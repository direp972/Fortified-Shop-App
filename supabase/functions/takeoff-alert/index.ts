// takeoff-alert: called by the takeoff_flagged_alert trigger (pg_net) when a run of the
// takeoff tool (takeoff.roofcoil.com) is flagged: a report format with no purpose-built
// reader, a rejection or error, or accuracy checks that did not all pass. Emails the
// RoofCoil desk who uploaded what, what went wrong, and the file itself (attached when
// small enough, plus a 7-day download link) so the format can be taught to the tool.
// The trigger sends at most one alert per person, file and reason per day (a run that has
// the file is never held back by an earlier one that didn't), on at most 10 files per
// person per day. What was sent is recorded in takeoff_runs.alert.
//
// Auth: x-alert-secret header, the same shared secret as order-alert and listing-alert
// (verify_jwt is off because pg_net cannot mint JWTs).
// Settings come from the function's environment first, then Vault via public.get_secret:
//   ALERT_SECRET, RESEND_API_KEY, ALERT_EMAIL_FROM  (shared with the other alerts)
//   TAKEOFF_ALERT_TO  - default orders@roofcoil.com
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const BUCKET = "takeoff-uploads";
const ATTACH_MAX_BYTES = 15 * 1024 * 1024;
const LINK_SECONDS = 7 * 24 * 3600;
const DEFAULT_TO = "orders@roofcoil.com";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function setting(name: string): Promise<string | undefined> {
  const env = Deno.env.get(name);
  if (env) return env;
  const { data, error } = await sb.rpc("get_secret", { secret_name: name });
  if (error) { console.error("get_secret", name, error.message); return undefined; }
  return typeof data === "string" && data ? data : undefined;
}

const REASON: Record<string, string> = {
  unsupported: "Report format the tool can't read yet",
  rejected: "Rejected by the tool",
  error: "The tool hit an error",
  no_reader: "Read without a purpose-built reader",
  checks_failed: "Accuracy checks didn't all pass",
};

const central = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) + " Central";

type Run = Record<string, any>;

async function who(run: Run) {
  let name = "";
  let phone = "";
  const { data: u } = await sb.auth.admin.getUserById(run.user_id);
  const meta = (u?.user?.user_metadata ?? {}) as Record<string, string>;
  name = meta.name || meta.full_name || "";
  // the account's own email first: the run's email column is written by the user's own
  // session, so it says only what they put there
  const email: string = u?.user?.email || run.email || "";
  if (email) {
    const { data: c } = await sb.from("customers").select("name,phone").eq("email", email).limit(1).maybeSingle();
    name = name || c?.name || "";
    phone = c?.phone || "";
  }
  return { name, phone, email };
}

async function theFile(run: Run) {
  if (!run.upload_path) {
    return {
      attachment: null,
      note: "The file couldn't be saved with this run. If the customer uploads it again, that run's alert will carry it.",
    };
  }
  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(run.upload_path, LINK_SECONDS);
  const link = signed?.signedUrl || "";
  const { data: blob, error } = await sb.storage.from(BUCKET).download(run.upload_path);
  let attachment: { filename: string; content: string } | null = null;
  let note: string;
  if (error || !blob) note = "The file couldn't be found in storage.";
  else if (blob.size > ATTACH_MAX_BYTES) note = "The file is too large to attach, so use the link.";
  else {
    const filename = run.file_name || String(run.upload_path).split("/").pop() || "upload";
    attachment = { filename, content: encodeBase64(new Uint8Array(await blob.arrayBuffer())) };
    note = "The file is attached.";
  }
  if (link) note += `\nDownload link (good for 7 days): ${link}`;
  return { attachment, note };
}

async function handle(reason: string, record: Run) {
  const id = record?.id;
  if (!id) return;
  try {
    const { data: run, error } = await sb.from("takeoff_runs").select("*").eq("id", id).maybeSingle();
    if (error || !run) { console.error("run lookup", error?.message ?? "not found"); return; }

    const person = await who(run);
    const file = await theFile(run);
    const label = REASON[reason] ?? reason;
    const checks = run.checks_total ? `${run.checks_passed ?? 0} of ${run.checks_total} accuracy checks passed` : "";
    const read = [
      run.address ? `Address: ${run.address}` : null,
      run.roof_area_sqft != null ? `Roof area: ${run.roof_area_sqft} sq ft` : null,
      run.facets != null ? `Facets: ${run.facets}` : null,
      run.system ? `Panel system: ${run.system}` : null,
      run.panel_count != null ? `Panels: ${run.panel_count}` : null,
    ].filter(Boolean);

    const subject = `Takeoff flagged: ${label} · ${run.file_name || "upload"} · ${person.name || person.email || "unknown user"}`;
    const text = [
      `A takeoff on takeoff.roofcoil.com was flagged: ${label}.`,
      ``,
      `Who: ${person.name || "(no name)"} <${person.email || "no email"}>${person.phone ? ` · ${person.phone}` : ""}`,
      `When: ${central(run.created_at)}`,
      `File: ${run.file_name || "(no name)"} (detected as ${run.file_type}, read by ${run.parser})`,
      run.error ? `What happened: ${run.error}` : null,
      checks ? `Checks: ${checks}` : null,
      ...(read.length ? [``, `What the tool read:`, ...read] : []),
      ``,
      file.note,
      ``,
      `To teach the tool this format, give the file to Claude Code on the roofcoil-takeoff repo with a note on what went wrong, then let ${person.email || "the customer"} know it's ready.`,
      ``,
      `Run ${run.id}`,
    ].filter((l) => l !== null).join("\n");

    let sent: Record<string, unknown>;
    const key = await setting("RESEND_API_KEY");
    if (!key) sent = { skipped: "RESEND_API_KEY not set" };
    else {
      const to = (await setting("TAKEOFF_ALERT_TO")) ?? DEFAULT_TO;
      const from = (await setting("ALERT_EMAIL_FROM")) ?? "RoofCoil.com <onboarding@resend.dev>";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [to],
          ...(person.email ? { reply_to: person.email } : {}),
          subject,
          text,
          ...(file.attachment ? { attachments: [file.attachment] } : {}),
        }),
      });
      sent = { to, status: res.status, attached: !!file.attachment, body: res.ok ? "sent" : await res.text() };
    }
    console.log("takeoff-alert", id, reason, JSON.stringify(sent));
    await sb.from("takeoff_runs").update({ alert: { reason, at: new Date().toISOString(), ...sent } }).eq("id", id);
  } catch (e) {
    console.error("takeoff-alert failed", e);
  }
}

Deno.serve(async (req: Request) => {
  const expected = await setting("ALERT_SECRET");
  if (!expected || req.headers.get("x-alert-secret") !== expected) {
    return new Response("forbidden", { status: 403 });
  }
  let payload: Record<string, any>;
  try { payload = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
  EdgeRuntime.waitUntil(handle(String(payload?.reason ?? ""), payload?.record ?? {}));
  return new Response("accepted", { status: 202 });
});
