-- Job photos on directory listings: applicants upload with their application,
-- staff approve which ones publish, and the directory card shows them.
alter table public.directory_listings
  add column if not exists photos text[] not null default '{}';
