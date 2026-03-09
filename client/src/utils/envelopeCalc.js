/**
 * envelopeCalc.js
 * Opaque envelope heat gain / loss calculations.
 *
 * CHANGELOG v2.1:
 *
 *   LOW-01 FIX — Import path for psychro.js corrected.
 *
 *     Previous: import { sensibleFactor, latentFactor } from '../utils/psychro';
 *     Fixed:    import { sensibleFactor, latentFactor } from './psychro';
 *
 *     envelopeCalc.js lives in src/utils/. The path '../utils/psychro' resolves
 *     correctly (up to src/, then back into utils/) but is non-idiomatic —
 *     it implies the import is from a different directory, misleading developers.
 *     The correct sibling-module form is './psychro'.
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
 */

import {
  WALL_CLTD,
  WALL_CLTD_SEASONAL,
  ROOF_CLTD,
  ROOF_CLTD_SEASONAL,
  SLAB_F_FACTOR,
  correctCLTD,
} from '../constants/ashraeTables';

import { sensibleFactor, latentFactor } from './psychro';   // LOW-01 FIX: was '../utils/psychro'
import { getMeanOutdoorTemp, getLM }     from './envelopeHelpers';

// ─────────────────────────────────────────────────────────────────────────────
// Internal guard helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * safeTemp(v, fallback)
 *
 * BUG-ENV-02 FIX: safe temperature parser that catches both undefined/null
 * AND NaN. Used in calcPartitionGain for adjacent space temperature fields.
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

  if (season === 'winter') {
    return u * area * (dbOut - tRoom);
  }

  const baseCLTD     = WALL_CLTD[orientation]?.[construction] ?? 15;
  const seasonMult   = WALL_CLTD_SEASONAL[season] ?? 1.0;
  const tMeanOutdoor = getMeanOutdoorTemp(dbOut, season, dailyRange);
  const lm           = getLM(latitude, orientation);

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
 * BUG-ENV-02 FIX: safeTemp() handles NaN from parseFloat(undefined).
 *
 * Fallback chain: tAdjSummer → tAdj → 85°F (summer)
 *                 tAdjWinter → tAdj → 65°F (winter)
 *
 * @returns {number} heat transfer (BTU/hr); positive = into space, negative = heat loss
 */
export const calcPartitionGain = (element, tRoom, season = 'summer') => {
  const area = parseFloat(element.area)   || 0;
  const u    = parseFloat(element.uValue) || 0;
  if (area === 0 || u === 0) return 0;

  let tAdj;
  if (season === 'winter') {
    const tAdjWinter = safeTemp(element.tAdjWinter, null);
    tAdj = tAdjWinter !== null
      ? tAdjWinter
      : safeTemp(element.tAdj, 65);
  } else {
    const tAdjSummer = safeTemp(element.tAdjSummer, null);
    tAdj = tAdjSummer !== null
      ? tAdjSummer
      : safeTemp(element.tAdj, 85);
  }

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
 * FIX-10: altitude-corrected factors from psychro.js.
 * FIX-11: floorArea in ft² — M2_TO_FT2 multiplier removed.
 * FIX LOW-02: climate field is .gr (climateSlice), not .grains.
 * FIX LOW-03: room field is .floorArea (roomSlice), not .area.
 *
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

  const floorAreaFt2 = parseFloat(room?.floorArea) || 0;
  const heightFt     = parseFloat(room?.height)    || 10;
  const volumeFt3    = floorAreaFt2 * heightFt;

  const achInf = parseFloat(room?.infiltrationAch) || 0.25;
  const cfmInf = (volumeFt3 * achInf) / 60;
  if (cfmInf <= 0) return { sensible: 0, latent: 0 };

  const dbOut = parseFloat(climate?.outside?.[season]?.db) || 95;
  const grOut = parseFloat(climate?.outside?.[season]?.gr) || 85;

  const sf = sensibleFactor(elevFt);
  const lf = latentFactor(elevFt);

  return {
    sensible: Math.round(sf * cfmInf * (dbOut - tRoom)),
    latent:   Math.round(lf * cfmInf * Math.max(0, grOut - grRoom)),
  };
};