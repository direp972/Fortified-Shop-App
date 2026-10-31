-- Catalog as data, step 3: a shop's catalog selection is a document in shop_settings under
-- the key 'catalog' (docs/catalog-as-data-design.md §2.2): the platform brands, colors,
-- bare metals and profiles it switched off, and its own paint lines and profiles. A customer
-- needs it to draw and price, so it joins the keys every signed-in account may read (the
-- sell-price keys and the tier labels, as the live policy has them); the shop's people write
-- it like the rest of its settings. Costs and the price list stay with can_manage_shop.
drop policy if exists "members read settings, sell prices for all" on public.shop_settings;
create policy "members read settings, sell prices for all" on public.shop_settings
  for select to authenticated
  using (public.can_manage_shop(shop_id) or key in ('coil-width-scale', 'custom-trim-presets', 'tier-labels', 'catalog'));
