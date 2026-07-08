// Shared parsing / measuring / coloring helpers used by both the personal editable
// view (app.js) and the read-only Team view (teamView.js). Ported from the original
// todo.html almost verbatim — this is the actual spec for how text becomes boxes.
"use strict";

export const DAY = 86400000;
export const RED_AT = 4 * DAY;
export const SLATE = [91, 107, 122];
export const RED = [192, 57, 43];
export const SECTION_COLORS = ['#4fd0e0', '#b18bff', '#f2b65a', '#5fd39b', '#ff7eb6', '#6ea8ff'];

export function normalize(s) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function parseTasks(text) {
  const lines = text.split('\n');
  const tasks = [];
  let i = 0;
  while (i < lines.length) {
    if (/^>/.test(lines[i])) {
      const start = i;
      const title = lines[i].replace(/^>\s?/, '');
      let j = i + 1;
      const notes = [];
      while (j < lines.length && /^[ \t]+\S/.test(lines[j])) {
        notes.push(lines[j].replace(/^[ \t]+/, ''));
        j++;
      }
      tasks.push({ start, end: j - 1, title, notes, key: normalize(title) });
      i = j;
    } else {
      i++;
    }
  }
  return tasks;
}

export function buildSectionMap(text, taskBlocks) {
  const lines = text.split('\n');
  const headers = [];
  lines.forEach((line, i) => {
    if (line && !/^\s/.test(line) && !/^>/.test(line) && /:\s*$/.test(line))
      headers.push({
        name: line.trim(), key: normalize(line.trim()), line: i,
        taskBlocks: [], firstCoverLine: -1, lastCoverLine: -1, col: '#4fd0e0'
      });
  });
  headers.forEach((h, hi) => {
    const nextHL = hi + 1 < headers.length ? headers[hi + 1].line : lines.length;
    h.taskBlocks = taskBlocks.filter(b => b.start > h.line && b.start < nextHL);
    h.col = SECTION_COLORS[hi % SECTION_COLORS.length];
    if (h.taskBlocks.length) {
      h.firstCoverLine = h.taskBlocks[0].start;
      h.lastCoverLine = h.taskBlocks[h.taskBlocks.length - 1].end;
    }
  });
  return headers;
}

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function ageStyle(createdAt, now = Date.now()) {
  const t = Math.max(0, Math.min(1, (now - createdAt) / RED_AT));
  const r = Math.round(SLATE[0] + (RED[0] - SLATE[0]) * t);
  const g = Math.round(SLATE[1] + (RED[1] - SLATE[1]) * t);
  const b = Math.round(SLATE[2] + (RED[2] - SLATE[2]) * t);
  const fill = 0.07 + (0.24 - 0.07) * t;
  const bg = `linear-gradient(180deg,rgba(${r},${g},${b},${(fill + 0.06).toFixed(3)}),rgba(${r},${g},${b},${(fill * 0.45).toFixed(3)}))`;
  const glow = `0 0 16px rgba(${r},${g},${b},${(0.05 + 0.28 * t).toFixed(3)})`;
  return { border: `rgb(${r},${g},${b})`, bg, glow, t };
}

// Measures where each line of `text` lands inside `taEl`, using `mirrorEl` (an
// identical-font hidden element) as a ruler. Shared by editable and read-only views
// since alignment math is identical either way.
export function measureLines(taEl, mirrorEl, text) {
  const COL = Math.max(220, Math.round((taEl.clientWidth - 44) * 0.5));
  taEl.style.paddingRight = Math.max(22, taEl.clientWidth - 22 - COL) + 'px';
  mirrorEl.style.width = (COL + 44) + 'px';
  mirrorEl.style.height = 'auto';
  mirrorEl.textContent = '';
  const items = [];
  text.split('\n').forEach(line => {
    const d = document.createElement('div');
    const s = document.createElement('span');
    s.textContent = line.length ? line : '​';
    d.appendChild(s);
    mirrorEl.appendChild(d);
    items.push({ d, s });
  });
  return items.map(({ d, s }) => ({
    top: d.offsetTop, height: d.offsetHeight, width: s.getBoundingClientRect().width
  }));
}

// Draws section bands + task boxes into `overlayEl` with no drag/edit affordances —
// shared by the Team view's columns and the personal view's "Assigned" inbox column,
// which both need the same visual language without the full editable drag engine.
// `onToggleSection(key)` fires when a band/cover is clicked; the caller owns the
// collapsedSections state and re-renders. `onBoxCreated(box, task)` is an optional
// hook for a caller to attach its own extra controls (e.g. inbox's +/× buttons)
// without this function needing to know about them.
export function renderReadOnlyBoxes({ taEl, mirrorEl, overlayEl }, { text, meta, collapsedSections, onToggleSection, onBoxCreated }) {
  taEl.value = text;
  const blocks = parseTasks(text);
  const geo = measureLines(taEl, mirrorEl, text);
  overlayEl.textContent = '';
  const sectionMap = buildSectionMap(text, blocks);
  const isHidden = b => sectionMap.some(h => collapsedSections.has(h.key) && h.taskBlocks.includes(b));
  const third = Math.round(taEl.clientWidth / 1.4);

  sectionMap.forEach(h => {
    const gi = geo[h.line]; if (!gi) return;
    const col = h.col;
    const isCollapsed = collapsedSections.has(h.key);
    const pad = 8;
    const topAbs = gi.top - pad;

    const sec = document.createElement('div');
    sec.className = 'section';
    sec.dataset.top = topAbs;
    sec.style.width = Math.min(taEl.clientWidth - 4, Math.max(third, 22 + gi.width + 18)) + 'px';
    sec.style.top = (topAbs - taEl.scrollTop) + 'px';
    sec.style.height = (gi.height + pad) + 'px';
    sec.style.borderLeftColor = col;
    sec.style.borderBottomColor = hexA(col, .38);
    sec.style.background = 'linear-gradient(180deg,' + hexA(col, .20) + ',' + hexA(col, .04) + ' 72%,transparent)';
    sec.style.boxShadow = '0 0 16px ' + hexA(col, .12) + ', inset 0 1px 0 rgba(255,255,255,.05)';
    sec.style.pointerEvents = 'auto';
    sec.style.cursor = 'pointer';
    sec.title = isCollapsed ? 'Click to expand' : 'Click to collapse';

    const arrow = document.createElement('span');
    arrow.style.cssText = `position:absolute;left:10px;top:50%;` +
      `transform:translateY(-50%) rotate(${isCollapsed ? -90 : 0}deg);` +
      `color:${col};font-size:9px;opacity:0.75;pointer-events:none;`;
    arrow.textContent = '▼';
    sec.appendChild(arrow);

    sec.addEventListener('click', () => onToggleSection(h.key));
    overlayEl.appendChild(sec);

    if (isCollapsed && h.firstCoverLine >= 0) {
      const g0 = geo[h.firstCoverLine], g1 = geo[h.lastCoverLine];
      if (g0 && g1) {
        const cov = document.createElement('div');
        cov.className = 'seccov';
        cov.dataset.top = g0.top;
        cov.style.top = (g0.top - taEl.scrollTop) + 'px';
        cov.style.height = ((g1.top + g1.height) - g0.top) + 'px';
        cov.style.borderTop = '1px dashed ' + hexA(col, .22);
        cov.title = 'Click to expand ' + h.name;
        const lbl = document.createElement('span');
        const n = h.taskBlocks.length;
        lbl.textContent = n + ' task' + (n === 1 ? '' : 's') + ' hidden';
        lbl.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);` +
          `font-size:11px;color:${hexA(col, .55)};letter-spacing:.5px;pointer-events:none;white-space:nowrap;`;
        cov.appendChild(lbl);
        cov.addEventListener('click', () => onToggleSection(h.key));
        overlayEl.appendChild(cov);
      }
    }
  });

  blocks.forEach(t => {
    if (isHidden(t)) return;
    const g0 = geo[t.start], g1 = geo[t.end] || g0; if (!g0) return;
    const topAbs = g0.top;
    const height = (g1.top + g1.height) - g0.top;
    let usedW = 0;
    for (let i = t.start; i <= t.end; i++) { if (geo[i] && geo[i].width > usedW) usedW = geo[i].width; }

    const box = document.createElement('div');
    box.className = 'box';
    box.dataset.top = topAbs + 3;
    box.style.left = '4px';
    box.style.width = Math.min(taEl.clientWidth - 8, Math.max(80, 18 + usedW + 16)) + 'px';
    box.style.top = (topAbs + 3 - taEl.scrollTop) + 'px';
    box.style.height = Math.max(height - 6, 22) + 'px';

    const cAt = meta[t.key] || Date.now();
    const c = ageStyle(cAt);
    box.style.borderColor = c.border;
    box.style.background = c.bg;
    box.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,.05), 0 1px 4px rgba(0,0,0,.32), ${c.glow}`;
    if (c.t >= 0.95) box.classList.add('aged');
    overlayEl.appendChild(box);
    if (onBoxCreated) onBoxCreated(box, t);

    for (let li = t.start + 1; li <= t.end; li++) {
      const gn = geo[li]; if (!gn) continue;
      const dotTop = gn.top + Math.round(gn.height / 2) - 2;
      const dot = document.createElement('div');
      dot.className = 'notedot';
      dot.dataset.top = dotTop;
      dot.style.cssText = `position:absolute;left:22px;top:${dotTop - taEl.scrollTop}px;` +
        `width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.22);pointer-events:none;`;
      overlayEl.appendChild(dot);
    }
  });
}
