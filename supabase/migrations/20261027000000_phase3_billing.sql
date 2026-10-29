-- Phase 3, migration M1: plans, billing and entitlements. Design: docs/phase3-billing-design.md.
--
-- A shop pays RoofCoil a monthly plan to take orders through RoofCoil. Every grant of a plan
-- or of Featured is a row in shop_subscriptions: Stripe subscriptions, written only by the
-- stripe-webhook and billing-session functions through billing_apply_subscription, and comp
-- or pilot rows, written only by platform admins (comp_shop, end_comp; append-only), the
-- migrations and, until plans open, the pilot trigger on new shops. shop_entitlement() is the
-- one place that turns those rows into what a shop may do today; shop_order_block() adds the
-- shop's own conditions (moderation, the owner's switch, an order email, a saved price list)
-- and names the first one missing. Time is read when the functions run, so a trial, a grace
-- period or a pilot's end date runs out without any event.
--
-- Additive and dormant on purpose: no existing gate reads the new functions yet (M2 flips
-- them), and nothing exists in Stripe. Live from here: the grandfather rows (Fortified's comp,
-- found by slug, and an open-ended pilot for every other shop), the pilot trigger, the daily
-- billing_reminders() job (nothing to send before go-live) and the columns my_shops and
-- shop_admin_info gain. Those two are dropped and recreated because their return types widen;
-- every existing column stays, in order, and their grants are restored exactly, so the build
-- that is live while this applies keeps working. No other existing object changes.
--
-- Also here, ahead of the platform-admin split (§9.4 S0) and neutral routing (§9.2): support
-- grants, the definer reads S1 switches to, ownership-change records, offers to accounts a
-- shop adds by email, a copy of the tier rows that exist now (the customer roster's pre-M1
-- accounts), and ZIP centroids (loaded by scripts/load-zip-centroids.mjs, not here).

/* ------------------------------------------------------------- extensions */
-- One daily job sends the time-based notices (decision 16). Access never depends on it.
create extension if not exists pg_cron with schema pg_catalog;

/* ----------------------------------------------------------------- tables */
-- Every table below is born locked: no API role reads or writes it except support_access,
-- which owners and platform admins may read. The functions further down are the way in.

-- One row. Which Stripe mode counts, and who may buy before plans open (§12 c, j).
create table public.billing_config (
  id            boolean primary key default true check (id),
  livemode      boolean not null default false,   -- a Stripe row grants access only when its livemode equals this (§4.1)
  plans_open    boolean not null default false,   -- false: billing-session and the plan card serve only test_shop_ids
  test_shop_ids uuid[]  not null default '{}'     -- the hidden test shops (B and C, §14) while plans are closed; set before their claims
);
insert into public.billing_config default values;
alter table public.billing_config enable row level security;
revoke all on table public.billing_config from public, anon, authenticated;

-- Limits per plan. The only place they live; changed by migration. No amounts: prices live in Stripe.
create table public.billing_plans (
  key          text primary key check (key in ('listing', 'shop', 'pro')),
  rank         int  not null unique,
  takes_orders boolean not null,
  seats        int  not null check (seats >= 1),   -- shop_members rows; pending invites also count when inviting
  bases        int  not null check (bases >= 1)    -- entries of directory_listings.locations used for routing
);
insert into public.billing_plans values ('listing', 0, false, 2, 1), ('shop', 1, true, 5, 1), ('pro', 2, true, 15, 10);
alter table public.billing_plans enable row level security;
revoke all on table public.billing_plans from public, anon, authenticated;

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
  has_payment_method    boolean not null default false,   -- the Customer has a default card (plan card, §8); kept by the webhook and sync
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.shop_billing enable row level security;
revoke all on table public.shop_billing from public, anon, authenticated;

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
alter table public.shop_subscriptions enable row level security;
revoke all on table public.shop_subscriptions from public, anon, authenticated;

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
alter table public.stripe_events enable row level security;
revoke all on table public.stripe_events from public, anon, authenticated;

-- Time-based notices already sent (§6.3), so the daily job sends each once.
create table public.billing_notices (
  grant_id  uuid not null references public.shop_subscriptions(id) on delete cascade,
  kind      text not null,                 -- ends_30 | ends_7 | ended | grace_10 | grace_14
  sent_at   timestamptz not null default now(),
  primary key (grant_id, kind)
);
alter table public.billing_notices enable row level security;
revoke all on table public.billing_notices from public, anon, authenticated;

-- US ZIP (ZCTA) centroids from the Census Bureau's 2020 Gazetteer file (public domain, ~33,800
-- rows). Empty here; scripts/load-zip-centroids.mjs loads it once with the service key.
create table public.zip_centroids (
  zip text primary key check (zip ~ '^\d{5}$'),
  lat double precision not null,
  lng double precision not null
);
alter table public.zip_centroids enable row level security;
revoke all on table public.zip_centroids from public, anon, authenticated;

-- A shop owner's read-only consent for platform admins to see the shop (§9.3), for at most 7
-- days. Written only by grant_/revoke_support_access; the shop's owners see their grants.
create table public.support_access (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  granted_by  uuid not null,
  reason      text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  revoked_by  uuid,
  check (expires_at > created_at and expires_at <= created_at + interval '7 days')
);
create index support_access_shop on public.support_access (shop_id);
alter table public.support_access enable row level security;
revoke all on table public.support_access from public, anon, authenticated;
grant select on table public.support_access to authenticated;
create policy "owners and platform admins read support grants" on public.support_access
  for select to authenticated using (public.is_shop_owner(shop_id) or public.is_staff());

-- Every change of a listing's owner, applied or pending (§9.4 S2 item 8): an owned listing
-- changes owner only after 7 days' notice its current owners can refuse. Nothing writes rows
-- until M3 rewires set_listing_owner and decide_listing_claim.
create table public.listing_owner_changes (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references public.directory_listings(id) on delete cascade,
  kind              text not null check (kind in ('link', 'dispute')),
  source            text not null check (source in ('set_listing_owner', 'decide_listing_claim')),
  claim_id          uuid references public.listing_claims(id) on delete set null,
  from_owner_id     uuid,
  from_owner_emails text[] not null default '{}',
  to_owner_id       uuid,                 -- null: the owner is cleared
  to_email          text,
  status            text not null check (status in ('applied', 'pending', 'refused')),
  requested_by      uuid,
  created_at        timestamptz not null default now(),
  effective_at      timestamptz not null,
  refused_by        uuid,
  refused_at        timestamptz,
  applied_by        uuid,
  applied_at        timestamptz
);
create index listing_owner_changes_listing on public.listing_owner_changes (listing_id);
alter table public.listing_owner_changes enable row level security;
revoke all on table public.listing_owner_changes from public, anon, authenticated;

-- A tier a shop gave an email that has no account yet (§9.3); becomes a shop_customers row at
-- sign-up. Nothing writes rows until M3 changes add_shop_customer.
create table public.shop_customer_offers (
  shop_id     uuid not null references public.shops(id) on delete cascade,
  email       text not null,
  tier        text not null default 'tier2' check (tier in ('tier1', 'tier2', 'greenleaf')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  primary key (shop_id, email)
);
alter table public.shop_customer_offers enable row level security;
revoke all on table public.shop_customer_offers from public, anon, authenticated;

-- The tier rows that exist when this migration runs (§9.3, "tier rows created before it",
-- decision 11): the accounts a shop already had, whose name and phone its roster keeps showing.
-- A copy rather than a test on shop_customers.created_at, because members can write that column
-- and so could backdate any account into view. Read only by shop_customer_roster.
create table public.shop_customers_before_phase3 (
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references public.customers(id) on delete cascade,
  primary key (shop_id, user_id)
);
alter table public.shop_customers_before_phase3 enable row level security;
revoke all on table public.shop_customers_before_phase3 from public, anon, authenticated;
insert into public.shop_customers_before_phase3 (shop_id, user_id)
select shop_id, user_id from public.shop_customers;

/* ------------------------------------------------------------ entitlement */
-- Internal (service role only): one shop's grants with the per-grant rule of shop_entitlement's
-- grants CTE, for the functions below that need the rows themselves (the plan card, the staff
-- list, the webhook's duplicate check, the reminders). Never returns a Stripe id. M1 asserts
-- at the end that the two copies of the rule agree for every shop.
create function public.shop_grants(p_shop uuid)
returns table (id uuid, shop_id uuid, kind text, plan text, source text, status text, livemode boolean,
               trial_end timestamptz, current_period_end timestamptz, cancel_at_period_end boolean,
               cancel_at timestamptz, past_due_since timestamptz, coupon text, ends_at timestamptz, note text,
               created_by uuid, created_at timestamptz, ended_at timestamptz, grace_until timestamptz,
               current boolean, access_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  -- keep in step with public.shop_entitlement (§4.1 grants CTE)
  select s.id, s.shop_id, s.kind, s.plan, s.source, s.status, s.livemode, s.trial_end, s.current_period_end,
         s.cancel_at_period_end, s.cancel_at, s.past_due_since, s.coupon, s.ends_at, s.note, s.created_by,
         s.created_at, s.ended_at,
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
  where s.shop_id = p_shop;
$$;
revoke all on function public.shop_grants(uuid) from public, anon, authenticated;
grant execute on function public.shop_grants(uuid) to service_role;

-- The single source of truth (§4.1). Internal: no API role may call it (§13). Definer functions
-- and the service role read it. There is no is_default and no shop name anywhere in it.
create function public.shop_entitlement(p_shop uuid)
returns table (plan text, takes_orders boolean, seats int, read_seats int, read_seats_until timestamptz,
               bases int, featured boolean, source text, status text, plan_until timestamptz, grace_until timestamptz)
language sql stable security definer set search_path = ''
as $$
  -- keep in step with public.shop_grants
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
revoke all on function public.shop_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.shop_entitlement(uuid) to service_role;

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
revoke all on function public.shop_order_block(uuid) from public, anon, authenticated;
grant execute on function public.shop_order_block(uuid) to service_role;

-- anon, authenticated, service_role. Public by nature: the fact directory_public shows for live
-- listings (from M2), and what the picker, ?shop= and the prerender links will read.
create function public.shop_takes_orders(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.shop_order_block(p_shop) is null;
$$;
revoke all on function public.shop_takes_orders(uuid) from public, anon, authenticated;
grant execute on function public.shop_takes_orders(uuid) to anon, authenticated, service_role;

-- anon, authenticated, service_role. Whether a listing is featured right now: paid, or a dated comp.
create function public.listing_featured(p_listing uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select e.featured from public.shop_entitlement(p_listing) e), false);
$$;
revoke all on function public.listing_featured(uuid) from public, anon, authenticated;
grant execute on function public.listing_featured(uuid) to anon, authenticated, service_role;

-- Internal. Seats enforced on read (§4.3 row 10): owners always, then the oldest staff members
-- (by joining, then user id) up to read_seats minus the owners. Nobody is deleted: a member past
-- the count is inactive until the plan covers them again. False for a non-member.
create function public.shop_member_seated(p_shop uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when m.role = 'owner' then true
      else (select count(*) from public.shop_members o
            where o.shop_id = p_shop and o.role = 'staff'
              and (o.created_at, o.user_id) < (m.created_at, m.user_id))
           < greatest((select e.read_seats from public.shop_entitlement(p_shop) e)
                      - (select count(*) from public.shop_members o where o.shop_id = p_shop and o.role = 'owner'), 0)
    end
    from public.shop_members m
    where m.shop_id = p_shop and m.user_id = p_user), false);
$$;
revoke all on function public.shop_member_seated(uuid, uuid) from public, anon, authenticated;
grant execute on function public.shop_member_seated(uuid, uuid) to service_role;

-- A platform admin may read a shop's private data only while its owner's grant is open (§9.3).
-- Feeds can_view_shop alone; nothing that writes reads it, so a grant can never change anything.
create function public.has_support_access(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_staff()
     and exists (select 1 from public.support_access a
                 where a.shop_id = p_shop and a.revoked_at is null and a.expires_at > now());
$$;
revoke all on function public.has_support_access(uuid) from public, anon, authenticated;
grant execute on function public.has_support_access(uuid) to authenticated, service_role;

-- Who may read a shop's private data: its people, or a platform admin under a support grant.
-- No policy uses it until M3.
create function public.can_view_shop(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_shop_member(p_shop) or public.has_support_access(p_shop);
$$;
revoke all on function public.can_view_shop(uuid) from public, anon, authenticated;
grant execute on function public.can_view_shop(uuid) to authenticated, service_role;

/* ---------------------------------------------------------------- readers */
-- my_shops gains takes_orders (so a member's Send on a paused own shop is refused before the
-- call), plan, and seated (so an inactive member is told why). The 13 existing columns, the
-- joins and the filter are unchanged. Dropped and recreated because the return type widens,
-- which resets its grants: restored as they were (authenticated, service_role; no anon).
drop function if exists public.my_shops();
create function public.my_shops()
returns table (id uuid, name text, phone text, city text, lat double precision, lng double precision, locations jsonb,
               accepts_orders boolean, listing_status text, shop_status text, role text, slug text, order_email text,
               takes_orders boolean, plan text, seated boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.name, l.phone, l.city, l.lat, l.lng, l.locations, l.accepts_orders, l.status, s.status, m.role, s.slug, l.order_email,
         public.shop_order_block(s.id) is null,
         (select e.plan from public.shop_entitlement(s.id) e),
         public.shop_member_seated(s.id, m.user_id)
  from public.shop_members m
  join public.shops s on s.id = m.shop_id
  join public.directory_listings l on l.id = s.id
  where m.user_id = auth.uid()
  order by l.name;
$$;
revoke all on function public.my_shops() from public, anon, authenticated;
grant execute on function public.my_shops() to authenticated, service_role;

-- shop_admin_info gains the effective ordering state and the plan fields, so Shop Settings names
-- the clause that is missing (order_block) instead of a blanket "your plan has ended". The 15
-- existing columns stay in order; is_default stays for the live build until M4. plan_lapse tells
-- a lapsed plan apart: 'overdue' (a failed card past its 14 days), 'ended', or null when a plan
-- is current or the shop never had one. Same drop, recreate and re-grant as my_shops.
drop function if exists public.shop_admin_info(uuid);
create function public.shop_admin_info(p_shop uuid)
returns table (id uuid, name text, slug text, phone text, order_email text, accepts_orders boolean,
               listing_status text, shop_status text, is_default boolean, po_prefix text, po_next bigint,
               price_list_saved boolean, tier_labels_saved boolean, member_count integer, pending_invites integer,
               takes_orders boolean, order_block text, plan text, plan_source text, plan_status text,
               plan_takes_orders boolean, plan_lapse text, plan_until timestamptz, grace_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, l.name, s.slug, l.phone, l.order_email, l.accepts_orders, l.status, s.status, s.is_default, s.po_prefix, s.po_next,
         exists (select 1 from public.shop_settings x where x.shop_id = s.id and x.key = 'price-list'),
         exists (select 1 from public.shop_settings x where x.shop_id = s.id and x.key = 'tier-labels'),
         (select count(*)::int from public.shop_members m where m.shop_id = s.id),
         (select count(*)::int from public.shop_invites i where i.shop_id = s.id and i.status = 'pending' and i.expires_at > now()),
         ob.block is null, ob.block, e.plan, e.source, e.status, e.takes_orders,
         case
           when e.source <> 'none' then null
           when exists (select 1 from public.shop_grants(s.id) g
                        where g.kind = 'plan' and g.source = 'stripe' and g.status = 'past_due'
                          and g.livemode is not distinct from (select c.livemode from public.billing_config c)) then 'overdue'
           when exists (select 1 from public.shop_grants(s.id) g
                        where g.kind = 'plan'
                          and (g.source <> 'stripe'
                               or (g.livemode is not distinct from (select c.livemode from public.billing_config c)
                                   and g.status not in ('incomplete', 'incomplete_expired')))) then 'ended'
         end,
         e.plan_until, e.grace_until
  from public.shops s
  join public.directory_listings l on l.id = s.id
  cross join lateral public.shop_entitlement(s.id) e
  cross join lateral (select public.shop_order_block(s.id) as block) ob
  where s.id = p_shop and public.can_manage_shop(p_shop);
$$;
revoke all on function public.shop_admin_info(uuid) from public, anon, authenticated;
grant execute on function public.shop_admin_info(uuid) to authenticated, service_role;

-- Everything the owner's plan card shows (§8), for the shop's members and platform admins;
-- zero rows for anyone else. Never a Stripe id: has_customer and has_payment_method are flags.
-- b is the plan row the entitlement uses (the same pick as shop_entitlement's best); f is the
-- Featured row shown, a paid one before a comp.
create function public.shop_billing_info(p_shop uuid)
returns table (shop_id uuid, plan text, plan_takes_orders boolean, source text, status text, takes_orders boolean,
               order_block text, plan_lapse text, trial_end timestamptz, current_period_end timestamptz,
               cancel_at_period_end boolean, cancel_at timestamptz, plan_until timestamptz, grace_until timestamptz,
               past_due_since timestamptz, founding boolean, grant_ends_at timestamptz, granted_by_email text,
               featured boolean, featured_source text, featured_until timestamptz, featured_granted_by_email text,
               trial_available boolean, offer text, has_customer boolean, has_payment_method boolean,
               plans_open boolean, test_mode boolean, seats int, read_seats int, read_seats_until timestamptz,
               bases int, seats_used int, pending_invites int, inactive_members jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select g.* from public.shop_grants(p_shop) g join public.billing_plans p on p.key = g.plan
    where g.kind = 'plan' and g.current
    order by p.rank desc, g.ends_at desc nulls first limit 1
  ), f as (
    select g.* from public.shop_grants(p_shop) g
    where g.kind = 'featured' and g.current
    order by (g.source = 'stripe') desc, g.created_at desc limit 1
  )
  select p_shop, e.plan, e.takes_orders, e.source, e.status,
         ob.block is null, ob.block,
         case
           when e.source <> 'none' then null
           when exists (select 1 from public.shop_grants(p_shop) g
                        where g.kind = 'plan' and g.source = 'stripe' and g.status = 'past_due'
                          and g.livemode is not distinct from c.livemode) then 'overdue'
           when exists (select 1 from public.shop_grants(p_shop) g
                        where g.kind = 'plan'
                          and (g.source <> 'stripe'
                               or (g.livemode is not distinct from c.livemode
                                   and g.status not in ('incomplete', 'incomplete_expired')))) then 'ended'
         end,
         b.trial_end, b.current_period_end, coalesce(b.cancel_at_period_end, false), b.cancel_at,
         e.plan_until, e.grace_until, b.past_due_since, coalesce(b.coupon = 'founding', false),
         case when b.source in ('comp', 'pilot') then b.ends_at end,
         (select u.email::text from auth.users u where u.id = b.created_by and b.source in ('comp', 'pilot')),
         e.featured, f.source,
         case when f.source = 'stripe'
              then case when f.cancel_at_period_end or f.cancel_at is not null then coalesce(f.cancel_at, f.current_period_end) end
              else f.ends_at end,
         (select u.email::text from auth.users u where u.id = f.created_by and f.source <> 'stripe'),
         -- one trial per shop, and a pilot was the shop's trial (§5.2); a comp doesn't use it up
         not exists (select 1 from public.shop_subscriptions x
                     where x.shop_id = p_shop and x.kind = 'plan' and x.source in ('stripe', 'pilot')),
         sb.offer_coupon, sb.stripe_customer_id is not null, coalesce(sb.has_payment_method, false),
         c.plans_open or p_shop = any (c.test_shop_ids), not c.livemode,
         e.seats, e.read_seats, e.read_seats_until, e.bases,
         (select count(*)::int from public.shop_members m where m.shop_id = p_shop),
         (select count(*)::int from public.shop_invites i where i.shop_id = p_shop and i.status = 'pending' and i.expires_at > now()),
         (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id,
                                                       'name', coalesce(cu.name, ''),
                                                       'email', coalesce(cu.email, u.email::text, ''))
                                    order by m.created_at), '[]'::jsonb)
          from public.shop_members m
          left join public.customers cu on cu.id = m.user_id
          left join auth.users u on u.id = m.user_id
          where m.shop_id = p_shop and not public.shop_member_seated(p_shop, m.user_id))
  from public.shops s
  cross join public.billing_config c
  cross join public.shop_entitlement(p_shop) e
  cross join (select public.shop_order_block(p_shop) as block) ob
  left join b on true
  left join f on true
  left join public.shop_billing sb on sb.shop_id = p_shop
  where s.id = p_shop and (public.is_shop_member(p_shop) or public.is_staff());
$$;
revoke all on function public.shop_billing_info(uuid) from public, anon, authenticated;
grant execute on function public.shop_billing_info(uuid) to authenticated, service_role;

-- The caller's own listings for manage-listing.html (§9.4 S0): the columns the owner edits, the
-- order email, the effective ordering state and any pending ownership change. Replaces the page's
-- direct select once S1 ships and M3 narrows the column grants.
create function public.my_listings()
returns table (id uuid, name text, status text, phone text, website text, gmaps_url text, licensed_states text,
               coil_desc text, fab_desc text, colors text[], abilities text[], accepts_orders boolean, order_email text,
               takes_orders boolean, order_block text, plan text,
               pending_change_id uuid, pending_change_effective_at timestamptz, pending_change_to_email text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.name, l.status, l.phone, l.website, l.gmaps_url, l.licensed_states, l.coil_desc, l.fab_desc,
         l.colors, l.abilities, l.accepts_orders, l.order_email,
         ob.block is null, ob.block, e.plan,
         pc.id, pc.effective_at, pc.to_email
  from public.directory_listings l
  cross join lateral (select public.shop_order_block(l.id) as block) ob
  cross join lateral public.shop_entitlement(l.id) e
  left join lateral (
    select x.id, x.effective_at, x.to_email
    from public.listing_owner_changes x
    where x.listing_id = l.id and x.status = 'pending'
    order by x.created_at desc
    limit 1) pc on true
  where l.owner_id = auth.uid()
  order by l.name;
$$;
revoke all on function public.my_listings() from public, anon, authenticated;
grant execute on function public.my_listings() to authenticated, service_role;

-- Every listing for directory-admin.html, platform admins only (§9.4 S0): every column named
-- explicitly except the raw featured, which M4 drops, plus the effective ordering state, whether
-- it is featured now, its shop and plan, the founding flag, and its current grants (each with the
-- grant id end_comp takes; never a Stripe id). staff_listing is one row; staff_listings is all of
-- them, featured first.
create function public.staff_listings()
returns table (id uuid, application_id uuid, status text, name text, badges text[], address text, city text,
               area_keywords text, lat double precision, lng double precision, abilities text[], colors text[],
               coil_desc text, fab_desc text, website text, phone text, colorchart_url text,
               created_at timestamptz, updated_at timestamptz, photos text[], logo_url text, licensed_states text,
               logo_bg text, locations jsonb, gmaps_url text, owner_id uuid, accepts_orders boolean, order_email text,
               takes_orders boolean, featured_now boolean, order_block text, has_shop boolean, shop_slug text,
               shop_status text, plan text, plan_source text, plan_status text, plan_until timestamptz,
               offer text, grants jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then raise exception 'platform admins only'; end if;
  return query
    select x.*
    from public.directory_listings l
    cross join lateral public.staff_listing(l.id) x
    order by x.featured_now desc, x.name;
end;
$$;
revoke all on function public.staff_listings() from public, anon, authenticated;
grant execute on function public.staff_listings() to authenticated, service_role;

create function public.staff_listing(p_id uuid)
returns table (id uuid, application_id uuid, status text, name text, badges text[], address text, city text,
               area_keywords text, lat double precision, lng double precision, abilities text[], colors text[],
               coil_desc text, fab_desc text, website text, phone text, colorchart_url text,
               created_at timestamptz, updated_at timestamptz, photos text[], logo_url text, licensed_states text,
               logo_bg text, locations jsonb, gmaps_url text, owner_id uuid, accepts_orders boolean, order_email text,
               takes_orders boolean, featured_now boolean, order_block text, has_shop boolean, shop_slug text,
               shop_status text, plan text, plan_source text, plan_status text, plan_until timestamptz,
               offer text, grants jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then raise exception 'platform admins only'; end if;
  return query
    select l.id, l.application_id, l.status, l.name, l.badges, l.address, l.city, l.area_keywords, l.lat, l.lng,
           l.abilities, l.colors, l.coil_desc, l.fab_desc, l.website, l.phone, l.colorchart_url,
           l.created_at, l.updated_at, l.photos, l.logo_url, l.licensed_states, l.logo_bg, l.locations, l.gmaps_url,
           l.owner_id, l.accepts_orders, l.order_email,
           public.shop_takes_orders(l.id), public.listing_featured(l.id), public.shop_order_block(l.id),
           s.id is not null, s.slug, s.status,
           e.plan, e.source, e.status, e.plan_until,
           sb.offer_coupon,
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', g.id, 'kind', g.kind, 'plan', g.plan, 'source', g.source, 'status', g.status,
                     'livemode', g.livemode, 'trial_end', g.trial_end, 'current_period_end', g.current_period_end,
                     'cancel_at_period_end', g.cancel_at_period_end, 'cancel_at', g.cancel_at, 'ends_at', g.ends_at,
                     'note', g.note,
                     'granted_by_email', (select u.email from auth.users u where u.id = g.created_by),
                     'created_at', g.created_at)
                   order by g.created_at), '[]'::jsonb)
            from public.shop_grants(l.id) g
            where g.current)
    from public.directory_listings l
    left join public.shops s on s.id = l.id
    left join public.shop_billing sb on sb.shop_id = l.id
    cross join lateral public.shop_entitlement(l.id) e
    where l.id = p_id;
end;
$$;
revoke all on function public.staff_listing(uuid) from public, anon, authenticated;
grant execute on function public.staff_listing(uuid) to authenticated, service_role;

-- Nearest shops taking orders to a ZIP (§9.2), computed here so the ZIP never goes to a third
-- party. Only live listings, so a hidden or draft shop is never suggested (its ?shop= link still
-- works). Each shop routes from the first `bases` locations that have coordinates, in stored
-- order, else its pin (the app's shopBases rule). Miles by haversine, R = 3959. Featured and the
-- name play no part, so a paid placement can never become the suggested shop. Limit and radius
-- are clamped so one call can't list every shop. A ZIP that is malformed or not in the Census
-- file gives no rows. The asin argument is clamped at 1 against floating-point overshoot.
create function public.nearest_ordering_shops(p_zip text, p_limit int default 3, p_radius int default 250)
returns table (id uuid, name text, miles numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with z as (
    select c.lat, c.lng
    from public.zip_centroids c
    where btrim(p_zip) ~ '^\d{5}$' and c.zip = btrim(p_zip)
  ), cand as (
    select l.id, l.name, l.lat, l.lng,
           case when jsonb_typeof(l.locations) = 'array' then l.locations else '[]'::jsonb end as locations,
           (select e.bases from public.shop_entitlement(l.id) e) as bases
    from public.directory_listings l
    join public.shops s on s.id = l.id
    where l.status = 'live' and public.shop_takes_orders(l.id)
  ), pts as (
    select k.id, (p.loc->>'lat')::double precision as lat, (p.loc->>'lng')::double precision as lng
    from cand k
    cross join lateral (
      select x.loc, row_number() over (order by x.n) as rn
      from jsonb_array_elements(k.locations) with ordinality as x(loc, n)
      where jsonb_typeof(x.loc->'lat') = 'number' and jsonb_typeof(x.loc->'lng') = 'number') p
    where p.rn <= k.bases
    union all
    select k.id, k.lat, k.lng
    from cand k
    where k.lat is not null and k.lng is not null
      and not exists (select 1 from jsonb_array_elements(k.locations) as x(loc)
                      where jsonb_typeof(x.loc->'lat') = 'number' and jsonb_typeof(x.loc->'lng') = 'number')
  ), dist as (
    select p.id,
           round(min(2 * 3959 * asin(least(1, sqrt(
             power(sin(radians(p.lat - z.lat) / 2), 2)
             + cos(radians(z.lat)) * cos(radians(p.lat)) * power(sin(radians(p.lng - z.lng) / 2), 2)))))::numeric, 1) as miles
    from pts p
    cross join z
    group by p.id
  )
  select d.id, k.name, d.miles
  from dist d
  join cand k on k.id = d.id
  where d.miles <= least(greatest(p_radius, 1), 500)
  order by d.miles, d.id
  limit least(greatest(p_limit, 1), 10);
$$;
revoke all on function public.nearest_ordering_shops(text, int, int) from public, anon, authenticated;
grant execute on function public.nearest_ordering_shops(text, int, int) to anon, authenticated, service_role;

-- Whether a ZIP is one the Census file knows. A ZIP stored at sign-up was never checked against
-- it, and design §9.2 treats an unknown one as no ZIP: this lets the app tell that apart from
-- "no shop near". Signed-in only: signed-out visitors have no ZIP.
create function public.zip_known(p_zip text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select btrim(p_zip) ~ '^\d{5}$' and exists (select 1 from public.zip_centroids z where z.zip = btrim(p_zip));
$$;
revoke all on function public.zip_known(text) from public, anon, authenticated;
grant execute on function public.zip_known(text) to authenticated, service_role;

-- A shop's customer roster as the shop may see it (§9.3), for its people or a platform admin
-- under a support grant; zero rows for anyone else. An account's name and phone show only once
-- it has ordered from the shop, or when it was among the shop's tier rows when this migration
-- ran (shop_customers_before_phase3: the accounts the shop already had); otherwise only its
-- email. Never the ZIP. Emails the shop gave a tier before they had an account follow as
-- pending rows.
create function public.shop_customer_roster(p_shop uuid)
returns table (user_id uuid, email text, name text, phone text, tier text, created_at timestamptz, pending boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select sc.user_id, cu.email,
         case when v.visible then coalesce(cu.name, '') else '' end,
         case when v.visible then cu.phone end,
         sc.tier, sc.created_at, false
  from public.shop_customers sc
  join public.customers cu on cu.id = sc.user_id
  cross join lateral (
    select exists (select 1 from public.orders o where o.user_id = sc.user_id and o.shop_id = p_shop)
           or exists (select 1 from public.shop_customers_before_phase3 b
                      where b.shop_id = sc.shop_id and b.user_id = sc.user_id) as visible) v
  where sc.shop_id = p_shop and public.can_view_shop(p_shop)
  union all
  select null, x.email, '', null, x.tier, x.created_at, true
  from public.shop_customer_offers x
  where x.shop_id = p_shop and public.can_view_shop(p_shop);
$$;
revoke all on function public.shop_customer_roster(uuid) from public, anon, authenticated;
grant execute on function public.shop_customer_roster(uuid) to authenticated, service_role;

/* ---------------------------------------------------------------- writers */
-- The signed-in account's ZIP, from the prompt above the picker (customers.update is staff-only
-- today). A ZIP the Census file lacks is treated as no ZIP (§9.2), so it is not saved either.
-- Returns 'ok' or 'invalid'.
create function public.set_my_zip(p_zip text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zip text := btrim(coalesce(p_zip, ''));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if v_zip !~ '^\d{5}$' or not exists (select 1 from public.zip_centroids z where z.zip = v_zip) then
    return 'invalid';
  end if;
  update public.customers set zip = v_zip where id = auth.uid();
  if not found then raise exception 'no customer row'; end if;
  return 'ok';
end;
$$;
revoke all on function public.set_my_zip(text) from public, anon, authenticated;
grant execute on function public.set_my_zip(text) to authenticated, service_role;

-- A platform admin comps a plan or Featured, or gives a pilot (§6.2). Append-only: a new row
-- beside whatever the listing has; the entitlement picks the best current one. Featuring is
-- either paid or a visible, dated comp (§7, decision 8), so a Featured comp needs an end date;
-- a plan comp may be open-ended. Every row records its admin and a note. Returns the grant id.
create function public.comp_shop(p_listing uuid, p_kind text, p_plan text, p_source text, p_until timestamptz, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := btrim(coalesce(p_note, ''));
  v_id uuid;
begin
  if not public.is_staff() then raise exception 'platform admins only'; end if;
  if not exists (select 1 from public.directory_listings l where l.id = p_listing) then raise exception 'no such listing'; end if;
  if p_kind is null or p_kind not in ('plan', 'featured') then raise exception 'bad kind'; end if;
  if p_kind = 'plan' and (p_plan is null or p_plan not in ('shop', 'pro')) then
    raise exception 'a plan grant needs plan shop or pro';
  end if;
  if p_kind = 'featured' and p_plan is not null then raise exception 'a featured grant has no plan'; end if;
  if p_source is null or p_source not in ('comp', 'pilot') then raise exception 'source must be comp or pilot'; end if;
  if p_kind = 'featured' and p_source = 'pilot' then raise exception 'featured can only be comped'; end if;
  if p_kind = 'featured' and p_until is null then raise exception 'a featured comp needs an end date'; end if;
  if p_until is not null and p_until <= now() then raise exception 'the end date must be in the future'; end if;
  if v_note = '' then raise exception 'a note is required'; end if;
  insert into public.shop_subscriptions (shop_id, kind, plan, source, status, ends_at, note, created_by)
  values (p_listing, p_kind, p_plan, p_source, 'active', p_until, v_note, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.comp_shop(uuid, text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.comp_shop(uuid, text, text, text, timestamptz, text) to authenticated, service_role;

-- A platform admin ends one comp or pilot row now, recording who did it. Stripe rows end in
-- Stripe, never here. Returns 'ended', or 'gone' when the row is missing or already over.
create function public.end_comp(p_grant uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
  v_ends timestamptz;
  v_ended timestamptz;
begin
  if not public.is_staff() then raise exception 'platform admins only'; end if;
  select s.source, s.ends_at, s.ended_at into v_source, v_ends, v_ended
  from public.shop_subscriptions s where s.id = p_grant
  for update;
  if not found then return 'gone'; end if;
  if v_source not in ('comp', 'pilot') then raise exception 'only comp and pilot grants can be ended here'; end if;
  if v_ended is not null or v_ends <= now() then return 'gone'; end if;
  update public.shop_subscriptions
     set ends_at = now(), ended_at = now(), ended_by = auth.uid(), updated_at = now()
   where id = p_grant;
  return 'ended';
end;
$$;
revoke all on function public.end_comp(uuid) from public, anon, authenticated;
grant execute on function public.end_comp(uuid) to authenticated, service_role;

-- A platform admin flags a shop for the founding rate on its next plan Checkout, or clears the
-- flag (null). The cap of five lives here, not in a Stripe redemption limit: a slot is held by a
-- flagged shop or by a current founding subscription in the mode that counts, so a trial that
-- never converts, or a founding shop that lapsed, frees it (§6.2). Flagging locks billing_config's
-- row first, so concurrent calls can't flag a sixth. Returns 'ok', 'full' or 'cleared'.
create function public.set_shop_offer(p_shop uuid, p_offer text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taken int;
begin
  if not public.is_staff() then raise exception 'platform admins only'; end if;
  if p_offer is not null and p_offer <> 'founding' then raise exception 'unknown offer'; end if;
  if not exists (select 1 from public.shops s where s.id = p_shop) then raise exception 'no such shop'; end if;
  if p_offer is null then
    update public.shop_billing set offer_coupon = null, updated_at = now() where shop_id = p_shop;
    return 'cleared';
  end if;
  -- One-row table: founding flags are set one at a time, so two admins can't both take the fifth
  -- slot. The count below takes its snapshot after the lock, so it sees a flag committed meanwhile.
  perform 1 from public.billing_config for update;
  select count(distinct t.shop_id) into v_taken
  from (
    select b.shop_id from public.shop_billing b
    where b.offer_coupon = 'founding' and b.shop_id <> p_shop
    union
    select s.shop_id from public.shop_subscriptions s cross join public.billing_config c
    where s.kind = 'plan' and s.source = 'stripe' and s.coupon = 'founding' and s.livemode = c.livemode
      and s.status in ('trialing', 'active', 'past_due') and s.shop_id <> p_shop
  ) t;
  if v_taken >= 5 then return 'full'; end if;
  insert into public.shop_billing (shop_id, offer_coupon, updated_at) values (p_shop, 'founding', now())
  on conflict (shop_id) do update set offer_coupon = 'founding', updated_at = now();
  return 'ok';
end;
$$;
revoke all on function public.set_shop_offer(uuid, text) from public, anon, authenticated;
grant execute on function public.set_shop_offer(uuid, text) to authenticated, service_role;

-- Service role only: the webhook, billing-session's sync and the admin resync write a Stripe
-- subscription's state through here (§5.3), always state they just fetched from Stripe. Upsert on
-- the subscription id; the later fetch wins, so a slower, older fetch is 'stale'. A mapping that
-- doesn't fit (a null or unknown kind/plan, a listing that doesn't exist, a subscription id
-- already recorded for another shop or kind) is 'unmapped' and writes nothing, rather than
-- failing a check constraint: a 500 would make Stripe retry for 3 days. The checkout slot is not
-- touched here (R-16): the callers that hold the session clear it. Returns 'applied', 'stale',
-- 'unmapped' or 'duplicate_subscription' (a second current Stripe plan; the row stays written).
create function public.billing_apply_subscription(
  p_shop uuid, p_kind text, p_plan text, p_sub_id text, p_status text, p_lookup_key text, p_livemode boolean,
  p_trial_end timestamptz, p_period_end timestamptz, p_cancel_at_period_end boolean, p_cancel_at timestamptz,
  p_past_due_since timestamptz, p_coupon text, p_automatic_tax boolean, p_ended_at timestamptz, p_fetched_at timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not coalesce((p_kind = 'plan' and p_plan in ('shop', 'pro')) or (p_kind = 'featured' and p_plan is null), false)
     or not exists (select 1 from public.directory_listings where id = p_shop) then
    return 'unmapped';
  end if;
  if exists (select 1 from public.shop_subscriptions s
             where s.stripe_subscription_id = p_sub_id and (s.shop_id <> p_shop or s.kind <> p_kind)) then
    return 'unmapped';
  end if;

  -- past_due_since: the oldest open invoice's finalization; if Stripe gave none, the first time
  -- this row was seen past_due, which is kept; cleared on any other status.
  insert into public.shop_subscriptions as s
    (shop_id, kind, plan, source, status, stripe_subscription_id, stripe_price_lookup_key, livemode,
     trial_end, current_period_end, cancel_at_period_end, cancel_at, past_due_since, coupon, automatic_tax,
     ended_at, state_fetched_at, created_by)
  values
    (p_shop, p_kind, p_plan, 'stripe', p_status, p_sub_id, p_lookup_key, p_livemode,
     p_trial_end, p_period_end, coalesce(p_cancel_at_period_end, false), p_cancel_at,
     case when p_status = 'past_due' then coalesce(p_past_due_since, p_fetched_at) end,
     p_coupon, p_automatic_tax, p_ended_at, p_fetched_at, null)
  on conflict (stripe_subscription_id) do update set
    plan                    = excluded.plan,
    status                  = excluded.status,
    stripe_price_lookup_key = excluded.stripe_price_lookup_key,
    livemode                = excluded.livemode,
    trial_end               = excluded.trial_end,
    current_period_end      = excluded.current_period_end,
    cancel_at_period_end    = excluded.cancel_at_period_end,
    cancel_at               = excluded.cancel_at,
    past_due_since          = case when excluded.status = 'past_due'
                                   then coalesce(p_past_due_since, s.past_due_since, p_fetched_at) end,
    coupon                  = excluded.coupon,
    automatic_tax           = excluded.automatic_tax,
    ended_at                = excluded.ended_at,
    state_fetched_at        = excluded.state_fetched_at,
    updated_at              = now()
  where s.state_fetched_at is null or excluded.state_fetched_at > s.state_fetched_at
  returning s.id into v_id;
  if v_id is null then return 'stale'; end if;

  -- the founding flag is spent once its coupon is on a subscription
  if p_coupon is not null then
    update public.shop_billing set offer_coupon = null, updated_at = now()
     where shop_id = p_shop and offer_coupon = p_coupon;
  end if;

  if p_kind = 'plan'
     and exists (select 1 from public.shop_grants(p_shop) g where g.id = v_id and g.current)
     and exists (select 1 from public.shop_grants(p_shop) g
                 where g.kind = 'plan' and g.source = 'stripe' and g.id <> v_id and g.current) then
    return 'duplicate_subscription';
  end if;
  return 'applied';
end;
$$;
revoke all on function public.billing_apply_subscription(uuid, text, text, text, text, text, boolean, timestamptz, timestamptz, boolean, timestamptz, timestamptz, text, boolean, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_apply_subscription(uuid, text, text, text, text, text, boolean, timestamptz, timestamptz, boolean, timestamptz, timestamptz, text, boolean, timestamptz, timestamptz) to service_role;

-- A shop's owner lets platform admins see (not change) the shop for 1 to 168 hours, 24 by
-- default (§9.3). Strict owners only: being a platform admin is not enough. Returns 'granted'.
create function public.grant_support_access(p_shop uuid, p_hours int, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_owner(p_shop) then
    raise exception 'Only the shop''s owners can do this.';
  end if;
  insert into public.support_access (shop_id, granted_by, reason, expires_at)
  values (p_shop, auth.uid(), left(nullif(btrim(p_reason), ''), 500),
          now() + make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 168)));
  return 'granted';
end;
$$;
revoke all on function public.grant_support_access(uuid, int, text) from public, anon, authenticated;
grant execute on function public.grant_support_access(uuid, int, text) to authenticated, service_role;

-- Closes every open support grant of the shop now. Returns 'revoked', or 'none' when none was open.
create function public.revoke_support_access(p_shop uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shop_owner(p_shop) then
    raise exception 'Only the shop''s owners can do this.';
  end if;
  update public.support_access set revoked_at = now(), revoked_by = auth.uid()
   where shop_id = p_shop and revoked_at is null and expires_at > now();
  return case when found then 'revoked' else 'none' end;
end;
$$;
revoke all on function public.revoke_support_access(uuid) from public, anon, authenticated;
grant execute on function public.revoke_support_access(uuid) to authenticated, service_role;

-- A current owner of the listing refuses a pending ownership change (§9.4 S2 item 8); the desk
-- is told (owner_change, event 'refused'). Returns 'refused', or 'gone' when it isn't pending.
create function public.refuse_owner_change(p_change uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change record;
begin
  select x.id, x.listing_id, x.status, x.to_email, x.effective_at into v_change
  from public.listing_owner_changes x where x.id = p_change
  for update;
  if not found then return 'gone'; end if;
  if not (public.is_shop_owner(v_change.listing_id)
          or exists (select 1 from public.directory_listings l where l.id = v_change.listing_id and l.owner_id = auth.uid())) then
    raise exception 'Only the listing''s current owners can refuse this.';
  end if;
  if v_change.status <> 'pending' then return 'gone'; end if;
  update public.listing_owner_changes set status = 'refused', refused_by = auth.uid(), refused_at = now()
   where id = p_change;
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/listing-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', coalesce(public.get_secret('ALERT_SECRET'), '')
      ),
      body := jsonb_build_object(
        'kind', 'owner_change',
        'record', jsonb_build_object(
          'event', 'refused',
          'change_id', v_change.id,
          'listing_id', v_change.listing_id,
          'listing_name', (select l.name from public.directory_listings l where l.id = v_change.listing_id),
          'to_email', v_change.to_email,
          'effective_at', v_change.effective_at,
          'owner_emails', coalesce(
            (select jsonb_agg(u.email order by m.created_at, m.user_id)
             from public.shop_members m join auth.users u on u.id = m.user_id
             where m.shop_id = v_change.listing_id and m.role = 'owner'),
            (select jsonb_build_array(u.email)
             from public.directory_listings l join auth.users u on u.id = l.owner_id
             where l.id = v_change.listing_id),
            '[]'::jsonb),
          'refused_by_email', (select u.email from auth.users u where u.id = auth.uid()))),
      timeout_milliseconds := 5000
    );
  exception when others then
    null; -- never block the refusal because the email call failed
  end;
  return 'refused';
end;
$$;
revoke all on function public.refuse_owner_change(uuid) from public, anon, authenticated;
grant execute on function public.refuse_owner_change(uuid) to authenticated, service_role;

-- A platform admin applies a pending ownership change once its 7 days have passed and nobody
-- refused it. The previous owners and the desk are told (owner_change, event 'applied').
-- Returns 'applied', 'too-early' or 'gone'.
create function public.apply_owner_change(p_change uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change record;
  v_prev text[];
begin
  if not public.is_staff() then raise exception 'platform admins only'; end if;
  select x.id, x.listing_id, x.status, x.to_owner_id, x.to_email, x.effective_at into v_change
  from public.listing_owner_changes x where x.id = p_change
  for update;
  if not found then return 'gone'; end if;
  if v_change.status <> 'pending' then return 'gone'; end if;
  if now() < v_change.effective_at then return 'too-early'; end if;
  -- Who is losing the listing, read first: listing_shop_sync (ensure_shop_for_listing) deletes
  -- the old owner_id's membership inside the update below.
  select coalesce(array_agg(distinct p.email), '{}') into v_prev
  from (
    select u.email::text as email
    from public.shop_members m join auth.users u on u.id = m.user_id
    where m.shop_id = v_change.listing_id and m.role = 'owner'
    union all
    select u.email::text
    from public.directory_listings l join auth.users u on u.id = l.owner_id
    where l.id = v_change.listing_id
  ) p
  where p.email is not null;
  update public.directory_listings set owner_id = v_change.to_owner_id, updated_at = now()
   where id = v_change.listing_id;
  update public.listing_owner_changes set status = 'applied', applied_by = auth.uid(), applied_at = now()
   where id = p_change;
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/listing-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', coalesce(public.get_secret('ALERT_SECRET'), '')
      ),
      body := jsonb_build_object(
        'kind', 'owner_change',
        'record', jsonb_build_object(
          'event', 'applied',
          'change_id', v_change.id,
          'listing_id', v_change.listing_id,
          'listing_name', (select l.name from public.directory_listings l where l.id = v_change.listing_id),
          'to_email', v_change.to_email,
          'effective_at', v_change.effective_at,
          'owner_emails', coalesce(
            (select jsonb_agg(u.email order by m.created_at, m.user_id)
             from public.shop_members m join auth.users u on u.id = m.user_id
             where m.shop_id = v_change.listing_id and m.role = 'owner'),
            (select jsonb_build_array(u.email)
             from public.directory_listings l join auth.users u on u.id = l.owner_id
             where l.id = v_change.listing_id),
            '[]'::jsonb),
          'previous_owner_emails', to_jsonb(v_prev))),
      timeout_milliseconds := 5000
    );
  exception when others then
    null; -- never block the change because the email call failed
  end;
  return 'applied';
end;
$$;
revoke all on function public.apply_owner_change(uuid) from public, anon, authenticated;
grant execute on function public.apply_owner_change(uuid) to authenticated, service_role;

-- The daily job (pg_cron, below): notices for what no row change marks (§6.3, decision 16). A
-- dated pilot or comp plan row ending (30 days, 7 days, the day itself; owners and desk), and
-- day 10 and day 14 of a failed card that Stripe still retries (owners). Only the row that ends
-- the shop's plan cover is reminded: none while another current plan row outlasts it, and one
-- 'ended' per shop (the row that ended last). Day 14 says ordering is paused, so it waits while
-- shop_entitlement still takes orders, like billing_lapsed. Featured rows and pilots with no end
-- date yet are never reminded. billing_notices keeps each (grant, notice) to one send; an end
-- that passed more than 3 days ago is never mailed on a first run. Returns how many notices it
-- posted.
create function public.billing_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_sent int := 0;
begin
  -- A grace notice belongs to one spell of past_due: once the row leaves it, its notices go, so a
  -- failure months later is told again (R-14; the primary key would otherwise stop it).
  delete from public.billing_notices n
  using public.shop_subscriptions s
  where s.id = n.grant_id and n.kind in ('grace_10', 'grace_14') and s.status <> 'past_due';

  for r in
    with g as (
      select x.*
      from (select distinct s.shop_id from public.shop_subscriptions s where s.kind = 'plan') d
      cross join lateral public.shop_grants(d.shop_id) x
      where x.kind = 'plan'
    )
    select g.id, g.shop_id, g.source, g.plan, g.ends_at, g.past_due_since, g.grace_until, n.notice,
           n.notice in ('ends_30', 'ends_7', 'ended') as desk
    from g
    cross join public.billing_config c
    cross join (values ('ends_30'), ('ends_7'), ('ended'), ('grace_10'), ('grace_14')) as n(notice)
    where case n.notice
      when 'ends_30' then g.source in ('comp', 'pilot') and g.ends_at is not null
                          and now() >= g.ends_at - interval '30 days' and now() < g.ends_at - interval '7 days'
                          and not exists (select 1 from g o where o.shop_id = g.shop_id and o.id <> g.id and o.current
                                          and (o.source = 'stripe' or o.ends_at is null or o.ends_at > g.ends_at
                                               or (o.ends_at = g.ends_at and o.id > g.id)))
      when 'ends_7'  then g.source in ('comp', 'pilot') and g.ends_at is not null
                          and now() >= g.ends_at - interval '7 days' and now() < g.ends_at
                          and not exists (select 1 from g o where o.shop_id = g.shop_id and o.id <> g.id and o.current
                                          and (o.source = 'stripe' or o.ends_at is null or o.ends_at > g.ends_at
                                               or (o.ends_at = g.ends_at and o.id > g.id)))
      when 'ended'   then g.source in ('comp', 'pilot') and g.ends_at is not null
                          and now() >= g.ends_at and now() < g.ends_at + interval '3 days'
                          and not exists (select 1 from g o where o.shop_id = g.shop_id and o.current)
                          and not exists (select 1 from g o where o.shop_id = g.shop_id and o.id <> g.id
                                          and o.source in ('comp', 'pilot') and o.ends_at is not null
                                          and (o.ends_at > g.ends_at or (o.ends_at = g.ends_at and o.id > g.id)))
      when 'grace_10' then g.source = 'stripe' and g.status = 'past_due' and g.livemode is not distinct from c.livemode
                           and g.past_due_since is not null
                           and now() >= g.past_due_since + interval '10 days' and now() < g.past_due_since + interval '13 days'
      when 'grace_14' then g.source = 'stripe' and g.status = 'past_due' and g.livemode is not distinct from c.livemode
                           and g.past_due_since is not null
                           and now() >= g.past_due_since + interval '14 days' and now() < g.past_due_since + interval '17 days'
                           and not (select e.takes_orders from public.shop_entitlement(g.shop_id) e)
    end
  loop
    insert into public.billing_notices (grant_id, kind) values (r.id, r.notice) on conflict do nothing;
    continue when not found;   -- already sent
    begin
      perform net.http_post(
        url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/listing-alert',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-alert-secret', coalesce(public.get_secret('ALERT_SECRET'), '')
        ),
        body := jsonb_build_object(
          'kind', 'billing_reminder',
          'record', jsonb_build_object(
            'notice', r.notice,
            'grant_id', r.id,
            'shop_id', r.shop_id,
            'shop_name', (select l.name from public.directory_listings l where l.id = r.shop_id),
            'shop_slug', (select s.slug from public.shops s where s.id = r.shop_id),
            'source', r.source,
            'plan', r.plan,
            'ends_at', r.ends_at,
            'past_due_since', r.past_due_since,
            'grace_until', r.grace_until,
            'offer', (select b.offer_coupon from public.shop_billing b where b.shop_id = r.shop_id),
            'owner_emails', (select coalesce(jsonb_agg(u.email order by m.created_at, m.user_id), '[]'::jsonb)
                             from public.shop_members m join auth.users u on u.id = m.user_id
                             where m.shop_id = r.shop_id and m.role = 'owner'),
            'desk', r.desk)),
        timeout_milliseconds := 5000
      );
    exception when others then
      null; -- never stop the run because one email call failed
    end;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
revoke all on function public.billing_reminders() from public, anon, authenticated;
grant execute on function public.billing_reminders() to service_role;

/* --------------------------------------------------------------- triggers */
-- RoofCoil's event notices for Stripe rows (§6.3), through listing-alert like notify_shop_invite:
-- billing_started (first trialing or active, plan or Featured) to the desk; billing_past_due (a
-- plan moving to past_due) to the owners with the cut-off date; billing_lapsed (a plan moving to
-- an ended status) to the owners and the desk, unless the entitlement still takes orders, for
-- instance through a second plan row. Featured never sends past_due or lapsed: ordering doesn't
-- depend on it.
create function public.notify_billing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if new.status in ('trialing', 'active')
     and (tg_op = 'INSERT' or old.status not in ('trialing', 'active', 'past_due')) then
    v_kind := 'billing_started';
  elsif new.kind = 'plan' and new.status = 'past_due'
     and (tg_op = 'INSERT' or old.status is distinct from 'past_due') then
    v_kind := 'billing_past_due';
  elsif tg_op = 'UPDATE' and new.kind = 'plan'
     and new.status in ('canceled', 'unpaid', 'paused', 'incomplete_expired')
     and old.status not in ('canceled', 'unpaid', 'paused', 'incomplete_expired')
     and not (select e.takes_orders from public.shop_entitlement(new.shop_id) e) then
    v_kind := 'billing_lapsed';
  else
    return new;
  end if;
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/listing-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', coalesce(public.get_secret('ALERT_SECRET'), '')
      ),
      body := jsonb_build_object(
        'kind', v_kind,
        'record', jsonb_build_object(
          'grant_id', new.id,
          'shop_id', new.shop_id,
          'shop_name', (select l.name from public.directory_listings l where l.id = new.shop_id),
          'shop_slug', (select s.slug from public.shops s where s.id = new.shop_id),
          'grant_kind', new.kind,
          'plan', new.plan,
          'status', new.status,
          'livemode', new.livemode,
          'trial_end', new.trial_end,
          'current_period_end', new.current_period_end,
          'cancel_at', new.cancel_at,
          'past_due_since', new.past_due_since,
          'grace_until', new.past_due_since + interval '14 days',
          'coupon', new.coupon,
          'owner_emails', (select coalesce(jsonb_agg(u.email order by m.created_at, m.user_id), '[]'::jsonb)
                           from public.shop_members m join auth.users u on u.id = m.user_id
                           where m.shop_id = new.shop_id and m.role = 'owner'))),
      timeout_milliseconds := 5000
    );
  exception when others then
    null; -- never block a billing write because the email call failed
  end;
  return new;
end;
$$;
revoke all on function public.notify_billing_event() from public, anon, authenticated, service_role;
create trigger shop_subscriptions_alert
  after insert or update of status on public.shop_subscriptions
  for each row when (new.source = 'stripe') execute function public.notify_billing_event();

-- When a shop's owners may have changed (an owner added, removed or demoted, or
-- ensure_shop_for_listing swapping the listing owner), billing-session points the Stripe
-- Customer's email and name at the earliest current owner (§6.2), so Stripe's receipts and
-- failed-payment emails stop reaching a former owner. Only for a shop that has a Customer.
create function public.notify_billing_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid := coalesce(new.shop_id, old.shop_id);
begin
  if not ((tg_op = 'INSERT' and new.role = 'owner')
          or (tg_op = 'DELETE' and old.role = 'owner')
          or (tg_op = 'UPDATE' and 'owner' in (old.role, new.role) and old.role is distinct from new.role)) then
    return coalesce(new, old);
  end if;
  if not exists (select 1 from public.shop_billing b where b.shop_id = v_shop and b.stripe_customer_id is not null) then
    return coalesce(new, old);
  end if;
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/billing-session',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', coalesce(public.get_secret('ALERT_SECRET'), '')
      ),
      body := jsonb_build_object('action', 'billing_contact', 'shopId', v_shop),
      timeout_milliseconds := 5000
    );
  exception when others then
    null; -- never block a membership change because the call failed
  end;
  return coalesce(new, old);
end;
$$;
revoke all on function public.notify_billing_contact() from public, anon, authenticated, service_role;
create trigger shop_members_billing_contact
  after insert or delete or update of role on public.shop_members
  for each row execute function public.notify_billing_contact();

-- Shops that Phase 2's self-serve flow keeps creating between M1 and go-live (a claim approved by
-- domain or by an admin; ensure_shop_for_listing inserts the shop) get the same open-ended pilot
-- as the shops that exist now: what Phase 2 would have given them. A no-op once plans are open,
-- and for the test shops (their ids are in test_shop_ids before they are claimed, §14 Setup).
-- M4 drops it.
create function public.shops_pilot_before_plans_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select c.plans_open from public.billing_config c)
     and not (new.id = any (select unnest(c.test_shop_ids) from public.billing_config c)) then
    insert into public.shop_subscriptions (shop_id, kind, plan, source, status, ends_at, note, created_by)
    values (new.id, 'plan', 'shop', 'pilot', 'active', null, 'Claimed before plans opened; dated at go-live', null);
  end if;
  return new;
end;
$$;
revoke all on function public.shops_pilot_before_plans_open() from public, anon, authenticated, service_role;
create trigger shops_pilot_before_plans_open
  after insert on public.shops
  for each row execute function public.shops_pilot_before_plans_open();

/* ------------------------------------------------------------ grandfather */
-- Comp for the operator's shop, selected by slug (data, not an is_default branch).
insert into public.shop_subscriptions (shop_id, kind, plan, source, status, note, created_by)
select s.id, 'plan', 'pro', 'comp', 'active', 'Operator''s shop, comped on the same path as every shop (rule a)', null
from public.shops s where s.slug = 'fortified-sheet-metal';
-- Pilot for every other shop that exists now (CFR Metals and Adax Metals today), ordering on or off:
-- nobody loses what Phase 2 let them do. Open-ended until go-live, when M5 dates it.
insert into public.shop_subscriptions (shop_id, kind, plan, source, status, ends_at, note, created_by)
select s.id, 'plan', 'shop', 'pilot', 'active', null, 'Shop existed before plans; dated at go-live', null
from public.shops s where s.slug <> 'fortified-sheet-metal';

-- Exactly one comp row (Fortified's) and one pilot row per other shop, or nothing applies.
do $$
declare
  v_comp int;
  v_comp_operator int;
  v_pilot int;
  v_others int;
  v_others_ok int;
begin
  select count(*), count(*) filter (where sh.slug = 'fortified-sheet-metal')
    into v_comp, v_comp_operator
  from public.shop_subscriptions s left join public.shops sh on sh.id = s.shop_id
  where s.kind = 'plan' and s.source = 'comp';
  select count(*) into v_pilot
  from public.shop_subscriptions s
  where s.kind = 'plan' and s.source = 'pilot';
  select count(*),
         count(*) filter (where (select count(*) from public.shop_subscriptions s
                                 where s.shop_id = sh.id and s.kind = 'plan' and s.source = 'pilot') = 1)
    into v_others, v_others_ok
  from public.shops sh
  where sh.slug <> 'fortified-sheet-metal';
  if v_comp <> 1 or v_comp_operator <> 1 or v_pilot <> v_others or v_others_ok <> v_others then
    raise exception 'phase3_billing: grandfather rows wrong: % comp (% for fortified-sheet-metal), % pilot for % other shops (% with exactly one)',
      v_comp, v_comp_operator, v_pilot, v_others, v_others_ok;
  end if;
end $$;

-- The per-grant rule exists twice (shop_entitlement's own CTE, verbatim from the design, and
-- shop_grants for everything else): the two must agree on every shop.
do $$
declare
  r record;
begin
  for r in select s.id from public.shops s loop
    if ((select e.source <> 'none' from public.shop_entitlement(r.id) e)
          is distinct from exists (select 1 from public.shop_grants(r.id) g where g.kind = 'plan' and g.current))
       or ((select e.featured from public.shop_entitlement(r.id) e)
          is distinct from exists (select 1 from public.shop_grants(r.id) g where g.kind = 'featured' and g.current)) then
      raise exception 'phase3_billing: shop_grants disagrees with shop_entitlement for shop %', r.id;
    end if;
  end loop;
end $$;

/* ------------------------------------------------------------------ cron */
-- Daily at 13:00 UTC (about 8 am Central).
select cron.schedule('billing-reminders', '0 13 * * *', $$select public.billing_reminders()$$);
