# RPC grant hardening — design

*2026-10-24. Scope: every `SECURITY DEFINER` function in `public` that Supabase's security
advisor flags as callable by the `anon` role, plus the `search_path` of the four definer
functions still set to `public`. Facts below were read from the hosted project
(`pg_proc`, `pg_policies`, `role_table_grants`) and from `main`'s call sites.*

## Why not just revoke everything from anon

A definer function is dangerous when an anonymous caller can use it to read or change
something RLS would hide. Two things make blanket revocation wrong here:

1. **The signed-out app and the prerender call three of them on purpose.** They return only
   data that is public anyway.
2. **Four of them are RLS predicates.** Postgres evaluates a policy's expression for whichever
   role the policy is granted `TO`. If a policy is `TO public` (the default) and its expression
   calls a function the `anon` role may not execute, an anonymous `select` on that table fails
   with `permission denied for function` instead of returning no rows — that is the outage
   PR #55 fixed. Revoking without first narrowing the policies would bring it back.

So the rule is: keep anonymous access where a signed-out visitor needs it and the function
can only return public data; where a function exists only to serve a policy, make the policy
`TO authenticated` (so anon never evaluates it) and then revoke.

## The eight anonymously-callable functions

| Function | Who calls it as `anon` | Returns | Decision |
|---|---|---|---|
| `shop_slugs()` | `scripts/prerender.mjs` (publishable key) — order links on supplier pages | `(id, slug)` of active shops with ordering on | **Keep anon.** Public by definition (the slugs are URLs). |
| `ordering_shop_by_ref(text)` | `src/App.jsx` — `?shop=<slug or id>` preselect, runs before sign-in | listing name/phone/city/pin of one active shop taking orders (or any active shop if the caller is staff) | **Keep anon.** Same columns `directory_public` already exposes. |
| `default_shop_id()` | `src/App.jsx` signed-out fallback; `submit-order` (service role) | one uuid | **Keep anon.** |
| `recent_public_uploads()` | nobody directly — it is the upload throttle inside the two `storage.objects` INSERT policies for `anon` and `authenticated` (`mfr-colorcharts` bucket) | an integer count | **Keep anon + authenticated, revoke from PUBLIC.** It is the only function granted to `PUBLIC` (every role, present and future); the storage policies need exactly `anon` and `authenticated`. |
| `is_staff()` | no code; policy predicate | boolean | **Revoke anon** after narrowing its three `staff` policies (below). Also set `search_path = ''` and qualify `public.staff`. |
| `is_shop_member(uuid)` | no code; policy predicate | boolean | **Revoke anon** after narrowing the two routed-order policies on `orders`. |
| `is_listing_owner(uuid)` | no code; policy predicate | boolean | **Revoke anon**, same two policies. |
| `is_customer_of_my_shop(uuid)` | no code; policy predicate | boolean | **Revoke anon** after narrowing the one `customers` policy. |

Every one of the eight already runs with `search_path = ''` except `is_staff` (`public`), and
none takes a caller-supplied value into anything but a `where` clause.

## Policies that become `TO authenticated`

These are the only policies in the database that reference the four predicates (regex scan of
`pg_policies`), restricted to tables the `anon` role has table-level grants on. Each can only
be true for a signed-in user, because the predicate compares against `auth.uid()`, which is
null for anon:

| Table | Policy | Command | Expression (abridged) |
|---|---|---|---|
| `orders` | shop owner reads routed orders | SELECT | `shop_id is not null and (is_listing_owner(shop_id) or is_shop_member(shop_id))` |
| `orders` | shop owner updates routed orders | UPDATE | same, as `using` and `with check` |
| `customers` | shop members read their shop customers | SELECT | `is_customer_of_my_shop(id)` |
| `staff` | staff read all staff | SELECT | `is_staff()` |
| `staff` | staff grant admin | INSERT | `is_staff()` |
| `staff` | staff revoke admin | DELETE | `is_staff() and id <> auth.uid()` |

What anon sees afterwards, table by table:

- `orders`: the remaining `TO public` policies (`own or staff read`, `staff update`, `staff delete`) use `auth.uid()` and an inline `exists (select 1 from staff …)`; they are false for anon → **no rows, no error**, exactly as today.
- `customers`: `See own record or staff sees all` and `Insert own record on signup` stay `TO public` and are false for anon → no rows.
- `staff`: `Check own staff membership` stays `TO public` → no rows for anon. The signed-out site (`public/auth.js`) reading `staff` keeps getting an empty result, not an error.

The policies on `shops`, `shop_members`, `shop_customers`, `shop_settings`, `shop_invites` and the
`catalog_items` write policies are **already** `TO authenticated`, and `anon` holds no table
grant on the first five, so they never evaluate for anon today and are untouched.

`is_staff()` is also called *inside* `ordering_shop_by_ref()`. That call runs in the definer's
context (the function owner), so anon losing EXECUTE on `is_staff` does not affect it.

## `search_path` tightening

Four definer functions still run with `search_path = public`, which lets a same-named object
in `public` shadow a catalog function. Their bodies already schema-qualify every table
(`public.*`, `auth.users`), so they can be switched to `''` without a body change — except
`is_staff`, whose body names bare `staff` and is recreated with `public.staff`:

- `is_staff()` — recreated
- `set_listing_owner(uuid, text)` — `alter function … set search_path = ''`
- `staff_listing_owners()` — same
- `validate_listing_edit()` (trigger) — same

## Advisor warnings that will remain, by design

After the migration the advisor still lists `shop_slugs`, `ordering_shop_by_ref`,
`default_shop_id` and `recent_public_uploads` as anonymously callable definer functions. They are
the signed-out surface of the product; each returns public data only, runs with an empty
`search_path`, and is `STABLE`. The 20-odd `authenticated`-callable warnings are the app's
RPC API and are expected.

## Out of scope, noted for later

`anon` and `authenticated` hold Supabase's default `ALL` table privileges (including `TRUNCATE`,
`REFERENCES`, `TRIGGER`) on every table in `public`. RLS does not apply to `TRUNCATE`.
PostgREST never issues it, so there is no path from the API today, but revoking the three
unused privileges from both roles (and fixing the default privileges so new tables don't get
them) is a cheap belt-and-braces change worth its own small migration.

## Verification

- The migration was dry-run on the hosted project inside a rolled-back transaction with
  assertions on the resulting grants and policy roles (see the PR description).
- After applying: the Supabase security advisor should show exactly the four accepted anon
  warnings; signed-out `shop.roofcoil.com` must still preselect `?shop=` and show the default
  shop; the signed-out site must still load; a signed-in shop owner must still see routed
  orders on the Shop Floor; staff must still see the Customer Pricing Tiers list.

## Rollback

Each statement is reversible: `alter policy … to public`, `grant execute … to anon`, and
`alter function … set search_path = public`. No data changes.
