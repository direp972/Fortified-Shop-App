# Catalog as data — design

*For review, 2026-10-20. Design only: no migration, no code change until this is approved. It completes the last Phase 1 item of the commercialization plan ("catalog editor v1: a shop picks which profiles, brands and colors it offers") and is the prerequisite for the manufacturer and distributor segments. It is independent of the Phase 2 self-serve onboarding design, which deliberately leaves the catalog out.*

**Goal.** Each shop offers its own catalog on the same platform: the paint lines and colors it stocks, the panel profiles it rolls, the gauges and unpainted metals it sells, with its own additions (a private-label color line, a profile from its own machine). Fortified keeps exactly today's catalog, every existing order and saved job still renders and reprices, and the server prices an order against the catalog of the shop it goes to.

**Out of scope.** Kit geometry (the Residential Standing Seam and Commercial kits are computed from pitch and sizes; they stay code), the 3D part shapes, the chimney cap styles, the drawing tool itself, price lists (already per shop), the directory's ability taxonomy (a different vocabulary, see §7), manufacturer-owned brand rows (Phase 4).

---

## 1. What the catalog is today

Everything below is a constant in `src/App.jsx` or `supabase/functions/_shared/pricing.mjs`; every shop sees the same lists.

| Piece | Where | Shape | Count | Used for |
|---|---|---|---|---|
| Painted brands (paint lines) | `BRAND_GROUPS`, `BRANDS` in App.jsx | names | 4 (Fortified Metal, Una-Clad, Adax Metals, Berridge) | brand picker, color lists, rules |
| Brand rules | `PVDF_ONLY_BRANDS`, `PVDF_24GA_ONLY_BRANDS`, `UNPAINTED_FLATS_ONLY_BRANDS` | name lists | 3 rules | which paints and gauges a brand allows |
| Colors | `COLORS_BY_BRAND` in pricing.mjs | per brand: `{name, hex, premium?}` | 72 distinct names, about 110 entries across the 4 lines (a name such as Regal White appears in several) + one swatch each for the 4 bare metals | color picker, Color Lab matching (by hex), premium upcharge in pricing (×1.12) |
| Unpainted metals | `UNPAINTED_MATERIALS` + `COPPER_WEIGHT_OPTIONS`, `G90_GAUGE_OPTIONS`, `GALVALUME_GAUGE_OPTIONS`, `BONDERIZED_GAUGE_OPTIONS` | `{id, label, panelSqft, trimFt}` | 4 metals, 2–5 gauges each | material picker; the $/sq ft and $/ft **fallback rates** pricing uses when the price list has no row |
| Painted gauges | `GAUGE_OPTIONS` in pricing.mjs | `{id, label, panelSqft, trimFt}` | 2 (24 ga, 26 ga) | gauge picker; fallback rates; the price-list row match ("24 Gauge Coil", "24 Gauge Trim") |
| Paint systems | `PAINT_OPTIONS` in pricing.mjs | `{id, label, mult}` | 2 (PVDF ×1.15, SMP ×1.0) | paint picker, pricing multiplier |
| Panel profiles | `PROFILE_INFO`, `PROFILES`, `PANEL_VENDORS` in App.jsx | keyed by display name: `{code, family, takeup, vendor?, delisted?, desc}` | 22 (14 New Tech + 8 Adax; 9 delisted, 13 listed) | profile picker and catalog page, coil-width takeup, seam drawing by family, fabrication row match by code ("FWQ100 Fabrication"), vendor grouping |
| Clips | `CLIP_SPECS` | by profile code: `{code, perBox}` | 5 | clip accessory, materials board |
| Accessories | `ACCESSORY_TYPES`, `DRY_IN_TYPES`, `ACCESSORY_SPECS` | names per group | 5 + 3 groups | accessory picker; price-list rows by name |
| Fabricator bases | `FAB_COMPANIES` | name + coordinates | 2 | mileage; already superseded by the listing's `locations` through `shopBases()` |

Two facts shape the design:

- **Orders and saved jobs reference the catalog by name.** `orders.data` carries `brand`, `colorName`, `gaugeId`, `paintId` and `profile` as the display strings above (`"SSQ200 – 2\" Mechanical Seam"`, `"Fortified Metal"`, `"Regal White"`). The pricing module matches price-list rows by name patterns too. So names are the keys; anything that changes a name orphans history.
- **The public site repeats parts of it.** `home.html`, `members.html` and `suppliers.html` each carry their own color-swatch list; `coil-and-flats.html` and `standing-seam-panels.html` name the brands and profiles in prose; `prerender.mjs` carries the gutter profile list. Today they drift by hand ("kept in lock-step").

---

## 2. The model: a platform reference catalog, and each shop's selection over it

Two layers, deliberately different in shape.

### 2.1 `catalog_items` — the platform reference (shared, data, rows)

Manufacturer-level facts that are the same for every shop: a paint line and its colors with hex values, a profile and its takeup, a gauge and its fallback rate. Public specs, so readable by anyone (the public pages and the prerender read them instead of their own copies); edited by platform staff only.

```sql
create table public.catalog_items (
  kind        text not null check (kind in ('brand','color','material','gauge','paint','profile','clip','accessory')),
  key         text not null,              -- the name orders store: "Una-Clad", "Regal White", "24ga", "SSQ200 – 2\" Mechanical Seam"
  parent_key  text,                       -- color → its brand; gauge → its brand or material
  data        jsonb not null default '{}',-- the rest: hex, premium, takeup, family, code, vendor, panelSqft, trimFt, mult, desc, rules…
  sort        int not null default 0,
  delisted    boolean not null default false, -- hidden from every picker, still resolves for old orders
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
-- one row per name within its kind and parent: unique index on (kind, coalesce(parent_key, ''), key)
```

Policies: `select` for `anon` and `authenticated`; `insert`/`update`/`delete` for platform staff (`is_staff()`). Rows are never deleted once an order could reference them; `delisted` is the off switch (this is what `PROFILE_INFO.delisted` already does for seven profiles).

### 2.2 `shop_settings` key `catalog` — the shop's selection (private, one JSON document)

What a shop offers, as one document in the table Phase 1 built, next to its price list. Absent document = **everything the platform lists that is not delisted**, which is exactly today's behaviour, so Fortified and CFR change nothing on day one.

```jsonc
{
  "brands":    { "Berridge": false },                         // platform brands switched off (default on)
  "colors":    { "Una-Clad": { "Brandywine": false } },      // colors switched off within a brand
  "materials": { "Bonderized": false },                      // unpainted metals switched off
  "profiles":  { "US-150 – 1.5\" Mechanical Seam": false },  // profiles switched off
  "custom": {                                                 // the shop's own additions, private to it
    "brands":   [{ "name": "CFR Select", "base": "painted-steel", "paints": ["pvdf","smp"], "gauges": ["24ga","26ga"],
                   "colors": [{ "name": "CFR Bronze", "hex": "#4A3E36" }, { "name": "CFR Slate", "hex": "#565B5E", "premium": true }] }],
    "profiles": [{ "name": "CFR-150 – 1.5\" Snap-Lock", "code": "CFR150", "family": "snap", "takeup": 4.25, "desc": "…" }]
  }
}
```

Why a document and not rows: it is small (a few dozen switches), it is read whole, it is shop-private, and it follows the price list's pattern (`shop_settings` → `shopStorage.get/set`, the same RLS). A custom brand or profile lives only here; nothing in the platform table knows about it. The key joins the everyone-readable list (`coil-width-scale`, `custom-trim-presets`, `catalog`), because a customer needs the shop's catalog to draw and price; it holds no cost.

### 2.3 The effective catalog — one pure function, shared by app and server

```js
// supabase/functions/_shared/catalog.mjs (new; plain ESM like pricing.mjs)
export const DEFAULT_CATALOG = { brands: [...], colors: {...}, materials: [...], gauges: {...}, paints: [...], profiles: {...}, clips: {...}, accessories: {...} };
export function catalogFromRows(rows)                 // catalog_items rows → the same shape as DEFAULT_CATALOG
export function resolveCatalog(platform, selection)   // platform shape + the shop document → what this shop offers
export function findGauge(catalog, gaugeId, brand), findColor(catalog, name, brand, paintId), profileInfo(catalog, name), …
```

`DEFAULT_CATALOG` is the constants of §1 moved out of `App.jsx`, kept as the fallback the way `DEFAULT_PRICE_LIST` is (used when the table is unreachable, and by `pricing-check`). `pricing.mjs` stops owning catalog data: `computePrice(order, priceList, coilWidthScale, tier, catalog)` takes the resolved catalog and uses its gauge and color lookups. The app resolves once per selected shop (`useCatalog(shopId)`); `submit-order` resolves the order's shop the same way, so an order is priced against the catalog its customer saw.

Resolution rules, in order: start from the platform rows; drop what the shop switched off; append the shop's custom brands (with their colors) and profiles; a delisted platform item is never offered but still resolves for an old order; a custom item that the shop later removes is likewise kept in a `retired` list so history still renders.

---

## 3. Keys and history

- **Names stay the keys.** `brand`, `colorName`, `gaugeId`, `paintId`, `profile` on orders keep their meaning and their values; nothing in `orders.data` is rewritten. Platform `key` values are the current display names, so the seed is exact.
- **Renames are forbidden on the platform rows** (a rename would be a new row plus delisting the old one). The catalog editor's name field for a platform item is read-only; a shop can change how an item is *labelled* on its own pickers later (Phase 2 of this work, with `label` in the selection document), never the key.
- **Custom item names are unique within the shop** across platform and custom (a shop cannot add a brand called "Berridge"), checked in the editor and again in `resolveCatalog`.
- The two existing orders reference `SSQ200 – 2" Mechanical Seam` and `Fortified Metal`; both are platform rows after the seed.

---

## 4. Pricing coupling

`getSellRates()` already prices from the shop's price list by row name ("24 Gauge Coil (per linear ft)", "Panel Fabrication", "FWQ100 Fabrication", "16 oz Copper") and falls back to the gauge table's `panelSqft` / `trimFt`. With the catalog as data:

- Painted gauges and unpainted-material gauges come from `catalog.gauges` (fallback rates included), so a shop that adds a gauge gets a sensible estimate before it prices it.
- A custom brand declares its `base` (`painted-steel` today; `copper` later) so it inherits that base's gauge table and price-list rows; its colors carry their own `premium` flag.
- A custom profile declares `family` (seam drawing), `takeup` (coil width) and `code` (so a "CFR150 Fabrication (per linear ft)" row in the price list is picked up exactly as "FWQ100 Fabrication" is today).
- `scripts/pricing-check.mjs` passes `DEFAULT_CATALOG` and gains a case for a custom brand and a custom profile.

---

## 5. The app

- **Reading.** `useCatalog(shopId)`: load `catalog_items` once per session (public, cached), load `shop_settings.catalog` for the selected shop (through `shopStorage`, like the price list), resolve, and hand the result to everything that reads `PROFILE_INFO`, `PROFILES`, `BRANDS`, `COLORS_BY_BRAND`, the gauge tables, `PAINT_OPTIONS`, `CLIP_SPECS`, `ACCESSORY_SPECS`, `PANEL_VENDORS` (about 60 references). The kit builders and presets keep reading the resolved catalog for gauge and paint. Switching the shop in the picker switches the catalog with it, like the price list does now.
- **Editing: a "Catalog" section in Price List → Backend (Edit)**, under the cost sections, for the shop's people:
  - Brands: a switch per platform brand; expanding a brand shows its colors with a switch each (platform colors cannot be edited, only switched).
  - Unpainted metals and profiles: a switch each.
  - "Add a brand": name, base, paints, gauges, then colors (name, hex, premium). "Add a profile": name, code, family, takeup, description. Removing a custom item retires it.
  - Platform staff get one more panel, **Platform catalog**, to add a brand, color or profile for everyone or delist one (the only place platform rows change; a plain form over `catalog_items`).
- **Public pages and prerender** read `catalog_items` for color swatches instead of their own lists (`home.html`, `members.html`, `suppliers.html`; the prerender already reads the database with the publishable key). The prose on `coil-and-flats.html` and `standing-seam-panels.html` stays prose.

---

## 6. Migration and rollout, in four pull requests

1. **Extract** (no database change). Move the §1 constants into `_shared/catalog.mjs` as `DEFAULT_CATALOG`, thread `catalog` through `pricing.mjs` and the ~60 call sites, `pricing-check` green, output identical. CI protects it; this is the risky-looking but mechanical step and ships alone.
2. **Platform table** (`catalog_items`, policies, seed). The seed is generated from `DEFAULT_CATALOG` by a script (`scripts/catalog-seed.mjs` writes the migration's `insert` statements), so the rows equal the constants exactly; the app and `submit-order` read the table and fall back to `DEFAULT_CATALOG`. Still identical output.
3. **Per-shop selection** (`shop_settings.catalog`, the Backend "Catalog" section, `submit-order` resolving per shop, the policy change adding `catalog` to the everyone-readable keys). Fortified and CFR have no document, so nothing changes for them until someone edits.
4. **Public pages** read colors from the table; the Platform catalog panel for staff.

Each step is additive and reversible by redeploying the previous build; the only schema is one new table with no foreign keys into existing data, plus one more key in an existing policy's list.

---

## 7. Relation to the directory's abilities

The directory's `abilities` taxonomy (53 distinct values in use, "1.5″ snap-lock", "Painted coil — PVDF / Kynar", …) is a marketing vocabulary for finding a supplier, kept in three public pages. It is not the ordering catalog and this design does not merge them. Once shops have catalogs, a later step can *derive* ability chips from a shop's catalog (profile families → seam abilities; paints → coil abilities) so a shop never fills both in by hand.

---

## 8. Guarantees

| Guarantee | How |
|---|---|
| Fortified's catalog is unchanged | No selection document → everything platform-listed, which is the seed of today's constants |
| Old orders and saved jobs still render and reprice | Names stay the keys; platform rows are never deleted, only delisted; retired custom items are kept |
| A shop's custom brands, colors and profiles are private | They live only in that shop's `shop_settings` document, under the Phase 1 policies |
| A customer sees the catalog of the shop they order from | `useCatalog(shopId)` follows the picker; `submit-order` resolves the order's shop |
| Costs stay private | The catalog holds no costs; price lists are untouched |
| The public site stops drifting | One source for color swatches |

---

## 9. Test plan (outline)

Shop A = Fortified, no document. Shop B = a test shop with: Berridge switched off, Una-Clad's "Brandywine" off, a custom brand "B Select" (painted steel, PVDF+SMP, two colors, one premium) and a custom profile "B-150" (snap, takeup 4.25), plus a "B150 Fabrication (per linear ft)" price-list row.

1. Fortified regression: every picker lists what it lists today; a saved job from before reopens; pricing-check and the seed diff are empty (a script compares `DEFAULT_CATALOG` with the table).
2. At B: Berridge and Brandywine absent from the pickers; "B Select" and "B-150" present; a panel order on B-150 in B Select / B Slate prices with the B150 fabrication row and the premium multiplier, on screen and in a `submit-order` dry run; the same order at A is refused by the picker (the catalog does not offer it) and by the server (B-150 is not in A's catalog).
3. Retire "B Select" at B: it leaves the picker, the earlier order still shows and reprices.
4. Platform staff delist a platform color: it leaves every shop's picker, old orders still show it.
5. RLS: B's owner cannot write `catalog_items`; a customer reads both catalogs and writes neither; anon reads `catalog_items` only.

---

## 10. Decisions to confirm

1. **Platform rows vs. one shared document.** Rows (recommended, §2.1) for per-item edits, public reads and later manufacturer ownership; a single JSON document would be simpler but makes "delist one color" an edit of a 110-item blob.
2. **Names remain the keys** (recommended, §3) so no order data is rewritten; the cost is that platform items can never be renamed, only replaced.
3. **Custom items are shop-private** (recommended). The alternative, "a shop proposes a brand to the platform", is a Phase 4 manufacturer feature.
4. **The four-step rollout** with step 1 shipping on its own as a pure refactor.
