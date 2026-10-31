-- Two emails the directory workflow was missing, both sent by the listing-alert function:
--   * a listing goes live  -> the shop hears it is published (owner account, else the
--                             email on its application)
--   * a proposed edit is applied or dismissed -> the person who proposed it hears back
create or replace function public.notify_listing_live()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'live' or old.status = 'live' then return new; end if;
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/listing-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', coalesce(public.get_secret('ALERT_SECRET'), '')
      ),
      body := jsonb_build_object(
        'kind', 'listing_live',
        'record', jsonb_build_object(
          'id', new.id,
          'name', new.name,
          'accepts_orders', new.accepts_orders,
          'owner_email', (select u.email from auth.users u where u.id = new.owner_id),
          'applicant_email', (select a.email from public.manufacturer_applications a where a.id = new.application_id))),
      timeout_milliseconds := 5000
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke all on function public.notify_listing_live() from public, anon, authenticated;
drop trigger if exists listing_live_alert on public.directory_listings;
create trigger listing_live_alert after update of status on public.directory_listings
  for each row execute function public.notify_listing_live();

create or replace function public.notify_listing_edit_decided()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'pending' or new.status not in ('applied', 'dismissed') then return new; end if;
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/listing-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', coalesce(public.get_secret('ALERT_SECRET'), '')
      ),
      body := jsonb_build_object(
        'kind', 'edit_decided',
        'record', jsonb_build_object(
          'id', new.id,
          'status', new.status,
          'email', new.submitted_email,
          'proposed', new.proposed,
          'note', new.note,
          'listing_name', (select l.name from public.directory_listings l where l.id = new.listing_id))),
      timeout_milliseconds := 5000
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke all on function public.notify_listing_edit_decided() from public, anon, authenticated;
drop trigger if exists listing_edit_decided_alert on public.listing_edits;
create trigger listing_edit_decided_alert after update of status on public.listing_edits
  for each row execute function public.notify_listing_edit_decided();
