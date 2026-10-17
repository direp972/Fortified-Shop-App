-- Phase 1: "shop" becomes a real tenant. Design: docs/phase1-tenant-design.md.
--
-- A shop is a directory listing that takes orders, and its id IS the listing's id, so
-- orders.shop_id, ?shop=, submit-order and order-alert keep their meaning untouched.
-- shop_members gives a shop's people that shop's Price List backend, costs, coil scale,
-- presets, materials board, customer tiers and Shop Floor; platform staff (public.staff)
-- keep every power they have today across every shop. shop_settings rows replace the six
-- global app_storage keys, shop_customers replaces the global customers.tier, and
-- customer_price_list takes the shop as a parameter.
--
-- Additive on purpose: app_storage rows and customers.tier are copied, not moved, so the
-- app build and the submit-order version that are live while this applies keep working.
-- A later cleanup migration removes them once the new build is verified.

/* ------------------------------------------------------------------ tables */
create table if not exists public.shops (
  id          uuid primary key references public.directory_listings(id) on delete restrict,
  slug        text unique,
  status      text not null default 'active' check (status in ('active', 'suspended')),
  is_default  boolean not null default false,   -- the platform's house shop: orders with no shop go here
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);
create unique index if not exists shops_one_default on public.shops (is_default) where is_default;
alter table public.shops enable row level security;

create table if not exists public.shop_members (
  shop_id     uuid not null references public.shops(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'staff' check (role in ('owner', 'staff')),
  created_at  timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create index if not exists shop_members_user_idx on public.shop_members (user_id);
alter table public.shop_members enable row level security;

-- One row per shop per key. Keys are the app_storage keys without their "shop-" prefix:
-- price-list, material-costs, production-costs, coil-width-scale, custom-trim-presets,
-- material-status. The value is the JSON the app stored as text before.
create table if not exists public.shop_settings (
  shop_id     uuid not null references public.shops(id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  primary key (shop_id, key)
);
alter table public.shop_settings enable row level security;

-- A customer's tier at one shop. No row means tier2 (retail), the default every sign-up
-- has today. Rows come from this migration (Fortified), from the first order a customer
-- sends a shop (submit-order), from add_shop_customer(), and for the default shop from
-- every new customers row (so Fortified's tier panel keeps showing new sign-ups).
create table if not exists public.shop_customers (
  shop_id     uuid not null references public.shops(id) on delete cascade,
  user_id     uuid not null references public.customers(id) on delete cascade,
  tier        text not null default 'tier2' check (tier in ('tier1', 'greenleaf', 'tier2')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create index if not exists shop_customers_user_idx on public.shop_customers (user_id);
alter table public.shop_customers enable row level security;

-- Anonymous visitors never touch tenant tables; the policies below are for signed-in roles.
revoke all on table public.shops, public.shop_members, public.shop_settings, public.shop_customers from anon;

/* ---------------------------------------------------------------- helpers */
-- Membership checks are SECURITY DEFINER so a policy on shop_members can use them without
-- recursing into shop_members' own policy. They answer false when nobody is signed in.
create or replace function public.is_shop_member(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.shop_members m where m.shop_id = p_shop and m.user_id = auth.uid());
$$;

create or replace function public.is_shop_owner(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.shop_members m where m.shop_id = p_shop and m.user_id = auth.uid() and m.role = 'owner');
$$;

-- Platform staff can manage every shop; a member can manage theirs.
create or replace function public.can_manage_shop(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_staff() or public.is_shop_member(p_shop);
$$;

revoke all on function public.is_shop_member(uuid), public.is_shop_owner(uuid), public.can_manage_shop(uuid) from public, anon;
grant execute on function public.is_shop_member(uuid), public.is_shop_owner(uuid), public.can_manage_shop(uuid) to authenticated;

-- The house shop. Callable signed out: the app preselects it in demo mode too.
create or replace function public.default_shop_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.shops s where s.is_default limit 1;
$$;
revoke all on function public.default_shop_id() from public;
grant execute on function public.default_shop_id() to anon, authenticated;

-- The shops the caller is a member of, with their listing's public fields whatever the
-- listing's status, so a hidden shop still shows up for its own people.
create or replace function public.my_shops()
returns table (id uuid, name text, phone text, city text, lat double precision, lng double precision, locations jsonb,
               accepts_orders boolean, listing_status text, shop_status text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.name, l.phone, l.city, l.lat, l.lng, l.locations, l.accepts_orders, l.status, s.status, m.role
  from public.shop_members m
  join public.shops s on s.id = m.shop_id
  join public.directory_listings l on l.id = s.id
  where m.user_id = auth.uid()
  order by l.name;
$$;
revoke all on function public.my_shops() from public, anon;
grant execute on function public.my_shops() to authenticated;

-- Resolves ?shop=<id> for a shop that takes orders even when its listing is not live, so a
-- shop can link to the tools from its own site without being in the public directory.
-- Nothing for a suspended shop or one with ordering switched off.
create or replace function public.ordering_shop(p_id uuid)
returns table (id uuid, name text, phone text, city text, lat double precision, lng double precision, locations jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.name, l.phone, l.city, l.lat, l.lng, l.locations
  from public.shops s
  join public.directory_listings l on l.id = s.id
  where s.id = p_id and s.status = 'active' and l.accepts_orders;
$$;
revoke all on function public.ordering_shop(uuid) from public;
grant execute on function public.ordering_shop(uuid) to anon, authenticated;

-- The shop's Price List without the cost column. Null shop means the default shop, which
-- is what the no-argument call the current build makes resolves to. Null result when the
-- shop has saved no list: the app and submit-order then use the code defaults, as today.
drop function if exists public.customer_price_list();
create or replace function public.customer_price_list(p_shop uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (select jsonb_agg(e.elem - 'cost' order by e.ord)
          from public.shop_settings s,
               jsonb_array_elements(s.value) with ordinality as e(elem, ord)
          where s.shop_id = coalesce(p_shop, public.default_shop_id())
            and s.key = 'price-list'
            and jsonb_typeof(s.value) = 'array');
$$;
revoke all on function public.customer_price_list(uuid) from public, anon;
grant execute on function public.customer_price_list(uuid) to authenticated;

-- A member adds an account to their shop's tier panel before its first order, by email.
-- Returns 'added', 'already' or 'no-account' (no confirmed account with that email).
create or replace function public.add_shop_customer(p_shop uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  if not public.can_manage_shop(p_shop) then
    raise exception 'not a member of this shop';
  end if;
  select c.id into uid from public.customers c where lower(c.email) = lower(btrim(p_email)) limit 1;
  if uid is null then
    select u.id into uid from auth.users u
    where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null and u.deleted_at is null
    limit 1;
    if uid is null then return 'no-account'; end if;
    insert into public.customers (id, email, name, phone)
    select u.id, coalesce(u.email, ''), coalesce(u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', ''), u.raw_user_meta_data->>'phone'
    from auth.users u where u.id = uid
    on conflict (id) do nothing;
  end if;
  insert into public.shop_customers (shop_id, user_id) values (p_shop, uid) on conflict do nothing;
  return case when found then 'added' else 'already' end;
end;
$$;
revoke all on function public.add_shop_customer(uuid, text) from public, anon;
grant execute on function public.add_shop_customer(uuid, text) to authenticated;

-- A unique URL-safe slug from a listing name, for ?shop=<slug> later.
create or replace function public.shop_slug(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  n int := 1;
begin
  base := trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'));
  if base = '' then base := 'shop'; end if;
  candidate := base;
  while exists (select 1 from public.shops s where s.slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end;
$$;
revoke all on function public.shop_slug(text) from public, anon, authenticated;

/* --------------------------------------------------------------- triggers */
-- A listing that takes orders is a shop, and its owner account runs it. This keeps every
-- existing flow (the directory admin's "Takes orders" switch, an owner proposing it from
-- manage-listing.html, claims, set_listing_owner) creating tenants and memberships with
-- no page changes. Switching ordering off keeps the shop and its data; shops.status is the
-- kill switch. When the owner link moves to another account the previous owner's
-- membership goes with it, so a cleared or replaced owner keeps no access.
create or replace function public.ensure_shop_for_listing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.accepts_orders and not exists (select 1 from public.shops s where s.id = new.id) then
    insert into public.shops (id, slug, created_by) values (new.id, public.shop_slug(new.name), auth.uid());
  end if;
  if tg_op = 'UPDATE' and old.owner_id is not null and old.owner_id is distinct from new.owner_id then
    delete from public.shop_members m where m.shop_id = new.id and m.user_id = old.owner_id;
  end if;
  if new.owner_id is not null and exists (select 1 from public.shops s where s.id = new.id) then
    insert into public.shop_members (shop_id, user_id, role) values (new.id, new.owner_id, 'owner')
    on conflict (shop_id, user_id) do update set role = 'owner';
  end if;
  return new;
end;
$$;
drop trigger if exists listing_shop_sync on public.directory_listings;
create trigger listing_shop_sync
  after insert or update of accepts_orders, owner_id on public.directory_listings
  for each row execute function public.ensure_shop_for_listing();

-- Every new customer gets a tier row at the default shop, so Fortified's Customer Pricing
-- Tiers panel keeps showing each new sign-up the moment it registers, as it does today.
create or replace function public.shop_customer_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d uuid := public.default_shop_id();
begin
  if d is not null then
    insert into public.shop_customers (shop_id, user_id, tier) values (d, new.id, coalesce(new.tier, 'tier2'))
    on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists customers_default_shop on public.customers;
create trigger customers_default_shop
  after insert on public.customers
  for each row execute function public.shop_customer_on_signup();

/* --------------------------------------------------------------- policies */
-- shops: members and platform staff read; only platform staff write by hand (the trigger
-- above creates rows as the function owner).
drop policy if exists "members and staff read shops" on public.shops;
create policy "members and staff read shops" on public.shops
  for select to authenticated using (public.is_staff() or public.is_shop_member(id));
drop policy if exists "staff insert shops" on public.shops;
create policy "staff insert shops" on public.shops
  for insert to authenticated with check (public.is_staff());
drop policy if exists "staff update shops" on public.shops;
create policy "staff update shops" on public.shops
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff delete shops" on public.shops;
create policy "staff delete shops" on public.shops
  for delete to authenticated using (public.is_staff());

-- shop_members: a shop's people see their roster; owners and platform staff change it;
-- nobody removes their own row.
drop policy if exists "members and staff read members" on public.shop_members;
create policy "members and staff read members" on public.shop_members
  for select to authenticated using (public.is_staff() or public.is_shop_member(shop_id));
drop policy if exists "owners and staff add members" on public.shop_members;
create policy "owners and staff add members" on public.shop_members
  for insert to authenticated with check (public.is_staff() or public.is_shop_owner(shop_id));
drop policy if exists "owners and staff change roles" on public.shop_members;
create policy "owners and staff change roles" on public.shop_members
  for update to authenticated
  using (public.is_staff() or public.is_shop_owner(shop_id))
  with check (public.is_staff() or public.is_shop_owner(shop_id));
drop policy if exists "owners and staff remove members" on public.shop_members;
create policy "owners and staff remove members" on public.shop_members
  for delete to authenticated using ((public.is_staff() or public.is_shop_owner(shop_id)) and user_id <> auth.uid());

-- shop_settings: the two sell-price keys every signed-in account needs for an estimate
-- (coil width scale, trim presets) are readable by anyone signed in, like today; the price
-- list with its costs, the cost sheets and the materials board are the shop's own.
drop policy if exists "members read settings, sell prices for all" on public.shop_settings;
create policy "members read settings, sell prices for all" on public.shop_settings
  for select to authenticated
  using (public.can_manage_shop(shop_id) or key in ('coil-width-scale', 'custom-trim-presets'));
drop policy if exists "members insert settings" on public.shop_settings;
create policy "members insert settings" on public.shop_settings
  for insert to authenticated with check (public.can_manage_shop(shop_id));
drop policy if exists "members update settings" on public.shop_settings;
create policy "members update settings" on public.shop_settings
  for update to authenticated using (public.can_manage_shop(shop_id)) with check (public.can_manage_shop(shop_id));
drop policy if exists "members delete settings" on public.shop_settings;
create policy "members delete settings" on public.shop_settings
  for delete to authenticated using (public.can_manage_shop(shop_id));

-- shop_customers: a customer reads their own tiers; a shop's people read and set theirs.
drop policy if exists "own tier or managed shop" on public.shop_customers;
create policy "own tier or managed shop" on public.shop_customers
  for select to authenticated using (user_id = auth.uid() or public.can_manage_shop(shop_id));
drop policy if exists "members insert tiers" on public.shop_customers;
create policy "members insert tiers" on public.shop_customers
  for insert to authenticated with check (public.can_manage_shop(shop_id));
drop policy if exists "members update tiers" on public.shop_customers;
create policy "members update tiers" on public.shop_customers
  for update to authenticated using (public.can_manage_shop(shop_id)) with check (public.can_manage_shop(shop_id));
drop policy if exists "members delete tiers" on public.shop_customers;
create policy "members delete tiers" on public.shop_customers
  for delete to authenticated using (public.can_manage_shop(shop_id));

-- customers: a shop's people may read the name, email and phone of the accounts in their
-- shop's tier panel. Own-row, platform-staff and update policies are unchanged. The CASE
-- keeps the membership function out of an anonymous request's policy evaluation.
drop policy if exists "shop members read their shop customers" on public.customers;
create policy "shop members read their shop customers" on public.customers
  for select using (
    case when auth.uid() is null then false
         else exists (select 1 from public.shop_customers sc
                      where sc.user_id = customers.id and public.is_shop_member(sc.shop_id))
    end);

-- orders: the two routed-order policies gain the shop's members next to the listing owner.
drop policy if exists "shop owner reads routed orders" on public.orders;
create policy "shop owner reads routed orders" on public.orders
  for select using (
    shop_id is not null and (
      exists (select 1 from public.directory_listings dl where dl.id = orders.shop_id and dl.owner_id = auth.uid())
      or case when auth.uid() is null then false else public.is_shop_member(shop_id) end));
drop policy if exists "shop owner updates routed orders" on public.orders;
create policy "shop owner updates routed orders" on public.orders
  for update using (
    shop_id is not null and (
      exists (select 1 from public.directory_listings dl where dl.id = orders.shop_id and dl.owner_id = auth.uid())
      or case when auth.uid() is null then false else public.is_shop_member(shop_id) end))
  with check (
    shop_id is not null and (
      exists (select 1 from public.directory_listings dl where dl.id = orders.shop_id and dl.owner_id = auth.uid())
      or case when auth.uid() is null then false else public.is_shop_member(shop_id) end));

/* ------------------------------------------------------------------- seed */
-- Fortified Sheet Metal is shop #1 and the default shop. Found by name, never by id.
do $$
declare
  f uuid;
  n int;
begin
  select count(*) into n from public.directory_listings
  where status = 'live' and accepts_orders and lower(name) like 'fortified%';
  if n <> 1 then
    raise exception 'expected exactly one live Fortified listing that takes orders, found %', n;
  end if;
  select id into f from public.directory_listings
  where status = 'live' and accepts_orders and lower(name) like 'fortified%';

  insert into public.shops (id, slug, is_default) values (f, 'fortified-sheet-metal', true)
  on conflict (id) do update set is_default = true;

  -- today's platform staff run Fortified
  insert into public.shop_members (shop_id, user_id, role)
  select f, s.id, 'owner' from public.staff s
  on conflict (shop_id, user_id) do update set role = 'owner';

  -- the six global keys, copied under Fortified (only the ones that exist)
  insert into public.shop_settings (shop_id, key, value, updated_at)
  select f, substr(a.key, 6), a.value::jsonb, a.updated_at
  from public.app_storage a
  where a.key in ('shop-price-list', 'shop-material-costs', 'shop-production-costs',
                  'shop-coil-width-scale', 'shop-custom-trim-presets', 'shop-material-status')
  on conflict (shop_id, key) do nothing;

  -- every customer's tier, as assigned today
  insert into public.shop_customers (shop_id, user_id, tier)
  select f, c.id, c.tier from public.customers c
  on conflict do nothing;

  -- the orders from before shops existed were Fortified's
  update public.orders set shop_id = f where shop_id is null;

  -- every other listing that already takes orders is a shop too, run by its owner
  insert into public.shops (id, slug)
  select l.id, public.shop_slug(l.name)
  from public.directory_listings l
  where l.accepts_orders and not exists (select 1 from public.shops s where s.id = l.id);

  insert into public.shop_members (shop_id, user_id, role)
  select l.id, l.owner_id, 'owner'
  from public.directory_listings l
  join public.shops s on s.id = l.id
  where l.owner_id is not null
  on conflict (shop_id, user_id) do nothing;
end;
$$;
