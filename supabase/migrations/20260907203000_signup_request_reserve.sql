-- Every sign-up request takes a slot here before anything else happens, inside one locked
-- statement, so concurrent requests cannot all slip under the limits and a caller that keeps
-- asking locks itself out for the hour. Returns the new row's id and the last hour's counts
-- including it; the function compares them with its limits. Service role only.
create or replace function public.signup_request_reserve(p_email text, p_ip text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('public.signup_requests'));
  insert into public.signup_requests (email, ip, kind) values (p_email, p_ip, 'pending') returning id into v_id;
  select jsonb_build_object(
    'id', v_id,
    'by_email', count(*) filter (where r.email = p_email),
    'by_ip', count(*) filter (where r.ip = p_ip),
    'total', count(*))
  into v
  from public.signup_requests r
  where r.created_at > now() - interval '1 hour';
  return v;
end;
$$;
revoke all on function public.signup_request_reserve(text, text) from public;
revoke all on function public.signup_request_reserve(text, text) from anon;
revoke all on function public.signup_request_reserve(text, text) from authenticated;
grant execute on function public.signup_request_reserve(text, text) to service_role;

-- Superseded by signup_request_reserve.
drop function if exists public.signup_email_counts(text, text);
