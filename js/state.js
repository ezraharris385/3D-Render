/* =========================================================
   3D Site Lab — shared state, units, geodesy, persistence.
   All stored dimensions/positions are METERS.
   Site-plane coordinates: x = east, z = south (three.js);
   north offset = -z. Rotations are degrees clockwise from
   north as seen in top view.
   ========================================================= */

export const FT = 0.3048;
export const STORAGE_KEY = "site-lab-v1";
export const DEFAULT_CENTER = [-89.4012, 43.0731]; // Madison, WI

export const UTILITY_TYPES = {
  electric: { label: "Electric", color: "#f2c744" },
  water:    { label: "Water",    color: "#4da3ff" },
  gas:      { label: "Gas",      color: "#ff8b5e" },
  sewer:    { label: "Sewer",    color: "#a97142" },
  data:     { label: "Data",     color: "#9a8cff" },
  steam:    { label: "Steam",    color: "#c0c8d0" },
};

export const SHAPES = {
  "box":   { label: "Box / Building",    dims: ["w", "d", "h"] },
  "cyl-v": { label: "Vertical cylinder", dims: ["dia", "h"] },
  "cyl-h": { label: "Horizontal cylinder", dims: ["dia", "len"] },
  "silo":  { label: "Silo (cone roof)",  dims: ["dia", "h"] },
  "sphere":{ label: "Sphere",            dims: ["dia"] },
};
export const DIM_LABELS = { w: "Width", d: "Depth", h: "Height", dia: "Diameter", len: "Length" };

/* Built-in commercial equipment templates (dims in meters) */
export const BUILTIN_CATALOG = [
  { id: "t-vtank",  name: "Vertical Tank",     shape: "cyl-v",  dims: { dia: 12 * FT, h: 24 * FT },        color: "#4da3ff" },
  { id: "t-htank",  name: "Horizontal Tank",   shape: "cyl-h",  dims: { dia: 8 * FT, len: 20 * FT },       color: "#5ad7d2" },
  { id: "t-silo",   name: "Silo",              shape: "silo",   dims: { dia: 14 * FT, h: 40 * FT },        color: "#d7dde3" },
  { id: "t-sphere", name: "Sphere Tank",       shape: "sphere", dims: { dia: 16 * FT },                    color: "#9a8cff" },
  { id: "t-cont",   name: "Shipping Container",shape: "box",    dims: { w: 40 * FT, d: 8 * FT, h: 8.5 * FT }, color: "#e4b34a" },
  { id: "t-rtu",    name: "RTU / HVAC Unit",   shape: "box",    dims: { w: 10 * FT, d: 6 * FT, h: 4 * FT },   color: "#8fa3b8" },
  { id: "t-xfmr",   name: "Transformer",       shape: "box",    dims: { w: 8 * FT, d: 6 * FT, h: 7 * FT },    color: "#7bd88f" },
  { id: "t-gen",    name: "Generator",         shape: "box",    dims: { w: 12 * FT, d: 5 * FT, h: 8 * FT },   color: "#ff8b5e" },
  { id: "t-ctower", name: "Cooling Tower",     shape: "box",    dims: { w: 12 * FT, d: 12 * FT, h: 14 * FT }, color: "#e97fd0" },
  { id: "t-whse",   name: "Warehouse",         shape: "box",    dims: { w: 100 * FT, d: 60 * FT, h: 24 * FT }, color: "#caa24b" },
  { id: "t-rack",   name: "Pipe Rack",         shape: "box",    dims: { w: 40 * FT, d: 4 * FT, h: 15 * FT },  color: "#c0c8d0" },
  { id: "t-dock",   name: "Loading Dock",      shape: "box",    dims: { w: 60 * FT, d: 12 * FT, h: 4 * FT },  color: "#a97142" },
];

/* ---------------- State ---------------- */
export const state = {
  units: "ft",              // 'ft' | 'm'
  customCatalog: [],        // user-defined templates (same shape as BUILTIN_CATALOG, id 'c<N>')
  items: [],                // {id, name, shape, dims{}, color, x, z, rot}
  utilities: [],            // {id, type, aId, bId, route:'ground'|'overhead'}
  site: null,               // {lng, lat, rot}  — georeference anchor for map mode
  selectedId: null,
  nextId: 1,
  nextCatalogId: 1,
  nextUtilId: 1,
  showLabels: true,
  snap: true,
};

export function catalogAll() {
  return [...BUILTIN_CATALOG, ...state.customCatalog];
}
export function selectedItem() {
  return state.items.find(i => i.id === state.selectedId) || null;
}
export function itemById(id) {
  return state.items.find(i => i.id === id) || null;
}

/* ---------------- Units ---------------- */
export const toUI   = m => state.units === "ft" ? m / FT : m;
export const fromUI = v => state.units === "ft" ? v * FT : v;
export const unitSuffix = () => state.units === "ft" ? "ft" : "m";
export function fmtLen(meters) {
  const v = toUI(meters);
  return (v < 10 ? Math.round(v * 10) / 10 : Math.round(v)) + " " + unitSuffix();
}
export function fmtDims(item) {
  const d = item.dims, s = unitSuffix(), r = m => Math.round(toUI(m) * 10) / 10;
  switch (item.shape) {
    case "box":   return `${r(d.w)}×${r(d.d)}×${r(d.h)} ${s}`;
    case "cyl-v": return `⌀${r(d.dia)} × ${r(d.h)} ${s}`;
    case "cyl-h": return `⌀${r(d.dia)} × ${r(d.len)} ${s}`;
    case "silo":  return `⌀${r(d.dia)} × ${r(d.h)} ${s}`;
    case "sphere":return `⌀${r(d.dia)} ${s}`;
    default:      return "";
  }
}
export function itemHeight(item) {
  const d = item.dims;
  switch (item.shape) {
    case "box":   return d.h;
    case "cyl-v": case "silo": return d.h;
    case "cyl-h": return d.dia * 1.15;   // saddles lift it slightly
    case "sphere":return d.dia;
    default:      return 3;
  }
}
/* Footprint in the item's local frame: [halfEast, halfNorth] extents,
   or {circle: radius}. */
export function footprintLocal(item) {
  const d = item.dims;
  switch (item.shape) {
    case "box":   return { hw: d.w / 2, hd: d.d / 2 };
    case "cyl-h": return { hw: d.len / 2, hd: d.dia / 2 };
    case "cyl-v": case "silo": case "sphere": return { circle: d.dia / 2 };
    default:      return { hw: 1, hd: 1 };
  }
}

/* ---------------- Geodesy ---------------- */
export function wrapLng(lng) {
  return ((lng % 360) + 540) % 360 - 180;
}
export function metersPerDegree(lat) {
  const p = lat * Math.PI / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lng: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p),
  };
}
export function haversine(a, b) {
  const R = 6371008.8;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Site-plane (x east, z south) -> lng/lat via site anchor + rotation.
   Site rot is degrees clockwise from north: the site's local north
   (-z) points rot degrees east of true north. */
export function siteToLngLat(x, z, site) {
  const th = site.rot * Math.PI / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const e0 = x, n0 = -z;
  const east  = e0 * c + n0 * s;
  const north = -e0 * s + n0 * c;
  const m = metersPerDegree(site.lat);
  return [wrapLng(site.lng + east / m.lng), site.lat + north / m.lat];
}

/* Ring for an item on the map (lng/lat coords, closed). Circles are
   24-gons. Combined rotation = site.rot + item.rot. */
export function itemRingLngLat(item, site) {
  const fp = footprintLocal(item);
  const pts = [];
  if (fp.circle) {
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      pts.push([item.x + fp.circle * Math.cos(a), item.z + fp.circle * Math.sin(a)]);
    }
  } else {
    const th = item.rot * Math.PI / 180;
    const c = Math.cos(th), s = Math.sin(th);
    for (const [lx, lz] of [[-fp.hw, -fp.hd], [fp.hw, -fp.hd], [fp.hw, fp.hd], [-fp.hw, fp.hd]]) {
      // clockwise-from-north item rotation in the (east, north) frame,
      // expressed in (x, z): x' = lx cos - lz sin ... derive via north = -z
      pts.push([item.x + lx * c - lz * s, item.z + lx * s + lz * c]);
    }
  }
  const ring = pts.map(([x, z]) => siteToLngLat(x, z, site));
  ring.push(ring[0]);
  return ring;
}

/* L-shaped utility route between two items in site-plane coords. */
export function utilityPath(u) {
  const a = itemById(u.aId), b = itemById(u.bId);
  if (!a || !b) return null;
  const pts = [[a.x, a.z]];
  if (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.z - b.z) > 0.01) pts.push([b.x, a.z]);
  pts.push([b.x, b.z]);
  return pts;
}
export function utilityLength(u) {
  const a = itemById(u.aId), b = itemById(u.bId);
  if (!a || !b) return 0;
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

/* ---------------- Validation & persistence ---------------- */
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
export function validItem(it) {
  if (!(it && typeof it.shape === "string" && SHAPES[it.shape] && it.dims &&
        Number.isFinite(it.x) && Number.isFinite(it.z))) return false;
  for (const k of SHAPES[it.shape].dims) {
    if (!(Number.isFinite(it.dims[k]) && it.dims[k] > 0)) return false;
  }
  if (!Number.isFinite(it.rot)) it.rot = 0;
  if (typeof it.color !== "string" || !COLOR_RE.test(it.color)) it.color = "#8fa3b8";
  if (typeof it.name !== "string") it.name = "Equipment";
  return true;
}
export function validTemplate(t) {
  return validItem({ ...t, x: 0, z: 0 }) ? true : false;
}
export function validUtility(u, itemIds) {
  return u && UTILITY_TYPES[u.type] && itemIds.has(u.aId) && itemIds.has(u.bId) &&
    (u.route === "ground" || u.route === "overhead");
}

let saveTimer = null;
let savePending = false;
export function save() {
  clearTimeout(saveTimer);
  savePending = true;
  saveTimer = setTimeout(flushSave, 250);
}
export function flushSave() {
  clearTimeout(saveTimer);
  if (!savePending) return;
  savePending = false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(exportProject()));
  } catch (e) { /* storage blocked/full — non-fatal */ }
}

export function exportProject() {
  return {
    app: "3d-site-lab",
    version: 2,
    units: state.units,
    customCatalog: state.customCatalog,
    items: state.items,
    utilities: state.utilities,
    site: state.site,
  };
}

export function loadProject(data, { replace = true } = {}) {
  if (!data || typeof data !== "object") return false;
  // refuse to wipe the current project for a file that clearly isn't ours —
  // validItem mutates (repairs) its argument, so probe on copies
  if (data.app !== "3d-site-lab" &&
      !(Array.isArray(data.items) && data.items.some(it => validItem({ ...it, dims: { ...(it && it.dims) } })))) {
    return false;
  }
  const items = (Array.isArray(data.items) ? data.items : []).filter(validItem);
  if (replace) {
    state.items = [];
    state.utilities = [];
    state.customCatalog = [];
    state.selectedId = null;
    state.site = null; // a project without a georeference must not inherit the old anchor
  }
  const idMap = new Map();
  for (const it of items) {
    const oldId = it.id;
    it.id = state.nextId++;
    if (Number.isFinite(oldId)) idMap.set(oldId, it.id);
    state.items.push(it);
  }
  const itemIds = new Set(state.items.map(i => i.id));
  for (const u of (Array.isArray(data.utilities) ? data.utilities : [])) {
    const remapped = { ...u, aId: idMap.get(u.aId), bId: idMap.get(u.bId) };
    if (!remapped.route) remapped.route = "ground";
    if (validUtility(remapped, itemIds)) {
      remapped.id = state.nextUtilId++;
      state.utilities.push(remapped);
    }
  }
  for (const t of (Array.isArray(data.customCatalog) ? data.customCatalog : [])) {
    if (validTemplate(t)) {
      t.id = "c" + state.nextCatalogId++;
      state.customCatalog.push(t);
    }
  }
  if (data.site && Number.isFinite(data.site.lng) && Number.isFinite(data.site.lat) &&
      Math.abs(data.site.lat) <= 90) {
    state.site = { lng: wrapLng(data.site.lng), lat: data.site.lat, rot: Number.isFinite(data.site.rot) ? data.site.rot : 0 };
  }
  if (data.units === "m" || data.units === "ft") state.units = data.units;
  return true;
}

export function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return loadProject(JSON.parse(raw));
  } catch (e) { return false; }
}

/* ---------------- Item ops ---------------- */
export function addItem(template, x, z) {
  const it = {
    id: state.nextId++,
    name: template.name,
    shape: template.shape,
    dims: { ...template.dims },
    color: template.color,
    x, z,
    rot: template.rot || 0,
  };
  state.items.push(it);
  state.selectedId = it.id;
  return it;
}
export function removeItem(id) {
  state.items = state.items.filter(i => i.id !== id);
  state.utilities = state.utilities.filter(u => u.aId !== id && u.bId !== id);
  if (state.selectedId === id) state.selectedId = null;
}

/* ---------------- CSV catalog import ----------------
   Columns (case-insensitive, any order): name, shape,
   width, depth, height, diameter, length, color.
   Dimension values are in the CURRENT UI units. */
/* RFC 4180-style parser: handles quoted fields containing commas,
   escaped quotes (""), and newlines inside quotes. */
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell.trim()); cell = "";
    } else if (ch === "\n" || ch === "\r") {
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

export function importCatalogCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { added: 0, skipped: 0 };
  const header = rows[0].map(h => h.toLowerCase());
  const col = name => header.indexOf(name);
  const iName = col("name"), iShape = col("shape"), iW = col("width"),
        iD = col("depth"), iH = col("height"), iDia = col("diameter"),
        iLen = col("length"), iColor = col("color");
  const shapeAlias = {
    box: "box", building: "box", rect: "box",
    cylinder: "cyl-v", "cyl-v": "cyl-v", vertical: "cyl-v", tank: "cyl-v",
    "cyl-h": "cyl-h", horizontal: "cyl-h", "tank-h": "cyl-h",
    silo: "silo", sphere: "sphere",
  };
  let added = 0, skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i];
    const get = idx => idx >= 0 && idx < c.length ? c[idx] : "";
    const num = idx => { const v = parseFloat(get(idx)); return Number.isFinite(v) && v > 0 ? fromUI(v) : null; };
    const shape = shapeAlias[(get(iShape) || "box").toLowerCase()] || null;
    const name = get(iName);
    if (!shape || !name) { skipped++; continue; }
    const dims = {};
    if (shape === "box") { dims.w = num(iW); dims.d = num(iD); dims.h = num(iH); }
    else if (shape === "cyl-v" || shape === "silo") { dims.dia = num(iDia); dims.h = num(iH); }
    else if (shape === "cyl-h") { dims.dia = num(iDia); dims.len = num(iLen) ?? num(iW); }
    else if (shape === "sphere") { dims.dia = num(iDia); }
    if (Object.values(dims).some(v => v === null)) { skipped++; continue; }
    const color = COLOR_RE.test(get(iColor)) ? get(iColor) : "#8fa3b8";
    state.customCatalog.push({ id: "c" + state.nextCatalogId++, name, shape, dims, color });
    added++;
  }
  return { added, skipped };
}
