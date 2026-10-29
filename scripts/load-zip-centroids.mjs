// Loads public.zip_centroids (Phase 3 migration M1) from the Census Bureau's 2020 Gazetteer
// ZCTA file: one row per 5-digit ZIP with its internal point, about 33,800 rows, public domain.
// nearest_ordering_shops and set_my_zip read it; it is too large for a migration file, so it is
// loaded once, by this script, with the service key (the table has no API-role grants).
//
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/load-zip-centroids.mjs [--file <.zip or .txt>] [--dry-run]
//
// Without --file it downloads the national file from census.gov. --dry-run parses and prints the
// row count and the first three rows, writes nothing and needs no key. Rows are upserted on zip in
// batches of 1000, so a rerun refreshes the table instead of failing. The download is only ever
// parsed as text, never run. Any failure exits non-zero.
//
// Node 18 or later; no dependencies (the zip is read with a minimal reader over node:zlib).
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const SOURCE = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip";
const SUPA = process.env.SUPABASE_URL ?? "https://znueitseoqijhkkvdomc.supabase.co";
const BATCH = 1000;
const USAGE = "usage: SUPABASE_SERVICE_ROLE_KEY=… node scripts/load-zip-centroids.mjs [--file <path to .zip or .txt>] [--dry-run]";

function fail(msg) {
  console.error(`load-zip-centroids: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { file: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--file") out.file = argv[++i] ?? fail(USAGE);
    else if (a.startsWith("--file=")) out.file = a.slice("--file=".length);
    else fail(`unknown argument ${a}\n${USAGE}`);
  }
  if (out.file === "") fail(USAGE);
  return out;
}

// The one .txt entry of a zip archive, from its central directory: the local headers' sizes may
// be zero when the archive was written with data descriptors, the central directory's never are.
// Stored and deflated entries only; no zip64 (the Census file is about 1 MB).
function txtFromZip(buf) {
  const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end of central directory)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff || count === 0xffff) throw new Error("zip64 archives are not supported");
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CEN) throw new Error("corrupt zip central directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.push({ name, method, csize, usize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const txt = entries.filter((e) => /\.txt$/i.test(e.name) && !e.name.endsWith("/"));
  if (txt.length !== 1) throw new Error(`expected one .txt entry in the zip, found ${txt.length} (${entries.map((e) => e.name).join(", ")})`);
  const e = txt[0];
  if (buf.readUInt32LE(e.local) !== LOC) throw new Error("corrupt zip local header");
  const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
  const data = buf.subarray(start, start + e.csize);
  let out;
  if (e.method === 0) out = data;
  else if (e.method === 8) out = inflateRawSync(data);
  else throw new Error(`unsupported zip compression method ${e.method}`);
  if (out.length !== e.usize) throw new Error(`zip entry ${e.name}: expected ${e.usize} bytes, got ${out.length}`);
  return out.toString("utf8");
}

// Tab-separated with a header row (GEOID … INTPTLAT INTPTLONG; the last header carries trailing
// spaces in the 2020 file). Keeps 5-digit GEOIDs with finite coordinates, one row per ZIP.
function parseGazetteer(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const header = lines[0].split("\t").map((h) => h.trim().toUpperCase());
  const gi = header.indexOf("GEOID"), lai = header.indexOf("INTPTLAT"), loi = header.indexOf("INTPTLONG");
  if (gi < 0 || lai < 0 || loi < 0) throw new Error(`unexpected header: ${lines[0].slice(0, 200)}`);
  const rows = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = lines[i].split("\t");
    const zip = (c[gi] ?? "").trim();
    const lat = Number((c[lai] ?? "").trim());
    const lng = Number((c[loi] ?? "").trim());
    if (/^\d{5}$/.test(zip) && Number.isFinite(lat) && Number.isFinite(lng) && (c[lai] ?? "").trim() !== "" && (c[loi] ?? "").trim() !== "") {
      rows.set(zip, { zip, lat, lng });
    }
  }
  return [...rows.values()];
}

async function load(file) {
  let buf;
  if (file) {
    buf = readFileSync(file);
  } else {
    console.log(`load-zip-centroids: downloading ${SOURCE}`);
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  // a zip starts with a local file header ("PK\x03\x04"); anything else is read as the .txt itself
  const isZip = buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
  return isZip ? txtFromZip(buf) : buf.toString("utf8");
}

async function upsert(rows, key) {
  const url = `${SUPA}/rest/v1/zip_centroids?on_conflict=zip`;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`upsert of rows ${i + 1}–${i + batch.length} failed: HTTP ${res.status} ${detail}`);
    }
    console.log(`load-zip-centroids: ${Math.min(i + BATCH, rows.length)} / ${rows.length}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!args.dryRun && !key) fail(`set SUPABASE_SERVICE_ROLE_KEY in the environment (or pass --dry-run)\n${USAGE}`);

try {
  const rows = parseGazetteer(await load(args.file));
  if (!rows.length) throw new Error("no ZIP rows found");
  console.log(`load-zip-centroids: ${rows.length} ZIP rows parsed`);
  if (args.dryRun) {
    for (const r of rows.slice(0, 3)) console.log(`  ${r.zip}\t${r.lat}\t${r.lng}`);
    console.log("load-zip-centroids: dry run, nothing written");
  } else {
    await upsert(rows, key);
    console.log(`load-zip-centroids: ${rows.length} rows upserted into zip_centroids`);
  }
} catch (e) {
  fail(e.message);
}
