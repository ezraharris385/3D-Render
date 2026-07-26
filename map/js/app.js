/* =========================================================
   Atlas — 3D mapping system.
   MapLibre GL v5: 3D terrain (AWS terrarium DEM), Esri
   satellite/aerial imagery, OSM 3D buildings (OpenFreeMap
   vector tiles), globe, measuring, GeoJSON import.
   No API keys required for any default source.
   ========================================================= */
"use strict";
import * as bridge from "../../js/bridge.js";

const $ = id => document.getElementById(id);
const STORAGE_KEY = "atlas-map-v1";
const DEFAULT_VIEW = { center: [-89.384, 43.0747], zoom: 15.2, pitch: 55, bearing: -20 };

export function initAtlas(shell) {

let units = "ft"; // 'ft' | 'm'
let mode = "idle"; // 'idle' | 'dist' | 'area'
let measureKind = null; // what the CURRENT drawing is ('dist'|'area') — survives finishing
let measurePts = [];
let measureMarkers = [];
let importedLayers = []; // {id, name, color, opacity, extrude, count, kinds}
let savedViews = [];
let importSeq = 1;

/* ---------------- persistence ---------------- */
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ units, savedViews }));
  } catch (e) { /* non-fatal */ }
}
try {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  if (raw.units === "m" || raw.units === "ft") units = raw.units;
  if (Array.isArray(raw.savedViews)) savedViews = raw.savedViews;
} catch (e) { /* ignore */ }

/* ---------------- formatting ---------------- */
const FT = 0.3048;
function fmtDist(m) {
  if (units === "ft") {
    const ft = m / FT;
    return ft >= 5280 ? (ft / 5280).toFixed(2) + " mi" : Math.round(ft).toLocaleString() + " ft";
  }
  return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m).toLocaleString() + " m";
}
function fmtArea(m2) {
  if (units === "ft") {
    const sf = m2 / (FT * FT);
    return sf >= 43560 ? (sf / 43560).toFixed(2) + " ac" : Math.round(sf).toLocaleString() + " sq ft";
  }
  return m2 >= 10000 ? (m2 / 10000).toFixed(2) + " ha" : Math.round(m2).toLocaleString() + " m²";
}
function fmtElev(m) {
  return units === "ft" ? Math.round(m / FT).toLocaleString() + " ft" : Math.round(m).toLocaleString() + " m";
}

/* ---------------- geodesy ---------------- */
function haversine(a, b) {
  const R = 6371008.8, r = Math.PI / 180;
  const h = Math.sin((b[1] - a[1]) * r / 2) ** 2 +
    Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[0] - a[0]) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function ringAreaM2(ring) {
  // planar shoelace in local ENU meters — accurate at site scale
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const r = Math.PI / 180;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * lat0 * r) + 1.175 * Math.cos(4 * lat0 * r);
  const mLng = 111412.84 * Math.cos(lat0 * r) - 93.5 * Math.cos(3 * lat0 * r);
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const x1 = p[0] * mLng, y1 = p[1] * mLat, x2 = q[0] * mLng, y2 = q[1] * mLat;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/* ---------------- style ---------------- */
const style = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sky: {
    "sky-color": "#1a2b45",
    "horizon-color": "#7d92ab",
    "fog-color": "#5c6b80",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.7,
    "fog-ground-blend": 0.85,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 8, 0.4, 12, 0],
  },
  sources: {
    esriSat: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256, maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community",
    },
    cartoVoyager: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256, maxzoom: 19,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
    cartoDark: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256, maxzoom: 19,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
    esriTransport: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256, maxzoom: 19, attribution: "© Esri",
    },
    esriLabels: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256, maxzoom: 19, attribution: "Labels © Esri",
    },
    dem: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      encoding: "terrarium",
      tileSize: 256, maxzoom: 15,
      attribution: "Terrain: Mapzen/AWS, USGS, SRTM",
    },
    demHill: { // hillshade needs its own raster-dem source when terrain is active
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      encoding: "terrarium",
      tileSize: 256, maxzoom: 15,
    },
    omt: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      attribution: "© OpenMapTiles © OpenStreetMap contributors",
    },
    sites: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    measureLine: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    measureFill: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    measurePts: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0b0e12" } },
    { id: "base-streets", type: "raster", source: "cartoVoyager", layout: { visibility: "none" } },
    { id: "base-dark", type: "raster", source: "cartoDark", layout: { visibility: "none" } },
    { id: "base-sat", type: "raster", source: "esriSat" },
    { id: "hillshade", type: "hillshade", source: "demHill",
      paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#0b0e12" } },
    { id: "ov-transport", type: "raster", source: "esriTransport", layout: { visibility: "none" }, paint: { "raster-opacity": 0.9 } },
    { id: "ov-labels", type: "raster", source: "esriLabels", layout: { visibility: "none" }, paint: { "raster-opacity": 0.95 } },
    {
      id: "osm-3d", type: "fill-extrusion", source: "omt", "source-layer": "building", minzoom: 13,
      paint: {
        "fill-extrusion-color": [
          "interpolate", ["linear"], ["coalesce", ["get", "render_height"], 5],
          0, "#9aa7b4", 25, "#b8c4d0", 80, "#dbe4ec",
        ],
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 5],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.86,
      },
    },
    {
      id: "sites-3d", type: "fill-extrusion", source: "sites",
      paint: {
        "fill-extrusion-color": ["get", "color"],
        "fill-extrusion-height": ["get", "h"],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.92,
      },
    },
    {
      id: "sites-outline", type: "line", source: "sites",
      filter: ["==", ["get", "selected"], 1],
      paint: { "line-color": "#ffd166", "line-width": 2.5, "line-dasharray": [1.4, 1] },
    },
    { id: "measure-fill", type: "fill", source: "measureFill",
      paint: { "fill-color": "#4da3ff", "fill-opacity": 0.22 } },
    { id: "measure-line", type: "line", source: "measureLine",
      paint: { "line-color": "#7bd88f", "line-width": 2.5, "line-dasharray": [1.6, 1] } },
    { id: "measure-pts", type: "circle", source: "measurePts",
      paint: { "circle-radius": 4.5, "circle-color": "#7bd88f",
               "circle-stroke-color": "#062512", "circle-stroke-width": 1.5 } },
  ],
};

const map = new maplibregl.Map({
  container: "map",
  style,
  ...DEFAULT_VIEW,
  maxPitch: 80,
  antialias: true,
  preserveDrawingBuffer: true,
  attributionControl: { compact: true },
  cancelPendingTileRequestsWhileZooming: false,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
const scaleCtrl = new maplibregl.ScaleControl({ maxWidth: 140, unit: units === "ft" ? "imperial" : "metric" });
map.addControl(scaleCtrl, "bottom-right");
map.keyboard.disableRotation();

map.on("load", () => {
  setTerrain(true);
  renderSites();
  toast("Atlas ready — search a place or drop a GeoJSON on the map");
});

/* ---------------- terrain / view toggles ---------------- */
function setTerrain(on) {
  const ex = parseFloat($("exagSlider").value);
  map.setTerrain(on ? { source: "dem", exaggeration: ex } : null);
  $("ckTerrain").checked = on;
}
$("ckTerrain").addEventListener("change", () => setTerrain($("ckTerrain").checked));
$("exagSlider").addEventListener("input", () => {
  $("exagVal").textContent = parseFloat($("exagSlider").value).toFixed(1);
  if ($("ckTerrain").checked) setTerrain(true);
});
$("ckBuildings").addEventListener("change", () =>
  map.setLayoutProperty("osm-3d", "visibility", $("ckBuildings").checked ? "visible" : "none"));
$("ckHillshade").addEventListener("change", () =>
  map.setLayoutProperty("hillshade", "visibility", $("ckHillshade").checked ? "visible" : "none"));
$("ckGlobe").addEventListener("change", () =>
  map.setProjection({ type: $("ckGlobe").checked ? "globe" : "mercator" }));

/* ---------------- basemaps ---------------- */
const BASES = {
  sat: { layers: { "base-sat": true, "base-streets": false, "base-dark": false, "ov-labels": false, "ov-transport": false } },
  hybrid: { layers: { "base-sat": true, "base-streets": false, "base-dark": false, "ov-labels": true, "ov-transport": true } },
  streets: { layers: { "base-sat": false, "base-streets": true, "base-dark": false, "ov-labels": false, "ov-transport": false } },
  dark: { layers: { "base-sat": false, "base-streets": false, "base-dark": true, "ov-labels": false, "ov-transport": false } },
};
let currentBase = "sat";
function setBase(name) {
  currentBase = name;
  for (const [layer, vis] of Object.entries(BASES[name].layers)) {
    map.setLayoutProperty(layer, "visibility", vis ? "visible" : "none");
  }
  document.querySelectorAll("[data-base]").forEach(b =>
    b.classList.toggle("active", b.dataset.base === name));
}
document.querySelectorAll("[data-base]").forEach(b =>
  b.addEventListener("click", () => setBase(b.dataset.base)));

/* ---------------- search (Photon autocomplete) ---------------- */
let sugTimer = null, sugItems = [], sugHot = -1;
$("searchBox").addEventListener("input", () => {
  clearTimeout(sugTimer);
  const q = $("searchBox").value.trim();
  if (q.length < 3) { hideSug(); return; }
  sugTimer = setTimeout(() => fetchSug(q), 250);
});
$("searchBox").addEventListener("keydown", e => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!sugItems.length) return;
    sugHot = (sugHot + (e.key === "ArrowDown" ? 1 : -1) + sugItems.length) % sugItems.length;
    renderSug();
  } else if (e.key === "Enter") {
    const q = $("searchBox").value.trim();
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        flyToPlace({ lng, lat, name: `${lat}, ${lng}` });
        return;
      }
    }
    if (sugHot >= 0 && sugItems[sugHot]) pickSug(sugItems[sugHot]);
    else if (sugItems.length) pickSug(sugItems[0]);
    else if (q.length >= 3) {
      // suggestions haven't arrived yet — search directly
      clearTimeout(sugTimer);
      fetchSug(q).then(items => {
        if (items.length) pickSug(items[0]);
        else toast("No results for that search");
      });
    }
  } else if (e.key === "Escape") hideSug();
});
let sugSeq = 0;
async function fetchSug(q) {
  const seq = ++sugSeq;
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6`);
    if (!res.ok) return [];
    const data = await res.json();
    if (seq !== sugSeq) return []; // a newer query superseded this response
    sugItems = (data.features || []).map(f => ({
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      name: f.properties.name || "",
      detail: [f.properties.street, f.properties.city, f.properties.state, f.properties.country]
        .filter(Boolean).join(", "),
      extent: f.properties.extent,
    }));
    sugHot = -1;
    renderSug();
    return sugItems;
  } catch (e) { return []; /* offline */ }
}
function renderSug() {
  const el = $("suggestions");
  if (!sugItems.length) { hideSug(); return; }
  el.style.display = "";
  el.innerHTML = "";
  sugItems.forEach((s, i) => {
    const d = document.createElement("div");
    d.className = "sug" + (i === sugHot ? " hot" : "");
    d.innerHTML = `<span></span><small></small>`;
    d.querySelector("span").textContent = s.name || s.detail;
    d.querySelector("small").textContent = s.detail;
    d.addEventListener("mousedown", e => { e.preventDefault(); pickSug(s); });
    el.appendChild(d);
  });
}
function hideSug() { $("suggestions").style.display = "none"; sugItems = []; sugHot = -1; }
function pickSug(s) {
  $("searchBox").value = s.name || s.detail;
  hideSug();
  flyToPlace(s);
}
function flyToPlace(s) {
  if (s.extent && s.extent.length === 4) {
    // Photon extents are [minLon, maxLat, maxLon, minLat] — normalize to SW/NE
    const [a, b, c, d] = s.extent;
    map.fitBounds([[Math.min(a, c), Math.min(b, d)], [Math.max(a, c), Math.max(b, d)]],
      { padding: 60, pitch: 45, duration: 2200, maxZoom: 17.5 });
  } else {
    map.flyTo({ center: [s.lng, s.lat], zoom: 16.5, pitch: 50, duration: 2200 });
  }
  toast(s.name || "Here");
}
document.addEventListener("click", e => {
  if (!e.target.closest(".searchwrap")) hideSug();
});

/* ---------------- measuring ---------------- */
function setMode(next, { clear = true } = {}) {
  mode = next;
  if (next === "dist" || next === "area") {
    measurePts = [];
    measureKind = next;
  } else if (clear) {
    measurePts = [];
    measureKind = null;
  }
  updateMeasure();
  $("measureDistBtn").classList.toggle("active", mode === "dist");
  $("measureAreaBtn").classList.toggle("active", mode === "area");
  map.getCanvas().style.cursor = mode === "idle" ? "" : "crosshair";
  const b = $("modeBanner");
  if (mode === "idle") { b.style.display = "none"; return; }
  b.style.display = "";
  b.textContent = mode === "dist"
    ? "Click points to measure distance — double-click or Esc to finish"
    : "Click the corners of an area — double-click or Esc to finish";
}
/* finish = exit the tool but KEEP the drawing (double-click and Esc) */
function finishMeasure() {
  if (mode !== "dist" && mode !== "area") return;
  setMode("idle", { clear: measurePts.length < 2 });
}
$("measureDistBtn").addEventListener("click", () => setMode(mode === "dist" ? "idle" : "dist"));
$("measureAreaBtn").addEventListener("click", () => setMode(mode === "area" ? "idle" : "area"));
$("measureClearBtn").addEventListener("click", () => { setMode("idle"); $("measureOut").style.display = "none"; });

function updateMeasure() {
  const line = map.getSource("measureLine");
  if (!line) return;
  const coords = measurePts.map(p => [p.lng, p.lat]);
  const isArea = measureKind === "area";
  const closed = isArea && coords.length > 2 ? [...coords, coords[0]] : coords;
  line.setData({
    type: "FeatureCollection",
    features: coords.length > 1
      ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: closed } }]
      : [],
  });
  map.getSource("measureFill").setData({
    type: "FeatureCollection",
    features: isArea && coords.length > 2
      ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] } }]
      : [],
  });
  map.getSource("measurePts").setData({
    type: "FeatureCollection",
    features: coords.map(c => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } })),
  });
  measureMarkers.forEach(m => m.remove());
  measureMarkers = [];
  const out = $("measureOut");
  if (coords.length < 2) { out.style.display = "none"; return; }
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1], coords[i]);
    total += d;
    const el = document.createElement("div");
    el.className = "measure-label";
    el.textContent = fmtDist(d);
    measureMarkers.push(new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([(coords[i - 1][0] + coords[i][0]) / 2, (coords[i - 1][1] + coords[i][1]) / 2])
      .addTo(map));
  }
  out.style.display = "";
  if (measureKind === "area" && coords.length > 2) {
    const area = ringAreaM2(coords);
    const perim = total + haversine(coords[coords.length - 1], coords[0]);
    out.innerHTML = `<b>Area:</b> ${fmtArea(area)}<br><b>Perimeter:</b> ${fmtDist(perim)}`;
    const c = coords.reduce((s, p) => [s[0] + p[0] / coords.length, s[1] + p[1] / coords.length], [0, 0]);
    const el = document.createElement("div");
    el.className = "measure-label area-label";
    el.textContent = fmtArea(area);
    measureMarkers.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(c).addTo(map));
  } else {
    out.innerHTML = `<b>Total:</b> ${fmtDist(total)}`;
  }
}

let suppressNextClick = false;
map.on("mousedown", () => { suppressNextClick = false; });
map.on("click", e => {
  if (suppressNextClick) { suppressNextClick = false; return; }
  hideCtx();
  if (mode === "dist" || mode === "area") {
    measurePts.push(e.lngLat);
    updateMeasure();
    return;
  }
  if (mode === "place" && pendingProject) {
    placeSiteAt(e.lngLat);
    return;
  }
  if (mode === "idle" && selectedSiteId !== null) {
    const hits = map.queryRenderedFeatures(e.point, { layers: ["sites-3d"] });
    if (!hits.length) { selectedSiteId = null; renderSites(); }
  }
});
map.on("dblclick", e => {
  if (mode !== "idle") {
    e.preventDefault();
    if (measurePts.length > 1) measurePts.pop(); // drop the double-click duplicate
    finishMeasure(); // keeps the drawing, re-renders without the duplicate
  }
});

/* ---------------- Studio sites (placed projects) ---------------- */
let sites = bridge.getSites();
let selectedSiteId = null;
let nextSiteId = sites.reduce((m, s) => Math.max(m, s.id + 1), 1);
let pendingProject = null;
let siteDrag = null;
let siteMarkers = new Map();

function wrapLng(lng) { return ((lng % 360) + 540) % 360 - 180; }
function metersPerDegree(lat) {
  const p = lat * Math.PI / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lng: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p),
  };
}
/* studio plane (x east, z south) -> lng/lat via site anchor + rotation (deg CW) */
function siteToLngLat(x, z, site) {
  const th = site.rot * Math.PI / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const e0 = x, n0 = -z;
  const east = e0 * c + n0 * s;
  const north = -e0 * s + n0 * c;
  const m = metersPerDegree(site.lat);
  return [wrapLng(site.lng + east / m.lng), site.lat + north / m.lat];
}
function bldgRing(bd, site) {
  const th = bd.rot * Math.PI / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const pts = [[-bd.w / 2, -bd.d / 2], [bd.w / 2, -bd.d / 2], [bd.w / 2, bd.d / 2], [-bd.w / 2, bd.d / 2]]
    .map(([lx, lz]) => [bd.x + lx * c - lz * s, bd.z + lx * s + lz * c]);
  const ring = pts.map(([x, z]) => siteToLngLat(x, z, site));
  ring.push(ring[0]);
  return ring;
}

/* geometry + markers only — safe to call at input-event rates */
function renderSitesGeo() {
  const src = map.getSource("sites");
  if (!src) return;
  const fc = { type: "FeatureCollection", features: [] };
  for (const site of sites) {
    for (const bd of site.buildings) {
      fc.features.push({
        type: "Feature",
        properties: {
          siteId: site.id, color: bd.color, h: bd.h,
          selected: site.id === selectedSiteId ? 1 : 0,
        },
        geometry: { type: "Polygon", coordinates: [bldgRing(bd, site)] },
      });
    }
  }
  src.setData(fc);
  // one name pill per site
  const live = new Set();
  for (const site of sites) {
    live.add(site.id);
    let mk = siteMarkers.get(site.id);
    if (!mk) {
      const el = document.createElement("div");
      el.className = "measure-label area-label";
      mk = new maplibregl.Marker({ element: el, anchor: "center", offset: [0, -18] })
        .setLngLat([site.lng, site.lat]).addTo(map);
      siteMarkers.set(site.id, mk);
    }
    mk.getElement().textContent = site.name;
    mk.setLngLat([site.lng, site.lat]);
  }
  for (const [id, mk] of siteMarkers) {
    if (!live.has(id)) { mk.remove(); siteMarkers.delete(id); }
  }
}
function renderSites() {
  renderSitesGeo();
  renderSiteList();
  bridge.setSites(sites);
}

function armPlacement(project) {
  pendingProject = project;
  setMode("idle");
  mode = "place";
  map.getCanvas().style.cursor = "crosshair";
  const b = $("modeBanner");
  b.style.display = "";
  b.textContent = `Click the map to place “${project.name}” (Esc to cancel)`;
}

function placeSiteAt(lngLat) {
  // re-resolve at click time so a re-save between arming and placing isn't stale
  const libEntry = bridge.listProjects().find(p => p.name === pendingProject.name);
  const site = {
    id: nextSiteId++,
    name: pendingProject.name,
    lng: wrapLng(lngLat.lng), lat: lngLat.lat, rot: 0,
    buildings: libEntry ? bridge.massing(libEntry.buildings) : pendingProject.massing,
  };
  sites.push(site);
  pendingProject = null;
  mode = "idle";
  map.getCanvas().style.cursor = "";
  $("modeBanner").style.display = "none";
  selectedSiteId = site.id;
  renderSites();
  toast(`“${site.name}” placed — drag to move, use its slider to line it up`);
}

function renderProjPanel() {
  const holder = $("projList");
  holder.innerHTML = "";
  const projects = bridge.listProjects();
  if (!projects.length) {
    holder.innerHTML = `<div class="lyr"><span class="meta">No saved projects yet — design in the Studio tab and hit “Send to Atlas map”.</span></div>`;
    return;
  }
  for (const p of projects) {
    const el = document.createElement("div");
    el.className = "lyr";
    el.innerHTML = `<div class="row"><span class="name"></span><span class="meta"></span><button class="place">📍 Place</button></div>`;
    el.querySelector(".name").textContent = p.name;
    el.querySelector(".meta").textContent = `${p.buildings.length} bldg${p.buildings.length === 1 ? "" : "s"}`;
    el.querySelector(".place").addEventListener("click", () =>
      armPlacement({ name: p.name, massing: bridge.massing(p.buildings) }));
    holder.appendChild(el);
  }
}
bridge.onProjectsChanged(renderProjPanel);

function renderSiteList() {
  const holder = $("siteList");
  holder.innerHTML = "";
  for (const site of sites) {
    const el = document.createElement("div");
    el.className = "lyr";
    const sel = site.id === selectedSiteId;
    el.innerHTML = `
      <div class="row">
        <span class="name" style="cursor:pointer"></span>
        <button class="zoom" title="Zoom to site">⌖</button>
        <button class="mini" title="Remove from map">✕</button>
      </div>
      ${sel ? `<div class="row"><label class="small">Rotation — <span class="rv"></span>°</label></div>
      <input type="range" class="rot" min="0" max="359" step="1" value="${Math.round(site.rot)}">` : ""}`;
    el.querySelector(".name").textContent = (sel ? "▸ " : "") + site.name;
    el.querySelector(".name").addEventListener("click", () => {
      selectedSiteId = sel ? null : site.id;
      renderSites();
    });
    el.querySelector(".zoom").addEventListener("click", () => {
      selectedSiteId = site.id;
      map.flyTo({ center: [site.lng, site.lat], zoom: 17.5, pitch: 55, duration: 1400 });
      renderSites();
    });
    el.querySelector(".mini").addEventListener("click", () => {
      sites = sites.filter(s => s !== site);
      if (selectedSiteId === site.id) selectedSiteId = null;
      renderSites();
    });
    if (sel) {
      const rv = el.querySelector(".rv");
      rv.textContent = Math.round(site.rot);
      el.querySelector(".rot").addEventListener("input", ev => {
        site.rot = parseFloat(ev.target.value) || 0;
        rv.textContent = Math.round(site.rot);
        renderSitesGeo(); // don't rebuild the list mid-drag
      });
      el.querySelector(".rot").addEventListener("change", () => bridge.setSites(sites));
    }
    holder.appendChild(el);
  }
}

/* drag a placed site by any of its buildings */
map.on("mousedown", "sites-3d", e => {
  if (mode !== "idle" || !e.features.length) return;
  if (e.originalEvent && e.originalEvent.button !== 0) return;
  e.preventDefault();
  const site = sites.find(s => s.id === e.features[0].properties.siteId);
  if (!site) return;
  selectedSiteId = site.id;
  siteDrag = { site, startLngLat: e.lngLat, origLng: site.lng, origLat: site.lat, moved: false };
  map.getCanvas().style.cursor = "grabbing";
  renderSites();
});
map.on("mousemove", e => {
  if (!siteDrag) return;
  siteDrag.site.lng = wrapLng(siteDrag.origLng + (e.lngLat.lng - siteDrag.startLngLat.lng));
  siteDrag.site.lat = siteDrag.origLat + (e.lngLat.lat - siteDrag.startLngLat.lat);
  siteDrag.moved = true;
  renderSitesGeo(); // list + persistence wait for drag end
});
const endSiteDrag = () => {
  if (siteDrag && siteDrag.moved) {
    suppressNextClick = true;
    bridge.setSites(sites);
  }
  siteDrag = null;
  map.getCanvas().style.cursor = mode === "idle" ? "" : "crosshair";
};
map.on("mouseup", endSiteDrag);
window.addEventListener("mouseup", () => { if (siteDrag) endSiteDrag(); });
map.on("mouseenter", "sites-3d", () => {
  if (mode === "idle" && !siteDrag) map.getCanvas().style.cursor = "grab";
});
map.on("mouseleave", "sites-3d", () => {
  if (!siteDrag) map.getCanvas().style.cursor = mode === "idle" ? "" : "crosshair";
});

/* ---------------- context menu ---------------- */
const ctx = $("ctxMenu");
map.on("contextmenu", e => {
  const { lng, lat } = e.lngLat;
  ctx.style.display = "";
  ctx.innerHTML = "";
  const add = (label, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", () => { hideCtx(); fn(); });
    ctx.appendChild(b);
  };
  add(`📋 Copy ${lat.toFixed(6)}, ${lng.toFixed(6)}`, () => {
    navigator.clipboard?.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    toast("Coordinates copied");
  });
  add("📏 Measure from here", () => { setMode("dist"); measurePts = [e.lngLat]; updateMeasure(); });
  add("🎯 Center here", () => map.easeTo({ center: e.lngLat, duration: 600 }));
  // position after populating so we can clamp to the window
  const rect = map.getContainer().getBoundingClientRect();
  const left = Math.min(rect.left + e.point.x + 2, window.innerWidth - ctx.offsetWidth - 8);
  const top = Math.min(rect.top + e.point.y + 2, window.innerHeight - ctx.offsetHeight - 8);
  ctx.style.left = Math.max(4, left) + "px";
  ctx.style.top = Math.max(4, top) + "px";
});
function hideCtx() { ctx.style.display = "none"; }
document.addEventListener("click", e => { if (!e.target.closest("#ctxMenu")) hideCtx(); });

/* ---------------- status bar ---------------- */
let elevPending = false;
map.on("mousemove", e => {
  $("stCoords").textContent = `${e.lngLat.lat.toFixed(6)}, ${e.lngLat.lng.toFixed(6)}`;
  if (!elevPending) {
    elevPending = true;
    requestAnimationFrame(() => {
      elevPending = false;
      const el = map.terrain ? map.queryTerrainElevation(e.lngLat) : null;
      $("stElev").textContent = el === null || el === undefined ? "elev —" : "elev " + fmtElev(el / (map.terrain?.exaggeration || 1));
    });
  }
});
map.on("move", () => {
  $("stZoom").textContent = "z " + map.getZoom().toFixed(1);
  $("stCam").textContent = `${Math.round((map.getBearing() + 360) % 360)}° / ${Math.round(map.getPitch())}°`;
});

/* ---------------- GeoJSON import ---------------- */
$("importGeoBtn").addEventListener("click", () => $("geoFile").click());
$("geoFile").addEventListener("change", e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (f) importGeoFile(f);
});
document.addEventListener("drop", e => {
  if (shell.getTab() !== "atlas") return; // shell owns preventDefault globally
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) importGeoFile(f);
});

function importGeoFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const gj = JSON.parse(String(reader.result));
      addGeoLayer(gj, file.name.replace(/\.(geo)?json$/i, ""));
    } catch (err) {
      toast("Couldn't parse that file as GeoJSON");
    }
  };
  reader.readAsText(file);
}

const PALETTE = ["#e4b34a", "#7bd88f", "#e97fd0", "#ff8b5e", "#9a8cff", "#5ad7d2"];
function heightOf(props) {
  if (!props) return null;
  for (const k of ["height", "render_height", "Height", "HEIGHT", "bldg_height"]) {
    const v = parseFloat(props[k]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  for (const k of ["levels", "building:levels", "stories", "STORIES"]) {
    const v = parseFloat(props[k]);
    if (Number.isFinite(v) && v > 0) return v * 3.1;
  }
  return null;
}
function addGeoLayer(gj, name) {
  const features = gj.type === "FeatureCollection" ? gj.features
    : gj.type === "Feature" ? [gj]
    : gj.type ? [{ type: "Feature", properties: {}, geometry: gj }] : null;
  if (!features || !features.length) { toast("No features found in that file"); return; }

  const kinds = new Set();
  let heightCount = 0;
  for (const f of features) {
    if (!f.geometry) continue;
    const t = f.geometry.type;
    kinds.add(t.replace("Multi", ""));
    f.properties = f.properties || {};
    const h = heightOf(f.properties);
    if (h !== null) { f.properties.__h = h; heightCount++; }
  }
  const id = "user-" + importSeq++;
  const color = PALETTE[(importSeq - 2) % PALETTE.length];
  const extrude = kinds.has("Polygon") && heightCount > 0;
  map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features } });

  if (kinds.has("Polygon")) {
    map.addLayer({
      id: id + "-fill",
      type: extrude ? "fill-extrusion" : "fill",
      source: id,
      filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
      paint: extrude
        ? { "fill-extrusion-color": color, "fill-extrusion-height": ["coalesce", ["get", "__h"], 4],
            "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.85 }
        : { "fill-color": color, "fill-opacity": 0.35 },
    });
    if (!extrude) {
      map.addLayer({
        id: id + "-outline", type: "line", source: id,
        filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
        paint: { "line-color": color, "line-width": 1.5 },
      });
    }
  }
  if (kinds.has("LineString")) {
    map.addLayer({
      id: id + "-line", type: "line", source: id,
      filter: ["any", ["==", ["geometry-type"], "LineString"], ["==", ["geometry-type"], "MultiLineString"]],
      paint: { "line-color": color, "line-width": 2.5 },
    });
  }
  if (kinds.has("Point")) {
    map.addLayer({
      id: id + "-pt", type: "circle", source: id,
      filter: ["any", ["==", ["geometry-type"], "Point"], ["==", ["geometry-type"], "MultiPoint"]],
      paint: { "circle-radius": 5, "circle-color": color, "circle-stroke-color": "#0b0e12", "circle-stroke-width": 1.5 },
    });
  }

  importedLayers.push({ id, name, color, opacity: 1, extrude, count: features.length, kinds: [...kinds] });
  renderLayerList();
  // zoom to data
  const b = new maplibregl.LngLatBounds();
  let n = 0;
  const extend = c => { if (Array.isArray(c) && typeof c[0] === "number") { b.extend(c); n++; } else if (Array.isArray(c)) c.forEach(extend); };
  features.forEach(f => f.geometry && extend(f.geometry.coordinates));
  if (n) map.fitBounds(b, { padding: 80, pitch: extrude ? 50 : map.getPitch(), duration: 1600, maxZoom: 17.5 });
  toast(`${name}: ${features.length} features${extrude ? `, ${heightCount} with heights → 3D` : ""}`);
}

function layerIdsFor(id) {
  return [id + "-fill", id + "-outline", id + "-line", id + "-pt"].filter(l => map.getLayer(l));
}
function renderLayerList() {
  const holder = $("layerList");
  holder.innerHTML = "";
  for (const lyr of importedLayers) {
    const el = document.createElement("div");
    el.className = "lyr";
    el.innerHTML = `
      <div class="row">
        <input type="color" value="${lyr.color}">
        <span class="name"></span>
        <button class="zoom" title="Zoom to layer">⌖</button>
        <button class="mini" title="Remove">✕</button>
      </div>
      <div class="row">
        <span class="meta">${lyr.count} features · ${lyr.kinds.join(", ")}${lyr.extrude ? " · 3D" : ""}</span>
        <input type="range" class="grow" min="0" max="1" step="0.05" value="${lyr.opacity}">
      </div>`;
    el.querySelector(".name").textContent = lyr.name;
    el.querySelector("input[type=color]").addEventListener("input", ev => {
      lyr.color = ev.target.value;
      for (const lid of layerIdsFor(lyr.id)) {
        const t = map.getLayer(lid).type;
        const prop = t === "fill-extrusion" ? "fill-extrusion-color" : t === "fill" ? "fill-color" : t === "line" ? "line-color" : "circle-color";
        map.setPaintProperty(lid, prop, lyr.color);
      }
    });
    el.querySelector("input[type=range]").addEventListener("input", ev => {
      lyr.opacity = parseFloat(ev.target.value);
      for (const lid of layerIdsFor(lyr.id)) {
        const t = map.getLayer(lid).type;
        const prop = t === "fill-extrusion" ? "fill-extrusion-opacity" : t === "fill" ? "fill-opacity" : t === "line" ? "line-opacity" : "circle-opacity";
        map.setPaintProperty(lid, prop, lyr.opacity * (t === "fill" ? 0.35 : t === "fill-extrusion" ? 0.85 : 1));
      }
    });
    el.querySelector(".zoom").addEventListener("click", () => {
      const src = map.getSource(lyr.id);
      const data = src && src._data;
      if (!data) return;
      const b = new maplibregl.LngLatBounds();
      const extend = c => { if (Array.isArray(c) && typeof c[0] === "number") b.extend(c); else if (Array.isArray(c)) c.forEach(extend); };
      data.features.forEach(f => f.geometry && extend(f.geometry.coordinates));
      map.fitBounds(b, { padding: 80, duration: 1200, maxZoom: 17.5 });
    });
    el.querySelector(".mini").addEventListener("click", () => {
      for (const lid of layerIdsFor(lyr.id)) map.removeLayer(lid);
      if (map.getSource(lyr.id)) map.removeSource(lyr.id);
      importedLayers = importedLayers.filter(x => x !== lyr);
      renderLayerList();
    });
    holder.appendChild(el);
  }
}

/* ---------------- saved views ---------------- */
$("saveViewBtn").addEventListener("click", () => {
  const name = $("viewName").value.trim() || "View " + (savedViews.length + 1);
  savedViews.push({
    name,
    center: map.getCenter().toArray(),
    zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(),
    display: {
      base: currentBase,
      terrain: $("ckTerrain").checked,
      exag: parseFloat($("exagSlider").value),
      globe: $("ckGlobe").checked,
      buildings: $("ckBuildings").checked,
      hillshade: $("ckHillshade").checked,
    },
  });
  $("viewName").value = "";
  persist();
  renderViews();
});
function applyViewDisplay(d) {
  if (!d) return;
  if (BASES[d.base]) setBase(d.base);
  $("exagSlider").value = d.exag ?? 1.3;
  $("exagVal").textContent = (d.exag ?? 1.3).toFixed(1);
  setTerrain(!!d.terrain);
  $("ckGlobe").checked = !!d.globe;
  map.setProjection({ type: d.globe ? "globe" : "mercator" });
  $("ckBuildings").checked = d.buildings !== false;
  map.setLayoutProperty("osm-3d", "visibility", d.buildings !== false ? "visible" : "none");
  $("ckHillshade").checked = d.hillshade !== false;
  map.setLayoutProperty("hillshade", "visibility", d.hillshade !== false ? "visible" : "none");
}
function renderViews() {
  const holder = $("viewList");
  holder.innerHTML = "";
  for (const v of savedViews) {
    const el = document.createElement("div");
    el.className = "lyr";
    el.innerHTML = `<div class="row"><span class="name"></span><button class="mini">✕</button></div>`;
    el.querySelector(".name").textContent = v.name;
    el.style.cursor = "pointer";
    el.querySelector(".name").addEventListener("click", () => {
      applyViewDisplay(v.display);
      map.flyTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing, duration: 1800 });
    });
    el.querySelector(".mini").addEventListener("click", () => {
      savedViews = savedViews.filter(x => x !== v);
      persist();
      renderViews();
    });
    holder.appendChild(el);
  }
}
renderViews();

/* ---------------- units / views / screenshot ---------------- */
function setUnits(u) {
  units = u;
  $("atUnitFt").classList.toggle("active", u === "ft");
  $("atUnitM").classList.toggle("active", u === "m");
  scaleCtrl.setUnit(u === "ft" ? "imperial" : "metric");
  updateMeasure();
  persist();
}
$("atUnitFt").addEventListener("click", () => setUnits("ft"));
$("atUnitM").addEventListener("click", () => setUnits("m"));
setUnits(units);

$("view3dBtn").addEventListener("click", () => map.easeTo({ pitch: 62, duration: 700 }));
$("viewTopBtn").addEventListener("click", () => map.easeTo({ pitch: 0, duration: 700 }));
$("northBtn").addEventListener("click", () => map.easeTo({ bearing: 0, duration: 700 }));

$("atShotBtn").addEventListener("click", () => {
  map.once("render", () => {
    const src = map.getCanvas();
    const out = document.createElement("canvas");
    out.width = src.width; out.height = src.height;
    const c = out.getContext("2d");
    c.drawImage(src, 0, 0);
    const k = src.width / src.clientWidth;
    // composite measure labels (they're DOM markers, not canvas pixels)
    const pill = (text, cx, cy, bg, fg) => {
      c.font = `600 ${11.5 * k}px "Segoe UI", system-ui, sans-serif`;
      const padX = 7 * k, h = 19 * k;
      const w = c.measureText(text).width + padX * 2;
      c.beginPath();
      if (c.roundRect) c.roundRect(cx - w / 2, cy - h / 2, w, h, 6 * k); else c.rect(cx - w / 2, cy - h / 2, w, h);
      c.fillStyle = bg; c.fill();
      c.fillStyle = fg; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(text, cx, cy + 0.5 * k);
    };
    const coords = measurePts.map(p => [p.lng, p.lat]);
    for (let i = 1; i < coords.length; i++) {
      const p = map.project([(coords[i - 1][0] + coords[i][0]) / 2, (coords[i - 1][1] + coords[i][1]) / 2]);
      pill(fmtDist(haversine(coords[i - 1], coords[i])), p.x * k, p.y * k, "rgba(123,216,143,.95)", "#062512");
    }
    if (measureKind === "area" && coords.length > 2) {
      const cen = coords.reduce((s, p) => [s[0] + p[0] / coords.length, s[1] + p[1] / coords.length], [0, 0]);
      const pc = map.project(cen);
      pill(fmtArea(ringAreaM2(coords)), pc.x * k, pc.y * k, "rgba(77,163,255,.95)", "#06121f");
    }
    const credits = currentBase === "sat" || currentBase === "hybrid"
      ? "Imagery © Esri, Maxar, Earthstar Geographics | Terrain: Mapzen/AWS | © OpenStreetMap contributors"
      : "© OpenStreetMap contributors © CARTO | Terrain: Mapzen/AWS";
    c.font = `${10 * k}px sans-serif`;
    c.textAlign = "right"; c.textBaseline = "bottom";
    c.fillStyle = "rgba(0,0,0,.55)";
    c.fillText(credits, out.width - 6 * k + k, out.height - 5 * k + k);
    c.fillStyle = "rgba(255,255,255,.9)";
    c.fillText(credits, out.width - 6 * k, out.height - 5 * k);
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = "atlas-view.png";
    a.click();
    toast("Screenshot downloaded");
  });
  map.triggerRepaint();
});

/* ---------------- keyboard ---------------- */
window.addEventListener("keydown", e => {
  if (shell.getTab() !== "atlas") return; // Studio owns the keyboard on its tab
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  switch (e.key) {
    case "Escape":
      if (ctx.style.display !== "none") { hideCtx(); break; } // just close the menu
      if (mode === "place") {
        mode = "idle";
        pendingProject = null;
        $("modeBanner").style.display = "none";
        map.getCanvas().style.cursor = "";
        break;
      }
      if (mode === "dist" || mode === "area") finishMeasure(); // banner says Esc finishes
      break;
    case "t": case "T": map.easeTo({ pitch: map.getPitch() > 5 ? 0 : 60, duration: 600 }); break;
    case "n": case "N": map.easeTo({ bearing: 0, duration: 600 }); break;
    case "g": case "G": $("ckGlobe").checked = !$("ckGlobe").checked; $("ckGlobe").dispatchEvent(new Event("change")); break;
    case "b": case "B": $("ckBuildings").checked = !$("ckBuildings").checked; $("ckBuildings").dispatchEvent(new Event("change")); break;
  }
});

/* ---------------- toast (shared shell timer) ---------------- */
function toast(msg) { shell.toast(msg); }

renderProjPanel();

/* test hooks */
window.atlas = {
  map, setBase, setMode, setUnits, addGeoLayer, finishMeasure, armPlacement, placeSiteAt,
  importedLayers: () => importedLayers, measureState: () => ({ mode, measureKind, pts: measurePts.length }),
  sites: () => sites,
  ringAreaM2, haversine, fmtDist, fmtArea,
};

return {
  resize: () => map.resize(),
  armPlacement,
  refreshProjects: renderProjPanel,
};
} // end initAtlas
