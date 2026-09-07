// signup-email: sign-up that sends its own confirmation email through Resend.
//
// Supabase Auth's built-in mailer allows two confirmation emails an hour, and the site
// requires confirmation before first sign-in, so one busy afternoon locked people out with
// "email rate limit exceeded". This function creates the account unconfirmed with the
// service-role key, asks Supabase Auth for the confirmation code its own mailer would have
// sent (auth.admin.generateLink), and emails a link through Resend from the verified
// roofcoil.com domain. The link opens public/confirm.html, which exchanges the code for a
// session on a button press and lands the person back on the page they signed up from.
//
// Every address gets the same answer and roughly the same work, so this endpoint never
// reveals who is registered:
//   {sent:true}  — a confirmation link went out; or the address already has a confirmed
//                  account and was emailed "you already have an account"; or a "send a new
//                  link" request named an address with no account and was emailed that
//   {error:"…"}  — the request itself was bad (400) or over the limits (429)
// An account that was never confirmed is only a pending request. Signing up again, or the
// "send a new link" button (which knows only email and password), gets it a fresh code;
// its password and details are never changed by a request that hasn't proven it owns the
// inbox, so nobody can take over a pending account by asking for a link.
//
// Settings (environment first, then Vault through public.get_secret):
//   RESEND_API_KEY     — required
//   SIGNUP_EMAIL_FROM  — default "<brand> <no-reply@roofcoil.com>"
//
// Limits: every request, accepted or not, takes a slot in public.signup_requests inside one
// locked statement before anything else happens, so bursts can't slip under them and a
// caller that keeps asking locks itself out. Per hour: 3 requests for one inbox (plus-tags
// and Gmail dots count as the same inbox), 5 from one connection, 30 overall; 80 a day
// overall, well under the Resend quota that order alerts share. Over a limit answers 429
// with a message that carries the shop's phone number. A CAPTCHA in front of the forms
// would stop a distributed bot at the source; these limits only bound the damage.
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
const LIMITS = { perInbox: 3, perIp: 5, perHour: 30, perDay: 80 };
// Pages the person may be sent back to after confirming. Anything else lands on the home page.
const ALLOWED_HOSTS = ["roofcoil.com", "www.roofcoil.com", "shop.roofcoil.com", "fortifiedmetals.com", "www.fortifiedmetals.com", "localhost"];
// public/confirm.html in this repo, on the domain Vercel deploys straight from main. It
// exchanges the hashed code for a session on a button press, then sends the person on to
// whichever page they signed up from. Ship the page before pointing emails at it.
const CONFIRM_PAGE = "https://shop.roofcoil.com/confirm.html";
const BUSY = `We're getting a lot of sign-ups right now — try again in a few minutes, or call ${PHONE} and we'll set you up.`;
const INBOX_BUSY = `We've already sent ${LIMITS.perInbox} emails to that address in the last hour — check your spam folder, or call ${PHONE} and we'll set you up.`;

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
    if (/\/confirm\.html$/i.test(u.pathname)) return undefined;
    u.hash = "";
    return u.toString();
  } catch { return undefined; }
}

// The address as one inbox, for the limits: a plus-tag or, on Gmail, dots don't make a new one.
function inboxKey(email: string): string {
  const at = email.lastIndexOf("@");
  const domain = email.slice(at + 1);
  let local = email.slice(0, at).split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

const digits = (s: string) => s.replace(/\D/g, "").length;
const mask = (email: string) => email.replace(/^(.).*?(@.*)$/, "$1…$2");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
// Only a plain first name reaches the email: a caller can type anything into the form, and
// the message is signed for roofcoil.com, so nothing that looks like a link or a pitch may ride along.
function greeting(name: string): string {
  const first = (name || "").trim().split(/\s+/)[0] || "";
  const clean = first.replace(/[^\p{L}\p{M}'’.-]/gu, "").slice(0, 30);
  return clean ? `Hi ${clean},` : "Hi there,";
}
const footer = (brand: string) => brand === "Fortified Metals" ? `Fortified Metals · ${PHONE}` : `${brand} · Fortified Metals · ${PHONE}`;

type Mail = { subject: string; text: string; html: string };

function shell(brand: string, inner: string): string {
  return `<div style="background:#F6F4EE;padding:28px 12px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1C1C1E">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:28px 26px;border:1px solid #E7E2D6">
    <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8A94A6;margin-bottom:14px">${esc(brand)}</div>
    ${inner}
    <div style="margin-top:26px;padding-top:14px;border-top:1px solid #E7E2D6;font-size:12px;color:#8A94A6;line-height:1.5">
      ${esc(footer(brand))}
    </div>
  </div>
</div>`;
}
const button = (href: string, label: string, bg: string, fg: string) =>
  `<p style="margin:0 0 20px"><a href="${esc(href)}" style="display:inline-block;background:${bg};color:${fg};font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border-radius:9px">${esc(label)}</a></p>`;
const small = (text: string) => `<p style="font-size:12.5px;line-height:1.5;color:#4E6273;margin:0 0 6px">${esc(text)}</p>`;

function confirmationMail(name: string, link: string, brand: string, note: string): Mail {
  const hi = greeting(name);
  const tail = `The link expires in about an hour. If you didn't create an account, you can ignore this email.`;
  return {
    subject: `Confirm your ${brand} account`,
    text: `${hi}\n\nClick the link below to confirm your email and finish creating your ${brand} account:\n\n${link}\n\n${note ? note + "\n\n" : ""}${tail}\n\n${footer(brand)}`,
    html: shell(brand, `
    <h1 style="font-size:22px;margin:0 0 10px;color:#0A2B41">${esc(hi)}</h1>
    <p style="font-size:15px;line-height:1.55;margin:0 0 20px">Click the button below to confirm your email and finish creating your ${esc(brand)} account.</p>
    ${button(link, "Confirm my email", "#D4AF37", "#0B1E2C")}
    ${small("If the button doesn't work, copy this link into your browser:")}
    <p style="font-size:12px;line-height:1.5;word-break:break-all;margin:0 0 18px"><a href="${esc(link)}" style="color:#0F3D5C">${esc(link)}</a></p>
    ${note ? small(note) : ""}
    ${small(tail)}`),
  };
}

function existingAccountMail(brand: string, signIn: string): Mail {
  const help = `If you signed up with Google, use "Continue with Google". Forgot your password, or wasn't you? Call ${PHONE} and we'll sort it out.`;
  return {
    subject: `You already have a ${brand} account`,
    text: `Someone — probably you — just tried to create a ${brand} account with this email address, but it already has one.\n\nSign in here with your password: ${signIn}\n\n${help}\n\n${footer(brand)}`,
    html: shell(brand, `
    <h1 style="font-size:22px;margin:0 0 10px;color:#0A2B41">You already have an account</h1>
    <p style="font-size:15px;line-height:1.55;margin:0 0 20px">Someone, probably you, just tried to create a ${esc(brand)} account with this email address, but it already has one.</p>
    ${button(signIn, "Sign in", "#0F3D5C", "#fff")}
    ${small(help)}`),
  };
}

function noAccountMail(brand: string, signUp: string): Mail {
  const help = `If that wasn't you, you can ignore this email. Questions? Call ${PHONE}.`;
  return {
    subject: `No ${brand} account for this email yet`,
    text: `Someone — probably you — asked us to resend a sign-in link for this email address, but it doesn't have a ${brand} account yet.\n\nCreate one here: ${signUp}\n\n${help}\n\n${footer(brand)}`,
    html: shell(brand, `
    <h1 style="font-size:22px;margin:0 0 10px;color:#0A2B41">No account for this email yet</h1>
    <p style="font-size:15px;line-height:1.55;margin:0 0 20px">Someone, probably you, asked us to resend a sign-in link for this email address, but it doesn't have a ${esc(brand)} account yet.</p>
    ${button(signUp, "Create an account", "#D4AF37", "#0B1E2C")}
    ${small(help)}`),
  };
}

async function sendMail(to: string, mail: Mail, brand: string): Promise<void> {
  const key = await setting("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not set");
  const from = (await setting("SIGNUP_EMAIL_FROM")) ?? `${brand} <no-reply@roofcoil.com>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: mail.subject, text: mail.text, html: mail.html }),
  });
  if (!res.ok) {
    const err = new Error(`resend ${res.status}: ${await res.text()}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
}

// Takes this request's slot and reads the counts, including it, in one locked database
// call. The row stays whatever happens next, so retries and rejected requests count too.
// A hiccup is retried once; if it fails again the sign-up goes through, since turning a
// real person away costs more than one extra email from a bot.
async function reserve(inbox: string, ip: string): Promise<{ id: number | null; over: "inbox" | "load" | null }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await admin.rpc("signup_request_reserve", { p_email: inbox, p_ip: ip });
    if (!error && data) {
      const over = Number(data.by_email) > LIMITS.perInbox ? "inbox"
        : (Number(data.by_ip) > LIMITS.perIp || Number(data.total) > LIMITS.perHour || Number(data.day) > LIMITS.perDay) ? "load"
        : null;
      return { id: Number(data.id), over };
    }
    console.error("signup_request_reserve", attempt, error?.message || "no data");
  }
  return { id: null, over: null };
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

  const slot = await reserve(inboxKey(email), clientIp(req));
  if (slot.over) return json({ error: slot.over === "inbox" ? INBOX_BUSY : BUSY }, 429);

  const { data: state, error: stateErr } = await admin.rpc("signup_state", { p_email: email });
  if (stateErr) { console.error("signup_state", stateErr.message); return json({ error: "Sign up failed — please try again." }, 400); }

  const onFortified = !!redirectTo && /fortifiedmetals\.com/.test(redirectTo);
  const brand = onFortified ? "Fortified Metals" : "RoofCoil.com";
  const home = onFortified ? "https://fortifiedmetals.com/app" : "https://www.roofcoil.com/";
  // Where the emails' buttons point: the page the person came from, with a marker that
  // public/auth.js turns into an open sign-in or sign-up box.
  const signIn = (redirectTo || home) + "#signin";
  const signUp = (redirectTo || home) + "#signup";

  let kind: "confirm" | "existing" | "none" = "confirm";
  try {
    if (state?.state === "confirmed") {
      await sendMail(email, existingAccountMail(brand, signIn), brand);
      kind = "existing";
    } else if (state?.state !== "unconfirmed" && resend) {
      await sendMail(email, noAccountMail(brand, signUp), brand);
      kind = "none";
    } else {
      // For a pending account Supabase Auth issues a fresh code and leaves the password as it
      // was; its own name and phone win over anything sent now, so a stranger asking for a
      // link can neither take the account over nor rewrite its details.
      let data = { name, company, phone };
      let note = "";
      if (state?.state === "unconfirmed") {
        const { data: old } = await admin.auth.admin.getUserById(state.id);
        const m = (old?.user?.user_metadata ?? {}) as Record<string, string>;
        data = { name: m.name || name, company: m.company || company, phone: m.phone || phone };
        note = "This confirms the account you created earlier. Your password is the one you chose then.";
      }
      const { data: gen, error: genErr } = await admin.auth.admin.generateLink({
        type: "signup", email, password, options: { data, redirectTo },
      });
      if (genErr) {
        const code = (genErr as { code?: string }).code || "";
        if (code === "email_exists" || /already been registered/i.test(genErr.message || "")) {
          // Confirmed between the state check and now: same outcome as the confirmed branch.
          await sendMail(email, existingAccountMail(brand, signIn), brand);
          kind = "existing";
        } else if ((genErr as { status?: number }).status === 422 && genErr.message) {
          // Other 422s are about the request itself (password policy) — say what Supabase Auth said.
          return json({ error: genErr.message }, 400);
        } else {
          throw genErr;
        }
      } else {
        // The email links to the site's own confirm page with the hashed code, not to Supabase's
        // /verify URL: mail scanners (Outlook Safe Links and friends) open every link before the
        // person does and would burn the one-time code. The page exchanges the code only when
        // the person presses its button, then sends them on to `next` signed in.
        const tokenHash = gen?.properties?.hashed_token;
        if (!tokenHash) throw new Error("no hashed_token in generateLink response");
        const link = `${CONFIRM_PAGE}?token_hash=${encodeURIComponent(tokenHash)}&type=signup&next=${encodeURIComponent(redirectTo || home)}`;
        await sendMail(email, confirmationMail(data.name, link, brand, note), brand);
      }
    }
  } catch (e) {
    console.error("signup-email", mask(email), (e as Error).message);
    // Resend saying "too many" is the same story as our own limits.
    if ((e as { status?: number }).status === 429) return json({ error: BUSY }, 429);
    return json({ error: `We couldn't send the email just now — try again in a minute, or call ${PHONE}.` }, 400);
  }

  if (slot.id) {
    const { error: logErr } = await admin.from("signup_requests").update({ kind: resend ? "resend" : kind }).eq("id", slot.id);
    if (logErr) console.error("signup_requests update", logErr.message);
  }
  // Keep the trail short: rows older than two days no longer count for anything.
  if (Math.random() < 0.05) await admin.from("signup_requests").delete().lt("created_at", new Date(Date.now() - 2 * 86400_000).toISOString());
  return json({ sent: true });
});
