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
