// Read-only "everyone's list" view: one column per teammate, ~3 fit per screen with
// horizontal scroll (see index.html CSS), plus a full-screen pop-out per person.
// Nobody can edit another person's actual list here — the "Edit" action opens a
// compose modal that only adds to that person's "Assigned" inbox (see app.js).
"use strict";

import { renderReadOnlyBoxes } from "./renderer.js";
import { listAllProfilesWithBoards, subscribeToBoardChanges, appendToInbox } from "./sync.js";

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
    renderReadOnlyBoxes({ taEl, mirrorEl, overlayEl }, {
      text: state.content,
      meta: state.meta,
      collapsedSections: state.collapsedSections,
      onToggleSection: key => {
        if (state.collapsedSections.has(key)) state.collapsedSections.delete(key);
        else state.collapsedSections.add(key);
        render();
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

// Compose modal: the ONLY way anyone other than the owner can add to someone
// else's list — writes to their "Assigned" inbox, never their real board.
function openAddTaskModal(profile) {
  const overlay = document.createElement("div");
  overlay.className = "identity-overlay";
  overlay.innerHTML = `
    <div class="identity-box">
      <div class="identity-title"></div>
      <div class="identity-sub">Use <b>&gt;</b> to start a task, same as your own list. This adds to their Assigned column — it won't touch the rest of their list.</div>
      <textarea class="add-task-input" placeholder="&gt;Task for them"></textarea>
      <div class="identity-error"></div>
      <div class="identity-actions">
        <button class="identity-btn" data-action="cancel">Cancel</button>
        <button class="identity-btn identity-btn-primary" data-action="send">Send</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".identity-title").textContent = `Add a task for ${profile.display_name}`;

  const input = overlay.querySelector(".add-task-input");
  const err = overlay.querySelector(".identity-error");
  const sendBtn = overlay.querySelector('[data-action="send"]');
  const cancelBtn = overlay.querySelector('[data-action="cancel"]');
  input.focus();

  function close() { overlay.remove(); }
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

  sendBtn.addEventListener("click", async () => {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true; cancelBtn.disabled = true;
    try {
      await appendToInbox(profile.id, text);
      close();
    } catch (e) {
      err.textContent = "Couldn't send that. Check your connection and try again.";
      sendBtn.disabled = false; cancelBtn.disabled = false;
    }
  });
}

function openFullScreen(profile, boards) {
  const overlay = document.createElement("div");
  overlay.className = "team-fullscreen";
  overlay.innerHTML = `
    <div class="tfs-header">
      <div class="tfs-name"></div>
      <div class="tfs-tabs"></div>
      <button class="tfs-edit">Add a task for them</button>
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
  overlay.querySelector(".tfs-edit").addEventListener("click", () => openAddTaskModal(profile));

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

function renderGrid(grid, data) {
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
    editBtn.title = "Add a task for them";
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

    popBtn.addEventListener("click", () => openFullScreen(profile, boards));
    editBtn.addEventListener("click", () => openAddTaskModal(profile));
  });
}

export async function initTeamView(container) {
  container.innerHTML = `<div class="team-grid" id="teamGrid"></div>`;
  const grid = container.querySelector("#teamGrid");

  const data = await listAllProfilesWithBoards();
  renderGrid(grid, data);

  const unsubscribe = subscribeToBoardChanges(async () => {
    try {
      const fresh = await listAllProfilesWithBoards();
      renderGrid(grid, fresh);
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
