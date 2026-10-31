-- The three rate-limit counts the signup-email function needs, in one call instead of
-- three concurrent requests. Service role only, like the rest of the sign-up plumbing.
create or replace function public.signup_email_counts(p_email text, p_ip text)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'by_email', (select count(*) from public.signup_requests r where r.email = p_email and r.created_at > now() - interval '1 hour'),
    'by_ip',    (select count(*) from public.signup_requests r where r.ip = p_ip and r.created_at > now() - interval '1 hour'),
    'total',    (select count(*) from public.signup_requests r where r.created_at > now() - interval '1 hour'));
$$;
revoke all on function public.signup_email_counts(text, text) from public;
revoke all on function public.signup_email_counts(text, text) from anon;
revoke all on function public.signup_email_counts(text, text) from authenticated;
grant execute on function public.signup_email_counts(text, text) to service_role;
