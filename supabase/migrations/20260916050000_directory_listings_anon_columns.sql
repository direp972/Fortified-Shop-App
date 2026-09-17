-- Anonymous readers lose the table-wide SELECT on directory_listings and keep only the
-- columns the directory_public view shows. The view is security_invoker, so it reads the
-- table as the caller: these column grants are exactly what it needs, and owner_id,
-- application_id and order_email are now unreadable to anon by any path. Signed-in
-- readers (authenticated) keep the full table grant; RLS still decides which rows.
--
-- Applied only after a production build had proven every anonymous reader is on the view
-- (the September 16 outage was a column grant applied while the prerender still did
-- select=* on the table). Verified afterwards with `set role anon`: directory_public
-- returns the live listings, and selecting owner_id or * from the table is denied.
revoke select on public.directory_listings from anon;
grant select (id, status, name, badges, address, city, area_keywords, lat, lng, locations,
              abilities, colors, coil_desc, fab_desc, website, phone, colorchart_url, photos,
              logo_url, logo_bg, licensed_states, featured, gmaps_url, accepts_orders,
              created_at, updated_at)
  on public.directory_listings to anon;
