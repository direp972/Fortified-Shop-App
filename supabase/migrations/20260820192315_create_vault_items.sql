create table public.vault_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_name text not null default 'My Job',
  kind text not null,
  payload jsonb not null,
  saved_price numeric not null,
  acked_price numeric,
  created_at timestamptz not null default now()
);
alter table public.vault_items enable row level security;
create policy "own vault read" on public.vault_items for select using (user_id = auth.uid());
create policy "own vault insert" on public.vault_items for insert with check (user_id = auth.uid());
create policy "own vault update" on public.vault_items for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own vault delete" on public.vault_items for delete using (user_id = auth.uid());
create index vault_items_user_idx on public.vault_items (user_id, job_name);
