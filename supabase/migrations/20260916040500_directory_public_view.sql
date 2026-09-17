-- The public directory's read model. Anonymous readers (suppliers.html, the home-page
-- counter, the prerender step, and the app's shop picker for signed-out visitors) read this
-- view instead of the table, so owner_id, application_id and order_email never leave the
-- database. security_invoker keeps the table's RLS in force; the view only lists live rows.
-- Signed-in pages that need the internal columns (directory admin, manage listing) keep
-- reading the table. The table's own anon grant is removed in a later migration, once
-- every anonymous reader is on the view and a production build has proven it.
create or replace view public.directory_public
with (security_invoker = true)
as
  select id, status, name, badges, address, city, area_keywords, lat, lng, locations,
         abilities, colors, coil_desc, fab_desc, website, phone, colorchart_url, photos,
         logo_url, logo_bg, licensed_states, featured, gmaps_url, accepts_orders,
         created_at, updated_at
  from public.directory_listings
  where status = 'live';
grant select on public.directory_public to anon, authenticated;
