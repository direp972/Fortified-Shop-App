-- Takeoff alerts, hardened.
-- 1. Users can no longer set created_at on their runs. The alert dedup and the daily cap
--    count runs from the last 24 hours, so a backdated row slipped past both and every
--    insert could email the desk. The column default (now()) always applies now; the app
--    never sends it.
revoke insert (created_at) on public.takeoff_runs from authenticated;

-- 2. notify_takeoff_flagged:
--    - one alert per person per file per day PER REASON: a run flagged as an error or
--      refused (a file that couldn't be read back, one over the size limit) no longer uses
--      up the alert for a later run of the same file that is unsupported or fails its checks;
--    - the 10-files-a-day cap counts the person's OTHER files, so a follow-up alert for a
--      file already alerted today (the one that carries it, say) isn't held back by it.
--    An alert that carries the file is still never held back by one that didn't.
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
               and public.takeoff_flag_reason(t) = reason) then
    return new;
  end if;
  if (select count(distinct t.file_name) from public.takeoff_runs t
      where t.user_id = new.user_id and t.id <> new.id
        and t.file_name is distinct from new.file_name
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
