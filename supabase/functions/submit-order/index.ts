// submit-order: the one way an order gets into public.orders.
//
// The app prices every estimate in the browser so the number moves as the person types, but
// the browser is the customer's machine: the price it sends with an order is a claim, not a
// fact. This function takes the order as drawn, works out which shop it goes to, looks up
// the tier THAT shop assigned to the signed-in account, prices it again with the same
// pricing module the app uses — against that shop's live Price List and coil width scale,
// not whatever the browser had — and writes the row with that price. The caller's price is
// ignored; the reply carries the real one.
//
// Shops: every order belongs to one shop (public.shops, whose id is the directory listing's
// id). The parts in one call all go to the same shop; a missing shopId means the platform's
// default shop (Fortified Sheet Metal), and the rows are stamped with it. The shop's price
// list and coil scale come from public.shop_settings ('price-list', 'coil-width-scale'),
// falling back to the code defaults when the shop has saved nothing — the same rule the app
// uses. The tier comes from public.shop_customers (no row = retail), and the first order an
// account sends a shop creates that row, which is how the account appears in the shop's
// Customer Pricing Tiers panel.
//
// Body: { orders: [order, ...], dryRun?: true }
//   order   — the object the app builds in submitOrder (type, dimensions, gauge, paint, color,
//             quantity, shopId, …). Up to 50 per call; one job's parts come together.
//   dryRun  — price and validate but write nothing, for checking an estimate server-side.
// Reply:   { orders: [priced order, ...], tier, shopId }  or  { error }
//
// Auth: the signed-in customer's access token in the Authorization header. Rows are written
// with the service role, so public.orders needs no insert policy for customers any more —
// see migration 20261017200506_orders_server_priced.sql.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { computePrice, sellTierFor, DEFAULT_PRICE_LIST, DEFAULT_COIL_WIDTH_SCALE } from "../_shared/pricing.mjs";
import { DEFAULT_CATALOG, catalogFromRows, isUsableCatalog } from "../_shared/catalog.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MAX_ORDERS = 50;
const TYPES = ["trim", "panel", "metal", "part3d"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_ID = /^[a-z0-9]{6,40}$/i; // the app's uid(): base-36 time + random
const SIGN_IN = "Sign in to send an order.";
const TRY_AGAIN = "Order didn't save — please try again.";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// A JSON array the shop saved under a shop_settings key, or the seed when there is none.
// deno-lint-ignore no-explicit-any
async function shopList(shopId: string, key: string, fallback: any[]): Promise<any[]> {
  const { data, error } = await admin.from("shop_settings").select("value").eq("shop_id", shopId).eq("key", key).maybeSingle();
  if (error) throw new Error(`shop_settings ${key}: ${error.message}`);
  return Array.isArray(data?.value) ? data.value : fallback;
}

// The platform catalog (public.catalog_items) as the object pricing reads, or the code
// default when the table is unreachable, empty or missing something pricing needs.
async function loadCatalog() {
  const { data, error } = await admin.from("catalog_items").select("kind, parent_key, key, data, sort, delisted");
  if (error) { console.error("catalog_items", error.message); return DEFAULT_CATALOG; }
  if (!data || data.length === 0) return DEFAULT_CATALOG;
  try {
    const catalog = catalogFromRows(data);
    if (!isUsableCatalog(catalog)) { console.error("catalog_items: incomplete, using the default"); return DEFAULT_CATALOG; }
    return catalog;
  } catch (e) {
    console.error("catalog_items", (e as Error).message);
    return DEFAULT_CATALOG;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: SIGN_IN }, 401);
  const { data: { user }, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !user) return json({ error: SIGN_IN }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const incoming = Array.isArray(body?.orders) ? body.orders : null;
  if (!incoming || incoming.length === 0) return json({ error: "No orders in the request." }, 400);
  if (incoming.length > MAX_ORDERS) return json({ error: `At most ${MAX_ORDERS} parts per order.` }, 400);
  const dryRun = body.dryRun === true;

  // One job, one shop. A shopId the app didn't offer is refused rather than silently routed
  // to the desk; no shopId at all means the default shop.
  const shopIds = [...new Set(incoming.map((o: { shopId?: unknown }) => o?.shopId).filter(Boolean))] as unknown[];
  if (shopIds.some((id) => typeof id !== "string" || !UUID.test(id))) return json({ error: "Bad shop." }, 400);
  if (shopIds.length > 1) return json({ error: "One order goes to one shop." }, 400);
  let shopId = shopIds[0] as string | undefined;
  if (!shopId) {
    const { data, error } = await admin.rpc("default_shop_id");
    if (error || typeof data !== "string") { console.error("default_shop_id", error?.message); return json({ error: TRY_AGAIN }, 500); }
    shopId = data;
  }
  {
    const [{ data: shop, error: shopErr }, { data: listing, error: listingErr }] = await Promise.all([
      admin.from("shops").select("id, status").eq("id", shopId).maybeSingle(),
      admin.from("directory_listings").select("id, accepts_orders").eq("id", shopId).maybeSingle(),
    ]);
    if (shopErr || listingErr) { console.error("shop lookup", shopErr?.message || listingErr?.message); return json({ error: TRY_AGAIN }, 500); }
    if (!shop || !listing || shop.status !== "active" || listing.accepts_orders !== true) {
      return json({ error: "That shop isn't taking orders right now." }, 400);
    }
  }

  let tier: string, priceList, coilWidthScale, catalog, hadTierRow = false;
  try {
    const [{ data: shopCustomer, error: tierErr }, list, scale, cat] = await Promise.all([
      admin.from("shop_customers").select("tier").eq("shop_id", shopId).eq("user_id", user.id).maybeSingle(),
      shopList(shopId, "price-list", DEFAULT_PRICE_LIST),
      shopList(shopId, "coil-width-scale", DEFAULT_COIL_WIDTH_SCALE),
      loadCatalog(),
    ]);
    catalog = cat;
    if (tierErr) throw new Error(`shop_customers: ${tierErr.message}`);
    hadTierRow = !!shopCustomer;
    tier = sellTierFor(shopCustomer);
    priceList = list;
    coilWidthScale = scale;
  } catch (e) {
    console.error("pricing data", (e as Error).message);
    return json({ error: TRY_AGAIN }, 500);
  }

  const now = new Date().toISOString();
  // deno-lint-ignore no-explicit-any
  const priced: any[] = [];
  for (const raw of incoming) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "Bad order." }, 400);
    if (!TYPES.includes(raw.type)) return json({ error: `Unknown order type "${raw.type}".` }, 400);
    if (typeof raw.id !== "string" || !ORDER_ID.test(raw.id)) return json({ error: "Bad order id." }, 400);
    const { userId: _userId, ...order } = raw; // the app's local-only field; user_id is the column
    let price: number;
    // The platform catalog; a shop's own selection over it arrives with catalog-as-data step 3.
    try { price = computePrice(order, priceList, coilWidthScale, tier, catalog); } catch { return json({ error: "That order can't be priced." }, 400); }
    if (!Number.isFinite(price) || price < 0) return json({ error: "That order can't be priced." }, 400);
    order.price = price;
    order.tier = tier;
    order.shopId = shopId;
    order.pricedAt = now;
    order.status = "Pending";
    if (typeof order.createdAt !== "string" || Number.isNaN(Date.parse(order.createdAt))) order.createdAt = now;
    priced.push(order);
  }

  if (!dryRun) {
    const rows = priced.map((o) => ({ id: o.id, user_id: user.id, shop_id: shopId, data: o, created_at: o.createdAt }));
    const { error } = await admin.from("orders").insert(rows);
    if (error) {
      console.error("orders insert", error.message);
      return json({ error: TRY_AGAIN }, error.code === "23505" ? 409 : 500);
    }
    // The account is now one of this shop's customers: it appears in the shop's tier panel
    // at retail until the shop says otherwise. Best effort — the order is already saved.
    if (!hadTierRow) {
      const { error: tierErr } = await admin.from("shop_customers")
        .upsert({ shop_id: shopId, user_id: user.id, tier }, { onConflict: "shop_id,user_id", ignoreDuplicates: true });
      if (tierErr) console.error("shop_customers upsert", tierErr.message);
    }
  }
  return json({ orders: priced, tier, shopId, dryRun });
});
