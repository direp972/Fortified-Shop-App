-- is_staff() must stay executable by anon: the RLS policies on public.staff call it, and
-- the public directory read ("public reads live listings") consults staff in a subquery,
-- so an anonymous directory request evaluates is_staff() and fails without the grant.
-- It only ever returns false for anon.
grant execute on function public.is_staff() to anon;
