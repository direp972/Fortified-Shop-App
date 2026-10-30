# Phase 3 — plans, billing and entitlements

*Design for review, 2026-10-26. Nothing here is applied: no migration has run, no code has changed, nothing exists in Stripe (no products, prices, coupon, portal configuration or webhook endpoint, in test or live mode). Approve or amend this document first; the migrations, the function deploys, the Stripe setup and the app edits follow it exactly. Companion to `docs/phase2-self-serve-shop-design.md` (shipped as PR #59), `docs/rpc-grant-hardening-design.md`, and Part 2 of `docs/commercialization-plan.md` (SaaS per shop and Fortified's dual role, both decided 2026-10-26). The prices are starting points to confirm with pilots, not researched market rates. Nothing in §10 is legal or tax advice.*

**Goal.** A shop pays RoofCoil a flat monthly plan to take orders through RoofCoil. **One SQL function decides whether a shop may take orders today**, and every order path reads it: Postgres enforces it, not the UI. A shop whose plan lapses stops receiving new orders and keeps its free directory listing, its settings, its customers and its order history. Fortified Sheet Metal runs on a plan through the same path (comped, with no `is_default` shortcut). An order with no shop chosen stops going to Fortified by default. What the operator's team can see of other shops is written down and enforced. No money moves through RoofCoil on orders: contractors keep paying shops directly, and an order still carries an estimate the shop confirms.

**In scope.** (1) Stripe Billing: Checkout to start a plan, the Customer Portal to change it, cancel it, update the card and see invoices; (2) a webhook edge function and an owner-only session function; (3) per-shop subscription state and one entitlement function; (4) the plans (Listing free, Shop, Pro, Featured add-on) and their lifecycle: trial, grace, founding rate, cancellation, upgrade and downgrade; (5) Featured driving the directory's ordering; (6) the owner's plan card in Shop Settings; (7) Fortified comped, and CFR and Adax grandfathered; (8) Fortified's dual role, rules (a)–(d); (9) sales tax on the subscription; (10) RLS and grants, migrations, deploy order, rollback and a test plan in Stripe test mode.

**Out of scope (§11).** Stripe Connect, payments on orders and any marketplace fee; distributor and manufacturer tiers; the pilots playbook beyond the founding rate; custom domains; the app's rename away from "Fortified" (running separately).

---

## 1. What is true today (verified on the hosted project, 2026-10-26)

| Fact | Consequence for the design |
|---|---|
| **No billing anywhere.** No column or table matches `stripe`, `plan`, `subscri`, `trial`, `billing` or `entitle`. No payment handling exists in the app or the functions. | New tables, born locked down (§3, §13). Prices live only in Stripe. |
| Three shops. **fortified-sheet-metal**: `is_default`, ordering on, **no `order_email`**, no listing `owner_id`, settings `custom-trim-presets` and `material-status` only (**no `price-list`**), 32 tier rows, 2 orders, PO next 1007; its 2 owner members are **the 2 `staff` rows**. **cfr-metals** (Malta, OH): ordering on, `order_email` set, 1 owner (not staff), **no `shop_settings` rows at all**, so **it takes orders priced from the code seed** (`submit-order:132` falls back to `DEFAULT_PRICE_LIST`), 0 orders, 0 customers. **adax-metals** (Weatherford, TX): 1 owner, ordering off, no settings, no `locations` entry (its pin is the listing's lat/lng). Each shop has at most one `locations` entry; two unclaimed listings have several (Atlantic Pro Roofing 4, Custom Metal Roofing Sales 2). | Fortified is comped Pro; CFR and Adax get pilot rows, open-ended until go-live and then dated (§3.2). Nobody loses anything on deploy. Every orderable shop needs a saved price list, so Fortified's and CFR's current numbers are saved as their lists before the release that reads the predicate (§4.2, §12 d). A plan with one base routes from the first `locations` entry that has coordinates, else the pin (§2.1). |
| 14 listings, all `live`, **none featured**; 11 have no shop (`accepts_orders = false`, no owner). 2 claims (1 approved by domain, 1 dismissed). 29 leads (1 in the last 30 days), no `shop_id`, staff-only. | Nothing to grandfather for Featured. The free listing does not change. Leads stay platform data (§9.3). |
| `shops.id` **is** the listing's id (FK `shops_id_fkey` → `directory_listings`, on delete restrict); `orders.shop_id` also references `directory_listings`. `shops.status` allows only `active` / `suspended`, and staff use it as the moderation kill switch. | Billing rows are keyed by that shared id (§3.1). A lapsed plan does **not** set `suspended`: that would erase the moderation meaning and still leave the shop in the picker (§4.4). |
| The only server-side order gate is `submit-order/index.ts:117-126`: `shops.status = 'active'` and `accepts_orders`. It runs after the default-shop fallback (111-116) and before pricing (128) and `next_po_number` (175, which burns a counter). The app shows `reply.error` verbatim in a toast (`App.jsx:4762`). | The entitlement check goes into that gate, before the PO counter, dry run or not. Its wording is what the contractor reads (§4.3). |
| The other order paths: `ordering_shop_by_ref` (`?shop=`; active and `accepts_orders`, or staff), `shop_slugs()` (prerender order links, `scripts/prerender.mjs:129`), and the picker reading `directory_public` filtered on `accepts_orders` (`App.jsx:4673-4676`). The view returns only listings with `status = 'live'` (of `draft`, `live`, `hidden`) and has no `shops.status`. `default_shop_id()` checks nothing. | One predicate, read by all of them; the view's `accepts_orders` becomes the effective value (§4). Discovery (picker, nearest shop, prerender links) stays on live listings; a hidden shop is reachable only by its `?shop=` link (§4.2, §9.2). |
| `accepts_orders` is written by five paths: `set_shop_ordering` (`App.jsx:3892`), the staff PATCH in `public/directory-admin.html:684-691`, applied listing edits (`:863-875`), a staff insert, and service-role/SQL writes. It is read raw by the listing-live email (`notify_listing_live` → `listing-alert:116`), `manage-listing.html:226`, the setup checklist (`App.jsx:3877`), the member pre-Send guard (`App.jsx:5887`, through `shop_admin_info`), `directory-admin.html`'s list badge and editor chip (722, 757), and `set_shop_slug`'s rename lock. `validate_listing_edit` still lets an owner propose `accepts_orders` and `order_email`. `featured` is written only by that staff PATCH; **no function references `featured`**. | A gate placed only in `set_shop_ordering` leaks. This design reads entitlement **at every gate**, so the switch becomes the owner's intent and no writer can bypass the plan (§4.4). The raw readers move to the effective value (§4.3). |
| **Staff can rewrite another shop's routing and ownership.** `authenticated` holds table-wide `UPDATE` on `directory_listings` and `shops`, and the staff policies "staff update listings" and "staff update shops" allow any row. So a staff login can PATCH any listing's `order_email`, `accepts_orders` or `owner_id`, and any shop's `slug`, `po_prefix` or `po_next`. `set_listing_owner` and `decide_listing_claim` replace an existing owner without notice. `claim_listing` files a pending claim even on an owned listing. `listing_shop_sync` then deletes the old owner's membership and inserts the new one as `owner`. | Rule (c) needs those columns written only through the owner's own functions (column grants), and an owned listing to change owner only by the owner's own invite or a dated, notified dispute (§9.3, §9.4). |
| **Private directory columns.** `authenticated` has table-wide `SELECT` on `directory_listings`; anon's column list leaves out `order_email`, `owner_id` and `application_id`. Readers that need them: `directory-admin.html:711` and `:839` (`select=*`), `:692` (POST with `return=representation`), `manage-listing.html:186` (selects `order_email`, filters `owner_id`), `AuthProvider.jsx:44` (`ownedShops`, which nothing consumes), and the `listing_edits` insert policy "owner submits edits", whose sub-select reads `owner_id` with the caller's privileges. | Narrowing the column grant needs a definer read for each reader first (§9.4). Column privileges belong to the role, so platform admins lose them too unless they read through a function. |
| `set_shop_ordering` and `set_shop_contact` exempt the default shop from the order-email and price-list rules. Seven UI branches test `info.is_default` (`App.jsx:3872, 4000, 4016, 4022, 4237, 8558, 8570`). | All removed under rule (a). Fortified passes the same checks with data: an order email, a saved price list and a comp row (§9.1). |
| Routing: the app picks `?shop=` → a member's own shop → `default_shop_id()` (4694) → `list[0]` (4698); `submit-order` falls back to `default_shop_id()`. Nearest-by-ZIP runs only in the browser through Nominatim (4704-4736), and **0 of 32 customers have a ZIP**. Google sign-ups collect none. `shop_customer_on_signup` enrols every new account as a Fortified `tier2` customer (32 of 32 `shop_customers` rows are Fortified's). With no `shopId` the price-list effect returns early (`App.jsx:4965`) and `priceList` stays `[]` (4179); `customer_price_list` is called only with a shop (4974). | Rule (b) needs a server-side nearest-shop function, no silent default, and an end to auto-enrolment (§9.2). Sample prices with no shop chosen need an app change, not just `customer_price_list(null)`. |
| `add_shop_customer` lets **any member of any shop** (staff role included) attach any confirmed account by email, and answers `no-account` or `added`. The policy "shop members read their shop customers" then shows that account's `customers` row (name, email, phone, ZIP) to the shop. | A shop can read the phone and ZIP of any contractor whose email it knows, and learn whether an email has an account. Rule (c) needs a roster that shows a shop only what it was given (§9.3). |
| `order-alert` treats a shop with no `order_email` as "unrouted". It emails `ALERT_EMAIL_TO` (default `sales@fortifiedmetals.com`, line 77), **texts the desk** (302), and signs the customer copy with Fortified's name and phone (115-117). Fortified's own orders take this path. | Any shop switched on without an email (possible through the staff paths) sends its customers' orders to Fortified. The predicate requires an order email for every shop. Fortified keeps its text alert through a per-shop setting (§9.1). |
| `is_staff()` is the only admin test. **40 of 63 policies** depend on it (14 through `is_staff()`, 17 inline, 9 through `can_manage_shop`), and so do 15 functions. The 2 staff logins are Fortified's 2 owners. In the UI `isShopOwner` and `canManageShop` include `isStaff` (`App.jsx:4163-4164`). | A billing button gated on `isOwner` would show for every shop to Fortified's owners. Billing authorizes on strict ownership (§5.2, §8). Rules (c) and (d) need a split (§9.3, §9.4). |
| Three `orders` policies ("own or staff read", "staff update", "staff delete") are `TO public`, and anon holds `SELECT`, `INSERT`, `UPDATE` and `DELETE` on `orders`. They are anon-safe today only because they use inline `exists (select 1 from staff …)`. | A policy changed to call a function anon cannot execute must move to `TO authenticated` in the same statement (the PR #55 outage; §9.4, §13). |
| Owners can insert `shop_members` rows directly under RLS (`App.jsx:5092`), bypassing `invite_shop_member`. `invite_shop_member`, `accept_shop_invites_for` and `ensure_shop_for_listing` upsert with `on conflict (shop_id, user_id) do update`, which still fires BEFORE INSERT triggers. `locations` is edited only by staff. | Seat limits need a trigger that does not count a row that already exists. The base limit gates how bases are *used* (routing), not the directory data (§2.1, §4.3). |
| Default privileges after `20261026104615`: new tables give `anon` and `authenticated` `arwd`, new functions give them `EXECUTE`, and `service_role` gets everything. The `ensure_rls` event trigger turns RLS on at `create table`, with no policies. `my_shops` and `shop_admin_info` are EXECUTE for `authenticated` and `service_role` only. | Every new table and function, and every function dropped and recreated, revokes explicitly (§13). |
| `pg_net` 0.20.4 and Vault are installed; **pg_cron is available (1.6.4) but not installed**. Seven triggers call functions with `x-alert-secret`. `listing-alert` sends an **unknown `kind` to the desk as an "application"** email (240-251). | Lapse is decided **at read time** (no scheduler needed for access). Notices for lapses that no event marks need a daily job (decision 16). The fall-through is fixed before any new kind exists (§6.3). |
| No `supabase/config.toml`. `verify_jwt` is false on all four repo functions and lives only in deployed metadata. The functions are deployed by hand. Deployed `submit-order` v7 is byte-identical to the repo. | A `config.toml` lists every function, so a CLI deploy cannot flip `verify_jwt` and 401 the pg_net callers or Stripe (§5.3). |
| Hosts: `shop.roofcoil.com`; the whole of `www.roofcoil.com` proxied (app at `/app`); `fortifiedmetals.com/app` proxied with Fortified branding. `members.html:133` embeds the app in a same-origin iframe with no `sandbox`. The Stripe Portal sends `frame-ancestors 'none'`. | Checkout and the Portal always open top-level (§5.4). Billing buttons are hidden on the Fortified-branded host (§8). |
| `public/suppliers.html` orders featured cards from each baked card's **build-time** `data-featured` (565-570); the runtime fetch only appends unbaked names (580-587). A geo search sorts by distance alone (399). No card shows a "Featured" label. Builds run only on push. | A Featured purchase must take effect on the live page without a deploy (§7). |
| There is no staging project: the Phase 2 test ran on the production database with a hidden test shop. | Stripe test mode runs against production data, so test-mode access must be confined to the test shops and must stop counting at go-live (§3.1 `billing_config`, §12 c and j). |

---

## 2. Plans

### 2.1 What each plan unlocks

| | **Listing** | **Shop** | **Pro** | **Featured** (add-on) |
|---|---|---|---|---|
| Starting price (in Stripe only) | free | about $149/month | about $299/month | +$49/month, on any plan |
| Directory listing, claim, listing proposals | yes | yes | yes | — |
| Shop Settings, price list, tiers, Shop Floor, estimates for the shop's own people | yes | yes | yes | — |
| **Takes orders through RoofCoil**: in the picker, `?shop=` link, "Order from this shop" on the supplier page | no | yes | yes | — |
| People: members, plus pending invites when inviting | 2 | 5 | 15 | — |
| Bases used for nearest-shop routing | 1 (the first) | 1 (the first) | up to 10 | — |
| Text alert on new orders (`order-sms`, §9.1) | — | yes | yes | — |
| Pinned first in the directory and the picker, with a "Featured" label | — | — | — | yes |

The Shop vs Pro split is a starting point: seats and bases are the only differences that have a gate today (decision 5). "The first" base is the first `locations` entry with coordinates, else the listing pin (the app's `shopBases` rule, `App.jsx:649-659`). When a shop has more members than its plan's seats, **nothing is deleted**: owners and the oldest staff members keep access, and the newest staff members are inactive until the plan covers them again. A downgrade applies at once. A lapse applies 30 days after the plan stopped counting, so the crew can finish jobs in progress (§4.1, §4.3 row 10, §6.2, decision 5). Featured is sold on any plan, Listing included. It is placement in the directory, which is free, and it costs RoofCoil nothing to deliver. A Listing-plan shop paying for it is the funnel working.

### 2.2 Prices live in Stripe; the code knows plan keys

- **Limits** live in one table, `billing_plans` (§3.1): `takes_orders`, `seats` and `bases` per plan key. They change only by migration. **No amount appears in code, SQL or the app.**
- **Stripe** holds three Products with metadata `roofcoil_plan` = `shop` | `pro` | `featured`. Each Product has a monthly Price with lookup key `roofcoil_shop_monthly`, `roofcoil_pro_monthly` or `roofcoil_featured_monthly` (plus `_annual` variants if decision 7 says yes). Prices are tax-exclusive.
- **Shop and Pro are separate Products** because the Portal allows one Price per Product per interval. Stripe schedules a Portal downgrade at the period end only between Prices of the same Product, so a switch between Shop and Pro takes effect immediately (§5.5, §6.2).
- **Selling** uses the lookup key: `billing-session` calls `prices.list({ lookup_keys, active: true })`. **Interpreting** uses the Product's metadata: the webhook maps a subscription item to a plan through `price.product.metadata.roofcoil_plan`, never through the lookup key or the amount. When a price changes later, the lookup key moves to the new Price (`transfer_lookup_key`), and shops still on the old Price keep mapping to the right plan.
- The plan card shows prices it gets from `billing-session` (`action: "prices"`), which reads the three lookup keys and caches the answer for 10 minutes in the function instance.
- **Not the Stripe Entitlements API.** With three plans and one add-on, a lookup-key and metadata map is simpler. Entitlements belong to the Customer, not the subscription. Stripe's docs don't say how they behave during `past_due`, which grace needs. Seat counts can't be expressed as numbers. Feature changes reach existing subscriptions only at the next period. It can be adopted later without changing the gates.

---

## 3. Data model

### 3.1 Tables

```sql
-- One row. Which Stripe mode counts, and who may buy before plans open (§12 c, j).
create table public.billing_config (
  id            boolean primary key default true check (id),
  livemode      boolean not null default false,   -- a Stripe row grants access only when its livemode equals this (§4.1)
  plans_open    boolean not null default false,   -- false: billing-session and the plan card serve only test_shop_ids
  test_shop_ids uuid[]  not null default '{}'     -- the hidden test shops (B and C, §14) while plans are closed; set before their claims
);
insert into public.billing_config default values;

-- Limits per plan. The only place they live; changed by migration.
create table public.billing_plans (
  key          text primary key check (key in ('listing', 'shop', 'pro')),
  rank         int  not null unique,
  takes_orders boolean not null,
  seats        int  not null check (seats >= 1),   -- shop_members rows; pending invites also count when inviting
  bases        int  not null check (bases >= 1)    -- entries of directory_listings.locations used for routing
);
insert into public.billing_plans values ('listing', 0, false, 2, 1), ('shop', 1, true, 5, 1), ('pro', 2, true, 15, 10);

-- One Stripe Customer per shop (strict 1:1, so a Customer's subscriptions always map to one shop).
create table public.shop_billing (
  shop_id               uuid primary key references public.shops(id) on delete restrict,
  stripe_customer_id    text unique,              -- created by billing-session at the first Checkout; cleared on customer.deleted
  previous_customer_ids text[] not null default '{}',
  customer_generation   int  not null default 0,  -- part of the customers.create idempotency key; bumped when a Customer is replaced
  livemode              boolean,
  checkout_session_id   text,                     -- the shop's one open Checkout Session (§5.2)
  checkout_claimed_at   timestamptz,
  offer_coupon          text,                     -- founding coupon for the next plan Checkout; set by a platform admin, cleared once applied
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Every grant of a plan or of Featured: Stripe subscriptions (written only by the webhook and the
-- sync paths, §5.3) and comp/pilot rows (written only by platform-admin functions, the migrations and,
-- until go-live, the pilot trigger on new shops, §3.2). Keyed by the
-- listing id, which is the shop id. That lets a platform admin comp Featured on a listing nobody
-- has claimed yet, and matches orders.shop_id, which references directory_listings too.
create table public.shop_subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  shop_id                 uuid not null references public.directory_listings(id) on delete restrict,
  kind                    text not null check (kind in ('plan', 'featured')),
  plan                    text check (plan in ('shop', 'pro')),              -- kind 'plan' only
  source                  text not null check (source in ('stripe', 'comp', 'pilot')),
  status                  text not null,   -- Stripe's status verbatim (no check: a status Stripe adds later must not fail the webhook); 'active' for comp/pilot
  stripe_subscription_id  text unique,
  stripe_price_lookup_key text,
  livemode                boolean,
  trial_end               timestamptz,
  current_period_end      timestamptz,     -- from the subscription item on current API versions (§5.3)
  cancel_at_period_end    boolean not null default false,
  cancel_at               timestamptz,     -- a dated cancellation (Dashboard "custom date", or cancel_at enums)
  past_due_since          timestamptz,     -- oldest open invoice's finalized_at while status = 'past_due' (§5.3); never null then
  coupon                  text,            -- the coupon on the subscription (founding count, §6.2)
  automatic_tax           boolean,         -- automatic_tax.enabled on the subscription (§10)
  ends_at                 timestamptz,     -- comp/pilot: when the grant ends; null = until a platform admin ends it
  note                    text,
  created_by              uuid default auth.uid(),   -- the platform admin who wrote a comp/pilot; null for Stripe and migration rows
  ended_by                uuid,
  ended_at                timestamptz,     -- comp/pilot: when it was ended; Stripe: the subscription's ended_at (seat wind-down, §4.1)
  state_fetched_at        timestamptz,     -- when the webhook fetched the state written here (stale-write guard, §5.3)
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check ((kind = 'plan') = (plan is not null)),
  check ((source = 'stripe') = (stripe_subscription_id is not null))
);
create index shop_subscriptions_shop on public.shop_subscriptions (shop_id);

-- Idempotency and an audit trail for the webhook.
create table public.stripe_events (
  id           text primary key,           -- evt_…
  type         text not null,
  livemode     boolean not null,
  created      timestamptz not null,       -- event.created: logged, never used to order events
  object_id    text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  result       text                        -- applied | stale | duplicate | ignored | unmapped | duplicate_subscription | paid_after_cancel | pay_declined | alerted | error: …
);

-- Time-based notices already sent (§6.3), so the daily job sends each once.
create table public.billing_notices (
  grant_id  uuid not null references public.shop_subscriptions(id) on delete cascade,
  kind      text not null,                 -- ends_30 | ends_7 | ended | grace_10 | grace_14
  sent_at   timestamptz not null default now(),
  primary key (grant_id, kind)
);
```

There is no unique index on "one current Stripe plan per shop". The webhook must never fail on state Stripe already holds (a failed delivery is retried for 3 days and blocks nothing else). Instead, `billing-session` asks Stripe before opening a plan Checkout and keeps one open session per shop (§5.2). A second current plan that still appears (a Dashboard-made subscription, a race that slipped through) is recorded as `duplicate_subscription` and alerted to the desk; meanwhile the entitlement function takes the best current row. A Stripe subscription's `status` is unconstrained for the same reason.

**Comp and pilot rows are append-only.** `comp_shop` inserts a row and `end_comp` ends one row by id, recording who did it. A later comp never overwrites an earlier one (there is no unique index on non-Stripe rows), and the entitlement function picks the best current row.

### 3.2 Grandfathering: the only rows the migrations write

**Go-live** is the day M5 runs (§12 step j): plans open and live mode starts counting. Pilots are dated from it, not from M1, because nobody knows at M1 how long steps a–j will take.

```sql
-- M1. Comp for the operator's shop, selected by slug (data, not an is_default branch).
insert into public.shop_subscriptions (shop_id, kind, plan, source, status, note, created_by)
select s.id, 'plan', 'pro', 'comp', 'active', 'Operator''s shop, comped on the same path as every shop (rule a)', null
from public.shops s where s.slug = 'fortified-sheet-metal';
-- M1. Pilot for every other shop that exists now (CFR Metals and Adax Metals today), ordering on or off:
-- nobody loses what Phase 2 let them do. Open-ended until go-live, when M5 dates it.
insert into public.shop_subscriptions (shop_id, kind, plan, source, status, ends_at, note, created_by)
select s.id, 'plan', 'shop', 'pilot', 'active', null, 'Shop existed before plans; dated at go-live', null
from public.shops s where s.slug <> 'fortified-sheet-metal';
-- The migration raises unless exactly one comp row and one pilot row per other shop were written.

-- M1. Shops that Phase 2's self-serve flow keeps creating between M1 and go-live (a claim approved by
-- domain or by an admin; ensure_shop_for_listing inserts the shop) get the same open-ended pilot.
-- AFTER INSERT on shops; a no-op once plans are open, and for the test shops (their ids are in
-- test_shop_ids before they are claimed, §14 Setup). M4 drops it.
create function public.shops_pilot_before_plans_open() returns trigger
  -- if not (select plans_open from public.billing_config) and not (new.id = any (select unnest(test_shop_ids) from public.billing_config)):
  --   insert into public.shop_subscriptions (shop_id, kind, plan, source, status, ends_at, note, created_by)
  --   values (new.id, 'plan', 'shop', 'pilot', 'active', null, 'Claimed before plans opened; dated at go-live', null);

-- M5 (go-live). Date every open-ended pilot, append-only: end the row the way end_comp does
-- (ended_by null = the migration) and insert its dated successor.
with ended as (
  update public.shop_subscriptions set ends_at = now(), ended_at = now(), updated_at = now()
  where kind = 'plan' and source = 'pilot' and ends_at is null
  returning shop_id)
insert into public.shop_subscriptions (shop_id, kind, plan, source, status, ends_at, note, created_by)
select shop_id, 'plan', 'shop', 'pilot', 'active', now() + interval '90 days', 'Pilot, dated at go-live (decision 6)', null
from ended;
```

| Shop | Row | What it keeps |
|---|---|---|
| Fortified Sheet Metal | `plan pro`, `source comp`, no end date | Ordering, Pro limits; Featured not included (decision 9) |
| CFR Metals | `plan shop`, `source pilot`: open-ended until go-live, then until go-live + 90 days (decision 6) | Ordering until then, at the prices it charges today: before the release that reads the predicate, its owner saves its current numbers (the code seed) as its price list (§12 d, decision 18), so they stop moving with RoofCoil's sample list. From 30 days before the end it sees a "pilot ends" banner with the founding rate, and is emailed (§6.3). If it starts a plan during the pilot, the Stripe trial runs to the pilot's end date (§5.2 trial rule), so it is never charged twice for the same days. The pilot is its trial: starting after the pilot has ended charges at once. |
| Adax Metals | `plan shop`, `source pilot`, as CFR (decision 6) | What Phase 2 gave it: it can still switch ordering on without paying until then (after setting an order email and saving its prices, like every shop), with 5 seats (it has 1 member). Same banner, emails and founding offer as CFR. |
| A shop created between M1 and go-live | `plan shop`, `source pilot`, from the trigger, as CFR | What Phase 2 would have given it: free ordering until go-live + 90 days. A SQL check at steps g and j lists any shop outside `test_shop_ids` with no current plan grant (§12). |
| The 11 unclaimed listings, all 14 listings' place in the directory | none | Unchanged; the listing is free |

A comp is the same kind of row as a paid plan and goes through the same function. It just doesn't come from Stripe. That means no Stripe Customer, no $0 invoices and no tax filings for Fortified. The alternative (a real $0 subscription with a 100% `forever` coupon) would exercise the webhook daily, at the cost of fake invoices (decision 9).

---

## 4. One entitlement function, read by every gate

### 4.1 `shop_entitlement(p_shop)`: the single source of truth

```sql
-- Internal: no API role may call it (§13). Definer functions and the service role read it.
create function public.shop_entitlement(p_shop uuid)
returns table (plan text, takes_orders boolean, seats int, read_seats int, read_seats_until timestamptz,
               bases int, featured boolean, source text, status text, plan_until timestamptz, grace_until timestamptz)
language sql stable security definer set search_path = ''
as $$
  with grants as (
    select s.*,
      case when s.status = 'past_due' then s.past_due_since + interval '14 days' end as grace_until,  -- decision 4
      case
        when s.source <> 'stripe'                then s.ends_at is null or s.ends_at > now()
        when s.livemode is distinct from c.livemode then false    -- a test-mode row never counts in live mode, nor the reverse
        when s.status = 'trialing'               then s.trial_end > now() - interval '1 day'
        when s.status = 'active'                 then s.current_period_end > now() - interval '3 days'
        when s.status = 'past_due'               then s.past_due_since + interval '14 days' > now()
        else false   -- unpaid, canceled, paused, incomplete, incomplete_expired, and any status Stripe adds
      end as current,
      case   -- when the grant stopped (or stops) counting; the seat wind-down runs 30 days from it (decision 5)
        when s.source <> 'stripe'                   then s.ends_at
        when s.livemode is distinct from c.livemode then null
        when s.status = 'trialing'                  then s.trial_end + interval '1 day'
        when s.status = 'active'                    then s.current_period_end + interval '3 days'
        when s.status = 'past_due'                  then s.past_due_since + interval '14 days'
        when s.status in ('incomplete', 'incomplete_expired') then null   -- never granted access
        else coalesce(s.ended_at, s.state_fetched_at)                      -- canceled, unpaid, paused: when Stripe ended it
      end as access_until
    from public.shop_subscriptions s cross join public.billing_config c
    where s.shop_id = p_shop
  ), best as (
    select g.* from grants g join public.billing_plans p on p.key = g.plan
    where g.kind = 'plan' and g.current
    order by p.rank desc, g.ends_at desc nulls first limit 1
  ), wind as (   -- one row (aggregate), nulls when no plan stopped counting in the last 30 days
    select max(p.seats) as seats, max(g.access_until) + interval '30 days' as until
    from grants g join public.billing_plans p on p.key = g.plan
    where g.kind = 'plan' and not g.current and g.access_until > now() - interval '30 days'
  )
  select p.key, p.takes_orders, p.seats,
         greatest(p.seats, coalesce(w.seats, 0)),
         case when coalesce(w.seats, 0) > p.seats then w.until end,
         p.bases,
         coalesce((select bool_or(current) from grants where kind = 'featured'), false),
         coalesce(b.source, 'none'), coalesce(b.status, 'none'),
         coalesce(b.cancel_at, b.ends_at, b.current_period_end), b.grace_until
  from public.billing_plans p left join best b on true cross join wind w
  where p.key = coalesce(b.plan, 'listing');
$$;
```

**Two seat numbers.** `seats` limits new members (the `shop_members` trigger, invites). `read_seats` is what `is_shop_member` seats on read: the current plan's seats, or, for 30 days after a plan stopped counting, that plan's seats if larger (until `read_seats_until`). So a shop whose plan lapses (trial ended without a card, day 15 of a failed card, a cancellation, a renewal whose events never arrived) keeps its whole crew on the Shop Floor and its routed orders for 30 days, and can't add anyone beyond Listing's 2 meanwhile. A Portal downgrade changes the same row's plan instead of ending a row, so it cuts at once (decision 5).

Time is evaluated **when the function is read**. A pilot's end date, a grace period, and a Stripe row whose trial or period passed with no event (a lost or failed webhook) all run out without any event, which is what makes a scheduler unnecessary for access. The bounds give a day after `trial_end` and three days after `current_period_end` for the renewal's events to land; an owner's "Refresh" and a platform admin's resync re-read Stripe when they don't (§5.3). A Stripe row counts only in the mode `billing_config.livemode` names, so a test-mode row left behind on this production database can never grant access after go-live. `past_due_since` is never null while `past_due` (§5.3), so grace always has a date. There is **no `is_default` and no shop name anywhere in it**.

### 4.2 Thin readers

```sql
-- Internal (no API role). The first reason a shop can't take orders right now, or null when it can.
create function public.shop_order_block(p_shop uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when not exists (select 1 from public.shops where id = p_shop) then 'no-shop'
    else (
      select case
        when s.status <> 'active'                       then 'suspended'   -- moderation (staff), unchanged
        when not l.accepts_orders                       then 'off'         -- the owner's switch: intent
        when coalesce(l.order_email, '') not like '%@%' then 'no-email'    -- somewhere to send the order, for every shop
        when not exists (select 1 from public.shop_settings x
                         where x.shop_id = s.id and x.key = 'price-list') then 'no-prices'  -- the shop's own saved prices
        when not e.takes_orders                         then 'no-plan'     -- the plan
      end                                                                  -- null: takes orders
      from public.shops s
      join public.directory_listings l on l.id = s.id
      cross join lateral public.shop_entitlement(s.id) e
      where s.id = p_shop)
  end;
$$;

-- anon, authenticated, service_role. Public by nature: the fact directory_public shows for live listings.
create function public.shop_takes_orders(p_shop uuid) returns boolean
  -- select public.shop_order_block(p_shop) is null

-- anon, authenticated. Whether a listing is featured right now.
create function public.listing_featured(p_listing uuid) returns boolean
  -- select coalesce((select e.featured from public.shop_entitlement(p_listing) e), false)
```

`shop_admin_info` and `my_listings` also return `order_block`, so an owner is told which clause is missing instead of a blanket "your plan has ended" (§8, §4.3 row 12).

The order-email and price-list clauses close today's leaks (§1) for every writer, staff paths included: a shop with no order email, or pricing from RoofCoil's seed, simply does not take orders. So rule (a)'s "same checks" hold at every gate, not only inside `set_shop_ordering`.

**Listing status is deliberately not in the predicate.** A hidden shop keeps taking orders by its `?shop=` link (staff hide listings for directory reasons; `shops.status` is the ordering kill switch). Discovery is a separate rule: `directory_public`, `nearest_ordering_shops` and `shop_slugs` show only `status = 'live'` listings, so a hidden or draft shop is never suggested, preselected or linked from a static page (§4.3 rows 6, 7, 9).

### 4.3 Every call site

| # | Call site | Today | After |
|---|---|---|---|
| 1 | **`submit-order/index.ts:117-126`**, the authoritative gate | reads `shops.status` and `accepts_orders` | `admin.rpc("shop_takes_orders", { p_shop: shopId })` replaces the two reads. False → 400 **"That shop isn't taking orders right now — pick another shop under 'Send this order to'."** It applies to dry runs too (a dry run would otherwise price a lapsed shop) and stays before `next_po_number` (175), so no PO number is burned. The default fallback at 111-116 goes (§9.2): no `shopId` → 400 "Choose a shop under 'Send this order to'." |
| 2 | **`orders` BEFORE INSERT OR UPDATE OF `shop_id`** (new trigger `orders_require_ordering_shop`) | no insert policy; only `submit-order` writes. "staff update" and "shop owner updates routed orders" let a staff login, or a member of two shops, rewrite `shop_id` | On insert, raises the same sentence unless `shop_takes_orders(new.shop_id)`. On update, raises whenever `new.shop_id is distinct from old.shop_id` **and `new.shop_id` is not null**: an order is never re-routed through the API, and the FK's own `ON DELETE SET NULL` (`orders_shop_id_fkey`, an update of `shop_id` that fires this trigger) still lets a listing whose shop is gone be deleted. Members can't null it (their update policy requires `shop_id is not null`), and "staff update" is dropped in M3. Defence in depth for any future writer. |
| 3 | **`set_shop_ordering`** (`App.jsx:3892`) | owner/staff; email and price checks except for the default shop | new reply `'needs-plan'`, checked first on switch-on; the `dflt` exemption is dropped; **switching off is never refused**. Owner only from M3 (§9.4). |
| 4 | **`set_shop_contact`** | default shop may clear its email while live | exemption dropped: no shop taking orders may clear its email. Owner only from M3. |
| 5 | **`ordering_shop_by_ref`** (`App.jsx:4687`) | `status = 'active' and (accepts_orders or is_staff())` | `shop_takes_orders(s.id) or (s.status = 'active' and is_staff())`. A platform admin can still open any active shop's customer view, which shows only public sell prices (costs stay stripped); it **keeps `is_staff()` after M3** and is not one of the six owner RPCs in §9.4. Not filtered on listing status: the link is how a hidden shop is reached. |
| 6 | **`shop_slugs()`** (prerender, `prerender.mjs:129`) | active and `accepts_orders` | `where l.status = 'live' and shop_takes_orders(s.id)`. A static page built before a lapse keeps its link until the next build; the link then resolves to nothing and shows the notice (§9.2). |
| 7 | **`directory_public`** (picker `App.jsx:4673`; `suppliers.html:573`; `prerender.mjs:122`) | `accepts_orders` and `featured` are the raw columns | the same column names become `shop_takes_orders(l.id) as accepts_orders` and `listing_featured(l.id) as featured` (`create or replace view`, same order and types, still `security_invoker`). **No reader changes**, and the view still filters only on listing `status = 'live'`, so **a lapsed shop keeps its free listing**. |
| 8 | **`my_shops()`**, **`shop_admin_info()`**, new **`shop_billing_info()`**, new **`my_listings()`** | raw `accepts_orders` | `my_shops` gains `takes_orders`, `plan` and `seated` (dropped and recreated in M1, as in Phase 2), so a member's Send on a lapsed own shop is refused in the app before the call, and an inactive member is told why. `shop_admin_info` gains `takes_orders`, `order_block` and the plan fields (M1; it keeps `is_default` for the old build until M4). The member pre-Send guard (`App.jsx:5887`, `shopInfo.accepts_orders` today) reads `takes_orders` and words the toast from `order_block` (§8). `shop_billing_info` feeds the plan card (§8). `my_listings` feeds `manage-listing.html` (§9.4). |
| 9 | **`nearest_ordering_shops()`** (new, replaces the browser's Nominatim routing) | — | only `status = 'live'` listings where `shop_takes_orders`, using at most `bases` locations each; `p_limit` clamped to 10 and `p_radius` to 500 inside the function (§9.2) |
| 10 | **Seats**: `shop_members` BEFORE INSERT trigger `shop_members_seat_limit`; `invite_shop_member`; `accept_shop_invites_for`; **`is_shop_member`** | no limit | The trigger locks the `shops` row and raises `seat-limit` at `seats` members, **unless a row for `(new.shop_id, new.user_id)` already exists** (an upsert's conflict path, such as re-inviting a staff member as owner, adds no seat). The listing owner's own membership (`ensure_shop_for_listing`) is always allowed. `invite_shop_member` answers `'seat-limit'` when members plus pending invites reach `seats`, counting only an invite that would add someone: an email that resolves to an account already a member of the shop (re-inviting, staff → owner) skips the check, matching the trigger's exemption. `accept_shop_invites_for` **leaves an over-limit invite pending instead of raising**, because it runs inside the `customers` insert trigger, and an exception there would abort the sign-up. **Seats are also enforced on read**: `is_shop_member(p_shop)` (M2) is true for owners and for the oldest `read_seats − owners` staff members (by `created_at`, then `user_id`), through an internal helper `shop_member_seated(p_shop, p_user)`. So a downgrade can't keep extra seats; after a lapse the last plan's seats hold for 30 days (§4.1); nothing is deleted. |
| 11 | **`notify_listing_live`** → `listing-alert:116` (the listing-live email) | sends the raw `accepts_orders`, so a shop with no plan is told "Ordering is switched on" | sends `public.shop_takes_orders(new.id)` under the same key (M2), so the email's existing wording is true. |
| 12 | **`manage-listing.html:226`** (owner's ordering note) | "Ordering is on for …" from the raw column | reads `takes_orders`, `plan` and `order_block` from `my_listings()`: with the switch on and the shop not taking orders, "Ordering is on but paused: " plus the reason's line from §8 (for `no-plan`, "no plan — start one in Shop Floor → Shop Settings."). |
| 13 | **Setup checklist "Go live"** (`App.jsx:3877`) | ticked from the raw switch | stays the switch (the owner's intent). The new required **Plan** step and the status line ("Ordering is on but paused: …") carry the paused state (§8). |
| 14 | **`directory-admin.html`** list badge (722) and editor chip (757) | "🛒 takes orders" and the chip from the raw column | the badge reads `takes_orders` from `staff_listings()`; the chip becomes a read-only line ("Owner's switch: on · Takes orders: no — no plan"), since the PATCH stops sending the column in S1 (§9.4) |
| 15 | **`validate_listing_edit`** (listing proposals) | its allowlist includes `accepts_orders` and `order_email` | M3 removes both, so a proposal of either is refused with "field … cannot be proposed" instead of being filed and then silently skipped (owners set them in Shop Settings, §9.4 S1) |
| — | **Not gated, on purpose** | | `order-alert` and status emails for existing orders; the Shop Floor (jobs in progress finish; the crew keeps the last plan's seats for 30 days after a lapse, §4.1); `customer_price_list`; Shop Settings; listing emails other than the listing-live line; the directory card itself; `set_shop_slug`'s rename lock, which stays on the raw switch so a paused shop's link doesn't move (§4.4). |

### 4.4 Why the switch stays the owner's intent

A lapse does not write `accepts_orders = false` and does not set `shops.status = 'suspended'`. Writing false would discard the owner's choice: the owner would have to switch ordering back on after paying, the slug rename would unlock (`App.jsx:4009`), and the shop's links would fall through to whatever the app preselects. Suspending would overload the moderation switch and leave the shop in the picker, failing at Send. Reading entitlement at the gates means a payment turns ordering back on the moment the webhook lands. It also means the staff PATCH, applied edits and inserts (§1) cannot make an unentitled shop orderable, with no trigger on `directory_listings` needed. From M3 no platform-admin path writes `accepts_orders` or `order_email` at all (§9.4).

---

## 5. Stripe: starting and managing a plan

### 5.1 Starting a plan

```
Owner — Shop Floor → Shop Settings → Plan → "Start Shop trial"
  │ click handler: POST /functions/v1/billing-session  {shopId, action:"checkout", plan:"shop", interval:"month"}  Bearer <access token>
  ▼
billing-session
  getUser(token) ── fail → 401 "Sign in to manage your plan."
  shop_members(shop_id, user_id, role = 'owner')? ── no → 403 "Only the shop's owners can change its plan."   (no is_staff, no can_manage_shop)
  billing_config: plans_open, or shopId in test_shop_ids? ── no → 503 "Plans aren't open yet."
  shop_billing.stripe_customer_id ── none, or customers.retrieve says deleted / resource_missing
        → customers.create({name, email, metadata:{shop_id}}, idempotencyKey "shop-customer-<id>-<generation>") → upsert
  Customer email not a current owner's → customers.update({email, name}) to the earliest current owner (§6.2)
  subscriptions.list({customer, status:"all"}), items classified through the product map (§5.2):
        a plan in trialing | active | past_due | unpaid | incomplete | paused? ── yes → 409 "This shop already has a plan — use Manage billing."
  a current open-ended pilot or comp plan grant? ── yes → 409 "RoofCoil covers this shop's plan for now."   (trial rule, §5.2)
  claim the shop's checkout slot (shop_billing.checkout_claimed_at older than 1 min, else 409 "Checkout is already opening — try again in a minute.")
  shop_billing.checkout_session_id still open → checkout.sessions.expire(it)       ← one open session per shop
  price = prices.list({lookup_keys:["roofcoil_shop_monthly"], active:true})
  checkout.sessions.create({...§5.2, expires_at: now + 35 min}) → store its id → {url}
  ▼
app: (window.top !== window.self ? window.top : window).location.assign(url)     ← never inside the members.html frame
  ▼
checkout.stripe.com (hosted page) ── success_url ──► https://<same origin><app path>?shop=<slug>&billing=success&session={CHECKOUT_SESSION_ID}
  ║ meanwhile: checkout.session.completed, customer.subscription.created ──► stripe-webhook ──► shop_subscriptions
  ▼
app: opens Shop Floor → Shop Settings, "Confirming your plan…": billing-session {action:"sync", session} once, then polls shop_billing_info
     → trial banner; "Switch on" enabled
```

### 5.2 `billing-session` (owner only)

- **Skeleton.** It copies `submit-order`'s: OPTIONS/POST guard, the `json()` helper, a module-level service-role client, and token → `admin.auth.getUser(token)` (93-96).
- **Ownership** is checked with a direct `shop_members` select (`role = 'owner'`) on the service-role client. `is_shop_owner()` would see a null `auth.uid()` there, and `can_manage_shop()` admits every platform admin until M3. Platform admins never buy for a shop; they comp (§6).
- **Test mode is confined.** While `billing_config.plans_open` is false, every action except `prices` answers 503 "Plans aren't open yet." for any shop not in `billing_config.test_shop_ids`, and `shop_billing_info` returns `plans_open = false`, so the card hides the buttons. Only the hidden test shops can create Stripe objects before go-live (§12 c–j).
- **Classifying a listed subscription.** `subscriptions.list` can't expand each item's Product (`data.items.data.price.product` is five levels; Stripe allows four). So `_shared/billing.ts` keeps a product map, `products.list({ limit: 100 })` filtered on `metadata.roofcoil_plan` and cached for 10 minutes in the function instance, and classifies a listed item by its `price.product` id. The 409 checks, `firstPlanEver`, the Featured 409 and `sync` without a session all use it; a Product missing from the map refreshes it once. The webhook's single `subscriptions.retrieve` keeps its four-level expand (§5.3).
- **CORS** uses the `api/scan-sketch.js:16-27` allowlist, not `*`, minus `fortifiedmetals.com` (§8). It includes `*.vercel.app` and localhost only while the keys are test keys.
- **Actions.**
  - `checkout` (a plan) and `featured` (the add-on), as in §5.1.
  - `portal`.
  - `sync` (owner): with a `session`, it retrieves that Checkout Session (its `customer` must equal the shop's), then its subscription; without one, it lists the shop Customer's subscriptions. Each goes through the same mapping and `billing_apply_subscription` as the webhook (shared module `_shared/billing.ts`), so it is idempotent and stale-safe. The card offers it as "Refresh" when "Confirming…" times out.
  - `resync` (platform admin): the same listing for any shop, or, with a `subscription` id, that one subscription (retrieved directly, so it also repairs a row whose Customer was since deleted or replaced, §6.2). It applies state regardless of event ids, which a Dashboard resend cannot do for an event already marked processed. Authorized like ownership: `select 1 from public.staff where id = <user.id from getUser>` on the service-role client, since `is_staff()` would see a null `auth.uid()` there; anyone else gets 403.
  - `prices` (any signed-in account; §2.2).
  - `billing_contact` (internal; `x-alert-secret` instead of a user token, called by the pg_net trigger on owner changes, §6.2): sets the Customer's email and name to the earliest current owner's.
- **Errors.** Stripe errors are logged with `console.error("billing-session", …)` and returned as 502 "Couldn't open checkout — try again." Missing Stripe secrets return 503 "Plans aren't open yet." That is how the function ships dormant. If Checkout rejects the founding discount (coupon deleted or expired), the session is created again without it and the reply says "The founding rate isn't available — you're on the standard price."

```js
// checkout (plan). Endive (2026-09-30): payment_method_types is gone; allowed_payment_method_types replaces it (confirm semantics when coding).
{ mode: "subscription", customer, client_reference_id: shopId, metadata: { shop_id: shopId },
  line_items: [{ price, quantity: 1 }],
  subscription_data: {
    metadata: { shop_id: shopId, kind: "plan" },
    description: `RoofCoil ${planName} — ${shopName}`,
    trial_end: grantEnd ? Math.max(grantEnd, nowSeconds + 48 * 3600) : undefined,   // trial rule (below); Stripe: ≥ 48 h away
    trial_period_days: !grantEnd && firstPlanEver ? TRIAL_DAYS : undefined,          // never both
    trial_settings: { end_behavior: { missing_payment_method: "cancel" } } },
  allowed_payment_method_types: ["card", "link"],                    // immediate methods only: no ACH or other delayed debits
  payment_method_collection: "if_required",                          // decision 3: no card to start a trial
  discounts: offerCoupon ? [{ coupon: offerCoupon }] : undefined,
  allow_promotion_codes: offerCoupon ? undefined : true,             // never both on one session
  consent_collection: { terms_of_service: "required" },              // terms page with the plan, routing and visibility rules (§12 e, decision 19)
  billing_address_collection: "required", customer_update: { address: "auto", name: "auto" },
  tax_id_collection: { enabled: true }, automatic_tax: { enabled: AUTOMATIC_TAX },   // §10
  expires_at: nowSeconds + 35 * 60,                                  // Stripe allows 30 min–24 h after creation; 35 so latency can't land under 30
  success_url: `${ret}&billing=success&session={CHECKOUT_SESSION_ID}`, cancel_url: `${ret}&billing=cancel` }
```

- **Immediate payment methods only.** A delayed method such as ACH Direct Debit can make a subscription `active` at once, and if the debit fails later Stripe voids the invoice while the subscription stays `active`, which this entitlement would honour. Both Checkouts allow card and Link only, and the account's default payment method configuration (which the Portal's payment-method update uses) is set to the same two in step c; the sandbox test confirms ACH is not offered (§14.10). If a delayed method is ever wanted, an `active` subscription whose latest invoice is void must stop counting first.
- **Trials** use subscription-level `trial_period_days`, which Stripe now calls "legacy", **on purpose**: subscriptions that use Trial Offers cannot be updated in the Portal, and Portal plan switching matters more here.
- **Trial rule** (decision 6), decided by `billing-session` from the shop's grants:
  - A **current pilot or dated comp** plan grant: `trial_end` = that grant's `ends_at`, raised to 48 hours from now when it ends sooner (Stripe's minimum for `trial_end`). The shop keeps what it has and is first charged when the grant ends, never twice for the same days. With several, the latest end wins.
  - A **current open-ended** pilot or comp (Fortified's comp; any pilot before go-live): 409 "RoofCoil covers this shop's plan for now." There is no end to start billing from.
  - Otherwise, a 30-day trial (`trial_period_days`) when `firstPlanEver`, else none.
  - **`firstPlanEver`** is true when the Customer has no plan subscription in Stripe's list (any status), and the shop has no `source = 'stripe'` plan row and **no `source = 'pilot'` row**. A pilot is the shop's trial: a pilot shop that lets its pilot end and starts later is charged at once (at the founding rate when flagged), so starting before the end keeps ordering continuous at no extra cost. A comp (the operator's, an incident comp) doesn't use up the trial.
- **`featured`** is a second Checkout in subscription mode on the same Customer. Its one line item is `roofcoil_featured_monthly`, with `metadata.kind = 'featured'`, no trial and no coupon. It is refused (409) if Stripe's list already has a current Featured subscription, and it shares the shop's one-open-session slot. Featured is its own single-item subscription because a second item on the plan subscription would make the plan impossible to update in the Portal (Stripe: multi-product subscriptions can be cancelled there but not updated).
- **`portal`**: `billingPortal.sessions.create({ customer, return_url })`, with an optional `flow_data: { type: "payment_method_update" }` for the past-due "Update card" button. It needs a `shop_billing` row. The new card becomes the Customer's default, which is the only place a card lives (§5.3), so it is what renewals, retries and trial ends charge.
- **Return URLs** are built here, never taken from the body. The origin comes from the `Origin` header checked against the allowlist. The app path is `/` on `shop.roofcoil.com` and `/app` on `www.roofcoil.com` and `roofcoil.com`. Then `?shop=<slug>`. Returning to the **same origin** keeps the session, because supabase-js stores it per origin.
- **Settings** are read with `setting()` (env first, then Vault, like the other functions): `STRIPE_SESSION_KEY`, `BILLING_TRIAL_DAYS`, `BILLING_AUTOMATIC_TAX`. The client is `import Stripe from "npm:stripe@23.0.1"` with `new Stripe(key, { apiVersion: "2026-09-30.endive", httpClient: Stripe.createFetchHttpClient() })`. That matches the repo's `npm:` imports (no esm.sh) and pins the API version.
- **Keys: two restricted keys, never a full secret key.** Function secrets are project-wide and readable by every function, including `scrape-site` and `signup-direct`, which are not in the repo and are reviewed before Stripe secrets are added (§12 c).
  - `STRIPE_SESSION_KEY` (billing-session): Checkout Sessions write, Customer portal write, Customers write; Prices, Products, Coupons, Promotion codes, Subscriptions and Invoices read.
  - `STRIPE_WEBHOOK_KEY` (stripe-webhook): Subscriptions write, Invoices write, Customers write; Products and Prices read.
  - Each key's request log is checked for permission errors after the sandbox run (§14.7), before step j.

### 5.3 `stripe-webhook`

```
Stripe ── POST /functions/v1/stripe-webhook  (verify_jwt = false; Stripe-Signature is the only authentication) ──►
 1  body = await req.text()      ← raw body, before any JSON parse
    event = await stripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET, undefined, Stripe.createSubtleCryptoProvider())
                                                                         bad or stale signature → 400
 2  event.livemode ≠ STRIPE_LIVEMODE                                     → 200, result 'ignored'
 3  insert into stripe_events (id, type, livemode, created, object_id) on conflict do nothing
    row exists with processed_at set                                      → 200, 'duplicate'
 4  by object:
      customer.deleted                → shop_billing: id moved to previous_customer_ids, generation + 1; then each of that
                                        shop's Stripe rows not yet canceled/incomplete_expired is re-fetched by
                                        stripe_subscription_id and applied as in 5–6 (Stripe cancels them)          → 'applied'
      customer.updated (default card changed) → for each past_due subscription of the Customer: invoices.pay(oldest open invoice,
                                        idempotency key "pay-<invoice>-<payment method>"); a card decline, an invoice
                                        already paid or no longer open is handled, not retried                    → 'applied' | 'pay_declined'
      charge.dispute.created          → desk alert                                                          → 'alerted'
      otherwise subscription id ← subscription.id | checkout.session.subscription
                                  | the invoice's subscription (invoice.parent.subscription_details.subscription on current versions)
      none                            → 'ignored', 200
 5  sub = stripe.subscriptions.retrieve(id, { expand: ["items.data.price.product"] }); fetched_at = time of the request
    if past_due: invoices.list({ subscription: id, status: "open" }) → oldest finalized_at
 6  rpc billing_apply_subscription(…, fetched_at)                         → 'applied' | 'stale' | 'unmapped' | 'duplicate_subscription'
 7  card hygiene and terminal clean-up (below)
 8  update stripe_events set processed_at = now(), result                 → 200
    any other error in 4–8 (network, Stripe 5xx or 429, a database error) → 500: Stripe retries (live mode: up to 3 days);
    the row stays unprocessed and the retry runs it again. Stripe 4xx answers that a retry can't change (a card error from
    invoices.pay, invoice not open) are results, recorded with 200, never 500.
```

- **Idempotent on the event id** (step 3). Processing itself is idempotent too, so a retry after a half-finished attempt is harmless.
- **Safe out of order.** Step 5 ignores what the event says and fetches the subscription's current state (Stripe: "don't use `created` to determine event order"). Two deliveries racing can still finish in the wrong order. `billing_apply_subscription` writes only if `p_fetched_at > state_fetched_at`, so the later fetch wins and a slower, older fetch returns `'stale'`.
- **The DB write happens before the 2xx**, unlike the alert functions' 202-then-`waitUntil` pattern, which would hide failures from Stripe's retries.
- **Not the only path in.** If events are lost beyond Stripe's retries (endpoint disabled, a bad secret during the step j swap, a misdeploy), the read-time bounds in §4.1 stop a stale `trialing` or `active` row from granting access for long, and the owner's `sync` and the admin's `resync` (§5.2) write current state through the same function.
- **Mapping.** The shop comes from `sub.metadata.shop_id`, cross-checked against `shop_billing` for `sub.customer`, which may be the shop's `stripe_customer_id` **or one of its `previous_customer_ids`** (a Dashboard-made subscription without metadata maps through the Customer the same way). So a `customer.subscription.deleted` that arrives after `customer.deleted` still cancels the row instead of being `unmapped`. **Kind and plan come from the Product metadata of the subscription's items**: exactly one item must carry `roofcoil_plan`, and its value gives the kind (`featured`, else `plan`) and the plan. Several RoofCoil items, none, a `metadata.kind` that disagrees with the Product (a Featured subscription whose price an admin swapped to Pro), or a metadata/Customer mismatch is recorded as `'unmapped'`, returns 200 (a retry cannot fix it) and is alerted to the desk, instead of writing or throwing.
- **A second current plan.** When the applied row is a current plan and the shop already has another current Stripe plan row, the result is `'duplicate_subscription'` and the desk is alerted to cancel and refund the newer one in the Dashboard. The entitlement takes the best row meanwhile, and `billing_lapsed` is not sent while another current plan row remains (§6.3).
- **Field sources.**
  - `current_period_end` comes from the subscription item (it moved off the Subscription in Basil, 2025-03-31).
  - `past_due_since` is the oldest open invoice's `status_transitions.finalized_at` while the status is `past_due`. If that is null (a draft), it is the first time this row was seen `past_due`, which is kept. It is cleared on any other status.
  - `cancel_at_period_end` and `cancel_at` are both stored; a Dashboard "custom date" cancellation sets only `cancel_at`.
  - `coupon` is the subscription's discount coupon id; `automatic_tax` is `automatic_tax.enabled`.
  - Check every path against the pinned Endive reference when coding.
- **Card hygiene (step 7): one place for the card.** A subscription started through Checkout can carry its own `default_payment_method`, which Stripe charges and retries before the Customer's default, while the Portal's card update sets only the Customer's default. So on `checkout.session.completed` and `customer.subscription.created`, when the subscription has a `default_payment_method`, the webhook sets it as the Customer's `invoice_settings.default_payment_method` and clears it on the subscription. Every subscription then follows the card the Portal edits. That also covers a no-card plan trial plus a Featured Checkout with a card: the trial end finds the Customer's default and charges it, instead of cancelling the plan. On `customer.updated` with a new default card, an open invoice of a `past_due` subscription is paid at once (`invoices.pay`) rather than at Smart Retries' next attempt. **One attempt per card**: the idempotency key is per invoice and payment method, and a decline is recorded as `pay_declined` with a 200, so a redelivery never charges a failing card again on top of Smart Retries (card networks penalise excessive reattempts). Confirm in the sandbox which field Checkout writes (§14.9).
- **Terminal clean-up (step 7).** On `customer.subscription.deleted` with `cancellation_details.reason = 'payment_failed'`, the subscription's open invoices are voided, so a late payment can't be taken for a subscription that can no longer be revived (Stripe: a cancelled subscription is terminal). An `invoice.paid` on an invoice whose subscription is cancelled is recorded as `'paid_after_cancel'` and alerted to the desk to refund or comp.
- **Events** the endpoint subscribes to: `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`, `.trial_will_end`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.finalization_failed` (also alerted, because `requires_location_inputs` blocks tax), `customer.updated`, `customer.deleted`, `charge.dispute.created`. **`invoice.created` is deliberately not subscribed**: Stripe delays finalization up to 72 hours when that event gets no 2xx.
- **`billing_apply_subscription(p_shop, p_kind, p_plan, p_sub_id, p_status, p_lookup_key, p_livemode, p_trial_end, p_period_end, p_cancel_at_period_end, p_cancel_at, p_past_due_since, p_coupon, p_automatic_tax, p_ended_at, p_fetched_at) returns text`** is service-role only. `p_ended_at` is the subscription's `ended_at` (the seat wind-down, §4.1). It is an upsert on `stripe_subscription_id` with the stale guard in the `do update … where` clause. It also clears `shop_billing.offer_coupon` when `p_coupon` equals it, and `checkout_session_id` when the subscription came from it.
- **Settings**: `STRIPE_WEBHOOK_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_LIVEMODE`, all through `setting()`. Test and live endpoints have different signing secrets; only one mode is accepted at a time (§12).
- **`supabase/config.toml`** (new) sets `verify_jwt = false` for `submit-order`, `order-alert`, `listing-alert`, `signup-email`, `billing-session` and `stripe-webhook`. That matches the deployed metadata, so a CLI deploy cannot 401 the pg_net callers or Stripe. `scrape-site` and `signup-direct` are not in the repo and are left alone.

### 5.4 Top-level, never in a frame

The Stripe Portal refuses framing (`frame-ancestors 'none'`). Stripe also says not to put Checkout inside another iframe. The members.html frame is same-origin and unsandboxed (`members.html:133`), so the click handler sends the top window to the URL. A new tab opened after an `await` would be popup-blocked, and the app's existing `window.open` pattern (875-878) opens before it knows the URL. Embedded Checkout (`embedded_page`) is rejected for the same nesting reason. The return lands on the full-screen app (`/app?shop=…&billing=…`), not back inside members.html; members.html's own "Open full screen" link (131) points at the same app.

### 5.5 Portal configuration (Dashboard, test then live)

- **Turned on:** invoice history; payment method update (card and Link, through the account's default payment method configuration, §5.2); customer updates for address, email, name and tax id.
- **Cancel:** `at_period_end`, collecting a reason.
- **Plan switching:** `subscription_update` with the Shop and Pro Products (monthly, plus annual if offered: same Product, different interval, which Stripe allows).
  - **Immediate, both ways.** Stripe's "Manage downgrades" schedules a change at the period end only between Prices of the same Product, and Shop and Pro are separate Products (§2.2). It stays at "update immediately" (decision 20).
  - `proration_behavior: always_invoice`, so an upgrade is invoiced and paid when it is made, and a downgrade credits the unused time to the next invoice.
  - A downgrade's extra members go inactive at once through the seat check on read (§4.3 row 10), so upgrading, adding people and downgrading gains nothing.
  - `trial_update_behavior: continue_trial`, so switching during a trial keeps the trial.
  - Verify the same-Product rule and the proration in the sandbox (§14.11).
- **No promotion codes in the Portal.** The founding coupon is applied by `billing-session`.
- **Featured** is not in the plan-switching Products, so the Portal offers it Cancel only.
- **Business profile**: the terms and privacy URLs.

---

## 6. Plan lifecycle

### 6.1 States

```
                 Start a plan (Checkout)                 trial ends, card on file
  Listing ─────────────────────────────► trialing ────────────────────────────────► active ◄────────────┐
  (no current       ▲                       │ trial ends, no card                    │ renewal fails   │ paid (card updated
   plan row)        │                       ▼ (missing_payment_method: cancel)       ▼                 │  → invoice paid at once)
                    └────────────────── canceled ◄──── retries exhausted ──────── past_due ────────────┘
                     new Checkout          ▲          (open invoices voided)      orders continue for 14 days,
                                           │          (Dashboard: cancel)         then paused while Stripe retries
                                           └──── period end after "Cancel plan" (cancel_at_period_end / cancel_at)
```

### 6.2 Rules

| Situation | What happens | Why |
|---|---|---|
| **Trial** | 30 days (decision 2), Shop or Pro, full plan. Card not needed to start (`payment_method_collection: if_required`). One trial per shop. | The lowest-friction start for a shop that has never paid for software like this; the Portal adds the card later. |
| **Trial ends without a card** | Stripe cancels the subscription. The shop is on Listing: ordering paused, the switch still on, the listing untouched. "Start a plan" opens Checkout, which now collects a card (no second trial); ordering resumes as the webhook lands. A card added in the Portal, or through a Featured Checkout, is the Customer's default (§5.3), which the trial end checks. | `cancel` needs no resume endpoint, which `pause` would. |
| **Founding rate** | A Stripe coupon `founding` (proposed: one third off, `forever`, `applies_to` the Shop and Pro Products, **no `max_redemptions`**; decision 6). A platform admin flags a shop with `set_shop_offer(p_shop, 'founding')`, which refuses a sixth shop. The count is the distinct shops that either have `shop_billing.offer_coupon = 'founding'` or have a `kind = 'plan'` Stripe row with `coupon = 'founding'`, `livemode = billing_config.livemode` and a status of `trialing`, `active` or `past_due`. Its next plan Checkout carries `discounts`, and the webhook clears the flag once the coupon is on a subscription. A founding shop that lapses frees its slot, and its rate goes with the cancelled subscription; on return a platform admin may flag it again if a slot is free. Other shops get `allow_promotion_codes`. | The cap lives in our flag, not in a global redemption count, so trials that never convert can't use up the slots and an exhausted coupon can't make Checkout fail. A `forever` coupon keeps the rate through later price changes. A second "founding" Price would break the Portal, which forbids two prices of one product at one interval. |
| **Payment fails** (`past_due`) | **Orders continue for 14 days** from the oldest unpaid invoice's finalization (decision 4), with an amber banner, a RoofCoil `billing_past_due` email giving the cut-off date (§6.3) and Stripe's failed-payment email. "Update card" changes the Customer's default card and the webhook pays the open invoice at once (§5.3). Smart Retries is set to the 2-week window. **From day 15, while Stripe is still retrying**, ordering is paused and the card says "Payment overdue — ordering paused" with Update card (not Start a plan: the plan still exists). | Matches Stripe's default 8-tries-in-2-weeks window. |
| **Retries exhausted** | Stripe **cancels** the subscription; the webhook voids its open invoices. The shop is on Listing; the card's only action is "Start a plan", a new Checkout. A payment that lands anyway (`paid_after_cancel`) alerts the desk to refund or comp. | Cancel (not "unpaid") gives a terminal state and a known end date. A cancelled subscription can't be revived by paying its old invoice. |
| **Seats after a lapse** | Any lapse (trial ended without a card, day 15 of a failed card, a cancellation taking effect, a renewal whose events never arrived): ordering pauses at once, but every member keeps access for **30 days** from when the plan stopped counting (`read_seats`, §4.1), so jobs in progress finish and routed orders stay readable. New members are refused beyond Listing's 2 meanwhile. After the 30 days, the newest staff members beyond 2 are inactive; nothing is deleted. | The Shop Floor is "not gated, on purpose" (§4.3); a lapse shouldn't cut a crew off mid-job, and 30 days is too short to run a shop on a lapsed plan's seats. |
| **3-D Secure required** | `invoice.payment_action_required` → Stripe's email asks the owner to authenticate. The status is `past_due` (grace applies) or `incomplete` on a first payment (no access yet). | Stripe's documented semantics. |
| **Cancel** | Portal, at period end: the banner shows "Ends on <date>; ordering stops then", the date being `cancel_at` when set, else the period end. The plan can be renewed in the Portal until then. After the period: canceled → Listing. | No refunds to compute; the shop keeps what it paid for. |
| **Upgrade** Shop → Pro | Portal, invoiced and paid immediately for the rest of the period (`always_invoice`); seats 15 and bases 10 at once. | |
| **Downgrade** Pro → Shop | Portal, **immediate** (Stripe schedules a period-end downgrade only within one Product, §5.5); the unused Pro time is credited to the next invoice. Routing uses the first base only. Members beyond 5 (the newest staff first) become **inactive**: they keep their accounts and their membership rows, the card lists them, and they regain access when the plan covers them again. **Nothing is deleted.** | Seats enforced on read, so a round trip through Pro can't keep Pro's seats. |
| **Featured removed** | Portal cancel at period end; `featured` turns false when the subscription ends. Independent of the plan, so cancelling the plan leaves Featured running until its own end. | |
| **Comp / pilot** | Written and ended only by platform admins: `comp_shop(p_listing, p_kind, p_plan, p_source, p_until, p_note) returns uuid` inserts a row, and `end_comp(p_grant)` ends that row (`ends_at = now()`, `ended_by`, `ended_at`). The only other writers are the migrations (M1's grandfather rows, M5 dating the pilots the same end-and-insert way) and, until go-live, the new-shop pilot trigger (§3.2). Rows are never updated otherwise or deleted; the one exception is M5 deleting the test shops' rows (§12). | Auditable, dated, append-only and visible on the shop's card (with the granting admin), instead of a hidden flag. |
| **Shop suspended** (moderation) | Ordering off (`shops.status` in the predicate), and billing continues. The platform admin cancels or refunds in the Stripe Dashboard. | Moderation and billing stay separate. |
| **Owners change** | An owned listing changes owner only by the owner's own invite or a dated dispute (§9.3). Any change to a shop's owners (an owner removed or demoted, `ensure_shop_for_listing` swapping the owner) fires a pg_net call to `billing-session` (`billing_contact`, §5.2), which sets the Stripe Customer's email and name to the earliest current owner. `billing-session` also checks this on every call. So Stripe's receipts, invoices and failed-payment emails stop reaching a former owner. | The Customer stays with the shop; its contact follows the shop's owners. |
| **Disputes** | Dashboard → Billing → subscriptions: "Manage disputed payments" set to cancel the subscription at the period end (step c and j). `charge.dispute.created` alerts the desk. Refunds stay in the Dashboard; entitlement follows the subscription status. | By default a disputed subscription keeps cycling and billing. |
| **Customer deleted in the Dashboard** | Stripe cancels its subscriptions (the shop goes to Listing). `customer.deleted` moves the id to `previous_customer_ids` and re-fetches the shop's open Stripe rows, so they read `canceled` whichever event lands first; a later `customer.subscription.deleted` still maps through `previous_customer_ids` (§5.3), and `resync` with a subscription id repairs any row left over. The next Checkout creates a new Customer with a new idempotency key. | Otherwise every later Checkout or Portal call would fail on a deleted id, and an event order Stripe doesn't guarantee could leave the old row entitled for a period. |

### 6.3 Notices

- **Stripe sends the payment emails**: receipts, failed payment, expiring card and trial-ending reminder (Dashboard → Billing → customer emails; reminders are not sent from a sandbox). The failed-payment and expiring-card emails link to the app's plan card (the Dashboard's custom-link option), not to a Stripe-hosted page.
- **RoofCoil's event-driven notices** go through the established path. A trigger `shop_subscriptions_alert` (after insert or update of `status`, Stripe rows only) posts with pg_net and `x-alert-secret` to `listing-alert`, the same pattern as `notify_shop_invite`:
  - `billing_started` (first `trialing` or `active`) goes to the desk (`LISTING_ALERT_TO`), naming the kind (plan or Featured).
  - `billing_past_due` (**`kind = 'plan'` only**, a move to `past_due`) goes to the shop's owners: "Your card payment failed. Ordering continues until <past_due_since + 14 days>; update your card in Shop Floor → Shop Settings."
  - `billing_lapsed` (**`kind = 'plan'` only**, a move to `canceled`, `unpaid`, `paused` or `incomplete_expired`, **unless `shop_entitlement` still says the shop takes orders**, for instance through a second plan row) goes to the shop's owners and to the desk: "Ordering through RoofCoil is paused because your plan ended. Your listing is still in the directory, and your prices, customers and orders are kept. Start a plan at https://shop.roofcoil.com/ → Shop Floor → Shop Settings."
  - **Featured sends no RoofCoil notice** when its payment fails or it ends: ordering doesn't depend on it, Stripe's failed-payment email covers the card, and the plan card shows "Featured until <date>". So a Listing-plan shop is never told its "plan ended" because Featured did.
  - Owners are resolved by a new lookup (`notify_shop_invite` only reads the inviter's email): `select u.email from public.shop_members m join auth.users u on u.id = m.user_id where m.shop_id = new.shop_id and m.role = 'owner'`.
- **Time-based notices** (decision 16). A pilot or comp reaching `ends_at`, and grace running out on day 14 while Stripe still says `past_due`, change no row, so no trigger fires. Recommended: enable `pg_cron` (available, 1.6.4) for one daily job, `billing_reminders()`. It emails the owners and the desk 30 days, 7 days and on the day a pilot or comp **plan** row ends, and the owners on day 10 and day 14 of a **plan** row's grace (Featured rows, comped or paid, get no reminder; the card and `directory-admin.html` show their end). A pilot with no end date yet (before go-live) is never reminded. `billing_notices` keeps each notice to one send. The alternative is a manual reminder by a platform admin, written into §12 k.
- **Desk alerts** from the webhook: `unmapped`, `duplicate_subscription`, `paid_after_cancel`, a dispute, `invoice.finalization_failed`. Ownership disputes send `owner_change` (§9.3).
- **`listing-alert`'s fall-through is fixed first**: an unknown `kind` returns 400 instead of mailing the desk an "application".

---

## 7. Featured

- **Computed in the view, not written by the webhook.** `directory_public.featured` is `listing_featured(l.id)` (§4.2), so it is right at every moment. That includes a comp's end date, which no event marks, and it needs no scheduler and no write path to guard. The view has 14 rows; if the directory grows into the thousands, the flag can be materialized by the webhook later.
- **The raw column stops mattering.** `directory_listings.featured` (0 rows true) is ignored by the view from the enforcement migration on, written by nothing new, and dropped in the cleanup migration, after `directory-admin.html` stops sending it (684).
- **Staff featuring becomes a dated comp.** The directory admin's "★ Featured" chip (83-84) becomes **"Comp Featured until [date]"**, calling `comp_shop(listing, 'featured', null, 'comp', until, note)`; "End" calls `end_comp(grant)`. It works on an unclaimed listing too, because grants are keyed by listing id. Featuring is either paid or a visible, dated comp; there is no third way.
- **Placement.**
  - Featured listings are pinned first in the directory (`suppliers.html`) and first in the app's picker list (`App.jsx:4676`).
  - **Featured never decides routing or preselection.** The `list[0]` fallback (4698) is removed (§9.2), and `nearest_ordering_shops` has no featured term, so a paid placement cannot become the default shop.
  - A **"Featured" label** goes on the directory card (`buildCard` 444-472 and the prerender's `cardHtml` 244-271) and in the picker. Paid placement is marked as such.
- **Static pages without a deploy.** `suppliers.html`'s runtime fetch already returns `featured`. It now sets `data-featured` on the baked cards from the runtime rows before the featured-first shuffle (565-587). A purchase shows on the next page load, and the prerender's baked value is just the first paint.
- **Geo search** (399, distance only today): featured listings within 100 miles of the searched place come first, then everything by distance (decision 8).

---

## 8. The owner's plan card (Shop Floor → Shop Settings)

- **Placement.** Between the setup checklist (`App.jsx:3969-3986`) and the Ordering card (3988).
- **Data.** From `shop_billing_info(p_shop)`: plan, source, status, `takes_orders`, `featured`, trial end, period end, `cancel_at_period_end`, `cancel_at`, `grace_until`, comp/pilot end and the granting admin's email, the Featured period end and cancel flag, `trial_available`, `offer`, `has_payment_method`, `plans_open`, seats used/allowed, `read_seats_until` and the inactive members, bases allowed. The ordering card also reads `order_block` from `shop_admin_info`. It answers for the shop's members and platform admins, and never returns a Stripe id.
- **Buttons** need a new prop, `isOwnerStrict = memberShops.some(s => s.id === shopId && s.role === "owner")`, which **does not include `isStaff`**, unlike `isShopOwner` (4164). Staff members see the status line read-only, with no buttons and no prices. Platform admins see the status line and use the comp controls in `directory-admin.html`, not here. While `plans_open` is false the buttons are hidden ("Plans open soon"), except for the test shops.

| State | Card text | Owner's buttons |
|---|---|---|
| Listing, trial available | "**Listing — free.** You're in the directory. Start a plan to take orders through RoofCoil." Shop and Pro prices from `billing-session`; "30-day free trial, no card needed." | Start Shop trial · Start Pro trial |
| Trialing | "**Shop — trial**, 23 days left (ends Nov 25)." Without a card: "No card on file: ordering pauses when the trial ends." | Add card (Portal) · Manage billing |
| Active | "**Shop — $149/month**, renews Dec 1." | Manage billing |
| Cancel scheduled | "**Shop — ends Dec 1.** Ordering stops then; your listing stays." (`cancel_at` when set, else the period end) | Manage billing (renew) |
| Past due, in grace | Amber: "**Payment failed on Nov 3.** Ordering continues until Nov 17 — update your card." | Update card (Portal deep link) |
| Past due, grace over | Red: "**Payment overdue — ordering paused.** Update your card and ordering resumes as soon as the payment goes through." | Update card |
| Lapsed | Red: "**Your plan has ended, so ordering is paused.** Your listing is still in the directory; your prices, customers and orders are kept." | Start a plan |
| Pilot | "**Pilot — free until Jan 31, 2027.** Start a plan before then to keep taking orders without a gap (founding rate); your first charge is on Jan 31. After that date a plan starts without a trial." Before go-live: "**Pilot — free.** Your end date is set when plans open: 90 days from then." | Start a plan (trial to the pilot's end; hidden until plans open) |
| Comp | "**Pro — comped by RoofCoil.**" | — |
| Over seats | "Your plan covers 5 people; 2 are inactive until it covers them: <names>." | Manage billing |
| Lapsed, seats winding down | "Everyone keeps access until <read_seats_until>; then your free plan covers 2 people." | Start a plan |
| Featured line | "Featured — pinned first in the directory with a Featured label, +$49/month" / "Featured until <date>" | Add Featured · Manage billing |

- **The ordering switch** (3988-4018):
  - `!info.is_default` disappears from 4000 and 4016, so Fortified's owners get the switch like everyone else. The 4016 note becomes "The link name is fixed while ordering is on — switch off to change it" (admins no longer rename a live shop, §9.4).
  - When the plan doesn't cover ordering and the switch is off, the button reads **"Start a plan to switch on"** and scrolls to the card. The server answers `needs-plan` anyway, and `toggleOrdering` (3891-3898) maps it to that flash.
  - **"Switch off" is always available.**
  - With the switch on and `takes_orders` false, the status line names the first missing clause (`order_block`, §4.2): `suspended` "Ordering is on but paused: RoofCoil has suspended this shop — contact support."; `no-email` "… add an order email below."; `no-prices` "… save your prices in Price List → Backend."; `no-plan` "… no plan — start one above.", "… payment overdue — update your card." (past due, grace over) or "… your plan has ended." (a plan that lapsed). The member pre-Send toast (5887) uses the same lines, so a comped or pilot shop missing its email or prices is never told its plan ended.
- **Checklist.** A required **Plan** step sits before Go live (`steps`, 3872). The copy at 3972 changes ("Four steps before customers can order from you…"), and so do the Backend banner's "of 3 required steps" (8570-8577) and the first-run condition (4234-4247). The `is_default` branches at 3872, 4237, 8558 and 8570 go.
- **`?billing=success|cancel` deep link.** It opens Shop Floor → Shop Settings for `?shop=<slug>` (members resolve through `my_shops`, even with ordering off). On success it shows "Confirming your plan…", calls `billing-session` `sync` with the `session` parameter once, and polls `shop_billing_info` every 2 s for up to 30 s. It then strips the parameters (`history.replaceState`), and offers "Refresh" (`sync` again) if the plan still isn't there. Today a return would land on the last tab, in Jobs.
- **On `fortifiedmetals.com`** (`ON_FORTIFIED`): the buttons are replaced by "Manage your plan at shop.roofcoil.com ↗". A competitor should not pay RoofCoil inside Fortified's branding, and that origin's session would not carry over anyway.

---

## 9. Fortified's dual role

### 9.1 Rule (a): same plan, same checks, comped

Fortified gets the comp row of §3.2 and passes `shop_takes_orders` like any shop. Every special case is removed or turned into data:

| Special case today | After |
|---|---|
| `set_shop_ordering` / `set_shop_contact` `dflt` exemptions | dropped (§4.3) |
| No `order_email`; orders go to the desk and are texted | Before the release that reads the predicate (§12 d, after `order-alert` v6 is deployed), Fortified's owners set an order email through today's contact card (decision 10, today's `ALERT_EMAIL_TO`). A new shop setting **`order-sms`** (members-only; any shop on a plan that takes orders) makes `order-alert` text a routed order too, and the desk's number is written there for Fortified at the same prep step, by SQL with its owners' go-ahead (the field itself ships in the release at §12 e). `ALERT_EMAIL_TO` becomes `orders@roofcoil.com`, so the unrouted path, now unreachable through the predicate, is never a Fortified inbox. |
| No saved `price-list`: Fortified prices from `DEFAULT_PRICE_LIST`, which is also every new shop's seed (and CFR's live prices) | Before the release that reads the predicate (§12 d), Fortified's owners save their list, numbers unchanged, in today's Price List → Backend (today's build hides "Keep these prices" for the default shop, `App.jsx:8558`, so they edit a rate and set it back; each edit saves the list), and CFR's owner saves CFR's current numbers (decision 18). The predicate requires a saved list for every shop (§4.2). Neither shop's prices move when RoofCoil's seed moves, and the seed becomes RoofCoil's sample list. Because the seed equals Fortified's live prices today, it is then replaced with clearly illustrative numbers (decision 11), so an unrouted estimate never quotes one competitor's real prices. |
| 7 `is_default` UI branches (§1) | removed (§8) |
| `default_shop_id()` routing; `customer_price_list(null)` → Fortified; `shop_customer_on_signup` | §9.2 |
| `is_default` column and `shops_one_default` index | unused after the release, dropped in the cleanup migration so nothing can special-case them again |
| Hardcoded Fortified copy (`App.jsx:893, 4350-4353, 7425-7427`; email footers and phone in the three email functions) | the separate rename. Routed customer copies already sign with the shop's name and phone (Phase 2 rider), and every order becomes routed. |

### 9.2 Rule (b): neutral routing

**Options.** (1) *Publish the rule* ("no shop chosen → Fortified Sheet Metal, run by RoofCoil's operator"): least code, but it keeps the default-shop special case and the signup enrolment, against rule (a). (2) *Nearest shop taking orders by ZIP, computed on the server*. (3) *No default at all*: the contractor must choose, and an empty area produces a "tell me when" lead.

**Recommended: (2) with (3)'s fallback, and the rule published.** Nothing is ever sent to a shop nobody chose or computed:

```sql
-- US ZIP (ZCTA) centroids from the Census Bureau's 2020 Gazetteer file (public domain, ~33,800 rows), loaded once.
create table public.zip_centroids (zip text primary key check (zip ~ '^\d{5}$'), lat double precision not null, lng double precision not null);

-- anon, authenticated. Nearest shops taking orders to a ZIP, within p_radius miles.
create function public.nearest_ordering_shops(p_zip text, p_limit int default 3, p_radius int default 250)
returns table (id uuid, name text, miles numeric)
-- listings with status = 'live' where shop_takes_orders(id): a hidden or draft shop is never suggested;
-- least(greatest(p_limit, 1), 10) and least(greatest(p_radius, 1), 500), so one call can't list every shop;
-- bases = the first (shop_entitlement(id)).bases entries of directory_listings.locations that have lat/lng,
-- in stored order, else the listing pin (App.jsx shopBases rule, 649-659);
-- miles = min haversine, R = 3959 (havMiles, 660-664); order by miles, id. Featured and name play no part.

create function public.set_my_zip(p_zip text) returns text   -- authenticated; 'ok' | 'invalid'
-- customers.update is staff-only today, so a ZIP prompt needs this definer function
```

**Preselection order in the app** (replaces 4692-4699):
1. `?shop=`.
2. A member's own shop.
3. The shop this account last ordered from, or one that gave it a non-retail tier (the customer's own history, not a platform default).
4. `nearest_ordering_shops(customers.zip)`, with the existing toast "Pricing from X, the shop nearest Z (about N mi)".
5. **Nothing.** The picker lists the shops taking orders with their distance, and Send asks "Choose a shop under 'Send this order to'." Estimates use RoofCoil's sample list under a "Sample prices — choose a shop to see its prices" line. That is an app change: when `shopId` is null, the price-list effect (4964-4984) sets `priceList` to `DEFAULT_PRICE_LIST` and shows the line, instead of returning early with `[]`. `customer_price_list(null)` returning null instead of Fortified's list (M2) is defensive only; the app never calls it without a shop.

The routing rule is printed under the picker and on the terms page: "RoofCoil sends your order to the shop you choose, or suggests the nearest shop taking orders to your ZIP. RoofCoil is run by the owner of Fortified Sheet Metal, one of these shops; it gets no preference. Sample prices are RoofCoil's illustrative numbers, not any shop's." `shop_customer_on_signup` and its trigger `customers_default_shop` are dropped. A new account becomes a shop's customer when it orders there (`submit-order:190-194`) or is added by email (§9.3).

| Edge case | Behaviour |
|---|---|
| No ZIP (all 32 accounts today, every Google sign-up) | A one-field prompt above the picker ("Your ZIP — we'll suggest the nearest shop") → `set_my_zip`. Until then, step 3 or nothing. |
| No shop within the radius | Nothing preselected; "No shop takes RoofCoil orders near 59715 yet" and a **Tell me when one does** button that inserts a `leads` row with the ZIP (anon/authenticated insert, throttled, exists today). |
| ZIP not in the Census file (PO-box ZIPs) | Treated as no ZIP. There is no geocoder to go down any more, and **the ZIP no longer goes to a third party** (Nominatim, 4717). |
| Signed out | Sample prices, nothing preselected (signed-out visitors cannot send). |
| `?shop=` for a lapsed shop | The notice at 6316-6320, reworded in the release because today's copy ends "this order goes to the shop below", which is false when nothing is preselected: "… isn't taking orders through RoofCoil right now — choose a shop under 'Send this order to'." Then steps 3-5. **Never Fortified by default.** |
| `?shop=` for a hidden shop that takes orders | It works: the link is the one way to reach a shop the directory doesn't show. It is never suggested by step 4. |
| A Vault job reopened for a shop that has since lapsed | It isn't in the list, so the pick resets by the order above; `submit-order` refuses anyway. |
| Featured shops | Sorted first in the list, never preselected (§7). |
| Fortified's own owners | Fortified, as a member (step 2), like any shop's people. |

`submit-order` gets no ZIP fallback. The app always sends the `shopId` it showed, and a missing one is an error, not a routing decision.

### 9.3 Rule (c): what the Fortified team and platform admins can see and change

"Fortified's team" means the members of Fortified's shop. "Platform admin" means a `staff` login that, after §9.4, is never a shop member. Applies after the split; today's column describes the two staff logins, which are Fortified's owners.

| Data of another shop | Fortified's team (after) | Platform admin (after) | Today |
|---|---|---|---|
| Orders: items, customer name and phone, estimate | none | **read only**, under that shop's **support grant**; no update or delete | read, update, delete all |
| Price list cost column, material and production costs, materials board, catalog choice | none. Sell prices are seen like any signed-in contractor: `customer_price_list` (cost stripped) and the `coil-width-scale`, `custom-trim-presets`, `tier-labels`, `catalog` keys | the same as any account; private keys **read only** under a support grant | read and write all |
| Customers and tiers (`shop_customers`) | none | read only, under a support grant | read and write all |
| Accounts (`customers`: name, email, phone, ZIP) | through `shop_customer_roster` only: name, email, tier, and phone for accounts that ordered from Fortified or were its customers before M1 (tier rows created before it: the existing 32, decision 11); **only the typed email** for an account Fortified added by email until it orders; **never ZIP** | **read all**: RoofCoil operates the accounts (sign-in support, granting admin) | members read the full row of any account they attach by email |
| Rosters (`shop_members`), invites | none | members **read** (who runs which shop; billing contact); no writes, no invites, so no adding themselves | full control, including adding themselves |
| Ordering switch, order email, contact, slug, PO | none | **none**: only the shop's owners, through their own functions; column grants stop the staff PATCH. Moderation stays through `shops.status` (suspending stops ordering) | all |
| Listing ownership | none | an unowned listing: link an owner, as today, audited. An **owned** listing changes owner only by its owner's own invite, or by a **dispute**: 7 days' notice by email to the current owners and the desk, refusable by them, audited, applied by an admin only after the 7 days | replace the owner silently |
| Plan and billing status | none | read (`shop_billing_info`); comp and offer functions, each comp recording the admin; invoices and payment methods only in the Stripe Dashboard | n/a |
| Directory private columns (`order_email`, `owner_id`, `application_id`) | none | read all, through `staff_listings()` | **every signed-in account** reads them (authenticated table-wide SELECT plus the live-row policy) |
| Leads, manufacturer applications | none | read, delete | read, delete |
| Claims, listing edits, platform `catalog_items` | none / none / read | read and decide (an owned listing's claim goes through the dispute) / read and decide (minus the ordering fields) / write | the same |

**Support grants are read-only.** A shop's owner opens one from Shop Settings ("Let RoofCoil support **see** (not change) this shop for 24 hours"). It is a row in `support_access(shop_id, granted_by, reason, created_at, expires_at ≤ 7 days, revoked_at)`, written by the owner-only `grant_support_access(p_shop, p_hours, p_reason)` and `revoke_support_access(p_shop)`. The predicate is `has_support_access(p_shop) = is_staff() and exists (an unexpired, unrevoked grant)`. It feeds **only** `can_view_shop(p_shop) = is_shop_member(p_shop) or has_support_access(p_shop)`, which the SELECT policies and read functions use. Every write stays with members (`can_manage_shop`) or owners. A grant therefore leaves nothing behind when it expires or is revoked: no member added, no email repointed, no setting changed. The owner sees active and past grants. Row-level logging of what was viewed is out of scope.

**Accounts a shop adds by email.** `add_shop_customer` answers `'added'` whether or not the email has an account, so it no longer tells a shop who is registered. For an existing account it writes the tier row. For an unknown email it stores a pending row in `shop_customer_offers(shop_id, email, tier, created_by, created_at)`, which the `customers` insert trigger (the one that already runs `accept_shop_invites_for`) turns into a tier row at sign-up. The roster shows such a row as the email the shop typed until the account orders from the shop. The members' policy on `customers` is dropped, so the table itself never shows a shop another account's phone or ZIP.

**Honest limit.** Nick is both the operator and Fortified's owner. Separate logins separate the permissions, make cross-shop access visible and require the other shop's consent, and the column grants make the admin login unable to repoint another shop's orders. They cannot stop the operator from using the database owner role or the service key, which bypass RLS. That is why these rules, including that limit, are published on the terms page that Checkout requires shops to accept.

### 9.4 Rule (d): platform admin apart from Fortified's shop staff, staged so nothing breaks

`public.staff` keeps its name and means "platform admin". Renaming it would touch 31 policies for no behaviour change; a rename can come later.

| Stage | What | Why it doesn't break |
|---|---|---|
| S0 (with the billing migration, M1) | `support_access` and its three functions; `can_view_shop`; the definer reads `staff_listings()` and `staff_listing(p_id)` (raise unless `is_staff()`; every column **named explicitly except the raw `featured`**, so M4 can drop it, plus `takes_orders` and `featured_now` from `listing_featured`), `my_listings()` (rows with `owner_id = auth.uid()`, every column the owner edits plus `order_email`, `takes_orders`, `order_block`, `plan` and any pending ownership change), `shop_customer_roster(p_shop)` (§9.3); `listing_owner_changes` with `refuse_owner_change` and `apply_owner_change`; `shop_customer_offers`. `is_staff()` is unchanged. | additive |
| S1 (release) | Two new platform-admin logins are created and confirmed (decision 12). The app removes `isStaff` from `canManageShop`, `isShopOwner` and `canRunShopFloor` (4163-4165) and from `floorOrders` (6311). Moved to `directory-admin.html`, which is already staff-gated (214-216): the Platform toggle (8623-8635), the staff-list load (5038-5041), the leads/applications lists (5120-5144) and the platform catalog editor `PlatformCatalogSection` (8747, today inside the Price List backend that needs `canManageShop`, 8554). Readers switch to definer functions: `directory-admin.html:711` and `:839` to `staff_listings()` / `staff_listing(id)`; the POST at `:692` to `?select=id` (needs only `id`); `manage-listing.html:186` to `my_listings()`, and its 226 note to `takes_orders`; `loadShopCustomers` (5031-5034) to `shop_customer_roster`. `AuthProvider.jsx:44` (`ownedShops`) is removed: nothing consumes it. `directory-admin.html`'s PATCH body drops `featured`, `accepts_orders` and `order_email` (684-686); its list badge reads `takes_orders` and its ordering chip becomes read-only (§4.3 row 14). Applied edits skip those two keys (863-875), and `manage-listing.html` stops proposing them: owners set them in Shop Settings. M3 then refuses such proposals at the source (step 11 below). The `AuthProvider.jsx:43` staff check is unchanged. | Fortified's owners still hold `staff` rows until S2, so no access is lost in between. Every reader of a column S2 narrows already goes through a function. |
| S2 (migration M3 `phase3_platform_admin_split`) | See the list below. | Fortified's owners keep everything a shop's owners have, and the new admins keep every platform power in §9.3. |
| S3 | Test plan step 18; publish the rules. | — |

**S2, in one transaction:**
1. Insert the two new logins into `staff` by confirmed email (raise if missing). **Delete the two Fortified logins from `staff`**: the migration runs as postgres, so the no-self-revoke policy doesn't apply.
2. `can_manage_shop` becomes `is_shop_member(p_shop)` (writes). Of its 9 policies, the 3 SELECT ones ("members read settings, sell prices for all", "own tier or managed shop", "members read their shop invites") and the read functions `shop_admin_info` and `shop_roster` switch to `can_view_shop`. The 6 insert/update/delete policies on `shop_settings` and `shop_customers`, and `add_shop_customer`, stay on `can_manage_shop`, so a support grant can't write.
3. The six shop RPCs that test `is_staff()` drop it and become strict owner (`is_shop_owner`): `invite_shop_member`, `revoke_shop_invite`, `set_po_sequence`, `set_shop_contact`, `set_shop_ordering`, `set_shop_slug`. The seventh `is_staff()` caller, `ordering_shop_by_ref`, keeps it (§4.3 row 5: public sell prices only).
4. `orders`: "own or staff read" is recreated `TO authenticated` as `user_id = auth.uid() or has_support_access(shop_id)`. "staff update" and "staff delete" are dropped: no admin path writes orders. anon's table grants on `orders` are revoked (nothing anonymous reads or writes it). The policy moves to `TO authenticated` in the same statement that adds the function call, so anon never evaluates `has_support_access` (the PR #55 outage).
5. The `shop_members` insert/update/delete policies become owner-only (`is_shop_owner`).
6. `directory_listings`: `authenticated` loses table-wide SELECT, INSERT and UPDATE. It gets SELECT on the anon column list, and INSERT and UPDATE on every column except `owner_id`, `order_email`, `accepts_orders` and `featured`. The `listing_edits` policy "owner submits edits" is recreated `TO authenticated` with `is_listing_owner(listing_id)` (definer) in place of its sub-select on `owner_id`.
7. `shops`: `authenticated` loses table-wide UPDATE and keeps UPDATE on `status` only (moderation). Owners change slug and PO through their RPCs.
8. `set_listing_owner` and `decide_listing_claim`: on a listing with no owner (`owner_id` null and no owner member) they act as today and write a `listing_owner_changes` row. On an owned listing, including clearing the owner, they write a pending row (`effective_at = now() + 7 days`), email the current owners and the desk (`owner_change`), and return `'pending-7-days'`. The current owners can `refuse_owner_change` from `manage-listing.html` or Shop Settings. A platform admin can `apply_owner_change` only after `effective_at` on a row nobody refused. Fortified's listing has no `owner_id` but has owner members, so it counts as owned.
9. `customers`: the policy "shop members read their shop customers" is dropped (the roster replaces it). `add_shop_customer` and the `customers` insert trigger take the §9.3 behaviour.
10. Guard triggers on `staff` and `shop_members` refuse a login that would be both.
11. `validate_listing_edit`: `accepts_orders` and `order_email` leave its `allowed` array, so an owner can no longer file a proposal of either through REST only to have it skipped (§4.3 row 15).

The split lands **before the first non-Fortified shop pays** (§12 step k). Its 25 platform policies keep `is_staff()`: `directory_listings` ×4 (the update policy can now write only the granted columns), `listing_claims`, `listing_edits` ×3, `manufacturer_applications` ×2, `leads` ×2, `catalog_items` ×3, `staff` ×3, `shops` ×4 (update limited to `status`), `shop_members` SELECT, and `customers` ×2 (inline, anon-safe). The other 15 narrow: 9 through `can_manage_shop` / `can_view_shop`, 3 on `orders` (one recreated, two dropped), 3 on `shop_members`. Outside the 40, the `customers` members' policy is dropped and the `listing_edits` insert policy is rewritten.

---

## 10. Sales tax on the subscription (flag for an accountant; not legal advice)

- **What Texas says.** The Comptroller treats SaaS as a data-processing service: "Data processing services providers include sellers of software as a service" (Publication 96-259, rev. 01/2026). "Twenty percent of the total amount charged for data processing services is exempted from tax" (34 TAC §3.330(c)(4)). The state rate is 6.25%, and local taxes can add up to 2%.
- **What that probably means for RoofCoil.** A Texas shop's subscription is taxable on 80% of the charge: at most about 6.6% (0.8 × 8.25%), or roughly $9.84 on $149. A comped $0 subscription carries none. Ohio (CFR) and every other state follow their own rules.
- **Pending change.** A 2026-09-30 executive order directs a *proposed* change to Rule 3.330 to remove marketplace and platform fees. It names marketplaces and delivery apps, not SaaS, and has no effective date. It matters for a future transaction fee, not for plans.
- **Stripe Tax collects only where a registration is active, and silently computes $0 elsewhere.** The order is:
  1. The selling entity (decision 13: RoofCoil's own entity, not Fortified's) obtains a Texas sales and use tax permit, and any others its accountant names.
  2. Add the registrations in Stripe Tax.
  3. Set `BILLING_AUTOMATIC_TAX = true` **before the first live Checkout** (a gate in §12 j). `billing-session` then sets `automatic_tax`, and already requires the billing address and saves it to the Customer, so renewals keep a tax location.
- **Turning tax on later doesn't reach existing subscriptions.** Stripe's automatic tax applies to new Checkout Sessions; existing subscriptions must be updated separately, and its migration tool skips some (those with schedules, those without an address). If live subscriptions ever start untaxed (a permit still pending at go-live), backfilling them is an explicit step: Stripe's tax migration in the Dashboard plus manual updates, with a key that has Subscriptions write. `shop_subscriptions.automatic_tax` lets one query list the live subscriptions still untaxed.
- **Tax settings in Stripe.** The Products carry the business-use SaaS tax code (`txcd_10103001`, to confirm in Stripe's tax-code list), and the Prices are tax-exclusive ($149 plus tax; decision 13). Confirm with Stripe that this code applies Texas's 20% exemption.
- **Tested in the sandbox first.** A Texas test registration in Stripe Tax and a dedicated run with `BILLING_AUTOMATIC_TAX = true` (§14.19): a Texas address is taxed on 80% at the Texas rate, an Ohio address gets $0, and a forced `requires_location_inputs` case reaches the desk.
- **Cost.** Stripe Tax Basic costs 0.5% per transaction. On a $149 invoice that comes to about $4.62 card + $1.04 Billing + $0.75 Tax ≈ **$6.41 (4.3%)**.
- **Finalization failures.** `invoice.finalization_failed` with `requires_location_inputs` alerts the desk (§5.3).
- **Before going live:** confirm with an accountant (or a Comptroller STAR ruling) the 80% treatment, the entity, the registrations and whether prices are tax-exclusive.

---

## 11. What stays out of Phase 3

- **Stripe Connect, payments on orders, a marketplace or transaction fee.** Contractors keep paying shops directly. A fee is revisited only as optional online payments once routed orders are steady.
- **Distributor and manufacturer tiers** (branch portals, white-label tools).
- **The pilots playbook** beyond the founding coupon and the pilot rows: choosing shops, onboarding calls, feedback loop.
- **Custom domains**, and the subdomains sketched in Phase 2 §4.3.
- **The rename** of the app, emails and footers away from "Fortified" (separate work; §9.1 lists what it touches).
- **Stripe Entitlements API, Trial Offers, usage or per-seat pricing, pausing on demand, delayed payment methods (ACH).** Not needed for three plans and one add-on (§2.2, §5.2).
- **RoofCoil's own dunning emails** beyond `billing_past_due`, `billing_lapsed` and the time-based reminders, an MRR or plans dashboard (a query answers it), and refunds or disputes in the app (Stripe Dashboard).
- **Owner-side editing of `locations`** (bases stay a staff edit, proposed through listing edits).
- **Logging what a platform admin viewed under a support grant.**
- **The legacy `app_storage` table** (0 rows; four `TO public` policies on `auth.role() = 'authenticated'`, so any signed-in account can write it). Unrelated to billing; tracked as a separate hardening follow-up, like the rpc-grant work's table-privilege cleanup.

---

## 12. Migration plan and deploy order

**Migrations** (each one transaction):
- **M1 `phase3_billing`**: additive and dormant; no existing behaviour changes.
  - Tables: `billing_config` (one row: test mode, plans closed), `billing_plans` (rows), `shop_billing`, `shop_subscriptions`, `stripe_events`, `billing_notices`, `zip_centroids` (empty), `support_access`, `listing_owner_changes`, `shop_customer_offers`.
  - New functions: `shop_entitlement`, `shop_order_block`, `shop_takes_orders`, `listing_featured`, `shop_billing_info`, `billing_apply_subscription`, `comp_shop`, `end_comp`, `set_shop_offer`, `nearest_ordering_shops`, `set_my_zip`, `grant_support_access`, `revoke_support_access`, `has_support_access`, `can_view_shop`, `shop_member_seated`, `staff_listings`, `staff_listing`, `my_listings`, `shop_customer_roster`, `refuse_owner_change`, `apply_owner_change`, and `billing_reminders` (if decision 16 picks pg_cron, with `create extension pg_cron` and the daily job).
  - Two widened return types: `my_shops` (gains `takes_orders`, `plan`, `seated`) and `shop_admin_info` (gains `takes_orders`, `order_block` and plan fields; **keeps `is_default`**, which the old build reads, until M4) are dropped and recreated, which resets their ACLs, so the migration re-grants them exactly as today (§13).
  - The `shop_subscriptions_alert` trigger, the owner-change contact-sync trigger on `shop_members` (§6.2; it calls `billing-session`, which does nothing until a shop has a Stripe Customer), the `shops_pilot_before_plans_open` trigger on `shops` (§3.2), the grandfather rows (Fortified's comp; open-ended pilots for CFR and Adax, §3.2), and every revoke and grant in §13.
- **Data load** `zip_centroids` from the Census Gazetteer, by a one-off service-role script (about 1.5 MB of rows; too large for a migration file).
- **M2 `phase3_enforce`**, the flip:
  - The view `directory_public` (§4.3 row 7).
  - Functions (nine): `ordering_shop_by_ref`, `shop_slugs`, `set_shop_ordering`, `set_shop_contact`, `invite_shop_member`, `accept_shop_invites_for` (over-limit invites stay pending), `customer_price_list` (null → null), `notify_listing_live`, `is_shop_member` (seated).
  - Triggers: add `orders_require_ordering_shop` (insert or update of `shop_id`) and `shop_members_seat_limit`; drop the trigger `customers_default_shop` **and its function `shop_customer_on_signup`**, which calls `default_shop_id()` (dropped in M4).
- **M3 `phase3_platform_admin_split`**: §9.4 S2.
- **M4 `phase3_cleanup`**, in this order:
  1. Drop and recreate `shop_admin_info` without `is_default`, re-granted exactly as today (`authenticated`, `service_role`).
  2. **Assert** over `pg_proc.prosrc` in `public`: no function mentions `is_default` or `default_shop_id`, and every function that mentions `featured` is on an allow-list written in the migration (the Phase 3 functions where it is a grant kind or an output name; `staff_listings` and `staff_listing` name their columns and leave the raw one out, §9.4 S0). It raises otherwise. A SQL function with a string body records no dependency (today `shop_admin_info` selects `s.is_default`, and `pg_depend` shows only the column default and the index), so the `DROP COLUMN` would succeed and the function would fail at its next call.
  3. Drop `default_shop_id()`, `shops.is_default` and `shops_one_default`, `directory_listings.featured`, and the `shops_pilot_before_plans_open` trigger and function (a no-op since go-live).
- **M5 `phase3_go_live`** (step j):
  1. Asserts that no shop outside `billing_config.test_shop_ids` has a `livemode = false` row in `shop_subscriptions` or `shop_billing`.
  2. Deletes the test shops' rows **without updating them first**, so the alert trigger (insert or update only) sends nothing: every `shop_subscriptions` row of a shop in `test_shop_ids`, Stripe and non-Stripe alike (the one exception to append-only, confined to the test shops and recorded by this migration; `billing_notices` cascade), those shops' `shop_billing` rows, and every `stripe_events` row with `livemode = false` (events carry no shop key). It asserts none remain.
  3. Dates the pilots (§3.2): every open-ended pilot row is ended and replaced by one ending go-live + 90 days.
  4. Sets `billing_config` to `livemode = true`, `plans_open = true`, `test_shop_ids = '{}'`.

| Step | What | Why this order |
|---|---|---|
| a | Apply M1; load `zip_centroids` | Dormant: nothing reads the new objects yet. |
| b | Deploy `listing-alert` v6 (billing and `owner_change` kinds; unknown kind → 400), `order-alert` v6 (`order-sms`; neutral sign-off for the unrouted path), `stripe-webhook` v1, `billing-session` v1 (503 until the secrets exist); commit `supabase/config.toml` | The alert kinds must exist before the trigger can fire them. The new functions are inert without secrets. |
| c | **Stripe sandbox.** Review `scrape-site` and `signup-direct` before any Stripe secret is added to the project. Products with `roofcoil_plan` metadata and the tax code; tax-exclusive monthly Prices with lookup keys (and annual if decided); coupon `founding` (no `max_redemptions`); Portal configuration (§5.5); default payment method configuration card and Link only; Smart Retries 2 weeks, then cancel; subscription status resolution left at "Most recent invoice" (the default; confirm); "Manage disputed payments": cancel at period end; customer emails with the app's custom link; a Texas test registration in Stripe Tax; webhook endpoint `https://znueitseoqijhkkvdomc.supabase.co/functions/v1/stripe-webhook` with the §5.3 events, API version `2026-09-30.endive`; terms and privacy URLs. Function secrets: the two restricted test keys, `STRIPE_WEBHOOK_SECRET`, `STRIPE_LIVEMODE=false`, `BILLING_TRIAL_DAYS`, `BILLING_AUTOMATIC_TAX=false`. Create test shops B and C (§14 Setup); put each listing's id in `billing_config.test_shop_ids` (SQL) **before** it is claimed, so the pilot trigger skips it. | Test mode on the production database is confined: `billing-session` serves only the test shops while plans are closed, and test-mode rows stop counting the moment M5 sets `billing_config.livemode = true`. |
| d | **Prep, before the release, with today's app** (after b, so `order-alert` v6 already texts on `order-sms`). Fortified's owners set the order email in today's contact card (`set_shop_contact`) and save their price list, numbers unchanged, in today's Price List → Backend (today's build hides "Keep these prices" for the default shop, `App.jsx:8558`, so they edit a rate and set it back; each edit saves the list). The desk's number is written as Fortified's `order-sms` setting by SQL, with its owners' go-ahead. CFR's owner presses "Keep these prices" (shown to CFR today); a one-off service-role script copies the current `DEFAULT_PRICE_LIST` into CFR's `price-list` (numbers unchanged) **only with CFR's owner's written consent** (decision 18). **SQL check, the gate for step e:** both shops have a `price-list` row; `shop_takes_orders` is true for Fortified and CFR, false for Adax. If CFR has neither saved nor consented, CFR's ordering pauses from step f until its owner saves, and CFR's owner is told beforehand (decision 18). | Everything from step e on reads the predicate: the release's nearest-shop call, picker and pre-Send check, then `submit-order` v8. It must already be true for the shops taking orders today, or Fortified's own owners would be refused Send and every contractor told no shop is near. |
| e | Merge the PR, once step d's check passes; the build ships: plan card (buttons only when `plans_open` or a test shop) and strict-owner flag, `needs-plan`, the status line's reasons (§8), `?billing=` deep link with `sync`, top-level navigation, neutral picker (`nearest_ordering_shops`, ZIP prompt, sample prices with no shop, no `default_shop_id`/`list[0]`, the reworded `?shop=` notice, §9.2), `is_default` branches gone, `order-sms` field, support-grant card, `my_shops.takes_orders` check before Send and `takes_orders` at 5887; `directory-admin.html` comp controls and badge; `suppliers.html` Featured override and label; `public/terms.html` (plans, cancellation, routing rule, visibility rules and their limit; a draft marked as such until its review, decision 19) | Works against M1 and the old gates, because step d made the predicate true for both ordering shops. Real owners see "Plans open soon". |
| f | Deploy `submit-order` v8 (predicate gate, no default fallback) | It reads the predicate, which is now true for both ordering shops. |
| g | Apply M2; set `ALERT_EMAIL_TO=orders@roofcoil.com`. SQL check: every shop outside `test_shop_ids` has a current plan grant (the pilot trigger covers claims since M1); any gap gets `comp_shop(<shop>, 'plan', 'shop', 'pilot', null, 'claimed before plans opened')`, which M5 dates like the others | Every gate now reads the one function. |
| h | Run the §14 steps tagged h, the tax step (19) included | |
| i | §9.4 S1 (admin logins, release), then M3; run §14.18 | Before any competitor pays. |
| j | **Live mode (go-live).** Gates: a tax registration active in Stripe Tax and `BILLING_AUTOMATIC_TAX=true`, or an explicit backfill plan (§10); §14 passed; each restricted key's request log clean; `public/terms.html` final and reviewed (decision 19); step g's SQL check run again. B's and C's subscriptions cancelled in the sandbox Dashboard. Live Products, Prices, coupon, Portal, payment method configuration, dispute setting, customer emails, endpoint. Secrets swapped: the two live restricted keys (never a full secret key), the live signing secret, `STRIPE_LIVEMODE=true`. Then apply M5 (test rows removed, pilots dated) and run §14.23 and the §14 Cleanup. Replace `DEFAULT_PRICE_LIST` with illustrative numbers in `_shared/pricing.mjs` (decision 11; a release plus a `submit-order` redeploy; both ordering shops have saved lists by now, so no live price moves). | One mode at a time: there is no staging project. Later test-mode work runs on a Supabase branch. |
| k | Invite pilot shops (founding offer); CFR's and Adax's banners show their pilot end (go-live + 90 days); the 30-day reminders start (§6.3) | |
| l | Later, after the old build is gone: M4; run §14.24 | `default_shop_id()` and `is_default` are still read by pre-Phase-3 builds. |

**Rollback.**
- **Before g:** nothing enforces the plan yet; redeploy the previous functions and build. The prep data (Fortified's order email and `order-sms`, the saved lists) stays: today's code reads it correctly.
- **M2:** a prepared `phase3_enforce_rollback` restores the previous `directory_public` and the previous bodies of every function M2 replaced (`ordering_shop_by_ref`, `shop_slugs`, `set_shop_ordering`, `set_shop_contact`, `invite_shop_member`, `accept_shop_invites_for`, `customer_price_list`, `notify_listing_live`, `is_shop_member`), drops the two new triggers and recreates `shop_customer_on_signup` and its trigger `customers_default_shop`; `submit-order` v7 is redeployed. No data is touched.
- **M3:** a prepared `phase3_platform_admin_split_rollback`, in this order: drops the guard triggers (they would refuse the next step); restores `can_manage_shop`, the six owner RPCs, `shop_admin_info`, `shop_roster`, `set_listing_owner`, `decide_listing_claim`, `add_shop_customer`, `validate_listing_edit` and the `customers` insert trigger function; restores the 15 policies, the `customers` members' policy and the `listing_edits` insert policy; re-grants table-wide SELECT, INSERT and UPDATE on `directory_listings` and UPDATE on `shops` to `authenticated`, and anon's grants on `orders`; then re-inserts the two Fortified `staff` rows. The app release of S1 stays: it works under both.
- **M4:** needed only if an old build reappears: a prepared rollback re-adds `shops.is_default` (true for Fortified) with `shops_one_default`, `directory_listings.featured` (all false), `default_shop_id()` and the M1 `shop_admin_info`.
- **M5:** reversible by setting `billing_config` back (`livemode = false`, `plans_open = false`) and re-opening the dated pilots the same append-only way (each ended and replaced by an open-ended one), so a later go-live dates them again; deleted test rows are not needed.
- **Both prepared rollbacks are rehearsed** in a rolled-back transaction before their migration is applied (§14.2, §14.18).
- **Fastest lever, needing no rollback:** `comp_shop(<shop>, 'plan', 'shop', 'comp', now() + interval '7 days', 'incident')` restores one shop's ordering in seconds, as a new row beside whatever it has.
- **Stripe:** disabling the endpoint stops writes. A failed event stays unprocessed, so a Dashboard resend (15 days) or the CLI (30 days) re-runs it; for an event already marked processed (`unmapped`, `duplicate`), the platform-admin `resync` applies current state regardless of event ids.

**What these migrations do not do.** They don't change `orders` rows, `order_alerts`, the pg_net order triggers, `catalog_items`, `listing_claims` rows, `listing_edits` rows or `vault_items`. They don't move money and don't create anything in Stripe; the Dashboard steps do that.

---

## 13. The guarantees, before and after

**Grants.** Every new table: `revoke all on table … from public, anon, authenticated`. RLS is already on through `ensure_rls`, and `service_role` keeps its default `arwdDxtm`. Every new function, and every function dropped and recreated (`my_shops`, `shop_admin_info`): `revoke all on function … from public, anon, authenticated`, then exactly the grants below. That follows the pattern of `…phase2_self_serve_shops.sql:184-185` and the `rpc-grant-hardening` rule, because postgres's default privileges would otherwise make each one anon-callable (`20261026104615`). Every new function is `security definer`, `set search_path = ''`. **Every new policy, and every existing policy a migration changes, is `TO authenticated`**, so anon never evaluates a predicate it cannot execute (the PR #55 outage).

| Object | anon | authenticated | service_role |
|---|---|---|---|
| `billing_config`, `billing_plans`, `shop_billing`, `shop_subscriptions`, `stripe_events`, `billing_notices`, `zip_centroids`, `listing_owner_changes`, `shop_customer_offers` | — | — (no policies; read through functions) | all |
| `support_access` | — | SELECT where `is_shop_owner(shop_id) or is_staff()` | all |
| `shop_entitlement`, `shop_order_block`, `shop_member_seated`, `billing_apply_subscription`, `billing_reminders` | — | — | EXECUTE |
| `shop_takes_orders`, `listing_featured`, `nearest_ordering_shops` | EXECUTE (public facts; `directory_public` is `security_invoker`) | EXECUTE | EXECUTE |
| `my_shops`, `shop_admin_info` (recreated in M1, and `shop_admin_info` again in M4; granted as today each time) | — | EXECUTE | EXECUTE |
| `shop_billing_info` (members, platform admins), `set_my_zip`, `grant_/revoke_support_access` (strict owner), `has_support_access`, `can_view_shop`, `my_listings`, `shop_customer_roster` (`can_view_shop`), `refuse_owner_change` (current owners), `staff_listings` / `staff_listing` / `apply_owner_change` / `comp_shop` / `end_comp` / `set_shop_offer` (raise unless `is_staff()`) | — | EXECUTE | EXECUTE |
| Trigger functions (`orders_require_ordering_shop`, `shop_members_seat_limit`, `shop_subscriptions_alert`, `shops_pilot_before_plans_open`, the owner-change contact sync, guards) | — | — | — |
| Changed in M3 | `orders`: anon's table grants revoked | `directory_listings`: SELECT on the anon column list; INSERT/UPDATE on all but `owner_id`, `order_email`, `accepts_orders`, `featured`. `shops`: UPDATE on `status` only | unchanged |

| Guarantee | Today | After Phase 3 |
|---|---|---|
| A shop takes orders only while entitled | n/a: any active shop with the switch on | `submit-order`, the `orders` insert/update trigger, `?shop=`, prerender links and the picker all read `shop_takes_orders` → `shop_entitlement`; it also requires an order email and a saved price list; no writer of `accepts_orders` can bypass it |
| A lapsed shop keeps its listing and its data | n/a | the view filters only on listing status; settings, customers, orders, membership rows and the switch are untouched |
| A hidden listing is never suggested | n/a | the view, `nearest_ordering_shops` and `shop_slugs` show live listings only; `?shop=` is the only way to a hidden shop |
| Nobody grants themselves a plan or Featured | n/a; staff set `featured` freely | billing tables have no API-role grants; rows come only from the signature-verified webhook and the owner/admin sync paths (service role), or platform-admin comp functions, each comp row dated, noted, append-only and recording its admin; the only other writers are the migrations and, until go-live, the pilot trigger, which gives a newly created shop what Phase 2 gave it; test-mode rows never count once `billing_config.livemode` is true, and only the test shops can create them before |
| Stripe events apply once, in any order | n/a | event id claimed in `stripe_events`; state re-fetched; stale writes refused by `state_fetched_at`; a Customer deleted before its subscription events still maps; lost events can't keep a shop entitled past its trial or period, and `sync`/`resync` recover missed ones; the webhook attempts a failing card at most once per invoice and card |
| Only a shop's owners start or change its billing | n/a | `billing-session` checks `shop_members.role = 'owner'`; platform admins and staff members cannot; the Stripe Customer's contact follows a current owner |
| Billing state is private | n/a | members and platform admins read status through `shop_billing_info`; no Stripe id reaches the browser; anon learns only "takes orders" and "featured" |
| Fortified passes the same checks | default-shop exemptions in two RPCs and seven UI branches | no `is_default` in any check; Fortified has an order email, a saved list and a comp row |
| No order goes to a shop nobody chose or computed | no shop → Fortified | no shop → refused; preselection = link, membership, history, nearest by ZIP, or nothing; an order is never re-routed through the API |
| No shop's orders reach another shop's inbox | only while no shop is on without an email (staff paths could) | an orderable shop must have an order email, for every writer; only its owners can set it (column grants) |
| Fortified's team cannot read other shops' private data | its owners are platform staff and read everything | Fortified is a shop like any other (after M3); a shop sees an account it added by email only as that email until the account orders |
| Platform admins read a shop's private data only with consent, and never change it | blanket read and write | owner-granted, expiring, **read-only** support grants; no admin path writes another shop's orders, order email, switch, slug, PO or roster; platform data stays theirs (§9.3) |
| No silent change of a shop's owner | staff replace an owner without notice | owner-initiated, or a 7-day notified, refusable, audited dispute |
| Seat limits | none | trigger on `shop_members` (every insert path, including the direct insert at `App.jsx:5092`; an upsert of an existing member adds no seat) and the seated check on read, so a downgrade can't keep extra seats; after a lapse the last plan's seats hold for 30 days, so a crew finishes jobs in progress |
| Customers never see costs; tiers only shop-editable | as Phase 2 | unchanged |

---

## 14. Test plan (Stripe sandbox; production database with hidden test shops, as in Phase 2)

**Setup.**
- **Shop B:** a hidden listing "RoofCoil Test Shop (Phase 3)", phone and order email set, claimed by **B-owner**, a fresh **non-staff** account. Phase 2's run had to use a staff account here, which hid owner-only behaviour.
- **Shop C:** a second hidden listing "RoofCoil Test Shop C (Phase 3)", claimed by **C-owner**, another fresh non-staff account. It is the shop for the steps that need a shop with no plan, or one that has never had a trial (steps 7–8, 10, 12, 15, 19), so B's subscription can run steps 5, 9 and 11 without being cancelled under them. Neither shop's trial eligibility is ever reset: each is used once (§5.2).
- **Both listing ids go into `billing_config.test_shop_ids` before the claims** (shops share the listing's id), so the pilot trigger gives neither a pilot: after the claims, B and C have no `shop_subscriptions` row.
- **B and C are hidden, and `directory_public` returns only `status = 'live'` listings**, so they never appear in the view, the picker or the suppliers page. Status-independent checks call `shop_takes_orders(…)` and `listing_featured(…)` directly. The two page checks (steps 3 and 11) run in a short, announced window with B `live` **and its switch off**, then B goes back to hidden.
- **Accounts:** **Crew**, B's `staff` member. **Customer**, an ordinary account with ZIP 75090 (Sherman, TX). **Admin**, a platform admin.
- **Stripe:** one test clock per shop, each with a Customer created in the Dashboard and put into `shop_billing` for its shop, so clocks drive each shop's subscriptions separately. The "Manage disputed payments" setting does not work with test clocks; it is checked by configuration only.
- **How SQL checks run:** as in Phase 2, with simulated JWT claims, and rolled back.
- Each step names the §12 step at which it runs and, from step 5, the shop it uses. **The order matters**: a step that opens a new plan Checkout on a shop says first how that shop's current plan was ended (the 409 rule, §5.1).

1. **Dormant M1** [a].
   - `shop_entitlement`: Fortified `pro/comp`; CFR and Adax `shop/pilot` with `ends_at` null (open-ended until go-live).
   - In a rolled-back transaction, a new listing claimed after M1 (its shop inserted by `ensure_shop_for_listing`) gets one open-ended pilot row; with `plans_open` set true in the same transaction, a second new shop gets none.
   - Fortified orders still work through the old gate.
   - `has_function_privilege` matches §13 for every new function and for the recreated `my_shops` and `shop_admin_info` (no anon), and anon gets permission denied on the billing tables. `shop_admin_info` still returns `is_default` for the old build.
2. **Prep and flip** [d–g].
   - After prep (the gate for step e): Fortified and CFR have a `price-list` row; `shop_takes_orders` is true for both, false for Adax (switch off). As a Fortified owner, the step e build sends at Fortified (pre-Send check passes), and Customer at 75090 sees Fortified suggested. With CFR's `price-list` deleted in a rolled-back transaction, it is false and `shop_order_block` says `no-prices`.
   - After M2 (step g): every shop outside `test_shop_ids` has a current plan grant.
   - `phase3_enforce_rollback` applied in a rolled-back transaction restores every old body it names.
   - After M2: anon `shop_slugs()` returns both, `directory_public` shows both with `accepts_orders` true, and Adax shows false while staying listed.
3. **Lapsed shop keeps its listing** [h]. B-owner sets the order email and saves a price list; a staff curl PATCH (still possible before M3) sets B's `accepts_orders = true`.
   - `shop_takes_orders(B)` is false; B's listing row is unchanged. In the live window (switch off), B is on the suppliers page.
   - B is not in the picker, and `?shop=` shows the notice.
   - A forced `submit-order` (curl, dry run and real) → "That shop isn't taking orders right now — pick another shop…", and B's `po_next` is unchanged.
4. **Needs a plan** [h]. As B-owner, the switch reads "Start a plan to switch on". `set_shop_ordering(B, true)` → `needs-plan`. Switch off → `off`.
5. **Checkout from the frame** [h; B]. In `www.roofcoil.com/members.html`, Start Shop trial opens Checkout **top-level**, with no card asked (4242 not needed).
   - It returns to `/app?shop=…&billing=success&session=…`, then "Confirming…", then the trial banner.
   - `stripe_events` rows are `applied`, and `shop_subscriptions` has B `trialing` with `livemode = false`.
   - Switch on → `on`. Customer at `?shop=` orders → PO-1001, routed to B's email.
   - As Adax's owner (not a test shop): no buttons ("Plans open soon"), and `billing-session` `checkout` → 503.
6. **Owner only** [h; B]. Crew sees the status line and no buttons; `billing-session` as Crew, as Admin and as a non-member → 403 each. `billing-session` `resync` as B-owner → 403; as Admin → applied. `fortifiedmetals.com/app` shows the link instead of the buttons.
7. **Webhook robustness** [h; B, and C's first Checkout].
   - `stripe events resend <evt>` → `duplicate`.
   - Replaying an older `customer.subscription.updated` after a newer one → state unchanged.
   - `billing_apply_subscription` with an older `fetched_at` → `stale`.
   - A tampered body → 400. A live-mode event while `STRIPE_LIVEMODE=false` → `ignored`.
   - A subscription made in the Dashboard for an unknown Customer → `unmapped` and a desk alert. A Featured subscription whose price is swapped to Pro in the Dashboard → `unmapped`, nothing written.
   - Two Checkout requests for C in a row (C has no plan yet): the first session is expired, only the second could complete; both are left to expire. A second plan subscription for B made in the Dashboard → `duplicate_subscription` and a desk alert; cancelling that one sends no `billing_lapsed`.
   - With the endpoint disabled, C-owner completes C's first Checkout (a no-card trial); "Refresh" (`sync`) writes the trial; the endpoint is re-enabled. Admin `resync` re-applies a subscription whose event was marked `unmapped`.
   - In a rolled-back transaction with B's `trial_end` moved 2 days into the past and no event, `shop_takes_orders(B)` is false (the read-time bound, §4.1).
   - Each restricted key's request log shows no permission errors.
   - (The Customer-deletion check is step 22, after every test-clock step, because deleting a Customer cancels its subscriptions.)
8. **Trial ends without a card** [h; C, C's test clock]. During the trial C-owner sets C's order email, saves a price list and switches on. Day 27 → `trial_will_end`. Day 31 → `canceled`, C on Listing.
   - Ordering is refused while the switch stays on, and the listing stays; the status line reads "… your plan has ended."
   - `billing_lapsed` goes to C-owner and the desk.
   - Start a plan again → no trial; Checkout asks for a card (left to expire).
9. **Grace and the card** [h; B, B's test clock]. B has 3 members (B-owner, Crew and a newer staff member).
   - Before B's step-5 trial ends, B-owner adds Featured with 4242 (a Featured Checkout). After `checkout.session.completed`: the Featured subscription's `default_payment_method` is null and the Customer's default is the 4242 card (confirms which field Checkout wrote and that the webhook moved it). `listing_featured(B)` true.
   - Advance past B's trial end: the no-card plan trial charges that card and becomes `active` instead of cancelling. Then cancel B's Featured immediately in the Dashboard (step 11 adds it again), so only the plan is in play below.
   - Swap the card in the Portal to `4000 0000 0000 0341` (the Customer default, now the field renewals charge) and advance past renewal: status `past_due`, `past_due_since` set from the open invoice, the amber banner, a `billing_past_due` email with the cut-off date.
   - Swap the card in the Portal to a second declining card (`4000 0000 0000 0002`) → `customer.updated` → one `invoices.pay` attempt, declined → result `pay_declined`, a 200, no redelivery, and no second attempt on that card in the request log.
   - Day 13: orders still go through. Day 15: refused, even though Stripe still says `past_due`; the card reads "Payment overdue — ordering paused".
   - Day 15, seats: Crew and the newer staff member still see B's routed orders and the Shop Floor job in progress (`read_seats` 5 until day 44); an invite → `seat-limit` (Listing's 2). In a rolled-back transaction with that row's `past_due_since` moved 45 days back, the newer staff member is inactive (`is_shop_member` false, `my_shops.seated` false).
   - Update card to 4242 in the Portal → `customer.updated` → the open invoice is paid at once → `active` → ordering resumes with no switch action.
   - Separately, let retries end → `canceled`, its open invoices voided; the card offers only Start a plan. A payment forced onto the old subscription's invoice → `paid_after_cancel` alert, ordering not resumed. Start a plan → new Checkout with 4242 (no trial) → ordering resumes. B keeps this plan for step 11.
10. **Cards and methods** [h; C, no current plan since step 8]. `4000 0000 0000 9995` is declined with no access. A 3-D Secure card abandoned at authentication leaves nothing current (a first payment left `incomplete` grants nothing). `4000 0027 6000 3184` (always 3-D Secure) completes after authentication: C has an active plan. Checkout and the Portal offer card and Link only, no ACH.
11. **Portal** [h; B's plan from step 9].
    - Upgrade Shop → Pro: invoiced immediately, seats 15.
    - Downgrade Pro → Shop: immediate, with a credit on the next invoice (confirms the same-Product rule). With 6 members, the newest staff member is inactive: `is_shop_member` false for them, the card lists them, `my_shops.seated` false.
    - A further member insert (direct, as at `App.jsx:5092`) → `seat-limit`; invite → `seat-limit`. Re-inviting an existing staff member as owner at the limit → allowed (no seat added).
    - Cancel at period end → banner, still ordering → renew. A Dashboard cancellation on a custom date → "Ends on <that date>", then removed in the Dashboard.
    - Add Featured → `listing_featured(B)` true. In the live window (switch off): first on the suppliers page **without a deploy**, with the label.
    - Cancel Featured → off after the clock passes its period; no RoofCoil notice is sent for it (§6.3).
12. **Founding** [h; C]. Cancel C's plan (from step 10) immediately in the Dashboard and wait for `canceled`. `set_shop_offer(C, 'founding')` → C's next Checkout shows the coupon (no trial: C had one); the invoice is discounted; the flag clears once applied; the Portal offers no code box. In a rolled-back transaction with five shops flagged, a sixth is refused, and C's canceled founding subscription doesn't count. Then cancel C's plan again and wait for `canceled`, delete the coupon in the sandbox and flag C again: Checkout opens without it and the owner is told; that session is left to expire.
13. **Seat limit vs sign-up** [h]. An invited address signs up while B is full: the account is created and the invite stays pending.
14. **RLS and grants, as B-owner** [h].
    - `select` on `shop_subscriptions`, `shop_billing`, `stripe_events`, `billing_config` → permission denied.
    - `shop_entitlement(B)` and `billing_apply_subscription` → denied. `comp_shop` → "platform admins only".
    - `shop_billing_info(B)` → one row; `shop_billing_info(<Fortified>)` → none.
    - As anon: `shop_takes_orders` works, `shop_billing_info` is denied.
15. **CFR unaffected; pilot to paid** [h].
    - CFR is in the picker, and a staff dry run to CFR prices exactly as before (its saved list equals the old seed).
    - CFR's owner sees "Pilot — free. Your end date is set when plans open" (no buttons before go-live).
    - In a rolled-back transaction with CFR's open-ended pilot ended (`end_comp`): `shop_takes_orders` is false and CFR stays in `directory_public`.
    - Pilot to paid, on C (no current plan since step 12): `comp_shop(C, 'plan', 'shop', 'pilot', now() + 20 days, 'test')`, then Start a plan → the Stripe trial ends on the pilot's end date (the trial rule: a current dated pilot sets `trial_end`, whatever `firstPlanEver` says); no charge before it. Then `end_comp` on the test pilot. The trial rule is a pure function in `_shared/billing.ts`, unit-tested for the other cases: a grant ending in 1 day → `trial_end` 48 hours away; an open-ended pilot or comp → 409; a lapsed pilot → no trial; a comp-only history → 30 days.
16. **Fortified comped** [h].
    - The card reads "Pro — comped by RoofCoil", and the switch is visible.
    - A Fortified order is routed to its order email plus an `order-sms` text, with the next PO.
    - Stripe holds no object for Fortified.
17. **Neutral routing** [h].
    - Customer at 75090 → Fortified preselected with the nearest toast. At 43758 (Malta, OH) → CFR. At 59715 (Bozeman, MT) → nothing preselected, the "no shop near you" line, and Tell me when → a `leads` row.
    - With no ZIP → the prompt, sample prices (`DEFAULT_PRICE_LIST` with the "Sample prices" line, not `[]`), and Send refused until a shop is chosen. `set_my_zip('ABCDE')` → `invalid`.
    - B hidden, on a plan and switched on, is never returned by `nearest_ordering_shops` for any ZIP, its own included, but `?shop=<B>` still orders. `nearest_ordering_shops('75090', 50, 5000)` returns at most 10 rows within 500 miles.
    - Featured never wins preselection: in a rolled-back transaction with a Featured comp on CFR, `nearest_ordering_shops('75090')` still puts Fortified first; the preselection code has no featured term.
    - A lapsed `?shop=` never lands on Fortified. Signed out → sample prices.
18. **Visibility** [i, after M3].
    - `phase3_platform_admin_split_rollback` applied in a rolled-back transaction first restores the old state.
    - Seed CFR test rows for its private keys (`price-list`, `material-status`, the cost keys, `order-sms`) in a rolled-back transaction. As a Fortified owner: those keys, CFR's `orders`, `shop_customers` and `leads` → 0 rows; CFR's public sell keys (`coil-width-scale`, `custom-trim-presets`, `tier-labels`, `catalog`) are readable, by design.
    - As Admin without a grant: CFR's private settings and orders → 0 rows, while `leads`, `staff_listings()` and `shop_billing_info(CFR)` → readable. The `directory-admin.html` editor loads and saves a listing.
    - As Admin: PATCH CFR's `order_email`, `accepts_orders` or `owner_id` → permission denied; PATCH CFR's shop `slug` → denied; `set_shop_contact(CFR, …)` → refused. `set_listing_owner(CFR, <alt>)` → `pending-7-days`, an `owner_change` email to CFR's owner and the desk; `apply_owner_change` before 7 days → refused; after CFR's owner refuses → refused.
    - With CFR-owner's 24-hour grant: reads succeed; `invite_shop_member(CFR, <alt>, 'owner')`, a `shop_settings` update and an `orders` update → refused. After revoke → 0 rows.
    - As a Listing-plan shop owner: `add_shop_customer(<a CFR customer's email>)` → `added`, and the same reply for an unknown email; the roster shows only the typed email; `select` on that account's `customers` row → nothing.
    - As a listing owner who isn't staff: `manage-listing.html` loads (through `my_listings()`), and submitting a listing edit works (the rewritten policy).
    - anon `select * from orders` → 0 rows, no error.
    - Admin inserting itself into `shop_members` → refused. A `staff` row for a shop member → refused by the guard.
19. **Tax** [h; a gate before j; C, with its step-15 plan cancelled in the Dashboard first]. Add a Texas test registration and set `BILLING_AUTOMATIC_TAX=true` for this step only. A completed Checkout with a Texas address is taxed on 80% of the charge at the Texas rate; a second Checkout page with an Ohio address shows $0 tax (left to expire); a forced `requires_location_inputs` case sends the `invoice.finalization_failed` desk alert. `shop_subscriptions.automatic_tax` is true for the taxed rows.
20. **Notices and staff paths** [h].
    - `billing_reminders()` run by hand with B's pilot row ending in 30, 7 and 0 days sends each notice once (`billing_notices`); a `past_due` row on day 10 and 14 sends the grace notices.
    - `listing-alert` with an unknown `kind` → 400.
    - In a rolled-back transaction, a staff "Comp Featured until [date]" on an unclaimed listing → `listing_featured` true and that row of `directory_public` shows `featured` true.
    - A listing-live email for a shop with the switch on and no plan does not say "Ordering is switched on".
    - The status line names the right reason: in rolled-back transactions on B, a suspended shop, a cleared order email and a deleted `price-list` each give their own line (§8), never "your plan has ended".
    - A listing edit proposing `accepts_orders` (REST, as B-owner) is refused after M3 (step i).
21. **Build and checks** [e and h].
    - `node scripts/pricing-check.mjs` and `npm run build` are green.
    - The prerender has 14 supplier pages, with order links for CFR and Fortified only.
    - Security Advisor: the new anon-callable functions are exactly `shop_takes_orders`, `listing_featured` and `nearest_ordering_shops` (accepted, public facts).
22. **Customer deleted** [h; B, the last test-clock step]. Delete B's Customer in the Dashboard → `customer.deleted` moves the id to `previous_customer_ids`; B's plan row reads `canceled` (re-fetched, whichever event lands first) and `shop_takes_orders(B)` is false. Replaying the `customer.subscription.deleted` afterwards → applied, not `unmapped`. `resync` with that subscription id → applied. The next Checkout creates a new Customer (left to expire).
23. **Go-live** [j, after M5].
    - CFR's and Adax's open-ended pilot rows are ended (not deleted) and each has a successor ending the M5 date + 90 days; before M5 their `ends_at` was null.
    - No `shop_subscriptions`, `shop_billing` or `stripe_events` row with `livemode = false` remains; B and C have no billing rows; no `billing_lapsed` was sent by the migration.
    - `billing_config`: live mode, plans open, `test_shop_ids` empty. Adax's owner sees the plan buttons.
24. **Cleanup migration** [l, after M4]. `shop_admin_info(<CFR>)` as CFR's owner and `shop_admin_info(<Fortified>)` as a Fortified owner each return a row; Shop Settings, the pre-Send check and `my_shops` work; M4's assertion passed.

**Cleanup** (step j). Before the secrets are swapped, cancel B's and C's subscriptions in the sandbox Dashboard. M5 then deletes the test shops' billing rows and every test-mode event (§12) and asserts none remain. After M5, by SQL: delete B's and C's orders, `support_access`, `listing_owner_changes` and `shop_customer_offers` rows, then the shops (members, settings, customers and invites cascade), then the listings. `shop_billing` and `shop_subscriptions` restrict deletes, so they must be gone first, which M5 ensures.

---

## 15. Decisions to confirm before I code

1. **Prices**, as Stripe Prices, not code: Listing free, Shop $149/month, Pro $299/month, Featured +$49/month, tax-exclusive. These are starting points for pilots, not researched rates.
2. **Trial length: 30 days**, Shop or Pro, once per shop. Alternative: 14 days.
3. **No card to start a trial** (`if_required`), and a trial without a card ends in cancellation. Alternative: card up front (fewer, warmer trials; `always`). Either way, card and Link only (no ACH).
4. **Grace: 14 days** of ordering while `past_due`, with Stripe's Smart Retries over 2 weeks, then cancel. Alternative: 7 days, or "mark unpaid".
5. **Shop vs Pro contents.** Seats 2 / 5 / 15 (Listing / Shop / Pro); bases used for routing 1 / 1 / 10; everything else identical. Over the seat count, the newest staff members are inactive (nothing deleted): **at once after a downgrade; 30 days after a lapse** (trial ended without a card, day 15 of a failed card, a cancellation), so the crew finishes jobs in progress and routed orders stay readable (recommended). Alternatives: cut at once on a lapse too (contradicts "jobs in progress finish"), or a longer wind-down. Candidates to move into Pro: `order-sms`, more than one PO prefix, a future API.
6. **Founding rate:** coupon `founding`, one third off, `forever`, first 5 shops (counted by our flag and current founding subscriptions, not by a Stripe redemption limit; a founding shop that lapses frees its slot and loses the rate unless flagged again), applied by a platform admin's flag. **Pilots for CFR and Adax: 90 days from go-live** (the M5 date, step j; open-ended until then), so neither loses what Phase 2 gave it however long steps a–j take. A shop that claims a listing before go-live gets the same pilot (the trigger, §3.2). **The pilot is the shop's trial** (recommended): a plan started during it is first charged when the pilot ends; one started after it is charged at once. Dated comps set the trial end the same way but don't use up the 30-day trial. Alternatives: pilots also get the 30-day trial afterwards (in effect 90 + 30 days, and no reason to start early); 12 months (`repeating`); a public promotion code; for Adax, "trial like any new shop" instead of a pilot.
7. **Annual billing:** offer `_annual` Prices at ten months' price, or monthly only at go-live (recommended: monthly only, add annual after pilots).
8. **Featured rules:**
   - Sold on any plan, Listing included.
   - Pinned first in the directory and the picker list, with a visible label; never used for preselection.
   - A geo search puts featured listings within 100 miles first.
   - Staff featuring only as a dated comp.
9. **Fortified's comp** as a database row (`source = 'comp'`, Pro, open-ended, Featured not included). Alternative: a real $0 Stripe subscription with a 100% coupon.
10. **Fortified's order email** (proposed: today's desk address) **and its `order-sms` number**, plus `ALERT_EMAIL_TO` moving to `orders@roofcoil.com`. Also: is `order-sms` for every plan that takes orders, or Pro only?
11. **Neutral routing: option (2)** (server-side nearest by ZIP, 250-mile radius, no silent default, "tell me when" lead), with the rule published. Also:
    - Keep Fortified's existing 32 customer rows (accounts from before the platform), and stop auto-enrolment for new sign-ups. Alternative: remove the 25 auto-enrolled `tier2` rows.
    - A shop sees an account it adds by email only as that email until the account orders from it.
    - After Fortified and CFR save their lists, replace `DEFAULT_PRICE_LIST` with clearly illustrative sample numbers (later perhaps a regional median). Alternative: keep the seed and disclose that sample prices come from the operator's shop.
    - Alternatives to option (2): option (1) publish the default.
12. **Platform admin split:** two new admin logins (on which addresses?), and the existing two become Fortified-only. Platform admins **read every account's name, email, phone and ZIP** (`customers`, for sign-in support and granting admin; §9.3). Alternative: email only, the rest under a shop's support grant. Support grants up to 7 days, opened by the shop's owner, **read-only**. No admin path writes another shop's order email, switch, slug, PO, roster or orders. An owned listing changes owner only by its owner or a 7-day notified dispute. The split lands before the first non-Fortified shop pays.
13. **Tax:** which entity sells and holds the Stripe account (recommended: RoofCoil's own, not Fortified's); a Texas permit and `automatic_tax` on before the first live Checkout (or an explicit backfill); tax-exclusive prices; accountant sign-off on the 80% treatment and other states (Ohio first).
14. **Billing buttons hidden on `fortifiedmetals.com`**, with a link to `shop.roofcoil.com` instead.
15. **Branch.** This document is on `docs/phase3-billing-design`, cut from `main`, in the nested worktree `.worktrees/phase3-billing` of the app repository. Implementation gets its own branch from `main` after approval; M3 (the admin split) ships as its own PR.
16. **Time-based notices** (pilot and comp ends at 30, 7 and 0 days; grace day 10 and 14): enable `pg_cron` for one daily `billing_reminders()` job (recommended), or a manual reminder by a platform admin. Access does not depend on it either way.
17. **Disputed payments:** cancel the subscription at the period end (recommended) or immediately, plus a desk alert.
18. **CFR's saved price list** (§12 d). CFR's owner presses "Keep these prices" before the release (recommended). The only fallback is a one-off service-role script that copies today's seed into CFR's `price-list`, **run only with CFR's owner's written consent**: otherwise it is the operator, a competitor, writing another shop's data, against rule (c). Without either, CFR's ordering pauses from step f until its owner saves, and CFR's owner is told beforehand.
19. **Terms page** (`public/terms.html`: plans, cancellation, the routing rule, the visibility rules and their limit, §9.3). Who drafts it, and who reviews it legally? Checkout requires shops to accept it (`consent_collection`), so the reviewed version is a **gate for step j**. A draft marked as such serves the sandbox Checkouts from step e.
20. **Downgrade timing.** Shop ↔ Pro switches in the Portal take effect immediately with a prorated credit, and a downgrade cuts seats at once (recommended: no code). A period-end downgrade is not available in the Portal across Products (Stripe schedules downgrades only between Prices of one Product, and one Product can't hold both plans at one interval), so it would need its own "Downgrade at renewal" action in `billing-session` creating a subscription schedule, with Portal switching limited accordingly. Alternative short of that: `proration_behavior: none` (immediate, no credit).
