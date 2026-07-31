/* =========================================================
   Studio — asset-type templates. Each generator returns the
   `partial` consumed by makeBuilding(). Dimensions in meters
   (FT constants keep the real-world numbers legible). These
   are starting points — every value is editable afterwards,
   and the same schema is the hook for your own per-asset
   database later (see README).
   ========================================================= */
import { FT, INTERIOR_TYPES } from "./state.js";

function arrayAcross(face, type, count, L, margin, opts = {}) {
  const out = [];
  if (count === 1) return [{ face, type, u: L / 2, ...opts }];
  for (let i = 0; i < count; i++) {
    out.push({ face, type, u: margin + (L - margin * 2) * (i / (count - 1)), ...opts });
  }
  return out;
}

export const TEMPLATES = {
  office: {
    label: "Office",
    icon: "🏢",
    make() {
      const w = 36.576, d = 18.288; // 120 × 60 ft
      return {
        name: "Office", assetType: "office",
        plan: { w, d }, stories: 4, floorH: 13 * FT, parapet: 4 * FT,
        material: "curtainwall",
        openings: [
          { face: "s", type: "glass-door", u: w / 2 },
          { face: "n", type: "man-door", u: 3 },
        ],
      };
    },
  },
  multifamily: {
    label: "Multifamily",
    icon: "🏘️",
    make() {
      const w = 45.72, d = 18.288; // 150 × 60 ft
      const openings = [
        { face: "s", type: "glass-door", u: w / 2 },
        { face: "n", type: "man-door", u: 2.5 },
        { face: "n", type: "man-door", u: w - 2.5 },
      ];
      // punched double-hungs, upper stories all around; ground floor
      // gets them clear of the entry
      for (let story = 0; story < 4; story++) {
        const sill = story * (10.5 * FT) + 3 * FT;
        for (const face of ["s", "n"]) {
          for (const o of arrayAcross(face, "double-hung", 10, w, 2.4, { sill })) {
            if (story === 0 && face === "s" && Math.abs(o.u - w / 2) < 2.8) continue;
            if (story === 0 && face === "n" && (Math.abs(o.u - 2.5) < 1.6 || Math.abs(o.u - (w - 2.5)) < 1.6)) continue;
            openings.push(o);
          }
        }
        for (const face of ["e", "w"]) {
          openings.push(...arrayAcross(face, "double-hung", 4, d, 2.2, { sill }));
        }
      }
      return {
        name: "Multifamily", assetType: "multifamily",
        plan: { w, d }, stories: 4, floorH: 10.5 * FT, parapet: 3 * FT,
        material: "brick",
        openings,
      };
    },
  },
  industrial: {
    label: "Industrial",
    icon: "🏭",
    make() {
      const w = 60.96, d = 30.48; // 200 × 100 ft
      const openings = [
        ...arrayAcross("n", "dock", 6, w, 6),
        { face: "e", type: "overhead", u: d / 2 },
        { face: "s", type: "glass-door", u: 5 },
        { face: "s", type: "man-door", u: w - 4 },
        ...arrayAcross("s", "fixed", 4, w, 10, { sill: 4.5 * FT }),
        { face: "w", type: "man-door", u: 3 },
      ];
      return {
        name: "Industrial", assetType: "industrial",
        plan: { w, d }, stories: 1, floorH: 32 * FT, parapet: 3 * FT,
        material: "metal",
        openings,
      };
    },
  },
  datacenter: {
    label: "Data Center",
    icon: "🖥️",
    make() {
      const w = 76.2, d = 36.576; // 250 × 120 ft
      // interior: hot/cold-aisle rack rows + mechanical/electrical lineup
      const interior = [];
      for (let row = 0; row < 4; row++) {
        const z = -10 + row * 4.5;
        for (let i = 0; i < 12; i++) {
          interior.push({ kind: "item", floor: 1, name: "Rack", type: "rack",
            x: -22 + i * 0.75, z, rot: 0, w: 0.6096, d: 1.0668, h: 2.1336, color: "#1f2937" });
        }
        interior.push({ kind: "item", floor: 1, name: "CRAC", type: "crac",
          x: -25.5, z, rot: 90, w: 2.4384, d: 0.9144, h: 1.9812, color: "#5ad7d2" });
      }
      for (let i = 0; i < 3; i++) {
        interior.push({ kind: "item", floor: 1, name: "UPS", type: "ups",
          x: 20 + i * 2, z: -12, rot: 0, w: 1.2192, d: 0.9144, h: 1.9812, color: "#9a8cff" });
      }
      interior.push({ kind: "item", floor: 1, name: "Switchgear", type: "switchgear",
        x: 26, z: -6, rot: 90, w: 2.7432, d: 1.2192, h: 2.286, color: "#e4b34a" });
      // electrical room demising wall
      interior.push({ kind: "wall", floor: 1, name: "Partition", x1: 15, z1: -18.288, x2: 15, z2: 0, t: 0.15 });
      interior.push({ kind: "wall", floor: 1, name: "Partition", x1: 15, z1: 0, x2: 38.1, z2: 0, t: 0.15 });
      return {
        name: "Data Center", assetType: "datacenter",
        plan: { w, d }, stories: 1, floorH: 24 * FT, parapet: 5 * FT,
        material: "concrete",
        interior,
        openings: [
          { face: "s", type: "glass-door", u: 6 },
          { face: "s", type: "fixed", u: 10.5, sill: 4 * FT },
          { face: "s", type: "fixed", u: 13.5, sill: 4 * FT },
          { face: "n", type: "dock", u: 8 },
          { face: "n", type: "dock", u: 12 },
          { face: "n", type: "man-door", u: 3 },
          { face: "e", type: "man-door", u: d / 2 },
          { face: "w", type: "man-door", u: d / 2 },
        ],
      };
    },
  },
  retail: {
    label: "Retail",
    icon: "🏬",
    make() {
      const w = 30.48, d = 24.384; // 100 × 80 ft
      const openings = [
        { face: "s", type: "glass-door", u: w / 2 },
        { face: "n", type: "man-door", u: 3 },
        { face: "n", type: "dock", u: w - 6 },
      ];
      // storefront run across the front, skipping the entry
      for (const o of arrayAcross("s", "storefront", 4, w, 3.4)) {
        if (Math.abs(o.u - w / 2) < 2.6) continue;
        openings.push(o);
      }
      return {
        name: "Retail", assetType: "retail",
        plan: { w, d }, stories: 1, floorH: 18 * FT, parapet: 4 * FT,
        material: "eifs",
        openings,
      };
    },
  },
};

/* =========================================================
   Signature builds — fully developed showcase projects, one
   Start-click away in the preset dropdown. Unlike the
   standard templates these ship an articulated shell spec
   (bands, canopy, fins, cornice, roof screen) and a complete
   floor-by-floor fit-out: structure grid, cores, MEP/power/
   utility rooms, ceiling-hung distribution, and buildout
   spaces — every system toggleable in the Interior tab.
   ========================================================= */
function itemSpec(type, floor, x, z, rot = 0, extra = {}) {
  const t = INTERIOR_TYPES[type];
  return {
    kind: "item", floor, type, x, z, rot,
    name: t.label, w: t.w, d: t.d, h: t.h, color: t.color,
    sys: t.sys, elev: t.elev, ...(t.space ? { space: true } : {}),
    ...extra,
  };
}
const coreWall = (floor, x1, z1, x2, z2) =>
  ({ kind: "wall", floor, name: "Core wall", x1, z1, x2, z2, t: 0.18 });

export const SIGNATURE = {
  office: [{
    label: "Meridian Point — 3-Story Class-A Office",
    icon: "⭐",
    make() {
      const w = 36.576, d = 21.336;   // 120 × 70 ft
      const FH = 14 * FT;             // 4.2672 m floor-to-floor

      /* ---------- envelope: storefront base, ribbon glass above ---------- */
      const openings = [{ face: "s", type: "glass-door", u: w / 2 }];
      for (let k = 0; k < 7; k++) {
        const u = 2.2 + k * 2.1;
        openings.push({ face: "s", type: "storefront", u });
        openings.push({ face: "s", type: "storefront", u: w - u });
      }
      for (let story = 1; story <= 2; story++) {
        const sill = story * FH + 3 * FT;
        for (let i = 0; i < 8; i++) {
          openings.push({ face: "s", type: "ribbon", u: 3.2 + i * 4.1, sill, h: 6 * FT });
          openings.push({ face: "n", type: "ribbon", u: 3.2 + i * 4.1, sill, h: 6 * FT });
        }
        for (let i = 0; i < 4; i++) {
          openings.push({ face: "e", type: "ribbon", u: 3.4 + i * 4.5, sill, h: 6 * FT });
          openings.push({ face: "w", type: "ribbon", u: 3.4 + i * 4.5, sill, h: 6 * FT });
        }
      }
      for (let i = 0; i < 6; i++) {
        openings.push({ face: "e", type: "fixed", u: 2.6 + i * 3.05, sill: 3.5 * FT });
        openings.push({ face: "w", type: "fixed", u: 2.6 + i * 3.05, sill: 3.5 * FT });
      }
      openings.push({ face: "n", type: "man-door", u: 2.5 });
      openings.push({ face: "n", type: "man-door", u: w - 2.5 });
      for (let i = 0; i < 9; i++)
        openings.push({ face: "n", type: "fixed", u: 6 + i * 3.05, sill: 3.5 * FT });

      /* ---------- facade articulation ---------- */
      const shell = {
        bandColor: "#262c33",
        bands: "floors", // re-derives from live story count/height
        cornice: { h: 0.45, color: "#cfc7b8" },
        corners: { w: 0.6, color: "#cfc7b8" },
        canopy: { face: "s", uf: 0.5, w: 8.2, depth: 2.6, y: 3.5, color: "#262c33" },
        fins: { face: "s", from: FH, us: [5.25, 9.35, 13.45, 17.55, 21.65, 25.75, 29.85],
                w: 0.22, depth: 0.4, color: "#cfc7b8" },
        roofScreen: { x: 0, z: -3.2, w: 15, d: 7.5, h: 2.0, color: "#39424c" },
      };

      /* ---------- structure, cores, systems, buildouts ---------- */
      const interior = [];
      const put = (...a) => interior.push(itemSpec(...a));

      for (let f = 1; f <= 3; f++) {
        // steel grid: two interior column rows on 22'-6" bays
        // (the bay at (0,-5.34) is omitted — it would stand in the core doorway)
        for (const cx of [-13.72, -6.86, 0, 6.86, 13.72])
          for (const cz of [-5.34, 5.34]) {
            if (cx === 0 && cz === -5.34) continue;
            put("col-steel", f, cx, cz);
          }
        // braced frames at each end wall
        put("brace-frame", f, -17.6, 0, 90);
        put("brace-frame", f, 17.6, 0, 90);
        // elevator / stair core against the north wall
        interior.push(coreWall(f, -3.05, -10.4, -3.05, -5.6));
        interior.push(coreWall(f, 3.05, -10.4, 3.05, -5.6));
        interior.push(coreWall(f, -3.05, -5.6, -0.8, -5.6));
        interior.push(coreWall(f, 0.8, -5.6, 3.05, -5.6));
        put("stair-run", f, 0, -8.6, 0); // centered inside the core
        // ceiling distribution: main ducts + VAVs + busway riser run
        put("duct-run", f, -6.0, 0.6, 0);
        put("duct-run", f, 6.0, 0.6, 0);
        put("vav", f, -9.0, 2.2);
        put("vav", f, -3.5, 2.2);
        put("vav", f, 3.5, 2.2);
        put("vav", f, 9.0, 2.2);
        put("busway", f, 5.0, -4.4, 0);
        // electrical / IDF closet gear beside the core
        put("panel", f, 4.2, -10.35, 0);
        put("idf", f, 5.3, -9.8, 0);
        // restroom core west of the elevator core
        put("restroom", f, -6.6, -8.1);
      }

      // Level 1 — arrival + main mechanical/electrical rooms
      put("reception", 1, 0, 6.9);
      put("conference", 1, 9.9, 6.9);
      put("break-room", 1, -9.9, 6.9);
      put("open-office", 1, -11.9, 0.2);
      put("office-run", 1, 13.9, -1.2, 90);
      put("it-room", 1, 6.4, -8.3);
      put("msb", 1, 15.9, -9.5, 0);
      put("ats", 1, 13.9, -9.6, 0);
      put("transformer-dry", 1, 12.1, -9.5, 0);
      put("fire-riser", 1, 17.5, -9.6, 0);
      put("backflow", 1, 17.3, -8.3, 90);
      put("waterheater", 1, 16.4, -7.3, 0);
      put("pump-skid", 1, 14.6, -7.2, 0);
      put("ahu", 1, 9.2, -8.4, 0);

      // Level 2 — the working floor
      put("open-office", 2, -10.5, 1.5);
      put("open-office", 2, 10.5, 1.5);
      put("office-run", 2, -12.6, -7.9, 0);
      put("conference", 2, 12.7, -7.8);
      put("break-room", 2, -4.7, 7.2);
      put("fcu", 2, 0, 5.2);
      put("fcu", 2, 0, -2.4);

      // Level 3 — executive floor
      put("conference", 3, 11.8, -7.6);
      put("office-run", 3, -12.6, -7.9, 0);
      put("amenity", 3, 9.2, 5.2);
      put("fitness", 3, -9.2, 5.0);
      put("open-office", 3, -1.6, -0.4);
      put("erv", 3, 15.6, -8.3, 90);

      // Rooftop plant (inside the screen wall) — floor 3 items mounted at roof level
      put("rtu", 3, -3.6, -3.0, 0, { elev: FH });
      put("rtu", 3, 3.6, -3.0, 0, { elev: FH });
      put("exhaust-fan", 3, -6.4, -5.6, 0, { elev: FH });
      put("exhaust-fan", 3, 6.4, -5.6, 0, { elev: FH });
      put("split-cu", 3, 0, -5.9, 0, { elev: FH });

      return {
        name: "Meridian Point", assetType: "office",
        plan: { w, d }, stories: 3, floorH: FH, parapet: 4 * FT,
        material: "concrete",
        shell, openings, interior,
      };
    },
  }],
};
