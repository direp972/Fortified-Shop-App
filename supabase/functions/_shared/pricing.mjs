// Pricing, shared by the app (src/App.jsx) and the submit-order Edge Function
// (supabase/functions/submit-order), so an order is priced on the server by exactly the code
// that priced the estimate on the screen. The catalog it prices against (gauges and their
// fallback rates, paint multipliers, premium colors) comes from catalog.mjs next to it and
// is passed in, defaulting to DEFAULT_CATALOG. Plain ESM whose only import is that sibling:
// Vite bundles both into the app and Deno loads them as-is. Keep it that way — anything
// React- or DOM-specific belongs in App.jsx.
import { DEFAULT_CATALOG, findColor, findGauge, findPaint } from "./catalog.mjs";

// One resolved set of scupper numbers, shared by the model, the blank, the price and the
// ticket. They used to be defaulted and clamped separately in each, so a plate typed
// narrower than its own opening was drawn at one size, priced at a second and printed at a
// third — and the shop builds from the printed one.
export function scupperSpec(o) {
  const n = (v, d) => (Number.isFinite(+v) ? +v : d);
  const W = Math.max(1, n(o.partW, 12)), H = Math.max(1, n(o.partH, 4)), WT = Math.max(1, n(o.partD, 8));
  const proj = Math.max(0.25, n(o.scupProj, 2));
  // The roof-side plate is usually cut and welded in the field, so the shop only makes one when
  // the order says so. An order written before that was a choice has no scupRoofMode: it was
  // priced with whatever flange it carried, so that is what it keeps.
  const roofShop = o.scupRoofMode ? o.scupRoofMode === "shop" : Math.max(0, n(o.scupFlange, 6)) > 0.01;
  const flange = roofShop ? Math.max(0, n(o.scupFlange, 6)) : 0;
  const dsRaw = String(o.scupDsSize || "4×5").split("×").map(Number);
  return {
    W, H, WT, proj, flange, roofShop,
    // the bottom of the roof plate can turn out flat onto the deck for the membrane to lap over;
    // zero leaves it stopping at the deck, which is the other way it gets done
    deckLeg: roofShop ? Math.max(0, n(o.scupDeckLeg, 0)) : 0,
    // Three ways the outside of the wall can go, and only one of them is metal the shop sends
    // with the sleeve. "none" is a bare sleeve: a box gets made in the field and added there,
    // or ordered on its own as a Collector Box part.
    outside: o.scupOutlet === "collector" ? "collector" : o.scupOutlet === "none" ? "none" : "faceplate",
    collector: o.scupOutlet === "collector",
    faceplate: o.scupOutlet !== "collector" && o.scupOutlet !== "none",
    // a termination narrower than the hole it covers is not a thing, so the opening floors it
    plateW: Math.max(W + 1, n(o.scupPlateW, W + 4)),
    plateH: Math.max(H + 1, n(o.scupPlateH, H + 4)),
    boxW: Math.max(W + 1, n(o.scupBoxW, W + 4)),
    // the box has to reach past the spout or the stream lands in front of it
    boxD: Math.max(1, proj + 2, n(o.scupBoxD, proj + 4)),
    boxH: Math.max(2, n(o.scupBoxH, 12)),
    dsSize: o.scupDsSize || "4×5",
    dsOut: Math.max(1, dsRaw[0] || 4), dsAcross: Math.max(1, dsRaw[1] || 5),
    dsLen: Math.max(0, n(o.scupDsLen, 0)),
    gap: 1.5, // free fall under the spout, so a hard rain can't dam back into the wall
  };
}

// The back plate of the collector box, derived from the spec so the model, the price and the
// ticket describe the same piece of metal. It runs from the box bottom up past the spout,
// with the sleeve pierced through it.
export function scupperBack(k) {
  return { h: k.H + 2 + k.gap + k.boxH, pierceW: k.W, pierceH: k.H };
}

// $2/mile one way past 40 miles from the nearest roll-forming base.
export const MILEAGE_FREE = 40, MILEAGE_RATE = 2;
export const mileageCharge = (miles) => Math.max(0, (+miles || 0) - MILEAGE_FREE) * MILEAGE_RATE;

// The shop's price list and coil width scale as first seeded, and what the app and the
// server fall back to until the shop has saved its own (shop_settings keys price-list and
// coil-width-scale for that shop).
export const DEFAULT_PRICE_LIST = [
  // Roof Panel
  { id: "p1", category: "Roof Panel", name: '24 Gauge Coil (per linear ft)', derivedFromMaterialId: "m1", coverageWidth: 16, cost: 0, tier1: 4.10, tier2: 4.55, greenleaf: 3.95 },
  { id: "p2", category: "Roof Panel", name: '26 Gauge Coil (per linear ft)', cost: 0, tier1: 3.30, tier2: 3.65, greenleaf: 3.15 },
  { id: "p1f", category: "Roof Panel", name: 'Panel Fabrication (per linear ft)', cost: 0, tier1: 1.00, tier2: 1.15, greenleaf: 0.65 },
  { id: "p1f2", category: "Roof Panel", name: 'FWQ100 Fabrication (per linear ft)', cost: 0, tier1: 1.75, tier2: 2.00, greenleaf: 1.50 },
  { id: "p2b", category: "Roof Panel", name: "Flat Sheet Material (per sq ft)", cost: 0, tier1: 1.40, tier2: 1.40, greenleaf: 1.40 },
  { id: "p2c", category: "Roof Panel", name: "Flat Sheet Processing (per sheet)", cost: 0, tier1: 7.50, tier2: 7.50, greenleaf: 7.50 },
  // Trim / Flashing
  { id: "p3", category: "Trim / Flashing", name: '24 Gauge Trim (per linear ft)', cost: 0, tier1: 3.00, tier2: 3.35, greenleaf: 2.90 },
  { id: "p4", category: "Trim / Flashing", name: '26 Gauge Trim (per linear ft)', cost: 0, tier1: 2.40, tier2: 2.70, greenleaf: 2.30 },
  // Copper
  { id: "p5", category: "Copper", name: '16 oz Copper (per sq ft)', cost: 0, tier1: 15.75, tier2: 17.50, greenleaf: 15.25 },
  { id: "p6", category: "Copper", name: '20 oz Copper (per sq ft)', cost: 0, tier1: 19.25, tier2: 21.50, greenleaf: 18.60 },
  // Paint / Finish
  { id: "p6a", category: "Paint / Finish", name: "PVDF Paint Upcharge (per sq ft)", cost: 0, tier1: 0.55, tier2: 0.65, greenleaf: 0.50 },
  { id: "p6b", category: "Paint / Finish", name: "SMP Paint (per sq ft)", cost: 0, tier1: 0, tier2: 0, greenleaf: 0 },
  { id: "p6c", category: "Paint / Finish", name: "Premium Color Upcharge (per sq ft)", cost: 0, tier1: 0.45, tier2: 0.55, greenleaf: 0.40 },
  // Accessories
  { id: "p7", category: "Accessories", name: '1" XLP Screws (each)', cost: 0, tier1: 0.18, tier2: 0.22, greenleaf: 0.16 },
  { id: "p8", category: "Accessories", name: 'DP1 Screws (each)', cost: 0, tier1: 0.22, tier2: 0.27, greenleaf: 0.20 },
  { id: "p9", category: "Accessories", name: 'DP3 Screws (each)', cost: 0, tier1: 0.26, tier2: 0.32, greenleaf: 0.24 },
  { id: "p10", category: "Accessories", name: '3/8" Butyl Tape (per roll)', cost: 0, tier1: 6.50, tier2: 7.50, greenleaf: 6.00 },
  { id: "p11", category: "Accessories", name: '1" Butyl Tape (per roll)', cost: 0, tier1: 8.25, tier2: 9.50, greenleaf: 7.75 },
  { id: "p12a", category: "Accessories", name: 'Pipe Boot 1" (each)', cost: 0, tier1: 12.00, tier2: 14.00, greenleaf: 11.00 },
  { id: "p12b", category: "Accessories", name: 'Pipe Boot 1.5" (each)', cost: 0, tier1: 13.00, tier2: 15.25, greenleaf: 12.00 },
  { id: "p12c", category: "Accessories", name: 'Pipe Boot 2" (each)', cost: 0, tier1: 14.00, tier2: 16.50, greenleaf: 13.00 },
  { id: "p12d", category: "Accessories", name: 'Pipe Boot 3" (each)', cost: 0, tier1: 15.50, tier2: 18.00, greenleaf: 14.25 },
  { id: "p12e", category: "Accessories", name: 'Pipe Boot 4" (each)', cost: 0, tier1: 17.00, tier2: 19.75, greenleaf: 15.75 },
  { id: "p12f", category: "Accessories", name: 'Pipe Boot 5" (each)', cost: 0, tier1: 19.00, tier2: 22.00, greenleaf: 17.50 },
  { id: "p12g", category: "Accessories", name: 'Pipe Boot 6" (each)', cost: 0, tier1: 21.50, tier2: 25.00, greenleaf: 20.00 },
  { id: "p12h", category: "Accessories", name: 'Pipe Boot 7" (each)', cost: 0, tier1: 24.00, tier2: 28.00, greenleaf: 22.25 },
  { id: "p12i", category: "Accessories", name: 'Pipe Boot 8" (each)', cost: 0, tier1: 27.00, tier2: 31.50, greenleaf: 25.00 },
  { id: "p13", category: "Accessories", name: 'Sealant, Color-Matched (per tube)', cost: 0, tier1: 9.00, tier2: 10.50, greenleaf: 8.50 },
  // Dry In
  { id: "pd1", category: "Accessories", name: 'Synthetic Underlayment 42" (1,000 sq ft roll)', cost: 0, tier1: 0, tier2: 0, greenleaf: 0 },
  { id: "pd2", category: "Accessories", name: 'Plastic Cap Nails (2,000 ct box)', cost: 0, tier1: 0, tier2: 0, greenleaf: 0 },
  { id: "pd3", category: "Accessories", name: 'Palisade SA-HT Ice & Water (2 sq roll)', cost: 0, tier1: 0, tier2: 0, greenleaf: 0 },
  // Clips — priced PER CLIP; the backend shows the computed per-box price
  // (per-clip × the box count from CLIP_SPECS) next to each row.
  // Costs are BPD (bpdusa.com) listed per-clip prices as of 2026-08-21; sell
  // prices are cost × 1.8, rounded to the cent.
  { id: "pc1", category: "Clips", name: 'FG-100-24 Clip (per clip)', cost: 0.133, tier1: 0.24, tier2: 0.24, greenleaf: 0.24 },
  { id: "pc2", category: "Clips", name: 'FG-158-24 Clip (per clip)', cost: 0.147, tier1: 0.26, tier2: 0.26, greenleaf: 0.26 },
  { id: "pc3", category: "Clips", name: 'FG-218-24 Clip (per clip)', cost: 0.317, tier1: 0.57, tier2: 0.57, greenleaf: 0.57 },
  { id: "pc4", category: "Clips", name: 'SG-114-24-SL Clip (per clip)', cost: 0.199, tier1: 0.36, tier2: 0.36, greenleaf: 0.36 },
  { id: "pc5", category: "Clips", name: 'SG-178-18 Clip (per clip)', cost: 0.271, tier1: 0.49, tier2: 0.49, greenleaf: 0.49 },
  { id: "p14", category: "Accessories", name: 'Clips (per 100, by profile)', cost: 0, tier1: 22.00, tier2: 26.00, greenleaf: 20.50 },
  // 3D Parts
  { id: "p15", category: "3D Parts", name: 'Collector Box (base fabrication fee)', cost: 0, tier1: 45.00, tier2: 55.00, greenleaf: 42.00 },
  { id: "p16", category: "3D Parts", name: 'Scupper (base fabrication fee)', cost: 0, tier1: 40.00, tier2: 50.00, greenleaf: 37.00 },
  { id: "p17", category: "3D Parts", name: 'Chimney Cap (base fabrication fee)', cost: 0, tier1: 50.00, tier2: 62.00, greenleaf: 47.00 },
];

export const DEFAULT_COIL_WIDTH_SCALE = [
  { id: "cw1", width: 16, pricePerFt: 2.56 },
  { id: "cw2", width: 21, pricePerFt: 3.03 },
  { id: "cw3", width: 24, pricePerFt: 3.31 },
];

/* ---------------------------------- pricing ---------------------------------- */
// Every Price List row carries one sell price per customer tier (tier1 / tier2 /
// greenleaf). Estimates and orders are priced at the tier the shop assigned to the
// signed-in customer; an account with no tier yet, or a value that isn't one of the three,
// prices at tier2 — the retail default every new sign-up starts on.
export const TIERS = ["tier1", "tier2", "greenleaf"];
export const DEFAULT_TIER = "tier2";
export function sellTierFor(customer) {
  const t = customer?.tier;
  return TIERS.includes(t) ? t : DEFAULT_TIER;
}
// A row's sell price at a tier, or undefined when the row has no number there — rows the
// shop hasn't priced for that tier are skipped, the same as unpriced rows always were.
export function sellRate(item, tier) {
  const v = item?.[TIERS.includes(tier) ? tier : DEFAULT_TIER];
  return typeof v === "number" ? v : undefined;
}

// Pulls live sell rates from the Price List (at the customer's tier) instead of the old
// hardcoded GAUGE_OPTIONS table, so editing prices in the Price List tab actually
// changes what New Order shows. Price List panel rates are $/linear ft at a specific
// coil width (that item's own "Coverage Width"), so they get converted to a $/sqft
// basis using that same width — trim rates are already $/linear ft, no conversion
// needed. Falls back to the old hardcoded rates for materials the Price List doesn't
// have a matching entry for yet (Copper only if no matching entry, G90/Galvalume/
// Bonderized always, since those aren't in the Price List at all currently).
// Coil sells in width BRACKETS, not on a sliding scale: each scale point means
// "anything up to this width costs this much per LF". With points at 16/21/24,
// a 15" coil prices at the 16" rate, 16.01"–21" at the 21" rate, 21.01"–24" at
// the 24" rate. Wider than the top bracket uses the top bracket's price.
// Returns null when the scale is empty so callers can fall back to flat-rate.
export function coilPriceForWidth(widthIn, scale) {
  if (!scale || scale.length === 0 || !widthIn) return null;
  const sorted = [...scale].sort((a, b) => a.width - b.width);
  const bracket = sorted.find((p) => widthIn <= p.width) || sorted[sorted.length - 1];
  return Math.max(0, bracket.pricePerFt);
}

// Fabrication $/LF from the Price List — a profile-specific row (name starting with
// the profile code, e.g. "FWQ100 Fabrication") beats the generic "Panel Fabrication".
export function findFabItem(priceList, profile, tier) {
  const fabItems = (priceList || []).filter((p) => p.category === "Roof Panel" && p.name.toLowerCase().includes("fabrication") && sellRate(p, tier) !== undefined);
  const code = profile ? profile.split(" ")[0].toLowerCase() : "";
  return (code && fabItems.find((p) => p.name.toLowerCase().startsWith(code))) || fabItems.find((p) => p.name.toLowerCase().startsWith("panel")) || fabItems[0] || null;
}

export function getSellRates(gaugeId, brand, priceList, profile, tier, catalog = DEFAULT_CATALOG) {
  const gauge = findGauge(catalog, gaugeId, brand);
  const fallback = { coilSqft: gauge.panelSqft, panelSqft: gauge.panelSqft, fabSqft: 0, trimFt: gauge.trimFt };
  if (!priceList || priceList.length === 0) return fallback;

  if (brand === "Copper") {
    const item = priceList.find((p) => p.category === "Copper" && p.name.toLowerCase().includes(gauge.label.toLowerCase()) && sellRate(p, tier) !== undefined);
    const coilSqft = item ? sellRate(item, tier) : fallback.coilSqft;
    return { coilSqft, panelSqft: coilSqft, fabSqft: 0, trimFt: fallback.trimFt };
  }
  if (["G90 Galvanized", "Galvalume", "Bonderized"].includes(brand)) {
    return fallback; // not in the Price List yet
  }

  const gaugeLabel = gauge.label; // "24 Gauge" or "26 Gauge"
  // "24/26 Gauge Coil" is the raw material rate. "Panel Fabrication" is the separate
  // per-linear-ft charge for actually roll-forming that coil into a finished panel —
  // raw coil/flat metal orders should only ever be charged the coil rate, never
  // fabrication, since nothing's being formed.
  const coilItem = priceList.find((p) => p.category === "Roof Panel" && p.name.startsWith(gaugeLabel) && sellRate(p, tier) !== undefined);
  const fabItem = findFabItem(priceList, profile, tier);
  const trimItem = priceList.find((p) => p.category === "Trim / Flashing" && p.name.startsWith(gaugeLabel) && sellRate(p, tier) !== undefined);

  const coilWidthIn = coilItem?.coverageWidth || 12;
  const coilSqft = coilItem ? sellRate(coilItem, tier) / (coilWidthIn / 12) : fallback.coilSqft;
  const fabSqft = fabItem ? sellRate(fabItem, tier) / (coilWidthIn / 12) : 0;
  const panelSqft = coilSqft + fabSqft;
  const trimFt = trimItem ? sellRate(trimItem, tier) : fallback.trimFt;
  return { coilSqft, panelSqft, fabSqft, trimFt };
}

export function computePrice(order, priceList, coilWidthScale, tier, catalog = DEFAULT_CATALOG) {
  const rates = getSellRates(order.gaugeId, order.brand, priceList, order.profile, tier, catalog);
  const paint = order.brand === "Copper" ? { mult: 1 } : (findPaint(catalog, order.paintId) || catalog.paints[0]);
  const colorObj = findColor(catalog, order.colorName, order.brand, order.paintId);
  const premiumMult = colorObj?.premium ? 1.12 : 1;
  if (order.type === "metal") {
    const flatSqft = ((order.flatWidth || 0) * (order.flatLength || 0)) / 144;
    // Flat sheets price as material ($/sq ft) + a flat processing fee per sheet, pulled
    // from the Price List's "Flat Sheet Material" / "Flat Sheet Processing" items —
    // falls back to the old gauge-derived rate (material only, no processing fee) if
    // those items aren't in the Price List.
    const flatMaterialItem = priceList?.find((p) => p.name.toLowerCase().includes("flat sheet material") && sellRate(p, tier) !== undefined);
    const flatProcessingItem = priceList?.find((p) => p.name.toLowerCase().includes("flat sheet processing") && sellRate(p, tier) !== undefined);
    const flatMaterialRate = flatMaterialItem ? sellRate(flatMaterialItem, tier) : rates.coilSqft;
    const flatProcessingFee = flatProcessingItem ? sellRate(flatProcessingItem, tier) : 0;
    const flatCost = (flatSqft * flatMaterialRate * paint.mult + flatProcessingFee) * order.quantity;
    // Coil pricing prefers the real interpolated width scale (actual supplier price
    // points) over the flat derived $/sqft rate, since coil doesn't price out linearly
    // with width in the real world — falls back to the flat rate if there aren't at
    // least 2 scale points to interpolate between. The scale points themselves are
    // PVDF pricing, so they apply as-is for PVDF orders and get scaled down by the
    // PVDF/SMP ratio for SMP orders, rather than getting the PVDF multiplier stacked
    // on top of an already-PVDF price.
    const interpolatedPerFt = coilPriceForWidth(order.coilWidth, coilWidthScale);
    const pvdfMult = findPaint(catalog, "pvdf")?.mult || 1;
    const coilFeet = (order.coilLength || 0) / 12;
    const coilCost = interpolatedPerFt !== null
      ? interpolatedPerFt * (paint.mult / pvdfMult) * coilFeet
      : (((order.coilWidth || 0) * (order.coilLength || 0)) / 144) * rates.coilSqft * paint.mult;
    const base = flatCost + coilCost;
    return Math.max(15, base * premiumMult + 15);
  } else if (order.type === "part3d") {
    const W = order.partW || 0, D = order.partD || 0, H = order.partH || 0, CH = order.partCapH || 0;
    let sqin;
    if (order.partType === "chimney") {
      const oh = order.partOverhang ?? 2, postH = order.partPostH ?? 6, shelf = order.partShelf ?? 3, leg = order.partLeg ?? 3;
      const EW = W + 2 * oh, ED = D + 2 * oh;
      const slant = Math.sqrt((Math.max(EW, ED) / 2) ** 2 + CH ** 2);
      // the base (shelf + down leg + hem, all the way round) + four posts + the roof out to its eave + drip and seams
      sqin = 2 * (W + D) * (shelf + leg + 0.5) + 4 * postH * 6 + 2 * (EW + ED) * slant * 1.1;
    } else if (order.partType === "scupper") {
      // the sleeve's girth over its run, plus the roof flange collar, plus whatever the
      // spout runs into. Without this a face-plate scupper and a scupper with a head and
      // ten feet of downspout under it quote to exactly the same number.
      const k = scupperSpec(order);
      sqin = 2 * (k.W + k.H) * (k.WT + k.proj)
        + ((k.W + 2 * k.flange) * (k.H + 2 * k.flange) - k.W * k.H)
        + (k.W + 2 * k.flange) * k.deckLeg; // the turned-out leg comes off the same blank
      if (k.collector) {
        // bottom, front, two sides, and the back the sleeve passes through
        sqin += k.boxW * k.boxD + k.boxW * k.boxH + 2 * k.boxD * k.boxH
          + (k.boxW * scupperBack(k).h - k.W * k.H);
        sqin += 2 * (k.dsOut + k.dsAcross) * k.dsLen * 12;
      } else if (k.faceplate) {
        sqin += k.plateW * k.plateH - k.W * k.H;
      }
    } else {
      sqin = 2 * (W + D) * H + W * D; // walls + bottom
    }
    const sqft = sqin / 144;
    const fabItemName = order.partType === "collector" ? "collector box" : order.partType === "scupper" ? "scupper" : "chimney cap";
    const feeFor = (name) => {
      const it = priceList?.find((p) => p.category === "3D Parts" && p.name.toLowerCase().includes(name) && sellRate(p, tier) !== undefined);
      return it ? sellRate(it, tier) : 12; // per-piece fee for the extra seams/folds vs a flat panel
    };
    // A scupper with a head under it is two fabricated pieces on one line. The head's seams
    // and its outlet are the same work the standalone Collector Box part is billed for, so
    // without this the box and its downspout go out as raw coil with no labor on them.
    let formingFee = feeFor(fabItemName);
    if (order.partType === "scupper" && order.scupOutlet === "collector") formingFee += feeFor("collector box");
    const base = sqft * rates.coilSqft * paint.mult * order.quantity + formingFee * order.quantity;
    return Math.max(20, base * premiumMult + 20);
  } else if (order.type === "panel") {
    const sqft = (order.width * order.height) / 144;
    const coilCost = sqft * rates.coilSqft * paint.mult * order.quantity;
    const fabCost = sqft * (rates.fabSqft || 0) * paint.mult * order.quantity;
    // Fabrication minimums: hauling the roll former to a job site floors the
    // fabrication charge at $600; shop-rolled runs floor at $150.
    const fabMin = order.runLocation === "Job Site" ? 600 : 200;
    // $2/mile one way past 40 miles from the nearest roll-forming base
    const mileage = order.runLocation === "Job Site" ? mileageCharge(order.jobSiteMiles) : 0;
    const base = coilCost + Math.max(fabCost, fabMin) + mileage;
    return Math.max(15, base * premiumMult + 15);
  } else {
    const points = order.points || [];
    const bends = Math.max(0, points.length - 2);
    const totalFt = order.lengthPerPiece * order.quantity;
    const base = (totalFt * rates.trimFt * paint.mult) + bends * 2 * order.quantity;
    return Math.max(10, base * premiumMult + 10);
  }
}
