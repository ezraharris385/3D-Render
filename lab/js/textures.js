/* =========================================================
   Studio — procedural wall materials at TRUE pattern scale.
   Each maker returns { canvas, patternW, patternH } where
   patternW/H are the real-world meters covered by one tile,
   so texture.repeat = faceMeters / pattern gives brick
   courses, panel ribs, etc. at their actual size.
   ========================================================= */
import * as THREE from "three";

const FT = 0.3048, IN = 0.0254;

function canvas(px = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  return c;
}
function rand(seed) {
  // deterministic PRNG so rebuilds look identical
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* Brick: modular 7.625"×2.25" + 3/8" mortar → module 8"×2.667".
   Tile = 8 bricks × 24 courses = 1.6256 m square. */
export function makeBrick() {
  const c = canvas(512), g = c.getContext("2d");
  const r = rand(7);
  const cols = 8, rows = 24;
  const bw = c.width / cols, bh = c.height / rows;
  g.fillStyle = "#b8ab9b"; // mortar
  g.fillRect(0, 0, c.width, c.height);
  const mortar = c.width * ((3 / 8) * IN / 1.6256); // 3/8" joint in px
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * bw / 2;
    for (let col = -1; col < cols; col++) {
      const shade = 0.82 + r() * 0.36;
      const hue = 12 + r() * 10;
      g.fillStyle = `hsl(${hue}, ${38 + r() * 14}%, ${26 + shade * 12}%)`;
      g.fillRect(col * bw + off + mortar / 2, row * bh + mortar / 2, bw - mortar, bh - mortar);
      if (r() < 0.18) { // occasional dark header
        g.fillStyle = `rgba(40,26,20,${0.12 + r() * 0.2})`;
        g.fillRect(col * bw + off + mortar / 2, row * bh + mortar / 2, bw - mortar, bh - mortar);
      }
    }
  }
  return { canvas: c, patternW: 1.6256, patternH: 1.6256 };
}

/* CMU: 15.625"×7.625" + 3/8" joint → module 16"×8".
   Tile = 4 blocks × 8 courses = 1.6256 m square. */
export function makeCMU() {
  const c = canvas(512), g = c.getContext("2d");
  const r = rand(11);
  const cols = 4, rows = 8;
  const bw = c.width / cols, bh = c.height / rows;
  g.fillStyle = "#9a958c";
  g.fillRect(0, 0, c.width, c.height);
  const mortar = c.width * ((3 / 8) * IN / 1.6256);
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * bw / 2;
    for (let col = -1; col < cols; col++) {
      const l = 58 + r() * 10;
      g.fillStyle = `hsl(40, 6%, ${l}%)`;
      g.fillRect(col * bw + off + mortar / 2, row * bh + mortar / 2, bw - mortar, bh - mortar);
      g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`;
      for (let s = 0; s < 14; s++) {
        g.fillRect(col * bw + off + r() * bw, row * bh + r() * bh, 2, 2);
      }
    }
  }
  return { canvas: c, patternW: 1.6256, patternH: 1.6256 };
}

/* Concrete tilt-up: 15 ft panels with chamfered reveal joints.
   Tile = 4.572 m square (one panel width). */
export function makeConcrete() {
  const c = canvas(512), g = c.getContext("2d");
  const r = rand(23);
  g.fillStyle = "#b9bcbe";
  g.fillRect(0, 0, c.width, c.height);
  // mottle
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${100 + r() * 60},${100 + r() * 60},${105 + r() * 55},${0.05 + r() * 0.08})`;
    const s = 2 + r() * 26;
    g.fillRect(r() * c.width, r() * c.height, s, s * (0.4 + r()));
  }
  // form tie holes (2ft grid-ish)
  g.fillStyle = "rgba(60,60,62,.5)";
  for (let x = 0.25; x < 1; x += 0.25) {
    for (let y = 0.2; y < 1; y += 0.3) {
      g.beginPath();
      g.arc(x * c.width, y * c.height, 3, 0, 7);
      g.fill();
    }
  }
  // vertical reveal joint at tile edge
  const j = Math.max(3, c.width * (0.75 * IN / 4.572));
  g.fillStyle = "#7e8184";
  g.fillRect(0, 0, j, c.height);
  g.fillRect(c.width - j, 0, j, c.height);
  return { canvas: c, patternW: 4.572, patternH: 4.572 };
}

/* Metal panel: vertical ribs every 12". Tile = 0.9144 m (3 ribs). */
export function makeMetal() {
  const c = canvas(384), g = c.getContext("2d");
  const ribs = 3, rw = c.width / ribs;
  for (let i = 0; i < ribs; i++) {
    const x = i * rw;
    const grad = g.createLinearGradient(x, 0, x + rw, 0);
    grad.addColorStop(0, "#7d8892");
    grad.addColorStop(0.12, "#aeb9c2");
    grad.addColorStop(0.5, "#98a3ad");
    grad.addColorStop(0.88, "#828d97");
    grad.addColorStop(1, "#6c7781");
    g.fillStyle = grad;
    g.fillRect(x, 0, rw, c.height);
    g.fillStyle = "rgba(255,255,255,.25)";
    g.fillRect(x + rw * 0.05, 0, 2, c.height);
    g.fillStyle = "rgba(0,0,0,.28)";
    g.fillRect(x + rw - 3, 0, 3, c.height);
  }
  return { canvas: c, patternW: 0.9144, patternH: 0.9144 };
}

/* Curtainwall: 5 ft mullion grid over blue-green glass.
   Tile = 1.524 m square. */
export function makeCurtainwall() {
  const c = canvas(256), g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, c.width, c.height);
  grad.addColorStop(0, "#5d7f96");
  grad.addColorStop(0.5, "#7ba0b5");
  grad.addColorStop(1, "#4c6b82");
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "rgba(255,255,255,.12)";
  g.beginPath();
  g.moveTo(0, c.height * 0.7);
  g.lineTo(c.width, c.height * 0.15);
  g.lineTo(c.width, 0);
  g.lineTo(0, 0);
  g.fill();
  const m = Math.max(3, c.width * (2.5 * IN / 1.524));
  g.fillStyle = "#2b3238";
  g.fillRect(0, 0, m, c.height);
  g.fillRect(0, 0, c.width, m);
  return { canvas: c, patternW: 1.524, patternH: 1.524 };
}

/* EIFS / stucco: fine sand noise. Tile = 1 m. */
export function makeEIFS() {
  const c = canvas(256), g = c.getContext("2d");
  const r = rand(41);
  g.fillStyle = "#cfc7b4";
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${90 + r() * 90},${85 + r() * 85},${70 + r() * 75},${0.05 + r() * 0.09})`;
    g.fillRect(r() * c.width, r() * c.height, 1.5, 1.5);
  }
  return { canvas: c, patternW: 1, patternH: 1 };
}

/* Lap siding: 6" exposure. Tile = 0.9144 m (6 laps). */
export function makeSiding() {
  const c = canvas(384), g = c.getContext("2d");
  const r = rand(53);
  const laps = 6, lh = c.height / laps;
  for (let i = 0; i < laps; i++) {
    const y = i * lh;
    const grad = g.createLinearGradient(0, y, 0, y + lh);
    const l = 55 + r() * 6;
    grad.addColorStop(0, `hsl(210, 8%, ${l + 8}%)`);
    grad.addColorStop(0.85, `hsl(210, 8%, ${l}%)`);
    grad.addColorStop(1, `hsl(210, 10%, ${l - 22}%)`);
    g.fillStyle = grad;
    g.fillRect(0, y, c.width, lh);
  }
  return { canvas: c, patternW: 0.9144, patternH: 0.9144 };
}

/* Ribbed door panel (overhead/dock): horizontal ribs ~21". */
export function makeDoorPanel() {
  const c = canvas(256), g = c.getContext("2d");
  const ribs = 6, rh = c.height / ribs;
  for (let i = 0; i < ribs; i++) {
    const y = i * rh;
    const grad = g.createLinearGradient(0, y, 0, y + rh);
    grad.addColorStop(0, "#c3c9ce");
    grad.addColorStop(0.5, "#aab1b7");
    grad.addColorStop(0.92, "#8f979e");
    grad.addColorStop(1, "#6f767c");
    g.fillStyle = grad;
    g.fillRect(0, y, c.width, rh);
  }
  return { canvas: c, patternW: 3.2, patternH: 3.2 };
}

/* ---------------- material factory ---------------- */
const MAKERS = {
  brick: makeBrick, cmu: makeCMU, concrete: makeConcrete, metal: makeMetal,
  curtainwall: makeCurtainwall, eifs: makeEIFS, siding: makeSiding,
};
const cache = new Map();

export function wallMaterial(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const maker = MAKERS[kind] || makeConcrete;
  const { canvas: cv, patternW, patternH } = maker();
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: kind === "curtainwall" ? 0.25 : kind === "metal" ? 0.45 : 0.85,
    metalness: kind === "curtainwall" ? 0.55 : kind === "metal" ? 0.6 : 0.02,
  });
  const entry = { mat, patternW, patternH };
  cache.set(kind, entry);
  return entry;
}
export function doorPanelMaterial() {
  if (cache.has("__door")) return cache.get("__door");
  const { canvas: cv, patternW, patternH } = makeDoorPanel();
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.5 });
  const entry = { mat, patternW, patternH };
  cache.set("__door", entry);
  return entry;
}
