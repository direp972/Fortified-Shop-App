create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  company text not null default '',
  email text not null default '',
  source text not null default 'members-gate',
  created_at timestamptz not null default now()
);

alter table public.leads enable row level security;

-- The public site's signup gate submits with the anon key; nobody anonymous can read back.
create policy "anyone can submit a lead" on public.leads
  for insert to anon with check (true);
create policy "signed-in users can submit a lead" on public.leads
  for insert to authenticated with check (true);

-- Only staff accounts can view or clear leads.
create policy "staff can read leads" on public.leads
  for select to authenticated
  using (exists (select 1 from public.staff s where s.id = auth.uid()));
create policy "staff can delete leads" on public.leads
  for delete to authenticated
  using (exists (select 1 from public.staff s where s.id = auth.uid()));
