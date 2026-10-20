import { supabase } from "./supabaseClient";
import { shopStorage } from "./storage";
import { DEFAULT_CATALOG, catalogFromRows, isUsableCatalog } from "../../supabase/functions/_shared/catalog.mjs";

// The platform catalog (public.catalog_items, readable by everyone): its rows, read once
// per page and shared, and the object the lookups read, built from them. The code default
// stands in when the table is unreachable, empty or incomplete — the same rule as
// submit-order's loadCatalog(). The staff Platform catalog panel writes the table through
// the helpers below and then invalidates, so the next load (its own rows and the app's
// re-resolution) fetches fresh rows once.
let rowsPromise = null;
let catalogPromise = null;

// The rows, or null when the table could not be read (an empty table reads as []).
export function loadPlatformCatalogRows() {
  if (!rowsPromise) {
    rowsPromise = (async () => {
      try {
        const { data, error } = await supabase.from("catalog_items").select("kind, parent_key, key, data, sort, delisted").limit(5000);
        if (error) { console.error("catalog_items", error); return null; }
        return Array.isArray(data) ? data : null;
      } catch (e) {
        console.error("catalog_items", e);
        return null;
      }
    })();
  }
  return rowsPromise;
}

export function loadPlatformCatalog() {
  if (!catalogPromise) {
    catalogPromise = loadPlatformCatalogRows().then((rows) => {
      if (!rows || rows.length === 0) return DEFAULT_CATALOG;
      const catalog = catalogFromRows(rows);
      return isUsableCatalog(catalog) ? catalog : DEFAULT_CATALOG;
    });
  }
  return catalogPromise;
}

// Forget what was loaded; the next load fetches again. Called after every staff write.
export function invalidatePlatformCatalog() { rowsPromise = null; catalogPromise = null; }
export function reloadPlatformCatalog() { invalidatePlatformCatalog(); return loadPlatformCatalog(); }

/* ----------------------------- staff writes (RLS: is_staff) ----------------------------- */
// A row is addressed by its primary key (kind, parent_key, key) and never renamed or
// deleted: names are what orders store. updated_by records who; a write the policy let
// nothing through for (no row changed) is reported, not swallowed.
const stamp = (userId) => ({ updated_at: new Date().toISOString(), ...(userId ? { updated_by: userId } : {}) });
const pk = (row) => ({ kind: row.kind, parent_key: row.parent_key ?? "", key: row.key });
async function updateRow(row, patch, userId) {
  const { data, error } = await supabase.from("catalog_items").update({ ...patch, ...stamp(userId) }).match(pk(row)).select("key");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("nothing changed — the row is gone, or you are no longer platform staff");
}
export const setCatalogItemDelisted = (row, delisted, userId) => updateRow(row, { delisted: !!delisted }, userId);
export const setCatalogItemData = (row, data, userId) => updateRow(row, { data }, userId);
export async function addCatalogItem(row, userId) {
  const { error } = await supabase.from("catalog_items").insert({ ...pk(row), data: row.data || {}, sort: row.sort ?? 0, delisted: !!row.delisted, ...stamp(userId) });
  if (error) throw error;
}

// A shop's selection document (shop_settings key `catalog`), or null when it has none.
export async function loadShopCatalogSelection(shopId) {
  try {
    const res = await shopStorage.get(shopId, "catalog");
    if (!res?.value) return null;
    const parsed = JSON.parse(res.value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    console.error("shop catalog", e);
    return null;
  }
}
