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

/* ---------------- shared geodesy (Atlas + Earth) ---------------- */
export function wrapLng(lng) { return ((lng % 360) + 540) % 360 - 180; }
export function metersPerDegree(lat) {
  const p = lat * Math.PI / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lng: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p),
  };
}
export function siteToLngLat(x, z, site) {
  const th = site.rot * Math.PI / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const east = x * c + (-z) * s;
  const north = -x * s + (-z) * c;
  const m = metersPerDegree(site.lat);
  return [wrapLng(site.lng + east / m.lng), site.lat + north / m.lat];
}
/* per-building footprint rings (lng/lat, closed) for a placed site */
export function siteBuildingRings(site) {
  return site.buildings.map(bd => {
    const th = bd.rot * Math.PI / 180;
    const c = Math.cos(th), s = Math.sin(th);
    const ring = [[-bd.w / 2, -bd.d / 2], [bd.w / 2, -bd.d / 2], [bd.w / 2, bd.d / 2], [-bd.w / 2, bd.d / 2]]
      .map(([lx, lz]) => siteToLngLat(bd.x + lx * c - lz * s, bd.z + lx * s + lz * c, site));
    ring.push(ring[0]);
    return { ring, h: bd.h, color: bd.color, name: bd.name };
  });
}

/* ---------------- API keys ---------------- */
const KEYS_KEY = "engine-keys-v1";
export function getKeys() { return read(KEYS_KEY, {}); }
export function setKeys(patch) { write(KEYS_KEY, { ...getKeys(), ...patch }); }

/* ---------------- placed sites (Atlas) ---------------- */
export function getSites() {
  const arr = read(SITES_KEY, []);
  return Array.isArray(arr) ? arr : [];
}
export function setSites(sites) {
  write(SITES_KEY, sites);
}
