# RoofCoil Shop App — Commercialization Plan and Status

*Assessment written 2026-10-17 from direct inspection of this repository, the production
Supabase project ("Fortified Project"), Vercel and the security advisors. Refreshed
2026-10-26 to record what has shipped since. Facts are verified unless marked as an
assumption or a recommendation. The design docs beside this file
([phase1-tenant-design.md](phase1-tenant-design.md), [phase2-self-serve-shop-design.md](phase2-self-serve-shop-design.md),
[catalog-as-data-design.md](catalog-as-data-design.md), [rpc-grant-hardening-design.md](rpc-grant-hardening-design.md),
[phase1-two-shop-test-plan.md](phase1-two-shop-test-plan.md), [phase3-billing-design.md](phase3-billing-design.md)) hold the detail for each piece.*

---

## Status at a glance — 2026-10-26

Twenty pull requests merged between 17 and 26 October (#49–#68), thirteen migrations
applied to production, every change through CI. In order:

| Shipped | PRs | What it means |
|---|---|---|
| Correct, tamper-proof pricing | #49, #52 | Orders price at the customer's assigned tier and are repriced on the server (`submit-order`); the browser can no longer insert an order. Prerender reads its config from the environment. |
| Shops as tenants | #53, #54, #55, #56 | Each shop has its own price list, costs, presets, Shop Floor board and customer tiers, isolated by RLS; Fortified is shop #1. A two-shop checklist passed and its results are recorded. |
| Catalog as data | #57, #58, #60, #61 | The platform catalog (187 rows: profiles, gauges, brands, colors, kits) lives in `catalog_items`; a shop can run its own catalog over the platform's; the public pages and the prerender read colors from it; staff edit it in a platform panel. |
| Self-serve onboarding | #59, #62, #63, #64 | A shop onboards itself: setup checklist, member invites, `?shop=<slug>`, per-shop tier names and PO counters. A second shop onboarded itself end to end in the test. |
| Drawing tool polish | #50, #51, #65 | Presets in folders, Trim Box on the canvas, members-page tabs following the app. |
| Database hardening | #66, #68 | Anonymous callers keep only the signed-out surface; RLS predicates are authenticated-only; the API roles lost TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on every table and new tables are born without them. The advisor shows only the four accepted anonymous functions. |
| No pricing before sign-in | #67 | Signed out, every price, rate and mileage term is withheld; the rate and total boxes read "Sign up today"; sign-up asks for a ZIP and a new account starts on the ordering shop nearest it. |

**Live numbers (production, 2026-10-26):** 32 customer accounts (none with a ZIP yet — the
field is a day old), 2 staff, 29 site leads, 14 directory listings of which 2 take orders,
3 shops with 4 members, 187 catalog rows, 19 tables, 52 migrations. **Orders in the last 30
days: 0.** The platform is ready for other shops; nobody is ordering through it yet, which
is the strongest argument for starting pilots over building more.

**Open as of today:** leaked-password protection (dashboard toggle, Pro plan); a real
sign-up with a ZIP has not been exercised; pilot shops. The business model is decided
(SaaS per shop, 26 October) and the Phase 3 billing design is in review.

---

## Part 1 — What we had on 17 October, and where each finding stands

### 1.1 The asset

**RoofCoil.com** is a live, real-customer system with three connected parts in one repo,
deployed to shop.roofcoil.com (the `roofcoil` Vercel project only proxies the domain):

1. **Panel & Trim design + ordering tools** — trim drawing with fold-by-fold canvas, flat
   patterns and AI sketch scanning (Anthropic, server-side); a 3D part designer (collector
   boxes, scuppers, chimney caps); a panel configurator; residential and commercial kits;
   coil and flat-metal ordering; the cross-brand Color Lab; instant pricing with
   staff-managed customer tiers; Job Vault; orders with PO numbers and status emails.
2. **Shop Floor** — staff order management plus the Master Materials List and backend
   pricing, enforced in Postgres rather than hidden in the UI.
3. **Supplier directory + content site** — prerendered SEO pages per supplier, Get Listed
   applications, listing claims, owner accounts, and shops that take orders through
   RoofCoil with their own Shop Floor.

### 1.2 What is genuinely good (unchanged)

The tools are the product and are hard to copy; the marketplace primitive (directory +
order routing) already exists; security is enforced at the database; acquisition is built
in through the prerendered directory; the email and abuse engineering is real.

### 1.3 The blockers found on 17 October — resolution

| # | Finding then | Status now |
|---|---|---|
| 1 | Single-tenant core: one catalog, one price list, Fortified's | **Resolved** — per-shop price lists, costs, presets, tiers (#53) and per-shop catalogs over a platform catalog held as data (#57–#61). |
| 2 | Tier pricing not wired through (every estimate used the Greenleaf rate) | **Resolved** — confirmed a bug and fixed (#49). |
| 3 | Prices computed in the browser and trusted on submit | **Resolved** — `submit-order` reprices server-side and is the only write path into `orders` (#49). |
| 4 | The single-file `App.jsx` as the velocity blocker | **Partly resolved** — catalog and pricing now live in `supabase/functions/_shared/` and are shared with the server; the component itself is still one large file. Further splitting is a judgement call, not a blocker. |
| 5 | Binary identity model, no organization concept | **Resolved** — `shops`, `shop_members`, `shop_customers`, `shop_settings`, `shop_invites` with owner/staff roles (#53, #59). |
| 6 | No commercial machinery: billing, plans, onboarding | **Half resolved** — self-serve onboarding shipped (#59); billing and entitlements are not started (Phase 3). |
| 7 | Duplication of taxonomy and colors across pages | **Mostly resolved** — colors come from `catalog_items` everywhere (#61); the capability taxonomy is still copied between the public pages. |
| 8 | Hardcoded Supabase fallbacks; leaked-password protection off | **Half resolved** — fallbacks removed (#52); the password toggle is still off. |

---

## Part 2 — Commercial product blueprint (unchanged)

**What this is:** a quoting, design and ordering storefront for sheet-metal fabrication —
"Shopify for sheet-metal fabrication" with RoofCoil.com as the network on top.

> **RoofCoil — the ordering platform for the sheet-metal supply chain.** Give your
> contractor customers professional design tools under your brand, with your catalog and
> your pricing, and run every order through one shop floor.

**Segments:** independent fab shops first (the platform now does everything they need except
billing); distributors (branch-level portals) and manufacturers (white-label design tools
for dealer networks) after pilots prove the model.

**Business model — decided 2026-10-26: SaaS subscription per shop.** A shop pays a flat
monthly plan for the storefront, the design tools and the Shop Floor. The directory listing
stays free and is the funnel; featured placement in the directory is the one paid add-on.
No money moves through RoofCoil on orders: contractors keep paying shops directly, as today.
A transaction fee is only revisited later, as optional online payments, once routed orders
are steady. Why not a marketplace fee: there is almost no routed volume to take a cut of
(2 orders ever), collecting it would mean taking card payments on orders that shops sell on
account and price after confirmation, and a fee paid by competitors to a platform whose
owner also runs a shop is a channel conflict. Starting prices to confirm with pilots, not
researched market rates: Listing free, Shop about $149/month, Pro about $299/month (multiple
bases, more staff), Featured +$49/month. The prices live in Stripe, not in code. The billing
design is [phase3-billing-design.md](phase3-billing-design.md).

**Fortified's dual role — decided 2026-10-26.** Fortified Sheet Metal is both the platform's
operator and a shop on it. Four rules:

1. **Same plan, same checks.** Fortified runs on a plan and the same server-side entitlement
   checks as every other shop, comped rather than special-cased.
2. **Neutral routing.** Today an order with no shop chosen goes to Fortified as the default
   shop. That rule is either published, or replaced by routing to the nearest ordering shop
   by the customer's ZIP, which the app already works out at sign-up.
3. **Written visibility rules.** What the Fortified team can and cannot see of another
   shop's data (prices, costs, customers, tiers, orders, leads) is written down.
4. **Platform admin apart from Fortified's shop staff.** The two platform staff accounts are
   also Fortified's owner members today. Platform administration becomes its own role, so
   running the platform and running Fortified's shop stop being the same login and the same
   permissions.

The billing design sets out how each rule is implemented.

**Data rule:** the directory and reference data are shared; a shop's catalog choices,
prices, costs, customers, tiers, orders and leads are private, enforced by RLS. Competing
shops will coexist in the same metro.

---

## Part 3 — The minimum commercially viable product

| Step | Status |
|---|---|
| P0.1 Tier wiring | ✓ #49 |
| P0.2 Server-side reprice | ✓ #49 |
| P0.3 Prerender fallbacks to env; leaked-password protection | ✓ #52 / **toggle still off** |
| P1.4 Catalog and pricing out of `App.jsx` | ✓ #49, #57 |
| P1.5 Shops, members, per-shop rows, RLS; Fortified as shop #1 | ✓ #53, #54 |
| P1.6 Catalog editor; app renders the shop's catalog | ✓ #58, #60, #61 |
| P1.7 Onboarding: claim → workspace → price list → ordering on | ✓ #59, #62, #64 |
| P2.8 Stripe plans and server-side entitlements | **designing** — SaaS per shop decided 2026-10-26; design in [phase3-billing-design.md](phase3-billing-design.md) |
| P2.9 Pilot with 2–3 directory shops | **not started** — blocked on choosing the shops |

Added since the plan was written, because they turned out to matter first: no pricing
before sign-in with ZIP-based shop selection (#67), and the database hardening (#66, #68).

---

## Part 4 — Architecture: what changed

**Kept, as planned:** Vite/React + Supabase + Vercel, RLS-first, definer RPCs for privacy,
edge functions for email and for order submission, the prerender SEO pipeline, GitHub
Actions CI.

**Changed:** pricing (`_shared/pricing.mjs`) and the catalog (`_shared/catalog.mjs`) are
plain modules shared by the app and the `submit-order` function, so the server prices with
exactly the code that priced the screen; the catalog is rows in `catalog_items`; shop data
lives in shop-scoped tables with RLS; four edge functions (`order-alert`, `listing-alert`,
`signup-email`, `submit-order`) are in the repo and deployed from it.

**Still open from the architecture list:** a staging Supabase project (every migration this
month went straight to production), one shared taxonomy module for the public pages, and
whether to split `App.jsx` further.

---

## Part 5 — Roadmap with status

| Phase | Scope | Status |
|---|---|---|
| 0. Correctness | Tier fix, server-side reprice, config and advisor fixes | **Done** (toggle aside) |
| 1. Tenant foundation | Shops, members, per-shop pricing and catalog, isolation verified | **Done** — two-shop checklist passed |
| 2. Self-serve shop | Catalog editor, onboarding from a listing claim, shop-slug entry | **Done** — a second shop onboarded itself |
| 3. Pilots + billing | Stripe plans, 2–3 paying pilot shops, feedback loop | **Designing** — SaaS per shop decided; billing design in review; pilot shops still to choose |
| 4. Expand segment | Distributor branches or manufacturer white-label, whichever pilots pull | Later, demand-driven |

---

## Part 6 — Questions still open

1. ~~Tier pricing intent~~ — answered: a bug, fixed.
2. ~~Business model~~ — answered 2026-10-26: SaaS per shop, directory free, featured placement as the paid add-on (Part 2).
3. **Pilot shops**: which 2–3 of the 14 listings (2 already take orders) start as paying pilots.
4. ~~Fortified's dual role~~ — answered 2026-10-26: same plan and checks, neutral routing, written visibility rules, platform admin apart from Fortified's shop staff (Part 2; implementation in the billing design).
5. Permit Intelligence — parked for now at Nick's request (2026-10-26); not part of this plan.
6. **Order history**: the `orders` table still shows 2 rows and none in the last 30 days; pilots are how that changes.

---

## Appendix — Asset map (2026-10-26)

| Asset | Location |
|---|---|
| Source of truth | GitHub `direp972/Fortified-Shop-App`; CI in `.github/workflows/build.yml`; builds read `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from repository variables |
| App hosting | Vercel `fortified-shop-app` → shop.roofcoil.com; `roofcoil` project = domain proxy |
| Database | Supabase "Fortified Project" (`znueitseoqijhkkvdomc`): 19 tables, 52 migrations, Vault secrets |
| Edge functions | `order-alert`, `listing-alert`, `signup-email`, `submit-order` (all in `supabase/functions/`, shared modules in `_shared/`) |
| AI feature | `api/scan-sketch.js` (Vercel function, Anthropic API, key server-side) |
| Takeoff product | separate repo `direp972/roofcoil-takeoff` (EagleView import engine + upload app) |
| Unused/parked | Vercel `fortified-metals`, `roofcoil-proxy-check`; Supabase "Fortified Metals Website" (inactive) |
