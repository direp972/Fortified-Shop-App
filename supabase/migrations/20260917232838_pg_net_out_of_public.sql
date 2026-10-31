-- pg_net was installed in the public schema (security advisor 0014). Its objects live in
-- the net schema either way; only the extension's own home moves. Recreating it drops the
-- request queue and response log, which hold nothing worth keeping. One transaction, so a
-- failed create leaves the old extension in place.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
