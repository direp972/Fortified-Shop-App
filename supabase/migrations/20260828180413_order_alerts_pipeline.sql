-- The applied version of this migration had the alert shared secret written
-- into the SQL. It is redacted here so the secret never enters git; the version
-- number (all `supabase db push` compares) is the applied one.
-- Alert pipeline: new order rows ping the order-alert edge function via pg_net.
create extension if not exists pg_net;

-- One row per job: the edge function claims the job here so a multi-item
-- order produces exactly one alert. Service-role only (RLS on, no policies).
create table if not exists public.order_alerts (
  job_id text primary key,
  claimed_at timestamptz not null default now(),
  status jsonb
);
alter table public.order_alerts enable row level security;

create or replace function public.notify_order_insert()
returns trigger
language plpgsql
security definer
as $$
begin
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/order-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', '<redacted: the live ALERT_SECRET, read from Vault since 20260916012330>'
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

drop trigger if exists orders_alert_on_insert on public.orders;
create trigger orders_alert_on_insert
after insert on public.orders
for each row execute function public.notify_order_insert();
