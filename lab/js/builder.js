/* =========================================================
   Studio — building geometry. Walls are ExtrudeGeometry
   shapes with real window holes; texture UVs are in shape
   meters so material patterns render at true size.
   ========================================================= */
import * as THREE from "three";
import {
  FACES, OPENING_TYPES, faceLength, wallHeight, bodyHeight, ridgeHeight,
  isGableFace, fittedOpenings, fmtLen, totalHeight, mountElev,
} from "./state.js";
import { wallMaterial, doorPanelMaterial } from "./textures.js";

const WALL_T = 0.25;
/* E/W walls sit 1cm behind the S/N wall end-planes so no two surfaces
   are coplanar at the corners (reads as a control joint, kills
   z-fighting). */
const CORNER_EPS = 0.01;

/* Face transform: mesh positioned so shape-x runs along the face
   left→right as seen from OUTSIDE, shape-y is up, extrude +z points
   INTO the building interior wall thickness with the outer surface
   coincident with the building envelope. */
function faceTransform(b, face) {
  const { w, d } = b.plan;
  switch (face) {
    case "s": return { pos: [-w / 2, 0, d / 2 - WALL_T], rotY: 0 };
    case "n": return { pos: [w / 2, 0, -d / 2 + WALL_T], rotY: Math.PI };
    case "e": return { pos: [w / 2 - WALL_T - CORNER_EPS, 0, d / 2], rotY: Math.PI / 2 };
    case "w": return { pos: [-w / 2 + WALL_T + CORNER_EPS, 0, -d / 2], rotY: -Math.PI / 2 };
  }
}

const glassMat = new THREE.MeshStandardMaterial({
  color: 0x8fb4c9, metalness: 0.85, roughness: 0.08,
  transparent: true, opacity: 0.6, side: THREE.DoubleSide,
});
const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.5, metalness: 0.6 });
const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.65, metalness: 0.3 });
const revealMat = new THREE.MeshStandardMaterial({ color: 0x8f9296, roughness: 0.9 });
const slabMat = new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.95 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.92 });

/* ---------------- walls ---------------- */
function buildFace(b, face, group) {
  const L = faceLength(b, face);
  const H = wallHeight(b, face);
  const { ok } = fittedOpenings(b, face);
  const gable = isGableFace(b, face);
  const ridgeH = ridgeHeight(b);

  const shape = new THREE.Shape();
  if (gable) {
    shape.moveTo(0, 0);
    shape.lineTo(L, 0);
    shape.lineTo(L, H);
    shape.lineTo(L / 2, ridgeH);
    shape.lineTo(0, H);
    shape.closePath();
  } else {
    shape.moveTo(0, 0);
    shape.lineTo(L, 0);
    shape.lineTo(L, H);
    shape.lineTo(0, H);
    shape.closePath();
  }
  for (const o of ok) {
    const hole = new THREE.Path();
    const x0 = o.u - o.w / 2, y0 = o.sill;
    hole.moveTo(x0, y0);
    hole.lineTo(x0 + o.w, y0);
    hole.lineTo(x0 + o.w, y0 + o.h);
    hole.lineTo(x0, y0 + o.h);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, { depth: WALL_T, bevelEnabled: false });
  const { mat, patternW, patternH } = wallMaterial(b.material);
  const wallMat = mat.clone();
  wallMat.map = mat.map.clone();
  wallMat.map.needsUpdate = true;
  wallMat.map.repeat.set(1 / patternW, 1 / patternH);
  const mesh = new THREE.Mesh(geo, [wallMat, revealMat]);
  const t = faceTransform(b, face);
  mesh.position.set(...t.pos);
  mesh.rotation.y = t.rotY;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData = { buildingId: b.id, face };
  group.add(mesh);

  // openings content (frames, glass, panels, mullions) in face-local coords
  const faceGroup = new THREE.Group();
  faceGroup.position.set(...t.pos);
  faceGroup.rotation.y = t.rotY;
  group.add(faceGroup);
  for (const o of ok) buildOpening(b, o, faceGroup);
}

function buildOpening(b, o, faceGroup) {
  const t = OPENING_TYPES[o.type] || OPENING_TYPES.fixed;
  const x0 = o.u - o.w / 2, y0 = o.sill;
  const g = new THREE.Group();
  g.position.set(o.u, y0 + o.h / 2, 0);
  g.userData = { buildingId: b.id, openingId: o.id };

  const F = 0.055;            // frame width
  const frameD = 0.1;
  const zMid = WALL_T * 0.55; // slightly inset from outer surface

  const addBox = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.userData = g.userData;
    g.add(m);
  };

  // perimeter frame
  addBox(o.w, F, frameD, 0, o.h / 2 - F / 2, zMid, frameMat);
  addBox(o.w, F, frameD, 0, -o.h / 2 + F / 2, zMid, frameMat);
  addBox(F, o.h, frameD, -o.w / 2 + F / 2, 0, zMid, frameMat);
  addBox(F, o.h, frameD, o.w / 2 - F / 2, 0, zMid, frameMat);

  if (t.kind === "glass") {
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(o.w - F * 2, o.h - F * 2), glassMat);
    glass.position.set(0, 0, zMid - 0.02);
    glass.rotation.y = Math.PI; // face outward
    glass.userData = g.userData;
    g.add(glass);
    // mullions by type
    const M = 0.04;
    const mull = (w, h, x, y) => addBox(w, h, frameD * 0.8, x, y, zMid, frameMat);
    switch (t.mullions) {
      case "h1": mull(o.w - F * 2, M, 0, 0); break;
      case "v1": mull(M, o.h - F * 2, 0, 0); break;
      case "door": mull(M, o.h - F * 2, 0, 0);
        mull(o.w - F * 2, M, 0, -o.h / 2 + 0.9); break;
      case "grid": {
        for (let x = 0.9144; x < o.w - F * 2 - 0.05; x += 0.9144) mull(M, o.h - F * 2, x - (o.w - F * 2) / 2, 0);
        mull(o.w - F * 2, M, 0, -o.h / 2 + F + 0.6);
        break;
      }
      case "v": {
        for (let x = 1.524; x < o.w - F * 2 - 0.05; x += 1.524) mull(M, o.h - F * 2, x - (o.w - F * 2) / 2, 0);
        break;
      }
    }
  } else {
    // solid panel (doors)
    const mat = t.panel === "ribbed" ? doorPanelMaterial().mat : doorMat;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(o.w - F * 1.2, o.h - F * 1.2, 0.06), mat);
    panel.position.set(0, 0, zMid);
    panel.castShadow = true;
    panel.userData = g.userData;
    g.add(panel);
    if (o.type === "man-door") {
      addBox(0.08, 0.08, 0.12, o.w / 2 - 0.22, -0.05, zMid + 0.05, frameMat); // handle
    }
  }
  faceGroup.add(g);
}

/* ---------------- roof / slabs ---------------- */
function buildRoof(b, group) {
  const { w, d } = b.plan;
  const body = bodyHeight(b);
  if (b.roof.type === "flat") {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w - WALL_T, 0.15, d - WALL_T), roofMat);
    slab.position.y = body - 0.075;
    slab.receiveShadow = true;
    slab.userData = { buildingId: b.id };
    group.add(slab);
    return;
  }
  // gable roof planes
  const ridgeAlongX = b.roof.ridge === "x";
  const span = ridgeAlongX ? d : w;
  const run = span / 2;
  const rise = run * (b.roof.pitch / 12);
  const slopeLen = Math.hypot(run, rise);
  const angle = Math.atan2(rise, run);
  const over = 0.35;
  const len = (ridgeAlongX ? w : d) + over * 2;
  for (const s of [1, -1]) {
    const plane = new THREE.Mesh(new THREE.BoxGeometry(
      ridgeAlongX ? len : slopeLen + over, 0.12, ridgeAlongX ? slopeLen + over : len), roofMat);
    if (ridgeAlongX) {
      plane.rotation.x = s * angle;
      plane.position.set(0, body + rise / 2 + 0.02, s * run / 2);
    } else {
      plane.rotation.z = -s * angle;
      plane.position.set(s * run / 2, body + rise / 2 + 0.02, 0);
    }
    plane.castShadow = plane.receiveShadow = true;
    plane.userData = { buildingId: b.id };
    group.add(plane);
  }
}

function buildSlabs(b, group) {
  const { w, d } = b.plan;
  for (let k = 1; k < b.stories; k++) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w - WALL_T * 1.5, 0.25, d - WALL_T * 1.5), slabMat);
    slab.position.y = k * b.floorH;
    slab.userData = { buildingId: b.id };
    group.add(slab);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.12, d + 0.6), slabMat);
  base.position.y = 0.06;
  base.receiveShadow = true;
  base.userData = { buildingId: b.id };
  group.add(base);
}

/* ---------------- dimension annotations ---------------- */
function textSprite(text, k = 1, depthTest = false) {
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  g.font = "600 44px 'Segoe UI', system-ui, sans-serif";
  const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w; c.height = 72;
  const g2 = c.getContext("2d");
  g2.font = "600 44px 'Segoe UI', system-ui, sans-serif";
  g2.fillStyle = "rgba(13,17,22,.85)";
  g2.beginPath();
  if (g2.roundRect) g2.roundRect(0, 0, w, 72, 14); else g2.rect(0, 0, w, 72);
  g2.fill();
  g2.fillStyle = "#ffd166";
  g2.textAlign = "center";
  g2.textBaseline = "middle";
  g2.fillText(text, w / 2, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest }));
  const scale = 0.014 * k;
  spr.scale.set(w * scale, 72 * scale, 1);
  spr.renderOrder = 10;
  return spr;
}
const dimLineMat = new THREE.LineBasicMaterial({ color: 0xffd166 });
function dimLine(p1, p2, label, group, k) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...p1), new THREE.Vector3(...p2),
  ]);
  group.add(new THREE.Line(geo, dimLineMat));
  for (const p of [p1, p2]) {
    const tick = new THREE.Mesh(new THREE.SphereGeometry(0.09 * k, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd166 }));
    tick.position.set(...p);
    group.add(tick);
  }
  const spr = textSprite(label, k);
  spr.position.set((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2 + 0.5 * k, (p1[2] + p2[2]) / 2);
  group.add(spr);
}
export function buildDims(b) {
  const g = new THREE.Group();
  const { w, d } = b.plan;
  const H = totalHeight(b);
  // labels stay legible on big buildings: scale with footprint
  const k = Math.min(6, Math.max(1, Math.max(w, d) / 28));
  const off = 1.6 * k;
  dimLine([-w / 2, 0.05, d / 2 + off], [w / 2, 0.05, d / 2 + off], fmtLen(w), g, k);
  dimLine([w / 2 + off, 0.05, -d / 2], [w / 2 + off, 0.05, d / 2], fmtLen(d), g, k);
  dimLine([-w / 2 - off * 0.6, 0, -d / 2 - off * 0.6], [-w / 2 - off * 0.6, H, -d / 2 - off * 0.6], fmtLen(H), g, k);
  return g;
}

/* ---------------- interior infrastructure ---------------- */
const partitionMat = new THREE.MeshStandardMaterial({ color: 0xd7dde3, roughness: 0.9 });
function buildInterior(b, group) {
  for (const it of (b.interior || [])) {
    const base = (it.floor - 1) * b.floorH + 0.13 + (it.kind === "item" ? mountElev(b, it) : 0); // slab + mount height
    if (it.kind === "wall") {
      const len = Math.hypot(it.x2 - it.x1, it.z2 - it.z1);
      if (len < 0.05) continue;
      const h = Math.max(0.5, b.floorH - 0.4);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, it.t), partitionMat);
      m.position.set((it.x1 + it.x2) / 2, base + h / 2, (it.z1 + it.z2) / 2);
      m.rotation.y = -Math.atan2(it.z2 - it.z1, it.x2 - it.x1);
      m.castShadow = m.receiveShadow = true;
      m.userData = { buildingId: b.id, interiorId: it.id };
      group.add(m);
    } else if (it.space) {
      // high-level buildout space: translucent volume + floor pad + outline + name tag
      const color = new THREE.Color(it.color);
      const vol = new THREE.Mesh(
        new THREE.BoxGeometry(it.w, it.h, it.d),
        new THREE.MeshStandardMaterial({
          color, transparent: true, opacity: 0.3, roughness: 0.85, depthWrite: false,
        })
      );
      vol.position.set(it.x, base + it.h / 2, it.z);
      vol.rotation.y = -it.rot * Math.PI / 180;
      vol.userData = { buildingId: b.id, interiorId: it.id };
      group.add(vol);
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(it.w * 0.995, 0.05, it.d * 0.995),
        new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.55), roughness: 0.95 })
      );
      pad.position.set(0, -it.h / 2 + 0.03, 0);
      pad.receiveShadow = true;
      pad.userData = vol.userData;
      vol.add(pad);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(vol.geometry),
        new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(1.25) })
      );
      edges.userData = vol.userData;
      vol.add(edges);
      // depthTest on so the label hides behind the shell from outside;
      // clamp below the doll-house cut (0.9·floorH) so the clip plane
      // never slices the text on short floors
      const kTag = Math.min(2.6, Math.max(1, Math.max(it.w, it.d) / 9));
      const tag = textSprite(it.name, kTag, true);
      const tagTop = Math.max(1, b.floorH * 0.9 - 0.13 - 0.58 * kTag);
      tag.position.set(0, Math.min(it.h + 0.35, tagTop) - it.h / 2, 0);
      tag.userData = vol.userData;
      vol.add(tag);
    } else {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(it.color), roughness: 0.6, metalness: 0.3,
      });
      const m = new THREE.Mesh(new THREE.BoxGeometry(it.w, it.h, it.d), mat);
      m.position.set(it.x, base + it.h / 2, it.z);
      m.rotation.y = -it.rot * Math.PI / 180;
      m.castShadow = m.receiveShadow = true;
      m.userData = { buildingId: b.id, interiorId: it.id };
      group.add(m);
      // subtle top cap line so dense rows read individually
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(it.w * 0.96, 0.02, it.d * 0.96),
        new THREE.MeshBasicMaterial({ color: 0x0c0f13 })
      );
      cap.position.set(0, it.h / 2 + 0.011, 0);
      cap.userData = m.userData;
      m.add(cap);
    }
  }
}

/* ---------------- shell articulation (signature builds) ----------------
   Optional b.shell spec renders facade depth on top of the envelope:
   accent bands at floor lines, corner piers, a cornice cap, an entry
   canopy, vertical fins, and a rooftop mechanical screen. All geometry
   is proud of the wall plane, so it never z-fights the facade. */
function shellMat(color, metal = false) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: metal ? 0.45 : 0.85,
    metalness: metal ? 0.5 : 0.05,
  });
}
function buildShellExtras(b, group) {
  const s = b.shell;
  if (!s || typeof s !== "object") return;
  const { w, d } = b.plan;
  const bodyH = bodyHeight(b);
  const topY = bodyH + (b.roof.type === "flat" ? b.parapet : 0);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = v => Number.isFinite(v);
  // u runs left→right as seen from OUTSIDE each face (mirrors on n and e)
  const uToX = (face, u) => face === "n" ? w / 2 - u : u - w / 2;
  const uToZ = (face, u) => face === "e" ? d / 2 - u : u - d / 2;
  const box = (bw, bh, bd, x, y, z, mat) => {
    if (![bw, bh, bd, x, y, z].every(Number.isFinite) || bw <= 0 || bh <= 0 || bd <= 0) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    m.userData = { buildingId: b.id, shellExtra: true };
    group.add(m);
  };

  // accent bands: "floors" re-derives from the live story count, so the
  // articulation follows Studio edits instead of floating at stale heights
  let bands = [];
  if (s.bands === "floors") {
    for (let k = 1; k < b.stories; k++) bands.push({ y: k * b.floorH - 0.55, h: 0.75 });
  } else if (Array.isArray(s.bands)) {
    bands = s.bands.filter(x => x && num(x.y) && num(x.h) && x.h > 0);
  }
  for (const band of bands) {
    const mat = shellMat(band.color || s.bandColor || "#2f3640", true);
    const y = clamp(band.y, 0.1, bodyH - band.h) + band.h / 2, p = 0.055;
    box(w + p * 2, band.h, 0.11, 0, y, d / 2 + p, mat);
    box(w + p * 2, band.h, 0.11, 0, y, -(d / 2 + p), mat);
    box(0.11, band.h, d + p * 2, w / 2 + p, y, 0, mat);
    box(0.11, band.h, d + p * 2, -(w / 2 + p), y, 0, mat);
  }
  if (s.corners) {
    const mat = shellMat(s.corners.color || "#cfc7b8");
    const cw = num(s.corners.w) && s.corners.w > 0 ? s.corners.w : 0.6;
    const ph = topY + 0.04; // sits proud of the wall cap — no coplanar top
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      box(cw, ph, cw, sx * w / 2, ph / 2, sz * d / 2, mat);
  }
  if (s.cornice) {
    const mat = shellMat(s.cornice.color || "#cfc7b8");
    const ch = num(s.cornice.h) && s.cornice.h > 0 ? s.cornice.h : 0.4;
    const y = topY + 0.06 - ch / 2; // coping cap proud of the wall top
    box(w + 0.3, ch, 0.3, 0, y, d / 2, mat);
    box(w + 0.3, ch, 0.3, 0, y, -d / 2, mat);
    box(0.3, ch, d + 0.3, w / 2, y, 0, mat);
    box(0.3, ch, d + 0.3, -w / 2, y, 0, mat);
  }
  if (s.canopy) {
    const c = s.canopy;
    const face = ["s", "n", "e", "w"].includes(c.face) ? c.face : "s";
    const along = face === "s" || face === "n";
    const L = along ? w : d;
    // uf (fraction of the face) tracks plan edits; absolute u is clamped onto the face
    let u = num(c.uf) ? c.uf * L : c.u;
    if (num(u) && num(c.w) && num(c.depth) && num(c.y) && c.w > 0 && c.depth > 0 && c.y > 0) {
      const cw = Math.min(c.w, L - 0.6);
      u = clamp(u, cw / 2 + 0.2, L - cw / 2 - 0.2);
      const mat = shellMat(c.color || "#2f3640", true);
      const out = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[face];
      const xc = along ? uToX(face, u) : out[0] * (w / 2 + c.depth / 2);
      const zc = along ? out[1] * (d / 2 + c.depth / 2) : uToZ(face, u);
      box(along ? cw : c.depth, 0.14, along ? c.depth : cw, xc, c.y, zc, mat);
      const lipOff = c.depth / 2 - 0.07;
      box(along ? cw : 0.14, 0.34, along ? 0.14 : cw,
        xc + (along ? 0 : out[0] * lipOff), c.y - 0.1, zc + (along ? out[1] * lipOff : 0), mat);
      for (const side of [-1, 1]) {
        const px = along ? xc + side * (cw / 2 - 0.35) : out[0] * (w / 2 + c.depth - 0.25);
        const pz = along ? out[1] * (d / 2 + c.depth - 0.25) : zc + side * (cw / 2 - 0.35);
        box(0.12, c.y, 0.12, px, c.y / 2, pz, mat);
      }
    }
  }
  if (s.fins && Array.isArray(s.fins.us)) {
    const f = s.fins;
    const face = ["s", "n", "e", "w"].includes(f.face) ? f.face : "s";
    const along = face === "s" || face === "n";
    const L = along ? w : d;
    const mat = shellMat(f.color || "#cfc7b8");
    const from = num(f.from) ? clamp(f.from, 0, bodyH - 0.5) : 0;
    const fh = Math.max(0.5, bodyH - from);
    const fw = num(f.w) && f.w > 0 ? f.w : 0.2;
    const fd = num(f.depth) && f.depth > 0 ? f.depth : 0.35;
    for (let u of f.us) {
      if (!num(u)) continue;
      u = clamp(u, 0.4, L - 0.4); // never off the end of the facade
      if (along) box(fw, fh, fd, uToX(face, u), from + fh / 2, (face === "s" ? 1 : -1) * (d / 2 + fd / 2), mat);
      else box(fd, fh, fw, (face === "e" ? 1 : -1) * (w / 2 + fd / 2), from + fh / 2, uToZ(face, u), mat);
    }
  }
  if (s.roofScreen && num(s.roofScreen.w) && num(s.roofScreen.d) && num(s.roofScreen.h)) {
    const r = s.roofScreen;
    if (r.w > 0 && r.d > 0 && r.h > 0) {
      const mat = shellMat(r.color || "#39424c", true);
      // keep the screen on the roof even after plan edits
      const sw = Math.min(r.w, w - 1), sd = Math.min(r.d, d - 1);
      const sx = clamp(num(r.x) ? r.x : 0, -(w - sw) / 2, (w - sw) / 2);
      const sz = clamp(num(r.z) ? r.z : 0, -(d - sd) / 2, (d - sd) / 2);
      const y = bodyH + r.h / 2;
      box(sw, r.h, 0.1, sx, y, sz - sd / 2, mat);
      box(0.1, r.h, sd, sx - sw / 2, y, sz, mat);
      box(0.1, r.h, sd, sx + sw / 2, y, sz, mat);
    }
  }
}

/* ---------------- top-level ---------------- */
export function buildBuilding(b, { withInterior = true } = {}) {
  const group = new THREE.Group();
  for (const face of FACES) buildFace(b, face, group);
  buildRoof(b, group);
  buildSlabs(b, group);
  buildShellExtras(b, group);
  if (withInterior) buildInterior(b, group);
  group.position.set(b.x, 0, b.z);
  group.rotation.y = -b.rot * Math.PI / 180;
  group.userData = { buildingId: b.id };
  return group;
}

/* interior-only group, positioned like the building (Interior tab) */
export function buildInteriorOnly(b) {
  const group = new THREE.Group();
  buildInterior(b, group);
  group.position.set(b.x, 0, b.z);
  group.rotation.y = -b.rot * Math.PI / 180;
  group.userData = { buildingId: b.id };
  return group;
}

export function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        // shared cached materials must not be disposed; clones own their maps
        if (m === revealMat || m === glassMat || m === frameMat || m === doorMat ||
            m === slabMat || m === roofMat || m === dimLineMat || m === partitionMat) continue;
        if (m.map && m.map.image && m !== doorPanelMaterial().mat) m.map.dispose();
        if (m !== doorPanelMaterial().mat) m.dispose();
      }
    }
  });
}
