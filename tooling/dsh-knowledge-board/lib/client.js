/**
 * dsh-knowledge-board — browser half.
 *
 * Registers a full-page knowledge board into the `main` keyed slot under the
 * key `board`, plus a sidebar entry that selects it. Content comes from the
 * host half's `/board-api` JSON routes; a 2s poll compares a file revision so
 * an agent write appears without a manual reload, and a focus file written by
 * the agent steers the visible node (that is the "look at the board" gesture
 * during a lesson).
 *
 * This file is a hand-written client bundle: the shell loads it as a classic
 * script that registers a factory on window.__ModuleLoader__. Everything runs
 * inside the factory, and `require` resolves the platform seed modules
 * (react, react/jsx-runtime, @deepseek-ai/cordis, ...).
 */
window.__ModuleLoader__.load({
  id: 'dsh-knowledge-board',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const e = React.createElement;
    const { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, Fragment } = React;

    const PANEL_ID = 'board';
    const STYLE_ID = 'dsh-knowledge-board-style';
    const POLL_MS = 2000;

    /** Card geometry in world units. */
    const CARD_W = 780;
    const GAP_X = 150;
    const GAP_Y = 190;
    const BAND_GAP = 240;
    /** Cards per row before the band wraps. */
    const ROW_MAX = 3;
    /** Assumed card height before the real one is measured; only affects first paint. */
    const CARD_H_GUESS = 700;

    const MIN_ZOOM = 0.08;
    const MAX_ZOOM = 2.4;
    const FIT_PADDING = 120;

    const VIEW_KEY = 'dsh-knowledge-board/view';
    const LAYOUT_KEY = 'dsh-knowledge-board/layout';
    const MENU_KEY = 'dsh-knowledge-board/menu';

    //#region styles
    const CSS = `
.kb-root{position:relative;display:flex;flex-direction:column;min-height:0;box-sizing:border-box;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);font-size:14px;line-height:1.7;overflow:hidden}
.kb-meta{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px}
.kb-menu{position:absolute;left:12px;top:12px;z-index:3;display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.kb-menu-button{display:inline-flex;align-items:center;gap:7px;appearance:none;border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 94%,transparent);color:var(--dsw-alias-label-secondary,#4a4a4a);border-radius:999px;padding:6px 13px 6px 11px;font-family:inherit;font-size:12.5px;line-height:1.4;cursor:pointer;box-shadow:var(--dsw-elevation-soft,0 2px 10px rgba(0,0,0,.06))}
.kb-menu-button:hover{color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-layer-1,#fff)}
.kb-menu-button[aria-expanded=true]{color:var(--dsw-alias-label-primary,#1a1a1a);border-color:var(--dsw-alias-border-l4,rgba(0,0,0,.2))}
.kb-menu-panel{width:272px;max-height:min(62vh,520px);overflow-y:auto;padding:8px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 96%,transparent);box-shadow:var(--dsw-elevation-prominent,0 6px 24px rgba(0,0,0,.12))}
.kb-menu-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;padding:7px 8px 2px;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08))}
.kb-link{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-family:inherit;font-size:12px;line-height:1.6;cursor:pointer;padding:2px 6px;border-radius:6px}
.kb-link:hover{color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.kb-stage{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;background-color:var(--dsw-alias-bg-base,#fff);background-image:radial-gradient(circle at 1px 1px,var(--dsw-alias-border-l2,rgba(0,0,0,.14)) 1px,transparent 0);background-size:26px 26px}
.kb-stage.kb-grabbing{cursor:grabbing}
.kb-world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.kb-world.kb-animate{transition:transform .26s cubic-bezier(.22,.61,.36,1)}
.kb-connectors{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;color:var(--dsw-alias-border-l4,rgba(0,0,0,.22))}
.kb-band-label{position:absolute;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;white-space:nowrap;user-select:none}
.kb-band-sub{font-size:12px;letter-spacing:0;text-transform:none;font-weight:400;opacity:.8;margin-top:2px;max-width:640px;white-space:normal;line-height:1.5}
.kb-card{position:absolute;width:780px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:16px;box-shadow:var(--dsw-elevation-soft,0 2px 10px rgba(0,0,0,.05));overflow:hidden}
.kb-card.kb-card-active{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 45%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 14%,transparent),var(--dsw-elevation-soft,0 2px 10px rgba(0,0,0,.05))}
.kb-card-head{display:flex;align-items:flex-start;gap:10px;padding:16px 22px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));cursor:grab;background:var(--dsw-alias-bg-layer-1,#fff);touch-action:none}
.kb-card-head:active{cursor:grabbing}
.kb-card-title{font-size:18px;font-weight:650;line-height:1.4;margin:0}
.kb-card-sub{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12.5px;margin-top:3px}
.kb-chip{flex:none;font-size:10.5px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;padding:3px 8px;border-radius:999px;border:1px solid currentColor;margin-top:2px}
.kb-chip-planned{color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.kb-chip-learning{color:var(--dsw-alias-state-warn-primary,#b45309)}
.kb-chip-done{color:var(--dsw-alias-state-success-primary,#15803d)}
.kb-card-body{padding:18px 22px 24px;user-select:text;-webkit-user-select:text;cursor:auto}
.kb-card-body>:last-child{margin-bottom:0}
.kb-h2{font-size:17px;font-weight:650;margin:26px 0 10px}
.kb-h3{font-size:15px;font-weight:650;margin:20px 0 8px}
.kb-p{margin:0 0 13px}
.kb-ul,.kb-ol{margin:0 0 13px;padding-left:22px}
.kb-li{margin:0 0 5px}
.kb-quote{margin:0 0 13px;padding:2px 0 2px 14px;border-left:3px solid var(--dsw-alias-border-l4,rgba(0,0,0,.18));color:var(--dsw-alias-label-secondary,#4a4a4a)}
.kb-code-inline{font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12.5px;background:var(--dsw-alias-markdown-inline-code,rgba(0,0,0,.06));border-radius:4px;padding:1px 5px}
.kb-a{color:var(--dsw-alias-link,#4d6bfe);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-link,#4d6bfe) 35%,transparent)}
.kb-a:hover{border-bottom-color:var(--dsw-alias-link,#4d6bfe)}
.kb-key,.kb-note,.kb-warn{border-radius:10px;padding:13px 16px;margin:0 0 16px;border:1px solid transparent}
.kb-key{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 26%,transparent)}
.kb-note{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.08))}
.kb-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 9%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 30%,transparent)}
.kb-callout-t{font-weight:650;font-size:12.5px;letter-spacing:.04em;text-transform:uppercase;margin:0 0 6px;color:var(--dsw-alias-label-secondary,#4a4a4a)}
.kb-key .kb-callout-t{color:var(--dsw-alias-brand-primary,#4d6bfe)}
.kb-warn .kb-callout-t{color:var(--dsw-alias-state-warn-primary,#b45309)}
.kb-callout-b>:last-child{margin-bottom:0}
.kb-table{width:100%;border-collapse:collapse;margin:0 0 18px;font-size:13px}
.kb-table th,.kb-table td{text-align:left;padding:8px 11px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));vertical-align:top}
.kb-table th{font-weight:600;color:var(--dsw-alias-label-secondary,#4a4a4a);background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));white-space:nowrap}
.kb-table tr:last-child td{border-bottom:0}
.kb-codebox{margin:0 0 18px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:10px;overflow:hidden;background:var(--dsw-alias-markdown-code-block,rgba(0,0,0,.04))}
.kb-codebox-h{display:flex;justify-content:space-between;gap:10px;padding:6px 12px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8a8a);background:var(--dsw-alias-markdown-code-block-banner,rgba(0,0,0,.05));border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08))}
.kb-codebox pre{margin:0;padding:13px 15px;overflow-x:auto;font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12.5px;line-height:1.6}
.kb-compare{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0 0 18px}
.kb-compare-col{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:10px;padding:13px 15px;background:var(--dsw-alias-bg-layer-1,#fff)}
.kb-compare-t{font-weight:650;margin:0 0 8px}
.kb-compare-b>:last-child{margin-bottom:0}
.kb-steps{margin:0 0 18px;padding:0;list-style:none}
.kb-step{position:relative;padding:0 0 16px 26px;border-left:2px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));margin-left:6px}
.kb-step:last-child{border-left-color:transparent;padding-bottom:0}
.kb-step::before{content:"";position:absolute;left:-7px;top:5px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-brand-primary,#4d6bfe);border:2px solid var(--dsw-alias-bg-base,#fff)}
.kb-step-t{font-weight:650;margin:0 0 3px}
.kb-src{margin:0 0 18px;padding:0;list-style:none}
.kb-src li{padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.07))}
.kb-src li:last-child{border-bottom:0}
.kb-src-note{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12.5px;margin-top:2px}
.kb-q{margin:0 0 10px;padding:11px 14px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));border-left:3px solid var(--dsw-alias-state-business-primary,#7c8cff)}
.kb-quiz{margin:0 0 14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:10px;overflow:hidden}
.kb-quiz-q{width:100%;text-align:left;appearance:none;border:0;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font-family:inherit;font-size:13.5px;padding:12px 15px;cursor:pointer;display:flex;gap:10px;align-items:flex-start}
.kb-quiz-q:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}
.kb-quiz-mark{color:var(--dsw-alias-brand-primary,#4d6bfe);flex:none}
.kb-quiz-a{padding:12px 15px 13px 37px;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));color:var(--dsw-alias-label-secondary,#3a3a3a);background:var(--dsw-alias-bg-layer-1,#fff)}
.kb-lab{display:flex;gap:12px;align-items:flex-start;margin:0 0 14px;padding:13px 16px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,#fff)}
.kb-lab-badge{flex:none;font-size:11px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;padding:3px 8px;border-radius:6px;border:1px solid currentColor}
.kb-lab-todo{color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.kb-lab-doing{color:var(--dsw-alias-state-warn-primary,#b45309)}
.kb-lab-done{color:var(--dsw-alias-state-success-primary,#15803d)}
.kb-figure{margin:0 0 18px;padding:16px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));overflow-x:auto}
.kb-figure svg{max-width:100%;height:auto;display:block;margin:0 auto;color:var(--dsw-alias-label-primary,#1a1a1a)}
.kb-figure-cap{text-align:center;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12.5px;margin-top:8px}
.kb-ol-dir{margin:0 0 2px;padding:6px 8px 2px;font-size:11.5px;font-weight:650;letter-spacing:.08em;color:var(--dsw-alias-label-tertiary,#8a8a8a);text-transform:uppercase}
.kb-ol-item{display:block;width:100%;text-align:left;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#4a4a4a);font-family:inherit;font-size:13px;line-height:1.45;padding:6px 9px;border-radius:8px;cursor:pointer}
.kb-ol-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#1a1a1a)}
.kb-ol-item.kb-ol-active{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.08));color:var(--dsw-alias-label-primary,#1a1a1a);font-weight:600}
.kb-status{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--dsw-alias-label-tertiary,#8a8a8a);padding:40px;text-align:center}
.kb-status-big{font-size:15px;color:var(--dsw-alias-label-secondary,#4a4a4a);font-weight:600}
.kb-banner{position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:4;max-width:min(680px,80%);display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 96%,transparent);box-shadow:var(--dsw-elevation-soft,0 2px 10px rgba(0,0,0,.08));font-size:12.5px;color:var(--dsw-alias-label-secondary,#4a4a4a)}
.kb-banner-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-markdown-code-font-family,monospace);color:var(--dsw-alias-label-error,#dc2626)}
.kb-err{max-width:560px;font-size:12.5px;font-family:var(--dsw-font-markdown-code-font-family,monospace);color:var(--dsw-alias-label-error,#dc2626);word-break:break-word;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));padding:10px 12px;border-radius:8px}
`;
    //#endregion

    //#region markdown
    let inlineKey = 0;
    /** Render one line of inline markdown: bold, code, links, emphasis. */
    function inline(text) {
      const nodes = [];
      const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*([^*]+)\*/g;
      let last = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index));
        const key = `i${String(inlineKey++)}`;
        if (match[1] !== undefined) nodes.push(e('strong', { key }, match[1]));
        else if (match[2] !== undefined) nodes.push(e('code', { key, className: 'kb-code-inline' }, match[2]));
        else if (match[3] !== undefined)
          nodes.push(
            e('a', { key, className: 'kb-a', href: match[4], target: '_blank', rel: 'noreferrer' }, match[3]),
          );
        else if (match[5] !== undefined) nodes.push(e('em', { key }, match[5]));
        last = pattern.lastIndex;
      }
      if (last < text.length) nodes.push(text.slice(last));
      return nodes.length === 0 ? [text] : nodes;
    }

    /** Render block-level markdown (headings, lists, quotes, fenced code, paragraphs). */
    function markdown(text) {
      const lines = String(text ?? '').split('\n');
      const blocks = [];
      let i = 0;
      let key = 0;
      while (i < lines.length) {
        const line = lines[i];
        if (/^```/.test(line)) {
          const lang = line.slice(3).trim();
          const body = [];
          i += 1;
          while (i < lines.length && !/^```/.test(lines[i])) {
            body.push(lines[i]);
            i += 1;
          }
          i += 1;
          blocks.push(
            e(
              'div',
              { key: `b${String(key++)}`, className: 'kb-codebox' },
              lang !== '' ? e('div', { className: 'kb-codebox-h' }, e('span', null, lang)) : null,
              e('pre', null, e('code', null, body.join('\n'))),
            ),
          );
          continue;
        }
        if (line.trim() === '') {
          i += 1;
          continue;
        }
        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading !== null) {
          const cls = heading[1].length <= 2 ? 'kb-h2' : 'kb-h3';
          blocks.push(e('div', { key: `b${String(key++)}`, className: cls }, inline(heading[2])));
          i += 1;
          continue;
        }
        if (/^>\s?/.test(line)) {
          const body = [];
          while (i < lines.length && /^>\s?/.test(lines[i])) {
            body.push(lines[i].replace(/^>\s?/, ''));
            i += 1;
          }
          blocks.push(e('div', { key: `b${String(key++)}`, className: 'kb-quote' }, inline(body.join(' '))));
          continue;
        }
        if (/^\s*[-*]\s+/.test(line)) {
          const items = [];
          while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
            items.push(e('li', { key: `li${String(i)}`, className: 'kb-li' }, inline(lines[i].replace(/^\s*[-*]\s+/, ''))));
            i += 1;
          }
          blocks.push(e('ul', { key: `b${String(key++)}`, className: 'kb-ul' }, items));
          continue;
        }
        if (/^\s*\d+[.)]\s+/.test(line)) {
          const items = [];
          while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
            items.push(e('li', { key: `li${String(i)}`, className: 'kb-li' }, inline(lines[i].replace(/^\s*\d+[.)]\s+/, ''))));
            i += 1;
          }
          blocks.push(e('ol', { key: `b${String(key++)}`, className: 'kb-ol' }, items));
          continue;
        }
        const para = [];
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          !/^(#{1,4}\s|>\s?|\s*[-*]\s+|\s*\d+[.)]\s+|```)/.test(lines[i])
        ) {
          para.push(lines[i]);
          i += 1;
        }
        blocks.push(e('p', { key: `b${String(key++)}`, className: 'kb-p' }, inline(para.join(' '))));
      }
      return blocks;
    }
    //#endregion

    //#region blocks
    let blockKey = 0;
    /** A collapsible self-check card. */
    function QuizCard({ q, a }) {
      const [open, setOpen] = useState(false);
      return e(
        'div',
        { className: 'kb-quiz' },
        e(
          'button',
          { type: 'button', className: 'kb-quiz-q', onClick: () => setOpen(!open) },
          e('span', { className: 'kb-quiz-mark' }, open ? '−' : '?'),
          e('span', null, inline(q)),
        ),
        open ? e('div', { className: 'kb-quiz-a' }, markdown(a)) : null,
      );
    }

    /** Render one content block by its declared type. */
    function renderBlock(block) {
      const key = `k${String(blockKey++)}`;
      if (block === null || typeof block !== 'object') return null;
      switch (block.type) {
        case 'md':
          return e(Fragment, { key }, markdown(block.text));
        case 'key':
        case 'note':
        case 'warn': {
          const cls = block.type === 'key' ? 'kb-key' : block.type === 'warn' ? 'kb-warn' : 'kb-note';
          return e(
            'div',
            { key, className: cls },
            block.title ? e('div', { className: 'kb-callout-t' }, block.title) : null,
            e('div', { className: 'kb-callout-b' }, markdown(block.text)),
          );
        }
        case 'table': {
          const columns = Array.isArray(block.columns) ? block.columns : [];
          const rows = Array.isArray(block.rows) ? block.rows : [];
          return e(
            'table',
            { key, className: 'kb-table' },
            e(
              'thead',
              null,
              e(
                'tr',
                null,
                columns.map((column, index) => e('th', { key: `h${String(index)}` }, inline(String(column)))),
              ),
            ),
            e(
              'tbody',
              null,
              rows.map((row, rowIndex) =>
                e(
                  'tr',
                  { key: `r${String(rowIndex)}` },
                  (Array.isArray(row) ? row : []).map((cell, cellIndex) =>
                    e('td', { key: `c${String(cellIndex)}` }, inline(String(cell))),
                  ),
                ),
              ),
            ),
          );
        }
        case 'code':
          return e(
            'div',
            { key, className: 'kb-codebox' },
            e(
              'div',
              { className: 'kb-codebox-h' },
              e('span', null, block.title ?? ''),
              e('span', null, block.lang ?? ''),
            ),
            e('pre', null, e('code', null, String(block.text ?? ''))),
          );
        case 'compare': {
          const col = (side, index) =>
            e(
              'div',
              { key: `s${String(index)}`, className: 'kb-compare-col' },
              e('div', { className: 'kb-compare-t' }, inline(String(side?.title ?? ''))),
              e('div', { className: 'kb-compare-b' }, markdown(side?.text ?? '')),
            );
          return e('div', { key, className: 'kb-compare' }, [col(block.left, 0), col(block.right, 1)]);
        }
        case 'steps':
          return e(
            'ol',
            { key, className: 'kb-steps' },
            (Array.isArray(block.items) ? block.items : []).map((item, index) =>
              e(
                'li',
                { key: `t${String(index)}`, className: 'kb-step' },
                e('div', { className: 'kb-step-t' }, inline(String(item?.label ?? ''))),
                markdown(item?.text ?? ''),
              ),
            ),
          );
        case 'sources':
          return e(
            'ul',
            { key, className: 'kb-src' },
            (Array.isArray(block.items) ? block.items : []).map((item, index) =>
              e(
                'li',
                { key: `s${String(index)}` },
                e(
                  'a',
                  { className: 'kb-a', href: String(item?.url ?? '#'), target: '_blank', rel: 'noreferrer' },
                  String(item?.title ?? item?.url ?? ''),
                ),
                item?.note ? e('div', { className: 'kb-src-note' }, inline(String(item.note))) : null,
              ),
            ),
          );
        case 'questions':
          return e(
            'div',
            { key },
            (Array.isArray(block.items) ? block.items : []).map((item, index) =>
              e('div', { key: `q${String(index)}`, className: 'kb-q' }, inline(String(item))),
            ),
          );
        case 'quiz':
          return e(
            'div',
            { key },
            (Array.isArray(block.items) ? block.items : []).map((item, index) =>
              e(QuizCard, { key: `z${String(index)}`, q: String(item?.q ?? ''), a: String(item?.a ?? '') }),
            ),
          );
        case 'lab':
          return e(
            'div',
            { key, className: 'kb-lab' },
            e(
              'span',
              { className: `kb-lab-badge kb-lab-${String(block.status ?? 'todo')}` },
              block.status === 'done' ? '已完成' : block.status === 'doing' ? '进行中' : '未开始',
            ),
            e(
              'div',
              { style: { minWidth: 0 } },
              e('div', { style: { fontWeight: 650 } }, inline(String(block.title ?? ''))),
              markdown(block.text ?? ''),
              block.link
                ? e('a', { className: 'kb-a', href: String(block.link), target: '_blank', rel: 'noreferrer' }, '实验页面')
                : null,
            ),
          );
        case 'figure':
          return e(
            'div',
            { key, className: 'kb-figure' },
            e('div', { dangerouslySetInnerHTML: { __html: String(block.svg ?? '') } }),
            block.caption ? e('div', { className: 'kb-figure-cap' }, inline(String(block.caption))) : null,
          );
        default:
          return e(
            'div',
            { key, className: 'kb-note' },
            e('div', { className: 'kb-callout-t' }, `未知块类型：${String(block.type)}`),
            e('pre', { className: 'kb-code-inline' }, JSON.stringify(block, null, 2)),
          );
      }
    }
    //#endregion

    //#region canvas layout
    const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

    /**
     * Compute world positions for every node card.
     *
     * A direction is one horizontal band; its nodes flow left to right and wrap
     * every ROW_MAX columns. Card heights come from measurement (`heights`), so
     * this is a pure function of the measured heights: it converges after the
     * first paint instead of oscillating.
     *
     * @param directions - direction -> nodes, in file order.
     * @param heights - measured card height by `${direction}/${node}`.
     * @param moved - user-dragged positions overriding the computed ones.
     */
    function buildLayout(directions, heights, moved) {
      const cards = [];
      const bands = [];
      let y = 0;
      for (const direction of directions) {
        const nodes = Array.isArray(direction.nodes) ? direction.nodes : [];
        const bandTop = y;
        let x = 0;
        let rowTop = y;
        let rowHeight = 0;
        let column = 0;
        for (const node of nodes) {
          const id = `${direction.id}/${String(node?.id ?? '')}`;
          const height = heights[id] ?? CARD_H_GUESS;
          if (column >= ROW_MAX) {
            x = 0;
            rowTop += rowHeight + GAP_Y;
            rowHeight = 0;
            column = 0;
          }
          const override = moved[id];
          const card = {
            id,
            direction: direction.id,
            node,
            x: override ? override.x : x,
            y: override ? override.y : rowTop,
            w: CARD_W,
            h: height,
          };
          cards.push(card);
          x += CARD_W + GAP_X;
          rowHeight = Math.max(rowHeight, height);
          column += 1;
        }
        const bandHeight = rowTop + rowHeight - bandTop;
        bands.push({ id: direction.id, title: direction.title, subtitle: direction.subtitle, x: 0, y: bandTop - 74, w: CARD_W * ROW_MAX });
        y = bandTop + Math.max(bandHeight, 200) + BAND_GAP;
      }
      return { cards, bands, height: Math.max(y - BAND_GAP, 400) };
    }

    /** World-space bounding box of a set of cards. */
    function boundsOf(cards) {
      if (cards.length === 0) return { minX: 0, minY: 0, maxX: CARD_W, maxY: 400 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const card of cards) {
        minX = Math.min(minX, card.x);
        minY = Math.min(minY, card.y);
        maxX = Math.max(maxX, card.x + card.w);
        maxY = Math.max(maxY, card.y + card.h);
      }
      return { minX, minY, maxX, maxY };
    }

    /** The view that fits `box` inside a `size`-sized stage, clearing `insetLeft`. */
    function fitView(box, size, padding, insetLeft) {
      const left = insetLeft ?? 0;
      const availableW = Math.max(size.w - left, 120);
      const width = Math.max(box.maxX - box.minX, 1);
      const height = Math.max(box.maxY - box.minY, 1);
      const k = clamp(
        Math.min((availableW - padding * 2) / width, (size.h - padding * 2) / height),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      return {
        k,
        x: left + (availableW - width * k) / 2 - box.minX * k,
        y: (size.h - height * k) / 2 - box.minY * k,
      };
    }

    /**
     * The view that shows one card, clearing `insetLeft`. A card taller than
     * the stage is aligned to its top instead of centred — centring a long
     * lesson would open it halfway down.
     */
    function focusView(card, size, insetLeft) {
      const left = insetLeft ?? 0;
      const availableW = Math.max(size.w - left, 120);
      const k = clamp(Math.min(1, (availableW - FIT_PADDING * 2) / card.w), MIN_ZOOM, MAX_ZOOM);
      const fits = card.h * k <= size.h - FIT_PADDING;
      return {
        k,
        x: left + availableW / 2 - (card.x + card.w / 2) * k,
        y: fits ? size.h / 2 - (card.y + card.h / 2) * k : FIT_PADDING - card.y * k,
      };
    }

    /** Read one JSON value from localStorage, falling back on anything broken. */
    function readStored(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return fallback;
        const parsed = JSON.parse(raw);
        return parsed ?? fallback;
      } catch {
        return fallback;
      }
    }

    /** Write one JSON value to localStorage, ignoring quota or privacy failures. */
    function writeStored(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* a full or blocked store must never break the board */
      }
    }
    //#endregion

    /** Host route fetch helper. */
    async function boardFetch(path) {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) {
        let detail = '';
        try {
          detail = (await response.json()).error ?? '';
        } catch {
          detail = '';
        }
        throw new Error(`HTTP ${String(response.status)} ${detail}`.trim());
      }
      return await response.json();
    }

    /**
     * Load every card's content.
     *
     * `/board-api/board` is one request, but a host half older than this client
     * bundle does not have that route — the host half only reloads when the app
     * restarts, while this file hot-reloads. A 404 therefore falls back to the
     * index plus one `/board-api/node` read per node, which the older host does
     * serve: the board keeps working, only slower, until the next restart.
     */
    async function loadBoard() {
      try {
        return await boardFetch('/board-api/board');
      } catch (failure) {
        if (!/HTTP 404/.test(String(failure?.message ?? ''))) throw failure;
      }
      const index = await boardFetch('/board-api/manifest');
      const directions = await Promise.all(
        (index.directions ?? []).map(async (direction) => ({
          ...direction,
          nodes: await Promise.all(
            (direction.nodes ?? []).map(async (node) => {
              try {
                const one = await boardFetch(
                  `/board-api/node?direction=${encodeURIComponent(direction.id)}&id=${encodeURIComponent(node.id)}`,
                );
                return one.node ?? node;
              } catch {
                return node;
              }
            }),
          ),
        })),
      );
      return { ...index, directions, degraded: true };
    }

    /**
     * The board: an infinite canvas of node cards with pan/zoom/move gestures
     * and one corner menu. Polls the manifest revision, follows the agent's
     * focus file, and refetches every card when a content file changes.
     */
    function BoardView() {
      const rootRef = useRef(null);
      const stageRef = useRef(null);
      const worldRef = useRef(null);
      const [size, setSize] = useState({ w: 1200, h: 700 });
      const [payload, setPayload] = useState(null);
      const [manifest, setManifest] = useState(null);
      const [error, setError] = useState(null);
      const [rev, setRev] = useState(null);
      const [heights, setHeights] = useState({});
      const [moved, setMoved] = useState(() => readStored(LAYOUT_KEY, {}));
      const [menuOpen, setMenuOpen] = useState(() => readStored(MENU_KEY, false));
      const [activeId, setActiveId] = useState(null);
      const [view, setView] = useState({ x: 0, y: 0, k: 1 });
      const [animate, setAnimate] = useState(false);
      const animTimer = useRef(0);
      const revRef = useRef(null);
      const focusRef = useRef(null);
      const fittedRef = useRef(null);
      const viewRef = useRef(view);
      viewRef.current = view;
      const sizeRef = useRef(size);
      sizeRef.current = size;

      /** Move the view with a short transition (user gestures stay instant). */
      const animateTo = useCallback((next) => {
        setAnimate(true);
        setView(next);
        window.clearTimeout(animTimer.current);
        animTimer.current = window.setTimeout(() => setAnimate(false), 320);
      }, []);

      const directions = useMemo(() => {
        const list = payload?.directions ?? manifest?.directions ?? [];
        return list.map((direction) => ({
          ...direction,
          nodes: Array.isArray(direction.nodes) ? direction.nodes : [],
        }));
      }, [payload, manifest]);

      const layout = useMemo(() => buildLayout(directions, heights, moved), [directions, heights, moved]);
      const layoutRef = useRef(layout);
      layoutRef.current = layout;

      /**
       * The conversation body lets a view grow and scrolls the whole column, so
       * an infinite canvas has to claim a definite height instead. Size the root
       * to the scrollport minus the composer, which makes the column fit exactly
       * and leaves the stage non-scrolling.
       */
      useLayoutEffect(() => {
        const root = rootRef.current;
        if (root === null) return undefined;
        const measure = () => {
          let scroller = root.parentElement;
          while (scroller !== null && scroller !== document.body) {
            const overflow = window.getComputedStyle(scroller).overflowY;
            if (overflow === 'auto' || overflow === 'scroll') break;
            scroller = scroller.parentElement;
          }
          let height = Math.max(window.innerHeight - 220, 260);
          if (scroller !== null && scroller !== document.body) {
            const raw = window.getComputedStyle(scroller).getPropertyValue('--dsh-composer-height').trim();
            const composer = Number.parseFloat(raw) || 152;
            const offset = root.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
            height = Math.max(scroller.clientHeight - composer - offset, 260);
          }
          root.style.height = `${String(Math.round(height))}px`;
        };
        measure();
        const timer = window.setTimeout(measure, 120);
        window.addEventListener('resize', measure);
        return () => {
          window.clearTimeout(timer);
          window.removeEventListener('resize', measure);
        };
      }, []);

      /** Space the canvas may occupy: the scrollport minus the composer. */
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

      // Poll the light manifest; refetch full content when the revision moves.
      useEffect(() => {
        let alive = true;
        async function poll() {
          try {
            const next = await boardFetch('/board-api/manifest');
            if (!alive) return;
            setManifest(next);
            setError(next.error ?? null);
            if (revRef.current === null || next.rev !== revRef.current) {
              revRef.current = next.rev;
              setRev(next.rev);
            }
          } catch (failure) {
            if (!alive) return;
            setError(String(failure?.message ?? failure));
          }
        }
        poll();
        const timer = window.setInterval(poll, POLL_MS);
        return () => {
          alive = false;
          window.clearInterval(timer);
        };
      }, []);

      useEffect(() => {
        if (rev === null) return undefined;
        let alive = true;
        loadBoard()
          .then((next) => {
            if (!alive) return;
            setPayload(next);
            setError(next.error ?? null);
          })
          .catch((failure) => {
            if (!alive) return;
            setError(String(failure?.message ?? failure));
          });
        return () => {
          alive = false;
        };
      }, [rev]);

      // Follow the agent's focus file: one transition per new (direction,node,ts).
      useEffect(() => {
        const focus = manifest?.focus;
        if (!focus || !focus.direction || !focus.node) return;
        const key = `${focus.direction}/${focus.node}@${String(focus.ts ?? 0)}`;
        if (key === focusRef.current) return;
        focusRef.current = key;
        const card = layoutRef.current.cards.find((item) => item.id === `${focus.direction}/${focus.node}`);
        if (card === undefined) return;
        setActiveId(card.id);
        animateTo(focusView(card, sizeRef.current));
      }, [manifest, animateTo]);

      // First paint with real content: restore the remembered view, else fit all.
      useEffect(() => {
        if (payload === null || layout.cards.length === 0) return;
        const signature = `${String(rev)}:${String(layout.cards.length)}`;
        if (fittedRef.current === signature) return;
        fittedRef.current = signature;
        if (focusRef.current !== null) return;
        const stored = readStored(VIEW_KEY, null);
        if (stored !== null && typeof stored === 'object' && typeof stored.k === 'number') {
          setView({ x: Number(stored.x) || 0, y: Number(stored.y) || 0, k: clamp(Number(stored.k), MIN_ZOOM, MAX_ZOOM) });
          return;
        }
        setView(fitView(boundsOf(layout.cards), sizeRef.current, FIT_PADDING));
      }, [payload, layout, rev]);

      // Remember the view across tab switches and reloads.
      useEffect(() => {
        if (fittedRef.current === null) return;
        writeStored(VIEW_KEY, { x: Math.round(view.x), y: Math.round(view.y), k: Number(view.k.toFixed(4)) });
      }, [view]);

      useEffect(() => {
        writeStored(MENU_KEY, menuOpen);
      }, [menuOpen]);

      // Measure card heights so the layout wraps with real numbers.
      useLayoutEffect(() => {
        const node = worldRef.current;
        if (node === null) return undefined;
        const measure = () => {
          const next = {};
          for (const element of node.querySelectorAll('[data-card-id]')) {
            const id = element.getAttribute('data-card-id');
            // offsetHeight is the untransformed layout height, which is the world height.
            if (id !== null) next[id] = element.offsetHeight;
          }
          setHeights((current) => {
            const keys = Object.keys(next);
            const same = keys.length === Object.keys(current).length && keys.every((key) => current[key] === next[key]);
            return same ? current : next;
          });
        };
        measure();
        if (typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver(measure);
        for (const element of node.querySelectorAll('[data-card-id]')) observer.observe(element);
        return () => observer.disconnect();
      }, [payload, layout.cards.length]);

      // Wheel must be non-passive to own the gesture: pan, or zoom with ⌘/ctrl.
      useEffect(() => {
        const node = stageRef.current;
        if (node === null) return undefined;
        let pending = { dx: 0, dy: 0, zoom: 0, x: 0, y: 0 };
        let frame = 0;
        const flush = () => {
          frame = 0;
          const current = viewRef.current;
          const rect = node.getBoundingClientRect();
          setAnimate(false);
          if (pending.zoom !== 0) {
            const factor = Math.exp(-pending.zoom / 320);
            const k = clamp(current.k * factor, MIN_ZOOM, MAX_ZOOM);
            const px = pending.x - rect.left;
            const py = pending.y - rect.top;
            setView({
              k,
              x: px - ((px - current.x) * k) / current.k,
              y: py - ((py - current.y) * k) / current.k,
            });
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

      /** Pointer drag that pans the canvas or moves one card. */
      const startDrag = useCallback((event, card) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const start = { x: event.clientX, y: event.clientY };
        const origin = card === null ? viewRef.current : { x: card.x, y: card.y };
        let movedFar = false;
        const target = event.currentTarget;
        try {
          target.setPointerCapture?.(event.pointerId);
        } catch {
          /* a synthetic or already-released pointer id is not fatal */
        }
        setAnimate(false);
        // One state update per animation frame, not per pointer event.
        let frame = 0;
        let latest = null;
        const apply = () => {
          frame = 0;
          if (latest === null) return;
          const dx = latest.clientX - start.x;
          const dy = latest.clientY - start.y;
          if (!movedFar && Math.abs(dx) + Math.abs(dy) > 4) movedFar = true;
          if (card === null) {
            setView({ ...viewRef.current, x: origin.x + dx, y: origin.y + dy });
            return;
          }
          const k = viewRef.current.k;
          setMoved((current) => ({ ...current, [card.id]: { x: origin.x + dx / k, y: origin.y + dy / k } }));
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
          try {
            target.releasePointerCapture?.(event.pointerId);
          } catch {
            /* capture may already be gone */
          }
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (card !== null) {
            setMoved((current) => {
              writeStored(LAYOUT_KEY, current);
              return current;
            });
            if (!movedFar) {
              setActiveId(card.id);
              animateTo(focusView(card, sizeRef.current));
            }
          }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }, [animateTo]);

      const fitAll = useCallback(() => {
        animateTo(fitView(boundsOf(layoutRef.current.cards), sizeRef.current, FIT_PADDING));
      }, [animateTo]);

      const gotoCard = useCallback(
        (id) => {
          const card = layoutRef.current.cards.find((item) => item.id === id);
          if (card === undefined) return;
          setActiveId(id);
          animateTo(focusView(card, sizeRef.current));
        },
        [animateTo],
      );

      /** Remap a stage-relative point into world coordinates. */
      const toWorld = useCallback((clientX, clientY) => {
        const rect = stageRef.current?.getBoundingClientRect();
        const current = viewRef.current;
        return {
          x: (clientX - (rect?.left ?? 0) - current.x) / current.k,
          y: (clientY - (rect?.top ?? 0) - current.y) / current.k,
        };
      }, []);

      useEffect(() => {
        if (!menuOpen) return undefined;
        const onDown = (event) => {
          if (event.target instanceof Element && event.target.closest('.kb-menu') !== null) return;
          setMenuOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setMenuOpen(false);
        };
        window.addEventListener('pointerdown', onDown, true);
        window.addEventListener('keydown', onKey);
        return () => {
          window.removeEventListener('pointerdown', onDown, true);
          window.removeEventListener('keydown', onKey);
        };
      }, [menuOpen]);

      const bounds = useMemo(() => boundsOf(layout.cards), [layout]);
      const bandLabels = layout.bands;

      /**
       * The canvas contents are memoized on purpose: panning and zooming only
       * change the world's transform, and rebuilding every card subtree on each
       * pointer move is what made the canvas feel heavy. Same element objects
       * in, same subtree out — React skips it.
       */
      const worldChildren = useMemo(
        () => [
          e(
            'svg',
            { className: 'kb-connectors', width: Math.max(bounds.maxX + 200, 100), height: Math.max(bounds.maxY + 200, 100) },
            layout.cards
              .filter((card) => {
                const next = layout.cards.find((item) => item.direction === card.direction && item.y === card.y && item.x > card.x);
                return next !== undefined && next.x - (card.x + card.w) < GAP_X + 40;
              })
              .map((card) => {
                const next = layout.cards
                  .filter((item) => item.direction === card.direction && item.y === card.y && item.x > card.x)
                  .sort((left, right) => left.x - right.x)[0];
                const y = card.y + 48;
                const x1 = card.x + card.w;
                const x2 = next.x;
                const mid = (x1 + x2) / 2;
                return e('path', {
                  key: `c${card.id}`,
                  d: `M ${String(x1)} ${String(y)} C ${String(mid)} ${String(y)}, ${String(mid)} ${String(next.y + 48)}, ${String(x2)} ${String(next.y + 48)}`,
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 2,
                  strokeDasharray: '6 6',
                });
              }),
          ),
          bandLabels.map((band) =>
            e(
              'div',
              { key: `band${band.id}`, className: 'kb-band-label', style: { left: band.x, top: band.y, width: band.w } },
              band.title,
              band.subtitle ? e('div', { className: 'kb-band-sub' }, band.subtitle) : null,
            ),
          ),
          layout.cards.map((card) =>
            e(
              'div',
              {
                key: card.id,
                'data-card-id': card.id,
                className: `kb-card${activeId === card.id ? ' kb-card-active' : ''}`,
                style: { left: card.x, top: card.y, width: card.w },
              },
              e(
                'div',
                { className: 'kb-card-head', onPointerDown: (event) => startDrag(event, card) },
                e(
                  'div',
                  { style: { flex: '1 1 auto', minWidth: 0 } },
                  e('h2', { className: 'kb-card-title' }, String(card.node?.title ?? card.id)),
                  card.node?.subtitle ? e('div', { className: 'kb-card-sub' }, String(card.node.subtitle)) : null,
                ),
                e(
                  'span',
                  { className: `kb-chip kb-chip-${String(card.node?.status ?? 'planned')}` },
                  card.node?.status === 'done' ? '已完成' : card.node?.status === 'learning' ? '进行中' : '待开始',
                ),
              ),
              e(
                'div',
                { className: 'kb-card-body' },
                (Array.isArray(card.node?.blocks) ? card.node.blocks : []).map((block) => renderBlock(block)),
              ),
            ),
          ),
        ],
        [layout, activeId, startDrag, bounds.maxX, bounds.maxY],
      );

      const stage = e(
        'div',
        {
          ref: stageRef,
          className: 'kb-stage',
          onPointerDown: (event) => {
            // Pan from anywhere that is not a card or a floating panel. The
            // connector layer and the zero-size world both sit under the
            // pointer on "empty" canvas, so testing them directly missed.
            if (event.target instanceof Element && event.target.closest('.kb-card, .kb-menu') !== null) return;
            startDrag(event, null);
          },
          onDoubleClick: (event) => {
            if (event.target instanceof Element && event.target.closest('.kb-card, .kb-menu') !== null) return;
            fitAll();
          },
        },
        e(
          'div',
          { ref: worldRef, className: `kb-world${animate ? ' kb-animate' : ''}`, style: { transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.k)})` } },
          worldChildren,
        ),
      );

      /**
       * The board's only chrome: one small button in the corner. Everything else
       * is a gesture (drag to pan, ⌘+wheel to zoom, double-click to fit), so the
       * canvas keeps the whole pane. Refresh lives inside the panel, low-key,
       * because it is only needed when a poll looks stuck.
       */
      const menu = e(
        'div',
        { className: 'kb-menu' },
        e(
          'button',
          {
            type: 'button',
            className: 'kb-menu-button',
            'aria-expanded': menuOpen,
            'aria-label': '目录',
            onClick: () => setMenuOpen(!menuOpen),
          },
          e(
            'svg',
            { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' },
            e('path', { d: 'M2.5 4h11M2.5 8h11M2.5 12h7' }),
          ),
          '目录',
        ),
        menuOpen
          ? e(
              'div',
              { className: 'kb-menu-panel' },
              directions.length === 0
                ? e('div', { className: 'kb-ol-dir' }, '还没有内容')
                : directions.map((direction) =>
                    e(
                      Fragment,
                      { key: direction.id },
                      e('div', { className: 'kb-ol-dir' }, direction.title),
                      (direction.nodes ?? []).map((node) => {
                        const id = `${direction.id}/${String(node.id)}`;
                        return e(
                          'button',
                          {
                            key: id,
                            type: 'button',
                            className: `kb-ol-item${activeId === id ? ' kb-ol-active' : ''}`,
                            onClick: () => {
                              gotoCard(id);
                              setMenuOpen(false);
                            },
                          },
                          String(node.title ?? node.id),
                        );
                      }),
                    ),
                  ),
              e(
                'div',
                { className: 'kb-menu-foot' },
                manifest?.focus?.note
                  ? e('span', { className: 'kb-meta' }, manifest.focus.note)
                  : e('span', null),
                e('button', { type: 'button', className: 'kb-link', onClick: () => setRev(String(Date.now())) }, '刷新'),
              ),
            )
          : null,
      );

      // A full-cover status is only for "nothing to show"; with cards already
      // drawn an error must not swallow the canvas' pointer events.
      let overlay = null;
      let banner = null;
      if (error !== null && layout.cards.length > 0) {
        banner = e(
          'div',
          { className: 'kb-banner' },
          e('span', null, '接口报错：'),
          e('span', { className: 'kb-banner-text' }, error),
        );
      } else if (error !== null) {
        overlay = e(
          'div',
          { className: 'kb-status' },
          e('div', { className: 'kb-status-big' }, '读不到内容'),
          e('div', { className: 'kb-err' }, error),
          e('div', { className: 'kb-err' }, `contentRoot: ${String(manifest?.root ?? payload?.root ?? '')}`),
        );
      } else if (payload === null) {
        overlay = e('div', { className: 'kb-status' }, e('div', null, '读取中…'));
      }

      return e(
        'div',
        { ref: rootRef, className: 'kb-root' },
        stage,
        menu,
        overlay,
        banner,
      );
    }

    //#endregion

    /** Install the board's stylesheet once per document. */
    function installStyle(doc) {
      if (doc.getElementById(STYLE_ID) !== null) return;
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.setAttribute('data-plugin-css', 'dsh-knowledge-board');
      style.textContent = CSS;
      doc.head.appendChild(style);
    }

    // Styles are installed while the factory materializes so the module system
    // owns the element and removes it if this plugin is unloaded.
    if (typeof document !== 'undefined') installStyle(document);

    /**
     * Client plugin body: register the board as a view in the conversation's
     * top tab strip, beside 对话 and 轨迹.
     *
     * `conversation.view` is the list slot ui-conversation reads to build that
     * strip, so one registration gives both the tab and the body it renders.
     * Order 5 keeps it next to the conversation and ahead of the developer
     * trajectory view (10).
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          { name: 'conversation.view', id: PANEL_ID, order: 5, label: () => '知识板' },
          BoardView,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    return module.exports;
  },
});
