// submit-order: the one way an order gets into public.orders.
//
// The app prices every estimate in the browser so the number moves as the person types, but
// the browser is the customer's machine: the price it sends with an order is a claim, not a
// fact. This function takes the order as drawn, looks up the tier the shop assigned to the
// signed-in account, prices it again with the same pricing module the app uses — against the
// shop's live Price List and coil width scale, not whatever the browser had — and writes the
// row with that price. The caller's price is ignored; the reply carries the real one.
//
// Body: { orders: [order, ...], dryRun?: true }
//   order   — the object the app builds in submitOrder (type, dimensions, gauge, paint, color,
//             quantity, shopId, …). Up to 50 per call; one job's parts come together.
//   dryRun  — price and validate but write nothing, for checking an estimate server-side.
// Reply:   { orders: [priced order, ...], tier }  or  { error }
//
// Auth: the signed-in customer's access token in the Authorization header. Rows are written
// with the service role, so public.orders needs no insert policy for customers any more —
// see migration 20261017120000_orders_server_priced.sql.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { computePrice, sellTierFor, DEFAULT_PRICE_LIST, DEFAULT_COIL_WIDTH_SCALE } from "../_shared/pricing.mjs";

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

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// A JSON array the shop saved under an app_storage key, or the seed when there is none.
// deno-lint-ignore no-explicit-any
async function storedList(key: string, fallback: any[]): Promise<any[]> {
  const { data, error } = await admin.from("app_storage").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`app_storage ${key}: ${error.message}`);
  if (!data?.value) return fallback;
  try {
    const parsed = JSON.parse(data.value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
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

  // Only a listing with ordering switched on can be sent an order; a shopId the app didn't
  // offer is refused rather than silently routed to the desk.
  const shopIds = [...new Set(incoming.map((o: { shopId?: unknown }) => o?.shopId).filter(Boolean))] as string[];
  if (shopIds.some((id) => typeof id !== "string" || !UUID.test(id))) return json({ error: "Bad shop." }, 400);
  if (shopIds.length) {
    const { data: shops, error } = await admin.from("directory_listings").select("id, accepts_orders").in("id", shopIds);
    if (error) { console.error("directory_listings", error.message); return json({ error: "Order didn't save — please try again." }, 500); }
    const ok = new Set((shops || []).filter((s) => s.accepts_orders === true).map((s) => s.id));
    if (shopIds.some((id) => !ok.has(id))) return json({ error: "That shop isn't taking orders right now." }, 400);
  }

  let tier: string, priceList, coilWidthScale;
  try {
    const [{ data: customer }, list, scale] = await Promise.all([
      admin.from("customers").select("tier").eq("id", user.id).maybeSingle(),
      storedList("shop-price-list", DEFAULT_PRICE_LIST),
      storedList("shop-coil-width-scale", DEFAULT_COIL_WIDTH_SCALE),
    ]);
    tier = sellTierFor(customer);
    priceList = list;
    coilWidthScale = scale;
  } catch (e) {
    console.error("pricing data", (e as Error).message);
    return json({ error: "Order didn't save — please try again." }, 500);
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
    try { price = computePrice(order, priceList, coilWidthScale, tier); } catch { return json({ error: "That order can't be priced." }, 400); }
    if (!Number.isFinite(price) || price < 0) return json({ error: "That order can't be priced." }, 400);
    order.price = price;
    order.tier = tier;
    order.pricedAt = now;
    order.status = "Pending";
    if (typeof order.createdAt !== "string" || Number.isNaN(Date.parse(order.createdAt))) order.createdAt = now;
    priced.push(order);
  }

  if (!dryRun) {
    const rows = priced.map((o) => ({ id: o.id, user_id: user.id, shop_id: o.shopId || null, data: o, created_at: o.createdAt }));
    const { error } = await admin.from("orders").insert(rows);
    if (error) {
      console.error("orders insert", error.message);
      return json({ error: "Order didn't save — please try again." }, error.code === "23505" ? 409 : 500);
    }
  }
  return json({ orders: priced, tier, dryRun });
});
