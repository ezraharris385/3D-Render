/* =========================================================
   3D Site Lab — the Three.js design lab.
   ========================================================= */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  state, FT, SHAPES, DIM_LABELS, UTILITY_TYPES, BUILTIN_CATALOG,
  catalogAll, selectedItem, itemById, addItem, removeItem,
  toUI, fromUI, unitSuffix, fmtLen, fmtDims, itemHeight, utilityPath, utilityLength,
  importCatalogCSV, save,
} from "./state.js";

const $ = id => document.getElementById(id);

let renderer, scene, camera, controls;
let itemsGroup, utilGroup, gridGroup, human;
let raycaster = new THREE.Raycaster();
let pointer = new THREE.Vector2();
let groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

let labMode = "idle";          // 'idle' | 'place' | 'connect'
let placeTemplate = null;
let connectType = "electric";
let connectRoute = "ground";
let connectFirst = null;
let dragging = null;           // { id, offX, offZ } or { human: true }
let selectionHelper = null;
let onChanged = () => {};      // callback into main (autosave etc.)

const meshById = new Map();

/* ---------------- Scene setup ---------------- */
export function initLab(container, changedCb) {
  onChanged = changedCb;

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x141b23, 250, 900);

  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
  camera.position.set(38, 30, 38);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.minDistance = 3;
  controls.maxDistance = 600;
  controls.target.set(0, 2, 0);

  // sky dome
  const skyGeo = new THREE.SphereGeometry(900, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP;
      void main(){
        float t = clamp(vP.y / 450.0, 0.0, 1.0);
        vec3 hor = vec3(0.16, 0.21, 0.27);
        vec3 top = vec3(0.045, 0.075, 0.12);
        gl_FragColor = vec4(mix(hor, top, pow(t, 0.55)), 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // lights
  scene.add(new THREE.HemisphereLight(0xbdd3ea, 0x2a2f2a, 0.85));
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
  sun.position.set(120, 160, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -160; sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(800, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2b323a, roughness: 0.96, metalness: 0 })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  gridGroup = new THREE.Group();
  scene.add(gridGroup);
  rebuildGrid();

  itemsGroup = new THREE.Group();
  utilGroup = new THREE.Group();
  scene.add(itemsGroup, utilGroup);

  buildHuman();

  const el = renderer.domElement;
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp); // system gestures/palm rejection
  el.style.touchAction = "none";

  new ResizeObserver(() => resize(container)).observe(container);
  resize(container);

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  rebuildAllMeshes();
  rebuildUtilities();
}

function resize(container) {
  const w = container.clientWidth || 1, h = container.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

export function rebuildGrid() {
  while (gridGroup.children.length) {
    const c = gridGroup.children.pop();
    c.geometry.dispose(); c.material.dispose();
  }
  const minor = state.units === "ft" ? 5 * FT : 1;
  const major = state.units === "ft" ? 25 * FT : 10;
  // derive size from an even division count so cells are exactly one step
  // and a line passes through the origin — snapped items sit on gridlines
  const exactGrid = (step, c1, c2) => {
    let n = Math.round(400 / step);
    if (n % 2) n++;
    return new THREE.GridHelper(n * step, n, c1, c2);
  };
  const g1 = exactGrid(minor, 0x39434e, 0x323b45);
  g1.material.opacity = 0.35; g1.material.transparent = true;
  g1.position.y = 0.02;
  const g2 = exactGrid(major, 0x4d5a68, 0x46525f);
  g2.material.opacity = 0.55; g2.material.transparent = true;
  g2.position.y = 0.03;
  gridGroup.add(g1, g2);
}

function buildHuman() {
  human = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xe8b06a, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 1.05, 6, 12), mat);
  body.position.y = 0.74;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), mat);
  head.position.y = 1.63;
  body.castShadow = head.castShadow = true;
  human.add(body, head);
  human.position.set(4, 0, 4);
  human.userData.isHuman = true;
  human.visible = true;
  scene.add(human);
}
export function setHumanVisible(v) { human.visible = v; }

/* ---------------- Item meshes ---------------- */
function materialFor(color) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.55,
    metalness: 0.25,
  });
}

function buildItemMesh(item) {
  const g = new THREE.Group();
  const d = item.dims;
  const mat = materialFor(item.color);
  const add = (geo, y, extraMat) => {
    const m = new THREE.Mesh(geo, extraMat || mat);
    m.position.y = y;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  switch (item.shape) {
    case "box":
      add(new THREE.BoxGeometry(d.w, d.h, d.d), d.h / 2);
      break;
    case "cyl-v":
      add(new THREE.CylinderGeometry(d.dia / 2, d.dia / 2, d.h, 32), d.h / 2);
      break;
    case "silo": {
      const coneH = Math.min(d.dia * 0.35, d.h * 0.25);
      add(new THREE.CylinderGeometry(d.dia / 2, d.dia / 2, d.h - coneH, 32), (d.h - coneH) / 2);
      add(new THREE.ConeGeometry(d.dia / 2 * 1.02, coneH, 32), d.h - coneH / 2);
      break;
    }
    case "cyl-h": {
      const lift = d.dia * 0.15;
      const cyl = add(new THREE.CylinderGeometry(d.dia / 2, d.dia / 2, d.len, 28), d.dia / 2 + lift);
      cyl.rotation.z = Math.PI / 2;
      const sadMat = new THREE.MeshStandardMaterial({ color: 0x3c444d, roughness: 0.8 });
      const sw = d.dia * 0.55, sh = d.dia / 2 + lift;
      add(new THREE.BoxGeometry(d.dia * 0.25, sh, sw), sh / 2, sadMat).position.x = -d.len / 4;
      add(new THREE.BoxGeometry(d.dia * 0.25, sh, sw), sh / 2, sadMat).position.x = d.len / 4;
      break;
    }
    case "sphere": {
      add(new THREE.SphereGeometry(d.dia / 2, 28, 20), d.dia / 2);
      const legMat = new THREE.MeshStandardMaterial({ color: 0x3c444d, roughness: 0.8 });
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        const leg = add(new THREE.CylinderGeometry(0.06 * d.dia, 0.06 * d.dia, d.dia * 0.5, 8), d.dia * 0.25, legMat);
        leg.position.x = Math.cos(a) * d.dia * 0.32;
        leg.position.z = Math.sin(a) * d.dia * 0.32;
      }
      break;
    }
  }
  g.position.set(item.x, 0, item.z);
  g.rotation.y = -item.rot * Math.PI / 180;   // rot is clockwise in top view
  g.userData.itemId = item.id;
  return g;
}

function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

export function rebuildItemMesh(id) {
  const old = meshById.get(id);
  if (old) { itemsGroup.remove(old); disposeGroup(old); meshById.delete(id); }
  const item = itemById(id);
  if (!item) { refreshSelectionHelper(); return; }
  const mesh = buildItemMesh(item);
  itemsGroup.add(mesh);
  meshById.set(id, mesh);
  refreshSelectionHelper();
}

export function rebuildAllMeshes() {
  for (const [, m] of meshById) { itemsGroup.remove(m); disposeGroup(m); }
  meshById.clear();
  for (const item of state.items) {
    const mesh = buildItemMesh(item);
    itemsGroup.add(mesh);
    meshById.set(item.id, mesh);
  }
  refreshSelectionHelper();
}

export function syncItemTransform(item) {
  const m = meshById.get(item.id);
  if (m) {
    m.position.set(item.x, 0, item.z);
    m.rotation.y = -item.rot * Math.PI / 180;
  }
  refreshSelectionHelper();
}

function refreshSelectionHelper() {
  if (selectionHelper) { scene.remove(selectionHelper); selectionHelper.dispose?.(); selectionHelper = null; }
  const it = selectedItem();
  if (!it) return;
  const mesh = meshById.get(it.id);
  if (!mesh) return;
  selectionHelper = new THREE.BoxHelper(mesh, 0x4da3ff);
  scene.add(selectionHelper);
}

/* ---------------- Utility pipes ---------------- */
function pipeSegment(p1, p2, radius, mat) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  if (len < 1e-6) return null;
  const geo = new THREE.CylinderGeometry(radius, radius, len, 10);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  return mesh;
}

export function rebuildUtilities() {
  while (utilGroup.children.length) {
    const c = utilGroup.children.pop();
    disposeGroup(c);
  }
  const R = 0.09;
  for (const u of state.utilities) {
    const path = utilityPath(u);
    if (!path) continue;
    const h = u.route === "overhead" ? 4.5 : 0.22;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(UTILITY_TYPES[u.type].color),
      roughness: 0.4, metalness: 0.3,
    });
    const g = new THREE.Group();
    const pts3 = path.map(([x, z]) => new THREE.Vector3(x, h, z));
    for (let i = 1; i < pts3.length; i++) {
      const seg = pipeSegment(pts3[i - 1], pts3[i], R, mat);
      if (seg) g.add(seg);
    }
    for (const p of pts3) {
      const el = new THREE.Mesh(new THREE.SphereGeometry(R * 1.35, 10, 8), mat);
      el.position.copy(p);
      el.castShadow = true;
      g.add(el);
    }
    if (u.route === "overhead") {
      for (const p of [pts3[0], pts3[pts3.length - 1]]) {
        const post = pipeSegment(new THREE.Vector3(p.x, 0, p.z), p, R * 0.8, mat);
        if (post) g.add(post);
      }
    }
    utilGroup.add(g);
  }
}

/* ---------------- Picking & interaction ---------------- */
function setPointerFromEvent(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}
function groundHit() {
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
}
function pickItem() {
  const hits = raycaster.intersectObjects(itemsGroup.children, true);
  for (const h of hits) {
    let o = h.object;
    while (o && o.userData.itemId === undefined) o = o.parent;
    if (o) return o.userData.itemId;
  }
  return null;
}
function pickHuman() {
  return human.visible && raycaster.intersectObject(human, true).length > 0;
}

const snapStep = () => state.units === "ft" ? FT : 0.5;   // 1 ft / 0.5 m
function maybeSnap(v) {
  if (!state.snap) return v;
  const s = snapStep();
  return Math.round(v / s) * s;
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  if (dragging) return; // a second touch must not hijack an active drag
  setPointerFromEvent(e);

  if (labMode === "place" && placeTemplate) {
    const p = groundHit();
    if (p) {
      addItem(placeTemplate, maybeSnap(p.x), maybeSnap(p.z));
      setLabMode("idle");
      fullRefresh();
    }
    return;
  }

  const id = pickItem();

  if (labMode === "connect") {
    if (id !== null) {
      if (connectFirst !== null && !itemById(connectFirst)) {
        connectFirst = null; // first endpoint was deleted mid-connect — restart
      }
      if (connectFirst === null) {
        connectFirst = id;
        state.selectedId = id;
        fullRefresh();
        banner(`First: ${itemById(id).name} — now click the second equipment`);
      } else if (id !== connectFirst) {
        state.utilities.push({
          id: state.nextUtilId++,
          type: connectType, route: connectRoute,
          aId: connectFirst, bId: id,
        });
        setLabMode("idle");
        fullRefresh();
      }
    }
    return;
  }

  if (id !== null) {
    state.selectedId = id;
    const item = itemById(id);
    const p = groundHit();
    dragging = p ? { id, pointerId: e.pointerId, offX: item.x - p.x, offZ: item.z - p.z } : null;
    if (dragging) try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* non-fatal */ }
    controls.enabled = false;
    fullRefresh();
  } else if (pickHuman()) {
    dragging = { humanDrag: true, pointerId: e.pointerId };
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* non-fatal */ }
    controls.enabled = false;
  } else if (state.selectedId !== null) {
    state.selectedId = null;
    fullRefresh();
  }
}

function onPointerMove(e) {
  if (!dragging || e.pointerId !== dragging.pointerId) return;
  setPointerFromEvent(e);
  const p = groundHit();
  if (!p) return;
  if (dragging.humanDrag) {
    human.position.set(p.x, 0, p.z);
    return;
  }
  const item = itemById(dragging.id);
  if (!item) { dragging = null; controls.enabled = true; return; }
  item.x = maybeSnap(p.x + dragging.offX);
  item.z = maybeSnap(p.z + dragging.offZ);
  syncItemTransform(item);
  rebuildUtilities();
  renderSelectedPanel();
}

function onPointerUp(e) {
  if (dragging && e && e.pointerId !== dragging.pointerId) return; // other finger lifted
  if (dragging && !dragging.humanDrag) onChanged();
  dragging = null;
  controls.enabled = true;
}

/* ---------------- Modes & UI ---------------- */
export function setLabMode(next, opts = {}) {
  labMode = next;
  connectFirst = null;
  if (next === "place") placeTemplate = opts.template || placeTemplate;
  if (next === "connect") { connectType = opts.type || connectType; connectRoute = opts.route || connectRoute; }
  renderer.domElement.style.cursor = next === "idle" ? "" : "crosshair";
  $("connectBtn").classList.toggle("active", next === "connect");
  if (next === "place") banner(`Click the ground to place “${placeTemplate.name}” (Esc to cancel)`);
  else if (next === "connect") banner(`${UTILITY_TYPES[connectType].label} run — click the first equipment (Esc to cancel)`);
  else banner(null);
}
export function getLabMode() { return labMode; }

function banner(text) {
  const el = $("labBanner");
  if (!text) { el.style.display = "none"; return; }
  el.style.display = "";
  el.textContent = text;
}

export function fullRefresh() {
  rebuildAllMeshes();
  rebuildUtilities();
  renderCatalog();
  renderItemList();
  renderSelectedPanel();
  renderUtilList();
  onChanged();
}

/* selection changed elsewhere (e.g. map mode) — sync lab UI */
export function syncSelectionUI() {
  refreshSelectionHelper();
  renderItemList();
  renderSelectedPanel();
}

/* connect dropdowns changed while connect mode is armed */
export function updateConnectParams(type, route) {
  connectType = type;
  connectRoute = route;
  if (labMode === "connect" && connectFirst === null) {
    banner(`${UTILITY_TYPES[connectType].label} run — click the first equipment (Esc to cancel)`);
  }
}

/* light refresh after transform-only changes */
export function transformRefresh(item) {
  syncItemTransform(item);
  rebuildUtilities();
  renderSelectedPanel();
  renderItemList();
  onChanged();
}

/* ---------------- Panel rendering ---------------- */
export function renderCatalog() {
  const holder = $("catalogList");
  holder.innerHTML = "";
  for (const t of catalogAll()) {
    const custom = String(t.id).startsWith("c");
    const el = document.createElement("div");
    el.className = "cat-item";
    el.innerHTML = `<span class="b-swatch"></span><span class="cat-name"></span><span class="cat-dims"></span>${custom ? '<button class="b-del" title="Remove from library">✕</button>' : ""}`;
    el.querySelector(".b-swatch").style.background = t.color;
    el.querySelector(".cat-name").textContent = t.name;
    el.querySelector(".cat-dims").textContent = fmtDims(t);
    el.title = "Click, then click the ground to place";
    el.addEventListener("click", e => {
      if (e.target.classList.contains("b-del")) return;
      setLabMode("place", { template: t });
    });
    if (custom) {
      el.querySelector(".b-del").addEventListener("click", () => {
        state.customCatalog = state.customCatalog.filter(c => c.id !== t.id);
        renderCatalog();
        onChanged();
      });
    }
    holder.appendChild(el);
  }
}

export function renderItemList() {
  const list = $("itemList");
  list.innerHTML = "";
  if (!state.items.length) {
    list.innerHTML = `<div class="empty-note">Nothing placed yet — pick equipment from the library, then click the ground.</div>`;
    return;
  }
  for (const it of state.items) {
    const el = document.createElement("div");
    el.className = "b-item" + (it.id === state.selectedId ? " selected" : "");
    el.innerHTML = `<span class="b-swatch"></span><span class="b-name"></span><span class="b-dims"></span><button class="b-del" title="Delete">✕</button>`;
    el.querySelector(".b-swatch").style.background = it.color;
    el.querySelector(".b-name").textContent = it.name;
    el.querySelector(".b-dims").textContent = fmtDims(it);
    el.addEventListener("click", e => {
      if (e.target.classList.contains("b-del")) return;
      state.selectedId = it.id;
      controls.target.set(it.x, itemHeight(it) / 2, it.z);
      fullRefresh();
    });
    el.querySelector(".b-del").addEventListener("click", () => {
      removeItem(it.id);
      fullRefresh();
    });
    list.appendChild(el);
  }
}

export function renderSelectedPanel() {
  const sec = $("selectedSection");
  const it = selectedItem();
  if (!it) { sec.style.display = "none"; return; }
  sec.style.display = "";
  const setVal = (id, v) => {
    const el = $(id);
    if (document.activeElement !== el) el.value = v;
  };
  setVal("selName", it.name);
  setVal("selColor", it.color);
  setVal("selRot", Math.round(it.rot));
  $("selRotVal").textContent = Math.round(it.rot);

  // dimension inputs adapt to shape
  const dimsHolder = $("selDims");
  const wanted = SHAPES[it.shape].dims;
  if (dimsHolder.dataset.shape !== it.shape) {
    dimsHolder.dataset.shape = it.shape;
    dimsHolder.innerHTML = "";
    for (const k of wanted) {
      const wrap = document.createElement("div");
      wrap.innerHTML = `<label class="small">${DIM_LABELS[k]} (<span class="unitLbl"></span>)</label><input type="number" min="0.1" step="0.5" data-dim="${k}">`;
      dimsHolder.appendChild(wrap);
    }
    dimsHolder.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("input", () => {
        const item = selectedItem();
        const v = parseFloat(inp.value);
        if (item && Number.isFinite(v) && v > 0) {
          item.dims[inp.dataset.dim] = fromUI(v);
          rebuildItemMesh(item.id);
          rebuildUtilities();
          renderItemList();
          onChanged();
        }
      });
    });
  }
  dimsHolder.querySelectorAll(".unitLbl").forEach(el => el.textContent = unitSuffix());
  dimsHolder.querySelectorAll("input").forEach(inp => {
    if (document.activeElement !== inp) {
      inp.value = Math.round(toUI(it.dims[inp.dataset.dim]) * 10) / 10;
    }
  });
}

export function renderUtilList() {
  const list = $("utilList");
  list.innerHTML = "";
  if (!state.utilities.length) {
    list.innerHTML = `<div class="empty-note">No utility runs yet.</div>`;
    return;
  }
  for (const u of state.utilities) {
    const a = itemById(u.aId), b = itemById(u.bId);
    if (!a || !b) continue;
    const el = document.createElement("div");
    el.className = "b-item util-item";
    el.innerHTML = `<span class="b-swatch"></span><span class="b-name"></span><span class="b-dims"></span><button class="b-del" title="Delete">✕</button>`;
    el.querySelector(".b-swatch").style.background = UTILITY_TYPES[u.type].color;
    el.querySelector(".b-name").textContent = `${UTILITY_TYPES[u.type].label} · ${a.name} → ${b.name}`;
    el.querySelector(".b-dims").textContent = fmtLen(utilityLength(u)) + (u.route === "overhead" ? " ⤴" : "");
    el.querySelector(".b-del").addEventListener("click", () => {
      state.utilities = state.utilities.filter(x => x.id !== u.id);
      rebuildUtilities();
      renderUtilList();
      onChanged();
    });
    list.appendChild(el);
  }
}

/* ---------------- Views & extras ---------------- */
export function viewIso() {
  const c = sceneCenter();
  camera.position.set(c.x + 38, 30, c.z + 38);
  controls.target.set(c.x, 2, c.z);
}
export function viewTop() {
  const c = sceneCenter();
  camera.position.set(c.x, Math.max(60, sceneRadius() * 2.2), c.z + 0.01);
  controls.target.set(c.x, 0, c.z);
}
function sceneCenter() {
  if (!state.items.length) return { x: 0, z: 0 };
  let sx = 0, sz = 0;
  for (const it of state.items) { sx += it.x; sz += it.z; }
  return { x: sx / state.items.length, z: sz / state.items.length };
}
function sceneRadius() {
  const c = sceneCenter();
  let r = 20;
  for (const it of state.items) {
    r = Math.max(r, Math.hypot(it.x - c.x, it.z - c.z) + 10);
  }
  return r;
}

export function labScreenshot() {
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/png");
}

/* ---------------- Keyboard (called from main) ---------------- */
export function labKeydown(e) {
  if (e.key === "Escape") { setLabMode("idle"); return true; }
  const it = selectedItem();
  if (!it) return false;
  const step = (e.shiftKey ? 5 : 1) * (state.units === "ft" ? FT : 0.5);
  let handled = true;
  switch (e.key) {
    case "ArrowUp": it.z -= step; break;
    case "ArrowDown": it.z += step; break;
    case "ArrowLeft": it.x -= step; break;
    case "ArrowRight": it.x += step; break;
    case "q": case "Q": it.rot = (it.rot - (e.shiftKey ? 1 : 15) + 360) % 360; break;
    case "e": case "E": it.rot = (it.rot + (e.shiftKey ? 1 : 15)) % 360; break;
    case "d": case "D":
      if (e.ctrlKey || e.metaKey) {
        const fp = it.shape === "box" ? it.dims.w : (it.dims.len || it.dims.dia);
        addItem({ ...it, rot: it.rot }, it.x + fp + 2, it.z);
        fullRefresh();
        return true;
      }
      handled = false; break;
    case "Delete": case "Backspace":
      removeItem(it.id);
      fullRefresh();
      return true;
    default: handled = false;
  }
  if (handled) transformRefresh(it);
  return handled;
}

/* test hooks */
export const _test = {
  get scene() { return scene; },
  get camera() { return camera; },
  get renderer() { return renderer; },
  meshById,
};
