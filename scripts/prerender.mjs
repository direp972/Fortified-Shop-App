// Pre-renders the supplier directory so search engines and AI crawlers can read it.
//
// Runs after `vite build` (see package.json). Reads every live row from
// public.directory_listings and writes into the build output:
//   dist/suppliers/<slug>/index.html   one page per listed shop, with LocalBusiness schema
//   dist/suppliers.html                the directory with every card already in the HTML
//                                      (the page's own script still filters, sorts and
//                                      adds anything published since this build)
//   dist/sitemap.xml                   every public page plus the supplier pages
//   dist/llms.txt                      a plain-text map of the site for AI assistants
//
// Listing text is applicant-submitted: everything is escaped, and every URL passes the
// same gates the directory page applies before it becomes an href.
//
// Local preview without database access: LISTINGS_FIXTURE=/path/rows.json node scripts/prerender.mjs
// A failed fetch fails the build on purpose — the previous deploy stays live instead of
// shipping a directory with no shops in it.
import { promises as fs } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.env.OUT_DIR || path.join(ROOT, "dist"));
const SITE = "https://www.roofcoil.com";
const SUPA = process.env.VITE_SUPABASE_URL || "https://znueitseoqijhkkvdomc.supabase.co";
const KEY = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_R7JBgFijjjXcYJaggpx-og_Qn4iGdAB";

/* ── taxonomy (kept in lock-step with get-listed / suppliers / directory-admin) ── */
const COIL = ["Coil & flat sheet", "Painted coil — PVDF / Kynar", "Painted coil — SMP", "Bare — Galvalume · G90 · bonderized", "Copper"];
const STANDING_SEAM = ["1″ mechanical lock", "1.5″ snap-lock", "1.75″ snap-lock", "1.5″ mechanical lock (single)", "1.5″ mechanical lock (double)", "2″ mechanical lock", "1″ nail strip", "1.5″ nail strip", "T-panel (138T)", "T-panel (238T)", "Batten seam", "2.5″ trapezoidal", "3″ trapezoidal structural", "Flush wall & soffit", "Board & batten"];
const EF_PANELS = ["R-panel / PBR", "7.2 panel (structural rib)", "7/8″ corrugated", "1/2″ corrugated (low-profile)", "5V-crimp", "Ag panel / tuff rib", "U-panel / PBU", "M-panel / box-rib (wall)"];
// "U-panel" was renamed "U-panel / PBU" after shops were listed — rows still carrying
// the old spelling render and group under the new canonical.
const RENAMED_ABILITIES = { "u-panel": "U-panel / PBU", "u panel": "U-panel / PBU", "pbu-panel": "U-panel / PBU", "pbu panel": "U-panel / PBU" };
const canonAbility = (a) => RENAMED_ABILITIES[String(a ?? "").trim().toLowerCase()] || a;
const EXPOSED = ["Exposed fastener", ...EF_PANELS];
const TRIM = ["Trim & flashing", "3D parts — boxes · scuppers · caps"];
const GUTTER_PROFILES = ["5″ K-style gutter", "6″ K-style gutter", "7″ K-style gutter", "5″ half-round gutter", "6″ half-round gutter", "6″ box gutter", "7″ box gutter", "8″ box gutter", "6″ euro box gutter", "Fascia gutter", "Straight-face / square gutter"];
const GUTTER_MATERIALS = ["Gutter — .027 aluminum", "Gutter — .032 aluminum", "Gutter — 26 ga painted steel", "Gutter — 24 ga painted steel", "Gutter — galvalume", "Gutter — galvanized / bonderized (paint-grip)", "Gutter — copper (16 / 20 oz)"];
const SERVICES = ["On-site roll forming", "On-site gutter roll forming", "Turnkey — supply · fabrication · labor"];
const GROUPS = [
  ["Standing seam panels", STANDING_SEAM],
  ["Exposed fastener panels", EXPOSED],
  ["Coil & flat sheet", COIL],
  ["Trim & 3D parts", TRIM],
  ["Roll-formed gutters", GUTTER_PROFILES],
  ["Gutter materials", GUTTER_MATERIALS],
  ["Services", SERVICES],
];
const COLOR_HEX = { "Regal White": "#E3E1DC", "Almond": "#D9C9AE", "Ash Gray": "#9C9088", "Slate Gray": "#706A66", "Burnished Slate": "#565B5E", "Charcoal": "#55504C", "Medium Bronze": "#4A3E36", "Dark Bronze": "#3A322C", "Matte Black": "#26262A", "Evergreen": "#1F3D2E", "Copper Metallic": "#A0602E", "Galvalume": "#D8D6D0", "Texas Silver": "#B0B4B7", "Bare Copper": "#B87333", "Bonderized": "#7E837F", "Acrylic Coated Galvalume": "#D8D6D0", "Aged Bronze": "#5A4E42", "Brandy Wine": "#722F37", "Brownstone": "#6B5A4E", "Buckskin": "#B49877", "Champagne": "#CBB58C", "Charcoal Gray": "#55504C", "Colonial Red": "#7A2422", "Forest Green": "#21402B", "Hartford Green": "#1E3A2A", "Hemlock Green": "#4E5B4A", "Mansard Brown": "#3E2A24", "Patina Green": "#4E8C74", "Preweather Galvalume": "#8E9494", "Regal Blue": "#1C5C7A", "Regal Red": "#8C2B2B", "Roman Blue": "#33586E", "Sandstone": "#C7BEB0", "Silver": "#B9BCBE", "Snow White": "#F2F2EF", "Surrey Beige": "#A9906F", "Terracotta": "#B5623E", "Tundra": "#7A7E6F", "Acrylic Galvalume": "#D8D6D0", "Artic White": "#EDEEEA", "Berry": "#7E3B47", "Black Crinkle": "#2A2A2C", "Bone White": "#E8E4D8", "Burnished Slate Crinkle": "#52575A", "Charcoal Blue Gray": "#4C555E", "Charcoal Gray Crinkle": "#514D49", "Charcoal Gray II": "#5A5652", "Colony Green": "#2E4A3A", "Crimson Red": "#7E2A33", "Dark Red": "#6E1F1F", "Desert Sand": "#C9B597", "Evergreen Crinkle": "#23422F", "Fern Green": "#4A6B45", "Gallery Blue": "#2E4A68", "Hawaiian Blue": "#4A7B96", "Ivory": "#E9E2CE", "Ivy Green": "#3A5A40", "Koko Crinkle": "#4A3B31", "Light Stone": "#D4CBB4", "Old Town Gray": "#8C8A84", "Polar White": "#EFEFEA", "Rural Red": "#7C3030", "Rustic Red": "#6E3226", "Rustic Red Crinkle": "#6A3024", "Saddle Tan": "#A87F52", "Taupe": "#8A7A6A" };

/* ── helpers ─────────────────────────────────────────────────────────────── */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const attr = esc;
const clean = (s) => String(s ?? "").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();
const slugify = (s) => String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "shop";
function safeUrl(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:" ? u.href : null; } catch { return null; }
}
function mapsUrl(raw) {
  const s = safeUrl(raw); if (!s) return null;
  try {
    const u = new URL(s); const h = u.hostname.toLowerCase();
    if (h === "maps.app.goo.gl" || h === "g.page" || h === "share.google") return u.href;
    if (h === "maps.google.com" && (u.pathname === "/" || u.pathname.startsWith("/maps"))) return u.href;
    if ((h === "google.com" || h === "www.google.com") && u.pathname.startsWith("/maps")) return u.href;
    if (h === "goo.gl" && u.pathname.startsWith("/maps")) return u.href;
    if (h === "g.co" && u.pathname.startsWith("/kgs")) return u.href;
    return null;
  } catch { return null; }
}
const phoneDisplay = (p) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : clean(p); };
const phoneHref = (p) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length === 10 ? `tel:+1${d}` : d.length === 11 && d[0] === "1" ? `tel:+${d}` : null; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const isFinite2 = (n) => typeof n === "number" && Number.isFinite(n);
const trimTo = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…");
const titleCaseCity = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
function splitCity(city) {
  const c = clean(city); const i = c.indexOf(",");
  if (i < 0) return { locality: titleCaseCity(c), region: "" };
  return { locality: titleCaseCity(c.slice(0, i).trim()), region: c.slice(i + 1).trim().replace(/\b([a-z])/g, (m) => m.toUpperCase()) };
}
function gitDate(rel) {
  try { const d = execSync(`git log -1 --format=%cI -- "${rel}"`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); return d || null; } catch { return null; }
}
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);

/* ── data ─────────────────────────────────────────────────────────────────── */
async function loadListings() {
  if (process.env.LISTINGS_FIXTURE) {
    console.log("prerender: using fixture", process.env.LISTINGS_FIXTURE);
    return JSON.parse(await fs.readFile(process.env.LISTINGS_FIXTURE, "utf8"));
  }
  const cols = "id,name,badges,address,city,area_keywords,lat,lng,locations,abilities,colors,coil_desc,fab_desc,website,phone,photos,logo_url,logo_bg,licensed_states,featured,gmaps_url,updated_at,created_at";
  const r = await fetch(`${SUPA}/rest/v1/directory_listings?select=${cols}&status=eq.live&order=featured.desc,name.asc`, { headers: { apikey: KEY } });
  if (!r.ok) throw new Error(`directory_listings fetch failed: HTTP ${r.status}`);
  return r.json();
}

function normalize(rows) {
  const used = new Map();
  return rows
    .filter((l) => l && typeof l.name === "string" && l.name.trim())
    .map((l) => {
      const name = clean(l.name);
      let slug = slugify(name);
      if (used.has(slug)) slug = `${slug}-${String(l.id || "").slice(0, 6) || used.get(slug) + 1}`;
      used.set(slug, 1);
      const locs = (Array.isArray(l.locations) ? l.locations : [])
        .filter((x) => x && (x.city || x.address))
        .map((x) => ({ address: clean(x.address), city: clean(x.city), lat: isFinite2(x.lat) ? x.lat : null, lng: isFinite2(x.lng) ? x.lng : null, abilities: Array.isArray(x.abilities) && x.abilities.length ? x.abilities.map((a) => canonAbility(clean(a))) : null }));
      if (!locs.length && (l.city || l.address)) locs.push({ address: clean(l.address), city: clean(l.city), lat: isFinite2(l.lat) ? l.lat : null, lng: isFinite2(l.lng) ? l.lng : null, abilities: null });
      const website = safeUrl(l.website);
      const photos = (Array.isArray(l.photos) ? l.photos : []).map(safeUrl).filter(Boolean).slice(0, 6);
      return {
        id: l.id, name, slug, url: `${SITE}/suppliers/${slug}`, path: `/suppliers/${slug}`,
        badges: Array.isArray(l.badges) ? l.badges : [],
        featured: !!l.featured,
        address: clean(l.address), city: clean(l.city),
        area: clean(l.area_keywords),
        lat: isFinite2(l.lat) ? l.lat : null, lng: isFinite2(l.lng) ? l.lng : null,
        locs,
        abilities: (Array.isArray(l.abilities) ? l.abilities : []).map((a) => canonAbility(clean(a))).filter(Boolean),
        colors: (Array.isArray(l.colors) ? l.colors : []).map(clean).filter(Boolean),
        coil: clean(l.coil_desc), fab: clean(l.fab_desc),
        website, host: website ? hostOf(website) : "",
        phone: clean(l.phone), photos,
        logo: safeUrl(l.logo_url), logoBg: /^#[0-9a-fA-F]{3,8}$/.test(l.logo_bg || "") ? l.logo_bg : null,
        licensed: clean(l.licensed_states), maps: mapsUrl(l.gmaps_url),
        updated: l.updated_at || l.created_at || null,
      };
    });
}

/* ── shared chrome ────────────────────────────────────────────────────────── */
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
<script src="/auth.js" defer></script>
<script defer src="/_vercel/insights/script.js"></script>`;
const NAV = (tag) => `<a class="ribbon" href="/get-listed.html"><b>Suppliers &amp; fabricators</b><span>Get your shop listed &mdash; free</span><i>&rarr;</i></a>
<header class="nav"><div class="nav-in">
  <a class="brand" href="/"><b>Roof<i>Coil</i></b><span>${esc(tag)}</span></a>
  <nav class="nav-links">
    <a href="/">Home</a>
    <a href="/panels">Panels</a>
    <a href="/articles/">Resources</a>
    <a href="/suppliers.html">Find a supplier</a>
    <a href="/get-listed.html">Get listed</a>
  </nav>
  <a class="nav-phone" href="tel:+19729447963">972-944-7963</a><span data-auth-slot></span>
</div></header>`;
const FOOTER = `<footer><div class="f-bot" style="flex-direction:column;gap:10px;align-items:flex-start">
  <nav style="display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12.5px">
    <a href="/panels" style="color:#CFE0EC;text-decoration:none">Metal roof panels</a>
    <a href="/sheet-metal-trim.html" style="color:#CFE0EC;text-decoration:none">Sheet metal trim</a>
    <a href="/roll-forming.html" style="color:#CFE0EC;text-decoration:none">On-site roll forming</a>
    <a href="/coil-and-flats.html" style="color:#CFE0EC;text-decoration:none">Coil &amp; flat sheet</a>
    <a href="/articles/" style="color:#CFE0EC;text-decoration:none">Resources</a>
    <a href="/suppliers.html" style="color:#CFE0EC;text-decoration:none">Find a supplier</a>
    <a href="/get-listed.html" style="color:#CFE0EC;text-decoration:none">Get listed</a>
    <a href="/members.html" style="color:#CFE0EC;text-decoration:none">Member tools</a>
  </nav>
  <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;width:100%">
    <span>© 2026 RoofCoil · <a href="tel:+19729447963" style="color:inherit;text-decoration:none">972-944-7963</a> · <a href="mailto:orders@roofcoil.com" style="color:inherit;text-decoration:none">orders@roofcoil.com</a></span>
    <span class="mono" style="letter-spacing:.12em;text-transform:uppercase">Search by ability · color · location</span>
  </div>
</div></footer>`;
const CARD_CSS = `.co{background:var(--card);border:1px solid rgba(15,61,92,.1);border-radius:12px;padding:20px 22px;margin-bottom:12px;box-shadow:var(--shadow-1)}
.co-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 14px;margin-bottom:8px}
.co-head h2{font-family:var(--disp);font-size:20px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;color:var(--ink-deep);margin:0}
.co-head h2 a{color:inherit;text-decoration:none}
.co-head h2 a:hover{color:var(--copper)}
.cobadge{font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;padding:4px 10px;border-radius:999px}
.cobadge.coil{background:linear-gradient(180deg,var(--gold-soft),var(--gold));color:var(--ink-deep)}
.cobadge.fab{background:var(--patina);color:#fff}
.cobadge.turnkey{background:#A0602E;color:#fff}
.co-head .loc{font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;color:var(--steel);margin-left:auto}
.co-head .loc .dist{color:var(--copper);font-weight:600}
.co p{margin:4px 0 0;font-size:13.5px;line-height:1.6;color:#4E6273}
.co p b{color:var(--ink-deep);font-weight:600}
.ab-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.abchip{font-family:var(--mono);font-size:10px;letter-spacing:.04em;padding:5px 11px;border-radius:999px;background:var(--paper);border:1px solid rgba(15,61,92,.14);color:#3B4E5E;text-decoration:none}
a.abchip:hover{border-color:var(--gold);color:var(--ink-deep)}
.sw-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px}
.sw-row .lbl{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--steel);margin-right:4px}
.sw-row .dot{width:18px;height:18px;border-radius:999px;border:1px solid rgba(15,61,92,.25)}
.co-logo{width:38px;height:38px;object-fit:contain;border-radius:8px;background:#fff;border:1px solid rgba(15,61,92,.12);align-self:center}
.ph-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.ph-row img{height:72px;border-radius:8px;border:1px solid rgba(15,61,92,.15);display:block;transition:transform .15s}
.ph-row a:hover img{transform:scale(1.05)}`;

const badgeHtml = (badges) => [
  badges.includes("coil") ? `<span class="cobadge coil">Supply Materials</span>` : "",
  badges.includes("fab") ? `<span class="cobadge fab">Fabrication</span>` : "",
  badges.includes("turnkey") ? `<span class="cobadge turnkey">Turnkey — supply · fab · labor</span>` : "",
].join("");
const abilityLink = (a) => `/suppliers.html?ability=${encodeURIComponent(a)}`;
const logoHtml = (l) => {
  if (!l.logo) return "";
  const bg = l.logoBg ? ` style="background:${attr(l.logoBg)};padding:4px;border-radius:8px;object-fit:contain"` : "";
  return `<img class="co-logo" src="${attr(l.logo)}" alt="" loading="lazy"${bg}>`;
};

/* ── directory card (mirrors buildCard() in suppliers.html) ───────────────── */
function cardHtml(l) {
  const area = (l.city + " " + l.area + " " + l.locs.map((x) => x.city).join(" ")).toLowerCase();
  const attrs = [
    `data-name="${attr(l.name)}"`, `data-city="${attr(l.city)}"`, `data-area="${attr(area)}"`,
    l.lat != null ? `data-lat="${l.lat}"` : "", l.lng != null ? `data-lng="${l.lng}"` : "",
    l.locs.length ? `data-locs="${attr(JSON.stringify(l.locs))}"` : "",
    `data-abilities="${attr(l.abilities.join("|"))}"`, `data-colors="${attr(l.colors.join("|"))}"`,
    l.featured ? `data-featured="1"` : "",
  ].filter(Boolean).join(" ");
  const paras = [];
  if (l.locs.length > 1) paras.push(`<p><b>Locations: </b>${l.locs.map((x) => esc(x.city || x.address) + (x.abilities ? " (" + esc(x.abilities.join(", ")) + ")" : "")).join(" · ")}</p>`);
  if (l.coil) paras.push(`<p><b>Coil line: </b>${esc(l.coil)}</p>`);
  if (l.fab) paras.push(`<p><b>Fabrication: </b>${esc(l.fab)}</p>`);
  if (l.licensed) paras.push(`<p><b>Licensed in: </b>${esc(l.licensed)}</p>`);
  const contact = [];
  if (l.website) contact.push(`<a href="${attr(l.website)}" target="_blank" rel="noopener nofollow" style="color:var(--copper);font-weight:600;text-decoration:none">${esc(l.host)}</a>`);
  if (l.maps) contact.push(`<a href="${attr(l.maps)}" target="_blank" rel="noopener nofollow" style="color:var(--copper);font-weight:600;text-decoration:none">Directions</a>`);
  if (l.phone) contact.push(esc(phoneDisplay(l.phone)));
  if (contact.length) paras.push(`<p>${contact.join(" · ")}</p>`);
  const photos = l.photos.length ? `<div class="ph-row">${l.photos.map((u) => `<a href="${attr(u)}" target="_blank" rel="noopener"><img src="${attr(u)}" loading="lazy" alt="Job photo from ${attr(l.name)}"></a>`).join("")}</div>` : "";
  const chips = `<div class="ab-row">${l.abilities.map((a) => `<span class="abchip">${esc(a)}</span>`).join("")}</div>`;
  const colors = l.colors.length ? `<div class="sw-row"><span class="lbl">${l.colors.length} colors</span>${l.colors.map((c) => `<span class="dot" title="${attr(c)}" style="background:${COLOR_HEX[c] || "#8A94A6"}"></span>`).join("")}</div>` : "";
  return `<div class="co" ${attrs}>
<div class="co-head">${logoHtml(l)}<h2><a href="${l.path}">${esc(l.name)}</a></h2>${badgeHtml(l.badges)}<span class="loc">${esc([l.address, l.city].filter(Boolean).join(" · "))}<span class="dist"></span></span></div>
${paras.join("\n")}
${photos}${chips}${colors}
</div>`;
}

/* ── supplier page ────────────────────────────────────────────────────────── */
function roleOf(l) {
  const coil = l.badges.includes("coil"), fab = l.badges.includes("fab"), tk = l.badges.includes("turnkey");
  const base = coil && fab ? "Sheet Metal Supplier & Fabricator" : fab ? "Sheet Metal Fabricator" : coil ? "Sheet Metal Supplier" : "Sheet Metal Shop";
  return tk ? base + " & Contractor" : base;
}
function descriptionOf(l) {
  const parts = [l.fab, l.coil].filter(Boolean);
  const where = l.city ? ` in ${l.city}` : "";
  let s = parts.length ? `${l.name}${where}: ${parts.join(" ")}` : `${l.name}${where} runs ${l.abilities.slice(0, 6).join(", ")}${l.abilities.length > 6 ? " and more" : ""}. Listed on RoofCoil with every ability, color and location.`;
  return trimTo(s.replace(/\s+/g, " "), 158);
}
function schemaOf(l) {
  const { locality, region } = splitCity(l.city);
  const business = {
    "@type": "LocalBusiness", "@id": `${l.url}#business`, name: l.name, url: l.website || l.url,
    telephone: phoneHref(l.phone) ? phoneHref(l.phone).slice(4) : undefined,
    image: l.photos[0] || l.logo || `${SITE}/og-card.png`,
    address: (l.address || l.city) ? { "@type": "PostalAddress", streetAddress: l.address || undefined, addressLocality: locality || undefined, addressRegion: region || undefined, addressCountry: "US" } : undefined,
    geo: l.lat != null && l.lng != null ? { "@type": "GeoCoordinates", latitude: l.lat, longitude: l.lng } : undefined,
    hasMap: l.maps || undefined,
    areaServed: l.area || undefined,
    knowsAbout: l.abilities,
    sameAs: l.website ? [l.website] : undefined,
    mainEntityOfPage: l.url,
  };
  if (l.locs.length > 1) business.location = l.locs.map((x) => { const c = splitCity(x.city); return { "@type": "Place", address: { "@type": "PostalAddress", streetAddress: x.address || undefined, addressLocality: c.locality || undefined, addressRegion: c.region || undefined, addressCountry: "US" }, geo: x.lat != null && x.lng != null ? { "@type": "GeoCoordinates", latitude: x.lat, longitude: x.lng } : undefined }; });
  const crumbs = { "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "Find a supplier", item: `${SITE}/suppliers.html` },
    { "@type": "ListItem", position: 3, name: l.name, item: l.url },
  ] };
  return JSON.stringify({ "@context": "https://schema.org", "@graph": [business, crumbs] }, (k, v) => (v === undefined ? undefined : v)).replace(/<\//g, "<\\/");
}
function supplierPage(l, all) {
  const role = roleOf(l);
  const title = `${l.name} — ${role}${l.city ? " in " + l.city : ""} | RoofCoil`;
  const desc = descriptionOf(l);
  const grouped = GROUPS.map(([label, list]) => [label, l.abilities.filter((a) => list.includes(a))]).filter(([, xs]) => xs.length);
  const known = new Set(GROUPS.flatMap(([, xs]) => xs));
  const other = l.abilities.filter((a) => !known.has(a));
  if (other.length) grouped.push(["Also runs", other]);
  const cityQuery = l.city ? l.city.split(",")[0].trim() : "";
  const nearby = all.filter((o) => o !== l && cityQuery && (o.city + " " + o.area).toLowerCase().includes(cityQuery.toLowerCase())).slice(0, 4);
  const shared = all.filter((o) => o !== l && !nearby.includes(o)).map((o) => ({ o, n: o.abilities.filter((a) => l.abilities.includes(a)).length })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 4).map((x) => x.o);
  const related = [...nearby, ...shared].slice(0, 4);
  const contactRows = [];
  if (l.website) contactRows.push(`<p><b>Website: </b><a href="${attr(l.website)}" target="_blank" rel="noopener nofollow" style="color:var(--copper);font-weight:600;text-decoration:none">${esc(l.host)}</a></p>`);
  if (l.phone) contactRows.push(`<p><b>Phone: </b>${phoneHref(l.phone) ? `<a href="${attr(phoneHref(l.phone))}" style="color:var(--copper);font-weight:600;text-decoration:none">${esc(phoneDisplay(l.phone))}</a>` : esc(phoneDisplay(l.phone))}</p>`);
  if (l.maps) contactRows.push(`<p><b>Map: </b><a href="${attr(l.maps)}" target="_blank" rel="noopener nofollow" style="color:var(--copper);font-weight:600;text-decoration:none">Directions on Google Maps</a></p>`);
  if (l.licensed) contactRows.push(`<p><b>Licensed in: </b>${esc(l.licensed)}</p>`);
  if (l.area) contactRows.push(`<p><b>Service area: </b>${esc(l.area)}</p>`);
  const updated = day(l.updated);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${attr(desc)}" />
<link rel="canonical" href="${l.url}">
<meta property="og:type" content="business.business" />
<meta property="og:site_name" content="RoofCoil" />
<meta property="og:url" content="${l.url}" />
<meta property="og:title" content="${attr(title)}" />
<meta property="og:description" content="${attr(desc)}" />
<meta property="og:image" content="${attr(l.photos[0] || `${SITE}/og-card.png`)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${attr(title)}" />
<meta name="twitter:description" content="${attr(desc)}" />
<meta name="twitter:image" content="${attr(l.photos[0] || `${SITE}/og-card.png`)}" />
${FONTS}
<script type="application/ld+json">${schemaOf(l)}</script>
<style>
${CARD_CSS}
.sp-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.8fr);gap:22px;align-items:start}
@media(max-width:860px){.sp-grid{grid-template-columns:1fr}}
.sp-grid .step{margin:0 0 16px}
.sp-grid .step h3{font-size:14px;letter-spacing:.06em}
.sp-grid .step p{margin:0 0 6px;font-size:14px;line-height:1.6;color:#4E6273}
.sp-grid .step p b{color:var(--ink-deep);font-weight:600}
.grp{margin:0 0 14px}
.grp .lbl{font-family:var(--mono);font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--steel);margin:0 0 6px}
.grp .ab-row{margin-top:0}
.sw-list{display:flex;flex-wrap:wrap;gap:6px 12px;margin:0}
.sw-list span{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:#3B4E5E}
.sw-list .dot{width:14px;height:14px;border-radius:999px;border:1px solid rgba(15,61,92,.25);display:inline-block}
.ph-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:0}
.ph-grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;border:1px solid rgba(15,61,92,.15);display:block}
.hero-logo{width:64px;height:64px;object-fit:contain;border-radius:12px;background:#fff;border:1px solid rgba(255,255,255,.3);display:block;margin-bottom:12px}
.rel{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.rel a{display:block;text-decoration:none;background:var(--card);border:1px solid rgba(15,61,92,.1);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow-1)}
.rel a b{display:block;font-family:var(--disp);font-size:15px;text-transform:uppercase;letter-spacing:.03em;color:var(--ink-deep)}
.rel a span{font-family:var(--mono);font-size:10.5px;color:var(--steel)}
</style>
</head>
<body>
${NAV("Directory")}

<div class="dhero" style="min-height:0">
  <div class="seam dseam" style="--c:#3A322C"></div>
  <div class="scrim"></div>
  <div class="wrap" style="padding-block:clamp(34px,5vw,56px)">
    <p class="eyebrow" style="color:#C7D6E2"><a href="/suppliers.html" style="color:inherit;text-decoration:none">RoofCoil directory</a>${l.city ? " · " + esc(l.city) : ""}</p>
    ${l.logo ? `<img class="hero-logo" src="${attr(l.logo)}" alt=""${l.logoBg ? ` style="background:${attr(l.logoBg)};padding:6px"` : ""}>` : ""}
    <h1 style="font-family:var(--disp);font-size:clamp(26px,4vw,42px);text-transform:uppercase;font-weight:700;margin:6px 0;text-shadow:0 2px 18px rgba(0,0,0,.5)">${esc(l.name)}</h1>
    <p class="sub">${esc(role)}${l.city ? " · " + esc(l.city) : ""}</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">${badgeHtml(l.badges)}</div>
  </div>
</div>

<div class="wrap" style="padding-block:clamp(28px,4vw,44px)">
<div class="sp-grid">
  <div>
    ${l.coil || l.fab ? `<div class="step"><h3>About the shop</h3>${l.coil ? `<p><b>Coil line: </b>${esc(l.coil)}</p>` : ""}${l.fab ? `<p><b>Fabrication: </b>${esc(l.fab)}</p>` : ""}</div>` : ""}
    <div class="step"><h3>What ${esc(l.name)} runs</h3>
      <p style="margin-bottom:12px">Every ability below is a live search facet — tap one to see every listed shop that runs it.</p>
      ${grouped.map(([label, xs]) => `<div class="grp"><p class="lbl">${esc(label)}</p><div class="ab-row">${xs.map((a) => `<a class="abchip" href="${abilityLink(a)}">${esc(a)}</a>`).join("")}</div></div>`).join("")}
    </div>
    ${l.colors.length ? `<div class="step"><h3>Colors carried (${l.colors.length})</h3><p class="sw-list">${l.colors.map((c) => `<span><i class="dot" style="background:${COLOR_HEX[c] || "#8A94A6"}"></i>${esc(c)}</span>`).join("")}</p></div>` : ""}
    ${l.photos.length ? `<div class="step"><h3>Job photos</h3><div class="ph-grid">${l.photos.map((u) => `<a href="${attr(u)}" target="_blank" rel="noopener"><img src="${attr(u)}" loading="lazy" alt="Job photo from ${attr(l.name)}"></a>`).join("")}</div></div>` : ""}
  </div>
  <div>
    <div class="step"><h3>Contact</h3>
      ${contactRows.join("\n") || `<p>Contact details are on file with RoofCoil — <a href="mailto:orders@roofcoil.com" style="color:var(--copper);font-weight:600;text-decoration:none">email us</a> and we'll connect you.</p>`}
    </div>
    <div class="step"><h3>${l.locs.length > 1 ? "Locations" : "Location"}</h3>
      ${l.locs.length ? l.locs.map((x) => `<p><b>${esc(x.city || "Location")}</b>${x.address ? "<br>" + esc(x.address) : ""}${x.abilities ? `<br><span class="mono" style="font-size:10.5px;color:var(--steel)">runs: ${esc(x.abilities.join(", "))}</span>` : ""}</p>`).join("") : `<p>${esc(l.city || "Location on request")}</p>`}
      ${cityQuery ? `<a class="btn dark" style="margin-top:8px" href="/suppliers.html?loc=${encodeURIComponent(cityQuery)}">More shops near ${esc(cityQuery)}</a>` : ""}
    </div>
    <div class="step"><h3>Is this your shop?</h3>
      <p>Keep the listing current — abilities, colors, photos and locations — and contractors searching by what the job needs will keep finding you.</p>
      <a class="btn dark" href="/manage-listing.html">Manage this listing</a>
    </div>
  </div>
</div>

${related.length ? `<h2 class="sec" style="margin-top:28px">Other listed shops</h2>
<div class="rel">${related.map((o) => `<a href="${o.path}"><b>${esc(o.name)}</b><span>${esc(o.city)}${o.city ? " · " : ""}${o.abilities.length} abilities</span></a>`).join("")}</div>` : ""}

<div class="co cta" style="border-style:dashed;background:transparent;display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;justify-content:space-between;margin-top:26px">
  <p style="margin:0;font-size:14px">Run sheet metal and not listed yet? Listing is free, and contractors search by ability, color and location.</p>
  <a class="btn" href="/get-listed.html">Get listed →</a>
</div>
${updated ? `<p class="mono" style="font-size:10.5px;color:var(--steel);letter-spacing:.05em;margin:18px 0 0">Listing details as published by the shop and reviewed by RoofCoil · last updated ${esc(updated)}</p>` : ""}
</div>

${FOOTER}
</body>
</html>
`;
}

/* ── directory page patch ─────────────────────────────────────────────────── */
function patchDirectory(html, all) {
  const cards = all.map(cardHtml).join("\n");
  const marker = /<div id="dir">[\s\S]*?<\/div>/;
  if (!marker.test(html)) throw new Error("suppliers.html: #dir container not found");
  html = html.replace(marker, `<div id="dir">\n${cards}\n</div>`);
  const list = { "@context": "https://schema.org", "@type": "ItemList", name: "RoofCoil Supplier & Fabricator Directory", numberOfItems: all.length,
    itemListElement: all.map((l, i) => { const c = splitCity(l.city); return { "@type": "ListItem", position: i + 1, item: { "@type": "LocalBusiness", "@id": `${l.url}#business`, url: l.url, name: l.name, telephone: phoneHref(l.phone) ? phoneHref(l.phone).slice(4) : undefined, address: l.city ? { "@type": "PostalAddress", streetAddress: l.address || undefined, addressLocality: c.locality || undefined, addressRegion: c.region || undefined, addressCountry: "US" } : undefined, geo: l.lat != null && l.lng != null ? { "@type": "GeoCoordinates", latitude: l.lat, longitude: l.lng } : undefined } }; }) };
  const ld = /<script type="application\/ld\+json">[\s\S]*?<\/script>/;
  if (!ld.test(html)) throw new Error("suppliers.html: ItemList JSON-LD not found");
  return html.replace(ld, `<script type="application/ld+json">\n${JSON.stringify(list, (k, v) => (v === undefined ? undefined : v)).replace(/<\//g, "<\\/")}\n</script>`);
}

/* ── sitemap + llms.txt ───────────────────────────────────────────────────── */
async function staticPages() {
  const skip = new Set(["confirm.html", "directory-admin.html", "manage-listing.html"]);
  const out = [];
  const add = async (rel, loc, priority) => {
    const html = await fs.readFile(path.join(ROOT, "public", rel), "utf8");
    if (/name="robots"\s+content="[^"]*noindex/i.test(html)) return;
    const title = (html.match(/<title>([^<]*)<\/title>/) || [, ""])[1].replace(/&amp;/g, "&").replace(/\s*\|\s*RoofCoil\s*$/, "").trim();
    const desc = (html.match(/name="description" content="([^"]*)"/) || [, ""])[1].replace(/&amp;/g, "&");
    out.push({ loc, title, desc, lastmod: day(gitDate(path.posix.join("public", rel))), priority });
  };
  for (const f of (await fs.readdir(path.join(ROOT, "public"))).filter((f) => f.endsWith(".html") && !skip.has(f)).sort()) {
    const loc = f === "home.html" ? `${SITE}/` : f === "standing-seam-panels.html" ? `${SITE}/panels` : `${SITE}/${f}`;
    await add(f, loc, f === "home.html" ? "1.0" : "0.8");
  }
  for (const f of (await fs.readdir(path.join(ROOT, "public", "articles"))).filter((f) => f.endsWith(".html")).sort()) {
    await add(path.posix.join("articles", f), f === "index.html" ? `${SITE}/articles/` : `${SITE}/articles/${f}`, "0.7");
  }
  await add("docs/privacy.html", `${SITE}/docs/privacy.html`, "0.2");
  return out;
}
function sitemapXml(pages, all) {
  const url = (loc, lastmod, priority) => `  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}${priority ? `<priority>${priority}</priority>` : ""}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => url(p.loc, p.lastmod, p.priority)).join("\n")}\n${all.map((l) => url(l.url, day(l.updated), "0.6")).join("\n")}\n</urlset>\n`;
}
function llmsTxt(pages, all) {
  const byLoc = (loc) => pages.find((p) => p.loc === loc);
  const line = (loc, fallback) => { const p = byLoc(loc); return `- [${p ? p.title : fallback}](${loc})${p && p.desc ? ": " + p.desc : ""}`; };
  const articles = pages.filter((p) => p.loc.startsWith(`${SITE}/articles/`) && p.loc !== `${SITE}/articles/`);
  return `# RoofCoil

> The search engine for sheet metal in North America. RoofCoil indexes suppliers, fabricators and contractors by what they can actually run — standing seam and exposed fastener panels, slit coil and flat sheet, custom trim, roll-formed gutters, 3D parts and on-site roll forming — plus the colors they carry and where they are, and offers free tools to price panels, draw trim and match colors. Contact: orders@roofcoil.com · 972-944-7963.

Every listed shop has its own page under /suppliers/ with a LocalBusiness record, the exact abilities it runs, colors carried, locations and contact details. Ability names are a fixed taxonomy (below); the directory at /suppliers.html filters on them and accepts ?ability=<name>, ?color=<name> and ?loc=<city> query strings.

## Key pages
${line(`${SITE}/`, "Home")}
${line(`${SITE}/suppliers.html`, "Find a supplier")}
${line(`${SITE}/get-listed.html`, "Get listed")}
${line(`${SITE}/panels`, "Metal roof panels")}
${line(`${SITE}/sheet-metal-trim.html`, "Sheet metal trim")}
${line(`${SITE}/roll-forming.html`, "On-site roll forming")}
${line(`${SITE}/coil-and-flats.html`, "Coil & flat sheet")}
${line(`${SITE}/members.html`, "Member tools")}

## Articles
${articles.map((p) => `- [${p.title}](${p.loc})${p.desc ? ": " + p.desc : ""}`).join("\n")}

## Listed suppliers, fabricators and contractors (${all.length})
${all.map((l) => `- [${l.name}](${l.url}): ${[l.city, roleOf(l)].filter(Boolean).join(" · ")}. Runs ${l.abilities.slice(0, 8).join(", ")}${l.abilities.length > 8 ? ` and ${l.abilities.length - 8} more` : ""}.${l.colors.length ? ` ${l.colors.length} stock colors.` : ""}${l.locs.length > 1 ? ` Locations: ${l.locs.map((x) => x.city).filter(Boolean).join(", ")}.` : ""}`).join("\n")}

## Ability taxonomy
- Standing seam panels: ${STANDING_SEAM.join(", ")}
- Exposed fastener panels (generic names, each rolled by more than one manufacturer): ${EXPOSED.join(", ")}
- Coil & flat sheet: ${COIL.join(", ")}
- Trim & 3D parts: ${TRIM.join(", ")}
- Roll-formed gutters: ${GUTTER_PROFILES.join(", ")}
- Gutter materials: ${GUTTER_MATERIALS.join(", ")}
- Services: ${SERVICES.join(", ")}

## Optional
- [Privacy policy](${SITE}/docs/privacy.html)
- [Sitemap](${SITE}/sitemap.xml)
`;
}

/* ── main ─────────────────────────────────────────────────────────────────── */
const rows = await loadListings();
const all = normalize(rows);
if (!all.length) throw new Error("prerender: zero live listings came back — refusing to publish an empty directory");
await fs.mkdir(path.join(OUT, "suppliers"), { recursive: true });
for (const l of all) {
  await fs.mkdir(path.join(OUT, "suppliers", l.slug), { recursive: true });
  await fs.writeFile(path.join(OUT, "suppliers", l.slug, "index.html"), supplierPage(l, all));
}
const dirPath = path.join(OUT, "suppliers.html");
await fs.writeFile(dirPath, patchDirectory(await fs.readFile(dirPath, "utf8"), all));
const pages = await staticPages();
await fs.writeFile(path.join(OUT, "sitemap.xml"), sitemapXml(pages, all));
await fs.writeFile(path.join(OUT, "llms.txt"), llmsTxt(pages, all));
console.log(`prerender: ${all.length} supplier pages, directory patched, sitemap (${pages.length + all.length} urls), llms.txt → ${OUT}`);
