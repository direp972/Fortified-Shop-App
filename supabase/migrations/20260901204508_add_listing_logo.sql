-- Shop logos on directory listings for brand recognition — uploaded with the
-- application or pulled from the shop's website by staff.
alter table public.directory_listings
  add column if not exists logo_url text not null default '';
