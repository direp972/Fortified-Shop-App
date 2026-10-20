# Fortified Sheet Metal — Shop Order Portal

Standalone version of the app with real login accounts and staff-assigned customer
pricing tiers — independent of Claude.ai's artifact environment.

## What changed from the Claude artifact version

Same app, same tools, same everything — but now:
- People have to **sign in** to use it (no more open-to-anyone link)
- Every new signup gets a real account, defaulting to **Tier 2 (retail)** pricing
- **You** assign each customer's real tier (Tier 1, Greenleaf, or Tier 2) from a new
  **Customer Pricing Tiers** panel in Price List → Backend
- Customers only ever see *their own* assigned pricing — no tier switcher, no way to
  see other tiers
- **Shop Floor** and **Backend Pricing** are staff-only. Regular customers can't see
  internal costs, margins, or other people's orders.
- **Shops that take orders through RoofCoil** get their own Shop Floor: switch ordering on
  for their directory listing and every order sent to them is emailed to the shop and shows
  up for the listing's owner account (see *Shops that take orders* below).

## One-time setup (about 20 minutes)

### 1. Create a Supabase project (free)
1. Go to [supabase.com](https://supabase.com) and sign up / log in.
2. Click **New Project**. Pick any name and a database password (save it somewhere).
3. Wait ~2 minutes for the project to finish provisioning.

### 2. Turn on email sign-up
1. In Supabase, go to **Authentication** in the left sidebar.
2. Under **Providers**, confirm **Email** is enabled (it is by default).
3. If you don't want the "confirm your email" step slowing down testing, go to
   **Authentication > Settings** and temporarily disable "Confirm email" — just remember
   to turn it back on before this goes live with real customers.

### 3. Create the database tables
1. Open **SQL Editor** in the left sidebar, click **New query**.
2. Open `supabase-setup.sql` (included in this folder), copy **everything above the
   "ONE-TIME MANUAL STEP" section**, paste it in, and click **Run**.
3. You should see "Success. No rows returned."

### 4. Get your API keys
1. Go to **Project Settings** (gear icon) > **API**.
2. Copy the **Project URL** and the **anon public** key.

### 5. Configure the app
1. Copy `.env.example` to a new file named `.env`.
2. Paste in your Project URL and anon key.

### 6. Test it locally
```
npm install
npm run dev
```
Open the URL it gives you (usually `http://localhost:5173`).

### 7. Make yourself a staff member
1. On the app, **sign up** for an account using your own email — this is a real account,
   the same as any customer would create.
2. Back in Supabase's **SQL Editor**, run the one-time statement at the bottom of
   `supabase-setup.sql` with your email filled in:
   ```sql
   insert into staff (id)
   select id from auth.users where email = 'you@example.com';
   ```
3. Sign out and back in on the app. You should now see the **Shop Floor** tab and
   **Backend (Edit)** inside Price List.

Repeat step 7 (with a coworker's email, after they sign up) for anyone else on your
team who needs staff access.

### 8. Assign your first customer a tier
1. Have a customer sign up (or sign up again yourself with a second email to test).
2. As staff, go to **Price List → Backend (Edit)**. You'll see them listed under
   **Customer Pricing Tiers** with a dropdown — set it to Tier 1, Greenleaf, or Tier 2.
3. That customer will now see their assigned pricing automatically the next time they
   open Price List — no tier picker, no way to see anyone else's pricing.

### 9. Deploy it live

**Option A — Vercel (recommended, free tier):**
1. Push this folder to a GitHub repo (or use Vercel's drag-and-drop deploy).
2. Go to [vercel.com](https://vercel.com), sign up, click **Add New Project**, import your repo.
3. Add your two environment variables under **Settings > Environment Variables**.
4. Optional: add `ANTHROPIC_API_KEY` there too. It powers **Scan a Sketch** in the trim
   drawing tool (the `api/scan-sketch.js` function reads it server-side — the key never
   reaches the browser). Without it, the button explains that scanning isn't set up yet.
5. Click **Deploy**.

**Option B — Netlify:**
1. Run `npm run build` — creates a `dist` folder.
2. Drag the `dist` folder onto Netlify's deploy page.
3. Add the same two environment variables, then redeploy so the build picks them up.

### 10. Turn on email (order alerts, Get Listed alerts)

The shop is emailed about every new order (`order-alert`) and every Get Listed
application (`listing-alert`) through [Resend](https://resend.com). Both Edge Functions
(source under `supabase/functions/`) read their settings from Supabase Vault, so nothing
has to be typed into the dashboard's secrets page. Open **SQL Editor** and run, with
your Resend API key in place of the placeholder:

```sql
select vault.create_secret('re_your_key_here', 'RESEND_API_KEY');
```

Optional settings are stored the same way: `ALERT_EMAIL_TO` (default
sales@fortifiedmetals.com), `LISTING_ALERT_TO` (default orders@roofcoil.com) and
`ALERT_EMAIL_FROM` (default onboarding@resend.dev, which Resend only delivers to the
address on your own Resend account — verify your domain in Resend, then set this to
something like `Fortified Metals Orders <orders@fortifiedmetals.com>`).

To rotate a key, update the existing secret rather than creating a second one with the
same name:

```sql
select vault.update_secret((select id from vault.secrets where name = 'RESEND_API_KEY'), 're_new_key_here');
```

**Password reset** goes through the same function: **Forgot password?** on either sign-in
form posts `{email, reset:true}`, and the email links to `public/reset.html`, where the
person types a new password and lands back signed in. A pending (never confirmed) account
gets a fresh confirmation link to the same page instead, so a forgotten first password is
no longer a dead end. Every address gets the same answer, so the form can't be used to find
out who is registered.

**Sign-up confirmation emails** go through the same key. Supabase Auth's own mailer is
capped at two emails an hour, so the `signup-email` Edge Function creates each account
unconfirmed, asks Supabase Auth for its confirmation code, and emails a link itself
through Resend from `no-reply@roofcoil.com` (change the sender with a Vault secret named
`SIGNUP_EMAIL_FROM`). The link opens `public/confirm.html` on shop.roofcoil.com, where one
button press exchanges the code for a session and sends the person back to the page they
started from, signed in. The page exists because mail scanners such as Outlook Safe Links
open links before the person does and would burn a one-time code. Both sign-up forms (the site modal in `public/auth.js` and
the drawing app) use it, and a sign-in that fails with "not confirmed" offers a
**Send a new link** button. To keep bots from burning through the Resend quota, every
request takes a slot in `public.signup_requests` before anything else happens, and the
function allows 3 requests an hour for one inbox, 5 an hour from one connection, 30 an
hour and 80 a day overall (`LIMITS` at the top of the function). A pending account keeps
its password and details until its owner confirms, so asking for a link can never take one
over. When the function is redeployed, ship `public/confirm.html` first: every email links
to it. A CAPTCHA in front of the forms is the next step if bots ever become a problem.

## Shops that take orders

Any directory listing can take orders from the Panel & Trim app:

1. In **Directory admin → editor**, tap **Takes orders from RoofCoil.com** and fill in the
   **Order email** (a shop can also propose both from `/manage-listing.html`; you apply the
   edit like any other). Link the shop's account under **Owner account** so they get a
   Shop Floor.
2. The app's order form shows **Send this order to** with every shop that has ordering on
   (with one shop it just says where the order goes). `?shop=<listing id>` on the app URL
   preselects a shop, which is how a shop can link to the tools from its own site later.
3. Every order carries `orders.shop_id`. The `order-alert` function emails that shop's order
   email (the Fortified desk when there is no shop or no order email), and the customer
   gets a confirmation with the shop's name and phone. The listing's owner account sees only
   the orders sent to their shop on **Shop Floor** and can move them through the statuses;
   the Master Materials List stays staff-only.
4. When a listing goes live, the shop is emailed that it is published; when a proposed edit
   is applied or dismissed, the person who proposed it is emailed the outcome.
5. The customer is emailed when their job moves to In Production, Ready for Pickup or
   Completed, once per status, with the pieces that reached it and the shop's phone.

Fortified Sheet Metal's own listing has ordering switched on with no order email, so its
orders keep going to `ALERT_EMAIL_TO` and the shop text exactly as before.

## Shops as tenants

Every listing that takes orders is a **shop** on the platform (`public.shops`, same id as
the listing — a database trigger creates it the moment ordering is switched on), and the
listing's owner account is the shop's first **member** (`public.shop_members`, roles
`owner` and `staff`). A shop's people get, for their shop only: Price List → Backend (Edit)
with costs and margins, the coil width scale, saved trim presets, the Master Materials
List, the Customer Pricing Tiers panel and Shop Floor. Everything a shop saves lives in
`public.shop_settings` (one row per shop per key) and its tiers in `public.shop_customers`
(one row per shop per customer; no row means Tier 2), all isolated by RLS — a shop can
never read another shop's prices, costs, presets, board, members or customers. Platform
staff (`public.staff`) keep every power across every shop. Design and the reasoning:
`docs/phase1-tenant-design.md`; the two-shop checklist: `docs/phase1-two-shop-test-plan.md`.

- The app follows one **selected shop**: `?shop=<listing id>` picks it (also a shop whose
  listing is hidden, through `ordering_shop()`), otherwise a member's own shop, otherwise
  the platform's default shop (Fortified). The picker under "Send this order to" changes
  it; the price list, coil scale, presets, the account's tier and the backend all follow.
- `submit-order` reprices against the **order's shop**: that shop's price list and coil
  scale (the code defaults until the shop has saved its own) at the tier that shop gave
  the account. The first order an account sends a shop puts it on that shop's tier panel
  at Tier 2; a shop can also add an account by email before its first order.
- In Customer Pricing Tiers, **Admin** makes an account one of the selected shop's people
  (shop owners and platform staff can tap it); **Platform** (platform staff only) makes it
  a platform admin.
- Fortified Sheet Metal is shop #1 and the default shop: its people are the platform staff,
  its tiers are every account's tier as assigned before, and new sign-ups keep appearing
  on its tier panel. The six old `app_storage` keys (`shop-price-list`, …) were copied into
  `shop_settings` by migration `20261017213414_shops_tenant.sql`; the cleanup migration
  `20261017220436_phase1_cleanup_legacy_keys.sql` then deleted them, returned `app_storage` to plain
  signed-in read/write (it holds only the idea box now), and dropped `customers.tier`.
- **A shop onboards itself** (Phase 2, `docs/phase2-self-serve-shop-design.md`, migration
  `20261020181706_phase2_self_serve_shops.sql`). A listing becomes a shop the moment its owner
  is linked (ordering off); Shop Floor → **Shop Settings** walks the owner through prices,
  order email and phone, people, tier names and the ordering switch, which needs an order
  email and a saved price list (the default shop is exempt). Owners invite people by email
  (`shop_invites`; accepted by whichever account confirms that email), the listing's owner
  account can never be removed, `?shop=<slug>` works next to `?shop=<id>`, tier names live
  per shop under `shop_settings` key `tier-labels`, and PO numbers come from each shop's
  own counter, assigned by `submit-order`. Deploy order: the migration (additive), then
  `submit-order`, `listing-alert` and `order-alert`, then the build; a later cleanup drops
  `next_po_number()`, `po_number_seq` and `ordering_shop(uuid)`.

## How the New Order tab moves

Two steps and a sheet. **What do you need** picks the tool (panel, trim, a kit, metal, 3D
parts); **Order details** is the tool itself. **Finish & color** is not a step you travel to:
it opens as a sheet over whatever screen is up, and Done drops you back on it with the 3D
model, the drawing and every typed number exactly as they were. A sticky bar at the top of
the tab shows the three stops with what each holds (the part, the tool, the color) and each
is a button, so the color is one tap away from the 3D tool and the chooser one tap away
from a drawing.

The browser's Back button and a phone's back gesture close the sheet, close a kit, return
from the 3D tool to the Commercial Kit it was opened from, or step from a tool back to the
chooser, instead of leaving the app. Only moves the person made by hand leave a history
entry; deep links, the Job Vault and a kit opened after a send do not, and nothing is
pushed when members.html embeds the app. `?view=color` (the Color Lab button) opens the
sheet over the chooser.

## Notes on how access works

- **Anyone signed in** (staff or customer) can submit orders and see the Price List
  Customer View with their own assigned pricing.
- **Platform staff and a shop's people** see Shop Floor and Backend Pricing (raw costs,
  margins, and the tier-assignment panel): platform staff for every shop, a shop's people
  for their own shop only (see *Shops as tenants*).
- **Customers cannot change their own tier** — that's enforced at the database level
  (Row Level Security), not just hidden in the UI, so it can't be bypassed by someone
  poking at the browser's dev tools.
- **Raw costs never leave the shop.** Only a shop's people and platform staff can read
  that shop's backend price list and its material and production cost rows; customers get
  the price list through `customer_price_list(shop)`, which drops the cost column. The
  tier prices stay in that payload because the app computes every estimate in the browser.
- **Every estimate and order is priced at the account's assigned tier**, and the order's
  price is set on the server. The pricing code and the catalog it needs live in
  `supabase/functions/_shared/pricing.mjs`, shared by the app and the `submit-order` Edge
  Function: the app shows the estimate as the person types, and on Send the function
  prices the order again at that account's tier against the shop's live Price List, writes
  the row itself and replies with the real price. Once the build that calls it is live,
  apply `supabase/migrations/20261017200506_orders_server_priced.sql`, which drops the
  browser's insert right on `orders`, so a tampered page can't send a price of its own.
  `node scripts/pricing-check.mjs` checks the tier math against the seed price list.
- The first staff member is added by SQL (step 7). After that, platform staff grant or
  revoke platform admin with the **Platform** button in the **Customer Pricing Tiers**
  panel, and a shop's owners give their own people the shop's backend with **Admin**;
  nobody can grant either to themselves or remove their own.
- Every confirmed account gets its `customers` row from a database trigger the moment it
  is confirmed, so it shows up in the tiers panel whether or not it has opened the app.
- Anonymous readers (the directory page, the home-page counter, the prerender step and
  the app's shop picker) read the `directory_public` view, which lists live rows without
  `owner_id`, `application_id` or `order_email`. The anon role's grant on the table itself
  is limited to those same columns, so a hand-written request can't read them either.
  Signed-in admin pages read the table.
- **Address fields suggest as you type** (Get Listed locations, the directory's "City or
  area" box, the admin editor's locations, the app's Job Site Address) through Google
  Places API (New), shared in `public/places.js`. The browser key goes in
  `public/site-config.js`; restrict it in Google Cloud by HTTP referrer (roofcoil.com,
  www.roofcoil.com, shop.roofcoil.com, fortifiedmetals.com, www.fortifiedmetals.com,
  localhost) and by API (Maps JavaScript API, Places API (New)). A picked address carries
  its coordinates, so the OpenStreetMap check at submit is skipped for it; with the key
  empty every field behaves as before. One autocomplete session is billed per address
  picked, not per keystroke.
- **Shops claim their own listing.** A signed-in account with no listing sees the live
  directory on Manage your listing and taps "This is my shop" (each prerendered supplier
  page and the Get Listed form link straight to it). `claim_listing()` links the account
  immediately when its confirmed email is at the listing's website domain and nobody owns
  the listing yet; every other claim waits under **Listing claims** in Directory admin,
  where `decide_listing_claim()` approves or dismisses it. The desk is emailed about a
  pending claim and the claimant about the outcome (`listing-alert`, kinds `claim` and
  `claim_decided`). Get Listed warns when the company or website is already on the
  directory, and an application card in Directory admin flags the existing listing so the
  changes go onto it instead of a second copy.
- Every push and pull request runs the real build, prerender included, in GitHub Actions
  (`.github/workflows/build.yml`). Make it a required check on `main` so a red build can't
  be merged. The workflow reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the
  repository's Actions **variables** (Settings > Secrets and variables > Actions > Variables)
  — the same two public values as `.env`. The prerender has no built-in fallback for them,
  so a build without them fails on purpose rather than pointing at the wrong project.
- The public forms are throttled in the database: Get Listed applications stop at 3 an hour
  from one address and 20 an hour overall, leads at 10 and 60, uploads at 60 an hour, and
  sign-ups at 3 an hour per inbox and 10 per connection.
