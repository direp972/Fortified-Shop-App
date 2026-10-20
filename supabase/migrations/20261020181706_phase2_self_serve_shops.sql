-- Phase 2: a shop onboards itself. Design: docs/phase2-self-serve-shop-design.md.
--
-- A claimed listing becomes a shop the moment its owner is linked (ordering off), and the
-- owner switches ordering on themselves once the shop has an order email and a saved price
-- list. Owners invite their people by email (shop_invites), accepted by whichever account
-- proves it owns that email through Supabase's confirmation; the listing owner is the anchor
-- member nobody can remove. ?shop= takes the shop's slug as well as its id. Tier names live
-- per shop under shop_settings key 'tier-labels'. PO numbers come from a counter per shop,
-- assigned by submit-order; Fortified's continues where the global sequence stopped.
--
-- Additive on purpose: next_po_number(), po_number_seq and ordering_shop(uuid) stay so the
-- app build that is live while this applies keeps working. A later cleanup migration drops
-- them once the Phase 2 build is verified.

/* --------------------------------------------------------------- slugs */
-- A URL-safe slug from a listing name, by the same rule the prerender uses for
-- /suppliers/<slug> pages, so a shop's directory page and its ?shop=<slug> link agree:
-- '&' becomes 'and', runs of anything else become '-', cut to 60 characters, then -2, -3…
-- on a collision. Always at least 3 characters so it passes shops_slug_format.
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
  base := lower(coalesce(p_name, ''));
  base := replace(base, '&', ' and ');
  base := trim(both '-' from regexp_replace(base, '[^a-z0-9]+', '-', 'g'));
  base := trim(both '-' from left(base, 60));
  if base = '' then base := 'my-shop'; end if;
  if length(base) < 3 then base := base || '-shop'; end if;
  candidate := base;
  while exists (select 1 from public.shops s where s.slug = candidate) loop
    n := n + 1;
    candidate := left(base, 60 - length('-' || n::text)) || '-' || n::text;
  end loop;
  return candidate;
end;
$$;
revoke all on function public.shop_slug(text) from public, anon, authenticated;

/* --------------------------------------------------------------- shops */
alter table public.shops
  add column if not exists po_prefix text   not null default 'PO-',
  add column if not exists po_next   bigint not null default 1001;
alter table public.shops drop constraint if exists shops_po_prefix_format;
alter table public.shops add constraint shops_po_prefix_format check (po_prefix ~ '^[A-Za-z0-9-]{0,8}$');
alter table public.shops drop constraint if exists shops_po_next_positive;
alter table public.shops add constraint shops_po_next_positive check (po_next >= 1);

-- Fortified's counter continues the global sequence without a gap (1007 at the time of
-- writing); every other shop starts at 1001.
update public.shops
   set po_next = (select case when q.is_called then q.last_value + 1 else q.last_value end from public.po_number_seq q)
 where is_default;

-- Every shop has a slug (both do today; this is for safety), and it is well formed:
-- 3–60 characters of lower-case letters, digits and hyphens, no hyphen at either end.
update public.shops s
   set slug = public.shop_slug((select l.name from public.directory_listings l where l.id = s.id))
 where s.slug is null;
alter table public.shops alter column slug set not null;
alter table public.shops drop constraint if exists shops_slug_format;
alter table public.shops add constraint shops_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$');

/* --------------------------------------------------------- shop_invites */
-- An invitation to run a shop, by email. 'pending' until the email's account appears (or
-- exists already: then the row is written 'accepted' with the membership, so the email trail
-- is the same). Expiry is lazy: a row past expires_at is never accepted and shows as expired.
-- Rows are written only by the functions below; the shop's people and platform staff read.
create table if not exists public.shop_invites (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id) on delete cascade,
  email        text not null,
  role         text not null default 'staff' check (role in ('owner', 'staff')),
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null
);
create unique index if not exists shop_invites_one_pending on public.shop_invites (shop_id, email) where status = 'pending';
create index if not exists shop_invites_email on public.shop_invites (email) where status = 'pending';
alter table public.shop_invites enable row level security;
revoke all on table public.shop_invites from public, anon, authenticated;
grant select on table public.shop_invites to authenticated;
drop policy if exists "members read their shop invites" on public.shop_invites;
create policy "members read their shop invites" on public.shop_invites
  for select to authenticated using (public.can_manage_shop(shop_id));

/* ------------------------------------------------------------ functions */
-- What the Shop Settings screen needs about one shop, in one call, for its people and
-- platform staff: the listing's contact and ordering fields, the shop's slug and PO counter,
-- and the facts the setup checklist is derived from. Nothing for anyone else.
create or replace function public.shop_admin_info(p_shop uuid)
returns table (id uuid, name text, slug text, phone text, order_email text, accepts_orders boolean,
               listing_status text, shop_status text, is_default boolean, po_prefix text, po_next bigint,
               price_list_saved boolean, tier_labels_saved boolean, member_count int, pending_invites int)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, l.name, s.slug, l.phone, l.order_email, l.accepts_orders, l.status, s.status, s.is_default, s.po_prefix, s.po_next,
         exists (select 1 from public.shop_settings x where x.shop_id = s.id and x.key = 'price-list'),
         exists (select 1 from public.shop_settings x where x.shop_id = s.id and x.key = 'tier-labels'),
         (select count(*)::int from public.shop_members m where m.shop_id = s.id),
         (select count(*)::int from public.shop_invites i where i.shop_id = s.id and i.status = 'pending' and i.expires_at > now())
  from public.shops s
  join public.directory_listings l on l.id = s.id
  where s.id = p_shop and public.can_manage_shop(p_shop);
$$;
revoke all on function public.shop_admin_info(uuid) from public, anon;
grant execute on function public.shop_admin_info(uuid) to authenticated;

-- The shop's order email and phone, set by its owners. The order email is where order-alert
-- sends each order; a non-default shop that is taking orders may not clear it.
-- Returns 'ok', 'bad-email' or 'needs-email'.
create or replace function public.set_shop_contact(p_shop uuid, p_order_email text, p_phone text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text := nullif(lower(btrim(coalesce(p_order_email, ''))), '');
  ph text := left(btrim(coalesce(p_phone, '')), 40);
  taking boolean;
  dflt boolean;
begin
  if not (public.is_staff() or public.is_shop_owner(p_shop)) then
    raise exception 'Only the shop''s owners can change this.';
  end if;
  select l.accepts_orders, s.is_default into taking, dflt
  from public.directory_listings l join public.shops s on s.id = l.id where l.id = p_shop;
  if not found then raise exception 'no such shop'; end if;
  if em is not null and (length(em) > 254 or em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    return 'bad-email';
  end if;
  if em is null and taking and not dflt then return 'needs-email'; end if;
  update public.directory_listings set order_email = em, phone = ph, updated_at = now() where id = p_shop;
  return 'ok';
end;
$$;
revoke all on function public.set_shop_contact(uuid, text, text) from public, anon;
grant execute on function public.set_shop_contact(uuid, text, text) to authenticated;

-- Ordering on or off, by the shop's owners. On needs an order email and a saved price list
-- (so no shop goes live sending its orders to the Fortified desk or selling at RoofCoil's
-- seed numbers by accident); the default shop is exempt from both.
-- Returns 'on', 'off', 'needs-email' or 'needs-prices'.
create or replace function public.set_shop_ordering(p_shop uuid, p_on boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text;
  dflt boolean;
begin
  if not (public.is_staff() or public.is_shop_owner(p_shop)) then
    raise exception 'Only the shop''s owners can change this.';
  end if;
  select l.order_email, s.is_default into em, dflt
  from public.directory_listings l join public.shops s on s.id = l.id where l.id = p_shop;
  if not found then raise exception 'no such shop'; end if;
  if p_on and not dflt then
    if em is null or em = '' then return 'needs-email'; end if;
    if not exists (select 1 from public.shop_settings x where x.shop_id = p_shop and x.key = 'price-list') then
      return 'needs-prices';
    end if;
  end if;
  update public.directory_listings set accepts_orders = p_on, updated_at = now() where id = p_shop;
  return case when p_on then 'on' else 'off' end;
end;
$$;
revoke all on function public.set_shop_ordering(uuid, boolean) from public, anon;
grant execute on function public.set_shop_ordering(uuid, boolean) to authenticated;

-- The shop's slug, by its owners while ordering is off (the link has not been handed out
-- yet); once the shop is live only platform staff change it.
-- Returns 'ok', 'invalid', 'reserved', 'taken' or 'live'.
create or replace function public.set_shop_slug(p_shop uuid, p_slug text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := lower(btrim(coalesce(p_slug, '')));
begin
  if not (public.is_staff() or public.is_shop_owner(p_shop)) then
    raise exception 'Only the shop''s owners can change this.';
  end if;
  if s !~ '^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$' then return 'invalid'; end if;
  if s = any (array['app','www','shop','admin','api','static','assets','suppliers','members','login','signin','signup','fortified','roofcoil','test']) then
    return 'reserved';
  end if;
  if exists (select 1 from public.shops x where x.slug = s and x.id <> p_shop) then return 'taken'; end if;
  if (select l.accepts_orders from public.directory_listings l where l.id = p_shop) and not public.is_staff() then
    return 'live';
  end if;
  update public.shops set slug = s where id = p_shop;
  return 'ok';
end;
$$;
revoke all on function public.set_shop_slug(uuid, text) from public, anon;
grant execute on function public.set_shop_slug(uuid, text) to authenticated;

-- Resolves ?shop=<id or slug> for a shop that takes orders, whatever its listing's status
-- (a shop links to the tools from its own site without being in the public directory).
-- Nothing for a suspended shop or one with ordering off. The CASE keeps the uuid cast off
-- a slug. Callable signed out, like ordering_shop(uuid), which stays for the live build.
create or replace function public.ordering_shop_by_ref(p_ref text)
returns table (id uuid, slug text, name text, phone text, city text, lat double precision, lng double precision, locations jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.slug, l.name, l.phone, l.city, l.lat, l.lng, l.locations
  from public.shops s
  join public.directory_listings l on l.id = s.id
  where s.status = 'active' and l.accepts_orders
    and case when btrim(p_ref) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then s.id = btrim(p_ref)::uuid
             else s.slug = lower(btrim(p_ref)) end;
$$;
revoke all on function public.ordering_shop_by_ref(text) from public;
grant execute on function public.ordering_shop_by_ref(text) to anon, authenticated;

-- id → slug for every shop that takes orders, for the prerender's "Order from this shop"
-- link on supplier pages (directory_public is security_invoker and anon cannot read shops).
create or replace function public.shop_slugs()
returns table (id uuid, slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.slug
  from public.shops s
  join public.directory_listings l on l.id = s.id
  where s.status = 'active' and l.accepts_orders;
$$;
revoke all on function public.shop_slugs() from public;
grant execute on function public.shop_slugs() to anon, authenticated;

-- my_shops gains the slug (for the shop's link) and the order email. Same name, more columns;
-- the app reads columns by name. Dropped and recreated because the return type changes.
drop function if exists public.my_shops();
create function public.my_shops()
returns table (id uuid, name text, phone text, city text, lat double precision, lng double precision, locations jsonb,
               accepts_orders boolean, listing_status text, shop_status text, role text, slug text, order_email text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.name, l.phone, l.city, l.lat, l.lng, l.locations, l.accepts_orders, l.status, s.status, m.role, s.slug, l.order_email
  from public.shop_members m
  join public.shops s on s.id = m.shop_id
  join public.directory_listings l on l.id = s.id
  where m.user_id = auth.uid()
  order by l.name;
$$;
revoke all on function public.my_shops() from public, anon;
grant execute on function public.my_shops() to authenticated;

-- The shop's people with their roles, for the People section. Names and emails come from
-- customers (every confirmed account has a row), falling back to the auth email.
create or replace function public.shop_roster(p_shop uuid)
returns table (user_id uuid, role text, name text, email text, joined_at timestamptz, is_listing_owner boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, m.role, coalesce(c.name, ''), coalesce(c.email, u.email::text, ''), m.created_at, (l.owner_id = m.user_id)
  from public.shop_members m
  join public.shops s on s.id = m.shop_id
  join public.directory_listings l on l.id = s.id
  left join public.customers c on c.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.shop_id = p_shop and public.can_manage_shop(p_shop)
  order by (m.role = 'owner') desc, m.created_at;
$$;
revoke all on function public.shop_roster(uuid) from public, anon;
grant execute on function public.shop_roster(uuid) to authenticated;

-- Accepts every pending, unexpired invite addressed to p_email for account p_user: inserts
-- the membership (an invite never demotes an existing owner) and marks the row accepted.
-- Internal: called by the customers trigger and by accept_my_invites(); no API grants.
create or replace function public.accept_shop_invites_for(p_user uuid, p_email text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int := 0;
  r record;
begin
  if p_user is null or p_email is null or btrim(p_email) = '' then return 0; end if;
  for r in
    select i.id, i.shop_id, i.role
    from public.shop_invites i
    where i.email = lower(btrim(p_email)) and i.status = 'pending' and i.expires_at > now()
    for update
  loop
    insert into public.shop_members as m (shop_id, user_id, role) values (r.shop_id, p_user, r.role)
    on conflict (shop_id, user_id) do update set role = case when excluded.role = 'owner' then 'owner' else m.role end;
    update public.shop_invites set status = 'accepted', accepted_at = now(), accepted_by = p_user where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.accept_shop_invites_for(uuid, text) from public, anon, authenticated;

-- The app calls this once after sign-in: any invite addressed to the account's confirmed
-- email becomes a membership. Returns how many were accepted.
create or replace function public.accept_my_invites()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text;
begin
  select lower(u.email) into em from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null and u.deleted_at is null;
  if em is null then return 0; end if;
  return public.accept_shop_invites_for(auth.uid(), em);
end;
$$;
revoke all on function public.accept_my_invites() from public, anon;
grant execute on function public.accept_my_invites() to authenticated;

-- An owner (or platform staff) invites an email to run the shop. A confirmed account with
-- that email is added on the spot ('added', with an 'accepted' invite row for the email
-- trail); otherwise a pending invite waits for the account ('invited'). 'already' when the
-- account is a member with that role or higher; 'pending' when an invite is already out
-- (revoke it to resend); 'too-many' past 20 pending invites; 'bad-email'; 'bad-role'.
create or replace function public.invite_shop_member(p_shop uuid, p_email text, p_role text default 'staff')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text := lower(btrim(coalesce(p_email, '')));
  uid uuid;
  existing text;
begin
  if not (public.is_staff() or public.is_shop_owner(p_shop)) then
    raise exception 'Only the shop''s owners can invite people.';
  end if;
  if p_role is null or p_role not in ('owner', 'staff') then return 'bad-role'; end if;
  if em = '' or length(em) > 254 or em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return 'bad-email'; end if;
  select u.id into uid from auth.users u
  where lower(u.email) = em and u.email_confirmed_at is not null and u.deleted_at is null
  limit 1;
  if uid is not null then
    select m.role into existing from public.shop_members m where m.shop_id = p_shop and m.user_id = uid;
    if existing is not null and (existing = 'owner' or existing = p_role) then return 'already'; end if;
    insert into public.shop_members as m (shop_id, user_id, role) values (p_shop, uid, p_role)
    on conflict (shop_id, user_id) do update set role = case when excluded.role = 'owner' then 'owner' else m.role end;
    insert into public.shop_invites (shop_id, email, role, status, invited_by, accepted_at, accepted_by)
    values (p_shop, em, p_role, 'accepted', auth.uid(), now(), uid);
    return 'added';
  end if;
  if exists (select 1 from public.shop_invites i where i.shop_id = p_shop and i.email = em and i.status = 'pending' and i.expires_at > now()) then
    return 'pending';
  end if;
  -- an expired invite for the same address is superseded by the new one
  update public.shop_invites set status = 'revoked' where shop_id = p_shop and email = em and status = 'pending';
  if (select count(*) from public.shop_invites i where i.shop_id = p_shop and i.status = 'pending' and i.expires_at > now()) >= 20 then
    return 'too-many';
  end if;
  insert into public.shop_invites (shop_id, email, role, invited_by) values (p_shop, em, p_role, auth.uid());
  return 'invited';
end;
$$;
revoke all on function public.invite_shop_member(uuid, text, text) from public, anon;
grant execute on function public.invite_shop_member(uuid, text, text) to authenticated;

-- Returns 'revoked' or 'gone'.
create or replace function public.revoke_shop_invite(p_invite uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  select i.shop_id into sid from public.shop_invites i where i.id = p_invite and i.status = 'pending';
  if sid is null then return 'gone'; end if;
  if not (public.is_staff() or public.is_shop_owner(sid)) then
    raise exception 'Only the shop''s owners can revoke an invite.';
  end if;
  update public.shop_invites set status = 'revoked' where id = p_invite;
  return 'revoked';
end;
$$;
revoke all on function public.revoke_shop_invite(uuid) from public, anon;
grant execute on function public.revoke_shop_invite(uuid) to authenticated;

-- The next PO number of one shop: an atomic row update, so no sequence objects per shop.
-- Service role only — submit-order calls it once per job and stamps every row.
create or replace function public.next_po_number(p_shop uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.shops set po_next = po_next + 1 where id = p_shop
  returning po_prefix || (po_next - 1)::text;
$$;
revoke all on function public.next_po_number(uuid) from public, anon, authenticated;

-- The shop's PO prefix and next number, by its owners. The next number may only move up:
-- numbers are never reused. Returns 'ok', 'invalid' or 'too-low'.
create or replace function public.set_po_sequence(p_shop uuid, p_prefix text, p_next bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  pf text := btrim(coalesce(p_prefix, ''));
  cur bigint;
begin
  if not (public.is_staff() or public.is_shop_owner(p_shop)) then
    raise exception 'Only the shop''s owners can change this.';
  end if;
  if pf !~ '^[A-Za-z0-9-]{0,8}$' or p_next is null or p_next < 1 then return 'invalid'; end if;
  select s.po_next into cur from public.shops s where s.id = p_shop;
  if cur is null then raise exception 'no such shop'; end if;
  if p_next < cur then return 'too-low'; end if;
  update public.shops set po_prefix = pf, po_next = p_next where id = p_shop;
  return 'ok';
end;
$$;
revoke all on function public.set_po_sequence(uuid, text, bigint) from public, anon;
grant execute on function public.set_po_sequence(uuid, text, bigint) to authenticated;

/* ------------------------------------------------------------- triggers */
-- A listing that takes orders is a shop, and so is a listing with an owner: the shop row
-- exists (ordering off) from the moment the claim links the account, so the owner can set
-- prices before going live. The owner-membership part is unchanged from Phase 1.
create or replace function public.ensure_shop_for_listing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.accepts_orders or new.owner_id is not null) and not exists (select 1 from public.shops s where s.id = new.id) then
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
revoke all on function public.ensure_shop_for_listing() from public, anon, authenticated;
-- the trigger listing_shop_sync (after insert or update of accepts_orders, owner_id) is unchanged

-- The listing's owner account always runs the shop: it cannot be removed from shop_members
-- or demoted while it is the listing's owner. Changing the listing owner (set_listing_owner,
-- a claim) moves the membership through listing_shop_sync. Deleting the shop itself still
-- cascades: the guard steps aside once the shops row is gone.
create or replace function public.shop_members_keep_listing_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.shops s where s.id = old.shop_id)
     and old.user_id = (select l.owner_id from public.directory_listings l where l.id = old.shop_id)
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.user_id <> old.user_id or new.shop_id <> old.shop_id) then
    raise exception 'The listing owner always runs this shop. Change the listing owner first.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.shop_members_keep_listing_owner() from public, anon, authenticated;
drop trigger if exists shop_members_keep_owner on public.shop_members;
create trigger shop_members_keep_owner
  before update or delete on public.shop_members
  for each row execute function public.shop_members_keep_listing_owner();

-- A confirmed account's customers row appears once (handle_confirmed_user, or the app's
-- self-heal with a session): the moment to accept any invite addressed to its email.
create or replace function public.shop_invites_on_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.accept_shop_invites_for(new.id, new.email);
  return new;
end;
$$;
revoke all on function public.shop_invites_on_customer() from public, anon, authenticated;
drop trigger if exists customers_shop_invites on public.customers;
create trigger customers_shop_invites
  after insert on public.customers
  for each row execute function public.shop_invites_on_customer();

-- Every invite row emails its address through listing-alert (kind shop_invite): "create an
-- account" for a pending one, "you've been added" for an accepted one.
create or replace function public.notify_shop_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/listing-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', coalesce(public.get_secret('ALERT_SECRET'), '')
      ),
      body := jsonb_build_object(
        'kind', 'shop_invite',
        'record', jsonb_build_object(
          'id', new.id,
          'status', new.status,
          'role', new.role,
          'email', new.email,
          'expires_at', new.expires_at,
          'shop_id', new.shop_id,
          'shop_name', (select l.name from public.directory_listings l where l.id = new.shop_id),
          'shop_slug', (select s.slug from public.shops s where s.id = new.shop_id),
          'invited_by_email', (select u.email from auth.users u where u.id = new.invited_by))),
      timeout_milliseconds := 5000
    );
  exception when others then
    null; -- never block an invite because the email call failed
  end;
  return new;
end;
$$;
revoke all on function public.notify_shop_invite() from public, anon, authenticated;
drop trigger if exists shop_invite_alert on public.shop_invites;
create trigger shop_invite_alert
  after insert on public.shop_invites
  for each row execute function public.notify_shop_invite();

/* ------------------------------------------------------------- policies */
-- Tier names join the two sell-price keys any signed-in account may read: a customer sees
-- the name of their own tier at the shop they order from. Writes stay the shop's people.
drop policy if exists "members read settings, sell prices for all" on public.shop_settings;
create policy "members read settings, sell prices for all" on public.shop_settings
  for select to authenticated
  using (public.can_manage_shop(shop_id) or key in ('coil-width-scale', 'custom-trim-presets', 'tier-labels'));

/* ------------------------------------------------------------- backfill */
-- The rule in ensure_shop_for_listing applied to today's data: a shop (ordering off) for
-- every listing that has an owner and no shop yet, with that owner as its owner member.
insert into public.shops (id, slug)
select l.id, public.shop_slug(l.name)
from public.directory_listings l
where l.owner_id is not null and not exists (select 1 from public.shops s where s.id = l.id);

insert into public.shop_members (shop_id, user_id, role)
select l.id, l.owner_id, 'owner'
from public.directory_listings l
join public.shops s on s.id = l.id
where l.owner_id is not null
on conflict (shop_id, user_id) do nothing;
