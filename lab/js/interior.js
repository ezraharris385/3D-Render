/* =========================================================
   Interior — building systems & buildouts tab. The shell
   comes straight from Studio (read-only here); this tab
   owns everything inside: power / utility / MEP systems
   and interior buildouts, with per-system visibility and a
   red systems-overlay view.
   ========================================================= */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  state, FT, INTERIOR_TYPES, SYS_GROUPS, classifySys,
  selectedBuilding, addInterior, floorBase, interiorOnFloor,
  toUI, fromUI, unitSuffix, fmtLen, save, loadProject,
} from "./state.js";
import { buildBuilding, buildInteriorOnly, disposeGroup } from "./builder.js";
import * as bridge from "../../js/bridge.js";

const $ = id => document.getElementById(id);

export function initInterior(shell) {

let renderer, scene, camera, controls;
let shellGroup = null;
let intGroup = null;
let helperBox = null;
let raycaster = new THREE.Raycaster();
// default Line threshold is a full meter of slop — space edge outlines
// would steal clicks from half a meter away
raycaster.params.Line = { threshold: 0.05 };
raycaster.params.Points = { threshold: 0.05 };
let pointer = new THREE.Vector2();
let dragging = null;

let activeFloor = 1;
let insideView = true;                 // this tab defaults to looking inside
let mode = "idle";                     // 'idle' | 'place' | 'wall'
let placeSpec = null;
let wallFirst = null;
let selectedId = null;                 // interior element id
const sysVisible = { power: true, utility: true, mep: true, buildout: true };
let redMode = false;
let lastBuildingId = null;             // detect shell swaps across tab switches
let loopFn = null;
let loopOn = true;

const bld = () => selectedBuilding() || state.buildings[0] || null;
function itemById(id) {
  const b = bld();
  return b ? (b.interior || []).find(i => i.id === id) || null : null;
}
function toLocal(b, wx, wz) {
  const th = b.rot * Math.PI / 180;
  const dx = wx - b.x, dz = wz - b.z;
  return { x: dx * Math.cos(th) + dz * Math.sin(th), z: -dx * Math.sin(th) + dz * Math.cos(th) };
}

/* ---------------- scene ---------------- */
function initScene() {
  const holder = $("interiorCanvasHolder");
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  holder.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c0f);
  scene.fog = new THREE.Fog(0x0a0c0f, 320, 900);

  camera = new THREE.PerspectiveCamera(48, 1, 0.25, 2000);
  camera.position.set(40, 45, 55);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 0.5; // walk right up to equipment
  controls.maxDistance = 500;
  controls.target.set(0, 2, 0);

  scene.add(new THREE.HemisphereLight(0xcdd8e6, 0x14161a, 0.9));
  const sun = new THREE.DirectionalLight(0xfff0dc, 1.9);
  sun.position.set(90, 130, 55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -160; sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
  sun.shadow.camera.far = 500;
  sun.shadow.bias = -0.0003;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8fa8c8, 0.55);
  fill.position.set(-70, 60, -90);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(700, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x121417, roughness: 0.97 })
  );
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(320, 64, 0x272d34, 0x1a1e23);
  grid.material.opacity = 0.45;
  grid.material.transparent = true;
  grid.position.y = 0.02;
  scene.add(grid);

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

/* ---------------- rebuild & styling ---------------- */
const RED = new THREE.Color(0xff3b30);
function rebuildShell() {
  if (shellGroup) { scene.remove(shellGroup); disposeGroup(shellGroup); shellGroup = null; }
  const b = bld();
  if (!b) return;
  shellGroup = buildBuilding(b, { withInterior: false });
  scene.add(shellGroup);
}
function rebuildInterior() {
  if (intGroup) { scene.remove(intGroup); disposeGroup(intGroup); intGroup = null; }
  if (helperBox) { scene.remove(helperBox); helperBox.dispose?.(); helperBox = null; }
  const b = bld();
  if (!b) { renderPanels(); return; }
  intGroup = buildInteriorOnly(b);
  // systems styling: visibility per group, red overlay mode.
  // Caps share their parent's userData, so style TOP-LEVEL meshes only —
  // otherwise the traverse re-shows/re-materials the caps it just hid.
  intGroup.traverse(o => {
    if (o.parent !== intGroup) return;
    const id = o.userData?.interiorId;
    if (!id || !o.material) return;
    const it = (b.interior || []).find(i => i.id === id);
    if (!it) return;
    const sys = it.sys || "buildout";
    const orphan = it.floor > b.stories; // shell shrank under this item
    o.visible = !orphan && sysVisible[sys] !== false;
    if (redMode && o.geometry) {
      if (sys === "buildout") {
        o.material = new THREE.MeshStandardMaterial({
          color: 0x6b7280, transparent: true, opacity: 0.18, roughness: 0.9, depthWrite: false,
        });
        o.castShadow = false;
      } else {
        o.material = new THREE.MeshStandardMaterial({
          color: RED, emissive: RED, emissiveIntensity: 0.35, roughness: 0.5,
        });
      }
      // hide the black cap accents in overlay mode
      for (const child of o.children) child.visible = false;
    }
  });
  scene.add(intGroup);
  if (selectedId) {
    const target = helperTargetFor(selectedId);
    if (target) {
      helperBox = new THREE.BoxHelper(target, 0xffd166);
      scene.add(helperBox);
    }
  }
  renderPanels();
}
/* what the selection outline should wrap: for a space, its floor pad —
   a BoxHelper on the volume would swallow the name-tag sprite's bounds */
function helperTargetFor(id) {
  if (!intGroup) return null;
  let top = null;
  intGroup.traverse(o => { if (!top && o.userData?.interiorId === id && o.parent === intGroup) top = o; });
  if (!top || top.visible === false) return null;
  const b = bld();
  const it = b ? (b.interior || []).find(i => i.id === id) : null;
  if (it?.space) {
    const pad = top.children.find(c => c.isMesh);
    if (pad) return pad;
  }
  return top;
}
function applyClip() {
  const b = bld();
  if (insideView && b) {
    const cutY = floorBase(b, activeFloor) + b.floorH * 0.9;
    renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), cutY)];
  } else {
    renderer.clippingPlanes = [];
  }
}
function changed() {
  rebuildInterior();
  save();
}

/* ---------------- picking & modes ---------------- */
function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}
function floorPlaneHit(b, floor) {
  const y = floorBase(b, floor) + 0.13;
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, p) ? p : null;
}
function pickInterior() {
  if (!intGroup) return null;
  // The opaque shell occludes clicks — but only below the doll-house cut
  // (the raycaster has no idea about clipping planes, so we filter by cutY).
  const b = bld();
  const targets = [...intGroup.children];
  if (shellGroup) targets.push(shellGroup);
  const hits = raycaster.intersectObjects(targets, true);
  const cutY = insideView && b ? floorBase(b, activeFloor) + b.floorH * 0.9 : Infinity;
  let ghostFallback = null;
  for (const h of hits) {
    if (h.point.y > cutY) continue;          // clipped away — visually absent
    // the raycaster ignores visibility, so skip hits on hidden nodes
    // (e.g. a red-mode-hidden name tag floating in "empty" air)
    let hidden = false;
    for (let v = h.object; v && v !== intGroup && v !== shellGroup; v = v.parent) {
      if (v.visible === false) { hidden = true; break; }
    }
    if (hidden) continue;
    let o = h.object;
    while (o && !o.userData?.interiorId) o = o.parent;
    if (!o) return ghostFallback;            // shell surface blocked the click
    while (o.parent && o.parent !== intGroup) o = o.parent; // cap/tag → its item mesh
    if (o.visible === false) continue;       // hidden system / orphan floor
    const it = (b?.interior || []).find(i => i.id === o.userData.interiorId);
    // room-scale zones and red-mode ghosts yield to solid items behind/inside them
    const yields = it?.space === true || (redMode && (it?.sys || "buildout") === "buildout");
    if (yields) {
      if (ghostFallback === null) ghostFallback = o.userData.interiorId;
      continue;
    }
    return o.userData.interiorId;
  }
  return ghostFallback;
}
function setMode(next, spec = null) {
  mode = next;
  if (spec) placeSpec = spec;
  wallFirst = null;
  renderer.domElement.style.cursor = next === "idle" ? "" : "crosshair";
  $("inPlaceBtn").classList.toggle("active", next === "place");
  $("inWallBtn").classList.toggle("active", next === "wall");
}

function onPointerDown(e) {
  if (e.button !== 0 || dragging) return;
  setPointer(e);
  const b = bld();
  if (!b) return;

  if (mode !== "idle") {
    const p = floorPlaneHit(b, activeFloor);
    if (!p) return;
    const l = toLocal(b, p.x, p.z);
    const snap = state.units === "ft" ? FT / 2 : 0.25;
    l.x = Math.round(l.x / snap) * snap;
    l.z = Math.round(l.z / snap) * snap;
    if (mode === "place" && placeSpec) {
      const it = addInterior(b, { ...placeSpec, kind: "item", floor: activeFloor, x: l.x, z: l.z });
      selectedId = it.id;
      setMode("idle");
      changed();
    } else if (mode === "wall") {
      if (!wallFirst) {
        wallFirst = l;
        shell.toast("First corner set — click the wall's end point");
      } else {
        const it = addInterior(b, { kind: "wall", floor: activeFloor, name: "Partition",
          x1: wallFirst.x, z1: wallFirst.z, x2: l.x, z2: l.z });
        selectedId = it.id;
        setMode("idle");
        changed();
      }
    }
    return;
  }

  const hitId = pickInterior();
  if (hitId) {
    selectedId = hitId;
    const it = itemById(hitId);
    if (it && it.kind === "item") {
      activeFloor = Math.min(it.floor, b.stories);
      applyClip();
      const planeY = floorBase(b, it.floor) + 0.13;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
      const p = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, p)) {
        const l = toLocal(b, p.x, p.z);
        let meshRef = null;
        intGroup.traverse(o => { if (!meshRef && o.userData?.interiorId === it.id && o.parent === intGroup && o.geometry?.type === "BoxGeometry") meshRef = o; });
        dragging = { id: it.id, pointerId: e.pointerId, offX: it.x - l.x, offZ: it.z - l.z, planeY, meshRef, moved: false };
        try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
        controls.enabled = false;
      }
    }
    rebuildHelperOnly();
    renderPanels();
  } else if (selectedId) {
    selectedId = null;
    rebuildHelperOnly();
    renderPanels();
  }
}
function rebuildHelperOnly() {
  if (helperBox) { scene.remove(helperBox); helperBox.dispose?.(); helperBox = null; }
  if (!selectedId || !intGroup) return;
  const target = helperTargetFor(selectedId);
  if (target) {
    helperBox = new THREE.BoxHelper(target, 0xffd166);
    scene.add(helperBox);
  }
}
function onPointerMove(e) {
  if (!dragging || e.pointerId !== dragging.pointerId) return;
  setPointer(e);
  const b = bld();
  const it = itemById(dragging.id);
  if (!b || !it) { dragging = null; controls.enabled = true; return; }
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -dragging.planeY);
  const p = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, p)) return;
  const l = toLocal(b, p.x, p.z);
  const snap = state.units === "ft" ? FT / 4 : 0.1;
  it.x = Math.round((l.x + dragging.offX) / snap) * snap;
  it.z = Math.round((l.z + dragging.offZ) / snap) * snap;
  dragging.moved = true;
  if (dragging.meshRef) dragging.meshRef.position.set(it.x, floorBase(b, it.floor) + 0.13 + it.h / 2, it.z);
  if (helperBox) helperBox.update();
}
function onPointerUp(e) {
  if (dragging && e && e.pointerId !== dragging.pointerId) return;
  if (dragging && dragging.moved) { renderList(); save(); }
  dragging = null;
  controls.enabled = true;
}

window.addEventListener("keydown", e => {
  if (shell.getTab() !== "interior") return;
  if (dragging) return; // a rebuild mid-drag would orphan the dragged mesh
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (e.key === "Escape" && mode !== "idle") { setMode("idle"); e.preventDefault(); return; }
  const b = bld();
  const it = selectedId ? itemById(selectedId) : null;
  if (!b || !it) return;
  const step = (e.shiftKey ? 5 : 1) * (state.units === "ft" ? FT : 0.5);
  let handled = true;
  if (it.kind === "item") {
    switch (e.key) {
      case "ArrowUp": it.z -= step; break;
      case "ArrowDown": it.z += step; break;
      case "ArrowLeft": it.x -= step; break;
      case "ArrowRight": it.x += step; break;
      case "q": case "Q": it.rot = (it.rot - (e.shiftKey ? 1 : 15) + 360) % 360; break;
      case "e": case "E": it.rot = (it.rot + (e.shiftKey ? 1 : 15)) % 360; break;
      case "Delete": case "Backspace":
        b.interior = b.interior.filter(x => x.id !== it.id);
        selectedId = null;
        changed();
        e.preventDefault(); e.stopPropagation();
        return;
      default: handled = false;
    }
  } else if (e.key === "Delete" || e.key === "Backspace") {
    b.interior = b.interior.filter(x => x.id !== it.id);
    selectedId = null;
    changed();
    e.preventDefault(); e.stopPropagation();
    return;
  } else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); changed(); }
}, true);

/* ---------------- panels ---------------- */
const PALETTE_GROUPS = [
  { key: "power",    label: SYS_GROUPS.power.label },
  { key: "mep",      label: SYS_GROUPS.mep.label },
  { key: "utility",  label: SYS_GROUPS.utility.label },
  { key: "space",    label: "Buildout — spaces" },
  { key: "buildout", label: "Buildout — fixtures & equipment" },
];
function paletteEntries() {
  const out = Object.entries(INTERIOR_TYPES).map(([key, t]) => ({
    value: "std:" + key,
    label: t.label,
    group: t.space ? "space" : classifySys(`${key} ${t.label}`),
    spec: { name: t.label, type: key, w: t.w, d: t.d, h: t.h, color: t.color,
            ...(t.space ? { space: true, sys: "buildout" } : {}) },
  }));
  bridge.getCatalog().forEach((row, i) => {
    if (row.kind !== "equipment") return;
    out.push({
      value: "cat:" + i,
      label: row.name + (row.brand ? ` — ${row.brand}` : ""),
      group: classifySys(`${row.type} ${row.name}`),
      spec: { name: row.name, brand: row.brand, type: row.type || "custom", w: row.w, d: row.d, h: row.h, color: row.color },
    });
  });
  return out;
}
function renderPalette() {
  const sel = $("inType");
  const prev = sel.value;
  sel.innerHTML = "";
  const entries = paletteEntries();
  for (const g of PALETTE_GROUPS) {
    const members = entries.filter(e => e.group === g.key)
      .sort((a, b) => a.label.localeCompare(b.label));
    if (!members.length) continue;
    const og = document.createElement("optgroup");
    og.label = g.label;
    for (const e of members) {
      const opt = document.createElement("option");
      opt.value = e.value;
      opt.textContent = e.label;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function renderPanels() {
  const b = bld();
  const has = !!b;
  $("inEmpty").style.display = has ? "none" : "";
  $("inControls").style.display = has ? "" : "none";
  if (!has) { $("inShellName").textContent = ""; return; }
  $("inShellName").textContent = `${b.name} — ${fmtLen(b.plan.w)} × ${fmtLen(b.plan.d)}, ${b.stories} ${b.stories === 1 ? "story" : "stories"}`;
  // floor chips
  activeFloor = Math.min(activeFloor, b.stories);
  const chips = $("inFloorChips");
  chips.innerHTML = "";
  for (let f = 1; f <= Math.min(b.stories, 10); f++) {
    const btn = document.createElement("button");
    btn.textContent = f;
    btn.classList.toggle("active", f === activeFloor);
    btn.addEventListener("click", () => {
      activeFloor = f;
      applyClip();
      renderPanels();
    });
    chips.appendChild(btn);
  }
  $("inInsideBtn").classList.toggle("active", insideView);
  // system toggles
  for (const sys of Object.keys(SYS_GROUPS)) {
    const btn = $("sys-" + sys);
    if (btn) btn.classList.toggle("active", sysVisible[sys]);
  }
  $("redModeBtn").classList.toggle("active", redMode);
  renderList();
  document.querySelectorAll("#interiorRoot .unitLbl").forEach(el => el.textContent = unitSuffix());
}

function renderList() {
  const b = bld();
  const list = $("inList");
  list.innerHTML = "";
  if (!b) return;
  const items = interiorOnFloor(b, activeFloor);
  if (!items.length) {
    list.innerHTML = `<div class="empty-note">Nothing on floor ${activeFloor} yet — place systems or draw walls.</div>`;
  }
  // grouped by system, spaces before fixtures, walls last, alphabetical within
  const rank = it => it.kind === "wall" ? 2 : it.space ? 0 : 1;
  for (const sys of Object.keys(SYS_GROUPS)) {
    const members = items.filter(it => (it.sys || "buildout") === sys)
      .sort((a, c) => rank(a) - rank(c) || a.name.localeCompare(c.name));
    if (!members.length) continue;
    const head = document.createElement("div");
    head.className = "sys-head";
    head.innerHTML = `<span class="b-swatch"></span><span></span>`;
    head.querySelector(".b-swatch").style.background = SYS_GROUPS[sys].color;
    head.querySelector("span:last-child").textContent = `${SYS_GROUPS[sys].label} (${members.length})`;
    list.appendChild(head);
    for (const it of members) {
      const el = document.createElement("div");
      el.className = "b-item" + (it.id === selectedId ? " selected" : "");
      el.innerHTML = `<span class="b-name"></span><span class="b-dims"></span><button class="b-del">✕</button>`;
      el.querySelector(".b-name").textContent =
        (it.kind === "wall" ? "▭ " : it.space ? "▢ " : "") + it.name + (it.brand ? ` — ${it.brand}` : "");
      el.querySelector(".b-dims").textContent = it.kind === "wall"
        ? fmtLen(Math.hypot(it.x2 - it.x1, it.z2 - it.z1))
        : `${fmtLen(it.w)}×${fmtLen(it.d)}×${fmtLen(it.h)}`;
      el.addEventListener("click", ev => {
        if (ev.target.classList.contains("b-del")) return;
        selectedId = it.id;
        rebuildHelperOnly();
        renderPanels();
        renderEditor();
      });
      el.querySelector(".b-del").addEventListener("click", () => {
        b.interior = b.interior.filter(x => x.id !== it.id);
        if (selectedId === it.id) selectedId = null;
        changed();
      });
      list.appendChild(el);
    }
  }
  const orphans = (b.interior || []).filter(i => i.floor > b.stories).length;
  if (orphans) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = `⚠ ${orphans} item${orphans === 1 ? "" : "s"} on floors above this ${b.stories}-story shell (hidden) — raise Stories in Studio to bring ${orphans === 1 ? "it" : "them"} back.`;
    list.appendChild(note);
  }
  renderEditor();
}

const setVal = (id, v) => {
  const el = $(id);
  if (document.activeElement !== el) el.value = v;
};
const round2 = v => Math.round(v * 100) / 100;
function renderEditor() {
  const ed = $("inEditor");
  const it = selectedId ? itemById(selectedId) : null;
  if (!it || it.kind !== "item") { ed.style.display = "none"; return; }
  ed.style.display = "";
  $("inSelName").textContent = `${it.name}${it.brand ? " — " + it.brand : ""} · ${SYS_GROUPS[it.sys || "buildout"].label}`;
  setVal("nW", round2(toUI(it.w)));
  setVal("nD", round2(toUI(it.d)));
  setVal("nH", round2(toUI(it.h)));
  setVal("nRot", Math.round(it.rot));
}

/* ---------------- project import (complete a saved shell here) ---------------- */
function renderProjPick() {
  const sel = $("inProjPick");
  const prev = sel.value;
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Import project from library…";
  sel.appendChild(ph);
  for (const p of bridge.listProjects()) {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = `${p.name} (${p.buildings.length} bldg${p.buildings.length === 1 ? "" : "s"})`;
    sel.appendChild(opt);
  }
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}
function importProject(name) {
  const p = bridge.listProjects().find(x => x.name === name);
  if (!p) return;
  if (state.buildings.length &&
      !confirm(`Replace the current building with “${name}”? Shell and interior both come from the saved project.`)) return;
  loadProject({ app: "render-lab", buildings: JSON.parse(JSON.stringify(p.buildings)) });
  save();
  // keep Studio's save/send flows pointed at the project now on deck —
  // otherwise its stale name field silently overwrites the wrong project
  const pn = document.getElementById("projName");
  if (pn) pn.value = name;
  selectedId = null;
  setMode("idle");
  activeFloor = 1;
  const b = bld();
  lastBuildingId = b ? b.id : null;
  rebuildShell();
  rebuildInterior();
  applyClip();
  if (b) frame();
  shell.toast(`Imported “${name}” — complete the interior here`);
}

/* ---------------- wiring ---------------- */
function wire() {
  renderPalette();
  bridge.onCatalogChanged(renderPalette);
  renderProjPick();
  bridge.onProjectsChanged(renderProjPick);
  $("inProjLoadBtn").addEventListener("click", () => {
    const name = $("inProjPick").value;
    if (!name) { shell.toast("Pick a saved project to import"); return; }
    importProject(name);
  });

  // switching the palette while place mode is armed re-arms with the new pick
  $("inType").addEventListener("change", () => {
    if (mode !== "place") return;
    const entry = paletteEntries().find(x => x.value === $("inType").value);
    if (entry) placeSpec = entry.spec;
  });

  $("inPlaceBtn").addEventListener("click", () => {
    if (mode === "place") { setMode("idle"); return; }
    const entry = paletteEntries().find(x => x.value === $("inType").value);
    if (!entry) return;
    setMode("place", entry.spec);
    shell.toast(`Click the floor to place “${entry.spec.name}” (Esc to cancel)`);
  });
  $("inWallBtn").addEventListener("click", () => {
    if (mode === "wall") { setMode("idle"); return; }
    setMode("wall");
    shell.toast("Partition wall: click the start point, then the end point (Esc to cancel)");
  });
  $("inInsideBtn").addEventListener("click", () => {
    insideView = !insideView;
    applyClip();
    renderPanels();
  });

  for (const sys of Object.keys(SYS_GROUPS)) {
    const btn = $("sys-" + sys);
    if (btn) {
      btn.addEventListener("click", () => {
        sysVisible[sys] = !sysVisible[sys];
        rebuildInterior();
      });
    }
  }
  $("redModeBtn").addEventListener("click", () => {
    redMode = !redMode;
    rebuildInterior();
  });

  const nField = (id, key) => {
    $(id).addEventListener("input", () => {
      const it = selectedId ? itemById(selectedId) : null;
      const v = parseFloat($(id).value);
      if (!it || it.kind !== "item" || !Number.isFinite(v)) return;
      if (key === "rot") it.rot = ((v % 360) + 360) % 360;
      else if (v > 0.02) it[key] = fromUI(v);
      changed();
    });
  };
  nField("nW", "w"); nField("nD", "d"); nField("nH", "h"); nField("nRot", "rot");
  $("inDelBtn").addEventListener("click", () => {
    const b = bld();
    if (b && selectedId) {
      b.interior = b.interior.filter(x => x.id !== selectedId);
      selectedId = null;
      changed();
    }
  });

  $("inFrameBtn").addEventListener("click", frame);
  $("inShotBtn").addEventListener("click", () => {
    renderer.render(scene, camera);
    const a = document.createElement("a");
    a.href = renderer.domElement.toDataURL("image/png");
    a.download = "interior.png";
    a.click();
    shell.toast("Screenshot downloaded");
  });
}

function frame() {
  const b = bld();
  if (!b) return;
  const r = Math.max(b.plan.w, b.plan.d);
  camera.position.set(b.x + r * 0.55, floorBase(b, activeFloor) + r * 0.8, b.z + r * 0.7);
  controls.target.set(b.x, floorBase(b, activeFloor) + 1, b.z);
}

/* ---------------- boot ---------------- */
initScene();
wire();
rebuildShell();
rebuildInterior();
applyClip();
lastBuildingId = bld() ? bld().id : null;
if (bld()) frame();

/* test hooks */
window.interiorLab = {
  state,
  get renderer() { return renderer; },
  get redMode() { return redMode; },
  get loopOn() { return loopOn; },
  get selectedId() { return selectedId; },
  sysVisible,
  scene, camera,
  get controls() { return controls; },
  setRed(v) { redMode = v; rebuildInterior(); },
  rebuildInterior, rebuildShell,
  intGroup: () => intGroup,
  helperBox: () => helperBox,
};

return {
  activate() {
    // shell may have changed in Studio — rebuild from state, but only
    // reset the user's view/selection when the building actually changed
    const b = bld();
    const swapped = !b || b.id !== lastBuildingId;
    lastBuildingId = b ? b.id : null;
    setMode("idle"); // never keep an armed place/wall mode across tab switches
    if (swapped) selectedId = null;
    if (b) activeFloor = Math.min(activeFloor, b.stories);
    rebuildShell();
    rebuildInterior();
    applyClip();
    renderPalette();
    if (b && swapped) frame();
  },
  setActive,
};

} // end initInterior
