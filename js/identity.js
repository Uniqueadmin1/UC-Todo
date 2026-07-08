// One-time (per browser) name-based identity flow. No passwords — see the plan's
// "name-based identity" notes for why. Shows nothing if a cached profile already exists.
"use strict";

import { getCachedProfile, setCachedProfile, findProfileByName, createProfile } from "./sync.js";

export async function resolveIdentity(rootEl) {
  const cached = getCachedProfile();
  if (cached) return cached;

  const modal = buildModal(rootEl);
  let lastName = "";
  try {
    for (;;) {
      const name = await modal.askName(lastName);
      if (!name) continue;
      lastName = name;
      modal.showError(""); // clear any previous error now that a fresh attempt is starting

      let existing;
      try {
        existing = await modal.withBusy(() => findProfileByName(name));
      } catch (e) {
        modal.showError("Couldn't reach the server. Check your connection and try again.");
        continue;
      }

      if (existing) {
        setCachedProfile(existing);
        return existing;
      }

      const makeNew = await modal.confirmNewList(name);
      if (!makeNew) continue; // back to the name prompt

      let created;
      try {
        created = await modal.withBusy(() => createProfile(name));
      } catch (e) {
        modal.showError("Couldn't create your list. Check your connection and try again.");
        continue;
      }
      setCachedProfile(created);
      return created;
    }
  } finally {
    modal.destroy();
  }
}

function buildModal(rootEl) {
  const overlay = document.createElement("div");
  overlay.className = "identity-overlay";
  overlay.innerHTML = `
    <div class="identity-box">
      <div class="identity-title">Who's this?</div>
      <div class="identity-sub" id="idSub">Type your name to open your list.</div>
      <input class="identity-input" id="idInput" type="text" autocomplete="off" placeholder="Your name" />
      <div class="identity-error" id="idError"></div>
      <div class="identity-actions" id="idActions"></div>
    </div>`;
  rootEl.appendChild(overlay);

  const input = overlay.querySelector("#idInput");
  const sub = overlay.querySelector("#idSub");
  const err = overlay.querySelector("#idError");
  const actions = overlay.querySelector("#idActions");

  function setBusy(busy) {
    input.disabled = busy;
    overlay.querySelectorAll("button").forEach(b => (b.disabled = busy));
  }

  return {
    async askName(prefill = "") {
      sub.textContent = "Type your name to open your list.";
      input.style.display = "";
      input.value = prefill;
      actions.innerHTML = "";
      const btn = document.createElement("button");
      btn.className = "identity-btn identity-btn-primary";
      btn.textContent = "Continue";
      actions.appendChild(btn);
      input.focus();
      if (prefill) input.select();

      return new Promise(resolve => {
        const submit = () => {
          const v = input.value.trim();
          if (!v) return;
          cleanup();
          resolve(v);
        };
        const onKey = e => {
          if (e.key === "Enter") submit();
        };
        const cleanup = () => {
          btn.removeEventListener("click", submit);
          input.removeEventListener("keydown", onKey);
        };
        btn.addEventListener("click", submit);
        input.addEventListener("keydown", onKey);
      });
    },

    async withBusy(fn) {
      setBusy(true);
      try {
        return await fn();
      } finally {
        setBusy(false);
      }
    },

    showError(msg) {
      err.textContent = msg;
    },

    async confirmNewList(name) {
      err.textContent = "";
      sub.textContent = `No list found for "${name}". Make a new one?`;
      input.style.display = "none";
      actions.innerHTML = "";
      const no = document.createElement("button");
      no.className = "identity-btn";
      no.textContent = "Try a different name";
      const yes = document.createElement("button");
      yes.className = "identity-btn identity-btn-primary";
      yes.textContent = "Make new list";
      actions.appendChild(no);
      actions.appendChild(yes);

      return new Promise(resolve => {
        yes.addEventListener("click", () => resolve(true));
        no.addEventListener("click", () => resolve(false));
      });
    },

    destroy() {
      overlay.remove();
    }
  };
}
