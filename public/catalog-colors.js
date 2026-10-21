/* The platform catalog's colors, for the public pages and the build.
   One read of public.catalog_items (everyone may read it; the shop app sells from the same
   rows) so the swatches on home, members and the directory are the catalog's and never
   drift from it — step 4 of docs/catalog-as-data-design.md.

   Browser: <script src="/catalog-colors.js"></script>, then rcCatalogColors() resolves to
   the index below, or to null when the table is unreachable (each page degrades on its
   own: no chips, gray dots). Build: scripts/prerender.mjs imports this same file and calls
   rcCatalogColorsFromRows() on the rows it fetched, or on the code default.

   The index: { brands, unpainted, groups: { [paint line or bare metal]: [{ name, hex,
   premium }] }, names (every listed painted color once), hexOf(name, fallback) }. Listed
   means not delisted, on a paint line or bare metal that is not delisted. hexOf answers
   for every row, delisted or not, because a directory listing names the colors it carries
   in its own words: a delisted color keeps its hex the way a delisted profile keeps its
   takeup. The match ignores case, spaces and punctuation; ALIASES maps the directory's
   short names onto the catalog's keys; LEGACY carries the directory's Adax Metals palette,
   which the catalog does not hold yet — add those colors in Backend → Platform catalog
   and this map can go. */
(function (root) {
  const SUPA = "https://znueitseoqijhkkvdomc.supabase.co";
  const KEY = "sb_publishable_R7JBgFijjjXcYJaggpx-og_Qn4iGdAB";
  const ALIASES = { "charcoal": "Charcoal Gray", "texas silver": "Texas Silver Metallic", "bare copper": "Natural Copper (Mill Finish)", "bonderized": "Bonderized (Mill Finish)", "paintgrip ultra": "Paint Grip Ultra SMP", "acrylic galvalume": "Acrylic-Coated Galvalume", "preweather galvalume": "Preweathered Galvalume" };
  const LEGACY = { "Artic White": "#EDEEEA", "Berry": "#7E3B47", "Black Crinkle": "#2A2A2C", "Brownstone": "#6B5A4E", "Burnished Slate Crinkle": "#52575A", "Charcoal Blue Gray": "#4C555E", "Charcoal Gray Crinkle": "#514D49", "Charcoal Gray II": "#5A5652", "Colony Green": "#2E4A3A", "Crimson Red": "#7E2A33", "Dark Red": "#6E1F1F", "Desert Sand": "#C9B597", "Evergreen Crinkle": "#23422F", "Fern Green": "#4A6B45", "Gallery Blue": "#2E4A68", "Hawaiian Blue": "#4A7B96", "Ivory": "#E9E2CE", "Ivy Green": "#3A5A40", "Koko Crinkle": "#4A3B31", "Light Stone": "#D4CBB4", "Old Town Gray": "#8C8A84", "Polar White": "#EFEFEA", "Roman Blue": "#33586E", "Rural Red": "#7C3030", "Rustic Red": "#6E3226", "Rustic Red Crinkle": "#6A3024", "Saddle Tan": "#A87F52", "Silver": "#B9BCBE", "Snow White": "#F2F2EF", "Taupe": "#8A7A6A", "Tundra": "#7A7E6F" };
  const GRAY = "#8A94A6";
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const norm = function (s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, ""); };
  const legacy = {};
  for (const k in LEGACY) legacy[norm(k)] = LEGACY[k];

  function fromRows(rows) {
    const by = function (kind) { return rows.filter(function (r) { return r && r.kind === kind; }).sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }); };
    const listed = function (r) { return !r.delisted; };
    const brands = by("brand").filter(listed).map(function (r) { return r.key; });
    const unpainted = by("material").filter(listed).map(function (r) { return r.key; });
    const on = {};
    brands.concat(unpainted).forEach(function (g) { on[g] = true; });
    const groups = {}, hex = {}, names = [];
    by("color").forEach(function (r) {
      const group = r.parent_key || "";
      const h = r.data && HEX.test(r.data.hex || "") ? r.data.hex.toUpperCase() : GRAY;
      const c = { name: r.key, hex: h, premium: !!(r.data && r.data.premium) };
      const n = norm(c.name);
      if (!(n in hex)) hex[n] = h; // the first row by sort wins, the first paint line's shade, as findColor's search does
      if (r.delisted || !on[group]) return;
      (groups[group] = groups[group] || []).push(c);
      if (on[group] && brands.indexOf(group) >= 0 && names.indexOf(c.name) < 0) names.push(c.name);
    });
    const hexOf = function (name, fallback) {
      const k = norm(name);
      const alias = ALIASES[String(name == null ? "" : name).toLowerCase().trim()];
      return hex[k] || (alias && hex[norm(alias)]) || legacy[k] || (fallback === undefined ? GRAY : fallback);
    };
    return { brands: brands, unpainted: unpainted, groups: groups, names: names, hexOf: hexOf };
  }

  let shared = null;
  function load(opts) {
    if (shared && !opts) return shared;
    const p = (async function () {
      try {
        const base = (opts && opts.url) || SUPA, key = (opts && opts.key) || KEY;
        const r = await fetch(base + "/rest/v1/catalog_items?select=kind,parent_key,key,data,sort,delisted&kind=in.(brand,material,color)&order=sort.asc&limit=2000", { headers: { apikey: key } });
        if (!r.ok) return null;
        const rows = await r.json();
        return Array.isArray(rows) && rows.some(function (x) { return x && x.kind === "color"; }) ? fromRows(rows) : null;
      } catch (e) { return null; }
    })();
    if (!opts) shared = p;
    return p;
  }
  root.rcCatalogColors = load;
  root.rcCatalogColorsFromRows = fromRows;
})(typeof window !== "undefined" ? window : globalThis);
