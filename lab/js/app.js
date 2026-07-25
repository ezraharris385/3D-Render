/* =========================================================
   Studio — 3D rendering lab: scene, interaction, panels.
   ========================================================= */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  state, FT, MATERIALS, OPENING_TYPES, FACES, FACE_LABELS,
  selectedBuilding, buildingById, openingById, makeBuilding, addOpening,
  removeBuilding, arrayOpenings, faceLength, wallHeight, totalHeight,
  fittedOpenings, openingFits,
  toUI, fromUI, unitSuffix, fmtLen,
  exportProject, loadProject, loadSaved, save, flushSave,
} from "./state.js";
import { buildBuilding, buildDims, disposeGroup } from "./builder.js";
import { TEMPLATES } from "./templates.js";

const $ = id => document.getElementById(id);

let renderer, scene, camera, controls, human;
let buildingGroups = new Map();
let dimsGroup = null;
let selBox = null;
let openingBox = null;
let raycaster = new THREE.Raycaster();
let pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let dragging = null;
let editFace = "s";

/* ---------------- scene ---------------- */
function initScene() {
  const holder = $("canvasHolder");
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  holder.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d10);
  scene.fog = new THREE.Fog(0x0b0d10, 320, 900);

  camera = new THREE.PerspectiveCamera(48, 1, 0.5, 2000); // near 0.5 keeps depth precision high
  camera.position.set(52, 34, 58);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 2;
  controls.maxDistance = 500;
  controls.target.set(0, 5, 0);

  scene.add(new THREE.HemisphereLight(0xcdd8e6, 0x14161a, 0.75));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
  sun.position.set(90, 130, 55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -140; sun.shadow.camera.right = 140;
  sun.shadow.camera.top = 140; sun.shadow.camera.bottom = -140;
  sun.shadow.camera.far = 500;
  sun.shadow.bias = -0.0003;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x6f87a8, 0.5);
  rim.position.set(-70, 50, -90);
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(700, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.97 })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(320, 64, 0x2b3138, 0x1d2126);
  grid.material.opacity = 0.5;
  grid.material.transparent = true;
  grid.position.y = 0.02;
  scene.add(grid);

  // human scale figure (6 ft)
  human = new THREE.Group();
  const hm = new THREE.MeshStandardMaterial({ color: 0xe8b06a, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 1.05, 6, 12), hm);
  body.position.y = 0.74;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), hm);
  head.position.y = 1.63;
  body.castShadow = head.castShadow = true;
  human.add(body, head);
  human.position.set(6, 0, 8);
  scene.add(human);

  const el = renderer.domElement;
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.style.touchAction = "none";

  new ResizeObserver(() => {
    const w = holder.clientWidth || 1, h = holder.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }).observe(holder);

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}

/* ---------------- rebuild ---------------- */
function rebuildBuilding(id) {
  const old = buildingGroups.get(id);
  if (old) { scene.remove(old); disposeGroup(old); buildingGroups.delete(id); }
  const b = buildingById(id);
  if (!b) { refreshHelpers(); return; }
  const g = buildBuilding(b);
  scene.add(g);
  buildingGroups.set(id, g);
  refreshHelpers();
}
function rebuildAll() {
  for (const [, g] of buildingGroups) { scene.remove(g); disposeGroup(g); }
  buildingGroups.clear();
  for (const b of state.buildings) {
    const g = buildBuilding(b);
    scene.add(g);
    buildingGroups.set(b.id, g);
  }
  refreshHelpers();
}
function refreshHelpers() {
  if (selBox) { scene.remove(selBox); selBox.dispose?.(); selBox = null; }
  if (openingBox) { scene.remove(openingBox); openingBox.dispose?.(); openingBox = null; }
  if (dimsGroup) { scene.remove(dimsGroup); disposeGroup(dimsGroup); dimsGroup = null; }
  const b = selectedBuilding();
  if (!b) return;
  const g = buildingGroups.get(b.id);
  if (g) {
    selBox = new THREE.BoxHelper(g, 0x4da3ff);
    scene.add(selBox);
  }
  if (state.showDims) {
    dimsGroup = buildDims(b);
    dimsGroup.position.set(b.x, 0, b.z);
    dimsGroup.rotation.y = -b.rot * Math.PI / 180;
    scene.add(dimsGroup);
  }
  if (state.selectedOpening && state.selectedOpening.bId === b.id && g) {
    let target = null;
    g.traverse(o => { if (o.userData && o.userData.openingId === state.selectedOpening.oId && !target) target = o; });
    if (target) {
      openingBox = new THREE.BoxHelper(target, 0xffd166);
      scene.add(openingBox);
    }
  }
}

/* cheap transform-only sync during drags/nudges — no rebuild */
function syncHelpers(b) {
  if (dimsGroup) {
    dimsGroup.position.set(b.x, 0, b.z);
    dimsGroup.rotation.y = -b.rot * Math.PI / 180;
  }
  if (selBox) selBox.update();
  if (openingBox) openingBox.update();
}

/* ---------------- interaction ---------------- */
function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}
function groundHit() {
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
}
function pick() {
  const targets = [...buildingGroups.values()];
  const hits = raycaster.intersectObjects(targets, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData?.buildingId) o = o.parent;
    if (o) return { buildingId: o.userData.buildingId, openingId: findOpeningId(h.object) };
  }
  return null;
}
function findOpeningId(obj) {
  let o = obj;
  while (o) {
    if (o.userData && o.userData.openingId) return o.userData.openingId;
    o = o.parent;
  }
  return null;
}

function onPointerDown(e) {
  if (e.button !== 0 || dragging) return;
  setPointer(e);
  const hit = pick();
  if (hit) {
    state.selectedId = hit.buildingId;
    state.selectedOpening = hit.openingId ? { bId: hit.buildingId, oId: hit.openingId } : null;
    if (hit.openingId) {
      const b = buildingById(hit.buildingId);
      const o = openingById(b, hit.openingId);
      if (o) editFace = o.face;
    }
    const b = buildingById(hit.buildingId);
    const p = groundHit();
    if (p && !hit.openingId) {
      dragging = { id: b.id, pointerId: e.pointerId, offX: b.x - p.x, offZ: b.z - p.z, moved: false };
      try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
      controls.enabled = false;
    }
    renderPanels();
    refreshHelpers();
  } else {
    const hp = raycaster.intersectObject(human, true);
    if (hp.length) {
      dragging = { humanDrag: true, pointerId: e.pointerId };
      try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
      controls.enabled = false;
    } else if (state.selectedId !== null || state.selectedOpening) {
      state.selectedId = null;
      state.selectedOpening = null;
      renderPanels();
      refreshHelpers();
    }
  }
}
function onPointerMove(e) {
  if (!dragging || e.pointerId !== dragging.pointerId) return;
  setPointer(e);
  const p = groundHit();
  if (!p) return;
  if (dragging.humanDrag) { human.position.set(p.x, 0, p.z); return; }
  const b = buildingById(dragging.id);
  if (!b) { dragging = null; controls.enabled = true; return; }
  const snap = state.units === "ft" ? FT : 0.5;
  b.x = Math.round((p.x + dragging.offX) / snap) * snap;
  b.z = Math.round((p.z + dragging.offZ) / snap) * snap;
  dragging.moved = true;
  const g = buildingGroups.get(b.id);
  if (g) g.position.set(b.x, 0, b.z);
  syncHelpers(b);
}
function onPointerUp(e) {
  if (dragging && e && e.pointerId !== dragging.pointerId) return;
  if (dragging && !dragging.humanDrag && dragging.moved) save();
  dragging = null;
  controls.enabled = true;
}

window.addEventListener("keydown", e => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  const b = selectedBuilding();
  if (!b) return;
  const step = (e.shiftKey ? 5 : 1) * (state.units === "ft" ? FT : 0.5);
  let handled = true;
  switch (e.key) {
    case "ArrowUp": b.z -= step; break;
    case "ArrowDown": b.z += step; break;
    case "ArrowLeft": b.x -= step; break;
    case "ArrowRight": b.x += step; break;
    case "q": case "Q": b.rot = (b.rot - (e.shiftKey ? 1 : 15) + 360) % 360; break;
    case "e": case "E": b.rot = (b.rot + (e.shiftKey ? 1 : 15)) % 360; break;
    case "Delete": case "Backspace":
      if (state.selectedOpening) {
        const bb = buildingById(state.selectedOpening.bId);
        if (bb) bb.openings = bb.openings.filter(o => o.id !== state.selectedOpening.oId);
        state.selectedOpening = null;
        changed(b.id);
      } else {
        removeBuilding(b.id);
        changedAll();
      }
      e.preventDefault(); e.stopPropagation();
      return;
    default: handled = false;
  }
  if (handled) {
    e.preventDefault(); e.stopPropagation();
    const g = buildingGroups.get(b.id);
    if (g) { g.position.set(b.x, 0, b.z); g.rotation.y = -b.rot * Math.PI / 180; }
    syncHelpers(b);
    renderPanels();
    save();
  }
}, true);

/* ---------------- change plumbing ---------------- */
function changed(id) {
  rebuildBuilding(id);
  renderPanels();
  save();
}
function changedAll() {
  rebuildAll();
  renderPanels();
  save();
}

/* ---------------- panels ---------------- */
function renderPanels() {
  renderBuildingList();
  renderSelected();
  renderOpenings();
}

function renderBuildingList() {
  const list = $("buildingList");
  list.innerHTML = "";
  if (!state.buildings.length) {
    list.innerHTML = `<div class="empty-note">No buildings yet — start from an asset template above.</div>`;
    return;
  }
  for (const b of state.buildings) {
    const el = document.createElement("div");
    el.className = "b-item" + (b.id === state.selectedId ? " selected" : "");
    el.innerHTML = `<span class="b-name"></span><span class="b-dims"></span><button class="b-del">✕</button>`;
    el.querySelector(".b-name").textContent = `${TEMPLATES[b.assetType]?.icon || "🏗️"} ${b.name}`;
    el.querySelector(".b-dims").textContent = `${fmtLen(b.plan.w)} × ${fmtLen(b.plan.d)}`;
    el.addEventListener("click", ev => {
      if (ev.target.classList.contains("b-del")) return;
      state.selectedId = b.id;
      state.selectedOpening = null;
      controls.target.set(b.x, totalHeight(b) / 2, b.z);
      renderPanels();
      refreshHelpers();
    });
    el.querySelector(".b-del").addEventListener("click", () => { removeBuilding(b.id); changedAll(); });
    list.appendChild(el);
  }
}

const setVal = (id, v) => {
  const el = $(id);
  if (document.activeElement !== el) el.value = v;
};

function renderSelected() {
  const sec = $("selectedSection");
  const b = selectedBuilding();
  if (!b) { sec.style.display = "none"; return; }
  sec.style.display = "";
  setVal("bName", b.name);
  setVal("bW", round2(toUI(b.plan.w)));
  setVal("bD", round2(toUI(b.plan.d)));
  setVal("bStories", b.stories);
  setVal("bFloorH", round2(toUI(b.floorH)));
  setVal("bParapet", round2(toUI(b.parapet)));
  setVal("bMaterial", b.material);
  setVal("bRoof", b.roof.type);
  setVal("bPitch", b.roof.pitch);
  setVal("bRidge", b.roof.ridge);
  setVal("bRot", Math.round(b.rot));
  $("bRotVal").textContent = Math.round(b.rot);
  $("bTotalH").textContent = fmtLen(totalHeight(b));
  $("pitchRow").style.display = b.roof.type === "gable" ? "" : "none";
  $("parapetRow").style.display = b.roof.type === "flat" ? "" : "none";
  document.querySelectorAll(".unitLbl").forEach(el => el.textContent = unitSuffix());
}
const round2 = v => Math.round(v * 100) / 100;

function renderOpenings() {
  const sec = $("openingsSection");
  const b = selectedBuilding();
  if (!b) { sec.style.display = "none"; return; }
  sec.style.display = "";
  document.querySelectorAll("[data-face]").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.face === editFace));
  $("faceInfo").textContent =
    `${FACE_LABELS[editFace]} — ${fmtLen(faceLength(b, editFace))} long, ${fmtLen(wallHeight(b, editFace))} tall`;

  const { ok, bad } = fittedOpenings(b, editFace);
  const list = $("openingList");
  list.innerHTML = "";
  const rows = [...ok, ...bad];
  if (!rows.length) list.innerHTML = `<div class="empty-note">No openings on this face.</div>`;
  for (const o of rows) {
    const t = OPENING_TYPES[o.type];
    const isSel = state.selectedOpening && state.selectedOpening.oId === o.id;
    const el = document.createElement("div");
    el.className = "b-item" + (isSel ? " selected" : "") + (bad.includes(o) ? " bad" : "");
    el.innerHTML = `<span class="b-name"></span><span class="b-dims"></span><button class="b-del">✕</button>`;
    el.querySelector(".b-name").textContent = (bad.includes(o) ? "⚠ " : "") + t.label;
    el.querySelector(".b-dims").textContent = `${fmtLen(o.w)}×${fmtLen(o.h)} @ ${fmtLen(o.u)}`;
    el.addEventListener("click", ev => {
      if (ev.target.classList.contains("b-del")) return;
      state.selectedOpening = { bId: b.id, oId: o.id };
      renderPanels();
      refreshHelpers();
    });
    el.querySelector(".b-del").addEventListener("click", () => {
      b.openings = b.openings.filter(x => x.id !== o.id);
      if (state.selectedOpening?.oId === o.id) state.selectedOpening = null;
      changed(b.id);
    });
    list.appendChild(el);
  }

  // selected opening editor
  const oSec = $("openingEditor");
  const sel = state.selectedOpening ? openingById(b, state.selectedOpening.oId) : null;
  if (!sel || sel.face !== editFace) { oSec.style.display = "none"; return; }
  oSec.style.display = "";
  setVal("oType", sel.type);
  setVal("oW", round2(toUI(sel.w)));
  setVal("oH", round2(toUI(sel.h)));
  setVal("oSill", round2(toUI(sel.sill)));
  setVal("oU", round2(toUI(sel.u)));
}

/* ---------------- panel wiring ---------------- */
function wirePanels() {
  // templates
  const holder = $("templateGrid");
  for (const [key, t] of Object.entries(TEMPLATES)) {
    const btn = document.createElement("button");
    btn.innerHTML = `<span class="t-icon">${t.icon}</span>${t.label}`;
    btn.addEventListener("click", () => {
      const spec = t.make();
      // place next to existing work
      let x = 0, z = 0;
      if (state.buildings.length) {
        const maxX = Math.max(...state.buildings.map(b => b.x + b.plan.w / 2));
        x = maxX + spec.plan.w / 2 + 6;
      }
      makeBuilding({ ...spec, x, z });
      editFace = "s";
      changedAll();
      frameSelected();
    });
    holder.appendChild(btn);
  }

  // building fields
  $("bName").addEventListener("input", () => { const b = selectedBuilding(); if (b) { b.name = $("bName").value; renderBuildingList(); save(); } });
  const numField = (id, apply) => {
    $(id).addEventListener("input", () => {
      const b = selectedBuilding();
      const v = parseFloat($(id).value);
      if (b && Number.isFinite(v)) { apply(b, v); changed(b.id); }
    });
  };
  numField("bW", (b, v) => { if (v > 0.5) b.plan.w = fromUI(v); });
  numField("bD", (b, v) => { if (v > 0.5) b.plan.d = fromUI(v); });
  numField("bStories", (b, v) => { if (v >= 1 && v <= 60) b.stories = Math.round(v); });
  numField("bFloorH", (b, v) => { if (v > 0.5) b.floorH = fromUI(v); });
  numField("bParapet", (b, v) => { if (v >= 0) b.parapet = fromUI(v); });
  numField("bPitch", (b, v) => { if (v > 0 && v <= 24) b.roof.pitch = v; });
  $("bMaterial").addEventListener("change", () => { const b = selectedBuilding(); if (b) { b.material = $("bMaterial").value; changed(b.id); } });
  $("bRoof").addEventListener("change", () => { const b = selectedBuilding(); if (b) { b.roof.type = $("bRoof").value; changed(b.id); } });
  $("bRidge").addEventListener("change", () => { const b = selectedBuilding(); if (b) { b.roof.ridge = $("bRidge").value; changed(b.id); } });
  $("bRot").addEventListener("input", () => {
    const b = selectedBuilding();
    if (b) {
      b.rot = parseFloat($("bRot").value) || 0;
      $("bRotVal").textContent = Math.round(b.rot);
      const g = buildingGroups.get(b.id);
      if (g) g.rotation.y = -b.rot * Math.PI / 180;
      syncHelpers(b);
      save();
    }
  });
  $("bDup").addEventListener("click", () => {
    const b = selectedBuilding();
    if (!b) return;
    const copy = JSON.parse(JSON.stringify(b));
    copy.name += " copy";
    copy.x = b.x + b.plan.w + 5;
    delete copy.id;
    makeBuilding(copy); // re-adds openings with fresh ids
    changedAll();
  });
  $("bDel").addEventListener("click", () => { const b = selectedBuilding(); if (b) { removeBuilding(b.id); changedAll(); } });

  // faces
  document.querySelectorAll("[data-face]").forEach(btn =>
    btn.addEventListener("click", () => {
      editFace = btn.dataset.face;
      state.selectedOpening = null;
      renderOpenings();
      refreshHelpers();
    }));

  // add opening
  const typeSel = $("addType");
  for (const [key, t] of Object.entries(OPENING_TYPES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = t.label;
    typeSel.appendChild(opt);
  }
  $("addOpeningBtn").addEventListener("click", () => {
    const b = selectedBuilding();
    if (!b) return;
    const type = typeSel.value;
    const t = OPENING_TYPES[type];
    const L = faceLength(b, editFace);
    // march the whole face for a free slot
    const { ok } = fittedOpenings(b, editFace);
    let u = t.w / 2 + 0.6, found = false;
    while (u <= L - t.w / 2 - 0.3) {
      if (openingFits(b, { face: editFace, type, u, sill: t.sill, w: t.w, h: t.h }, ok)) { found = true; break; }
      u += 0.25;
    }
    const o = addOpening(b, { face: editFace, type, u: found ? u : L / 2 });
    if (!found) toast("No free slot on this face — placed at center (flagged); move or resize it");
    state.selectedOpening = { bId: b.id, oId: o.id };
    changed(b.id);
  });
  $("arrayBtn").addEventListener("click", () => {
    const b = selectedBuilding();
    if (!b) return;
    const n = parseInt($("arrayCount").value, 10);
    if (!Number.isFinite(n) || n < 1) return;
    arrayOpenings(b, editFace, typeSel.value, Math.min(n, 60));
    changed(b.id);
  });
  $("clearFaceBtn").addEventListener("click", () => {
    const b = selectedBuilding();
    if (!b) return;
    b.openings = b.openings.filter(o => o.face !== editFace);
    state.selectedOpening = null;
    changed(b.id);
  });

  // opening editor
  $("oType").innerHTML = typeSel.innerHTML;
  $("oType").addEventListener("change", () => {
    const b = selectedBuilding();
    const o = state.selectedOpening && openingById(b, state.selectedOpening.oId);
    if (o) {
      o.type = $("oType").value;
      const t = OPENING_TYPES[o.type];
      o.w = t.w; o.h = t.h; o.sill = t.sill;
      changed(b.id);
    }
  });
  const oField = (id, key, min) => {
    $(id).addEventListener("input", () => {
      const b = selectedBuilding();
      const o = state.selectedOpening && openingById(b, state.selectedOpening.oId);
      const v = parseFloat($(id).value);
      if (o && Number.isFinite(v) && v >= min) { o[key] = fromUI(v); changed(b.id); }
    });
  };
  oField("oW", "w", 0.1);
  oField("oH", "h", 0.1);
  oField("oSill", "sill", 0);
  oField("oU", "u", 0);
  $("oDel").addEventListener("click", () => {
    const b = selectedBuilding();
    if (b && state.selectedOpening) {
      b.openings = b.openings.filter(x => x.id !== state.selectedOpening.oId);
      state.selectedOpening = null;
      changed(b.id);
    }
  });

  // view / project
  $("dimsBtn").addEventListener("click", () => {
    state.showDims = !state.showDims;
    $("dimsBtn").classList.toggle("active", state.showDims);
    refreshHelpers();
  });
  $("humanBtn").addEventListener("click", () => {
    human.visible = !human.visible;
    $("humanBtn").classList.toggle("active", human.visible);
  });
  $("isoBtn").addEventListener("click", frameSelected);
  $("frontBtn").addEventListener("click", () => {
    const b = selectedBuilding();
    const c = b ? { x: b.x, z: b.z } : { x: 0, z: 0 };
    const h = b ? totalHeight(b) : 10;
    const dist = b ? Math.max(b.plan.w, h * 2) : 40;
    camera.position.set(c.x, h * 0.6, c.z + dist);
    controls.target.set(c.x, h / 2, c.z);
  });
  $("topBtn").addEventListener("click", () => {
    const b = selectedBuilding();
    const c = b ? { x: b.x, z: b.z } : { x: 0, z: 0 };
    camera.position.set(c.x, 120, c.z + 0.01);
    controls.target.set(c.x, 0, c.z);
  });
  $("shotBtn").addEventListener("click", () => {
    renderer.render(scene, camera);
    const a = document.createElement("a");
    a.href = renderer.domElement.toDataURL("image/png");
    a.download = "studio.png";
    a.click();
    toast("Screenshot downloaded");
  });

  $("unitFt").addEventListener("click", () => setUnits("ft"));
  $("unitM").addEventListener("click", () => setUnits("m"));

  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(exportProject(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "render-lab-project.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (!loadProject(JSON.parse(String(reader.result)))) { toast("That file isn't a Render Lab project"); return; }
        setUnits(state.units);
        changedAll();
        frameSelected();
        toast(`Loaded ${state.buildings.length} building${state.buildings.length === 1 ? "" : "s"}`);
      } catch (err) { toast("Couldn't read that file"); }
    };
    reader.readAsText(f);
  });
  $("clearBtn").addEventListener("click", () => {
    if (!state.buildings.length) return;
    if (!confirm("Remove all buildings?")) return;
    state.buildings = [];
    state.selectedId = null;
    state.selectedOpening = null;
    changedAll();
  });
}

function frameSelected() {
  const b = selectedBuilding() || state.buildings[0];
  if (!b) return;
  const h = totalHeight(b);
  const r = Math.max(b.plan.w, b.plan.d, h * 1.6);
  camera.position.set(b.x + r * 0.9, h + r * 0.42, b.z + r * 0.95);
  controls.target.set(b.x, h * 0.45, b.z);
}

function setUnits(u) {
  state.units = u;
  $("unitFt").classList.toggle("active", u === "ft");
  $("unitM").classList.toggle("active", u === "m");
  renderPanels();
  refreshHelpers(); // dimension labels re-render in new units
  if (dimsGroup) { /* rebuilt in refreshHelpers */ }
  save();
}

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

/* ---------------- boot ---------------- */
window.addEventListener("pagehide", flushSave);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSave();
});

initScene();
wirePanels();
loadSaved();
setUnits(state.units);
$("dimsBtn").classList.toggle("active", state.showDims);
rebuildAll();
renderPanels();
if (state.buildings.length) frameSelected();

/* test hooks */
window.lab = {
  state, makeBuilding, addOpening, removeBuilding, arrayOpenings,
  rebuildAll, buildingGroups, scene, camera, controls,
  exportProject, loadProject, frameSelected, setUnits,
  fittedOpenings, faceLength, wallHeight, totalHeight,
};
