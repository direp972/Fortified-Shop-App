import React, { useState, useEffect, useRef, useCallback } from "react";
import { Ruler, Trash2, Undo2, Plus, Check, Clock, Hammer, Truck, PackageCheck, ClipboardList, PenTool, Square, Phone, User, StickyNote, ChevronDown, ChevronUp, Layers, Box, DollarSign, GripVertical, Printer, Briefcase } from "lucide-react";
import * as THREE from "three";
import { storage } from "./lib/storage";
import { supabase } from "./lib/supabaseClient";
import { useAuth } from "./lib/AuthProvider";

/* ---------------------------------- tokens ---------------------------------- */
const INK = "#0F3D5C";        // blueprint ink
const INK_DEEP = "#0A2B41";
const CHARCOAL = "#0B1E2C";   // matches roofcoil.com --night so the app reads as part of the site
const PAPER = "#F6F4EE";      // matches roofcoil.com --paper
const STEEL = "#8A94A6";
const SAFETY = "#D4AF37";     // gold accent (was orange)
const AMBER = "#EFA623";      // brighter gold
const GREEN = "#2FA84F";      // brighter green

// Densities in lb/in³ — used by the coil weight calculator (standard material physics
// constants, not specific to any particular calculator app).
const MATERIAL_DENSITIES = {
  steel: { label: "Steel / Galvanized / Galvalume", density: 0.2836 },
  stainless: { label: "Stainless Steel", density: 0.289 },
  aluminum: { label: "Aluminum", density: 0.098 },
  copper: { label: "Copper", density: 0.323 },
};

const GAUGE_OPTIONS = [
  { id: "24ga", label: "24 Gauge", panelSqft: 3.75, trimFt: 2.75 },
  { id: "26ga", label: "26 Gauge", panelSqft: 3.00, trimFt: 2.20 },
];

const COPPER_WEIGHT_OPTIONS = [
  { id: "16oz", label: "16 oz Copper", panelSqft: 14.50, trimFt: 10.75 },
  { id: "20oz", label: "20 oz Copper", panelSqft: 17.75, trimFt: 13.25 },
];

const G90_GAUGE_OPTIONS = [
  { id: "16ga", label: "16 Gauge", panelSqft: 6.25, trimFt: 4.60 },
  { id: "18ga", label: "18 Gauge", panelSqft: 5.35, trimFt: 3.95 },
  { id: "20ga", label: "20 Gauge", panelSqft: 4.55, trimFt: 3.35 },
  { id: "22ga", label: "22 Gauge", panelSqft: 4.05, trimFt: 3.00 },
  { id: "24ga", label: "24 Gauge", panelSqft: 3.35, trimFt: 2.50 },
];

const GALVALUME_GAUGE_OPTIONS = [
  { id: "24ga", label: "24 Gauge", panelSqft: 3.45, trimFt: 2.55 },
  { id: "26ga", label: "26 Gauge", panelSqft: 2.85, trimFt: 2.10 },
];

const BONDERIZED_GAUGE_OPTIONS = [
  { id: "24ga", label: "24 Gauge", panelSqft: 3.60, trimFt: 2.65 },
  { id: "26ga", label: "26 Gauge", panelSqft: 3.00, trimFt: 2.20 },
];

const PAINT_OPTIONS = [
  { id: "pvdf", label: "PVDF (Kynar 500)", mult: 1.15 },
  { id: "smp", label: "40YR SMP", mult: 1.0 },
];

const BRAND_GROUPS = {
  Painted: ["Fortified Metal", "Una-Clad", "Adax Metals", "Berridge"],
};
const BRANDS = [...BRAND_GROUPS.Painted]; // painted brands only — unpainted materials live in their own dropdown
const UNPAINTED_MATERIALS = ["G90 Galvanized", "Copper", "Galvalume", "Bonderized"];
const PVDF_24GA_ONLY_BRANDS = ["Berridge"];
const PVDF_ONLY_BRANDS = ["Una-Clad"]; // no SMP, but any gauge is fine
const UNPAINTED_FLATS_ONLY_BRANDS = ["G90 Galvanized"];

const PROFILE_INFO = {
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
  // without a vendor field are Fortified's own machines. Ultra Seam publishes NO
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
const PROFILES = Object.keys(PROFILE_INFO).filter((k) => !PROFILE_INFO[k].delisted);

// Fixed-clip part numbers by panel profile — clips sell by the box.
const CLIP_SPECS = {
  SS100: { code: "FG-100-24", perBox: 1000 },    // 1" mechanical seam
  SS150: { code: "FG-158-24", perBox: 500 },     // 1.5" mechanical seam
  SSQ200: { code: "FG-218-24", perBox: 300 },    // 2" mechanical seam
  SS450: { code: "SG-114-24-SL", perBox: 800 },  // 1.5" snap-lock
  SSQ675: { code: "SG-178-18", perBox: 500 },    // 1.75" snap-lock
};
const clipSpecForProfile = (profile) => CLIP_SPECS[PROFILE_INFO[profile]?.code] || null;

function profileFamily(profile) {
  return PROFILE_INFO[profile]?.family || "mech";
}

// Builds a detailed side-view (cross-section) of the panel: real fold geometry for the
// seam (a rounded hook cap for snap-lock vs. a flat, layered, double-folded block for
// mechanical seam — those are mechanically different closures and should read as visually
// different shapes, not the same blob), plus the rib texture running across the pan.
// This draws the sheet as a proper closed outline (top face + a thin material-thickness
// edge) with a metal-sheen gradient, rather than a single centerline stroke, and zooms in
// on one full seam-to-seam module rather than trying to show true panel width — legibility
// of the fold shape matters more here than literal width-to-scale accuracy.
function generatePanelProfileSvg(profileLabel, ribStyle, widthIn) {
  const info = PROFILE_INFO[profileLabel] || {};
  const family = info.family || "mech";
  const seamHeightMatch = profileLabel.match(/(\d+(\.\d+)?)"/);
  const seamHeightIn = seamHeightMatch ? parseFloat(seamHeightMatch[1]) : 1.5;

  const w = 480, h = 300, padX = 50, baseY = 235;
  const seamH = Math.min(150, 60 + seamHeightIn * 36); // exaggerated, zoomed in for legibility
  const seamW = 42;
  const thick = 4; // drawn material thickness

  const isMech = family === "mech" || family === "mecharmco" || family === "trapezoid";
  const isBatten = family === "batten";
  const isFlange = family === "flange";

  // Outer profile top-line + a thin parallel inner line (thick px back) to suggest
  // material thickness, the way real fold-up drawings show gauge stock.
  const seamPath = (x, mirror) => {
    const s = mirror ? -1 : 1;
    const top = baseY - seamH;
    if (isMech) {
      // Double-lock mechanical seam: wall up, fold flat across the top, step down,
      // fold flat again, step down to close — a layered rectangular block, not a curl.
      return {
        outer: `M ${x} ${baseY} L ${x} ${top + 34}
                L ${x + s * 2} ${top + 30} L ${x + s * 2} ${top + 16}
                L ${x + s * 15} ${top + 16} L ${x + s * 15} ${top}
                L ${x + s * 15} ${top} L ${x + s * 15} ${top + 10}
                L ${x + s * 5} ${top + 10} L ${x + s * 5} ${top + 22}
                L ${x + s * 12} ${top + 22} L ${x + s * 12} ${top + 40}
                L ${x + s * 6} ${top + 40} L ${x + s * 6} ${baseY - 10}
                L ${x} ${baseY - 10} Z`,
        foldLines: [
          `M ${x + s * 2} ${top + 16} L ${x + s * 15} ${top + 16}`,
          `M ${x + s * 5} ${top + 22} L ${x + s * 12} ${top + 22}`,
          `M ${x + s * 6} ${top + 34} L ${x + s * 6} ${baseY - 10}`,
        ],
      };
    }
    if (isBatten) {
      // Board-and-batten cap: a wide, boxy trapezoid rather than a thin hook.
      return {
        outer: `M ${x - s * 3} ${baseY} L ${x - s * 3} ${top + 8}
                L ${x + s * 3} ${top} L ${x + s * 22} ${top}
                L ${x + s * 28} ${top + 8} L ${x + s * 28} ${baseY - 10}
                L ${x + s * 20} ${baseY - 10} L ${x + s * 20} ${top + 16}
                L ${x + s * 8} ${top + 16} L ${x + s * 8} ${baseY - 10}
                L ${x - s * 3} ${baseY - 10} Z`,
        foldLines: [`M ${x + s * 3} ${top} L ${x + s * 3} ${baseY - 10}`],
      };
    }
    // Snap-lock / flange / newlock family: a rounded hook cap. The male leg curls
    // over and nests inside the taller female leg's curled lip — draw the outer wall,
    // a smooth rounded bulb over the top, and a shorter inner hook line to suggest
    // the nested male leg without turning it into a flat blob.
    const flangeFoot = isFlange
      ? `M ${x} ${baseY} L ${x - s * 10} ${baseY} L ${x - s * 10} ${baseY - 6} L ${x} ${baseY - 6} Z `
      : "";
    return {
      outer: `M ${x} ${baseY} L ${x} ${top + 22}
              C ${x} ${top + 4} ${x + s * 4} ${top - 6} ${x + s * 14} ${top - 4}
              C ${x + s * 24} ${top - 2} ${x + s * 26} ${top + 10} ${x + s * 18} ${top + 16}
              C ${x + s * 13} ${top + 20} ${x + s * 9} ${top + 18} ${x + s * 9} ${top + 26}
              L ${x + s * 9} ${baseY - 8} L ${x} ${baseY - 8} Z`,
      foldLines: [
        `M ${x + s * 4} ${top + 8} C ${x + s * 4} ${top + 2} ${x + s * 9} ${top - 2} ${x + s * 15} ${top}`,
      ],
      extra: flangeFoot,
    };
  };

  const left = seamPath(padX, false);
  const right = seamPath(w - padX, true);

  // Rib texture across the pan, between the two seams — drawn as a proper filled
  // ribbon (top surface) rather than a thin centerline, so it reads as raised metal.
  const panStart = padX + seamW, panEnd = w - padX - seamW;
  const panSpan = panEnd - panStart;
  let ribTop = "", ribShade = [];
  if (ribStyle === "bead") {
    const n = 2, r = 16;
    let d = `M ${panStart} ${baseY}`;
    for (let i = 1; i <= n; i++) {
      const cx = panStart + (panSpan * i) / (n + 1);
      d += ` L ${cx - r} ${baseY} C ${cx - r} ${baseY - r * 1.3} ${cx + r} ${baseY - r * 1.3} ${cx + r} ${baseY}`;
      ribShade.push(`M ${cx - r} ${baseY} C ${cx - r} ${baseY - r * 1.3} ${cx + r} ${baseY - r * 1.3} ${cx + r} ${baseY}`);
    }
    d += ` L ${panEnd} ${baseY}`;
    ribTop = d;
  } else if (ribStyle === "pencil") {
    const n = 3, r = 6;
    let d = `M ${panStart} ${baseY}`;
    for (let i = 1; i <= n; i++) {
      const cx = panStart + (panSpan * i) / (n + 1);
      d += ` L ${cx - r} ${baseY} L ${cx - 2} ${baseY - 20} L ${cx + 2} ${baseY - 20} L ${cx + r} ${baseY}`;
      ribShade.push(`M ${cx - r} ${baseY} L ${cx - 2} ${baseY - 20} L ${cx + 2} ${baseY - 20} L ${cx + r} ${baseY}`);
    }
    d += ` L ${panEnd} ${baseY}`;
    ribTop = d;
  } else if (ribStyle === "v") {
    const n = 2, r = 22;
    let d = `M ${panStart} ${baseY}`;
    for (let i = 1; i <= n; i++) {
      const cx = panStart + (panSpan * i) / (n + 1);
      d += ` L ${cx - r} ${baseY} L ${cx} ${baseY - 30} L ${cx + r} ${baseY}`;
      ribShade.push(`M ${cx - r} ${baseY} L ${cx} ${baseY - 30} L ${cx + r} ${baseY}`);
    }
    d += ` L ${panEnd} ${baseY}`;
    ribTop = d;
  } else if (ribStyle === "striations") {
    const n = 11, r = 5;
    let d = `M ${panStart} ${baseY}`;
    for (let i = 1; i <= n; i++) {
      const cx = panStart + (panSpan * i) / (n + 1);
      d += ` L ${cx - r} ${baseY} C ${cx - r} ${baseY - 6} ${cx + r} ${baseY - 6} ${cx + r} ${baseY}`;
    }
    d += ` L ${panEnd} ${baseY}`;
    ribTop = d;
  } else {
    ribTop = `M ${panStart} ${baseY} L ${panEnd} ${baseY}`;
  }

  return { w, h, left, right, ribTop, ribShade, panStart, panEnd, baseY, thick };
}

function profileSearchUrl(profile) {
  const code = PROFILE_INFO[profile]?.code || profile;
  return `https://newtechmachinery.com/?s=${encodeURIComponent(code)}`;
}

/* ---------------------------------- panel catalog (vendor menu) ---------------------------------- */

// McElroy-style isometric rendering of a panel: an oblique-projected extrusion of a
// simplified full-width cross-section. Length runs lower-left → upper-right, width
// recedes down-right, seam height rises straight up. Painter's order: extruded strips
// far → near, then a sheen sweep along the length, then the near cut edge on top.
// Geometry is exaggerated for thumbnail legibility, same trade-off as the old
// cross-section drawing — the fold SHAPE matters more than true scale.
function generatePanelIsoSvg(profileLabel, ribStyle, idSuffix) {
  const family = PROFILE_INFO[profileLabel]?.family || "mech";
  const seamMatch = profileLabel.match(/(\d+(\.\d+)?)"/);
  const seamIn = Math.max(1.0, Math.min(2.6, seamMatch ? parseFloat(seamMatch[1]) : 1.5));

  // Cross-section in inches: u across the panel (0 = far seam edge), v above the pan.
  const W = 16;
  const sec = [];
  const S = (u, v) => sec.push([u, v]);
  if (family === "batten") {
    S(0, 0); S(0, seamIn); S(1.6, seamIn); S(1.6, 0); S(2.0, 0);
  } else if (family === "trapezoid") {
    S(0, 0); S(0.9, seamIn); S(2.1, seamIn); S(3.0, 0);
  } else if (family === "flush" || family === "flange") {
    S(0, 0); S(0, 0.55); S(0.5, 0.55); S(0.5, 0); S(1.0, 0);
  } else if (family === "mech" || family === "mecharmco") {
    S(0, 0); S(0, seamIn); S(0.75, seamIn); S(0.75, seamIn * 0.62); S(1.05, seamIn * 0.62); S(1.05, 0);
  } else { // snap / snapbump / newlock
    S(0, 0); S(0, seamIn); S(0.85, seamIn); S(0.85, seamIn * 0.72); S(0.55, seamIn * 0.72); S(0.55, 0);
  }
  const panStart = sec[sec.length - 1][0];
  const span = W - panStart;
  if (ribStyle === "bead") {
    [0.33, 0.62].forEach((f) => {
      const c = panStart + span * f;
      S(c - 0.55, 0); S(c - 0.35, 0.16); S(c + 0.35, 0.16); S(c + 0.55, 0);
    });
  } else if (ribStyle === "pencil") {
    [0.28, 0.5, 0.72].forEach((f) => { const c = panStart + span * f; S(c - 0.4, 0); S(c, 0.14); S(c + 0.4, 0); });
  } else if (ribStyle === "v") {
    [0.36, 0.64].forEach((f) => { const c = panStart + span * f; S(c - 0.4, 0); S(c, -0.16); S(c + 0.4, 0); });
  } else if (ribStyle === "striations") {
    const n = 14;
    for (let i = 1; i < n; i++) {
      const u = panStart + (span * i) / n;
      S(u - span / (n * 4), 0); S(u, i % 2 ? 0.05 : -0.05); S(u + span / (n * 4), 0);
    }
  }
  S(W, 0);

  // Projection: screen = O + u*A + v*V + t*B  (u,v in inches; t 0..1 along the length).
  const w = 300, h = 210, SC = 10.2;
  const A = [0.60 * SC, 0.335 * SC];
  const V = [-0.08 * SC, -1.35 * SC];
  const B = [176, -102];
  const O = [26, 180];
  const px = (u, v, t) => (O[0] + u * A[0] + v * V[0] + t * B[0]).toFixed(1);
  const py = (u, v, t) => (O[1] + u * A[1] + v * V[1] + t * B[1]).toFixed(1);

  // Lighting by strip orientation: flat pan bright, seam side-walls dark, back-facing
  // folds darker still — that contrast is what makes the fold shape read at card size.
  const BASE_H = 208, BASE_S = 40;
  const shade = (du, dv) => {
    const flat = Math.abs(du) / (Math.abs(du) + Math.abs(dv) * 2.2 + 1e-6);
    const facing = du >= 0 ? 1 : 0.55;
    return `hsl(${BASE_H} ${BASE_S}% ${(30 + flat * 34 * facing).toFixed(0)}%)`;
  };

  let strips = "";
  for (let i = 0; i < sec.length - 1; i++) {
    const [u1, v1] = sec[i], [u2, v2] = sec[i + 1];
    if (u1 === u2 && v1 === v2) continue;
    strips += `<polygon points="${px(u1, v1, 0)},${py(u1, v1, 0)} ${px(u2, v2, 0)},${py(u2, v2, 0)} ${px(u2, v2, 1)},${py(u2, v2, 1)} ${px(u1, v1, 1)},${py(u1, v1, 1)}" fill="${shade(u2 - u1, v2 - v1)}"/>`;
  }

  const TH = 0.16;
  const edgeTop = sec.map(([u, v]) => `${px(u, v, 0)},${py(u, v, 0)}`).join(" ");
  const edgeBot = sec.slice().reverse().map(([u, v]) => `${px(u, v - TH, 0)},${py(u, v - TH, 0)}`).join(" ");
  const edge = `<polygon points="${edgeTop} ${edgeBot}" fill="hsl(${BASE_H} ${BASE_S + 6}% 20%)"/>`;

  // Gradient ids must be unique per rendered SVG or same-page cards bleed into each other.
  const gid = `pcs${(PROFILE_INFO[profileLabel]?.code || "x")}${ribStyle || "none"}${idSuffix || ""}`;
  const panQuad = `${px(0, 0, 0)},${py(0, 0, 0)} ${px(W, 0, 0)},${py(W, 0, 0)} ${px(W, 0, 1)},${py(W, 0, 1)} ${px(0, 0, 1)},${py(0, 0, 1)}`;
  const sheen = `<defs><linearGradient id="${gid}" x1="0" y1="1" x2="1" y2="0">` +
    `<stop offset="0.15" stop-color="#fff" stop-opacity="0"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.22"/>` +
    `<stop offset="0.62" stop-color="#fff" stop-opacity="0.05"/><stop offset="1" stop-color="#fff" stop-opacity="0.16"/>` +
    `</linearGradient></defs><polygon points="${panQuad}" fill="url(#${gid})"/>`;

  const shadow = `<ellipse cx="${w * 0.52}" cy="${h * 0.92}" rx="${w * 0.44}" ry="8" fill="rgba(0,0,0,0.10)"/>`;

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${shadow}${strips}${sheen}${edge}</svg>`;
}

// Which vendor's lineup each catalog section shows, and where that vendor is, so a
// contractor browsing panels sees who offers what and how far away they are.
// Coordinates are city-center approximations for the distance estimate — edit the
// profiles arrays here as vendor lineups change.
const PANEL_VENDORS = [
  {
    id: "fortified", name: "Fortified Metal", tagline: "Rolled in-house on our own machines",
    city: "Sherman", state: "TX", lat: 33.6357, lng: -96.6089, // 605 E Mulberry St, Sherman, TX (per the shop)
    profiles: PROFILES.filter((p) => !PROFILE_INFO[p].vendor),
  },
  {
    id: "adax", name: "Adax Metals", tagline: "Licensed Ultra Seam profiles",
    city: "Weatherford", state: "TX", lat: 32.7593, lng: -97.7972, // 1901 B Mineral Wells Hwy, Weatherford, TX 76088
    profiles: PROFILES.filter((p) => PROFILE_INFO[p].vendor === "adax"),
  },
];

function distanceMiles(a, b) {
  const R = 3958.8, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}


const COLORS_BY_BRAND = {
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

const TRIM_PRESETS = {
  // Eave / drip edge: ~3" roof-deck flange, 2" fascia drop, small hemmed drip lip
  "Eave": [[0, 0], [3, 0], [3, 2], [3.6, 2.1]],
  // Rake / gable trim: taller roof-side and fascia legs (~5.5" each), small hemmed edge
  "Rake": [[0, 0], [5.5, 0], [5.5, 5.5], [6, 5.6]],
  // Ridge cap: symmetric tent over the peak with hemmed drip edges on both sides
  "Ridge Cap": [[0, 1], [0, 0], [6, -3], [12, 0], [12, 1]],
  // Sidewall flashing: small kickout, roof leg, wall leg, hemmed top edge
  "Sidewall Flashing": [[-0.375, 0.25], [0, 0], [4, 0], [4, -4], [4.5, -4.1]],
  "F-Channel": [[0, 0], [0, 10.5], [7, 10.5], [7, 4], [10, 4], [10, 0]],
  "Z-Bar": [[0, 0], [0, 7.5], [6, 1.5], [6, 9]],
  "Custom": [[0, 0], [0, 6]],
};

const STATUS_FLOW = ["Pending", "In Production", "Ready for Pickup", "Completed"];
const RIB_LABELS = { bead: "Bead Ribs", pencil: "Pencil Ribs", v: "V Ribs", striations: "Striations" };
const PART3D_LABELS = { collector: "Collector Box", scupper: "Scupper", chimney: "Chimney Cap" };
const CAP_STYLE_LABELS = { pyramid: "Pyramid", stevenson: "Stevenson Top", texas: "Texas Top", chateau: "Chateau Cap" };

const ACCESSORY_TYPES = ["Screws", "Butyl Tape", "Pipe Boots", "Sealant", "Clips"];
const DRY_IN_TYPES = ["Underlayment", "Cap Nails", "High Temp Ice & Water"];
const ACCESSORY_SPECS = {
  Screws: ['1" XLP Screws', "DP1 Screws", "DP3 Screws"],
  "Butyl Tape": ['1" Butyl Tape', '3/8" Butyl Tape'],
  "Pipe Boots": ['1"', '1.5"', '2"', '3"', '4"', '5"', '6"', '7"', '8"'],
  Underlayment: ['Synthetic Underlayment — 42" × 1,000 sq ft roll'],
  "Cap Nails": ["Plastic Cap Nails (2,000/box)"],
  "High Temp Ice & Water": ["Palisade SA-HT — 2 sq roll"],
};
const STATUS_ICON = { Pending: Clock, "In Production": Hammer, "Ready for Pickup": PackageCheck, Completed: Truck };
const STATUS_COLOR = { Pending: STEEL, "In Production": AMBER, "Ready for Pickup": INK, Completed: GREEN };

const SCALE = 13; // px per inch on the drawing canvas
const VB_W = 416, VB_H = 220; // inches shown: 32 x ~17

// Listed companies — each can supply metal, fabricate, or both. The in-app price
// list is Fortified's; picking someone else keeps the Fortified-rate estimate and
// flags that the final price comes from that company. Job-site mileage measures
// from the chosen fabricator's closest base.
const FAB_COMPANIES = [
  {
    name: "Fortified Metal",
    bases: [
      { name: "Sherman", lat: 33.6357, lng: -96.6089 }, // 605 E Mulberry, Sherman TX
      { name: "Plano", lat: 33.0255, lng: -96.7093 },   // 1851 Central Expressway, Plano TX
    ],
  },
  {
    name: "Adax Metals",
    bases: [{ name: "Weatherford", lat: 32.7593, lng: -97.7972 }],
  },
];
const MILEAGE_FREE = 40, MILEAGE_RATE = 2;
const havMiles = (a, b, c, d) => {
  const r = (x) => (x * Math.PI) / 180;
  const s = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * 3959 * Math.asin(Math.sqrt(s));
};
const mileageCharge = (miles) => Math.max(0, (+miles || 0) - MILEAGE_FREE) * MILEAGE_RATE;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const snap = (v, step = 0.05) => Math.round(v / step) * step;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const money = (n) => `$${n.toFixed(2)}`;

function bendAngle(prev, cur, next) {
  const v1 = [prev[0] - cur[0], prev[1] - cur[1]];
  const v2 = [next[0] - cur[0], next[1] - cur[1]];
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const m1 = Math.hypot(...v1), m2 = Math.hypot(...v2);
  if (m1 === 0 || m2 === 0) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  return Math.round(180 - (Math.acos(cos) * 180) / Math.PI);
}

// Most brands have one flat color list. Some (Quality Metals, currently delisted) have
// different palettes for PVDF vs SMP, stored as { pvdf: [...], smp: [...] } instead —
// this always returns a flat array either way.
function getColorsForBrand(brand, paintId) {
  const entry = COLORS_BY_BRAND[brand];
  if (!entry) return [];
  if (Array.isArray(entry)) return entry;
  return entry[paintId] || entry.pvdf || entry.smp || [];
}

function findColor(name, brand, paintId) {
  const preferred = getColorsForBrand(brand, paintId).find((c) => c.name === name);
  if (preferred) return preferred;
  for (const entry of Object.values(COLORS_BY_BRAND)) {
    const lists = Array.isArray(entry) ? [entry] : Object.values(entry);
    for (const list of lists) {
      const hit = list.find((c) => c.name === name);
      if (hit) return hit;
    }
  }
  return null;
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

// Plain-language description of how a match differs from the reference color —
// lighter/darker, warmer/cooler, more muted/richer — instead of a fabricated precision
// percentage the underlying hex estimates can't actually support.
// Classifies a color into an everyday color word, the same way a person would
// describe it out loud — "black," "brown," "gray" — not a technical hue/saturation term.
function colorFamilyName(h, s, l) {
  if (l < 0.13) return "black";
  if (l > 0.92) return "white";
  if (s < 0.14) return l < 0.35 ? "dark gray" : l < 0.7 ? "gray" : "light gray";
  if (h < 20 || h >= 345) return "red";
  if (h < 45) return l < 0.4 ? "brown" : "orange";
  if (h < 65) return "tan";
  if (h < 170) return "green";
  if (h < 200) return "teal";
  if (h < 250) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

function describeColorShift(hexRef, hexMatch) {
  const ref = hexToHsl(hexRef), m = hexToHsl(hexMatch);
  const refFamily = colorFamilyName(ref.h, ref.s, ref.l);
  const matchFamily = colorFamilyName(m.h, m.s, m.l);
  const dl = m.l - ref.l;
  const parts = [];
  if (Math.abs(dl) > 0.05) parts.push(dl > 0 ? "Lighter" : "Darker");
  if (matchFamily !== refFamily) parts.push(`leans more ${matchFamily}`);
  if (parts.length === 0) return "Nearly identical tone";
  return parts.join(", ");
}

// Simple weighted Euclidean distance in RGB space — cheap to compute and good enough
// for "which of these is visually closest" ranking without needing a full Lab conversion.
function colorDistance(hexA, hexB) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

// Finds the closest-matching colors to a given hex from every OTHER brand — so if a
// customer's preferred color isn't available from one manufacturer, the shop can show
// the nearest equivalent from a different one instead of just saying "we don't have that."
function findSimilarColorsAcrossBrands(hex, excludeBrand, limit = 8) {
  const results = [];
  for (const [brandName, entry] of Object.entries(COLORS_BY_BRAND)) {
    if (brandName === excludeBrand) continue;
    const isNested = !Array.isArray(entry);
    const colorGroups = isNested ? Object.entries(entry) : [[null, entry]];
    for (const [paintKey, colors] of colorGroups) {
      for (const c of colors) {
        results.push({ brand: brandName, name: c.name, hex: c.hex, premium: c.premium, paintId: paintKey, distance: colorDistance(hex, c.hex) });
      }
    }
  }
  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, limit);
}

// Gauge IDs (e.g. "24ga") are reused across different material option sets with different
// prices, so lookup has to pick the right set by brand FIRST, then find within it — a plain
// id-only search would silently match the wrong table.
function findGauge(gaugeId, brand) {
  const set = brand === "Copper" ? COPPER_WEIGHT_OPTIONS
    : brand === "G90 Galvanized" ? G90_GAUGE_OPTIONS
    : brand === "Galvalume" ? GALVALUME_GAUGE_OPTIONS
    : brand === "Bonderized" ? BONDERIZED_GAUGE_OPTIONS
    : GAUGE_OPTIONS;
  return set.find((g) => g.id === gaugeId) || set[0] || GAUGE_OPTIONS[0];
}

// Rolls a job's line items up into "what raw stock do I need to pull to run this job":
// how many flat sheets (by size), and how much coil (by width, in linear feet).
// Panel orders don't store their own coil width directly, so it's derived from the
// profile's takeup the same way the order form itself computes it.
// Formats a dimension without unnecessary trailing zeros: 4.00 -> "4", 16.50 -> "16.5",
// 20.875 -> "20.88" (still rounds to 2 decimals, just doesn't pad with zeros).
function formatDim(n) {
  return (+n).toFixed(2).replace(/\.?0+$/, "");
}

// Formats a length given in inches as feet + leftover inches: 126 -> "10' 6"", 120 -> "10'".
function formatFeetInches(totalInches) {
  const totalIn = Math.round(+totalInches || 0);
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn % 12;
  return inch === 0 ? `${ft}'` : `${ft}' ${inch}"`;
}

// Renders a trim profile as a plain, static SVG string (not the interactive drawing
// tool) for print/export — clean outline with length labels at each segment.
function generateProfileSvgString(points, colorHex) {
  if (!points || points.length < 2) return "";
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 30, w = 480, h = 320;
  const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const toSvg = ([x, y]) => [(x - minX) * scale + pad, (y - minY) * scale + pad];
  const pathPts = points.map(toSvg);
  const pathD = pathPts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  let labels = "";
  for (let i = 1; i < points.length; i++) {
    const len = dist(points[i - 1], points[i]);
    const mx = (pathPts[i - 1][0] + pathPts[i][0]) / 2;
    const my = (pathPts[i - 1][1] + pathPts[i][1]) / 2;
    labels += `<text x="${mx.toFixed(1)}" y="${(my - 8).toFixed(1)}" font-size="11" text-anchor="middle" font-family="monospace" fill="#333">${len.toFixed(2)}"</text>`;
  }
  const dotSvg = pathPts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${colorHex || "#333"}" />`).join("");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="background:#fff;border:1px solid #ddd;border-radius:8px;">
    <path d="${pathD}" fill="none" stroke="${colorHex || "#333"}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    ${dotSvg}
    ${labels}
  </svg>`;
}

// Opens a clean, printable spec sheet in a new tab and prompts the browser's native
// print dialog — the person can "Save as PDF" from there. No PDF library needed or
// available in this environment, so this is the reliable cross-browser path.
function printPartAsPDF(item) {
  const svg = generateProfileSvgString(item.points, item.colorHex);
  const win = window.open("", "_blank");
  if (!win) { window.alert("Your browser blocked the print window — please allow popups for this site and try again."); return; }
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  win.document.write(`<!doctype html><html><head><title>${esc(item.name || "Trim Part")}</title>
    <style>
      body{font-family:system-ui,-apple-system,sans-serif;padding:28px;color:#1C1C1E;max-width:720px;margin:0 auto;}
      h1{font-size:20px;margin:0 0 2px;}
      .sub{color:#777;font-size:12px;margin-bottom:20px;}
      .row{display:flex;gap:28px;margin-top:12px;flex-wrap:wrap;}
      .details div{margin-bottom:7px;font-size:13px;}
      .details b{display:inline-block;width:130px;color:#555;}
      img.ref{max-width:260px;border-radius:8px;border:1px solid #ddd;margin-top:14px;display:block;}
      .printbtn{margin-top:28px;padding:11px 22px;background:#D4AF37;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;}
      @media print { .printbtn{display:none;} }
    </style></head><body>
    <h1>${esc(item.name || "Trim Part")}</h1>
    <div class="sub">Fortified Sheet Metal — Order Spec Sheet</div>
    <div class="row">
      <div>${svg}</div>
      <div class="details">
        <div><b>Quantity</b>${esc(item.quantity)}</div>
        <div><b>Length / piece</b>${esc(item.lengthPerPiece)} ft</div>
        <div><b>Girth</b>${item.girth != null ? item.girth.toFixed(2) : "—"}"</div>
        <div><b>Brand</b>${esc(item.brand)}</div>
        <div><b>Color</b>${esc(item.colorName)}</div>
        <div><b>Paint side</b>${item.paintSide === "left" ? "Left" : "Right"}</div>
        <div><b>Start hem</b>${esc(item.hemStart)}</div>
        <div><b>End hem</b>${esc(item.hemEnd)}</div>
        ${item.photo ? `<img class="ref" src="${item.photo}" />` : ""}
      </div>
    </div>
    <button class="printbtn" onclick="window.print()">Print / Save as PDF</button>
  </body></html>`);
  win.document.close();
}

function computeJobMaterials(items) {
  const flatSheets = new Map(); // "widthxlength-brand-color" -> { width, length, count, brand, colorName, colorHex }
  const coilByWidth = new Map(); // "width-brand-color" -> { width, feet, brand, colorName, colorHex }
  const accByLabel = new Map(); // accessory label -> { label, qty, pos }

  const addCoil = (widthIn, feet, o) => {
    if (!widthIn || !feet) return;
    const w = Math.round(widthIn * 100) / 100;
    const key = `${w}-${o.brand}-${o.colorName}`;
    const existing = coilByWidth.get(key);
    if (existing) { existing.feet += feet; if (o.poNumber) existing.pos.add(o.poNumber); }
    else coilByWidth.set(key, { key, width: widthIn, feet, brand: o.brand, colorName: o.colorName, colorHex: o.colorHex, pos: new Set(o.poNumber ? [o.poNumber] : []) });
  };
  const addFlatSheets = (widthIn, lengthIn, count, o) => {
    if (!widthIn || !lengthIn || !count) return;
    const w = Math.round(widthIn * 100) / 100, l = Math.round(lengthIn * 100) / 100;
    const key = `${w}x${l}-${o.brand}-${o.colorName}`;
    const existing = flatSheets.get(key);
    if (existing) { existing.count += count; if (o.poNumber) existing.pos.add(o.poNumber); }
    else flatSheets.set(key, { key, width: widthIn, length: lengthIn, count, brand: o.brand, colorName: o.colorName, colorHex: o.colorHex, pos: new Set(o.poNumber ? [o.poNumber] : []) });
  };

  for (const o of items) {
    if (Array.isArray(o.accessories)) {
      for (const a of o.accessories) {
        const existing = accByLabel.get(a.label);
        if (existing) { existing.qty += +a.qty || 0; if (o.poNumber) existing.pos.add(o.poNumber); }
        else accByLabel.set(a.label, { key: a.label, label: a.label, qty: +a.qty || 0, pos: new Set(o.poNumber ? [o.poNumber] : []) });
      }
    }
    if (o.type === "metal") {
      if (o.flatWidth && o.flatLength) addFlatSheets(o.flatWidth, o.flatLength, +o.quantity || 0, o);
      if (o.coilWidth && o.coilLength) addCoil(o.coilWidth, o.coilLength / 12, o);
    } else if (o.type === "panel") {
      const takeup = PROFILE_INFO[o.profile]?.takeup || 0;
      const coilWidthIn = (+o.width || 0) + takeup;
      const feet = ((+o.height || 0) / 12) * (+o.quantity || 0);
      addCoil(coilWidthIn, feet, o);
    } else if (o.type === "trim") {
      // Trim is nested and cut across flat sheet stock, not fed from a coil — the order
      // form already works out how many sheets that takes (partsPerSheet/sheetsNeeded),
      // so reuse that instead of recomputing it differently here.
      const sheetsNeeded = +o.sheetsNeeded || 0;
      if (sheetsNeeded > 0) {
        addFlatSheets(+o.sheetWidth || 0, (+o.lengthPerPiece || 0) * 12, sheetsNeeded, o);
      }
    }
    // 3D parts aren't included — their flat-pattern material need isn't tracked per
    // order the same way panels/trim/flats are, so they're left out of this rollup
    // rather than guessed at.
  }

  return {
    flatSheets: [...flatSheets.values()].map((f) => ({ ...f, pos: [...f.pos].sort() })).sort((a, b) => b.count - a.count),
    coil: [...coilByWidth.values()].map((c) => ({ ...c, pos: [...c.pos].sort() })).sort((a, b) => b.feet - a.feet),
    accessories: [...accByLabel.values()].map((a) => ({ ...a, pos: [...a.pos].sort() })).sort((a, b) => b.qty - a.qty),
  };
}

/* ---------------------------------- pricing ---------------------------------- */
// Pulls live sell rates from the Price List (Greenleaf tier) instead of the old
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
function coilPriceForWidth(widthIn, scale) {
  if (!scale || scale.length === 0 || !widthIn) return null;
  const sorted = [...scale].sort((a, b) => a.width - b.width);
  const bracket = sorted.find((p) => widthIn <= p.width) || sorted[sorted.length - 1];
  return Math.max(0, bracket.pricePerFt);
}

// Fabrication $/LF from the Price List — a profile-specific row (name starting with
// the profile code, e.g. "FWQ100 Fabrication") beats the generic "Panel Fabrication".
function findFabItem(priceList, profile) {
  const fabItems = (priceList || []).filter((p) => p.category === "Roof Panel" && p.name.toLowerCase().includes("fabrication") && typeof p.greenleaf === "number");
  const code = profile ? profile.split(" ")[0].toLowerCase() : "";
  return (code && fabItems.find((p) => p.name.toLowerCase().startsWith(code))) || fabItems.find((p) => p.name.toLowerCase().startsWith("panel")) || fabItems[0] || null;
}

function getSellRates(gaugeId, brand, priceList, profile) {
  const gauge = findGauge(gaugeId, brand);
  const fallback = { coilSqft: gauge.panelSqft, panelSqft: gauge.panelSqft, fabSqft: 0, trimFt: gauge.trimFt };
  if (!priceList || priceList.length === 0) return fallback;

  if (brand === "Copper") {
    const item = priceList.find((p) => p.category === "Copper" && p.name.toLowerCase().includes(gauge.label.toLowerCase()) && typeof p.greenleaf === "number");
    const coilSqft = item ? item.greenleaf : fallback.coilSqft;
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
  const coilItem = priceList.find((p) => p.category === "Roof Panel" && p.name.startsWith(gaugeLabel) && typeof p.greenleaf === "number");
  const fabItem = findFabItem(priceList, profile);
  const trimItem = priceList.find((p) => p.category === "Trim / Flashing" && p.name.startsWith(gaugeLabel) && typeof p.greenleaf === "number");

  const coilWidthIn = coilItem?.coverageWidth || 12;
  const coilSqft = coilItem ? coilItem.greenleaf / (coilWidthIn / 12) : fallback.coilSqft;
  const fabSqft = fabItem ? fabItem.greenleaf / (coilWidthIn / 12) : 0;
  const panelSqft = coilSqft + fabSqft;
  const trimFt = trimItem ? trimItem.greenleaf : fallback.trimFt;
  return { coilSqft, panelSqft, fabSqft, trimFt };
}

function computePrice(order, priceList, coilWidthScale) {
  const rates = getSellRates(order.gaugeId, order.brand, priceList, order.profile);
  const paint = order.brand === "Copper" ? { mult: 1 } : (PAINT_OPTIONS.find((p) => p.id === order.paintId) || PAINT_OPTIONS[0]);
  const colorObj = findColor(order.colorName, order.brand, order.paintId);
  const premiumMult = colorObj?.premium ? 1.12 : 1;
  if (order.type === "metal") {
    const flatSqft = ((order.flatWidth || 0) * (order.flatLength || 0)) / 144;
    // Flat sheets price as material ($/sq ft) + a flat processing fee per sheet, pulled
    // from the Price List's "Flat Sheet Material" / "Flat Sheet Processing" items —
    // falls back to the old gauge-derived rate (material only, no processing fee) if
    // those items aren't in the Price List.
    const flatMaterialItem = priceList?.find((p) => p.name.toLowerCase().includes("flat sheet material") && typeof p.greenleaf === "number");
    const flatProcessingItem = priceList?.find((p) => p.name.toLowerCase().includes("flat sheet processing") && typeof p.greenleaf === "number");
    const flatMaterialRate = flatMaterialItem ? flatMaterialItem.greenleaf : rates.coilSqft;
    const flatProcessingFee = flatProcessingItem ? flatProcessingItem.greenleaf : 0;
    const flatCost = (flatSqft * flatMaterialRate * paint.mult + flatProcessingFee) * order.quantity;
    // Coil pricing prefers the real interpolated width scale (actual supplier price
    // points) over the flat derived $/sqft rate, since coil doesn't price out linearly
    // with width in the real world — falls back to the flat rate if there aren't at
    // least 2 scale points to interpolate between. The scale points themselves are
    // PVDF pricing, so they apply as-is for PVDF orders and get scaled down by the
    // PVDF/SMP ratio for SMP orders, rather than getting the PVDF multiplier stacked
    // on top of an already-PVDF price.
    const interpolatedPerFt = coilPriceForWidth(order.coilWidth, coilWidthScale);
    const pvdfMult = PAINT_OPTIONS.find((p) => p.id === "pvdf")?.mult || 1;
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
      const slant = Math.sqrt((Math.max(W, D) / 2) ** 2 + CH ** 2);
      sqin = 2 * (W + D) * H + 2 * (W + D) * slant + W * D * 1.25; // walls + hip cap + base skirt allowance
    } else {
      sqin = 2 * (W + D) * H + W * D; // walls + bottom
    }
    const sqft = sqin / 144;
    const fabItemName = order.partType === "collector" ? "collector box" : order.partType === "scupper" ? "scupper" : "chimney cap";
    const fabItem = priceList?.find((p) => p.category === "3D Parts" && p.name.toLowerCase().includes(fabItemName) && typeof p.greenleaf === "number");
    const formingFee = fabItem ? fabItem.greenleaf : 12; // per-piece fee for the extra seams/folds vs a flat panel
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

/* ---------------------------------- shape thumbnail ---------------------------------- */
function ShapeThumb({ order, size = 64 }) {
  const pad = 6;
  if (order.type === "part3d") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z" fill="none" stroke={order.colorHex} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M12 2 L21 7 L12 12 L3 7 Z" fill={order.colorHex} fillOpacity="0.5" stroke={order.colorHex} strokeWidth="1.2" strokeLinejoin="round" />
        <line x1="12" y1="12" x2="12" y2="22" stroke={order.colorHex} strokeWidth="1.2" />
      </svg>
    );
  }
  if (order.type === "panel" || order.type === "metal") {
    const tw = order.type === "metal" ? (order.flatWidth || order.coilWidth || 1) : order.width;
    const th = order.type === "metal" ? (order.flatLength || order.coilLength || 1) : order.height;
    const ar = tw / th || 1;
    let w = size - pad * 2, h = w / ar;
    if (h > size - pad * 2) { h = size - pad * 2; w = h * ar; }
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <rect x={(size - w) / 2} y={(size - h) / 2} width={w} height={h}
          fill={order.colorHex} stroke={INK_DEEP} strokeWidth="1.5" />
      </svg>
    );
  }
  const pts = order.points || [[0, 0], [0, 1]];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(0.5, maxX - minX), h = Math.max(0.5, maxY - minY);
  const s = Math.min((size - pad * 2) / w, (size - pad * 2) / h);
  const offX = (size - w * s) / 2 - minX * s;
  const offY = (size - h * s) / 2 - minY * s;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0] * s + offX} ${p[1] * s + offY}`).join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <path d={d} fill="none" stroke={order.colorHex} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ---------------------------------- drawing canvas ---------------------------------- */
function parseHem(value) {
  if (!value || value === "none") return null;
  const [type, dir] = value.split("-");
  return { type, dir };
}
function formatHem(value) {
  const h = parseHem(value);
  if (!h) return null;
  const type = h.type === "open" ? "Open" : "Closed";
  const dir = h.dir.charAt(0).toUpperCase() + h.dir.slice(1);
  return `${type}, faces ${dir}`;
}
function unitVec(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const m = Math.hypot(dx, dy) || 1;
  return [dx / m, dy / m];
}
// One leg continues straight off the profile line; the other leg folds 180°
// back over it, offset to the chosen side. Touching = closed, spaced = open.
function hemGlyph(p, dir, side, isOpen, unit) {
  const sideMult = side === "left" ? 1 : -1;
  const perp = [-dir[1] * sideMult, dir[0] * sideMult];
  const L = 3.5 * unit;
  const gap = (isOpen ? 2 : 0.4) * unit;
  const r = gap / 2;
  const tip1 = [p[0] + dir[0] * L, p[1] + dir[1] * L];
  const tip2 = [tip1[0] + perp[0] * gap, tip1[1] + perp[1] * gap];
  const end2 = [tip2[0] - dir[0] * L, tip2[1] - dir[1] * L];
  const sweep = sideMult === 1 ? 1 : 0; // mirrored side needs the mirrored arc direction too
  const d = `M ${p[0]} ${p[1]} L ${tip1[0]} ${tip1[1]} A ${r} ${r} 0 0 ${sweep} ${tip2[0]} ${tip2[1]} L ${end2[0]} ${end2[1]}`;
  const labelPos = [tip1[0] + dir[0] * 2.5 * unit + perp[0] * (gap / 2), tip1[1] + dir[1] * 2.5 * unit + perp[1] * (gap / 2)];
  return { d, labelPos };
}

function TrimCanvas({ points, setPoints, colorHex, hemStart, hemEnd, paintSide, viewResetKey }) {
  const svgRef = useRef(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [zoom, setZoom] = useState(0.35); // 4 zoom-in clicks (0.2 each) from the standard 1.0, clamped at the 0.35 floor
  const [zoomCenter, setZoomCenter] = useState(null); // [x,y] override when zoomed into a specific leg
  const [mode, setMode] = useState("draw"); // "draw" | "select"
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [gridSpacing, setGridSpacing] = useState(3); // inches between dots
  const [angleVisibility, setAngleVisibility] = useState("all"); // "all" | "hide90" | "hideAll"
  const [showSettings, setShowSettings] = useState(false);
  const [unitSystem, setUnitSystem] = useState("imperial"); // "imperial" | "metric" — display only, data always stays in inches

  // Formats a length in inches for display, switching to mm when metric is selected.
  const formatLen = (inches) => (unitSystem === "metric" ? `${Math.round(inches * 25.4)}mm` : `${inches.toFixed(2)}"`);

  // When a preset is loaded, reset to a neutral zoom. Sizing itself is now handled by
  // the proportional margin above (scales with each shape's own size), so every preset
  // — small or large — fills the frame consistently without needing a guessed zoom value.
  useEffect(() => {
    setZoom(1);
    setZoomCenter(null);
  }, [viewResetKey]);

  const toUser = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM().inverse();
    const loc = pt.matrixTransform(ctm);
    return [snap(loc.x), snap(loc.y)];
  }, []);

  const lastAddRef = useRef(0);
  const handleBgDown = (e) => {
    if (dragIdx !== null) return;
    if (mode === "select") { setSelectedIdx(null); return; }
    const now = Date.now();
    if (now - lastAddRef.current < 220) return; // debounce — stops one tap from registering as several points
    lastAddRef.current = now;
    const [x, y] = toUser(e.clientX, e.clientY);
    setPoints((p) => {
      if (p.length === 0) return [[x, y]];
      const last = p[p.length - 1];
      const dx = Math.abs(x - last[0]), dy = Math.abs(y - last[1]);
      // Keep the new segment a straight horizontal or vertical line off the last point.
      const next = dx >= dy ? [x, last[1]] : [last[0], y];
      return [...p, next];
    });
  };

  const editSegmentLength = (i) => {
    const current = dist(points[i - 1], points[i]);
    const unitLabel = unitSystem === "metric" ? "mm" : "inches";
    const promptDefault = unitSystem === "metric" ? Math.round(current * 25.4).toString() : current.toFixed(2);
    const input = window.prompt(`Exact length for this segment (${unitLabel}):`, promptDefault);
    if (input === null) return;
    const raw = parseFloat(input);
    if (!isFinite(raw) || raw <= 0) return;
    const val = unitSystem === "metric" ? raw / 25.4 : raw; // always store in inches internally
    const dir = unitVec(points[i - 1], points[i]);
    setPoints((pts) => pts.map((pt, idx) => (idx === i
      ? [pts[i - 1][0] + dir[0] * val, pts[i - 1][1] + dir[1] * val]
      : pt)));
  };

  const editAngle = (i) => {
    const prev = points[i - 1], cur = points[i], next = points[i + 1];
    const current = bendAngle(prev, cur, next);
    const input = window.prompt("Exact bend angle at this point (degrees):", current.toFixed(1));
    if (input === null) return;
    const desired = parseFloat(input);
    if (!isFinite(desired) || desired < 0 || desired > 180) return;

    const v1 = unitVec(cur, prev); // direction cur -> prev, held fixed
    const v2 = unitVec(cur, next); // direction cur -> next, to be rotated
    const cross = v1[0] * v2[1] - v1[1] * v2[0];
    const dot = Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1]));
    const signedCurrent = Math.atan2(cross, dot); // radians, current signed angle from v1 to v2
    const sign = signedCurrent === 0 ? 1 : Math.sign(signedCurrent);
    const desiredBetween = (180 - desired) * (Math.PI / 180); // unsigned angle between v1 and v2'
    const theta = sign * desiredBetween;
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    const v2x = v1[0] * cosT - v1[1] * sinT;
    const v2y = v1[0] * sinT + v1[1] * cosT;
    const L = dist(cur, next);
    const newNext = [cur[0] + v2x * L, cur[1] + v2y * L];
    setPoints((pts) => pts.map((pt, idx) => (idx === i + 1 ? newNext : pt)));
  };

  const dragStartRef = useRef(null); // { pointerX, pointerY, origPoint } — used to dampen drag sensitivity
  const handlePointDown = (i) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    e.target.setPointerCapture?.(e.pointerId);
    setDragIdx(i);
    setSelectedIdx(i);
    const [ux, uy] = toUser(e.clientX, e.clientY);
    dragStartRef.current = { startUx: ux, startUy: uy, origPoint: [...points[i]] };
  };

  const DRAG_DAMPING = 0.51; // lower = slower/finer point movement relative to actual finger/mouse motion
  const handleMove = (e) => {
    if (dragIdx === null) return;
    e.preventDefault();
    const [ux, uy] = toUser(e.clientX, e.clientY);
    const start = dragStartRef.current;
    if (!start) return;
    const dx = (ux - start.startUx) * DRAG_DAMPING;
    const dy = (uy - start.startUy) * DRAG_DAMPING;
    const x = snap(start.origPoint[0] + dx);
    const y = snap(start.origPoint[1] + dy);
    setPoints((p) => p.map((pt, i) => (i === dragIdx ? [x, y] : pt)));
  };

  // Auto-fit & recenter the view around whatever has been drawn so far,
  // so the whole profile is always fully visible. Margin scales with the shape's own
  // size (not a fixed number of inches), so a tiny preset and a large one both end up
  // looking similarly "filled" instead of one being cramped and the other swimming
  // in empty space.
  const xs = points.length ? points.map((p) => p[0]) : [0];
  const ys = points.length ? points.map((p) => p[1]) : [0];
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  const contentSize = Math.max(maxX - minX, maxY - minY, 0.5);
  const PAD = Math.max(0.6, contentSize * 0.18);
  const MIN_W = Math.max(2.5, contentSize * 0.25), MIN_H = Math.max(1.8, contentSize * 0.25);
  if (maxX - minX < MIN_W) { const c = (minX + maxX) / 2; minX = c - MIN_W / 2; maxX = c + MIN_W / 2; }
  if (maxY - minY < MIN_H) { const c = (minY + maxY) / 2; minY = c - MIN_H / 2; maxY = c + MIN_H / 2; }
  const vbX = minX - PAD, vbY = minY - PAD, vbW = (maxX - minX) + PAD * 2, vbH = (maxY - minY) + PAD * 2;
  // Manual zoom scales the view around its own center (or a clicked leg's midpoint), on top of the auto-fit box.
  const cx = zoomCenter ? zoomCenter[0] : vbX + vbW / 2, cy = zoomCenter ? zoomCenter[1] : vbY + vbH / 2;
  const zVbW = vbW * zoom, zVbH = vbH * zoom;
  const zVbX = cx - zVbW / 2, zVbY = cy - zVbH / 2;
  const unit = zVbW / 100; // scales strokes/points/text relative to current zoom

  // Dot grid — reads as graph paper without the line clutter.
  const gridDots = [];
  const gStartX = Math.floor(zVbX / gridSpacing) * gridSpacing, gEndX = Math.ceil((zVbX + zVbW) / gridSpacing) * gridSpacing;
  const gStartY = Math.floor(zVbY / gridSpacing) * gridSpacing, gEndY = Math.ceil((zVbY + zVbH) / gridSpacing) * gridSpacing;
  for (let x = gStartX; x <= gEndX; x += gridSpacing) {
    for (let y = gStartY; y <= gEndY; y += gridSpacing) {
      gridDots.push(<circle key={`d${x}-${y}`} cx={x} cy={y} r={0.45 * unit} fill="rgba(255,255,255,0.45)" />);
    }
  }

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");

  return (
    <div style={{ position: "relative", userSelect: "none", WebkitUserSelect: "none", MozUserSelect: "none" }}>
      <div style={{ position: "absolute", top: 6, left: 6, zIndex: 2, display: "flex", flexDirection: "column", gap: 3 }}>
        <button type="button" onClick={() => setZoom((z) => Math.max(0.35, +(z - 0.2).toFixed(2)))}
          style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid rgba(255,255,255,0.4)", background: "rgba(10,43,65,0.85)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", lineHeight: 1 }}>
          +
        </button>
        <button type="button" onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))}
          style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid rgba(255,255,255,0.4)", background: "rgba(10,43,65,0.85)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", lineHeight: 1 }}>
          −
        </button>
      </div>
      <div style={{ position: "absolute", top: 6, right: 6, zIndex: 2, display: "flex", gap: 3 }}>
        <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid rgba(255,255,255,0.4)" }}>
          <button type="button" onClick={() => { setMode("draw"); setSelectedIdx(null); setZoomCenter(null); setZoom(0.35); }}
            style={{ padding: "4px 8px", fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer",
              background: mode === "draw" ? SAFETY : "rgba(10,43,65,0.85)", color: "#fff" }}>
            Draw
          </button>
          <button type="button" onClick={() => setMode("select")}
            style={{ padding: "4px 8px", fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer",
              background: mode === "select" ? SAFETY : "rgba(10,43,65,0.85)", color: "#fff" }}>
            Select
          </button>
        </div>
        <button type="button" onClick={() => setShowSettings((s) => !s)}
          style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid rgba(255,255,255,0.4)", background: "rgba(10,43,65,0.85)", color: "#fff", fontSize: 12, cursor: "pointer", lineHeight: 1 }}>
          ⚙
        </button>
      </div>
      {showSettings && (
        <div style={{
          position: "absolute", top: 34, right: 6, zIndex: 3, width: 190, background: "#0F2C3F", border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 8, padding: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 10, color: "#8FB4C9", fontWeight: 700, marginBottom: 4 }}>UNITS</div>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {[{ id: "imperial", label: "in / ft" }, { id: "metric", label: "mm" }].map((u) => (
              <button key={u.id} type="button" onClick={() => setUnitSystem(u.id)}
                style={{
                  flex: 1, padding: "5px 0", borderRadius: 5, fontSize: 10.5, cursor: "pointer",
                  border: `1px solid ${unitSystem === u.id ? SAFETY : "rgba(255,255,255,0.3)"}`,
                  background: unitSystem === u.id ? SAFETY : "transparent", color: "#fff", fontWeight: 600,
                }}>
                {u.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: "#8FB4C9", fontWeight: 700, marginBottom: 4 }}>GRID SPACING</div>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {[3, 6, 12].map((g) => (
              <button key={g} type="button" onClick={() => setGridSpacing(g)}
                style={{
                  flex: 1, padding: "5px 0", borderRadius: 5, fontSize: 10.5, cursor: "pointer",
                  border: `1px solid ${gridSpacing === g ? SAFETY : "rgba(255,255,255,0.3)"}`,
                  background: gridSpacing === g ? SAFETY : "transparent", color: "#fff", fontWeight: 600,
                }}>
                {g}"
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: "#8FB4C9", fontWeight: 700, marginBottom: 4 }}>ANGLE VISIBILITY</div>
          {[
            { id: "all", label: "Show all" },
            { id: "hide90", label: "Hide 90°" },
            { id: "hideAll", label: "Hide 45°, 90°, 135°" },
          ].map((o) => (
            <button key={o.id} type="button" onClick={() => setAngleVisibility(o.id)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 5, fontSize: 10.5, cursor: "pointer", marginBottom: 3,
                border: `1px solid ${angleVisibility === o.id ? SAFETY : "rgba(255,255,255,0.3)"}`,
                background: angleVisibility === o.id ? "rgba(217,98,45,0.2)" : "transparent", color: "#fff",
              }}>
              {angleVisibility === o.id ? "✓ " : ""}{o.label}
            </button>
          ))}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`${zVbX} ${zVbY} ${zVbW} ${zVbH}`}
        onPointerDown={handleBgDown}
        onPointerMove={handleMove}
        onPointerUp={() => { setDragIdx(null); dragStartRef.current = null; }}
        style={{
          width: "100%", height: "auto", aspectRatio: `${zVbW} / ${zVbH}`, background: INK, borderRadius: 4,
          touchAction: "none", cursor: mode === "select" ? "default" : "crosshair", display: "block",
          userSelect: "none", WebkitUserSelect: "none", MozUserSelect: "none", WebkitTouchCallout: "none",
        }}
      >
      {gridDots}
      {points.length > 1 && (
        <path d={pathD} fill="none" stroke="#fff" strokeWidth={1.75 * unit} strokeLinejoin="round" strokeLinecap="round" />
      )}
      {points.length > 1 && points.slice(1).map((p, idx) => {
        const i = idx + 1;
        const prevPt = points[idx];
        const mid = [(prevPt[0] + p[0]) / 2, (prevPt[1] + p[1]) / 2];
        return (
          <line key={`hit${i}`} x1={prevPt[0]} y1={prevPt[1]} x2={p[0]} y2={p[1]}
            stroke="transparent" strokeWidth={6 * unit}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { setZoomCenter(mid); setZoom(0.5); editSegmentLength(i); }}
            style={{ cursor: "pointer" }} />
        );
      })}
      {/* Painted-side indicator: one small tag near the start, not a stripe down the whole path. */}
      {points.length > 1 && (() => {
        const prev = points[0], p = points[1];
        const dir = unitVec(prev, p);
        const sideMult = paintSide === "left" ? 1 : -1;
        const perp = [-dir[1] * sideMult, dir[0] * sideMult];
        const mx = prev[0] + dir[0] * Math.min(dist(prev, p) / 2, 3 * unit) + perp[0] * 4 * unit;
        const my = prev[1] + dir[1] * Math.min(dist(prev, p) / 2, 3 * unit) + perp[1] * 4 * unit;
        const r = 2.6 * unit;
        return (
          <g>
            <circle cx={mx} cy={my} r={r} fill={colorHex} stroke="#fff" strokeWidth={0.5 * unit} />
            <text x={mx} y={my} fill="#fff" fontSize={2.4 * unit} fontWeight="700" fontFamily="'IBM Plex Mono', monospace"
              textAnchor="middle" dominantBaseline="central">P</text>
          </g>
        );
      })()}
      {points.map((p, i) => {
        const prev = points[i - 1], next = points[i + 1];
        return (
          <g key={i}>
            {prev && (() => {
              const mx = (prev[0] + p[0]) / 2, my = (prev[1] + p[1]) / 2;
              const segLen = dist(prev, p);
              const label = formatLen(segLen);
              const fs = 3.4 * unit;
              const boxW = label.length * fs * 0.62 + fs * 0.9, boxH = fs * 1.6;
              // Always sit off the line (never directly on top of it) — with a thin
              // leader tick — so the actual line and its endpoints stay visible.
              const segDir = unitVec(prev, p);
              const perp = [-segDir[1], segDir[0]];
              const offset = boxH * 0.9;
              const lx = mx + perp[0] * offset, ly = my + perp[1] * offset;
              return (
                <g
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => editSegmentLength(i)}
                  style={{ cursor: "pointer" }}
                >
                  <line x1={mx} y1={my} x2={lx} y2={ly} stroke="rgba(255,255,255,0.5)" strokeWidth={0.25 * unit} />
                  <rect x={lx - boxW / 2} y={ly - boxH / 2} width={boxW} height={boxH} rx={boxH / 2}
                    fill={SAFETY} stroke={INK} strokeWidth={0.3 * unit} />
                  <text x={lx} y={ly} dy="0.35em" fill="#fff" fontSize={fs} fontWeight="700" fontFamily="'IBM Plex Mono', monospace"
                    textAnchor="middle">
                    {label}
                  </text>
                </g>
              );
            })()}
            {prev && next && (() => {
              const deg = bendAngle(prev, p, next);
              const isRightAngle = Math.abs(deg - 90) < 0.5;
              const isDiagonal = Math.abs(deg - 45) < 0.5 || Math.abs(deg - 135) < 0.5;
              if (angleVisibility === "hide90" && isRightAngle) return null;
              if (angleVisibility === "hideAll" && (isRightAngle || isDiagonal)) return null;
              const label = `${deg}°`;
              const fs = 2.8 * unit;
              const boxW = label.length * fs * 0.62 + fs * 0.7, boxH = fs * 1.5;
              const lx = p[0] + 8 * unit, ly = p[1] - 8 * unit;
              return (
                <g
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => editAngle(i)}
                  style={{ cursor: "pointer" }}
                >
                  <rect x={lx - boxW / 2} y={ly - boxH / 2} width={boxW} height={boxH} rx={boxH / 2}
                    fill={INK_DEEP} stroke={SAFETY} strokeWidth={0.25 * unit} />
                  <text x={lx} y={ly} dy="0.35em" fill={SAFETY} fontSize={fs} fontWeight="700" fontFamily="'IBM Plex Mono', monospace"
                    textAnchor="middle">
                    {label}
                  </text>
                </g>
              );
            })()}
            {(() => {
              const isStart = i === 0;
              const isEnd = points.length > 1 && i === points.length - 1;
              const hasHem = (isStart && hemStart !== "none") || (isEnd && hemEnd !== "none");
              const isSelected = mode === "select" && selectedIdx === i;
              return (
                <g>
                  {isSelected && (
                    <circle cx={p[0]} cy={p[1]} r={4.5 * unit} fill="none" stroke="#4EA8FF" strokeWidth={0.5 * unit}
                      strokeDasharray={`${1.2 * unit} ${1 * unit}`} />
                  )}
                  {hasHem ? (
                    <circle
                      cx={p[0]} cy={p[1]} r={3 * unit}
                      fill="transparent" stroke="none"
                      onPointerDown={handlePointDown(i)}
                      style={{ cursor: "grab", touchAction: "none" }}
                    />
                  ) : (
                    <circle
                      cx={p[0]} cy={p[1]} r={2.5 * unit}
                      fill={i === 0 ? SAFETY : "#fff"} stroke={INK_DEEP} strokeWidth={0.5 * unit}
                      onPointerDown={handlePointDown(i)}
                      style={{ cursor: "grab", touchAction: "none" }}
                    />
                  )}
                </g>
              );
            })()}
          </g>
        );
      })}
      {points.length === 0 && (
        <text x={zVbX + zVbW / 2} y={zVbY + zVbH / 2} fill="rgba(255,255,255,0.5)" fontSize={6 * unit} textAnchor="middle" fontFamily="Inter, sans-serif">
          Tap to place the first point of your profile
        </text>
      )}
      {points.length > 1 && hemStart !== "none" && (() => {
        const h = parseHem(hemStart);
        const dir = unitVec(points[1], points[0]); // continues the line back past the start
        const closed = h.type === "closed";
        const g = hemGlyph(points[0], dir, h.dir, !closed, unit);
        return (
          <g>
            <path d={g.d} fill={closed ? SAFETY : "none"} stroke={SAFETY}
              strokeWidth={(closed ? 1.8 : 0.9) * unit} strokeLinecap="round" strokeLinejoin="round" />
            <text x={g.labelPos[0]} y={g.labelPos[1]} fill={SAFETY} fontSize={3 * unit} fontWeight="700"
              fontFamily="'IBM Plex Mono', monospace" textAnchor="middle" dominantBaseline="central">
              {closed ? "CLOSED" : "OPEN"} {h.dir === "left" ? "L" : "R"}
            </text>
          </g>
        );
      })()}
      {points.length > 1 && hemEnd !== "none" && (() => {
        const h = parseHem(hemEnd);
        const last = points.length - 1;
        const dir = unitVec(points[last - 1], points[last]); // continues the line past the end
        const closed = h.type === "closed";
        const g = hemGlyph(points[last], dir, h.dir, !closed, unit);
        return (
          <g>
            <path d={g.d} fill={closed ? SAFETY : "none"} stroke={SAFETY}
              strokeWidth={(closed ? 1.8 : 0.9) * unit} strokeLinecap="round" strokeLinejoin="round" />
            <text x={g.labelPos[0]} y={g.labelPos[1]} fill={SAFETY} fontSize={3 * unit} fontWeight="700"
              fontFamily="'IBM Plex Mono', monospace" textAnchor="middle" dominantBaseline="central">
              {closed ? "CLOSED" : "OPEN"} {h.dir === "left" ? "L" : "R"}
            </text>
          </g>
        );
      })()}
    </svg>
    </div>
  );
}

function PanelProfileIcon({ family, colorHex }) {
  const W = 200, H = 70;
  const rib = (cx) => {
    if (family === "mech") {
      // tall standing seam rib with a folded double-lock cap
      return (
        <g key={cx}>
          <rect x={cx - 7} y={10} width={14} height={40} fill={colorHex} stroke={INK_DEEP} strokeWidth={1.5} />
          <circle cx={cx} cy={10} r={7} fill={colorHex} stroke={INK_DEEP} strokeWidth={1.5} />
        </g>
      );
    }
    if (family === "mecharmco") {
      // mechanical seam plus the extra ARMCO-style down leg
      return (
        <g key={cx}>
          <rect x={cx - 7} y={10} width={14} height={40} fill={colorHex} stroke={INK_DEEP} strokeWidth={1.5} />
          <circle cx={cx} cy={10} r={7} fill={colorHex} stroke={INK_DEEP} strokeWidth={1.5} />
          <rect x={cx + 7} y={38} width={6} height={12} fill={colorHex} stroke={INK_DEEP} strokeWidth={1.2} />
        </g>
      );
    }
    if (family === "snap") {
      // shorter snap-lock rib with a hook cap
      return (
        <g key={cx}>
          <path d={`M ${cx - 8} 50 L ${cx - 8} 26 Q ${cx - 8} 18 ${cx} 18 Q ${cx + 8} 18 ${cx + 8} 26 L ${cx + 8} 50`}
            fill={colorHex} stroke={INK_DEEP} strokeWidth={1.5} strokeLinejoin="round" />
        </g>
      );
    }
    if (family === "snapbump") {
      // snap-lock with the self-locking bump on the male leg
      return (
        <g key={cx}>
          <path d={`M ${cx - 8} 50 L ${cx - 8} 26 Q ${cx - 8} 18 ${cx} 18 Q ${cx + 8} 18 ${cx + 8} 26 L ${cx + 8} 50`}
            fill={colorHex} stroke={INK_DEEP} strokeWidth={1.5} strokeLinejoin="round" />
          <circle cx={cx - 8} cy={34} r={3} fill={INK_DEEP} />
        </g>
      );
    }
    if (family === "flange") {
      // snap-lock with a slotted fastener flange at the base
      return (
        <g key={cx}>
          <path d={`M ${cx - 8} 50 L ${cx - 8} 26 Q ${cx - 8} 18 ${cx} 18 Q ${cx + 8} 18 ${cx + 8} 26 L ${cx + 8} 50`}
            fill={colorHex} stroke={INK_DEEP} strokeWidth={1.5} strokeLinejoin="round" />
          <rect x={cx - 8} y={48} width={16} height={5} fill={colorHex} stroke={INK_DEEP} strokeWidth={1} />
        </g>
      );
    }
    if (family === "trapezoid") {
      // tall mechanical-seam trapezoid rib with anti-capillary leg
      return (
        <g key={cx}>
          <path d={`M ${cx - 16} 50 L ${cx - 9} 12 L ${cx + 9} 12 L ${cx + 16} 50`}
            fill={colorHex} stroke={INK_DEEP} strokeWidth={1.5} strokeLinejoin="round" />
          <circle cx={cx} cy={12} r={6} fill={colorHex} stroke={INK_DEEP} strokeWidth={1.5} />
        </g>
      );
    }
    if (family === "newlock") {
      // two-in-one: seam rib with a snap hook overlay
      return (
        <g key={cx}>
          <rect x={cx - 7} y={10} width={14} height={40} fill={colorHex} stroke={INK_DEEP} strokeWidth={1.5} />
          <path d={`M ${cx - 7} 24 Q ${cx - 14} 24 ${cx - 14} 32 Q ${cx - 14} 40 ${cx - 7} 40`}
            fill="none" stroke={INK_DEEP} strokeWidth={1.5} />
        </g>
      );
    }
    if (family === "batten") {
      // wide raised batten cover
      return (
        <path key={cx} d={`M ${cx - 14} 50 L ${cx - 10} 20 L ${cx + 10} 20 L ${cx + 14} 50`}
          fill={colorHex} stroke={INK_DEEP} strokeWidth={1.5} strokeLinejoin="round" />
      );
    }
    return null;
  };

  if (family === "flush") {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: INK, borderRadius: 4 }}>
        <rect x={4} y={30} width={W - 8} height={20} fill={colorHex} stroke={INK_DEEP} strokeWidth={1.5} />
        <line x1={W / 2} y1={30} x2={W / 2} y2={50} stroke={INK_DEEP} strokeWidth={1} />
      </svg>
    );
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: INK, borderRadius: 4 }}>
      <line x1={0} y1={50} x2={W} y2={50} stroke={colorHex} strokeWidth={3} />
      {[35, 100, 165].map(rib)}
    </svg>
  );
}

function PanelPreview({ width, height, colorHex }) {
  const pad = 40;
  const maxW = VB_W - pad * 2, maxH = VB_H - pad * 2;
  const ar = width / height || 1;
  let w = maxW, h = w / ar;
  if (h > maxH) { h = maxH; w = h * ar; }
  const x = (VB_W - w) / 2, y = (VB_H - h) / 2;
  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ width: "100%", height: "auto", background: INK, borderRadius: 4 }}>
      <rect x={x} y={y} width={w} height={h} fill={colorHex} stroke="#fff" strokeWidth={1.5} />
      {/* width dimension */}
      <line x1={x} y1={y - 14} x2={x + w} y2={y - 14} stroke="#CFE3EF" strokeWidth={1} />
      <line x1={x} y1={y - 18} x2={x} y2={y - 10} stroke="#CFE3EF" strokeWidth={1} />
      <line x1={x + w} y1={y - 18} x2={x + w} y2={y - 10} stroke="#CFE3EF" strokeWidth={1} />
      <text x={x + w / 2} y={y - 20} fill="#CFE3EF" fontSize="5" fontFamily="'IBM Plex Mono', monospace" textAnchor="middle">
        {width}" W
      </text>
      {/* height dimension */}
      <line x1={x + w + 14} y1={y} x2={x + w + 14} y2={y + h} stroke="#CFE3EF" strokeWidth={1} />
      <text x={x + w + 20} y={y + h / 2} fill="#CFE3EF" fontSize="5" fontFamily="'IBM Plex Mono', monospace">
        {height}" H
      </text>
    </svg>
  );
}

/* ---------------------------------- 3D box parts (collector box / scupper / chimney cap) ---------------------------------- */
function makeSideWallsGeometry(w, d, height) {
  const hw = w / 2, hd = d / 2;
  const positions = new Float32Array([
    -hw, 0, -hd,  hw, 0, -hd,  hw, 0, hd,  -hw, 0, hd, // bottom ring 0-3
    -hw, height, -hd,  hw, height, -hd,  hw, height, hd,  -hw, height, hd, // top ring 4-7
  ]);
  const idx = [
    0, 4, 1, 1, 4, 5, // front
    1, 5, 2, 2, 5, 6, // right
    2, 6, 3, 3, 6, 7, // back
    3, 7, 0, 0, 7, 4, // left
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function makeTroughGeometry(w, h, d) {
  // A real open channel: bottom + two side walls only. No end caps, no top — water
  // (visually, empty space) passes straight through both open ends and the open top.
  const hw = w / 2, hd = d / 2;
  const positions = new Float32Array([
    -hw, 0, -hd,  hw, 0, -hd,  -hw, 0, hd,  hw, 0, hd, // bottom: 0,1,2,3
    -hw, h, -hd,  hw, h, -hd,  -hw, h, hd,  hw, h, hd, // top rim: 4,5,6,7
  ]);
  const idx = [
    0, 1, 3, 0, 3, 2, // bottom
    0, 2, 6, 0, 6, 4, // left wall
    1, 5, 7, 1, 7, 3, // right wall
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function makeOpenTopBoxGeometry(w, h, d) {
  const hw = w / 2, hd = d / 2;
  const positions = new Float32Array([
    -hw, 0, -hd,  hw, 0, -hd,  hw, 0, hd,  -hw, 0, hd, // bottom ring 0-3
    -hw, h, -hd,  hw, h, -hd,  hw, h, hd,  -hw, h, hd, // top ring 4-7 (no cap between them)
  ]);
  const idx = [
    0, 1, 2, 0, 2, 3, // bottom cap
    0, 4, 1, 1, 4, 5, // front
    1, 5, 2, 2, 5, 6, // right
    2, 6, 3, 3, 6, 7, // back
    3, 7, 0, 0, 7, 4, // left
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function makeTaperedBoxGeometry(topW, topD, botW, botD, height) {
  const hw1 = topW / 2, hd1 = topD / 2, hw2 = botW / 2, hd2 = botD / 2;
  const y1 = 0, y2 = -height;
  const positions = new Float32Array([
    -hw1, y1, -hd1,  hw1, y1, -hd1,  hw1, y1, hd1,  -hw1, y1, hd1,
    -hw2, y2, -hd2,  hw2, y2, -hd2,  hw2, y2, hd2,  -hw2, y2, hd2,
  ]);
  const idx = [
    0, 4, 1, 1, 4, 5, // front
    1, 5, 2, 2, 5, 6, // right
    2, 6, 3, 3, 6, 7, // back
    3, 7, 0, 0, 7, 4, // left
    4, 6, 5, 4, 7, 6, // bottom cap
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function Part3DPreview({ partType, w, d, h, capH, colorHex, outletShape, flangeW, flangeD, outletDiameter, outletLength, topTrim, bodyTaper, taperStart, taperLength, flangeTapered, flangeLength, outletRoundTapered, capStyle }) {
  const mountRef = useRef(null);
  const stateRef = useRef({});
  const rotateRef = useRef(null);
  const zoomActionRef = useRef(null);
  const viewStateRef = useRef({ rotY: 0.6, rotX: -0.25, zoomLevel: 1 }); // persists rotation/zoom across rebuilds so the camera doesn't reset every time a dimension changes

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const width = mount.clientWidth || 300, height = 260;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a2b41);
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    mount.innerHTML = "";
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 5, 4);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.35);
    dir2.position.set(-3, -2, -4);
    scene.add(dir2);

    const group = new THREE.Group();
    scene.add(group);

    const mat = new THREE.MeshStandardMaterial({ color: colorHex || "#8A94A6", metalness: 0.35, roughness: 0.5, side: THREE.DoubleSide });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });

    const addEdges = (geo, mesh) => {
      const edges = new THREE.EdgesGeometry(geo);
      const line = new THREE.LineSegments(edges, edgeMat);
      mesh.add(line);
    };

    const W = Math.max(1, +w || 1), D = Math.max(1, +d || 1), H = Math.max(1, +h || 1);

    if (partType === "collector") {
      // Genuinely open-top box (no top face) — straight-walled or tapered (funnel) sides —
      // with a downspout outlet on the bottom (round pipe or tapered box flange).
      const isBoxOutlet = outletShape === "box";
      const FW = Math.max(0.5, +flangeW || 4), FD = Math.max(0.5, +flangeD || 4);
      const dia = Math.max(0.5, +outletDiameter || 4);
      // When the body itself tapers, bring it all the way down to the OUTLET's own size directly —
      // one continuous taper ending at the flange/pipe, instead of tapering to an arbitrary
      // halfway point and then tapering *again* for the outlet.
      const bw = bodyTaper ? (isBoxOutlet ? FW : dia) : W;
      const bd = bodyTaper ? (isBoxOutlet ? FD : dia) : D;
      const TS = Math.max(0, Math.min(H - 0.5, +taperStart || 0)); // straight-wall height from the top before tapering starts
      const TL = Math.max(0.5, Math.min(H - TS, +taperLength || H - TS)); // how far the taper itself runs
      const shelfH = Math.max(0, H - TS - TL); // remaining straight "shelf" below the taper, at the tapered-down size
      let boxGeo, boxMesh;
      if (bodyTaper) {
        // top straight section, full W×D
        if (TS > 0.01) {
          const topGeo = makeSideWallsGeometry(W, D, TS);
          const topMesh = new THREE.Mesh(topGeo, mat.clone());
          topMesh.position.y = H - TS;
          addEdges(topGeo, topMesh);
          group.add(topMesh);
        }
        // the taper itself, narrowing W×D down to bw×bd over TL inches
        boxGeo = makeTaperedBoxGeometry(W, D, bw, bd, TL);
        boxMesh = new THREE.Mesh(boxGeo, mat.clone());
        boxMesh.position.y = H - TS; // local y=0 (top, W×D) sits where the top straight section ends
        addEdges(boxGeo, boxMesh);
        group.add(boxMesh);
        // shelf: straight walls at the tapered-down size, continuing down to the outlet — no further taper
        if (shelfH > 0.01) {
          const shelfGeo = makeSideWallsGeometry(bw, bd, shelfH);
          const shelfMesh = new THREE.Mesh(shelfGeo, mat.clone());
          shelfMesh.position.y = 0; // sits right on the box's true bottom, where the outlet attaches
          addEdges(shelfGeo, shelfMesh);
          group.add(shelfMesh);
        }
      } else {
        boxGeo = makeOpenTopBoxGeometry(W, H, D);
        boxMesh = new THREE.Mesh(boxGeo, mat.clone());
        addEdges(boxGeo, boxMesh);
        group.add(boxMesh);
      }
      // outlet on the underside, sized off the box's actual bottom (bw × bd).
      // If the body already tapered all the way down to the flange/pipe size, the outlet
      // itself just needs a straight stub — the taper already happened once, above.
      if (outletShape === "box") {
        const FL = Math.max(0.5, +flangeLength || 4);
        if (flangeTapered && !bodyTaper) {
          const TAPER_FIXED = 3; // the taper itself stays a fixed length — only the straight stub grows/shrinks with Flange Length
          const taperH = Math.min(TAPER_FIXED, FL - 0.25);
          const stubH = Math.max(0.25, FL - taperH);
          const taperGeo = makeTaperedBoxGeometry(bw, bd, FW, FD, taperH);
          const taperMesh = new THREE.Mesh(taperGeo, mat.clone());
          taperMesh.position.set(0, 0, 0);
          addEdges(taperGeo, taperMesh);
          group.add(taperMesh);
          // straight flange stub below the taper — this is the part that extends to reach the full Flange Length
          const flangeGeo = new THREE.BoxGeometry(FW, stubH, FD);
          const flangeMesh = new THREE.Mesh(flangeGeo, mat.clone());
          flangeMesh.position.set(0, -taperH - stubH / 2, 0);
          addEdges(flangeGeo, flangeMesh);
          group.add(flangeMesh);
        } else {
          // straight, non-tapered flange duct running the full specified length
          const flangeGeo = new THREE.BoxGeometry(FW, FL, FD);
          const flangeMesh = new THREE.Mesh(flangeGeo, mat.clone());
          flangeMesh.position.set(0, -FL / 2, 0);
          addEdges(flangeGeo, flangeMesh);
          group.add(flangeMesh);
        }
      } else {
        const outletR = Math.max(0.25, (+outletDiameter || 4) / 2);
        const spoutLen = Math.max(0.5, +outletLength || 6);
        if (outletRoundTapered && !bodyTaper) {
          const taperH = spoutLen * 0.75, stubH = spoutLen * 0.25;
          // rectangular taper down from the box's own bottom (bw × bd) to roughly the pipe's diameter — the taper itself is not round
          const taperGeo = makeTaperedBoxGeometry(bw, bd, outletR * 2, outletR * 2, taperH);
          const taperMesh = new THREE.Mesh(taperGeo, mat.clone());
          taperMesh.position.set(0, 0, 0);
          addEdges(taperGeo, taperMesh);
          group.add(taperMesh);
          // only the short stub that actually plugs into the downspout is round
          const stubGeo = new THREE.CylinderGeometry(outletR, outletR, stubH, 24, 1, true);
          const stubMesh = new THREE.Mesh(stubGeo, mat.clone());
          stubMesh.position.set(0, -taperH - stubH / 2, 0);
          group.add(stubMesh);
        } else {
          const spoutGeo = new THREE.CylinderGeometry(outletR, outletR, spoutLen, 24, 1, true);
          const spoutMesh = new THREE.Mesh(spoutGeo, mat.clone());
          spoutMesh.position.set(0, -spoutLen / 2, 0);
          group.add(spoutMesh);
        }
      }
      // open top rim indicator
      const rimGeo = new THREE.BoxGeometry(W * 1.02, 0.15, D * 1.02);
      const rimMesh = new THREE.Mesh(rimGeo, mat.clone());
      rimMesh.position.y = H;
      group.add(rimMesh);
      // optional top trim cap: a picture-frame overhang ~1" out and ~1" tall, sitting above the rim
      if (topTrim) {
        const OH = 1, TH = 1; // overhang, trim height
        const trimY = H + TH / 2 + 0.16;
        const front = new THREE.Mesh(new THREE.BoxGeometry(W + OH * 2, TH, OH), mat.clone());
        front.position.set(0, trimY, -D / 2 - OH / 2);
        const back = new THREE.Mesh(new THREE.BoxGeometry(W + OH * 2, TH, OH), mat.clone());
        back.position.set(0, trimY, D / 2 + OH / 2);
        const left = new THREE.Mesh(new THREE.BoxGeometry(OH, TH, D + OH * 2), mat.clone());
        left.position.set(-W / 2 - OH / 2, trimY, 0);
        const right = new THREE.Mesh(new THREE.BoxGeometry(OH, TH, D + OH * 2), mat.clone());
        right.position.set(W / 2 + OH / 2, trimY, 0);
        [front, back, left, right].forEach((m) => { addEdges(m.geometry, m); group.add(m); });
      }
    } else if (partType === "scupper") {
      // A real open channel — bottom + two side walls, open top, open both ends —
      // so it visually reads as something water actually flows through, not a solid block.
      const troughGeo = makeTroughGeometry(W, H, D);
      const troughMesh = new THREE.Mesh(troughGeo, mat.clone());
      addEdges(troughGeo, troughMesh);
      group.add(troughMesh);
      // mounting flanges at both open ends — thin open frames, not solid caps, so the
      // through-opening stays visible rather than looking plugged.
      const flangeT = 0.5; // frame thickness
      [-1, 1].forEach((side) => {
        const z = side * (D / 2 + 0.06);
        const fw = W * 1.35, fh = H * 1.35;
        const top = new THREE.Mesh(new THREE.BoxGeometry(fw, flangeT, 0.12), mat.clone());
        top.position.set(0, fh / 2 - flangeT / 2, z);
        const bottom = new THREE.Mesh(new THREE.BoxGeometry(fw, flangeT, 0.12), mat.clone());
        bottom.position.set(0, -fh / 2 + flangeT / 2, z);
        const left = new THREE.Mesh(new THREE.BoxGeometry(flangeT, fh, 0.12), mat.clone());
        left.position.set(-fw / 2 + flangeT / 2, 0, z);
        const right = new THREE.Mesh(new THREE.BoxGeometry(flangeT, fh, 0.12), mat.clone());
        right.position.set(fw / 2 - flangeT / 2, 0, z);
        [top, bottom, left, right].forEach((m) => group.add(m));
      });
    } else {
      // Chimney cap only — no mesh screen box/frame, just the roof piece that sits over the opening.
      const CH = Math.max(1, +capH || 6);
      const skirt = new THREE.BoxGeometry(W * 1.25, 0.12, D * 1.25);
      const skirtMesh = new THREE.Mesh(skirt, mat.clone());
      skirtMesh.position.y = 0;
      group.add(skirtMesh);

      if (capStyle === "texas") {
        // Texas Top: a near-flat lid sitting right at the opening.
        const lidGeo = new THREE.BoxGeometry(W * 1.15, CH * 0.25, D * 1.15);
        const lidMesh = new THREE.Mesh(lidGeo, mat.clone());
        lidMesh.position.y = 0.15 + (CH * 0.25) / 2;
        addEdges(lidGeo, lidMesh);
        group.add(lidMesh);
      } else if (capStyle === "stevenson") {
        // Stevenson Top: a shallow, low-pitched hip roof.
        const shallowCH = CH * 0.55;
        const capGeo = new THREE.ConeGeometry(Math.sqrt(W * W + D * D) / 2 * 1.15, shallowCH, 4);
        capGeo.rotateY(Math.PI / 4);
        const capMesh = new THREE.Mesh(capGeo, mat.clone());
        capMesh.position.y = shallowCH / 2;
        addEdges(capGeo, capMesh);
        group.add(capMesh);
      } else if (capStyle === "chateau") {
        // Chateau Cap: a flared, concave bell profile — built as stacked frustums that widen faster near the bottom.
        const rTop = Math.sqrt(W * W + D * D) / 2 * 0.55;
        const rMid = Math.sqrt(W * W + D * D) / 2 * 0.75;
        const rBot = Math.sqrt(W * W + D * D) / 2 * 1.35;
        const seg1H = CH * 0.4, seg2H = CH * 0.6;
        const seg1Geo = new THREE.CylinderGeometry(rTop, rMid, seg1H, 4, 1, true);
        seg1Geo.rotateY(Math.PI / 4);
        const seg1Mesh = new THREE.Mesh(seg1Geo, mat.clone());
        seg1Mesh.position.y = CH - seg1H / 2;
        addEdges(seg1Geo, seg1Mesh);
        group.add(seg1Mesh);
        const seg2Geo = new THREE.CylinderGeometry(rMid, rBot, seg2H, 4, 1, true);
        seg2Geo.rotateY(Math.PI / 4);
        const seg2Mesh = new THREE.Mesh(seg2Geo, mat.clone());
        seg2Mesh.position.y = CH - seg1H - seg2H / 2;
        addEdges(seg2Geo, seg2Mesh);
        group.add(seg2Mesh);
        const capTopGeo = new THREE.BoxGeometry(rTop * 1.2, 0.12, rTop * 1.2);
        const capTopMesh = new THREE.Mesh(capTopGeo, mat.clone());
        capTopMesh.position.y = CH;
        group.add(capTopMesh);
      } else {
        // Pyramid (default): straight hip roof cap.
        const capGeo = new THREE.ConeGeometry(Math.sqrt(W * W + D * D) / 2 * 1.05, CH, 4);
        capGeo.rotateY(Math.PI / 4);
        const capMesh = new THREE.Mesh(capGeo, mat.clone());
        capMesh.position.y = CH / 2;
        addEdges(capGeo, capMesh);
        group.add(capMesh);
      }
    }

    // frame the camera on the whole group — use the bounding diagonal (not just one axis)
    // so the part stays fully in view with margin no matter how it's rotated, at any size.
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center); // recenter the model at world origin — camera can now always look at (0,0,0), which stays correct through any rotation
    const radius = Math.max(0.5, size.length() / 2);
    const fovRad = (camera.fov * Math.PI) / 180;
    const marginFactor = 1.65; // >1 leaves breathing room so the part never touches the frame edge
    const baseDist = (radius * marginFactor) / Math.tan(fovRad / 2);
    const dirVec = new THREE.Vector3(0.6, 0.5, 0.8).normalize();
    let zoomLevel = viewStateRef.current.zoomLevel;
    const positionCamera = () => {
      const d = baseDist * zoomLevel;
      camera.position.set(dirVec.x * d, dirVec.y * d, dirVec.z * d);
      camera.lookAt(0, 0, 0);
    };
    positionCamera();
    zoomActionRef.current = (factor) => {
      zoomLevel = Math.max(0.35, Math.min(3, zoomLevel * factor));
      viewStateRef.current.zoomLevel = zoomLevel;
      positionCamera();
    };

    let rotY = viewStateRef.current.rotY, rotX = viewStateRef.current.rotX;
    group.rotation.set(rotX, rotY, 0);

    const applyRotate = (dyaw, dpitch) => {
      rotY += dyaw;
      rotX = rotX + dpitch;
      group.rotation.set(rotX, rotY, 0);
      viewStateRef.current.rotY = rotY;
      viewStateRef.current.rotX = rotX;
    };
    rotateRef.current = applyRotate;

    let dragging = false, lastX = 0, lastY = 0;
    const onDown = (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; };
    const onMove = (e) => {
      if (!dragging) return;
      applyRotate((e.clientX - lastX) * 0.01, (e.clientY - lastY) * 0.01);
      lastX = e.clientX; lastY = e.clientY;
    };
    const onUp = () => { dragging = false; };
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    // Keep the renderer resolution and camera aspect matched to the container's actual
    // settled size — the initial clientWidth read above can be stale if the layout hasn't
    // finished sizing yet, which stretches/skews everything in the scene.
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const newWidth = entry.contentRect.width;
      if (newWidth < 10) return;
      renderer.setSize(newWidth, height);
      camera.aspect = newWidth / height;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(mount);

    let raf;
    const animate = () => { raf = requestAnimationFrame(animate); renderer.render(scene, camera); };
    animate();

    stateRef.current = { renderer, scene };

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      renderer.dispose();
      if (mount) mount.innerHTML = "";
    };
  }, [partType, w, d, h, capH, colorHex, outletShape, flangeW, flangeD, outletDiameter, outletLength, topTrim, bodyTaper, taperStart, taperLength, flangeTapered, flangeLength, outletRoundTapered, capStyle]);

  const STEP = 0.35;
  const spinIntervalRef = useRef(null);
  const btnStyle = {
    position: "absolute", width: 34, height: 34, borderRadius: 17, border: "1px solid rgba(255,255,255,0.4)",
    background: "rgba(10,43,65,0.85)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, touchAction: "none",
    userSelect: "none", WebkitUserSelect: "none", MozUserSelect: "none", WebkitTouchCallout: "none",
  };
  const startSpin = (dyaw, dpitch) => {
    stopSpin();
    rotateRef.current && rotateRef.current(dyaw, dpitch); // immediate nudge on tap
    spinIntervalRef.current = setInterval(() => {
      rotateRef.current && rotateRef.current(dyaw * 0.35, dpitch * 0.35);
    }, 16);
  };
  const stopSpin = () => {
    if (spinIntervalRef.current) { clearInterval(spinIntervalRef.current); spinIntervalRef.current = null; }
  };
  useEffect(() => () => stopSpin(), []);

  return (
    <div style={{ userSelect: "none", WebkitUserSelect: "none", MozUserSelect: "none" }}>
      <div style={{ position: "relative" }}>
        <div ref={mountRef} style={{
          width: "100%", height: 260, borderRadius: 6, overflow: "hidden", touchAction: "none",
          userSelect: "none", WebkitUserSelect: "none", MozUserSelect: "none", WebkitTouchCallout: "none",
        }} />
        <button type="button"
          onPointerDown={() => startSpin(0, -STEP)} onPointerUp={stopSpin} onPointerLeave={stopSpin} onPointerCancel={stopSpin}
          style={{ ...btnStyle, top: 4, left: "50%", transform: "translateX(-50%)" }} title="Hold to tilt up">↑</button>
        <button type="button"
          onPointerDown={() => startSpin(0, STEP)} onPointerUp={stopSpin} onPointerLeave={stopSpin} onPointerCancel={stopSpin}
          style={{ ...btnStyle, bottom: 4, left: "50%", transform: "translateX(-50%)" }} title="Hold to tilt down">↓</button>
        <button type="button"
          onPointerDown={() => startSpin(-STEP, 0)} onPointerUp={stopSpin} onPointerLeave={stopSpin} onPointerCancel={stopSpin}
          style={{ ...btnStyle, left: 4, top: "50%", transform: "translateY(-50%)" }} title="Hold to spin left">←</button>
        <button type="button"
          onPointerDown={() => startSpin(STEP, 0)} onPointerUp={stopSpin} onPointerLeave={stopSpin} onPointerCancel={stopSpin}
          style={{ ...btnStyle, right: 4, top: "50%", transform: "translateY(-50%)" }} title="Hold to spin right">→</button>
        <div style={{ position: "absolute", top: 4, left: 4, display: "flex", flexDirection: "column", gap: 3 }}>
          <button type="button" onClick={() => zoomActionRef.current && zoomActionRef.current(1 / 1.2)}
            style={{ ...btnStyle, position: "static", width: 26, height: 26, borderRadius: 6, fontSize: 14 }} title="Zoom in">+</button>
          <button type="button" onClick={() => zoomActionRef.current && zoomActionRef.current(1.2)}
            style={{ ...btnStyle, position: "static", width: 26, height: 26, borderRadius: 6, fontSize: 14 }} title="Zoom out">−</button>
        </div>
      </div>
      <div style={{ fontSize: 9.5, color: "#8FB4C9", marginTop: 4, textAlign: "center" }}>Drag, or press and hold an arrow to spin continuously</div>
    </div>
  );
}

function FlatPatternSVG({ partType, w, d, h, capH, colorHex, outletShape, flangeW, flangeD, outletDiameter, outletLength, topTrim, bodyTaper, taperStart, taperLength, flangeTapered }) {
  const W = Math.max(1, +w || 1), D = Math.max(1, +d || 1), H = Math.max(1, +h || 1), CH = Math.max(1, +capH || 6);

  if (partType === "collector") {
    const isBoxOutlet = outletShape === "box";
    const FWfull = Math.max(0.5, +flangeW || 4), FDfull = Math.max(0.5, +flangeD || 4);
    const diaFull = Math.max(0.5, +outletDiameter || 4);
    const bw = bodyTaper ? (isBoxOutlet ? FWfull : diaFull) : W;
    const bd = bodyTaper ? (isBoxOutlet ? FDfull : diaFull) : D;
    const TS = bodyTaper ? Math.max(0, Math.min(H - 0.5, +taperStart || 0)) : 0;
    const TL = bodyTaper ? Math.max(0.5, Math.min(H - TS, +taperLength || H - TS)) : 0;
    const shelfH = bodyTaper ? Math.max(0, H - TS - TL) : 0;
    const widthAt = (s, full, narrow) => {
      if (!bodyTaper) return full;
      if (s <= shelfH) return narrow;
      if (s <= shelfH + TL) return narrow + (full - narrow) * ((s - shelfH) / TL);
      return full;
    };
    const keyS = [0, shelfH, shelfH + TL, H];

    const pad = 6;
    const extraX = Math.max(0, W - bw) / 2, extraY = Math.max(0, D - bd) / 2;
    const baseX = pad + H + extraX, baseY = pad + H + extraY;
    const cutLines = []; // solid perimeter segments: [[x1,y1],[x2,y2]]
    const foldLines = []; // dashed fold segments
    const polys = []; // {pts, label}

    // bottom panel
    const bottomPts = [[baseX, baseY], [baseX + bw, baseY], [baseX + bw, baseY + bd], [baseX, baseY + bd]];
    polys.push({ pts: bottomPts, label: `${bw.toFixed(1)}×${bd.toFixed(1)}` });
    foldLines.push([[baseX, baseY], [baseX + bw, baseY]]); // shared with front
    foldLines.push([[baseX, baseY + bd], [baseX + bw, baseY + bd]]); // shared with back
    foldLines.push([[baseX, baseY], [baseX, baseY + bd]]); // shared with left
    foldLines.push([[baseX + bw, baseY], [baseX + bw, baseY + bd]]); // shared with right

    const wallPoly = (cx, cy, axis, dir, full, narrow) => {
      // axis: "y" (front/back, width runs in x) or "x" (left/right, width runs in y)
      const left = [], right = [];
      keyS.forEach((s) => {
        const hwv = widthAt(s, full, narrow) / 2;
        if (axis === "y") {
          const yy = cy + dir * s;
          left.push([cx - hwv, yy]); right.push([cx + hwv, yy]);
        } else {
          const xx = cx + dir * s;
          left.push([xx, cy - hwv]); right.push([xx, cy + hwv]);
        }
      });
      return [...left, ...right.slice().reverse()];
    };

    const frontPts = wallPoly(baseX + bw / 2, baseY, "y", -1, W, bw);
    const backPts = wallPoly(baseX + bw / 2, baseY + bd, "y", 1, W, bw);
    const leftPts = wallPoly(baseX, baseY + bd / 2, "x", -1, D, bd);
    const rightPts = wallPoly(baseX + bw, baseY + bd / 2, "x", 1, D, bd);
    polys.push({ pts: frontPts, label: `H ${H}"` });
    polys.push({ pts: backPts, label: `H ${H}"` });
    polys.push({ pts: leftPts, label: `H ${H}"` });
    polys.push({ pts: rightPts, label: `H ${H}"` });

    let vbW = bw + H * 2 + pad * 2 + extraX * 2;
    let vbH = bd + H * 2 + pad * 2 + extraY * 2;

    // secondary pieces laid out below the main unfold
    const extras = [];
    let extraY2 = baseY + bd + H + pad * 2;
    if (outletShape === "round") {
      const dia = Math.max(0.5, +outletDiameter || 4), len = Math.max(0.5, +outletLength || 6);
      const circ = Math.PI * dia;
      extras.push({ rect: [pad, extraY2, circ, len], label: `Pipe: ${circ.toFixed(1)}" × ${len}" (⌀${dia}")` });
      // hole to cut in the bottom panel for the pipe
      polys[0].hole = { cx: baseX + bw / 2, cy: baseY + bd / 2, r: dia / 2 };
      vbH = Math.max(vbH, extraY2 + len + pad - baseY + H);
      vbW = Math.max(vbW, circ + pad * 2);
    } else {
      const FW = Math.max(0.5, +flangeW || 4), FD = Math.max(0.5, +flangeD || 4);
      const fbaseX = pad + 5, fbaseY = extraY2 + 5;
      const flangeBottom = [[fbaseX, fbaseY], [fbaseX + FW, fbaseY], [fbaseX + FW, fbaseY + FD], [fbaseX, fbaseY + FD]];
      extras.push({ poly: flangeBottom, label: `Flange base ${FW.toFixed(1)}×${FD.toFixed(1)}${flangeTapered ? "" : " (straight)"}` });
      // trapezoids (tapered) or plain rectangles (straight duct) from bw/bd down to FW/FD, height = stub
      const stubH = 5;
      const trap = (cx, cy, axis, dir, wideW, narrowW) => {
        const w0 = wideW / 2, w1 = narrowW / 2;
        if (axis === "y") {
          const y1 = cy + dir * stubH;
          return [[cx - w0, cy], [cx + w0, cy], [cx + w1, y1], [cx - w1, y1]];
        } else {
          const x1 = cx + dir * stubH;
          return [[cx, cy - w0], [x1, cy - w1], [x1, cy + w1], [cx, cy + w0]];
        }
      };
      const topW = flangeTapered ? bw : FW, topD = flangeTapered ? bd : FD;
      extras.push({ poly: trap(fbaseX + FW / 2, fbaseY, "y", -1, topW, FW), label: "" });
      extras.push({ poly: trap(fbaseX + FW / 2, fbaseY + FD, "y", 1, topW, FW), label: "" });
      extras.push({ poly: trap(fbaseX, fbaseY + FD / 2, "x", -1, topD, FD), label: "" });
      extras.push({ poly: trap(fbaseX + FW, fbaseY + FD / 2, "x", 1, topD, FD), label: "" });
      vbH = Math.max(vbH, fbaseY + FD + stubH + pad);
    }
    if (topTrim) {
      const OH = 1, TH = 1;
      let ty = vbH + pad;
      extras.push({ rect: [pad, ty, W + OH * 2, TH], label: `Trim front/back ${(W + OH * 2).toFixed(1)}"×${TH}"` });
      extras.push({ rect: [pad, ty + TH + 3, D + OH * 2, TH], label: `Trim left/right ${(D + OH * 2).toFixed(1)}"×${TH}"` });
      vbH = ty + TH * 2 + 6;
      vbW = Math.max(vbW, D + OH * 2 + pad * 2);
    }

    const polyToPath = (pts) => `M ${pts.map((p) => p.join(",")).join(" L ")} Z`;

    return (
      <svg viewBox={`0 0 ${vbW} ${vbH}`} style={{ width: "100%", height: "auto", background: INK, borderRadius: 4 }}>
        {polys.map((p, i) => {
          const cx = p.pts.reduce((s, pt) => s + pt[0], 0) / p.pts.length;
          const cy = p.pts.reduce((s, pt) => s + pt[1], 0) / p.pts.length;
          return (
            <g key={i}>
              <path d={polyToPath(p.pts)} fill={colorHex} fillOpacity={0.85} stroke="#fff" strokeWidth={0.45} />
              {p.hole && <circle cx={p.hole.cx} cy={p.hole.cy} r={p.hole.r} fill={INK} stroke="#fff" strokeWidth={0.35} strokeDasharray="1.2 0.8" />}
              <text x={cx} y={cy} fill="#fff" fontSize={3.2} fontFamily="'IBM Plex Mono', monospace" textAnchor="middle" dominantBaseline="central">{p.label}</text>
            </g>
          );
        })}
        {foldLines.map((f, i) => (
          <line key={`f${i}`} x1={f[0][0]} y1={f[0][1]} x2={f[1][0]} y2={f[1][1]} stroke="#0A2B41" strokeWidth={0.5} strokeDasharray="1.5 1" />
        ))}
        {extras.map((e, i) => {
          if (e.rect) {
            const [x, y, rw, rh] = e.rect;
            return (
              <g key={`e${i}`}>
                <rect x={x} y={y} width={rw} height={rh} fill={colorHex} fillOpacity={0.85} stroke="#fff" strokeWidth={0.4} />
                <text x={x + rw / 2} y={y + rh / 2} fill="#fff" fontSize={2.6} fontFamily="'IBM Plex Mono', monospace" textAnchor="middle" dominantBaseline="central">{e.label}</text>
              </g>
            );
          }
          if (e.poly) {
            return <path key={`e${i}`} d={polyToPath(e.poly)} fill={colorHex} fillOpacity={0.7} stroke="#fff" strokeWidth={0.35} />;
          }
          return null;
        })}
        <text x={vbW / 2} y={vbH - 2} fill="#8FB4C9" fontSize={3} textAnchor="middle" fontFamily="Inter, sans-serif">
          Solid = cut · Dashed = fold — nominal, not bend-allowance corrected
        </text>
      </svg>
    );
  }

  const TAB = 0.75; // seam tab width, schematic only
  const panels = []; // {x,y,w,h,fold:[edges]}
  let vbW = 100, vbH = 100;

  const panel = (x, y, pw, ph, foldEdges) => panels.push({ x, y, w: pw, h: ph, foldEdges: foldEdges || [] });

  if (partType === "scupper") {
    // Cross layout: bottom in the middle, four sides folding up around it.
    const pad = 4;
    panel(pad + H, pad + H, W, D, ["top", "bottom", "left", "right"]); // bottom/base
    panel(pad + H, pad, W, H, ["bottom"]); // front
    panel(pad + H, pad + H + D, W, H, ["top"]); // back
    panel(pad, pad + H, H, D, ["right"]); // left side
    panel(pad + H + W, pad + H, H, D, ["left"]); // right side
    vbW = W + H * 2 + pad * 2 + TAB * 2;
    vbH = D + H * 2 + pad * 2 + TAB * 2;
  } else {
    // Chimney cap: 4 side panels around a base rectangle, plus 4 triangular cap panels above.
    const pad = 4;
    const slant = Math.sqrt((Math.max(W, D) / 2) ** 2 + CH ** 2);
    panel(pad + H, pad + CH + H, W, D, ["top", "bottom", "left", "right"]); // base ring reference (not cut, just layout anchor)
    panel(pad + H, pad + CH, W, H, ["bottom", "top"]); // front wall
    panel(pad + H, pad + CH + H + D, W, H, ["top"]); // back wall
    panel(pad, pad + CH + H, H, D, ["right"]); // left wall
    panel(pad + H + W, pad + CH + H, H, D, ["left"]); // right wall
    // cap triangle (front) above front wall
    panels.push({ tri: [[pad + H, pad + CH], [pad + H + W, pad + CH], [pad + H + W / 2, pad]], label: `${slant.toFixed(1)}"` });
    vbW = W + H * 2 + pad * 2 + TAB * 2;
    vbH = D + H * 2 + CH + pad * 2 + TAB * 2;
  }

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} style={{ width: "100%", height: "auto", background: INK, borderRadius: 4 }}>
      {panels.filter((p) => !p.tri).map((p, i) => (
        <g key={i}>
          <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={colorHex} fillOpacity={0.85} stroke="#fff" strokeWidth={0.4} />
          {p.foldEdges.includes("top") && <line x1={p.x} y1={p.y} x2={p.x + p.w} y2={p.y} stroke="#0A2B41" strokeWidth={0.5} strokeDasharray="1.5 1" />}
          {p.foldEdges.includes("bottom") && <line x1={p.x} y1={p.y + p.h} x2={p.x + p.w} y2={p.y + p.h} stroke="#0A2B41" strokeWidth={0.5} strokeDasharray="1.5 1" />}
          {p.foldEdges.includes("left") && <line x1={p.x} y1={p.y} x2={p.x} y2={p.y + p.h} stroke="#0A2B41" strokeWidth={0.5} strokeDasharray="1.5 1" />}
          {p.foldEdges.includes("right") && <line x1={p.x + p.w} y1={p.y} x2={p.x + p.w} y2={p.y + p.h} stroke="#0A2B41" strokeWidth={0.5} strokeDasharray="1.5 1" />}
          <text x={p.x + p.w / 2} y={p.y + p.h / 2} fill="#fff" fontSize={Math.min(p.w, p.h) * 0.18} fontFamily="'IBM Plex Mono', monospace" textAnchor="middle" dominantBaseline="central">
            {p.w.toFixed(0)}×{p.h.toFixed(0)}
          </text>
        </g>
      ))}
      {panels.filter((p) => p.tri).map((p, i) => (
        <g key={`t${i}`}>
          <polygon points={p.tri.map((pt) => pt.join(",")).join(" ")} fill={colorHex} fillOpacity={0.85} stroke="#fff" strokeWidth={0.4} />
        </g>
      ))}
      <text x={vbW / 2} y={vbH - 3} fill="#8FB4C9" fontSize={3.2} textAnchor="middle" fontFamily="Inter, sans-serif">
        Nominal flat pattern — schematic only, not bend-allowance corrected
      </text>
    </svg>
  );
}

/* ---------------------------------- main app ---------------------------------- */
export default function ShopOrderApp() {
  const { user, customer, isStaff, signOut } = useAuth();
  const [customers, setCustomers] = useState([]); // staff-only: every registered customer, for tier assignment
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [staffIds, setStaffIds] = useState([]);
  const [siteLeads, setSiteLeads] = useState([]); // staff-only: signups from the roofcoil.com member gate
  const [siteLeadsLoaded, setSiteLeadsLoaded] = useState(false);
  const [mfrApps, setMfrApps] = useState([]); // staff-only: manufacturer "get listed" applications from the site
  const [mfrAppsLoaded, setMfrAppsLoaded] = useState(false);
  const [tab, setTab] = useState("order");
  const [orderStep, setOrderStep] = useState("type"); // "color" | "type" | "details"
  const [showColorMatch, setShowColorMatch] = useState(false);
  const [materialCategory, setMaterialCategory] = useState("painted"); // "painted" | "unpainted"
  const [orders, setOrders] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [priceList, setPriceList] = useState([]);
  const [priceListLoaded, setPriceListLoaded] = useState(false);
  const [priceListView, setPriceListView] = useState("customer"); // "backend" | "customer"
  const [priceListTier, setPriceListTier] = useState("tier1"); // which tier the customer view shows

  // Non-staff customers always see their own assigned tier, not whatever was last selected.
  useEffect(() => {
    if (!isStaff && customer?.tier) setPriceListTier(customer.tier);
  }, [isStaff, customer]);
  const [materialCosts, setMaterialCosts] = useState([]);
  const [materialCostsLoaded, setMaterialCostsLoaded] = useState(false);
  const [productionCosts, setProductionCosts] = useState([]);
  const [productionCostsLoaded, setProductionCostsLoaded] = useState(false);
  const [coilWidthScale, setCoilWidthScale] = useState([]);
  const [customPresets, setCustomPresets] = useState([]);
  const [showIdeaBox, setShowIdeaBox] = useState(false);
  const [ideaType, setIdeaType] = useState("idea"); // "idea" | "bug"
  const [ideaText, setIdeaText] = useState("");
  const [ideaSubmitting, setIdeaSubmitting] = useState(false);
  const [ideas, setIdeas] = useState([]);
  const [ideasLoaded, setIdeasLoaded] = useState(false);
  const [customPresetsLoaded, setCustomPresetsLoaded] = useState(false);
  const [coilWidthScaleLoaded, setCoilWidthScaleLoaded] = useState(false);
  const [priceDrafts, setPriceDrafts] = useState({}); // holds in-progress typed text for price/cost/margin fields so it isn't clobbered mid-keystroke

  const theme = darkMode ? {
    pageBg: "#14181C",
    card: "#1E252B",
    inputBg: "#252C33",
    highlight: "#242C24",
    text: "#EDEAE0",
    textSecondary: "#93A0A8",
    border: "#39434B",
  } : {
    pageBg: PAPER,
    card: "#fff",
    inputBg: "#fff",
    highlight: "#F6F4EC",
    text: INK_DEEP,
    textSecondary: STEEL,
    border: "#D9D5C7",
  };

  const [shapeType, setShapeType] = useState("panel");
  const [width, setWidth] = useState(24);
  const [height, setHeight] = useState(853.08); // 100 finished sq ft at the default 21" coil / 16.88" SS450 pan width
  const [flatWidth, setFlatWidth] = useState(48);
  const [accType, setAccType] = useState("Screws");
  const [accSpec, setAccSpec] = useState(ACCESSORY_SPECS.Screws[0]);
  const [accProfile, setAccProfile] = useState(PROFILES[0]);
  const [accQty, setAccQty] = useState(1);
  const [accSealColor, setAccSealColor] = useState("match"); // "match" | "Clear" | a color name
  const [accessories, setAccessories] = useState([]);
  const [partType, setPartType] = useState("collector");
  const [partW, setPartW] = useState(12);
  const [partD, setPartD] = useState(8);
  const [partH, setPartH] = useState(10);
  const [partCapH, setPartCapH] = useState(6);
  const [capStyle, setCapStyle] = useState("pyramid"); // "pyramid" | "stevenson" | "texas" | "chateau"
  const [partView, setPartView] = useState("3d"); // "3d" | "flat"
  const [outletShape, setOutletShape] = useState("box"); // "round" | "box"
  const [flangeW, setFlangeW] = useState(4);
  const [flangeD, setFlangeD] = useState(4);
  const [flangeTapered, setFlangeTapered] = useState(true);
  const [flangeLength, setFlangeLength] = useState(4);
  const [outletRoundTapered, setOutletRoundTapered] = useState(false);
  const [outletDiameter, setOutletDiameter] = useState(4);
  const [outletLength, setOutletLength] = useState(6);
  const [topTrim, setTopTrim] = useState(false);
  const [bodyTaper, setBodyTaper] = useState(false);
  const [taperStart, setTaperStart] = useState(0); // inches of straight wall from the top before the taper begins
  const [taperLength, setTaperLength] = useState(6); // inches the taper itself spans before leveling into a straight shelf
  const [flatLength, setFlatLength] = useState(120); // 10 ft
  const [metalCoilWidth, setMetalCoilWidth] = useState(21);
  const [metalCoilLength, setMetalCoilLength] = useState(12000); // 1000 ft
  const [coilWidth, setCoilWidth] = useState(21);
  const [sqftEditing, setSqftEditing] = useState(null);
  const [widthEditing, setWidthEditing] = useState(null);
  const [coilPricePerFt, setCoilPricePerFt] = useState(2.5);
  const [fabPricePerFt, setFabPricePerFt] = useState(0);
  const [runLocation, setRunLocation] = useState("Shop");
  const [jobSiteAddress, setJobSiteAddress] = useState("");
  const [jobSiteMiles, setJobSiteMiles] = useState("");
  const [supplierCo, setSupplierCo] = useState("Fortified Metal");
  const [fabricatorCo, setFabricatorCo] = useState("Fortified Metal");
  const [milesLookupBusy, setMilesLookupBusy] = useState(false);
  const [milesLookupNote, setMilesLookupNote] = useState("");
  const [ribStyle, setRibStyle] = useState(null);
  const [clipRelief, setClipRelief] = useState(null);
  const [profile, setProfile] = useState(PROFILES[0]);
  const [showPanelCatalog, setShowPanelCatalog] = useState(false);
  const [catalogUserLoc, setCatalogUserLoc] = useState(null); // {lat,lng} once the contractor shares their location
  const [catalogLocStatus, setCatalogLocStatus] = useState("idle"); // "idle" | "asking" | "denied"

  useEffect(() => {
    const takeup = PROFILE_INFO[profile]?.takeup || 0;
    setWidth(Math.max(0, Math.round((coilWidth - takeup) * 100) / 100));
  }, [coilWidth, profile]);
  // Clips default to the panel profile being ordered, so "Clips — <profile>" matches the panel.
  useEffect(() => { if (shapeType === "panel") setAccProfile(profile); }, [shapeType, profile]);
  const [points, setPoints] = useState(TRIM_PRESETS["Eave"]);
  const [preset, setPreset] = useState("Eave");
  const [viewResetKey, setViewResetKey] = useState(0);
  const [hemStart, setHemStart] = useState("none");
  const [hemEnd, setHemEnd] = useState("none");
  const [paintSide, setPaintSide] = useState("left");
  const [partName, setPartName] = useState("");
  const [partPhoto, setPartPhoto] = useState(null); // base64 data URL of an attached reference photo
  const [scanningSketch, setScanningSketch] = useState(false);
  const [showCoilCalc, setShowCoilCalc] = useState(false);
  const [coilCalcGaugeThickness, setCoilCalcGaugeThickness] = useState(0.0239); // 24ga steel, inches
  const [coilCalcMaterial, setCoilCalcMaterial] = useState("steel");
  const [coilCalcOD, setCoilCalcOD] = useState(48);
  const [coilCalcID, setCoilCalcID] = useState(20);
  const [coilCalcWidth, setCoilCalcWidth] = useState(21);
  const [gaugeId, setGaugeId] = useState(GAUGE_OPTIONS[0].id);
  const [paintId, setPaintId] = useState(PAINT_OPTIONS[0].id);
  const [brand, setBrand] = useState(BRANDS[0]);
  const [colorName, setColorName] = useState(COLORS_BY_BRAND[BRANDS[0]][0].name);
  const [colorSearch, setColorSearch] = useState("");
  const [quantity, setQuantity] = useState(4);
  const [sheetWidth, setSheetWidth] = useState(48);
  const [lengthPerPiece, setLengthPerPiece] = useState(10);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [shopFloorView, setShopFloorView] = useState("jobs"); // "jobs" | "materials"
  const [expandedJobs, setExpandedJobs] = useState({});
  const [matStatus, setMatStatus] = useState({}); // materials pull board: lineKey -> "instock" | "pulled"
  const matSaveChain = useRef(Promise.resolve()); // serializes board writes so rapid taps can't land out of order
  const [submitting, setSubmitting] = useState(false);
  const [basket, setBasket] = useState([]);
  const [tabLoaded, setTabLoaded] = useState(false);
  // Job Vault — each member's saved trim/panel configs (Supabase vault_items, owner-only)
  const [vaultItems, setVaultItems] = useState([]);
  const [vaultLoaded, setVaultLoaded] = useState(false);
  const [vaultSaveOpen, setVaultSaveOpen] = useState(false);
  const [vaultJobName, setVaultJobName] = useState("");
  const [vaultExpanded, setVaultExpanded] = useState({});
  const [savingVault, setSavingVault] = useState(false);

  // Remember which section you were last on (personal, not shared — everyone gets their own).
  // ?view=color deep link (the site's Color Lab button) opens straight to Pick Your
  // Finish — and wins over the saved last-tab restore below.
  const deepLinkColor = new URLSearchParams(window.location.search).get("view") === "color";
  useEffect(() => {
    if (deepLinkColor) { setTab("order"); setOrderStep("color"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("last-tab", false);
        if (res?.value && !deepLinkColor) setTab(res.value);
      } catch (e) { /* first time opening, no saved tab yet */ }
      setTabLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tabLoaded) return; // don't overwrite the saved tab with the default before it's loaded
    storage.set("last-tab", tab, false).catch((e) => console.error("storage error", e));
  }, [tab, tabLoaded]);

  // Shop Floor is staff-only — if a customer's saved "last tab" happens to point there
  // (or they try to navigate there directly), bounce them back to New Order.
  useEffect(() => {
    if (tab === "dashboard" && !isStaff) setTab("order");
  }, [tab, isStaff]);

  useEffect(() => {
    if (priceListView === "backend" && !isStaff) setPriceListView("customer");
  }, [priceListView, isStaff]);

  // Orders live in their own table (not the shared app_storage blob) — RLS shows
  // customers only their own orders, staff see everything.
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from("orders").select("id, user_id, data").order("created_at", { ascending: false });
        if (!error && data) setOrders(data.map((r) => ({ ...r.data, userId: r.user_id })));
      } catch (e) { /* no orders yet */ }
      setLoaded(true);
    })();
  }, []);

  const insertOrders = async (newOrders) => {
    // attach userId locally so a just-submitted order shows in Past Orders without a reload
    setOrders((prev) => [...newOrders.map((o) => ({ ...o, userId: user?.id || null })), ...prev]);
    const rows = newOrders.map((o) => ({ id: o.id, user_id: user?.id || null, data: o, created_at: o.createdAt }));
    const { error } = await supabase.from("orders").insert(rows);
    if (error) {
      console.error("orders insert error", error);
      setToast("⚠️ Order didn't save — check your connection and try again.");
      setTimeout(() => setToast(""), 4000);
    }
  };

  const updateOrderRows = async (patched) => {
    setOrders((prev) => prev.map((o) => patched.find((p) => p.id === o.id) || o));
    for (const o of patched) {
      const { userId, ...data } = o;
      const { error } = await supabase.from("orders").update({ data }).eq("id", o.id);
      if (error) console.error("orders update error", error);
    }
  };

  // Load this member's Job Vault (RLS limits rows to their own).
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase.from("vault_items").select("*").order("created_at", { ascending: false });
      if (!error) setVaultItems(data || []);
      setVaultLoaded(true);
    })();
  }, [user]);

  // Coil wider than 24" isn't auto-priced — the form blanks out and says call for
  // price. Past 48" the shop can't run it at all, so the message hardens to
  // "Not available".
  const coilOverMax = (+coilWidth || 0) > 24;
  const coilUnavailable = (+coilWidth || 0) > 48;
  const coilGateText = coilUnavailable ? "Not available" : "Call for price";
  const coilGateColor = coilUnavailable ? "#B3261E" : AMBER;

  // The panel form's Coil $/LF reference follows the bracket scale for the selected
  // coil width and finish (scale prices are PVDF; SMP gets the ratio). Still editable.
  const panelCoilPerFt = () => {
    if (coilOverMax) return null;
    const per = coilPriceForWidth(+coilWidth || 0, coilWidthScale);
    if (per === null) return null;
    const pvdfM = PAINT_OPTIONS.find((p) => p.id === "pvdf")?.mult || 1;
    const m = brand === "Copper" ? 1 : (PAINT_OPTIONS.find((p) => p.id === paintId) || PAINT_OPTIONS[0]).mult;
    return Math.round(per * (m / pvdfM) * 100) / 100;
  };
  useEffect(() => {
    const v = panelCoilPerFt();
    if (v !== null) setCoilPricePerFt(v);
    else if (coilOverMax) setCoilPricePerFt("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coilWidth, paintId, brand, coilWidthScale]);

  const fabBases = (FAB_COMPANIES.find((c) => c.name === fabricatorCo) || FAB_COMPANIES[0]).bases;

  // Look up one-way driving miles from the chosen fabricator's NEAREST base to the
  // job site — geocode via OpenStreetMap, route via OSRM, straight-line ×1.25 fallback.
  const lookupJobSiteMiles = async () => {
    const addr = jobSiteAddress.trim();
    if (!addr) { setMilesLookupNote("Enter the job site address first."); return; }
    setMilesLookupBusy(true);
    setMilesLookupNote("");
    try {
      const g = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(addr)}`);
      const gj = await g.json();
      if (!gj || !gj[0]) throw new Error("not found");
      const lat = +gj[0].lat, lon = +gj[0].lon;
      let best = null;
      for (const base of fabBases) {
        let miles = null;
        try {
          const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${base.lng},${base.lat};${lon},${lat}?overview=false`);
          const rj = await r.json();
          if (rj?.routes?.[0]?.distance) miles = rj.routes[0].distance / 1609.34;
        } catch (e) { /* routing down — straight-line estimate below */ }
        const est = miles === null;
        if (est) miles = havMiles(base.lat, base.lng, lat, lon) * 1.25;
        if (!best || miles < best.miles) best = { miles, name: base.name, est };
      }
      const rounded = Math.max(1, Math.round(best.miles));
      setJobSiteMiles(rounded);
      setMilesLookupNote(`${rounded} mi one way from the ${best.name} shop${best.est ? " (estimated)" : ""}`);
    } catch (e) {
      setMilesLookupNote("Couldn't find that address — type the one-way miles in yourself.");
    }
    setMilesLookupBusy(false);
  };

  // Switching fabricators moves the home bases, so refresh the mileage lookup.
  useEffect(() => {
    if (runLocation === "Job Site" && jobSiteAddress.trim()) lookupJobSiteMiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricatorCo]);

  // Fabrication $/LF reference follows the Price List — profile-specific rows
  // (e.g. FWQ100 Fabrication) beat the generic Panel Fabrication rate.
  const panelFabPerFt = () => {
    const fabItem = findFabItem(priceList, profile);
    return fabItem ? fabItem.greenleaf : null;
  };
  useEffect(() => {
    const v = panelFabPerFt();
    if (v !== null) setFabPricePerFt(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceList, profile]);

  const DEFAULT_PRICE_LIST = [
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
    // prices are cost × 2.3, rounded to the cent.
    { id: "pc1", category: "Clips", name: 'FG-100-24 Clip (per clip)', cost: 0.133, tier1: 0.31, tier2: 0.31, greenleaf: 0.31 },
    { id: "pc2", category: "Clips", name: 'FG-158-24 Clip (per clip)', cost: 0.147, tier1: 0.34, tier2: 0.34, greenleaf: 0.34 },
    { id: "pc3", category: "Clips", name: 'FG-218-24 Clip (per clip)', cost: 0.317, tier1: 0.73, tier2: 0.73, greenleaf: 0.73 },
    { id: "pc4", category: "Clips", name: 'SG-114-24-SL Clip (per clip)', cost: 0.199, tier1: 0.46, tier2: 0.46, greenleaf: 0.46 },
    { id: "pc5", category: "Clips", name: 'SG-178-18 Clip (per clip)', cost: 0.271, tier1: 0.62, tier2: 0.62, greenleaf: 0.62 },
    { id: "p14", category: "Accessories", name: 'Clips (per 100, by profile)', cost: 0, tier1: 22.00, tier2: 26.00, greenleaf: 20.50 },
    // 3D Parts
    { id: "p15", category: "3D Parts", name: 'Collector Box (base fabrication fee)', cost: 0, tier1: 45.00, tier2: 55.00, greenleaf: 42.00 },
    { id: "p16", category: "3D Parts", name: 'Scupper (base fabrication fee)', cost: 0, tier1: 40.00, tier2: 50.00, greenleaf: 37.00 },
    { id: "p17", category: "3D Parts", name: 'Chimney Cap (base fabrication fee)', cost: 0, tier1: 50.00, tier2: 62.00, greenleaf: 47.00 },
  ];

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("shop-price-list", true);
        if (res?.value) {
          const parsed = JSON.parse(res.value);
          setPriceList(parsed.map((p) => ({ cost: 0, ...p })));
        }
        else setPriceList(DEFAULT_PRICE_LIST);
      } catch (e) { setPriceList(DEFAULT_PRICE_LIST); }
      setPriceListLoaded(true);
    })();
  }, []);

  const savePriceList = async (next) => {
    setPriceList(next);
    const attempt = async () => {
      try {
        const res = await storage.set("shop-price-list", JSON.stringify(next), true);
        return !!res; // storage.set can resolve to null on failure without throwing
      } catch (e) {
        console.error("storage error", e);
        return false;
      }
    };
    let ok = await attempt();
    if (!ok) ok = await attempt(); // one automatic retry before giving up
    if (!ok) {
      setToast("⚠️ Price list change didn't save — check your connection and try again.");
    }
  };

  const updatePriceListItem = (id, field, value) => {
    savePriceList(priceList.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };
  const addPriceListItem = () => {
    savePriceList([...priceList, { id: uid(), category: "Custom", name: "New Item", cost: 0, tier1: 0, tier2: 0, greenleaf: 0 }]);
  };
  const removePriceListItem = (id) => {
    savePriceList(priceList.filter((p) => p.id !== id));
  };
  const restorePriceListDefaults = () => {
    // Add back any default items that are currently missing (by id), without touching
    // anything you've kept, edited, or added yourself.
    const existingIds = new Set(priceList.map((p) => p.id));
    const missing = DEFAULT_PRICE_LIST.filter((p) => !existingIds.has(p.id));
    if (missing.length === 0) { setToast("Nothing missing — your price list already has every default item."); return; }
    savePriceList([...priceList, ...missing]);
    setToast(`Restored ${missing.length} item${missing.length === 1 ? "" : "s"} back to the price list.`);
  };

  // Staff-only: load every registered customer so their pricing tier can be assigned,
  // plus the current admin (staff) list for the toggle.
  useEffect(() => {
    if (!isStaff) return;
    (async () => {
      const { data, error } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
      if (!error) setCustomers(data || []);
      const { data: staffRows } = await supabase.from("staff").select("id");
      if (staffRows) setStaffIds(staffRows.map((s) => s.id));
      setCustomersLoaded(true);
    })();
  }, [isStaff]);

  const updateCustomerTier = async (customerId, tier) => {
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, tier } : c)));
    const { error } = await supabase.from("customers").update({ tier }).eq("id", customerId);
    if (error) {
      setToast("Couldn't save that — try again.");
      console.error(error);
    }
  };

  // Staff-only: load the shared materials pull board.
  useEffect(() => {
    if (!isStaff) return;
    (async () => {
      try {
        const res = await storage.get("shop-material-status", true);
        if (res?.value) setMatStatus(JSON.parse(res.value));
      } catch (e) { /* no board yet */ }
    })();
  }, [isStaff]);

  // Staff-only: grant or revoke backend admin access. RLS also blocks removing yourself.
  const toggleAdmin = async (customerId) => {
    if (customerId === user?.id) { setToast("That's you — you can't remove your own admin access."); setTimeout(() => setToast(""), 3500); return; }
    const isAdmin = staffIds.includes(customerId);
    setStaffIds((prev) => (isAdmin ? prev.filter((id) => id !== customerId) : [...prev, customerId]));
    const { error } = isAdmin
      ? await supabase.from("staff").delete().eq("id", customerId)
      : await supabase.from("staff").insert({ id: customerId });
    if (error) {
      setStaffIds((prev) => (isAdmin ? [...prev, customerId] : prev.filter((id) => id !== customerId)));
      setToast("Couldn't change admin access — try again.");
      setTimeout(() => setToast(""), 3500);
      console.error(error);
    }
  };

  // Staff-only: leads submitted through the roofcoil.com member gate (public.leads,
  // RLS lets anon insert but only staff read/delete).
  useEffect(() => {
    if (!isStaff) return;
    (async () => {
      const { data, error } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
      if (!error) setSiteLeads(data || []);
      setSiteLeadsLoaded(true);
    })();
  }, [isStaff]);

  const deleteSiteLead = async (id) => {
    setSiteLeads((prev) => prev.filter((l) => l.id !== id));
    const { error } = await supabase.from("leads").delete().eq("id", id);
    if (error) console.error(error);
  };

  // Staff-only: manufacturer applications from roofcoil.com/get-listed.html
  // (public.manufacturer_applications, same RLS shape as leads).
  useEffect(() => {
    if (!isStaff) return;
    (async () => {
      const { data, error } = await supabase.from("manufacturer_applications").select("*").order("created_at", { ascending: false });
      if (!error) setMfrApps(data || []);
      setMfrAppsLoaded(true);
    })();
  }, [isStaff]);

  const deleteMfrApp = async (id) => {
    setMfrApps((prev) => prev.filter((a) => a.id !== id));
    const { error } = await supabase.from("manufacturer_applications").delete().eq("id", id);
    if (error) console.error(error);
  };

  // Drag-to-reorder for price list items — touch-friendly, reorders live within the
  // same category, commits to storage once when you let go.
  const [dragItemId, setDragItemId] = useState(null); // for visual highlight only
  const dragItemIdRef = useRef(null); // the actual drag-tracking value — a ref so it's never stale mid-drag
  const priceRowRefs = useRef({});
  const livePriceListRef = useRef(priceList);
  useEffect(() => { livePriceListRef.current = priceList; }, [priceList]);
  const dragCategoryRef = useRef(null);

  const handleDragMove = useCallback((e) => {
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    // Auto-scroll the page when dragging near the top or bottom edge of the screen,
    // so you're not stuck fighting the viewport on a long list.
    const EDGE = 90, MAX_SPEED = 18;
    if (y < EDGE) {
      window.scrollBy(0, -MAX_SPEED * (1 - y / EDGE));
    } else if (y > window.innerHeight - EDGE) {
      window.scrollBy(0, MAX_SPEED * (1 - (window.innerHeight - y) / EDGE));
    }
    const cat = dragCategoryRef.current;
    const draggedId = dragItemIdRef.current;
    if (draggedId == null) return;
    const current = livePriceListRef.current;
    const idsInCat = current.filter((p) => p.category === cat).map((p) => p.id);
    for (const id of idsInCat) {
      if (id === draggedId) continue;
      const el = priceRowRefs.current[id];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) {
        const dragIdx = current.findIndex((p) => p.id === draggedId);
        const targetIdx = current.findIndex((p) => p.id === id);
        if (dragIdx === -1 || targetIdx === -1) break;
        const next = [...current];
        const [moved] = next.splice(dragIdx, 1);
        next.splice(targetIdx, 0, moved);
        livePriceListRef.current = next;
        setPriceList(next);
        break;
      }
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", handleDragEnd);
    dragItemIdRef.current = null;
    setDragItemId(null);
    savePriceList(livePriceListRef.current);
  }, [handleDragMove]);

  const handleDragStart = (item) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragItemIdRef.current = item.id;
    setDragItemId(item.id);
    dragCategoryRef.current = item.category;
    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
  };

  const moveItemInCategory = (id, direction) => { // direction: -1 = up, 1 = down
    const item = priceList.find((p) => p.id === id);
    if (!item) return;
    const sameCat = priceList.filter((p) => p.category === item.category);
    const idx = sameCat.findIndex((p) => p.id === id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= sameCat.length) return; // already at the top/bottom of its category
    const swapWith = sameCat[swapIdx];
    const fullIdxA = priceList.findIndex((p) => p.id === item.id);
    const fullIdxB = priceList.findIndex((p) => p.id === swapWith.id);
    const next = [...priceList];
    [next[fullIdxA], next[fullIdxB]] = [next[fullIdxB], next[fullIdxA]];
    savePriceList(next);
  };

  const DEFAULT_MATERIAL_COSTS = [
    { id: "m1", name: "24 Gauge Galvalume (per sq ft)", costPerSqft: 0, lastUpdated: null },
    { id: "m2", name: "24 Gauge Painted (per sq ft)", costPerSqft: 0, lastUpdated: null },
    { id: "m3", name: "16 oz Copper (per sq ft)", costPerSqft: 0, lastUpdated: null },
    { id: "m4", name: "20 oz Copper (per sq ft)", costPerSqft: 0, lastUpdated: null },
  ];

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("shop-material-costs", true);
        if (res?.value) {
          const parsed = JSON.parse(res.value);
          setMaterialCosts(parsed.map((m) => { const { unit, coilWidth, ...rest } = m; return rest; }));
        } else setMaterialCosts(DEFAULT_MATERIAL_COSTS);
      } catch (e) { setMaterialCosts(DEFAULT_MATERIAL_COSTS); }
      setMaterialCostsLoaded(true);
    })();
  }, []);

  const saveMaterialCosts = async (next) => {
    setMaterialCosts(next);
    try { await storage.set("shop-material-costs", JSON.stringify(next), true); }
    catch (e) { console.error("storage error", e); }
  };

  const updateMaterialCost = (id, value) => {
    const today = new Date().toISOString().slice(0, 10);
    saveMaterialCosts(materialCosts.map((m) => (m.id === id ? { ...m, costPerSqft: value, lastUpdated: today } : m)));
  };

  const DEFAULT_PRODUCTION_COSTS = [
    { id: "pc1", name: "Flat Sheet (per sheet)", cost: 0, lastUpdated: null },
    { id: "pc2", name: "Coil (per LF)", cost: 0, lastUpdated: null },
    { id: "pc3", name: "Plastic (per LF)", cost: 0, lastUpdated: null },
  ];

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("shop-production-costs", true);
        if (res?.value) setProductionCosts(JSON.parse(res.value));
        else setProductionCosts(DEFAULT_PRODUCTION_COSTS);
      } catch (e) { setProductionCosts(DEFAULT_PRODUCTION_COSTS); }
      setProductionCostsLoaded(true);
    })();
  }, []);

  const saveProductionCosts = async (next) => {
    setProductionCosts(next);
    try { await storage.set("shop-production-costs", JSON.stringify(next), true); }
    catch (e) { console.error("storage error", e); }
  };

  const updateProductionCost = (id, value) => {
    const today = new Date().toISOString().slice(0, 10);
    saveProductionCosts(productionCosts.map((p) => (p.id === id ? { ...p, cost: value, lastUpdated: today } : p)));
  };

  const DEFAULT_COIL_WIDTH_SCALE = [
    { id: "cw1", width: 16, pricePerFt: 2.56 },
    { id: "cw2", width: 21, pricePerFt: 3.03 },
    { id: "cw3", width: 24, pricePerFt: 3.31 },
  ];

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("shop-coil-width-scale", true);
        if (res?.value) setCoilWidthScale(JSON.parse(res.value));
        else setCoilWidthScale(DEFAULT_COIL_WIDTH_SCALE);
      } catch (e) { setCoilWidthScale(DEFAULT_COIL_WIDTH_SCALE); }
      setCoilWidthScaleLoaded(true);
    })();
  }, []);

  const saveCoilWidthScale = async (next) => {
    setCoilWidthScale(next);
    try { await storage.set("shop-coil-width-scale", JSON.stringify(next), true); }
    catch (e) { console.error("storage error", e); }
  };

  const updateCoilScalePoint = (id, field, value) => {
    saveCoilWidthScale(coilWidthScale.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };
  const addCoilScalePoint = () => {
    saveCoilWidthScale([...coilWidthScale, { id: uid(), width: 24, pricePerFt: 0 }]);
  };
  const removeCoilScalePoint = (id) => {
    saveCoilWidthScale(coilWidthScale.filter((c) => c.id !== id));
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("shop-custom-trim-presets", true);
        if (res?.value) setCustomPresets(JSON.parse(res.value));
      } catch (e) { /* none saved yet */ }
      setCustomPresetsLoaded(true);
    })();
  }, []);

  const saveCustomPresets = async (next) => {
    setCustomPresets(next);
    try { await storage.set("shop-custom-trim-presets", JSON.stringify(next), true); }
    catch (e) { console.error("storage error", e); }
  };

  const saveCurrentAsPreset = () => {
    if (points.length < 2) { setToast("Draw a shape first before saving it as a preset."); return; }
    const name = window.prompt("Name this preset (e.g. \"Custom Sill Flashing\"):");
    if (!name || !name.trim()) return;
    saveCustomPresets([...customPresets, { id: uid(), name: name.trim(), points: points.map((pt) => [...pt]) }]);
    setToast(`Saved "${name.trim()}" to your preset library.`);
  };
  const deleteCustomPreset = (id) => {
    saveCustomPresets(customPresets.filter((p) => p.id !== id));
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("shop-idea-box", true);
        if (res?.value) setIdeas(JSON.parse(res.value));
      } catch (e) { /* none submitted yet */ }
      setIdeasLoaded(true);
    })();
  }, []);

  const submitIdea = async () => {
    if (!ideaText.trim()) { setToast("Write something first before submitting."); return; }
    setIdeaSubmitting(true);
    const next = [{ id: uid(), type: ideaType, text: ideaText.trim(), submittedBy: customerName.trim() || "Anonymous", createdAt: new Date().toISOString() }, ...ideas];
    setIdeas(next);
    try { await storage.set("shop-idea-box", JSON.stringify(next), true); }
    catch (e) { console.error("storage error", e); }
    setIdeaSubmitting(false);
    setIdeaText("");
    setShowIdeaBox(false);
    setToast(ideaType === "bug" ? "Thanks — bug reported to the shop." : "Thanks — idea submitted!");
    setTimeout(() => setToast(""), 3000);
  };
  const deleteIdea = async (id) => {
    const next = ideas.filter((i) => i.id !== id);
    setIdeas(next);
    try { await storage.set("shop-idea-box", JSON.stringify(next), true); }
    catch (e) { console.error("storage error", e); }
  };

  // Resizes/compresses a photo client-side before storing it (as a data URL) so a
  // full-resolution phone photo doesn't blow past storage limits — caps the longest
  // side at 1000px and re-encodes as JPEG at moderate quality.
  const handlePhotoAttach = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1000;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setPartPhoto(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  // Sends a photo of a hand-drawn sketch to Claude's vision API and asks it to read
  // off the shape (and any handwritten dimensions) as a straight-line point path,
  // which becomes the starting drawing — this is a best-effort AI reading of a messy
  // hand sketch, not precise tracing, so the result should always be checked and
  // adjusted afterward rather than trusted blindly.
  const scanSketchToPoints = (file) => {
    if (!file) return;
    setScanningSketch(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const img = new Image();
        const dataUrl = await new Promise((resolve, reject) => {
          img.onload = () => {
            const maxSide = 1200;
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.85));
          };
          img.onerror = reject;
          img.src = e.target.result;
        });
        const base64 = dataUrl.split(",")[1];

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1000,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
                {
                  type: "text",
                  text: "This is a photo of a hand-drawn sketch of a sheet metal trim/flashing cross-section profile — a shape made of connected straight line segments. Read any handwritten dimensions (lengths in inches or feet, angles in degrees) if present, and use them to size each segment accurately. If a segment isn't labeled, estimate its length proportionally relative to the labeled ones. Trace the profile as a connected path of straight segments only (no curves), starting from one end. Respond with ONLY a JSON array of [x, y] coordinate pairs in inches, like [[0,0],[4,0],[4,-2]] — no markdown code fences, no explanation, nothing else.",
                },
              ],
            }],
          }),
        });
        const data = await response.json();
        const textBlock = (data.content || []).find((b) => b.type === "text");
        if (!textBlock) throw new Error("No response from the model");
        const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed) || parsed.length < 2 || !parsed.every((p) => Array.isArray(p) && p.length === 2 && isFinite(p[0]) && isFinite(p[1]))) {
          throw new Error("Couldn't make sense of that sketch");
        }
        setPoints(parsed);
        setViewResetKey((k) => k + 1);
        setToast("Sketch scanned — check the shape and adjust any points/lengths before using it.");
        setTimeout(() => setToast(""), 5000);
      } catch (err) {
        console.error("scanSketchToPoints error", err);
        setToast("Couldn't read that sketch — try a clearer photo, or draw it by hand instead.");
        setTimeout(() => setToast(""), 4000);
      } finally {
        setScanningSketch(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Draft-value helpers: while typing, the field shows exactly what was typed (including
  // "4.", a trailing decimal, or an empty field mid-edit) instead of a value re-parsed and
  // snapped back on every keystroke. The real numeric value only commits on blur.
  const draftValue = (key, committed) => (priceDrafts[key] !== undefined ? priceDrafts[key] : String(committed ?? ""));
  const setDraft = (key, text) => setPriceDrafts((d) => ({ ...d, [key]: text }));
  const commitDraft = (key, fallback, onCommit) => {
    const raw = priceDrafts[key];
    setPriceDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
    if (raw === undefined) return;
    const parsed = parseFloat(raw);
    onCommit(isFinite(parsed) ? parsed : fallback);
  };
  // Pressing Enter blurs the field, which triggers the existing onBlur commit — so a
  // save isn't solely dependent on the browser firing a real blur event (flaky on some
  // mobile/tablet keyboards when tapping "Done" or switching fields quickly).
  const commitOnEnter = (e) => { if (e.key === "Enter") e.target.blur(); };

  const seedSampleOrders = async () => {
    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const trimColor = (brandName, name) => {
      const c = COLORS_BY_BRAND[brandName].find((x) => x.name === name) || COLORS_BY_BRAND[brandName][0];
      return { colorName: c.name, colorHex: c.hex };
    };
    const mkTrim = (over) => {
      const base = {
        id: uid(), type: "trim", partName: "Sample Part",
        customerName: "Sample Customer", phone: "(555) 555-0100",
        points: TRIM_PRESETS["Eave"], lengthPerPiece: 10, hemStart: "none", hemEnd: "none", paintSide: "left",
        quantity: 4, gaugeId: GAUGE_OPTIONS[0].id, paintId: PAINT_OPTIONS[0].id, brand: "Fortified Metal",
        notes: "", status: "Pending", createdAt: daysAgo(1),
        ...trimColor("Fortified Metal", "Charcoal Gray"),
      };
      const merged = { ...base, ...over };
      // Same math the real order form uses when a trim order is actually submitted,
      // so sample/seed data rolls up into Materials Needed the same way real orders do.
      const girth = merged.points.reduce((s, p, i) => s + (i > 0 ? dist(merged.points[i - 1], p) : 0), 0);
      const sheetWidth = merged.sheetWidth || 48;
      const partsPerSheet = girth > 0 ? Math.floor(sheetWidth / girth) : 0;
      const sheetsNeeded = partsPerSheet > 0 ? Math.ceil(merged.quantity / partsPerSheet) : 0;
      Object.assign(merged, { girth, sheetWidth, partsPerSheet, sheetsNeeded });
      merged.price = computePrice(merged, priceList, coilWidthScale);
      return merged;
    };
    const mkPanel = (over) => {
      const base = {
        id: uid(), type: "panel",
        customerName: "Sample Customer", phone: "(555) 555-0100",
        profile: PROFILES[0], width: 16, height: 120, quantity: 6, runLocation: "Shop", ribStyle: "none", clipRelief: false,
        gaugeId: GAUGE_OPTIONS[0].id, paintId: PAINT_OPTIONS[0].id, brand: "Fortified Metal",
        notes: "", status: "Pending", createdAt: daysAgo(1),
        ...trimColor("Fortified Metal", "Charcoal Gray"),
      };
      const merged = { ...base, ...over };
      merged.price = computePrice(merged, priceList, coilWidthScale);
      return merged;
    };

    // Each customer's parts (trim + panel) share one jobId, so the whole
    // job — every piece of trim and every panel — groups together as one order.
    const jobDave = uid();
    const jobPriya = uid();
    const jobMarcus = uid();
    const jobTammy = uid();

    const samples = [
      // Dave Rutherford — 2 trim pieces + 1 panel run, all Pending
      mkTrim({ jobId: jobDave, partName: "Eave — North Slope", customerName: "Dave Rutherford", phone: "(817) 555-0142",
        points: TRIM_PRESETS["Eave"], quantity: 12, lengthPerPiece: 10, hemStart: "closed-left",
        brand: "Berridge", ...trimColor("Berridge", "Charcoal Grey"), status: "Pending", createdAt: daysAgo(1) }),
      mkTrim({ jobId: jobDave, partName: "Rake — West Gable", customerName: "Dave Rutherford", phone: "(817) 555-0142",
        points: TRIM_PRESETS["Rake"], quantity: 8, lengthPerPiece: 10, hemEnd: "open-right",
        brand: "Berridge", ...trimColor("Berridge", "Charcoal Grey"), status: "Pending", createdAt: daysAgo(1) }),
      mkTrim({ jobId: jobDave, partName: "Ridge Cap — North Slope", customerName: "Dave Rutherford", phone: "(817) 555-0142",
        points: TRIM_PRESETS["Ridge Cap"], quantity: 4, lengthPerPiece: 10,
        brand: "Berridge", ...trimColor("Berridge", "Charcoal Grey"), status: "Pending", createdAt: daysAgo(1) }),
      mkPanel({ jobId: jobDave, customerName: "Dave Rutherford", phone: "(817) 555-0142", profile: "SS150 – 1.5\" Mechanical Seam",
        width: 16, height: 216, quantity: 22,
        brand: "Berridge", ...trimColor("Berridge", "Charcoal Grey"), status: "Pending", createdAt: daysAgo(1) }),

      // Priya Anand — 2 trim pieces + 2 panel runs, all In Production
      mkTrim({ jobId: jobPriya, partName: "Ridge Cap — Main House", customerName: "Priya Anand", phone: "(972) 555-0118",
        points: TRIM_PRESETS["Ridge Cap"], quantity: 6, lengthPerPiece: 10,
        brand: "Una-Clad", ...trimColor("Una-Clad", "Hartford Green"), status: "In Production", createdAt: daysAgo(3) }),
      mkTrim({ jobId: jobPriya, partName: "Sidewall Flashing — Chimney", customerName: "Priya Anand", phone: "(972) 555-0118",
        points: TRIM_PRESETS["Sidewall Flashing"], quantity: 4, lengthPerPiece: 8, hemStart: "closed-right",
        brand: "Una-Clad", ...trimColor("Una-Clad", "Hartford Green"), status: "In Production", createdAt: daysAgo(3) }),
      mkPanel({ jobId: jobPriya, customerName: "Priya Anand", phone: "(972) 555-0118", profile: "SS450 – 1.5\" Snap-Lock",
        width: 18, height: 180, quantity: 16,
        brand: "Una-Clad", ...trimColor("Una-Clad", "Hartford Green"), status: "In Production", createdAt: daysAgo(3) }),
      mkPanel({ jobId: jobPriya, customerName: "Priya Anand", phone: "(972) 555-0118", profile: "FWQ100 – 1\" Flush Wall / Soffit",
        width: 12, height: 108, quantity: 10,
        brand: "Una-Clad", ...trimColor("Una-Clad", "Hartford Green"), status: "In Production", createdAt: daysAgo(3) }),

      // Marcus Webb — 2 trim pieces + 1 panel run, all Ready for Pickup
      mkTrim({ jobId: jobMarcus, partName: "F-Channel — Soffit Return", customerName: "Marcus Webb", phone: "(469) 555-0177",
        points: TRIM_PRESETS["F-Channel"], quantity: 10, lengthPerPiece: 10,
        brand: "Adax Metals", ...trimColor("Adax Metals", "Matte Black"), status: "Ready for Pickup", createdAt: daysAgo(5) }),
      mkTrim({ jobId: jobMarcus, partName: "Z-Bar — Wainscot Transition", customerName: "Marcus Webb", phone: "(469) 555-0177",
        points: TRIM_PRESETS["Z-Bar"], quantity: 14, lengthPerPiece: 10,
        brand: "Adax Metals", ...trimColor("Adax Metals", "Matte Black"), status: "Ready for Pickup", createdAt: daysAgo(5) }),
      mkPanel({ jobId: jobMarcus, customerName: "Marcus Webb", phone: "(469) 555-0177", profile: "BB750 – Board and Batten",
        width: 12, height: 144, quantity: 30, runLocation: "Job Site",
        brand: "Adax Metals", ...trimColor("Adax Metals", "Matte Black"), status: "Ready for Pickup", createdAt: daysAgo(5) }),

      // Tammy Ostrowski — 2 trim pieces + 1 panel run, all Completed
      mkTrim({ jobId: jobTammy, partName: "Eave — Shop Addition", customerName: "Tammy Ostrowski", phone: "(214) 555-0163",
        points: TRIM_PRESETS["Eave"], quantity: 20, lengthPerPiece: 10, hemStart: "closed-left", hemEnd: "closed-left",
        brand: "Fortified Metal", ...trimColor("Fortified Metal", "Copper Metallic"), status: "Completed", createdAt: daysAgo(9) }),
      mkTrim({ jobId: jobTammy, partName: "Ridge Cap — Shop Addition", customerName: "Tammy Ostrowski", phone: "(214) 555-0163",
        points: TRIM_PRESETS["Ridge Cap"], quantity: 5, lengthPerPiece: 10,
        brand: "Fortified Metal", ...trimColor("Fortified Metal", "Copper Metallic"), status: "Completed", createdAt: daysAgo(9) }),
      mkPanel({ jobId: jobTammy, customerName: "Tammy Ostrowski", phone: "(214) 555-0163", profile: "FWQ100 – 1\" Flush Wall / Soffit",
        width: 12, height: 96, quantity: 40,
        brand: "Fortified Metal", ...trimColor("Fortified Metal", "Copper Metallic"), status: "Completed", createdAt: daysAgo(9) }),
    ];
    const poByJob = { [jobDave]: "PO-1001", [jobPriya]: "PO-1002", [jobMarcus]: "PO-1003", [jobTammy]: "PO-1004" };
    samples.forEach((o) => { o.poNumber = poByJob[o.jobId]; });
    await insertOrders(samples);
    setToast(`Added ${samples.length} sample orders across 4 jobs to the Shop Floor.`);
    setTimeout(() => setToast(""), 4000);
  };

  const colorObj = findColor(colorName, brand, paintId);
  const activeGauge = findGauge(gaugeId, brand);
  const activePaint = brand === "Copper" ? { mult: 1 } : (PAINT_OPTIONS.find((p) => p.id === paintId) || PAINT_OPTIONS[0]);
  const activePremiumMult = colorObj?.premium ? 1.12 : 1;
  const activeRates = getSellRates(gaugeId, brand, priceList, profile);
  const ratePerSqft = activeRates.coilSqft * activePaint.mult * activePremiumMult;
  const activeFlatMaterialItem = priceList?.find((p) => p.name.toLowerCase().includes("flat sheet material") && typeof p.greenleaf === "number");
  const activeFlatProcessingItem = priceList?.find((p) => p.name.toLowerCase().includes("flat sheet processing") && typeof p.greenleaf === "number");
  const activeFlatMaterialRate = activeFlatMaterialItem ? activeFlatMaterialItem.greenleaf : activeRates.coilSqft;
  const activeFlatProcessingFee = activeFlatProcessingItem ? activeFlatProcessingItem.greenleaf : 0;
  const flatSheetPrice = (((+flatWidth || 0) * (+flatLength || 0)) / 144) * activeFlatMaterialRate * activePaint.mult * activePremiumMult + activeFlatProcessingFee;
  const interpolatedCoilPerFt = coilPriceForWidth(+metalCoilWidth || 0, coilWidthScale);
  const pvdfMultRef = PAINT_OPTIONS.find((p) => p.id === "pvdf")?.mult || 1;
  const metalCoilPricePerFt = interpolatedCoilPerFt !== null
    ? interpolatedCoilPerFt * (activePaint.mult / pvdfMultRef)
    : ((+metalCoilWidth || 0) / 12) * ratePerSqft;
  const handleBrandChange = (nextBrand) => {
    setBrand(nextBrand);
    // paintId hasn't been updated yet at this point (that happens below), so figure out
    // what paint type this brand will actually end up on before picking its default color.
    const nextPaintId = PVDF_24GA_ONLY_BRANDS.includes(nextBrand) || PVDF_ONLY_BRANDS.includes(nextBrand) ? "pvdf" : paintId;
    setColorName(getColorsForBrand(nextBrand, nextPaintId)[0].name);
    setColorSearch("");
    // gauge ids like "24ga" are reused across different option sets with different prices,
    // so switching brands always resets to that brand's own first (correct) gauge option.
    const nextGaugeSet = nextBrand === "Copper" ? COPPER_WEIGHT_OPTIONS
      : nextBrand === "G90 Galvanized" ? G90_GAUGE_OPTIONS
      : nextBrand === "Galvalume" ? GALVALUME_GAUGE_OPTIONS
      : nextBrand === "Bonderized" ? BONDERIZED_GAUGE_OPTIONS
      : PVDF_24GA_ONLY_BRANDS.includes(nextBrand) ? GAUGE_OPTIONS.filter((g) => g.id === "24ga")
      : GAUGE_OPTIONS;
    setGaugeId(nextGaugeSet[0].id);
    if (PVDF_24GA_ONLY_BRANDS.includes(nextBrand) || PVDF_ONLY_BRANDS.includes(nextBrand)) {
      setPaintId("pvdf"); // Kynar 500/Hylar 5000 (PVDF) only — no SMP
    }
  };
  const handlePaintChange = (nextPaintId) => {
    setPaintId(nextPaintId);
    // Some brands carry genuinely different color palettes for
    // PVDF vs SMP — if the current color doesn't exist under the new paint type, fall
    // back to that palette's first color instead of leaving an invalid selection.
    const nextColors = getColorsForBrand(brand, nextPaintId);
    if (!nextColors.find((c) => c.name === colorName)) {
      setColorName(nextColors[0].name);
    }
  };
  // brand matters: Copper/G90/Galvalume/Bonderized price from their own rate tables,
  // and submitOrder computes the real order price WITH brand — the estimate must match it.
  const draft = shapeType === "panel"
    ? { type: "panel", width, height, quantity, gaugeId, paintId, brand, colorName, runLocation, jobSiteMiles }
    : shapeType === "metal"
    ? { type: "metal", flatWidth, flatLength, coilWidth: metalCoilWidth, coilLength: metalCoilLength, quantity, gaugeId, paintId, brand, colorName }
    : shapeType === "part3d"
    ? { type: "part3d", partType, partW, partD, partH, partCapH, outletShape, flangeW, flangeD, outletDiameter, outletLength, topTrim, bodyTaper, taperStart, taperLength, flangeTapered, flangeLength, outletRoundTapered, capStyle, quantity, gaugeId, paintId, brand, colorName }
    : { type: "trim", points, quantity, lengthPerPiece, gaugeId, paintId, brand, colorName };
  const estimate = computePrice(draft, priceList, coilWidthScale);
  const girth = points.reduce((s, p, i) => s + (i > 0 ? dist(points[i - 1], p) : 0), 0);
  const partsPerSheet = girth > 0 ? Math.floor(sheetWidth / girth) : 0;
  const sheetsNeeded = partsPerSheet > 0 ? Math.ceil(quantity / partsPerSheet) : 0;
  const dropWidth = partsPerSheet > 0 ? Math.max(0, sheetWidth - partsPerSheet * girth) : sheetWidth;

  const resetForm = () => {
    setOrderStep("type");
    setShapeType("panel"); setWidth(16.88); setHeight(853.08); setCoilWidth(21); setProfile(PROFILES[0]); setRunLocation("Shop"); setJobSiteAddress(""); setJobSiteMiles(""); setMilesLookupNote(""); setSupplierCo("Fortified Metal"); setFabricatorCo("Fortified Metal"); setRibStyle(null); setClipRelief(null);
    setFlatWidth(48); setFlatLength(120); setMetalCoilWidth(21); setMetalCoilLength(12000);
    setAccessories([]); setAccType("Screws"); setAccSpec(ACCESSORY_SPECS.Screws[0]); setAccProfile(PROFILES[0]); setAccQty(1);
    setPartType("collector"); setPartW(12); setPartD(8); setPartH(10); setPartCapH(6); setPartView("3d"); setCapStyle("pyramid");
    setOutletShape("box"); setFlangeW(4); setFlangeD(4); setOutletDiameter(4); setOutletLength(6); setFlangeTapered(true);
    setFlangeLength(4); setOutletRoundTapered(false);
    setTopTrim(false); setBodyTaper(false); setTaperStart(0); setTaperLength(6);
    setPoints(TRIM_PRESETS["Eave"]); setPreset("Eave");
    setHemStart("none"); setHemEnd("none"); setPaintSide("left");
    setGaugeId(GAUGE_OPTIONS[0].id); setPaintId(PAINT_OPTIONS[0].id); setBrand(BRANDS[0]); setColorName(COLORS_BY_BRAND[BRANDS[0]][0].name);
    setQuantity(4); setLengthPerPiece(10); setSheetWidth(48); setPartName("");
    setCustomerName(""); setPhone(""); setNotes("");
  };

  const clearDrawing = () => {
    setPoints([]); setHemStart("none"); setHemEnd("none"); setPaintSide("left");
    setQuantity(4); setLengthPerPiece(10); setPartName("");
  };

  const addToBasket = () => {
    if (points.length < 2) { setToast("Draw at least two points before adding this part to the order."); return; }
    const item = {
      id: uid(),
      name: partName.trim() || `Part ${basket.length + 1}`,
      points, hemStart, hemEnd, paintSide, quantity, lengthPerPiece, sheetWidth,
      girth, partsPerSheet, sheetsNeeded, dropWidth, photo: partPhoto,
      gaugeId, paintId, brand, colorName, colorHex: colorObj.hex,
      price: computePrice({ type: "trim", points, quantity, lengthPerPiece, gaugeId, paintId, brand, colorName }, priceList, coilWidthScale),
    };
    setBasket((b) => [...b, item]);
    clearDrawing();
    setPartPhoto(null);
    setToast(`"${item.name}" added to the order — ${basket.length + 1} part${basket.length + 1 === 1 ? "" : "s"} so far.`);
    setTimeout(() => setToast(""), 3000);
  };

  const removeBasketItem = (id) => setBasket((b) => b.filter((i) => i.id !== id));

  // Screws only sell in lots of 100 — the qty spinner steps by the lot size and any
  // typed amount rounds to the nearest full lot. Every other accessory counts by 1.
  const screwLots = accType === "Screws";
  const accClipSpec = accType === "Clips" ? clipSpecForProfile(accProfile) : null;
  // Fastener-flange and flush wall/soffit panels screw straight through the flange.
  const accNoClip = accType === "Clips" && ["FF100", "FWQ100"].includes(PROFILE_INFO[accProfile]?.code);
  useEffect(() => {
    // Fresh sensible qty per accessory type: screws start at a full lot, everything else at 1.
    setAccQty(screwLots ? 100 : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accType]);

  const addAccessory = () => {
    if (accNoClip) return; // flange panels don't take clips
    let qty = Math.max(1, +accQty || 1);
    if (screwLots) qty = Math.max(100, Math.round(qty / 100) * 100);
    let label = accSpec;
    if (accType === "Sealant") label = accSealColor === "match" ? `Sealant — color-matched (${colorName})` : `Sealant — ${accSealColor}`;
    if (accType === "Clips") {
      const cs = clipSpecForProfile(accProfile);
      label = cs ? `Clips ${cs.code} — ${accProfile} (${cs.perBox}/box, ${(qty * cs.perBox).toLocaleString()} clips total)` : `Clips — ${accProfile}`;
    }
    setAccessories((a) => [...a, { id: uid(), type: accType, label, qty }]);
    setAccQty(1);
  };
  const removeAccessory = (id) => setAccessories((a) => a.filter((x) => x.id !== id));

  const basketPartsCount = basket.reduce((s, i) => s + i.quantity, 0);
  const basketSheets = basket.reduce((s, i) => s + i.sheetsNeeded, 0);
  const basketTotal = basket.reduce((s, i) => s + i.price, 0);
  const combinedEstimate = shapeType === "trim"
    ? basketTotal + (points.length >= 2 ? estimate : 0)
    : estimate;

  // PO numbers come from a server-side counter — customers only see their own
  // orders now, so a client-side count would collide across accounts.
  const nextPoNumber = async () => {
    try {
      const { data, error } = await supabase.rpc("next_po_number");
      if (!error && data) return data;
    } catch (e) {}
    const distinctJobs = new Set(orders.map((o) => o.jobId).filter(Boolean));
    return `PO-${1000 + distinctJobs.size + 1}`;
  };

  const submitOrder = async () => {
    if (!customerName.trim()) { setToast("Add a name so the shop knows who this is for."); return; }
    if (shapeType === "panel") {
      if (ribStyle === null) { setToast("Pick a rib style (or None) before sending the order."); return; }
      if (clipRelief === null) { setToast("Choose whether Clip Relief is ON or OFF before sending the order."); return; }
      if (coilUnavailable) { setToast("Coil over 48\" isn't available — 48\" is the widest we can run."); setTimeout(() => setToast(""), 5000); return; }
      if (runLocation === "Job Site" && (jobSiteAddress.trim() === "" || jobSiteMiles === "")) { setToast("Add the job site address and tap Look up (or type the one-way miles) so mileage can be figured."); setTimeout(() => setToast(""), 5000); return; }
      if (coilOverMax) { setToast("Coil over 24\" can't be priced online — call the shop and we'll quote it."); setTimeout(() => setToast(""), 5000); return; }
    }

    if (shapeType === "trim") {
      const items = [...basket];
      if (points.length >= 2) {
        items.push({
          id: uid(), name: partName.trim() || `Part ${basket.length + 1}`,
          points, hemStart, hemEnd, paintSide, quantity, lengthPerPiece, sheetWidth,
          girth, partsPerSheet, sheetsNeeded, gaugeId, paintId, brand, colorName, colorHex: colorObj.hex, photo: partPhoto,
        });
      }
      if (items.length === 0) { setToast("Draw at least two points, or add a part to the order first."); return; }
      setSubmitting(true);
      const jobId = uid();
      const poNumber = await nextPoNumber();
      const newOrders = items.map((it, idx) => {
        const order = {
          id: uid(),
          jobId,
          poNumber,
          type: "trim",
          // accessories ride on the job's first part only, so quantities aren't duplicated per part
          accessories: idx === 0 && accessories.length > 0 ? accessories : undefined,
          partName: it.name,
          customerName: customerName.trim(),
          phone: phone.trim(),
          points: it.points,
          lengthPerPiece: it.lengthPerPiece,
          hemStart: it.hemStart,
          hemEnd: it.hemEnd,
          paintSide: it.paintSide,
          quantity: it.quantity,
          gaugeId: it.gaugeId,
          paintId: it.paintId,
          brand: it.brand,
          colorName: it.colorName,
          colorHex: it.colorHex,
          photo: it.photo || null,
          notes: notes.trim(),
          status: "Pending",
          createdAt: new Date().toISOString(),
        };
        order.price = computePrice(order, priceList, coilWidthScale);
        return order;
      });
      await insertOrders(newOrders);
      setSubmitting(false);
      const totalPrice = newOrders.reduce((s, o) => s + o.price, 0);
      setToast(`Order sent — ${newOrders.length} part${newOrders.length === 1 ? "" : "s"}, estimate ${money(totalPrice)}. The shop will confirm final pricing.`);
      setBasket([]);
      resetForm();
      setTimeout(() => setToast(""), 6000);
      return;
    }

    setSubmitting(true);
    const isMetal = shapeType === "metal";
    const isPart3d = shapeType === "part3d";
    const order = {
      id: uid(),
      jobId: uid(),
      poNumber: await nextPoNumber(),
      type: shapeType,
      customerName: customerName.trim(),
      phone: phone.trim(),
      profile: isMetal || isPart3d ? undefined : profile,
      width: isMetal || isPart3d ? undefined : width,
      height: isMetal || isPart3d ? undefined : height,
      flatWidth: isMetal ? flatWidth : undefined,
      flatLength: isMetal ? flatLength : undefined,
      coilWidth: isMetal ? metalCoilWidth : undefined,
      accessories: !isPart3d && accessories.length > 0 ? accessories : undefined,
      coilLength: isMetal ? metalCoilLength : undefined,
      partType: isPart3d ? partType : undefined,
      partW: isPart3d ? partW : undefined,
      partD: isPart3d ? partD : undefined,
      partH: isPart3d ? partH : undefined,
      partCapH: isPart3d && partType === "chimney" ? partCapH : undefined,
      capStyle: isPart3d && partType === "chimney" ? capStyle : undefined,
      outletShape: isPart3d && partType === "collector" ? outletShape : undefined,
      flangeW: isPart3d && partType === "collector" && outletShape === "box" ? flangeW : undefined,
      flangeD: isPart3d && partType === "collector" && outletShape === "box" ? flangeD : undefined,
      flangeTapered: isPart3d && partType === "collector" && outletShape === "box" ? flangeTapered : undefined,
      flangeLength: isPart3d && partType === "collector" && outletShape === "box" ? flangeLength : undefined,
      outletRoundTapered: isPart3d && partType === "collector" && outletShape === "round" ? outletRoundTapered : undefined,
      outletDiameter: isPart3d && partType === "collector" && outletShape === "round" ? outletDiameter : undefined,
      outletLength: isPart3d && partType === "collector" && outletShape === "round" ? outletLength : undefined,
      topTrim: isPart3d && partType === "collector" ? topTrim : undefined,
      bodyTaper: isPart3d && partType === "collector" ? bodyTaper : undefined,
      taperStart: isPart3d && partType === "collector" && bodyTaper ? taperStart : undefined,
      taperLength: isPart3d && partType === "collector" && bodyTaper ? taperLength : undefined,
      quantity,
      runLocation: isMetal || isPart3d ? undefined : runLocation,
      jobSiteAddress: !isMetal && !isPart3d && runLocation === "Job Site" ? jobSiteAddress.trim() : "",
      jobSiteMiles: !isMetal && !isPart3d && runLocation === "Job Site" ? (+jobSiteMiles || 0) : undefined,
      metalSupplier: !isMetal && !isPart3d ? supplierCo : undefined,
      fabricator: !isMetal && !isPart3d ? fabricatorCo : undefined,
      ribStyle: isMetal || isPart3d ? undefined : ribStyle,
      clipRelief: isMetal || isPart3d ? undefined : clipRelief,
      gaugeId,
      paintId,
      brand,
      colorName,
      colorHex: colorObj.hex,
      notes: notes.trim(),
      status: "Pending",
      createdAt: new Date().toISOString(),
    };
    order.price = computePrice(order, priceList, coilWidthScale);
    await insertOrders([order]);
    setSubmitting(false);
    setToast(`Order sent — estimate ${money(order.price)}. The shop will confirm final pricing.`);
    resetForm();
    setTimeout(() => setToast(""), 5000);
  };

  /* ---------- Job Vault ---------- */
  const vaultCurrentPrice = (item) => computePrice(item.payload || {}, priceList, coilWidthScale);
  // An item alerts when today's price is above the last price the member acknowledged
  // (or the price at save time, if they never dismissed an alert).
  const vaultIncrease = (item) => {
    const cur = vaultCurrentPrice(item);
    const ref = item.acked_price != null ? Number(item.acked_price) : Number(item.saved_price);
    return cur - ref > 0.005 ? cur - ref : 0;
  };
  // Until the price list arrives, computePrice runs on hardcoded fallback rates —
  // don't raise (or count) price alerts against those transient numbers.
  const vaultAlertCount = priceListLoaded ? vaultItems.filter((v) => vaultIncrease(v) > 0).length : 0;
  const vaultJobNames = [...new Set(vaultItems.map((v) => v.job_name))];

  // Past Orders: only this member's own submissions (staff use Shop Floor for the rest)
  const myOrders = orders.filter((o) => o.userId === (user?.id || ""));
  const myJobKeys = [...new Set(myOrders.map((o) => o.jobId || o.id))];

  const vaultItemLabel = (v) => {
    const p = v.payload || {};
    if (p.type === "trim") return p.partName || "Trim part";
    if (p.type === "panel") return p.profile || "Roof panel";
    if (p.type === "metal") return "Flat sheet + coil";
    if (p.type === "part3d") return PART3D_LABELS[p.partType] || "3D part";
    return "Saved item";
  };

  // Mirrors submitOrder's item construction, minus customer/status fields — the payload
  // is order-shaped so computePrice and ShapeThumb both accept it as-is.
  const buildVaultPayloads = () => {
    if (shapeType === "trim") {
      const parts = [...basket];
      if (points.length >= 2) {
        parts.push({
          name: partName.trim() || `Part ${basket.length + 1}`,
          points, hemStart, hemEnd, paintSide, quantity, lengthPerPiece, sheetWidth,
          gaugeId, paintId, brand, colorName, colorHex: colorObj.hex, photo: partPhoto,
        });
      }
      return parts.map((it, idx) => ({
        type: "trim", partName: it.name, points: it.points, lengthPerPiece: it.lengthPerPiece,
        hemStart: it.hemStart, hemEnd: it.hemEnd, paintSide: it.paintSide, quantity: it.quantity,
        sheetWidth: it.sheetWidth, gaugeId: it.gaugeId, paintId: it.paintId, brand: it.brand,
        colorName: it.colorName, colorHex: it.colorHex, photo: it.photo || null,
        accessories: idx === 0 && accessories.length > 0 ? accessories : undefined,
      }));
    }
    const isMetal = shapeType === "metal";
    const isPart3d = shapeType === "part3d";
    return [{
      type: shapeType,
      profile: isMetal || isPart3d ? undefined : profile,
      width: isMetal || isPart3d ? undefined : width,
      height: isMetal || isPart3d ? undefined : height,
      coilWidth: isMetal ? metalCoilWidth : shapeType === "panel" ? coilWidth : undefined,
      flatWidth: isMetal ? flatWidth : undefined,
      flatLength: isMetal ? flatLength : undefined,
      coilLength: isMetal ? metalCoilLength : undefined,
      ribStyle: shapeType === "panel" ? ribStyle : undefined,
      clipRelief: shapeType === "panel" ? clipRelief : undefined,
      runLocation: shapeType === "panel" ? runLocation : undefined,
      jobSiteAddress: shapeType === "panel" && runLocation === "Job Site" ? jobSiteAddress.trim() : undefined,
      jobSiteMiles: shapeType === "panel" && runLocation === "Job Site" ? (+jobSiteMiles || 0) : undefined,
      metalSupplier: shapeType === "panel" ? supplierCo : undefined,
      fabricator: shapeType === "panel" ? fabricatorCo : undefined,
      partType: isPart3d ? partType : undefined,
      partW: isPart3d ? partW : undefined,
      partD: isPart3d ? partD : undefined,
      partH: isPart3d ? partH : undefined,
      partCapH: isPart3d && partType === "chimney" ? partCapH : undefined,
      capStyle: isPart3d && partType === "chimney" ? capStyle : undefined,
      outletShape: isPart3d && partType === "collector" ? outletShape : undefined,
      flangeW: isPart3d && partType === "collector" && outletShape === "box" ? flangeW : undefined,
      flangeD: isPart3d && partType === "collector" && outletShape === "box" ? flangeD : undefined,
      flangeTapered: isPart3d && partType === "collector" && outletShape === "box" ? flangeTapered : undefined,
      flangeLength: isPart3d && partType === "collector" && outletShape === "box" ? flangeLength : undefined,
      outletRoundTapered: isPart3d && partType === "collector" && outletShape === "round" ? outletRoundTapered : undefined,
      outletDiameter: isPart3d && partType === "collector" && outletShape === "round" ? outletDiameter : undefined,
      outletLength: isPart3d && partType === "collector" && outletShape === "round" ? outletLength : undefined,
      topTrim: isPart3d && partType === "collector" ? topTrim : undefined,
      bodyTaper: isPart3d && partType === "collector" ? bodyTaper : undefined,
      taperStart: isPart3d && partType === "collector" && bodyTaper ? taperStart : undefined,
      taperLength: isPart3d && partType === "collector" && bodyTaper ? taperLength : undefined,
      accessories: !isPart3d && accessories.length > 0 ? accessories : undefined,
      quantity, gaugeId, paintId, brand, colorName, colorHex: colorObj.hex,
    }];
  };

  const saveToVault = async (jobNameRaw) => {
    if (!priceListLoaded) { setToast("Still loading current prices — try again in a second."); setTimeout(() => setToast(""), 3000); return; }
    const jobName = (jobNameRaw || "").trim() || "My Job";
    const payloads = buildVaultPayloads();
    if (payloads.length === 0) { setToast("Nothing to save yet — draw a part or set up a panel first."); setTimeout(() => setToast(""), 3000); return; }
    if (shapeType === "panel" && coilOverMax) { setToast(coilUnavailable ? "Coil over 48\" isn't available — 48\" is the widest we can run." : "Coil over 24\" can't be priced online — call the shop for a quote before saving it."); setTimeout(() => setToast(""), 5000); return; }
    setSavingVault(true);
    const rows = payloads.map((p) => ({
      user_id: user.id,
      job_name: jobName,
      kind: p.type,
      payload: p,
      saved_price: computePrice(p, priceList, coilWidthScale),
    }));
    const { data, error } = await supabase.from("vault_items").insert(rows).select();
    setSavingVault(false);
    if (error) { setToast("Couldn't save to your vault — check your connection and try again."); setTimeout(() => setToast(""), 4000); return; }
    setVaultItems((prev) => [...(data || []), ...prev]);
    setVaultSaveOpen(false);
    setVaultJobName("");
    setToast(`Saved ${rows.length === 1 ? "1 item" : `${rows.length} items`} to "${jobName}" in your Job Vault.`);
    setTimeout(() => setToast(""), 4000);
  };

  const deleteVaultItem = async (id) => {
    setVaultItems((prev) => prev.filter((v) => v.id !== id));
    await supabase.from("vault_items").delete().eq("id", id);
  };
  const deleteVaultJob = async (jobName) => {
    const ids = vaultItems.filter((v) => v.job_name === jobName).map((v) => v.id);
    setVaultItems((prev) => prev.filter((v) => v.job_name !== jobName));
    await supabase.from("vault_items").delete().in("id", ids);
  };
  const ackVaultItem = async (item) => {
    const cur = vaultCurrentPrice(item);
    setVaultItems((prev) => prev.map((v) => (v.id === item.id ? { ...v, acked_price: cur } : v)));
    await supabase.from("vault_items").update({ acked_price: cur }).eq("id", item.id);
  };

  // Restore a saved item back into the order flow so the member can adjust and send it.
  // Also powers "Reorder" from Past Orders — order objects are payload-shaped.
  const loadVaultItem = (item, sourceLabel = "your Job Vault") => {
    const p = item.payload || {};
    const kind = p.type || item.kind;
    setTab("order");
    setShapeType(kind);
    setOrderStep("details");
    setMaterialCategory(UNPAINTED_MATERIALS.includes(p.brand) ? "unpainted" : "painted");
    if (p.gaugeId) setGaugeId(p.gaugeId);
    if (p.paintId) setPaintId(p.paintId);
    // brand then color directly — handleBrandChange would reset the color
    if (p.brand) setBrand(p.brand);
    if (p.colorName) setColorName(p.colorName);
    if (p.quantity != null) setQuantity(p.quantity);
    setAccessories(Array.isArray(p.accessories) ? p.accessories : []);
    if (kind === "trim") {
      setPoints(Array.isArray(p.points) ? p.points : []);
      setHemStart(p.hemStart || "none"); setHemEnd(p.hemEnd || "none");
      setPaintSide(p.paintSide || "left");
      setPartName(p.partName || "");
      setPartPhoto(p.photo || null);
      if (p.lengthPerPiece != null) setLengthPerPiece(p.lengthPerPiece);
      if (p.sheetWidth != null) setSheetWidth(p.sheetWidth);
      setViewResetKey((k) => k + 1);
    } else if (kind === "panel") {
      if (p.profile) setProfile(p.profile);
      // width re-derives from coilWidth + profile; submitted orders store only width,
      // so reconstruct coilWidth from it when reordering
      if (p.coilWidth != null) setCoilWidth(p.coilWidth);
      else if (p.width != null) setCoilWidth(p.width + (PROFILE_INFO[p.profile]?.takeup ?? 0));
      if (p.height != null) setHeight(p.height);
      setRibStyle(p.ribStyle ?? null);
      setClipRelief(p.clipRelief ?? null);
      setRunLocation(p.runLocation || "Shop");
      setJobSiteAddress(p.jobSiteAddress || "");
      setJobSiteMiles(p.jobSiteMiles ?? "");
      setSupplierCo(p.metalSupplier || "Fortified Metal");
      setFabricatorCo(p.fabricator || "Fortified Metal");
    } else if (kind === "metal") {
      if (p.flatWidth != null) setFlatWidth(p.flatWidth);
      if (p.flatLength != null) setFlatLength(p.flatLength);
      if (p.coilWidth != null) setMetalCoilWidth(p.coilWidth);
      if (p.coilLength != null) setMetalCoilLength(p.coilLength);
    } else if (kind === "part3d") {
      if (p.partType) setPartType(p.partType);
      if (p.partW != null) setPartW(p.partW);
      if (p.partD != null) setPartD(p.partD);
      if (p.partH != null) setPartH(p.partH);
      if (p.partCapH != null) setPartCapH(p.partCapH);
      if (p.capStyle) setCapStyle(p.capStyle);
      if (p.outletShape) setOutletShape(p.outletShape);
      if (p.flangeW != null) setFlangeW(p.flangeW);
      if (p.flangeD != null) setFlangeD(p.flangeD);
      if (p.flangeTapered != null) setFlangeTapered(p.flangeTapered);
      if (p.flangeLength != null) setFlangeLength(p.flangeLength);
      if (p.outletRoundTapered != null) setOutletRoundTapered(p.outletRoundTapered);
      if (p.outletDiameter != null) setOutletDiameter(p.outletDiameter);
      if (p.outletLength != null) setOutletLength(p.outletLength);
      if (p.topTrim != null) setTopTrim(p.topTrim);
      if (p.bodyTaper != null) setBodyTaper(p.bodyTaper);
      if (p.taperStart != null) setTaperStart(p.taperStart);
      if (p.taperLength != null) setTaperLength(p.taperLength);
    }
    setToast(`Loaded "${vaultItemLabel(item)}" from ${sourceLabel} — adjust anything and send when ready.`);
    setTimeout(() => setToast(""), 4000);
  };

  const updateStatus = async (id, status) => {
    await updateOrderRows(orders.filter((o) => o.id === id).map((o) => ({ ...o, status })));
  };

  const updatePoNumber = async (jobKey, poNumber) => {
    await updateOrderRows(orders.filter((o) => (o.jobId || o.id) === jobKey).map((o) => ({ ...o, poNumber })));
  };

  // Master Materials List pull status — shared so the whole shop sees one board.
  // Keys include the quantity, so if a line's need grows it drops back to Needed.
  const materialLines = () => {
    const m = computeJobMaterials(orders.filter((o) => o.status !== "Completed"));
    return [
      ...m.flatSheets.map((f) => ({ lk: `fs:${f.key}:${f.count}`, pos: f.pos })),
      ...m.coil.map((c) => ({ lk: `coil:${c.key}:${Math.ceil(c.feet)}`, pos: c.pos })),
      ...m.accessories.map((a) => ({ lk: `acc:${a.key}:${a.qty}`, pos: a.pos })),
    ];
  };
  const cycleMatStatus = async (lineKey) => {
    const cur = matStatus[lineKey];
    const nextMap = { ...matStatus };
    const lines = materialLines();
    if (cur === "pulled") {
      // Not actually ready: the tapped card returns to Needed and the rest of its
      // PO(s) drop back to In Stock — Ready for Production empties for that PO.
      const mine = lines.find((l) => l.lk === lineKey);
      const pos = mine ? mine.pos : [];
      lines.forEach((l) => { if (nextMap[l.lk] === "pulled" && l.pos.some((p) => pos.includes(p))) nextMap[l.lk] = "instock"; });
      delete nextMap[lineKey];
    } else if (cur === "instock") {
      delete nextMap[lineKey]; // undo — back to Needed
    } else {
      nextMap[lineKey] = "instock";
    }
    // Ready for Production can ONLY be reached here: the moment every component a
    // PO needs is In Stock, that whole PO's cards move over together.
    for (const po of [...new Set(lines.flatMap((l) => l.pos))]) {
      const poLines = lines.filter((l) => l.pos.includes(po));
      if (poLines.length > 0 && poLines.every((l) => nextMap[l.lk] === "instock" || nextMap[l.lk] === "pulled")) {
        poLines.forEach((l) => { nextMap[l.lk] = "pulled"; });
      }
    }
    setMatStatus(nextMap);
    matSaveChain.current = matSaveChain.current
      .then(() => storage.set("shop-material-status", JSON.stringify(nextMap), true))
      .catch((e) => console.error("storage error", e));
  };

  const visibleOrders = statusFilter === "All" ? orders : orders.filter((o) => o.status === statusFilter);

  return (
    <div style={{ fontFamily: "Inter, sans-serif", background: theme.pageBg, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .disp { font-family: 'Oswald', sans-serif; text-transform: uppercase; letter-spacing: 0.03em; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        input[type=number]::-webkit-inner-spin-button { opacity: 1; }
        select { -webkit-appearance: none; appearance: none; }
        .mac-btn {
          transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.15s ease, filter 0.15s ease;
        }
        .mac-btn:hover {
          transform: scale(1.08) translateY(-1px);
          filter: brightness(1.04);
        }
        .mac-btn:active {
          transform: scale(0.97);
        }
        /* Bouncy press feedback for everyday buttons — a snappier, more playful tap than a flat click. */
        .tap-bounce {
          transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.12s ease;
        }
        .tap-bounce:active {
          transform: scale(0.93);
          filter: brightness(0.97);
        }
        @keyframes popIn {
          0% { transform: scale(0.7); opacity: 0; }
          60% { transform: scale(1.06); opacity: 1; }
          100% { transform: scale(1); }
        }
        .pop-in { animation: popIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes wiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-4deg); }
          75% { transform: rotate(4deg); }
        }
        .wiggle-hover:hover { animation: wiggle 0.3s ease; }
        @keyframes slideUpFade {
          0% { transform: translateY(14px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .slide-up-in { animation: slideUpFade 0.28s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes celebrateSpin {
          0% { transform: scale(0) rotate(-15deg); opacity: 0; }
          50% { transform: scale(1.2) rotate(8deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); }
        }
        .celebrate { animation: celebrateSpin 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
      `}</style>

      {/* header */}
      <div style={{ background: `linear-gradient(135deg, ${CHARCOAL}, ${INK})`, borderBottom: `1px solid rgba(212,175,55,0.25)`, padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="disp" style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>Panel &amp; Trim Calculator</div>
          <div className="mono" style={{ color: theme.textSecondary, fontSize: 11, marginTop: 2 }}>Shop Order Portal</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ textAlign: "right", marginRight: 4, maxWidth: 150, overflow: "hidden" }}>
            <div style={{ color: "#fff", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{customer?.name || user?.email}</div>
            <div style={{ color: theme.textSecondary, fontSize: 9.5 }}>
              {isStaff ? "Staff" : `Tier: ${customer?.tier === "tier1" ? "Tier 1" : customer?.tier === "greenleaf" ? "Greenleaf" : "Tier 2"}`}
            </div>
          </div>
          <button onClick={signOut}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            Sign Out
          </button>
          <button onClick={() => setDarkMode((d) => !d)}
            style={{ width: 30, height: 30, borderRadius: 15, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}>
            {darkMode ? "☀" : "☾"}
          </button>
          <Ruler color={SAFETY} size={22} />
        </div>
      </div>

      {/* tabs */}
      <div style={{ display: "flex", background: CHARCOAL, paddingBottom: 0 }}>
        {[{ id: "order", label: "New Order", icon: PenTool }, { id: "vault", label: "Job Vault", icon: Briefcase }, ...(isStaff ? [{ id: "dashboard", label: "Shop Floor", icon: ClipboardList }] : []), { id: "past", label: "Past Orders", icon: Clock }, { id: "pricelist", label: "Price List", icon: DollarSign }].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="disp tap-bounce"
              style={{
                flex: 1, padding: "12px 8px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                background: active ? theme.pageBg : "transparent", color: active ? SAFETY : "#9AA5AD",
                border: "none", borderTopLeftRadius: active ? 10 : 0, borderTopRightRadius: active ? 10 : 0,
                borderTop: active ? `3px solid ${SAFETY}` : "3px solid transparent",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>
              <Icon size={15} /> {t.label}
              {t.id === "vault" && vaultAlertCount > 0 && (
                <span className="mono" style={{ background: AMBER, color: "#fff", borderRadius: 999, fontSize: 9, padding: "1px 6px", fontWeight: 700 }}>▲{vaultAlertCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {toast && (
        <div className="pop-in" style={{
          background: `linear-gradient(90deg, #FBF3D9, #F5E6C3)`, borderBottom: `3px solid ${SAFETY}`, color: theme.text,
          padding: "11px 20px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 16 }}>✨</span>
          {toast}
        </div>
      )}

      {tab === "order" ? (
        <div style={{ padding: 16, maxWidth: 640, margin: "0 auto" }}>
          {orderStep === "color" && (
            <>
              <button onClick={() => setOrderStep("details")}
                style={{ border: "none", background: "none", color: theme.textSecondary, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 10, display: "flex", alignItems: "center", gap: 4 }}>
                <ChevronDown size={14} style={{ transform: "rotate(90deg)" }} /> Back to Order Details
              </button>
              <div className="disp" style={{ fontSize: 15, color: theme.text, marginBottom: 4 }}>Step 3 of 3 — Pick Your Finish</div>
              <div style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 14 }}>Choose your manufacturer, gauge, and color.</div>
              {/* quick links into the panel calculator / trim drawing tool */}
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  { id: "panel", label: "Panel Calculator", icon: Square, accent: SAFETY },
                  { id: "trim", label: "Trim Drawing Tool", icon: PenTool, accent: "#4F9A63" },
                ].map((q) => {
                  const Icon = q.icon;
                  return (
                    <button key={q.id} onClick={() => { setShapeType(q.id); setOrderStep("details"); }} className="tap-bounce"
                      style={{
                        flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 8px",
                        borderRadius: 8, border: `1px solid ${q.accent}`, background: theme.card, color: q.accent,
                        fontSize: 12, fontWeight: 700, cursor: "pointer",
                      }}>
                      <Icon size={14} /> {q.label}
                    </button>
                  );
                })}
              </div>
          {/* color picker */}
          <div style={{ background: theme.card, borderRadius: 10, padding: 12, marginTop: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <div className="disp" style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 8 }}>Finish Color</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {[{ id: "painted", label: "Painted" }, { id: "unpainted", label: "Unpainted" }].map((c) => (
                <button key={c.id} onClick={() => {
                  setMaterialCategory(c.id);
                  handleBrandChange(c.id === "unpainted" ? UNPAINTED_MATERIALS[0] : BRANDS[0]);
                }}
                  style={{
                    flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    border: `1px solid ${materialCategory === c.id ? INK : theme.border}`, background: materialCategory === c.id ? INK : theme.inputBg, color: materialCategory === c.id ? "#fff" : theme.text,
                  }}>
                  {c.label}
                </button>
              ))}
            </div>

            {materialCategory === "unpainted" ? (
              <>
                <div style={{ fontSize: 10, color: theme.textSecondary, marginBottom: 8 }}>
                  Bare/mill-finish materials — no paint, no color chart, just a few SKUs.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
                  {UNPAINTED_MATERIALS.map((mName) => {
                    const swatch = COLORS_BY_BRAND[mName]?.[0]?.hex || "#999";
                    const active = brand === mName;
                    return (
                      <button key={mName} onClick={() => handleBrandChange(mName)}
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4, padding: 5,
                          border: `2px solid ${active ? INK : "transparent"}`, borderRadius: 8, background: active ? "#F0EDE3" : "transparent", cursor: "pointer",
                        }}>
                        <span style={{ width: "100%", height: 46, borderRadius: 5, background: swatch, border: "1px solid rgba(0,0,0,0.15)", position: "relative", display: "block" }}>
                          {active && <Check size={16} color="#fff" style={{ position: "absolute", top: 5, right: 5, filter: "drop-shadow(0 0 1.5px #000)" }} />}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 600, textAlign: "center", lineHeight: 1.2, color: theme.text }}>{mName}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    {brand === "Copper" ? "Copper Weight" : "Gauge"}
                    <select value={gaugeId} onChange={(e) => setGaugeId(e.target.value)}
                      style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, background: theme.inputBg }}>
                      {(brand === "Copper" ? COPPER_WEIGHT_OPTIONS
                        : brand === "G90 Galvanized" ? G90_GAUGE_OPTIONS
                        : brand === "Galvalume" ? GALVALUME_GAUGE_OPTIONS
                        : BONDERIZED_GAUGE_OPTIONS).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                    </select>
                  </label>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, border: `1px solid ${theme.border}`, borderRadius: 7 }}>
                  <span style={{ width: 40, height: 40, borderRadius: 6, background: colorObj?.hex || "#ccc", border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: theme.text }}>{colorName}</span>
                </div>
                {UNPAINTED_FLATS_ONLY_BRANDS.includes(brand) && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "8px 10px",
                    background: darkMode ? "#332A0C" : "#FBF3D9", border: `1px solid ${SAFETY}`, borderRadius: 6,
                  }}>
                    <StickyNote size={16} color={SAFETY} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: theme.text, fontWeight: 600 }}>
                      {brand} is only available as 4' × 10' flat sheet stock — go to Order Metal → Flat Sheet to order it.
                    </span>
                  </div>
                )}
                {brand === "Bonderized" && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "8px 10px",
                    background: darkMode ? "#332A0C" : "#FBF3D9", border: `1px solid ${SAFETY}`, borderRadius: 6,
                  }}>
                    <StickyNote size={16} color={SAFETY} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: theme.text, fontWeight: 600 }}>
                      Non-warranted finish — Bonderized is unpainted, so no paint warranty applies. It also typically runs Grade 33–45, softer than standard Grade 50, and is not recommended for roofing material.
                    </span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Brand
                    <select value={brand} onChange={(e) => handleBrandChange(e.target.value)}
                      style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, background: theme.inputBg }}>
                      {BRANDS.map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Gauge
                    <select value={gaugeId} onChange={(e) => setGaugeId(e.target.value)} disabled={PVDF_24GA_ONLY_BRANDS.includes(brand)}
                      style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, background: PVDF_24GA_ONLY_BRANDS.includes(brand) ? theme.pageBg : theme.inputBg, opacity: PVDF_24GA_ONLY_BRANDS.includes(brand) ? 0.7 : 1 }}>
                      {(PVDF_24GA_ONLY_BRANDS.includes(brand) ? GAUGE_OPTIONS.filter((g) => g.id === "24ga") : GAUGE_OPTIONS).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                    </select>
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Paint Type
                    <select value={paintId} onChange={(e) => handlePaintChange(e.target.value)} disabled={PVDF_24GA_ONLY_BRANDS.includes(brand) || PVDF_ONLY_BRANDS.includes(brand)}
                      style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, background: (PVDF_24GA_ONLY_BRANDS.includes(brand) || PVDF_ONLY_BRANDS.includes(brand)) ? theme.pageBg : theme.inputBg, opacity: (PVDF_24GA_ONLY_BRANDS.includes(brand) || PVDF_ONLY_BRANDS.includes(brand)) ? 0.7 : 1 }}>
                      {(PVDF_24GA_ONLY_BRANDS.includes(brand) || PVDF_ONLY_BRANDS.includes(brand) ? PAINT_OPTIONS.filter((p) => p.id === "pvdf") : PAINT_OPTIONS).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </label>
                </div>
                {PVDF_ONLY_BRANDS.includes(brand) && (
                  <div style={{ fontSize: 9.5, color: theme.textSecondary, marginTop: -4, marginBottom: 8 }}>
                    {brand} is Kynar 500/Hylar 5000 (PVDF) only — no SMP.
                  </div>
                )}
                {PVDF_24GA_ONLY_BRANDS.includes(brand) && (
                  <div style={{ fontSize: 9.5, color: theme.textSecondary, marginTop: -4, marginBottom: 8 }}>
                    {brand} is Kynar 500/Hylar 5000 (PVDF), 24 gauge only.
                  </div>
                )}
                <input
                  value={colorSearch}
                  onChange={(e) => setColorSearch(e.target.value)}
                  placeholder="Search colors…"
                  style={{ width: "100%", padding: 8, marginBottom: 8, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }}
                />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, maxHeight: 340, overflowY: "auto", paddingRight: 2 }}>
                  {getColorsForBrand(brand, paintId).filter((c) => c.name.toLowerCase().includes(colorSearch.toLowerCase())).map((c) => {
                    const active = colorName === c.name;
                    return (
                      <button key={c.name} onClick={() => setColorName(c.name)}
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4, padding: 5,
                          border: `2px solid ${active ? INK : "transparent"}`, borderRadius: 8, background: active ? "#F0EDE3" : "transparent", cursor: "pointer",
                        }}>
                        <span style={{ width: "100%", height: 46, borderRadius: 5, background: c.hex, border: "1px solid rgba(0,0,0,0.15)", position: "relative", display: "block" }}>
                          {active && <Check size={16} color="#fff" style={{ position: "absolute", top: 5, right: 5, filter: "drop-shadow(0 0 1.5px #000)" }} />}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 600, textAlign: "center", lineHeight: 1.2, color: theme.text }}>{c.name}{c.premium && " *"}</span>
                      </button>
                    );
                  })}
                </div>
                {colorObj?.premium && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "8px 10px",
                    background: darkMode ? "#332A0C" : "#FBF3D9", border: `1px solid ${SAFETY}`, borderRadius: 6,
                  }}>
                    <StickyNote size={16} color={SAFETY} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: theme.text, fontWeight: 600 }}>
                      "{colorObj.name}" is a non-standard finish (Deep Tone, Metallic, Woodgrain, or Specialty) — this is not standard pricing. A +12% surcharge applies.
                    </span>
                  </div>
                )}
                <div style={{ fontSize: 10, color: theme.textSecondary, marginTop: 8 }}>* Premium/metallic finish, +12%. Screen colors are approximate — confirm with a physical chip before ordering.</div>
                <button onClick={() => setShowColorMatch((s) => !s)}
                  style={{
                    width: "100%", marginTop: 10, padding: "9px", borderRadius: 8, cursor: "pointer",
                    border: `1px solid ${theme.border}`, background: theme.inputBg, color: theme.text, fontSize: 12, fontWeight: 600,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}>
                  {showColorMatch ? "Hide" : "Can't find this color? Search other brands"}
                </button>
                {showColorMatch && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 10.5, color: theme.textSecondary, marginBottom: 8 }}>
                      Closest matches to <strong style={{ color: theme.text }}>"{colorName}"</strong> from other manufacturers:
                    </div>
                    {findSimilarColorsAcrossBrands(colorObj?.hex || "#888888", brand, 8).map((m, i) => (
                      <button key={`${m.brand}-${m.name}`}
                        onClick={() => { handleBrandChange(m.brand); if (m.paintId) setPaintId(m.paintId); setColorName(m.name); setShowColorMatch(false); }}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 10, padding: 8, marginBottom: 4,
                          border: `1px solid ${i === 0 ? SAFETY : theme.border}`, borderRadius: 7, background: theme.card, cursor: "pointer", textAlign: "left",
                        }}>
                        <span className="mono" style={{
                          width: 20, height: 20, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 9.5, fontWeight: 700, background: i === 0 ? SAFETY : theme.inputBg, color: i === 0 ? "#fff" : theme.textSecondary,
                        }}>
                          {i + 1}
                        </span>
                        <span style={{ width: 34, height: 34, borderRadius: 6, background: m.hex, border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: theme.text }}>
                            {m.name}{m.premium && " *"}
                            {i === 0 && <span style={{ color: SAFETY, fontWeight: 700, fontSize: 9.5 }}> · Closest Match</span>}
                          </div>
                          <div style={{ fontSize: 10, color: theme.textSecondary }}>{m.brand}</div>
                        </div>
                        <span style={{ fontSize: 9.5, color: theme.textSecondary, textAlign: "right", maxWidth: 90, lineHeight: 1.25 }}>
                          {describeColorShift(colorObj?.hex || "#888888", m.hex)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
              <button onClick={() => setOrderStep("details")}
                style={{ width: "100%", marginTop: 14, padding: "13px", borderRadius: 10, border: "none", background: SAFETY, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Done — Back to Order Details
              </button>
            </>
          )}

          {orderStep === "type" && (
            <>
              <div className="disp" style={{ fontSize: 15, color: theme.text, marginBottom: 4 }}>Step 1 of 3 — What Do You Need?</div>
              <div style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 16 }}>We'll ask for your finish and color next.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { id: "panel", label: "Roof Panel", desc: "Formed standing-seam or snap-lock panels", icon: Square, accent: SAFETY },
                  { id: "trim", label: "Trim Profile", desc: "Custom-drawn flashing and trim pieces", icon: PenTool, accent: "#4F9A63" },
                  { id: "metal", label: "Unfabricated Metal", desc: "Raw coil or 4x10 flat sheet stock", icon: Layers, accent: "#3E7CB1" },
                  { id: "part3d", label: "3D Parts", desc: "Collector boxes, scuppers, chimney caps", icon: Box, accent: "#8A5FBF" },
                ].map((t) => {
                  const Icon = t.icon;
                  return (
                    <button key={t.id} onClick={() => { if (t.id === "part3d") setAccessories([]); setShapeType(t.id); setOrderStep("details"); }} className="mac-btn"
                      style={{
                        display: "flex", alignItems: "center", gap: 14, padding: 16, borderRadius: 12, border: `1px solid ${t.accent}`,
                        background: `linear-gradient(180deg, ${t.accent}, ${t.accent}dd)`, color: "#fff", cursor: "pointer", textAlign: "left",
                        boxShadow: `0 3px 8px ${t.accent}44, inset 0 1px 0 rgba(255,255,255,0.3)`,
                      }}>
                      <Icon size={26} style={{ flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{t.label}</div>
                        <div style={{ fontSize: 11, opacity: 0.9, marginTop: 2 }}>{t.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => setShowCoilCalc(true)}
                className="tap-bounce"
                style={{
                  width: "100%", marginTop: 14, padding: "12px", borderRadius: 10, cursor: "pointer",
                  border: `1px solid ${theme.border}`, background: theme.card, color: theme.text, fontSize: 13, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}>
                ⚖️ Coil Weight Calculator
              </button>
            </>
          )}

          {showCoilCalc && (() => {
            const density = MATERIAL_DENSITIES[coilCalcMaterial].density;
            const od = +coilCalcOD || 0, id = +coilCalcID || 0, width = +coilCalcWidth || 0;
            const validGeometry = od > id && id >= 0 && width > 0;
            // Standard coil weight formula: cross-sectional area of the annulus (OD² − ID²) × π/4,
            // times width, times material density. This is basic geometry + material physics —
            // the same math any coil weight calculator uses, not proprietary to any one app.
            const weightLbs = validGeometry ? (Math.PI / 4) * (od * od - id * id) * width * density : 0;
            // Approximate coil length, derived from weight ÷ (width × material thickness × density).
            const thickness = +coilCalcGaugeThickness || 0;
            const lengthFt = validGeometry && thickness > 0 ? weightLbs / (width * thickness * density * 12) : 0;
            return (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
                onClick={() => setShowCoilCalc(false)}>
                <div onClick={(e) => e.stopPropagation()}
                  style={{ background: theme.card, borderRadius: 12, padding: 20, maxWidth: 420, width: "100%", boxShadow: "0 8px 30px rgba(0,0,0,0.3)", maxHeight: "90vh", overflowY: "auto" }}>
                  <div className="disp" style={{ fontSize: 16, color: theme.text, marginBottom: 4 }}>⚖️ Coil Weight Calculator</div>
                  <div style={{ fontSize: 11.5, color: theme.textSecondary, marginBottom: 14 }}>
                    Figure a coil's weight from its measurements — no scale needed.
                  </div>

                  <label style={{ display: "block", fontSize: 11, color: theme.textSecondary, marginBottom: 10 }}>
                    Material
                    <select value={coilCalcMaterial} onChange={(e) => setCoilCalcMaterial(e.target.value)}
                      style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, background: theme.inputBg, color: theme.text }}>
                      {Object.entries(MATERIAL_DENSITIES).map(([id2, m]) => <option key={id2} value={id2}>{m.label}</option>)}
                    </select>
                  </label>

                  <label style={{ display: "block", fontSize: 11, color: theme.textSecondary, marginBottom: 10 }}>
                    Gauge / Thickness (in) — used for the length estimate below
                    <select value={coilCalcGaugeThickness} onChange={(e) => setCoilCalcGaugeThickness(+e.target.value)}
                      style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, background: theme.inputBg, color: theme.text }}>
                      <option value={0.0299}>22 Gauge (0.0299")</option>
                      <option value={0.0239}>24 Gauge (0.0239")</option>
                      <option value={0.0179}>26 Gauge (0.0179")</option>
                      <option value={0.0149}>28 Gauge (0.0149")</option>
                    </select>
                  </label>

                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                      Outer Diameter (in)
                      <input type="number" min={0} step="0.25" value={coilCalcOD} onChange={(e) => setCoilCalcOD(e.target.value)}
                        style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", background: theme.inputBg, color: theme.text }} />
                    </label>
                    <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                      Core / Inner Dia. (in)
                      <input type="number" min={0} step="0.25" value={coilCalcID} onChange={(e) => setCoilCalcID(e.target.value)}
                        style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", background: theme.inputBg, color: theme.text }} />
                    </label>
                  </div>
                  <label style={{ display: "block", fontSize: 11, color: theme.textSecondary, marginBottom: 14 }}>
                    Coil Width (in)
                    <input type="number" min={0} step="0.25" value={coilCalcWidth} onChange={(e) => setCoilCalcWidth(e.target.value)}
                      style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", background: theme.inputBg, color: theme.text }} />
                  </label>

                  {!validGeometry ? (
                    <div style={{ fontSize: 11.5, color: theme.textSecondary, padding: 10, textAlign: "center" }}>
                      Outer Diameter needs to be larger than Core Diameter, and Width above zero.
                    </div>
                  ) : (
                    <div style={{ background: theme.inputBg, borderRadius: 8, padding: 12, marginBottom: 4 }}>
                      <div style={{ fontSize: 11, color: theme.textSecondary }}>Estimated Weight</div>
                      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: theme.text }}>{weightLbs.toFixed(0)} lbs</div>
                      <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 6 }}>≈ {(weightLbs / 100).toFixed(2)} CWT</div>
                      {lengthFt > 0 && (
                        <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 2 }}>≈ {Math.round(lengthFt)} ft of material on the coil</div>
                      )}
                    </div>
                  )}

                  <div className="disp" style={{ fontSize: 11.5, color: SAFETY, marginTop: 16, marginBottom: 6 }}>
                    Weight per Sq Ft — {MATERIAL_DENSITIES[coilCalcMaterial].label}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 10.5, marginBottom: 4, color: theme.textSecondary, fontWeight: 700 }}>
                    <div>Gauge</div><div>Bare</div><div>Painted</div>
                  </div>
                  {[
                    { label: "22 Ga", thickness: 0.0299 },
                    { label: "24 Ga", thickness: 0.0239 },
                    { label: "26 Ga", thickness: 0.0179 },
                    { label: "28 Ga", thickness: 0.0149 },
                  ].map((g) => {
                    const bare = g.thickness * density * 144;
                    const paintFilmAdd = 0.01; // approximate weight of a PVDF/SMP coating system — thin enough that this is a small, rough estimate, not a precise figure
                    const painted = bare + paintFilmAdd;
                    return (
                      <div key={g.label} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 12, padding: "4px 0", borderTop: `1px solid ${theme.border}`, color: theme.text }}>
                        <div className="mono">{g.label}</div>
                        <div className="mono">{bare.toFixed(3)}</div>
                        <div className="mono">{painted.toFixed(3)}</div>
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 9, color: theme.textSecondary, marginTop: 6 }}>
                    lbs/sq ft. Painted figures add an approximate coating film weight — the difference is small enough that it's a rough estimate, not a precise spec value.
                  </div>

                  <div style={{ fontSize: 9.5, color: theme.textSecondary, marginTop: 10 }}>
                    Standard coil geometry formula — a real scale reading is always more accurate than an estimate from measurements.
                  </div>

                  <button onClick={() => setShowCoilCalc(false)}
                    style={{ width: "100%", marginTop: 14, padding: "11px", borderRadius: 8, border: "none", background: SAFETY, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    Close
                  </button>
                </div>
              </div>
            );
          })()}

          {orderStep === "details" && (
            <>
              <div className="disp" style={{ fontSize: 15, color: theme.text, marginBottom: 10 }}>Step 2 of 3 — Order Details</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <button onClick={() => setOrderStep("type")} className="tap-bounce"
                  style={{ border: `1.5px solid ${theme.border}`, background: theme.card, color: theme.text, fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "7px 14px 7px 10px", borderRadius: 8, display: "flex", alignItems: "center", gap: 4 }}>
                  <ChevronDown size={16} style={{ transform: "rotate(90deg)" }} /> Change Type
                </button>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 3, alignSelf: "flex-end" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                    <span className="disp" style={{ fontSize: 9.5, color: theme.textSecondary, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>Selected Color</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: theme.text, lineHeight: 1.3, textAlign: "right" }}>
                      {brand} — {colorName}{" "}
                      <button onClick={() => setOrderStep("color")}
                        style={{ border: "none", background: "none", color: SAFETY, fontSize: 10.5, fontWeight: 700, cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                        Edit
                      </button>
                    </span>
                  </div>
                  <span style={{ width: "100%", minWidth: 220, height: 46, borderRadius: 5, background: colorObj?.hex || "#ccc", border: "1px solid rgba(0,0,0,0.15)" }} />
                </div>
              </div>
          {/* drawing area */}
          <div style={{ background: theme.card, borderRadius: 10, padding: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            {shapeType === "metal" ? (
              <>
                <div className="disp" style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 4 }}>Flat Sheet</div>
                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                  <label style={{ width: 70, fontSize: 11, color: theme.textSecondary }}>
                    Qty
                    <input type="number" min={1} value={quantity}
                      onChange={(e) => setQuantity(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setQuantity(1); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Width (in)
                    <input type="number" min={0.1} step="0.1" value={flatWidth}
                      onChange={(e) => setFlatWidth(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setFlatWidth(48); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Length (ft)
                    <input type="number" min={0.1} step="0.1" value={flatLength === "" ? "" : +(flatLength / 12).toFixed(2)}
                      onChange={(e) => setFlatLength(e.target.value === "" ? "" : Math.max(0, +e.target.value * 12))}
                      onBlur={(e) => { if (e.target.value === "") setFlatLength(120); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                </div>

                <div className="disp" style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 12 }}>Coil</div>
                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Coil Width (in)
                    <input type="number" min={0.1} step="0.1" value={metalCoilWidth}
                      onChange={(e) => setMetalCoilWidth(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setMetalCoilWidth(21); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Coil Length (ft)
                    <input type="number" min={1} step="1" value={metalCoilLength === "" ? "" : Math.round(metalCoilLength / 12)}
                      onChange={(e) => setMetalCoilLength(e.target.value === "" ? "" : Math.max(0, +e.target.value * 12))}
                      onBlur={(e) => { if (e.target.value === "") setMetalCoilLength(12000); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                </div>

                {(() => {
                  const coilFeet = (+metalCoilLength || 0) / 12;
                  return (
                    <div style={{ marginTop: 10, padding: 10, background: theme.inputBg, borderRadius: 8, border: `1px solid ${theme.border}` }}>
                      <div style={{ fontSize: 11.5, color: theme.text, marginBottom: 4 }}>
                        <strong>Flat Sheet:</strong> {money(flatSheetPrice)} each — {quantity || 0} × = <strong>{money(flatSheetPrice * (+quantity || 0))}</strong>
                      </div>
                      <div style={{ fontSize: 11.5, color: theme.text }}>
                        <strong>Coil:</strong> {money(metalCoilPricePerFt)} per linear ft — {Math.round(coilFeet)} ft = <strong>{money(metalCoilPricePerFt * coilFeet)}</strong>
                      </div>
                    </div>
                  );
                })()}

                <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 10 }}>
                  Raw material — no profile or trim shape. Gauge, paint, and color are set below in Finish Color.
                </div>

              </>
            ) : shapeType === "part3d" ? (
              <>
                <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                  {[
                    { id: "collector", label: "Collector Box" },
                    { id: "scupper", label: "Scupper" },
                    { id: "chimney", label: "Chimney Cap" },
                  ].map((t) => (
                    <button key={t.id} type="button" onClick={() => setPartType(t.id)}
                      style={{
                        padding: "6px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer",
                        border: `1px solid ${partType === t.id ? INK : theme.border}`, background: partType === t.id ? INK : theme.inputBg, color: partType === t.id ? "#fff" : theme.text,
                      }}>
                      {t.label}
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Width (in){partType === "collector" && <span style={{ color: theme.textSecondary, fontWeight: 400 }}> (max 150)</span>}
                    <input type="number" min={0.1} max={partType === "collector" ? 150 : undefined} step="0.1" value={partW}
                      onChange={(e) => setPartW(e.target.value === "" ? "" : Math.max(0, partType === "collector" ? Math.min(150, +e.target.value) : +e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setPartW(12); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Depth (in){partType === "collector" && <span style={{ color: theme.textSecondary, fontWeight: 400 }}> (max 150)</span>}
                    <input type="number" min={0.1} max={partType === "collector" ? 150 : undefined} step="0.1" value={partD}
                      onChange={(e) => setPartD(e.target.value === "" ? "" : Math.max(0, partType === "collector" ? Math.min(150, +e.target.value) : +e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setPartD(8); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Height (in){partType === "collector" && <span style={{ color: theme.textSecondary, fontWeight: 400 }}> (max 150)</span>}
                    <input type="number" min={0.1} max={partType === "collector" ? 150 : undefined} step="0.1" value={partH}
                      onChange={(e) => setPartH(e.target.value === "" ? "" : Math.max(0, partType === "collector" ? Math.min(150, +e.target.value) : +e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setPartH(10); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                  </label>
                </div>

                {partType === "chimney" && (
                  <>
                    <div style={{ fontSize: 11, color: theme.textSecondary, marginTop: 8 }}>
                      Cap Style
                      <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" }}>
                        {[
                          { id: "pyramid", label: "Pyramid" },
                          { id: "stevenson", label: "Stevenson Top" },
                          { id: "texas", label: "Texas Top" },
                          { id: "chateau", label: "Chateau Cap" },
                        ].map((s) => (
                          <button key={s.id} type="button" onClick={() => setCapStyle(s.id)}
                            style={{
                              flex: "1 1 45%", padding: "7px 4px", borderRadius: 6, fontSize: 10.5, fontWeight: 600, cursor: "pointer",
                              border: `1px solid ${capStyle === s.id ? INK : theme.border}`, background: capStyle === s.id ? INK : theme.inputBg, color: capStyle === s.id ? "#fff" : theme.text,
                            }}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label style={{ display: "block", width: "100%", fontSize: 11, color: theme.textSecondary, marginTop: 8 }}>
                      Cap Height (in)
                      <input type="number" min={0.1} step="0.1" value={partCapH}
                        onChange={(e) => setPartCapH(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                        onBlur={(e) => { if (e.target.value === "") setPartCapH(6); }}
                        className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                    </label>
                  </>
                )}

                {partType === "collector" && (
                  <>
                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <div style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                        Outlet Shape
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          {[{ id: "box", label: "Box" }, { id: "round", label: "Round" }].map((o) => (
                            <button key={o.id} type="button" onClick={() => setOutletShape(o.id)}
                              style={{
                                flex: 1, padding: "7px 4px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                                border: `1px solid ${outletShape === o.id ? INK : theme.border}`, background: outletShape === o.id ? INK : theme.inputBg, color: outletShape === o.id ? "#fff" : theme.text,
                              }}>
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {outletShape === "box" && (
                        <div style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                          Flange Tapered
                          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                            {[{ v: true, label: "On" }, { v: false, label: "Off" }].map((o) => (
                              <button key={String(o.v)} type="button" onClick={() => setFlangeTapered(o.v)}
                                style={{
                                  flex: 1, padding: "7px 4px", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                                  border: `1px solid ${flangeTapered === o.v ? SAFETY : theme.border}`, background: flangeTapered === o.v ? SAFETY : theme.inputBg, color: flangeTapered === o.v ? "#fff" : theme.text,
                                }}>
                                {o.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {outletShape === "round" && (
                        <div style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                          Round Tapered
                          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                            {[{ v: true, label: "On" }, { v: false, label: "Off" }].map((o) => (
                              <button key={String(o.v)} type="button" onClick={() => setOutletRoundTapered(o.v)}
                                style={{
                                  flex: 1, padding: "7px 4px", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                                  border: `1px solid ${outletRoundTapered === o.v ? SAFETY : theme.border}`, background: outletRoundTapered === o.v ? SAFETY : theme.inputBg, color: outletRoundTapered === o.v ? "#fff" : theme.text,
                                }}>
                                {o.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {outletShape === "box" && (
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                          Flange Width (in)
                          <input type="number" min={0.5} step="0.1" value={flangeW}
                            onChange={(e) => setFlangeW(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                            onBlur={(e) => { if (e.target.value === "") setFlangeW(4); }}
                            className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                        </label>
                        <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                          Flange Depth (in)
                          <input type="number" min={0.5} step="0.1" value={flangeD}
                            onChange={(e) => setFlangeD(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                            onBlur={(e) => { if (e.target.value === "") setFlangeD(4); }}
                            className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                        </label>
                        <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                          Flange Length (in)
                          <input type="number" min={0.5} step="0.1" value={flangeLength}
                            onChange={(e) => setFlangeLength(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                            onBlur={(e) => { if (e.target.value === "") setFlangeLength(4); }}
                            className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                        </label>
                      </div>
                    )}
                    {outletShape === "round" && (
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                          Diameter (in)
                          <select value={outletDiameter} onChange={(e) => setOutletDiameter(+e.target.value)}
                            style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, background: theme.inputBg, color: theme.text }}>
                            {[2, 3, 4, 5, 6].map((v) => <option key={v} value={v}>{v}"</option>)}
                          </select>
                        </label>
                        <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                          Length (in)
                          <select value={outletLength} onChange={(e) => setOutletLength(+e.target.value)}
                            style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, background: theme.inputBg, color: theme.text }}>
                            {[4, 6, 8, 10, 12].map((v) => <option key={v} value={v}>{v}"</option>)}
                          </select>
                        </label>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <div style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                        Tapered Sides
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          {[{ v: false, label: "Off" }, { v: true, label: "On" }].map((o) => (
                            <button key={String(o.v)} type="button"
                              onClick={() => { setBodyTaper(o.v); if (o.v) setTaperLength(Math.max(0.5, (+partH || 10) / 2)); }}
                              style={{
                                flex: 1, padding: "7px 0", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                                border: `1px solid ${bodyTaper === o.v ? SAFETY : theme.border}`, background: bodyTaper === o.v ? SAFETY : theme.inputBg, color: bodyTaper === o.v ? "#fff" : theme.text,
                              }}>
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                        Top Trim Cap (1" off, 1" tall)
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          {[{ v: false, label: "Off" }, { v: true, label: "On" }].map((o) => (
                            <button key={String(o.v)} type="button" onClick={() => setTopTrim(o.v)}
                              style={{
                                flex: 1, padding: "7px 0", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                                border: `1px solid ${topTrim === o.v ? SAFETY : theme.border}`, background: topTrim === o.v ? SAFETY : theme.inputBg, color: topTrim === o.v ? "#fff" : theme.text,
                              }}>
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {bodyTaper && (
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                          Taper Start (in from top)
                          <input type="number" min={0} step="0.1" value={taperStart}
                            onChange={(e) => setTaperStart(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                            onBlur={(e) => { if (e.target.value === "") setTaperStart(0); }}
                            className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                        </label>
                        <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                          Taper In (in)
                          <input type="number" min={0.5} step="0.1" value={taperLength}
                            onChange={(e) => setTaperLength(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                            onBlur={(e) => { if (e.target.value === "") setTaperLength(6); }}
                            className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                        </label>
                      </div>
                    )}
                  </>
                )}

                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  {[{ id: "3d", label: "3D Preview" }, { id: "flat", label: "Flat Pattern" }].map((v) => (
                    <button key={v.id} type="button" onClick={() => setPartView(v.id)}
                      style={{
                        flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                        border: `1px solid ${partView === v.id ? SAFETY : theme.border}`, background: partView === v.id ? SAFETY : theme.inputBg, color: partView === v.id ? "#fff" : theme.text,
                      }}>
                      {v.label}
                    </button>
                  ))}
                </div>

                <div style={{ marginTop: 8 }}>
                  {partView === "3d" ? (
                    <Part3DPreview partType={partType} w={partW} d={partD} h={partH} capH={partCapH} colorHex={colorObj.hex} outletShape={outletShape} flangeW={flangeW} flangeD={flangeD} outletDiameter={outletDiameter} outletLength={outletLength} topTrim={topTrim} bodyTaper={bodyTaper} taperStart={taperStart} taperLength={taperLength} flangeTapered={flangeTapered} flangeLength={flangeLength} outletRoundTapered={outletRoundTapered} capStyle={capStyle} />
                  ) : (
                    <FlatPatternSVG partType={partType} w={partW} d={partD} h={partH} capH={partCapH} colorHex={colorObj.hex} outletShape={outletShape} flangeW={flangeW} flangeD={flangeD} outletDiameter={outletDiameter} outletLength={outletLength} topTrim={topTrim} bodyTaper={bodyTaper} taperStart={taperStart} taperLength={taperLength} flangeTapered={flangeTapered} />
                  )}
                </div>

                <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 10 }}>
                  Schematic 3D preview and nominal flat pattern — not bend-allowance corrected. Gauge, paint, and color are set below in Finish Color.
                </div>
              </>
            ) : shapeType === "panel" ? (
              <>
                <label style={{ display: "block", fontSize: 11, color: theme.textSecondary, marginTop: 4 }}>
                  Fabricated By
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {FAB_COMPANIES.map((c) => (
                      <button key={c.name} type="button" onClick={() => setFabricatorCo(c.name)}
                        style={{
                          flex: 1, padding: "7px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                          border: `1px solid ${fabricatorCo === c.name ? INK : "#D9D5C7"}`,
                          background: fabricatorCo === c.name ? INK : "#fff", color: fabricatorCo === c.name ? "#fff" : INK_DEEP, fontWeight: 600,
                        }}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                </label>
                {(supplierCo !== "Fortified Metal" || fabricatorCo !== "Fortified Metal") && (
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: AMBER, marginTop: 6 }}>
                    Estimate shown at Fortified rates — final pricing confirmed by the companies you picked.
                  </div>
                )}
                <div style={{ fontSize: 11, color: theme.textSecondary, marginTop: 10 }}>Panel profile</div>
                <button onClick={() => setShowPanelCatalog(true)} className="tap-bounce"
                  style={{
                    width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: `1px solid ${theme.border}`,
                    background: theme.inputBg, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                  }}>
                  <span style={{ width: 88, flexShrink: 0, display: "block" }} dangerouslySetInnerHTML={{ __html: generatePanelIsoSvg(profile, ribStyle, "pk") }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: theme.text }}>{profile}</span>
                    <span style={{ display: "block", fontSize: 10, color: theme.textSecondary, marginTop: 2 }}>
                      {(PANEL_VENDORS.find((v) => v.profiles.includes(profile))?.name || "Special order")} — tap to browse all panels
                    </span>
                  </span>
                  <ChevronDown size={16} color={theme.textSecondary} style={{ flexShrink: 0 }} />
                </button>

                {showPanelCatalog && (
                  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 14 }}
                    onClick={() => setShowPanelCatalog(false)}>
                    <div onClick={(e) => e.stopPropagation()}
                      style={{ background: theme.pageBg, borderRadius: 12, padding: 16, maxWidth: 560, width: "100%", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 8px 30px rgba(0,0,0,0.3)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div className="disp" style={{ fontSize: 16, color: theme.text }}>Panel Catalog</div>
                        <button onClick={() => setShowPanelCatalog(false)}
                          style={{ border: "none", background: "none", color: theme.textSecondary, fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1 }}>✕</button>
                      </div>
                      <div style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 10 }}>
                        What each vendor offers — tap a panel to use it for this order.
                      </div>
                      {!catalogUserLoc && (
                        <button
                          onClick={() => {
                            if (!navigator.geolocation) { setCatalogLocStatus("denied"); return; }
                            setCatalogLocStatus("asking");
                            navigator.geolocation.getCurrentPosition(
                              (pos) => { setCatalogUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setCatalogLocStatus("idle"); },
                              () => setCatalogLocStatus("denied"),
                              { timeout: 8000 }
                            );
                          }}
                          style={{
                            width: "100%", marginBottom: 12, padding: "9px", borderRadius: 8, cursor: "pointer",
                            border: `1px solid ${theme.border}`, background: theme.card, color: theme.text, fontSize: 11.5, fontWeight: 600,
                          }}>
                          📍 {catalogLocStatus === "asking" ? "Locating…" : catalogLocStatus === "denied" ? "Location unavailable — check browser permissions" : "Show each vendor's distance from me"}
                        </button>
                      )}
                      {PANEL_VENDORS.map((vend) => (
                        <div key={vend.id} style={{ marginBottom: 16 }}>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, borderBottom: `2px solid ${SAFETY}`, paddingBottom: 5, marginBottom: 8 }}>
                            <div style={{ minWidth: 0 }}>
                              <span className="disp" style={{ fontSize: 13, color: theme.text }}>{vend.name}</span>
                              <span style={{ fontSize: 9.5, color: theme.textSecondary, marginLeft: 6 }}>{vend.tagline}</span>
                            </div>
                            <span style={{ fontSize: 10, color: theme.textSecondary, whiteSpace: "nowrap", flexShrink: 0 }}>
                              {vend.city}, {vend.state}
                              {catalogUserLoc && (
                                <span className="mono" style={{ color: SAFETY, fontWeight: 700 }}> · ~{Math.round(distanceMiles(catalogUserLoc, vend))} mi</span>
                              )}
                            </span>
                          </div>
                          {vend.profiles.length === 0 ? (
                            <div style={{ fontSize: 11, color: theme.textSecondary, padding: "6px 0 2px" }}>
                              Lineup coming soon — call the shop for current {vend.name} availability.
                            </div>
                          ) : (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                              {vend.profiles.map((p) => {
                                const active = profile === p;
                                const dash = p.indexOf("–");
                                const pCode = dash > 0 ? p.slice(0, dash).trim() : p;
                                const pSpec = dash > 0 ? p.slice(dash + 1).trim() : (PROFILE_INFO[p]?.desc || "");
                                return (
                                  <button key={p} onClick={() => { setProfile(p); setShowPanelCatalog(false); }} className="tap-bounce"
                                    style={{
                                      padding: 0, borderRadius: 10, overflow: "hidden", cursor: "pointer", textAlign: "center",
                                      border: active ? `2px solid ${SAFETY}` : `1px solid ${theme.border}`, background: theme.card,
                                    }}>
                                    <span style={{ display: "block", background: darkMode ? "#20262B" : "#F7F5EE" }}
                                      dangerouslySetInnerHTML={{ __html: generatePanelIsoSvg(p, "none") }} />
                                    <span style={{ display: "block", padding: "5px 8px 9px" }}>
                                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: theme.text }}>{pCode}</span>
                                      <span style={{ display: "block", fontSize: 9.5, color: theme.textSecondary, marginTop: 1 }}>{pSpec}</span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <div style={{ flex: 2, fontSize: 11, color: theme.textSecondary }}>
                    Ribs
                    <div style={{ display: "flex", gap: 3, marginTop: 4, flexWrap: "nowrap" }}>
                      {[
                        { id: "none", label: "None", grow: 0.8 },
                        { id: "bead", label: "Bead", grow: 0.85 },
                        { id: "pencil", label: "Pencil", grow: 1 },
                        { id: "v", label: "V Rib", grow: 0.9 },
                        { id: "striations", label: "Striations", grow: 1.6 },
                      ].map((r) => (
                        <button key={r.id} onClick={() => setRibStyle(r.id)}
                          style={{
                            flex: `${r.grow} 1 0%`, minWidth: 0, minHeight: 34, boxSizing: "border-box",
                            padding: "8px 2px", borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: "pointer",
                            border: `1px solid ${ribStyle === r.id ? INK : "#D9D5C7"}`,
                            background: ribStyle === r.id ? INK : "#fff", color: ribStyle === r.id ? "#fff" : INK_DEEP,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Clip Relief
                    <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
                      <button onClick={() => setClipRelief(true)}
                        style={{
                          flex: 1, minHeight: 34, boxSizing: "border-box", padding: "8px 2px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                          border: `1px solid ${clipRelief === true ? SAFETY : "#D9D5C7"}`,
                          background: clipRelief === true ? SAFETY : "#fff", color: clipRelief === true ? "#fff" : INK_DEEP,
                        }}>
                        ON
                      </button>
                      <button onClick={() => setClipRelief(false)}
                        style={{
                          flex: 1, minHeight: 34, boxSizing: "border-box", padding: "8px 2px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                          border: `1px solid ${clipRelief === false ? SAFETY : "#D9D5C7"}`,
                          background: clipRelief === false ? SAFETY : "#fff", color: clipRelief === false ? "#fff" : INK_DEEP,
                        }}>
                        OFF
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Length of Panel(s) (ft)
                    <input type="number" min={0.1} step="0.1" value={height === "" ? "" : +(height / 12).toFixed(2)}
                      onChange={(e) => setHeight(e.target.value === "" ? "" : Math.max(0, +e.target.value * 12))}
                      onBlur={(e) => { if (e.target.value === "") setHeight(853.08); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14 }} />
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Finished Sq Ft
                    {coilOverMax ? (
                      <div className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${coilGateColor}`, borderRadius: 6, fontSize: 13, background: theme.highlight, boxSizing: "border-box", color: coilGateColor, fontWeight: 700 }}>{coilGateText}</div>
                    ) : (
                      <input type="number" min={0} step="0.01"
                        value={sqftEditing !== null ? sqftEditing : (isFinite((width * height) / 144) ? (+((width * height) / 144).toFixed(2)) : 0)}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSqftEditing(val);
                          if (val !== "" && +width > 0) {
                            setHeight(Math.max(0, (+val * 144) / width));
                          }
                        }}
                        onBlur={(e) => { setSqftEditing(null); if (e.target.value === "") setHeight(853.08); }}
                        className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                    )}
                  </label>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Coil Width (in)
                    <input type="number" min={1} max={48} value={coilWidth}
                      onChange={(e) => setCoilWidth(e.target.value === "" ? "" : Math.max(0, Math.min(48, +e.target.value)))}
                      onBlur={(e) => { if (e.target.value === "") setCoilWidth(21); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Pan Width (in)
                    {coilOverMax ? (
                      <div className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${coilGateColor}`, borderRadius: 6, fontSize: 13, background: theme.highlight, boxSizing: "border-box", color: coilGateColor, fontWeight: 700 }}>{coilGateText}</div>
                    ) : (
                    <input type="number" min={0} step="0.01"
                      value={widthEditing !== null ? widthEditing : (isFinite(width) ? +Number(width).toFixed(2) : 0)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setWidthEditing(val);
                        if (val !== "") {
                          const newWidth = Math.max(0, +val);
                          const takeup = PROFILE_INFO[profile]?.takeup || 0;
                          setWidth(newWidth);
                          setCoilWidth(Math.max(0, Math.min(48, Math.round((newWidth + takeup) * 100) / 100)));
                        }
                      }}
                      onBlur={(e) => { setWidthEditing(null); if (e.target.value === "") setCoilWidth(21); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                    )}
                  </label>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Coil $/LF
                    {coilOverMax ? (
                      <div className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${coilGateColor}`, borderRadius: 6, fontSize: 13, background: theme.highlight, boxSizing: "border-box", color: coilGateColor, fontWeight: 700 }}>{coilGateText}</div>
                    ) : (
                      <input type="number" min={0} step="0.01" value={coilPricePerFt}
                        onChange={(e) => setCoilPricePerFt(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                        onBlur={(e) => { if (e.target.value === "") setCoilPricePerFt(panelCoilPerFt() ?? 2.5); }}
                        className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                    )}
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Fabrication $/LF
                    <input type="number" min={0} step="0.01" value={fabPricePerFt}
                      onChange={(e) => setFabPricePerFt(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setFabPricePerFt(panelFabPerFt() ?? 0); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Total Price
                    <div className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${coilOverMax ? coilGateColor : theme.border}`, borderRadius: 6, fontSize: coilOverMax ? 13 : 14, background: theme.highlight, boxSizing: "border-box", color: coilOverMax ? coilGateColor : theme.text, fontWeight: coilOverMax ? 700 : 600 }}>
                      {coilOverMax ? coilGateText : money(((+coilPricePerFt || 0) + (+fabPricePerFt || 0)) * ((+height || 0) / 12))}
                    </div>
                  </label>
                </div>
                {coilOverMax && (
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: coilGateColor, marginTop: 6 }}>
                    {coilUnavailable ? 'Coil over 48" isn\'t available — 48" is the widest we can run.' : 'Coil over 24" — call the shop for pricing on wide panels.'}
                  </div>
                )}
                <div style={{ fontSize: 10, color: theme.textSecondary, marginTop: 4 }}>
                  Fabrication minimum: $200 shop-rolled · $600 rolled on site — applied automatically in the order estimate.
                </div>

                <label style={{ display: "block", fontSize: 11, color: theme.textSecondary, marginTop: 10 }}>
                  Run Location
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {["Shop", "Job Site"].map((loc) => (
                      <button key={loc} type="button" onClick={() => setRunLocation(loc)}
                        style={{
                          flex: 1, padding: "7px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                          border: `1px solid ${runLocation === loc ? INK : "#D9D5C7"}`,
                          background: runLocation === loc ? INK : "#fff", color: runLocation === loc ? "#fff" : INK_DEEP, fontWeight: 600,
                        }}>
                        {loc}
                      </button>
                    ))}
                  </div>
                </label>
                {runLocation === "Job Site" && (
                  <>
                    <label style={{ display: "block", fontSize: 11, color: theme.textSecondary, marginTop: 10 }}>
                      Job Site Address
                      <input value={jobSiteAddress} onChange={(e) => setJobSiteAddress(e.target.value)} onBlur={lookupJobSiteMiles}
                        placeholder="Street address, city, state"
                        style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                    </label>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-end" }}>
                      <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                        Miles from Roll Former Shop (one way)
                        <input type="number" min={0} value={jobSiteMiles}
                          onChange={(e) => setJobSiteMiles(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                          className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                      </label>
                      <button type="button" onClick={lookupJobSiteMiles} disabled={milesLookupBusy}
                        style={{ padding: "9px 14px", borderRadius: 6, border: "none", background: INK, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: milesLookupBusy ? 0.7 : 1, whiteSpace: "nowrap" }}>
                        {milesLookupBusy ? "Looking…" : "📍 Look up"}
                      </button>
                    </div>
                    <div style={{ fontSize: 10, color: theme.textSecondary, marginTop: 4 }}>
                      First {MILEAGE_FREE} miles free, then ${MILEAGE_RATE}/mile one way from the nearest {fabricatorCo} shop ({fabBases.map((b) => b.name).join(" or ")})
                      {(+jobSiteMiles || 0) > MILEAGE_FREE ? <b style={{ color: AMBER }}> — mileage charge {money(mileageCharge(jobSiteMiles))}</b> : null}
                      {milesLookupNote ? ` · ${milesLookupNote}` : ""}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                  {Object.keys(TRIM_PRESETS).map((p) => (
                    <button key={p} onClick={() => { setPreset(p); setPoints(TRIM_PRESETS[p].map((pt) => [...pt])); setViewResetKey((k) => k + 1); }}
                      style={{
                        padding: "5px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer",
                        border: `1px solid ${preset === p ? INK : "#D9D5C7"}`, background: preset === p ? INK : "#fff", color: preset === p ? "#fff" : INK_DEEP,
                      }}>
                      {p}
                    </button>
                  ))}
                  {customPresetsLoaded && customPresets.map((cp) => (
                    <span key={cp.id} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                      <button onClick={() => { setPreset(cp.name); setPoints(cp.points.map((pt) => [...pt])); setViewResetKey((k) => k + 1); }}
                        style={{
                          padding: "5px 8px 5px 10px", borderRadius: "999px 0 0 999px", fontSize: 11, cursor: "pointer",
                          border: `1px solid ${SAFETY}`, borderRight: "none", background: preset === cp.name ? SAFETY : "#fff", color: preset === cp.name ? "#fff" : SAFETY,
                        }}>
                        ★ {cp.name}
                      </button>
                      <button onClick={() => deleteCustomPreset(cp.id)} title="Delete this saved preset"
                        style={{
                          padding: "5px 8px", borderRadius: "0 999px 999px 0", fontSize: 11, cursor: "pointer",
                          border: `1px solid ${SAFETY}`, background: "#fff", color: SAFETY,
                        }}>
                        ×
                      </button>
                    </span>
                  ))}
                  <button onClick={saveCurrentAsPreset} title="Save the current drawing as a reusable preset"
                    style={{
                      padding: "5px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer",
                      border: `1px dashed ${theme.textSecondary}`, background: "transparent", color: theme.textSecondary, display: "flex", alignItems: "center", gap: 4,
                    }}>
                    <Plus size={11} /> Save as Preset
                  </button>
                  <label title="Take or upload a photo of a hand-drawn sketch and let AI read it into the drawing tool"
                    style={{
                      padding: "5px 10px", borderRadius: 999, fontSize: 11, cursor: scanningSketch ? "default" : "pointer",
                      border: `1px solid ${SAFETY}`, background: scanningSketch ? theme.inputBg : "#fff", color: SAFETY, display: "flex", alignItems: "center", gap: 4, opacity: scanningSketch ? 0.7 : 1,
                    }}>
                    📷 {scanningSketch ? "Reading sketch…" : "Scan a Sketch"}
                    <input type="file" accept="image/*" capture="environment" disabled={scanningSketch} style={{ display: "none" }}
                      onChange={(e) => { scanSketchToPoints(e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                </div>
                <div style={{ fontSize: 9.5, color: theme.textSecondary, marginTop: -4, marginBottom: 6 }}>
                  AI reads a best-effort shape from the photo — always check and adjust points/lengths before using it.
                </div>
                <TrimCanvas points={points} setPoints={setPoints} colorHex={colorObj.hex} hemStart={hemStart} hemEnd={hemEnd} paintSide={paintSide} viewResetKey={viewResetKey} />
                <div style={{ display: "flex", alignItems: "center", marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => setPoints((p) => p.slice(0, -1))}
                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: "5px 9px", borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.inputBg, cursor: "pointer" }}>
                    <Undo2 size={12} /> Undo
                  </button>
                  <span className="mono" style={{ fontSize: 11, color: theme.text, fontWeight: 600 }}>
                    Girth: {girth.toFixed(2)}" · {points.length} pts
                  </span>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: theme.text, fontWeight: 600 }}>
                    Qty
                    <input type="number" min={1} value={quantity}
                      onChange={(e) => setQuantity(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setQuantity(1); }}
                      className="mono" style={{ width: 44, padding: "5px 6px", border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12 }} />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: theme.text, fontWeight: 600 }}>
                    Sheet width
                    <input type="number" min={1} value={sheetWidth}
                      onChange={(e) => setSheetWidth(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setSheetWidth(48); }}
                      className="mono" style={{ width: 48, padding: "5px 6px", border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12 }} />
                  </label>
                  <button onClick={() => setPoints([])}
                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: "5px 9px", borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.inputBg, cursor: "pointer" }}>
                    <Trash2 size={12} /> Clear
                  </button>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: theme.textSecondary }}>
                    ft/pc
                    <input type="number" min={1} value={lengthPerPiece}
                      onChange={(e) => setLengthPerPiece(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setLengthPerPiece(10); }}
                      className="mono" style={{ width: 52, padding: "5px 6px", border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12 }} />
                  </label>
                  <span className="mono" style={{ fontSize: 11, color: theme.text, fontWeight: 600 }} title="Sheet width ÷ girth, rounded down">
                    {partsPerSheet} pcs/{sheetWidth}" sheet · {sheetsNeeded} sheet{sheetsNeeded === 1 ? "" : "s"} needed
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: SAFETY, fontWeight: 600 }} title="Leftover width per sheet after cutting all full pieces">
                    Drop: {dropWidth.toFixed(2)}"
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "nowrap", gap: 5, marginTop: 10 }}>
                  <label style={{ flex: 1, minWidth: 0, fontSize: 9, color: theme.textSecondary }}>
                    Start Hem
                    <select value={hemStart} onChange={(e) => setHemStart(e.target.value)}
                      style={{ width: "100%", padding: "6px 2px", marginTop: 3, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 10, background: theme.inputBg }}>
                      <option value="none">None</option>
                      <option value="open-left">Open, faces Left</option>
                      <option value="open-right">Open, faces Right</option>
                      <option value="closed-left">Closed, faces Left</option>
                      <option value="closed-right">Closed, faces Right</option>
                    </select>
                  </label>
                  <label style={{ flex: 1, minWidth: 0, fontSize: 9, color: theme.textSecondary }}>
                    End Hem
                    <select value={hemEnd} onChange={(e) => setHemEnd(e.target.value)}
                      style={{ width: "100%", padding: "6px 2px", marginTop: 3, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 10, background: theme.inputBg }}>
                      <option value="none">None</option>
                      <option value="open-left">Open, faces Left</option>
                      <option value="open-right">Open, faces Right</option>
                      <option value="closed-left">Closed, faces Left</option>
                      <option value="closed-right">Closed, faces Right</option>
                    </select>
                  </label>
                  <button onClick={() => setPaintSide("left")}
                    style={{
                      flex: 1, minWidth: 0, padding: "6px 2px", marginTop: 15, borderRadius: 6, fontSize: 9.5, cursor: "pointer",
                      border: `1px solid ${paintSide === "left" ? SAFETY : "#D9D5C7"}`,
                      background: paintSide === "left" ? SAFETY : "#fff", color: paintSide === "left" ? "#fff" : INK_DEEP, fontWeight: 600,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                    Paint: Left
                  </button>
                  <button onClick={() => setPaintSide("right")}
                    style={{
                      flex: 1, minWidth: 0, padding: "6px 2px", marginTop: 15, borderRadius: 6, fontSize: 9.5, cursor: "pointer",
                      border: `1px solid ${paintSide === "right" ? SAFETY : "#D9D5C7"}`,
                      background: paintSide === "right" ? SAFETY : "#fff", color: paintSide === "right" ? "#fff" : INK_DEEP, fontWeight: 600,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                    Paint: Right
                  </button>
                </div>

                <label style={{ display: "block", fontSize: 10.5, color: theme.textSecondary, marginTop: 10 }}>
                  Part name (so you can tell parts apart)
                  <input value={partName} onChange={(e) => setPartName(e.target.value)} placeholder="e.g. Drip Edge — North Wall"
                    style={{ width: "100%", padding: 7, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
                </label>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 10.5, color: theme.textSecondary, marginBottom: 4 }}>Reference photo (optional)</div>
                  {partPhoto ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <img src={partPhoto} alt="Attached reference" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: `1px solid ${theme.border}` }} />
                      <button onClick={() => setPartPhoto(null)}
                        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: "6px 10px", borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.inputBg, color: theme.textSecondary, cursor: "pointer" }}>
                        <Trash2 size={12} /> Remove Photo
                      </button>
                    </div>
                  ) : (
                    <label style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px",
                      border: `1px dashed ${theme.border}`, borderRadius: 8, cursor: "pointer", fontSize: 11.5, color: theme.textSecondary,
                    }}>
                      <Plus size={13} /> Attach a Photo
                      <input type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                        onChange={(e) => handlePhotoAttach(e.target.files?.[0])} />
                    </label>
                  )}
                </div>

                <button onClick={addToBasket}
                  className="disp"
                  style={{
                    width: "100%", marginTop: 10, padding: "10px", borderRadius: 8, border: `2px solid ${SAFETY}`,
                    background: theme.inputBg, color: SAFETY, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}>
                  <Plus size={14} /> Add Part to Order
                </button>

                {basket.length > 0 && (
                  <div style={{ marginTop: 10, borderTop: "1px solid #EEE9DC", paddingTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span className="disp" style={{ fontSize: 11, color: theme.textSecondary }}>Parts Added</span>
                      <span className="mono" style={{ fontSize: 11, color: theme.text, fontWeight: 600 }}>
                        {basketPartsCount} pcs · {basketSheets} sheet{basketSheets === 1 ? "" : "s"}
                      </span>
                    </div>
                    {basket.map((it, idx) => {
                      const itGauge = findGauge(it.gaugeId, it.brand);
                      const itBends = Math.max(0, it.points.length - 2);
                      return (
                        <div key={it.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 0", borderBottom: idx < basket.length - 1 ? "1px solid #F3F0E7" : "none" }}>
                          <div style={{ background: INK, borderRadius: 5, padding: 3, flexShrink: 0 }}>
                            <ShapeThumb order={{ type: "trim", points: it.points, colorHex: it.colorHex }} size={28} />
                          </div>
                          {it.photo && (
                            <img src={it.photo} alt="Reference" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 5, border: `1px solid ${theme.border}`, flexShrink: 0 }} />
                          )}
                          <span style={{ fontSize: 11.5, color: theme.text, flex: 1 }}>
                            <strong>{it.name}</strong> — Qty {it.quantity} · {it.girth.toFixed(2)}" girth · {it.sheetsNeeded} sheet{it.sheetsNeeded === 1 ? "" : "s"} · {it.dropWidth.toFixed(2)}" drop
                            <br />
                            <span style={{ fontSize: 10.5, color: theme.textSecondary }}>
                              {it.colorName} · {itGauge?.label} · {itBends} bend{itBends === 1 ? "" : "s"} · Paint side: {it.paintSide === "left" ? "Left" : "Right"}
                            </span>
                          </span>
                          <span className="mono" style={{ fontSize: 11, color: theme.textSecondary }}>{money(it.price)}</span>
                          <button onClick={() => printPartAsPDF(it)} title="Export as PDF"
                            style={{ border: "none", background: "none", color: theme.textSecondary, cursor: "pointer", padding: 2, display: "flex" }}>
                            <Printer size={13} />
                          </button>
                          <button onClick={() => removeBasketItem(it.id)}
                            style={{ border: "none", background: "none", color: theme.textSecondary, cursor: "pointer", padding: 2, display: "flex" }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
          {/* accessories — offered with every panel, trim, and metal order, not just raw metal */}
          {shapeType !== "part3d" && (
            <div style={{ background: theme.card, borderRadius: 10, padding: 12, marginTop: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <div className="disp" style={{ fontSize: 12, color: theme.textSecondary }}>Accessories</div>
              <div style={{ fontSize: 10, color: theme.textSecondary, marginTop: 2 }}>
                Screws, clips, sealant, and closures to finish the job — added to this order.
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {ACCESSORY_TYPES.map((t) => (
                  <button key={t} type="button"
                    onClick={() => { setAccType(t); setAccSpec(ACCESSORY_SPECS[t]?.[0] || ""); }}
                    style={{
                      padding: "6px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer",
                      border: `1px solid ${accType === t ? INK : "#D9D5C7"}`, background: accType === t ? INK : "#fff", color: accType === t ? "#fff" : INK_DEEP,
                    }}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="disp" style={{ fontSize: 10, color: theme.textSecondary, marginTop: 8 }}>Dry In</div>
              <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                {DRY_IN_TYPES.map((t) => (
                  <button key={t} type="button"
                    onClick={() => { setAccType(t); setAccSpec(ACCESSORY_SPECS[t]?.[0] || ""); }}
                    style={{
                      padding: "6px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer",
                      border: `1px solid ${accType === t ? INK : "#D9D5C7"}`, background: accType === t ? INK : "#fff", color: accType === t ? "#fff" : INK_DEEP,
                    }}>
                    {t}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "flex-end" }}>
                {accType === "Sealant" ? (
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Sealant Color
                    <select value={accSealColor} onChange={(e) => setAccSealColor(e.target.value)}
                      style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, background: theme.inputBg }}>
                      <option value="match">Match panel color — {colorName}</option>
                      <option value="Clear">Clear</option>
                      {getColorsForBrand(brand, paintId).filter((c) => c.name !== colorName).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </label>
                ) : accType === "Clips" ? (
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Panel Profile
                    <select value={accProfile} onChange={(e) => setAccProfile(e.target.value)}
                      style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, background: theme.inputBg }}>
                      {PROFILES.map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </label>
                ) : (
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Spec
                    <select value={accSpec} onChange={(e) => setAccSpec(e.target.value)}
                      style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, background: theme.inputBg }}>
                      {ACCESSORY_SPECS[accType].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                )}
                {!accNoClip && (
                  <label style={{ width: 70, fontSize: 11, color: theme.textSecondary }}>
                    {accClipSpec ? "Boxes" : "Qty"}
                    <input type="number" min={screwLots ? 100 : 1} step={screwLots ? 100 : 1} value={accQty}
                      onChange={(e) => setAccQty(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                      onBlur={(e) => {
                        if (e.target.value === "") { setAccQty(screwLots ? 100 : 1); return; }
                        if (screwLots) setAccQty(Math.max(100, Math.round((+e.target.value || 100) / 100) * 100));
                      }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                )}
                {accClipSpec && (
                  <div style={{ width: 92, fontSize: 11, color: theme.textSecondary }}>
                    Total Clips
                    <div className="mono" style={{ padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, background: theme.highlight, color: theme.text, fontWeight: 600, boxSizing: "border-box", whiteSpace: "nowrap", textAlign: "right" }}>
                      {((+accQty || 0) * accClipSpec.perBox).toLocaleString()}
                    </div>
                  </div>
                )}
                {!accNoClip && (
                  <button type="button" onClick={addAccessory}
                    style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${SAFETY}`, background: theme.inputBg, color: SAFETY, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                    + Add
                  </button>
                )}
              </div>
              {screwLots && (
                <div style={{ fontSize: 10, color: theme.textSecondary, marginTop: 4 }}>
                  Screws sell in lots of 100 — the qty steps by full lots.
                </div>
              )}
              {accClipSpec && (
                <div style={{ fontSize: 10, color: theme.textSecondary, marginTop: 4 }}>
                  Clip {accClipSpec.code} · {accClipSpec.perBox} per box — the qty above is boxes.
                </div>
              )}
              {accNoClip && (
                <div style={{ fontSize: 10.5, fontWeight: 600, color: theme.textSecondary, marginTop: 4 }}>
                  No clip needed — this panel fastens straight through its flange.
                </div>
              )}

              {accessories.length > 0 && (
                <div style={{ marginTop: 10, borderTop: "1px solid #EEE9DC", paddingTop: 8 }}>
                  {accessories.map((a) => (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                      <span style={{ fontSize: 11.5, color: theme.text, flex: 1 }}>
                        {a.label} <span className="mono" style={{ color: theme.textSecondary }}>× {a.qty}</span>
                      </span>
                      <button onClick={() => removeAccessory(a.id)}
                        style={{ border: "none", background: "none", color: theme.textSecondary, cursor: "pointer", padding: 2, display: "flex" }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* order details */}
          <div style={{ background: theme.card, borderRadius: 10, padding: 12, marginTop: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <div className="disp" style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 8 }}>Order Details</div>

            <div style={{ position: "relative", marginTop: 10 }}>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name"
                style={{ width: "100%", padding: "8px 30px 8px 8px", border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
              <User size={14} color={STEEL} style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
            </div>
            <div style={{ position: "relative", marginTop: 10 }}>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone"
                style={{ width: "100%", padding: "8px 30px 8px 8px", border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
              <Phone size={14} color={STEEL} style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
            </div>
            <div style={{ position: "relative", marginTop: 10 }}>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes for the shop — delivery address, job site, deadline..."
                style={{ width: "100%", padding: "8px 30px 8px 8px", border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
              <StickyNote size={14} color={STEEL} style={{ position: "absolute", right: 9, top: 9, pointerEvents: "none" }} />
            </div>
          </div>

          {/* estimate + submit */}
          <div style={{ background: INK, borderRadius: 10, padding: 14, marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ color: "#CFE3EF", fontSize: 11 }}>
                {shapeType === "trim" ? `Estimated total${basket.length > 0 ? ` · ${basket.length + (points.length >= 2 ? 1 : 0)} part(s)` : ""}` : "Estimated total"}
              </div>
              <div className="mono" style={{ color: "#fff", fontSize: 22, fontWeight: 600 }}>{shapeType === "panel" && coilOverMax ? coilGateText : money(combinedEstimate)}</div>
            </div>
            <button onClick={submitOrder} disabled={submitting}
              className="disp tap-bounce"
              style={{
                background: `linear-gradient(135deg, ${SAFETY}, #F0C955)`, color: "#fff", border: "none", padding: "13px 22px", borderRadius: 10,
                fontSize: 13.5, fontWeight: 700, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1,
                boxShadow: `0 4px 14px ${SAFETY}55`,
              }}>
              {submitting ? "Sending…" : "🚀 Send Order"}
            </button>
          </div>
          {user && (
            <div style={{ marginTop: 8 }}>
              {!vaultSaveOpen ? (
                <button onClick={() => { setVaultJobName(""); setVaultSaveOpen(true); }} className="tap-bounce"
                  style={{ width: "100%", padding: "10px", borderRadius: 10, border: `1.5px dashed ${SAFETY}`, background: "transparent", color: theme.text, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                  🧰 Save to Job Vault — keep this for later
                </button>
              ) : (
                <div className="pop-in" style={{ background: theme.card, borderRadius: 10, padding: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <div className="disp" style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 6 }}>Save to which job?</div>
                  {vaultJobNames.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                      {vaultJobNames.map((n) => (
                        <button key={n} onClick={() => saveToVault(n)} disabled={savingVault}
                          style={{ padding: "6px 12px", borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.inputBg, color: theme.text, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={vaultJobName} onChange={(e) => setVaultJobName(e.target.value)} placeholder="New job name — e.g. Smith Residence"
                      style={{ flex: 1, padding: "8px", border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
                    <button onClick={() => saveToVault(vaultJobName)} disabled={savingVault}
                      style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: SAFETY, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: savingVault ? 0.7 : 1 }}>
                      {savingVault ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => setVaultSaveOpen(false)}
                      style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, background: "transparent", color: theme.textSecondary, fontSize: 12.5, cursor: "pointer" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 8, textAlign: "center" }}>
            Estimate only — final pricing confirmed by the shop. Orders are visible to shop staff.
          </div>
            </>
          )}

          <button onClick={() => setShowIdeaBox(true)}
            className="tap-bounce"
            style={{
              width: "100%", marginTop: 16, padding: "12px", borderRadius: 10, border: "none",
              background: `linear-gradient(135deg, ${INK}, ${INK_DEEP})`, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer",
            }}>
            💡 Idea Box
          </button>
          <div style={{ fontSize: 10, color: theme.textSecondary, marginTop: 4, textAlign: "center" }}>
            Feedback on this ordering app — feature ideas or bugs, not order/pricing requests.
          </div>

          {showIdeaBox && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
              onClick={() => setShowIdeaBox(false)}>
              <div onClick={(e) => e.stopPropagation()}
                style={{ background: theme.card, borderRadius: 12, padding: 20, maxWidth: 420, width: "100%", boxShadow: "0 8px 30px rgba(0,0,0,0.3)" }}>
                <div className="disp" style={{ fontSize: 16, color: theme.text, marginBottom: 4 }}>💡 Idea Box</div>
                <div style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 14 }}>
                  Feedback about this ordering app — a feature that would help, or something that's not working right. This isn't the place for order or pricing requests; call the shop for those.
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {[{ id: "idea", label: "💡 Idea" }, { id: "bug", label: "🐛 Bug Report" }].map((t) => (
                    <button key={t.id} onClick={() => setIdeaType(t.id)}
                      style={{
                        flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                        border: `1px solid ${ideaType === t.id ? SAFETY : theme.border}`, background: ideaType === t.id ? SAFETY : theme.inputBg, color: ideaType === t.id ? "#fff" : theme.text,
                      }}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <textarea value={ideaText} onChange={(e) => setIdeaText(e.target.value)}
                  placeholder={ideaType === "bug" ? "What happened in the app? What were you trying to do?" : "What would make this ordering app easier to use?"}
                  rows={5}
                  style={{ width: "100%", padding: 10, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13.5, boxSizing: "border-box", resize: "vertical", background: theme.inputBg, color: theme.text }} />
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={() => setShowIdeaBox(false)}
                    style={{ flex: 1, padding: "11px", borderRadius: 8, border: `1px solid ${theme.border}`, background: "transparent", color: theme.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Cancel
                  </button>
                  <button onClick={submitIdea} disabled={ideaSubmitting}
                    style={{ flex: 2, padding: "11px", borderRadius: 8, border: "none", background: SAFETY, color: "#fff", fontSize: 13, fontWeight: 700, cursor: ideaSubmitting ? "default" : "pointer", opacity: ideaSubmitting ? 0.7 : 1 }}>
                    {ideaSubmitting ? "Sending…" : "Submit"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : tab === "pricelist" ? (
        <div style={{ padding: 16, maxWidth: 640, margin: "0 auto" }}>
          {isStaff && (
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {[{ id: "customer", label: "Customer View" }, { id: "backend", label: "Backend (Edit)" }].map((v) => (
                <button key={v.id} onClick={() => setPriceListView(v.id)}
                  style={{
                    flex: 1, padding: "9px 6px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                    border: `1px solid ${priceListView === v.id ? INK : theme.border}`, background: priceListView === v.id ? INK : theme.card, color: priceListView === v.id ? "#fff" : theme.text,
                  }}>
                  {v.label}
                </button>
              ))}
            </div>
          )}

          {!priceListLoaded ? (
            <div style={{ color: theme.textSecondary, fontSize: 13, textAlign: "center", padding: 40 }}>Loading price list…</div>
          ) : priceListView === "backend" && !isStaff ? (
            <div style={{ color: theme.textSecondary, fontSize: 13, textAlign: "center", padding: 40 }}>You don't have access to this view.</div>
          ) : priceListView === "backend" ? (
            <>
              <div style={{ marginBottom: 18 }}>
                <div className="disp" style={{ fontSize: 12, color: SAFETY, marginBottom: 6 }}>Customer Pricing Tiers</div>
                {!customersLoaded ? (
                  <div style={{ color: theme.textSecondary, fontSize: 12, padding: 10 }}>Loading…</div>
                ) : customers.length === 0 ? (
                  <div style={{ color: theme.textSecondary, fontSize: 12, padding: 10 }}>No customers have registered yet.</div>
                ) : (
                  customers.map((c) => (
                    <div key={c.id} style={{ background: theme.card, borderRadius: 8, padding: 10, marginBottom: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: theme.text }}>{c.name || "(no name)"}</div>
                        <div style={{ fontSize: 10.5, color: theme.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</div>
                      </div>
                      <select value={c.tier} onChange={(e) => updateCustomerTier(c.id, e.target.value)}
                        style={{ padding: 6, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 11.5, fontWeight: 600, background: theme.inputBg, color: theme.text }}>
                        <option value="tier1">Tier 1 — Preferred</option>
                        <option value="greenleaf">Greenleaf</option>
                        <option value="tier2">Tier 2 — Retail</option>
                      </select>
                      <button onClick={() => toggleAdmin(c.id)}
                        title={c.id === user?.id ? "That's you — you can't remove your own admin access" : staffIds.includes(c.id) ? "Tap to remove backend admin access" : "Tap to grant backend admin access"}
                        style={{
                          padding: "6px 11px", borderRadius: 999, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
                          cursor: c.id === user?.id ? "default" : "pointer", opacity: c.id === user?.id ? 0.75 : 1,
                          border: `1px solid ${staffIds.includes(c.id) ? SAFETY : theme.border}`,
                          background: staffIds.includes(c.id) ? SAFETY : "transparent",
                          color: staffIds.includes(c.id) ? "#fff" : theme.textSecondary,
                        }}>
                        {staffIds.includes(c.id) ? "Admin ✓" : "Admin"}
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div style={{ marginBottom: 18 }}>
                <div className="disp" style={{ fontSize: 12, color: SAFETY, marginBottom: 6 }}>🌐 RoofCoil Site Leads</div>
                <div style={{ fontSize: 9.5, color: theme.textSecondary, marginBottom: 6 }}>
                  Everyone who signed up through the roofcoil.com member gate — name, company, email, and phone, newest first.
                </div>
                {!siteLeadsLoaded ? (
                  <div style={{ color: theme.textSecondary, fontSize: 12, padding: 10 }}>Loading…</div>
                ) : siteLeads.length === 0 ? (
                  <div style={{ color: theme.textSecondary, fontSize: 12, padding: 10 }}>No site signups yet.</div>
                ) : (
                  siteLeads.map((l) => (
                    <div key={l.id} style={{ background: theme.card, borderRadius: 8, padding: 10, marginBottom: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: theme.text }}>{l.name || "(no name)"}{l.company ? <span style={{ fontWeight: 400, color: theme.textSecondary }}> — {l.company}</span> : null}</div>
                        <div style={{ fontSize: 10.5, color: theme.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.email}{l.phone ? ` · ${l.phone}` : ""}</div>
                      </div>
                      <span style={{ fontSize: 10, color: theme.textSecondary, whiteSpace: "nowrap" }}>{new Date(l.created_at).toLocaleDateString()}</span>
                      <button onClick={() => deleteSiteLead(l.id)} style={{ border: "none", background: "none", color: theme.textSecondary, cursor: "pointer", padding: 2, display: "flex" }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div style={{ marginBottom: 18 }}>
                <div className="disp" style={{ fontSize: 12, color: SAFETY, marginBottom: 6 }}>🏭 Manufacturer Applications</div>
                <div style={{ fontSize: 9.5, color: theme.textSecondary, marginBottom: 6 }}>
                  Manufacturers who applied to be listed through roofcoil.com — lines, gauges, and their color chart.
                </div>
                {!mfrAppsLoaded ? (
                  <div style={{ color: theme.textSecondary, fontSize: 12, padding: 10 }}>Loading…</div>
                ) : mfrApps.length === 0 ? (
                  <div style={{ color: theme.textSecondary, fontSize: 12, padding: 10 }}>No applications yet.</div>
                ) : (
                  mfrApps.map((a) => (
                    <div key={a.id} style={{ background: theme.card, borderRadius: 8, padding: 10, marginBottom: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: theme.text }}>
                            {a.company || "(no company)"}
                            {a.website && <a href={a.website.startsWith("http") ? a.website : `https://${a.website}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: SAFETY, marginLeft: 6, fontWeight: 600 }}>site ↗</a>}
                          </div>
                          <div style={{ fontSize: 10.5, color: theme.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {a.contact_name}{a.email ? ` · ${a.email}` : ""}{a.phone ? ` · ${a.phone}` : ""}
                          </div>
                        </div>
                        <span style={{ fontSize: 10, color: theme.textSecondary, whiteSpace: "nowrap" }}>{new Date(a.created_at).toLocaleDateString()}</span>
                        <button onClick={() => deleteMfrApp(a.id)} style={{ border: "none", background: "none", color: theme.textSecondary, cursor: "pointer", padding: 2, display: "flex" }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div style={{ fontSize: 10.5, color: theme.text, marginTop: 5, lineHeight: 1.5 }}>
                        {(a.panel_types || []).join(" · ")}
                        {(a.gauges || []).length > 0 && <span style={{ color: theme.textSecondary }}> — {(a.gauges || []).join(", ")}</span>}
                      </div>
                      {(a.plants || a.colorchart_url || a.notes) && (
                        <div style={{ fontSize: 10, color: theme.textSecondary, marginTop: 3 }}>
                          {a.plants && <span>Plants: {a.plants.split("\n").join("; ")} </span>}
                          {a.colorchart_url && <a href={a.colorchart_url} target="_blank" rel="noopener noreferrer" style={{ color: SAFETY, fontWeight: 700 }}>Color chart ↗</a>}
                          {a.notes && <div style={{ marginTop: 2 }}>{a.notes}</div>}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div style={{ marginBottom: 18 }}>
                <div className="disp" style={{ fontSize: 12, color: SAFETY, marginBottom: 6 }}>💡 Idea Box Submissions</div>
                <div style={{ fontSize: 9.5, color: theme.textSecondary, marginBottom: 6 }}>
                  Ideas and bug reports submitted from the bottom of New Order.
                </div>
                {!ideasLoaded ? (
                  <div style={{ color: theme.textSecondary, fontSize: 12, padding: 10 }}>Loading…</div>
                ) : ideas.length === 0 ? (
                  <div style={{ color: theme.textSecondary, fontSize: 12, padding: 10 }}>Nothing submitted yet.</div>
                ) : (
                  ideas.map((idea) => (
                    <div key={idea.id} style={{ background: theme.card, borderRadius: 8, padding: 10, marginBottom: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                          background: idea.type === "bug" ? "#FDECEA" : "#EAF3E3", color: idea.type === "bug" ? "#B3261E" : "#3D7A2E",
                        }}>
                          {idea.type === "bug" ? "🐛 Bug" : "💡 Idea"}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, color: theme.textSecondary }}>{idea.submittedBy} · {new Date(idea.createdAt).toLocaleDateString()}</span>
                          <button onClick={() => deleteIdea(idea.id)} style={{ border: "none", background: "none", color: theme.textSecondary, cursor: "pointer", padding: 2, display: "flex" }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <div style={{ fontSize: 12.5, color: theme.text, lineHeight: 1.4 }}>{idea.text}</div>
                    </div>
                  ))
                )}
              </div>

              <div style={{ marginBottom: 18 }}>
                <div className="disp" style={{ fontSize: 12, color: SAFETY, marginBottom: 6 }}>Raw Material Cost (per sq ft)</div>
                {!materialCostsLoaded ? (
                  <div style={{ color: theme.textSecondary, fontSize: 12, padding: 10 }}>Loading…</div>
                ) : (
                  <div style={{ background: theme.card, borderRadius: 8, padding: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", display: "flex", gap: 8 }}>
                    {materialCosts.map((m) => (
                      <div key={m.id} style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 9.5, color: theme.textSecondary, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={m.name}>
                          {m.name.replace(" (per sq ft)", "")}
                        </div>
                        <input type="text" inputMode="decimal" value={draftValue(`mc-${m.id}`, m.costPerSqft)}
                          onChange={(e) => setDraft(`mc-${m.id}`, e.target.value)}
                          onBlur={() => commitDraft(`mc-${m.id}`, m.costPerSqft, (v) => updateMaterialCost(m.id, v))}
                            onKeyDown={commitOnEnter}
                          className="mono" style={{ width: "100%", padding: 5, marginTop: 3, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 12, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                        <div className="mono" style={{ fontSize: 8.5, color: theme.textSecondary, marginTop: 3, textAlign: "center" }}>
                          {m.lastUpdated || "never"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 18 }}>
                <div className="disp" style={{ fontSize: 12, color: SAFETY, marginBottom: 6 }}>Production Cost</div>
                {!productionCostsLoaded ? (
                  <div style={{ color: theme.textSecondary, fontSize: 12, padding: 10 }}>Loading…</div>
                ) : (
                  <div style={{ background: theme.card, borderRadius: 8, padding: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", display: "flex", gap: 8 }}>
                    {productionCosts.map((p) => (
                      <div key={p.id} style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 9.5, color: theme.textSecondary, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.name}>
                          {p.name}
                        </div>
                        <input type="text" inputMode="decimal" value={draftValue(`pc-${p.id}`, p.cost)}
                          onChange={(e) => setDraft(`pc-${p.id}`, e.target.value)}
                          onBlur={() => commitDraft(`pc-${p.id}`, p.cost, (v) => updateProductionCost(p.id, v))}
                            onKeyDown={commitOnEnter}
                          className="mono" style={{ width: "100%", padding: 5, marginTop: 3, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 12, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                        <div className="mono" style={{ fontSize: 8.5, color: theme.textSecondary, marginTop: 3, textAlign: "center" }}>
                          {p.lastUpdated || "never"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 18 }}>
                <div className="disp" style={{ fontSize: 12, color: SAFETY, marginBottom: 6 }}>Coil Width Price Scale</div>
                <div style={{ fontSize: 9.5, color: theme.textSecondary, marginBottom: 6 }}>
                  Bracket pricing ($/LF): each row means "anything up to this width costs this much per linear foot". With rows at 16", 21", and 24" — a 15" coil prices at the 16" row, an 18" coil at the 21" row, a 22" coil at the 24" row. Prices are PVDF; SMP orders get the SMP/PVDF ratio automatically.
                </div>
                {!coilWidthScaleLoaded ? (
                  <div style={{ color: theme.textSecondary, fontSize: 12, padding: 10 }}>Loading…</div>
                ) : (
                  [...coilWidthScale].sort((a, b) => a.width - b.width).map((c) => (
                    <div key={c.id} style={{ background: theme.card, borderRadius: 8, padding: 10, marginBottom: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", display: "flex", alignItems: "flex-end", gap: 8 }}>
                      <label style={{ flex: 1, fontSize: 9.5, color: theme.textSecondary }}>
                        Width (in)
                        <input type="text" inputMode="decimal" value={draftValue(`cws-${c.id}-w`, c.width)}
                          onChange={(e) => setDraft(`cws-${c.id}-w`, e.target.value)}
                          onBlur={() => commitDraft(`cws-${c.id}-w`, c.width, (v) => updateCoilScalePoint(c.id, "width", v))}
                            onKeyDown={commitOnEnter}
                          className="mono" style={{ width: "100%", padding: 6, marginTop: 2, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 12, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                      </label>
                      <label style={{ flex: 1, fontSize: 9.5, color: theme.textSecondary }}>
                        Price ($/LF)
                        <input type="text" inputMode="decimal" value={draftValue(`cws-${c.id}-p`, c.pricePerFt)}
                          onChange={(e) => setDraft(`cws-${c.id}-p`, e.target.value)}
                          onBlur={() => commitDraft(`cws-${c.id}-p`, c.pricePerFt, (v) => updateCoilScalePoint(c.id, "pricePerFt", v))}
                            onKeyDown={commitOnEnter}
                          className="mono" style={{ width: "100%", padding: 6, marginTop: 2, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 12, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                      </label>
                      <button onClick={() => removeCoilScalePoint(c.id)}
                        style={{ border: "none", background: "none", color: theme.textSecondary, cursor: "pointer", padding: 4 }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
                <button onClick={addCoilScalePoint}
                  style={{ width: "100%", padding: "8px", borderRadius: 8, border: `1px dashed ${theme.border}`, background: "transparent", color: theme.textSecondary, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Plus size={12} /> Add Width Point
                </button>
              </div>

              <div style={{ fontSize: 10.5, color: theme.textSecondary, marginBottom: 10 }}>
                Edit rates below. Changes save automatically and apply to everyone using this price list.
              </div>
              <button onClick={restorePriceListDefaults}
                style={{ width: "100%", padding: "10px", borderRadius: 8, border: `1px solid ${SAFETY}`, background: "transparent", color: SAFETY, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 14 }}>
                <Undo2 size={13} /> Restore Deleted Default Items
              </button>
              {Object.entries(
                priceList.reduce((acc, p) => { (acc[p.category] = acc[p.category] || []).push(p); return acc; }, {})
              ).map(([cat, items]) => (
                <div key={cat} style={{ marginBottom: 16 }}>
                  <div className="disp" style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 6 }}>{cat}</div>
                  {items.map((p) => {
                    const linkedMaterial = materialCosts.find((m) => m.id === p.derivedFromMaterialId);
                    const cost = linkedMaterial
                      ? (+linkedMaterial.costPerSqft || 0) * ((+p.coverageWidth || 12) / 12)
                      : (+p.cost || 0);
                    const marginOf = (price) => (cost > 0 && price > 0 ? (((price - cost) / price) * 100) : 0);
                    const priceFromMargin = (marginPct) => {
                      const m = Math.min(99, +marginPct || 0);
                      return cost > 0 ? cost / (1 - m / 100) : 0;
                    };
                    const tierRow = (key, label) => (
                      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginTop: 4 }}>
                        <label style={{ width: 62, fontSize: 9.5, color: theme.textSecondary }}>{label}</label>
                        <label style={{ flex: 1, fontSize: 9, color: theme.textSecondary }}>
                          Price ($)
                          <input type="text" inputMode="decimal" value={draftValue(`pl-${p.id}-${key}`, p[key])}
                            onChange={(e) => setDraft(`pl-${p.id}-${key}`, e.target.value)}
                            onBlur={() => commitDraft(`pl-${p.id}-${key}`, p[key], (v) => updatePriceListItem(p.id, key, v))}
                            onKeyDown={commitOnEnter}
                            className="mono" style={{ width: "100%", padding: 5, marginTop: 2, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 12, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                        </label>
                        <label style={{ flex: 1, fontSize: 9, color: theme.textSecondary }}>
                          Margin (%)
                          <input type="text" inputMode="decimal" value={draftValue(`plm-${p.id}-${key}`, marginOf(p[key]).toFixed(1))}
                            onChange={(e) => setDraft(`plm-${p.id}-${key}`, e.target.value)}
                            onBlur={() => commitDraft(`plm-${p.id}-${key}`, marginOf(p[key]), (v) => updatePriceListItem(p.id, key, +priceFromMargin(v).toFixed(2)))}
                            onKeyDown={commitOnEnter}
                            disabled={cost <= 0} title={cost <= 0 ? "Set a Cost above to edit margin" : ""}
                            className="mono" style={{ width: "100%", padding: 5, marginTop: 2, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 12, background: cost <= 0 ? theme.pageBg : theme.inputBg, color: theme.text, boxSizing: "border-box", opacity: cost <= 0 ? 0.5 : 1 }} />
                        </label>
                      </div>
                    );
                    return (
                      <div key={p.id} ref={(el) => { priceRowRefs.current[p.id] = el; }}
                        style={{
                          background: theme.card, borderRadius: 8, padding: 10, marginBottom: 6,
                          boxShadow: dragItemId === p.id ? "0 4px 14px rgba(0,0,0,0.25)" : "0 1px 3px rgba(0,0,0,0.08)",
                          opacity: dragItemId === p.id ? 0.85 : 1,
                          transform: dragItemId === p.id ? "scale(1.02)" : "scale(1)",
                          transition: "opacity 0.1s, transform 0.1s",
                        }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <div onPointerDown={handleDragStart(p)}
                            style={{ cursor: "grab", touchAction: "none", color: theme.text, display: "flex", alignItems: "center", justifyContent: "center", padding: 8, background: theme.inputBg, borderRadius: 6, border: `1px solid ${theme.border}` }}>
                            <GripVertical size={22} />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <button onClick={() => moveItemInCategory(p.id, -1)}
                              style={{ border: `1px solid ${theme.border}`, background: theme.inputBg, color: theme.text, cursor: "pointer", padding: 6, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center" }}
                              title="Move up">
                              <ChevronUp size={18} />
                            </button>
                            <button onClick={() => moveItemInCategory(p.id, 1)}
                              style={{ border: `1px solid ${theme.border}`, background: theme.inputBg, color: theme.text, cursor: "pointer", padding: 6, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center" }}
                              title="Move down">
                              <ChevronDown size={18} />
                            </button>
                          </div>
                          <input value={p.name} onChange={(e) => updatePriceListItem(p.id, "name", e.target.value)}
                            className="mono" style={{ flex: 1, padding: 6, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 12.5, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                          <button onClick={() => removePriceListItem(p.id)}
                            style={{ border: "none", background: "none", color: theme.textSecondary, cursor: "pointer", padding: 4 }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginTop: 6 }}>
                          <label style={{ flex: 1, fontSize: 9.5, color: theme.textSecondary }}>
                            Derive cost from
                            <select value={p.derivedFromMaterialId || ""} onChange={(e) => updatePriceListItem(p.id, "derivedFromMaterialId", e.target.value || undefined)}
                              className="mono" style={{ width: "100%", padding: 5, marginTop: 2, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 11.5, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }}>
                              <option value="">— Manual cost —</option>
                              {materialCosts.map((m) => <option key={m.id} value={m.id}>{m.name.replace(" (per sq ft)", "").replace(" (per linear ft)", "")}</option>)}
                            </select>
                          </label>
                          {linkedMaterial && (
                            <label style={{ width: 100, fontSize: 9.5, color: theme.textSecondary }}>
                              Coil Size
                              <select value={p.coverageWidth || 12} onChange={(e) => updatePriceListItem(p.id, "coverageWidth", +e.target.value)}
                                className="mono" style={{ width: "100%", padding: 5, marginTop: 2, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 12, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }}>
                                {[16, 20, 21, 24].map((cw) => <option key={cw} value={cw}>{cw}"</option>)}
                              </select>
                            </label>
                          )}
                        </div>
                        <label style={{ display: "block", width: 120, fontSize: 9.5, color: theme.textSecondary, marginTop: 6 }}>
                          Cost ($)
                          {linkedMaterial ? (
                            <div className="mono" style={{ padding: 5, marginTop: 2, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 12, background: theme.pageBg, color: theme.text, boxSizing: "border-box" }} title="Auto-computed: raw material cost per sq ft × coil width">
                              {money(cost)} <span style={{ color: theme.textSecondary, fontSize: 9 }}>(auto)</span>
                            </div>
                          ) : (
                            <input type="text" inputMode="decimal" value={draftValue(`plc-${p.id}`, p.cost || 0)}
                              onChange={(e) => setDraft(`plc-${p.id}`, e.target.value)}
                              onBlur={() => commitDraft(`plc-${p.id}`, p.cost || 0, (v) => updatePriceListItem(p.id, "cost", v))}
                            onKeyDown={commitOnEnter}
                              className="mono" style={{ width: "100%", padding: 5, marginTop: 2, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 12, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                          )}
                        </label>
                        {tierRow("tier1", "Tier 1")}
                        {tierRow("tier2", "Tier 2")}
                        {tierRow("greenleaf", "Greenleaf")}
                        {(() => {
                          const spec = Object.values(CLIP_SPECS).find((cs) => p.name.toUpperCase().startsWith(cs.code));
                          if (!spec) return null;
                          return (
                            <div className="mono" style={{ fontSize: 10.5, color: theme.text, marginTop: 6, background: theme.highlight, borderRadius: 5, padding: "6px 9px" }}>
                              Box of {spec.perBox}: T1 {money((+p.tier1 || 0) * spec.perBox)} · T2 {money((+p.tier2 || 0) * spec.perBox)} · GL {money((+p.greenleaf || 0) * spec.perBox)}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              ))}
              <button onClick={addPriceListItem}
                style={{ width: "100%", padding: "10px", borderRadius: 8, border: `1px dashed ${theme.border}`, background: "transparent", color: theme.textSecondary, fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Plus size={13} /> Add Item
              </button>
              <button onClick={restorePriceListDefaults}
                style={{ width: "100%", padding: "10px", borderRadius: 8, border: `1px solid ${SAFETY}`, background: "transparent", color: SAFETY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8 }}>
                <Undo2 size={13} /> Restore Deleted Default Items
              </button>
            </>
          ) : (
            <>
              {isStaff ? (
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  {[
                    { id: "tier1", label: "Tier 1 — Preferred" },
                    { id: "greenleaf", label: "Greenleaf" },
                    { id: "tier2", label: "Tier 2 — Retail" },
                  ].map((t) => (
                    <button key={t.id} onClick={() => setPriceListTier(t.id)}
                      style={{
                        flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
                        border: `1px solid ${priceListTier === t.id ? SAFETY : theme.border}`, background: priceListTier === t.id ? SAFETY : theme.card, color: priceListTier === t.id ? "#fff" : theme.text,
                      }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <div style={{ background: theme.card, borderRadius: 10, padding: 18, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <div className="disp" style={{ fontSize: 16, color: theme.text, textAlign: "center", marginBottom: 2 }}>Fortified Sheet Metal</div>
                <div style={{ fontSize: 11, color: theme.textSecondary, textAlign: "center", marginBottom: 10 }}>
                  {priceListTier === "tier1" ? "Preferred Customer Pricing" : priceListTier === "greenleaf" ? "Greenleaf Pricing" : "Standard Pricing"}
                </div>
                <div style={{ fontSize: 10.5, color: SAFETY, fontWeight: 700, textAlign: "center", marginBottom: 16 }}>
                  Prices shown do not include sales tax — 8.25% sales tax will be added.
                </div>
                {Object.entries(
                  priceList.reduce((acc, p) => { (acc[p.category] = acc[p.category] || []).push(p); return acc; }, {})
                ).map(([cat, items]) => (
                  <div key={cat} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: SAFETY, borderBottom: `1px solid ${theme.border}`, paddingBottom: 4, marginBottom: 6 }}>{cat}</div>
                    {items.map((p) => (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5, color: theme.text }}>
                        <span>{p.name}</span>
                        <span className="mono" style={{ fontWeight: 600 }}>{money(p[priceListTier])}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <div style={{ fontSize: 9.5, color: theme.textSecondary, marginTop: 10, textAlign: "center" }}>
                  Prices subject to change. Contact us for a formal quote on your project.
                </div>
              </div>
            </>
          )}
        </div>
      ) : tab === "vault" ? (
        <div style={{ padding: 16, maxWidth: 640, margin: "0 auto" }}>
          <div className="disp" style={{ fontSize: 16, fontWeight: 700, color: theme.text, marginBottom: 2 }}>🧰 Job Vault</div>
          <div style={{ fontSize: 11.5, color: theme.textSecondary, marginBottom: 14 }}>
            Trim and panels saved by job — reference them anytime, load one back into an order, and get flagged when shop prices change.
          </div>

          {vaultAlertCount > 0 && (
            <div className="pop-in" style={{ background: "linear-gradient(90deg, #FBF3D9, #F5E6C3)", borderLeft: `4px solid ${AMBER}`, borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: 12.5, fontWeight: 600, color: INK_DEEP }}>
              ▲ Prices went up on {vaultAlertCount} saved item{vaultAlertCount === 1 ? "" : "s"} since you last checked — marked below.
            </div>
          )}

          {!vaultLoaded || !priceListLoaded ? (
            <div style={{ color: theme.textSecondary, fontSize: 13, padding: 20, textAlign: "center" }}>Loading your vault…</div>
          ) : vaultItems.length === 0 ? (
            <div style={{ background: theme.card, borderRadius: 10, padding: 24, textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>🧰</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: theme.text, marginBottom: 4 }}>Nothing saved yet</div>
              <div style={{ fontSize: 12, color: theme.textSecondary, lineHeight: 1.6 }}>
                Build a trim profile or panel in New Order, then hit "Save to Job Vault" next to the estimate. Everything you save lands here, grouped by job — and we'll flag it if shop prices go up.
              </div>
            </div>
          ) : (
            vaultJobNames.map((jobName) => {
              const items = vaultItems.filter((v) => v.job_name === jobName);
              const savedTotal = items.reduce((s, v) => s + Number(v.saved_price), 0);
              const curTotal = items.reduce((s, v) => s + vaultCurrentPrice(v), 0);
              const open = vaultExpanded[jobName] !== false;
              const jobAlerts = items.filter((v) => vaultIncrease(v) > 0).length;
              return (
                <div key={jobName} style={{ background: theme.card, borderRadius: 10, marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", overflow: "hidden" }}>
                  <div onClick={() => setVaultExpanded((e) => ({ ...e, [jobName]: !open }))}
                    style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", borderBottom: open ? `1px solid ${theme.border}` : "none" }}>
                    <Briefcase size={16} color={SAFETY} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="disp" style={{ fontSize: 13.5, fontWeight: 700, color: theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{jobName}</div>
                      <div className="mono" style={{ fontSize: 10, color: theme.textSecondary }}>
                        {items.length} item{items.length === 1 ? "" : "s"} · saved {money(savedTotal)}{Math.abs(curTotal - savedTotal) > 0.005 ? ` · today ${money(curTotal)}` : ""}
                      </div>
                    </div>
                    {jobAlerts > 0 && (
                      <span className="mono" style={{ background: AMBER, color: "#fff", borderRadius: 999, fontSize: 9.5, padding: "2px 8px", fontWeight: 700 }}>▲ {jobAlerts}</span>
                    )}
                    {open ? <ChevronUp size={15} color={STEEL} /> : <ChevronDown size={15} color={STEEL} />}
                  </div>
                  {open && (
                    <div style={{ padding: "4px 14px 10px" }}>
                      {items.map((v) => {
                        const cur = vaultCurrentPrice(v);
                        const inc = vaultIncrease(v);
                        const saved = Number(v.saved_price);
                        return (
                          <div key={v.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: `1px dotted ${theme.border}` }}>
                            <ShapeThumb order={v.payload} size={44} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vaultItemLabel(v)}</div>
                              <div className="mono" style={{ fontSize: 9.5, color: theme.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                Qty {v.payload?.quantity ?? 1} · {v.payload?.gaugeId || ""} · {v.payload?.colorName || ""} · saved {new Date(v.created_at).toLocaleDateString()}
                              </div>
                              {inc > 0 && (
                                <div className="mono" style={{ fontSize: 9.5, color: AMBER, fontWeight: 700, marginTop: 2 }}>
                                  ▲ Up {money(inc)} since you saved it
                                </div>
                              )}
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              {inc > 0 ? (
                                <>
                                  <div className="mono" style={{ fontSize: 9.5, color: theme.textSecondary, textDecoration: "line-through" }}>{money(saved)}</div>
                                  <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: AMBER }}>{money(cur)}</div>
                                </>
                              ) : (
                                <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>{money(cur)}</div>
                              )}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                              <button onClick={() => loadVaultItem(v)} className="tap-bounce"
                                style={{ padding: "5px 10px", borderRadius: 7, border: "none", background: `linear-gradient(135deg, ${SAFETY}, #F0C955)`, color: "#fff", fontSize: 10.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                                Load
                              </button>
                              {inc > 0 && (
                                <button onClick={() => ackVaultItem(v)} title="Dismiss this price alert"
                                  style={{ padding: "4px 8px", borderRadius: 7, border: `1px solid ${theme.border}`, background: "transparent", color: theme.textSecondary, fontSize: 9.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                                  Got it
                                </button>
                              )}
                            </div>
                            <button onClick={() => deleteVaultItem(v.id)} title="Remove from vault"
                              style={{ border: "none", background: "none", color: theme.textSecondary, cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 }}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                      <div style={{ textAlign: "right", marginTop: 6 }}>
                        <button onClick={() => { if (window.confirm(`Remove "${jobName}" and its ${items.length} saved item${items.length === 1 ? "" : "s"}?`)) deleteVaultJob(jobName); }}
                          style={{ border: "none", background: "none", color: theme.textSecondary, fontSize: 10, cursor: "pointer", textDecoration: "underline" }}>
                          Delete this job
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div style={{ fontSize: 10, color: theme.textSecondary, marginTop: 4, textAlign: "center" }}>
            Vault prices follow the shop's current price list — the shop still confirms final pricing on every order.
          </div>
        </div>
      ) : tab === "past" ? (
        <div style={{ padding: 16, maxWidth: 640, margin: "0 auto" }}>
          <div className="disp" style={{ fontSize: 16, fontWeight: 700, color: theme.text, marginBottom: 2 }}>🕐 Past Orders</div>
          <div style={{ fontSize: 11.5, color: theme.textSecondary, marginBottom: 14 }}>
            Every order you've sent to the shop, newest first — with where it stands. Tap Reorder to run one again.
          </div>
          {!loaded ? (
            <div style={{ color: theme.textSecondary, fontSize: 13, padding: 20, textAlign: "center" }}>Loading your orders…</div>
          ) : myOrders.length === 0 ? (
            <div style={{ background: theme.card, borderRadius: 10, padding: 24, textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>🕐</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: theme.text, marginBottom: 4 }}>No orders yet</div>
              <div style={{ fontSize: 12, color: theme.textSecondary, lineHeight: 1.6 }}>
                Orders you send from New Order will show up here with their shop status — Pending, In Production, Ready for Pickup, Completed.
              </div>
            </div>
          ) : (
            myJobKeys.map((jobKey) => {
              const items = myOrders.filter((o) => (o.jobId || o.id) === jobKey);
              const first = items[0];
              const total = items.reduce((s, o) => s + (o.price || 0), 0);
              return (
                <div key={jobKey} style={{ background: theme.card, borderRadius: 10, marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", overflow: "hidden" }}>
                  <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${theme.border}` }}>
                    <Clock size={16} color={SAFETY} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="disp" style={{ fontSize: 13.5, fontWeight: 700, color: theme.text }}>{first.poNumber || "Order"}</div>
                      <div className="mono" style={{ fontSize: 10, color: theme.textSecondary }}>
                        {new Date(first.createdAt).toLocaleDateString()} · {items.length} item{items.length === 1 ? "" : "s"} · est. {money(total)}
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: "4px 14px 10px" }}>
                    {items.map((o) => (
                      <div key={o.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: `1px dotted ${theme.border}` }}>
                        <ShapeThumb order={o} size={44} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vaultItemLabel({ payload: o })}</div>
                          <div className="mono" style={{ fontSize: 9.5, color: theme.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            Qty {o.quantity ?? 1} · {o.gaugeId || ""} · {o.colorName || ""}
                          </div>
                        </div>
                        <span className="disp" style={{ background: STATUS_COLOR[o.status] || STEEL, color: "#fff", borderRadius: 999, fontSize: 8.5, padding: "3px 9px", fontWeight: 700, letterSpacing: "0.05em", whiteSpace: "nowrap", flexShrink: 0 }}>
                          {o.status || "Pending"}
                        </span>
                        <div className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: theme.text, flexShrink: 0 }}>{money(o.price || 0)}</div>
                        <button onClick={() => loadVaultItem({ payload: o }, "your past orders")} className="tap-bounce"
                          style={{ padding: "5px 10px", borderRadius: 7, border: "none", background: `linear-gradient(135deg, ${SAFETY}, #F0C955)`, color: "#fff", fontSize: 10.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                          Reorder
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
          <div style={{ fontSize: 10, color: theme.textSecondary, marginTop: 4, textAlign: "center" }}>
            Estimates shown — the shop confirms final pricing on every order.
          </div>
        </div>
      ) : (
        <div style={{ padding: 16, maxWidth: 640, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {[{ id: "jobs", label: "Jobs" }, { id: "materials", label: "Master Materials List" }].map((v) => (
              <button key={v.id} onClick={() => setShopFloorView(v.id)}
                style={{
                  flex: 1, padding: "9px 6px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                  border: `1px solid ${shopFloorView === v.id ? INK : "#D9D5C7"}`, background: shopFloorView === v.id ? INK : "#fff", color: shopFloorView === v.id ? "#fff" : INK_DEEP,
                }}>
                {v.label}
              </button>
            ))}
          </div>

          {shopFloorView === "materials" ? (
            (() => {
              const activeOrders = orders.filter((o) => o.status !== "Completed");
              const materials = computeJobMaterials(activeOrders);
              return !loaded ? (
                <div style={{ color: theme.textSecondary, fontSize: 13, textAlign: "center", padding: 40 }}>Loading orders…</div>
              ) : materials.flatSheets.length === 0 && materials.coil.length === 0 && materials.accessories.length === 0 ? (
                <div style={{ color: theme.textSecondary, fontSize: 13, textAlign: "center", padding: 40 }}>
                  Nothing needed right now — no active jobs with trackable material needs.
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10.5, color: theme.textSecondary, marginBottom: 12 }}>
                    Every coil, sheet, and accessory needed across all active (non-Completed) jobs — each card shows the PO(s) it feeds. Tap a card in Needed once it's in stock (tap again to undo). Nothing can be moved to Ready for Production by hand: the moment every component a PO needs is In Stock, that whole PO's cards move over together. Tapping a Ready card sends its PO back, and a card returns to Needed if its quantity grows.
                  </div>
                  {(() => {
                    const allLines = [
                      ...materials.coil.map((c) => ({
                        lk: `coil:${c.key}:${Math.ceil(c.feet)}`, group: "Coils",
                        title: `${formatDim(c.width)}" — ${Math.ceil(c.feet)} ft`,
                        sub: `${c.brand}, ${c.colorName}`, pos: c.pos,
                      })),
                      ...materials.flatSheets.map((f) => ({
                        lk: `fs:${f.key}:${f.count}`, group: "Flat Sheets",
                        title: `${f.count} sheets — ${formatDim(f.width / 12)}' × ${formatDim(f.length / 12)}'`,
                        sub: `${f.brand}, ${f.colorName}`, pos: f.pos,
                      })),
                      ...materials.accessories.map((a) => ({
                        lk: `acc:${a.key}:${a.qty}`, group: "Accessories",
                        title: `${a.qty} × ${a.label}`,
                        sub: "", pos: a.pos,
                      })),
                    ];
                    const cols = [
                      { id: undefined, label: "Needed", color: STEEL },
                      { id: "instock", label: "In Stock", color: AMBER },
                      { id: "pulled", label: "Ready for Production", color: GREEN },
                    ];
                    return (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, alignItems: "start" }}>
                        {cols.map((col) => {
                          const lines = allLines.filter((l) => matStatus[l.lk] === col.id);
                          return (
                            <div key={col.label} style={{ background: theme.pageBg, border: `1px solid ${theme.border}`, borderTop: `3px solid ${col.color}`, borderRadius: 8, padding: 6, minHeight: 120 }}>
                              <div className="disp" style={{ fontSize: 10, color: col.color, marginBottom: 6, textAlign: "center" }}>
                                {col.label} ({lines.length})
                              </div>
                              {lines.length === 0 ? (
                                <div style={{ fontSize: 10, color: theme.textSecondary, textAlign: "center", padding: "14px 4px" }}>—</div>
                              ) : (
                                ["Coils", "Flat Sheets", "Accessories"].map((g) => {
                                  const groupLines = lines.filter((l) => l.group === g);
                                  if (groupLines.length === 0) return null;
                                  return (
                                    <div key={g}>
                                      <div className="disp" style={{ fontSize: 8.5, color: theme.textSecondary, margin: "5px 2px 3px" }}>{g}</div>
                                      {groupLines.map((l) => (
                                        <button key={l.lk} onClick={() => cycleMatStatus(l.lk)} className="tap-bounce"
                                          title={col.id === "pulled" ? "Not actually ready? Tap to send this PO back" : col.id === "instock" ? "Tap to undo — Ready for Production fills itself once the whole PO is in stock" : "Tap when it's in stock"}
                                          style={{ display: "block", width: "100%", textAlign: "left", background: theme.card, border: "none", borderRadius: 6, padding: 8, marginBottom: 5, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", cursor: "pointer" }}>
                                          {l.pos.length > 0 && (
                                            <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: SAFETY, lineHeight: 1.3, marginBottom: 3 }}>{l.pos.join(" · ")}</div>
                                          )}
                                          <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: theme.text, lineHeight: 1.3 }}>{l.title}</div>
                                          {l.sub ? <div style={{ fontSize: 11, fontWeight: 600, color: theme.text, marginTop: 3, lineHeight: 1.4 }}>{l.sub}</div> : null}
                                        </button>
                                      ))}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  <div style={{ fontSize: 9.5, color: theme.textSecondary, marginTop: 4 }}>
                    3D Parts (collector boxes, scuppers, chimney caps) aren't included — their material need isn't tracked as a simple sheet/coil quantity yet.
                  </div>
                </div>
              );
            })()
          ) : (
            <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <button onClick={seedSampleOrders}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, padding: "6px 10px", borderRadius: 6, border: `1px solid ${SAFETY}`, background: theme.inputBg, color: SAFETY, fontWeight: 600, cursor: "pointer" }}>
              <Plus size={12} /> Load 12 Sample Orders
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {["All", ...STATUS_FLOW].map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                style={{
                  padding: "6px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                  border: `1px solid ${statusFilter === s ? INK : "#D9D5C7"}`, background: statusFilter === s ? INK : "#fff", color: statusFilter === s ? "#fff" : INK_DEEP,
                }}>
                {s}
              </button>
            ))}
          </div>

          {!loaded ? (
            <div style={{ color: theme.textSecondary, fontSize: 13, textAlign: "center", padding: 40 }}>Loading orders…</div>
          ) : visibleOrders.length === 0 ? (
            <div style={{ color: theme.textSecondary, fontSize: 13, textAlign: "center", padding: 40 }}>
              No orders here yet. New submissions from the order form will show up on the shop floor.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(() => {
                const groups = [];
                const byKey = new Map();
                visibleOrders.forEach((o) => {
                  const key = o.jobId || o.id;
                  if (!byKey.has(key)) { byKey.set(key, { key, items: [] }); groups.push(byKey.get(key)); }
                  byKey.get(key).items.push(o);
                });
                return groups.map((group) => {
                  const first = group.items[0];
                  const jobTotal = group.items.reduce((s, o) => s + o.price, 0);
                  const isOpen = !!expandedJobs[group.key];
                  const statusCounts = {};
                  group.items.forEach((o) => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });
                  const trimItems = group.items.filter((o) => o.type === "trim");
                  const panelItems = group.items.filter((o) => o.type === "panel");
                  const trimPieceTotal = trimItems.reduce((s, o) => s + (+o.quantity || 0), 0);
                  const panelFeetTotal = panelItems.reduce((s, o) => s + ((+o.height || 0) / 12) * (+o.quantity || 0), 0);
                  const panelLocations = [...new Set(panelItems.map((o) => o.runLocation).filter(Boolean))];
                  const materials = computeJobMaterials(group.items);
                  return (
                    <div key={group.key} style={{ background: theme.card, borderRadius: 10, padding: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <span className="disp" style={{ fontSize: 10, color: theme.textSecondary }}>PO#</span>
                        <input
                          value={first.poNumber || ""}
                          onChange={(e) => updatePoNumber(group.key, e.target.value)}
                          placeholder="—"
                          className="mono"
                          style={{ fontSize: 12, fontWeight: 700, color: SAFETY, border: "1px solid #EEE9DC", borderRadius: 5, padding: "2px 7px", width: 100 }}
                        />
                      </div>
                      <button onClick={() => setExpandedJobs((e) => ({ ...e, [group.key]: !e[group.key] }))}
                        style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <ChevronDown size={16} color={STEEL}
                              style={{ marginTop: 3, flexShrink: 0, transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s" }} />
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 15, color: theme.text }}>{first.customerName}</div>
                              <div style={{ fontSize: 11, color: theme.textSecondary }}>{first.phone || "No phone provided"}</div>
                              <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 2 }}>
                                {group.items.length} piece{group.items.length === 1 ? "" : "s"} in this job
                              </div>
                              {trimItems.length > 0 && (
                                <div style={{ fontSize: 10.5, color: theme.text, marginTop: 1 }}>
                                  {trimItems.length} trim type{trimItems.length === 1 ? "" : "s"} · {trimPieceTotal} trim pcs total
                                </div>
                              )}
                              {panelItems.length > 0 && (
                                <>
                                  <div style={{ fontSize: 10.5, color: theme.text, marginTop: 1 }}>
                                    {panelFeetTotal.toFixed(1)} ft of panel · Run: {panelLocations.join(" & ") || "—"}
                                  </div>
                                  <div style={{ marginTop: 3, display: "flex", flexDirection: "column", gap: 1 }}>
                                    {panelItems.map((o, i) => (
                                      <div key={i} style={{ fontSize: 10, color: theme.textSecondary, display: "flex", alignItems: "center", gap: 5 }}>
                                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: o.colorHex, flexShrink: 0, border: "1px solid rgba(0,0,0,0.15)" }} />
                                        {o.brand} · {o.colorName} · {o.profile}
                                      </div>
                                    ))}
                                  </div>
                                </>
                              )}
                              {!isOpen && (
                                <div style={{ display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap" }}>
                                  {Object.entries(statusCounts).map(([s, n]) => (
                                    <span key={s} style={{
                                      fontSize: 9.5, fontWeight: 600, padding: "2px 7px", borderRadius: 999,
                                      color: STATUS_COLOR[s], border: `1px solid ${STATUS_COLOR[s]}`,
                                    }}>
                                      {n} {s}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="mono" style={{ fontWeight: 700, fontSize: 16, color: theme.text, whiteSpace: "nowrap" }}>{money(jobTotal)}</div>
                        </div>
                      </button>

                      {isOpen && (materials.flatSheets.length > 0 || materials.coil.length > 0) && (
                        <div style={{ margin: "8px 0", padding: 10, background: darkMode ? "#2A2E22" : "#F0F4E8", border: `1px solid ${darkMode ? "#4A5238" : "#C9D9AE"}`, borderRadius: 8 }}>
                          <div className="disp" style={{ fontSize: 10.5, color: darkMode ? "#B9D08A" : "#4C6B22", marginBottom: 6 }}>Materials Needed</div>
                          {materials.flatSheets.map((f, i) => (
                            <div key={`fs-${i}`} style={{ fontSize: 11.5, color: theme.text, marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ width: 12, height: 12, borderRadius: 3, background: f.colorHex, border: "1px solid rgba(0,0,0,0.2)", flexShrink: 0 }} />
                              <span><strong>{f.count}</strong> flat sheet{f.count === 1 ? "" : "s"} — {formatDim(f.width / 12)}' × {formatDim(f.length / 12)}' — {f.brand}, {f.colorName}</span>
                            </div>
                          ))}
                          {materials.coil.map((c, i) => (
                            <div key={`coil-${i}`} style={{ fontSize: 11.5, color: theme.text, marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ width: 12, height: 12, borderRadius: 3, background: c.colorHex, border: "1px solid rgba(0,0,0,0.2)", flexShrink: 0 }} />
                              <span><strong>{formatDim(c.width)}"</strong> wide coil — <strong>{Math.ceil(c.feet)} ft</strong> needed — {c.brand}, {c.colorName}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {isOpen && group.items.map((o, idx) => {
                        const gauge = findGauge(o.gaugeId, o.brand);
                        const paint = PAINT_OPTIONS.find((p) => p.id === o.paintId);
                        const StatusIcon = STATUS_ICON[o.status];
                        return (
                          <div key={o.id} style={{ display: "flex", gap: 10, marginTop: 10, paddingTop: 10, borderTop: "1px solid #F0EDE3" }}>
                            <div style={{ background: INK, borderRadius: 8, padding: 6, flexShrink: 0 }}>
                              <ShapeThumb order={o} size={52} />
                            </div>
                            {o.photo && (
                              <img src={o.photo} alt="Reference" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, border: `1px solid ${theme.border}`, flexShrink: 0 }} />
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                                {o.partName && <div style={{ fontSize: 12, color: SAFETY, fontWeight: 600 }}>{o.partName}</div>}
                                <div className="mono" style={{ fontWeight: 600, fontSize: 13, color: theme.text, whiteSpace: "nowrap" }}>{money(o.price)}</div>
                              </div>
                              <div style={{ fontSize: 11.5, color: theme.text, marginTop: 2 }}>
                                {o.type === "panel" ? (
                                  <>Qty {o.quantity} × {o.width}" panel, {formatFeetInches(o.height)} long — {o.profile}</>
                                ) : (
                                  <>
                                    {o.type === "metal"
                                      ? `Flat ${o.flatWidth}" × ${(o.flatLength / 12).toFixed(1)}' + Coil ${o.coilWidth}" × ${(o.coilLength / 12).toFixed(0)}'`
                                      : o.type === "part3d"
                                      ? `${PART3D_LABELS[o.partType] || o.partType}${o.capStyle ? ` (${CAP_STYLE_LABELS[o.capStyle] || o.capStyle})` : ""} — ${o.partW}"W × ${o.partD}"D × ${o.partH}"H${o.partType === "chimney" ? ` (cap ${o.partCapH}")` : ""}`
                                      : `Trim profile — ${o.lengthPerPiece} ft/pc`} · Qty {o.quantity}
                                  </>
                                )}
                              </div>
                              {o.type === "panel" && o.runLocation && (
                                <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 1 }}>
                                  Run at: {o.runLocation}
                                  {o.ribStyle && o.ribStyle !== "none" && ` · ${RIB_LABELS[o.ribStyle] || o.ribStyle}`}
                                  {o.clipRelief && " · Clip Relief"}
                                </div>
                              )}
                              {o.accessories && o.accessories.length > 0 && (
                                <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 2 }}>
                                  Accessories: {o.accessories.map((a) => `${a.label} ×${a.qty}`).join(", ")}
                                </div>
                              )}
                              {o.type === "panel" && (o.metalSupplier || o.fabricator) && (
                                <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 1 }}>
                                  Supply: {o.metalSupplier || "Fortified Metal"} · Fab: {o.fabricator || "Fortified Metal"}
                                </div>
                              )}
                              {o.type === "panel" && o.runLocation === "Job Site" && o.jobSiteAddress && (
                                <div style={{ fontSize: 10.5, color: SAFETY, marginTop: 1 }}>
                                  📍 {o.jobSiteAddress}{o.jobSiteMiles ? ` · ${o.jobSiteMiles} mi one way${mileageCharge(o.jobSiteMiles) > 0 ? ` · mileage ${money(mileageCharge(o.jobSiteMiles))}` : ""}` : ""}
                                </div>
                              )}
                              {o.type === "trim" && (o.hemStart !== "none" || o.hemEnd !== "none") && (
                                <div style={{ fontSize: 10.5, color: SAFETY, marginTop: 2 }}>
                                  {o.hemStart !== "none" && `Start hem: ${formatHem(o.hemStart)}`}
                                  {o.hemStart !== "none" && o.hemEnd !== "none" && " · "}
                                  {o.hemEnd !== "none" && `End hem: ${formatHem(o.hemEnd)}`}
                                </div>
                              )}
                              {o.type === "trim" && o.paintSide && (
                                <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 2 }}>
                                  Painted side: {o.paintSide === "left" ? "Left" : "Right"} of line
                                </div>
                              )}
                              <div style={{ fontSize: 11, color: theme.textSecondary, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ width: 9, height: 9, borderRadius: "50%", background: o.colorHex, display: "inline-block", border: "1px solid rgba(0,0,0,0.15)" }} />
                                {o.colorName} · {o.brand} · {gauge?.label} · {paint?.label}
                              </div>
                              {o.notes && <div style={{ fontSize: 11, color: theme.textSecondary, marginTop: 4, fontStyle: "italic" }}>"{o.notes}"</div>}
                              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                                <StatusIcon size={12} color={STATUS_COLOR[o.status]} />
                                <div style={{ position: "relative", flex: 1 }}>
                                  <select value={o.status} onChange={(e) => updateStatus(o.id, e.target.value)}
                                    style={{
                                      width: "100%", padding: "5px 22px 5px 8px", fontSize: 11.5, borderRadius: 6,
                                      border: `1px solid ${STATUS_COLOR[o.status]}`, color: STATUS_COLOR[o.status], background: theme.inputBg, fontWeight: 600,
                                    }}>
                                    {STATUS_FLOW.map((s) => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                  <ChevronDown size={11} style={{ position: "absolute", right: 7, top: 7, pointerEvents: "none", color: STATUS_COLOR[o.status] }} />
                                </div>
                                {o.type === "trim" && (
                                  <button onClick={() => printPartAsPDF(o)} title="Export as PDF"
                                    style={{ border: `1px solid ${theme.border}`, background: theme.inputBg, color: theme.textSecondary, cursor: "pointer", padding: 5, borderRadius: 6, display: "flex" }}>
                                    <Printer size={13} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
          )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
