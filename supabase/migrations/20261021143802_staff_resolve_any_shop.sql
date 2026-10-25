-- Platform staff can open a shop whose ordering is off.
--
-- ordering_shop_by_ref answers only for shops taking orders, and my_shops() only for members,
-- so a staff account helping a shop set up before it goes live had no way to select it
-- (finding 1 of the Phase 2 test plan, docs/phase2-self-serve-shop-design.md §11). For
-- platform staff the resolver now answers for any active shop, ordering on or off; for
-- everyone else nothing changes. is_staff() is executable by anon and answers false when
-- nobody is signed in, so an anonymous ?shop= still resolves only shops taking orders.
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
  where s.status = 'active' and (l.accepts_orders or public.is_staff())
    and case when btrim(p_ref) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then s.id = btrim(p_ref)::uuid
             else s.slug = lower(btrim(p_ref)) end;
$$;
revoke all on function public.ordering_shop_by_ref(text) from public;
grant execute on function public.ordering_shop_by_ref(text) to anon, authenticated;
