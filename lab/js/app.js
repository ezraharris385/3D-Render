/* =========================================================
   Studio — shell & exterior design. One building per
   project. Interiors live in the Interior tab; the shell
   built here is what that tab (and Atlas/Earth) recognize.
   ========================================================= */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  state, FT, MATERIALS, OPENING_TYPES, FACES, FACE_LABELS,
  selectedBuilding, buildingById, openingById, makeBuilding, addOpening, addInterior,
  removeBuilding, arrayOpenings, faceLength, wallHeight, totalHeight,
  fittedOpenings, openingFits,
  toUI, fromUI, unitSuffix, fmtLen,
  exportProject, loadProject, loadSaved, save, flushSave,
} from "./state.js";
import { buildBuilding, buildDims, disposeGroup } from "./builder.js";
import { TEMPLATES } from "./templates.js";
import * as bridge from "../../js/bridge.js";

const $ = id => document.getElementById(id);

export function initStudio(shell) {

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
let loopFn = null;
let loopOn = true;

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

  camera = new THREE.PerspectiveCamera(48, 1, 0.3, 2000);
  camera.position.set(52, 34, 58);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 0.6; // get right up against the facade
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

  loopFn = () => {
    controls.update();
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(loopFn);
}

/* the shell pauses hidden tabs so only the visible renderer draws */
function setActive(v) {
  if (v === loopOn) return;
  loopOn = v;
  renderer.setAnimationLoop(v ? loopFn : null);
}

/* ---------------- rebuild (shell only — interiors live in their tab) ---------------- */
function rebuildBuilding(id) {
  const old = buildingGroups.get(id);
  if (old) { scene.remove(old); disposeGroup(old); buildingGroups.delete(id); }
  const b = buildingById(id);
  if (!b) { refreshHelpers(); return; }
  const g = buildBuilding(b, { withInterior: false });
  scene.add(g);
  buildingGroups.set(id, g);
  refreshHelpers();
}
function rebuildAll() {
  for (const [, g] of buildingGroups) { scene.remove(g); disposeGroup(g); }
  buildingGroups.clear();
  for (const b of state.buildings) {
    const g = buildBuilding(b, { withInterior: false });
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
    if (!hit.openingId) {
      const p = groundHit();
      if (p) {
        dragging = { id: b.id, pointerId: e.pointerId, offX: b.x - p.x, offZ: b.z - p.z, moved: false };
        try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
        controls.enabled = false;
      }
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
  if (shell.getTab() !== "studio") return;
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
  if (state.buildings.length && !selectedBuilding()) state.selectedId = state.buildings[0].id;
  renderBuildingList();
  renderSelected();
  renderOpenings();
}

function renderBuildingList() {
  const list = $("buildingList");
  if (!list) return;
  list.innerHTML = "";
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
  document.querySelectorAll("#openingsSection [data-face]").forEach(btn =>
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
    el.querySelector(".b-name").textContent = (bad.includes(o) ? "⚠ " : "") + (o.label || t.label);
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

/* ---------------- catalog panel ---------------- */
let catManageOpen = false;
function renderCatalogPanel() {
  const holder = $("catList");
  holder.innerHTML = "";
  const rows = bridge.getCatalog();
  if (!rows.length) {
    holder.innerHTML = `<div class="empty-note">No custom data yet — upload a CSV of your equipment, window/door products, and building presets.</div>`;
    return;
  }
  const byKind = { equipment: 0, opening: 0, preset: 0 };
  rows.forEach(r => { byKind[r.kind] = (byKind[r.kind] || 0) + 1; });
  const summary = document.createElement("div");
  summary.className = "empty-note";
  summary.textContent = `${rows.length} entries — 🔧 ${byKind.equipment || 0} equipment · 🪟 ${byKind.opening || 0} openings · 🏢 ${byKind.preset || 0} presets`;
  holder.appendChild(summary);
  const KIND_ICON = { equipment: "🔧", opening: "🪟", preset: "🏢" };
  const det = document.createElement("details");
  det.open = catManageOpen;
  det.addEventListener("toggle", () => { catManageOpen = det.open; });
  const sum = document.createElement("summary");
  sum.textContent = "Manage entries";
  det.appendChild(sum);
  const box = document.createElement("div");
  box.className = "cat-rows";
  rows.forEach((row, i) => {
    const el = document.createElement("div");
    el.className = "b-item";
    el.innerHTML = `<span class="b-name"></span><span class="b-dims"></span><button class="b-del">✕</button>`;
    el.querySelector(".b-name").textContent = `${KIND_ICON[row.kind] || "•"} ${row.name}${row.brand ? " — " + row.brand : ""}`;
    el.querySelector(".b-dims").textContent = row.kind;
    el.querySelector(".b-del").addEventListener("click", () => bridge.removeCatalogRow(i));
    box.appendChild(el);
  });
  det.appendChild(box);
  holder.appendChild(det);
  const clearBtn = document.createElement("button");
  clearBtn.className = "danger wide";
  clearBtn.textContent = "Remove all catalog data";
  clearBtn.addEventListener("click", () => {
    if (confirm("Remove every uploaded catalog entry?")) bridge.setCatalog([]);
  });
  holder.appendChild(clearBtn);
}
function catalogChanged() {
  renderOpeningTypeOptions();
  renderTemplatePicker();
  renderCatalogPanel();
}

/* opening type dropdown: built-ins + catalog opening products */
function renderOpeningTypeOptions() {
  const sel = $("addType");
  const prev = sel.value;
  sel.innerHTML = "";
  const og1 = document.createElement("optgroup");
  og1.label = "Standard types";
  for (const [key, t] of Object.entries(OPENING_TYPES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = t.label;
    og1.appendChild(opt);
  }
  sel.appendChild(og1);
  const catRows = bridge.getCatalog();
  const hasProducts = catRows.some(r => r.kind === "opening");
  if (hasProducts) {
    const og2 = document.createElement("optgroup");
    og2.label = "Your products";
    catRows.forEach((row, i) => {
      if (row.kind !== "opening") return;
      const opt = document.createElement("option");
      opt.value = "cat:" + i;
      opt.textContent = `${row.name}${row.brand ? " — " + row.brand : ""} (${fmtLen(row.w)}×${fmtLen(row.h)})`;
      og2.appendChild(opt);
    });
    sel.appendChild(og2);
  }
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}
function resolveOpeningChoice(value) {
  if (value.startsWith("cat:")) {
    const row = bridge.getCatalog()[parseInt(value.slice(4), 10)];
    if (row && row.kind === "opening") {
      return { type: row.baseType, w: row.w, h: row.h,
        sill: row.sill ?? OPENING_TYPES[row.baseType].sill, label: row.name };
    }
    return { type: "fixed" };
  }
  return { type: value };
}

/* ---------------- template picker (asset dropdown → presets) ---------------- */
const ASSET_FILTERS = [
  { value: "multifamily", label: "Multifamily", match: ["multifamily", "mf", "apartment", "apartments", "residential", "condo", "condos", "student housing", "senior housing"] },
  { value: "retail", label: "Retail", match: ["retail", "strip", "strip center", "shopping", "shopping center", "store", "grocery", "restaurant"] },
  { value: "office", label: "Office", match: ["office", "medical office", "creative office"] },
  { value: "industrial", label: "Industrial", match: ["industrial", "warehouse", "flex", "logistics", "distribution", "manufacturing", "cold storage"] },
  { value: "datacenter", label: "Data Center", match: ["datacenter", "data center", "data-center", "dc"] },
];
/* every uploaded preset stays reachable: unrecognized types land in "Other uploads" */
function assetForPresetRow(row) {
  const t = (row.type || "").toLowerCase().trim();
  const hit = ASSET_FILTERS.find(a => a.match.includes(t));
  return hit ? hit.value : "other";
}

function startBuilding(spec) {
  if (state.buildings.length &&
      !confirm(`Replace the current building with “${spec.name}”? (Save the project first if you want to keep it.)`)) return;
  for (const old of [...state.buildings]) removeBuilding(old.id);
  makeBuilding({ ...spec, x: 0, z: 0 });
  editFace = "s";
  changedAll();
  frameSelected();
}

function presetOptionsFor(assetValue) {
  const out = [];
  const builtin = TEMPLATES[assetValue];
  if (builtin) out.push({ value: "std", label: `${builtin.icon} Standard ${builtin.label} template` });
  bridge.getCatalog().forEach((row, i) => {
    if (row.kind !== "preset") return;
    if (assetForPresetRow(row) !== assetValue) return;
    out.push({ value: "cat:" + i, label: `📦 ${row.name}${row.brand ? " — " + row.brand : ""}` });
  });
  return out;
}
function renderTemplatePicker() {
  const asset = $("assetFilter");
  const prevAsset = asset.value || "industrial";
  const entries = ASSET_FILTERS.map(a => ({ value: a.value, label: a.label }));
  if (bridge.getCatalog().some(r => r.kind === "preset" && assetForPresetRow(r) === "other"))
    entries.push({ value: "other", label: "Other uploads" });
  asset.innerHTML = "";
  for (const a of entries) {
    const opt = document.createElement("option");
    opt.value = a.value;
    opt.textContent = a.label;
    asset.appendChild(opt);
  }
  asset.value = entries.some(e => e.value === prevAsset) ? prevAsset : "industrial";
  const pick = $("presetPick");
  const prev = pick.value;
  pick.innerHTML = "";
  for (const o of presetOptionsFor(asset.value)) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    pick.appendChild(opt);
  }
  if ([...pick.options].some(o => o.value === prev)) pick.value = prev;
  $("presetCount").textContent = `${pick.options.length} option${pick.options.length === 1 ? "" : "s"}`;
}
function wireTemplatePicker() {
  renderTemplatePicker();
  $("assetFilter").addEventListener("change", renderTemplatePicker);
  $("startBtn").addEventListener("click", () => {
    const asset = $("assetFilter").value;
    const choice = $("presetPick").value;
    if (choice === "std") {
      const t = TEMPLATES[asset];
      if (t) startBuilding(t.make());
      return;
    }
    if (choice.startsWith("cat:")) {
      const row = bridge.getCatalog()[parseInt(choice.slice(4), 10)];
      if (!row || row.kind !== "preset") return;
      startBuilding({
        name: row.name, assetType: row.type || "custom",
        plan: { w: row.w, d: row.d }, stories: row.stories, floorH: row.floorH,
        parapet: row.parapet, material: MATERIALS[row.material] ? row.material : "concrete",
      });
    }
  });
}

/* ---------------- panel wiring ---------------- */
function wirePanels() {
  wireTemplatePicker();
  $("bDup").style.display = "none"; // one building per project

  $("bName").addEventListener("input", () => { const b = selectedBuilding(); if (b) { b.name = $("bName").value; save(); } });
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
  $("bDel").addEventListener("click", () => { const b = selectedBuilding(); if (b) { removeBuilding(b.id); changedAll(); } });

  // faces
  document.querySelectorAll("#openingsSection [data-face]").forEach(btn =>
    btn.addEventListener("click", () => {
      editFace = btn.dataset.face;
      state.selectedOpening = null;
      renderOpenings();
      refreshHelpers();
    }));

  // add opening (built-in types + catalog products)
  const typeSel = $("addType");
  renderOpeningTypeOptions();
  $("addOpeningBtn").addEventListener("click", () => {
    const b = selectedBuilding();
    if (!b) return;
    const choice = resolveOpeningChoice(typeSel.value);
    const t = OPENING_TYPES[choice.type];
    const w = choice.w ?? t.w, h = choice.h ?? t.h, sill = choice.sill ?? t.sill;
    const L = faceLength(b, editFace);
    const { ok } = fittedOpenings(b, editFace);
    let u = w / 2 + 0.6, found = false;
    while (u <= L - w / 2 - 0.3) {
      if (openingFits(b, { face: editFace, type: choice.type, u, sill, w, h }, ok)) { found = true; break; }
      u += 0.25;
    }
    const o = addOpening(b, { face: editFace, type: choice.type, u: found ? u : L / 2, w, h, sill });
    if (choice.label) o.label = choice.label;
    if (!found) toast("No free slot on this face — placed at center (flagged); move or resize it");
    state.selectedOpening = { bId: b.id, oId: o.id };
    changed(b.id);
  });
  $("arrayBtn").addEventListener("click", () => {
    const b = selectedBuilding();
    if (!b) return;
    const n = parseInt($("arrayCount").value, 10);
    if (!Number.isFinite(n) || n < 1) return;
    const choice = resolveOpeningChoice(typeSel.value);
    const made = arrayOpenings(b, editFace, choice.type, Math.min(n, 60), choice);
    if (choice.label && made > 0) {
      for (const o of b.openings.slice(-made)) o.label = choice.label;
    }
    changed(b.id);
  });
  $("clearFaceBtn").addEventListener("click", () => {
    const b = selectedBuilding();
    if (!b) return;
    b.openings = b.openings.filter(o => o.face !== editFace);
    state.selectedOpening = null;
    changed(b.id);
  });

  // opening editor (base types only)
  for (const [key, t] of Object.entries(OPENING_TYPES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = t.label;
    $("oType").appendChild(opt);
  }
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

  // catalog (shared store — feeds Studio pickers AND the Interior tab)
  renderCatalogPanel();
  bridge.onCatalogChanged(catalogChanged);
  $("catUploadBtn").addEventListener("click", () => $("catFile").click());
  $("catFile").addEventListener("change", e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      try {
        if (f.name.toLowerCase().endsWith(".json")) {
          const arr = JSON.parse(text);
          if (!Array.isArray(arr)) throw new Error("not a catalog array");
          bridge.setCatalog(bridge.getCatalog().concat(arr));
          toast(`Imported ${arr.length} catalog entr${arr.length === 1 ? "y" : "ies"}`);
        } else {
          const { added, skipped } = bridge.importCatalogCSV(text, state.units);
          toast(`Catalog: ${added} added${skipped ? `, ${skipped} skipped` : ""} — pickers updated`);
        }
      } catch (err) {
        toast("Couldn't read that file — CSV with a header row, or an exported catalog JSON");
      }
    };
    reader.readAsText(f);
  });
  $("catExportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(bridge.getCatalog(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "engine-catalog.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
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
    if (!confirm("Remove the current building?")) return;
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
  refreshHelpers();
  save();
}

function toast(msg) { shell.toast(msg); }

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

/* ---------------- project library + send to map ---------------- */
bridge.registerLive(() => JSON.parse(JSON.stringify(state.buildings)));

function renderProjLib() {
  const holder = $("projLibList");
  holder.innerHTML = "";
  for (const p of bridge.listProjects()) {
    const el = document.createElement("div");
    el.className = "b-item";
    el.innerHTML = `<span class="b-name"></span><span class="b-dims"></span><button class="load">Load</button><button class="b-del">✕</button>`;
    el.querySelector(".b-name").textContent = p.name;
    el.querySelector(".b-dims").textContent = `${p.buildings.length} bldg${p.buildings.length === 1 ? "" : "s"}`;
    el.querySelector(".load").addEventListener("click", () => {
      if (state.buildings.length && !confirm(`Replace the current work with “${p.name}”?`)) return;
      loadProject({ app: "render-lab", buildings: JSON.parse(JSON.stringify(p.buildings)) });
      setUnits(state.units);
      changedAll();
      frameSelected();
      $("projName").value = p.name;
      toast(`Loaded “${p.name}”`);
    });
    el.querySelector(".b-del").addEventListener("click", () => {
      bridge.deleteProject(p.name);
    });
    holder.appendChild(el);
  }
}
bridge.onProjectsChanged(renderProjLib);
renderProjLib();

function uniqueName(base) {
  const taken = new Set(bridge.listProjects().map(p => p.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
function resolveProjectName({ confirmOverwrite }) {
  let name = $("projName").value.trim();
  if (!name) {
    name = uniqueName("Untitled project");
  } else if (confirmOverwrite && bridge.listProjects().some(p => p.name === name)) {
    if (!confirm(`Overwrite the existing project “${name}”?`)) return null;
  }
  $("projName").value = name;
  return name;
}
$("projSaveBtn").addEventListener("click", () => {
  if (!state.buildings.length) { toast("Nothing to save yet"); return; }
  const name = resolveProjectName({ confirmOverwrite: true });
  if (!name) return;
  bridge.saveProject(name, state.buildings);
  toast(`“${name}” saved to the library`);
});
$("sendToMapBtn").addEventListener("click", () => {
  if (!state.buildings.length) { toast("Design a building first"); return; }
  const name = resolveProjectName({ confirmOverwrite: false });
  if (!name) return;
  bridge.saveProject(name, state.buildings);
  shell.requestPlacement({ name, massing: bridge.massing(state.buildings) });
});

/* test hooks */
window.lab = {
  state, makeBuilding, addOpening, addInterior, removeBuilding, arrayOpenings,
  rebuildAll, buildingGroups, scene, camera, controls,
  get renderer() { return renderer; },
  get loopOn() { return loopOn; },
  exportProject, loadProject, frameSelected, setUnits,
  fittedOpenings, faceLength, wallHeight, totalHeight,
  bridge, startBuilding,
};

return {
  // shell may change while on other tabs (Interior can import projects);
  // renderPanels picks a selection, so helpers must re-run after it
  refresh() { rebuildAll(); renderPanels(); refreshHelpers(); },
  setActive,
};

} // end initStudio
