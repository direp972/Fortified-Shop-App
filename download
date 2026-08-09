import { supabase } from "./supabaseClient";

// Drop-in replacement for the Claude-artifact `window.storage` API used throughout
// the app: storage.get(key, shared) / storage.set(key, value, shared).
//
//   shared = true  -> everyone using the app sees the same data (orders, price list,
//                      material costs). Backed by a Supabase table so it's a real,
//                      always-on shared database instead of a Claude-specific feature.
//   shared = false -> personal to this browser/device (e.g. "last tab open").
//                      Backed by localStorage - no backend needed for this, and it
//                      keeps the free Supabase quota for the data that actually
//                      needs to be synced across your team.

const TABLE = "app_storage";

async function get(key, shared = false) {
  if (!shared) {
    const raw = window.localStorage.getItem(`personal:${key}`);
    if (raw === null) return null;
    return { key, value: raw, shared: false };
  }
  const { data, error } = await supabase
    .from(TABLE)
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.error("storage.get error", error);
    return null;
  }
  if (!data) return null;
  return { key, value: data.value, shared: true };
}

async function set(key, value, shared = false) {
  if (!shared) {
    window.localStorage.setItem(`personal:${key}`, value);
    return { key, value, shared: false };
  }
  const { error } = await supabase
    .from(TABLE)
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) {
    console.error("storage.set error", error);
    return null;
  }
  return { key, value, shared: true };
}

async function del(key, shared = false) {
  if (!shared) {
    window.localStorage.removeItem(`personal:${key}`);
    return { key, deleted: true, shared: false };
  }
  const { error } = await supabase.from(TABLE).delete().eq("key", key);
  if (error) {
    console.error("storage.delete error", error);
    return null;
  }
  return { key, deleted: true, shared: true };
}

async function list(prefix = "", shared = false) {
  if (!shared) {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(`personal:${prefix}`)) keys.push(k.replace("personal:", ""));
    }
    return { keys, prefix, shared: false };
  }
  const { data, error } = await supabase.from(TABLE).select("key").ilike("key", `${prefix}%`);
  if (error) {
    console.error("storage.list error", error);
    return null;
  }
  return { keys: (data || []).map((r) => r.key), prefix, shared: true };
}

export const storage = { get, set, delete: del, list };
