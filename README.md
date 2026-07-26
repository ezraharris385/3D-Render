# 3D Render Engine — Studio + Atlas

**One engine, two tabs.** Design true-dimension buildings in **🏗️ Studio**, save them as projects, then switch to **🛰️ Atlas** and place them on the satellite map — where they render at real scale alongside Atlas's full mapping feature set. Desktop-only, static files, no build step, **no API keys required**.

## The workflow

1. **Studio tab** — one building per project. Start from an asset template (office, multifamily, industrial, data center, retail) or one of your own uploaded presets; control every dimension, material, window, and door — and the **interior infrastructure**: place equipment and draw partition walls floor by floor, then slice the building open to work inside it.
2. **💾 Save** — projects go to a library shared by both tabs (and auto-persist in the browser).
3. **📍 Send to Atlas map** — the engine switches tabs and arms placement; click the map and your project lands as true-scale 3D massing (footprints, heights, material colors). Drag to move it, rotate it to sit the lot, place as many saved projects as you like — each placement is independent and persistent.
4. Atlas keeps **all of its own features** around your placements: 3D terrain, OSM buildings, measuring, GeoJSON imports, saved views.

`map/` and `lab/` remain the code homes for each system; their old standalone URLs redirect into the engine.

| 🛰️ Atlas tab | 🏗️ Studio tab |
| --- | --- |
| ![Atlas](docs/atlas.png) | ![Studio](docs/studio.png) |

---

## 🛰️ Atlas — the mapping tab

A serious 3D mapping platform (MapLibre GL v5):

- **3D terrain** — real global elevation (AWS/Mapzen terrarium DEM) with adjustable exaggeration and hillshading.
- **Satellite / aerial imagery** — Esri World Imagery, plus Hybrid (labels + roads), Streets, and Dark basemaps.
- **Real 3D buildings** — OSM building massing with true heights, extruded from OpenFreeMap vector tiles, worldwide.
- **Globe projection** toggle, smooth tilt/rotate camera, saved named views.
- **Search** — autocomplete geocoding (Photon/komoot) or paste `lat, lng` directly.
- **Measuring** — distance and area tools (imperial/metric: ft/mi, sq ft/acres).
- **Bring your own data** — drag-and-drop GeoJSON. Polygons carrying `height` (meters) or `levels`/`stories` properties render instantly as 3D buildings; per-layer color, opacity, zoom-to, remove.
- **Status bar** — live cursor coordinates, ground elevation, zoom, camera bearing/pitch. Right-click → copy coordinates, measure from here.
- **PNG screenshots** with imagery credits and measurement labels baked in.

### What you can give me to make Atlas stronger

The system runs 100% key-free today. Each of these drops in cleanly and levels it up:

| You provide | What it unlocks |
| --- | --- |
| **Building footprints GeoJSON** (county GIS, Microsoft/OSM footprint extracts, Regrid, etc.) | Already supported — drop the file on the map and footprints with heights render as 3D. This is the single best upgrade and it's free. |
| **Parcel boundaries GeoJSON** | Lot lines over satellite — same drag-drop path. |
| **Google Maps Platform key** (Map Tiles API) | **Photorealistic 3D Tiles** — actual photogrammetry meshes of most US metros. This is the visual endgame; it needs a Cesium/deck.gl layer added, which I'd build as an Atlas mode. |
| **Cesium ion token** (free tier) | Cesium World Terrain (crisper than the public DEM) + worldwide OSM Buildings as clean 3D tiles. |
| **MapTiler key** (free tier) | Sharper vector basemaps, contour lines, higher-zoom terrain. |
| **Nearmap / EagleView / state orthophoto endpoint** | Recent, high-res aerials as a drop-in raster source (many state/county GIS servers are free WMS/XYZ). |

---

## 🏗️ Studio — the rendering tab

A black-space design studio where **nothing is left to guess**:

- **True-dimension envelopes** — width/depth per building, story count × floor height, flat roof with parapet or gable with real pitch (rise:12) and ridge direction. Overall height reported in feet-inches.
- **Real material textures at true pattern scale** — brick renders with modular courses at actual 8" × 2⅔" spacing; CMU at 16"×8"; concrete tilt-up with 15 ft panel reveals; metal panel with 12" ribs; curtainwall with 5 ft mullion grid; EIFS; 6" lap siding. Pattern size is exact because texture repeat is computed from wall meters.
- **Openings are components** — windows and doors are first-class objects on each face: pick the **type** (fixed, double-hung, sliding, picture, storefront, ribbon, glass entry, man door, overhead door, dock door — each with real default sizes), then control **width, height, sill height, and position** to the inch. Walls get real holes; glass, frames, and mullions render per type. Click any window in 3D to select and edit it.
- **Fast fenestration** — "Fill face evenly" arrays any type across a face; misfit/overlapping openings are flagged, never silently drawn wrong.
- **Asset-type templates** — Office, Multifamily, Industrial, Data Center, Retail: one click generates a building with that asset class's construction defaults (materials, story heights, dock doors, storefront runs…). All of it stays editable.
- **Interior infrastructure** — pick a floor, place equipment with real dimensions (server racks, CRAC/CRAH, UPS, PDUs, switchgear, panels, pallet racking, machines — plus anything you upload), draw partition walls with two clicks, and hit **👁 Inside** to slice the building open above the active floor (doll-house view). Click any interior item in 3D to select it; drag, rotate, resize, delete. The Data Center template ships with a full rack/CRAC/electrical-room layout.
- **Dimension annotations** — toggleable 3D dimension lines with feet-inch labels, a draggable 6 ft scale figure, framed/front/top cameras, PNG screenshots.
- **Projects** — one building per project; auto-save, JSON export/import (foreign files are rejected, never wipe your work).

### Your data — the catalog the system adapts to

Studio has a **catalog upload** (CSV or exported JSON) that feeds every picker. One file, three kinds of rows:

```csv
kind,name,brand,type,width,depth,height,sill,color,stories,floorheight,parapet,material
equipment,Chiller X90,Trane,chiller,8,4,6,,#5ad7d2,,,,
opening,ProLine 4x6,Pella,double-hung,4,,6,2.5,#ffffff,,,,
preset,Flex Warehouse 40k,,industrial,400,100,,,,1,28,3,metal
```

- `equipment` rows join the **interior palette** (place them on any floor).
- `opening` rows join the **windows & doors picker** as products with real sizes (`type` maps to a base type: window, double-hung, sliding, storefront, door, overhead, dock…).
- `preset` rows join the **building templates** grid.

Dimensions are read in the current units; entries persist in the browser and export/import as JSON.

---

## Run / deploy

```bash
python3 -m http.server 8000   # ES modules need HTTP
# engine: http://localhost:8000/   (Studio tab; #atlas opens the map tab)
```

GitHub Pages: **Settings → Pages → Deploy from a branch** → `main` / root. The hub page links both systems.

## Verification

28 headless-browser checks across both systems plus 12 engine-integration checks (tab lifecycle, project library, placement round-trip with exact 35 ft massing heights and 200 ft footprint edges): template generation with zero misfit openings, wall holes at exact `u ± w/2`, texture repeat exactly `1/pattern-size`, area math within 0.15% on a 100 m square, GeoJSON height extrusion, measure totals, basemap switching, import guards, round-trip persistence — plus multi-agent adversarial code review each round.

## Attribution

Esri World Imagery · © OpenStreetMap contributors · © CARTO · OpenMapTiles/OpenFreeMap · Terrain: Mapzen/AWS, USGS, SRTM · Photon/komoot geocoding · MapLibre GL JS (BSD-3) · three.js (MIT)
