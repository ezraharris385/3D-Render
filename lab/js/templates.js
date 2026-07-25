/* =========================================================
   Studio — asset-type templates. Each generator returns the
   `partial` consumed by makeBuilding(). Dimensions in meters
   (FT constants keep the real-world numbers legible). These
   are starting points — every value is editable afterwards,
   and the same schema is the hook for your own per-asset
   database later (see README).
   ========================================================= */
import { FT } from "./state.js";

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
      return {
        name: "Data Center", assetType: "datacenter",
        plan: { w, d }, stories: 1, floorH: 24 * FT, parapet: 5 * FT,
        material: "concrete",
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
