-- Phase 1 cleanup: the global pricing keys and the global tier column are retired.
--
-- shops_tenant (20261017213414) copied the six shop-* keys of app_storage into
-- shop_settings and customers.tier into shop_customers, and left the originals so the app
-- build that was live at the time kept working. The Phase 1 build reads only the copies.
-- APPLY THIS ONLY ONCE THAT BUILD IS LIVE ON shop.roofcoil.com: the build before it reads
-- shop-custom-trim-presets and shop-material-status from app_storage, shows the tier from
-- customers.tier, and writes customers.tier from the Customer Pricing Tiers panel.

-- 1. app_storage goes back to what it was built for: shared, non-sensitive app data (today
--    only the idea box) that any signed-in account may read and write. The shop-* rows are
--    gone and so are the key-specific clauses that kept costs staff-only here; costs now
--    live in shop_settings under that table's own policies.
delete from public.app_storage
where key in ('shop-price-list', 'shop-material-costs', 'shop-production-costs',
              'shop-coil-width-scale', 'shop-custom-trim-presets', 'shop-material-status',
              'shop-orders');

drop policy if exists "auth read app_storage" on public.app_storage;
create policy "auth read app_storage" on public.app_storage
  for select using (auth.role() = 'authenticated');
drop policy if exists "auth insert app_storage" on public.app_storage;
create policy "auth insert app_storage" on public.app_storage
  for insert with check (auth.role() = 'authenticated');
drop policy if exists "auth update app_storage" on public.app_storage;
create policy "auth update app_storage" on public.app_storage
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth delete app_storage" on public.app_storage;
create policy "auth delete app_storage" on public.app_storage
  for delete using (auth.role() = 'authenticated');

-- 2. Tiers live in shop_customers, one row per shop per customer. The trigger that gives
--    every new customer a row at the default shop stops copying the column before it goes.
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
    insert into public.shop_customers (shop_id, user_id, tier) values (d, new.id, 'tier2')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

alter table public.customers drop column if exists tier;

-- "Only staff can update tiers" on customers stays as the update policy for the row's
-- other fields (name, phone): platform staff only, as before.
