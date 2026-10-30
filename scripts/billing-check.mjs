// Checks the billing rules the Stripe functions share (trial rule, mapping, coupon, Checkout
// parameters), with made-up rows and subscription objects: no Stripe account, no database.
// Run: node scripts/billing-check.mjs   (exits non-zero on the first failing check)
import assert from "node:assert/strict";
import {
  PLAN_BLOCKING_STATUSES, LOOKUP_KEYS, grantCurrent, firstPlanEver, trialFor, classifyItems, resolveShop, couponOf,
  pastDueSinceFrom, applyArgs, ALLOWED_ORIGINS, originAllowed, returnUrl, planCheckoutParams, featuredCheckoutParams, earliestOwner,
} from "../supabase/functions/_shared/billing-rules.mjs";

const DAY = 24 * 3600;
const nowSec = 1_800_000_000; // a fixed "now", so the checks never depend on the clock
const now = nowSec * 1000;
const at = (sec) => new Date(sec * 1000).toISOString();
const cfg = { livemode: false };
const stripeRow = (status, extra = {}) => ({ kind: "plan", plan: "shop", source: "stripe", status, livemode: false, ...extra });
const grant = (source, endsSec, extra = {}) => ({ kind: "plan", plan: "shop", source, status: "active", ends_at: endsSec == null ? null : at(endsSec), ...extra });

assert.deepEqual(PLAN_BLOCKING_STATUSES, ["trialing", "active", "past_due", "unpaid", "incomplete", "paused"]);
assert.deepEqual(LOOKUP_KEYS, { shop: "roofcoil_shop_monthly", pro: "roofcoil_pro_monthly", featured: "roofcoil_featured_monthly" });

// grantCurrent mirrors shop_entitlement's `current`: a day after trial_end, three days after the
// period end, fourteen days of grace, and only in the configured mode.
assert.equal(grantCurrent(stripeRow("trialing", { trial_end: at(nowSec - DAY + 60) }), cfg, now), true, "trial ended under a day ago still counts");
assert.equal(grantCurrent(stripeRow("trialing", { trial_end: at(nowSec - DAY - 60) }), cfg, now), false, "trial ended over a day ago");
assert.equal(grantCurrent(stripeRow("active", { current_period_end: at(nowSec - 3 * DAY + 60) }), cfg, now), true, "period ended under 3 days ago still counts");
assert.equal(grantCurrent(stripeRow("active", { current_period_end: at(nowSec - 3 * DAY - 60) }), cfg, now), false, "period ended over 3 days ago");
assert.equal(grantCurrent(stripeRow("past_due", { past_due_since: at(nowSec - 13 * DAY) }), cfg, now), true, "grace day 13");
assert.equal(grantCurrent(stripeRow("past_due", { past_due_since: at(nowSec - 15 * DAY) }), cfg, now), false, "grace day 15");
assert.equal(grantCurrent(stripeRow("active", { livemode: true, current_period_end: at(nowSec + 10 * DAY) }), cfg, now), false, "a live row never counts in test mode");
assert.equal(grantCurrent(stripeRow("active", { current_period_end: at(nowSec + 10 * DAY) }), { livemode: true }, now), false, "nor a test row in live mode");
assert.equal(grantCurrent(grant("comp", null), cfg, now), true, "open-ended comp");
assert.equal(grantCurrent(grant("comp", nowSec - 60), cfg, now), false, "ended comp");
assert.equal(grantCurrent(grant("pilot", nowSec + DAY), cfg, now), true, "dated pilot before its end");
assert.equal(grantCurrent(stripeRow("incomplete", { current_period_end: at(nowSec + 10 * DAY) }), cfg, now), false, "incomplete never counts");
assert.equal(grantCurrent(stripeRow("canceled", { current_period_end: at(nowSec + 10 * DAY) }), cfg, now), false, "canceled never counts");

// firstPlanEver: any Stripe plan subscription or row, or any pilot, uses the trial up; a comp doesn't.
assert.equal(firstPlanEver({ stripePlanSubs: [{ id: "sub_1" }], rows: [] }), false, "Stripe list non-empty");
assert.equal(firstPlanEver({ stripePlanSubs: [], rows: [grant("pilot", nowSec - DAY)] }), false, "a pilot row");
assert.equal(firstPlanEver({ stripePlanSubs: [], rows: [stripeRow("canceled")] }), false, "a Stripe plan row");
assert.equal(firstPlanEver({ stripePlanSubs: [], rows: [grant("comp", nowSec - DAY)] }), true, "comp rows only");
assert.equal(firstPlanEver({ stripePlanSubs: [], rows: [] }), true, "nothing at all");

// trialFor: a current dated grant sets trial_end (at least 48 h out), an open-ended one refuses,
// otherwise 30 days only for a first plan. Never two trial keys.
const trial = (rows, first) => trialFor({ rows, firstPlanEver: first, nowSec, trialDays: 30, livemode: false });
assert.deepEqual(trial([grant("pilot", nowSec + DAY)], false), { trialEnd: nowSec + 48 * 3600 + 10 * 60 }, "grant ending in 1 day → 48 h + 10 min");
assert.deepEqual(trial([grant("pilot", nowSec + 48 * 3600 + 5)], false), { trialEnd: nowSec + 48 * 3600 + 10 * 60 }, "grant ending just past 48 h → still the floor");
assert.deepEqual(trial([grant("pilot", nowSec + 48 * 3600 + 11 * 60)], false), { trialEnd: nowSec + 48 * 3600 + 11 * 60 }, "grant ending past the floor → its end");
assert.deepEqual(trial([grant("pilot", nowSec + 20 * DAY)], true), { trialEnd: nowSec + 20 * DAY }, "dated pilot → its end, whatever firstPlanEver says");
assert.deepEqual(trial([grant("comp", nowSec + 40 * DAY), grant("pilot", nowSec + 20 * DAY)], false), { trialEnd: nowSec + 40 * DAY }, "two dated grants → the later");
assert.deepEqual(trial([grant("pilot", null)], false), { refuse: "covered" }, "open-ended pilot");
assert.deepEqual(trial([grant("comp", null), grant("pilot", nowSec + 20 * DAY)], false), { refuse: "covered" }, "open-ended comp beside a dated pilot");
assert.deepEqual(trial([grant("pilot", nowSec - DAY)], false), {}, "lapsed pilot → no trial");
assert.deepEqual(trial([grant("comp", nowSec - DAY)], true), { trialPeriodDays: 30 }, "comp-only history → 30 days");
assert.deepEqual(trial([{ kind: "featured", plan: null, source: "comp", status: "active", ends_at: null }], true), { trialPeriodDays: 30 }, "a Featured comp is not a plan grant");
for (const [rows, first] of [[[grant("pilot", nowSec + DAY)], true], [[], true], [[], false], [[grant("comp", nowSec + 5 * DAY)], true]]) {
  const t = trial(rows, first);
  assert.ok(!("trialEnd" in t && "trialPeriodDays" in t), "never both trial keys");
}

// classifyItems: exactly one RoofCoil item decides kind and plan.
const item = (roofcoilPlan, lookupKey = null) => ({ roofcoilPlan, lookupKey, currentPeriodEnd: nowSec + 30 * DAY });
assert.deepEqual(classifyItems([item("pro", "roofcoil_pro_monthly")]), { ok: true, kind: "plan", plan: "pro", lookupKey: "roofcoil_pro_monthly", itemIndex: 0 }, "one plan item");
assert.deepEqual(classifyItems([item(null), item("featured", "roofcoil_featured_monthly")]), { ok: true, kind: "featured", plan: null, lookupKey: "roofcoil_featured_monthly", itemIndex: 1 }, "one featured item");
assert.deepEqual(classifyItems([item("shop"), item("featured")]), { ok: false, reason: "several" }, "two RoofCoil items");
assert.deepEqual(classifyItems([item(null), item("enterprise")]), { ok: false, reason: "none" }, "no RoofCoil item");

// resolveShop: the Customer decides the shop; metadata must agree with it and with the Product.
const SHOP = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
assert.deepEqual(resolveShop({ metaShopId: SHOP, metaKind: "plan", customerShopId: null, mappedKind: "plan" }), { ok: false, reason: "unknown-customer" });
assert.deepEqual(resolveShop({ metaShopId: OTHER, metaKind: "plan", customerShopId: SHOP, mappedKind: "plan" }), { ok: false, reason: "shop-mismatch" });
assert.deepEqual(resolveShop({ metaShopId: SHOP, metaKind: "featured", customerShopId: SHOP, mappedKind: "plan" }), { ok: false, reason: "kind-mismatch" }, "Featured subscription swapped to Pro");
assert.deepEqual(resolveShop({ metaShopId: undefined, metaKind: undefined, customerShopId: SHOP, mappedKind: "plan" }), { ok: true, shopId: SHOP }, "Dashboard subscription without metadata");
assert.deepEqual(resolveShop({ metaShopId: SHOP, metaKind: "plan", customerShopId: SHOP, mappedKind: "plan" }), { ok: true, shopId: SHOP });
assert.deepEqual(resolveShop({ metaShopId: SHOP.toUpperCase(), metaKind: "plan", customerShopId: SHOP, mappedKind: "plan" }), { ok: true, shopId: SHOP }, "an uppercase metadata id is the same shop");
assert.deepEqual(resolveShop({ metaShopId: OTHER.toUpperCase(), metaKind: "plan", customerShopId: SHOP, mappedKind: "plan" }), { ok: false, reason: "shop-mismatch" }, "and another shop's stays a mismatch");

// couponOf reads both expanded discount shapes and refuses an unexpanded id.
assert.equal(couponOf({ discounts: [{ id: "di_1", source: { type: "coupon", coupon: "founding" } }] }), "founding", "Endive shape: source.coupon id");
assert.equal(couponOf({ discounts: [{ id: "di_1", source: { type: "coupon", coupon: { id: "founding" } } }] }), "founding", "source.coupon expanded");
assert.equal(couponOf({ discounts: [{ id: "di_1", coupon: { id: "founding" } }] }), "founding", "coupon object");
assert.equal(couponOf({ discounts: [] }), null, "empty discounts");
assert.equal(couponOf({}), null, "no discounts");
assert.equal(couponOf({ discounts: null }), null, "null discounts");
assert.throws(() => couponOf({ discounts: ["di_1"] }), /couponOf: discounts not expanded/, "an unexpanded id throws");

// pastDueSinceFrom: the oldest finalized open invoice.
assert.equal(pastDueSinceFrom([{ status_transitions: { finalized_at: nowSec - DAY } }, { status_transitions: { finalized_at: null } }, { status_transitions: { finalized_at: nowSec - 3 * DAY } }]), at(nowSec - 3 * DAY), "oldest, nulls ignored");
assert.equal(pastDueSinceFrom([{ status_transitions: { finalized_at: null } }]), null, "only drafts");
assert.equal(pastDueSinceFrom([]), null, "empty");

// applyArgs: the period end comes from the RoofCoil item, past_due_since only while past_due,
// and a custom-date cancellation is cancel_at alone.
const sub = {
  id: "sub_1", status: "active", livemode: false, trial_end: null, cancel_at_period_end: false, cancel_at: nowSec + 9 * DAY, ended_at: null,
  automatic_tax: { enabled: true }, metadata: { shop_id: SHOP, kind: "plan" },
  discounts: [{ id: "di_1", source: { type: "coupon", coupon: "founding" } }],
  items: { data: [{ current_period_end: nowSec + DAY }, { current_period_end: nowSec + 30 * DAY }] },
};
const mapped = { ok: true, kind: "plan", plan: "shop", lookupKey: "roofcoil_shop_monthly", itemIndex: 1 };
const fetchedAt = new Date(now);
const args = applyArgs({ sub, mapped, shopId: SHOP, pastDueSince: at(nowSec - 2 * DAY), fetchedAt });
assert.deepEqual(Object.keys(args), ["p_shop", "p_kind", "p_plan", "p_sub_id", "p_status", "p_lookup_key", "p_livemode", "p_trial_end", "p_period_end",
  "p_cancel_at_period_end", "p_cancel_at", "p_past_due_since", "p_coupon", "p_automatic_tax", "p_ended_at", "p_fetched_at"], "the 16 named arguments, in order");
assert.equal(args.p_period_end, at(nowSec + 30 * DAY), "period end from the RoofCoil item");
assert.equal(args.p_past_due_since, null, "past_due_since only while past_due");
assert.equal(args.p_cancel_at_period_end, false, "a custom-date cancel is not cancel_at_period_end");
assert.equal(args.p_cancel_at, at(nowSec + 9 * DAY), "cancel_at kept");
assert.equal(args.p_coupon, "founding");
assert.equal(args.p_automatic_tax, true);
assert.equal(args.p_fetched_at, fetchedAt.toISOString());
assert.equal(args.p_lookup_key, "roofcoil_shop_monthly");
assert.equal(applyArgs({ sub: { ...sub, status: "past_due" }, mapped, shopId: SHOP, pastDueSince: at(nowSec - 2 * DAY), fetchedAt }).p_past_due_since, at(nowSec - 2 * DAY), "past_due carries it");
assert.equal(applyArgs({ sub: { ...sub, automatic_tax: undefined, discounts: [] }, mapped, shopId: SHOP, pastDueSince: null, fetchedAt }).p_automatic_tax, null, "no automatic_tax → null");
assert.equal(applyArgs({ sub: { ...sub, discounts: [] }, mapped, shopId: SHOP, pastDueSince: null, fetchedAt }).p_coupon, null, "no discount → no coupon");
assert.throws(() => applyArgs({ sub: { ...sub, discounts: ["di_1"] }, mapped, shopId: SHOP, pastDueSince: null, fetchedAt }), /discounts not expanded/,
  "an unexpanded subscription never reaches the database call");

// Origins: the three RoofCoil hosts; never fortifiedmetals.com; previews only with test keys.
assert.deepEqual(ALLOWED_ORIGINS, ["https://www.roofcoil.com", "https://roofcoil.com", "https://shop.roofcoil.com"]);
for (const o of ALLOWED_ORIGINS) assert.equal(originAllowed(o, { testKeys: false }), true, o);
assert.equal(originAllowed("https://www.fortifiedmetals.com", { testKeys: true }), false, "fortifiedmetals.com is never allowed");
assert.equal(originAllowed("https://fortifiedmetals.com", { testKeys: false }), false);
assert.equal(originAllowed("https://roofcoil-tools-git-x.vercel.app", { testKeys: false }), false, "vercel previews need test keys");
assert.equal(originAllowed("https://roofcoil-tools-git-x.vercel.app", { testKeys: true }), true);
assert.equal(originAllowed("http://localhost:5173", { testKeys: false }), false, "localhost needs test keys");
assert.equal(originAllowed("http://localhost:5173", { testKeys: true }), true);
assert.equal(originAllowed("http://127.0.0.1:4173", { testKeys: true }), true);
assert.equal(originAllowed("https://evil.example.com", { testKeys: true }), false);
assert.equal(originAllowed(null, { testKeys: true }), false, "no Origin header");

// Return URLs: the app lives at / on shop.roofcoil.com and /app on the www and apex hosts.
assert.equal(returnUrl("https://shop.roofcoil.com", "sample-shop"), "https://shop.roofcoil.com/?shop=sample-shop");
assert.equal(returnUrl("https://www.roofcoil.com", "sample-shop"), "https://www.roofcoil.com/app?shop=sample-shop");
assert.equal(returnUrl("https://roofcoil.com", "sample-shop"), "https://roofcoil.com/app?shop=sample-shop");
assert.equal(returnUrl("http://localhost:5173", "sample-shop"), "http://localhost:5173/?shop=sample-shop", "a preview host is the shop app");
assert.equal(returnUrl("https://shop.roofcoil.com", "a b&c"), "https://shop.roofcoil.com/?shop=a%20b%26c", "slug encoded");

// Checkout parameters.
const ret = returnUrl("https://shop.roofcoil.com", "test-shop");
const common = { customer: "cus_1", shopId: SHOP, shopName: "Test Shop", price: "price_1", automaticTax: false, ret, nowSec };
const withCoupon = planCheckoutParams({ ...common, plan: "shop", trial: { trialPeriodDays: 30 }, offerCoupon: "founding" });
const noCoupon = planCheckoutParams({ ...common, plan: "pro", trial: { trialEnd: nowSec + 20 * DAY }, offerCoupon: null });
assert.deepEqual(withCoupon.discounts, [{ coupon: "founding" }], "founding coupon");
assert.ok(!("allow_promotion_codes" in withCoupon), "no promotion codes beside the coupon");
assert.equal(noCoupon.allow_promotion_codes, true, "promotion codes without a coupon");
assert.ok(!("discounts" in noCoupon), "no discounts key without a coupon");
assert.equal(withCoupon.subscription_data.trial_period_days, 30);
assert.ok(!("trial_end" in withCoupon.subscription_data), "trial_period_days alone");
assert.equal(noCoupon.subscription_data.trial_end, nowSec + 20 * DAY);
assert.ok(!("trial_period_days" in noCoupon.subscription_data), "trial_end alone");
const noTrial = planCheckoutParams({ ...common, plan: "shop", trial: {}, offerCoupon: null });
assert.ok(!("trial_end" in noTrial.subscription_data) && !("trial_period_days" in noTrial.subscription_data), "no trial: neither key");
assert.deepEqual(noTrial.subscription_data.trial_settings, { end_behavior: { missing_payment_method: "cancel" } }, "a trial without a card cancels");
const both = planCheckoutParams({ ...common, plan: "shop", trial: { trialEnd: nowSec + 20 * DAY, trialPeriodDays: 30 }, offerCoupon: null });
assert.equal(both.subscription_data.trial_end, nowSec + 20 * DAY);
assert.ok(!("trial_period_days" in both.subscription_data), "never both trial keys, even if asked");
assert.equal(withCoupon.mode, "subscription");
assert.equal(withCoupon.client_reference_id, SHOP);
assert.deepEqual(withCoupon.metadata, { shop_id: SHOP });
assert.deepEqual(withCoupon.subscription_data.metadata, { shop_id: SHOP, kind: "plan" });
assert.equal(withCoupon.subscription_data.description, "RoofCoil Shop — Test Shop");
assert.equal(noCoupon.subscription_data.description, "RoofCoil Pro — Test Shop");
assert.deepEqual(withCoupon.line_items, [{ price: "price_1", quantity: 1 }]);
assert.deepEqual(withCoupon.allowed_payment_method_types, ["card", "link"], "card and Link only");
assert.ok(!("payment_method_types" in withCoupon), "the pre-Endive key is not sent");
assert.equal(withCoupon.payment_method_collection, "if_required");
assert.deepEqual(withCoupon.consent_collection, { terms_of_service: "required" });
assert.equal(withCoupon.billing_address_collection, "required");
assert.deepEqual(withCoupon.customer_update, { address: "auto", name: "auto" });
assert.deepEqual(withCoupon.tax_id_collection, { enabled: true });
assert.deepEqual(withCoupon.automatic_tax, { enabled: false });
assert.deepEqual(planCheckoutParams({ ...common, automaticTax: true, plan: "shop", trial: {}, offerCoupon: null }).automatic_tax, { enabled: true });
assert.equal(withCoupon.expires_at, nowSec + 2100, "expires 35 minutes out");
assert.equal(withCoupon.success_url, "https://shop.roofcoil.com/?shop=test-shop&billing=success&session={CHECKOUT_SESSION_ID}");
assert.equal(withCoupon.cancel_url, "https://shop.roofcoil.com/?shop=test-shop&billing=cancel");
assert.ok(Object.values(withCoupon).every((v) => v !== undefined) && Object.values(withCoupon.subscription_data).every((v) => v !== undefined), "undefined keys are omitted");

const featured = featuredCheckoutParams(common);
assert.deepEqual(featured.subscription_data, { metadata: { shop_id: SHOP, kind: "featured" }, description: "RoofCoil Featured — Test Shop" }, "Featured: no trial keys");
assert.ok(!("discounts" in featured) && !("allow_promotion_codes" in featured), "Featured: no coupon, no promotion codes");
assert.deepEqual(featured.allowed_payment_method_types, ["card", "link"]);
assert.equal(featured.expires_at, nowSec + 2100);
assert.equal(featured.success_url, withCoupon.success_url);
assert.equal(featured.cancel_url, withCoupon.cancel_url);
assert.deepEqual(featured.consent_collection, { terms_of_service: "required" });

// earliestOwner: by created_at, then user_id.
const t0 = "2026-10-01T12:00:00.000Z";
assert.equal(earliestOwner([
  { user_id: "bbbbbbbb-0000-4000-8000-000000000000", created_at: t0, email: "b@x.test" },
  { user_id: "cccccccc-0000-4000-8000-000000000000", created_at: "2026-09-01T12:00:00.000Z", email: "c@x.test" },
]).email, "c@x.test", "the earliest owner");
assert.equal(earliestOwner([
  { user_id: "bbbbbbbb-0000-4000-8000-000000000000", created_at: t0, email: "b@x.test" },
  { user_id: "aaaaaaaa-0000-4000-8000-000000000000", created_at: t0, email: "a@x.test" },
]).email, "a@x.test", "same instant: the lower user id");
assert.equal(earliestOwner([]), null, "no owners");

console.log("billing-check: all checks passed");
