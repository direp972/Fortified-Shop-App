-- Supabase security advisor clean-up.
--
-- * Privileged (security definer) functions that are only called by triggers, by
--   policies, or by signed-in users lose their anonymous execute grant.
-- * The two pg_net trigger functions read the alert secret from Vault instead of
--   carrying it in their bodies, and pin search_path.
-- is_staff() keeps its anon grant on purpose: the RLS policies on public.staff call it, and
-- the public directory read consults staff in a subquery, so anonymous directory requests
-- evaluate it. It only ever returns false for anon.
revoke execute on function public.next_po_number() from anon;
revoke all on function public.set_listing_owner(uuid, text) from anon;
revoke all on function public.staff_listing_owners() from anon;
revoke all on function public.validate_listing_edit() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public.notify_order_insert() from public, anon, authenticated;
revoke all on function public.notify_application_insert() from public, anon, authenticated;

create or replace function public.notify_order_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/order-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', coalesce(public.get_secret('ALERT_SECRET'), '')
      ),
      body := jsonb_build_object('record', to_jsonb(new)),
      timeout_milliseconds := 5000
    );
  exception when others then
    null; -- never block an order insert because the alert call failed
  end;
  return new;
end;
$$;

create or replace function public.notify_application_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/listing-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', coalesce(public.get_secret('ALERT_SECRET'), '')
      ),
      body := jsonb_build_object('kind', 'application', 'record', to_jsonb(new)),
      timeout_milliseconds := 5000
    );
  exception when others then
    null; -- never block an application because the alert call failed
  end;
  return new;
end;
$$;
