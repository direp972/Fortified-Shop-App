-- Anonymous reads of orders and customers answer "no rows" instead of an error.
--
-- The app's demo (signed out) loads orders on mount, and the two routed-order policies on
-- public.orders carried an EXISTS on directory_listings.owner_id — a column the anon role
-- has not been able to read since directory_listings_anon_columns (2026-09-17). Postgres
-- checks table and function privileges for every part of a policy expression when the
-- query is initialised, before any row is looked at, so a CASE guard around the subquery
-- does not help: the whole SELECT failed with "permission denied for table
-- directory_listings" and the app silently showed no orders. The Phase 1 policy that lets
-- a shop's people read their shop's customers had the same shape (an EXISTS on
-- shop_customers, which anon cannot read).
--
-- Fix: the ownership and membership tests move into SECURITY DEFINER helpers that any role
-- may execute. They read the tables as their owner and answer false when nobody is signed
-- in, so an anonymous request gets no rows and no error, and a signed-in request sees
-- exactly the rows it saw before.

create or replace function public.is_listing_owner(p_listing uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.directory_listings dl where dl.id = p_listing and dl.owner_id = auth.uid());
$$;
revoke all on function public.is_listing_owner(uuid) from public;
grant execute on function public.is_listing_owner(uuid) to anon, authenticated;

-- A policy on orders calls it, and anonymous requests reach that policy; it answers false
-- for them.
grant execute on function public.is_shop_member(uuid) to anon;

create or replace function public.is_customer_of_my_shop(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.shop_customers sc where sc.user_id = p_user and public.is_shop_member(sc.shop_id));
$$;
revoke all on function public.is_customer_of_my_shop(uuid) from public;
grant execute on function public.is_customer_of_my_shop(uuid) to anon, authenticated;

drop policy if exists "shop owner reads routed orders" on public.orders;
create policy "shop owner reads routed orders" on public.orders
  for select using (shop_id is not null and (public.is_listing_owner(shop_id) or public.is_shop_member(shop_id)));

drop policy if exists "shop owner updates routed orders" on public.orders;
create policy "shop owner updates routed orders" on public.orders
  for update
  using (shop_id is not null and (public.is_listing_owner(shop_id) or public.is_shop_member(shop_id)))
  with check (shop_id is not null and (public.is_listing_owner(shop_id) or public.is_shop_member(shop_id)));

drop policy if exists "shop members read their shop customers" on public.customers;
create policy "shop members read their shop customers" on public.customers
  for select using (public.is_customer_of_my_shop(id));
