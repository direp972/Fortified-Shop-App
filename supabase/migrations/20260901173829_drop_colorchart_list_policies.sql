-- The mfr-colorcharts bucket is public, so chart URLs are served via the
-- public object endpoint regardless of RLS. These SELECT policies only
-- enabled the storage LIST endpoint, letting anyone enumerate every upload
-- (including spam) — nothing on the site uses list, so drop them.
drop policy if exists "anyone can view color charts" on storage.objects;
drop policy if exists "signed-in users can view color charts" on storage.objects;
