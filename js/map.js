/* =========================================================
   3D Site Lab — Site Map mode.
   Places the assembled site (all equipment + utility runs)
   on satellite imagery, georeferenced via a single anchor
   point + site rotation. Uses global `maplibregl`.
   ========================================================= */
import {
  state, DEFAULT_CENTER, UTILITY_TYPES,
  itemById, itemHeight, itemRingLngLat, siteToLngLat, utilityPath, utilityLength,
  metersPerDegree, wrapLng, haversine, fmtLen, fmtDims,
} from "./state.js";

const $ = id => document.getElementById(id);

let map = null;
let scaleCtrl = null;
let basemap = "sat";
let mapMode = "idle";              // 'idle' | 'placeSite' | 'measure'
let measurePts = [];
let measureMarkers = [];
let labelMarkers = new Map();
let siteDrag = null;               // {startLngLat, origLng, origLat}
let onChanged = () => {};
let onSelectionChange = () => {};
let booted = false;

export function isMapReady() { return booted; }

export function initMap(onChangedCb, onSelectionChangeCb) {
  if (booted) return;
  booted = true;
  onChanged = onChangedCb;
  if (onSelectionChangeCb) onSelectionChange = onSelectionChangeCb;

  const style = {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256, maxzoom: 19,
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community",
      },
      streets: {
        type: "raster",
        tiles: [
          "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        tileSize: 256, maxzoom: 19,
        attribution: "© OpenStreetMap contributors",
      },
      refLabels: {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256, maxzoom: 19,
        attribution: "Labels © Esri",
      },
      items: { type: "geojson", data: emptyFC() },
      utils: { type: "geojson", data: emptyFC() },
      measureLine: { type: "geojson", data: emptyFC() },
      measurePts: { type: "geojson", data: emptyFC() },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0b0e12" } },
      { id: "satellite", type: "raster", source: "satellite" },
      { id: "streets", type: "raster", source: "streets", layout: { visibility: "none" } },
      { id: "refLabels", type: "raster", source: "refLabels", paint: { "raster-opacity": 0.9 } },
      {
        id: "utils-lines", type: "line", source: "utils",
        paint: {
          "line-color": ["get", "color"], "line-width": 3,
          "line-dasharray": [2, 1],
        },
      },
      {
        id: "items-3d", type: "fill-extrusion", source: "items",
        paint: {
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.88,
        },
      },
      {
        id: "items-outline", type: "line", source: "items",
        filter: ["==", ["get", "selected"], 1],
        paint: { "line-color": "#4da3ff", "line-width": 2.5, "line-dasharray": [1.4, 1] },
      },
      {
        id: "measure-line", type: "line", source: "measureLine",
        paint: { "line-color": "#7bd88f", "line-width": 2.5, "line-dasharray": [1.6, 1] },
      },
      {
        id: "measure-pts", type: "circle", source: "measurePts",
        paint: {
          "circle-radius": 4.5, "circle-color": "#7bd88f",
          "circle-stroke-color": "#062512", "circle-stroke-width": 1.5,
        },
      },
    ],
  };

  map = new maplibregl.Map({
    container: "map",
    style,
    center: state.site ? [state.site.lng, state.site.lat] : DEFAULT_CENTER,
    zoom: state.site ? 17.5 : 16,
    pitch: 50,
    bearing: 0,
    maxPitch: 75,
    antialias: true,
    preserveDrawingBuffer: true,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  scaleCtrl = new maplibregl.ScaleControl({ maxWidth: 140, unit: state.units === "ft" ? "imperial" : "metric" });
  map.addControl(scaleCtrl, "bottom-right");
  map.keyboard.disable();

  map.on("load", () => renderMap());
  wireInteractions();
  wireMapPanel();
}

function emptyFC() { return { type: "FeatureCollection", features: [] }; }

export function setUnitsOnMap() {
  if (scaleCtrl) scaleCtrl.setUnit(state.units === "ft" ? "imperial" : "metric");
  if (map) updateMeasure(); // re-render measure labels in the new units
}

export function resizeMap() {
  if (map) map.resize();
}

/* ---------------- Rendering ---------------- */
export function renderMap() {
  if (!map || !map.getSource("items")) return;
  const itemFC = emptyFC(), utilFC = emptyFC();
  if (state.site) {
    for (const it of state.items) {
      itemFC.features.push({
        type: "Feature",
        properties: {
          id: it.id, color: it.color, height: itemHeight(it),
          selected: it.id === state.selectedId ? 1 : 0,
        },
        geometry: { type: "Polygon", coordinates: [itemRingLngLat(it, state.site)] },
      });
    }
    for (const u of state.utilities) {
      const path = utilityPath(u);
      if (!path) continue;
      utilFC.features.push({
        type: "Feature",
        properties: { color: UTILITY_TYPES[u.type].color },
        geometry: { type: "LineString", coordinates: path.map(([x, z]) => siteToLngLat(x, z, state.site)) },
      });
    }
  }
  map.getSource("items").setData(itemFC);
  map.getSource("utils").setData(utilFC);
  renderMapLabels();
  renderSitePanel();
}

function renderMapLabels() {
  const live = new Set();
  if (state.site && state.showLabels) {
    for (const it of state.items) {
      live.add(it.id);
      let mk = labelMarkers.get(it.id);
      const pos = siteToLngLat(it.x, it.z, state.site);
      if (!mk) {
        const el = document.createElement("div");
        el.className = "dim-label";
        mk = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(pos).addTo(map);
        labelMarkers.set(it.id, mk);
      }
      mk.getElement().textContent = `${it.name} · ${fmtDims(it)}`;
      mk.setLngLat(pos);
    }
  }
  for (const [id, mk] of labelMarkers) {
    if (!live.has(id)) { mk.remove(); labelMarkers.delete(id); }
  }
}

function renderSitePanel() {
  const status = $("siteStatus");
  if (!state.site) {
    status.textContent = "Site not placed yet — click “Place site”, then click the map.";
    $("siteRotRow").style.display = "none";
  } else {
    status.textContent = `Anchor: ${state.site.lat.toFixed(6)}, ${state.site.lng.toFixed(6)}`;
    $("siteRotRow").style.display = "";
    const rotInput = $("siteRot");
    if (document.activeElement !== rotInput) rotInput.value = Math.round(state.site.rot);
    $("siteRotVal").textContent = Math.round(state.site.rot);
  }
}

/* ---------------- Modes ---------------- */
function setMapMode(next) {
  mapMode = next;
  $("placeSiteBtn").classList.toggle("active", next === "placeSite");
  $("mapMeasureBtn").classList.toggle("active", next === "measure");
  map.getCanvas().style.cursor = next === "idle" ? "" : "crosshair";
  const bannerEl = $("mapBanner");
  if (next === "placeSite") {
    bannerEl.style.display = "";
    bannerEl.textContent = "Click the map where the site origin (lab 0,0) should sit (Esc to cancel)";
  } else if (next === "measure") {
    bannerEl.style.display = "";
    bannerEl.textContent = "Click points to measure · double-click or Esc to finish";
    clearMeasure();
  } else {
    bannerEl.style.display = "none";
  }
}
export function escapeMapMode() { if (map) setMapMode("idle"); }

/* ---------------- Measure ---------------- */
function clearMeasure() {
  measurePts = [];
  updateMeasure();
}
function updateMeasure() {
  if (!map || !map.getSource("measureLine")) return;
  map.getSource("measureLine").setData({
    type: "FeatureCollection",
    features: measurePts.length > 1 ? [{
      type: "Feature", properties: {},
      geometry: { type: "LineString", coordinates: measurePts.map(p => [p.lng, p.lat]) },
    }] : [],
  });
  map.getSource("measurePts").setData({
    type: "FeatureCollection",
    features: measurePts.map(p => ({
      type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    })),
  });
  measureMarkers.forEach(m => m.remove());
  measureMarkers = [];
  let total = 0;
  for (let i = 1; i < measurePts.length; i++) {
    const d = haversine(measurePts[i - 1], measurePts[i]);
    total += d;
    const el = document.createElement("div");
    el.className = "dim-label measure-label";
    el.textContent = fmtLen(d);
    measureMarkers.push(new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([(measurePts[i - 1].lng + measurePts[i].lng) / 2, (measurePts[i - 1].lat + measurePts[i].lat) / 2])
      .addTo(map));
  }
  const readout = $("mapMeasureReadout");
  if (measurePts.length > 1) {
    readout.style.display = "";
    readout.textContent = `Total: ${fmtLen(total)}`;
  } else {
    readout.style.display = "none";
  }
}

/* ---------------- Interactions ---------------- */
let suppressNextClick = false;

function wireInteractions() {
  map.on("mousedown", () => { if (!siteDrag) suppressNextClick = false; });
  map.on("touchstart", () => { if (!siteDrag) suppressNextClick = false; });

  map.on("click", e => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    if (mapMode === "placeSite") {
      state.site = { lng: wrapLng(e.lngLat.lng), lat: e.lngLat.lat, rot: state.site ? state.site.rot : 0 };
      setMapMode("idle");
      renderMap();
      onChanged();
      return;
    }
    if (mapMode === "measure") {
      measurePts.push({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      updateMeasure();
      return;
    }
    const hits = map.queryRenderedFeatures(e.point, { layers: ["items-3d"] });
    const next = hits.length ? hits[0].properties.id : null;
    if (next !== state.selectedId) {
      state.selectedId = next;
      renderMap();
      onSelectionChange(); // keep the lab panel in sync
    }
  });

  map.on("dblclick", e => {
    if (mapMode === "measure") {
      e.preventDefault();
      if (measurePts.length > 1) { measurePts.pop(); updateMeasure(); }
      setMapMode("idle");
    }
  });

  // dragging any site feature moves the whole site anchor
  map.on("mousedown", "items-3d", e => {
    if (mapMode !== "idle" || !state.site) return;
    if (e.originalEvent && e.originalEvent.button !== 0) return; // right-drag = camera

    e.preventDefault();
    siteDrag = {
      startLngLat: e.lngLat,
      origLng: state.site.lng, origLat: state.site.lat, moved: false,
    };
    map.getCanvas().style.cursor = "grabbing";
  });
  map.on("mousemove", e => {
    if (!siteDrag) return;
    state.site.lng = wrapLng(siteDrag.origLng + (e.lngLat.lng - siteDrag.startLngLat.lng));
    state.site.lat = siteDrag.origLat + (e.lngLat.lat - siteDrag.startLngLat.lat);
    siteDrag.moved = true;
    renderMap();
  });
  const endSiteDrag = () => {
    if (siteDrag && siteDrag.moved) { suppressNextClick = true; onChanged(); }
    siteDrag = null;
    map.getCanvas().style.cursor = mapMode === "idle" ? "" : "crosshair";
  };
  map.on("mouseup", endSiteDrag);
  window.addEventListener("mouseup", () => { if (siteDrag) endSiteDrag(); });
  map.on("touchstart", "items-3d", e => {
    if (mapMode !== "idle" || !state.site || e.points.length !== 1) return;
    e.preventDefault();
    siteDrag = { startLngLat: e.lngLat, origLng: state.site.lng, origLat: state.site.lat, moved: false };
  });
  map.on("touchmove", e => {
    if (siteDrag && e.points.length === 1) {
      e.preventDefault();
      state.site.lng = wrapLng(siteDrag.origLng + (e.lngLat.lng - siteDrag.startLngLat.lng));
      state.site.lat = siteDrag.origLat + (e.lngLat.lat - siteDrag.startLngLat.lat);
      siteDrag.moved = true;
      renderMap();
    }
  });
  map.on("touchend", endSiteDrag);
  map.on("touchcancel", endSiteDrag);

  map.on("mouseenter", "items-3d", () => {
    if (mapMode === "idle" && !siteDrag) map.getCanvas().style.cursor = "grab";
  });
  map.on("mouseleave", "items-3d", () => {
    if (!siteDrag) map.getCanvas().style.cursor = mapMode === "idle" ? "" : "crosshair";
  });
}

/* ---------------- Panel wiring ---------------- */
function wireMapPanel() {
  $("placeSiteBtn").addEventListener("click", () =>
    setMapMode(mapMode === "placeSite" ? "idle" : "placeSite"));
  $("mapMeasureBtn").addEventListener("click", () =>
    setMapMode(mapMode === "measure" ? "idle" : "measure"));

  $("siteRot").addEventListener("input", () => {
    if (!state.site) return;
    state.site.rot = parseFloat($("siteRot").value) || 0;
    $("siteRotVal").textContent = Math.round(state.site.rot);
    renderMap();
    onChanged();
  });

  $("zoomSiteBtn").addEventListener("click", () => {
    if (state.site) map.flyTo({ center: [state.site.lng, state.site.lat], zoom: 17.8, pitch: 50 });
  });

  function setBase(which) {
    basemap = which;
    $("mapBaseSat").classList.toggle("active", which === "sat");
    $("mapBaseStreet").classList.toggle("active", which === "street");
    map.setLayoutProperty("satellite", "visibility", which === "sat" ? "visible" : "none");
    map.setLayoutProperty("streets", "visibility", which === "street" ? "visible" : "none");
    syncRefLabels();
  }
  function syncRefLabels() {
    map.setLayoutProperty("refLabels", "visibility",
      basemap === "sat" && state.showLabels ? "visible" : "none");
  }
  $("mapBaseSat").addEventListener("click", () => setBase("sat"));
  $("mapBaseStreet").addEventListener("click", () => setBase("street"));

  $("mapLabelsBtn").addEventListener("click", () => {
    state.showLabels = !state.showLabels;
    $("mapLabelsBtn").classList.toggle("active", state.showLabels);
    syncRefLabels();
    renderMapLabels();
    onChanged();
  });

  $("mapTiltBtn").addEventListener("click", () => map.easeTo({ pitch: 60, duration: 600 }));
  $("mapTopBtn").addEventListener("click", () => map.easeTo({ pitch: 0, bearing: 0, duration: 600 }));

  $("mapSearchBtn").addEventListener("click", doSearch);
  $("mapSearchBox").addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

  $("mapShotBtn").addEventListener("click", mapScreenshot);
}

async function doSearch() {
  const q = $("mapSearchBox").value.trim();
  if (!q) return;
  const toast = window.__toast || (() => {});
  $("mapSearchBtn").disabled = true;
  try {
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    let hit = null;
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) hit = { lat, lng, label: `${lat}, ${lng}` };
    }
    if (!hit) {
      const res = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(q),
        { headers: { "Accept": "application/json" } });
      if (!res.ok) throw new Error("geocoder");
      const arr = await res.json();
      if (arr.length) hit = { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon), label: arr[0].display_name };
    }
    if (!hit) { toast("No results for that search"); return; }
    map.flyTo({ center: [hit.lng, hit.lat], zoom: 17.5, pitch: 45 });
    toast(hit.label.length > 80 ? hit.label.slice(0, 77) + "…" : hit.label);
  } catch (e) {
    toast("Search failed — check your connection");
  } finally {
    $("mapSearchBtn").disabled = false;
  }
}

function mapScreenshot() {
  map.once("render", () => {
    const src = map.getCanvas();
    const out = document.createElement("canvas");
    out.width = src.width; out.height = src.height;
    const ctx = out.getContext("2d");
    ctx.drawImage(src, 0, 0);
    const k = src.width / src.clientWidth;

    const pill = (text, cx, cy, bg, fg) => {
      ctx.font = `600 ${11.5 * k}px "Segoe UI", system-ui, sans-serif`;
      const padX = 7 * k, h = 19 * k;
      const w = ctx.measureText(text).width + padX * 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 6 * k);
      else ctx.rect(cx - w / 2, cy - h / 2, w, h);
      ctx.fillStyle = bg; ctx.fill();
      ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, cx, cy + 0.5 * k);
    };
    const onScreen = p => p.x >= 0 && p.y >= 0 && p.x <= src.clientWidth && p.y <= src.clientHeight;

    if (state.site && state.showLabels) {
      for (const it of state.items) {
        const p = map.project(siteToLngLat(it.x, it.z, state.site));
        if (onScreen(p)) pill(`${it.name} · ${fmtDims(it)}`, p.x * k, p.y * k, "rgba(13,17,22,.82)", "#fff");
      }
    }
    for (let i = 1; i < measurePts.length; i++) {
      const d = haversine(measurePts[i - 1], measurePts[i]);
      const p = map.project([
        (measurePts[i - 1].lng + measurePts[i].lng) / 2,
        (measurePts[i - 1].lat + measurePts[i].lat) / 2,
      ]);
      if (onScreen(p)) pill(fmtLen(d), p.x * k, p.y * k, "rgba(123,216,143,.95)", "#062512");
    }

    const credits = basemap === "sat"
      ? "Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community"
      : "© OpenStreetMap contributors";
    ctx.font = `${10 * k}px sans-serif`;
    ctx.textAlign = "right"; ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillText(credits, out.width - 6 * k + k, out.height - 5 * k + k);
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.fillText(credits, out.width - 6 * k, out.height - 5 * k);

    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = "site-map.png";
    a.click();
    (window.__toast || (() => {}))("Screenshot downloaded");
  });
  map.triggerRepaint();
}

/* test hooks */
export const _mapTest = { get map() { return map; } };
