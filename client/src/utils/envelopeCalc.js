/**
 * envelopeCalc.js
 * Opaque envelope heat gain / loss calculations.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Ch.18 & 28
 *            ASHRAE Cooling & Heating Load Calculation Manual, 2nd Ed., §3
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   FIX-INFIL-01 [CRITICAL] — calcInfiltrationGain: volume conversion corrected.
 *
 *     roomSlice stores room.volume in m³. The previous version derived volumeFt3
 *     from floorArea × height (both SI), which produced a value in m³ labelled
 *     as ft³. For a 300 m³ room (= 10,764 ft³), cfmInf was 35.9× too low.
 *
 *     Fix: caller (seasonalLoads.js) now passes volumeFt3 already converted via
 *     m3ToFt3(). calcInfiltrationGain receives pre-converted ft³ directly.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   LOW-01 FIX — Import path for psychro.js corrected (was '../utils/psychro').
 *
 * ── SIGN CONVENTION (all functions) ──────────────────────────────────────────
 *
 *   Positive = heat INTO conditioned space  → cooling load
 *   Negative = heat OUT OF conditioned space → heating load / heat loss
 *
 *   ⚠️  NEVER clamp return values to Math.max(0, ...).
 *       Negative values are physically valid (heat loss through element).
 *
 * ── SOUTHERN HEMISPHERE NOTE ─────────────────────────────────────────────────
 *
 *   calcWallGain() passes orientation directly to WALL_CLTD[orientation] for
 *   the CLTD table lookup. For the LM correction, getLM(latitude, orientation)
 *   in envelopeHelpers.js is responsible for swapping N↔S (and NE↔SE, NW↔SW)
 *   when latitude < 0.
 *
 *   ⚠️  The CLTD base value lookup also requires the swapped orientation for
 *       southern hemisphere — a N-facing wall in Sydney receives the same low
 *       sun as a S-facing wall in Delhi. Verify that envelopeHelpers.getLM()
 *       applies the orientation swap BEFORE the CLTD table is read, or that
 *       calcWallGain passes the effective orientation to WALL_CLTD.
 *       → To be confirmed in envelopeHelpers.js audit.
 */

import {
  WALL_CLTD,
  WALL_CLTD_SEASONAL,
  ROOF_CLTD,
  ROOF_CLTD_SEASONAL,
  SLAB_F_FACTOR,
  correctCLTD,
} from '../constants/ashraeTables';

import { sensibleFactor, latentFactor }                    from './psychro';
import { getMeanOutdoorTemp, getLM, swapForHemisphere }    from './envelopeHelpers';
import { m3ToFt3 }                                         from './units';

// ─────────────────────────────────────────────────────────────────────────────
// Internal guard helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * safeTemp(v, fallback)
 * Safe temperature parser — catches both undefined/null AND NaN.
 * Used in calcPartitionGain for adjacent space temperature fields.
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
 * Winter: steady-state conduction Q = U × A × (T_outdoor − T_room).
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

  // Use hemisphere-swapped orientation for BOTH the WALL_CLTD base lookup
  // and the LM correction (getLM swaps internally). Without this, a S-facing
  // wall in Sydney (latitude < 0) would get the low NH-summer S-facing CLTD
  // instead of the correct high-sun N-facing equivalent.
  const effectiveOrientation = swapForHemisphere(orientation, latitude);
  const baseCLTD     = WALL_CLTD[effectiveOrientation]?.[construction] ?? 15;
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
 * Summer/monsoon: CLTD method. Winter: steady-state U×A×ΔT.
 *
 * @param {object} roof       - roof element from envelopeSlice
 * @param {object} climate    - climate state from climateSlice
 * @param {number} tRoom      - room design dry-bulb (°F)
 * @param {string} season     - 'summer' | 'monsoon' | 'winter'
 * @param {number} latitude   - site latitude (unused for roofs — no orientation)
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

  const correctedCLTD = correctCLTD(baseCLTD, tRoom, tMeanOutdoor, 0) * seasonMult;
  return u * area * correctedCLTD;
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Partition / Internal Floor Heat Transfer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcPartitionGain(element, tRoom, season?)
 *
 * Season-aware adjacent temperature selection:
 *   Summer/monsoon: tAdjSummer → tAdj → 85°F fallback
 *   Winter:         tAdjWinter → tAdj → 65°F fallback
 *
 * safeTemp() handles NaN from parseFloat(undefined) for missing fields.
 *
 * @param {object} element - partition/floor element from envelopeSlice
 * @param {number} tRoom   - room design dry-bulb (°F)
 * @param {string} season  - 'summer' | 'monsoon' | 'winter'
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
 * @param {number} perimeterFt    - exposed slab perimeter (ft)
 * @param {string} insulationType - key from SLAB_F_FACTOR (default 'Uninsulated')
 * @param {number} tRoom          - room design dry-bulb (°F)
 * @param {number} tGround        - ground temperature (°F, default 55°F)
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
 * calcInfiltrationGain(inf, room, volumeFt3, dbOut, tRoom, grIn, grOut, elevFt)
 *
 * Computes sensible and latent infiltration loads from envelope ACH value.
 * Returns zeros for pressurized rooms or when ACH = 0.
 *
 * @param {object} inf       - envelope.infiltration object (source of achValue)
 * @param {object} room      - room state — used only for pressurized check
 * @param {number} volumeFt3 - room volume in ft³ (pre-converted by caller)
 * @param {number} dbOut     - outdoor dry-bulb (°F)
 * @param {number} tRoom     - room design dry-bulb (°F)
 * @param {number} grIn      - indoor humidity ratio (gr/lb), elevation-corrected
 * @param {number} grOut     - outdoor humidity ratio (gr/lb), elevation-corrected
 * @param {number} elevFt    - site elevation (ft)
 * @returns {{ sensible: number, latent: number, cfm: number }} BTU/hr, signed
 */
export const calcInfiltrationGain = (
  inf,
  room,
  volumeFt3,
  dbOut,
  tRoom,
  grIn,
  grOut,
  elevFt = 0,
) => {
  const isPressurized = room?.pressurized ?? false;
  if (isPressurized) return { sensible: 0, latent: 0, cfm: 0 };

  const achInf = parseFloat(inf?.achValue) || 0;
  const cfm    = (volumeFt3 * achInf) / 60;
  if (cfm <= 0) return { sensible: 0, latent: 0, cfm: 0 };

  const sf = sensibleFactor(elevFt);
  const lf = latentFactor(elevFt);

  return {
    sensible: Math.round(sf * cfm * (dbOut - tRoom)),
    latent:   Math.round(lf * cfm * Math.max(0, grOut - grIn)),
    cfm,
  };
};