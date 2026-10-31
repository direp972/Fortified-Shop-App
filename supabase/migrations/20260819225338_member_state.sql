-- Per-account memory for roofcoil.com: last color viewed, last finder path, last page,
-- and room for saved projects. One row per user; owner-only access.
create table public.member_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.member_state enable row level security;

create policy "own state read" on public.member_state
  for select to authenticated using (user_id = auth.uid());
create policy "own state insert" on public.member_state
  for insert to authenticated with check (user_id = auth.uid());
create policy "own state update" on public.member_state
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
