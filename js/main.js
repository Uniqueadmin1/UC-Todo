// Entry point: resolve identity, boot the personal view, wire the Team toggle.
"use strict";

import { resolveIdentity } from "./identity.js";
import { initPersonalView } from "./app.js";
import { initTeamView } from "./teamView.js";
import { clearCachedProfile } from "./sync.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(err => console.error("SW registration failed", err));
  });
}

// Wired independently of identity/view state — the header is visible from first paint.
function wireInstructionsDropdown() {
  const btn = document.getElementById("instructionsToggle");
  const dropdown = document.getElementById("instructionsDropdown");
  const wrap = document.querySelector(".instructions-wrap");

  btn.addEventListener("click", e => {
    e.stopPropagation();
    dropdown.hidden = !dropdown.hidden;
  });
  document.addEventListener("click", e => {
    if (!dropdown.hidden && !wrap.contains(e.target)) dropdown.hidden = true;
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") dropdown.hidden = true;
  });
}
wireInstructionsDropdown();

async function main() {
  const profile = await resolveIdentity(document.body);
  await initPersonalView(profile);

  const personalEl = document.getElementById("personalView");
  const teamEl = document.getElementById("teamView");
  const teamBtn = document.getElementById("teamToggle");
  const signOutBtn = document.getElementById("signOutBtn");

  let teamController = null;
  let inTeamView = false;

  signOutBtn.addEventListener("click", () => {
    const ok = confirm("Sign out and clear this device's saved name? Type your name again anytime to get your list back.");
    if (!ok) return;
    clearCachedProfile();
    window.location.reload();
  });

  teamBtn.addEventListener("click", async () => {
    inTeamView = !inTeamView;
    teamBtn.textContent = inTeamView ? "My List" : "Team";
    if (inTeamView) {
      personalEl.style.display = "none";
      teamEl.style.display = "flex";
      if (!teamController) teamController = await initTeamView(teamEl);
    } else {
      teamEl.style.display = "none";
      personalEl.style.display = "flex";
    }
  });
}

main().catch(err => {
  console.error("Failed to start", err);
  document.body.innerHTML =
    '<div style="color:#d4d4d4;font-family:monospace;padding:24px;">' +
    "Couldn't load your list. Check your internet connection and reload.</div>";
});
