-- Security-definer check avoids recursive RLS when staff policies ask "am I staff".
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from staff where id = auth.uid()) $$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- Staff can see the whole admin list (everyone can still see their own row).
create policy "staff read all staff" on public.staff for select
  using (public.is_staff());
-- Staff can grant admin...
create policy "staff grant admin" on public.staff for insert
  with check (public.is_staff());
-- ...and revoke it, but never from themselves (no locking yourself out mid-click).
create policy "staff revoke admin" on public.staff for delete
  using (public.is_staff() and id <> auth.uid());
