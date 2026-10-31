-- Second upload on the Get Listed application: a sales book / line card
-- alongside the color chart. Same public bucket, staff-only read via the
-- existing application RLS.
alter table public.manufacturer_applications
  add column if not exists salesbook_url text;
