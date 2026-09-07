// Sign-up that never sends an email.
//
// Supabase's built-in mailer allows only a couple of confirmation emails an hour, and the
// site requires confirmation before first sign-in — so a burst of sign-ups (a Facebook
// post, say) locks everyone out with "email rate limit exceeded". This function creates
// the account already confirmed with the service-role key (available to Edge Functions
// by default) and answers {created:true}. The browser then signs in through the ordinary
// password grant from its own connection, so Supabase's per-IP sign-in limits and captcha
// apply to the visitor, not to this function's shared egress address.
//
// An email that already has an account gets the same {created:true}: the browser's
// sign-in then either succeeds (right password) or fails with the uniform "invalid login"
// message, so this endpoint never reveals which emails are registered. It never touches
// an existing account.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Best-effort brake per isolate: the gateway appends the real client address as the last
// x-forwarded-for entry, so key on that (earlier entries are caller-supplied). Not a
// security boundary — a determined script can still create accounts, as it could with
// /auth/v1/signup — just enough to blunt the casual loop.
const hits = new Map<string, number[]>();
function throttled(req: Request): boolean {
  const xff = (req.headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = req.headers.get("cf-connecting-ip") || xff[xff.length - 1] || "unknown";
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 12;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (throttled(req)) return json({ error: "Too many sign-ups from this connection — try again in a few minutes." }, 429);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim().slice(0, 120);
  const company = String(body.company || "").trim().slice(0, 160);
  const phone = String(body.phone || "").trim().slice(0, 40);

  // Same rules the sign-up form enforces, re-checked here because the form can be bypassed.
  if (!/.+@.+\..+/.test(email) || email.length > 254) return json({ error: "Enter a valid email." }, 400);
  if (password.length < 6 || password.length > 200) return json({ error: "Password needs at least 6 characters." }, 400);
  if (!name) return json({ error: "Name is required." }, 400);
  if (phone.replace(/\D/g, "").length < 10) return json({ error: "A phone number is required so the shop can reach you about orders." }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name, company, phone },
  });
  if (error) {
    const code = (error as { code?: string }).code || "";
    const status = (error as { status?: number }).status || 0;
    if (code === "email_exists" || /already|exists|registered/i.test(error.message || "")) return json({ created: true });
    // 422s are about the request itself (password policy, a failing users trigger) — say what GoTrue said.
    if (status === 422 && error.message) return json({ error: error.message }, 400);
    console.error("createUser", code, error.message);
    return json({ error: "Sign up failed — please try again." }, 400);
  }
  return json({ created: true });
});
