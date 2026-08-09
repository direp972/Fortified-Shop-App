# Fortified Sheet Metal — Shop Order Portal

This is a standalone version of the app, no longer dependent on Claude.ai's artifact
environment. It uses a real database (Supabase) so orders, the price list, and
material costs are actually shared across everyone who opens the deployed link.

## What changed from the Claude artifact version

The only thing that changed is *where data is stored*. All the app logic, the
drawing tools, the 3D previews, the price list — everything is identical. Orders
and the price list now live in a real Postgres database (via Supabase) instead of
Claude's built-in `window.storage`.

## One-time setup (about 15 minutes)

### 1. Create a Supabase project (free)
1. Go to [supabase.com](https://supabase.com) and sign up / log in.
2. Click **New Project**. Pick any name and a database password (save it somewhere).
3. Wait ~2 minutes for the project to finish provisioning.

### 2. Create the database table
1. In your new Supabase project, open **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `supabase-setup.sql` (included in this folder), copy all of it, paste it in, and click **Run**.
4. You should see "Success. No rows returned" — that means the table is ready.

### 3. Get your API keys
1. In Supabase, go to **Project Settings** (gear icon) > **API**.
2. Copy the **Project URL** and the **anon public** key. You'll need both in the next step.

### 4. Configure the app
1. In this folder, copy `.env.example` to a new file named `.env`.
2. Paste in your Project URL and anon key from step 3.

### 5. Test it locally (optional but recommended)
```
npm install
npm run dev
```
Open the URL it gives you (usually `http://localhost:5173`). Submit a test order,
then check Supabase's **Table Editor** > `app_storage` to confirm a row appeared.

### 6. Deploy it live

**Option A — Vercel (recommended, free tier):**
1. Push this folder to a GitHub repo (or use Vercel's drag-and-drop deploy).
2. Go to [vercel.com](https://vercel.com), sign up, click **Add New Project**, import your repo.
3. Before deploying, add your two environment variables (same names as `.env.example`)
   under **Settings > Environment Variables**.
4. Click **Deploy**. You'll get a live URL like `your-app.vercel.app`.

**Option B — Netlify (also free, drag-and-drop friendly):**
1. Run `npm run build` locally — this creates a `dist` folder.
2. Go to [netlify.com](https://netlify.com), drag the `dist` folder onto the deploy page.
3. Add the same two environment variables under **Site settings > Environment variables**,
   then trigger a redeploy so the build picks them up.

Either way, you end up with a real URL you can hand to customers and staff — no
Claude account needed to use it, and it'll keep working independent of this
conversation.

## Important limitation to know about

There is currently **no login system** — anyone with the link can view and submit
orders, and anyone can open the Shop Floor or Price List tabs (including your
backend pricing and margins). The Supabase table is set up wide open (see
`supabase-setup.sql`) to match how the app worked before.

If you want the Shop Floor and Price List tabs restricted to staff only before you
hand this out publicly, that needs a real login system (Supabase Auth is a natural
fit) — tell me and I'll build it in before you go live.
