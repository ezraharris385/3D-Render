/* =========================================================
   Earth — Google-Earth-quality photorealistic 3D via
   CesiumJS + Google Map Tiles API (Photorealistic 3D Tiles).
   Cesium (~5 MB) loads lazily, and only once a key exists.
   Placed Studio sites render here too.
   ========================================================= */
import * as bridge from "./bridge.js";

const CESIUM_VERSION = "1.126.0";
const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;
const $ = id => document.getElementById(id);

export function initEarth(shell) {
  let viewer = null;
  let tileset = null;
  let booting = false;
  let cesiumPromise = null;
  let siteEntities = [];

  /* ---------------- status / panels ---------------- */
  function setStatus(msg, kind = "info") {
    const el = $("earthStatus");
    el.textContent = msg;
    el.style.color = kind === "err" ? "var(--danger)" : kind === "ok" ? "var(--accent-2)" : "var(--muted)";
  }
  function updatePanels() {
    const hasKey = !!bridge.getKeys().google;
    $("earthSetup").style.display = hasKey ? "none" : "";
    $("earthReady").style.display = hasKey ? "" : "none";
  }

  /* ---------------- cesium loader ---------------- */
  function loadCesium() {
    if (window.Cesium) return Promise.resolve();
    if (cesiumPromise) return cesiumPromise;
    cesiumPromise = new Promise((resolve, reject) => {
      window.CESIUM_BASE_URL = CESIUM_BASE;
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = CESIUM_BASE + "Widgets/widgets.css";
      document.head.appendChild(css);
      const s = document.createElement("script");
      s.src = CESIUM_BASE + "Cesium.js";
      s.onload = () => resolve();
      s.onerror = () => { cesiumPromise = null; reject(new Error("cesium-load")); };
      document.head.appendChild(s);
    });
    return cesiumPromise;
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    const key = bridge.getKeys().google;
    if (!key || viewer || booting) return;
    booting = true;
    setStatus("Loading the 3D engine…");
    try {
      await loadCesium();
    } catch (e) {
      booting = false;
      setStatus("Couldn't load the 3D engine (network). Retry from the button below.", "err");
      return;
    }
    const C = window.Cesium;
    try {
      viewer = new C.Viewer("earthContainer", {
        baseLayer: false,
        baseLayerPicker: false, geocoder: false, timeline: false, animation: false,
        homeButton: false, sceneModePicker: false, navigationHelpButton: false,
        fullscreenButton: false, infoBox: false, selectionIndicator: false,
      });
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.globe.show = false; // photorealistic tiles replace the globe
      setStatus("Streaming Google Photorealistic 3D Tiles…");
      tileset = await C.Cesium3DTileset.fromUrl(
        `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(key)}`,
        { showCreditsOnScreen: true }
      );
      viewer.scene.primitives.add(tileset);
      setStatus("Photorealistic 3D active", "ok");
      renderSites();
      const sites = bridge.getSites();
      if (sites.length) flyToSite(sites[0]);
      else flyTo(-89.384, 43.0747, 900);
    } catch (e) {
      setStatus("Google rejected the key or the Map Tiles API isn't enabled on it. Double-check the key and that 'Map Tiles API' is enabled in Google Cloud, then Reload.", "err");
      if (viewer) viewer.scene.globe.show = true; // plain globe fallback
    } finally {
      booting = false;
    }
  }

  function flyTo(lng, lat, height = 700, duration = 2.5) {
    if (!viewer) return;
    const C = window.Cesium;
    viewer.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(lng, lat - height / 220000, height),
      orientation: { heading: 0, pitch: C.Math.toRadians(-32), roll: 0 },
      duration,
    });
  }
  function flyToSite(site) { flyTo(site.lng, site.lat, 500); }

  /* ---------------- placed sites ---------------- */
  function renderSites() {
    if (!viewer) return;
    const C = window.Cesium;
    for (const e of siteEntities) viewer.entities.remove(e);
    siteEntities = [];
    for (const site of bridge.getSites()) {
      for (const b of bridge.siteBuildingRings(site)) {
        siteEntities.push(viewer.entities.add({
          polygon: {
            hierarchy: C.Cartesian3.fromDegreesArray(b.ring.flat()),
            material: C.Color.fromCssColorString(b.color).withAlpha(0.95),
            height: 0,
            heightReference: C.HeightReference.CLAMP_TO_GROUND,
            extrudedHeight: b.h,
            extrudedHeightReference: C.HeightReference.RELATIVE_TO_GROUND,
            outline: false,
          },
        }));
      }
      siteEntities.push(viewer.entities.add({
        position: window.Cesium.Cartesian3.fromDegrees(site.lng, site.lat, 4),
        label: {
          text: site.name,
          font: "600 13px system-ui",
          fillColor: C.Color.fromCssColorString("#06121f"),
          showBackground: true,
          backgroundColor: C.Color.fromCssColorString("#4da3ff").withAlpha(0.95),
          backgroundPadding: new C.Cartesian2(7, 4),
          heightReference: C.HeightReference.CLAMP_TO_GROUND,
          verticalOrigin: C.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }));
    }
    renderSiteList();
  }
  function renderSiteList() {
    const holder = $("earthSiteList");
    holder.innerHTML = "";
    for (const site of bridge.getSites()) {
      const el = document.createElement("div");
      el.className = "lyr";
      el.innerHTML = `<div class="row"><span class="name" style="cursor:pointer"></span><span class="meta"></span></div>`;
      el.querySelector(".name").textContent = site.name;
      el.querySelector(".meta").textContent = `${site.buildings.length} bldg${site.buildings.length === 1 ? "" : "s"}`;
      el.querySelector(".name").addEventListener("click", () => flyToSite(site));
      holder.appendChild(el);
    }
  }

  /* ---------------- panel wiring ---------------- */
  $("earthKeySaveBtn").addEventListener("click", () => {
    const key = $("earthKeyInput").value.trim();
    if (!key) { shell.toast("Paste your Google Maps Platform API key first"); return; }
    bridge.setKeys({ google: key });
    $("earthKeyInput").value = "";
    updatePanels();
    shell.toast("Key saved — loading Google Earth-quality 3D…");
    boot();
  });
  $("earthReloadBtn").addEventListener("click", () => {
    if (viewer) { viewer.destroy(); viewer = null; tileset = null; siteEntities = []; }
    boot();
  });
  $("earthKeyClearBtn").addEventListener("click", () => {
    bridge.setKeys({ google: "" });
    if (viewer) { viewer.destroy(); viewer = null; tileset = null; siteEntities = []; }
    updatePanels();
    setStatus("Key removed.");
  });

  $("earthSearchBtn").addEventListener("click", earthSearch);
  $("earthSearchBox").addEventListener("keydown", e => { if (e.key === "Enter") earthSearch(); });
  async function earthSearch() {
    const q = $("earthSearchBox").value.trim();
    if (!q) return;
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) { flyTo(parseFloat(m[2]), parseFloat(m[1]), 700); return; }
    try {
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`);
      const data = await res.json();
      const f = data.features && data.features[0];
      if (!f) { shell.toast("No results for that search"); return; }
      flyTo(f.geometry.coordinates[0], f.geometry.coordinates[1], 700);
      shell.toast(f.properties.name || "Here");
    } catch (e) { shell.toast("Search failed — check your connection"); }
  }

  updatePanels();
  setStatus(bridge.getKeys().google
    ? "Ready — opening this tab streams the 3D tiles."
    : "Paste a key to unlock photorealistic 3D.");

  /* test hooks */
  window.earth = { boot, renderSites, hasViewer: () => !!viewer };

  return {
    activate() {
      if (!viewer && bridge.getKeys().google) boot();
      else if (viewer) renderSites(); // pick up newly placed sites
    },
  };
}
