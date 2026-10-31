-- Saved takeoffs — the "Report history" on takeoff.roofcoil.com. One row per
-- takeoff report the API produced (a run comparing several panel options
-- saves one per option), written by the API as the signed-in user. The report
-- PDF, the on-screen result and the uploaded measurement file sit in the
-- private `takeoff-reports` bucket under the owner's own user-id folder, so a
-- report can be opened again later or its measurement run again with other
-- options. Users see their own; staff see everyone's.
create table if not exists public.takeoff_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- the takeoff_runs row of the same request; no foreign key, the run is
  -- logged after its reports are saved
  run_id uuid,
  option_index int not null default 0,
  option_count int not null default 1,
  address text,
  job_name text,
  job_number text,
  customer text,
  file_name text,
  file_type text,
  system text,
  system_id text,
  coverage_in numeric,
  coil_width_in numeric,
  roof_area_sqft numeric,
  facets int,
  panel_count int,
  panel_lnft numeric,
  verified boolean not null default true,
  pdf_path text not null,
  result_path text not null,
  source_path text
);
create index if not exists takeoff_reports_user_created on public.takeoff_reports (user_id, created_at desc);
alter table public.takeoff_reports enable row level security;
revoke all on table public.takeoff_reports from public, anon, authenticated;
grant select, insert, delete on table public.takeoff_reports to authenticated;

-- The API writes with the user's own session, which means the user's session
-- could write too, straight past the API. The folder rule below keeps that
-- to the user's own history; these counts keep it to a sane amount of it (a
-- run saves at most 5 rows and 11 files), like the colour-chart bucket's
-- recent_public_uploads().
create or replace function public.recent_takeoff_report_rows()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.takeoff_reports r
  where r.user_id = auth.uid() and r.created_at > now() - interval '1 hour';
$$;
create or replace function public.recent_takeoff_report_files()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from storage.objects o
  where o.bucket_id = 'takeoff-reports'
    and o.name like auth.uid()::text || '/%'
    and o.created_at > now() - interval '1 hour';
$$;
revoke all on function public.recent_takeoff_report_rows() from public, anon;
revoke all on function public.recent_takeoff_report_files() from public, anon;
grant execute on function public.recent_takeoff_report_rows() to authenticated;
grant execute on function public.recent_takeoff_report_files() to authenticated;

drop policy if exists "user inserts own takeoff reports" on public.takeoff_reports;
create policy "user inserts own takeoff reports" on public.takeoff_reports
  for insert to authenticated
  with check (user_id = auth.uid() and public.recent_takeoff_report_rows() < 100);
drop policy if exists "user or staff read takeoff reports" on public.takeoff_reports;
create policy "user or staff read takeoff reports" on public.takeoff_reports
  for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.staff s where s.id = auth.uid()));
drop policy if exists "user deletes own takeoff reports" on public.takeoff_reports;
create policy "user deletes own takeoff reports" on public.takeoff_reports
  for delete to authenticated
  using (user_id = auth.uid());

-- The files. Private bucket; every object path starts with its owner's user id
-- (<user_id>/<run_id>/<report_id>/report.pdf, …/result.json, and
-- <user_id>/<run_id>/source/<file> for the uploaded measurement). The size
-- limit is the API's 25 MB upload cap with a little room.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'takeoff-reports',
  'takeoff-reports',
  false,
  27262976,
  array['application/pdf', 'application/json', 'application/xml', 'text/xml']
)
on conflict (id) do nothing;
drop policy if exists "user writes own takeoff report files" on storage.objects;
create policy "user writes own takeoff report files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'takeoff-reports'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.recent_takeoff_report_files() < 200
  );
drop policy if exists "user or staff read takeoff report files" on storage.objects;
create policy "user or staff read takeoff report files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'takeoff-reports'
    and ((storage.foldername(name))[1] = auth.uid()::text or exists (select 1 from public.staff s where s.id = auth.uid()))
  );
drop policy if exists "user deletes own takeoff report files" on storage.objects;
create policy "user deletes own takeoff report files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'takeoff-reports' and (storage.foldername(name))[1] = auth.uid()::text);
