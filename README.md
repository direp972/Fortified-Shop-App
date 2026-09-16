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

Fortified Sheet Metal's own listing has ordering switched on with no order email, so its
orders keep going to `ALERT_EMAIL_TO` and the shop text exactly as before.

## Notes on how access works

- **Anyone signed in** (staff or customer) can submit orders and see the Price List
  Customer View with their own assigned pricing.
- **Only staff** can see Shop Floor (all orders from every customer) and Backend
  Pricing (raw costs, margins, and the tier-assignment panel).
- **Customers cannot change their own tier** — that's enforced at the database level
  (Row Level Security), not just hidden in the UI, so it can't be bypassed by someone
  poking at the browser's dev tools.
- **Raw costs never leave the shop.** Only staff can read the backend price list and the
  material and production cost keys; customers get the price list through
  `customer_price_list()`, which drops the cost column. The tier prices stay in that
  payload because the app computes every estimate in the browser.
- The first staff member is added by SQL (step 7). After that, staff can grant or revoke
  admin access from the **Customer Pricing Tiers** panel; nobody can grant it to themselves.
- Every confirmed account gets its `customers` row from a database trigger the moment it
  is confirmed, so it shows up in the tiers panel whether or not it has opened the app.
- The public forms are throttled in the database: Get Listed applications stop at 3 an hour
  from one address and 20 an hour overall, leads at 10 and 60, uploads at 60 an hour, and
  sign-ups at 3 an hour per inbox and 10 per connection.
