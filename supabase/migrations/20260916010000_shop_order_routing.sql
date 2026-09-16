-- Shops that take orders from RoofCoil.com.
--
-- A directory listing can be switched on for ordering (staff do it in the directory admin;
-- a shop can ask for it from /manage-listing.html) and given an order email. Every order
-- records the shop it was sent to, the order-alert function emails that shop, and the
-- listing's owner account gets a Shop Floor showing only its own orders. Orders with no
-- shop keep going to the Fortified Metals desk exactly as before.
alter table public.directory_listings
  add column if not exists accepts_orders boolean not null default false,
  add column if not exists order_email text;

alter table public.orders
  add column if not exists shop_id uuid references public.directory_listings(id) on delete set null;
create index if not exists orders_shop_id_idx on public.orders (shop_id);

drop policy if exists "shop owner reads routed orders" on public.orders;
create policy "shop owner reads routed orders" on public.orders
  for select using (
    shop_id is not null and exists (
      select 1 from public.directory_listings dl
      where dl.id = orders.shop_id and dl.owner_id = auth.uid()));

drop policy if exists "shop owner updates routed orders" on public.orders;
create policy "shop owner updates routed orders" on public.orders
  for update using (
    shop_id is not null and exists (
      select 1 from public.directory_listings dl
      where dl.id = orders.shop_id and dl.owner_id = auth.uid()))
  with check (
    shop_id is not null and exists (
      select 1 from public.directory_listings dl
      where dl.id = orders.shop_id and dl.owner_id = auth.uid()));

-- Note: a column-level anon grant on directory_listings (to hide owner_id, application_id
-- and order_email from anonymous readers) was tried here and reverted in
-- 20260916013500_directory_listings_anon_select_restored.sql: PostgREST answers 401 to a
-- role with no table-level privilege, which broke the public directory and every build's
-- prerender step. Hiding those columns needs a view, not a grant.

-- A shop may propose switching ordering on or off and its order email, like any other field.
create or replace function public.validate_listing_edit()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  allowed text[] := array['name','phone','website','gmaps_url','licensed_states','coil_desc','fab_desc','colors','abilities','accepts_orders','order_email'];
  k text;
  v jsonb;
  el jsonb;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      if not exists (select 1 from public.directory_listings dl
                     where dl.id = new.listing_id and dl.owner_id = auth.uid()) then
        raise exception 'new row violates row-level security policy for table "listing_edits"';
      end if;
      new.submitted_by := auth.uid();
    end if;
    new.status := 'pending';
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.created_at := now();
    new.submitted_email := (select u.email::text from auth.users u where u.id = new.submitted_by);
  end if;
  if jsonb_typeof(new.proposed) is distinct from 'object' then
    raise exception 'proposed must be a JSON object';
  end if;
  if new.proposed = '{}'::jsonb and (new.note is null or btrim(new.note) = '') then
    raise exception 'nothing proposed';
  end if;
  if new.note is not null and length(new.note) > 4000 then
    raise exception 'note too long';
  end if;
  for k, v in select * from jsonb_each(new.proposed) loop
    if k <> all(allowed) then
      raise exception 'field % cannot be proposed', k;
    end if;
    if k = 'accepts_orders' then
      if jsonb_typeof(v) is distinct from 'boolean' then
        raise exception 'field accepts_orders must be true or false';
      end if;
    elsif k = 'order_email' then
      if jsonb_typeof(v) is distinct from 'string' or length(v #>> '{}') > 254
         or ((v #>> '{}') <> '' and (v #>> '{}') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
        raise exception 'field order_email must be an email address';
      end if;
    elsif k in ('colors','abilities') then
      if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) > 100 then
        raise exception 'field % must be an array of at most 100 items', k;
      end if;
      for el in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(el) is distinct from 'string' or length(el #>> '{}') > 120 then
          raise exception 'field % items must be short strings', k;
        end if;
        if position('|' in (el #>> '{}')) > 0 then
          raise exception 'field % items must not contain the | character', k;
        end if;
      end loop;
    else
      if jsonb_typeof(v) is distinct from 'string' or length(v #>> '{}') > 2000 then
        raise exception 'field % must be a string under 2000 chars', k;
      end if;
    end if;
  end loop;
  if tg_op = 'INSERT' and (select count(*) from public.listing_edits e
      where e.listing_id = new.listing_id and e.status = 'pending') >= 10 then
    raise exception 'too many pending edits for this listing';
  end if;
  return new;
end;
$$;
