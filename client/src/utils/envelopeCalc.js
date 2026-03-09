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
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-ENV-01 [CRITICAL — import path, NOT in this file]:
 *     seasonalLoads.js imports calcTotalEnvelopeGain from utils/envelopeCalc.
 *     That function is NOT exported from this file — it lives in
 *     utils/envelopeAggregator.js, which aggregates calls to the individual
 *     component functions here plus glazingCalc.js for glass/skylight gains.
 *
 *     The import in seasonalLoads.js MUST be:
 *       import { calcTotalEnvelopeGain } from '../../utils/envelopeAggregator';
 *                                                          ^^^^^^^^^^^^^^^^
 *     Calling an undefined import as a function throws:
 *       TypeError: calcTotalEnvelopeGain is not a function
 *
 *     This file is NOT changed for that fix — it is documented here so
 *     that the error is traceable from either file. The fix lives in
 *     seasonalLoads.js (import path corrected in the re-delivered file).
 *
 *   BUG-ENV-02 [MEDIUM]: parseFloat + ?? NaN trap in calcPartitionGain.
 *
 *     JavaScript nullish coalescing (??) only catches null and undefined.
 *     It does NOT catch NaN. So:
 *       parseFloat(undefined)  → NaN
 *       NaN ?? 85              → NaN   ← falls through, not caught by ??
 *       u × area × (NaN − tRoom) → NaN
 *
 *     This silently corrupts the partition heat transfer for any element
 *     created without the tAdjWinter / tAdjSummer fields. DEFAULT_ELEMENTS
 *     in ashraeTables.js provides these defaults, but defensive code is
 *     required since elements can be created through Redux actions without
 *     going through the DEFAULT_ELEMENTS template.
 *
 *     Fix: explicit isNaN check pattern — same guard used in units.js (numOrNull).
 *     A valid 0°F adjacent space temp is physically meaningful (cold storage),
 *     so `|| 85` would be wrong. The guard must distinguish 0 from NaN.
 *
 * RETAINED FIXES (v1.x):
 *   FIX-01 — Seasonal multiplier applied AFTER correctCLTD(), not before.
 *   FIX-02 — LM correction consolidated into correctCLTD() call.
 *   FIX-03 — DR/21 multiplier removed (ashraeTables.js FIX MED-08).
 *   FIX-04 — Winter heating uses U×A×ΔT (conduction), not CLTD × 0.4.
 *   FIX-07 — calcInfiltrationGain() field names corrected (LOW-02, LOW-03).
 *   FIX-08 — calcSlabGain() ASHRAE F-factor method.
 *   FIX-09 — Math.max(0, correctedCLTD) clamping REMOVED (walls and roofs).
 *   FIX-10 — calcInfiltrationGain: altitude-corrected sensible/latent factors.
 *   FIX-11 — calcInfiltrationGain: erroneous M2_TO_FT2 on floorArea removed.
 *   FIX MED-04 — calcPartitionGain(): season-aware adjacent temperature.
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
// Internal guard helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * safeTemp(v, fallback)
 *
 * BUG-ENV-02 FIX: safe temperature parser that catches both undefined/null
 * AND NaN. Used in calcPartitionGain for adjacent space temperature fields.
 *
 * Why not `parseFloat(v) || fallback`:
 *   parseFloat("0") || 85 → 85  (wrong — 0°F cold storage is valid)
 *
 * Why not `parseFloat(v) ?? fallback`:
 *   parseFloat(undefined) → NaN; NaN ?? 85 → NaN  (NaN passes through ??)
 *
 * @param {*}      v        - raw field value
 * @param {number} fallback - value to use when v is missing or unparseable
 * @returns {number}
 */
const safeTemp = (v, fallback) => {
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
};


// ─────────────────────────────────────────────────────────────────────────────
// 1. Wall Heat Gain / Heat Loss
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcWallGain(wall, climate, tRoom, season, latitude?, dailyRange?)
 *
 * Summer/monsoon: CLTD method (ASHRAE HOF 2021, Ch.18 & Ch.28).
 * Winter: steady-state conduction  Q = U × A × (T_outdoor − T_room).
 *
 * @param {object} wall       - wall element from envelopeSlice
 * @param {object} climate    - climate state from climateSlice
 * @param {number} tRoom      - room design dry-bulb (°F)
 * @param {string} season     - 'summer' | 'monsoon' | 'winter'
 * @param {number} latitude   - site latitude (degrees; negative = south)
 * @param {number} dailyRange - diurnal range (°F); 0 = use DIURNAL_RANGE_DEFAULTS
 * @returns {number} heat gain/loss (BTU/hr); negative = heat loss outward
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

  // Winter: steady-state conduction (negative when outdoor < room = heat loss)
  if (season === 'winter') {
    return u * area * (dbOut - tRoom);
  }

  const baseCLTD     = WALL_CLTD[orientation]?.[construction] ?? 15;
  const seasonMult   = WALL_CLTD_SEASONAL[season] ?? 1.0;
  const tMeanOutdoor = getMeanOutdoorTemp(dbOut, season, dailyRange);
  const lm           = getLM(latitude, orientation);

  // FIX-01: seasonMult applied AFTER correctCLTD (not before).
  // FIX-09: No Math.max(0, ...) clamp — negative correctedCLTD is valid.
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
 * @param {number} latitude   - retained for API symmetry; unused for horizontal surface
 * @param {number} dailyRange - diurnal range (°F)
 * @returns {number} heat gain/loss (BTU/hr); negative = heat loss
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
    return u * area * (dbOut - tRoom);
  }

  const baseCLTD      = ROOF_CLTD[construction] ?? 30;
  const seasonMult    = ROOF_CLTD_SEASONAL[season] ?? 1.0;
  const tMeanOutdoor  = getMeanOutdoorTemp(dbOut, season, dailyRange);

  // lmCorrection = 0 for roofs (orientation-independent horizontal surface).
  // FIX-09: No Math.max(0, ...) clamp.
  const correctedCLTD = correctCLTD(baseCLTD, tRoom, tMeanOutdoor, 0) * seasonMult;
  return u * area * correctedCLTD;
};


// ─────────────────────────────────────────────────────────────────────────────
// 3. Partition / Internal Floor Heat Transfer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcPartitionGain(element, tRoom, season?)
 *
 * FIX MED-04: Season-aware adjacent temperature.
 * BUG-ENV-02 FIX: safeTemp() replaces parseFloat + ?? (which passed NaN through).
 *
 * Element schema:
 *   tAdjSummer (°F) — adjacent space temp, summer/monsoon (preferred)
 *   tAdjWinter (°F) — adjacent space temp, winter          (preferred)
 *   tAdj       (°F) — legacy single value (fallback if seasonal fields absent)
 *
 * Fallback chain: tAdjSummer → tAdj → 85°F (summer)
 *                 tAdjWinter → tAdj → 65°F (winter)
 *
 * The winter fallback of 65°F assumes an unconditioned but enclosed adjacent
 * space (stairwell, service corridor). If the adjacent space is fully
 * outdoor-exposed, use the outdoor DB instead.
 *
 * @param {object} element - partition or floor element from envelopeSlice
 * @param {number} tRoom   - room design dry-bulb (°F)
 * @param {string} season  - 'summer' | 'monsoon' | 'winter'
 * @returns {number} heat transfer (BTU/hr); positive = into space, negative = heat loss
 */
export const calcPartitionGain = (element, tRoom, season = 'summer') => {
  const area = parseFloat(element.area)   || 0;
  const u    = parseFloat(element.uValue) || 0;
  if (area === 0 || u === 0) return 0;

  // BUG-ENV-02 FIX: safeTemp() correctly handles undefined, null, AND NaN.
  // The ?? operator was silently passing NaN through because NaN is not
  // null/undefined — ?? only triggers on those two values.
  let tAdj;
  if (season === 'winter') {
    // Try tAdjWinter → tAdj (legacy) → 65°F default
    const tAdjWinter = safeTemp(element.tAdjWinter, null);
    tAdj = tAdjWinter !== null
      ? tAdjWinter
      : safeTemp(element.tAdj, 65);
  } else {
    // Try tAdjSummer → tAdj (legacy) → 85°F default
    const tAdjSummer = safeTemp(element.tAdjSummer, null);
    tAdj = tAdjSummer !== null
      ? tAdjSummer
      : safeTemp(element.tAdj, 85);
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
 * Returns negative (heat loss) when tRoom > tGround (typical winter).
 * Returns near-zero in summer when slab is near or above room temperature.
 *
 * @param {number} perimeterFt     - exposed slab perimeter (ft)
 * @param {string} insulationType  - key from SLAB_F_FACTOR table
 * @param {number} tRoom           - room design dry-bulb (°F)
 * @param {number} tGround         - ground temperature (°F); default 55°F
 * @returns {number} heat transfer (BTU/hr); negative = heat loss to ground
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
  return fFactor * perimeter * (tGround - tRoom);
};


// ─────────────────────────────────────────────────────────────────────────────
// 5. Infiltration Heat Gain / Loss
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcInfiltrationGain(room, climate, season, tRoom, grRoom?, elevFt?)
 *
 * NOTE: Currently supplementary — primary infiltration is in seasonalLoads.js
 * via envelope.achValue. This function is correct and ready for activation
 * when infiltration is migrated here.
 *
 * FIX-10: altitude-corrected factors from psychro.js.
 * FIX-11: floorArea in ft² — M2_TO_FT2 multiplier removed (was inflating CFM 10×).
 * FIX LOW-02: climate field is .gr (climateSlice), not .grains.
 * FIX LOW-03: room field is .floorArea (roomSlice), not .area.
 *
 * @param {object} room    - room state from roomSlice (floorArea ft², height ft)
 * @param {object} climate - climate state from climateSlice
 * @param {string} season  - 'summer' | 'monsoon' | 'winter'
 * @param {number} tRoom   - room design dry-bulb (°F)
 * @param {number} grRoom  - room humidity ratio (gr/lb); default 50
 * @param {number} elevFt  - site elevation (ft); default 0
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

  const floorAreaFt2 = parseFloat(room?.floorArea)       || 0;
  const heightFt     = parseFloat(room?.height)           || 10;
  const volumeFt3    = floorAreaFt2 * heightFt;

  const achInf = parseFloat(room?.infiltrationAch) || 0.25;
  const cfmInf = (volumeFt3 * achInf) / 60;
  if (cfmInf <= 0) return { sensible: 0, latent: 0 };

  const dbOut = parseFloat(climate?.outside?.[season]?.db) || 95;
  const grOut = parseFloat(climate?.outside?.[season]?.gr) || 85;  // FIX LOW-02

  const sf = sensibleFactor(elevFt);   // FIX-10
  const lf = latentFactor(elevFt);     // FIX-10

  return {
    sensible: Math.round(sf * cfmInf * (dbOut - tRoom)),
    latent:   Math.round(lf * cfmInf * Math.max(0, grOut - grRoom)),
  };
};