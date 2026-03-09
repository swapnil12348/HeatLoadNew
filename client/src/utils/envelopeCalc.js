/**
 * envelopeCalc.js
 * Opaque envelope heat gain / loss calculations.
 * Responsibility: walls, roofs, partitions, internal floors, slabs, infiltration.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Ch.18 & 28
 *            ASHRAE CHLCM 2nd Edition, §3
 *
 * SIGN CONVENTION (all functions):
 *   Positive = heat INTO conditioned space  → cooling load
 *   Negative = heat OUT OF conditioned space → heating load / heat loss
 *
 * ⚠️  NEVER clamp return values to Math.max(0, ...).
 *     Negative values are physically valid (heat loss through element).
 *     Clamping silently drops heating loads from the calculation chain.
 *     Reference: ashraeTables.js correctCLTD() — FIX MED-10.
 *
 * CHANGELOG:
 *   FIX-01 — Seasonal multiplier applied AFTER correctCLTD(), not before.
 *   FIX-02 — LM correction consolidated into correctCLTD() call.
 *   FIX-03 — DR/21 multiplier removed (ashraeTables.js FIX MED-08).
 *   FIX-04 — Winter heating uses U×A×ΔT (conduction), not CLTD × 0.4.
 *   FIX-07 — calcInfiltrationGain() field names corrected (LOW-02, LOW-03).
 *   FIX-08 — calcSlabGain() added using ASHRAE F-factor method.
 *   FIX-09 — Math.max(0, correctedCLTD) clamping REMOVED from walls and roofs.
 *             Negative CLTD = heat loss in marginal conditions — do not zero out.
 *   FIX-10 — calcInfiltrationGain: replaced ASHRAE.SENSIBLE/LATENT_FACTOR with
 *             altitude-corrected sensibleFactor(elev) / latentFactor(elev).
 *   FIX-11 — calcInfiltrationGain: removed erroneous M2_TO_FT2 multiplier on
 *             floorArea. roomSlice stores floorArea in ft² already — applying
 *             M2_TO_FT2 inflated infiltration volume by 10.76× and CFM by 10×.
 *   FIX MED-04 — calcPartitionGain() is season-aware (tAdjSummer / tAdjWinter).
 */

import {
  WALL_CLTD,
  WALL_CLTD_SEASONAL,
  ROOF_CLTD,
  ROOF_CLTD_SEASONAL,
  SLAB_F_FACTOR,
  correctCLTD,
} from '../constants/ashraeTables';

import { sensibleFactor, latentFactor } from '../utils/psychro';
import { getMeanOutdoorTemp, getLM }     from './envelopeHelpers';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Wall Heat Gain / Heat Loss
// ─────────────────────────────────────────────────────────────────────────────
/**
 * calcWallGain(wall, climate, tRoom, season, latitude?, dailyRange?, elevFt?)
 *
 * Summer/monsoon: CLTD method (ASHRAE Ch.28).
 * Winter: steady-state conduction Q = U × A × (tRoom − tOutdoor).
 *
 * @param {object} wall       - wall element from envelopeSlice
 * @param {object} climate    - climate state from climateSlice
 * @param {number} tRoom      - room design dry-bulb (°F)
 * @param {string} season     - 'summer' | 'monsoon' | 'winter'
 * @param {number} latitude   - site latitude (degrees; negative = south)
 * @param {number} dailyRange - diurnal range (°F); 0 = use DIURNAL_RANGE_DEFAULTS
 * @returns {number} heat gain (BTU/hr); negative = heat loss
 */
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

  // Winter: steady-state conduction (sign convention: positive = into space)
  if (season === 'winter') {
    return u * area * (dbOut - tRoom);   // negative when dbOut < tRoom (heat loss)
  }

  const baseCLTD     = WALL_CLTD[orientation]?.[construction] ?? 15;
  const seasonMult   = WALL_CLTD_SEASONAL[season] ?? 1.0;
  const tMeanOutdoor = getMeanOutdoorTemp(dbOut, season, dailyRange);
  const lm           = getLM(latitude, orientation);

  // FIX-09: removed Math.max(0, ...) — negative correctedCLTD is valid (marginal conditions).
  const correctedCLTD = correctCLTD(baseCLTD, tRoom, tMeanOutdoor, lm) * seasonMult;
  return u * area * correctedCLTD;
};


// ─────────────────────────────────────────────────────────────────────────────
// 2. Roof Heat Gain / Heat Loss
// ─────────────────────────────────────────────────────────────────────────────
/**
 * calcRoofGain(roof, climate, tRoom, season, latitude?, dailyRange?)
 *
 * Roofs have no orientation LM correction (horizontal surface).
 *
 * @param {object} roof       - roof element from envelopeSlice
 * @param {object} climate    - climate state
 * @param {number} tRoom      - room design dry-bulb (°F)
 * @param {string} season     - 'summer' | 'monsoon' | 'winter'
 * @param {number} latitude   - site latitude (unused for roof LM; retained for API symmetry)
 * @param {number} dailyRange - diurnal range (°F)
 * @returns {number} heat gain (BTU/hr); negative = heat loss
 */
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
    return u * area * (dbOut - tRoom);   // negative = heat loss
  }

  const baseCLTD      = ROOF_CLTD[construction] ?? 30;
  const seasonMult    = ROOF_CLTD_SEASONAL[season] ?? 1.0;
  const tMeanOutdoor  = getMeanOutdoorTemp(dbOut, season, dailyRange);
  // lmCorrection = 0 for roofs (orientation-independent horizontal surface)
  // FIX-09: no Math.max(0, ...) clamp
  const correctedCLTD = correctCLTD(baseCLTD, tRoom, tMeanOutdoor, 0) * seasonMult;

  return u * area * correctedCLTD;
};


// ─────────────────────────────────────────────────────────────────────────────
// 3. Partition / Internal Floor Heat Transfer
// ─────────────────────────────────────────────────────────────────────────────
/**
 * calcPartitionGain(element, tRoom, season?)
 *
 * FIX MED-04: Season-aware adjacent temperature selection.
 * A corridor adjacent to a cleanroom is 85°F in summer (heat gain into space)
 * and 50°F in winter (heat loss from space). Using a single tAdj produced
 * wrong loads in both directions.
 *
 * Element schema:
 *   tAdjSummer (°F) — adjacent space design temp, summer/monsoon (new field)
 *   tAdjWinter (°F) — adjacent space design temp, winter            (new field)
 *   tAdj       (°F) — legacy fallback (used if seasonal fields absent)
 *
 * @param {object} element - partition or floor element from envelopeSlice
 * @param {number} tRoom   - room design dry-bulb (°F)
 * @param {string} season  - 'summer' | 'monsoon' | 'winter'
 * @returns {number} heat transfer (BTU/hr); negative = heat loss into space
 */
export const calcPartitionGain = (element, tRoom, season = 'summer') => {
  const area = parseFloat(element.area)   || 0;
  const u    = parseFloat(element.uValue) || 0;
  if (area === 0 || u === 0) return 0;

  let tAdj;
  if (season === 'winter') {
    tAdj = parseFloat(element.tAdjWinter) ?? parseFloat(element.tAdj) ?? 85;
  } else {
    tAdj = parseFloat(element.tAdjSummer) ?? parseFloat(element.tAdj) ?? 85;
  }

  // Positive when tAdj > tRoom (heat into space); negative when tAdj < tRoom
  return u * area * (tAdj - tRoom);
};


// ─────────────────────────────────────────────────────────────────────────────
// 4. Slab-on-Grade Heat Loss
// ─────────────────────────────────────────────────────────────────────────────
/**
 * calcSlabGain(perimeterFt, insulationType?, tRoom, tGround?)
 *
 * ASHRAE F-factor method (HOF 2021 Ch.18, Table 12):
 *   Q_slab = F × perimeter_ft × (tGround − tRoom)
 *
 * Returns negative (heat loss) when tRoom > tGround (typical winter condition).
 * Returns near-zero in summer when slab is at or above room temperature.
 *
 * @param {number} perimeterFt     - exposed slab perimeter (ft)
 * @param {string} insulationType  - key from SLAB_F_FACTOR table
 * @param {number} tRoom           - room design dry-bulb (°F)
 * @param {number} tGround         - ground temperature (°F); default 55°F
 * @returns {number} heat transfer (BTU/hr); negative = heat loss
 */
export const calcSlabGain = (
  perimeterFt,
  insulationType = 'Uninsulated',
  tRoom,
  tGround = 55,
) => {
  const perimeter = parseFloat(perimeterFt) || 0;
  if (perimeter === 0) return 0;

  const fFactor = SLAB_F_FACTOR[insulationType] ?? SLAB_F_FACTOR['Uninsulated'];
  // Positive = heat into space from ground; negative = heat loss to ground
  return fFactor * perimeter * (tGround - tRoom);
};


// ─────────────────────────────────────────────────────────────────────────────
// 5. Infiltration Heat Gain / Loss
// ─────────────────────────────────────────────────────────────────────────────
/**
 * calcInfiltrationGain(room, climate, season, tRoom, grRoom?, elevFt?)
 *
 * NOTE: Currently supplementary — primary infiltration is handled in
 * seasonalLoads.js via envelope.achValue. This function is correct and
 * ready for activation when infiltration is migrated here.
 *
 * FIX-10: Uses altitude-corrected sensibleFactor(elevFt) / latentFactor(elevFt)
 *         instead of raw ASHRAE.SENSIBLE_FACTOR_SEA_LEVEL / LATENT_FACTOR_SEA_LEVEL.
 *         Sea-level factors cause underestimation of required OA at elevation.
 *
 * FIX-11: Removed erroneous ASHRAE.M2_TO_FT2 multiplier on floorArea.
 *         roomSlice stores floorArea in ft² — applying M2_TO_FT2 inflated
 *         infiltration volume (and CFM) by 10.76×.
 *
 * FIX LOW-02: climate field corrected from .grains to .gr (climateSlice field name).
 * FIX LOW-03: room field corrected from .area to .floorArea (roomSlice field name).
 *
 * @param {object} room    - room state from roomSlice (floorArea ft², height ft)
 * @param {object} climate - climate state from climateSlice
 * @param {string} season  - 'summer' | 'monsoon' | 'winter'
 * @param {number} tRoom   - room design dry-bulb (°F)
 * @param {number} grRoom  - room design humidity ratio (gr/lb); default 50
 * @param {number} elevFt  - site elevation (ft) for altitude correction; default 0
 * @returns {{ sensible: number, latent: number }} BTU/hr, signed
 */
export const calcInfiltrationGain = (
  room,
  climate,
  season,
  tRoom,
  grRoom = 50,
  elevFt = 0,
) => {
  const isPressurized = room?.pressurized ?? false;
  if (isPressurized) return { sensible: 0, latent: 0 };

  // FIX-11: floorArea is in ft² — no unit conversion needed
  const floorAreaFt2 = parseFloat(room?.floorArea)      || 0;
  const heightFt     = parseFloat(room?.height)          || 10;
  const volumeFt3    = floorAreaFt2 * heightFt;

  const achInf = parseFloat(room?.infiltrationAch) || 0.25;
  const cfmInf = (volumeFt3 * achInf) / 60;
  if (cfmInf <= 0) return { sensible: 0, latent: 0 };

  const dbOut = parseFloat(climate?.outside?.[season]?.db) || 95;
  // FIX LOW-02: .gr is the correct climateSlice field name (set by deriveFields())
  const grOut = parseFloat(climate?.outside?.[season]?.gr) || 85;

  // FIX-10: altitude-corrected factors from psychro.js
  const sf = sensibleFactor(elevFt);
  const lf = latentFactor(elevFt);

  return {
    sensible: Math.round(sf * cfmInf * (dbOut - tRoom)),
    latent:   Math.round(lf * cfmInf * Math.max(0, grOut - grRoom)),
  };
};