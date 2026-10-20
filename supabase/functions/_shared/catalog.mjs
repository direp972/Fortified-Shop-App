// The catalog: the paint lines and their colors, the bare metals, the gauges and their
// fallback rates, the paint systems, the panel profiles, the clips and the accessories, as
// data. Shared by the app (src/App.jsx) and the submit-order Edge Function through
// pricing.mjs, so an order is priced against exactly the catalog the estimate used.
// DEFAULT_CATALOG is Fortified Sheet Metal's catalog as first seeded and what everything
// falls back to; docs/catalog-as-data-design.md is the plan for the platform table and the
// per-shop selection that replace it. Plain ESM with no imports: Vite bundles it into the
// app and Deno loads it as-is. Keep it that way.
//
// Names are the keys. Orders and saved jobs carry brand, colorName, gaugeId, paintId and
// profile as the strings below, so an entry is never renamed: a replacement is a new entry
// and `delisted: true` on the old one, which hides it from every picker but still resolves.

/* --------------------- paint lines, colors, bare metals, gauges, paints --------------------- */
export const GAUGE_OPTIONS = [
  { id: "24ga", label: "24 Gauge", panelSqft: 3.75, trimFt: 2.75 },
  { id: "26ga", label: "26 Gauge", panelSqft: 3.00, trimFt: 2.20 },
];

export const COPPER_WEIGHT_OPTIONS = [
  { id: "16oz", label: "16 oz Copper", panelSqft: 14.50, trimFt: 10.75 },
  { id: "20oz", label: "20 oz Copper", panelSqft: 17.75, trimFt: 13.25 },
];

export const G90_GAUGE_OPTIONS = [
  { id: "16ga", label: "16 Gauge", panelSqft: 6.25, trimFt: 4.60 },
  { id: "18ga", label: "18 Gauge", panelSqft: 5.35, trimFt: 3.95 },
  { id: "20ga", label: "20 Gauge", panelSqft: 4.55, trimFt: 3.35 },
  { id: "22ga", label: "22 Gauge", panelSqft: 4.05, trimFt: 3.00 },
  { id: "24ga", label: "24 Gauge", panelSqft: 3.35, trimFt: 2.50 },
];

export const GALVALUME_GAUGE_OPTIONS = [
  { id: "24ga", label: "24 Gauge", panelSqft: 3.45, trimFt: 2.55 },
  { id: "26ga", label: "26 Gauge", panelSqft: 2.85, trimFt: 2.10 },
];

export const BONDERIZED_GAUGE_OPTIONS = [
  { id: "24ga", label: "24 Gauge", panelSqft: 3.60, trimFt: 2.65 },
  { id: "26ga", label: "26 Gauge", panelSqft: 3.00, trimFt: 2.20 },
];

export const PAINT_OPTIONS = [
  { id: "pvdf", label: "PVDF (Kynar 500)", mult: 1.15 },
  { id: "smp", label: "40YR SMP", mult: 1.0 },
];

export const COLORS_BY_BRAND = {
  "Fortified Metal": [
    { name: "Regal White", hex: "#E3E1DC" },
    { name: "Almond", hex: "#D9C9AE" },
    { name: "Sandstone", hex: "#C7BEB0" },
    { name: "Surrey Beige", hex: "#A9906F" },
    { name: "Ash Gray", hex: "#9C9088" },
    { name: "Slate Gray", hex: "#706A66" },
    { name: "Burnished Slate", hex: "#565B5E", premium: true },
    { name: "Charcoal Gray", hex: "#55504C" },
    { name: "Medium Bronze", hex: "#4A3E36" },
    { name: "Aged Bronze", hex: "#4A3B34" },
    { name: "Mansard Brown", hex: "#3E2A24" },
    { name: "Dark Bronze", hex: "#3A322C" },
    { name: "Matte Black", hex: "#26262A" },
    { name: "Regal Blue", hex: "#1C5C7A", premium: true },
    { name: "Evergreen", hex: "#1F3D2E", premium: true },
    { name: "Copper Metallic", hex: "#A0602E", premium: true },
    { name: "Paint Grip Ultra SMP", hex: "#8B8B8B", premium: true },
    { name: "Galvalume", hex: "#D8D6D0", premium: true },
    { name: "Texas Silver Metallic", hex: "#B0B4B7", premium: true },
  ],
  "Una-Clad": [
    { name: "Stone White", hex: "#EDEBE3" },
    { name: "Bone White", hex: "#EDE8DD" },
    { name: "Almond", hex: "#D9C9A8" },
    { name: "Sandstone", hex: "#C2A97E" },
    { name: "Slate Gray", hex: "#5C6268" },
    { name: "Cityscape", hex: "#7C7F82" },
    { name: "Charcoal Gray", hex: "#4A4E52" },
    { name: "Sierra Tan", hex: "#B79A6E" },
    { name: "Medium Bronze", hex: "#5C4A38" },
    { name: "Dark Bronze", hex: "#4A3B2E" },
    { name: "Extra Dark Bronze", hex: "#332920" },
    { name: "Matte Black", hex: "#2B2B2B" },
    { name: "Mountain Black", hex: "#1E1E1E", premium: true },
    { name: "Brandywine", hex: "#6E2F28" },
    { name: "Colonial Red", hex: "#7B2B25" },
    { name: "Terra Cotta", hex: "#B5623E" },
    { name: "Mansard Brown", hex: "#4A3826" },
    { name: "Regal Red", hex: "#8C2A28", premium: true },
    { name: "Award Blue", hex: "#2E5C8C", premium: true },
    { name: "Sky Blue", hex: "#6E9FBF" },
    { name: "Electric Blue", hex: "#2A5FA8" },
    { name: "Regal Blue", hex: "#2E4A66", premium: true },
    { name: "Amazon Blue", hex: "#1F4A5C", premium: true },
    { name: "Teal", hex: "#2E6E6A", premium: true },
    { name: "Patina Green", hex: "#5C8264" },
    { name: "Dark Ivy", hex: "#2A3F2C" },
    { name: "Sherwood Green", hex: "#38513B" },
    { name: "Hartford Green", hex: "#1F3D2B", premium: true },
    { name: "Hemlock Green", hex: "#445940" },
    { name: "Tropical Patina", hex: "#4E8C74", premium: true },
    { name: "Aged Zinc", hex: "#9096A0", premium: true },
    { name: "Vintage", hex: "#8A9088", premium: true },
    { name: "Burnished Slate", hex: "#565B5E", premium: true },
    { name: "Silver Metallic", hex: "#B7BABD", premium: true },
    { name: "Classic Copper", hex: "#A05A3A", premium: true },
    { name: "Champagne Metallic", hex: "#C8B98A", premium: true },
  ],
  "Adax Metals": [
    { name: "Regal White", hex: "#E3E1DC" },
    { name: "Almond", hex: "#D9C9AE" },
    { name: "Sandstone", hex: "#C7BEB0" },
    { name: "Surrey Beige", hex: "#A9906F" },
    { name: "Ash Gray", hex: "#9C9088" },
    { name: "Slate Gray", hex: "#706A66" },
    { name: "Charcoal Gray", hex: "#55504C" },
    { name: "Medium Bronze", hex: "#4A3E36" },
    { name: "Aged Bronze", hex: "#4A3B34" },
    { name: "Mansard Brown", hex: "#3E2A24" },
    { name: "Dark Bronze", hex: "#3A322C" },
    { name: "Matte Black", hex: "#26262A" },
    { name: "Colonial Red", hex: "#7A2422", premium: true },
    { name: "Regal Blue", hex: "#1C5C7A", premium: true },
    { name: "Evergreen", hex: "#1F3D2E", premium: true },
    { name: "Copper Metallic", hex: "#A0602E", premium: true },
    { name: "Pre-Weathered Galvalume", hex: "#8B8D8A", premium: true },
    { name: "Paint Grip Ultra SMP", hex: "#8B8B8B", premium: true },
    { name: "Crimson Red SMP", hex: "#A31F1F", premium: true },
    { name: "Galvalume", hex: "#D8D6D0", premium: true },
  ],
  "Copper": [
    { name: "Natural Copper (Mill Finish)", hex: "#B87333" },
  ],
  "G90 Galvanized": [
    { name: "G90 Galvanized (Mill Finish)", hex: "#B8BCC0" },
  ],
  "Galvalume": [
    { name: "Galvalume (Mill Finish)", hex: "#C4C7C6" },
  ],
  "Bonderized": [
    { name: "Bonderized (Mill Finish)", hex: "#A8A398" },
  ],
  "Berridge": [
    // Standard Colors
    { name: "Buckskin", hex: "#8A7B65" },
    { name: "Parchment", hex: "#D9D6C9" },
    { name: "Almond", hex: "#E4E6D3" },
    { name: "Aged Bronze", hex: "#3E2E22" },
    { name: "Shasta White", hex: "#EDEDE8" },
    { name: "Forest Green", hex: "#1F4739" },
    { name: "Patina Green", hex: "#5F9384" },
    { name: "Sierra Tan", hex: "#B9AD8B" },
    { name: "Medium Bronze", hex: "#4B3A2B" },
    { name: "Charcoal Grey", hex: "#3D3D3F" },
    { name: "Hemlock Green", hex: "#5C7B6C" },
    { name: "Bristol Blue", hex: "#3A6E85" },
    { name: "Terra-Cotta", hex: "#B0562F" },
    { name: "Dark Bronze", hex: "#2E2318" },
    { name: "Zinc Grey", hex: "#75797C" },
    { name: "Hartford Green", hex: "#1D3B33" },
    { name: "Royal Blue", hex: "#1B4863" },
    { name: "Colonial Red", hex: "#7A2E2A" },
    { name: "Copper Brown", hex: "#3A2A20" },
    { name: "Matte Black", hex: "#232324" },
    { name: "Teal Green", hex: "#2E7266" },
    { name: "Burgundy", hex: "#4A1F22" },
    { name: "Deep Red", hex: "#A32030" },
    // Premium Colors
    { name: "Natural White", hex: "#F5F3EA", premium: true },
    { name: "Award Blue", hex: "#1B3E6F", premium: true },
    // Metallic Colors
    { name: "Champagne", hex: "#A99C86", premium: true },
    { name: "Copper-Cote", hex: "#B5652C", premium: true },
    { name: "Antique Copper-Cote", hex: "#8C8A6E", premium: true },
    { name: "Zinc-Cote", hex: "#8B8D8E", premium: true },
    { name: "Lead-Cote", hex: "#6E6F71", premium: true },
    { name: "Preweathered Galvalume", hex: "#8C8D8A", premium: true },
    // Natural Metal Finish
    { name: "Acrylic-Coated Galvalume", hex: "#C9CACA" },
  ],
};

export const BRAND_GROUPS = {
  Painted: ["Fortified Metal", "Una-Clad", "Adax Metals", "Berridge"],
};
export const BRANDS = [...BRAND_GROUPS.Painted]; // painted brands only — unpainted materials live in their own dropdown
export const UNPAINTED_MATERIALS = ["G90 Galvanized", "Copper", "Galvalume", "Bonderized"];
export const PVDF_24GA_ONLY_BRANDS = ["Berridge"];
export const PVDF_ONLY_BRANDS = ["Una-Clad"]; // no SMP, but any gauge is fine
export const UNPAINTED_FLATS_ONLY_BRANDS = ["G90 Galvanized"];

/* ------------------------------------- panel profiles ------------------------------------- */
export const PROFILE_INFO = {
  // Takeups (coil width − finished coverage) are NTM's published "material usage" figures,
  // taken from the official profile drawings / Material Usage Guide (verified 2026-08-19).
  // NTM marks them APPROX., measured with clip relief engaged where that's standard.
  'SS450 – 1.5" Snap-Lock': { code: "SS450", family: "snap", takeup: 4.125, desc: "Popular residential snap-lock; the clip flares over the male leg." },
  'SS150 – 1.5" Mechanical Seam': { code: "SS150", family: "mech", takeup: 4, desc: "Taller mechanical seam for added rigidity on architectural runs." },
  'SSQ200 – 2" Mechanical Seam': { code: "SSQ200", family: "mech", takeup: 5.8125, desc: "Commercial workhorse mechanical seam, rated for open-purlin spans down to 2:12 slope." },
  'SSQ675 – 1.75" Snap-Lock': { code: "SSQ675", family: "snap", takeup: 6.125, desc: "Taller snap-lock profile for a more pronounced seam line." },
  'FWQ100 – 1" Flush Wall / Soffit': { code: "FWQ100", family: "flush", takeup: 4, desc: "Flat panel with adjustable reveal for soffits, fascia, underdeck, and flush wall siding." },
  "BB750 – Board and Batten": { code: "BB750", family: "batten", takeup: 3.625, delisted: true, desc: "Vertical board-and-batten wall siding profile with a farmhouse look." },
  'SS100 – 1" Mechanical Seam': { code: "SS100", family: "mech", takeup: 3, desc: "Low-profile double-lock mechanical seam. 28–22 ga. steel, aluminum, or copper." },
  'SSQ210A – 2" ARMCO Mechanical Seam': { code: "SSQ210A", family: "mecharmco", takeup: 6.125, delisted: true, desc: "SSQ200 seam plus an extra down leg for added strength in high-wind, severe-weather markets." },
  'SSQ550 – 1.5" Snap-Lock': { code: "SSQ550", family: "snap", takeup: 5.125, delisted: true, desc: "1.5\" snap-lock, alternate roller set." },
  'TRQ250 – 2.5" Mechanical Seam Trapezoid': { code: "TRQ250", family: "trapezoid", takeup: 5.625, delisted: true, desc: "Tallest seam in the lineup, with an anti-capillary leg for commercial/industrial roofs." },
  'SS450SL – 1.5" Snap-Lock': { code: "SS450SL", family: "snapbump", takeup: 4.375, delisted: true, desc: "Same profile as SS450 with a self-locking bump on the male leg." },
  'FF100 – 1" Snap-Lock, Slotted Flange': { code: "FF100", family: "flange", takeup: 4.0625, desc: "Fastened through a flange on the male leg, then the female leg snaps over it — no clips." },
  'FF150 – 1.5" Snap-Lock, Slotted Flange': { code: "FF150", family: "flange", takeup: 5.3125, delisted: true, desc: "Taller fastener-flange snap-lock, no clips required." },
  'SSQ275 – 2" Snap-Lock / Mech. Seam': { code: "SSQ275", family: "newlock", takeup: 6.5, delisted: true, desc: "Proprietary two-in-one profile — install as snap-lock, seam it later if the job calls for it." },
  // Adax Metals (Weatherford, TX) — licensed Ultra Seam profiles they roll in-house.
  // vendor: "adax" routes these into the Adax section of the panel catalog; entries
  // without a vendor field are the New Tech Machinery profiles above. Ultra Seam publishes NO
  // coil-width/material-usage specs (checked every data sheet 2026-08-19), so these
  // takeups are estimates borrowed from the equivalent NTM seam geometry above —
  // replace with Adax's real numbers when the shop gets them.
  'US-100CS – 1" Snap-On Cap Seam': { code: "US-100CS", family: "batten", takeup: 3, vendor: "adax", delisted: true, desc: 'Snap-on cap over a 1" seam; 12–20" pan widths, flat or striated.' },
  'US-100NS – 1" Nail Strip': { code: "US-100NS", family: "flange", takeup: 3, vendor: "adax", desc: 'Fastener-flange nail strip for roof or siding; Class 4 hail rated.' },
  'US-150 – 1.5" Mechanical Seam': { code: "US-150", family: "mech", takeup: 4.5, vendor: "adax", desc: 'Single- or double-lock mechanical seam; UL-90, curved version available.' },
  'US-150LS – 1.5" Snap-Lock': { code: "US-150LS", family: "snap", takeup: 4.5, vendor: "adax", desc: "Lok-Seam snap-together — no field seaming; HVHZ approved, Class 4 hail." },
  'US-175LS – 1.75" Snap-Lock': { code: "US-175LS", family: "snap", takeup: 4.375, vendor: "adax", desc: "Taller Lok-Seam snap-lock with concealed clips; UL-90, Class A fire." },
  'US-200 – 2" Mechanical Seam': { code: "US-200", family: "mech", takeup: 6, vendor: "adax", desc: 'Heavy 2" mechanical seam for long, low-slope commercial runs; UL-90.' },
  'US-200SB – 2" Seam + Snap-On Batten': { code: "US-200SB", family: "batten", takeup: 6, vendor: "adax", delisted: true, desc: "US-200 pan with a decorative snap-on batten cap over the seam." },
  'US-100FP – 1" Flush Wall / Soffit': { code: "US-100FP", family: "flush", takeup: 4, vendor: "adax", desc: "Flush wall and soffit panel; plain, beaded, or vented versions." },
};
// Delisted profiles stay in PROFILE_INFO so old orders and vault items still
// render and reprice, but they're hidden from every picker and the catalog.
export const PROFILES = Object.keys(PROFILE_INFO).filter((k) => !PROFILE_INFO[k].delisted);

// Fixed-clip part numbers by panel profile — clips sell by the box.
export const CLIP_SPECS = {
  SS100: { code: "FG-100-24", perBox: 1000 },    // 1" mechanical seam
  SS150: { code: "FG-158-24", perBox: 500 },     // 1.5" mechanical seam
  SSQ200: { code: "FG-218-24", perBox: 300 },    // 2" mechanical seam
  SS450: { code: "SG-114-24-SL", perBox: 800 },  // 1.5" snap-lock
  SSQ675: { code: "SG-178-18", perBox: 500 },    // 1.75" snap-lock
};

/* -------------------------------------- accessories -------------------------------------- */
export const ACCESSORY_TYPES = ["Screws", "Butyl Tape", "Pipe Boots", "Sealant", "Clips"];
export const DRY_IN_TYPES = ["Underlayment", "Cap Nails", "High Temp Ice & Water"];
export const ACCESSORY_SPECS = {
  Screws: ['1" XLP Screws', "DP1 Screws", "DP3 Screws"],
  "Butyl Tape": ['1" Butyl Tape', '3/8" Butyl Tape'],
  "Pipe Boots": ['1"', '1.5"', '2"', '3"', '4"', '5"', '6"', '7"', '8"'],
  Underlayment: ['Synthetic Underlayment — 42" × 1,000 sq ft roll'],
  "Cap Nails": ["Plastic Cap Nails (2,000/box)"],
  "High Temp Ice & Water": ["Palisade SA-HT — 2 sq roll"],
};

/* ------------------------------------ the catalog object ------------------------------------ */
// One object the lookups below read, so a shop's own catalog (the same shape, resolved from
// the platform table and the shop's selection) can take the default's place.
export const DEFAULT_CATALOG = {
  brands: BRANDS,
  brandGroups: BRAND_GROUPS,
  unpainted: UNPAINTED_MATERIALS,
  rules: { pvdfOnly: PVDF_ONLY_BRANDS, pvdf24gaOnly: PVDF_24GA_ONLY_BRANDS, unpaintedFlatsOnly: UNPAINTED_FLATS_ONLY_BRANDS },
  colors: COLORS_BY_BRAND,
  // keyed by bare metal; every painted brand prices from the painted gauge table
  gauges: { painted: GAUGE_OPTIONS, Copper: COPPER_WEIGHT_OPTIONS, "G90 Galvanized": G90_GAUGE_OPTIONS, Galvalume: GALVALUME_GAUGE_OPTIONS, Bonderized: BONDERIZED_GAUGE_OPTIONS },
  paints: PAINT_OPTIONS,
  profiles: PROFILE_INFO,
  clips: CLIP_SPECS,
  accessories: { types: ACCESSORY_TYPES, dryIn: DRY_IN_TYPES, specs: ACCESSORY_SPECS },
};

/* ------------------------------------------ lookups ------------------------------------------ */
// Most brands have one flat color list. Some (Quality Metals, currently delisted) have
// different palettes for PVDF vs SMP, stored as { pvdf: [...], smp: [...] } instead —
// this always returns a flat array either way.
export function getColorsForBrand(catalog, brand, paintId) {
  const entry = catalog.colors[brand];
  if (!entry) return [];
  if (Array.isArray(entry)) return entry;
  return entry[paintId] || entry.pvdf || entry.smp || [];
}

export function findColor(catalog, name, brand, paintId) {
  const preferred = getColorsForBrand(catalog, brand, paintId).find((c) => c.name === name);
  if (preferred) return preferred;
  for (const entry of Object.values(catalog.colors)) {
    const lists = Array.isArray(entry) ? [entry] : Object.values(entry);
    for (const list of lists) {
      const hit = list.find((c) => c.name === name);
      if (hit) return hit;
    }
  }
  return null;
}

// Gauge IDs (e.g. "24ga") are reused across different material option sets with different
// prices, so lookup has to pick the right set by brand FIRST, then find within it — a plain
// id-only search would silently match the wrong table.
export function findGauge(catalog, gaugeId, brand) {
  const set = catalog.gauges[brand] || catalog.gauges.painted;
  return set.find((g) => g.id === gaugeId) || set[0] || catalog.gauges.painted[0];
}

// Delisted profiles stay in the catalog so old orders and vault items still render and
// reprice, but they're hidden from every picker and the catalog page.
export const listedProfiles = (catalog) => Object.keys(catalog.profiles).filter((k) => !catalog.profiles[k].delisted);
export const profileInfo = (catalog, profile) => catalog.profiles[profile] || null;
export const profileFamily = (catalog, profile) => catalog.profiles[profile]?.family || "mech";
export const clipSpecForProfile = (catalog, profile) => catalog.clips[catalog.profiles[profile]?.code] || null;

/* ------------------------------------ rows and back ------------------------------------ */
// The platform table (public.catalog_items) holds this same catalog as rows: one per brand,
// bare metal, color, gauge, paint, profile, clip and accessory, with parent_key tying a
// color to its brand, a gauge to its table and an accessory spec to its type ('' when there
// is no parent). catalogToRows writes the seed migration; catalogFromRows rebuilds the
// object the lookups read. They are inverses: pricing-check asserts that
// catalogFromRows(catalogToRows(DEFAULT_CATALOG)) deep-equals DEFAULT_CATALOG, whatever
// order the rows come back in. sort keeps every list in its original order, and the order
// of the color and gauge groups too, because findColor's search across brands follows it.
export const CATALOG_KINDS = ["brand", "material", "color", "gauge", "paint", "profile", "clip", "accessory"];

export function catalogToRows(catalog) {
  const rows = [];
  const push = (kind, parent_key, key, data, sort, delisted = false) => rows.push({ kind, parent_key, key, data, sort, delisted });
  catalog.brands.forEach((b, i) => push("brand", "", b, { pvdfOnly: catalog.rules.pvdfOnly.includes(b), pvdf24gaOnly: catalog.rules.pvdf24gaOnly.includes(b) }, i));
  catalog.unpainted.forEach((m, i) => push("material", "", m, { flatsOnly: catalog.rules.unpaintedFlatsOnly.includes(m) }, i));
  Object.entries(catalog.colors).forEach(([group, entry], gi) => {
    const list = Array.isArray(entry) ? entry : [...(entry.pvdf || []), ...(entry.smp || [])];
    list.forEach((c, i) => push("color", group, c.name, { hex: c.hex, ...(c.premium ? { premium: true } : {}) }, gi * 1000 + i));
  });
  Object.entries(catalog.gauges).forEach(([set, list], gi) => list.forEach((g, i) => push("gauge", set, g.id, { label: g.label, panelSqft: g.panelSqft, trimFt: g.trimFt }, gi * 100 + i)));
  catalog.paints.forEach((p, i) => push("paint", "", p.id, { label: p.label, mult: p.mult }, i));
  Object.entries(catalog.profiles).forEach(([name, p], i) => { const { delisted, ...rest } = p; push("profile", "", name, rest, i, !!delisted); });
  Object.entries(catalog.clips).forEach(([code, c], i) => push("clip", "", code, { code: c.code, perBox: c.perBox }, i));
  catalog.accessories.types.forEach((t, i) => push("accessory", "", t, { dryIn: false }, i));
  catalog.accessories.dryIn.forEach((t, i) => push("accessory", "", t, { dryIn: true }, 100 + i));
  Object.entries(catalog.accessories.specs).forEach(([type, specs], gi) => specs.forEach((s, i) => push("accessory", type, s, {}, gi * 100 + i)));
  return rows;
}

export function catalogFromRows(rows) {
  const by = (kind) => rows.filter((r) => r.kind === kind).sort((a, b) => a.sort - b.sort);
  const parent = (r) => (r.parent_key == null ? "" : r.parent_key);
  const brandRows = by("brand");
  const brands = brandRows.map((r) => r.key);
  const materialRows = by("material");
  const rules = {
    pvdfOnly: brandRows.filter((r) => r.data?.pvdfOnly).map((r) => r.key),
    pvdf24gaOnly: brandRows.filter((r) => r.data?.pvdf24gaOnly).map((r) => r.key),
    unpaintedFlatsOnly: materialRows.filter((r) => r.data?.flatsOnly).map((r) => r.key),
  };
  const colors = {};
  for (const r of by("color")) (colors[parent(r)] ||= []).push({ name: r.key, hex: r.data?.hex, ...(r.data?.premium ? { premium: true } : {}) });
  const gauges = {};
  for (const r of by("gauge")) (gauges[parent(r)] ||= []).push({ id: r.key, label: r.data?.label, panelSqft: r.data?.panelSqft, trimFt: r.data?.trimFt });
  const paints = by("paint").map((r) => ({ id: r.key, label: r.data?.label, mult: r.data?.mult }));
  const profiles = {};
  for (const r of by("profile")) profiles[r.key] = { ...(r.data || {}), ...(r.delisted ? { delisted: true } : {}) };
  const clips = {};
  for (const r of by("clip")) clips[r.key] = { code: r.data?.code, perBox: r.data?.perBox };
  const accessoryRows = by("accessory");
  const types = accessoryRows.filter((r) => !parent(r) && !r.data?.dryIn).map((r) => r.key);
  const dryIn = accessoryRows.filter((r) => !parent(r) && r.data?.dryIn).map((r) => r.key);
  const specs = {};
  for (const r of accessoryRows.filter((r) => parent(r))) (specs[parent(r)] ||= []).push(r.key);
  return { brands, brandGroups: { Painted: brands }, unpainted: materialRows.map((r) => r.key), rules, colors, gauges, paints, profiles, clips, accessories: { types, dryIn, specs } };
}

// What pricing and the pickers cannot do without; a table that lacks any of it is not
// used, and the caller keeps DEFAULT_CATALOG.
export function isUsableCatalog(c) {
  return !!c && Array.isArray(c.brands) && c.brands.length > 0 && Array.isArray(c.paints) && c.paints.length > 0
    && Array.isArray(c.gauges?.painted) && c.gauges.painted.length > 0 && !!c.profiles && Object.keys(c.profiles).length > 0 && !!c.colors && Object.keys(c.colors).length > 0;
}
