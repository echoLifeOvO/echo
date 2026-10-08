/**
 * dsh-session-map — browser half.
 *
 * Registers a full-window "session map" into the central `main` slot: every
 * workspace is a band, every session a card, and each card shows what that
 * session is doing right now (running / waiting for you / finished unread /
 * idle).
 *
 * Navigation model, per the user's design:
 *   - the conversation stays the default surface;
 *   - one shortcut (⌘⇧M) toggles the map;
 *   - picking a card opens that session and returns to the conversation;
 *   - Escape returns to the conversation;
 *   - the sidebar is collapsed once at startup, so the session pane spans the
 *     window and the map is one keypress away.
 *
 * All of this uses shipped extension points only: the `main` keyed slot, the
 * `shortcuts` service, `ctx.layout`, and `ctx.uiWorkspace`. No theme or layout
 * overrides.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-map',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const e = React.createElement;
    const { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } = React;

    const PANEL_ID = 'session-map';
    const STYLE_ID = 'dsh-session-map-style';

    /** Fixed card geometry; fixed sizes keep the layout a pure function. */
    const CARD_W = 302;
    const CARD_H = 104;
    const GAP_X = 26;
    const GAP_Y = 26;
    const BAND_GAP = 54;
    const LABEL_H = 34;
    const PER_ROW = 5;
    const FIT_PADDING = 64;
    const MIN_ZOOM = 0.2;
    const MAX_ZOOM = 1.6;
    const VIEW_KEY = 'dsh-session-map/view';
    /** The reader's last sidebar choice, so a later start reproduces it. */
    const SIDEBAR_KEY = 'dsh-session-map/sidebar-collapsed';

    /** Set while the map is the selected main panel, so the shortcut can toggle. */
    let mapVisible = false;

    //#region styles
    const CSS = `
.sm-root{position:absolute;inset:0;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)}
.sm-stage{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;background-image:radial-gradient(circle at 1px 1px,var(--dsw-alias-border-l2,rgba(0,0,0,.14)) 1px,transparent 0);background-size:26px 26px}
.sm-stage.sm-grabbing{cursor:grabbing}
.sm-world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.sm-world.sm-animate{transition:transform .26s cubic-bezier(.22,.61,.36,1)}
.sm-band{position:absolute;font-size:13px;font-weight:650;letter-spacing:.01em;color:var(--dsw-alias-label-tertiary,#8a8a8a);white-space:nowrap;user-select:none}
.sm-band-path{font-size:11px;font-weight:400;letter-spacing:0;text-transform:none;opacity:.7;margin-left:10px}
.sm-card{position:absolute;box-sizing:border-box;width:${String(CARD_W)}px;height:${String(CARD_H)}px;padding:12px 14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-elevation-soft,0 1px 4px rgba(0,0,0,.05));cursor:pointer;display:flex;flex-direction:column;gap:6px;transition:border-color .15s,box-shadow .15s,transform .15s}
.sm-card:hover{border-color:var(--dsw-alias-border-l4,rgba(0,0,0,.22));box-shadow:var(--dsw-elevation-prominent,0 6px 18px rgba(0,0,0,.12))}
.sm-card.sm-current{box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 45%,transparent),var(--dsw-elevation-soft,0 1px 4px rgba(0,0,0,.05))}
.sm-card.sm-running{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 55%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 16%,transparent),var(--dsw-elevation-soft,0 1px 4px rgba(0,0,0,.05))}
.sm-card.sm-waiting{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 60%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 18%,transparent),var(--dsw-elevation-soft,0 1px 4px rgba(0,0,0,.05))}
.sm-card.sm-idle{opacity:.72}
.sm-card.sm-idle:hover{opacity:1}
.sm-title{font-size:13.5px;font-weight:600;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.sm-meta{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8a8a);margin-top:auto;font-variant-numeric:tabular-nums}
.sm-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-label-dimmed,#c4c4c4)}
.sm-dot.sm-dot-running{background:var(--dsw-alias-state-success-primary,#22c55e)}
.sm-dot.sm-dot-waiting{background:var(--dsw-alias-state-warn-primary,#f59e0b)}
.sm-dot.sm-dot-done{background:var(--dsw-alias-state-business-primary,#7c8cff)}
.sm-chip{font-size:10.5px;font-weight:650;letter-spacing:.04em;padding:1px 6px;border-radius:999px;border:1px solid currentColor;flex:none}
.sm-chip-current{color:var(--dsw-alias-brand-primary,#4d6bfe)}
.sm-chip-waiting{color:var(--dsw-alias-state-warn-primary,#b45309)}
.sm-chip-running{color:var(--dsw-alias-state-success-primary,#15803d)}
.sm-chip-done{color:var(--dsw-alias-state-business-primary,#5b6bff)}
.sm-new{display:flex;align-items:center;justify-content:center;gap:8px;border-style:dashed;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:13px;background:transparent}
.sm-new:hover{color:var(--dsw-alias-label-primary,#1a1a1a);border-color:var(--dsw-alias-border-l4,rgba(0,0,0,.22))}
.sm-bar{position:absolute;left:calc(12px + var(--dsh-frame-leading-clearance,0px));top:calc(var(--dsh-frame-top-clearance,0px) + 10px);z-index:3;display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 94%,transparent);box-shadow:var(--dsw-elevation-soft,0 2px 10px rgba(0,0,0,.06));font-size:12.5px}
.sm-bar-title{font-weight:650}
.sm-bar-meta{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-variant-numeric:tabular-nums}
.sm-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#4a4a4a);font-family:inherit;font-size:12.5px;padding:2px 7px;border-radius:6px;cursor:pointer}
.sm-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#1a1a1a)}
.sm-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:13.5px;flex-direction:column;gap:8px}
@media (prefers-reduced-motion:reduce){.sm-world.sm-animate{transition:none}}
`;
    //#endregion

    //#region helpers
    /** Read one JSON value from localStorage, tolerating anything broken. */
    function readStored(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : (JSON.parse(raw) ?? fallback);
      } catch {
        return fallback;
      }
    }

    /** Persist one JSON value, ignoring quota or privacy failures. */
    function writeStored(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* never let storage break the map */
      }
    }

    /** A short "3 分钟前" style age. */
    function ago(updatedAt) {
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return '';
      const delta = Date.now() - updatedAt;
      if (delta < 60_000) return '刚刚';
      const minutes = Math.floor(delta / 60_000);
      if (minutes < 60) return `${String(minutes)} 分钟前`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${String(hours)} 小时前`;
      const days = Math.floor(hours / 24);
      if (days < 30) return `${String(days)} 天前`;
      return `${String(Math.floor(days / 30))} 个月前`;
    }

    const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

    /**
     * A workspace's display name. Storage keeps the slug `default-workspace`
     * for the automatic workspace while the shipped UI shows a localized name,
     * so mirror that one case rather than showing the slug.
     */
    function workspaceLabel(workspace) {
      const title = typeof workspace.title === 'string' ? workspace.title : '';
      const path = typeof workspace.path === 'string' ? workspace.path : '';
      if (title === '' && path === '') return '工作区';
      if (title === 'default-workspace' || (title === '' && path.endsWith('/default-workspace'))) return '默认工作区';
      return title !== '' ? title : path;
    }

    /**
     * One card per visible session, plus a "new session" tile per workspace.
     * Fixed card sizes make this a pure function of the data.
     */
    function buildLayout(bands) {
      const cards = [];
      const labels = [];
      let y = 0;
      for (const band of bands) {
        labels.push({ key: band.key, title: band.title, path: band.path, x: 0, y, w: PER_ROW * (CARD_W + GAP_X) });
        y += LABEL_H;
        let column = 0;
        const place = (card) => {
          if (column >= PER_ROW) {
            column = 0;
            y += CARD_H + GAP_Y;
          }
          cards.push({ ...card, x: column * (CARD_W + GAP_X), y });
          column += 1;
        };
        for (const session of band.sessions) place({ kind: 'session', band: band.key, session });
        place({ kind: 'new', band: band.key, workspaceId: band.workspaceId });
        y += CARD_H + GAP_Y + BAND_GAP;
      }
      return { cards, labels, height: Math.max(y, 400) };
    }

    /** World-space bounds of the placed cards. */
    function boundsOf(cards) {
      if (cards.length === 0) return { minX: 0, minY: 0, maxX: CARD_W, maxY: 400 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const card of cards) {
        minX = Math.min(minX, card.x);
        minY = Math.min(minY, card.y);
        maxX = Math.max(maxX, card.x + CARD_W);
        maxY = Math.max(maxY, card.y + CARD_H);
      }
      return { minX, minY, maxX, maxY };
    }

    /** The view that fits a box inside the stage. */
    function fitView(box, size) {
      const width = Math.max(box.maxX - box.minX, 1);
      const height = Math.max(box.maxY - box.minY, 1);
      const k = clamp(
        Math.min((size.w - FIT_PADDING * 2) / width, (size.h - FIT_PADDING * 2) / height, 1),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      return { k, x: (size.w - width * k) / 2 - box.minX * k, y: (size.h - height * k) / 2 - box.minY * k };
    }
    //#endregion

    /** The session map panel. */
    function SessionMap(props) {
      const { useSessions, useWorkspaces, useSessionStatus, openSession, startSession, backToSession, toggleSidebar } = props;
      const list = useSessions((state) => state);
      const workspaceSnapshot = useWorkspaces((state) => state);
      const statuses = useSessionStatus((state) => state);

      const stageRef = useRef(null);
      const [size, setSize] = useState({ w: 1200, h: 700 });
      const [view, setView] = useState({ x: 0, y: 0, k: 1 });
      const [animate, setAnimate] = useState(false);
      const [sidebarHiddenState, setSidebarHiddenState] = useState(() => false);
      const animTimer = useRef(0);
      const viewRef = useRef(view);
      viewRef.current = view;
      const sizeRef = useRef(size);
      sizeRef.current = size;
      const fittedRef = useRef(null);

      useEffect(() => {
        mapVisible = true;
        setSidebarHiddenState(sidebarHidden());
        return () => {
          mapVisible = false;
        };
      }, []);

      const onToggleSidebar = useCallback(() => {
        toggleSidebar();
        const next = !sidebarHiddenState;
        setSidebarHiddenState(next);
        // Remember the choice: the next start reproduces it, and nothing is
        // collapsed until the reader has asked for it once.
        writeStored(SIDEBAR_KEY, next);
      }, [toggleSidebar, sidebarHiddenState]);

      /** One band per workspace, sessions in registry order. */
      /** Running child sessions per parent, so a card can show its own subagents. */
      const subagents = useMemo(() => {
        const byId = list?.byId ?? {};
        const counts = new Map();
        for (const session of Object.values(byId)) {
          if (session === null || session === undefined) continue;
          const parent = session.parentSessionId;
          if (typeof parent !== 'string') continue;
          if (!(statuses?.get?.(session.id)?.running)) continue;
          counts.set(parent, (counts.get(parent) ?? 0) + 1);
        }
        return counts;
      }, [list, statuses]);

      const bands = useMemo(() => {
        const byId = list?.byId ?? {};
        const items = Array.isArray(workspaceSnapshot?.items) ? workspaceSnapshot.items : [];
        const out = [];
        const seen = new Set();
        for (const workspace of items) {
          const sessions = [];
          for (const id of workspace.sessionIds ?? []) {
            seen.add(id);
            const session = byId[id];
            if (session === undefined) continue;
            if (session.origin === 'subagent') continue;
            if (session.blank === true) continue;
            sessions.push({
              id,
              title: typeof session.title === 'string' && session.title.trim() !== '' ? session.title.trim() : '未命名会话',
              updatedAt: session.updatedAt,
              current: (session.retainedBy?.mainView ?? 0) > 0,
              status: statuses?.get?.(id) ?? undefined,
            });
          }
          out.push({
            key: String(workspace.workspaceId ?? workspace.path ?? out.length),
            workspaceId: workspace.workspaceId,
            title: workspaceLabel(workspace),
            path: typeof workspace.path === 'string' ? workspace.path : '',
            sessions,
          });
        }
        // Sessions the registry knows but no workspace lists still deserve a home.
        const orphans = Object.values(byId).filter(
          (session) =>
            session !== undefined &&
            session !== null &&
            !seen.has(session.id) &&
            session.origin !== 'subagent' &&
            session.blank !== true,
        );
        if (orphans.length > 0) {
          out.push({
            key: '__orphans__',
            workspaceId: undefined,
            title: '未归入工作区',
            path: '',
            sessions: orphans.map((session) => ({
              id: session.id,
              title: typeof session.title === 'string' && session.title.trim() !== '' ? session.title.trim() : '未命名会话',
              updatedAt: session.updatedAt,
              current: (session.retainedBy?.mainView ?? 0) > 0,
              status: statuses?.get?.(session.id) ?? undefined,
            })),
          });
        }
        return out;
      }, [list, workspaceSnapshot, statuses]);

      const layout = useMemo(() => buildLayout(bands), [bands]);
      const bounds = useMemo(() => boundsOf(layout.cards), [layout]);

      const counters = useMemo(() => {
        let running = 0;
        let waiting = 0;
        let total = 0;
        for (const band of bands) {
          for (const session of band.sessions) {
            total += 1;
            if (session.status?.pendingInteraction) waiting += 1;
            else if (session.status?.running) running += 1;
          }
        }
        return { running, waiting, total, workspaces: bands.length };
      }, [bands]);

      const animateTo = useCallback((next) => {
        setAnimate(true);
        setView(next);
        window.clearTimeout(animTimer.current);
        animTimer.current = window.setTimeout(() => setAnimate(false), 320);
      }, []);

      // Stage size.
      useLayoutEffect(() => {
        const node = stageRef.current;
        if (node === null) return undefined;
        let observer = null;
        const measure = () => {
          const rect = node.getBoundingClientRect();
          const next = { w: Math.max(rect.width, 320), h: Math.max(rect.height, 240) };
          setSize((current) => (Math.abs(current.w - next.w) < 1 && Math.abs(current.h - next.h) < 1 ? current : next));
        };
        measure();
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(measure);
          observer.observe(node);
        }
        window.addEventListener('resize', measure);
        return () => {
          observer?.disconnect();
          window.removeEventListener('resize', measure);
        };
      }, []);

      // A remembered view belongs to the card set it was taken on: when sessions
      // appear or disappear the shape changes, so re-fit instead of restoring a
      // view that may leave the new cards off screen.
      useEffect(() => {
        if (layout.cards.length === 0) return;
        const signature = `${String(layout.cards.length)}:${String(layout.labels.length)}`;
        if (fittedRef.current === signature) return;
        fittedRef.current = signature;
        const stored = readStored(VIEW_KEY, null);
        if (
          stored !== null &&
          typeof stored === 'object' &&
          typeof stored.k === 'number' &&
          stored.signature === signature
        ) {
          setView({ x: Number(stored.x) || 0, y: Number(stored.y) || 0, k: clamp(Number(stored.k), MIN_ZOOM, MAX_ZOOM) });
          return;
        }
        setView(fitView(bounds, sizeRef.current));
      }, [layout, bounds]);

      useEffect(() => {
        if (fittedRef.current === null) return;
        writeStored(VIEW_KEY, {
          x: Math.round(view.x),
          y: Math.round(view.y),
          k: Number(view.k.toFixed(4)),
          signature: fittedRef.current,
        });
      }, [view]);

      // Escape returns to the conversation.
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            backToSession();
          }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [backToSession]);

      // Wheel must be non-passive to own the gesture.
      useEffect(() => {
        const node = stageRef.current;
        if (node === null) return undefined;
        let pending = { dx: 0, dy: 0, zoom: 0, x: 0, y: 0 };
        let frame = 0;
        const flush = () => {
          frame = 0;
          const current = viewRef.current;
          setAnimate(false);
          if (pending.zoom !== 0) {
            const k = clamp(current.k * Math.exp(-pending.zoom / 320), MIN_ZOOM, MAX_ZOOM);
            const rect = node.getBoundingClientRect();
            const px = pending.x - rect.left;
            const py = pending.y - rect.top;
            setView({ k, x: px - ((px - current.x) * k) / current.k, y: py - ((py - current.y) * k) / current.k });
          } else {
            setView({ ...current, x: current.x - pending.dx, y: current.y - pending.dy });
          }
          pending = { dx: 0, dy: 0, zoom: 0, x: 0, y: 0 };
        };
        const onWheel = (event) => {
          event.preventDefault();
          if (event.ctrlKey || event.metaKey) {
            pending.zoom += event.deltaY;
            pending.x = event.clientX;
            pending.y = event.clientY;
          } else {
            pending.dx += event.deltaX;
            pending.dy += event.deltaY;
          }
          if (frame === 0) frame = window.requestAnimationFrame(flush);
        };
        node.addEventListener('wheel', onWheel, { passive: false });
        return () => node.removeEventListener('wheel', onWheel);
      }, []);

      /** Pan from anywhere that is not a card. */
      const startPan = useCallback((event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const origin = viewRef.current;
        const start = { x: event.clientX, y: event.clientY };
        const stage = stageRef.current;
        stage?.classList.add('sm-grabbing');
        let frame = 0;
        let latest = null;
        const apply = () => {
          frame = 0;
          if (latest === null) return;
          setAnimate(false);
          setView({ ...viewRef.current, x: origin.x + (latest.clientX - start.x), y: origin.y + (latest.clientY - start.y) });
        };
        const onMove = (moveEvent) => {
          latest = moveEvent;
          if (frame === 0) frame = window.requestAnimationFrame(apply);
        };
        const onUp = () => {
          if (frame !== 0) {
            window.cancelAnimationFrame(frame);
            apply();
          }
          stage?.classList.remove('sm-grabbing');
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }, []);

      const fitAll = useCallback(() => {
        animateTo(fitView(boundsOf(layout.cards), sizeRef.current));
      }, [animateTo, layout]);

      /** World children are memoized so panning never re-renders the cards. */
      const worldChildren = useMemo(
        () => [
          layout.labels.map((label) =>
            e(
              'div',
              { key: `label:${label.key}`, className: 'sm-band', style: { left: label.x, top: label.y, width: label.w } },
              label.title,
              label.path !== '' ? e('span', { className: 'sm-band-path' }, label.path) : null,
            ),
          ),
          layout.cards.map((card) => {
            if (card.kind === 'new') {
              return e(
                'div',
                {
                  key: `new:${card.band}`,
                  className: 'sm-card sm-new',
                  style: { left: card.x, top: card.y },
                  onClick: () => startSession(card.workspaceId),
                  title: '在这个工作区新建会话',
                },
                e('span', null, '＋ 新会话'),
              );
            }
            const status = card.session.status ?? {};
            const waiting = Boolean(status.pendingInteraction);
            const running = !waiting && Boolean(status.running ?? card.session.running);
            const unread = status.completionUnread === true;
            const classes = ['sm-card'];
            if (card.session.current) classes.push('sm-current');
            if (waiting) classes.push('sm-waiting');
            else if (running) classes.push('sm-running');
            else if (!unread) classes.push('sm-idle');
            const dotClass = waiting
              ? 'sm-dot sm-dot-waiting'
              : running
                ? 'sm-dot sm-dot-running'
                : unread
                  ? 'sm-dot sm-dot-done'
                  : 'sm-dot';
            return e(
              'div',
              {
                key: card.session.id,
                className: classes.join(' '),
                style: { left: card.x, top: card.y },
                onClick: () => openSession(card.session.id),
                title: card.session.title,
              },
              e(
                'div',
                { style: { display: 'flex', alignItems: 'flex-start', gap: '8px' } },
                e('div', { className: 'sm-title' }, card.session.title),
                card.session.current ? e('span', { className: 'sm-chip sm-chip-current' }, '当前') : null,
                waiting ? e('span', { className: 'sm-chip sm-chip-waiting' }, '待确认') : null,
                !waiting && running ? e('span', { className: 'sm-chip sm-chip-running' }, '在跑') : null,
                !waiting && !running && unread ? e('span', { className: 'sm-chip sm-chip-done' }, '未读') : null,
              ),
              e(
                'div',
                { className: 'sm-meta' },
                e('span', { className: dotClass }),
                e('span', null, ago(card.session.updatedAt)),
                status.runningSubagentCount > 0 ? e('span', null, `· ${String(status.runningSubagentCount)} 个子智能体`) : null,
              ),
            );
          }),
        ],
        [layout, openSession, startSession],
      );

      const empty = counters.total === 0;

      return e(
        'div',
        { className: 'sm-root' },
        e(
          'div',
          {
            ref: stageRef,
            className: 'sm-stage',
            onPointerDown: (event) => {
              if (event.target instanceof Element && event.target.closest('.sm-card') !== null) return;
              startPan(event);
            },
            onDoubleClick: (event) => {
              if (event.target instanceof Element && event.target.closest('.sm-card') !== null) return;
              fitAll();
            },
          },
          e(
            'div',
            {
              className: `sm-world${animate ? ' sm-animate' : ''}`,
              style: { transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.k)})` },
            },
            worldChildren,
          ),
        ),
        e(
          'div',
          { className: 'sm-bar' },
          e('span', { className: 'sm-bar-title' }, '会话地图'),
          e(
            'span',
            { className: 'sm-bar-meta' },
            `${String(counters.workspaces)} 个工作区 · ${String(counters.total)} 个会话`,
            counters.running > 0 ? ` · ${String(counters.running)} 个在跑` : '',
            counters.waiting > 0 ? ` · ${String(counters.waiting)} 个待确认` : '',
          ),
          e('button', { type: 'button', className: 'sm-btn', onClick: fitAll }, '适应画面'),
          e(
            'button',
            { type: 'button', className: 'sm-btn', onClick: onToggleSidebar },
            sidebarHiddenState ? '展开侧边栏 (⌘B)' : '收起侧边栏',
          ),
          e('button', { type: 'button', className: 'sm-btn', onClick: () => backToSession() }, '回到会话 (Esc)'),
        ),
        empty
          ? e(
              'div',
              { className: 'sm-empty' },
              e('div', null, '还没有会话'),
              e('div', { style: { fontSize: '12px' } }, '在上面点「回到会话」开始一个吧'),
            )
          : null,
      );
    }

    /** Sidebar glyph, shown only when the shipped sidebar is expanded. */
    function MapIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16;
      return e(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        e('rect', { x: 2, y: 2.5, width: 5, height: 4.5, rx: 1.2 }),
        e('rect', { x: 9, y: 2.5, width: 5, height: 4.5, rx: 1.2 }),
        e('rect', { x: 2, y: 9, width: 5, height: 4.5, rx: 1.2 }),
        e('rect', { x: 9, y: 9, width: 5, height: 4.5, rx: 1.2 }),
      );
    }

    /** Install the stylesheet once, owned by the module system. */
    function installStyle(doc) {
      if (doc.getElementById(STYLE_ID) !== null) return;
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.setAttribute('data-plugin-css', 'dsh-session-map');
      style.textContent = CSS;
      doc.head.appendChild(style);
    }

    if (typeof document !== 'undefined') installStyle(document);

    /**
     * Whether the sidebar column is currently hidden.
     *
     * The layout service exposes only a toggle, so this reads the frame's own
     * inline `grid-template-columns`: macOS desktop writes 0 for a hidden
     * column, other platforms a narrow rail.
     */
    function sidebarWidth() {
      try {
        const frame = [...document.querySelectorAll('[style]')].find((element) =>
          (element.getAttribute('style') ?? '').includes('grid-template-columns'),
        );
        if (frame === null || frame === undefined) return Number.NaN;
        const match = /grid-template-columns:\s*([\d.]+)px/.exec(frame.getAttribute('style') ?? '');
        return match === null ? Number.NaN : Number(match[1]);
      } catch {
        return Number.NaN;
      }
    }

    /**
     * A hidden sidebar measures 0 on macOS desktop and 0 on Windows, but keeps a
     * 56px rail on the web surface, while an expanded one is at least 264px. Any
     * width below 120 therefore means hidden on every platform; treating only 0
     * as hidden would read the web rail as expanded.
     */
    const SIDEBAR_HIDDEN_BELOW = 120;

    function sidebarHidden() {
      const width = sidebarWidth();
      return Number.isFinite(width) && width < SIDEBAR_HIDDEN_BELOW;
    }

    /**
     * Collapse the sidebar once at startup so the session pane spans the window.
     *
     * The layout service exposes only a toggle, so this reads the frame's own
     * inline `grid-template-columns` to tell whether the sidebar is already
     * hidden (0 on macOS desktop, a narrow rail elsewhere). It never fights a
     * later manual expand.
     */
    function collapseSidebar(ctx, attempt) {
      try {
        const frame = [...document.querySelectorAll('[style]')].find((element) =>
          (element.getAttribute('style') ?? '').includes('grid-template-columns'),
        );
        if (frame === null || frame === undefined) {
          if (attempt < 8) window.setTimeout(() => collapseSidebar(ctx, attempt + 1), 250);
          return;
        }
        const match = /grid-template-columns:\s*([\d.]+)px/.exec(frame.getAttribute('style') ?? '');
        const width = match === null ? Number.NaN : Number(match[1]);
        // Never toggle a sidebar that is already hidden: on a narrow window the
        // frame collapses it by itself and toggling would expand it instead.
        if (Number.isFinite(width) && width >= SIDEBAR_HIDDEN_BELOW) ctx.layout.toggleSidebar();
      } catch {
        /* a layout surprise must never break the plugin */
      }
    }

    /**
     * Client plugin body: register the map panel and the ⌘⇧M toggle.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      const backToSession = () => ctx.layout.selectPanel(null);
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            inject: () => ({
              openSession: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
              startSession: (workspaceId) => ctx.uiWorkspace.startSession(workspaceId),
              backToSession,
              toggleSidebar: () => ctx.layout.toggleSidebar(),
            }),
          },
          SessionMap,
        ),
      );

      // The sidebar is collapsed by default, so the shortcut is the main way in;
      // this entry covers the case where the reader has the sidebar expanded.
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 4, label: () => '会话地图' }, MapIcon),
      );

      const toggle = () => {
        try {
          if (mapVisible) backToSession();
          else ctx.layout.selectPanel(PANEL_ID);
        } catch {
          /* the panel may not be registered yet */
        }
      };
      ctx.effect(
        () =>
          ctx.shortcuts.register({
            id: 'session-map.toggle',
            label: () => '会话地图',
            aliases: ['session map', '会话地图', '切换会话地图'],
            defaults: {
              'desktop:macos': { code: 'KeyM', modifiers: ['primary', 'shift'] },
              'desktop:windows': { code: 'KeyM', modifiers: ['primary', 'shift'] },
              'desktop:linux': { code: 'KeyM', modifiers: ['primary', 'shift'] },
              'web:macos': { code: 'KeyM', modifiers: ['primary', 'shift'] },
              'web:windows': { code: 'KeyM', modifiers: ['primary', 'shift'] },
            },
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => ({ status: 'handled', run: toggle }),
          }),
        'dsh-session-map: toggle shortcut',
      );

      // The sidebar is only collapsed automatically after the reader has chosen
      // it from the map at least once. A first install leaves the shipped
      // sidebar exactly as it was, so nothing can hide the way back out of the
      // plugin manager.
      if (readStored(SIDEBAR_KEY, false) === true) window.setTimeout(() => collapseSidebar(ctx, 1), 600);
    }

    exports.apply = apply;
    exports.inject = ['slots', 'layout', 'shortcuts', 'uiWorkspace'];
    return module.exports;
  },
});
