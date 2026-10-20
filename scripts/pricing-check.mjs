// Checks that estimates follow the customer's assigned tier, using the seed Price List.
// Run: node scripts/pricing-check.mjs   (exits non-zero on the first failing check)
import assert from "node:assert/strict";
import { computePrice, getSellRates, sellTierFor, sellRate, DEFAULT_PRICE_LIST, DEFAULT_COIL_WIDTH_SCALE } from "../supabase/functions/_shared/pricing.mjs";
import { DEFAULT_CATALOG, findGauge, findColor, listedProfiles, clipSpecForProfile, catalogToRows, catalogFromRows, isUsableCatalog, resolveCatalog, isOffered, getColorsForBrand } from "../supabase/functions/_shared/catalog.mjs";

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, wanted ${b}`);
const price = (order, tier) => computePrice(order, DEFAULT_PRICE_LIST, DEFAULT_COIL_WIDTH_SCALE, tier);

// Tier resolution: the three real tiers pass through, anything else is retail (tier2).
assert.equal(sellTierFor({ tier: "tier1" }), "tier1");
assert.equal(sellTierFor({ tier: "greenleaf" }), "greenleaf");
assert.equal(sellTierFor({ tier: "tier2" }), "tier2");
assert.equal(sellTierFor({ tier: "staff" }), "tier2");
assert.equal(sellTierFor(null), "tier2");
assert.equal(sellTierFor(undefined), "tier2");

// A row priced at one tier only is skipped at the others, as unpriced rows always were.
const partial = { category: "Trim / Flashing", name: "24 Gauge Trim (per linear ft)", tier1: 3 };
assert.equal(sellRate(partial, "tier1"), 3);
assert.equal(sellRate(partial, "tier2"), undefined);
assert.equal(sellRate(partial, "greenleaf"), undefined);

// Trim: 4 pieces × 10 ft of 24 ga SMP in a standard color = 40 LF at the tier's trim rate,
// one bend at $2 a piece, plus the $10 floor add. Seed rates: tier1 3.00, tier2 3.35, greenleaf 2.90.
const trim = { type: "trim", points: [[0, 0], [4, 0], [4, 2]], quantity: 4, lengthPerPiece: 10, gaugeId: "24ga", paintId: "smp", brand: "Fortified Metal", colorName: "Regal White" };
close(price(trim, "tier1"), 40 * 3.00 + 2 * 4 + 10, "trim tier1");
close(price(trim, "tier2"), 40 * 3.35 + 2 * 4 + 10, "trim tier2");
close(price(trim, "greenleaf"), 40 * 2.90 + 2 * 4 + 10, "trim greenleaf");
close(price(trim, "nonsense"), price(trim, "tier2"), "unknown tier prices as retail");

// Panel: coil and fabrication rates both move with the tier.
const panel = { type: "panel", width: 16, height: 120, quantity: 10, gaugeId: "24ga", paintId: "pvdf", brand: "Fortified Metal", colorName: "Regal White", profile: 'SS450 – 1.5" Snap-Lock', runLocation: "Shop" };
for (const tier of ["tier1", "tier2", "greenleaf"]) {
  const r = getSellRates("24ga", "Fortified Metal", DEFAULT_PRICE_LIST, panel.profile, tier);
  const row = (name) => DEFAULT_PRICE_LIST.find((p) => p.name === name)[tier];
  close(r.coilSqft, row("24 Gauge Coil (per linear ft)") / (16 / 12), `coil $/sqft ${tier}`);
  close(r.fabSqft, row("Panel Fabrication (per linear ft)") / (16 / 12), `fab $/sqft ${tier}`);
}
assert.ok(price(panel, "greenleaf") < price(panel, "tier1") && price(panel, "tier1") < price(panel, "tier2"), "panel tiers ordered greenleaf < tier1 < tier2");

// Flat sheet: the seed prices material and processing the same at every tier, so only the
// quantity moves the number — a guard that tier threading doesn't break tier-flat rows.
const flat = { type: "metal", flatWidth: 48, flatLength: 120, quantity: 2, gaugeId: "24ga", paintId: "smp", brand: "Fortified Metal", colorName: "Regal White" };
close(price(flat, "tier1"), price(flat, "tier2"), "flat sheet is tier-flat in the seed");

// 3D part: the base fabrication fee (collector box 45 / 55 / 42) and the coil material
// both follow the tier. With a price list that only carries the fee, the gap is exactly the fee gap.
const box = { type: "part3d", partType: "collector", partW: 12, partD: 8, partH: 10, quantity: 1, gaugeId: "24ga", paintId: "smp", brand: "Fortified Metal", colorName: "Regal White" };
assert.ok(price(box, "greenleaf") < price(box, "tier1") && price(box, "tier1") < price(box, "tier2"), "collector box tiers ordered greenleaf < tier1 < tier2");
const feeOnly = DEFAULT_PRICE_LIST.filter((p) => p.category === "3D Parts");
close(computePrice(box, feeOnly, [], "tier2") - computePrice(box, feeOnly, [], "tier1"), 10, "collector box fee gap tier2 - tier1");
close(computePrice(box, feeOnly, [], "tier1") - computePrice(box, feeOnly, [], "greenleaf"), 3, "collector box fee gap tier1 - greenleaf");

// An empty price list falls back to the hardcoded gauge rates regardless of tier.
close(computePrice(trim, [], [], "tier1"), computePrice(trim, [], [], "greenleaf"), "fallback rates ignore tier");

// The catalog is a parameter: passing the default explicitly changes nothing, and the
// lookups pick the right gauge table by material, the right color by brand, and keep
// delisted profiles out of the pickers while still resolving them.
close(computePrice(trim, DEFAULT_PRICE_LIST, DEFAULT_COIL_WIDTH_SCALE, "tier1", DEFAULT_CATALOG), price(trim, "tier1"), "explicit catalog equals the default");
close(computePrice(panel, DEFAULT_PRICE_LIST, DEFAULT_COIL_WIDTH_SCALE, "tier2", DEFAULT_CATALOG), price(panel, "tier2"), "explicit catalog equals the default (panel)");
assert.equal(findGauge(DEFAULT_CATALOG, "24ga", "Fortified Metal").trimFt, 2.75, "painted 24 ga fallback trim rate");
assert.equal(findGauge(DEFAULT_CATALOG, "16oz", "Copper").label, "16 oz Copper", "copper weights come from the copper table");
assert.equal(findGauge(DEFAULT_CATALOG, "24ga", "Copper").id, "16oz", "an unknown id falls back to the material's first gauge");
assert.equal(findGauge(DEFAULT_CATALOG, "22ga", "G90 Galvanized").trimFt, 3.00, "bare metals keep their own gauge tables");
assert.equal(findColor(DEFAULT_CATALOG, "Regal White", "Fortified Metal", "smp").hex, "#E3E1DC", "color by brand");
assert.equal(findColor(DEFAULT_CATALOG, "Burnished Slate", "Una-Clad", "pvdf").premium, true, "premium flag follows the color");
assert.equal(findColor(DEFAULT_CATALOG, "Award Blue", "Fortified Metal", "pvdf")?.name, "Award Blue", "a color is found across brands when its own brand lacks it");
const listed = listedProfiles(DEFAULT_CATALOG);
assert.ok(listed.includes('SS450 – 1.5" Snap-Lock') && !listed.includes("BB750 – Board and Batten"), "delisted profiles stay out of the pickers");
assert.ok(DEFAULT_CATALOG.profiles["BB750 – Board and Batten"], "but still resolve for old orders");
assert.equal(clipSpecForProfile(DEFAULT_CATALOG, 'SS450 – 1.5" Snap-Lock').code, "SG-114-24-SL", "clip spec by profile");
assert.equal(clipSpecForProfile(DEFAULT_CATALOG, 'FWQ100 – 1" Flush Wall / Soffit'), null, "profiles without clips");

// The platform table holds the catalog as rows: writing the default out and reading it back
// gives the default again, in every order the rows might come back in, including the order
// of the color groups that findColor searches across.
const rows = catalogToRows(DEFAULT_CATALOG);
assert.deepEqual(catalogFromRows(rows), DEFAULT_CATALOG, "rows round-trip to the default catalog");
assert.deepEqual(catalogFromRows([...rows].reverse()), DEFAULT_CATALOG, "row order does not matter");
assert.deepEqual(Object.keys(catalogFromRows([...rows].reverse()).colors), Object.keys(DEFAULT_CATALOG.colors), "color groups keep their order");
assert.deepEqual(Object.keys(catalogFromRows([...rows].reverse()).profiles), Object.keys(DEFAULT_CATALOG.profiles), "profiles keep their order");
assert.ok(rows.every((r) => typeof r.key === "string" && r.key.length > 0 && typeof r.parent_key === "string"), "every row has a key and a parent (empty when none)");
assert.equal(new Set(rows.map((r) => r.kind + "|" + r.parent_key + "|" + r.key)).size, rows.length, "rows are unique by kind, parent and key");
assert.ok(isUsableCatalog(DEFAULT_CATALOG) && !isUsableCatalog({ brands: [] }), "usability check");
close(computePrice(trim, DEFAULT_PRICE_LIST, DEFAULT_COIL_WIDTH_SCALE, "tier1", catalogFromRows(rows)), price(trim, "tier1"), "pricing from rows equals pricing from the default");

// A shop's selection over the platform catalog: switched-off brands, colors and profiles leave
// the pickers but still resolve for old orders; the shop's own paint line and profile price
// like platform ones; retired items stay resolvable; the server refuses what is not offered.
const selection = {
  brands: { Berridge: false },
  colors: { "Una-Clad": { Brandywine: false } },
  materials: { Bonderized: false },
  profiles: { 'US-150 – 1.5" Mechanical Seam': false },
  custom: {
    brands: [{ name: "B Select", base: "painted-steel", paints: ["pvdf", "smp"], gauges: ["24ga", "26ga"], colors: [{ name: "B Bronze", hex: "#4A3E36" }, { name: "B Slate", hex: "#565B5E", premium: true }] },
             { name: "B Kynar Only", base: "painted-steel", paints: ["pvdf"], gauges: ["24ga"], colors: [{ name: "B White", hex: "#EEEEEE" }] }],
    profiles: [{ name: 'B-150 – 1.5" Snap-Lock', code: "B150", family: "snap", takeup: 4.25, desc: "the shop's own" }],
  },
  retired: { brands: [{ name: "B Old", colors: [{ name: "B Old Red", hex: "#AA0000", premium: true }] }], profiles: [{ name: "B-100 – 1\" Snap-Lock", code: "B100", family: "snap", takeup: 3 }] },
};
const shop = resolveCatalog(DEFAULT_CATALOG, selection);
assert.deepEqual(resolveCatalog(DEFAULT_CATALOG, null), DEFAULT_CATALOG, "no selection is the platform catalog");
assert.ok(!shop.brands.includes("Berridge") && shop.brands.includes("B Select") && shop.brands.includes("B Kynar Only"), "brands follow the selection");
assert.ok(!shop.unpainted.includes("Bonderized") && shop.unpainted.includes("Copper"), "materials follow the selection");
assert.ok(!getColorsForBrand(shop, "Una-Clad", "pvdf").some((c) => c.name === "Brandywine"), "a switched-off color leaves the picker");
assert.equal(findColor(shop, "Brandywine", "Una-Clad", "pvdf")?.hex, "#6E2F28", "but still resolves");
assert.equal(findColor(shop, "Buckskin", "Berridge", "pvdf")?.hex, "#8A7B65", "a switched-off brand's color still resolves");
assert.equal(findColor(shop, "B Old Red", "B Old", "pvdf")?.premium, true, "a retired brand's color still resolves");
assert.ok(!shop.brands.includes("B Old"), "a retired brand is not offered");
assert.ok(!listedProfiles(shop).includes('US-150 – 1.5" Mechanical Seam') && shop.profiles['US-150 – 1.5" Mechanical Seam'].takeup === 4.5, "a switched-off profile leaves the pickers but keeps its takeup");
assert.ok(listedProfiles(shop).includes('B-150 – 1.5" Snap-Lock') && shop.profiles['B-150 – 1.5" Snap-Lock'].vendor === "shop", "the shop's own profile is listed");
assert.ok(!listedProfiles(shop).includes('B-100 – 1" Snap-Lock') && shop.profiles['B-100 – 1" Snap-Lock'].retired, "a retired profile still resolves");
assert.deepEqual(shop.rules.pvdfOnly.filter((b) => b.startsWith("B ")), [], "two paints and two gauges: no rule");
assert.deepEqual(shop.rules.pvdf24gaOnly.filter((b) => b.startsWith("B ")), ["B Kynar Only"], "PVDF and 24 ga only: the Berridge-style rule");
assert.equal(findGauge(shop, "24ga", "B Select").trimFt, 2.75, "a painted paint line prices from the painted gauge table");
const ownTrim = { ...trim, brand: "B Select", colorName: "B Slate" };
close(computePrice(ownTrim, DEFAULT_PRICE_LIST, DEFAULT_COIL_WIDTH_SCALE, "tier2", shop), computePrice({ ...trim, colorName: "Burnished Slate" }, DEFAULT_PRICE_LIST, DEFAULT_COIL_WIDTH_SCALE, "tier2", DEFAULT_CATALOG), "a premium color of the shop's own line prices like a platform premium color");
assert.ok(computePrice(ownTrim, DEFAULT_PRICE_LIST, DEFAULT_COIL_WIDTH_SCALE, "tier2", shop) > computePrice({ ...ownTrim, colorName: "B Bronze" }, DEFAULT_PRICE_LIST, DEFAULT_COIL_WIDTH_SCALE, "tier2", shop), "and more than its standard color");
const ownPanel = { ...panel, profile: 'B-150 – 1.5" Snap-Lock' };
const withRow = [...DEFAULT_PRICE_LIST, { id: "pb150", category: "Roof Panel", name: "B-150 Fabrication (per linear ft)", cost: 0, tier1: 2.5, tier2: 2.5, greenleaf: 2.5 }];
assert.ok(computePrice(ownPanel, withRow, DEFAULT_COIL_WIDTH_SCALE, "tier2", shop) > computePrice(ownPanel, DEFAULT_PRICE_LIST, DEFAULT_COIL_WIDTH_SCALE, "tier2", shop), "the shop's own profile picks up the fabrication row named after its first word, like the platform's");
assert.ok(isOffered(shop, trim).ok, "a platform item the shop kept is offered");
assert.ok(!isOffered(shop, { ...trim, brand: "Berridge", colorName: "Buckskin" }).ok, "a switched-off brand is refused");
assert.ok(!isOffered(shop, { ...trim, brand: "Una-Clad", colorName: "Brandywine" }).ok, "a switched-off color is refused");
assert.ok(isOffered(shop, ownTrim).ok && isOffered(shop, ownPanel).ok, "the shop's own line and profile are offered");
assert.ok(!isOffered(DEFAULT_CATALOG, ownPanel).ok, "the shop's own profile is not offered at a shop without it");
assert.ok(!isOffered(shop, { ...panel, profile: 'US-150 – 1.5" Mechanical Seam' }).ok, "a switched-off profile is refused");
assert.ok(!isOffered(shop, { ...trim, brand: "Bonderized", colorName: "Bonderized (Mill Finish)" }).ok && isOffered(shop, { ...trim, brand: "Copper", colorName: "Natural Copper (Mill Finish)" }).ok, "bare metals follow the selection");
const collide = resolveCatalog(DEFAULT_CATALOG, { custom: { brands: [{ name: "Berridge", colors: [{ name: "X", hex: "#000000" }] }], profiles: [{ name: 'SS450 – 1.5" Snap-Lock', code: "SS450", family: "snap", takeup: 1 }] } });
assert.deepEqual(collide.colors.Berridge, DEFAULT_CATALOG.colors.Berridge, "a custom item cannot shadow a platform item");
assert.equal(collide.profiles['SS450 – 1.5" Snap-Lock'].takeup, 4.125, "nor a platform profile");

console.log("pricing-check: all checks passed");
