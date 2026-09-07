// signup-email: sign-up that sends its own confirmation email through Resend.
//
// Supabase Auth's built-in mailer allows two confirmation emails an hour, and the site
// requires confirmation before first sign-in, so one busy afternoon locked people out with
// "email rate limit exceeded". This function creates the account unconfirmed with the
// service-role key, asks Supabase Auth for the very same confirmation link its own mailer
// would have sent (auth.admin.generateLink), and sends that link through Resend from the
// verified roofcoil.com domain. Clicking it confirms the account and lands the person back
// on the page they signed up from, signed in, exactly as the standard flow does.
//
// Every address gets the same answer, so this endpoint never reveals who is registered:
//   {sent:true}  — a confirmation link went out, or the address already has a confirmed
//                  account and was emailed "you already have an account" instead
//   {error:"…"}  — the request itself was bad (400) or over the limits (429)
// A sign-up that was never confirmed is only a pending request: signing up again (or the
// "send a new link" button, which knows only email and password) starts it over with a
// fresh link, keeping the name and phone from the first attempt when the new one has none.
//
// Settings (environment first, then Vault through public.get_secret):
//   RESEND_API_KEY     — required
//   SIGNUP_EMAIL_FROM  — default "RoofCoil.com <no-reply@roofcoil.com>"
//
// Limits live in public.signup_requests so they hold across instances: per hour, 3 emails
// to one address, 6 from one connection, 40 overall. Over the limit answers 429 with a
// message that carries the shop's phone number.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const PHONE = "972-944-7963";
const LIMITS = { perEmail: 3, perIp: 6, overall: 40 }; // per hour
// Pages the person may be sent back to after confirming. Anything else lands on the home page.
const ALLOWED_HOSTS = ["roofcoil.com", "www.roofcoil.com", "shop.roofcoil.com", "fortifiedmetals.com", "www.fortifiedmetals.com", "localhost"];
// public/confirm.html in this repo, on the domain Vercel deploys straight from main. It
// exchanges the hashed code for a session on a button press, then sends the person on to
// whichever page they signed up from.
const CONFIRM_PAGE = "https://shop.roofcoil.com/confirm.html";
const BUSY = `We're getting a lot of sign-ups right now — try again in a few minutes, or call ${PHONE} and we'll set you up.`;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// The environment variable if set, otherwise the Vault secret of the same name.
async function setting(name: string): Promise<string | undefined> {
  const env = Deno.env.get(name);
  if (env) return env;
  const { data, error } = await admin.rpc("get_secret", { secret_name: name });
  if (error) { console.error("get_secret", name, error.message); return undefined; }
  return typeof data === "string" && data ? data : undefined;
}

// The gateway appends the real client address as the last x-forwarded-for entry; earlier
// entries are caller-supplied.
function clientIp(req: Request): string {
  const xff = (req.headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  return req.headers.get("cf-connecting-ip") || xff[xff.length - 1] || "unknown";
}

function safeRedirect(raw: unknown): string | undefined {
  try {
    const u = new URL(String(raw || ""));
    const local = u.protocol === "http:" && u.hostname === "localhost";
    if (u.protocol !== "https:" && !local) return undefined;
    if (!ALLOWED_HOSTS.includes(u.hostname)) return undefined;
    u.hash = "";
    return u.toString();
  } catch { return undefined; }
}

const digits = (s: string) => s.replace(/\D/g, "").length;
const mask = (email: string) => email.replace(/^(.).*?(@.*)$/, "$1…$2");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

type Mail = { subject: string; text: string; html: string };

function shell(brand: string, inner: string): string {
  return `<div style="background:#F6F4EE;padding:28px 12px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1C1C1E">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:28px 26px;border:1px solid #E7E2D6">
    <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8A94A6;margin-bottom:14px">${esc(brand)}</div>
    ${inner}
    <div style="margin-top:26px;padding-top:14px;border-top:1px solid #E7E2D6;font-size:12px;color:#8A94A6;line-height:1.5">
      ${esc(brand)} · Fortified Metals · ${PHONE}
    </div>
  </div>
</div>`;
}

function confirmationMail(name: string, link: string, brand: string): Mail {
  const first = (name || "").trim().split(/\s+/)[0] || "";
  const hi = first ? `Hi ${first},` : "Hi,";
  return {
    subject: `Confirm your ${brand} account`,
    text: `${hi}\n\nClick the link below to confirm your email and finish creating your ${brand} account:\n\n${link}\n\nThe link expires in about an hour. If you didn't create an account, you can ignore this email.\n\n${brand} · Fortified Metals · ${PHONE}`,
    html: shell(brand, `
    <h1 style="font-size:22px;margin:0 0 10px;color:#0A2B41">${esc(hi)}</h1>
    <p style="font-size:15px;line-height:1.55;margin:0 0 20px">Click the button below to confirm your email and finish creating your ${esc(brand)} account.</p>
    <p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;background:#D4AF37;color:#0B1E2C;font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border-radius:9px">Confirm my email</a></p>
    <p style="font-size:12.5px;line-height:1.5;color:#4E6273;margin:0 0 6px">If the button doesn't work, copy this link into your browser:</p>
    <p style="font-size:12px;line-height:1.5;word-break:break-all;margin:0 0 18px"><a href="${esc(link)}" style="color:#0F3D5C">${esc(link)}</a></p>
    <p style="font-size:12.5px;line-height:1.5;color:#4E6273;margin:0">The link expires in about an hour. If you didn't create an account, you can ignore this email.</p>`),
  };
}

function existingAccountMail(brand: string, site: string): Mail {
  return {
    subject: `You already have a ${brand} account`,
    text: `Someone — probably you — just tried to create a ${brand} account with this email address, but it already has one.\n\nSign in here with your password: ${site}\n\nIf you signed up with Google, use "Continue with Google". Forgot your password, or wasn't you? Call ${PHONE} and we'll sort it out.\n\n${brand} · Fortified Metals · ${PHONE}`,
    html: shell(brand, `
    <h1 style="font-size:22px;margin:0 0 10px;color:#0A2B41">You already have an account</h1>
    <p style="font-size:15px;line-height:1.55;margin:0 0 20px">Someone, probably you, just tried to create a ${esc(brand)} account with this email address, but it already has one.</p>
    <p style="margin:0 0 20px"><a href="${esc(site)}" style="display:inline-block;background:#0F3D5C;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border-radius:9px">Sign in</a></p>
    <p style="font-size:12.5px;line-height:1.5;color:#4E6273;margin:0">If you signed up with Google, use "Continue with Google". Forgot your password, or wasn't you? Call ${PHONE} and we'll sort it out.</p>`),
  };
}

async function sendMail(to: string, mail: Mail): Promise<void> {
  const key = await setting("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not set");
  const from = (await setting("SIGNUP_EMAIL_FROM")) ?? "RoofCoil.com <no-reply@roofcoil.com>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: mail.subject, text: mail.text, html: mail.html }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

// Emails sent in the last hour to this address, from this connection and overall, in one
// database call. A hiccup is retried once; if it fails again the sign-up goes through,
// since turning a real person away costs more than one extra email from a bot.
async function overLimit(email: string, ip: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await admin.rpc("signup_email_counts", { p_email: email, p_ip: ip });
    if (!error && data) {
      return Number(data.by_email) >= LIMITS.perEmail || Number(data.by_ip) >= LIMITS.perIp || Number(data.total) >= LIMITS.overall;
    }
    console.error("signup_email_counts", attempt, error?.message || "no data");
  }
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim().slice(0, 120);
  const company = String(body.company || "").trim().slice(0, 160);
  const phone = String(body.phone || "").trim().slice(0, 40);
  const resend = body.resend === true;
  const redirectTo = safeRedirect(body.redirectTo);

  // Same rules the sign-up form enforces, re-checked here because the form can be bypassed.
  if (!/.+@.+\..+/.test(email) || email.length > 254) return json({ error: "Enter a valid email." }, 400);
  if (password.length < 6 || password.length > 200) return json({ error: "Password needs at least 6 characters." }, 400);
  if (!resend) {
    if (!name) return json({ error: "Name is required." }, 400);
    if (digits(phone) < 10) return json({ error: "A phone number is required so the shop can reach you about orders." }, 400);
  }

  const ip = clientIp(req);
  if (await overLimit(email, ip)) return json({ error: BUSY }, 429);

  const { data: state, error: stateErr } = await admin.rpc("signup_state", { p_email: email });
  if (stateErr) { console.error("signup_state", stateErr.message); return json({ error: "Sign up failed — please try again." }, 400); }

  const onFortified = !!redirectTo && /fortifiedmetals\.com/.test(redirectTo);
  const brand = onFortified ? "Fortified Metals" : "RoofCoil.com";
  const site = onFortified ? "https://fortifiedmetals.com/app" : "https://www.roofcoil.com";

  let kind: "confirm" | "existing" | "none" = "confirm";
  try {
    if (state?.state === "confirmed") {
      await sendMail(email, existingAccountMail(brand, site));
      kind = "existing";
    } else {
      let data = { name, company, phone };
      if (state?.state === "unconfirmed") {
        const { data: old } = await admin.auth.admin.getUserById(state.id);
        const m = (old?.user?.user_metadata ?? {}) as Record<string, string>;
        data = { name: name || m.name || "", company: company || m.company || "", phone: phone || m.phone || "" };
        const { error: delErr } = await admin.auth.admin.deleteUser(state.id);
        if (delErr) throw delErr;
      } else if (resend) {
        kind = "none"; // nothing to resend for an address with no account; answer like everyone else
      }
      if (kind !== "none") {
        if (!data.name || digits(data.phone) < 10) return json({ error: "Please create your account again with your name and phone number." }, 400);
        const { data: gen, error: genErr } = await admin.auth.admin.generateLink({
          type: "signup", email, password, options: { data, redirectTo },
        });
        if (genErr) {
          // 422s are about the request itself (password policy) — say what Supabase Auth said.
          if ((genErr as { status?: number }).status === 422 && genErr.message) return json({ error: genErr.message }, 400);
          throw genErr;
        }
        // The email links to the site's own confirm page with the hashed code, not to Supabase's
        // /verify URL: mail scanners (Outlook Safe Links and friends) open every link before the
        // person does and would burn the one-time code. The page exchanges the code only when
        // the person presses its button, then sends them on to `next` signed in.
        const tokenHash = gen?.properties?.hashed_token;
        if (!tokenHash) throw new Error("no hashed_token in generateLink response");
        const link = `${CONFIRM_PAGE}?token_hash=${encodeURIComponent(tokenHash)}&type=signup&next=${encodeURIComponent(redirectTo || site)}`;
        await sendMail(email, confirmationMail(data.name, link, brand));
      }
    }
  } catch (e) {
    console.error("signup-email", mask(email), (e as Error).message);
    return json({ error: `We couldn't send the confirmation email just now — try again in a minute, or call ${PHONE}.` }, 400);
  }

  if (kind !== "none") {
    const { error: logErr } = await admin.from("signup_requests").insert({ email, ip, kind: resend ? "resend" : kind });
    if (logErr) console.error("signup_requests insert", logErr.message);
    // Keep the trail short: rows older than two days no longer count for anything.
    if (Math.random() < 0.05) await admin.from("signup_requests").delete().lt("created_at", new Date(Date.now() - 2 * 86400_000).toISOString());
  }
  return json({ sent: true });
});
