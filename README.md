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
- **Shop Floor** and **Backend Pricing** are now staff-only. Regular customers can't see
  internal costs, margins, or other people's orders.

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

## Notes on how access works

- **Anyone signed in** (staff or customer) can submit orders and see the Price List
  Customer View with their own assigned pricing.
- **Only staff** can see Shop Floor (all orders from every customer) and Backend
  Pricing (raw costs, margins, and the tier-assignment panel).
- **Customers cannot change their own tier** — that's enforced at the database level
  (Row Level Security), not just hidden in the UI, so it can't be bypassed by someone
  poking at the browser's dev tools.
- New staff can only be added by you, running SQL directly in Supabase — never through
  the app itself. This is intentional: it means nobody can grant themselves staff access
  no matter what they do in the browser.
