/**
 * dsh-session-cost — host half.
 *
 * Prices a session's token usage locally and reports the account balance with
 * as few official calls as possible.
 *
 * Cost is a fold over the durable session log: every usage sample is priced at
 * its own event timestamp, so DeepSeek's peak/off-peak rates (off-peak is half
 * of peak) are applied to the right requests. No official API is involved in
 * costing; the only network call this plugin ever makes is the balance read,
 * which is cached on disk behind a TTL.
 *
 * Routes (GET, JSON, `cache-control: no-store`):
 *   /cost-api/session?sessionId=<id>   cost of the session plus its subagents
 *   /cost-api/balance[?refresh=1]      cached balance (refresh=1 forces a read)
 *   /cost-api/prices                   the price table actually in use
 *   /cost-api/health                   { ok, hasKey, balanceAgeMs }
 *
 * The API key is read through `ctx.credentials` and never leaves this process.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'dsh-session-cost';
export const inject = ['webServer'];
// Exported for tests and for a future UI that wants to explain the numbers.
export { DEFAULT_PRICES, PRICES_SOURCE, PRICES_READ_AT, isPeak, priceSample, foldEvents, bucketsFrom, bucketsEqual, usageOf };

const ROUTE = '/cost-api';

/**
 * Official list price, CNY per million tokens, from
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ (read 2026-10-04).
 * Off-peak is exactly half of peak; `offPeak` is stored explicitly anyway so a
 * future table need not be a clean halving.
 */
const DEFAULT_PRICES = {
  'deepseek-flash': {
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  },
  'deepseek-v4-pro': {
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
};
const PRICES_SOURCE = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/';
const PRICES_READ_AT = '2026-10-04';

const DEFAULT_BALANCE_URL = 'https://api.deepseek.com/user/balance';
const KEY_REF = 'DEEPSEEK_API_KEY';
/** Models billed as Flash when the log names something the table does not cover. */
const FALLBACK_MODEL = 'deepseek-flash';

const zeroBuckets = () => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

/** Buckets from a provider usage sample; `inputTokens` is the uncached input. */
function bucketsFrom(usage) {
  return {
    uncachedInputTokens: Number(usage?.inputTokens ?? 0),
    outputTokens: Number(usage?.outputTokens ?? 0),
    cacheReadTokens: Number(usage?.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(usage?.cacheWriteTokens ?? 0),
  };
}

/** Whether two usage samples are identical, so a repeat folds as a no-op. */
function bucketsEqual(left, right) {
  return (
    left.uncachedInputTokens === right.uncachedInputTokens &&
    left.outputTokens === right.outputTokens &&
    left.cacheReadTokens === right.cacheReadTokens &&
    left.cacheWriteTokens === right.cacheWriteTokens
  );
}

/** One durable Assistant settlement's usage sample, matching the token meter. */
function usageOf(event) {
  if (event.type === 'assistant/message' && event.data?.usage !== undefined) return event.data.usage;
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined;
  const stream = event.data?.stream;
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index];
    if (record?.type === 'usage' && record.usage !== undefined) return record.usage;
  }
  return undefined;
}

/** Event times are epoch milliseconds; tolerate seconds from older logs. */
function normalizeTime(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return Date.now();
  return time < 1e12 ? time * 1000 : time;
}

/**
 * Whether one instant falls in DeepSeek's peak window: Beijing time (UTC+8),
 * Monday–Friday, 09:00–12:00 or 14:00–18:00. Chinese public holidays are not
 * modelled, so a holiday is priced as peak — see the README.
 */
function isPeak(instantMs) {
  const shifted = new Date(instantMs + 8 * 3600 * 1000);
  const weekday = shifted.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60);
}

/** Price one usage sample under one model's table. */
function priceSample(buckets, instantMs, prices, model) {
  const table = prices[model] ?? prices[FALLBACK_MODEL];
  const tier = isPeak(instantMs) ? 'peak' : 'offPeak';
  const rate = table[tier];
  const perMillion = (tokens, unit) => (tokens / 1e6) * unit;
  const cacheHit = perMillion(buckets.cacheReadTokens, rate.cacheHit);
  const cacheMiss = perMillion(buckets.uncachedInputTokens, rate.cacheMiss);
  const cacheWrite = perMillion(buckets.cacheWriteTokens, rate.cacheMiss);
  const output = perMillion(buckets.outputTokens, rate.output);
  return { total: cacheHit + cacheMiss + cacheWrite + output, cacheHit, cacheMiss, cacheWrite, output, tier, model };
}

/**
 * Fold one session's events into a cost.
 *
 * Mirrors `dsh-token-meter`'s usage fold exactly: a usage sample replaces the
 * previous one only within the same (turn, step), so a restated streaming
 * settlement is not double billed while every new step is; `llm/retry-started`
 * closes that slot so a retried attempt is billed too. Unlike the reference,
 * each surviving sample keeps its own timestamp for peak/off-peak pricing.
 */
function foldEvents(events, prices, defaultModel) {
  const attempts = [];
  const totals = zeroBuckets();
  const byTier = { peak: 0, offPeak: 0 };
  let model = defaultModel;
  let last = null;

  for (const event of events) {
    if (event?.type === 'request/header') {
      const named = event.data?.header?.config?.model;
      if (typeof named === 'string' && named !== '') model = named;
      continue;
    }
    if (event?.type === 'llm/retry-started') {
      if (last !== null && last.turn === event.data?.turn && last.step === event.data?.step) last = null;
      continue;
    }
    const usage = usageOf(event);
    if (usage === undefined) continue;
    const turn = event.data?.turn;
    const step = event.data?.step;
    const buckets = bucketsFrom(usage);
    // Only samples from the SAME attempt replace each other (a streamed
    // settlement restating its own usage); a new step is a new billed attempt.
    const sameAttempt = last !== null && last.turn === turn && last.step === step;
    if (sameAttempt && bucketsEqual(last.buckets, buckets)) continue;
    const priced = priceSample(buckets, normalizeTime(event.time), prices, model);
    const record = { buckets, priced };
    if (sameAttempt) attempts[attempts.length - 1] = record;
    else attempts.push(record);
    last = { turn, step, buckets };
  }

  let cost = 0;
  const models = new Set();
  for (const attempt of attempts) {
    // A failed model id must not silently inherit a cheaper table's numbers.
    const known = prices[attempt.priced.model] !== undefined ? attempt.priced.model : FALLBACK_MODEL;
    models.add(known);
    cost += attempt.priced.total;
    byTier[attempt.priced.tier] += attempt.priced.total;
    totals.uncachedInputTokens += attempt.buckets.uncachedInputTokens;
    totals.outputTokens += attempt.buckets.outputTokens;
    totals.cacheReadTokens += attempt.buckets.cacheReadTokens;
    totals.cacheWriteTokens += attempt.buckets.cacheWriteTokens;
  }
  return { cost, totals, byTier, attempts: attempts.length, models: [...models], unpriced: models.has(FALLBACK_MODEL) && model !== FALLBACK_MODEL };
}

/**
 * Apply the session-cost host plugin.
 * @param ctx - profile context; `webServer` plus a session query service.
 * @param config - optional `prices` override, `balanceTtlMs`, `balancePath`, `model`.
 */
export function apply(ctx, config) {
  const prices = { ...DEFAULT_PRICES, ...(config?.prices ?? {}) };
  const defaultModel = typeof config?.model === 'string' ? config.model : FALLBACK_MODEL;
  const balanceTtlMs = Number(config?.balanceTtlMs) > 0 ? Number(config.balanceTtlMs) : 15 * 60 * 1000;
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh');
  const balancePath = typeof config?.balancePath === 'string' ? config.balancePath : join(home, 'storages', 'dsh-session-cost', 'balance.json');
  const balanceUrl = typeof config?.balanceUrl === 'string' && config.balanceUrl !== '' ? config.balanceUrl : DEFAULT_BALANCE_URL;

  /** Cost per session, memoized by the log length it was folded from. */
  const cache = new Map();
  /** Where the key was found, without ever touching its value. */
  let keyState = 'unknown';
  let balanceMemory = null;

  /** Read the configured DeepSeek key through the credential service. */
  async function resolveKey() {
    const credentials = ctx.get('credentials');
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(KEY_REF);
        if (hit?.value) {
          keyState = hit.source ?? 'store';
          return hit.value;
        }
        keyState = 'unset';
      } catch (error) {
        keyState = `error: ${String(error?.message ?? error)}`;
      }
    } else {
      keyState = 'no credentials service';
    }
    const fromEnv = process.env[KEY_REF];
    if (typeof fromEnv === 'string' && fromEnv !== '') {
      keyState = 'environment';
      return fromEnv;
    }
    return undefined;
  }

  async function readBalanceCache() {
    try {
      const parsed = JSON.parse(await readFile(balancePath, 'utf8'));
      return parsed !== null && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  async function writeBalanceCache(payload) {
    try {
      await mkdir(join(balancePath, '..'), { recursive: true });
      await writeFile(balancePath, JSON.stringify(payload), { mode: 0o600 });
    } catch {
      /* an unwritable cache must not break the read */
    }
  }

  /** The account balance, from the on-disk cache unless it is stale or forced. */
  async function balance(force) {
    const now = Date.now();
    const cached = balanceMemory ?? (await readBalanceCache());
    if (cached !== null) balanceMemory = cached;
    if (!force && cached !== null && typeof cached.fetchedAt === 'number' && now - cached.fetchedAt < balanceTtlMs) {
      return { ...cached, cached: true, ageMs: now - cached.fetchedAt, ttlMs: balanceTtlMs };
    }
    const key = await resolveKey();
    if (key === undefined) {
      return {
        ...(cached ?? {}),
        error: 'NO_KEY',
        keyState,
        cached: cached !== null,
        ageMs: cached?.fetchedAt !== undefined ? now - cached.fetchedAt : null,
        ttlMs: balanceTtlMs,
      };
    }
    try {
      const response = await fetch(balanceUrl, {
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        return {
          ...(cached ?? {}),
          error: `HTTP_${String(response.status)}`,
          keyState,
          cached: cached !== null,
          ageMs: cached?.fetchedAt !== undefined ? now - cached.fetchedAt : null,
          ttlMs: balanceTtlMs,
        };
      }
      const body = await response.json();
      const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : [];
      const cny = infos.find((info) => info?.currency === 'CNY') ?? infos[0] ?? null;
      const payload = {
        fetchedAt: now,
        isAvailable: body?.is_available === true,
        currency: cny?.currency ?? 'CNY',
        totalBalance: cny?.total_balance ?? null,
        grantedBalance: cny?.granted_balance ?? null,
        toppedUpBalance: cny?.topped_up_balance ?? null,
        keyState,
      };
      balanceMemory = payload;
      await writeBalanceCache(payload);
      return { ...payload, cached: false, ageMs: 0, ttlMs: balanceTtlMs };
    } catch (error) {
      return {
        ...(cached ?? {}),
        error: String(error?.name === 'TimeoutError' ? 'TIMEOUT' : (error?.message ?? error)),
        keyState,
        cached: cached !== null,
        ageMs: cached?.fetchedAt !== undefined ? now - cached.fetchedAt : null,
        ttlMs: balanceTtlMs,
      };
    }
  }

  /** Every session id that belongs to `rootId`, including root's subagents. */
  async function familyOf(rootId) {
    const query = ctx.get('sessionQuery');
    const ids = [rootId];
    if (query === undefined || typeof query.listSessions !== 'function') return ids;
    let records;
    try {
      records = await query.listSessions();
    } catch {
      return ids;
    }
    const children = new Map();
    for (const record of records ?? []) {
      const parent = record?.header?.parentSession;
      if (typeof parent !== 'string') continue;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(record.header.id);
    }
    const queue = [rootId];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const child of children.get(current) ?? []) {
        if (ids.includes(child)) continue;
        ids.push(child);
        queue.push(child);
      }
    }
    return ids;
  }

  /** Cost of one session, folded from its durable log and memoized by length. */
  async function costOf(sessionId) {
    const query = ctx.get('sessionQuery');
    if (query === undefined || typeof query.readSession !== 'function') {
      throw new Error('session query service unavailable');
    }
    const snapshot = await query.readSession(sessionId);
    const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
    const signature = `${String(events.length)}:${String(snapshot?.inheritedEventCount ?? 0)}`;
    const cached = cache.get(sessionId);
    if (cached !== undefined && cached.signature === signature) return cached.value;
    const value = foldEvents(events, prices, defaultModel);
    cache.set(sessionId, { signature, value });
    return value;
  }

  /** The session plus every descendant, added up. */
  async function familyCost(sessionId) {
    const ids = await familyOf(sessionId);
    const total = { cost: 0, totals: zeroBuckets(), byTier: { peak: 0, offPeak: 0 }, attempts: 0, models: [], unpriced: false };
    let counted = 0;
    const failures = [];
    for (const id of ids) {
      try {
        const one = await costOf(id);
        counted += 1;
        total.cost += one.cost;
        total.attempts += one.attempts;
        total.byTier.peak += one.byTier.peak;
        total.byTier.offPeak += one.byTier.offPeak;
        total.unpriced = total.unpriced || one.unpriced === true;
        for (const key of Object.keys(total.totals)) total.totals[key] += one.totals[key];
        for (const model of one.models) if (!total.models.includes(model)) total.models.push(model);
      } catch (error) {
        failures.push({ sessionId: id, error: String(error?.message ?? error) });
      }
    }
    return { ...total, sessions: counted, failures };
  }

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === `${ROUTE}/session`) {
        const sessionId = url.searchParams.get('sessionId') ?? '';
        if (sessionId === '') {
          sendJson(res, 400, { error: 'sessionId is required' });
          return;
        }
        sendJson(res, 200, { currency: 'CNY', ...(await familyCost(sessionId)) });
        return;
      }
      if (url.pathname === `${ROUTE}/balance`) {
        sendJson(res, 200, await balance(url.searchParams.get('refresh') === '1'));
        return;
      }
      if (url.pathname === `${ROUTE}/prices`) {
        sendJson(res, 200, { prices, defaultModel, source: PRICES_SOURCE, readAt: PRICES_READ_AT });
        return;
      }
      if (url.pathname === `${ROUTE}/health`) {
        const cached = balanceMemory ?? (await readBalanceCache());
        sendJson(res, 200, {
          ok: true,
          keyState,
          balanceAgeMs: cached?.fetchedAt !== undefined ? Date.now() - cached.fetchedAt : null,
          cachedSessions: cache.size,
        });
        return;
      }
      sendJson(res, 404, { error: 'unknown cost route' });
    } catch (error) {
      sendJson(res, 500, { error: String(error?.message ?? error) });
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler }), 'dsh-session-cost: /cost-api');
}
