// order-alert: called by the orders_alert_on_insert trigger (pg_net) whenever a
// row lands in public.orders. Claims the job in public.order_alerts so a
// multi-item order sends ONE alert, waits for the batch to finish inserting,
// then emails the shop the order was sent to and a confirmation to the customer.
//
// Routing: an order carries shop_id, the directory listing it was sent to. A listing
// that takes orders through RoofCoil has an order_email; the alert goes there and its
// owner sees the job on their own Shop Floor at shop.roofcoil.com. An order with no
// shop, or a shop with no order email, goes to the Fortified Metals desk (ALERT_EMAIL_TO)
// and the shop text, exactly as before.
//
// Auth: custom shared-secret header (x-alert-secret) matching the DB trigger —
// verify_jwt is off because pg_net cannot mint JWTs. Worst case for a leaked
// secret is a spurious notification; no data is exposed.
//
// Settings come from the function's environment first, then from Supabase Vault
// through public.get_secret (service role only), so each can be set with one SQL
// statement instead of the dashboard:  select vault.create_secret('value', 'NAME');
//   ALERT_SECRET      — the x-alert-secret value the DB trigger sends (required)
//   RESEND_API_KEY    — required for email (and gateway SMS)
//   ALERT_EMAIL_TO    — default sales@fortifiedmetals.com
//   ALERT_EMAIL_FROM  — default onboarding@resend.dev (use orders@fortifiedmetals.com after domain verify)
//   SMS_GATEWAY_TO    — e.g. 19725551234@vtext.com (free carrier email-to-SMS route)
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM / ALERT_SMS_TO — Twilio route (wins over gateway)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BATCH_SETTLE_MS = 8000;
const PHONE = "972-944-7963";
const DEFAULT_SHOP = "Fortified Metals";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// The environment variable if set, otherwise the Vault secret of the same name.
async function setting(name: string): Promise<string | undefined> {
  const env = Deno.env.get(name);
  if (env) return env;
  const { data, error } = await sb.rpc("get_secret", { secret_name: name });
  if (error) { console.error("get_secret", name, error.message); return undefined; }
  return typeof data === "string" && data ? data : undefined;
}

const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

function describeItem(it: Record<string, unknown>): string {
  const bits: string[] = [];
  const type = (it.type as string) || "item";
  const label =
    type === "panel" ? `Panel ${it.profile ?? ""}` :
    type === "trim" ? `Trim profile${it.partName ? ` (${it.partName})` : ""}` :
    type === "metal" ? "Coil / flat sheet" :
    type === "part3d" ? `3D part${it.partName ? ` (${it.partName})` : it.partType ? ` (${it.partType})` : ""}` :
    type;
  bits.push(label.trim());
  if (it.quantity != null) bits.push(`qty ${it.quantity}`);
  if (it.height != null && type === "panel") bits.push(`${it.height}" long`);
  if (it.lengthPerPiece != null && type === "trim") bits.push(`${it.lengthPerPiece}' each`);
  if (it.colorName) bits.push(String(it.colorName));
  if (it.brand) bits.push(String(it.brand));
  bits.push(money(Number(it.price) || 0));
  return "- " + bits.join(" · ");
}

async function sendEmail(subject: string, body: string, toOverride?: string, html?: string) {
  const key = await setting("RESEND_API_KEY");
  if (!key) return { skipped: "RESEND_API_KEY not set" };
  const to = toOverride ?? (await setting("ALERT_EMAIL_TO")) ?? "sales@fortifiedmetals.com";
  const from = (await setting("ALERT_EMAIL_FROM")) ?? "Fortified Metals Orders <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text: body, ...(html ? { html } : {}) }),
  });
  return { to, status: res.status, body: res.ok ? "sent" : await res.text() };
}

async function sendSms(shortText: string) {
  const sid = await setting("TWILIO_ACCOUNT_SID");
  const token = await setting("TWILIO_AUTH_TOKEN");
  const twFrom = await setting("TWILIO_FROM");
  const twTo = await setting("ALERT_SMS_TO");
  if (sid && token && twFrom && twTo) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${sid}:${token}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: twFrom, To: twTo, Body: shortText }),
    });
    return { via: "twilio", status: res.status, body: res.ok ? "sent" : await res.text() };
  }
  const gateway = await setting("SMS_GATEWAY_TO");
  if (gateway) {
    const r = await sendEmail("", shortText, gateway);
    return { via: "carrier-gateway", ...r };
  }
  return { skipped: "no TWILIO_* or SMS_GATEWAY_TO set" };
}

type Shop = { id: string; name: string; phone: string | null; order_email: string | null; accepts_orders: boolean } | null;

// The customer's copy: what they ordered, who is making it, and how to reach that shop.
function customerMail(name: string, shopName: string, shopPhone: string, po: string, items: Record<string, unknown>[], total: number) {
  const first = (name || "").trim().split(/\s+/)[0];
  const hi = first ? `Hi ${first},` : "Hi there,";
  const lines = items.map(describeItem);
  const text = [
    hi, "",
    `We received your order${po ? ` (${po})` : ""} and sent it to ${shopName}.`,
    `${shopName} will confirm the final price and reach out${shopPhone ? ` — or call them at ${shopPhone}` : ""}.`,
    "", ...lines, "",
    `Estimated total: ${money(total)} (final pricing confirmed by the shop)`,
    "",
    `You can see this order any time under Past Orders: https://shop.roofcoil.com/`,
    "",
    `RoofCoil.com · Fortified Metals · ${PHONE}`,
  ].join("\n");
  const html = `<div style="background:#F6F4EE;padding:28px 12px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1C1C1E">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:28px 26px;border:1px solid #E7E2D6">
    <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8A94A6;margin-bottom:14px">RoofCoil.com</div>
    <h1 style="font-size:22px;margin:0 0 10px;color:#0A2B41">${esc(hi)}</h1>
    <p style="font-size:15px;line-height:1.55;margin:0 0 14px">We received your order${po ? ` <b>${esc(po)}</b>` : ""} and sent it to <b>${esc(shopName)}</b>. They will confirm the final price and reach out${shopPhone ? `, or call them at <a href="tel:${esc(shopPhone.replace(/[^\d+]/g, ""))}" style="color:#0F3D5C">${esc(shopPhone)}</a>` : ""}.</p>
    <ul style="font-size:13.5px;line-height:1.6;padding-left:18px;margin:0 0 14px">${lines.map((l) => `<li>${esc(l.replace(/^- /, ""))}</li>`).join("")}</ul>
    <p style="font-size:14px;margin:0 0 18px"><b>Estimated total: ${esc(money(total))}</b> <span style="color:#4E6273">(final pricing confirmed by the shop)</span></p>
    <p style="margin:0 0 20px"><a href="https://shop.roofcoil.com/" style="display:inline-block;background:#0F3D5C;color:#fff;font-weight:700;font-size:14px;text-decoration:none;padding:11px 18px;border-radius:9px">See your orders</a></p>
    <div style="margin-top:22px;padding-top:14px;border-top:1px solid #E7E2D6;font-size:12px;color:#8A94A6;line-height:1.5">RoofCoil.com · Fortified Metals · ${PHONE}</div>
  </div></div>`;
  return { subject: `Order received${po ? ` — ${po}` : ""} · ${shopName}`, text, html };
}

async function process(record: Record<string, any>) {
  try {
    const data = record?.data ?? {};
    const jobId: string = data.jobId || record?.id;
    if (!jobId) return;

    // Claim the job — only the first inserted row's invocation proceeds.
    const { data: claimed, error: claimErr } = await sb
      .from("order_alerts")
      .upsert({ job_id: jobId }, { onConflict: "job_id", ignoreDuplicates: true })
      .select();
    if (claimErr) { console.error("claim error", claimErr); return; }
    if (!claimed || claimed.length === 0) return; // another row already claimed it

    await new Promise((r) => setTimeout(r, BATCH_SETTLE_MS)); // let sibling rows land

    const byJob = await sb.from("orders").select("id,user_id,shop_id,data,created_at").eq("data->>jobId", jobId);
    const byId = await sb.from("orders").select("id,user_id,shop_id,data,created_at").eq("id", jobId);
    const seen = new Set<string>();
    const rows = [...(byJob.data ?? []), ...(byId.data ?? [])].filter((r) => {
      if (seen.has(r.id)) return false; seen.add(r.id); return true;
    });
    const items = rows.length > 0 ? rows.map((r) => r.data ?? {}) : [data];

    const first = items[0] ?? {};
    const customer = first.customerName || "Unknown customer";
    const phone = first.phone || "no phone";
    const po = items.map((i) => i.poNumber).find(Boolean) || "";
    const total = items.reduce((s, i) => s + (Number(i.price) || 0), 0);

    // Where the order goes: the listing it was sent to, if that shop takes orders here.
    const shopId: string | null = rows.find((r) => r.shop_id)?.shop_id || record?.shop_id || first.shopId || null;
    let shop: Shop = null;
    if (shopId) {
      const { data: s, error } = await sb.from("directory_listings").select("id,name,phone,order_email,accepts_orders").eq("id", shopId).maybeSingle();
      if (error) console.error("shop lookup", error.message);
      shop = (s as Shop) ?? null;
    }
    const routed = !!(shop && shop.order_email && shop.order_email.includes("@"));
    const shopName = shop?.name || first.shopName || DEFAULT_SHOP;
    const shopPhone = routed ? (shop?.phone || "") : PHONE;
    const floorUrl = routed ? "https://shop.roofcoil.com/ (Shop Floor tab)" : "https://fortifiedmetals.com/app";

    const subject = `New order — ${customer}${po ? ` · PO ${po}` : ""} · ${money(total)}${shop ? ` → ${shop.name}` : ""}`;
    const body = [
      `New order on RoofCoil.com for ${shopName}`,
      ``,
      `Customer: ${customer}`,
      `Phone: ${phone}`,
      po ? `PO: ${po}` : null,
      `Items: ${items.length}`,
      `Total: ${money(total)}`,
      first.notes ? `Notes: ${first.notes}` : null,
      ``,
      ...items.map(describeItem),
      ``,
      `Open Shop Floor: ${floorUrl}`,
    ].filter((l) => l !== null).join("\n");
    const short = `${shopName}: new order from ${customer}${po ? ` (PO ${po})` : ""} — ${items.length} item(s), ${money(total)}`;

    const email = await sendEmail(subject, body, routed ? shop!.order_email! : undefined);
    const sms = routed ? { skipped: `routed to ${shop!.name}` } : await sendSms(short);

    // The customer's confirmation goes to the account that placed the order.
    let confirmation: Record<string, unknown> = { skipped: "no account on the order" };
    const userId: string | null = rows.find((r) => r.user_id)?.user_id || record?.user_id || null;
    if (userId) {
      const { data: u, error } = await sb.auth.admin.getUserById(userId);
      const to = u?.user?.email;
      if (error) confirmation = { skipped: `user lookup: ${error.message}` };
      else if (!to) confirmation = { skipped: "account has no email" };
      else {
        const m = customerMail(customer, shopName, shopPhone, po, items, total);
        confirmation = await sendEmail(m.subject, m.text, to, m.html);
      }
    }
    console.log("order-alert", jobId, JSON.stringify({ shop: shop?.name ?? null, routed, email, sms, confirmation }));

    await sb.from("order_alerts").update({ status: { shop: shop?.name ?? null, routed, email, sms, confirmation, items: items.length, total } }).eq("job_id", jobId);
  } catch (e) {
    console.error("order-alert failed", e);
  }
}

Deno.serve(async (req: Request) => {
  const expected = await setting("ALERT_SECRET");
  if (!expected || req.headers.get("x-alert-secret") !== expected) {
    return new Response("forbidden", { status: 403 });
  }
  let payload: Record<string, any>;
  try { payload = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
  EdgeRuntime.waitUntil(process(payload?.record ?? {}));
  return new Response("accepted", { status: 202 });
});
