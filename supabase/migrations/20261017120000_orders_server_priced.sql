-- Orders are priced on the server from now on: the submit-order Edge Function
-- (supabase/functions/submit-order) reprices each order at the customer's assigned tier
-- against the shop's live Price List and writes public.orders with the service role. The
-- browser-side insert path is closed so a customer can't send an order carrying a price of
-- their own choosing. Reads, and the staff / shop-owner updates, are unchanged.
--
-- Apply this only once the app build that calls submit-order is live on shop.roofcoil.com:
-- the build before it inserts straight into the table and would start failing.
drop policy if exists "own insert" on public.orders;
