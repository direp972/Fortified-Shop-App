-- Column-level anon grants on directory_listings made PostgREST answer 401 to every
-- anonymous directory read (suppliers.html, the home-page counter, and the prerender step
-- of every Vercel build), so the table-level grant is back. The three internal columns
-- (owner_id, application_id, order_email) are readable by anon again; they hold a user id,
-- an application id and a business email, nothing a page renders. Hiding them needs a view
-- or a separate table, not a grant.
grant select on public.directory_listings to anon;
