-- Every confirmed account gets its customers row the moment it is confirmed, whichever
-- form created it (site modal, Panel & Trim app, Google). Until now the row was only
-- created when the person opened the app, so members who signed in on the marketing
-- site never appeared in the Customer Pricing Tiers panel.
create or replace function public.handle_confirmed_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is null then return new; end if;
  insert into public.customers (id, email, name, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_confirmed_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.handle_confirmed_user();

-- Backfill the confirmed accounts that never opened the app.
insert into public.customers (id, email, name, phone)
select u.id, coalesce(u.email, ''),
       coalesce(u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', ''),
       u.raw_user_meta_data->>'phone'
from auth.users u
where u.email_confirmed_at is not null and u.deleted_at is null
  and not exists (select 1 from public.customers c where c.id = u.id);
