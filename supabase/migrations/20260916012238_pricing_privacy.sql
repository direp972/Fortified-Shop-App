-- Raw costs and the backend price list are staff-only reads. Customers get the price
-- list through customer_price_list(), which strips the cost column; the tier columns stay
-- because the app computes every estimate from them in the browser.
drop policy if exists "auth read app_storage" on public.app_storage;
create policy "auth read app_storage" on public.app_storage
  for select using (
    auth.role() = 'authenticated'
    and (key <> all (array['shop-price-list', 'shop-material-costs', 'shop-production-costs'])
         or exists (select 1 from public.staff where staff.id = auth.uid())));

create or replace function public.customer_price_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (select jsonb_agg(e.elem - 'cost' order by e.ord)
          from public.app_storage s,
               jsonb_array_elements(s.value::jsonb) with ordinality as e(elem, ord)
          where s.key = 'shop-price-list');
$$;
revoke all on function public.customer_price_list() from public, anon;
grant execute on function public.customer_price_list() to authenticated;
