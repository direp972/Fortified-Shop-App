// Billing rules, shared by the billing-session and stripe-webhook Edge Functions (through
// _shared/billing.ts) and checked by scripts/billing-check.mjs. Pure ESM with no imports, so
// Deno loads it as-is and node tests it without a Stripe account. Nothing here talks to
// Stripe or the database: it decides, the callers fetch and write.
//
// Prices are not here and never will be: they live only in Stripe, found by lookup key when
// selling (prices.list) and interpreted through the Product's metadata.roofcoil_plan when a
// subscription comes back (docs/phase3-billing-design.md §2.2).

// A plan subscription in any of these blocks a second plan Checkout (design §5.1); the same
// list blocks a second Featured.
export const PLAN_BLOCKING_STATUSES = ["trialing", "active", "past_due", "unpaid", "incomplete", "paused"];

// What billing-session sells. The webhook never reads these: a lookup key moves to a new Price
// when a price changes, and shops on the old Price must keep mapping to their plan.
export const LOOKUP_KEYS = {
  shop: "roofcoil_shop_monthly",
  pro: "roofcoil_pro_monthly",
  featured: "roofcoil_featured_monthly",
};

const ROOFCOIL_PLANS = ["shop", "pro", "featured"];
const DAY_MS = 24 * 3600 * 1000;
const ms = (v) => (v == null ? NaN : Date.parse(v));
const iso = (sec) => (sec == null ? null : new Date(sec * 1000).toISOString());

// The JS copy of the `current` expression in public.shop_entitlement (design §4.1): keep the
// two in step. Comp and pilot rows count until ends_at; a Stripe row only in the mode
// billing_config names, and only inside the read-time bounds that cover a lost renewal event.
export function grantCurrent(row, { livemode }, nowMs) {
  if (row.source !== "stripe") return row.ends_at == null || ms(row.ends_at) > nowMs;
  if ((row.livemode ?? null) !== (livemode ?? null)) return false;
  if (row.status === "trialing") return ms(row.trial_end) > nowMs - DAY_MS;
  if (row.status === "active") return ms(row.current_period_end) > nowMs - 3 * DAY_MS;
  if (row.status === "past_due") return ms(row.past_due_since) + 14 * DAY_MS > nowMs;
  return false; // unpaid, canceled, paused, incomplete, incomplete_expired, anything Stripe adds
}

// One 30-day trial per shop (design §5.2): none once Stripe has any plan subscription for the
// Customer, a Stripe plan row exists, or the shop had a pilot (a pilot is the shop's trial).
// A comp does not use the trial up.
export function firstPlanEver({ stripePlanSubs, rows }) {
  return stripePlanSubs.length === 0
    && !rows.some((r) => r.kind === "plan" && r.source === "stripe")
    && !rows.some((r) => r.source === "pilot");
}

// The trial rule (design §5.2, decision 6), from the shop's grant rows. A current dated pilot or
// comp sets the trial to end when it does, at least 48 hours out (Stripe's minimum) plus a
// 10-minute margin, so the shop is never charged twice for the same days; an open-ended one
// leaves nothing to bill from.
// Returns one of { refuse }, { trialEnd }, { trialPeriodDays } or {}: never two trial keys.
export function trialFor({ rows, firstPlanEver: first, nowSec, trialDays, livemode }) {
  const covering = rows.filter((r) => r.kind === "plan" && (r.source === "pilot" || r.source === "comp")
    && grantCurrent(r, { livemode }, nowSec * 1000));
  if (covering.some((r) => r.ends_at == null)) return { refuse: "covered" };
  if (covering.length) {
    const maxEndSec = Math.max(...covering.map((r) => Math.ceil(ms(r.ends_at) / 1000)));
    // Stripe: >= 48 h at create; +10 min so the calls before create can't land under it
    return { trialEnd: Math.max(maxEndSec, nowSec + 48 * 3600 + 10 * 60) };
  }
  return first ? { trialPeriodDays: trialDays } : {};
}

// Kind and plan come from the items' Product metadata (design §5.3 Mapping): exactly one item
// must carry roofcoil_plan. items: [{ roofcoilPlan, lookupKey, currentPeriodEnd }] in the
// subscription's item order, so itemIndex points back into sub.items.data.
export function classifyItems(items) {
  const hits = [];
  (items || []).forEach((it, i) => { if (ROOFCOIL_PLANS.includes(it?.roofcoilPlan)) hits.push(i); });
  if (hits.length === 0) return { ok: false, reason: "none" };
  if (hits.length > 1) return { ok: false, reason: "several" };
  const itemIndex = hits[0];
  const roofcoilPlan = items[itemIndex].roofcoilPlan;
  const kind = roofcoilPlan === "featured" ? "featured" : "plan";
  return { ok: true, kind, plan: kind === "plan" ? roofcoilPlan : null, lookupKey: items[itemIndex].lookupKey ?? null, itemIndex };
}

// The shop is the one whose shop_billing row holds the subscription's Customer (current or a
// previous id). Metadata, when present, must agree with it, and metadata.kind with the Product:
// a Featured subscription whose price was swapped to Pro is unmapped, not silently a plan.
// A Dashboard-made subscription has no metadata and maps through the Customer alone. The ids
// compare without case: metadata edited by hand in the Dashboard may be uppercase.
export function resolveShop({ metaShopId, metaKind, customerShopId, mappedKind }) {
  if (!customerShopId) return { ok: false, reason: "unknown-customer" };
  if (metaShopId && String(metaShopId).toLowerCase() !== String(customerShopId).toLowerCase()) return { ok: false, reason: "shop-mismatch" };
  if (metaKind && metaKind !== mappedKind) return { ok: false, reason: "kind-mismatch" };
  return { ok: true, shopId: customerShopId };
}

// The subscription's coupon id (the founding count and the offer flag clear read it). Stripe
// returns discounts as bare ids unless the retrieve expands them; an id says nothing about the
// coupon, so it throws instead of answering null and erasing a stored coupon (R-24).
export function couponOf(sub) {
  const discounts = sub?.discounts;
  if (!Array.isArray(discounts) || discounts.length === 0) return null;
  const d = discounts[0];
  if (typeof d === "string") throw new Error("couponOf: discounts not expanded");
  if (!d || typeof d !== "object") return null;
  const c = d.coupon?.id ?? d.coupon ?? d.source?.coupon?.id ?? d.source?.coupon ?? null;
  return typeof c === "string" ? c : null;
}

// Grace runs from the oldest open invoice's finalization (decision 4). Drafts have no
// finalized_at and are skipped; null when none is known, and the database keeps the first
// time it saw the row past_due instead.
export function pastDueSinceFrom(openInvoices) {
  const times = (openInvoices || []).map((inv) => inv?.status_transitions?.finalized_at).filter((t) => t != null);
  return times.length ? iso(Math.min(...times)) : null;
}

// The arguments of public.billing_apply_subscription, by name, from a retrieved subscription
// (design §5.3 field sources). current_period_end lives on the item since Basil.
export function applyArgs({ sub, mapped, shopId, pastDueSince, fetchedAt }) {
  const item = sub.items?.data?.[mapped.itemIndex];
  return {
    p_shop: shopId,
    p_kind: mapped.kind,
    p_plan: mapped.plan,
    p_sub_id: sub.id,
    p_status: sub.status,
    p_lookup_key: mapped.lookupKey ?? null,
    p_livemode: sub.livemode,
    p_trial_end: iso(sub.trial_end),
    p_period_end: iso(item?.current_period_end),
    p_cancel_at_period_end: !!sub.cancel_at_period_end,
    p_cancel_at: iso(sub.cancel_at),
    p_past_due_since: sub.status === "past_due" ? (pastDueSince ?? null) : null,
    p_coupon: couponOf(sub),
    p_automatic_tax: sub.automatic_tax?.enabled ?? null,
    p_ended_at: iso(sub.ended_at),
    p_fetched_at: fetchedAt.toISOString(),
  };
}

// Where billing-session answers from, and where Checkout and the Portal return to. Not
// fortifiedmetals.com: a competitor shouldn't pay RoofCoil inside Fortified's branding, and
// that origin's session wouldn't carry over (design §8). Preview hosts only with test keys.
export const ALLOWED_ORIGINS = ["https://www.roofcoil.com", "https://roofcoil.com", "https://shop.roofcoil.com"];

export function originAllowed(origin, { testKeys }) {
  if (typeof origin !== "string") return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (!testKeys) return false;
  return /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/.test(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
}

// Back to the same origin, so the supabase-js session (stored per origin) is still there.
export function returnUrl(origin, slug) {
  const host = new URL(origin).host;
  const path = host === "www.roofcoil.com" || host === "roofcoil.com" ? "/app" : "/";
  return `${origin}${path}?shop=${encodeURIComponent(slug)}`;
}

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// Fields both Checkouts share (design §5.2). Card and Link only: a delayed method such as ACH
// can leave a subscription active over a debit that later fails. On Endive,
// allowed_payment_method_types filters the dynamically eligible methods (payment_method_types
// is gone from Checkout).
function baseCheckout({ customer, shopId, automaticTax, ret, nowSec }) {
  return {
    mode: "subscription",
    customer,
    client_reference_id: shopId,
    metadata: { shop_id: shopId },
    allowed_payment_method_types: ["card", "link"],
    payment_method_collection: "if_required", // decision 3: no card needed to start a trial
    consent_collection: { terms_of_service: "required" },
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: true },
    automatic_tax: { enabled: !!automaticTax },
    expires_at: nowSec + 35 * 60, // Stripe allows 30 min–24 h; 35 so latency can't land under 30
    success_url: `${ret}&billing=success&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${ret}&billing=cancel`,
  };
}

// A plan Checkout. trial is trialFor's answer (never { refuse } here). The founding coupon and
// promotion codes are never both on one session.
export function planCheckoutParams({ customer, shopId, shopName, plan, price, trial, offerCoupon, automaticTax, ret, nowSec }) {
  const base = baseCheckout({ customer, shopId, automaticTax, ret, nowSec });
  return defined({
    ...base,
    line_items: [{ price, quantity: 1 }],
    subscription_data: defined({
      metadata: { shop_id: shopId, kind: "plan" },
      description: `RoofCoil ${plan === "pro" ? "Pro" : "Shop"} — ${shopName}`,
      trial_end: trial?.trialEnd,
      trial_period_days: trial?.trialEnd ? undefined : trial?.trialPeriodDays,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    }),
    discounts: offerCoupon ? [{ coupon: offerCoupon }] : undefined,
    allow_promotion_codes: offerCoupon ? undefined : true,
  });
}

// The Featured add-on: its own single-item subscription on the same Customer, so the plan stays
// updatable in the Portal. No trial and no coupon.
export function featuredCheckoutParams({ customer, shopId, shopName, price, automaticTax, ret, nowSec }) {
  const base = baseCheckout({ customer, shopId, automaticTax, ret, nowSec });
  return {
    ...base,
    line_items: [{ price, quantity: 1 }],
    subscription_data: {
      metadata: { shop_id: shopId, kind: "featured" },
      description: `RoofCoil Featured — ${shopName}`,
    },
  };
}

// The Stripe Customer's contact is the earliest current owner (design §6.2): by when they
// joined, then by user id so two owners added in the same instant always pick the same one
// (plain string order, which is Postgres's uuid order for lowercase ids).
export function earliestOwner(owners) {
  const byId = (a, b) => (String(a.user_id) < String(b.user_id) ? -1 : String(a.user_id) > String(b.user_id) ? 1 : 0);
  const sorted = [...(owners || [])].sort((a, b) => (ms(a.created_at) - ms(b.created_at)) || byId(a, b));
  return sorted[0] ?? null;
}
