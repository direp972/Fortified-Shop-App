-- signup_request_reserve also reports the last 24 hours' total, so the function can keep a
-- daily ceiling under the Resend quota that order alerts share.
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
    'by_email', count(*) filter (where r.email = p_email and r.created_at > now() - interval '1 hour'),
    'by_ip',    count(*) filter (where r.ip = p_ip and r.created_at > now() - interval '1 hour'),
    'total',    count(*) filter (where r.created_at > now() - interval '1 hour'),
    'day',      count(*))
  into v
  from public.signup_requests r
  where r.created_at > now() - interval '24 hours';
  return v;
end;
$$;
