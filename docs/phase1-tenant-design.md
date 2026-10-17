# Phase 1 — "shop" becomes a real tenant

*Design for review, 2026-10-17. Nothing here is applied yet: no migration has run, no code has changed. Approve or amend this document first; the migration, the app edits and the submit-order change follow it exactly.*

**Goal.** A second fabrication shop runs its own price list, costs, coil scale, presets, materials board and customer tiers on the same platform, with Fortified Sheet Metal as shop #1 and **no change in behaviour for Fortified's customers or staff**. Isolation is enforced by Postgres (RLS and SECURITY DEFINER functions), not by the UI.

**Out of scope (Phase 2+).** Per-shop catalog (profiles, colors, kits are still code in `pricing.mjs`/`App.jsx`); per-shop tier *names* (the three tier ids stay `tier1`, `tier2`, `greenleaf`); onboarding UI and member management screens; `?shop=<slug>`/subdomains; per-shop PO number sequences; billing.

---

## 1. What is true today (verified on the hosted project)

| Fact | Consequence for the design |
|---|---|
| `app_storage` holds **two** shop rows: `shop-custom-trim-presets` and `shop-material-status`. There is no saved `shop-price-list`, `shop-material-costs`, `shop-production-costs` or `shop-coil-width-scale`; Fortified prices from `DEFAULT_PRICE_LIST` / `DEFAULT_COIL_WIDTH_SCALE` in `pricing.mjs`. | Seeding Fortified is a copy of two rows. "No saved row → code defaults" stays the rule, so Fortified keeps pricing exactly as now. |
| `directory_listings` "Fortified Sheet Metal": `accepts_orders = true`, **no `owner_id`**, no `order_email`. Orders to it go to the desk (`ALERT_EMAIL_TO` + SMS) because `order-alert` treats "no order email" as "not routed". | Fortified's routing is untouched: it depends only on the listing's `order_email` being empty. |
| "CFR Metals": `owner_id` set, `accepts_orders = true`, `order_email` set. Its owner already has a Shop Floor through the `owner_id` policies on `orders`. Orders sent to CFR are priced at Fortified's defaults today (the known bug). | CFR is the natural second tenant and must not lose its Shop Floor. |
| `staff` has 2 rows (both also `customers`, tier greenleaf, owning no listing). `customers` has 31 rows: 24 tier2, 4 tier1, 3 greenleaf. | Both staff become Fortified shop owners **and** stay platform staff. All 31 tiers move to Fortified's per-shop tier table. |
| `orders` has 2 legacy rows with `shop_id = null`, `user_id = null` (Aug 11, before accounts). | Backfill `shop_id` to Fortified so "every order belongs to a shop" holds. |
| `orders.shop_id` → `directory_listings(id)`; `?shop=<listing id>` preselects the ordering shop; `submit-order` validates `shopId` against `directory_listings.accepts_orders`; `order-alert` looks the shop up in `directory_listings`; the pg_net triggers post `to_jsonb(new)` of the order row. | Keeping **shop id = listing id** means none of these change. |
| `customer_price_list()` (zero-arg, SECURITY DEFINER) strips `cost` from the global list. The live app calls it with no arguments. | The replacement takes `p_shop uuid default null`; a no-argument call still works during the deploy window. |
| `app_storage` RLS: the three cost keys are staff-only to read; `shop-coil-width-scale` and the cost keys are staff-only to write; everything else is readable and writable by any signed-in account. | The per-shop table keeps the same split and tightens the materials board to shop members (only the staff UI ever touched it). |

---

## 2. Schema

All tables live in `public`, RLS on, grants as today (`anon`/`authenticated` table grants are open; policies do the work). Every new function is `SECURITY DEFINER`, `set search_path = ''`, with `execute` revoked from `public`/`anon` and granted to `authenticated` unless noted.

### 2.1 `shops` — the tenant

**Decision: a shop's id *is* its directory listing's id.** `shops.id` is both the primary key and a foreign key to `directory_listings(id)` (`on delete restrict`, so a listing that is a tenant can't be deleted by the directory admin's delete button).

Why shops reference listings, and share the id, instead of listings referencing shops:

- Everything that already carries a shop id (`orders.shop_id`, `?shop=`, submit-order, order-alert, the Job Vault payloads, the two `orders` RLS policies) keeps its meaning with zero migration.
- The listing is the shop's public face and the thing people claim; the `shops` row is the private side (membership, settings, later plan/billing). `directory_listings` is readable by `anon` for live rows, so tenant config must not live on it.
- A shop that does not want to be in the public directory gets a listing with `status = 'hidden'` (the status already exists). Nothing in Phase 1 needs a shop without a listing.

```sql
create table public.shops (
  id          uuid primary key references public.directory_listings(id) on delete restrict,
  slug        text unique,                      -- from the listing name; for ?shop=<slug> later
  status      text not null default 'active' check (status in ('active','suspended')),
  is_default  boolean not null default false,   -- the platform's house shop (Fortified)
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);
create unique index shops_one_default on public.shops (is_default) where is_default;
```

Policies: `select` for platform staff or members of that shop; `insert`/`update`/`delete` for platform staff only. Customers never read `shops`; they get what they need from `directory_public`, `ordering_shop()` and `default_shop_id()` (below).

**Rule: a listing that takes orders is a shop.** A trigger on `directory_listings` (`after insert or update of accepts_orders, owner_id`) inserts the `shops` row the first time `accepts_orders` turns on, and adds the listing's `owner_id` as an `owner` member whenever it is set. This means the existing flows — directory admin's "Takes orders" switch, a listing owner proposing it from `/manage-listing.html`, claims (`claim_listing`, `decide_listing_claim`, `set_listing_owner`) — create tenants and memberships with no page changes. Turning `accepts_orders` off does **not** delete the shop (its settings and orders stay); `shops.status = 'suspended'` is the kill switch.

Applied to today's data this creates two shops: Fortified (default) and CFR Metals (with its owner as member).

### 2.2 `shop_members` — who runs a shop

```sql
create table public.shop_members (
  shop_id     uuid not null references public.shops(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'staff' check (role in ('owner','staff')),
  created_at  timestamptz not null default now(),
  primary key (shop_id, user_id)
);
```

- `owner`: everything `staff` can do, plus add/remove members (Phase 2 UI; Phase 1 exposes it through the existing "Admin" button, see §4).
- `staff`: Price List → Backend, costs, coil scale, presets, Customer Pricing Tiers, Shop Floor and the materials board **for that shop**.
- **Platform staff (`public.staff`) is unchanged** and keeps every power it has today across every shop: `is_staff()` is OR-ed into every new policy and helper. The directory admin, site leads, manufacturer applications and the idea box stay platform-staff-only.

Helpers (stable, definer): `is_shop_member(p_shop uuid)`, `is_shop_owner(p_shop uuid)`, `can_manage_shop(p_shop uuid) = is_staff() or is_shop_member(p_shop)`. Policies use the helpers, which avoids a `shop_members` policy recursing into `shop_members`.

Policies: `select` for platform staff or members of the same shop (members see their roster); `insert`/`update`/`delete` for platform staff or the shop's owners, and an owner cannot delete their own row (same guard as `staff`).

### 2.3 `shop_settings` — the per-shop rows that replace the global keys

```sql
create table public.shop_settings (
  shop_id     uuid not null references public.shops(id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  primary key (shop_id, key)
);
```

| Global key today (`app_storage`) | Per-shop key | Who can read | Who can write |
|---|---|---|---|
| `shop-price-list` | `price-list` | shop members, platform staff (customers: through `customer_price_list(p_shop)`, cost stripped) | shop members, platform staff |
| `shop-material-costs` | `material-costs` | shop members, platform staff | same |
| `shop-production-costs` | `production-costs` | shop members, platform staff | same |
| `shop-coil-width-scale` | `coil-width-scale` | any signed-in account (sell prices, needed for coil estimates — as today) | shop members, platform staff |
| `shop-custom-trim-presets` | `custom-trim-presets` | any signed-in account (as today) | shop members, platform staff (**today any signed-in account can write it; tightened**) |
| `shop-material-status` | `material-status` | shop members, platform staff (**today any signed-in account; tightened, only the staff UI uses it**) | shop members, platform staff |
| `shop-idea-box` | *stays in `app_storage`* | platform feedback, not shop data | unchanged |

Policies: `select` where `can_manage_shop(shop_id) or key in ('coil-width-scale','custom-trim-presets')`; `insert`/`update`/`delete` where `can_manage_shop(shop_id)`. `value` is `jsonb` (today's text is JSON anyway), which is what lets the price-list function strip costs in SQL and rejects a corrupt save.

`customer_price_list(p_shop uuid default null) returns jsonb` replaces the zero-arg function: `null` means the default shop; returns the shop's `price-list` with `cost` removed from every row, or `null` when the shop has saved nothing (the app then uses the code defaults, exactly as now).

### 2.4 `shop_customers` — per-shop tiers (decision: per shop, not global)

A tier is a relationship between **one shop** and a customer. Keeping `customers.tier` global would (a) hand Fortified's Tier 1 relationships to every other shop's pricing and (b) leave other shops unable to set tiers at all, since only platform staff may update `customers`. So:

```sql
create table public.shop_customers (
  shop_id     uuid not null references public.shops(id) on delete cascade,
  user_id     uuid not null references public.customers(id) on delete cascade,
  tier        text not null default 'tier2' check (tier in ('tier1','greenleaf','tier2')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (shop_id, user_id)
);
```

- **No row = `tier2` (retail)**, the same default every new sign-up has today.
- Policies: `select` own rows (any shop) or `can_manage_shop(shop_id)`; `insert`/`update`/`delete` only `can_manage_shop(shop_id)`. **Customers still cannot change a tier**, and a shop cannot see or change another shop's tiers.
- Who appears in a shop's **Customer Pricing Tiers** panel: the accounts with a `shop_customers` row for that shop. Rows are created by (1) the migration for Fortified (all 31 customers, tier copied), (2) `submit-order`, which upserts a `tier2` row the first time an account orders from a shop ("a customer of X is someone who ordered from X"), (3) `add_shop_customer(p_shop, p_email)` for a member who wants to set a tier before the first order (same shape as `set_listing_owner`: returns `added` or `no-account`), and (4) for the **default shop only**, a trigger on `customers` insert, so new sign-ups keep appearing in Fortified's panel the moment they register, exactly as today. Other shops never see a customer who has not ordered from them or been added by email — Fortified's customer base does not leak to a competitor.
- `customers` gains one `select` policy: a shop member may read the `customers` row (name, email, phone) of anyone with a `shop_customers` row for their shop. The existing policies (own row; platform staff all; only platform staff update) are untouched.
- `customers.tier` **stays for now** (the live app build and the live function read it until the new build ships) and is dropped in the cleanup migration after Phase 1 is verified. The new app and function never read it.

### 2.5 `orders`

- Two policies gain a shop-member branch: `shop owner reads routed orders` / `shop owner updates routed orders` become `shop_id is not null and (listing owner or is_shop_member(shop_id))`. Existing `own or staff read`, `staff update`, `staff delete` unchanged. `order-alert`, `notify_order_insert`, `notify_order_status` and `order_alerts` are not touched.
- Backfill: `update orders set shop_id = <default shop> where shop_id is null` (2 legacy rows). This is an update of `shop_id`, not of `data`, so `orders_status_alert` (`after update of data`) does not fire.

### 2.6 Small functions the app needs

| Function | Execute | Purpose |
|---|---|---|
| `default_shop_id() returns uuid` | anon, authenticated | The house shop; replaces the app's `/fortified/i` name match when there is no `?shop=`. |
| `my_shops() returns table(id, name, phone, city, lat, lng, locations, accepts_orders, status, role)` | authenticated | Shops the caller is a member of, from the listing, **regardless of listing status**, so a hidden test shop still shows for its own members. |
| `ordering_shop(p_id uuid)` same columns minus `role` | anon, authenticated | Resolves `?shop=<id>` for a shop that takes orders even when its listing is not live (a shop linking to the tools from its own site without being in the public directory). Returns nothing for a suspended shop or `accepts_orders = false`. |
| `customer_price_list(p_shop uuid default null)` | authenticated | §2.3. The zero-arg function is dropped in the same migration; PostgREST resolves a no-argument call to the default. |
| `add_shop_customer(p_shop uuid, p_email text) returns text` | authenticated (checks `can_manage_shop` inside) | §2.4. |

---

## 3. How the app picks the active shop

`shopId` (already in `App.jsx`) stays the single "active shop": it is the shop the order goes to **and** the shop whose prices, coil scale, presets, tier and backend are on screen. One concept, no second selector.

Resolution order on load (replaces the `?shop=` → `/fortified/i` → first rule):

1. `?shop=<listing id>` — from the picker list, or via `ordering_shop(id)` when the listing is not live.
2. Otherwise, if the account is a member of one or more shops, their first shop (a CFR member who opens the app lands on CFR's prices and CFR's backend; a Fortified staffer lands on Fortified, as today).
3. Otherwise `default_shop_id()` (every customer today → Fortified, as today).
4. Otherwise the first shop in the picker.

The picker ("Send this order to") lists `directory_public` where `accepts_orders` (as today) plus the caller's `my_shops()` rows, de-duplicated by id. Picking a different shop reloads price list, coil scale, presets and tier for that shop; the estimate on screen re-computes from them (the existing effects already key off `priceList`/`coilWidthScale`).

Derived flags, replacing the `isStaff` checks that gate shop-scoped UI today:

- `memberShops` (from `my_shops()`, loaded in `AuthProvider` next to `ownedShops`).
- `canManageShop = isStaff || memberShops.some(s => s.id === shopId)` → Price List → Backend (Edit), costs, coil scale editing, Customer Pricing Tiers, materials board, preset saving.
- `canRunShopFloor = isStaff || memberShops.length > 0` → Shop Floor tab.
- `isStaff` alone → site leads, manufacturer applications, idea box list, the platform-admin toggle.

### 3.1 Data loading, per key (the `storage.get/set` call sites become shop-scoped)

A new `shopStorage` in `src/lib/storage.js` with the same shape as `storage` but keyed by shop: `shopStorage.get(shopId, key)` resolves `{ value: <JSON string> }` and `shopStorage.set(shopId, key, jsonString)` upserts `shop_settings`. Returning the JSON as a string keeps every existing `JSON.parse(res.value)` / `JSON.stringify(next)` line as it is — each call site changes only its key and gains `shopId` in the effect's dependency list.

| Call site in `App.jsx` | Today | After |
|---|---|---|
| price list load (`isStaff ? storage.get : rpc customer_price_list`) | global | `canManageShop ? shopStorage.get(shopId,'price-list') : rpc('customer_price_list', { p_shop: shopId })`; deps `[shopId, canManageShop]` |
| `savePriceList` | `storage.set('shop-price-list')` | `shopStorage.set(shopId, 'price-list', …)` |
| coil width scale load/save | global, everyone reads | per `shopId`; everyone reads (policy) |
| custom trim presets load/save | global | per `shopId` |
| material costs, production costs load/save | `isStaff` | `canManageShop`, per `shopId` |
| material status (materials board) load/save | `isStaff` | `canManageShop`, per `shopId` |
| customers list for the tier panel | `from('customers')` (all) | `from('shop_customers').select('user_id, tier, customers(name,email)').eq('shop_id', shopId)` (RLS limits it to that shop) |
| `updateCustomerTier` | `update customers set tier` | `upsert shop_customers (shop_id, user_id, tier)` |
| `sellTier` / header badge / default `priceListTier` | `customer.tier` | the caller's `shop_customers` row for `shopId` (own-row read), `sellTierFor(row)` |
| `floorOrders` | `isStaff ? all : ownedShops` | `isStaff ? all : member shop ids` |
| materials board lines | all active orders | active orders **of `shopId`** (for Fortified staff this equals today once the two legacy orders are backfilled) |
| "Admin ✓" button in the tier panel | toggles `staff` (platform) | toggles `shop_members(shopId, user, 'staff')`; visible to shop owners and platform staff. A separate "Platform admin" toggle, visible only to platform staff, keeps today's behaviour for the two existing staff. |

Nothing moves out of `App.jsx` and no section is rewritten: the edits are the key changes, the three derived flags, the shop list union, and the tier panel's query. `pricing.mjs` and `scripts/pricing-check.mjs` are untouched.

---

## 4. `submit-order` reprices against the order's shop

Today it reads the global `shop-price-list` / `shop-coil-width-scale` keys and `customers.tier`. After:

1. All orders in one call must carry the same `shopId` (one job, one shop; the app already sends one job per call). A missing `shopId` resolves to `default_shop_id()` and is stamped on the rows — so every new order has a shop. (Fortified's orders already carry Fortified's id today.)
2. The shop must exist in `shops` with `status = 'active'` and its listing must have `accepts_orders = true` (the existing check).
3. Price list = `shop_settings(shop, 'price-list')` or `DEFAULT_PRICE_LIST`; coil scale = `shop_settings(shop, 'coil-width-scale')` or `DEFAULT_COIL_WIDTH_SCALE` — the same fallback rule the app uses.
4. Tier = `shop_customers(shop, user).tier`, else `tier2` (`sellTierFor` unchanged).
5. After a successful insert, upsert `shop_customers(shop, user)` with `tier2` if there is no row yet (§2.4).

The function keeps using the service role, so none of this depends on RLS from inside the function; the checks above are explicit. Redeployed with `index.ts` + `../_shared/pricing.mjs` as today. `verify_jwt` stays on.

---

## 5. Migration plan (one additive migration, then a cleanup later)

`supabase/migrations/20261018010000_shops_tenant.sql`, in this order inside one transaction:

1. Create `shops`, `shop_members`, `shop_settings`, `shop_customers`; indexes; RLS on; policies.
2. Helpers and functions of §2.2/§2.6; `drop function customer_price_list()` and create the `p_shop` version; grants.
3. `ensure_shop_for_listing()` trigger on `directory_listings`; `shop_customer_on_signup()` trigger on `customers` (default shop only).
4. **Seed Fortified as shop #1** — no generated ids hardcoded: the listing is selected as the live listing whose name starts with "Fortified" and takes orders; the migration raises if it finds none or more than one.
   - `shops`: `(id, slug 'fortified-sheet-metal', is_default true)`.
   - `shop_members`: every row of `staff` as `owner`.
   - `shop_settings`: every `app_storage` row whose key is one of the six `shop-*` keys, copied (not moved) as `(fortified, key minus the `shop-` prefix, value::jsonb)` — today that is the presets and the materials board.
   - `shop_customers`: every `customers` row as `(fortified, id, tier)`.
   - `orders`: `shop_id = fortified where shop_id is null`.
5. Apply the listing rule to existing data: a `shops` row for every other listing with `accepts_orders = true` (CFR Metals), its `owner_id` as `owner` member.
6. Add the two `orders` policy branches and the `customers` select policy.

**Deploy order.** (a) Apply the migration — additive; the live app and function keep working (`app_storage` rows still there, `customer_price_list()` with no args still answers, `customers.tier` still there). (b) Deploy `submit-order` — it accepts the old app's payload unchanged. (c) Merge the PR so Vercel ships the new build. (d) Later, after the two-shop test passes, a separate cleanup migration removes the six `shop-*` rows from `app_storage` and their key-specific policy clauses, and drops `customers.tier` (the app's sign-up insert stops sending `tier` in this PR so the column can go).

**Rollback.** Everything is additive: redeploy the previous function and build. The new tables can stay or be dropped; `customers.tier` and `app_storage` are never modified by the migration, so the old code finds exactly what it had.

**What this migration does not do.** No change to `directory_listings` columns, `directory_public`, `order-alert`, `listing-alert`, the pg_net triggers, `staff`, `is_staff()`, the claim functions, `vault_items`, `member_state`, `leads`, `manufacturer_applications`.

---

## 6. The guarantees, before and after

| Guarantee | Today | After Phase 1 |
|---|---|---|
| Customers never see costs or margins | `app_storage` cost keys are staff-only; `customer_price_list()` strips `cost` | `shop_settings` cost keys readable only by that shop's members and platform staff; `customer_price_list(p_shop)` strips `cost`; material and production costs never leave `shop_settings` |
| Tiers are only staff-editable | `customers.update` = platform staff | `shop_customers` writes = that shop's members or platform staff; `customers.update` unchanged |
| A customer sees only their own orders | `orders` select: own or staff or listing owner | same, plus shop members for their shop's orders |
| A shop sees only its own orders | listing owner only | listing owner or any member of that shop |
| **New:** a shop cannot read another shop's prices, costs, presets, board, members or tiers | n/a (one shop) | every `shop_*` policy is scoped by `shop_id` through `can_manage_shop`; the only cross-shop reads are the two sell-price keys (`coil-width-scale`, `custom-trim-presets`) and `customer_price_list`, which any signed-in account may read for any shop — the same visibility Fortified's sell prices have today, since any contractor can sign up |
| **New:** a shop cannot see another shop's customer base | n/a | `customers` rows are visible to a member only through `shop_customers` rows of their own shop |
| Platform staff can administer everything | `is_staff()` | unchanged; OR-ed into every new policy |
| Fortified's orders route exactly as before | `order_email` empty → desk + SMS | untouched; the migration does not write `directory_listings` |

---

## 7. Two-shop test plan (outline; the full checklist ships with the PR)

Shop A = Fortified (seeded). Shop B = a **hidden** directory listing "RoofCoil Test Shop" with `accepts_orders = true` and a test owner account (the trigger creates the shop and membership); hidden so it never appears in the public directory, the prerendered pages or other customers' pickers — only through `?shop=<id>` and to its own members.

1. Fortified regression: staff sign-in → Backend shows presets and the materials board as before; tier panel lists all 31 customers with their tiers; a customer's estimate and a dry-run `submit-order` give the same number as before the migration (recorded first).
2. B's owner signs in → lands on B; Backend edits B's price list (e.g. 24 ga trim $9.99); A's list is unchanged (check as Fortified staff and via `customer_price_list(A)`).
3. A test customer opens `?shop=<B>` → sees B's $9.99 in Price List; opens the plain app → sees A's prices; dry-run orders to each shop return each shop's price and `tier2`.
4. B's owner sets the test customer to `tier1` at B → the customer's estimate at B changes, their tier at A is still `tier2`, and B's tier panel shows only accounts that ordered from B or were added by email.
5. Isolation from the database side, as B's owner (RLS): `select` on `shop_settings`/`shop_customers`/`shop_members` filtered to A returns nothing; `customer_price_list(A)` returns no `cost`; `shop_customers` upsert for A is refused.
6. Platform staff still sees every order on Shop Floor and both shops' backends; `order-alert` for an order to A goes to the desk, for B to B's `order_email` (or is skipped when none is set).
7. `node scripts/pricing-check.mjs` and `npm run build` are green; the security advisor shows no new warnings.

---

## 8. Decisions to confirm before I code

1. **"A listing that takes orders is a shop."** CFR Metals becomes shop #2 at migration time with its owner as shop owner (it keeps its Shop Floor and gains a backend with the default price list until it edits it). Alternative: create shops only by hand (platform staff) — then CFR's owner needs a membership row added by hand before the new build ships, or they lose Shop Floor.
2. **Fortified is the platform's default shop.** New sign-ups get a `shop_customers` row at Fortified automatically, so the Customer Pricing Tiers panel keeps showing every new account as it does today. Other shops see only their own customers. Alternative: no automatic rows anywhere (Fortified would see a new account only after its first order, or by adding it by email).
3. **The "Admin" button becomes "shop staff" for the selected shop** (membership), with a separate "Platform admin" toggle only platform staff can see. The two existing staff accounts are untouched.
4. **Branch.** The checkout is shared with the session that started this one (on `chore/p0-cleanups`), so this work lives on `feat/phase1-shop-tenant`, cut from `chore/p0-cleanups`, in a nested worktree at `fortified-shop-app/.worktrees/phase1` (excluded from `git status`). The PR targets `main`; once the p0 branch merges, the PR diff shrinks to Phase 1 alone.
