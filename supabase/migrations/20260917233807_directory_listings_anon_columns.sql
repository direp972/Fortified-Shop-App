revoke select on public.directory_listings from anon;
grant select (id, status, name, badges, address, city, area_keywords, lat, lng, locations,
              abilities, colors, coil_desc, fab_desc, website, phone, colorchart_url, photos,
              logo_url, logo_bg, licensed_states, featured, gmaps_url, accepts_orders,
              created_at, updated_at)
  on public.directory_listings to anon;
