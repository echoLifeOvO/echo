/**
 * dsh-session-cost — browser half.
 *
 * One entry in `conversation.composer.dock`, the ambient row below the
 * composer, next to the shipped token/cache stats: `spent / remaining`.
 * Clicking it opens the breakdown.
 *
 * Everything shown comes from the host half's `/cost-api` routes. The cost is
 * a local fold over the session log; the balance is a cached official read.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-cost',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const e = React.createElement;
    const { createPortal } = require('react-dom');
    const { useState, useEffect, useRef } = React;

    const ENTRY_ID = 'cost';
    const STYLE_ID = 'dsh-session-cost-style';
    const COST_POLL_MS = 3000;
    const BALANCE_POLL_MS = 60000;
    const PANEL_WIDTH = 330;

    const CSS = `
.sc-pill{display:inline-flex;align-items:center;gap:6px;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-family:inherit;font-size:12px;line-height:1.6;font-variant-numeric:tabular-nums;padding:2px 6px;border-radius:6px;cursor:pointer;white-space:nowrap}
.sc-pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-secondary,#4a4a4a)}
.sc-spent{color:var(--dsw-alias-label-secondary,#4a4a4a)}
.sc-sep{opacity:.5}
.sc-dim{opacity:.75}
.sc-panel{position:fixed;z-index:1200;width:${String(PANEL_WIDTH)}px;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-elevation-prominent,0 8px 28px rgba(0,0,0,.16));color:var(--dsw-alias-label-primary,#1a1a1a);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);font-size:12.5px;line-height:1.65}
.sc-panel h4{margin:0 0 8px;font-size:13px;font-weight:650}
.sc-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.sc-row+.sc-row{margin-top:3px}
.sc-row dt,.sc-row .sc-k{color:var(--dsw-alias-label-secondary,#4a4a4a)}
.sc-num{font-variant-numeric:tabular-nums}
.sc-total{margin:0 0 10px;font-size:20px;font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.sc-total small{font-size:12px;font-weight:400;color:var(--dsw-alias-label-tertiary,#8a8a8a);margin-left:6px}
.sc-rule{height:1px;background:var(--dsw-alias-border-l2,rgba(0,0,0,.08));margin:10px 0}
.sc-note{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11.5px;line-height:1.6}
.sc-note a{color:var(--dsw-alias-link,#4d6bfe);text-decoration:none}
.sc-err{color:var(--dsw-alias-label-error,#dc2626)}
.sc-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px}
.sc-btn{appearance:none;border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:transparent;color:var(--dsw-alias-label-secondary,#4a4a4a);border-radius:7px;padding:2px 9px;font-family:inherit;font-size:11.5px;cursor:pointer}
.sc-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#1a1a1a)}
.sc-btn:disabled{opacity:.5;cursor:default}
`;

    /** Two decimals normally, three for amounts that would otherwise read 0.00. */
    function money(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      const abs = Math.abs(value);
      if (abs > 0 && abs < 0.01) return value.toFixed(3);
      return value.toFixed(2);
    }

    /** Whole tokens with thousands separators. */
    function tokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      return value.toLocaleString('zh-CN');
    }

    /** A short "3 分钟前" style age. */
    function age(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return '未知';
      if (ms < 60000) return '刚刚';
      const minutes = Math.round(ms / 60000);
      if (minutes < 60) return `${String(minutes)} 分钟前`;
      const hours = Math.round(minutes / 60);
      if (hours < 24) return `${String(hours)} 小时前`;
      return `${String(Math.round(hours / 24))} 天前`;
    }

    async function getJson(path) {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return await response.json();
    }

    /** The dock pill and its breakdown panel. */
    function CostPill(props) {
      const sessionId = props.sessionId;
      const [cost, setCost] = useState(null);
      const [balance, setBalance] = useState(null);
      const [open, setOpen] = useState(false);
      const [busy, setBusy] = useState(false);
      const [pos, setPos] = useState(null);
      const pillRef = useRef(null);

      // Session cost is local and cheap; poll it briskly while it is visible.
      useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined;
        let alive = true;
        const load = async () => {
          try {
            const next = await getJson(`/cost-api/session?sessionId=${encodeURIComponent(sessionId)}`);
            if (alive) setCost(next);
          } catch {
            /* leave the last good value in place */
          }
        };
        load();
        const timer = window.setInterval(load, COST_POLL_MS);
        return () => {
          alive = false;
          window.clearInterval(timer);
        };
      }, [sessionId]);

      // The balance is cached host-side behind a TTL, so this poll is cheap.
      useEffect(() => {
        let alive = true;
        const load = async () => {
          try {
            const next = await getJson('/cost-api/balance');
            if (alive) setBalance(next);
          } catch {
            /* ignore; the panel says what it knows */
          }
        };
        load();
        const timer = window.setInterval(load, BALANCE_POLL_MS);
        return () => {
          alive = false;
          window.clearInterval(timer);
        };
      }, []);

      useEffect(() => {
        if (!open) return undefined;
        const onDown = (event) => {
          if (event.target instanceof Element && event.target.closest('.sc-panel, .sc-pill') !== null) return;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        const onResize = () => setOpen(false);
        window.addEventListener('pointerdown', onDown, true);
        window.addEventListener('keydown', onKey);
        window.addEventListener('resize', onResize);
        return () => {
          window.removeEventListener('pointerdown', onDown, true);
          window.removeEventListener('keydown', onKey);
          window.removeEventListener('resize', onResize);
        };
      }, [open]);

      const spent = cost?.cost;
      const remaining = typeof balance?.totalBalance === 'string' ? Number(balance.totalBalance) : balance?.totalBalance;

      const toggle = () => {
        const rect = pillRef.current?.getBoundingClientRect();
        if (rect !== undefined && rect !== null) {
          setPos({
            left: Math.max(12, Math.min(rect.left + rect.width / 2 - PANEL_WIDTH / 2, window.innerWidth - PANEL_WIDTH - 12)),
            bottom: window.innerHeight - rect.top + 8,
          });
        }
        setOpen(!open);
      };

      const refreshBalance = async () => {
        setBusy(true);
        try {
          setBalance(await getJson('/cost-api/balance?refresh=1'));
        } catch {
          /* keep the previous reading */
        } finally {
          setBusy(false);
        }
      };

      const rows = [];
      if (cost !== null) {
        const t = cost.totals ?? {};
        rows.push(
          e('div', { className: 'sc-row', key: 'in' },
            e('span', { className: 'sc-k' }, '未命中输入'),
            e('span', { className: 'sc-num' }, `${tokens(t.uncachedInputTokens)} tok`)),
          e('div', { className: 'sc-row', key: 'hit' },
            e('span', { className: 'sc-k' }, '缓存命中'),
            e('span', { className: 'sc-num' }, `${tokens(t.cacheReadTokens)} tok`)),
          e('div', { className: 'sc-row', key: 'cw' },
            e('span', { className: 'sc-k' }, '缓存写入'),
            e('span', { className: 'sc-num' }, `${tokens(t.cacheWriteTokens)} tok`)),
          e('div', { className: 'sc-row', key: 'out' },
            e('span', { className: 'sc-k' }, '输出'),
            e('span', { className: 'sc-num' }, `${tokens(t.outputTokens)} tok`)),
        );
      }

      const panel = open && pos !== null
        ? createPortal(
            e(
              'div',
              { className: 'sc-panel', style: { left: pos.left, bottom: pos.bottom } },
              e('h4', null, '本会话花费'),
              e('div', { className: 'sc-total' }, money(spent),
                e('small', null, cost !== null && cost.sessions > 1 ? `含 ${String(cost.sessions)} 个会话（含子智能体）` : '人民币')),
              rows,
              cost !== null
                ? e('div', { className: 'sc-row' },
                    e('span', { className: 'sc-k' }, '高峰 / 空闲'),
                    e('span', { className: 'sc-num' }, `${money(cost.byTier?.peak)} / ${money(cost.byTier?.offPeak)}`))
                : null,
              e('div', { className: 'sc-rule' }),
              e('h4', null, '账户余额'),
              balance?.error !== undefined && balance?.error !== null
                ? e('div', { className: 'sc-err' }, `读取失败：${String(balance.error)}${balance.keyState !== undefined ? `（key: ${String(balance.keyState)}）` : ''}`)
                : null,
              e('div', { className: 'sc-total' }, money(remaining),
                balance?.currency !== undefined ? e('small', null, String(balance.currency)) : null),
              balance !== null
                ? e('div', null,
                    e('div', { className: 'sc-row' },
                      e('span', { className: 'sc-k' }, '充值余额'),
                      e('span', { className: 'sc-num' }, money(Number(balance.toppedUpBalance)))),
                    e('div', { className: 'sc-row' },
                      e('span', { className: 'sc-k' }, '赠金余额'),
                      e('span', { className: 'sc-num' }, money(Number(balance.grantedBalance)))))
                : e('div', { className: 'sc-note' }, '读取中…'),
              e('div', { className: 'sc-foot' },
                e('span', { className: 'sc-note' }, `余额取自 ${age(balance?.ageMs)}`),
                e('button', { type: 'button', className: 'sc-btn', disabled: busy, onClick: refreshBalance }, busy ? '刷新中…' : '刷新')),
              e('div', { className: 'sc-rule' }),
              e('div', { className: 'sc-note' },
                '按官方价目表本地估算，不是账单。空闲时段按高峰半价计；中国法定节假日未建模，节假日会按高峰价高估。价格核对日期 2026-10-04：',
                e('a', { href: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', target: '_blank', rel: 'noreferrer' }, '官方价格页'),
              ),
            ),
            document.body,
          )
        : null;

      return e(
        'span',
        null,
        e(
          'button',
          {
            ref: pillRef,
            type: 'button',
            className: 'sc-pill',
            onClick: toggle,
            title: '本会话花费 / 账户余额',
            'aria-expanded': open,
          },
          e('span', { className: 'sc-spent' }, money(spent)),
          e('span', { className: 'sc-sep' }, '/'),
          e('span', { className: 'sc-dim' }, money(remaining)),
        ),
        panel,
      );
    }

    /** Install the stylesheet once, owned by the module system. */
    function installStyle(doc) {
      if (doc.getElementById(STYLE_ID) !== null) return;
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.setAttribute('data-plugin-css', 'dsh-session-cost');
      style.textContent = CSS;
      doc.head.appendChild(style);
    }

    if (typeof document !== 'undefined') installStyle(document);

    /**
     * Client plugin body: add the pill to the ambient row under the composer.
     * Order 1 puts it right after the shipped token/cache stats.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register({ name: 'conversation.composer.dock', id: ENTRY_ID, order: 1 }, CostPill),
      );
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    return module.exports;
  },
});
