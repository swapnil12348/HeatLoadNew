/**
 * envelopeCalc.js
 * Pure ASHRAE CLTD/CLF/SHGF calculation functions.
 * Reference: ASHRAE Handbook of Fundamentals (2021), Ch 18 & 27-28
 *
 * BUG-07 FIX: Latitude corrections now applied to both CLTD and SHGF.
 *   - CLTD_LM correction shifts wall/roof CLTD from 40°N reference to
 *     actual project latitude.
 *   - SHGF_LATITUDE_FACTOR corrects solar heat gain from 32°N reference
 *     to actual project latitude.
 *   Both use interpolateLatitude() for smooth correction between table rows.
 *
 * BUG-09 FIX: Diurnal temperature range is no longer hardcoded.
 *   - calcTotalEnvelopeGain() now accepts a dailyRange argument (°F).
 *   - When dailyRange > 0 it overrides the seasonal defaults.
 *   - Falls back to DIURNAL_RANGE_DEFAULTS[season] when not supplied.
 *   - Engineer sets actual site daily range in ProjectDetails.
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
  interpolateLatitude,
} from '../constants/ashraeTables';

// ── Mean outdoor temperature ──────────────────────────────────────────────────
/**
 * BUG-09 FIX: dailyRange now comes from the project's ambient settings.
 *
 * ASHRAE correction requires t_mean = (t_max + t_min) / 2
 * Since climateSlice stores only peak DB:
 *   t_min  = t_peak − dailyRange
 *   t_mean = t_peak − dailyRange / 2
 *
 * @param {number} dbOutdoor - peak design dry bulb (°F)
 * @param {string} season    - 'summer' | 'monsoon' | 'winter'
 * @param {number} dailyRange - full daily temp swing (°F). 0 = use defaults.
 */
const getMeanOutdoorTemp = (dbOutdoor, season, dailyRange) => {
  // Use supplied dailyRange if > 0, otherwise fall back to season defaults.
  const range = dailyRange > 0
    ? dailyRange
    : DIURNAL_RANGE_DEFAULTS[season] ?? 18;
  return dbOutdoor - range / 2;
};

// ── Get latitude-corrected CLTD LM value ─────────────────────────────────────
/**
 * BUG-07 FIX: interpolate LM correction for actual project latitude.
 *
 * For southern hemisphere (lat < 0): use abs(lat) and swap N↔S orientation.
 * For northern hemisphere: use lat directly.
 *
 * @param {number} latitude     - Project latitude in decimal degrees
 * @param {string} orientation  - Wall orientation: 'N','NE','E','SE','S','SW','W','NW'
 * @returns {number} LM correction (°F) to add to corrected CLTD
 */
const getLM = (latitude, orientation) => {
  const absLat = Math.abs(latitude);
  let orient = orientation;

  // Southern hemisphere: sun is in the north, so swap N↔S.
  if (latitude < 0) {
    const swapMap = { N: 'S', S: 'N', NE: 'SE', SE: 'NE', SW: 'NW', NW: 'SW' };
    orient = swapMap[orientation] ?? orientation;
  }

  return interpolateLatitude(CLTD_LM, absLat, orient);
};

// ── Get latitude-corrected SHGF ───────────────────────────────────────────────
/**
 * BUG-07 FIX: apply SHGF latitude correction factor.
 *
 * The base SHGF table is at 32°N. Multiply by the latitude factor.
 *
 * @param {string} orientation - 'N','NE','E','SE','S','SW','W','NW','Horizontal'
 * @param {string} season
 * @param {number} latitude    - project latitude (decimal degrees)
 * @returns {number} Corrected SHGF (BTU/hr·ft²)
 */
const getCorrectedSHGF = (orientation, season, latitude) => {
  const baseSHGF = SHGF[orientation]?.[season] ?? 100;

  // S hemisphere: swap N↔S for SHGF orientation, use abs(lat) for table lookup
  const absLat = Math.abs(latitude);
  let orient   = orientation;
  if (latitude < 0) {
    const swapMap = { N: 'S', S: 'N', NE: 'SE', SE: 'NE', SW: 'NW', NW: 'SW' };
    orient = swapMap[orientation] ?? orientation;
  }

  const factor = interpolateLatitude(SHGF_LATITUDE_FACTOR, absLat, orient);
  return baseSHGF * factor;
};

// ── 1. Wall Heat Gain — ASHRAE CLTD Method ───────────────────────────────────
/**
 * Q_wall = U × A × CLTD_corrected
 *
 * CLTD_corrected = (baseCLTD × seasonMult) + (78 − tRoom) + (tMean − 85) + LM
 *
 * BUG-07 FIX: LM term added — shifts 40°N reference to actual project latitude.
 * BUG-09 FIX: tMean uses actual site dailyRange instead of hardcoded half-range.
 */
export const calcWallGain = (wall, climate, tRoom, season, latitude = 28, dailyRange = 0) => {
  const area = parseFloat(wall.area)   || 0;
  const u    = parseFloat(wall.uValue) || 0;
  if (area === 0 || u === 0) return 0;

  const orientation  = wall.orientation  || 'N';
  const construction = wall.construction || 'medium';

  const baseCLTD   = WALL_CLTD[orientation]?.[construction] ?? 15;
  const seasonMult = WALL_CLTD_SEASONAL[season] ?? 1.0;

  const dbOut        = parseFloat(climate?.outside?.[season]?.db) || 95;
  const tMeanOutdoor = getMeanOutdoorTemp(dbOut, season, dailyRange);

  // correctCLTD applies the standard (78 − tRoom) + (tMean − 85) adjustment
  const corrected = correctCLTD(baseCLTD * seasonMult, tRoom, tMeanOutdoor);

  // BUG-07 FIX: add LM correction for actual latitude
  const lm            = getLM(latitude, orientation);
  const correctedCLTD = corrected + lm;

  const finalCLTD = season === 'winter'
    ? correctedCLTD
    : Math.max(0, correctedCLTD);

  return u * area * finalCLTD;
};

// ── 2. Roof Heat Gain — ASHRAE CLTD Method ───────────────────────────────────
/**
 * Q_roof = U × A × CLTD_corrected
 *
 * Roofs have no orientation so no LM correction applies.
 * BUG-09 FIX: tMean uses actual site dailyRange.
 */
export const calcRoofGain = (roof, climate, tRoom, season, latitude = 28, dailyRange = 0) => {
  const area = parseFloat(roof.area)   || 0;
  const u    = parseFloat(roof.uValue) || 0;
  if (area === 0 || u === 0) return 0;

  const construction = roof.construction || '2" insulation';
  const baseCLTD     = ROOF_CLTD[construction] ?? 30;
  const seasonMult   = ROOF_CLTD_SEASONAL[season] ?? 1.0;

  const dbOut        = parseFloat(climate?.outside?.[season]?.db) || 95;
  const tMeanOutdoor = getMeanOutdoorTemp(dbOut, season, dailyRange);

  const correctedCLTD = correctCLTD(baseCLTD * seasonMult, tRoom, tMeanOutdoor);

  // Note: No LM applied to roofs — LM corrections are orientation-dependent.
  // Horizontal surfaces have negligible latitude correction for CLTD
  // (their CLTD is driven by solar on the horizontal plane, not wall exposure angle).

  const finalCLTD = season === 'winter'
    ? correctedCLTD
    : Math.max(0, correctedCLTD);

  return u * area * finalCLTD;
};

// ── 3. Glass Heat Gain — Conduction + Solar ───────────────────────────────────
/**
 * Q_glass = Q_conduction + Q_solar
 *
 * Q_conduction = U × A × CLTD_corrected
 *   BUG-09 FIX: tMean uses actual site dailyRange.
 *
 * Q_solar = SC × SHGF_corrected × A × CLF
 *   BUG-07 FIX: SHGF now corrected for actual project latitude.
 */
export const calcGlassGain = (glass, climate, tRoom, season, latitude = 28, dailyRange = 0) => {
  const area = parseFloat(glass.area)   || 0;
  const u    = parseFloat(glass.uValue) || 0;
  const sc   = parseFloat(glass.sc)     || 1.0;
  if (area === 0) return { conduction: 0, solar: 0, total: 0 };

  const orientation = glass.orientation || 'E';
  const roomMass    = glass.roomMass    || 'medium';

  // ── Conduction ─────────────────────────────────────────────────────────────
  const glassBaseCLTD      = GLASS_CLTD[season] ?? 15;
  const dbOut              = parseFloat(climate?.outside?.[season]?.db) || 95;
  const tMeanOutdoor       = getMeanOutdoorTemp(dbOut, season, dailyRange);
  const correctedGlassCLTD = correctCLTD(glassBaseCLTD, tRoom, tMeanOutdoor);
  const conduction         = u * area * correctedGlassCLTD;
  // Signed — glass conduction can be negative (heat loss) in winter.

  // ── Solar ──────────────────────────────────────────────────────────────────
  // BUG-07 FIX: use latitude-corrected SHGF instead of raw 32°N table value.
  const shgf  = getCorrectedSHGF(orientation, season, latitude);
  const clf   = CLF[orientation]?.[roomMass] ?? 0.55;
  const solar = sc * shgf * area * clf;

  return {
    conduction: Math.round(conduction),
    solar:      Math.round(solar),
    total:      Math.round(conduction + solar),
  };
};

// ── 4. Skylight Heat Gain ─────────────────────────────────────────────────────
/**
 * Same as glass but forced Horizontal orientation.
 * BUG-07 + BUG-09 corrections flow through calcGlassGain.
 */
export const calcSkylightGain = (skylight, climate, tRoom, season, latitude = 28, dailyRange = 0) =>
  calcGlassGain(
    { ...skylight, orientation: 'Horizontal' },
    climate,
    tRoom,
    season,
    latitude,
    dailyRange,
  );

// ── 5. Partition / Floor Heat Gain ────────────────────────────────────────────
/**
 * Q = U × A × (tAdj − tRoom)
 * Signed — callers decide whether to clamp.
 * Latitude and dailyRange don't affect conduction through internal surfaces.
 */
export const calcPartitionGain = (element, tRoom) => {
  const area = parseFloat(element.area)   || 0;
  const u    = parseFloat(element.uValue) || 0;
  const tAdj = parseFloat(element.tAdj)   || 85;
  return u * area * (tAdj - tRoom);
};

// ── 6. Total Envelope Sensible Gain for a Room ────────────────────────────────
/**
 * Aggregates all six element categories for a given season.
 *
 * BUG-07 FIX: latitude passed to all wall, roof, glass, skylight calculations.
 * BUG-09 FIX: dailyRange passed to all calculations — replaces hardcoded values.
 *
 * @param {object} elements   - envelope.elements from envelopeSlice
 * @param {object} climate    - state.climate
 * @param {number} tRoom      - room design temp (°F)
 * @param {string} season     - 'summer' | 'monsoon' | 'winter'
 * @param {number} latitude   - project latitude (decimal degrees). Default 28°N.
 * @param {number} dailyRange - full daily DB swing (°F). 0 = use seasonal default.
 * @returns {number} Total envelope sensible gain (BTU/hr), signed
 */
export const calcTotalEnvelopeGain = (
  elements, climate, tRoom, season,
  latitude  = 28,
  dailyRange = 0,
) => {
  if (!elements) return 0;

  let total = 0;

  (elements.walls     || []).forEach(w => {
    total += calcWallGain(w, climate, tRoom, season, latitude, dailyRange);
  });
  (elements.roofs     || []).forEach(r => {
    total += calcRoofGain(r, climate, tRoom, season, latitude, dailyRange);
  });
  (elements.glass     || []).forEach(g => {
    total += calcGlassGain(g, climate, tRoom, season, latitude, dailyRange).total;
  });
  (elements.skylights || []).forEach(s => {
    total += calcSkylightGain(s, climate, tRoom, season, latitude, dailyRange).total;
  });
  (elements.partitions || []).forEach(p => {
    total += calcPartitionGain(p, tRoom);
  });
  (elements.floors    || []).forEach(f => {
    total += calcPartitionGain(f, tRoom);
  });

  return Math.round(total);
};