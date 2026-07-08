// Read-only "everyone's list" view: one column per teammate, ~3 fit per screen with
// horizontal scroll (see index.html CSS), plus a full-screen pop-out per person.
// Deliberately a separate, simpler renderer from app.js rather than a shared
// editable/read-only abstraction — no drag state, no persistence, no drop slots.
"use strict";

import { parseTasks, buildSectionMap, hexA, ageStyle, measureLines } from "./renderer.js";
import { listAllProfilesWithBoards, subscribeToBoardChanges } from "./sync.js";

const activeReadOnlyBoards = new Set();
window.addEventListener("resize", () => { activeReadOnlyBoards.forEach(b => b.render()); });

function createReadOnlyBoard(mountEl) {
  // Appended as a child rather than repurposing mountEl's own class/position:
  // mountEl (e.g. .team-col-body, .tfs-editor) already sets position:relative for
  // its own layout purposes, and .ro-board sets position:absolute — putting both
  // classes on the same element lets .ro-board's position win and breaks containment.
  const root = document.createElement("div");
  root.className = "ro-board";
  root.innerHTML = `
    <div class="ro-mirror"></div>
    <textarea class="ro-ta" readonly tabindex="-1"></textarea>
    <div class="ro-overlay"></div>`;
  mountEl.appendChild(root);
  const taEl = root.querySelector(".ro-ta");
  const mirrorEl = root.querySelector(".ro-mirror");
  const overlayEl = root.querySelector(".ro-overlay");

  let state = { content: "", meta: {}, collapsedSections: new Set() };

  function render() {
    const text = state.content;
    taEl.value = text;
    const blocks = parseTasks(text);
    const geo = measureLines(taEl, mirrorEl, text);
    overlayEl.textContent = "";
    const sectionMap = buildSectionMap(text, blocks);
    const isHidden = b => sectionMap.some(h => state.collapsedSections.has(h.key) && h.taskBlocks.includes(b));
    const third = Math.round(mountEl.clientWidth / 1.4);

    sectionMap.forEach(h => {
      const gi = geo[h.line]; if (!gi) return;
      const col = h.col;
      const isCollapsed = state.collapsedSections.has(h.key);
      const pad = 8;
      const topAbs = gi.top - pad;

      const sec = document.createElement("div");
      sec.className = "section";
      sec.dataset.top = topAbs;
      sec.style.width = Math.min(taEl.clientWidth - 4, Math.max(third, 22 + gi.width + 18)) + "px";
      sec.style.top = (topAbs - taEl.scrollTop) + "px";
      sec.style.height = (gi.height + pad) + "px";
      sec.style.borderLeftColor = col;
      sec.style.borderBottomColor = hexA(col, .38);
      sec.style.background = "linear-gradient(180deg," + hexA(col, .20) + "," + hexA(col, .04) + " 72%,transparent)";
      sec.style.boxShadow = "0 0 16px " + hexA(col, .12) + ", inset 0 1px 0 rgba(255,255,255,.05)";
      sec.style.pointerEvents = "auto";
      sec.style.cursor = "pointer";
      sec.title = isCollapsed ? "Click to expand" : "Click to collapse";

      const arrow = document.createElement("span");
      arrow.style.cssText = `position:absolute;left:10px;top:50%;` +
        `transform:translateY(-50%) rotate(${isCollapsed ? -90 : 0}deg);` +
        `color:${col};font-size:9px;opacity:0.75;pointer-events:none;`;
      arrow.textContent = "▼";
      sec.appendChild(arrow);

      sec.addEventListener("click", () => {
        if (state.collapsedSections.has(h.key)) state.collapsedSections.delete(h.key);
        else state.collapsedSections.add(h.key);
        render();
      });
      overlayEl.appendChild(sec);

      if (isCollapsed && h.firstCoverLine >= 0) {
        const g0 = geo[h.firstCoverLine], g1 = geo[h.lastCoverLine];
        if (g0 && g1) {
          const cov = document.createElement("div");
          cov.className = "seccov";
          cov.dataset.top = g0.top;
          cov.style.top = (g0.top - taEl.scrollTop) + "px";
          cov.style.height = ((g1.top + g1.height) - g0.top) + "px";
          cov.style.borderTop = "1px dashed " + hexA(col, .22);
          cov.title = "Click to expand " + h.name;
          const lbl = document.createElement("span");
          const n = h.taskBlocks.length;
          lbl.textContent = n + " task" + (n === 1 ? "" : "s") + " hidden";
          lbl.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);` +
            `font-size:11px;color:${hexA(col, .55)};letter-spacing:.5px;pointer-events:none;white-space:nowrap;`;
          cov.appendChild(lbl);
          cov.addEventListener("click", () => { state.collapsedSections.delete(h.key); render(); });
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

      const box = document.createElement("div");
      box.className = "box";
      box.dataset.top = topAbs + 3;
      box.style.left = "4px";
      box.style.width = Math.min(taEl.clientWidth - 8, Math.max(80, 18 + usedW + 16)) + "px";
      box.style.top = (topAbs + 3 - taEl.scrollTop) + "px";
      box.style.height = Math.max(height - 6, 22) + "px";

      const cAt = state.meta[t.key] || Date.now();
      const c = ageStyle(cAt);
      box.style.borderColor = c.border;
      box.style.background = c.bg;
      box.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,.05), 0 1px 4px rgba(0,0,0,.32), ${c.glow}`;
      if (c.t >= 0.95) box.classList.add("aged");
      overlayEl.appendChild(box);

      for (let li = t.start + 1; li <= t.end; li++) {
        const gn = geo[li]; if (!gn) continue;
        const dotTop = gn.top + Math.round(gn.height / 2) - 2;
        const dot = document.createElement("div");
        dot.className = "notedot";
        dot.dataset.top = dotTop;
        dot.style.cssText = `position:absolute;left:22px;top:${dotTop - taEl.scrollTop}px;` +
          `width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.22);pointer-events:none;`;
        overlayEl.appendChild(dot);
      }
    });
  }

  taEl.addEventListener("scroll", () => {
    const st = taEl.scrollTop;
    overlayEl.querySelectorAll(".box,.section,.seccov,.notedot").forEach(b => {
      b.style.top = (parseFloat(b.dataset.top) - st) + "px";
    });
  });

  const instance = {
    setState(board) {
      state = {
        content: board.content || "",
        meta: board.meta || {},
        collapsedSections: new Set(board.collapsed_sections || [])
      };
      render();
      // A board freshly inserted into the DOM can have its first render measured
      // before the browser has fully settled layout for that new subtree, which
      // shows up as the first line getting zeroed-out geometry. One more render
      // on the next frame (after layout has definitely settled) self-corrects it.
      requestAnimationFrame(render);
    },
    render,
    destroy() { activeReadOnlyBoards.delete(instance); root.remove(); }
  };
  activeReadOnlyBoards.add(instance);
  return instance;
}

function timeAgo(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  const d = Math.floor(s / 86400); return d === 1 ? "yesterday" : d + "d ago";
}

function renderCompletedList(clistEl, completed) {
  clistEl.textContent = "";
  if (!completed.length) {
    const e = document.createElement("div"); e.className = "empty";
    e.textContent = "Nothing completed yet.";
    clistEl.appendChild(e); return;
  }
  completed.forEach(c => {
    const it = document.createElement("div"); it.className = "citem";
    const t = document.createElement("div"); t.className = "ct"; t.textContent = c.title; it.appendChild(t);
    if (c.notes && c.notes.trim()) { const n = document.createElement("div"); n.className = "cn"; n.textContent = c.notes; it.appendChild(n); }
    const w = document.createElement("div"); w.className = "cw"; w.textContent = "done " + timeAgo(c.doneAt); it.appendChild(w);
    clistEl.appendChild(it);
  });
}

function openFullScreen(profile, boards, onEdit) {
  const overlay = document.createElement("div");
  overlay.className = "team-fullscreen";
  overlay.innerHTML = `
    <div class="tfs-header">
      <div class="tfs-name"></div>
      <div class="tfs-tabs"></div>
      <button class="tfs-edit">Edit this list</button>
      <button class="tfs-close">&times; Close</button>
    </div>
    <div class="tfs-body">
      <div class="tfs-editor"></div>
      <div class="completed">
        <div class="chead"><div class="clabel">Completed</div></div>
        <div class="clist"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".tfs-name").textContent = profile.display_name;
  overlay.querySelector(".tfs-edit").addEventListener("click", () => {
    ro.destroy();
    overlay.remove();
    onEdit(profile);
  });

  const tabsEl = overlay.querySelector(".tfs-tabs");
  const editorMount = overlay.querySelector(".tfs-editor");
  const clistEl = overlay.querySelector(".clist");
  const ro = createReadOnlyBoard(editorMount);

  const sorted = boards.slice().sort((a, b) => a.tab_index - b.tab_index);
  function showTab(tabIndex) {
    const b = sorted.find(x => x.tab_index === tabIndex) || { content: "", meta: {}, collapsed_sections: [], completed: [] };
    ro.setState(b);
    renderCompletedList(clistEl, b.completed || []);
    tabsEl.querySelectorAll(".tab").forEach(el => el.classList.toggle("active", Number(el.dataset.tab) === tabIndex));
  }

  sorted.forEach(b => {
    const btn = document.createElement("button");
    btn.className = "tab"; btn.textContent = b.label; btn.dataset.tab = b.tab_index;
    btn.addEventListener("click", () => showTab(b.tab_index));
    tabsEl.appendChild(btn);
  });
  showTab(sorted.length ? sorted[0].tab_index : 0);

  function close() { ro.destroy(); overlay.remove(); }
  overlay.querySelector(".tfs-close").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
}

let currentGridBoards = [];

function renderGrid(grid, data, onEdit) {
  currentGridBoards.forEach(b => b.destroy());
  currentGridBoards = [];
  grid.innerHTML = "";

  if (!data.length) {
    const e = document.createElement("div"); e.className = "empty";
    e.textContent = "No one has a list yet.";
    grid.appendChild(e);
    return;
  }

  data.forEach(({ profile, boards }) => {
    const col = document.createElement("div");
    col.className = "team-col";

    const head = document.createElement("div");
    head.className = "team-col-head";
    const nameEl = document.createElement("span");
    nameEl.className = "team-col-name";
    nameEl.textContent = profile.display_name;
    const editBtn = document.createElement("button");
    editBtn.className = "team-edit-btn";
    editBtn.title = "Edit this list";
    editBtn.textContent = "✎";
    const popBtn = document.createElement("button");
    popBtn.className = "team-pop-btn";
    popBtn.title = "Full screen";
    popBtn.textContent = "⤢";
    head.appendChild(nameEl);
    head.appendChild(editBtn);
    head.appendChild(popBtn);
    col.appendChild(head);

    const mount = document.createElement("div");
    mount.className = "team-col-body";
    col.appendChild(mount);
    grid.appendChild(col);

    const board0 = boards.find(b => b.tab_index === 0) || { content: "", meta: {}, collapsed_sections: [] };
    const ro = createReadOnlyBoard(mount);
    ro.setState(board0);
    currentGridBoards.push(ro);

    popBtn.addEventListener("click", () => openFullScreen(profile, boards, onEdit));
    editBtn.addEventListener("click", () => onEdit(profile));
  });
}

export async function initTeamView(container, { onEdit } = {}) {
  container.innerHTML = `<div class="team-grid" id="teamGrid"></div>`;
  const grid = container.querySelector("#teamGrid");

  const data = await listAllProfilesWithBoards();
  renderGrid(grid, data, onEdit);

  const unsubscribe = subscribeToBoardChanges(async () => {
    try {
      const fresh = await listAllProfilesWithBoards();
      renderGrid(grid, fresh, onEdit);
    } catch (e) { console.error("team view refresh failed", e); }
  });

  return {
    destroy() {
      unsubscribe();
      currentGridBoards.forEach(b => b.destroy());
      currentGridBoards = [];
      container.innerHTML = "";
    }
  };
}
