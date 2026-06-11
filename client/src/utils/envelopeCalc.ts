/**
 * envelopeCalc.ts
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
 *     Fix: caller (seasonalLoads.ts) now passes volumeFt3 already converted.
 *     calcInfiltrationGain receives pre-converted ft³ directly.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   LOW-01 FIX — Import path for psychro corrected.
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
 *   in envelopeHelpers is responsible for swapping N↔S (and NE↔SE, NW↔SW)
 *   when latitude < 0.
 */

import {
  WALL_CLTD,
  WALL_CLTD_SEASONAL,
  ROOF_CLTD,
  ROOF_CLTD_SEASONAL,
  SLAB_F_FACTOR,
  correctCLTD,
} from '../constants/ashraeTables';

// @ts-ignore - Ignore missing types until psychro.js is converted
import { sensibleFactor, latentFactor } from './psychro';
// @ts-ignore - Ignore missing types until envelopeHelpers.js is converted
import { getMeanOutdoorTemp, getLM, swapForHemisphere } from './envelopeHelpers';

// ─── Logging ──────────────────────────────────────────────────────────────────
const logC = (...args: any[]): void => console.log('[envelopeCalc]', ...args);
const warnC = (...args: any[]): void => console.warn('[envelopeCalc]', ...args);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Season = 'summer' | 'monsoon' | 'winter';

export interface Wall {
  area?: string | number;
  uValue?: string | number;
  orientation?: string;
  construction?: string;
}

export interface Roof {
  area?: string | number;
  uValue?: string | number;
  construction?: string;
}

export interface Partition {
  area?: string | number;
  uValue?: string | number;
  tAdjWinter?: string | number;
  tAdjSummer?: string | number;
  tAdj?: string | number;
}

export interface Infiltration {
  achValue?: string | number;
}

export interface ClimateState {
  outside?: Record<string, { db?: string | number }>;
}

export interface RoomState {
  pressurized?: boolean;
}

export interface InfiltrationResult {
  sensible: number;
  latent: number;
  cfm: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal guard helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * safeTemp(v, fallback)
 * Safe temperature parser — catches both undefined/null AND NaN.
 * Overloaded to ensure proper TypeScript return types.
 */
function safeTemp(v: any, fallback: number): number;
function safeTemp(v: any, fallback: null): number | null;
function safeTemp(v: any, fallback: number | null): number | null {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return isNaN(n) ? fallback : n;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Wall Heat Gain / Heat Loss
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcWallGain
 *
 * Summer/monsoon: CLTD method (ASHRAE HOF 2021, Ch.18 & Ch.28).
 * Winter: steady-state conduction Q = U × A × (T_outdoor − T_room).
 */
export const calcWallGain = (
  wall: Wall,
  climate: ClimateState,
  tRoom: number,
  season: Season,
  latitude: number = 28,
  dailyRange: number = 0
): number => {
  const area = parseFloat(String(wall.area)) || 0;
  const u    = parseFloat(String(wall.uValue)) || 0;

  if (area === 0 || u === 0) {
    warnC(`wall: area=${wall.area}→${area}sf  U=${wall.uValue}→${u} — zero value, returning 0`);
    return 0;
  }

  const orientation  = wall.orientation  || 'N';
  const construction = wall.construction || 'medium';
  const rawDb        = climate?.outside?.[season]?.db;
  const dbOut        = parseFloat(String(rawDb)) || 95;

  if (rawDb === undefined || rawDb === null) {
    warnC(`wall: climate.outside.${season}.db missing — using fallback dbOut=${dbOut}°F`);
  }

  // ── Winter: steady-state U×A×ΔT ────────────────────────────────────────
  if (season === 'winter') {
    const result = u * area * (dbOut - tRoom);
    logC(`wall [winter]: U=${u}×A=${area}sf×(db${dbOut}-room${tRoom})°F = ${Math.round(result)} BTU/hr`);
    return result;
  }

  // ── Summer / Monsoon: CLTD method ────────────────────────────────────────
  const effectiveOrientation = swapForHemisphere(orientation, latitude);

  const cltdTable: any  = WALL_CLTD;
  const rawBaseCLTD     = cltdTable[effectiveOrientation]?.[construction];
  const baseCLTD        = rawBaseCLTD ?? 15;
  if (rawBaseCLTD === undefined) {
    warnC(`wall: WALL_CLTD[${effectiveOrientation}][${construction}] not found — using fallback baseCLTD=15`);
  }

  const seasonalTable: any = WALL_CLTD_SEASONAL;
  const rawSeasonMult      = seasonalTable[season];
  const seasonMult         = rawSeasonMult ?? 1.0;
  if (rawSeasonMult === undefined) {
    warnC(`wall: WALL_CLTD_SEASONAL[${season}] not found — using fallback seasonMult=1.0`);
  }

  const tMeanOutdoor  = getMeanOutdoorTemp(dbOut, season, dailyRange);
  const lm            = getLM(latitude, orientation);
  const correctedCLTD = correctCLTD(baseCLTD, tRoom, tMeanOutdoor, lm) * seasonMult;
  const result        = u * area * correctedCLTD;

  logC(`wall [${season}]: A=${area}sf U=${u} orient=${orientation}→${effectiveOrientation} const=${construction} dbOut=${dbOut}°F dailyRange=${dailyRange}`);
  logC(`wall [${season}]: baseCLTD=${baseCLTD} seasonMult=${seasonMult} tMean=${tMeanOutdoor.toFixed(1)}°F LM=${lm} corrCLTD=${correctedCLTD.toFixed(2)} → ${Math.round(result)} BTU/hr`);

  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Roof Heat Gain / Heat Loss
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcRoofGain
 *
 * Roofs have no orientation LM correction (horizontal surface).
 * Summer/monsoon: CLTD method. Winter: steady-state U×A×ΔT.
 */
export const calcRoofGain = (
  roof: Roof,
  climate: ClimateState,
  tRoom: number,
  season: Season,
  latitude: number = 28, // Unused logic-wise but kept for signature consistency
  dailyRange: number = 0
): number => {
  const area = parseFloat(String(roof.area)) || 0;
  const u    = parseFloat(String(roof.uValue)) || 0;

  if (area === 0 || u === 0) {
    warnC(`roof: area=${roof.area}→${area}sf  U=${roof.uValue}→${u} — zero value, returning 0`);
    return 0;
  }

  const construction = roof.construction || '2" insulation';
  const rawDb        = climate?.outside?.[season]?.db;
  const dbOut        = parseFloat(String(rawDb)) || 95;

  if (rawDb === undefined || rawDb === null) {
    warnC(`roof: climate.outside.${season}.db missing — using fallback dbOut=${dbOut}°F`);
  }

  // ── Winter: steady-state U×A×ΔT ────────────────────────────────────────
  if (season === 'winter') {
    const result = u * area * (dbOut - tRoom);
    logC(`roof [winter]: U=${u}×A=${area}sf×(db${dbOut}-room${tRoom})°F = ${Math.round(result)} BTU/hr`);
    return result;
  }

  // ── Summer / Monsoon: CLTD method ────────────────────────────────────────
  const cltdTable: any  = ROOF_CLTD;
  const rawBaseCLTD     = cltdTable[construction];
  const baseCLTD        = rawBaseCLTD ?? 30;
  if (rawBaseCLTD === undefined) {
    warnC(`roof: ROOF_CLTD[${construction}] not found — using fallback baseCLTD=30`);
  }

  const seasonalTable: any = ROOF_CLTD_SEASONAL;
  const rawSeasonMult      = seasonalTable[season];
  const seasonMult         = rawSeasonMult ?? 1.0;
  if (rawSeasonMult === undefined) {
    warnC(`roof: ROOF_CLTD_SEASONAL[${season}] not found — using fallback seasonMult=1.0`);
  }

  const tMeanOutdoor  = getMeanOutdoorTemp(dbOut, season, dailyRange);
  const correctedCLTD = correctCLTD(baseCLTD, tRoom, tMeanOutdoor, 0) * seasonMult;
  const result        = u * area * correctedCLTD;

  logC(`roof [${season}]: A=${area}sf U=${u} const=${construction} dbOut=${dbOut}°F dailyRange=${dailyRange}`);
  logC(`roof [${season}]: baseCLTD=${baseCLTD} seasonMult=${seasonMult} tMean=${tMeanOutdoor.toFixed(1)}°F corrCLTD=${correctedCLTD.toFixed(2)} → ${Math.round(result)} BTU/hr`);

  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Partition / Internal Floor Heat Transfer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcPartitionGain
 *
 * Season-aware adjacent temperature selection:
 *   Summer/monsoon: tAdjSummer → tAdj → 85°F fallback
 *   Winter:         tAdjWinter → tAdj → 65°F fallback
 */
export const calcPartitionGain = (
  element: Partition,
  tRoom: number,
  season: Season = 'summer'
): number => {
  const area = parseFloat(String(element.area)) || 0;
  const u    = parseFloat(String(element.uValue)) || 0;

  if (area === 0 || u === 0) {
    warnC(`partition: area=${element.area}→${area}sf  U=${element.uValue}→${u} — zero value, returning 0`);
    return 0;
  }

  let tAdj: number;
  let tAdjSource: string;

  if (season === 'winter') {
    const tAdjWinter = safeTemp(element.tAdjWinter, null);
    if (tAdjWinter !== null) {
      tAdj       = tAdjWinter;
      tAdjSource = `tAdjWinter=${tAdjWinter}`;
    } else {
      tAdj       = safeTemp(element.tAdj, 65);
      tAdjSource = element.tAdj != null ? `tAdj=${element.tAdj}` : `fallback=65°F`;
    }
  } else {
    const tAdjSummer = safeTemp(element.tAdjSummer, null);
    if (tAdjSummer !== null) {
      tAdj       = tAdjSummer;
      tAdjSource = `tAdjSummer=${tAdjSummer}`;
    } else {
      tAdj       = safeTemp(element.tAdj, 85);
      tAdjSource = element.tAdj != null ? `tAdj=${element.tAdj}` : `fallback=85°F`;
    }
  }

  const result = u * area * (tAdj - tRoom);
  logC(`partition [${season}]: A=${area}sf U=${u} tAdj=${tAdj}°F (${tAdjSource}) tRoom=${tRoom}°F → ${Math.round(result)} BTU/hr`);

  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. Slab-on-Grade Heat Loss
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcSlabGain
 *
 * ASHRAE F-factor method (HOF 2021 Ch.18, Table 12):
 *   Q_slab = F × perimeter_ft × (tGround − tRoom)
 */
export const calcSlabGain = (
  perimeterFt: string | number,
  insulationType: string = 'Uninsulated',
  tRoom: number,
  tGround: number = 55
): number => {
  const perimeter = parseFloat(String(perimeterFt)) || 0;

  if (perimeter === 0) {
    warnC(`slab: perimeterFt=${perimeterFt}→${perimeter}ft — zero perimeter, returning 0`);
    return 0;
  }

  const slabTable: any = SLAB_F_FACTOR;
  const rawFactor      = slabTable[insulationType];
  const fFactor        = rawFactor ?? slabTable['Uninsulated'];

  if (rawFactor === undefined) {
    warnC(`slab: SLAB_F_FACTOR[${insulationType}] not found — using Uninsulated fallback (fFactor=${fFactor})`);
  }

  const result = fFactor * perimeter * (tGround - tRoom);
  logC(`slab: perim=${perimeter}ft insul=${insulationType} fFactor=${fFactor} tGround=${tGround}°F tRoom=${tRoom}°F → ${Math.round(result)} BTU/hr`);

  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. Infiltration Heat Gain / Loss
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcInfiltrationGain
 *
 * Computes sensible and latent infiltration loads from envelope ACH value.
 * Returns zeros for pressurized rooms or when ACH = 0.
 */
export const calcInfiltrationGain = (
  inf: Infiltration | undefined | null,
  room: RoomState | undefined | null,
  volumeFt3: number,
  dbOut: number,
  tRoom: number,
  grIn: number,
  grOut: number,
  elevFt: number = 0
): InfiltrationResult => {
  const isPressurized = room?.pressurized ?? false;

  if (isPressurized) {
    logC(`infiltration: pressurized=true — returning zeros (no infiltration for pressurized room)`);
    return { sensible: 0, latent: 0, cfm: 0 };
  }

  const achInf = parseFloat(String(inf?.achValue)) || 0;
  const cfm    = (volumeFt3 * achInf) / 60;

  logC(`infiltration: pressurized=false achValue=${inf?.achValue}→ach=${achInf} volumeFt3=${volumeFt3.toFixed(0)}ft³ cfm=${cfm.toFixed(1)}`);

  if (achInf === 0) {
    warnC(`infiltration: achValue=0 — no infiltration load (set room envelope ACH if infiltration is expected)`);
  }

  if (cfm <= 0) return { sensible: 0, latent: 0, cfm: 0 };

  const sf       = sensibleFactor(elevFt);
  const lf       = latentFactor(elevFt);
  const sensible = Math.round(sf * cfm * (dbOut - tRoom));
  const latent   = Math.round(lf * cfm * Math.max(0, grOut - grIn));

  logC(`infiltration: sf=${sf.toFixed(4)} lf=${lf.toFixed(4)} (elevFt=${elevFt}) dbOut=${dbOut}°F tRoom=${tRoom}°F grOut=${grOut.toFixed(1)} grIn=${grIn.toFixed(1)}`);
  logC(`infiltration: → sens=${sensible} BTU/hr  lat=${latent} BTU/hr  cfm=${cfm.toFixed(1)}`);

  return { sensible, latent, cfm };
};