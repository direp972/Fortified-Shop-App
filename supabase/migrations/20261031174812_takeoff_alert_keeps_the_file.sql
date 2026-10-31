-- Takeoff alerts: an alert that carries the file is never held back by an earlier one that didn't.
-- notify_takeoff_flagged sends at most one alert per person per file name per day. When a run's
-- upload couldn't be saved, its alert went out without the file, and the user's retry, the run
-- that did save it, was then suppressed as a repeat, so the desk never got the file. Now an
-- earlier flagged run only counts as the alert already sent when it had the file too (or the new
-- run has none either). Nothing else changes.
create or replace function public.notify_takeoff_flagged()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  reason text := public.takeoff_flag_reason(new);
begin
  if reason is null then return new; end if;
  if exists (select 1 from public.takeoff_runs t
             where t.user_id = new.user_id and t.id <> new.id
               and t.file_name is not distinct from new.file_name
               and t.created_at > now() - interval '24 hours'
               and (t.upload_path is not null or new.upload_path is null)
               and public.takeoff_flag_reason(t) is not null) then
    return new;
  end if;
  if (select count(distinct t.file_name) from public.takeoff_runs t
      where t.user_id = new.user_id and t.id <> new.id
        and t.created_at > now() - interval '24 hours'
        and public.takeoff_flag_reason(t) is not null) >= 10 then
    return new;
  end if;
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/takeoff-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', coalesce(public.get_secret('ALERT_SECRET'), '')
      ),
      body := jsonb_build_object('reason', reason, 'record', jsonb_build_object('id', new.id)),
      timeout_milliseconds := 5000
    );
  exception when others then
    null; -- never block a run being logged because the alert call failed
  end;
  return new;
end;
$$;

revoke execute on function public.notify_takeoff_flagged() from public, anon, authenticated;
