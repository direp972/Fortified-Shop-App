// order-alert: called by the orders_alert_on_insert trigger (pg_net) whenever a
// row lands in public.orders. Claims the job in public.order_alerts so a
// multi-item order sends ONE alert, waits for the batch to finish inserting,
// then emails the desk and texts the shop.
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

function describeItem(it: Record<string, unknown>): string {
  const bits: string[] = [];
  const type = (it.type as string) || "item";
  const label =
    type === "panel" ? `Panel ${it.profile ?? ""}` :
    type === "trim" ? "Trim profile" :
    type === "metal" ? "Coil / flat sheet" :
    type === "part3d" ? `3D part${it.partName ? ` (${it.partName})` : ""}` :
    type;
  bits.push(label.trim());
  if (it.quantity != null) bits.push(`qty ${it.quantity}`);
  if (it.height != null && type === "panel") bits.push(`${it.height}" long`);
  if (it.colorName) bits.push(String(it.colorName));
  if (it.brand) bits.push(String(it.brand));
  const price = Number(it.price) || 0;
  bits.push(`$${price.toFixed(2)}`);
  return "- " + bits.join(" · ");
}

async function sendEmail(subject: string, body: string, toOverride?: string) {
  const key = await setting("RESEND_API_KEY");
  if (!key) return { skipped: "RESEND_API_KEY not set" };
  const to = toOverride ?? (await setting("ALERT_EMAIL_TO")) ?? "sales@fortifiedmetals.com";
  const from = (await setting("ALERT_EMAIL_FROM")) ?? "Fortified Metals Orders <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text: body }),
  });
  return { status: res.status, body: res.ok ? "sent" : await res.text() };
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

    const byJob = await sb.from("orders").select("id,data,created_at").eq("data->>jobId", jobId);
    const byId = await sb.from("orders").select("id,data,created_at").eq("id", jobId);
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

    const subject = `New order — ${customer}${po ? ` · PO ${po}` : ""} · $${total.toFixed(2)}`;
    const body = [
      `New order on Fortified Metals / RoofCoil`,
      ``,
      `Customer: ${customer}`,
      `Phone: ${phone}`,
      po ? `PO: ${po}` : null,
      `Items: ${items.length}`,
      `Total: $${total.toFixed(2)}`,
      ``,
      ...items.map(describeItem),
      ``,
      `Open Shop Floor: https://fortifiedmetals.com/app`,
    ].filter((l) => l !== null).join("\n");
    const short = `Fortified Metals: new order from ${customer}${po ? ` (PO ${po})` : ""} — ${items.length} item(s), $${total.toFixed(2)}`;

    const email = await sendEmail(subject, body);
    const sms = await sendSms(short);
    console.log("order-alert", jobId, JSON.stringify({ email, sms }));

    await sb.from("order_alerts").update({ status: { email, sms, items: items.length, total } }).eq("job_id", jobId);
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
