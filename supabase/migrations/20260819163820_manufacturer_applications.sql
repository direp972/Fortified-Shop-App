-- Manufacturer "get listed" applications from roofcoil.com/get-listed.html
create table public.manufacturer_applications (
  id uuid primary key default gen_random_uuid(),
  company text not null default '',
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  website text not null default '',
  plants text not null default '',
  panel_types text[] not null default '{}',
  gauges text[] not null default '{}',
  notes text not null default '',
  colorchart_url text not null default '',
  created_at timestamptz not null default now()
);

alter table public.manufacturer_applications enable row level security;

-- Public form submits with the anon key; nobody anonymous can read applications back.
create policy "anyone can submit an application" on public.manufacturer_applications
  for insert to anon with check (true);
create policy "signed-in users can submit an application" on public.manufacturer_applications
  for insert to authenticated with check (true);
create policy "staff can read applications" on public.manufacturer_applications
  for select to authenticated
  using (exists (select 1 from public.staff s where s.id = auth.uid()));
create policy "staff can delete applications" on public.manufacturer_applications
  for delete to authenticated
  using (exists (select 1 from public.staff s where s.id = auth.uid()));

-- Public bucket for uploaded color charts (PDF/images, 10 MB cap).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mfr-colorcharts', 'mfr-colorcharts', true, 10485760,
        array['application/pdf','image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

create policy "anyone can upload a color chart" on storage.objects
  for insert to anon with check (bucket_id = 'mfr-colorcharts');
create policy "signed-in users can upload a color chart" on storage.objects
  for insert to authenticated with check (bucket_id = 'mfr-colorcharts');
create policy "anyone can view color charts" on storage.objects
  for select to anon using (bucket_id = 'mfr-colorcharts');
create policy "signed-in users can view color charts" on storage.objects
  for select to authenticated using (bucket_id = 'mfr-colorcharts');
