// Sign-up that never sends an email.
//
// Supabase's built-in mailer allows only a couple of confirmation emails an hour, and the
// site requires confirmation before first sign-in — so a burst of sign-ups (a Facebook
// post, say) locks everyone out with "email rate limit exceeded". This function creates
// the account already confirmed with the service-role key (available to Edge Functions
// by default) and returns a real session, in the same shape /auth/v1/token returns, so
// the browser can store it and carry on. No email is sent, so no email limit applies.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Best-effort per-IP throttle (per isolate; enough to blunt a script, not a security boundary).
const hits = new Map<string, number[]>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 12;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (throttled(ip)) return json({ error: "Too many sign-ups from this connection — try again in a few minutes." }, 429);

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

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

  const { error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name, company, phone },
  });
  if (createErr) {
    const m = createErr.message || "";
    if (/already|exists|registered/i.test(m)) return json({ error: "That email already has an account — sign in instead." }, 409);
    console.error("createUser", m);
    return json({ error: "Sign up failed — try a different email." }, 400);
  }

  // Sign the new account in with the ordinary password grant so the browser gets a normal session.
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error: signErr } = await anon.auth.signInWithPassword({ email, password });
  if (signErr || !data.session) {
    console.error("signIn after create", signErr?.message);
    return json({ error: "Account created — now sign in with your email and password." }, 201);
  }
  const s = data.session;
  return json({
    access_token: s.access_token, refresh_token: s.refresh_token, token_type: s.token_type,
    expires_in: s.expires_in, expires_at: s.expires_at, user: s.user,
  });
});
