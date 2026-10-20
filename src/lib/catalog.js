import { supabase } from "./supabaseClient";
import { shopStorage } from "./storage";
import { DEFAULT_CATALOG, catalogFromRows, isUsableCatalog } from "../../supabase/functions/_shared/catalog.mjs";

// The platform catalog (public.catalog_items, readable by everyone) as the object the
// lookups read, loaded once per page and shared; the code default when the table is
// unreachable, empty or incomplete. Same rule as submit-order's loadCatalog().
let platformPromise = null;
export function loadPlatformCatalog() {
  if (!platformPromise) {
    platformPromise = (async () => {
      try {
        const { data, error } = await supabase.from("catalog_items").select("kind, parent_key, key, data, sort, delisted").limit(5000);
        if (error || !data || data.length === 0) { if (error) console.error("catalog_items", error); return DEFAULT_CATALOG; }
        const catalog = catalogFromRows(data);
        return isUsableCatalog(catalog) ? catalog : DEFAULT_CATALOG;
      } catch (e) {
        console.error("catalog_items", e);
        return DEFAULT_CATALOG;
      }
    })();
  }
  return platformPromise;
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
