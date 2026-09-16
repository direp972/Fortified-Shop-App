// listing-alert: the directory's emails, all sent by pg_net triggers with a shared
// secret (pg_net cannot mint JWTs). The body's `kind` says which:
//   application   — applications_alert_on_insert: a new Get Listed application landed in
//                   public.manufacturer_applications. Emails the desk so someone reviews
//                   it in the directory admin.
//   listing_live  — listing_live_alert: a listing's status just became 'live'. Emails the
//                   shop (its owner account, else the email on its application) that it is
//                   published, with the links to manage it.
//   edit_decided  — listing_edit_decided_alert: a proposed edit was applied or dismissed.
//                   Emails whoever proposed it.
//
// Settings come from the function's environment first, then from Supabase Vault
// through public.get_secret (service role only), so each can be set with one SQL
// statement instead of the dashboard:  select vault.create_secret('value', 'NAME');
//   ALERT_SECRET      — the x-alert-secret value the DB trigger sends (required)
//   RESEND_API_KEY    — required to send (same key as order-alert)
//   LISTING_ALERT_TO  — default orders@roofcoil.com
//   ALERT_EMAIL_FROM  — default onboarding@resend.dev (until domain verified)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PHONE = "972-944-7963";
const SITE = "https://www.roofcoil.com";

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

async function sendMail(to: string, subject: string, body: string): Promise<string> {
  const key = await setting("RESEND_API_KEY");
  if (!key) return "skipped, RESEND_API_KEY not set";
  const from = (await setting("ALERT_EMAIL_FROM")) ?? "RoofCoil Directory <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text: body }),
  });
  return `${res.status} ${res.ok ? "sent" : await res.text()}`;
}

const isEmail = (s: unknown) => typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const FIELD_LABELS: Record<string, string> = {
  name: "Company name", phone: "Phone", website: "Website", gmaps_url: "Maps link", licensed_states: "Licensed states",
  coil_desc: "Coil sentence", fab_desc: "Fabrication sentence", colors: "Colors", abilities: "Abilities",
  accepts_orders: "Takes orders through RoofCoil", order_email: "Order email",
};
const fmtVal = (v: unknown) => Array.isArray(v) ? (v.length ? v.join(", ") : "(none)") : v === true ? "yes" : v === false ? "no" : (v == null || v === "" ? "(cleared)" : String(v));

async function application(record: Record<string, any>) {
  const company = record?.company || "Unknown company";
  const details = record?.details ?? {};
  const abilities: string[] = record?.panel_types ?? details?.abilities ?? [];
  const extras = [...(details?.extra_profiles ?? []), ...(details?.extra_gutters ?? [])];

  const subject = `Get Listed application — ${company}`;
  const body = [
    `New Get Listed application on roofcoil.com`,
    ``,
    `Company: ${company}`,
    `Contact: ${record?.contact_name || "—"}`,
    `Phone: ${record?.phone || "—"}`,
    `Email: ${record?.email || "—"}`,
    `Website: ${record?.website || "—"}`,
    `Plants: ${record?.plants || "—"}`,
    `Service area: ${details?.service_area || "—"}`,
    ``,
    `Abilities (${abilities.length}): ${abilities.join(", ") || "—"}`,
    extras.length ? `⚠ Requested NEW profiles (need approval): ${extras.join(", ")}` : null,
    record?.notes ? `Notes: ${record.notes}` : null,
    ``,
    `Review, approve, or deny it here:`,
    `${SITE}/directory-admin.html`,
  ].filter((l) => l !== null).join("\n");

  const to = (await setting("LISTING_ALERT_TO")) ?? "orders@roofcoil.com";
  console.log("listing-alert application", company, await sendMail(to, subject, body));
}

async function listingLive(record: Record<string, any>) {
  const to = isEmail(record?.owner_email) ? record.owner_email : isEmail(record?.applicant_email) ? record.applicant_email : null;
  const name = record?.name || "your shop";
  if (!to) { console.log("listing-alert listing_live: no email for", name); return; }
  const linked = isEmail(record?.owner_email);
  const subject = `${name} is live on RoofCoil.com`;
  const body = [
    `Good news — ${name} is now published on the RoofCoil.com supplier directory.`,
    ``,
    `See your listing: ${SITE}/suppliers.html`,
    ``,
    linked
      ? `Keep it current: sign in at ${SITE}/manage-listing.html with this email to propose changes — we review them, usually within a business day.`
      : `Keep it current: create a free RoofCoil account with this email address (Sign in / Sign up on any page), then reply to this email and we'll link the listing to it so you can propose changes at ${SITE}/manage-listing.html.`,
    ``,
    record?.accepts_orders
      ? `Ordering is switched on: orders placed for your shop in the Panel & Trim app go to your order email, and you can work them on your own Shop Floor at https://shop.roofcoil.com/.`
      : `Want to take orders through RoofCoil? Contractors can send trim, panel and 3D-part orders straight to your shop from the Panel & Trim app. Reply to this email or switch it on from Manage your listing and we'll set it up.`,
    ``,
    `Questions? Reply here or call ${PHONE}.`,
    ``,
    `RoofCoil.com · Fortified Metals · ${PHONE}`,
  ].join("\n");
  console.log("listing-alert listing_live", name, await sendMail(to, subject, body));
}

async function editDecided(record: Record<string, any>) {
  const to = isEmail(record?.email) ? record.email : null;
  const name = record?.listing_name || "your listing";
  if (!to) { console.log("listing-alert edit_decided: no email for", name); return; }
  const applied = record?.status === "applied";
  const proposed = (record?.proposed && typeof record.proposed === "object") ? record.proposed as Record<string, unknown> : {};
  const lines = Object.entries(proposed).map(([k, v]) => `- ${FIELD_LABELS[k] || k}: ${fmtVal(v)}`);
  const subject = applied ? `Your update to ${name} is live` : `About your update to ${name}`;
  const body = [
    applied
      ? `The change you proposed for ${name} has been applied and is live on the RoofCoil.com directory.`
      : `The change you proposed for ${name} was not applied. If you think that's a mistake, reply to this email or call ${PHONE} and we'll sort it out.`,
    ``,
    ...(lines.length ? [`What you proposed:`, ...lines, ``] : []),
    record?.note ? `Your note: ${record.note}\n` : null,
    `Manage your listing: ${SITE}/manage-listing.html`,
    ``,
    `RoofCoil.com · Fortified Metals · ${PHONE}`,
  ].filter((l) => l !== null).join("\n");
  console.log("listing-alert edit_decided", name, record?.status, await sendMail(to, subject, body));
}

async function process(kind: string, record: Record<string, any>) {
  try {
    if (kind === "listing_live") await listingLive(record);
    else if (kind === "edit_decided") await editDecided(record);
    else await application(record);
  } catch (e) {
    console.error("listing-alert failed", kind, e);
  }
}

Deno.serve(async (req: Request) => {
  const expected = await setting("ALERT_SECRET");
  if (!expected || req.headers.get("x-alert-secret") !== expected) {
    return new Response("forbidden", { status: 403 });
  }
  let payload: Record<string, any>;
  try { payload = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
  EdgeRuntime.waitUntil(process(String(payload?.kind || "application"), payload?.record ?? {}));
  return new Response("accepted", { status: 202 });
});
