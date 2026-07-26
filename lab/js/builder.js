/* =========================================================
   Studio — building geometry. Walls are ExtrudeGeometry
   shapes with real window holes; texture UVs are in shape
   meters so material patterns render at true size.
   ========================================================= */
import * as THREE from "three";
import {
  FACES, OPENING_TYPES, faceLength, wallHeight, bodyHeight, ridgeHeight,
  isGableFace, fittedOpenings, fmtLen, totalHeight,
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
    const base = (it.floor - 1) * b.floorH + 0.13; // sit on the slab
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

/* ---------------- top-level ---------------- */
export function buildBuilding(b, { withInterior = true } = {}) {
  const group = new THREE.Group();
  for (const face of FACES) buildFace(b, face, group);
  buildRoof(b, group);
  buildSlabs(b, group);
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
