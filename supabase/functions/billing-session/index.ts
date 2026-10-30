// billing-session: how a shop's owner starts and manages a RoofCoil plan through Stripe
// Billing (docs/phase3-billing-design.md §5.1–5.2). It never takes a price, a return URL or a
// customer from the browser: prices come from Stripe by lookup key, the return URL is built
// from the checked Origin, and the Customer is the shop's own (one per shop, in shop_billing).
//
// Body: { action, ... }
//   prices                         — any signed-in account. The three lookup-key Prices (cached
//                                    10 minutes) and the trial length, for the plan card.
//   checkout  {shopId, plan, interval: "month"}  — owner. A plan Checkout Session, in §5.1's
//                                    order: Customer, contact, Stripe's own list (409 if a plan
//                                    exists), the trial rule (409 if RoofCoil covers the shop),
//                                    the shop's one-open-session slot, then the session.
//   featured  {shopId}             — owner. The Featured add-on's Checkout; no trial, no coupon.
//   portal    {shopId, flow?}      — owner. A Customer Portal session (flow
//                                    "payment_method_update" for the past-due "Update card").
//   sync      {shopId, session?}   — owner. Re-reads Stripe and writes what it says, through the
//                                    same _shared/billing.ts path as the webhook: the returning
//                                    Checkout's subscription, or every RoofCoil subscription of
//                                    the shop's Customer ("Refresh" on the card).
//   resync    {shopId} | {subscription}  — platform admin. sync for any shop, or one
//                                    subscription by id (repairs a row whose Customer was
//                                    replaced).
//   billing_contact {shopId}       — internal: the shop_members_billing_contact trigger, with
//                                    x-alert-secret instead of a token. Points the Customer's
//                                    email at the earliest current owner.
// Reply: { url, notice? } · { prices, trial_days } · { results: [{ kind, result }] } ·
//        { result }  or  { error }
//
// Auth: the caller's access token (admin.auth.getUser). Ownership is a direct shop_members
// select on the service role: is_shop_owner() would see a null auth.uid() here, and
// can_manage_shop() admits every platform admin, who comp shops instead of buying for them.
//
// Plans gate: while billing_config.plans_open is false, every action except prices answers 503
// "Plans aren't open yet." for any shop outside billing_config.test_shop_ids, resync included
// (for {subscription}, the shop it maps to). Without STRIPE_SESSION_KEY every action answers
// the same 503: that is how the function ships dormant.
//
// CORS echoes the Origin only for www.roofcoil.com, roofcoil.com and shop.roofcoil.com (plus
// localhost and *.vercel.app while the key is a test key), never fortifiedmetals.com, and
// Checkout and the Portal return to that same origin.
//
// Settings (environment first, then Vault, like the other functions):
//   STRIPE_SESSION_KEY     — a restricted key (Checkout Sessions, Customer portal, Customers
//                            write; Prices, Products, Coupons, Promotion codes, Subscriptions,
//                            Invoices read). Unset: 503.
//   BILLING_TRIAL_DAYS     — default 30
//   BILLING_AUTOMATIC_TAX  — "true" turns on Stripe Tax for new Checkouts (design §10)
//   ALERT_SECRET           — the x-alert-secret value the billing_contact trigger sends
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@23.0.1";
import { admin, applySubscription, idOf, isMissing, ownersOf, productMap, setting, stripeClient, syncCustomerContact } from "../_shared/billing.ts";
import {
  LOOKUP_KEYS, PLAN_BLOCKING_STATUSES, classifyItems, earliestOwner, featuredCheckoutParams, firstPlanEver, originAllowed,
  planCheckoutParams, returnUrl, trialFor,
} from "../_shared/billing-rules.mjs";

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACTIONS = ["prices", "checkout", "featured", "portal", "sync", "resync", "billing_contact"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUB_ID = /^sub_[A-Za-z0-9]+$/;
const SESSION_ID = /^cs_[A-Za-z0-9_]+$/;
const TEST_KEY = /^(rk|sk)_test_/;
const PRICES_TTL_MS = 10 * 60 * 1000;

const BAD = "Bad request.";
const SIGN_IN = "Sign in to manage your plan.";
const NOT_OWNER = "Only the shop's owners can change its plan.";
const NOT_ADMIN = "Only RoofCoil platform admins can do this.";
const WRONG_HOST = "Open RoofCoil at shop.roofcoil.com to manage your plan.";
const CLOSED = "Plans aren't open yet.";
const STRIPE_FAILED = "Couldn't open checkout — try again.";
const TRY_AGAIN = "Something went wrong — try again.";
const HAS_PLAN = "This shop already has a plan — use Manage billing.";
const HAS_FEATURED = "This shop already has Featured — use Manage billing.";
const COVERED = "RoofCoil covers this shop's plan for now.";
const OPENING = "Checkout is already opening — try again in a minute.";
const NO_ACCOUNT = "Start a plan first — there's no billing account for this shop yet.";
const NOT_THIS_SHOP = "That checkout isn't for this shop.";
const FOUNDING_GONE = "The founding rate isn't available — you're on the standard price.";

// A reply decided partway through an action (403, 409, 503 …), thrown to the handler.
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

// deno-lint-ignore no-explicit-any
type Ctx = { stripe: Stripe; body: any; userId: string | null; origin: string | null; testKeys: boolean };

// deno-lint-ignore no-explicit-any
function must<T>(res: { data: T; error: any }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

async function requireOwner(shopId: string, userId: string | null) {
  const row = must(await admin.from("shop_members").select("user_id")
    .eq("shop_id", shopId).eq("user_id", userId).eq("role", "owner").maybeSingle(), "shop_members");
  if (!row) throw new HttpError(403, NOT_OWNER);
}

async function requireAdmin(userId: string | null) {
  const row = must(await admin.from("staff").select("id").eq("id", userId).maybeSingle(), "staff");
  if (!row) throw new HttpError(403, NOT_ADMIN);
}

type Config = { livemode: boolean; plans_open: boolean; test_shop_ids: string[] };
async function billingConfig(): Promise<Config> {
  const row = must(await admin.from("billing_config").select("livemode, plans_open, test_shop_ids").maybeSingle(), "billing_config");
  if (!row) throw new Error("billing_config: no row");
  return row as Config;
}
const plansOpen = (cfg: Config, shopId: string) => cfg.plans_open || (cfg.test_shop_ids ?? []).includes(shopId);

async function requireOpen(shopId: string): Promise<Config> {
  const cfg = await billingConfig();
  if (!plansOpen(cfg, shopId)) throw new HttpError(503, CLOSED);
  return cfg;
}

// Where Checkout and the Portal send the owner back: the caller's own origin, if it's ours.
function requireReturn(ctx: Ctx, slug: string): string {
  if (!originAllowed(ctx.origin, { testKeys: ctx.testKeys })) throw new HttpError(403, WRONG_HOST);
  return returnUrl(ctx.origin!, slug);
}

async function shopFacts(shopId: string): Promise<{ name: string; slug: string }> {
  const [listing, shop] = await Promise.all([
    admin.from("directory_listings").select("name").eq("id", shopId).maybeSingle(),
    admin.from("shops").select("slug").eq("id", shopId).maybeSingle(),
  ]);
  const l = must(listing, "directory_listings"), s = must(shop, "shops");
  if (!l || !s) throw new Error(`shop ${shopId}: no listing or shop row`);
  return { name: l.name, slug: s.slug };
}

async function billingRow(shopId: string) {
  return must(await admin.from("shop_billing")
    .select("stripe_customer_id, previous_customer_ids, customer_generation, checkout_session_id, offer_coupon")
    .eq("shop_id", shopId).maybeSingle(), "shop_billing");
}

async function trialDays(): Promise<number> {
  const v = await setting("BILLING_TRIAL_DAYS");
  return v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : 30;
}

// The shop's Stripe Customer, created at its first Checkout. A Customer deleted in the
// Dashboard is replaced: its id moves to previous_customer_ids (late events still map), and
// the new generation gives customers.create a fresh idempotency key, while two racing calls
// for the same generation get the same Customer.
async function ensureCustomer(stripe: Stripe, shopId: string): Promise<string> {
  const row = await billingRow(shopId);
  let generation = row?.customer_generation ?? 0;
  let previous: string[] = row?.previous_customer_ids ?? [];
  if (row?.stripe_customer_id) {
    try {
      const existing = await stripe.customers.retrieve(row.stripe_customer_id);
      if (!existing.deleted) return existing.id;
    } catch (e) {
      if (!isMissing(e)) throw e;
    }
    previous = [...new Set([...previous, row.stripe_customer_id])];
    generation += 1;
    must(await admin.from("shop_billing")
      .update({ stripe_customer_id: null, previous_customer_ids: previous, customer_generation: generation, has_payment_method: false, updated_at: new Date().toISOString() })
      .eq("shop_id", shopId).eq("stripe_customer_id", row.stripe_customer_id), "shop_billing");
  }
  const owner = earliestOwner((await ownersOf(shopId)).filter((o) => o.email));
  const params: Stripe.CustomerCreateParams = { metadata: { shop_id: shopId } };
  if (owner?.name) params.name = owner.name;
  if (owner?.email) params.email = owner.email;
  const customer = await stripe.customers.create(params, { idempotencyKey: `shop-customer-${shopId}-${generation}` });
  must(await admin.from("shop_billing").upsert({
    shop_id: shopId, stripe_customer_id: customer.id, livemode: customer.livemode,
    previous_customer_ids: previous, customer_generation: generation, updated_at: new Date().toISOString(),
  }, { onConflict: "shop_id" }), "shop_billing");
  return customer.id;
}

// The Customer's subscriptions, each classified through the product map (a list can't expand
// the Products). A Product the map doesn't know refreshes it once.
async function classifiedSubs(stripe: Stripe, customer: string) {
  const list = await stripe.subscriptions.list({ customer, status: "all", limit: 100 });
  let map = await productMap(stripe);
  const productIds = list.data.flatMap((s) => s.items.data.map((i) => idOf(i.price?.product)));
  if (productIds.some((id) => id && !map.has(id))) map = await productMap(stripe, { refresh: true });
  return list.data.map((sub) => ({
    sub,
    mapped: classifyItems(sub.items.data.map((i) => ({
      roofcoilPlan: map.get(idOf(i.price?.product) ?? "") ?? null,
      lookupKey: i.price?.lookup_key ?? null,
      currentPeriodEnd: i.current_period_end,
    }))),
  }));
}

// Every RoofCoil subscription of the Customer, applied by id (the listed objects only supply
// the ids), so sync and resync write exactly what the webhook would.
async function applyAll(stripe: Stripe, customer: string) {
  const results = [];
  for (const { sub, mapped } of await classifiedSubs(stripe, customer)) {
    if (!mapped.ok && mapped.reason === "none") continue; // not a RoofCoil subscription
    const applied = await applySubscription(stripe, sub.id);
    results.push({ kind: applied.kind, result: applied.result });
  }
  return results;
}

// shop_billing.has_payment_method, which the plan card's "No card on file" line reads.
async function refreshPaymentMethod(stripe: Stripe, shopId: string, customerId: string) {
  let has = false;
  try {
    const c = await stripe.customers.retrieve(customerId);
    has = !c.deleted && !!c.invoice_settings?.default_payment_method;
  } catch (e) {
    if (!isMissing(e)) throw e;
  }
  must(await admin.from("shop_billing").update({ has_payment_method: has, updated_at: new Date().toISOString() })
    .eq("shop_id", shopId).eq("stripe_customer_id", customerId), "shop_billing");
}

// Checkout refused the founding discount (coupon deleted or expired): the session is made
// again at the standard price and the owner is told.
const couponRejected = (e: unknown) => e instanceof Stripe.errors.StripeInvalidRequestError
  && (/^discounts/.test(e.param ?? "") || e.code === "coupon_expired" || /coupon|discount/i.test(e.message));

let priceCache: { at: number; testKeys: boolean; prices: Record<string, unknown> } | null = null;

async function prices({ stripe, testKeys }: Ctx) {
  if (!priceCache || priceCache.testKeys !== testKeys || Date.now() - priceCache.at > PRICES_TTL_MS) {
    const list = await stripe.prices.list({ lookup_keys: Object.values(LOOKUP_KEYS), active: true, limit: 10 });
    const byKey = new Map(list.data.map((p) => [p.lookup_key, p]));
    const one = (key: string) => {
      const p = byKey.get(key);
      return p ? { amount: p.unit_amount, currency: p.currency, interval: p.recurring?.interval ?? null } : null;
    };
    priceCache = { at: Date.now(), testKeys, prices: { shop: one(LOOKUP_KEYS.shop), pro: one(LOOKUP_KEYS.pro), featured: one(LOOKUP_KEYS.featured) } };
  }
  return { prices: priceCache.prices, trial_days: await trialDays() };
}

// checkout (kind "plan") and featured: design §5.1's order, step for step.
async function openCheckout(ctx: Ctx, kind: "plan" | "featured") {
  const { stripe, body } = ctx;
  const shopId: string = body.shopId;
  await requireOwner(shopId, ctx.userId);
  const cfg = await requireOpen(shopId);
  const facts = await shopFacts(shopId);
  const ret = requireReturn(ctx, facts.slug);
  const nowSec = Math.floor(Date.now() / 1000);

  const customer = await ensureCustomer(stripe, shopId);
  await syncCustomerContact(stripe, shopId);

  // Stripe's list, not our rows, decides whether a plan already exists: a webhook may be late.
  const subs = await classifiedSubs(stripe, customer);
  if (subs.some((s) => s.mapped.ok && s.mapped.kind === kind && PLAN_BLOCKING_STATUSES.includes(s.sub.status))) {
    throw new HttpError(409, kind === "plan" ? HAS_PLAN : HAS_FEATURED);
  }
  let trial = {};
  if (kind === "plan") {
    const rows = must(await admin.from("shop_subscriptions")
      .select("kind, plan, source, status, livemode, trial_end, current_period_end, past_due_since, ends_at")
      .eq("shop_id", shopId), "shop_subscriptions") ?? [];
    const stripePlanSubs = subs.filter((s) => s.mapped.ok && s.mapped.kind === "plan").map((s) => s.sub);
    trial = trialFor({ rows, firstPlanEver: firstPlanEver({ stripePlanSubs, rows }), nowSec, trialDays: await trialDays(), livemode: cfg.livemode });
    if ("refuse" in trial) throw new HttpError(409, COVERED);
  }

  // One open session per shop: claim the slot for a minute, so a double click or two owners at
  // once can't open two Checkouts that could both complete.
  const claimedAt = new Date();
  const claimed = must(await admin.from("shop_billing")
    .update({ checkout_claimed_at: claimedAt.toISOString() })
    .eq("shop_id", shopId)
    .or(`checkout_claimed_at.is.null,checkout_claimed_at.lt."${new Date(claimedAt.getTime() - 60_000).toISOString()}"`)
    .select("checkout_session_id, offer_coupon"), "shop_billing");
  if (!claimed?.length) throw new HttpError(409, OPENING);

  try {
    const previousSession = claimed[0].checkout_session_id;
    if (previousSession) {
      try {
        const old = await stripe.checkout.sessions.retrieve(previousSession);
        if (old.status === "open") await stripe.checkout.sessions.expire(previousSession);
      } catch (e) {
        if (!isMissing(e)) throw e;
      }
    }
    const lookupKey = kind === "plan" ? LOOKUP_KEYS[body.plan as "shop" | "pro"] : LOOKUP_KEYS.featured;
    const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    const price = found.data[0]?.id;
    if (!price) throw new HttpError(503, CLOSED);
    const automaticTax = (await setting("BILLING_AUTOMATIC_TAX")) === "true";
    const common = { customer, shopId, shopName: facts.name, price, automaticTax, ret, nowSec };

    let session, notice: string | undefined;
    if (kind === "plan") {
      const offerCoupon = claimed[0].offer_coupon || null;
      const params = (coupon: string | null) => planCheckoutParams({ ...common, plan: body.plan, trial, offerCoupon: coupon });
      try {
        session = await stripe.checkout.sessions.create(params(offerCoupon));
      } catch (e) {
        if (!offerCoupon || !couponRejected(e)) throw e;
        console.error("billing-session founding coupon refused", shopId, (e as Error).message);
        session = await stripe.checkout.sessions.create(params(null));
        notice = FOUNDING_GONE;
      }
    } else {
      session = await stripe.checkout.sessions.create(featuredCheckoutParams(common));
    }
    const sessionId = session.id;
    const stored = await admin.from("shop_billing").update({ checkout_session_id: sessionId, updated_at: new Date().toISOString() })
      .eq("shop_id", shopId);
    if (stored.error) {
      // A session the slot doesn't hold could complete beside the next one: close it first.
      await stripe.checkout.sessions.expire(sessionId).catch((x) => console.error("billing-session expire", sessionId, x?.message));
      throw new Error(`shop_billing: ${stored.error.message}`);
    }
    return notice ? { url: session.url, notice } : { url: session.url };
  } catch (e) {
    // Nothing opened: free the slot so the owner can try again at once.
    await admin.from("shop_billing").update({ checkout_claimed_at: null }).eq("shop_id", shopId).eq("checkout_claimed_at", claimedAt.toISOString());
    throw e;
  }
}

async function portal(ctx: Ctx) {
  const { stripe, body } = ctx;
  const shopId: string = body.shopId;
  await requireOwner(shopId, ctx.userId);
  await requireOpen(shopId);
  const ret = requireReturn(ctx, (await shopFacts(shopId)).slug);
  const row = await billingRow(shopId);
  if (!row?.stripe_customer_id) throw new HttpError(409, NO_ACCOUNT);
  if ((await syncCustomerContact(stripe, shopId)) === "no-customer") throw new HttpError(409, NO_ACCOUNT);
  const params: Stripe.BillingPortal.SessionCreateParams = { customer: row.stripe_customer_id, return_url: `${ret}&billing=portal` };
  if (body.flow === "payment_method_update") params.flow_data = { type: "payment_method_update" };
  const session = await stripe.billingPortal.sessions.create(params);
  return { url: session.url };
}

async function sync(ctx: Ctx) {
  const { stripe, body } = ctx;
  const shopId: string = body.shopId;
  await requireOwner(shopId, ctx.userId);
  await requireOpen(shopId);
  const customer = (await billingRow(shopId))?.stripe_customer_id;
  if (!customer) return { results: [] };
  await syncCustomerContact(stripe, shopId);

  let results;
  if (body.session) {
    let session;
    try { session = await stripe.checkout.sessions.retrieve(body.session); } catch (e) { if (isMissing(e)) throw new HttpError(400, NOT_THIS_SHOP); throw e; }
    if (idOf(session.customer) !== customer) throw new HttpError(400, NOT_THIS_SHOP);
    results = [];
    const subId = idOf(session.subscription);
    if (subId) {
      const applied = await applySubscription(stripe, subId);
      results.push({ kind: applied.kind, result: applied.result });
    }
    // The slot is freed only for the session it holds (R-16), as the webhook does.
    if (session.status === "complete") {
      must(await admin.from("shop_billing").update({ checkout_session_id: null, checkout_claimed_at: null, updated_at: new Date().toISOString() })
        .eq("shop_id", shopId).eq("checkout_session_id", session.id), "shop_billing");
    }
  } else {
    results = await applyAll(stripe, customer);
  }
  await refreshPaymentMethod(stripe, shopId, customer);
  return { results };
}

async function resync(ctx: Ctx) {
  const { stripe, body } = ctx;
  await requireAdmin(ctx.userId);
  if (body.subscription) {
    // Retrieved directly, so it maps through previous_customer_ids too; the gate is checked on
    // the shop it maps to before anything is written.
    const cfg = await billingConfig();
    const applied = await applySubscription(stripe, body.subscription, { allowShop: (shop) => plansOpen(cfg, shop) });
    if (applied.result === "plans-closed") throw new HttpError(503, CLOSED);
    if (applied.shopId) await syncCustomerContact(stripe, applied.shopId);
    return { results: [{ kind: applied.kind, result: applied.result }] };
  }
  const shopId: string = body.shopId;
  await requireOpen(shopId);
  const customer = (await billingRow(shopId))?.stripe_customer_id;
  if (!customer) return { results: [] };
  await syncCustomerContact(stripe, shopId);
  const results = await applyAll(stripe, customer);
  await refreshPaymentMethod(stripe, shopId, customer);
  return { results };
}

async function billingContact({ stripe, body }: Ctx) {
  await requireOpen(body.shopId);
  return { result: await syncCustomerContact(stripe, body.shopId) };
}

// The request's shape, before anything is looked up.
// deno-lint-ignore no-explicit-any
function wellFormed(action: string, body: any): boolean {
  const shop = typeof body.shopId === "string" && UUID.test(body.shopId);
  switch (action) {
    case "prices": return true;
    case "checkout": return shop && (body.plan === "shop" || body.plan === "pro") && body.interval === "month";
    case "featured": case "portal": case "billing_contact": return shop;
    case "sync": return shop && (body.session == null || (typeof body.session === "string" && SESSION_ID.test(body.session)));
    case "resync": {
      const sub = typeof body.subscription === "string" && SUB_ID.test(body.subscription);
      return body.subscription == null ? shop : sub && body.shopId == null;
    }
  }
  return false;
}

Deno.serve(async (req: Request) => {
  // CORS needs to know whether the key is a test key (preview hosts are allowed only then).
  const origin = req.headers.get("origin");
  const sessionKey = await setting("STRIPE_SESSION_KEY");
  const testKeys = !!sessionKey && TEST_KEY.test(sessionKey);
  const cors: Record<string, string> = originAllowed(origin, { testKeys })
    ? { "Access-Control-Allow-Origin": origin!, Vary: "Origin", ...CORS_HEADERS }
    : { Vary: "Origin" };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: BAD }, 400); }
  const action = body?.action;
  if (typeof action !== "string" || !ACTIONS.includes(action) || !wellFormed(action, body)) return json({ error: BAD }, 400);
  // Postgres takes a uuid in any case, but metadata and idempotency keys compare as text: one form.
  if (typeof body.shopId === "string") body.shopId = body.shopId.toLowerCase();

  let userId: string | null = null;
  if (action === "billing_contact") {
    const expected = await setting("ALERT_SECRET");
    if (!expected || req.headers.get("x-alert-secret") !== expected) return json({ error: "forbidden" }, 403);
  } else {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: SIGN_IN }, 401);
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ error: SIGN_IN }, 401);
    userId = user.id;
  }

  const stripe = await stripeClient("STRIPE_SESSION_KEY");
  if (!stripe) return json({ error: CLOSED }, 503);

  const ctx: Ctx = { stripe, body, userId, origin, testKeys };
  try {
    switch (action) {
      case "prices": return json(await prices(ctx));
      case "checkout": return json(await openCheckout(ctx, "plan"));
      case "featured": return json(await openCheckout(ctx, "featured"));
      case "portal": return json(await portal(ctx));
      case "sync": return json(await sync(ctx));
      case "resync": return json(await resync(ctx));
      default: return json(await billingContact(ctx));
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof Stripe.errors.StripeError) {
      console.error("billing-session", action, e.type, e.code ?? "", e.message);
      return json({ error: STRIPE_FAILED }, 502);
    }
    console.error("billing-session", action, (e as Error).message);
    return json({ error: TRY_AGAIN }, 500);
  }
});
