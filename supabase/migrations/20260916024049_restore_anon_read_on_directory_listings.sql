-- The public directory, the build's pre-render step and the home page's
-- listed-shop counter all read directory_listings with the publishable key,
-- i.e. as the `anon` role. The table's own RLS policy ("public reads live
-- listings") is written for exactly that and limits anon to status='live'
-- rows, but the underlying table grant had been revoked, so the policy was
-- unreachable and every anonymous read failed with 401. That broke the site's
-- directory and failed the build on every branch.
--
-- Restore the grant. RLS still decides what anon may see: live rows only.
grant select on public.directory_listings to anon;
