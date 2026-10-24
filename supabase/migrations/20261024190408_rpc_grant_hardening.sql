-- RPC grant hardening. See docs/rpc-grant-hardening-design.md.
--
-- Four SECURITY DEFINER functions exist only as RLS predicates and compare against
-- auth.uid(), so they can never be true for the anon role. The six policies that use them
-- are narrowed to authenticated (anon then gets no rows without evaluating them, instead of
-- "permission denied for function" once EXECUTE is gone), and anon's EXECUTE is revoked.
-- The three functions the signed-out app and the prerender call on purpose keep their anon
-- grant; recent_public_uploads keeps anon and authenticated (the storage upload-throttle
-- policies run it) but loses the PUBLIC grant it was created with. Four definer functions
-- still on search_path = public move to an empty search_path.

-- 1. Policies that only a signed-in user can satisfy no longer run for anon.
alter policy "shop owner reads routed orders" on public.orders to authenticated;
alter policy "shop owner updates routed orders" on public.orders to authenticated;
alter policy "shop members read their shop customers" on public.customers to authenticated;
alter policy "staff read all staff" on public.staff to authenticated;
alter policy "staff grant admin" on public.staff to authenticated;
alter policy "staff revoke admin" on public.staff to authenticated;

-- 2. The predicates are no longer callable anonymously.
revoke execute on function public.is_staff() from anon;
revoke execute on function public.is_shop_member(uuid) from anon;
revoke execute on function public.is_listing_owner(uuid) from anon;
revoke execute on function public.is_customer_of_my_shop(uuid) from anon;

-- 3. The upload throttle is for the two roles that upload, not every role.
revoke execute on function public.recent_public_uploads() from public;
grant execute on function public.recent_public_uploads() to anon, authenticated;

-- 4. No definer function runs with public on its search_path.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff where id = auth.uid());
$$;
alter function public.set_listing_owner(uuid, text) set search_path = '';
alter function public.staff_listing_owners() set search_path = '';
alter function public.validate_listing_edit() set search_path = '';
