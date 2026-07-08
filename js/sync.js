// Data-access layer: wraps Supabase for identity (profiles) and board persistence.
// No Supabase Auth — identity is a plain name, matched against profiles.name_key.
// See the plan's "name-based identity" section for why this is an intentional,
// low-security-model tradeoff rather than an oversight.
"use strict";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CACHE_KEY = "todo.myProfile"; // { id, name_key, display_name }

export function getCachedProfile() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setCachedProfile(profile) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
  } catch (e) {}
}

export function clearCachedProfile() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (e) {}
}

export function normalizeName(s) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

const PROFILE_COLUMNS = "id, name_key, display_name, inbox_content, inbox_collapsed, inbox_unseen";

// Returns the existing profile row for this normalized name, or null if none exists.
export async function findProfileByName(displayName) {
  const nameKey = normalizeName(displayName);
  if (!nameKey) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("name_key", nameKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProfileById(id) {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Creates a brand-new profile. Caller is responsible for having already confirmed
// with the user ("No name found. Make new list?") before calling this.
export async function createProfile(displayName) {
  const nameKey = normalizeName(displayName);
  const { data, error } = await supabase
    .from("profiles")
    .insert({ name_key: nameKey, display_name: displayName.trim() })
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export async function listProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .order("display_name", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Appends new task lines to someone else's inbox and flags it unseen. Reads the
// current content first rather than trusting a possibly-stale local copy, since
// the whole point is that other people may be adding to it concurrently.
export async function appendToInbox(profileId, newLines) {
  const current = await getProfileById(profileId);
  const base = (current?.inbox_content || "").replace(/\s*$/, "");
  const content = (base ? base + "\n" : "") + newLines.replace(/\s*$/, "");
  return setInboxContent(profileId, content, { unseen: true });
}

// Generic inbox content setter — used for appends (from others) and for the
// owner's own dismiss / "add to my list" actions (which remove an item).
export async function setInboxContent(profileId, content, { unseen } = {}) {
  const patch = { inbox_content: content };
  if (unseen !== undefined) patch.inbox_unseen = unseen;
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", profileId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export async function setInboxCollapsed(profileId, collapsed) {
  const { error } = await supabase.from("profiles").update({ inbox_collapsed: collapsed }).eq("id", profileId);
  if (error) throw error;
}

export async function markInboxSeen(profileId) {
  const { error } = await supabase.from("profiles").update({ inbox_unseen: false }).eq("id", profileId);
  if (error) throw error;
}

// Live updates for one person's inbox badge. Returns an unsubscribe function.
export function subscribeToProfileChanges(profileId, onChange) {
  const channel = supabase
    .channel("profile-" + profileId)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${profileId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

const BOARD_COLUMNS =
  "id, owner_id, tab_index, label, content, meta, completed, collapsed_sections, panel_collapsed, updated_at";

export async function loadBoard(ownerId, tabIndex) {
  const { data, error } = await supabase
    .from("boards")
    .select(BOARD_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("tab_index", tabIndex)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listBoardsForOwner(ownerId) {
  const { data, error } = await supabase
    .from("boards")
    .select(BOARD_COLUMNS)
    .eq("owner_id", ownerId)
    .order("tab_index", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Creates or updates a board row for (ownerId, tabIndex). Pass only the fields that
// changed plus ownerId/tabIndex — upsert fills in defaults for the rest on first insert.
export async function saveBoard(ownerId, tabIndex, patch) {
  const row = { owner_id: ownerId, tab_index: tabIndex, ...patch };
  const { data, error } = await supabase
    .from("boards")
    .upsert(row, { onConflict: "owner_id,tab_index" })
    .select(BOARD_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

// For the Team view: every profile with all of their boards, one query round-trip each.
export async function listAllProfilesWithBoards() {
  const profiles = await listProfiles();
  const { data: boards, error } = await supabase
    .from("boards")
    .select(BOARD_COLUMNS)
    .order("tab_index", { ascending: true });
  if (error) throw error;
  const byOwner = new Map();
  (boards || []).forEach(b => {
    if (!byOwner.has(b.owner_id)) byOwner.set(b.owner_id, []);
    byOwner.get(b.owner_id).push(b);
  });
  return profiles.map(p => ({ profile: p, boards: byOwner.get(p.id) || [] }));
}

// Live updates for the Team view. Returns an unsubscribe function.
export function subscribeToBoardChanges(onChange) {
  const channel = supabase
    .channel("boards-team-view")
    .on("postgres_changes", { event: "*", schema: "public", table: "boards" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
