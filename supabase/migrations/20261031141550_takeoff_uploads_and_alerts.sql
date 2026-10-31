-- Takeoff uploads + flagged-run alerts.
-- Every upload to takeoff.roofcoil.com is saved to the private takeoff-uploads bucket at
-- {user_id}/{run_id}.{ext} and linked from takeoff_runs.upload_path. When a run is flagged
-- (unsupported format, rejected, error, read without a purpose-built reader, or failed
-- checks) the takeoff-alert edge function emails orders@roofcoil.com with the file.

-- 1. Run log: where the file is, what alert went out, and a new 'unsupported' outcome.
alter table public.takeoff_runs add column if not exists upload_path text;
alter table public.takeoff_runs add column if not exists alert jsonb;

alter table public.takeoff_runs drop constraint if exists takeoff_runs_outcome_check;
alter table public.takeoff_runs add constraint takeoff_runs_outcome_check
  check (outcome in ('ok', 'rejected', 'error', 'unsupported'));

alter table public.takeoff_runs drop constraint if exists takeoff_runs_upload_path_check;
alter table public.takeoff_runs add constraint takeoff_runs_upload_path_check
  check (upload_path is null or upload_path like (user_id::text || '/%'));

-- Users may insert their own runs but not the alert record (written by the edge function).
revoke insert on public.takeoff_runs from authenticated;
grant insert (id, created_at, user_id, email, file_name, file_type, parser, outcome, http_status,
  error, address, system, coverage_in, coil_width_in, roof_area_sqft, facets, panel_count,
  panel_lnft, checks_passed, checks_total, ai_model, ai_input_tokens, ai_output_tokens,
  ai_cost_usd, duration_ms, upload_path)
  on public.takeoff_runs to authenticated;

-- 2. Private storage for uploads (50 MB per file).
insert into storage.buckets (id, name, public, file_size_limit)
values ('takeoff-uploads', 'takeoff-uploads', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "takeoff uploads: user writes own folder" on storage.objects;
create policy "takeoff uploads: user writes own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'takeoff-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "takeoff uploads: owner or staff reads" on storage.objects;
create policy "takeoff uploads: owner or staff reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'takeoff-uploads' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.staff s where s.id = auth.uid())));

-- 3. Which runs get flagged.
create or replace function public.takeoff_flag_reason(r public.takeoff_runs)
returns text language sql stable set search_path = '' as $$
  select case
    when r.outcome = 'unsupported' then 'unsupported'
    when r.outcome in ('rejected', 'error') then r.outcome
    when r.parser in ('ai', 'none') then 'no_reader'
    when coalesce(r.checks_total, 0) > 0 and coalesce(r.checks_passed, 0) < r.checks_total then 'checks_failed'
    else null
  end
$$;

-- 4. Email the RoofCoil desk on flagged runs: one alert per person per file per day,
--    at most 10 different files per person per day.
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

drop trigger if exists takeoff_flagged_alert on public.takeoff_runs;
create trigger takeoff_flagged_alert
  after insert on public.takeoff_runs
  for each row execute function public.notify_takeoff_flagged();
