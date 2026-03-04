/**
 * envelopeCalc.js
 * Pure ASHRAE CLTD/CLF/SHGF calculation functions.
 * Reference: ASHRAE Handbook of Fundamentals (2021), Ch 18 & 27-28
 *
 * All functions are pure (no side effects) and return BTU/hr values.
 * Input units: area (ft²), U (BTU/hr·ft²·°F), temps (°F)
 *
 * SIGN CONVENTION:
 *   Positive = heat flowing INTO the conditioned space (cooling load)
 *   Negative = heat flowing OUT of the conditioned space (heat loss / heating load)
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

// ── Mean outdoor temperature ─────────────────────────────────────────────────
/**
 * Estimate mean daily outdoor dry-bulb from peak design DB.
 * ASHRAE correction formula requires: t_mean = (t_max + t_min) / 2
 * Since climateSlice only stores peak DB, we approximate using a
 * season-appropriate diurnal half-range:
 *
 *   Summer:  ~20°F total swing → half = 10°F  (dry heat, large swing)
 *   Monsoon: ~14°F total swing → half =  7°F  (high humidity dampens swing)
 *   Winter:  ~18°F total swing → half =  9°F
 *
 * Reference: ASHRAE Fundamentals Ch 14, Table 1 (typical diurnal ranges)
 */
const DIURNAL_HALF = { summer: 10, monsoon: 7, winter: 9 };

const getMeanOutdoorTemp = (dbOutdoor, season) =>
  dbOutdoor - (DIURNAL_HALF[season] ?? 10);

// ── 1. Wall Heat Gain — ASHRAE CLTD Method ───────────────────────────────────
/**
 * Q_wall = U × A × CLTD_corrected
 *
 * CLTD_corrected = (CLTD_table × seasonal_mult) + (78 − t_room) + (t_mean_outdoor − 85)
 *
 * Summer/Monsoon: clamped to ≥ 0 (no cooling credit from walls)
 * Winter:         allowed negative (heat loss contributes to heating load)
 *
 * @param {object} wall    - Redux wall element { orientation, construction, area, uValue }
 * @param {object} climate - state.climate
 * @param {number} tRoom   - indoor design temp (°F)
 * @param {string} season  - 'summer' | 'monsoon' | 'winter'
 * @returns {number} BTU/hr
 */
export const calcWallGain = (wall, climate, tRoom, season) => {
  const area = parseFloat(wall.area)   || 0;
  const u    = parseFloat(wall.uValue) || 0;
  if (area === 0 || u === 0) return 0;

  const orientation  = wall.orientation  || 'N';
  const construction = wall.construction || 'medium';

  const baseCLTD   = WALL_CLTD[orientation]?.[construction] ?? 15;
  const seasonMult = WALL_CLTD_SEASONAL[season] ?? 1.0;

  const dbOut        = parseFloat(climate?.outside?.[season]?.db) || 95;
  const tMeanOutdoor = getMeanOutdoorTemp(dbOut, season);

  const correctedCLTD = correctCLTD(baseCLTD * seasonMult, tRoom, tMeanOutdoor);
  const finalCLTD     = season === 'winter'
    ? correctedCLTD
    : Math.max(0, correctedCLTD);

  return u * area * finalCLTD;
};

// ── 2. Roof Heat Gain — ASHRAE CLTD Method ───────────────────────────────────
/**
 * Q_roof = U × A × CLTD_corrected
 *
 * Same correction logic as walls. Roofs see the highest solar exposure
 * so CLTD values are larger. Negative in winter = heat loss upward.
 *
 * @param {object} roof    - Redux roof element { construction, area, uValue }
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
  const tMeanOutdoor  = getMeanOutdoorTemp(dbOut, season);

  const correctedCLTD = correctCLTD(baseCLTD * seasonMult, tRoom, tMeanOutdoor);
  const finalCLTD     = season === 'winter'
    ? correctedCLTD
    : Math.max(0, correctedCLTD);

  return u * area * finalCLTD;
};

// ── 3. Glass Heat Gain — ASHRAE Conduction + Solar Method ────────────────────
/**
 * Q_glass = Q_conduction + Q_solar
 *
 * Q_conduction = U × A × CLTD_corrected
 *   Uses correctCLTD() with GLASS_CLTD base (15°F summer, 12°F monsoon, −5°F winter)
 *   Glass has negligible thermal mass so no seasonal clamping — sign is meaningful.
 *   Negative conduction = heat loss (winter or very cool outdoor conditions).
 *
 * Q_solar = SC × SHGF[orientation][season] × A × CLF[orientation][roomMass]
 *   Always positive — solar always adds heat regardless of season.
 *   In winter, solar gain beneficially offsets heating load.
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

  // ── Conduction ─────────────────────────────────────────────────────────────
  const glassBaseCLTD  = GLASS_CLTD[season]  ?? 15;
  const dbOut          = parseFloat(climate?.outside?.[season]?.db) || 95;
  const tMeanOutdoor   = getMeanOutdoorTemp(dbOut, season);
  // Use the exported correctCLTD() — same formula used for walls/roofs
  const correctedGlassCLTD = correctCLTD(glassBaseCLTD, tRoom, tMeanOutdoor);
  const conduction         = u * area * correctedGlassCLTD;
  // No clamping — glass conduction can be negative (heat loss) and that is meaningful

  // ── Solar ──────────────────────────────────────────────────────────────────
  const shgf  = SHGF[orientation]?.[season] ?? 100;
  const clf   = CLF[orientation]?.[roomMass] ?? 0.55;
  const solar = sc * shgf * area * clf;
  // Solar is always positive (no clamping needed — SHGF and CLF are always ≥ 0)

  return {
    conduction: Math.round(conduction),
    solar:      Math.round(solar),
    total:      Math.round(conduction + solar),
  };
};

// ── 4. Skylight Heat Gain ─────────────────────────────────────────────────────
/**
 * Same as glass but SHGF always uses Horizontal orientation.
 * Skylights receive direct overhead solar — use Horizontal SHGF values.
 *
 * @param {object} skylight - Redux skylight element
 * @param {object} climate
 * @param {number} tRoom    (°F)
 * @param {string} season
 * @returns {{ conduction: number, solar: number, total: number }}
 */
export const calcSkylightGain = (skylight, climate, tRoom, season) =>
  calcGlassGain(
    { ...skylight, orientation: 'Horizontal' },
    climate,
    tRoom,
    season,
  );

// ── 5. Partition / Floor Heat Gain — Simple ΔT ───────────────────────────────
/**
 * Q_partition = U × A × (tAdj − tRoom)
 *
 * tAdj = user-entered temperature of adjacent unconditioned space (°F).
 * Sign is meaningful:
 *   Positive → adjacent space warmer than conditioned space (heat gain, adds to cooling)
 *   Negative → adjacent space cooler than conditioned space (heat loss, e.g. cold store)
 *
 * Do NOT clamp here — callers decide whether to use the signed value.
 *
 * @param {object} element - { area, uValue, tAdj }
 * @param {number} tRoom   - indoor design temp (°F)
 * @returns {number} BTU/hr (signed)
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
 * Used by rdsSelector.js for all seasons.
 *
 * SIGN CONVENTION carried through:
 *   Summer/Monsoon: walls & roofs clamped ≥ 0 inside calcWallGain/calcRoofGain.
 *                   Glass, partitions, floors: signed (negative = heat loss).
 *   Winter:         all elements signed — negative total = net heat loss.
 *
 * The result is passed directly into the sensible load sum in rdsSelector.
 * A negative total in winter correctly reduces the winter "heating load" calculation.
 *
 * @param {object} elements - envelope.elements from envelopeSlice
 * @param {object} climate  - state.climate
 * @param {number} tRoom    - room design temp (°F)
 * @param {string} season
 * @returns {number} Total envelope sensible gain (BTU/hr), signed
 */
export const calcTotalEnvelopeGain = (elements, climate, tRoom, season) => {
  if (!elements) return 0;

  let total = 0;

  (elements.walls      || []).forEach(w => { total += calcWallGain(w, climate, tRoom, season); });
  (elements.roofs      || []).forEach(r => { total += calcRoofGain(r, climate, tRoom, season); });
  (elements.glass      || []).forEach(g => { total += calcGlassGain(g, climate, tRoom, season).total; });
  (elements.skylights  || []).forEach(s => { total += calcSkylightGain(s, climate, tRoom, season).total; });
  // Partitions and floors: pass signed value — negative means heat is leaving
  // the conditioned space (cold-adjacent store, slab-on-grade below dewpoint, etc.)
  (elements.partitions || []).forEach(p => { total += calcPartitionGain(p, tRoom); });
  (elements.floors     || []).forEach(f => { total += calcPartitionGain(f, tRoom); });

  return Math.round(total);
};