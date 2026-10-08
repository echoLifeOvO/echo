/**
 * dsh-knowledge-board — host half.
 *
 * Serves the knowledge board's read-only JSON API from local files, so the
 * browser half (lib/client.js) can render whatever the agent writes into the
 * workspace. The content root is a directory of `<direction>/board.json`
 * files; nothing is cached, so an agent file write shows up on the next poll.
 *
 * Routes (all GET, all JSON, `cache-control: no-store`):
 *   /board-api/manifest                      light index + revision + focus (the 2s poll)
 *   /board-api/board                         every direction with full node blocks (the canvas)
 *   /board-api/node?direction=<d>&id=<node>  one node's block list
 *   /board-api/health                        { ok, root } — used by the test loop
 *
 * The route is registered on the bare web server (no /api fence), so the
 * Desktop shell's `dsh-app://app/*` protocol bridge and the browser both reach
 * it unchanged. It only reads files under `contentRoot`.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-knowledge-board';
export const inject = ['webServer'];

const ROUTE = '/board-api';
const FOCUS_FILE = '.board-focus.json';
/**
 * Where the content lives when the entry declares no `contentRoot`: the
 * `learning/` directory of the workspace this plugin is checked out inside
 * (`<repo>/tooling/<plugin>/lib/index.js` → `<repo>/learning`). Deriving it
 * from this module's own location keeps the whole setup relocatable.
 */
const DEFAULT_CONTENT_ROOT = fileURLToPath(new URL('../../../learning', import.meta.url));

/** Read a file as UTF-8, returning undefined when it does not exist. */
async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Read and parse a JSON file, returning undefined for a missing or broken file. */
async function readJson(path) {
  const text = await readOptional(path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A one-line fingerprint of the files a board render depends on. */
async function revisionOf(paths) {
  const parts = [];
  for (const path of paths) {
    try {
      const info = await stat(path);
      parts.push(`${path}:${String(info.size)}:${String(Math.round(info.mtimeMs))}`);
    } catch {
      parts.push(`${path}:-`);
    }
  }
  return parts.join('|');
}

/**
 * Apply the knowledge-board host plugin.
 * @param ctx - profile context; `webServer` is the only required service.
 * @param config - optional `contentRoot` overriding the derived workspace default.
 */
export function apply(ctx, config) {
  const rawRoot = typeof config?.contentRoot === 'string' && config.contentRoot !== '' ? config.contentRoot : DEFAULT_CONTENT_ROOT;
  const root = resolve(rawRoot);

  /** Read every `<direction>/board.json` under the content root. */
  async function readDirections() {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      throw new Error(`content root unreadable: ${root} (${String(error?.message ?? error)})`);
    }
    const directions = [];
    const files = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = join(root, entry.name, 'board.json');
      const board = await readJson(file);
      if (board === undefined) continue;
      files.push(file);
      const nodes = Array.isArray(board.nodes) ? board.nodes : [];
      directions.push({
        id: typeof board.direction === 'string' ? board.direction : entry.name,
        title: typeof board.title === 'string' ? board.title : entry.name,
        subtitle: typeof board.subtitle === 'string' ? board.subtitle : '',
        source: typeof board.source === 'string' ? board.source : '',
        nodes: nodes.map((node) => ({
          id: String(node?.id ?? ''),
          title: String(node?.title ?? node?.id ?? ''),
          subtitle: typeof node?.subtitle === 'string' ? node.subtitle : '',
          status: typeof node?.status === 'string' ? node.status : 'planned',
          updated: typeof node?.updated === 'string' ? node.updated : '',
        })),
      });
    }
    files.sort();
    return { directions, files };
  }

  /** Locate one node and return both the node and its direction metadata. */
  async function readNode(directionId, nodeId) {
    const { directions } = await readDirections();
    const direction = directions.find((item) => item.id === directionId);
    if (direction === undefined) return undefined;
    const file = join(root, directionId, 'board.json');
    const board = await readJson(file);
    if (board === undefined) return undefined;
    const nodes = Array.isArray(board.nodes) ? board.nodes : [];
    const node = nodes.find((item) => String(item?.id ?? '') === nodeId);
    if (node === undefined) return undefined;
    return { direction: { id: direction.id, title: direction.title }, node };
  }

  /** Every direction with its nodes' full block lists — what the canvas draws. */
  async function board() {
    let directions = [];
    let files = [];
    let error;
    try {
      const read = await readDirections();
      files = read.files;
      directions = await Promise.all(
        read.directions.map(async (direction) => {
          const parsed = await readJson(join(root, direction.id, 'board.json'));
          const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
          return { id: direction.id, title: direction.title, subtitle: direction.subtitle, nodes };
        }),
      );
    } catch (failure) {
      error = String(failure?.message ?? failure);
    }
    const focusPath = join(root, FOCUS_FILE);
    files.push(focusPath);
    return { rev: await revisionOf(files), root, error, focus: await readFocus(focusPath), directions };
  }

  /** Read the agent's focus file into the shape the board renders. */
  async function readFocus(focusPath) {
    const focus = (await readJson(focusPath)) ?? null;
    return focus !== null && typeof focus === 'object'
      ? {
          direction: typeof focus.direction === 'string' ? focus.direction : null,
          node: typeof focus.node === 'string' ? focus.node : null,
          note: typeof focus.note === 'string' ? focus.note : '',
          ts: typeof focus.ts === 'number' ? focus.ts : 0,
        }
      : null;
  }

  async function manifest() {
    const focusPath = join(root, FOCUS_FILE);
    let directions = [];
    let files = [];
    let error;
    try {
      ({ directions, files } = await readDirections());
    } catch (failure) {
      // A missing or unreadable content root is a setup problem, not a crash:
      // answer 200 with the message so the board can show it in place.
      error = String(failure?.message ?? failure);
    }
    files.push(focusPath);
    return {
      rev: await revisionOf(files),
      root,
      error,
      focus: await readFocus(focusPath),
      directions,
    };
  }

  /** One JSON response; `no-store` keeps polling honest. */
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
      if (url.pathname === `${ROUTE}/manifest`) {
        sendJson(res, 200, await manifest());
        return;
      }
      if (url.pathname === `${ROUTE}/board`) {
        sendJson(res, 200, await board());
        return;
      }
      if (url.pathname === `${ROUTE}/node`) {
        const direction = url.searchParams.get('direction') ?? '';
        const id = url.searchParams.get('id') ?? '';
        if (direction === '' || id === '') {
          sendJson(res, 400, { error: 'direction and id are required' });
          return;
        }
        if (direction.includes(sep) || direction.includes('..') || id.includes(sep)) {
          sendJson(res, 400, { error: 'invalid identifier' });
          return;
        }
        const found = await readNode(direction, id);
        if (found === undefined) {
          sendJson(res, 404, { error: `no node ${direction}/${id}` });
          return;
        }
        sendJson(res, 200, { rev: await revisionOf([join(root, direction, 'board.json')]), ...found });
        return;
      }
      if (url.pathname === `${ROUTE}/health`) {
        sendJson(res, 200, { ok: true, root, name });
        return;
      }
      sendJson(res, 404, { error: 'unknown board route' });
    } catch (error) {
      sendJson(res, 500, { error: String(error?.message ?? error) });
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler }),
    'dsh-knowledge-board: /board-api',
  );
}
