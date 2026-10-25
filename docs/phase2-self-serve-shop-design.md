# Phase 2 — a shop onboards itself

*Design for review, 2026-10-20. Nothing here is applied: no migration has run, no code has changed. Approve or amend this document first; the migration, the function deploys and the app edits follow it exactly. Companion to `docs/phase1-tenant-design.md` (what shipped as PRs #53–#56) and `docs/catalog-as-data-design.md` (the per-shop catalog, designed separately and not repeated here).*

**Goal.** A fabrication shop on the directory goes from "this is my shop" to taking its own orders at its own prices with **at most one hour of hand-holding** (the Phase 2 exit criterion in the commercialization plan), and runs its own people afterwards. Platform staff stop being in the loop for prices, order email, ordering on/off, members and tier names. Isolation keeps being enforced by Postgres (RLS and SECURITY DEFINER functions), not by the UI, and **Fortified's customers and staff see no change in behaviour**.

**In scope.** (1) Onboarding from a listing claim to a working shop, with a guided first run; (2) a member-management screen with invites by email; (3) `?shop=<slug>` and a shop-facing link, with subdomains sketched but not built; (4) per-shop tier names and per-shop PO number sequences; (5) the migration, the RLS guarantees before and after, the deploy order and a test plan in which a second shop onboards itself.

**Out of scope (§6).** The catalog as data; billing; subdomains (sketched only); custom domains; changing the listing-edit review for the public directory fields; transferring a shop to another owner (stays `set_listing_owner`, staff); deleting a shop (staff).

---

## 1. What is true today (verified on the hosted project, 2026-10-20)

| Fact | Consequence for the design |
|---|---|
| Two shops. **Fortified Sheet Metal** (`is_default`, slug `fortified-sheet-metal`, 2 owner members = the 2 platform staff, settings rows `custom-trim-presets` + `material-status`, 32 tier rows, 2 orders, no `owner_id`, no `order_email`). **CFR Metals** (slug `cfr-metals`, 1 owner member from its `owner_id`, **no settings rows**, 0 tier rows, 0 orders, `order_email` set). | CFR is the live example of a shop that "has saved nothing": it prices from `DEFAULT_PRICE_LIST` and nothing in the app says so. Fortified's lack of an order email is by design (desk + SMS) and must stay. |
| 14 live listings; 2 take orders; 2 have an `owner_id` — CFR, and **Adax Metals** (linked by staff, ordering off, no shop row). 2 claims so far (1 approved by the domain match, 1 dismissed). 35 accounts (3 unconfirmed), 32 `customers`, 2 `staff`. | Adax is a claimed shop with nowhere to go: it has no `shops` row until someone switches ordering on. |
| The claim path: `claim_listing` (owner set at once when the account's email is at the listing's website domain; otherwise a pending claim) → `decide_listing_claim` (staff) or `set_listing_owner` (staff, by email). Setting `owner_id` fires `listing_shop_sync`, which **creates the `shops` row only when `accepts_orders` is already on** and adds the owner membership only when a row exists. | A new owner cannot set prices before going live, because there is no shop to set them on. |
| An owner can only *propose* `accepts_orders` and `order_email` (`listing_edits` → staff apply in `/directory-admin.html`). Only platform staff update `directory_listings`. | Going live needs staff twice (approve the claim, apply the edit). Phase 2 takes those two fields out of review for a verified owner. |
| `order-alert` emails the listing's `order_email`; an order to a shop with no order email goes to the **Fortified desk + SMS**, and the customer copy carries Fortified's phone and a "Fortified Metals" footer. | A non-default shop switched on without an order email would send *its* orders to Fortified's inbox and never hear about them. Phase 2 makes the email a precondition. |
| First run in the app for a member: lands on their shop (member shop wins over the default), Price List → Backend shows the seed list with every cost at 0, the seed material/production costs and coil scale, an empty tier panel, and a Price List heading with the shop's name. Nothing distinguishes "RoofCoil's seed numbers" from "mine". Customers at `?shop=<id>` see the same seed list. | The walkthrough has to make the seed state explicit and put "save your prices" before "go live". |
| Members: `shop_members(role owner\|staff)`; the only UI is the **Admin** chip on tier-panel rows (inserts `staff`; only accounts already in the tier panel; nobody can be made `owner` except through `owner_id`). `add_shop_customer(p_shop, p_email)` answers `added` / `already` / `no-account`; nothing exists for an email with no account yet. | A members screen and invites, including for people who have not signed up. |
| `shops.slug` is filled by `shop_slug(name)` at creation; both shops have one. `?shop=` is resolved by `ordering_shop(p_id uuid)`: a slug would fail the uuid cast (PostgREST 400). The prerender builds `/suppliers/<slug>` pages with **its own** slug rule (`&` → `and`, 60-char cap); the two rules agree for 13 of the 14 listing names and differ for **L&S Metal Roofing** (`l-s-metal-roofing` vs `l-and-s-metal-roofing`). | Make `shops.slug` canonical, align `shop_slug()` with the prerender's rule, resolve both forms. |
| Tier ids `tier1` / `tier2` / `greenleaf` are the Price List columns and what orders store (`TIERS` in `pricing.mjs`). Their **names** are hardcoded in `App.jsx` at five places: the header badge, the tier `<select>` in the tier panel, the customer-view tier switcher, the backend tier rows and the "T1 · T2 · GL" per-box note, plus the customer-view heading ("Preferred Customer Pricing" / "Standard Pricing" / "Greenleaf Pricing"). "Greenleaf" is a Fortified account name. | Names per shop in `shop_settings`; ids unchanged; defaults reproduce today's words exactly so Fortified changes nothing. |
| PO numbers: `next_po_number()` = `'PO-' \|\| nextval('po_number_seq')`, one global counter (at 1006; PO-1001 and PO-1002 are live, the checklist's 1005/1006 were deleted). The **browser** calls it before submitting and sends the number inside the order's `data`; `submit-order` passes it through; the Shop Floor lets the shop edit it. | Per-shop counters, assigned by `submit-order`, the client's value ignored — the same move Phase 0 made for the price. |
| Email: Resend through edge functions. `listing-alert` handles the directory's kinds from pg_net triggers with a shared secret; `signup-email` sends confirmation links to `public/confirm.html?next=…`; sign-up on the app goes through it with `redirectTo` = the page the person was on. The sign-in card opens on an `rc:open-auth` event, not on a URL hash. | Invites ride on `listing-alert` (new kind) and on Supabase's own email confirmation; the app learns to open the sign-up card from the URL. |
| The app: tabs New Order · Job Vault · Shop Floor · Past Orders · Price List (five on a phone); Shop Floor has views Jobs and Master Materials List; `isShopOwner` and `canManageShop` already exist. `vercel.json` has two rewrites; the app is served at `shop.roofcoil.com`, at `fortifiedmetals.com/app` behind a proxy, and inside an iframe on `www.roofcoil.com/members.html`. | Shop settings go in as a third Shop Floor view rather than a sixth tab; `?shop=<slug>` works on every host; subdomains need DNS, a wildcard domain and auth allow-list changes. |

---

## 2. Onboarding: from a claim to a working shop

### 2.1 The path after Phase 2

```
claim_listing / decide_listing_claim / set_listing_owner     (unchanged)
      │  owner_id set
      ▼
listing_shop_sync  ──►  shops row (ordering OFF) + owner membership        (§2.2, changed)
      │
      ▼  owner opens shop.roofcoil.com (or the link in the "your listing is live" / claim emails)
Shop Floor → Shop Settings opens on its own: the setup checklist           (§2.4)
      1. Your prices      — Price List → Backend, seed banner, "Keep these" or edit   → shop_settings 'price-list'
      2. Order email & phone                                                            → set_shop_contact()
      3. Your people      (optional)                                                   → §3
      4. Tier names       (optional)                                                   → §5.1
      5. Go live          — set_shop_ordering(on): needs 1 and 2                        → directory_listings.accepts_orders
      │
      ▼
customers: picker (live listing) · https://shop.roofcoil.com/?shop=<slug> (any listing status) · submit-order prices at the shop's list · order-alert emails the shop
```

Platform staff touch nothing after the owner link. The directory admin keeps its switches for the cases staff still handle by hand.

### 2.2 A claimed listing is a shop at once (trigger change)

`ensure_shop_for_listing()` creates the `shops` row when **either** `accepts_orders` turns on **or** `owner_id` is set:

```sql
  if (new.accepts_orders or new.owner_id is not null)
     and not exists (select 1 from public.shops s where s.id = new.id) then
    insert into public.shops (id, slug, created_by) values (new.id, public.shop_slug(new.name), auth.uid());
  end if;
  -- owner membership add/remove: unchanged
```

The trigger's event list (`after insert or update of accepts_orders, owner_id`) is unchanged. Ordering stays the listing's `accepts_orders` flag, off until the owner switches it on (§2.5). The migration applies the rule to existing rows: **Adax Metals gets a shop (ordering off, slug `adax-metals`) and its owner becomes its `owner` member** — on their next sign-in they land on Adax (a member's shop wins over the default) with the setup checklist instead of on Fortified's prices. Nothing changes for CFR or Fortified.

### 2.3 Order email, phone and the ordering switch are the owner's (two functions)

Both are `SECURITY DEFINER`, `set search_path = ''`, executable by `authenticated`, and refuse unless `public.is_staff() or public.is_shop_owner(p_shop)`.

```sql
-- 'ok' | 'bad-email' | 'needs-email'
create function public.set_shop_contact(p_shop uuid, p_order_email text, p_phone text) returns text
-- email := nullif(lower(btrim(p_order_email)), ''); must match the regex validate_listing_edit uses, ≤ 254 chars
-- phone := left(btrim(coalesce(p_phone, '')), 40)
-- a non-default shop that is taking orders may not clear its email → 'needs-email'
-- update public.directory_listings set order_email = email, phone = phone, updated_at = now() where id = p_shop

-- 'on' | 'off' | 'needs-email' | 'needs-prices'
create function public.set_shop_ordering(p_shop uuid, p_on boolean) returns text
-- p_on and not is_default and order_email is null                              → 'needs-email'
-- p_on and not is_default and no shop_settings row (p_shop, 'price-list')      → 'needs-prices'
-- update public.directory_listings set accepts_orders = p_on, updated_at = now() where id = p_shop
```

Why direct writes instead of a `listing_edits` proposal: the owner has already proven they run the shop (domain match or staff decision); the order email is where *their* orders go and the switch is whether *they* take them, so a second staff review protects nobody. The phone is public on the directory card, but it is the shop's own number and the customer-copy email prints it; the risk of letting a verified owner correct it is small. Everything else about the listing (name, descriptions, colors, abilities, website, locations, photos) stays a proposal that staff review. `validate_listing_edit` keeps accepting `accepts_orders`/`order_email` so pending proposals still apply; `public/manage-listing.html` step 5 stops offering those two fields to a linked owner and links to the app's Shop Settings instead.

Neither function touches `listing_live_alert` (fires on `status` only). `listing_shop_sync` fires on the `accepts_orders` update and is a no-op for an existing shop apart from re-asserting the owner membership. The default shop is exempt from both preconditions: Fortified has no order email on purpose.

### 2.4 The guided first run (Shop Settings)

**Where.** Shop Floor gains a third view, **Shop Settings** (`shopFloorView === "settings"`), shown when `canManageShop` for the selected shop. Owner-only controls inside it are hidden for `staff` members. A sixth tab would not fit a phone and the Shop Floor tab is already "the shop's own area" (visible to every member, including an owner whose shop has ordering off, since `canRunShopFloor` is membership, not `accepts_orders`).

**When it opens on its own.** On load, once `memberShops` and `shopId` resolve: if the account manages the selected shop, the shop is not the default, and a required step is incomplete, the app opens Shop Floor → Shop Settings once per browser (`storage.get('setup-seen:<shop>')`, personal). Afterwards a small banner on Price List → Backend ("Setup: 1 of 3 done — open Shop Settings") remains until the required steps are done.

**The checklist is derived, not stored.** No onboarding table: each step is a fact that already lives somewhere.

| Step | Done when | Control |
|---|---|---|
| 1. Your prices (required) | a `shop_settings` row `(shop, 'price-list')` exists | opens Price List → Backend with the seed banner (below) |
| 2. Order email and phone (required) | `order_email` is set (phone is shown; it is already filled for every listing) | two fields → `set_shop_contact()` |
| 3. Your people (optional) | ≥ 2 members or ≥ 1 pending invite | the People section (§3) |
| 4. Tier names (optional) | a `tier-labels` row exists | three fields (§5.1) |
| 5. Go live (required) | `accepts_orders` | the switch → `set_shop_ordering()`; disabled with the reason while 1 or 2 is incomplete |

Shop Settings also holds, below the checklist: the **shop link** (`https://shop.roofcoil.com/?shop=<slug>` with Copy; the slug editor while ordering is off, §4), **PO numbers** (prefix and next, §5.2), and the **People** section. The screen reads one definer function, `shop_admin_info(p_shop)` — the listing's contact and ordering fields, the shop's slug and PO counter, and the facts the checklist is derived from (a `price-list` row exists, a `tier-labels` row exists, member and pending-invite counts) — for the shop's people and platform staff only; `my_shops()` still gains `slug` and `order_email` for the picker and the link. No new table for the screen itself.

**The seed banner (what a shop sees before it has saved anything).** Today the Backend shows `DEFAULT_PRICE_LIST` as if it were the shop's. After: while no `price-list` row exists for the selected shop, the Backend shows above the tiers:

> **Starting prices.** These are RoofCoil's seed numbers, not yours yet. Customers can't order from you until ordering is on. **Keep these prices** · or edit anything below — either one saves the list as yours.

"Keep these prices" calls the existing `savePriceList(priceList)` (creates the row); the first edit of any cell does the same through `updatePriceListItem`. Material and production costs and the coil width scale keep their Phase 1 behaviour (code defaults until saved) and are not part of the gate: the coil scale is sell prices a shop may legitimately leave at the seed, and costs are private. The banner is the only place the word "seed" appears; once the row exists the Backend looks exactly as it does for Fortified today. **The default shop never shows the banner or the checklist**: the seed numbers *are* Fortified's, it has no order email on purpose, and its Backend must not change. Fortified's Shop Settings holds only the link, PO numbers, tier names and People sections.

**What customers see of an unconfigured shop.** Unchanged in kind, made explicit: a shop with ordering off is not in `directory_public`'s picker rows and `ordering_shop*` returns nothing for it, so `?shop=<slug>` falls back to the usual resolution — now with a one-line notice "**<name>** isn't taking orders through RoofCoil yet" instead of silently landing on Fortified. Its own members still get it from `my_shops()` and can draw estimates; pressing Send on a shop with ordering off gets "Ordering is off for your shop — switch it on in Shop Settings" (the app checks `accepts_orders` from `my_shops()` before calling `submit-order`, which refuses anyway).

**Emails that point at the walkthrough.** `listing-alert`'s `listing_live` and `claim_decided` (approved) wording gains one line: "Set your prices and switch ordering on at https://shop.roofcoil.com/ → Shop Floor → Shop Settings." No new kinds for this.

**Rider (recommended, small): the customer's confirmation email.** `order-alert` signs every customer copy "RoofCoil.com · Fortified Metals · 972-944-7963". For a routed order (a shop with an order email) the footer becomes "RoofCoil.com · <shop name> · <shop phone>"; the desk-routed case (Fortified) is unchanged. A self-serve shop would find the current footer embarrassing on its first real order.

---

## 3. Members: owners, staff, invites

### 3.1 Roles (unchanged meaning, one new guard)

- `staff`: Price List Backend, costs, coil scale, presets, tier panel, materials board, Shop Floor, **and** Shop Settings read-only except the price-related sections (tier names) — as today, plus the read.
- `owner`: everything `staff` can do, plus ordering/contact (§2.3), the slug and PO settings, and the People section: invite, change a role, remove a member, revoke an invite.
- **The listing's `owner_id` account is the anchor owner**: it cannot be removed from `shop_members` or demoted, by anyone, while it is the listing's owner. Changing the listing owner stays what it is (`set_listing_owner`, staff; or a claim), and `listing_shop_sync` already moves the membership with it. This keeps one account that always runs the shop and makes "two owners remove each other" impossible for the one that matters.

```sql
create function public.shop_members_keep_listing_owner() returns trigger  -- before update or delete on shop_members
-- if old.user_id = (select owner_id from public.directory_listings where id = old.shop_id)
--    and (tg_op = 'DELETE' or new.role <> 'owner')
--    then raise exception 'The listing owner always runs this shop. Change the listing owner first.';
```

The existing RLS (owners and platform staff insert/update/delete; nobody deletes their own row) stays. The **Admin** chip on the tier panel stays as the shortcut it is (inserts `staff`); the People section is the full version.

### 3.2 `shop_invites` — for emails with or without an account

```sql
create table public.shop_invites (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id) on delete cascade,
  email        text not null,                      -- lower(btrim())
  role         text not null default 'staff' check (role in ('owner', 'staff')),
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null
);
create unique index shop_invites_one_pending on public.shop_invites (shop_id, email) where status = 'pending';
create index shop_invites_email on public.shop_invites (email) where status = 'pending';
alter table public.shop_invites enable row level security;
revoke all on table public.shop_invites from public, anon, authenticated;
grant select on table public.shop_invites to authenticated;
create policy "members read their shop's invites" on public.shop_invites
  for select to authenticated using (public.can_manage_shop(shop_id));
-- no insert/update/delete policies: rows are written only by the functions below (same pattern as listing_claims)
```

Expiry is lazy: an invite past `expires_at` is never accepted and the roster shows it as expired; no scheduler. Resending = revoke + invite again (the unique index allows one pending row per shop and email).

### 3.3 Functions

| Function | Who | Returns |
|---|---|---|
| `invite_shop_member(p_shop uuid, p_email text, p_role text default 'staff')` | platform staff or the shop's owners | `added` — a **confirmed** account has that email: `shop_members` row inserted now (role merge below) and an `accepted` invite row written for the email trail; `invited` — no confirmed account: a `pending` row; `already` — already a member with that role or higher; `pending` — a pending invite exists (revoke it to resend); `bad-email`; `bad-role`; `too-many` — more than 20 pending invites for the shop |
| `revoke_shop_invite(p_invite uuid)` | platform staff or the shop's owners | `revoked` / `gone` |
| `accept_shop_invites_for(p_user uuid, p_email text)` | **internal** (no grants; called by the trigger and by `accept_my_invites`) | number of invites accepted: every `pending`, unexpired row whose `email = lower(p_email)` becomes `accepted` and inserts the membership |
| `accept_my_invites()` | `authenticated` | the same, for `auth.uid()` and the account's **confirmed** email from `auth.users`; the app calls it once after sign-in and reloads `my_shops()` when it returns > 0 |
| `shop_roster(p_shop uuid)` | `can_manage_shop(p_shop)` | `(user_id, role, name, email, joined_at, is_listing_owner)` from `shop_members` left-joined to `customers`, falling back to `auth.users.email`; this avoids widening the `customers` read policy to members who have no tier row |

Role merge on acceptance or `added`: `on conflict (shop_id, user_id) do update set role = case when excluded.role = 'owner' then 'owner' else shop_members.role end` — an invite never demotes.

**Acceptance is by email ownership, not by a token.** The trigger `customers_shop_invites` (`after insert on public.customers`) calls `accept_shop_invites_for(new.id, new.email)`; a `customers` row appears exactly when an account is confirmed (`handle_confirmed_user`) or first opens the app with a session (`AuthProvider` self-heal), both of which mean Supabase has verified the inbox. `accept_my_invites()` on app load is the belt to that brace (an account confirmed before the trigger existed, or an email that changed case). A token would be a second secret proving the same thing, and a link that stops working when forwarded. Plus-tags are not folded: an invite to `nick+crew@` is accepted only by that exact address.

**Email.** A trigger on `shop_invites` (`after insert`) posts to `listing-alert` with `kind = 'shop_invite'` and `{id, status, role, email, shop_id, shop_name, shop_slug, invited_by_email, expires_at}` — same pg_net + shared-secret pattern as `listing_claim_alert`. Two wordings: `pending` → "<inviter> invited you to run <shop> on RoofCoil. Create a free account with this email address and the shop is yours to work: https://shop.roofcoil.com/?shop=<slug>#signup (link good for 14 days)"; `accepted` → "<inviter> added you to <shop>. Sign in at https://shop.roofcoil.com/?shop=<slug>#signin — you'll find its Shop Floor and Price List there." The sign-in card (`AuthGate`) learns to open on `#signup` / `#signin` at load, on that side, then clears the hash — which `public/confirm.html`'s "Go to sign in" button already assumes.

### 3.4 The People section (owner view)

Roster rows: name, email, role (`owner` / `staff`, a select for owners; the anchor owner's row shows "listing owner" and no controls), joined date, **Remove**. Below: pending invites (email, role, sent, expires, **Revoke**). Below: the invite form (email, role, **Invite**) with the function's answer as the toast ("Invite sent — they have 14 days", "Added — they'll see the shop next time they sign in", "That account is already on the list", "An invite is already out for that address — revoke it to send a new one"). `staff` members see the roster and the pending list without controls.

---

## 4. Shop slugs: `?shop=<slug>`, the shop-facing link, subdomains sketched

### 4.1 `shops.slug` is canonical

```sql
alter table public.shops
  alter column slug set not null,                                            -- both rows have one
  add constraint shops_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$');  -- 3–60, no leading/trailing hyphen
```

`shop_slug(p_name)` adopts the prerender's rule so a shop's `/suppliers/<slug>` page and its `?shop=<slug>` agree: `&` → ` and `, non-alphanumerics → `-`, trimmed, cut to 60, then `-2`, `-3`… on collision; a name that reduces to nothing becomes `shop`. The two existing slugs are unchanged by the new rule. Reserved words, refused as a shop's slug: `app www shop admin api static assets suppliers members login signin signup fortified roofcoil test`.

`set_shop_slug(p_shop, p_slug)` (owner or platform staff) returns `ok` / `invalid` / `reserved` / `taken` / `live`: an owner may change the slug **only while ordering is off** (the link has not been handed out yet); after that it is a platform-staff change, because a printed or linked slug that stops working is a support call. No slug history or redirects in Phase 2.

### 4.2 Resolution

```sql
-- anon, authenticated. A uuid or a slug; nothing for a suspended shop or one with ordering off (as ordering_shop today).
create function public.ordering_shop_by_ref(p_ref text)
returns table (id uuid, slug text, name text, phone text, city text, lat double precision, lng double precision, locations jsonb)
-- p_ref that matches the uuid pattern submit-order uses (8-4-4-4-12 hex) → s.id = p_ref::uuid; anything else → s.slug = lower(btrim(p_ref))
```

`ordering_shop(uuid)` stays for the live build during the deploy window and is dropped in the cleanup migration. `my_shops()` is dropped and recreated with `slug` and `order_email` added (same name, more columns; the live build reads columns by name). `shop_slugs()` (anon) returns `(id, slug)` for active shops whose listing takes orders, so the prerender can put an **Order from this shop** link on a supplier's page without needing table access to `shops` (`directory_public` is `security_invoker` and anon has no grant on `shops`). The link is `https://shop.roofcoil.com/?shop=<slug>`, the same one Shop Settings shows the owner.

In `App.jsx` the shop-list effect changes one branch: when `?shop=` names something not in the list, call `ordering_shop_by_ref(want)` instead of `ordering_shop(want)`; a uuid and a slug go through the same call. A reference that resolves to nothing produces the "isn't taking orders yet" notice (§2.4). The Job Vault payloads keep the uuid. Resolution order is otherwise the Phase 1 order: `?shop=` → a member's own shop → `default_shop_id()` → the first shop listed.

### 4.3 Subdomains — the sketch, not built

`<slug>.shop.roofcoil.com`:

- **DNS and hosting.** A wildcard CNAME `*.shop` → Vercel, and `*.shop.roofcoil.com` added to the Vercel project as a wildcard domain (needs the apex `roofcoil.com` DNS on Vercel or a wildcard certificate; the Vercel project's own dashboard will say which).
- **App.** `location.hostname` with four labels → the first label is the slug and wins over `?shop=`; everything else is §4.2. Served from the same build; no per-shop deploys.
- **Auth.** The Supabase project's redirect allow-list gains `https://*.shop.roofcoil.com/**`; `signup-email`'s `safeRedirect` and `public/confirm.html`'s `HOSTS` allow-list gain the wildcard; Google sign-in goes through Supabase's callback and needs nothing more.
- **The real cost.** Each subdomain is its own origin: `supabase-js` keeps the session in that origin's `localStorage`, so a contractor signed in at `shop.roofcoil.com` is signed out at `cfr.shop.roofcoil.com` and signs in once per shop. That is fine for a shop's own customers, who use one host, and tiresome for a contractor who buys from three. It is why `?shop=<slug>` ships first and subdomains wait for a shop to ask.
- **Unaffected.** The `members.html` iframe, the `fortifiedmetals.com/app` proxy, order routing (everything keys on the uuid).

---

## 5. Per-shop tier names and PO number sequences

### 5.1 Tier names — ids stay, labels move to `shop_settings`

A new `shop_settings` key **`tier-labels`**:

```json
{ "tier1":     { "name": "Tier 1 — Preferred", "heading": "Preferred Customer Pricing" },
  "tier2":     { "name": "Tier 2 — Retail",    "heading": "Standard Pricing" },
  "greenleaf": { "name": "Greenleaf",          "heading": "Greenleaf Pricing" } }
```

- **No row = exactly today's words** (the JSON above is the default in the app), so Fortified's header, selects, tier rows and headings do not change by a character. The short form used by the header badge and the per-box note is the text before ` — ` when there is one (`Tier 1`, `Tier 2`, `Greenleaf`), else the name.
- A shop edits three names in Shop Settings (any member, like the price list); the heading defaults to `<short> Pricing` when the shop has not written one. Names are 1–24 characters.
- The key joins `coil-width-scale` and `custom-trim-presets` in the **readable-by-any-signed-in-account** clause of the `shop_settings` select policy: a customer sees the name of their own tier at the shop they are ordering from. Writes stay `can_manage_shop`.
- `App.jsx`: one `tierLabels` state loaded with `shopStorage.get(shopId, 'tier-labels')` (customers included — RLS allows the key) and three helpers `tierName(id)`, `tierShort(id)`, `tierHeading(id)` replacing the string literals at the five sites in §1. The backend's per-box note keeps its "T1 · T2 · GL" shorthand until a shop names its tiers, then uses the short names. `pricing.mjs`, `submit-order`, `order-alert` and the order rows never carry a label, only the id.
- `greenleaf` stays a third tier id with a Fortified name as its default; another shop renames it ("Builder", "Contractor") and never sees the word.

### 5.2 PO numbers — one counter per shop, assigned by the server

```sql
alter table public.shops
  add column po_prefix text   not null default 'PO-'  check (po_prefix ~ '^[A-Za-z0-9-]{0,8}$'),
  add column po_next   bigint not null default 1001   check (po_next >= 1);

-- Fortified continues the global counter without a gap: 1007 today.
update public.shops set po_next = (select case when is_called then last_value + 1 else last_value end from public.po_number_seq) where is_default;

-- Service role only (submit-order). An atomic row update, so no per-shop sequence objects.
create function public.next_po_number(p_shop uuid) returns text
-- update public.shops set po_next = po_next + 1 where id = p_shop returning po_prefix || (po_next - 1)::text
revoke all on function public.next_po_number(uuid) from public, anon, authenticated;

-- 'ok' | 'invalid' | 'too-low'. Owner or platform staff. p_next must be ≥ the current po_next: numbers are never reused.
create function public.set_po_sequence(p_shop uuid, p_prefix text, p_next bigint) returns text
```

`submit-order` v3: the client's `poNumber` is ignored like its `price`; after validation and before the insert, one `admin.rpc("next_po_number", { p_shop: shopId })` per call (one job per call) stamps `poNumber` on every row; a dry run allocates nothing and returns `poNumber: null`. The reply's orders carry the number, and `insertOrders` already replaces the optimistic rows with the reply, so Past Orders and the toast show the shop's number ("Order sent — PO-1007, 3 parts, estimate $…"). `App.jsx` drops the `nextPoNumber()` pre-call and its local fallback. The Shop Floor's hand-edit of a PO stays (it is the shop's own field); gaps from failed inserts are possible, as they are with the sequence today; no uniqueness index, since multi-part jobs share one PO on purpose and the shop can type.

New shops start at `<prefix>1001`; the owner can set the prefix and the next number in Shop Settings (for a shop whose books already run at 5000). `next_po_number()` (no argument) and `po_number_seq` stay until the cleanup migration so the live build keeps working through the deploy window (§7): the old build burns one global number per order, and `submit-order` v3 overwrites it with the shop's.

---

## 6. What stays out of Phase 2

- **The catalog as data** (profiles, brands, colors, gauges, kits are code in `pricing.mjs` / `App.jsx`): designed separately in `docs/catalog-as-data-design.md`, which puts a per-shop selection under `shop_settings` key `catalog`. Nothing here depends on it; the setup checklist gains a "Your catalog" step when it ships.
- **Billing**: Stripe plans and entitlement checks (Phase 3 in the commercialization plan). `shops.status` (`active` / `suspended`) is the only kill switch and stays staff-set.
- **Subdomains and custom domains**: sketched in §4.3.
- **Listing-edit review** for the public directory fields: unchanged on purpose.
- **Transferring or deleting a shop**: `set_listing_owner` (staff) and `delete from shops` (staff). No owner-initiated transfer or delete.
- **SMS for non-default shops**: order alerts to a shop are email only (today's behaviour); Fortified's SMS is the desk's.
- **Per-shop email branding** beyond the footer rider in §2.4.
- **An admin view of every shop's setup state** for platform staff (nice for pilots; a query answers it until then).

---

## 7. Migration plan and deploy order

**One additive migration, `phase2_self_serve_shops`, in one transaction:**

1. `shops`: `po_prefix`, `po_next`, slug `not null` + format check; Fortified's `po_next` from the sequence.
2. `shop_invites`: table, indexes, RLS, the one select policy, grants.
3. Functions: `ensure_shop_for_listing` (§2.2 condition), `shop_admin_info`, `set_shop_contact`, `set_shop_ordering`, `invite_shop_member`, `revoke_shop_invite`, `accept_shop_invites_for`, `accept_my_invites`, `shop_roster`, `shop_slug` (new rule), `set_shop_slug`, `ordering_shop_by_ref`, `shop_slugs`, `my_shops` (drop + create with `slug`, `order_email`), `next_po_number(uuid)`, `set_po_sequence`; grants as in each section; trigger functions revoked from every API role (the Phase 1 lesson).
4. Triggers: `customers_shop_invites` on `customers` (after insert); `shop_invite_alert` on `shop_invites` (after insert → `listing-alert`, kind `shop_invite`); `shop_members_keep_listing_owner` on `shop_members` (before update or delete).
5. `shop_settings` select policy: `key in ('coil-width-scale', 'custom-trim-presets', 'tier-labels')`.
6. Backfill: a `shops` row (ordering off) and owner membership for every listing with an `owner_id` and no shop — Adax Metals today. Nothing else is written.

**Deploy order.**

| Step | What | Why this order |
|---|---|---|
| a | Apply the migration | Additive. The live build keeps working: `next_po_number()`, `ordering_shop(uuid)` and `my_shops()`'s old columns are all still there. |
| b | Deploy `submit-order` v3 (server PO), `listing-alert` (kind `shop_invite`, the two wording lines), `order-alert` (footer rider) | Before the build: a new build that no longer pre-allocates a PO must not meet the old function, or orders would save with no number. The old build with the new function is fine (its number is overwritten). |
| c | Merge the PR; Vercel ships the build: `App.jsx` (slug resolution, Shop Settings view with the checklist, seed banner, tier labels, People section, hash → sign-in card, no PO pre-call), `src/lib/storage.js` (unchanged), `public/manage-listing.html` (step 5 pointer), `scripts/prerender.mjs` (optional "Order from this shop" link via `shop_slugs()`) | |
| d | Later, after the test plan passes: cleanup migration `phase2_cleanup` drops `next_po_number()`, `po_number_seq` and `ordering_shop(uuid)` | Must not run while the pre-Phase-2 build is live. |

**Rollback.** Everything is additive: redeploy the previous functions and build. The new tables and columns can stay. The only data the migration writes is Adax's shop row and Fortified's `po_next`; neither is read by the old code.

**What this migration does not do.** No change to `directory_listings` columns, `directory_public`, the claim functions, `listing_edits`, `staff`, `is_staff()`, `shop_customers`, `orders`, `order_alerts`, the pg_net order triggers, `vault_items`.

---

## 8. The guarantees, before and after

| Guarantee | After Phase 1 (today) | After Phase 2 |
|---|---|---|
| A shop's ordering switch and order email | platform staff write them; an owner proposes and waits | the shop's **owners** write them through two definer functions; staff still can; a non-default shop cannot be on without an email, and cannot go on without a saved price list |
| Nobody else's orders reach Fortified's desk | true only while no other shop is on without an email (CFR has one) | enforced by `set_shop_ordering` / `set_shop_contact` for every non-default shop |
| Who runs a shop | the listing owner (trigger) + accounts an owner makes `staff` from the tier panel | the same, plus invited owners and staff; **the listing owner cannot be removed or demoted**; a second owner needs the listing owner or staff to have invited them |
| Invites | n/a | readable only by the shop's people and platform staff; written only by the functions; accepted only by an account whose **confirmed** email matches; expire after 14 days; the email carries no secret |
| Cross-shop reads | every `shop_*` policy scoped by `shop_id` through `can_manage_shop`; sell-price keys and `customer_price_list` readable by any signed-in account | the same, plus `tier-labels` in the readable-by-all key list (a name, not a price), `shop_invites` scoped like `shop_members`, `shop_roster()` / `set_*` / `invite_*` all check their `p_shop` argument |
| Slug resolution | `?shop=<uuid>` for an active shop that takes orders | `?shop=<uuid or slug>`; a shop with ordering off resolves to nothing for everyone but its members, as before; slugs are public (they are the shop's name) |
| PO numbers | one global counter, number chosen by the browser and sent with the order | one counter per shop, number chosen by `submit-order`; `next_po_number(uuid)` is service-role only; a shop can read and set only its own counter (`shops` select = members or staff) |
| Customers never see costs or margins | `shop_settings` cost keys members-only; `customer_price_list` strips `cost` | unchanged |
| Tiers only shop-editable | `shop_customers` writes = members or staff | unchanged; labels follow the same write rule |
| Platform staff can administer everything | `is_staff()` OR-ed into every policy and helper | unchanged; every new function and policy includes it |
| Fortified behaves as before | | the default shop is exempt from the email and price-list preconditions; its tier words are the defaults; its next PO is 1007 either way; its two owners are untouched; the Admin/Platform chips are untouched |

---

## 9. Test plan — a second shop onboards itself

Run on `shop.roofcoil.com` once the Phase 2 build is live (migration and functions applied first, §7). SQL checks never change data.

**Setup.** Shop B = a new **hidden** listing "RoofCoil Test Shop" (`accepts_orders` off, no order email, phone set, website `https://roofcoil-test.invalid`), created in `/directory-admin.html`. Accounts: **Staff** (your platform-staff account); **B-owner** = a fresh sign-up (`you+shopb@…`), confirmed; **Crew** = an address with **no account yet** (`you+crew@…`); **Customer** = `bassnick1@gmail.com` (exists; Fortified tier2). Reference part as in the Phase 1 plan: trim, 4 × 10 ft, 24 ga, SMP, three points — **$152.00** at the seed list, **$417.60** with 24 ga trim at 9.99.

1. **Claim → shop (§2.2).** As Staff, link B-owner as the listing's owner (Owner account → Link; this is the same write `decide_listing_claim` makes). SQL: `select slug, status, po_prefix, po_next from public.shops where id = '<B>'` → `roofcoil-test-shop, active, PO-, 1001`; `shop_members` has B-owner as `owner`; `directory_listings.accepts_orders` is still false. Also check Adax: `select count(*) from public.shops s join public.directory_listings l on l.id = s.id where l.name = 'Adax Metals'` → 1 (from the backfill).
2. **First run.** Sign in as B-owner: lands on RoofCoil Test Shop, header "Shop staff", Shop Floor opens on **Shop Settings** with the checklist (0 of 3 required). The shop link reads `https://shop.roofcoil.com/?shop=roofcoil-test-shop`. Price List → Backend shows the **Starting prices** banner. As Customer at that link: the notice "RoofCoil Test Shop isn't taking orders through RoofCoil yet", Fortified preselected, $152.00.
3. **Prices.** As B-owner, edit 24 Gauge Trim to 9.99 in all three tiers: the banner disappears, step 1 is done, `shop_settings` has `(B, 'price-list')`. Reload: still 9.99. Fortified's rows unchanged.
4. **Go live too early.** Flip the ordering switch: refused with "needs an order email" (the switch is disabled with the reason; calling `set_shop_ordering('<B>', true)` from SQL as B-owner returns `needs-email`).
5. **Contact.** Set the order email to `you+shopb@…` and a phone: `directory_listings.order_email` and `phone` updated, `updated_at` moved, step 2 done. Try an invalid email → `bad-email`.
6. **Tier names.** Rename to Contractor / Retail / Builder: `shop_settings (B, 'tier-labels')` exists; the Backend's tier rows and the tier select show the new names; as Staff on Fortified the words are still "Tier 1 — Preferred" etc.
7. **People.** Invite Crew as `staff` → "Invite sent"; `shop_invites` has a `pending` row; Crew's inbox gets the `shop_invite` email with the `#signup` link. Invite Customer as `owner` → "Added"; `shop_members` has Customer as `owner`; Customer's inbox gets the "added" email. Open Crew's link in a fresh browser: the sign-up card is already open; sign up with the Crew address and confirm: on landing, `shop_members` has Crew as `staff`, the invite is `accepted`, Crew lands on RoofCoil Test Shop as Shop staff with Shop Settings read-only. As Customer (now an owner) try to remove B-owner → refused ("The listing owner always runs this shop"); demote Customer to `staff` as B-owner → allowed; invite Crew again → `already`; revoke a fresh pending invite to a third address → `revoked`, no email on acceptance attempts. SQL as B-owner: `update public.shop_invites set status = 'accepted'` → refused by RLS (no policy); `select * from public.shop_invites where shop_id = '<Fortified>'` → 0 rows.
8. **Slug.** As B-owner change the slug to `test-shop-b`: `ok`; `?shop=roofcoil-test-shop` now resolves to nothing, `?shop=test-shop-b` to B; try `app` → `reserved`, `cfr-metals` → `taken`, `x` → `invalid`.
9. **Go live.** Flip the switch: `on`; `accepts_orders = true`; the shop is **not** in anyone's picker (hidden listing) but `?shop=test-shop-b` and `?shop=<uuid>` both resolve. Now change the slug again → `live` (refused).
10. **A customer orders.** As Customer at `?shop=test-shop-b`: RoofCoil Test Shop preselected, header "Tier: Retail", 9.99, $417.60. Send the reference part: toast names **PO-1001**; Past Orders shows PO-1001 "Sent to RoofCoil Test Shop"; `orders` newest row has `shop_id = B`, `data->>'poNumber' = 'PO-1001'`, `data->>'price' = '417.6'`; `shops.po_next` for B is 1002, for Fortified still 1007; the order email arrived at `you+shopb@…` (no desk email, no SMS: `order_alerts.status->>'routed' = 'true'`); the customer copy names RoofCoil Test Shop, its phone, and ends "RoofCoil.com · RoofCoil Test Shop · <phone>".
11. **PO settings.** As B-owner set prefix `RT-` and next `5000`: `ok`; a second order from Customer is **RT-5000**; set next to `4000` → `too-low`.
12. **Fortified regression (Staff).** Header "Staff"; Fortified preselected; Price List words unchanged; Backend shows **no** seed banner and no setup banner (Fortified has no saved `price-list` row and still prices from the code defaults, as today); Shop Settings for Fortified shows no checklist, ordering on, no order email (allowed: default shop), PO next 1007; the tier panel still lists every account with the Admin and Platform chips; send one order to Fortified → **PO-1007**, desk email + SMS as before, customer copy signed "Fortified Metals" as before. Adax's owner, if they sign in, lands on Adax's checklist and can still pick Fortified in the picker.
13. **Isolation at the database (B-owner's session, as in the Phase 1 plan §5).** `set_shop_ordering('<Fortified>', false)` → exception (not an owner); `invite_shop_member('<Fortified>', …)` → exception; `set_po_sequence('<Fortified>', 'X-', 1)` → exception; `select po_next from public.shops where id = '<Fortified>'` → 0 rows; `shop_roster('<Fortified>')` → exception; `next_po_number('<B>')` → permission denied (service role only).
14. **Build, checks, advisors.** `node scripts/pricing-check.mjs` and `npm run build` green; prerender lists 14 supplier pages (the hidden test shop is not among them) and, if the optional link ships, CFR's and Fortified's pages carry "Order from this shop"; Security Advisor: the only new items are the anon-executable `ordering_shop_by_ref` and `shop_slugs` (intended) and the authenticated-callable definer functions, the same class as Phase 1's.

**Cleanup.** Delete B's orders; `delete from public.shops where id = '<B>'` (cascades members, settings, invites), then the listing; delete the Crew account (and B-owner if not wanted) in Authentication → Users; Customer keeps its Fortified row. Or keep B hidden as the permanent demo shop.

---

## 10. Decisions to confirm before I code

1. **A claimed listing is a shop at once, ordering off** (§2.2). Effect today: Adax Metals gets a shop and its owner lands on Adax's setup checklist instead of Fortified's prices. Alternative: keep "shop only when ordering is on" and add a staff step — which is the hand-holding this phase is meant to remove.
2. **Owners set ordering on/off, the order email and the phone directly** in the app (§2.3); `manage-listing.html` stops offering those two fields; every other listing field stays under staff review. Alternative: keep the phone under review (then the checklist shows it read-only with a "propose a change" link).
3. **Preconditions for going live** (non-default shops): an order email **and** a saved price list ("Keep these prices" counts). CFR stays live as it is and sees "Your prices: not saved" on its checklist until it saves. Alternative: email only, and let a shop go live on the seed numbers.
4. **Shop Settings lives as a third Shop Floor view**, opened once on its own while required steps are incomplete. Alternative: a sixth tab (tight on a phone) or a card at the top of Price List → Backend.
5. **Invites are accepted by email ownership, no token**; existing confirmed accounts are added immediately and emailed; 14-day expiry; at most 20 pending per shop. Alternative: tokened links (adds a secret and a page, buys nothing the confirmation email does not already prove).
6. **The listing owner is the anchor**: cannot be removed or demoted; more owners can be invited. Alternative: any owner can remove any other, including the listing owner (then the listing's owner link and the shop's membership can disagree).
7. **Slugs**: `shops.slug` canonical; `shop_slug()` adopts the prerender's rule (`&` → `and`); an owner may change the slug only while ordering is off; `?shop=<slug>` ships, subdomains do not (§4.3).
8. **Tier labels**: one name (and an optional heading) per tier id under `shop_settings` key `tier-labels`, readable by any signed-in account, editable by the shop's people; defaults are today's exact words.
9. **PO numbers**: per-shop prefix + counter on `shops`, assigned by `submit-order`, client value ignored; Fortified continues at 1007, new shops start at 1001; owners can set prefix and next (never lower); the global sequence is dropped in the cleanup migration.
10. **The email footer rider** in `order-alert` (routed orders sign with the shop's name and phone) and the one-line pointers in `listing-alert`'s live/approved emails ride along with this phase.
11. **Branch.** This document is on `docs/phase2-self-serve-shop-design`, cut from `main`, in a nested worktree at `fortified-shop-app/.worktrees/phase2-design` (excluded from `git status`, like the Phase 1 worktrees). Implementation gets its own branch from `main` after approval; the catalog work stays on its own branch and is not a dependency.

---

## 11. Results — run on 2026-10-20 against shop.roofcoil.com (bundle `index-DGewIaAE.js`)

Migration `20261020181706_phase2_self_serve_shops` applied, submit-order / listing-alert / order-alert at v5, PR #59 merged. Checks that need a specific database role were run as SQL with the JWT claims simulated and the transaction rolled back by a deliberate exception, so they wrote nothing.

**Accounts used, and how they differ from the plan.** The fresh B-owner sign-up did not happen (the sign-up form was never submitted), so **the platform-staff account nbass@greenleaf-roofing.com was linked as the test listing's owner** and played B-owner. That covers every shop-side screen and function, because the functions check `is_shop_owner` and a staff account passes `is_staff` too; it does not cover the member-only UI (the "Shop staff" header, landing on one's own shop, no Platform chips), which still needs a non-staff account. The plain-owner refusals were verified by simulating bassnick1 as a non-staff owner in SQL. bassnick1@gmail.com (a plain customer in Phase 1) now owns the catalog walk's test shop, so it was used only as the "existing account" for the invite checks. The customer order was sent by the staff account at the test shop. The crew invite went to nbass+crew@greenleaf-roofing.com and is still pending.

| Step | Result | Evidence |
|---|---|---|
| 1 Claim → shop | **Pass** | Hidden listing "RoofCoil Test Shop (Phase 2)" inserted with ordering off: no `shops` row. Setting `owner_id` (the write a claim makes) created the shop through `listing_shop_sync`: slug `roofcoil-test-shop-phase-2`, `PO-`/1001, ordering still off, owner membership. Adax Metals has a shop from the backfill. |
| 2 First run | **Pass** | Opening `?shop=<id>` as the owner landed on Shop Floor → **Shop Settings** by itself: "0 of 3 required steps done", the five steps, link `?shop=roofcoil-test-shop-phase-2`, PO next 1001, People showing the listing owner. |
| 3 Prices | **Pass** | Backend showed the **Starting prices** banner and "Setup: 1 of 3 … open Shop Settings". **Keep these prices** removed the banner and wrote the 40-row `price-list`; the tier rows read Contractor / Retail / Builder; 24 Gauge Trim edited to 9.99 × 3 and read back from `shop_settings`. Fortified still has no `price-list` row. |
| 4 Go live too early | **Pass** | Switch on before the email: banner "Add your order email first — every order is sent there." `set_shop_ordering` as the owner with an email but no list → `needs-prices`. |
| 5 Contact | **Pass** | `not-an-email` → `bad-email`; the real email and phone saved to `directory_listings`; step 2 ticked. Clearing the email while live → `needs-email`. |
| 6 Tier names | **Pass** | Contractor / Retail / Builder saved under `tier-labels`; shown on the Backend tier rows and in Shop Settings after a reload; Fortified's words unchanged. |
| 7 People | **Pass** | Crew address → "Invite sent — 14 days", pending row good until 11/3/2026, listing-alert 202. bassnick1 → **Added** as owner at once, `accepted` invite row, 202. Same address again → "An invite is already out…". Role Owner → Staff saved; **Revoke** and **Remove** worked; re-invite created a new pending row. SQL: removing or demoting the listing owner refused ("The listing owner always runs this shop…"); a pending invite accepted for a matching account made the membership and marked the row `accepted`; `revoke_shop_invite` by a non-owner refused. |
| 8 Slug | **Pass** | Rename to `test-shop-b` updated the link; `cfr-metals` / `adax-metals` → `taken`, `x` / `Has Spaces!` → `invalid`, `app` → `reserved`. After going live: a non-staff owner's rename → `live`; the staff account's rename is allowed (by design). |
| 9 Go live | **Pass** | Switch on → "SHOP SETUP — DONE", "Taking orders through RoofCoil", "Your listing isn't public…", slug editor replaced by the fixed-name note. Anonymous `ordering_shop_by_ref`: `test-shop-b`, `TEST-SHOP-B` and the uuid resolve; the old slug returns nothing; `shop_slugs()` lists it. |
| 10 Order | **Pass** | Picker: CFR, Fortified, RoofCoil Test Shop (Phase 2) preselected. Estimate **$485.54** (default part, 40 LF × 9.99 × 1.15 + 16 + 10). Toast "Order sent — **PO-1001**, 1 part, estimate $485.54". Row: `shop_id` = B, `poNumber` PO-1001, price 485.54, `tier2`; B's `po_next` 1002; Fortified's 1007; a tier row for the account at B; `order_alerts`: routed to nbass+shopb, customer copy sent; order-alert 202. The Shop Floor job card says "Sent to RoofCoil Test Shop (Phase 2)". |
| 11 PO settings | **Pass** | Prefix `RT-` next 5000 saved; 4000 → `too-low`; `TOO-LONG-PREFIX` → `invalid`; `next_po_number(B)` (rolled back) → RT-5000 then RT-5001. |
| 12 Fortified | **Pass** | Plain URL as Staff: Fortified preselected; Customer View words "Tier 1 — Preferred / Greenleaf / Tier 2 — Retail", heading "Preferred Customer Pricing", 24 ga trim $3.00; Backend: no seed banner, no setup line, Admin and Platform chips; Shop Settings: no checklist, ordering on, empty order email with the default-shop note, next PO-1007, both staff as owners; Shop Floor lists all three jobs. Database: Fortified's settings keys, 32 tier rows, 2 members and 2 orders unchanged, `po_number_seq` still 1006. |
| 13 Isolation | **Pass** | As bassnick1 (not a member of B) with `role authenticated`: B private settings 0, `tier-labels` 1 (readable by design), invites 0, members 0, shops 0, `shop_admin_info` 0, `shop_roster` 0, B orders 0; `customer_price_list(B)` has no `cost` and shows 9.99; Fortified private settings 0, members 0; inserting an invite → permission denied; `next_po_number(B)` → permission denied. `set_shop_ordering` / `invite_shop_member` / `set_shop_slug` for B as a non-member → "Only the shop's owners…". |
| 14 Build, advisors | **Pass** (build) | pricing-check and build green on PR #59; 2 supplier pages carry "Order from this shop" (CFR, Fortified) and www.roofcoil.com/suppliers/cfr-metals shows it live. Security Advisor not re-run after the apply. |

**Findings** (none blocks; all are follow-ups):

1. **Platform staff cannot reach a shop with ordering off unless they are a member.** `ordering_shop_by_ref` answers only for shops taking orders, and `my_shops()` only for members, so a staff account helping a shop before it goes live has no way to select it. Fix: let `ordering_shop_by_ref` (or a staff-only variant) resolve any active shop for `is_staff()`.
2. **Toasts are out of sight on long pages.** The toast renders at the top of the page, not fixed, so "Saved.", refusals and "Invite sent" fired from controls far down Shop Settings are not visible without scrolling up. A fixed-position toast, or inline feedback beside each Save, would fix it.
3. **Shop Settings does not refresh after an order.** The PO "Next number" and "Next order" preview still showed 1001 after PO-1001 was taken, until the shop was reselected. `reloadShopInfo` should run when the settings view opens.
4. **A refused PO save keeps the typed value** (4000 stayed in the field and the preview read RT-4000) although the server kept 5000. Reset the fields to the saved values on refusal.
5. **`#signup` stays in the URL** when an already-signed-in session loads it (the hash is only cleared when the card opens). Cosmetic.
6. **"(no name)" in rosters** for accounts whose `customers.name` is empty (the two staff accounts). Fall back to the email's local part.
7. **The default shop has no anchor owner** (Fortified's listing has no `owner_id`), so its two owners can remove each other; platform staff can always re-add. Acceptable, noted.
8. **Staff can rename a live shop's slug** (by design; the function exempts `is_staff()`).

**Not covered by this run:** the member-only UI as a non-staff member or owner (lands on own shop, "Shop staff" header, no Platform chip); the customer view at the test shop as a plain account (no Backend toggle, "Tier: Retail" badge); a real sign-up accepting the pending crew invite (the function path was exercised in a rolled-back transaction); the wording of the three emails (delivered per Resend; check the inbox).

**Cleanup (2026-10-20, on the owner’s go):** the test order and its `order_alerts` row, the shop row (cascading its member, settings, tier row and invites) and the hidden listing were deleted, in that order. Verified afterwards: no row of any kind left for the test shop, three shops remain (Fortified, CFR Metals, Adax Metals), nbass@greenleaf-roofing.com is back to Fortified only, two orders in the table (the legacy ones), Fortified’s next PO still 1007. No test accounts were created, so none needed removing; the pending invite to nbass+crew@greenleaf-roofing.com went with the shop.
