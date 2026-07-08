// Personal editable view: textarea + box overlay + drag-to-complete/reorder/move-tab.
// Ported from the original todo.html almost line-for-line; the only structural change
// is that persistence goes through sync.js (Supabase) instead of localStorage, keyed
// by the resolved profile's id instead of a browser-local tab index.
"use strict";

import { normalize, parseTasks, buildSectionMap, hexA, ageStyle, measureLines, renderReadOnlyBoxes } from "./renderer.js";
import {
  loadBoard, saveBoard, listBoardsForOwner,
  setInboxContent, setInboxCollapsed, markInboxSeen, subscribeToProfileChanges
} from "./sync.js";

let ta, mirror, overlay, panel, clist, countEl, ghost, tabbar;
let inboxTa, inboxMirror, inboxOverlay, inboxPanelEl, inboxBadge, inboxToggleBtn;
let profile = null;
let boardsCache = [];
let activeTab = 0;
let meta = {};
let completed = [];
let collapsedSections = new Set();
let blocks = [];
let currentSectionMap = [];
let dropSlots = [];
let drag = null;
let saveTimer = null;

// ---- "Assigned" inbox: tasks other people added for you, via Team view's
// compose modal. Only the owner can act on these (add to their list / dismiss);
// nobody else's edits can touch the real board directly. See teamView.js.
let inboxContent = "";
let inboxUnseen = false;
let inboxCollapsedSections = new Set(); // client-side only, not persisted

function defaultBoard(tabIndex) {
  return {
    tab_index: tabIndex,
    label: tabIndex === 0 ? "My List" : "Managed",
    content: "",
    meta: {},
    completed: [],
    collapsed_sections: [],
    panel_collapsed: false
  };
}

async function ensureBoardsLoaded() {
  const rows = await listBoardsForOwner(profile.id);
  // Reconstruct a dense 0..N tab sequence, filling in any index that hasn't been
  // written to the database yet (e.g. "Managed" before anyone's ever touched it)
  // with a fresh blank default instead of letting it silently disappear.
  const maxIndex = Math.max(1, ...rows.map(r => r.tab_index));
  const byIndex = new Map(rows.map(r => [r.tab_index, r]));
  boardsCache = Array.from({ length: maxIndex + 1 }, (_, i) => byIndex.get(i) || defaultBoard(i));
}

function loadTabState() {
  const b = boardsCache[activeTab];
  meta = { ...(b.meta || {}) };
  completed = [...(b.completed || [])];
  collapsedSections = new Set(b.collapsed_sections || []);
  if (b.panel_collapsed) panel.classList.add("collapsed");
  else panel.classList.remove("collapsed");
  ta.value = b.content || "";
}

function patchBoardCache(tabIndex, patch) {
  boardsCache[tabIndex] = { ...boardsCache[tabIndex], ...patch };
}

function persist(tabIndex, patch) {
  patchBoardCache(tabIndex, patch);
  saveBoard(profile.id, tabIndex, patch)
    .then(row => { boardsCache[tabIndex] = row; })
    .catch(err => console.error("save failed", err));
}

function saveText() { persist(activeTab, { content: ta.value }); }
function saveMeta() { persist(activeTab, { meta }); }
function saveCompleted() { persist(activeTab, { completed }); }
function saveCollSec() { persist(activeTab, { collapsed_sections: [...collapsedSections] }); }
function savePanelCollapsed(v) { persist(activeTab, { panel_collapsed: v }); }

function renameTab(tabIdx, newLabel) { persist(tabIdx, { label: newLabel }); }

function addTab() {
  const label = prompt("New list name:", "New List");
  if (label === null) return; // cancelled
  const tabIndex = boardsCache.length;
  boardsCache.push(defaultBoard(tabIndex));
  persist(tabIndex, { label: label.trim() || "New List" });
  switchTab(tabIndex);
}

function switchTab(newTab) {
  if (newTab === activeTab) return;
  clearTimeout(saveTimer);
  saveText();
  activeTab = newTab;
  localStorage.setItem("todo.activeTab", String(activeTab));
  loadTabState();
  updateTabBar();
  render();
  renderCompleted();
}

function updateTabBar() {
  tabbar.innerHTML = "";
  boardsCache.forEach((b, i) => {
    const btn = document.createElement("button");
    btn.className = "tab" + (i === activeTab ? " active" : "");
    btn.dataset.tab = i;
    btn.textContent = b.label;
    btn.title = "Double-click to rename";
    btn.addEventListener("click", () => switchTab(i));
    btn.addEventListener("dblclick", () => {
      const newLabel = prompt("Tab name:", b.label);
      if (newLabel && newLabel.trim()) {
        renameTab(i, newLabel.trim());
        updateTabBar();
      }
    });
    tabbar.appendChild(btn);
  });

  const addBtn = document.createElement("button");
  addBtn.className = "tab-add";
  addBtn.type = "button";
  addBtn.title = "New list";
  addBtn.textContent = "+";
  addBtn.addEventListener("click", addTab);
  tabbar.appendChild(addBtn);
}

// ---- section map lookup ----
function isBlockHidden(b) {
  return currentSectionMap.some(h => collapsedSections.has(h.key) && h.taskBlocks.includes(b));
}

// ---- meta lifecycle ----
function ensureMeta(tasks) {
  const now = Date.now(), present = new Set();
  tasks.forEach(t => { present.add(t.key); if (!(t.key in meta)) meta[t.key] = now; });
  Object.keys(meta).forEach(k => { if (!present.has(k)) delete meta[k]; });
  saveMeta();
}

// ---- render ----
function render() {
  const text = ta.value;
  blocks = parseTasks(text);
  ensureMeta(blocks);
  const geo = measureLines(ta, mirror, text);
  overlay.textContent = "";

  currentSectionMap = buildSectionMap(text, blocks);
  const third = Math.round(window.innerWidth / 3);

  currentSectionMap.forEach(h => {
    const gi = geo[h.line]; if (!gi) return;
    const col = h.col;
    const isCollapsed = collapsedSections.has(h.key);
    const pad = 8;
    const topAbs = gi.top - pad;

    const sec = document.createElement("div");
    sec.className = "section";
    sec.dataset.top = topAbs;
    sec.style.width = Math.min(ta.clientWidth - 4, Math.max(third, 22 + gi.width + 18)) + "px";
    sec.style.top = (topAbs - ta.scrollTop) + "px";
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
      `color:${col};font-size:9px;opacity:0.75;pointer-events:none;` +
      `transition:transform .2s ease,opacity .15s ease;`;
    arrow.textContent = "▼";
    sec.appendChild(arrow);

    sec.addEventListener("mouseenter", () => { sec.style.boxShadow = "0 0 22px " + hexA(col, .22) + ", inset 0 1px 0 rgba(255,255,255,.07)"; arrow.style.opacity = "1"; });
    sec.addEventListener("mouseleave", () => { sec.style.boxShadow = "0 0 16px " + hexA(col, .12) + ", inset 0 1px 0 rgba(255,255,255,.05)"; arrow.style.opacity = "0.75"; });

    const bdg = document.createElement("div");
    bdg.style.cssText = `position:absolute;right:10px;top:50%;transform:translateY(-50%);` +
      `width:7px;height:7px;border-radius:50%;` +
      `background:${col};box-shadow:0 0 8px 2px ${hexA(col, .55)};pointer-events:none;`;
    sec.appendChild(bdg);

    sec.addEventListener("click", () => {
      if (collapsedSections.has(h.key)) collapsedSections.delete(h.key);
      else collapsedSections.add(h.key);
      saveCollSec(); render();
    });
    overlay.appendChild(sec);

    if (isCollapsed && h.firstCoverLine >= 0) {
      const g0 = geo[h.firstCoverLine], g1 = geo[h.lastCoverLine];
      if (g0 && g1) {
        const covTop = g0.top;
        const covH = (g1.top + g1.height) - covTop;
        const cov = document.createElement("div");
        cov.className = "seccov";
        cov.dataset.top = covTop;
        cov.style.top = (covTop - ta.scrollTop) + "px";
        cov.style.height = covH + "px";
        cov.style.borderTop = "1px dashed " + hexA(col, .22);
        cov.title = "Click to expand " + h.name;

        const lbl = document.createElement("span");
        const n = h.taskBlocks.length;
        lbl.textContent = n + " task" + (n === 1 ? "" : "s") + " hidden";
        lbl.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);` +
          `font-size:11px;color:${hexA(col, .55)};letter-spacing:.5px;pointer-events:none;white-space:nowrap;`;
        cov.appendChild(lbl);

        cov.addEventListener("click", () => { collapsedSections.delete(h.key); saveCollSec(); render(); });
        overlay.appendChild(cov);
      }
    }
  });

  blocks.forEach((t, idx) => {
    if (isBlockHidden(t)) return;
    const g0 = geo[t.start], g1 = geo[t.end] || g0; if (!g0) return;
    const topAbs = g0.top;
    const height = (g1.top + g1.height) - g0.top;
    let usedW = 0;
    for (let i = t.start; i <= t.end; i++) { if (geo[i] && geo[i].width > usedW) usedW = geo[i].width; }

    const box = document.createElement("div");
    box.className = "box";
    box.dataset.idx = idx;
    box.dataset.top = topAbs + 3;
    box.style.left = "4px";
    box.style.width = Math.min(ta.clientWidth - 8, Math.max(80, 18 + usedW + 16)) + "px";
    box.style.top = (topAbs + 3 - ta.scrollTop) + "px";
    box.style.height = Math.max(height - 6, 22) + "px";

    const cAt = meta[t.key] || Date.now();
    const c = ageStyle(cAt);
    box.style.borderColor = c.border;
    box.style.background = c.bg;
    box.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,.05), 0 1px 4px rgba(0,0,0,.32), ${c.glow}`;
    if (c.t >= 0.95) box.classList.add("aged");

    const grip = document.createElement("div");
    grip.className = "grip";
    grip.title = "drag right → complete  ·  drag up/down → reorder";
    box.appendChild(grip);

    const tri = document.createElement("div");
    tri.className = "tri";
    tri.title = "refresh age (reset hue)";
    box.appendChild(tri);

    grip.addEventListener("mousedown", e => startDrag(e, idx));
    tri.addEventListener("click", e => { e.stopPropagation(); meta[t.key] = Date.now(); saveMeta(); render(); });
    overlay.appendChild(box);

    for (let li = t.start + 1; li <= t.end; li++) {
      const gn = geo[li]; if (!gn) continue;
      const dotTop = gn.top + Math.round(gn.height / 2) - 2;
      const dot = document.createElement("div");
      dot.className = "notedot";
      dot.dataset.top = dotTop;
      dot.style.cssText = `position:absolute;left:22px;top:${dotTop - ta.scrollTop}px;` +
        `width:3px;height:3px;border-radius:50%;` +
        `background:rgba(255,255,255,.22);pointer-events:none;`;
      overlay.appendChild(dot);
    }
  });

  if (drag) {
    computeDropSlots(geo);
    dropSlots.forEach((slot, si) => {
      const el = document.createElement("div");
      el.className = "dropslot";
      el.dataset.slotIdx = si;
      el.style.height = "2px";
      el.style.top = (slot.y - ta.scrollTop) + "px";
      el.style.background = "rgba(255,255,255,.12)";
      overlay.appendChild(el);
    });
  }
}

function computeDropSlots(geo) {
  dropSlots = [];
  const visible = blocks.filter(b => !isBlockHidden(b));
  const allSlots = [];

  visible.forEach((t, i) => {
    const g0 = geo[t.start]; if (!g0) return;
    let slotY;
    if (i === 0) {
      slotY = g0.top - 8;
    } else {
      const prev = visible[i - 1];
      const pg = geo[prev.end] || geo[prev.start];
      slotY = pg ? Math.round((pg.top + pg.height + g0.top) / 2) : g0.top - 8;
    }
    allSlots.push({ y: slotY, insertAtLine: t.start, blockIdx: blocks.indexOf(t) });
  });
  if (visible.length) {
    const last = visible[visible.length - 1];
    const gl = geo[last.end] || geo[last.start];
    if (gl) allSlots.push({ y: gl.top + gl.height + 8, insertAtLine: last.end + 1, blockIdx: -1 });
  }

  currentSectionMap.forEach(h => {
    if (collapsedSections.has(h.key)) return;
    if (h.taskBlocks.some(b => !isBlockHidden(b))) return;
    const gi = geo[h.line]; if (!gi) return;
    allSlots.push({ y: gi.top + gi.height + 4, insertAtLine: h.line + 1, blockIdx: -1 });
  });

  allSlots.sort((a, b) => a.y - b.y);
  dropSlots = allSlots;
}

function repositionOnScroll() {
  const st = ta.scrollTop;
  overlay.querySelectorAll(".box,.section,.seccov,.notedot").forEach(b => {
    b.style.top = (parseFloat(b.dataset.top) - st) + "px";
  });
  if (drag && dropSlots.length) {
    overlay.querySelectorAll(".dropslot").forEach((el, i) => {
      if (dropSlots[i]) el.style.top = (dropSlots[i].y - st) + "px";
    });
  }
}

// ---- completed list ----
function timeAgo(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  const d = Math.floor(s / 86400); return d === 1 ? "yesterday" : d + "d ago";
}

function renderCompleted() {
  countEl.textContent = completed.length ? "(" + completed.length + ")" : "";
  clist.textContent = "";
  if (!completed.length) {
    const e = document.createElement("div"); e.className = "empty";
    e.textContent = "Nothing completed yet. Drag a task here →";
    clist.appendChild(e); return;
  }
  completed.forEach((c, i) => {
    const it = document.createElement("div"); it.className = "citem";
    const undo = document.createElement("span"); undo.className = "undo"; undo.textContent = "restore";
    undo.addEventListener("click", () => restore(i));
    it.appendChild(undo);
    const t = document.createElement("div"); t.className = "ct"; t.textContent = c.title;
    it.appendChild(t);
    if (c.notes && c.notes.trim()) { const n = document.createElement("div"); n.className = "cn"; n.textContent = c.notes; it.appendChild(n); }
    const w = document.createElement("div"); w.className = "cw"; w.textContent = "done " + timeAgo(c.doneAt);
    it.appendChild(w); clist.appendChild(it);
  });
}

// ---- Assigned inbox ----
function renderInbox() {
  renderReadOnlyBoxes(
    { taEl: inboxTa, mirrorEl: inboxMirror, overlayEl: inboxOverlay },
    {
      text: inboxContent,
      meta: {},
      collapsedSections: inboxCollapsedSections,
      onToggleSection: key => {
        if (inboxCollapsedSections.has(key)) inboxCollapsedSections.delete(key);
        else inboxCollapsedSections.add(key);
        renderInbox();
      },
      onBoxCreated: (box, task) => {
        const actions = document.createElement("div");
        actions.className = "inbox-box-actions";
        const addBtn = document.createElement("button");
        addBtn.className = "inbox-action-btn"; addBtn.title = "Add to my list"; addBtn.textContent = "+";
        addBtn.addEventListener("click", e => { e.stopPropagation(); addInboxTaskToMyList(task); });
        const dismissBtn = document.createElement("button");
        dismissBtn.className = "inbox-action-btn"; dismissBtn.title = "Dismiss"; dismissBtn.textContent = "×";
        dismissBtn.addEventListener("click", e => { e.stopPropagation(); dismissInboxTask(task); });
        actions.appendChild(addBtn); actions.appendChild(dismissBtn);
        box.appendChild(actions);
      }
    }
  );
}

function removeInboxTaskLines(task) {
  const lines = inboxContent.split("\n");
  lines.splice(task.start, task.end - task.start + 1);
  if (lines[task.start] === "" && lines[task.start - 1] === "") lines.splice(task.start, 1);
  return lines.join("\n");
}

function persistInbox() {
  setInboxContent(profile.id, inboxContent).catch(err => console.error("inbox save failed", err));
}

function addInboxTaskToMyList(task) {
  let add = "\n>" + task.title;
  if (task.notes && task.notes.length) add += "\n" + task.notes.map(n => "\t" + n).join("\n");
  ta.value = ta.value.replace(/\s*$/, "") + "\n" + add.replace(/^\n/, "");
  saveText(); render();

  inboxContent = removeInboxTaskLines(task);
  persistInbox();
  renderInbox();
}

function dismissInboxTask(task) {
  inboxContent = removeInboxTaskLines(task);
  persistInbox();
  renderInbox();
}

function updateInboxBadge() {
  inboxBadge.hidden = !(inboxPanelEl.classList.contains("collapsed") && inboxUnseen);
}

function initInbox(p) {
  inboxContent = p.inbox_content || "";
  inboxUnseen = !!p.inbox_unseen;
  if (p.inbox_collapsed) inboxPanelEl.classList.add("collapsed");
  else inboxPanelEl.classList.remove("collapsed");

  // Already expanded with unseen content on load — they're seeing it right now.
  if (!p.inbox_collapsed && inboxUnseen) {
    inboxUnseen = false;
    markInboxSeen(profile.id).catch(err => console.error(err));
  }

  renderInbox();
  updateInboxBadge();

  inboxToggleBtn.addEventListener("click", () => {
    const collapsed = inboxPanelEl.classList.toggle("collapsed");
    setInboxCollapsed(profile.id, collapsed).catch(err => console.error(err));
    if (!collapsed && inboxUnseen) {
      inboxUnseen = false;
      updateInboxBadge();
      markInboxSeen(profile.id).catch(err => console.error(err));
    }
  });

  subscribeToProfileChanges(profile.id, payload => {
    const row = payload.new;
    if (!row) return;
    inboxContent = row.inbox_content || "";
    if (!inboxPanelEl.classList.contains("collapsed")) {
      inboxUnseen = false;
      markInboxSeen(profile.id).catch(err => console.error(err));
    } else {
      inboxUnseen = !!row.inbox_unseen;
    }
    renderInbox();
    updateInboxBadge();
  });
}

// ---- complete / restore ----
function completeTask(idx) {
  const t = blocks[idx]; if (!t) return;
  const lines = ta.value.split("\n");
  lines.splice(t.start, t.end - t.start + 1);
  if (lines[t.start] === "" && lines[t.start - 1] === "") lines.splice(t.start, 1);
  ta.value = lines.join("\n");
  completed.unshift({ title: t.title, notes: t.notes.join("\n"), doneAt: Date.now() });
  saveText(); saveCompleted(); render(); renderCompleted();
}

function restore(i) {
  const c = completed[i]; if (!c) return;
  completed.splice(i, 1);
  let add = "\n>" + c.title;
  if (c.notes && c.notes.trim()) add += "\n" + c.notes.split("\n").map(n => "\t" + n).join("\n");
  ta.value = ta.value.replace(/\s*$/, "") + "\n" + add.replace(/^\n/, "");
  meta[normalize(c.title)] = Date.now();
  saveText(); saveMeta(); saveCompleted(); render(); renderCompleted();
}

// ---- move task to new position within the same tab ----
function moveTask(idx, slot) {
  const t = blocks[idx]; if (!t) return;
  if (slot.blockIdx === idx) return;
  if (slot.insertAtLine === t.end + 1) return;
  const lines = ta.value.split("\n");
  const taskLen = t.end - t.start + 1;
  const taskLines = lines.splice(t.start, taskLen);
  let insertAt = slot.insertAtLine;
  if (insertAt > t.end) insertAt -= taskLen;
  insertAt = Math.max(0, Math.min(insertAt, lines.length));
  lines.splice(insertAt, 0, ...taskLines);
  ta.value = lines.join("\n");
  saveText(); render();
}

// ---- drag ----
function inCompleteZone(x) {
  const r = panel.getBoundingClientRect();
  return x >= r.left - 36 || x > window.innerWidth - 130;
}

function startDrag(e, idx) {
  e.preventDefault();
  const t = blocks[idx];
  drag = { idx, box: null, hoveredSlot: null, hoveredTabIdx: -1 };
  ghost.textContent = t.title || "(task)";
  ghost.style.display = "block";
  moveGhost(e);
  render();
  const newBox = overlay.querySelector(`.box[data-idx="${idx}"]`);
  if (newBox) { drag.box = newBox; newBox.classList.add("dragging"); }
  document.addEventListener("mousemove", onDrag);
  document.addEventListener("mouseup", endDrag);
}

function moveGhost(e) { ghost.style.left = (e.clientX + 12) + "px"; ghost.style.top = (e.clientY + 8) + "px"; }

function getHoveredTabIdx(e) {
  const tbr = tabbar.getBoundingClientRect();
  if (e.clientY < tbr.top - 30 || e.clientY > tbr.bottom) return -1;
  const tabs = tabbar.querySelectorAll(".tab");
  for (let i = 0; i < tabs.length; i++) {
    const r = tabs[i].getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right) return parseInt(tabs[i].dataset.tab, 10);
  }
  return -1;
}

function onDrag(e) {
  moveGhost(e);

  const overTabIdx = getHoveredTabIdx(e);
  const overOtherTab = overTabIdx >= 0 && overTabIdx !== activeTab;

  tabbar.querySelectorAll(".tab").forEach(t => t.classList.remove("droptarget"));
  if (overOtherTab) {
    const tBtn = tabbar.querySelectorAll(".tab")[overTabIdx];
    if (tBtn) tBtn.classList.add("droptarget");
  }
  drag.hoveredTabIdx = overOtherTab ? overTabIdx : -1;

  const inRight = !overOtherTab && inCompleteZone(e.clientX);
  panel.classList.toggle("droptarget", inRight);

  if (!inRight && !overOtherTab && drag && dropSlots.length) {
    const wrapRect = overlay.getBoundingClientRect();
    const relY = e.clientY - wrapRect.top + ta.scrollTop;
    let best = null, bestDist = Infinity;
    const dragT = blocks[drag.idx];
    dropSlots.forEach(slot => {
      if (slot.blockIdx === drag.idx) return;
      if (dragT && slot.insertAtLine === dragT.end + 1) return;
      const d = Math.abs(relY - slot.y); if (d < bestDist) { bestDist = d; best = slot; }
    });
    const newSlot = bestDist <= 55 ? best : null;
    if (newSlot !== drag.hoveredSlot) { drag.hoveredSlot = newSlot; updateSlotHighlight(); }
  } else if (drag && drag.hoveredSlot) {
    drag.hoveredSlot = null; updateSlotHighlight();
  }
}

function updateSlotHighlight() {
  overlay.querySelectorAll(".dropslot").forEach((el, i) => {
    const active = drag && drag.hoveredSlot === dropSlots[i];
    el.style.background = active ? "rgba(79,208,224,.85)" : "rgba(255,255,255,.12)";
    el.style.height = active ? "3px" : "2px";
    el.style.boxShadow = active ? "0 0 8px rgba(79,208,224,.6)" : "none";
  });
}

function endDrag(e) {
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", endDrag);
  ghost.style.display = "none";
  panel.classList.remove("droptarget");
  tabbar.querySelectorAll(".tab").forEach(t => t.classList.remove("droptarget"));
  if (drag && drag.box) drag.box.classList.remove("dragging");
  const hit = inCompleteZone(e.clientX);
  const idx = drag ? drag.idx : -1;
  const slot = drag ? drag.hoveredSlot : null;
  const dropTabNow = getHoveredTabIdx(e);
  const targetTab = (dropTabNow >= 0 && dropTabNow !== activeTab) ? dropTabNow
    : (drag ? drag.hoveredTabIdx : -1);
  drag = null;
  if (targetTab >= 0 && idx >= 0) moveTaskToTab(idx, targetTab);
  else if (hit && idx >= 0) completeTask(idx);
  else if (slot && idx >= 0) moveTask(idx, slot);
  else render();
}

// ---- move task to another tab ----
function moveTaskToTab(idx, targetTabIdx) {
  const t = blocks[idx]; if (!t) return;
  const lines = ta.value.split("\n");
  const taskLines = lines.splice(t.start, t.end - t.start + 1);
  if (lines[t.start] === "" && lines[t.start - 1] === "") lines.splice(t.start, 1);
  ta.value = lines.join("\n");
  saveText();

  const target = boardsCache[targetTabIdx] || defaultBoard(targetTabIdx);
  const targetText = (target.content || "").replace(/\s*$/, "") + "\n" + taskLines.join("\n");
  const targetMeta = { ...(target.meta || {}) };
  if (meta[t.key]) targetMeta[t.key] = meta[t.key];
  persist(targetTabIdx, { content: targetText, meta: targetMeta });

  render();
  renderCompleted();
}

// ---- events (wired once) ----
function wireEvents() {
  ta.addEventListener("keydown", e => {
    if (e.key === "Tab") {
      const pos = ta.selectionStart;
      const text = ta.value;
      const bol = text.lastIndexOf("\n", pos - 1) + 1;
      const eol = text.indexOf("\n", pos);
      const lineEnd = eol === -1 ? text.length : eol;
      const line = text.slice(bol, lineEnd);
      if (!/^>/.test(line) && !/^[ \t]/.test(line)) return;
      e.preventDefault();
      const ins = "\n\t• ";
      ta.value = text.slice(0, lineEnd) + ins + text.slice(lineEnd);
      ta.selectionStart = ta.selectionEnd = lineEnd + ins.length;
      render();
      clearTimeout(saveTimer); saveTimer = setTimeout(saveText, 300);
      return;
    }

    if (e.key === "Enter") {
      const pos = ta.selectionStart;
      const text = ta.value;
      const bol = text.lastIndexOf("\n", pos - 1) + 1;
      const eol = text.indexOf("\n", pos);
      const lineEnd = eol === -1 ? text.length : eol;
      const fullLine = text.slice(bol, lineEnd);
      if (pos === lineEnd && fullLine && !/^\s/.test(fullLine) && !/^>/.test(fullLine) && /:\s*$/.test(fullLine)) {
        e.preventDefault();
        const ins = "\n\n";
        ta.value = text.slice(0, pos) + ins + text.slice(pos);
        ta.selectionStart = ta.selectionEnd = pos + ins.length;
        render();
        clearTimeout(saveTimer); saveTimer = setTimeout(saveText, 300);
      }
    }
  });

  ta.addEventListener("input", () => { render(); clearTimeout(saveTimer); saveTimer = setTimeout(saveText, 300); });
  ta.addEventListener("scroll", repositionOnScroll);
  window.addEventListener("resize", render);
  setInterval(render, 5 * 60 * 1000);

  document.getElementById("toggle").addEventListener("click", () => {
    panel.classList.toggle("collapsed");
    savePanelCollapsed(panel.classList.contains("collapsed"));
    render();
  });

  document.getElementById("export").addEventListener("click", () => {
    let out = ta.value;
    if (completed.length) out += "\n\n--- Completed ---\n" + completed.map(c => "[x] " + c.title).join("\n");
    const blob = new Blob([out], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = boardsCache[activeTab].label + ".txt"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

export async function initPersonalView(p) {
  profile = p;
  ta = document.getElementById("ta");
  mirror = document.getElementById("mirror");
  overlay = document.getElementById("overlay");
  panel = document.getElementById("panel");
  clist = document.getElementById("clist");
  countEl = document.getElementById("count");
  ghost = document.getElementById("ghost");
  tabbar = document.getElementById("tabbar");
  inboxTa = document.getElementById("inboxTa");
  inboxMirror = document.getElementById("inboxMirror");
  inboxOverlay = document.getElementById("inboxOverlay");
  inboxPanelEl = document.getElementById("inboxPanel");
  inboxBadge = document.getElementById("inboxBadge");
  inboxToggleBtn = document.getElementById("inboxToggle");

  document.getElementById("date").textContent =
    new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  activeTab = parseInt(localStorage.getItem("todo.activeTab") || "0", 10) || 0;
  await ensureBoardsLoaded();
  if (activeTab < 0 || activeTab >= boardsCache.length) activeTab = 0;
  loadTabState();
  updateTabBar();

  initInbox(p);

  wireEvents();
  render();
  renderCompleted();
}
