/**
 * envelopeCalc.js
 * Pure ASHRAE CLTD/CLF/SHGF calculation functions.
 * Reference: ASHRAE Handbook of Fundamentals (2021), Ch 18 & 27-28
 *
 * All functions are pure (no side effects) and return BTU/hr values.
 * Input units: area (ft²), U (BTU/hr·ft²·°F), temps (°F)
 */

import {
  WALL_CLTD,
  WALL_CLTD_SEASONAL,
  ROOF_CLTD,
  ROOF_CLTD_SEASONAL,
  GLASS_CLTD,
  SHGF,
  CLF,
  correctCLTD,
} from '../constants/ashraeTables';

// ── Shared CLTD correction helper ────────────────────────────────────────────
// Computes mean outdoor temp per season from climateSlice data
// Approximation: mean = (DB - 10) for typical diurnal range of 20°F
const getMeanOutdoorTemp = (dbOutdoor) => dbOutdoor - 10;

// ── 1. Wall Heat Gain — ASHRAE CLTD Method ──────────────────────────────────
/**
 * Q_wall = U × A × CLTD_corrected
 *
 * @param {object} wall    - Redux wall element
 * @param {object} climate - state.climate
 * @param {number} tRoom   - indoor design temp (°F)
 * @param {string} season  - 'summer' | 'monsoon' | 'winter'
 * @returns {number} Heat gain in BTU/hr
 */
export const calcWallGain = (wall, climate, tRoom, season) => {
  const area = parseFloat(wall.area)   || 0;
  const u    = parseFloat(wall.uValue) || 0;
  if (area === 0 || u === 0) return 0;

  const orientation  = wall.orientation  || 'N';
  const construction = wall.construction || 'medium';

  // Base CLTD from table
  const baseCLTD = WALL_CLTD[orientation]?.[construction] ?? 15;

  // Seasonal multiplier
  const seasonMult = WALL_CLTD_SEASONAL[season] ?? 1.0;

  // Correct for actual indoor/outdoor design temps
  const dbOut         = parseFloat(climate?.outside?.[season]?.db) || 95;
  const tOutdoorMean  = getMeanOutdoorTemp(dbOut);
  const correctedCLTD = correctCLTD(baseCLTD * seasonMult, tRoom, tOutdoorMean);

  // Clamp to 0 in summer (we don't want negative gains for walls in cooling calc)
  const finalCLTD = season === 'winter' ? correctedCLTD : Math.max(0, correctedCLTD);

  return u * area * finalCLTD;
};

// ── 2. Roof Heat Gain — ASHRAE CLTD Method ──────────────────────────────────
/**
 * Q_roof = U × A × CLTD_corrected
 *
 * @param {object} roof    - Redux roof element
 * @param {object} climate - state.climate
 * @param {number} tRoom   - indoor design temp (°F)
 * @param {string} season
 * @returns {number} BTU/hr
 */
export const calcRoofGain = (roof, climate, tRoom, season) => {
  const area = parseFloat(roof.area)   || 0;
  const u    = parseFloat(roof.uValue) || 0;
  if (area === 0 || u === 0) return 0;

  const construction  = roof.construction || '2" insulation';
  const baseCLTD      = ROOF_CLTD[construction] ?? 30;
  const seasonMult    = ROOF_CLTD_SEASONAL[season] ?? 1.0;

  const dbOut         = parseFloat(climate?.outside?.[season]?.db) || 95;
  const tOutdoorMean  = getMeanOutdoorTemp(dbOut);
  const correctedCLTD = correctCLTD(baseCLTD * seasonMult, tRoom, tOutdoorMean);

  const finalCLTD = season === 'winter' ? correctedCLTD : Math.max(0, correctedCLTD);

  return u * area * finalCLTD;
};

// ── 3. Glass Heat Gain — ASHRAE Conduction + Solar Method ───────────────────
/**
 * Q_glass = Q_conduction + Q_solar
 *
 * Q_conduction = U × A × CLTD_glass
 * Q_solar      = SC × SHGF[orientation][season] × A × CLF[orientation][roomMass]
 *
 * Both components computed and summed.
 *
 * @param {object} glass   - Redux glass element
 * @param {object} climate - state.climate
 * @param {number} tRoom   - indoor design temp (°F)
 * @param {string} season
 * @returns {{ conduction: number, solar: number, total: number }}
 */
export const calcGlassGain = (glass, climate, tRoom, season) => {
  const area = parseFloat(glass.area)   || 0;
  const u    = parseFloat(glass.uValue) || 0;
  const sc   = parseFloat(glass.sc)     || 1.0;
  if (area === 0) return { conduction: 0, solar: 0, total: 0 };

  const orientation = glass.orientation || 'E';
  const roomMass    = glass.roomMass    || 'medium';

  // Conduction component
  const glassBaseCLTD = GLASS_CLTD[season] ?? 15;
  const dbOut         = parseFloat(climate?.outside?.[season]?.db) || 95;
  const tOutdoorMean  = getMeanOutdoorTemp(dbOut);
  // Apply CLTD correction for glass (smaller correction — glass has little thermal mass)
  const correctedGlassCLTD = glassBaseCLTD + (78 - tRoom) + (tOutdoorMean - 85);
  const conduction = u * area * correctedGlassCLTD;

  // Solar component
  const shgf = SHGF[orientation]?.[season]      ?? 100;
  const clf  = CLF[orientation]?.[roomMass]      ?? 0.55;
  // In winter, glass solar gain is beneficial (reduces heating load) — still compute
  const solar = sc * shgf * area * clf;

  return {
    conduction: Math.round(conduction),
    solar:      Math.round(solar),
    total:      Math.round(conduction + solar),
  };
};

// ── 4. Skylight Heat Gain ────────────────────────────────────────────────────
/**
 * Same as glass but always Horizontal orientation for SHGF.
 *
 * @param {object} skylight - Redux skylight element
 * @param {object} climate
 * @param {number} tRoom
 * @param {string} season
 * @returns {{ conduction: number, solar: number, total: number }}
 */
export const calcSkylightGain = (skylight, climate, tRoom, season) => {
  // Delegate to calcGlassGain with forced horizontal orientation
  return calcGlassGain(
    { ...skylight, orientation: 'Horizontal' },
    climate,
    tRoom,
    season,
  );
};

// ── 5. Partition / Floor Heat Gain — Simple ΔT ──────────────────────────────
/**
 * Q_partition = U × A × (tAdj - tRoom)
 *
 * Used for:
 *  - Partitions adjacent to unconditioned spaces (corridors, machine rooms)
 *  - Floors above unconditioned spaces or on grade
 *
 * tAdj = temperature of adjacent unconditioned space (user-defined, °F)
 *
 * @param {object} element - Redux partition or floor element
 * @param {number} tRoom   - indoor design temp (°F)
 * @returns {number} BTU/hr (can be negative — meaning heat loss)
 */
export const calcPartitionGain = (element, tRoom) => {
  const area  = parseFloat(element.area)   || 0;
  const u     = parseFloat(element.uValue) || 0;
  const tAdj  = parseFloat(element.tAdj)   || 85;
  return u * area * (tAdj - tRoom);
};

// ── 6. Total Envelope Sensible Gain for a Room ───────────────────────────────
/**
 * Aggregates all element categories for a room for a given season.
 * Used by rdsSelector.js to replace the old stub loop.
 *
 * @param {object} elements - envelope.elements from envelopeSlice
 * @param {object} climate  - state.climate
 * @param {number} tRoom    - room design temp (°F)
 * @param {string} season
 * @returns {number} Total envelope sensible gain (BTU/hr)
 */
export const calcTotalEnvelopeGain = (elements, climate, tRoom, season) => {
  if (!elements) return 0;

  let total = 0;

  // Walls
  (elements.walls || []).forEach(w => {
    total += calcWallGain(w, climate, tRoom, season);
  });

  // Roofs
  (elements.roofs || []).forEach(r => {
    total += calcRoofGain(r, climate, tRoom, season);
  });

  // Glass (conduction + solar)
  (elements.glass || []).forEach(g => {
    total += calcGlassGain(g, climate, tRoom, season).total;
  });

  // Skylights
  (elements.skylights || []).forEach(s => {
    total += calcSkylightGain(s, climate, tRoom, season).total;
  });

  // Partitions
  (elements.partitions || []).forEach(p => {
    // Only add positive gains (heat flowing INTO conditioned space)
    total += Math.max(0, calcPartitionGain(p, tRoom));
  });

  // Floors
  (elements.floors || []).forEach(f => {
    total += Math.max(0, calcPartitionGain(f, tRoom));
  });

  return Math.round(total);
};