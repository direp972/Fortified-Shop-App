-- Get Listed pipeline: applications gain structured details; approved listings
-- get their own public table that suppliers.html renders from.

alter table public.manufacturer_applications
  add column if not exists details jsonb;

create table if not exists public.directory_listings (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.manufacturer_applications(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','live','hidden')),
  name text not null,
  badges text[] not null default '{}',
  address text not null default '',
  city text not null default '',
  area_keywords text not null default '',
  lat double precision,
  lng double precision,
  abilities text[] not null default '{}',
  colors text[] not null default '{}',
  coil_desc text not null default '',
  fab_desc text not null default '',
  website text not null default '',
  phone text not null default '',
  colorchart_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.directory_listings enable row level security;

-- The public directory page reads live listings anonymously; staff see everything.
create policy "public reads live listings" on public.directory_listings
  for select using (
    status = 'live'
    or exists (select 1 from public.staff s where s.id = auth.uid())
  );

-- Only staff manage listings; with check repeated on insert/update so a
-- non-staff JWT can neither create rows nor flip a row's status.
create policy "staff insert listings" on public.directory_listings
  for insert to authenticated
  with check (exists (select 1 from public.staff s where s.id = auth.uid()));

create policy "staff update listings" on public.directory_listings
  for update to authenticated
  using (exists (select 1 from public.staff s where s.id = auth.uid()))
  with check (exists (select 1 from public.staff s where s.id = auth.uid()));

create policy "staff delete listings" on public.directory_listings
  for delete to authenticated
  using (exists (select 1 from public.staff s where s.id = auth.uid()));
