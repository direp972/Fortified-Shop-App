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
//   claim         — listing_claim_alert: a signed-in account asked to manage a listing and
//                   its email didn't match the listing's website domain. Emails the desk to
//                   approve or dismiss it in the directory admin.
//   claim_decided — listing_claim_alert: a claim was approved (by the domain match or by
//                   staff) or dismissed. Emails the claimant.
//   shop_invite   — shop_invite_alert: a shop's owner invited an email to run the shop
//                   (public.shop_invites). Emails the address: "create an account with this
//                   email" for a pending invite, "you've been added" when the account existed.
//
// Billing and ownership (Phase 3). Each record carries the shop's name and slug and its
// owners' emails, so nothing is looked up here:
//   billing_started  — shop_subscriptions_alert: a Stripe plan or Featured subscription
//                      started (first trialing or active). Emails the desk.
//   billing_past_due — shop_subscriptions_alert: a plan's card payment failed. Emails the
//                      owners the day ordering stops (14 days of grace).
//   billing_lapsed   — shop_subscriptions_alert: a plan ended and nothing else keeps the
//                      shop taking orders. Emails the owners and the desk.
//   billing_reminder — billing_reminders(), the daily pg_cron job: a pilot or comped plan
//                      ends in 30 or 7 days or has ended (owners and desk), or a failed card
//                      is on day 10 or 14 of its grace (owners).
//   owner_change     — refuse_owner_change / apply_owner_change (set_listing_owner and
//                      decide_listing_claim later): a dated change of a listing's owner was
//                      requested (owners and desk), refused (desk) or applied (the previous
//                      owners and desk).
// Any other kind, or none, is refused with 400 before any work.
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
const APP = "https://shop.roofcoil.com";
// Where a shop's owner sets prices, the order email, and switches ordering on.
const SHOP_SETUP = `Set your prices and switch ordering on at ${APP}/ → Shop Floor → Shop Settings.`;

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
      ? `Ordering is switched on: orders placed for your shop in the Panel & Trim app go to your order email, and you can work them on your own Shop Floor at ${APP}/.`
      : linked
        ? `Want to take orders through RoofCoil? Contractors can send trim, panel and 3D-part orders straight to your shop from the Panel & Trim app, priced at your own price list. ${SHOP_SETUP}`
        : `Want to take orders through RoofCoil? Contractors can send trim, panel and 3D-part orders straight to your shop from the Panel & Trim app. Once the listing is linked to your account, you set your prices and switch ordering on yourself.`,
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

async function claim(record: Record<string, any>) {
  const name = record?.listing_name || "a listing";
  const from = isEmail(record?.email) ? record.email : "someone";
  const subject = `Listing claim — ${name}`;
  const body = [
    `${from} says they run ${name} and wants to manage its RoofCoil.com listing.`,
    ``,
    `Their email address is not at the listing's website domain (${record?.listing_website || "no website on file"}), so it needs a look: check the domain, or call the shop's public number and ask.`,
    record?.note ? `Their note: ${record.note}` : null,
    ``,
    `Approve or dismiss it under Listing claims:`,
    `${SITE}/directory-admin.html`,
  ].filter((l) => l !== null).join("\n");
  const to = (await setting("LISTING_ALERT_TO")) ?? "orders@roofcoil.com";
  console.log("listing-alert claim", name, await sendMail(to, subject, body));
}

async function claimDecided(record: Record<string, any>) {
  const to = isEmail(record?.email) ? record.email : null;
  const name = record?.listing_name || "your listing";
  if (!to) { console.log("listing-alert claim_decided: no email for", name); return; }
  const approved = record?.status === "approved";
  const subject = approved ? `You're now managing ${name} on RoofCoil.com` : `About your claim on ${name}`;
  const body = (approved
    ? [
      `${name} is now linked to this account.`,
      record?.method === "domain"
        ? `Your email address is at the shop's own website domain, so it was linked automatically.`
        : `A RoofCoil staff member approved your claim.`,
      ``,
      `Manage your listing: ${SITE}/manage-listing.html`,
      `Change the phone, website, abilities, colors and the two card sentences there and send them in. We review edits, usually within a business day.`,
      ``,
      `Want to take orders through RoofCoil? ${SHOP_SETUP} Contractors can then send trim, panel and 3D-part orders to your shop from the Panel & Trim app, priced at your own price list.`,
      ``,
      `Questions? Reply here or call ${PHONE}.`,
      ``,
      `RoofCoil.com · Fortified Metals · ${PHONE}`,
    ]
    : [
      `We couldn't link ${name} to this account.`,
      ``,
      `If you do run this shop, reply to this email from a company address or call ${PHONE} and we'll sort it out.`,
      ``,
      `RoofCoil.com · Fortified Metals · ${PHONE}`,
    ]).join("\n");
  console.log("listing-alert claim_decided", name, record?.status, await sendMail(to, subject, body));
}

// An invite to run a shop. The link carries no secret: the invite is accepted by whichever
// account proves it owns this email address through the normal confirmation, so a forwarded
// email gives nobody else anything.
async function shopInvite(record: Record<string, any>) {
  const to = isEmail(record?.email) ? record.email : null;
  const shop = record?.shop_name || "a shop";
  if (!to) { console.log("listing-alert shop_invite: no email for", shop); return; }
  const by = isEmail(record?.invited_by_email) ? record.invited_by_email : "The shop";
  const role = record?.role === "owner" ? "an owner" : "staff";
  const link = `${APP}/${record?.shop_slug ? `?shop=${encodeURIComponent(String(record.shop_slug))}` : ""}`;
  const accepted = record?.status === "accepted";
  const until = record?.expires_at ? new Date(record.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : null;
  const subject = accepted ? `You've been added to ${shop} on RoofCoil` : `${shop} invited you to RoofCoil`;
  const body = (accepted
    ? [
      `${by} added you to ${shop} on RoofCoil.com as ${role}.`,
      ``,
      `Sign in with this email address and you'll find the shop's Shop Floor, Price List and settings:`,
      `${link}#signin`,
      ``,
      `Questions? Reply here or call ${PHONE}.`,
      ``,
      `RoofCoil.com · ${PHONE}`,
    ]
    : [
      `${by} invited you to run ${shop} on RoofCoil.com as ${role}.`,
      ``,
      `Create a free account with this email address (${to}) and the shop is yours to work:`,
      `${link}#signup`,
      ``,
      until ? `The invite is good until ${until}.` : null,
      `Already have a RoofCoil account under a different email? Ask ${by} to invite that address instead.`,
      ``,
      `Questions? Reply here or call ${PHONE}.`,
      ``,
      `RoofCoil.com · ${PHONE}`,
    ]).filter((l) => l !== null).join("\n");
  console.log("listing-alert shop_invite", shop, record?.status, await sendMail(to, subject, body));
}

// A billing or ownership date as the owners read it: Central time, with the year.
function fmtDate(v: unknown): string {
  if (v == null || v === "") return "";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}
const PLAN_NAMES: Record<string, string> = { shop: "Shop", pro: "Pro" };
const planName = (plan: unknown) => PLAN_NAMES[String(plan)] ?? String(plan ?? "plan");
const shopLink = (record: Record<string, any>) => `${APP}/${record?.shop_slug ? `?shop=${encodeURIComponent(String(record.shop_slug))}` : ""}`;
const START_PLAN = `Start a plan at ${APP}/ → Shop Floor → Shop Settings.`;
const FOOTER = `RoofCoil.com · ${PHONE}`;

// One email per owner, so no owner sees the others' addresses.
async function mailOwners(kind: string, name: string, owners: unknown, subject: string, body: string) {
  const list = Array.isArray(owners) ? [...new Set(owners.filter(isEmail))] : [];
  if (!list.length) console.log(`listing-alert ${kind}: no owner email for`, name);
  for (const to of list) console.log(`listing-alert ${kind}`, name, await sendMail(to, subject, body));
}

async function mailDesk(kind: string, name: string, subject: string, body: string) {
  const to = (await setting("LISTING_ALERT_TO")) ?? "orders@roofcoil.com";
  console.log(`listing-alert ${kind} desk`, name, await sendMail(to, subject, body));
}

async function billingStarted(record: Record<string, any>) {
  const shop = record?.shop_name || "Unknown shop";
  const featured = record?.grant_kind === "featured";
  const plan = planName(record?.plan);
  const subject = `Billing started — ${shop} (${featured ? "Featured" : plan})${record?.livemode ? "" : " [test mode]"}`;
  const body = [
    `${shop} started ${featured ? "Featured" : `the ${plan} plan`} through Stripe.`,
    ``,
    `Status: ${record?.status || "—"}`,
    record?.trial_end ? `Trial ends: ${fmtDate(record.trial_end)}` : null,
    record?.current_period_end ? `Period ends: ${fmtDate(record.current_period_end)}` : null,
    record?.coupon ? `Coupon: ${record.coupon}` : null,
    ``,
    `Directory admin: ${SITE}/directory-admin.html`,
  ].filter((l) => l !== null).join("\n");
  await mailDesk("billing_started", shop, subject, body);
}

// Plan rows only (the trigger never sends Featured): orders continue through the grace.
async function billingPastDue(record: Record<string, any>) {
  const shop = record?.shop_name || "Your shop";
  const until = fmtDate(record?.grace_until) || "14 days after the payment failed";
  const subject = `${shop}: card payment failed`;
  const body = [
    `Your card payment failed. Ordering continues until ${until}; update your card in Shop Floor → Shop Settings.`,
    ``,
    shopLink(record),
    ``,
    FOOTER,
  ].join("\n");
  await mailOwners("billing_past_due", shop, record?.owner_emails, subject, body);
}

async function billingLapsed(record: Record<string, any>) {
  const shop = record?.shop_name || "Your shop";
  const subject = `${shop}: ordering through RoofCoil is paused`;
  const body = [
    `Ordering through RoofCoil is paused because your plan ended. Your listing is still in the directory, and your prices, customers and orders are kept. ${START_PLAN}`,
    ``,
    FOOTER,
  ].join("\n");
  await mailOwners("billing_lapsed", shop, record?.owner_emails, subject, body);
  await mailDesk("billing_lapsed", shop, `Desk copy: ${subject}`, body);
}

// billing_reminders() sends each (grant, notice) once and says in `desk` whether the desk
// gets a copy (the pilot and comp notices).
async function billingReminder(record: Record<string, any>) {
  const shop = record?.shop_name || "Your shop";
  const notice = String(record?.notice || "");
  const pilot = record?.source === "pilot";
  const what = pilot ? "pilot" : "comped plan";
  // Every dated pilot says "(founding rate)", as the plan card's pilot line does (design §3.2, §8).
  const founding = pilot || record?.offer === "founding" ? " (founding rate)" : "";
  // A pilot is the shop's trial; a comp doesn't use the trial up (design §5.2).
  const noTrial = pilot ? " After that date a plan starts without a trial." : "";
  const ends = fmtDate(record?.ends_at);
  const until = fmtDate(record?.grace_until) || "14 days after the payment failed";
  let subject: string;
  let lines: string[];
  if (notice === "ends_30" || notice === "ends_7") {
    subject = `${shop}: your RoofCoil ${what} ends ${ends}`;
    lines = [
      `Your RoofCoil ${what} ends on ${ends}. Start a plan before then to keep taking orders without a gap${founding}; your first charge is on ${ends}.${noTrial}`,
      ``,
      `Start one at ${APP}/ → Shop Floor → Shop Settings.`,
    ];
  } else if (notice === "ended") {
    subject = `${shop}: your RoofCoil ${what} has ended`;
    lines = [`Your RoofCoil ${what} ended on ${ends}, so ordering through RoofCoil is paused. Your listing is still in the directory, and your prices, customers and orders are kept. ${START_PLAN}`];
  } else if (notice === "grace_10") {
    subject = `${shop}: card payment still failing`;
    lines = [`Your card payment for RoofCoil is still failing. Ordering continues until ${until}; update your card in Shop Floor → Shop Settings.`];
  } else if (notice === "grace_14") {
    subject = `${shop}: payment overdue — ordering paused`;
    lines = [`Your card payment for RoofCoil is overdue, so ordering through RoofCoil is paused. Update your card in Shop Floor → Shop Settings and ordering resumes as soon as the payment goes through.`];
  } else {
    console.log("listing-alert billing_reminder: unknown notice", notice, shop);
    return;
  }
  const body = [...lines, ``, FOOTER].join("\n");
  await mailOwners(`billing_reminder ${notice}`, shop, record?.owner_emails, subject, body);
  if (record?.desk === true) await mailDesk(`billing_reminder ${notice}`, shop, `Desk copy: ${subject}`, body);
}

// A dated change of a listing's owner (design §9.4): requested (sent by M3's functions),
// refused by a current owner, or applied by a platform admin after the 7-day notice.
async function ownerChange(record: Record<string, any>) {
  const listing = record?.listing_name || "the listing";
  const event = String(record?.event || "");
  const toEmail = record?.to_email ? String(record.to_email) : "";
  if (event === "pending") {
    const subject = `Ownership change requested for ${listing}`;
    const body = [
      `A RoofCoil platform admin asked to change who owns ${listing} on RoofCoil.com${toEmail ? ` to ${toEmail}` : " (removing the owner)"}. It takes effect on ${fmtDate(record?.effective_at)} unless a current owner refuses it. To refuse, sign in at ${SITE}/manage-listing.html or open Shop Floor → Shop Settings at ${APP}/.`,
      ``,
      `Questions? Reply here or call ${PHONE}.`,
      ``,
      FOOTER,
    ].join("\n");
    await mailOwners("owner_change pending", listing, record?.owner_emails, subject, body);
    await mailDesk("owner_change pending", listing, `Desk copy: ${subject}`, body);
  } else if (event === "refused") {
    const by = isEmail(record?.refused_by_email) ? record.refused_by_email : "A current owner";
    await mailDesk("owner_change refused", listing, `Ownership change refused — ${listing}`,
      `${by} refused the ownership change for ${listing}. Nothing changed.`);
  } else if (event === "applied") {
    const subject = `Ownership of ${listing} changed`;
    const body = [`${listing} on RoofCoil.com is now owned by ${toEmail || "nobody"}, after the 7-day notice.`, ``, FOOTER].join("\n");
    await mailOwners("owner_change applied", listing, record?.previous_owner_emails, subject, body);
    await mailDesk("owner_change applied", listing, `Desk copy: ${subject}`, body);
  } else {
    console.log("listing-alert owner_change: unknown event", event, listing);
  }
}

const HANDLERS: Record<string, (record: Record<string, any>) => Promise<void>> = {
  application,
  listing_live: listingLive,
  edit_decided: editDecided,
  claim,
  claim_decided: claimDecided,
  shop_invite: shopInvite,
  billing_started: billingStarted,
  billing_past_due: billingPastDue,
  billing_lapsed: billingLapsed,
  billing_reminder: billingReminder,
  owner_change: ownerChange,
};

async function process(kind: string, record: Record<string, any>) {
  try {
    await HANDLERS[kind](record);
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
  // Every trigger names its kind; anything else is refused here, before any work, instead
  // of falling through to the desk as an "application" (design §6.3).
  const kind = typeof payload?.kind === "string" ? payload.kind : "";
  if (!Object.hasOwn(HANDLERS, kind)) return new Response("unknown kind", { status: 400 });
  EdgeRuntime.waitUntil(process(kind, payload?.record ?? {}));
  return new Response("accepted", { status: 202 });
});
