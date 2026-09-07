// listing-alert: called by applications_alert_on_insert (pg_net) when a new
// Get Listed application lands in public.manufacturer_applications. Emails the
// desk so someone goes to the directory admin to approve or deny it.
//
// Auth: shared-secret header matching the DB trigger (pg_net cannot mint JWTs).
// Settings come from the function's environment first, then from Supabase Vault
// through public.get_secret (service role only), so each can be set with one SQL
// statement instead of the dashboard:  select vault.create_secret('value', 'NAME');
//   ALERT_SECRET      — the x-alert-secret value the DB trigger sends (required)
//   RESEND_API_KEY    — required to send (same key as order-alert)
//   LISTING_ALERT_TO  — default orders@roofcoil.com
//   ALERT_EMAIL_FROM  — default onboarding@resend.dev (until domain verified)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

async function process(record: Record<string, any>) {
  try {
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
      `https://www.roofcoil.com/directory-admin.html`,
    ].filter((l) => l !== null).join("\n");

    const key = await setting("RESEND_API_KEY");
    if (!key) { console.log("listing-alert: skipped, RESEND_API_KEY not set —", company); return; }
    const to = (await setting("LISTING_ALERT_TO")) ?? "orders@roofcoil.com";
    const from = (await setting("ALERT_EMAIL_FROM")) ?? "RoofCoil Directory <onboarding@resend.dev>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text: body }),
    });
    console.log("listing-alert", company, res.status, res.ok ? "sent" : await res.text());
  } catch (e) {
    console.error("listing-alert failed", e);
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
