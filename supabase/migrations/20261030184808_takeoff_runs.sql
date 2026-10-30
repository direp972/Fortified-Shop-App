-- Every run of the takeoff tool (takeoff.roofcoil.com), written by its API as
-- the signed-in user: who ran it, what was uploaded and how it was read, what
-- came out, and what the AI report reader cost. Users read their own rows;
-- staff read everyone's. Nothing here is edited after the fact.
create table if not exists public.takeoff_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  file_name text,
  file_type text not null check (file_type in ('eagleview-pdf', 'eagleview-xml', 'roofscope-pdf', 'other')),
  parser text not null check (parser in ('eagleview', 'eagleview-xml', 'ai', 'none')),
  outcome text not null check (outcome in ('ok', 'rejected', 'error')),
  http_status int,
  error text,
  address text,
  system text,
  coverage_in numeric,
  coil_width_in numeric,
  roof_area_sqft numeric,
  facets int,
  panel_count int,
  panel_lnft numeric,
  checks_passed int,
  checks_total int,
  ai_model text,
  ai_input_tokens int,
  ai_output_tokens int,
  ai_cost_usd numeric(10, 4),
  duration_ms int
);
create index if not exists takeoff_runs_user_created on public.takeoff_runs (user_id, created_at desc);
create index if not exists takeoff_runs_created on public.takeoff_runs (created_at desc);
alter table public.takeoff_runs enable row level security;
revoke all on table public.takeoff_runs from public, anon, authenticated;
grant select, insert on table public.takeoff_runs to authenticated;
drop policy if exists "user inserts own takeoff runs" on public.takeoff_runs;
create policy "user inserts own takeoff runs" on public.takeoff_runs
  for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "user or staff read takeoff runs" on public.takeoff_runs;
create policy "user or staff read takeoff runs" on public.takeoff_runs
  for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.staff s where s.id = auth.uid()));

-- Per-person rollup. security_invoker keeps the table's RLS in force, so a
-- user sees only their own line and staff see everyone.
create or replace view public.takeoff_usage_by_user
  with (security_invoker = true) as
select
  user_id,
  max(email) as email,
  count(*) as runs,
  count(*) filter (where outcome = 'ok') as ok_runs,
  count(*) filter (where parser = 'eagleview' or parser = 'eagleview-xml') as eagleview_runs,
  count(*) filter (where parser = 'ai') as ai_reads,
  round(coalesce(sum(ai_cost_usd), 0), 4) as ai_cost_usd,
  round(coalesce(sum(roof_area_sqft) filter (where outcome = 'ok'), 0)) as roof_sqft_total,
  min(created_at) as first_run,
  max(created_at) as last_run
from public.takeoff_runs
group by user_id;
revoke all on public.takeoff_usage_by_user from public, anon;
grant select on public.takeoff_usage_by_user to authenticated;
