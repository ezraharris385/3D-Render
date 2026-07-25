/* =========================================================
   3D Site Lab — app shell: modes, top bar, project I/O.
   ========================================================= */
import {
  state, SHAPES, DIM_LABELS, UTILITY_TYPES,
  selectedItem, itemById, addItem, removeItem, footprintLocal,
  toUI, fromUI, unitSuffix, exportProject, loadProject, loadSaved, save, flushSave,
  importCatalogCSV, validTemplate,
} from "./state.js";
import * as lab from "./lab.js";
import * as siteMap from "./map.js";

const $ = id => document.getElementById(id);

let mode = "lab";   // 'lab' | 'map'

/* ---------------- Toast ---------------- */
let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}
window.__toast = toast;

/* ---------------- Change propagation ---------------- */
function changed() {
  save();
  if (siteMap.isMapReady()) siteMap.renderMap();
}

/* ---------------- Mode switching ---------------- */
function setMode(next) {
  mode = next;
  $("tabLab").classList.toggle("active", next === "lab");
  $("tabMap").classList.toggle("active", next === "map");
  $("labRoot").style.display = next === "lab" ? "" : "none";
  $("mapRoot").style.display = next === "map" ? "" : "none";
  if (next === "map") {
    if (!siteMap.isMapReady()) siteMap.initMap(changed, () => lab.syncSelectionUI());
    siteMap.resizeMap();
    siteMap.renderMap();
  }
}
$("tabLab").addEventListener("click", () => setMode("lab"));
$("tabMap").addEventListener("click", () => setMode("map"));

/* ---------------- Units ---------------- */
function setUnits(u) {
  // preserve anything typed into the new-equipment form, converted
  const prevUnits = state.units;
  const typed = {};
  document.querySelectorAll("#neDims input").forEach(inp => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v)) typed[inp.dataset.dim] = v;
  });

  state.units = u;
  $("unitFt").classList.toggle("active", u === "ft");
  $("unitM").classList.toggle("active", u === "m");
  document.querySelectorAll(".unitLbl").forEach(el => el.textContent = unitSuffix());
  lab.rebuildGrid();
  lab.renderCatalog();
  lab.renderItemList();
  lab.renderSelectedPanel();
  lab.renderUtilList();
  siteMap.setUnitsOnMap();
  renderNewEquipForm();

  if (prevUnits !== u) {
    const factor = prevUnits === "ft" ? 0.3048 : 1;         // typed -> meters
    const out = u === "ft" ? 1 / 0.3048 : 1;                 // meters -> new units
    document.querySelectorAll("#neDims input").forEach(inp => {
      const k = inp.dataset.dim;
      if (k in typed) inp.value = Math.round(typed[k] * factor * out * 100) / 100;
    });
  }
  changed();
}
$("unitFt").addEventListener("click", () => setUnits("ft"));
$("unitM").addEventListener("click", () => setUnits("m"));

/* ---------------- Lab panel wiring ---------------- */
$("connectBtn").addEventListener("click", () => {
  if (lab.getLabMode() === "connect") { lab.setLabMode("idle"); return; }
  if (state.items.length < 2) { toast("Place at least two pieces of equipment first"); return; }
  lab.setLabMode("connect", { type: $("utilType").value, route: $("utilRoute").value });
});
// changing the dropdowns while connect mode is armed takes effect immediately
for (const id of ["utilType", "utilRoute"]) {
  $(id).addEventListener("change", () =>
    lab.updateConnectParams($("utilType").value, $("utilRoute").value));
}

$("selName").addEventListener("input", () => {
  const it = selectedItem();
  if (it) { it.name = $("selName").value; lab.renderItemList(); changed(); }
});
$("selColor").addEventListener("input", () => {
  const it = selectedItem();
  if (it) { it.color = $("selColor").value; lab.rebuildItemMesh(it.id); lab.renderItemList(); changed(); }
});
$("selRot").addEventListener("input", () => {
  const it = selectedItem();
  if (it) {
    it.rot = parseFloat($("selRot").value) || 0;
    $("selRotVal").textContent = Math.round(it.rot);
    lab.transformRefresh(it);
  }
});
$("selDupBtn").addEventListener("click", () => {
  const it = selectedItem();
  if (!it) return;
  const fp = footprintLocal(it);
  const w = fp.circle ? fp.circle * 2 : fp.hw * 2;
  addItem({ ...it }, it.x + w + 2, it.z);
  lab.fullRefresh();
});
$("selDelBtn").addEventListener("click", () => {
  const it = selectedItem();
  if (it) { removeItem(it.id); lab.fullRefresh(); }
});

$("viewIsoBtn").addEventListener("click", () => lab.viewIso());
$("viewTopBtn").addEventListener("click", () => lab.viewTop());
$("snapBtn").addEventListener("click", () => {
  state.snap = !state.snap;
  $("snapBtn").classList.toggle("active", state.snap);
});
$("humanBtn").addEventListener("click", () => {
  const on = !$("humanBtn").classList.contains("active");
  $("humanBtn").classList.toggle("active", on);
  lab.setHumanVisible(on);
});
$("labShotBtn").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = lab.labScreenshot();
  a.download = "site-lab.png";
  a.click();
  toast("Screenshot downloaded");
});

/* ---------------- New equipment form ---------------- */
function renderNewEquipForm() {
  const shape = $("neShape").value;
  const holder = $("neDims");
  holder.innerHTML = "";
  for (const k of SHAPES[shape].dims) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<label class="small">${DIM_LABELS[k]} (<span class="unitLbl">${unitSuffix()}</span>)</label>
      <input type="number" min="0.1" step="0.5" data-dim="${k}">`;
    holder.appendChild(wrap);
  }
}
$("neShape").addEventListener("change", renderNewEquipForm);
$("neAddBtn").addEventListener("click", () => {
  const name = $("neName").value.trim() || "Custom equipment";
  const shape = $("neShape").value;
  const dims = {};
  let ok = true;
  $("neDims").querySelectorAll("input").forEach(inp => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v) && v > 0) dims[inp.dataset.dim] = fromUI(v);
    else ok = false;
  });
  if (!ok) { toast("Enter all dimensions (must be > 0)"); return; }
  const t = { id: "c" + state.nextCatalogId++, name, shape, dims, color: $("neColor").value };
  if (!validTemplate(t)) { toast("Those dimensions don't look right"); return; }
  state.customCatalog.push(t);
  $("neName").value = "";
  lab.renderCatalog();
  changed();
  toast(`“${name}” added to the library — click it to place`);
});

$("csvBtn").addEventListener("click", () => $("csvFile").click());
$("csvFile").addEventListener("change", e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const { added, skipped } = importCatalogCSV(String(reader.result));
    lab.renderCatalog();
    changed();
    toast(`Imported ${added} equipment type${added === 1 ? "" : "s"}${skipped ? ` (${skipped} row${skipped === 1 ? "" : "s"} skipped)` : ""}`);
  };
  reader.readAsText(file);
});

/* ---------------- Project I/O ---------------- */
$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(exportProject(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "site-project.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      if (!loadProject(data)) { toast("Couldn't read that project file"); return; }
      setUnits(state.units);
      lab.fullRefresh();
      if (siteMap.isMapReady()) siteMap.renderMap();
      toast(`Project loaded — ${state.items.length} items, ${state.utilities.length} utility runs`);
    } catch (err) {
      toast("Couldn't read that file — is it a valid project export?");
    }
  };
  reader.readAsText(file);
});
$("clearBtn").addEventListener("click", () => {
  if (!state.items.length && !state.utilities.length) return;
  if (!confirm("Remove everything from the site? (Your equipment library is kept.)")) return;
  state.items = [];
  state.utilities = [];
  state.selectedId = null;
  lab.fullRefresh();
});

/* ---------------- Keyboard routing ---------------- */
window.addEventListener("keydown", e => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (mode === "lab") {
    if (lab.labKeydown(e)) { e.preventDefault(); e.stopPropagation(); }
  } else {
    if (e.key === "Escape") siteMap.escapeMapMode();
  }
}, true);

/* don't lose the debounced autosave when the tab closes */
window.addEventListener("pagehide", flushSave);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSave();
});

/* ---------------- Boot ---------------- */
loadSaved();
lab.initLab($("labCanvasHolder"), changed);
setUnits(state.units);
$("snapBtn").classList.toggle("active", state.snap);
renderNewEquipForm();
lab.fullRefresh();
setMode("lab");

/* test hooks */
window.app = {
  state, addItem, removeItem, lab, siteMap, setMode, setUnits,
  importCatalogCSV, exportProject, loadProject,
};
