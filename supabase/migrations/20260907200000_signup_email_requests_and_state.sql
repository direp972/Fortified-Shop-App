-- Sign-up requests handled by the signup-email Edge Function: one row per email it sent,
-- used to hold the limits (per address, per connection, overall) across instances and as
-- a trail of who asked to join and when.
create table if not exists public.signup_requests (
  id bigint generated always as identity primary key,
  email text not null,
  ip text,
  kind text not null default 'confirm', -- 'confirm' (link sent), 'existing' (already-registered note), 'resend'
  created_at timestamptz not null default now()
);
create index if not exists signup_requests_created_at_idx on public.signup_requests (created_at);
create index if not exists signup_requests_email_idx on public.signup_requests (email, created_at);
create index if not exists signup_requests_ip_idx on public.signup_requests (ip, created_at);
alter table public.signup_requests enable row level security;
-- No policies on purpose: only the service role, which bypasses RLS, reads or writes it.
revoke all on public.signup_requests from anon, authenticated;

-- Whether an address already has an account and whether it was ever confirmed, so the
-- function can answer every request the same way without guessing from error messages.
-- Service role only: this would otherwise reveal who is registered.
create or replace function public.signup_state(p_email text)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
       'state', case when u.email_confirmed_at is null then 'unconfirmed' else 'confirmed' end,
       'id', u.id)
     from auth.users u
     where lower(u.email) = lower(p_email) and u.deleted_at is null
     order by u.created_at desc
     limit 1),
    jsonb_build_object('state', 'none'));
$$;
revoke all on function public.signup_state(text) from public;
revoke all on function public.signup_state(text) from anon;
revoke all on function public.signup_state(text) from authenticated;
grant execute on function public.signup_state(text) to service_role;
