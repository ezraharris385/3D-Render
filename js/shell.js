/* =========================================================
   Engine shell — one app, two tabs. Studio boots
   immediately; Atlas boots on first visit (MapLibre needs a
   visible container).
   ========================================================= */
import { initStudio } from "../lab/js/app.js";
import { initAtlas } from "../map/js/app.js";

const $ = id => document.getElementById(id);

let tab = "studio";
let atlasApi = null;
let pendingPlacement = null;

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

const shell = {
  getTab: () => tab,
  toast,
  switchTab,
  /* Studio calls this to place a project on the map */
  requestPlacement(project) {
    pendingPlacement = project;
    switchTab("atlas"); // consumes pendingPlacement once Atlas is up
    if (atlasApi && pendingPlacement) {
      atlasApi.armPlacement(pendingPlacement);
      pendingPlacement = null;
    }
  },
};

function switchTab(next) {
  tab = next;
  $("tabStudio").classList.toggle("active", tab === "studio");
  $("tabAtlas").classList.toggle("active", tab === "atlas");
  $("labRoot").style.display = tab === "studio" ? "" : "none";
  $("mapRoot").style.display = tab === "atlas" ? "" : "none";
  if (tab === "atlas") {
    if (!atlasApi) {
      atlasApi = initAtlas(shell);
      window.atlasApi = atlasApi;
    }
    atlasApi.resize();
    if (pendingPlacement) {
      atlasApi.armPlacement(pendingPlacement);
      pendingPlacement = null;
    }
  }
}

$("tabStudio").addEventListener("click", () => switchTab("studio"));
$("tabAtlas").addEventListener("click", () => switchTab("atlas"));

// a stray file drop must never navigate away, whichever tab is up
["dragover", "drop"].forEach(evt =>
  document.addEventListener(evt, e => e.preventDefault()));

initStudio(shell);
if (location.hash === "#atlas") switchTab("atlas");

window.shell = shell;
