-- The applied version of this migration had the alert shared secret written
-- into the SQL. It is redacted here so the secret never enters git; the version
-- number (all `supabase db push` compares) is the applied one.
-- Get Listed applications ping the listing-alert edge function on insert.
create or replace function public.notify_application_insert()
returns trigger
language plpgsql
security definer
as $$
begin
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/listing-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', '<redacted: the live ALERT_SECRET, read from Vault since 20260916012330>'
      ),
      body := jsonb_build_object('record', to_jsonb(new)),
      timeout_milliseconds := 5000
    );
  exception when others then
    null; -- never block an application because the alert call failed
  end;
  return new;
end;
$$;

drop trigger if exists applications_alert_on_insert on public.manufacturer_applications;
create trigger applications_alert_on_insert
after insert on public.manufacturer_applications
for each row execute function public.notify_application_insert();
