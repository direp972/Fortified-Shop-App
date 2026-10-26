-- Table privileges the API roles never use. Follow-up noted in
-- docs/rpc-grant-hardening-design.md ("Out of scope").
--
-- anon and authenticated hold Supabase's default ALL on every table in public, which
-- includes TRUNCATE (not subject to row-level security), REFERENCES, TRIGGER and, on
-- Postgres 17, MAINTAIN. PostgREST issues none of them, so nothing changes for the app or
-- the site; what changes is that a future bug, or a direct connection holding one of
-- these roles, can no longer empty a table, hang a trigger on it, or point a foreign key
-- at it. Every migration runs as postgres and every table is owned by postgres, so the
-- default privileges postgres hands out in public stop including them: new tables are
-- born without them. (supabase_admin's defaults carry the same grants, but only for
-- objects the platform itself creates, and postgres cannot alter them.)
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;

-- sync_customer_details() fires from a trigger on auth.users and cannot be run any other
-- way; the EXECUTE grant every new function gets by default only puts it on the advisor's
-- list of anonymously callable definer functions.
revoke execute on function public.sync_customer_details() from public, anon, authenticated;
