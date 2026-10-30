// Billing plumbing shared by the billing-session and stripe-webhook Edge Functions
// (docs/phase3-billing-design.md §5). The decisions live in billing-rules.mjs next to it, which
// node tests; this module does the fetching and writing around them, so the webhook, an owner's
// sync and an admin's resync all write a subscription the same way: one retrieve, the same
// field sources, one database function (public.billing_apply_subscription).
//
// Settings come from the function's environment first, then from Supabase Vault through
// public.get_secret (service role only), like the alert functions.
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@23.0.1";
import { applyArgs, classifyItems, earliestOwner, pastDueSinceFrom, resolveShop } from "./billing-rules.mjs";

export const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// The environment variable if set, otherwise the Vault secret of the same name.
export async function setting(name: string): Promise<string | undefined> {
  const env = Deno.env.get(name);
  if (env) return env;
  const { data, error } = await admin.rpc("get_secret", { secret_name: name });
  if (error) { console.error("get_secret", name, error.message); return undefined; }
  return typeof data === "string" && data ? data : undefined;
}

// One client per key setting, rebuilt when the key changes (the test → live swap at go-live).
// null while the key is unset: that is how both functions ship dormant.
const clients = new Map<string, { key: string; stripe: Stripe }>();
export async function stripeClient(keyName: string): Promise<Stripe | null> {
  const key = await setting(keyName);
  if (!key) return null;
  const cached = clients.get(keyName);
  if (cached && cached.key === key) return cached.stripe;
  const stripe = new Stripe(key, { apiVersion: "2026-09-30.endive", httpClient: Stripe.createFetchHttpClient() });
  clients.set(keyName, { key, stripe });
  return stripe;
}

// An expandable Stripe field's id, whether it came back as an id or as the object.
// deno-lint-ignore no-explicit-any
export const idOf = (v: any): string | null => (typeof v === "string" ? v : typeof v?.id === "string" ? v.id : null);

// Stripe's "no such object": a Customer deleted in the Dashboard, or an id from the other mode.
export const isMissing = (e: unknown) => e instanceof Stripe.errors.StripeError && e.code === "resource_missing";

// Product id → metadata.roofcoil_plan, for classifying listed subscriptions: a list can't expand
// each item's Product (five levels; Stripe allows four). Cached 10 minutes per instance; callers
// refresh once when they meet a Product it doesn't know.
const PRODUCT_TTL_MS = 10 * 60 * 1000;
let products: { at: number; map: Map<string, string> } | null = null;
export async function productMap(stripe: Stripe, { refresh = false } = {}): Promise<Map<string, string>> {
  if (!refresh && products && Date.now() - products.at < PRODUCT_TTL_MS) return products.map;
  const list = await stripe.products.list({ limit: 100 });
  const map = new Map<string, string>();
  for (const p of list.data) if (p.metadata?.roofcoil_plan) map.set(p.id, p.metadata.roofcoil_plan);
  products = { at: Date.now(), map };
  return map;
}

export type Owner = { user_id: string; created_at: string; email: string; name: string };

// The shop's owners with their sign-in email and name (customers.name, else the sign-up name).
export async function ownersOf(shopId: string): Promise<Owner[]> {
  const { data: members, error } = await admin.from("shop_members").select("user_id, created_at").eq("shop_id", shopId).eq("role", "owner");
  if (error) throw new Error(`shop_members: ${error.message}`);
  if (!members?.length) return [];
  const { data: people, error: peopleErr } = await admin.from("customers").select("id, name").in("id", members.map((m) => m.user_id));
  if (peopleErr) throw new Error(`customers: ${peopleErr.message}`);
  const names = new Map((people ?? []).map((c) => [c.id, c.name]));
  return Promise.all(members.map(async (m) => {
    const { data, error: userErr } = await admin.auth.admin.getUserById(m.user_id);
    if (userErr) throw new Error(`getUserById: ${userErr.message}`);
    const name = names.get(m.user_id) || data.user?.user_metadata?.name || "";
    return { user_id: m.user_id, created_at: m.created_at, email: data.user?.email ?? "", name: String(name).trim() };
  }));
}

// The Customer's email follows the shop's owners (design §6.2), so receipts and failed-payment
// emails stop reaching someone who no longer owns the shop: when it isn't a current owner's,
// it becomes the earliest current owner's, with their name.
export async function syncCustomerContact(stripe: Stripe, shopId: string): Promise<"updated" | "unchanged" | "no-customer"> {
  const { data: row, error } = await admin.from("shop_billing").select("stripe_customer_id").eq("shop_id", shopId).maybeSingle();
  if (error) throw new Error(`shop_billing: ${error.message}`);
  if (!row?.stripe_customer_id) return "no-customer";
  let customer;
  try { customer = await stripe.customers.retrieve(row.stripe_customer_id); } catch (e) { if (isMissing(e)) return "no-customer"; throw e; }
  if (customer.deleted) return "no-customer";
  const owners = (await ownersOf(shopId)).filter((o) => o.email);
  const current = (customer.email ?? "").toLowerCase();
  if (!owners.length || owners.some((o) => o.email.toLowerCase() === current)) return "unchanged";
  const owner = earliestOwner(owners);
  await stripe.customers.update(customer.id, owner.name ? { email: owner.email, name: owner.name } : { email: owner.email });
  return "updated";
}

// The shop_billing row holding this Customer, now or before it was replaced, so a subscription
// event that lands after customer.deleted still maps. null unless exactly one.
export async function billingRowForCustomer(customerId: string | null) {
  if (!customerId || !/^cus_[A-Za-z0-9]+$/.test(customerId)) return null;
  const { data, error } = await admin.from("shop_billing")
    .select("shop_id, stripe_customer_id, previous_customer_ids, customer_generation")
    .or(`stripe_customer_id.eq.${customerId},previous_customer_ids.cs.{${customerId}}`).limit(2);
  if (error) throw new Error(`shop_billing: ${error.message}`);
  return data?.length === 1 ? data[0] : null;
}

// deno-lint-ignore no-explicit-any
const productPlan = (p: any): string | null => (p && typeof p === "object" && !p.deleted ? p.metadata?.roofcoil_plan ?? null : null);

export type Applied = {
  kind: "plan" | "featured" | null;
  result: string;   // applied | stale | unmapped | duplicate_subscription | plans-closed
  shopId?: string;
  reason?: string;  // why it is unmapped
  // deno-lint-ignore no-explicit-any
  sub: any;
};

// Writes one subscription's current state, whatever the event said (Stripe doesn't promise
// order). Takes an id, never a listed or event object: the retrieve expands each item's Product
// (the mapping) and the discounts (the coupon, R-24), and fetchedAt, taken just before it, is
// what the stale guard in billing_apply_subscription compares. allowShop lets resync refuse a
// shop that isn't open yet before anything is written. Returns the retrieved subscription so
// the webhook's card hygiene reads the same object.
export async function applySubscription(
  stripe: Stripe,
  subId: string,
  { allowShop }: { allowShop?: (shopId: string) => boolean | Promise<boolean> } = {},
): Promise<Applied> {
  const fetchedAt = new Date();
  const sub = await stripe.subscriptions.retrieve(subId, { expand: ["items.data.price.product", "discounts"] });
  let pastDueSince = null;
  if (sub.status === "past_due") {
    const open = await stripe.invoices.list({ subscription: sub.id, status: "open", limit: 100 });
    pastDueSince = pastDueSinceFrom(open.data);
  }
  const mapped = classifyItems(sub.items.data.map((it) => ({
    roofcoilPlan: productPlan(it.price?.product),
    lookupKey: it.price?.lookup_key ?? null,
    currentPeriodEnd: it.current_period_end,
  })));
  if (!mapped.ok) return { kind: null, result: "unmapped", reason: mapped.reason, sub };
  const resolved = resolveShop({
    metaShopId: sub.metadata?.shop_id,
    metaKind: sub.metadata?.kind,
    customerShopId: (await billingRowForCustomer(idOf(sub.customer)))?.shop_id ?? null,
    mappedKind: mapped.kind,
  });
  if (!resolved.ok) return { kind: mapped.kind, result: "unmapped", reason: resolved.reason, sub };
  if (allowShop && !(await allowShop(resolved.shopId))) return { kind: mapped.kind, result: "plans-closed", shopId: resolved.shopId, sub };
  const { data, error } = await admin.rpc("billing_apply_subscription", applyArgs({ sub, mapped, shopId: resolved.shopId, pastDueSince, fetchedAt }));
  if (error) throw new Error(`billing_apply_subscription: ${error.message}`);
  return { kind: mapped.kind, result: String(data), shopId: resolved.shopId, sub };
}

// An email to the desk (LISTING_ALERT_TO). Best effort: the event is already recorded, and a
// mail failure must not make Stripe redeliver it. Callers never pass card data.
export async function deskAlert(subject: string, lines: string[]): Promise<string> {
  try {
    const key = await setting("RESEND_API_KEY");
    if (!key) return "skipped, RESEND_API_KEY not set";
    const from = (await setting("ALERT_EMAIL_FROM")) ?? "RoofCoil Billing <onboarding@resend.dev>";
    const to = (await setting("LISTING_ALERT_TO")) ?? "orders@roofcoil.com";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text: lines.join("\n") }),
    });
    return `${res.status} ${res.ok ? "sent" : await res.text()}`;
  } catch (e) {
    return `failed: ${(e as Error).message}`;
  }
}
