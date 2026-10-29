// stripe-webhook: Stripe Billing's events in, public.shop_subscriptions out
// (docs/phase3-billing-design.md §5.3). The Stripe-Signature header is the only authentication
// (verify_jwt is off in supabase/config.toml), checked against the raw body before anything
// is parsed.
//
//   1  verify the signature (400 "bad signature"); without its settings the function answers
//      503 "not configured", which is how it ships dormant
//   2  an event from the other mode than STRIPE_LIVEMODE is recorded and ignored
//   3  claim the event id in public.stripe_events; one already processed → "duplicate"
//   4  customer.deleted, customer.updated and charge.dispute.created are handled on their own;
//      anything else names a subscription (the subscription, the Checkout Session's, or the
//      invoice's) or is ignored
//   5–6  the subscription is re-fetched, never read from the event (Stripe doesn't promise
//      order), mapped to its shop and written by billing_apply_subscription, which refuses a
//      fetch older than the one it already holds ("stale")
//   7  the checkout slot, card hygiene and terminal clean-up
//   8  the result is recorded, then 200. Any other failure records "error: …", leaves the event
//      unprocessed and answers 500, so Stripe retries it (for up to 3 days in live mode). A 4xx
//      a retry can't change (a declined card, an invoice no longer open) is a result, not a 500.
//
// Results: applied | stale | duplicate | ignored | unmapped | duplicate_subscription |
// paid_after_cancel | pay_declined | alerted | error: …   The desk is emailed for unmapped,
// duplicate_subscription, paid_after_cancel, disputes and finalization failures (never card data).
//
// Events the endpoint subscribes to: checkout.session.completed,
// customer.subscription.created, .updated, .deleted, .paused, .resumed, .trial_will_end,
// invoice.paid, invoice.payment_failed, invoice.payment_action_required,
// invoice.finalization_failed, customer.updated, customer.deleted, charge.dispute.created.
// Not invoice.created: Stripe holds finalization up to 72 hours when that event gets no 2xx.
//
// Settings (environment first, then Vault):
//   STRIPE_WEBHOOK_KEY     — a restricted key (Subscriptions, Invoices, Customers write;
//                            Products and Prices read)
//   STRIPE_WEBHOOK_SECRET  — the endpoint's signing secret (test and live endpoints differ)
//   STRIPE_LIVEMODE        — "true" or "false": the only mode accepted
//   RESEND_API_KEY, ALERT_EMAIL_FROM, LISTING_ALERT_TO — desk alerts (_shared/billing.ts)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@23.0.1";
import { admin, applySubscription, billingRowForCustomer, deskAlert, idOf, setting, stripeClient } from "../_shared/billing.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ALERTED = ["unmapped", "duplicate_subscription", "paid_after_cancel", "alerted"];
const HINTS: Record<string, string> = {
  unmapped: "Nothing was written. Check the subscription's Customer, metadata and Product in the Stripe Dashboard; a platform admin can resync it once it is fixed.",
  duplicate_subscription: "This shop now has two current plans. Cancel and refund the newer subscription in the Stripe Dashboard.",
  paid_after_cancel: "The subscription was already canceled, so ordering did not resume. Refund the payment or comp the shop.",
  "charge.dispute.created": "Review the dispute in the Stripe Dashboard.",
  "invoice.finalization_failed": "Stripe couldn't finalize the invoice (often a missing tax location). Check it in the Stripe Dashboard.",
};

type Outcome = {
  result: string;
  shopId?: string | null;
  customerId?: string | null;
  reason?: string;   // why a subscription is unmapped
  applied?: string;  // the write's own result, when the event's result says something else
};

const now = () => new Date().toISOString();
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// A 4xx that a retry can't change (an invoice already paid or voided, no longer open).
const finalAnswer = (e: unknown) => e instanceof Stripe.errors.StripeInvalidRequestError;

// A Customer deleted in the Dashboard: Stripe cancels its subscriptions. Its id moves to
// previous_customer_ids (late subscription events still map), the next Checkout gets a new
// Customer, and the shop's open Stripe rows are re-fetched now, so they read canceled whichever
// event lands first. A redelivery after a half-finished attempt finds the id already moved
// and only re-fetches.
async function customerDeleted(stripe: Stripe, customerId: string, livemode: boolean): Promise<Outcome> {
  const row = await billingRowForCustomer(customerId);
  if (!row) return { result: "ignored", customerId };
  if (row.stripe_customer_id === customerId) {
    const { error } = await admin.from("shop_billing").update({
      stripe_customer_id: null,
      previous_customer_ids: [...new Set([...(row.previous_customer_ids ?? []), customerId])],
      customer_generation: (row.customer_generation ?? 0) + 1,
      has_payment_method: false,
      updated_at: now(),
    }).eq("shop_id", row.shop_id).eq("stripe_customer_id", customerId);
    if (error) throw new Error(`shop_billing: ${error.message}`);
  }
  const { data: rows, error } = await admin.from("shop_subscriptions").select("stripe_subscription_id")
    .eq("shop_id", row.shop_id).eq("source", "stripe").eq("livemode", livemode)
    .not("status", "in", "(canceled,incomplete_expired)");
  if (error) throw new Error(`shop_subscriptions: ${error.message}`);
  for (const r of rows ?? []) await applySubscription(stripe, r.stripe_subscription_id);
  return { result: "applied", shopId: row.shop_id, customerId };
}

// The Customer's default card changed (the Portal's "Update card" sets only this). Every
// subscription follows it after card hygiene, so a past_due one is paid now rather than at
// Smart Retries' next attempt: one attempt per invoice and card (the idempotency key), and a
// decline is a result, so a redelivery never charges a failing card again.
// The event says only whether this change set a card. The flag and the card charged come from
// the Customer as it is now: an older copy can land after a newer one (Stripe doesn't promise order).
// deno-lint-ignore no-explicit-any
async function customerUpdated(stripe: Stripe, customer: any, previous: any): Promise<Outcome> {
  const current = await stripe.customers.retrieve(customer.id);
  const pm = current.deleted ? null : idOf(current.invoice_settings?.default_payment_method);
  const { data: rows, error } = await admin.from("shop_billing").update({ has_payment_method: !!pm, updated_at: now() })
    .eq("stripe_customer_id", customer.id).select("shop_id");
  if (error) throw new Error(`shop_billing: ${error.message}`);
  if (!rows?.length) return { result: "ignored", customerId: customer.id };
  const out = { shopId: rows[0].shop_id, customerId: customer.id };

  const before = previous?.invoice_settings;
  const changed = before && typeof before === "object" && "default_payment_method" in before
    && idOf(before.default_payment_method) !== idOf(customer.invoice_settings?.default_payment_method);
  if (!changed || !pm) return { result: "applied", ...out };

  let declined = false;
  const pastDue = await stripe.subscriptions.list({ customer: customer.id, status: "past_due", limit: 100 });
  for (const sub of pastDue.data) {
    const open = await stripe.invoices.list({ subscription: sub.id, status: "open", limit: 100 });
    const oldest = [...open.data].sort((a, b) =>
      (a.status_transitions?.finalized_at ?? a.created) - (b.status_transitions?.finalized_at ?? b.created))[0];
    if (!oldest) continue;
    try {
      // Name the card: a card left on the subscription would otherwise be charged first.
      await stripe.invoices.pay(oldest.id, { payment_method: pm }, { idempotencyKey: `pay-${oldest.id}-${pm}` });
    } catch (e) {
      if (e instanceof Stripe.errors.StripeCardError) { declined = true; continue; }
      if (finalAnswer(e)) continue;
      throw e;
    }
  }
  return { result: declined ? "pay_declined" : "applied", ...out };
}

// One place for the card: a subscription started through Checkout can carry its own default
// payment method, which Stripe charges before the Customer's, while the Portal edits only the
// Customer's. Move it to the Customer and clear it on the subscription.
// deno-lint-ignore no-explicit-any
async function cardHygiene(stripe: Stripe, sub: any, shopId: string) {
  const pm = idOf(sub.default_payment_method);
  // An ended subscription can't be updated and will never be charged again: a late
  // customer.subscription.created must not turn into three days of 500s.
  if (!pm || sub.status === "canceled" || sub.status === "incomplete_expired") return;
  try {
    await stripe.customers.update(idOf(sub.customer)!, { invoice_settings: { default_payment_method: pm } });
    await stripe.subscriptions.update(sub.id, { default_payment_method: "" });
  } catch (e) {
    if (!finalAnswer(e)) throw e; // e.g. the card was detached meanwhile: a retry can't change it
    console.error("stripe-webhook card hygiene", sub.id, errorMessage(e));
    return;
  }
  const { error } = await admin.from("shop_billing").update({ has_payment_method: true, updated_at: now() }).eq("shop_id", shopId);
  if (error) throw new Error(`shop_billing: ${error.message}`);
}

// Retries exhausted: a canceled subscription can't be revived, so a late payment of its old
// invoices must not be taken.
async function voidOpenInvoices(stripe: Stripe, subId: string) {
  const open = await stripe.invoices.list({ subscription: subId, status: "open", limit: 100 });
  for (const inv of open.data) {
    try { await stripe.invoices.voidInvoice(inv.id); } catch (e) { if (!finalAnswer(e)) throw e; }
  }
}

// Steps 4–7.
async function dispatch(stripe: Stripe, event: Stripe.Event): Promise<Outcome> {
  // deno-lint-ignore no-explicit-any
  const obj: any = event.data.object;
  if (event.type === "customer.deleted") return customerDeleted(stripe, obj.id, event.livemode);
  // deno-lint-ignore no-explicit-any
  if (event.type === "customer.updated") return customerUpdated(stripe, obj, (event.data as any).previous_attributes);
  if (event.type === "charge.dispute.created") return { result: "alerted" };

  const subId = obj?.object === "subscription" ? obj.id
    : obj?.object === "checkout.session" ? idOf(obj.subscription)
    : obj?.object === "invoice" ? idOf(obj.parent?.subscription_details?.subscription ?? obj.subscription)
    : null;
  if (!subId) return { result: "ignored" };

  const applied = await applySubscription(stripe, subId);
  const sub = applied.sub;
  const out: Outcome = { result: applied.result, shopId: applied.shopId ?? null, customerId: idOf(sub.customer), reason: applied.reason };

  if (applied.shopId) {
    // The slot is freed only when it still holds this session (R-16): a subscription made in
    // the Dashboard never frees a session the owner has open.
    if (event.type === "checkout.session.completed") {
      const { error } = await admin.from("shop_billing").update({ checkout_session_id: null, checkout_claimed_at: null, updated_at: now() })
        .eq("shop_id", applied.shopId).eq("checkout_session_id", obj.id);
      if (error) throw new Error(`shop_billing: ${error.message}`);
    }
    if (event.type === "checkout.session.completed" || event.type === "customer.subscription.created") {
      await cardHygiene(stripe, sub, applied.shopId);
    }
    if (event.type === "customer.subscription.deleted" && sub.cancellation_details?.reason === "payment_failed") {
      await voidOpenInvoices(stripe, sub.id);
    }
  }
  if (event.type === "invoice.paid" && sub.status === "canceled") return { ...out, result: "paid_after_cancel", applied: applied.result };
  if (event.type === "invoice.finalization_failed") return { ...out, result: "alerted", applied: applied.result };
  return out;
}

async function alertDesk(event: Stripe.Event, out: Outcome) {
  // deno-lint-ignore no-explicit-any
  const obj: any = event.data.object;
  let shop = "";
  if (out.shopId) {
    const { data } = await admin.from("directory_listings").select("name").eq("id", out.shopId).maybeSingle();
    shop = data?.name || out.shopId;
  }
  const label = out.result === "alerted" ? event.type : out.result;
  const lines = [
    `Event: ${event.id}`,
    `Type: ${event.type}`,
    `Result: ${out.result}${out.applied ? ` (the subscription write: ${out.applied})` : ""}`,
    `Shop: ${shop || "not mapped"}${out.customerId ? ` (Stripe customer ${out.customerId})` : ""}`,
    `Object: ${obj?.id ?? "—"}`,
    `Livemode: ${event.livemode}`,
    out.reason ? `Reason: ${out.reason}` : null,
    HINTS[out.result] ?? HINTS[event.type] ?? null,
  ].filter((l): l is string => l !== null);
  const subject = `[RoofCoil billing] ${label} — ${shop || out.customerId || "unknown customer"}`;
  console.log("stripe-webhook alert", event.id, await deskAlert(subject, lines));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.text(); // the raw body: the signature is over these exact bytes

  const [secret, live] = await Promise.all([setting("STRIPE_WEBHOOK_SECRET"), setting("STRIPE_LIVEMODE")]);
  const stripe = await stripeClient("STRIPE_WEBHOOK_KEY");
  if (!stripe || !secret || (live !== "true" && live !== "false")) return json({ error: "not configured" }, 503);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, req.headers.get("stripe-signature") ?? "", secret, undefined, Stripe.createSubtleCryptoProvider());
  } catch {
    return json({ error: "bad signature" }, 400);
  }

  // deno-lint-ignore no-explicit-any
  const row = { id: event.id, type: event.type, livemode: event.livemode, created: new Date(event.created * 1000).toISOString(), object_id: (event.data.object as any)?.id ?? null };
  if (event.livemode !== (live === "true")) {
    const { error } = await admin.from("stripe_events").upsert({ ...row, processed_at: now(), result: "ignored" }, { onConflict: "id", ignoreDuplicates: true });
    if (error) { console.error("stripe-webhook stripe_events", event.id, error.message); return json({ result: `error: ${error.message}` }, 500); }
    return json({ result: "ignored" });
  }

  {
    const claim = await admin.from("stripe_events").upsert(row, { onConflict: "id", ignoreDuplicates: true });
    const read = claim.error ? claim : await admin.from("stripe_events").select("processed_at").eq("id", event.id).single();
    if (read.error) { console.error("stripe-webhook stripe_events", event.id, read.error.message); return json({ result: `error: ${read.error.message}` }, 500); }
    if (read.data?.processed_at) return json({ result: "duplicate" });
  }

  let out: Outcome;
  try {
    out = await dispatch(stripe, event);
    const { error } = await admin.from("stripe_events").update({ processed_at: now(), result: out.result }).eq("id", event.id);
    if (error) throw new Error(`stripe_events: ${error.message}`);
  } catch (e) {
    const result = `error: ${errorMessage(e)}`.slice(0, 1000);
    console.error("stripe-webhook", event.id, event.type, result);
    await admin.from("stripe_events").update({ result }).eq("id", event.id);
    return json({ result }, 500);
  }
  // Mailed after the event is recorded and outside the reply, so a slow or failed mail can't
  // make Stripe redeliver it.
  if (ALERTED.includes(out.result)) EdgeRuntime.waitUntil(alertDesk(event, out).catch((e) => console.error("stripe-webhook alert", event.id, errorMessage(e))));
  return json({ result: out.result });
});
