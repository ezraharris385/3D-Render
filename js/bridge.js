/* =========================================================
   Engine bridge — shared project store between Studio and
   Atlas. Projects are saved in full Studio fidelity; Atlas
   consumes a massing view (footprint + height + color).
   ========================================================= */
import { totalHeight } from "../lab/js/state.js";

const LIB_KEY = "engine-projects-v1";
const SITES_KEY = "engine-sites-v1";

export const MAT_COLORS = {
  brick: "#9d5b40", cmu: "#9a958c", concrete: "#b9bcbe", metal: "#98a3ad",
  curtainwall: "#7ba0b5", eifs: "#cfc7b4", siding: "#8d99a5",
};

let liveGetter = null;
const listeners = new Set();

export function registerLive(fn) { liveGetter = fn; }
export function getLiveBuildings() {
  return liveGetter ? liveGetter() : [];
}

export function onProjectsChanged(cb) { listeners.add(cb); }
function emit() { for (const cb of listeners) cb(); }

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch (e) { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* non-fatal */ }
}

/* ---------------- project library (full Studio data) ---------------- */
export function listProjects() {
  const arr = read(LIB_KEY, []);
  return Array.isArray(arr) ? arr : [];
}
export function saveProject(name, buildings) {
  const lib = listProjects().filter(p => p.name !== name);
  lib.unshift({ name, buildings: JSON.parse(JSON.stringify(buildings)), savedAt: Date.now() });
  write(LIB_KEY, lib.slice(0, 40));
  emit();
}
export function deleteProject(name) {
  write(LIB_KEY, listProjects().filter(p => p.name !== name));
  emit();
}

/* Massing view for the map: footprint + overall height + material color.
   x east / z south in the studio ground plane, rot deg CW from north. */
export function massing(buildings) {
  return (buildings || []).map(b => ({
    name: b.name,
    w: b.plan.w, d: b.plan.d,
    x: b.x, z: b.z, rot: b.rot || 0,
    h: totalHeight(b),
    color: MAT_COLORS[b.material] || "#9aa7b4",
  }));
}

/* ---------------- shared geodesy (Atlas + Earth) ---------------- */
export function wrapLng(lng) { return ((lng % 360) + 540) % 360 - 180; }
export function metersPerDegree(lat) {
  const p = lat * Math.PI / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lng: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p),
  };
}
export function siteToLngLat(x, z, site) {
  const th = site.rot * Math.PI / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const east = x * c + (-z) * s;
  const north = -x * s + (-z) * c;
  const m = metersPerDegree(site.lat);
  return [wrapLng(site.lng + east / m.lng), site.lat + north / m.lat];
}
/* per-building footprint rings (lng/lat, closed) for a placed site */
export function siteBuildingRings(site) {
  return site.buildings.map(bd => {
    const th = bd.rot * Math.PI / 180;
    const c = Math.cos(th), s = Math.sin(th);
    const ring = [[-bd.w / 2, -bd.d / 2], [bd.w / 2, -bd.d / 2], [bd.w / 2, bd.d / 2], [-bd.w / 2, bd.d / 2]]
      .map(([lx, lz]) => siteToLngLat(bd.x + lx * c - lz * s, bd.z + lx * s + lz * c, site));
    ring.push(ring[0]);
    return { ring, h: bd.h, color: bd.color, name: bd.name };
  });
}

/* ---------------- user catalog (presets / sizes / types / brands) ----------------
   One shared store the whole system adapts to. Rows (meters):
   { kind: 'equipment'|'opening'|'preset', name, brand, type,
     w, d, h, sill, color, stories, floorH, parapet, material } */
const CATALOG_KEY = "engine-catalog-v1";
const catalogListeners = new Set();
export function onCatalogChanged(cb) { catalogListeners.add(cb); }
function emitCatalog() { for (const cb of catalogListeners) cb(); }

export function getCatalog() {
  const arr = read(CATALOG_KEY, []);
  return Array.isArray(arr) ? arr : [];
}
export function setCatalog(rows) { write(CATALOG_KEY, rows); emitCatalog(); }
export function removeCatalogRow(idx) {
  const rows = getCatalog();
  rows.splice(idx, 1);
  setCatalog(rows);
}

/* RFC 4180-ish CSV parser (quoted fields, "" escapes, newlines in quotes) */
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some(c => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(c => c !== "")) rows.push(row);
  return rows;
}

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const OPENING_ALIAS = {
  "fixed": "fixed", "window": "fixed", "picture": "picture", "double-hung": "double-hung",
  "doublehung": "double-hung", "sliding": "sliding", "slider": "sliding",
  "storefront": "storefront", "ribbon": "ribbon", "glass-door": "glass-door",
  "entry": "glass-door", "door": "man-door", "man-door": "man-door", "mandoor": "man-door",
  "overhead": "overhead", "garage": "overhead", "dock": "dock",
};

/* Import catalog rows from CSV text. Dimensions in `units` ('ft'|'m').
   Columns (any order, case-insensitive): kind, name, brand, type,
   width, depth, height, sill, color, stories, floorheight, parapet, material. */
export function importCatalogCSV(text, units = "ft") {
  const F = units === "ft" ? 0.3048 : 1;
  const rows = parseCSV(text);
  if (rows.length < 2) return { added: 0, skipped: 0 };
  const header = rows[0].map(h => h.toLowerCase().replace(/[^a-z]/g, ""));
  const col = n => header.indexOf(n);
  const idx = {
    kind: col("kind"), name: col("name"), brand: col("brand"), type: col("type"),
    w: col("width"), d: col("depth"), h: col("height"), sill: col("sill"),
    color: col("color"), stories: col("stories"), floorH: col("floorheight"),
    parapet: col("parapet"), material: col("material"),
  };
  const out = getCatalog();
  let added = 0, skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i];
    const get = k => idx[k] >= 0 && idx[k] < c.length ? c[idx[k]] : "";
    const num = k => { const v = parseFloat(get(k)); return Number.isFinite(v) && v > 0 ? v * F : null; };
    const kind = (get("kind") || "equipment").toLowerCase();
    const name = get("name");
    if (!name) { skipped++; continue; }
    const entry = {
      kind, name,
      brand: get("brand") || "",
      type: get("type") || "",
      color: COLOR_RE.test(get("color")) ? get("color") : "#8fa3b8",
    };
    if (kind === "equipment") {
      entry.w = num("w"); entry.d = num("d"); entry.h = num("h");
      if (!(entry.w && entry.d && entry.h)) { skipped++; continue; }
    } else if (kind === "opening") {
      entry.baseType = OPENING_ALIAS[(get("type") || "window").toLowerCase()] || "fixed";
      entry.w = num("w"); entry.h = num("h");
      entry.sill = (() => { const v = parseFloat(get("sill")); return Number.isFinite(v) && v >= 0 ? v * F : null; })();
      if (!(entry.w && entry.h)) { skipped++; continue; }
    } else if (kind === "preset") {
      entry.w = num("w"); entry.d = num("d");
      const st = parseInt(get("stories"), 10);
      entry.stories = Number.isFinite(st) && st >= 1 ? st : 1;
      entry.floorH = num("floorH") || (14 * 0.3048);
      const pp = parseFloat(get("parapet"));
      entry.parapet = Number.isFinite(pp) && pp >= 0 ? pp * F : 0.9144;
      entry.material = (get("material") || "concrete").toLowerCase();
      if (!(entry.w && entry.d)) { skipped++; continue; }
    } else { skipped++; continue; }
    out.push(entry);
    added++;
  }
  if (added) setCatalog(out);
  return { added, skipped };
}

/* ---------------- API keys ---------------- */
const KEYS_KEY = "engine-keys-v1";
export function getKeys() { return read(KEYS_KEY, {}); }
export function setKeys(patch) { write(KEYS_KEY, { ...getKeys(), ...patch }); }

/* ---------------- placed sites (Atlas) ---------------- */
export function getSites() {
  const arr = read(SITES_KEY, []);
  return Array.isArray(arr) ? arr : [];
}
export function setSites(sites) {
  write(SITES_KEY, sites);
}
