/* =========================================================
   Studio — 3D rendering lab. Data model.
   Everything stored in METERS. Faces are 's' (front, +z),
   'n' (back, -z), 'e' (+x), 'w' (-x). Opening `u` is the
   distance from the LEFT edge of the face as seen from
   OUTSIDE, to the opening's center. Rotation deg CW from
   north in top view.
   ========================================================= */

export const FT = 0.3048;
export const IN = 0.0254;
export const STORAGE_KEY = "render-lab-v1";

/* ---------------- Wall materials ----------------
   patternW/patternH = real-world size of one texture tile. */
export const MATERIALS = {
  brick:       { label: "Brick (modular, running bond)" },
  cmu:         { label: "CMU block" },
  concrete:    { label: "Concrete tilt-up" },
  metal:       { label: "Metal panel (12\" ribs)" },
  curtainwall: { label: "Glass curtainwall" },
  eifs:        { label: "EIFS / stucco" },
  siding:      { label: "Lap siding (6\")" },
};

/* ---------------- Opening catalog ----------------
   Real default sizes; everything editable after placement. */
export const OPENING_TYPES = {
  "fixed":       { label: "Fixed window",      w: 4 * FT,  h: 4 * FT,   sill: 3.5 * FT, kind: "glass", mullions: "none" },
  "double-hung": { label: "Double-hung",       w: 3 * FT,  h: 5 * FT,   sill: 3 * FT,   kind: "glass", mullions: "h1" },
  "sliding":     { label: "Sliding window",    w: 5 * FT,  h: 4 * FT,   sill: 3 * FT,   kind: "glass", mullions: "v1" },
  "picture":     { label: "Picture window",    w: 6 * FT,  h: 5 * FT,   sill: 2.5 * FT, kind: "glass", mullions: "none" },
  "storefront":  { label: "Storefront panel",  w: 6 * FT,  h: 9 * FT,   sill: 4 * IN,   kind: "glass", mullions: "grid" },
  "ribbon":      { label: "Ribbon window",     w: 12 * FT, h: 4 * FT,   sill: 7 * FT,   kind: "glass", mullions: "v" },
  "glass-door":  { label: "Glass entry (pair)",w: 6 * FT,  h: 7.5 * FT, sill: 0,        kind: "glass", mullions: "door" },
  "man-door":    { label: "Man door",          w: 3 * FT,  h: 7 * FT,   sill: 0,        kind: "panel", panel: "flat" },
  "overhead":    { label: "Overhead door",     w: 10 * FT, h: 12 * FT,  sill: 0,        kind: "panel", panel: "ribbed" },
  "dock":        { label: "Dock door",         w: 9 * FT,  h: 10 * FT,  sill: 0,        kind: "panel", panel: "ribbed" },
};

export const FACES = ["s", "e", "n", "w"];
export const FACE_LABELS = { s: "Front (S)", e: "Right (E)", n: "Back (N)", w: "Left (W)" };

/* ---------------- Interior infrastructure catalog ----------------
   Built-in items with real dimensions; user-uploaded catalog rows
   (kind=equipment) extend this list at runtime. */
export const INTERIOR_TYPES = {
  "rack":        { label: "Server rack (42U)",   w: 0.6096, d: 1.0668, h: 2.1336, color: "#1f2937" },
  "crac":        { label: "CRAC / CRAH unit",    w: 2.4384, d: 0.9144, h: 1.9812, color: "#5ad7d2" },
  "ups":         { label: "UPS cabinet",         w: 1.2192, d: 0.9144, h: 1.9812, color: "#9a8cff" },
  "pdu":         { label: "PDU",                 w: 0.9144, d: 0.9144, h: 1.9812, color: "#7bd88f" },
  "switchgear":  { label: "Switchgear",          w: 2.7432, d: 1.2192, h: 2.2860, color: "#e4b34a" },
  "panel":       { label: "Electrical panel",    w: 0.5080, d: 0.1524, h: 1.2192, color: "#93a3b3" },
  "waterheater": { label: "Water heater",        w: 0.6096, d: 0.6096, h: 1.5240, color: "#c0c8d0" },
  "racking":     { label: "Pallet racking bay",  w: 2.7432, d: 1.0668, h: 6.0960, color: "#ff8b5e" },
  "workbench":   { label: "Workbench / desk",    w: 1.8288, d: 0.7620, h: 0.9144, color: "#a97142" },
  "machine":     { label: "Machine / skid",      w: 2.4384, d: 1.5240, h: 1.8288, color: "#4da3ff" },
};

export function floorBase(b, floor) { return (floor - 1) * b.floorH; }
export function interiorOnFloor(b, floor) {
  return (b.interior || []).filter(it => it.floor === floor);
}

/* ---------------- State ---------------- */
export const state = {
  units: "ft",
  buildings: [],
  selectedId: null,       // building id
  selectedOpening: null,  // {bId, oId} | null
  nextId: 1,
  nextOpeningId: 1,
  showDims: true,
};

export function selectedBuilding() {
  return state.buildings.find(b => b.id === state.selectedId) || null;
}
export function buildingById(id) {
  return state.buildings.find(b => b.id === id) || null;
}
export function openingById(b, oId) {
  return b ? b.openings.find(o => o.id === oId) || null : null;
}

/* ---------------- Units ---------------- */
export const toUI   = m => state.units === "ft" ? m / FT : m;
export const fromUI = v => state.units === "ft" ? v * FT : v;
export const unitSuffix = () => state.units === "ft" ? "ft" : "m";
export function ftIn(m) {
  const totalIn = m / IN;
  let ft = Math.floor(totalIn / 12);
  let inch = Math.round(totalIn - ft * 12);
  if (inch === 12) { ft++; inch = 0; }
  return inch ? `${ft}′-${inch}″` : `${ft}′-0″`;
}
export function fmtLen(m) {
  return state.units === "ft" ? ftIn(m) : (Math.round(m * 100) / 100) + " m";
}

/* ---------------- Geometry helpers ---------------- */
export function faceLength(b, face) {
  return face === "n" || face === "s" ? b.plan.w : b.plan.d;
}
export function bodyHeight(b) {
  return b.stories * b.floorH;
}
export function wallHeight(b, face) {
  const body = bodyHeight(b);
  if (b.roof.type === "flat") return body + b.parapet;
  // gable: the two faces perpendicular to the ridge carry the gable
  // triangle (handled in the builder); rectangular part is body height
  return body;
}
export function ridgeHeight(b) {
  if (b.roof.type !== "gable") return bodyHeight(b);
  const span = b.roof.ridge === "x" ? b.plan.d : b.plan.w;
  return bodyHeight(b) + (span / 2) * (b.roof.pitch / 12);
}
export function totalHeight(b) {
  return b.roof.type === "gable" ? ridgeHeight(b) : bodyHeight(b) + b.parapet;
}
export function isGableFace(b, face) {
  return b.roof.type === "gable" &&
    ((b.roof.ridge === "x" && (face === "e" || face === "w")) ||
     (b.roof.ridge === "z" && (face === "n" || face === "s")));
}

/* Openings that geometrically fit their face (used by the builder);
   others are kept in the data but flagged in the UI. */
export function openingFits(b, o, accepted) {
  const L = faceLength(b, o.face);
  const H = wallHeight(b, o.face);
  const x0 = o.u - o.w / 2, x1 = o.u + o.w / 2;
  const y0 = o.sill, y1 = o.sill + o.h;
  if (x0 < 0.02 || x1 > L - 0.02 || y0 < -0.001 || y1 > H - 0.02) return false;
  for (const a of accepted) {
    if (x0 < a.u + a.w / 2 + 0.02 && x1 > a.u - a.w / 2 - 0.02 &&
        y0 < a.sill + a.h + 0.02 && y1 > a.sill - 0.02) return false;
  }
  return true;
}
export function fittedOpenings(b, face) {
  const ok = [], bad = [];
  for (const o of b.openings.filter(o => o.face === face)) {
    (openingFits(b, o, ok) ? ok : bad).push(o);
  }
  return { ok, bad };
}

/* ---------------- Building ops ---------------- */
export function makeBuilding(partial = {}) {
  const b = {
    id: state.nextId++,
    name: partial.name || `Building ${state.nextId - 1}`,
    assetType: partial.assetType || "custom",
    x: partial.x ?? 0, z: partial.z ?? 0, rot: partial.rot ?? 0,
    plan: { w: 24.384, d: 12.192, ...(partial.plan || {}) },   // 80×40 ft default
    stories: partial.stories ?? 1,
    floorH: partial.floorH ?? 4.2672,                          // 14 ft
    parapet: partial.parapet ?? 0.9144,                        // 3 ft
    roof: { type: "flat", pitch: 4, ridge: "x", ...(partial.roof || {}) },
    material: partial.material || "concrete",
    openings: [],
    interior: [],
  };
  for (const o of (partial.openings || [])) addOpening(b, o);
  for (const it of (partial.interior || [])) addInterior(b, it);
  state.buildings.push(b);
  state.selectedId = b.id;
  state.selectedOpening = null;
  return b;
}
export function addInterior(b, spec) {
  const it = {
    id: state.nextOpeningId++, // shared id sequence keeps everything unique
    kind: spec.kind === "wall" ? "wall" : "item",
    floor: Math.max(1, Math.round(spec.floor || 1)),
    name: spec.name || "Item",
    color: spec.color || "#8fa3b8",
  };
  if (it.kind === "wall") {
    it.x1 = spec.x1 ?? 0; it.z1 = spec.z1 ?? 0;
    it.x2 = spec.x2 ?? 1; it.z2 = spec.z2 ?? 0;
    it.t = spec.t || 0.12;
  } else {
    it.x = spec.x ?? 0; it.z = spec.z ?? 0; it.rot = spec.rot || 0;
    it.w = spec.w || 1; it.d = spec.d || 1; it.h = spec.h || 1;
    it.type = spec.type || "";
    it.brand = spec.brand || "";
  }
  b.interior.push(it);
  return it;
}
export function addOpening(b, spec) {
  const t = OPENING_TYPES[spec.type] || OPENING_TYPES["fixed"];
  const o = {
    id: state.nextOpeningId++,
    face: spec.face || "s",
    type: spec.type || "fixed",
    u: spec.u ?? faceLength(b, spec.face || "s") / 2,
    sill: spec.sill ?? t.sill,
    w: spec.w ?? t.w,
    h: spec.h ?? t.h,
  };
  b.openings.push(o);
  return o;
}
export function removeBuilding(id) {
  state.buildings = state.buildings.filter(b => b.id !== id);
  if (state.selectedId === id) { state.selectedId = null; state.selectedOpening = null; }
}
/* even array of openings across a face; positions colliding with
   existing openings are skipped, never silently overlapped */
export function arrayOpenings(b, face, type, count, override = {}) {
  const t = OPENING_TYPES[type];
  const L = faceLength(b, face);
  if (!t || count < 1) return 0;
  const w = override.w ?? t.w, h = override.h ?? t.h, sill = override.sill ?? t.sill;
  const margin = Math.max(0.6, w / 2 + 0.15);
  const usable = L - margin * 2;
  if (usable < w * count + 0.1 * (count - 1)) {
    count = Math.max(1, Math.floor(usable / (w + 0.4)));
  }
  if (count < 1) return 0;
  const accepted = [...fittedOpenings(b, face).ok];
  let made = 0;
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? L / 2 : margin + w / 2 + (usable - w) * (i / (count - 1));
    const spec = { face, type, u, sill, w, h };
    if (!openingFits(b, spec, accepted)) continue;
    const o = addOpening(b, spec);
    accepted.push(o);
    made++;
  }
  return made;
}

/* ---------------- Validation & persistence ---------------- */
export function validBuilding(b) {
  if (!(b && b.plan && Number.isFinite(b.plan.w) && b.plan.w > 0 &&
        Number.isFinite(b.plan.d) && b.plan.d > 0 &&
        Number.isFinite(b.x) && Number.isFinite(b.z) &&
        Number.isFinite(b.stories) && b.stories >= 1 &&
        Number.isFinite(b.floorH) && b.floorH > 1)) return false;
  b.stories = Math.round(b.stories);
  if (!Number.isFinite(b.rot)) b.rot = 0;
  if (!Number.isFinite(b.parapet) || b.parapet < 0) b.parapet = 0;
  if (!MATERIALS[b.material]) b.material = "concrete";
  if (!b.roof || (b.roof.type !== "flat" && b.roof.type !== "gable")) b.roof = { type: "flat", pitch: 4, ridge: "x" };
  if (!Number.isFinite(b.roof.pitch) || b.roof.pitch <= 0) b.roof.pitch = 4;
  if (b.roof.ridge !== "x" && b.roof.ridge !== "z") b.roof.ridge = "x";
  if (typeof b.name !== "string") b.name = "Building";
  if (typeof b.assetType !== "string") b.assetType = "custom";
  b.openings = (Array.isArray(b.openings) ? b.openings : []).filter(o =>
    o && OPENING_TYPES[o.type] && ["n", "s", "e", "w"].includes(o.face) &&
    Number.isFinite(o.u) && Number.isFinite(o.sill) &&
    Number.isFinite(o.w) && o.w > 0 && Number.isFinite(o.h) && o.h > 0);
  const CLR = /^#[0-9a-fA-F]{3,8}$/;
  b.interior = (Array.isArray(b.interior) ? b.interior : []).filter(it => {
    if (!it || !Number.isFinite(it.floor) || it.floor < 1) return false;
    if (typeof it.color !== "string" || !CLR.test(it.color)) it.color = "#8fa3b8";
    if (typeof it.name !== "string") it.name = "Item";
    if (it.kind === "wall") {
      if (![it.x1, it.z1, it.x2, it.z2].every(Number.isFinite)) return false;
      if (!Number.isFinite(it.t) || it.t <= 0) it.t = 0.12;
      return true;
    }
    it.kind = "item";
    if (!Number.isFinite(it.rot)) it.rot = 0;
    return [it.x, it.z].every(Number.isFinite) &&
      Number.isFinite(it.w) && it.w > 0 &&
      Number.isFinite(it.d) && it.d > 0 &&
      Number.isFinite(it.h) && it.h > 0;
  });
  return true;
}

export function exportProject() {
  return {
    app: "render-lab",
    version: 1,
    units: state.units,
    buildings: state.buildings,
  };
}
export function loadProject(data) {
  if (!data || typeof data !== "object") return false;
  if (data.app !== "render-lab" &&
      !(Array.isArray(data.buildings) && data.buildings.some(b => validBuilding(JSON.parse(JSON.stringify(b || null)))))) {
    return false;
  }
  const incoming = (Array.isArray(data.buildings) ? data.buildings : []).filter(validBuilding);
  state.buildings = [];
  state.selectedId = null;
  state.selectedOpening = null;
  let maxO = 0;
  for (const b of incoming) {
    b.id = state.nextId++;
    for (const o of b.openings) { o.id = ++maxO; }
    for (const it of b.interior) { it.id = ++maxO; }
    state.buildings.push(b);
  }
  state.nextOpeningId = maxO + 1;
  if (data.units === "m" || data.units === "ft") state.units = data.units;
  return true;
}

let saveTimer = null, savePending = false;
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
  } catch (e) { /* non-fatal */ }
}
export function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? loadProject(JSON.parse(raw)) : false;
  } catch (e) { return false; }
}
