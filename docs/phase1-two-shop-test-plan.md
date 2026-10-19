# Phase 1 — two-shop test plan

Checks that two shops run different price lists and tiers on the same platform without seeing each other, and that Fortified behaves exactly as before. Run it on shop.roofcoil.com once the Phase 1 build is live (the migrations and `submit-order` are already applied to the hosted project).

## Setup

| Thing | Value |
|---|---|
| Shop A | Fortified Sheet Metal — listing/shop id `7803cfaa-3320-4fc7-89c2-1c739a403921`, the default shop. Its people: the two platform staff accounts. |
| Shop B | **RoofCoil Test Shop** — listing/shop id `2ff8b15c-fcd3-4c64-8327-acd11a1a8cdf`, listing status `hidden`, `accepts_orders = true`, no order email (so its order alerts go to the desk, not to a real shop). Hidden listings never appear in the public directory, the prerendered pages or other customers' shop picker; only `?shop=<id>` and its own members reach it. Created by the migration session; delete it at the end (see Cleanup). |
| Accounts | **Staff**: your existing platform-staff account. **B-owner**: a fresh sign-up (for example `you+shopb@yourdomain`), confirmed. **Customer**: a fresh sign-up (for example `you+cust@yourdomain`), confirmed, never made staff. |
| Reference part | Trim, 4 pieces × 10 ft, 24 gauge, 40YR SMP, Fortified Metal / Regal White, drawn with three points (one bend). With the seed price list this is **$152.00 at Tier 2, $138.00 at Tier 1, $134.00 at Greenleaf** (40 LF × trim rate + 1 bend × $2 × 4 + $10). |
| SQL checks | Supabase dashboard → SQL Editor, or ask the session to run them. They never change data. |

Link B-owner to Shop B: as Staff, open `/directory-admin.html` → RoofCoil Test Shop → **Owner account** → B-owner's email → Link. The `listing_shop_sync` trigger makes B-owner the shop's `owner` member. Check:

```sql
select l.name, m.role, u.email from public.shop_members m
join public.directory_listings l on l.id = m.shop_id
join auth.users u on u.id = m.user_id order by l.name;
```
Expected: Fortified → the two staff accounts as `owner`; RoofCoil Test Shop → B-owner as `owner`; CFR Metals → its owner as `owner`.

## 1. Fortified regression (Staff)

1. Open the app signed in as Staff. Header says **Staff**. The shop picker preselects **Fortified Sheet Metal** (or no picker is shown when only one live shop takes orders).
2. Price List → **Backend (Edit)** opens. **Customer Pricing Tiers** lists every registered account (31 today) with the tiers as before; every row has both **Admin** and **Platform** buttons, and the two staff rows show **Admin ✓ Platform ✓**. The **RoofCoil Site Leads**, **Manufacturer Applications** and **Idea Box Submissions** panels are there.
3. Price List → **Customer View**: the three tier buttons work; the 24 Gauge Trim row shows 3.00 / 3.35 / 2.90.
4. New Order → trim → draw the reference part. The estimate at the tier shown matches the table above (Staff accounts are Greenleaf → **$134.00**).
5. Shop Floor → **Jobs** lists every order; **Master Materials List** opens and shows the pull board as before (one coil line marked in stock today).
6. New Order → drawing tool → the **saved presets** folder shows the shop's saved presets as before.
7. Send the reference order (or a cheaper one) to Fortified. Expected: the toast says the estimate; Past Orders shows it; the desk gets the usual order email and SMS and the customer copy names Fortified Sheet Metal. SQL: `select id, shop_id, data->>'tier', data->>'price' from public.orders order by created_at desc limit 3;` → `shop_id` is Fortified's id, tier is the account's tier, price matches.

## 2. Shop B sets its own prices (B-owner)

1. Sign in as B-owner. The app lands on **RoofCoil Test Shop** (a member's own shop wins over the default); header says **Shop staff**; the **Shop Floor** tab is there; Price List shows **Customer View / Backend (Edit)**.
2. Backend (Edit) shows the seed list (B has saved nothing yet). **Customer Pricing Tiers** is empty ("No customers yet…"); there is no Site Leads / Applications / Idea Box panel; the tier rows will have **Admin** but no **Platform** button.
3. Edit **24 Gauge Trim (per linear ft)** to **9.99** in all three tiers. Reload: the value is still 9.99. SQL:
   ```sql
   select shop_id, key, jsonb_array_length(value) from public.shop_settings order by shop_id, key;
   ```
   Expected: a `price-list` row for B's id; Fortified's rows are unchanged (presets and material-status only, unless Fortified saved a list in step 1).
4. Draw the reference part as B-owner: the estimate is **$417.60** (40 × 9.99 + 8 + 10) — B-owner has no tier row at B, so retail, and the backend view's tier switcher moves it.
5. Switch the picker to **Fortified Sheet Metal**: the estimate drops back to **$152.00** (B-owner is a plain Tier 2 customer at Fortified), the Backend toggle disappears, and Shop Floor shows nothing of Fortified's. Switch back to RoofCoil Test Shop.

## 3. A customer sees each shop's own prices (Customer)

1. Sign in as Customer at the plain app URL: the picker preselects Fortified; Price List shows 3.35 for 24 ga trim; the reference part estimates **$152.00**; header says **Tier: Tier 2**.
2. Open `https://shop.roofcoil.com/?shop=2ff8b15c-fcd3-4c64-8327-acd11a1a8cdf`: the picker now includes and preselects **RoofCoil Test Shop** (found through `ordering_shop()` because the listing is hidden); Price List shows **9.99**; the reference part estimates **$417.60**. No Backend toggle, no Shop Floor tab.
3. Send the reference part to RoofCoil Test Shop. Expected toast "estimate $417.60"; the desk gets an order email headed "→ RoofCoil Test Shop" (B has no order email, so it is not routed) and the customer copy names RoofCoil Test Shop. SQL: the newest `orders` row has `shop_id` = B's id, `data->>'tier'` = `tier2`, `data->>'price'` = `417.6`, and `select * from public.shop_customers where shop_id = '2ff8b15c-fcd3-4c64-8327-acd11a1a8cdf'` now has one row (Customer, tier2).
4. Back at the plain URL, send the same part to Fortified: priced **$152.00**, `shop_id` = Fortified's id.

## 4. Per-shop tiers (B-owner, then Customer)

1. As B-owner, Backend (Edit) → **Customer Pricing Tiers** now lists Customer (from the order). Set them to **Tier 1**. Also try **Add** with Staff's email: it appears with Tier 2 ("Added — set their tier below"); with a made-up email: "No confirmed RoofCoil account has that email yet."
2. As Customer at `?shop=<B>`: header says **Tier: Tier 1**; the reference part estimates **$417.60** still (B priced all tiers the same) — change B's Tier 1 trim rate to 8.00 as B-owner and reload as Customer: **$338.00** (40 × 8 + 8 + 10). At the plain URL (Fortified) the Customer is still **Tier 2 / $152.00**.
3. As Staff, Fortified's tier panel still shows Customer as **Tier 2**: B's tier did not leak into Fortified's.
4. As B-owner, tap **Admin** on Customer's row: Customer becomes B's staff. Sign in as Customer: Shop Floor and Backend appear **for RoofCoil Test Shop only**; at Fortified nothing changes. Tap Admin again to remove it.

## 5. Isolation at the database (B-owner's session)

Run these as B-owner through the app's session, or in SQL with the role simulated:

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = '<B-owner email>'), 'role', 'authenticated')::text, true);
set local role authenticated;
select (select count(*) from public.shop_settings  where shop_id = '7803cfaa-3320-4fc7-89c2-1c739a403921' and key <> 'custom-trim-presets' and key <> 'coil-width-scale') as fortified_private_rows_visible,
       (select count(*) from public.shop_customers where shop_id = '7803cfaa-3320-4fc7-89c2-1c739a403921') as fortified_tiers_visible,
       (select count(*) from public.shop_members   where shop_id = '7803cfaa-3320-4fc7-89c2-1c739a403921') as fortified_members_visible,
       (select count(*) from public.customers) as customers_visible,
       (select count(*) from public.orders where shop_id = '7803cfaa-3320-4fc7-89c2-1c739a403921') as fortified_orders_visible,
       (public.customer_price_list('7803cfaa-3320-4fc7-89c2-1c739a403921')::text like '%"cost"%') as fortified_list_has_cost;
rollback;
```
Expected: `0, 0, 0, <own row + B's customers>, 0, false` (or `null` for the list when Fortified has saved none). Then, still as B-owner, an `insert into public.shop_settings (shop_id, key, value) values ('7803cfaa-…', 'price-list', '[]')` and an `insert into public.shop_customers (shop_id, user_id, tier) values ('7803cfaa-…', auth.uid(), 'tier1')` both fail with *new row violates row-level security policy*.

## 6. Platform staff still runs everything (Staff)

1. Shop Floor → Jobs shows the orders of both shops; switching the picker to RoofCoil Test Shop (it is in Staff's picker because Staff can read every listing) shows B's **Master Materials List** and B's Backend with the 9.99 list; **Customer Pricing Tiers** shows B's customers and the **Admin** / **Platform** buttons.
2. Directory admin still toggles **Takes orders** and links owners as before. Switching ordering on for any listing creates its shop (`select count(*) from public.shops`).

## 7. Build, checks, advisors

- `node scripts/pricing-check.mjs` → "all checks passed".
- `npm run build` (with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`) → green, prerender lists 14 supplier pages (the hidden test shop is not among them).
- Supabase → Advisors → Security: the only new items are `default_shop_id()` and `ordering_shop()` callable by `anon` (intended: they expose the default shop's id and a shop's public listing fields) and the authenticated-callable helpers, the same class as `is_staff()` and `claim_listing()`.

## Cleanup

1. Delete the test orders: `delete from public.orders where shop_id = '2ff8b15c-fcd3-4c64-8327-acd11a1a8cdf';` and Fortified's test orders by id.
2. Remove the test shop in this order (the listing cannot be deleted while its shop exists): `delete from public.shops where id = '2ff8b15c-fcd3-4c64-8327-acd11a1a8cdf';` (cascades to its members, settings and tiers), then `delete from public.directory_listings where id = '2ff8b15c-fcd3-4c64-8327-acd11a1a8cdf';`. Or keep it as the permanent demo shop with `status = 'hidden'`.
3. Delete the two test accounts from Authentication → Users if they are not wanted (their `customers` and `shop_customers` rows cascade).

## Known gaps after this pass

- The materials board, presets and costs of a shop are per shop, but every shop still draws from the same catalog (profiles, brands, colors) and the same three tier ids and names — Phase 2.
- `next_po_number()` is one sequence across every shop.
- A shop whose listing is hidden can be ordered from only through `?shop=<id>`; a slug or subdomain comes with Phase 2.
- Anonymous reads of `orders` used to fail at the database (the pre-existing `shop owner reads routed orders` policy touched `directory_listings.owner_id`, a column the anon role cannot read) and the app ignored the error. Fixed by migration `anon_orders_policy_fix`: the ownership and membership tests are SECURITY DEFINER helpers, so a signed-out request gets no rows, and the app no longer loads orders before sign-in.
