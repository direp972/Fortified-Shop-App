-- featured: pin a listing to the top of the directory (Fortified's own shop).
-- logo_bg: optional hex backdrop for logos that vanish on the light card.
alter table public.directory_listings
  add column if not exists featured boolean not null default false,
  add column if not exists logo_bg text;
