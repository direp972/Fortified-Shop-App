import React, { useState, useEffect, useRef, useCallback } from "react";
import { Ruler, Trash2, Undo2, Plus, Check, Clock, Hammer, Truck, PackageCheck, ClipboardList, PenTool, Square, Phone, User, StickyNote, ChevronDown, ChevronUp, Layers, Box, DollarSign, GripVertical } from "lucide-react";
import * as THREE from "three";
import { storage } from "./lib/storage";

/* ---------------------------------- tokens ---------------------------------- */
const INK = "#0F3D5C";        // blueprint ink
const INK_DEEP = "#0A2B41";
const CHARCOAL = "#1C2126";
const PAPER = "#F4F2EA";
const STEEL = "#8A94A6";
const SAFETY = "#D9622B";
const AMBER = "#C68A2E";
const GREEN = "#4C7A4F";

const GAUGE_OPTIONS = [
  { id: "24ga", label: "24 Gauge", panelSqft: 3.75, trimFt: 2.75 },
  { id: "26ga", label: "26 Gauge", panelSqft: 3.00, trimFt: 2.20 },
];

const COPPER_WEIGHT_OPTIONS = [
  { id: "16oz", label: "16 oz Copper", panelSqft: 14.50, trimFt: 10.75 },
  { id: "20oz", label: "20 oz Copper", panelSqft: 17.75, trimFt: 13.25 },
];

const PAINT_OPTIONS = [
  { id: "pvdf", label: "PVDF (Kynar 500)", mult: 1.15 },
  { id: "smp", label: "SMP", mult: 1.0 },
];

const BRANDS = ["Fortified Metal", "McElroy", "Una-Clad", "Adax Metals", "Copper"];

const PROFILE_INFO = {
  'SS450 – 1.5" Snap-Lock': { code: "SS450", family: "snap", takeup: 4.5, desc: "Popular residential snap-lock; the clip flares over the male leg." },
  'SS150 – 1.5" Mechanical Seam': { code: "SS150", family: "mech", takeup: 4.5, desc: "Taller mechanical seam for added rigidity on architectural runs." },
  'SSQ200 – 2" Mechanical Seam': { code: "SSQ200", family: "mech", takeup: 6, desc: "Commercial workhorse mechanical seam, rated for open-purlin spans down to 2:12 slope." },
  'SSQ675 – 1.75" Snap-Lock': { code: "SSQ675", family: "snap", takeup: 4.375, desc: "Taller snap-lock profile for a more pronounced seam line." },
  'FWQ100 – 1" Flush Wall / Soffit': { code: "FWQ100", family: "flush", takeup: 4, desc: "Flat panel with adjustable reveal for soffits, fascia, underdeck, and flush wall siding." },
  "BB750 – Board and Batten": { code: "BB750", family: "batten", takeup: 4, desc: "Vertical board-and-batten wall siding profile with a farmhouse look." },
  'SS100 – 1" Mechanical Seam': { code: "SS100", family: "mech", takeup: 3, desc: "Low-profile double-lock mechanical seam. 28–22 ga. steel, aluminum, or copper." },
  'SSQ210A – 2" ARMCO Mechanical Seam': { code: "SSQ210A", family: "mecharmco", takeup: 6.5, desc: "SSQ200 seam plus an extra down leg for added strength in high-wind, severe-weather markets." },
  'SSQ550 – 1.5" Snap-Lock': { code: "SSQ550", family: "snap", takeup: 4.5, desc: "1.5\" snap-lock, alternate roller set." },
  'TRQ250 – 2.5" Mechanical Seam Trapezoid': { code: "TRQ250", family: "trapezoid", takeup: 7.5, desc: "Tallest seam in the lineup, with an anti-capillary leg for commercial/industrial roofs." },
  'SS450SL – 1.5" Snap-Lock': { code: "SS450SL", family: "snapbump", takeup: 4.5, desc: "Same profile as SS450 with a self-locking bump on the male leg." },
  'FF100 – 1" Snap-Lock, Slotted Flange': { code: "FF100", family: "flange", takeup: 3, desc: "Fastened through a flange on the male leg, then the female leg snaps over it — no clips." },
  'FF150 – 1.5" Snap-Lock, Slotted Flange': { code: "FF150", family: "flange", takeup: 4.5, desc: "Taller fastener-flange snap-lock, no clips required." },
  'SSQ275 – 2" Snap-Lock / Mech. Seam': { code: "SSQ275", family: "newlock", takeup: 6, desc: "Proprietary two-in-one profile — install as snap-lock, seam it later if the job calls for it." },
};
const PROFILES = Object.keys(PROFILE_INFO);

function profileFamily(profile) {
  return PROFILE_INFO[profile]?.family || "mech";
}
function profileSearchUrl(profile) {
  const code = PROFILE_INFO[profile]?.code || profile;
  return `https://newtechmachinery.com/?s=${encodeURIComponent(code)}`;
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
  McElroy: [
    { name: "Adobe Red", hex: "#A24C3D" },
    { name: "Alamo White", hex: "#EDEAE0" },
    { name: "Almond", hex: "#D9C9A8" },
    { name: "Antique Brown", hex: "#6B4A34" },
    { name: "Arctic Grey", hex: "#B8BCC0" },
    { name: "Ash Gray", hex: "#8D9096" },
    { name: "Autumn Red", hex: "#8B2E22" },
    { name: "Barkwood", hex: "#5A4A3A" },
    { name: "Blue Slate", hex: "#3A4A55" },
    { name: "Bone White", hex: "#EDE8DD" },
    { name: "Brandywine", hex: "#6E2F28" },
    { name: "Bravo Red", hex: "#9C2B24" },
    { name: "Brite Red", hex: "#B5262A" },
    { name: "Buckskin", hex: "#9C8060" },
    { name: "Camo Panel", hex: "#5C6644" },
    { name: "Cedar Shake", hex: "#8A6B4A" },
    { name: "Champagne Metallic", hex: "#C8B98A", premium: true },
    { name: "Charcoal", hex: "#4A4E52" },
    { name: "Charcoal Blend", hex: "#45494D" },
    { name: "Classic Cedar Shake", hex: "#7C5B3C" },
    { name: "Clay", hex: "#B98255" },
    { name: "Colonial Red", hex: "#7B2B25" },
    { name: "Copper Penny", hex: "#A05A3A", premium: true },
    { name: "COR-TEN AZP Raw", hex: "#8C5A3C" },
    { name: "Coral Blue", hex: "#4A7A8C" },
    { name: "Cotillion White", hex: "#EFEDE6" },
    { name: "Dark Bronze", hex: "#4A3B2E" },
    { name: "Ebony", hex: "#232323" },
    { name: "Estate Grey", hex: "#6E6C68" },
    { name: "Evergreen", hex: "#2F4B3C" },
    { name: "Forest Green", hex: "#33513F" },
    { name: "Gallery Blue", hex: "#3E6E8C" },
    { name: "Galvalume Plus", hex: "#A8ADB4" },
    { name: "Gray Slate", hex: "#5C6268" },
    { name: "Green Slate", hex: "#4A5C4E" },
    { name: "Hartford Green", hex: "#1F3D2B" },
    { name: "Hemlock Green", hex: "#445940" },
    { name: "Heritage Green", hex: "#35503D" },
    { name: "Homestead Brown", hex: "#5E4530" },
    { name: "Ivory", hex: "#EDE6D3" },
    { name: "Keystone Gray", hex: "#7A7D80" },
    { name: "Leadcoat", hex: "#6E7276" },
    { name: "Lightstone", hex: "#C9BFA8" },
    { name: "Linen", hex: "#E7E1D3" },
    { name: "Manor Gray", hex: "#6C6F73" },
    { name: "Mansard Brown", hex: "#4A3826" },
    { name: "Matte Black", hex: "#2B2B2B" },
    { name: "Meadow Green", hex: "#5C7A4A" },
    { name: "Medium Bronze", hex: "#5C4A38" },
    { name: "Mission Clay", hex: "#A8623E" },
    { name: "Morocco Red", hex: "#8C2E22" },
    { name: "Mossy Oak Camo", hex: "#5A5A3E" },
    { name: "New Penny", hex: "#B5622F" },
    { name: "Oakwood", hex: "#7A5C3E" },
    { name: "Patina Green", hex: "#5C8264" },
    { name: "Patrician Bronze", hex: "#5C4630" },
    { name: "Pewter Gray", hex: "#7C7F82" },
    { name: "Ponderosa", hex: "#6E5138" },
    { name: "Preweathered Galvalume", hex: "#9B9E9E" },
    { name: "Ranchwood Brown", hex: "#6B4E36" },
    { name: "Red Slate", hex: "#7A3A34" },
    { name: "Regal Blue", hex: "#2E4A66" },
    { name: "Regal White", hex: "#EDEAE1" },
    { name: "Roman Blue", hex: "#35506B" },
    { name: "Sandstone", hex: "#C2A97E" },
    { name: "Seasoned Cedar Shake", hex: "#7E6244" },
    { name: "Sepia Brown", hex: "#5A4632" },
    { name: "Silver Metallic", hex: "#B7BABD", premium: true },
    { name: "Slate Gray", hex: "#616669" },
    { name: "Spanish Tile Red", hex: "#9C3C2C" },
    { name: "Surrey Beige", hex: "#C7B896" },
    { name: "Taupe", hex: "#8C7B65" },
    { name: "Terra Cotta", hex: "#B5623E" },
    { name: "Terratone", hex: "#8C6B4A" },
    { name: "Texas Silver Metallic", hex: "#B0B4B7", premium: true },
    { name: "Timber Tan", hex: "#B79A6E" },
    { name: "Tudor Brown", hex: "#4E3A28" },
    { name: "Weathered Galvalume", hex: "#9C9C94" },
    { name: "Weathered Wood", hex: "#7A6A54" },
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
    { name: "Bright Copper (Polished)", hex: "#D2895A" },
    { name: "Statuary Bronze Copper", hex: "#5C4326", premium: true },
    { name: "Pre-Weathered Copper (Light Patina)", hex: "#8C7256", premium: true },
    { name: "Pre-Weathered Copper (Medium Patina)", hex: "#6E8C7A", premium: true },
    { name: "Pre-Patina Copper (Verdigris Green)", hex: "#4A8C72", premium: true },
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
const ACCESSORY_SPECS = {
  Screws: ['1" XLP Screws', "DP1 Screws", "DP3 Screws"],
  "Butyl Tape": ['3/8" Butyl Tape', '1" Butyl Tape'],
  "Pipe Boots": ['1"', '1.5"', '2"', '3"', '4"', '5"', '6"', '7"', '8"'],
};
const STATUS_ICON = { Pending: Clock, "In Production": Hammer, "Ready for Pickup": PackageCheck, Completed: Truck };
const STATUS_COLOR = { Pending: STEEL, "In Production": AMBER, "Ready for Pickup": INK, Completed: GREEN };

const SCALE = 13; // px per inch on the drawing canvas
const VB_W = 416, VB_H = 220; // inches shown: 32 x ~17

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

function findColor(name, brand) {
  const preferred = COLORS_BY_BRAND[brand]?.find((c) => c.name === name);
  if (preferred) return preferred;
  for (const list of Object.values(COLORS_BY_BRAND)) {
    const hit = list.find((c) => c.name === name);
    if (hit) return hit;
  }
  return null;
}

/* ---------------------------------- pricing ---------------------------------- */
function computePrice(order) {
  const gauge = GAUGE_OPTIONS.find((g) => g.id === order.gaugeId) || COPPER_WEIGHT_OPTIONS.find((g) => g.id === order.gaugeId) || GAUGE_OPTIONS[0];
  const paint = order.brand === "Copper" ? { mult: 1 } : (PAINT_OPTIONS.find((p) => p.id === order.paintId) || PAINT_OPTIONS[0]);
  const colorObj = findColor(order.colorName, order.brand);
  const premiumMult = colorObj?.premium ? 1.12 : 1;
  if (order.type === "metal") {
    const flatSqft = ((order.flatWidth || 0) * (order.flatLength || 0)) / 144;
    const coilSqft = ((order.coilWidth || 0) * (order.coilLength || 0)) / 144;
    const base = (flatSqft + coilSqft) * gauge.panelSqft * paint.mult * order.quantity;
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
    const formingFee = 12; // per-piece fee for the extra seams/folds vs a flat panel
    const base = sqft * gauge.panelSqft * paint.mult * order.quantity + formingFee * order.quantity;
    return Math.max(20, base * premiumMult + 20);
  } else if (order.type === "panel") {
    const sqft = (order.width * order.height) / 144;
    const base = sqft * gauge.panelSqft * paint.mult * order.quantity;
    return Math.max(15, base * premiumMult + 15);
  } else {
    const points = order.points || [];
    const bends = Math.max(0, points.length - 2);
    const totalFt = order.lengthPerPiece * order.quantity;
    const base = (totalFt * gauge.trimFt * paint.mult) + bends * 2 * order.quantity;
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

function TrimCanvas({ points, setPoints, colorHex, hemStart, hemEnd, paintSide }) {
  const svgRef = useRef(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [zoom, setZoom] = useState(0.35); // 4 zoom-in clicks (0.2 each) from the standard 1.0, clamped at the 0.35 floor
  const [zoomCenter, setZoomCenter] = useState(null); // [x,y] override when zoomed into a specific leg
  const [mode, setMode] = useState("draw"); // "draw" | "select"
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [gridSpacing, setGridSpacing] = useState(6); // inches between dots
  const [angleVisibility, setAngleVisibility] = useState("all"); // "all" | "hide90" | "hideAll"
  const [showSettings, setShowSettings] = useState(false);

  const toUser = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM().inverse();
    const loc = pt.matrixTransform(ctm);
    return [snap(loc.x), snap(loc.y)];
  }, []);

  const handleBgDown = (e) => {
    if (dragIdx !== null) return;
    if (mode === "select") { setSelectedIdx(null); return; }
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
    const input = window.prompt('Exact length for this segment (inches):', current.toFixed(2));
    if (input === null) return;
    const val = parseFloat(input);
    if (!isFinite(val) || val <= 0) return;
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

  const handlePointDown = (i) => (e) => {
    e.stopPropagation();
    e.target.setPointerCapture?.(e.pointerId);
    setDragIdx(i);
    setSelectedIdx(i);
  };

  const handleMove = (e) => {
    if (dragIdx === null) return;
    const [x, y] = toUser(e.clientX, e.clientY);
    setPoints((p) => p.map((pt, i) => (i === dragIdx ? [x, y] : pt)));
  };

  // Auto-fit & recenter the view around whatever has been drawn so far,
  // so the whole profile is always fully visible.
  const MIN_W = 14, MIN_H = 9, PAD = 2.5;
  const xs = points.length ? points.map((p) => p[0]) : [0];
  const ys = points.length ? points.map((p) => p[1]) : [0];
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
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
      gridDots.push(<circle key={`d${x}-${y}`} cx={x} cy={y} r={0.35 * unit} fill="rgba(255,255,255,0.25)" />);
    }
  }

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");

  return (
    <div style={{ position: "relative" }}>
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
        onPointerUp={() => setDragIdx(null)}
        style={{ width: "100%", height: "auto", aspectRatio: `${zVbW} / ${zVbH}`, background: INK, borderRadius: 4, touchAction: "none", cursor: mode === "select" ? "default" : "crosshair", display: "block" }}
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
              const label = `${dist(prev, p).toFixed(2)}"`;
              const fs = 3.4 * unit;
              const boxW = label.length * fs * 0.62 + fs * 0.9, boxH = fs * 1.6;
              return (
                <g
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => editSegmentLength(i)}
                  style={{ cursor: "pointer" }}
                >
                  <rect x={mx - boxW / 2} y={my - boxH / 2} width={boxW} height={boxH} rx={boxH / 2}
                    fill={SAFETY} stroke={INK} strokeWidth={0.3 * unit} />
                  <text x={mx} y={my} fill="#fff" fontSize={fs} fontWeight="700" fontFamily="'IBM Plex Mono', monospace"
                    textAnchor="middle" dominantBaseline="central">
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
                  <text x={lx} y={ly} fill={SAFETY} fontSize={fs} fontWeight="700" fontFamily="'IBM Plex Mono', monospace"
                    textAnchor="middle" dominantBaseline="central">
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
                      style={{ cursor: "grab" }}
                    />
                  ) : (
                    <circle
                      cx={p[0]} cy={p[1]} r={2.5 * unit}
                      fill={i === 0 ? SAFETY : "#fff"} stroke={INK_DEEP} strokeWidth={0.5 * unit}
                      onPointerDown={handlePointDown(i)}
                      style={{ cursor: "grab" }}
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
    <div>
      <div style={{ position: "relative" }}>
        <div ref={mountRef} style={{ width: "100%", height: 260, borderRadius: 6, overflow: "hidden" }} />
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
  const [tab, setTab] = useState("order");
  const [orders, setOrders] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [priceList, setPriceList] = useState([]);
  const [priceListLoaded, setPriceListLoaded] = useState(false);
  const [priceListView, setPriceListView] = useState("customer"); // "backend" | "customer"
  const [priceListTier, setPriceListTier] = useState("tier1"); // which tier the customer view shows
  const [materialCosts, setMaterialCosts] = useState([]);
  const [materialCostsLoaded, setMaterialCostsLoaded] = useState(false);
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
  const [height, setHeight] = useState(36);
  const [flatWidth, setFlatWidth] = useState(48);
  const [accType, setAccType] = useState("Screws");
  const [accSpec, setAccSpec] = useState(ACCESSORY_SPECS.Screws[0]);
  const [accProfile, setAccProfile] = useState(PROFILES[0]);
  const [accQty, setAccQty] = useState(1);
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
  const [coilWidth, setCoilWidth] = useState(24);
  const [sqftEditing, setSqftEditing] = useState(null);
  const [widthEditing, setWidthEditing] = useState(null);
  const [coilPricePerFt, setCoilPricePerFt] = useState(2.5);
  const [runLocation, setRunLocation] = useState("Shop");
  const [jobSiteAddress, setJobSiteAddress] = useState("");
  const [ribStyle, setRibStyle] = useState(null);
  const [clipRelief, setClipRelief] = useState(null);
  const [profile, setProfile] = useState(PROFILES[0]);

  useEffect(() => {
    const takeup = PROFILE_INFO[profile]?.takeup || 0;
    setWidth(Math.max(0, Math.round((coilWidth - takeup) * 100) / 100));
  }, [coilWidth, profile]);
  const [points, setPoints] = useState(TRIM_PRESETS["Eave"]);
  const [preset, setPreset] = useState("Eave");
  const [hemStart, setHemStart] = useState("none");
  const [hemEnd, setHemEnd] = useState("none");
  const [paintSide, setPaintSide] = useState("left");
  const [partName, setPartName] = useState("");
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
  const [expandedJobs, setExpandedJobs] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [basket, setBasket] = useState([]);
  const [tabLoaded, setTabLoaded] = useState(false);

  // Remember which section you were last on (personal, not shared — everyone gets their own).
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("last-tab", false);
        if (res?.value) setTab(res.value);
      } catch (e) { /* first time opening, no saved tab yet */ }
      setTabLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!tabLoaded) return; // don't overwrite the saved tab with the default before it's loaded
    storage.set("last-tab", tab, false).catch((e) => console.error("storage error", e));
  }, [tab, tabLoaded]);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("shop-orders", true);
        if (res?.value) setOrders(JSON.parse(res.value));
      } catch (e) { /* no orders yet */ }
      setLoaded(true);
    })();
  }, []);

  const saveOrders = async (next) => {
    setOrders(next);
    try { await storage.set("shop-orders", JSON.stringify(next), true); }
    catch (e) { console.error("storage error", e); }
  };

  const DEFAULT_PRICE_LIST = [
    // Roof Panel
    { id: "p1", category: "Roof Panel", name: '24 Gauge Panel (per linear ft)', derivedFromMaterialId: "m1", coverageWidth: 16, cost: 0, tier1: 4.10, tier2: 4.55, greenleaf: 3.95 },
    { id: "p2", category: "Roof Panel", name: '26 Gauge Panel (per linear ft)', cost: 0, tier1: 3.30, tier2: 3.65, greenleaf: 3.15 },
    { id: "p2b", category: "Roof Panel", name: "Flat Sheet 4' x 10' (per sheet)", cost: 0, tier1: 0, tier2: 0, greenleaf: 0 },
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
    try { await storage.set("shop-price-list", JSON.stringify(next), true); }
    catch (e) { console.error("storage error", e); }
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
      merged.price = computePrice(merged);
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
      merged.price = computePrice(merged);
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
        brand: "McElroy", ...trimColor("McElroy", "Charcoal"), status: "Pending", createdAt: daysAgo(1) }),
      mkTrim({ jobId: jobDave, partName: "Rake — West Gable", customerName: "Dave Rutherford", phone: "(817) 555-0142",
        points: TRIM_PRESETS["Rake"], quantity: 8, lengthPerPiece: 10, hemEnd: "open-right",
        brand: "McElroy", ...trimColor("McElroy", "Charcoal"), status: "Pending", createdAt: daysAgo(1) }),
      mkTrim({ jobId: jobDave, partName: "Ridge Cap — North Slope", customerName: "Dave Rutherford", phone: "(817) 555-0142",
        points: TRIM_PRESETS["Ridge Cap"], quantity: 4, lengthPerPiece: 10,
        brand: "McElroy", ...trimColor("McElroy", "Charcoal"), status: "Pending", createdAt: daysAgo(1) }),
      mkPanel({ jobId: jobDave, customerName: "Dave Rutherford", phone: "(817) 555-0142", profile: "SS150 – 1.5\" Mechanical Seam",
        width: 16, height: 216, quantity: 22,
        brand: "McElroy", ...trimColor("McElroy", "Charcoal"), status: "Pending", createdAt: daysAgo(1) }),

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
    await saveOrders([...samples, ...orders]);
    setToast(`Added ${samples.length} sample orders across 4 jobs to the Shop Floor.`);
    setTimeout(() => setToast(""), 4000);
  };

  const colorObj = findColor(colorName, brand);
  const handleBrandChange = (nextBrand) => {
    setBrand(nextBrand);
    setColorName(COLORS_BY_BRAND[nextBrand][0].name);
    setColorSearch("");
    if (nextBrand === "Copper") {
      setGaugeId(COPPER_WEIGHT_OPTIONS[0].id);
    } else if (brand === "Copper") {
      setGaugeId(GAUGE_OPTIONS[0].id);
    }
  };
  const draft = shapeType === "panel"
    ? { type: "panel", width, height, quantity, gaugeId, paintId, colorName }
    : shapeType === "metal"
    ? { type: "metal", flatWidth, flatLength, coilWidth: metalCoilWidth, coilLength: metalCoilLength, quantity, gaugeId, paintId, colorName }
    : shapeType === "part3d"
    ? { type: "part3d", partType, partW, partD, partH, partCapH, outletShape, flangeW, flangeD, outletDiameter, outletLength, topTrim, bodyTaper, taperStart, taperLength, flangeTapered, flangeLength, outletRoundTapered, capStyle, quantity, gaugeId, paintId, colorName }
    : { type: "trim", points, quantity, lengthPerPiece, gaugeId, paintId, colorName };
  const estimate = computePrice(draft);
  const girth = points.reduce((s, p, i) => s + (i > 0 ? dist(points[i - 1], p) : 0), 0);
  const partsPerSheet = girth > 0 ? Math.floor(sheetWidth / girth) : 0;
  const sheetsNeeded = partsPerSheet > 0 ? Math.ceil(quantity / partsPerSheet) : 0;
  const dropWidth = partsPerSheet > 0 ? Math.max(0, sheetWidth - partsPerSheet * girth) : sheetWidth;

  const resetForm = () => {
    setShapeType("panel"); setWidth(24); setHeight(36); setCoilWidth(24); setProfile(PROFILES[0]); setRunLocation("Shop"); setJobSiteAddress(""); setRibStyle(null); setClipRelief(null);
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
      girth, partsPerSheet, sheetsNeeded, dropWidth,
      gaugeId, paintId, brand, colorName, colorHex: colorObj.hex,
      price: computePrice({ type: "trim", points, quantity, lengthPerPiece, gaugeId, paintId, colorName }),
    };
    setBasket((b) => [...b, item]);
    clearDrawing();
    setToast(`"${item.name}" added to the order — ${basket.length + 1} part${basket.length + 1 === 1 ? "" : "s"} so far.`);
    setTimeout(() => setToast(""), 3000);
  };

  const removeBasketItem = (id) => setBasket((b) => b.filter((i) => i.id !== id));

  const addAccessory = () => {
    const qty = Math.max(1, +accQty || 1);
    let label = accSpec;
    if (accType === "Sealant") label = `Sealant — color-matched (${colorName})`;
    if (accType === "Clips") label = `Clips — ${accProfile}`;
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

  const nextPoNumber = () => {
    const distinctJobs = new Set(orders.map((o) => o.jobId).filter(Boolean));
    return `PO-${1000 + distinctJobs.size + 1}`;
  };

  const submitOrder = async () => {
    if (!customerName.trim()) { setToast("Add a name so the shop knows who this is for."); return; }
    if (shapeType === "panel") {
      if (ribStyle === null) { setToast("Pick a rib style (or None) before sending the order."); return; }
      if (clipRelief === null) { setToast("Choose whether Clip Relief is ON or OFF before sending the order."); return; }
    }

    if (shapeType === "trim") {
      const items = [...basket];
      if (points.length >= 2) {
        items.push({
          id: uid(), name: partName.trim() || `Part ${basket.length + 1}`,
          points, hemStart, hemEnd, paintSide, quantity, lengthPerPiece, sheetWidth,
          girth, partsPerSheet, sheetsNeeded, gaugeId, paintId, brand, colorName, colorHex: colorObj.hex,
        });
      }
      if (items.length === 0) { setToast("Draw at least two points, or add a part to the order first."); return; }
      setSubmitting(true);
      const jobId = uid();
      const poNumber = nextPoNumber();
      const newOrders = items.map((it) => {
        const order = {
          id: uid(),
          jobId,
          poNumber,
          type: "trim",
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
          notes: notes.trim(),
          status: "Pending",
          createdAt: new Date().toISOString(),
        };
        order.price = computePrice(order);
        return order;
      });
      await saveOrders([...newOrders, ...orders]);
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
      poNumber: nextPoNumber(),
      type: shapeType,
      customerName: customerName.trim(),
      phone: phone.trim(),
      profile: isMetal || isPart3d ? undefined : profile,
      width: isMetal || isPart3d ? undefined : width,
      height: isMetal || isPart3d ? undefined : height,
      flatWidth: isMetal ? flatWidth : undefined,
      flatLength: isMetal ? flatLength : undefined,
      coilWidth: isMetal ? metalCoilWidth : undefined,
      accessories: isMetal ? accessories : undefined,
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
    order.price = computePrice(order);
    await saveOrders([order, ...orders]);
    setSubmitting(false);
    setToast(`Order sent — estimate ${money(order.price)}. The shop will confirm final pricing.`);
    resetForm();
    setTimeout(() => setToast(""), 5000);
  };

  const updateStatus = async (id, status) => {
    await saveOrders(orders.map((o) => (o.id === id ? { ...o, status } : o)));
  };

  const updatePoNumber = async (jobKey, poNumber) => {
    await saveOrders(orders.map((o) => ((o.jobId || o.id) === jobKey ? { ...o, poNumber } : o)));
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
      `}</style>

      {/* header */}
      <div style={{ background: CHARCOAL, padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div className="disp" style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>Fortified Sheet Metal</div>
          <div className="mono" style={{ color: theme.textSecondary, fontSize: 11, marginTop: 2 }}>Custom Panels &amp; Trim — Shop Order Portal</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
        {[{ id: "order", label: "New Order", icon: PenTool }, { id: "dashboard", label: "Shop Floor", icon: ClipboardList }, { id: "pricelist", label: "Price List", icon: DollarSign }].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="disp"
              style={{
                flex: 1, padding: "12px 8px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                background: active ? theme.pageBg : "transparent", color: active ? theme.text : "#9AA5AD",
                border: "none", borderTopLeftRadius: active ? 10 : 0, borderTopRightRadius: active ? 10 : 0,
                fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {toast && (
        <div style={{ background: "#FFF3E4", borderBottom: `2px solid ${SAFETY}`, color: theme.text, padding: "10px 20px", fontSize: 13 }}>
          {toast}
        </div>
      )}

      {tab === "order" ? (
        <div style={{ padding: 16, maxWidth: 640, margin: "0 auto" }}>
          {/* shape type toggle */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[
              { id: "metal", label: "Order Metal", icon: Layers, accent: "#3E7CB1" },
              { id: "panel", label: "Roof Panel", icon: Square, accent: SAFETY },
              { id: "trim", label: "Trim Profile", icon: PenTool, accent: "#4F9A63" },
              { id: "part3d", label: "3D Parts", icon: Box, accent: "#8A5FBF" },
            ].map((s) => {
              const Icon = s.icon; const active = shapeType === s.id;
              return (
                <button key={s.id} onClick={() => setShapeType(s.id)} className="mac-btn"
                  style={{
                    flex: 1, padding: "11px 6px", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    border: `1px solid ${active ? s.accent : theme.border}`,
                    background: active
                      ? `linear-gradient(180deg, ${s.accent}, ${s.accent}dd)`
                      : (darkMode ? `linear-gradient(180deg, ${theme.inputBg}, ${theme.card})` : "linear-gradient(180deg, #ffffff, #f0eee6)"),
                    color: active ? "#fff" : theme.text,
                    fontWeight: 700, fontSize: 12.5, cursor: "pointer",
                    boxShadow: active ? `0 3px 8px ${s.accent}55, inset 0 1px 0 rgba(255,255,255,0.35)` : "0 1px 2px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.4)",
                  }}>
                  <Icon size={16} /> {s.label}
                </button>
              );
            })}
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

                <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 10 }}>
                  Raw material — no profile or trim shape. Gauge, paint, and color are set below in Finish Color.
                </div>

                <div className="disp" style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 14 }}>Accessories</div>
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
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

                <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "flex-end" }}>
                  {accType === "Sealant" ? (
                    <div style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                      Spec
                      <div className="mono" style={{ padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, background: theme.highlight }}>
                        Color-matched to {colorName}
                      </div>
                    </div>
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
                  <label style={{ width: 70, fontSize: 11, color: theme.textSecondary }}>
                    Qty
                    <input type="number" min={1} value={accQty}
                      onChange={(e) => setAccQty(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setAccQty(1); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                  <button type="button" onClick={addAccessory}
                    style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${SAFETY}`, background: theme.inputBg, color: SAFETY, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                    + Add
                  </button>
                </div>

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
                <label style={{ display: "block", fontSize: 11, color: theme.textSecondary, marginTop: 10 }}>
                  Panel profile
                  <select value={profile} onChange={(e) => setProfile(e.target.value)}
                    style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, background: theme.inputBg }}>
                    {PROFILES.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </label>

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
                      onBlur={(e) => { if (e.target.value === "") setHeight(36); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14 }} />
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Finished Sq Ft
                    <input type="number" min={0} step="0.01"
                      value={sqftEditing !== null ? sqftEditing : (isFinite((width * height) / 144) ? (+((width * height) / 144).toFixed(2)) : 0)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSqftEditing(val);
                        if (val !== "" && +width > 0) {
                          setHeight(Math.max(0, (+val * 144) / width));
                        }
                      }}
                      onBlur={(e) => { setSqftEditing(null); if (e.target.value === "") setHeight(36); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Coil Width (in)
                    <input type="number" min={1} value={coilWidth}
                      onChange={(e) => setCoilWidth(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setCoilWidth(24); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Pan Width (in)
                    <input type="number" min={0} step="0.01"
                      value={widthEditing !== null ? widthEditing : (isFinite(width) ? +Number(width).toFixed(2) : 0)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setWidthEditing(val);
                        if (val !== "") {
                          const newWidth = Math.max(0, +val);
                          const takeup = PROFILE_INFO[profile]?.takeup || 0;
                          setWidth(newWidth);
                          setCoilWidth(Math.max(0, Math.round((newWidth + takeup) * 100) / 100));
                        }
                      }}
                      onBlur={(e) => { setWidthEditing(null); if (e.target.value === "") setCoilWidth(24); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Coil $/Linear Ft
                    <input type="number" min={0} step="0.01" value={coilPricePerFt}
                      onChange={(e) => setCoilPricePerFt(e.target.value === "" ? "" : Math.max(0, +e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setCoilPricePerFt(2.5); }}
                      className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                    Total Price
                    <div className="mono" style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, background: theme.highlight, boxSizing: "border-box", color: theme.text, fontWeight: 600 }}>
                      {money((+coilPricePerFt || 0) * ((+height || 0) / 12))}
                    </div>
                  </label>
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
                  <label style={{ display: "block", fontSize: 11, color: theme.textSecondary, marginTop: 10 }}>
                    Job Site Address
                    <input value={jobSiteAddress} onChange={(e) => setJobSiteAddress(e.target.value)}
                      placeholder="Street address, city, state"
                      style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                  </label>
                )}
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                  {Object.keys(TRIM_PRESETS).map((p) => (
                    <button key={p} onClick={() => { setPreset(p); setPoints(TRIM_PRESETS[p].map((pt) => [...pt])); }}
                      style={{
                        padding: "5px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer",
                        border: `1px solid ${preset === p ? INK : "#D9D5C7"}`, background: preset === p ? INK : "#fff", color: preset === p ? "#fff" : INK_DEEP,
                      }}>
                      {p}
                    </button>
                  ))}
                </div>
                <TrimCanvas points={points} setPoints={setPoints} colorHex={colorObj.hex} hemStart={hemStart} hemEnd={hemEnd} paintSide={paintSide} />
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
                      const itGauge = GAUGE_OPTIONS.find((g) => g.id === it.gaugeId) || COPPER_WEIGHT_OPTIONS.find((g) => g.id === it.gaugeId);
                      const itBends = Math.max(0, it.points.length - 2);
                      return (
                        <div key={it.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 0", borderBottom: idx < basket.length - 1 ? "1px solid #F3F0E7" : "none" }}>
                          <div style={{ background: INK, borderRadius: 5, padding: 3, flexShrink: 0 }}>
                            <ShapeThumb order={{ type: "trim", points: it.points, colorHex: it.colorHex }} size={28} />
                          </div>
                          <span style={{ fontSize: 11.5, color: theme.text, flex: 1 }}>
                            <strong>{it.name}</strong> — Qty {it.quantity} · {it.girth.toFixed(2)}" girth · {it.sheetsNeeded} sheet{it.sheetsNeeded === 1 ? "" : "s"} · {it.dropWidth.toFixed(2)}" drop
                            <br />
                            <span style={{ fontSize: 10.5, color: theme.textSecondary }}>
                              {it.colorName} · {itGauge?.label} · {itBends} bend{itBends === 1 ? "" : "s"} · Paint side: {it.paintSide === "left" ? "Left" : "Right"}
                            </span>
                          </span>
                          <span className="mono" style={{ fontSize: 11, color: theme.textSecondary }}>{money(it.price)}</span>
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

          {/* color picker */}
          <div style={{ background: theme.card, borderRadius: 10, padding: 12, marginTop: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <div className="disp" style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 8 }}>Finish Color</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                Brand
                <select value={brand} onChange={(e) => handleBrandChange(e.target.value)}
                  style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, background: theme.inputBg }}>
                  {BRANDS.map((b) => <option key={b}>{b}</option>)}
                </select>
              </label>
              <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                {brand === "Copper" ? "Copper Weight" : "Gauge"}
                <select value={gaugeId} onChange={(e) => setGaugeId(e.target.value)}
                  style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, background: theme.inputBg }}>
                  {(brand === "Copper" ? COPPER_WEIGHT_OPTIONS : GAUGE_OPTIONS).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                </select>
              </label>
              {brand !== "Copper" && (
                <label style={{ flex: 1, fontSize: 11, color: theme.textSecondary }}>
                  Paint Type
                  <select value={paintId} onChange={(e) => setPaintId(e.target.value)}
                    style={{ width: "100%", padding: 8, marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, background: theme.inputBg }}>
                    {PAINT_OPTIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </label>
              )}
            </div>
            <input
              value={colorSearch}
              onChange={(e) => setColorSearch(e.target.value)}
              placeholder="Search colors…"
              style={{ width: "100%", padding: 8, marginBottom: 8, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 3.4, maxHeight: 260, overflowY: "auto", paddingRight: 2 }}>
              {COLORS_BY_BRAND[brand].filter((c) => c.name.toLowerCase().includes(colorSearch.toLowerCase())).map((c) => {
                const active = colorName === c.name;
                return (
                  <button key={c.name} onClick={() => setColorName(c.name)}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 1.7, padding: 2.8,
                      border: `2px solid ${active ? INK : "transparent"}`, borderRadius: 8, background: active ? "#F0EDE3" : "transparent", cursor: "pointer",
                    }}>
                    <span style={{ width: 22, height: 22, borderRadius: "50%", background: c.hex, border: "1px solid rgba(0,0,0,0.15)", position: "relative" }}>
                      {active && <Check size={12} color="#fff" style={{ position: "absolute", top: 4, left: 4, filter: "drop-shadow(0 0 1px #000)" }} />}
                    </span>
                    <span style={{ fontSize: 8.5, textAlign: "center", lineHeight: 1.15, color: theme.text }}>{c.name}{c.premium && " *"}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 10, color: theme.textSecondary, marginTop: 8 }}>* Premium/metallic finish, +12%. Screen colors are approximate — confirm with a physical chip before ordering.</div>
          </div>

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
              <div className="mono" style={{ color: "#fff", fontSize: 22, fontWeight: 600 }}>{money(combinedEstimate)}</div>
            </div>
            <button onClick={submitOrder} disabled={submitting}
              className="disp"
              style={{
                background: SAFETY, color: "#fff", border: "none", padding: "12px 20px", borderRadius: 8,
                fontSize: 13, fontWeight: 700, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1,
              }}>
              {submitting ? "Sending…" : "Send Order"}
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 8, textAlign: "center" }}>
            Estimate only — final pricing confirmed by the shop. Orders are visible to shop staff.
          </div>
        </div>
      ) : tab === "pricelist" ? (
        <div style={{ padding: 16, maxWidth: 640, margin: "0 auto" }}>
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

          {!priceListLoaded ? (
            <div style={{ color: theme.textSecondary, fontSize: 13, textAlign: "center", padding: 40 }}>Loading price list…</div>
          ) : priceListView === "backend" ? (
            <>
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
                          className="mono" style={{ width: "100%", padding: 5, marginTop: 3, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 12, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                        <div className="mono" style={{ fontSize: 8.5, color: theme.textSecondary, marginTop: 3, textAlign: "center" }}>
                          {m.lastUpdated || "never"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                            className="mono" style={{ width: "100%", padding: 5, marginTop: 2, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 12, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                        </label>
                        <label style={{ flex: 1, fontSize: 9, color: theme.textSecondary }}>
                          Margin (%)
                          <input type="text" inputMode="decimal" value={draftValue(`plm-${p.id}-${key}`, marginOf(p[key]).toFixed(1))}
                            onChange={(e) => setDraft(`plm-${p.id}-${key}`, e.target.value)}
                            onBlur={() => commitDraft(`plm-${p.id}-${key}`, marginOf(p[key]), (v) => updatePriceListItem(p.id, key, +priceFromMargin(v).toFixed(2)))}
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
                              className="mono" style={{ width: "100%", padding: 5, marginTop: 2, border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 12, background: theme.inputBg, color: theme.text, boxSizing: "border-box" }} />
                          )}
                        </label>
                        {tierRow("tier1", "Tier 1")}
                        {tierRow("tier2", "Tier 2")}
                        {tierRow("greenleaf", "Greenleaf")}
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
      ) : (
        <div style={{ padding: 16, maxWidth: 640, margin: "0 auto" }}>
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

                      {isOpen && group.items.map((o, idx) => {
                        const gauge = GAUGE_OPTIONS.find((g) => g.id === o.gaugeId) || COPPER_WEIGHT_OPTIONS.find((g) => g.id === o.gaugeId);
                        const paint = PAINT_OPTIONS.find((p) => p.id === o.paintId);
                        const StatusIcon = STATUS_ICON[o.status];
                        return (
                          <div key={o.id} style={{ display: "flex", gap: 10, marginTop: 10, paddingTop: 10, borderTop: "1px solid #F0EDE3" }}>
                            <div style={{ background: INK, borderRadius: 8, padding: 6, flexShrink: 0 }}>
                              <ShapeThumb order={o} size={52} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                                {o.partName && <div style={{ fontSize: 12, color: SAFETY, fontWeight: 600 }}>{o.partName}</div>}
                                <div className="mono" style={{ fontWeight: 600, fontSize: 13, color: theme.text, whiteSpace: "nowrap" }}>{money(o.price)}</div>
                              </div>
                              <div style={{ fontSize: 11.5, color: theme.text, marginTop: 2 }}>
                                {o.type === "panel"
                                  ? `${o.width}" × ${o.height}" panel — ${o.profile}`
                                  : o.type === "metal"
                                  ? `Flat ${o.flatWidth}" × ${(o.flatLength / 12).toFixed(1)}' + Coil ${o.coilWidth}" × ${(o.coilLength / 12).toFixed(0)}'`
                                  : o.type === "part3d"
                                  ? `${PART3D_LABELS[o.partType] || o.partType}${o.capStyle ? ` (${CAP_STYLE_LABELS[o.capStyle] || o.capStyle})` : ""} — ${o.partW}"W × ${o.partD}"D × ${o.partH}"H${o.partType === "chimney" ? ` (cap ${o.partCapH}")` : ""}`
                                  : `Trim profile — ${o.lengthPerPiece} ft/pc`} · Qty {o.quantity}
                              </div>
                              {o.type === "panel" && o.runLocation && (
                                <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 1 }}>
                                  Run at: {o.runLocation}
                                  {o.ribStyle && o.ribStyle !== "none" && ` · ${RIB_LABELS[o.ribStyle] || o.ribStyle}`}
                                  {o.clipRelief && " · Clip Relief"}
                                </div>
                              )}
                              {o.type === "metal" && o.accessories && o.accessories.length > 0 && (
                                <div style={{ fontSize: 10.5, color: theme.textSecondary, marginTop: 2 }}>
                                  Accessories: {o.accessories.map((a) => `${a.label} ×${a.qty}`).join(", ")}
                                </div>
                              )}
                              {o.type === "panel" && o.runLocation === "Job Site" && o.jobSiteAddress && (
                                <div style={{ fontSize: 10.5, color: SAFETY, marginTop: 1 }}>
                                  📍 {o.jobSiteAddress}
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
        </div>
      )}
    </div>
  );
}
