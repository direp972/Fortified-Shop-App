-- The customer hears when their order moves: a row whose status becomes In Production,
-- Ready for Pickup or Completed calls order-alert with kind "status". The function claims
-- "<jobId>:<status>" in order_alerts so a multi-item job announces each status once.
create or replace function public.notify_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.data->>'status') is not distinct from (old.data->>'status') then return new; end if;
  if (new.data->>'status') not in ('In Production', 'Ready for Pickup', 'Completed') then return new; end if;
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/order-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', coalesce(public.get_secret('ALERT_SECRET'), '')
      ),
      body := jsonb_build_object('kind', 'status', 'old_status', old.data->>'status', 'record', to_jsonb(new)),
      timeout_milliseconds := 5000
    );
  exception when others then
    null; -- never block a status change because the email call failed
  end;
  return new;
end;
$$;
revoke all on function public.notify_order_status() from public, anon, authenticated;
drop trigger if exists orders_status_alert on public.orders;
create trigger orders_status_alert after update of data on public.orders
  for each row execute function public.notify_order_status();
