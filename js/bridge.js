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

/* ---------------- placed sites (Atlas) ---------------- */
export function getSites() {
  const arr = read(SITES_KEY, []);
  return Array.isArray(arr) ? arr : [];
}
export function setSites(sites) {
  write(SITES_KEY, sites);
}
