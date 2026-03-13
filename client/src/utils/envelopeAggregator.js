/**
 * envelopeAggregator.js
 * Public API for total envelope heat gain/loss.
 * Responsibility: compose envelopeCalc.js + glazingCalc.js into a single
 * room-level result. This is the only envelope file that seasonalLoads.js
 * should import from.
 *
 * Import map:
 *   seasonalLoads.js  → envelopeAggregator.js  (this file — ALL envelope imports via here)
 *   envelopeCalc.js   → opaque elements (walls, roofs, partitions, slabs, infiltration)
 *   glazingCalc.js    → transparent elements (glass, skylights)
 *   envelopeHelpers.js → internal helpers (not imported externally)
 *
 * SIGN CONVENTION:
 *   Positive = heat INTO conditioned space  → cooling load contribution
 *   Negative = heat OUT OF conditioned space → heating load contribution
 *
 * Do NOT clamp results to Math.max(0, ...) — negative values are valid
 * and represent heating loads that must reach seasonalLoads.js intact.
 */

export { calcWallGain, calcRoofGain, calcPartitionGain, calcSlabGain,
         calcInfiltrationGain }                                        from './envelopeCalc';
export { calcGlassGain, calcSkylightGain }                             from './glazingCalc';
// ─────────────────────────────────────────────────────────────────────────────
// Total envelope gain — room level
// ─────────────────────────────────────────────────────────────────────────────
/**
 * calcTotalEnvelopeGain(elements, climate, tRoom, season, latitude?, dailyRange?)
 *
 * Aggregates all envelope element categories for a room.
 * Returns total sensible envelope gain/loss only (BTU/hr), signed.
 * Infiltration and internal loads are computed separately in seasonalLoads.js.
 *
 * @param {object} elements   - envelope elements from envelopeSlice
 *   { walls[], roofs[], glass[], skylights[], partitions[], floors[], slabs? }
 * @param {object} climate    - climate state from climateSlice
 * @param {number} tRoom      - room design dry-bulb (°F)
 * @param {string} season     - 'summer' | 'monsoon' | 'winter'
 * @param {number} latitude   - site latitude (degrees; negative = south)
 * @param {number} dailyRange - diurnal range (°F); 0 = use DIURNAL_RANGE_DEFAULTS
 * @returns {number} total sensible envelope gain (BTU/hr); signed
 */
export const calcTotalEnvelopeGain = (
  elements,
  climate,
  tRoom,
  season,
  latitude   = 28,
  dailyRange = 0,
) => {
  if (!elements) return 0;

  let total = 0;

  (elements.walls      || []).forEach(w => {
    total += calcWallGain(w, climate, tRoom, season, latitude, dailyRange);
  });

  (elements.roofs      || []).forEach(r => {
    total += calcRoofGain(r, climate, tRoom, season, latitude, dailyRange);
  });

  (elements.glass      || []).forEach(g => {
    total += calcGlassGain(g, climate, tRoom, season, latitude, dailyRange).total;
  });

  (elements.skylights  || []).forEach(s => {
    total += calcSkylightGain(s, climate, tRoom, season, latitude, dailyRange).total;
  });

  // FIX MED-04: season passed through so tAdjSummer / tAdjWinter is selected
  (elements.partitions || []).forEach(p => {
    total += calcPartitionGain(p, tRoom, season);
  });

  (elements.floors     || []).forEach(f => {
    total += calcPartitionGain(f, tRoom, season);
  });

  // Slabs: optional array — slab elements carry { perimeterFt, insulationType, tGround }
  (elements.slabs      || []).forEach(s => {
    total += calcSlabGain(
      s.perimeterFt,
      s.insulationType,
      tRoom,
      s.tGround ?? 55,
    );
  });

  return Math.round(total);
};

/**
 * calcDetailedEnvelopeGain(elements, climate, tRoom, season, latitude?, dailyRange?)
 *
 * Same as calcTotalEnvelopeGain but returns a per-category breakdown.
 * Used by RDSPage to populate individual envelope load rows.
 *
 * @returns {{
 *   walls:      number,
 *   roofs:      number,
 *   glass:      { conduction: number, solar: number, total: number },
 *   skylights:  { conduction: number, solar: number, total: number },
 *   partitions: number,
 *   floors:     number,
 *   slabs:      number,
 *   total:      number,
 * }}
 */
export const calcDetailedEnvelopeGain = (
  elements,
  climate,
  tRoom,
  season,
  latitude   = 28,
  dailyRange = 0,
) => {
  if (!elements) {
    return {
      walls: 0, roofs: 0,
      glass:     { conduction: 0, solar: 0, total: 0 },
      skylights: { conduction: 0, solar: 0, total: 0 },
      partitions: 0, floors: 0, slabs: 0, total: 0,
    };
  }

  const walls = (elements.walls || []).reduce((sum, w) =>
    sum + calcWallGain(w, climate, tRoom, season, latitude, dailyRange), 0);

  const roofs = (elements.roofs || []).reduce((sum, r) =>
    sum + calcRoofGain(r, climate, tRoom, season, latitude, dailyRange), 0);

  const glass = (elements.glass || []).reduce(
    (acc, g) => {
      const res = calcGlassGain(g, climate, tRoom, season, latitude, dailyRange);
      return {
        conduction: acc.conduction + res.conduction,
        solar:      acc.solar      + res.solar,
        total:      acc.total      + res.total,
      };
    },
    { conduction: 0, solar: 0, total: 0 },
  );

  const skylights = (elements.skylights || []).reduce(
    (acc, s) => {
      const res = calcSkylightGain(s, climate, tRoom, season, latitude, dailyRange);
      return {
        conduction: acc.conduction + res.conduction,
        solar:      acc.solar      + res.solar,
        total:      acc.total      + res.total,
      };
    },
    { conduction: 0, solar: 0, total: 0 },
  );

  const partitions = (elements.partitions || []).reduce((sum, p) =>
    sum + calcPartitionGain(p, tRoom, season), 0);

  const floors = (elements.floors || []).reduce((sum, f) =>
    sum + calcPartitionGain(f, tRoom, season), 0);

  const slabs = (elements.slabs || []).reduce((sum, s) =>
    sum + calcSlabGain(s.perimeterFt, s.insulationType, tRoom, s.tGround ?? 55), 0);

  const total = Math.round(
    walls + roofs + glass.total + skylights.total + partitions + floors + slabs
  );

  return {
    walls:      Math.round(walls),
    roofs:      Math.round(roofs),
    glass:      {
      conduction: Math.round(glass.conduction),
      solar:      Math.round(glass.solar),
      total:      Math.round(glass.total),
    },
    skylights:  {
      conduction: Math.round(skylights.conduction),
      solar:      Math.round(skylights.solar),
      total:      Math.round(skylights.total),
    },
    partitions: Math.round(partitions),
    floors:     Math.round(floors),
    slabs:      Math.round(slabs),
    total,
  };
};

