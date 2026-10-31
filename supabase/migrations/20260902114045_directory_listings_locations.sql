-- Multi-location support: each listing can carry several plant/branch locations.
-- Entries look like {"label","address","city","lat","lng","abilities"} where
-- abilities is null (= everything the company runs) or a subset for that site.
-- The legacy address/city/lat/lng columns mirror the first (primary) location
-- so older pages keep working.
alter table directory_listings
  add column if not exists locations jsonb not null default '[]'::jsonb;
