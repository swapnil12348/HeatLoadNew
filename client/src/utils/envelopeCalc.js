/**
 * envelopeCalc.js
 * Pure ASHRAE CLTD/CLF/SHGF calculation functions.
 * Reference: ASHRAE Handbook of Fundamentals (2021), Ch 18 & 27-28
 *
 * CHANGELOG v2.1:
 *
 *   FIX-01 — Seasonal multiplier now applied AFTER correctCLTD(), not before.
 *   FIX-02 — LM latitude correction consolidated into correctCLTD() call.
 *   FIX-03 — DR/21 multiplier removed from correctCLTD() usage here.
 *   FIX-04 — Winter heating uses U×A×ΔT (conduction), not CLTD × 0.4.
 *   FIX-05 — Glass solar gain: SHGC preferred over SC.
 *   FIX-06 — Winter solar gain treated as a credit (reduces heating load).
 *   FIX-07 — calcInfiltrationGain() field names corrected (LOW-02, LOW-03).
 *   FIX-08 — calcSlabGain() added using ASHRAE F-factor method.
 *
 *   FIX MED-04 — calcPartitionGain() is now season-aware.
 *     Partitions and internal floors carry tAdjSummer and tAdjWinter fields.
 *     Using a single tAdj for all seasons was wrong: a corridor adjacent to a
 *     cleanroom may be 85°F in summer (heat gain) and 50°F in winter (heat
 *     loss). The season-appropriate value is now selected, falling back to the
 *     legacy tAdj field for backward compatibility with existing elements.
 *     Reference: ASHRAE HOF 2021 Ch.18 — Q = U×A×(tAdj − tRoom)
 *
 *   FIX LOW-02 — calcInfiltrationGain() was reading climate?.outside?.[season]?.grains
 *     but climateSlice stores the field as .gr (derived by deriveFields()).
 *     This always returned the default 85 gr/lb regardless of climate state.
 *
 *   FIX LOW-03 — calcInfiltrationGain() was computing volume from room.area,
 *     which is always undefined in roomSlice (correct field is room.floorArea).
 *     Volume was always 0, so CFM was always 0. Fixed to use room.floorArea.
 *     NOTE: calcInfiltrationGain() is currently dead code — it is not called
 *     from seasonalLoads.js (infiltration is handled there via achValue).
 *     These fixes are correct for when it is eventually activated.
 *
 * SIGN CONVENTION (unchanged):
 *   Positive = heat INTO conditioned space (cooling load)
 *   Negative = heat OUT of conditioned space (heat loss / heating load)
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
  CLTD_LM,
  SHGF_LATITUDE_FACTOR,
  DIURNAL_RANGE_DEFAULTS,
  SLAB_F_FACTOR,
  interpolateLatitude,
} from '../constants/ashraeTables';

import ASHRAE from '../constants/ashrae';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute mean outdoor dry-bulb temperature.
 * ASHRAE: tMean = tPeak − DR/2
 */
const getMeanOutdoorTemp = (dbOutdoor, season, dailyRange) => {
  const range = (dailyRange > 0)
    ? dailyRange
    : (DIURNAL_RANGE_DEFAULTS[season] ?? 18);
  return dbOutdoor - range / 2;
};

/** Latitude-month (LM) correction for CLTD. */
const getLM = (latitude, orientation) => {
  const absLat = Math.abs(latitude);
  let orient = orientation;
  if (latitude < 0) {
    const swapMap = { N: 'S', S: 'N', NE: 'SE', SE: 'NE', SW: 'NW', NW: 'SW' };
    orient = swapMap[orientation] ?? orientation;
  }
  return interpolateLatitude(CLTD_LM, absLat, orient);
};

/** Latitude-corrected SHGF (BTU/hr·ft²). */
const getCorrectedSHGF = (orientation, season, latitude) => {
  const baseSHGF = SHGF[orientation]?.[season] ?? 100;
  const absLat   = Math.abs(latitude);
  let orient     = orientation;
  if (latitude < 0) {
    const swapMap = { N: 'S', S: 'N', NE: 'SE', SE: 'NE', SW: 'NW', NW: 'SW' };
    orient = swapMap[orientation] ?? orientation;
  }
  const factor = interpolateLatitude(SHGF_LATITUDE_FACTOR, absLat, orient);
  return baseSHGF * factor;
};

/**
 * Resolve SHGC from a glass element.
 * Prefer glass.shgc (new field). Fall back to glass.sc × 0.87 (legacy).
 */
const resolveShgc = (glass) => {
  if (glass.shgc != null && parseFloat(glass.shgc) > 0) {
    return parseFloat(glass.shgc);
  }
  const sc = parseFloat(glass.sc) || 1.0;
  return sc * 0.87;
};


// ─────────────────────────────────────────────────────────────────────────────
// 1. Wall Heat Gain / Heat Loss
// ─────────────────────────────────────────────────────────────────────────────
export const calcWallGain = (
  wall,
  climate,
  tRoom,
  season,
  latitude   = 28,
  dailyRange = 0,
) => {
  const area = parseFloat(wall.area)   || 0;
  const u    = parseFloat(wall.uValue) || 0;
  if (area === 0 || u === 0) return 0;

  const orientation  = wall.orientation  || 'N';
  const construction = wall.construction || 'medium';
  const dbOut        = parseFloat(climate?.outside?.[season]?.db) || 95;

  if (season === 'winter') {
    return u * area * (tRoom - dbOut);
  }

  const baseCLTD     = WALL_CLTD[orientation]?.[construction] ?? 15;
  const seasonMult   = WALL_CLTD_SEASONAL[season] ?? 1.0;
  const tMeanOutdoor = getMeanOutdoorTemp(dbOut, season, dailyRange);
  const lm           = getLM(latitude, orientation);

  // FIX MED-08: dropped old 5th-arg diurnalRange=21 — correctCLTD() no longer accepts it.
  // lm shifts from 5th to 4th position. tMeanOutdoor already encodes DR via tPeak − DR/2.
  const correctedCLTD = correctCLTD(baseCLTD, tRoom, tMeanOutdoor, lm) * seasonMult;
  return u * area * Math.max(0, correctedCLTD);
};


// ─────────────────────────────────────────────────────────────────────────────
// 2. Roof Heat Gain / Heat Loss
// ─────────────────────────────────────────────────────────────────────────────
export const calcRoofGain = (
  roof,
  climate,
  tRoom,
  season,
  latitude   = 28,
  dailyRange = 0,
) => {
  const area = parseFloat(roof.area)   || 0;
  const u    = parseFloat(roof.uValue) || 0;
  if (area === 0 || u === 0) return 0;

  const construction = roof.construction || '2" insulation';
  const dbOut        = parseFloat(climate?.outside?.[season]?.db) || 95;

  if (season === 'winter') {
    return u * area * (tRoom - dbOut);
  }

  const baseCLTD      = ROOF_CLTD[construction] ?? 30;
  const seasonMult    = ROOF_CLTD_SEASONAL[season] ?? 1.0;
  const tMeanOutdoor  = getMeanOutdoorTemp(dbOut, season, dailyRange);
  // FIX MED-08: dropped diurnalRange=21; lmCorrection=0 (roofs are orientation-independent).
  const correctedCLTD = correctCLTD(baseCLTD, tRoom, tMeanOutdoor, 0) * seasonMult;

  return u * area * Math.max(0, correctedCLTD);
};


// ─────────────────────────────────────────────────────────────────────────────
// 3. Glass Heat Gain / Heat Loss
// ─────────────────────────────────────────────────────────────────────────────
export const calcGlassGain = (
  glass,
  climate,
  tRoom,
  season,
  latitude   = 28,
  dailyRange = 0,
) => {
  const area = parseFloat(glass.area)   || 0;
  const u    = parseFloat(glass.uValue) || 0;
  if (area === 0) return { conduction: 0, solar: 0, total: 0 };

  const orientation = glass.orientation || 'E';
  const roomMass    = glass.roomMass    || 'medium';
  const shgc        = resolveShgc(glass);
  const dbOut       = parseFloat(climate?.outside?.[season]?.db) || 95;

  const shgf  = getCorrectedSHGF(orientation, season, latitude);
  const clf   = CLF[orientation]?.[roomMass] ?? 0.55;
  const solar = shgc * shgf * area * clf;

  if (season === 'winter') {
    const conduction = u * area * (tRoom - dbOut);
    const total      = conduction - solar;
    return {
      conduction: Math.round(conduction),
      solar:      Math.round(solar),
      total:      Math.round(total),
    };
  }

  const glassBaseCLTD      = GLASS_CLTD[season] ?? 15;
  const tMeanOutdoor       = getMeanOutdoorTemp(dbOut, season, dailyRange);
  // FIX MED-08: dropped diurnalRange=21; glass has no LM correction (lm=0).
  const correctedGlassCLTD = correctCLTD(glassBaseCLTD, tRoom, tMeanOutdoor, 0);
  const conduction         = u * area * correctedGlassCLTD;

  return {
    conduction: Math.round(conduction),
    solar:      Math.round(solar),
    total:      Math.round(conduction + solar),
  };
};


// ─────────────────────────────────────────────────────────────────────────────
// 4. Skylight Heat Gain
// ─────────────────────────────────────────────────────────────────────────────
export const calcSkylightGain = (
  skylight,
  climate,
  tRoom,
  season,
  latitude   = 28,
  dailyRange = 0,
) =>
  calcGlassGain(
    { ...skylight, orientation: 'Horizontal' },
    climate,
    tRoom,
    season,
    latitude,
    dailyRange,
  );


// ─────────────────────────────────────────────────────────────────────────────
// 5. Partition / Internal Floor Heat Transfer
// ─────────────────────────────────────────────────────────────────────────────
/**
 * FIX MED-04: calcPartitionGain is now season-aware.
 *
 * The adjacent-space temperature (tAdj) can differ significantly between
 * summer and winter. A corridor adjacent to a cleanroom may be 85°F in
 * summer (adding heat) and 50°F in winter (removing heat). Using a single
 * static tAdj produced incorrect loads in both directions.
 *
 * Element schema (new fields — backward-compatible):
 *   tAdj        — legacy fallback (used if seasonal fields absent)
 *   tAdjSummer  — adjacent space temp in summer/monsoon (°F)
 *   tAdjWinter  — adjacent space temp in winter (°F)
 *
 * Existing elements that only have tAdj continue to work correctly.
 * New elements should populate tAdjSummer and tAdjWinter for accuracy.
 *
 * @param {object} element - partition or floor element from envelopeSlice
 * @param {number} tRoom   - room design dry-bulb (°F)
 * @param {string} season  - 'summer' | 'monsoon' | 'winter'  (FIX MED-04)
 */
export const calcPartitionGain = (element, tRoom, season = 'summer') => {
  const area = parseFloat(element.area)   || 0;
  const u    = parseFloat(element.uValue) || 0;
  if (area === 0 || u === 0) return 0;

  // FIX MED-04: Select season-appropriate adjacent temperature.
  // Priority: seasonal field → legacy tAdj fallback → 85°F default.
  let tAdj;
  if (season === 'winter') {
    tAdj = parseFloat(element.tAdjWinter) ?? parseFloat(element.tAdj) ?? 85;
  } else {
    // summer and monsoon both use the summer adjacent temperature
    tAdj = parseFloat(element.tAdjSummer) ?? parseFloat(element.tAdj) ?? 85;
  }

  return u * area * (tAdj - tRoom);
};


// ─────────────────────────────────────────────────────────────────────────────
// 6. Slab-on-Grade Heat Loss
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ASHRAE F-factor method (HOF 2021 Ch.18 Table 12).
 *   Q_slab = F × perimeter_ft × (tRoom − tGround)
 * Negative = heat loss.
 */
export const calcSlabGain = (
  perimeterFt,
  insulationType = 'Uninsulated',
  tRoom,
  tGround = 60,
) => {
  const perimeter = parseFloat(perimeterFt) || 0;
  if (perimeter === 0) return 0;

  const fFactor = SLAB_F_FACTOR[insulationType] ?? SLAB_F_FACTOR['Uninsulated'];
  return -(fFactor * perimeter * Math.max(0, tRoom - tGround));
};


// ─────────────────────────────────────────────────────────────────────────────
// 7. Infiltration Heat Gain / Loss
// ─────────────────────────────────────────────────────────────────────────────
/**
 * NOTE: This function is currently dead code — infiltration is handled in
 * seasonalLoads.js via the envelope achValue field. These fixes (LOW-02,
 * LOW-03) are correct for when this function is eventually activated.
 *
 * FIX LOW-02: Was reading climate?.outside?.[season]?.grains — field does not
 *   exist in climateSlice. Correct field name is .gr (set by deriveFields()).
 *
 * FIX LOW-03: Was computing volume from room.area × height × 10.7639.
 *   room.area is always undefined in roomSlice — correct field is room.floorArea.
 *   Volume was always 0, so CFM was always 0 and function always returned zeros.
 *
 * @param {object} room    - room state (floorArea, height, pressurized)
 * @param {object} climate - climate state
 * @param {string} season  - 'summer' | 'monsoon' | 'winter'
 * @param {number} tRoom   - room design dry-bulb (°F)
 * @param {number} grRoom  - room design humidity ratio (gr/lb)
 * @returns {{ sensible: number, latent: number }}
 */
export const calcInfiltrationGain = (room, climate, season, tRoom, grRoom = 50) => {
  const isPressurized = room?.pressurized ?? false;
  if (isPressurized) return { sensible: 0, latent: 0 };

  // FIX LOW-03: was room?.area (always undefined) — correct field is room?.floorArea
  const floorAreaFt2 = parseFloat(room?.floorArea) || 0;
  const heightFt     = parseFloat(room?.height)    || 10;
  const volumeFt3    = floorAreaFt2 * heightFt * ASHRAE.M2_TO_FT2;

  const achInf = parseFloat(room?.infiltrationAch) || 0.25;
  const cfmInf = (volumeFt3 * achInf) / 60;

  if (cfmInf <= 0) return { sensible: 0, latent: 0 };

  const dbOut = parseFloat(climate?.outside?.[season]?.db) || 95;
  // FIX LOW-02: was .grains (field does not exist) — correct field is .gr
  const grOut = parseFloat(climate?.outside?.[season]?.gr) || 85;

  const sensible = ASHRAE.SENSIBLE_FACTOR * cfmInf * (dbOut - tRoom);
  const latent   = ASHRAE.LATENT_FACTOR   * cfmInf * Math.max(0, grOut - grRoom);

  return {
    sensible: Math.round(sensible),
    latent:   Math.round(latent),
  };
};


// ─────────────────────────────────────────────────────────────────────────────
// 8. Total Envelope Sensible Gain for a Room
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Aggregates all envelope element categories for a given season.
 * Returns sensible envelope gain only (BTU/hr), signed.
 * Infiltration and internal loads are summed separately in seasonalLoads.js.
 *
 * FIX MED-04: season is now passed through to calcPartitionGain() so that
 * tAdjSummer / tAdjWinter are selected correctly for each element.
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
  // FIX MED-04: pass season so calcPartitionGain selects tAdjSummer/tAdjWinter
  (elements.partitions || []).forEach(p => {
    total += calcPartitionGain(p, tRoom, season);
  });
  (elements.floors     || []).forEach(f => {
    total += calcPartitionGain(f, tRoom, season);
  });

  return Math.round(total);
};