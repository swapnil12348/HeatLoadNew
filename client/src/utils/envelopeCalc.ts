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
  const u = parseFloat(String(wall.uValue)) || 0;
  if (area === 0 || u === 0) return 0;

  const orientation = wall.orientation || 'N';
  const construction = wall.construction || 'medium';
  const dbOut = parseFloat(String(climate?.outside?.[season]?.db)) || 95;

  if (season === 'winter') {
    return u * area * (dbOut - tRoom);
  }

  // Use hemisphere-swapped orientation for BOTH the WALL_CLTD base lookup
  // and the LM correction
  const effectiveOrientation = swapForHemisphere(orientation, latitude);
  
  // Cast table to any to bypass indexing errors if ashraeTables isn't perfectly typed
  const cltdTable: any = WALL_CLTD;
  const baseCLTD = cltdTable[effectiveOrientation]?.[construction] ?? 15;
  
  const seasonalTable: any = WALL_CLTD_SEASONAL;
  const seasonMult = seasonalTable[season] ?? 1.0;
  
  const tMeanOutdoor = getMeanOutdoorTemp(dbOut, season, dailyRange);
  const lm = getLM(latitude, orientation);

  const correctedCLTD = correctCLTD(baseCLTD, tRoom, tMeanOutdoor, lm) * seasonMult;
  return u * area * correctedCLTD;
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
  const u = parseFloat(String(roof.uValue)) || 0;
  if (area === 0 || u === 0) return 0;

  const construction = roof.construction || '2" insulation';
  const dbOut = parseFloat(String(climate?.outside?.[season]?.db)) || 95;

  if (season === 'winter') {
    return u * area * (dbOut - tRoom);
  }

  const cltdTable: any = ROOF_CLTD;
  const baseCLTD = cltdTable[construction] ?? 30;
  
  const seasonalTable: any = ROOF_CLTD_SEASONAL;
  const seasonMult = seasonalTable[season] ?? 1.0;
  
  const tMeanOutdoor = getMeanOutdoorTemp(dbOut, season, dailyRange);

  const correctedCLTD = correctCLTD(baseCLTD, tRoom, tMeanOutdoor, 0) * seasonMult;
  return u * area * correctedCLTD;
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
  const u = parseFloat(String(element.uValue)) || 0;
  if (area === 0 || u === 0) return 0;

  let tAdj: number;
  
  if (season === 'winter') {
    const tAdjWinter = safeTemp(element.tAdjWinter, null);
    tAdj = tAdjWinter !== null ? tAdjWinter : safeTemp(element.tAdj, 65);
  } else {
    const tAdjSummer = safeTemp(element.tAdjSummer, null);
    tAdj = tAdjSummer !== null ? tAdjSummer : safeTemp(element.tAdj, 85);
  }

  return u * area * (tAdj - tRoom);
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
  if (perimeter === 0) return 0;

  const slabTable: any = SLAB_F_FACTOR;
  const fFactor = slabTable[insulationType] ?? slabTable['Uninsulated'];
  
  return fFactor * perimeter * (tGround - tRoom);
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
  if (isPressurized) return { sensible: 0, latent: 0, cfm: 0 };

  const achInf = parseFloat(String(inf?.achValue)) || 0;
  const cfm = (volumeFt3 * achInf) / 60;
  
  if (cfm <= 0) return { sensible: 0, latent: 0, cfm: 0 };

  const sf = sensibleFactor(elevFt);
  const lf = latentFactor(elevFt);

  return {
    sensible: Math.round(sf * cfm * (dbOut - tRoom)),
    latent: Math.round(lf * cfm * Math.max(0, grOut - grIn)),
    cfm,
  };
};