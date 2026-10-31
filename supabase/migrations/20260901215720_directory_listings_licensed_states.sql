-- Turnkey shops list the states they hold licenses in; shown on the directory card.
alter table public.directory_listings add column if not exists licensed_states text;
