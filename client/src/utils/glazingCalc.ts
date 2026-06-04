/**
 * glazingCalc.ts
 * Transparent envelope heat gain / loss calculations.
 * Responsibility: glass elements, skylights, solar heat gain.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Ch.18 & 27
 *            ASHRAE CHLCM 2nd Edition, §3
 *
 * SIGN CONVENTION:
 *   Positive = heat INTO conditioned space  → cooling load
 *   Negative = heat OUT OF conditioned space → heating load / heat loss
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   LOW-TIER1-05 — GLASS_CLTD lookup made safe against undefined season.
 *
 *     The previous `GLASS_CLTD[season] ?? 15` fallback would silently apply
 *     a 15°F CLTD to any unrecognised season — an order-of-magnitude error
 *     in winter. The HIGH-04 fix intentionally removed the winter key from
 *     GLASS_CLTD; winter glass conduction must use U×A×ΔT, not CLTD.
 *
 *     Fix: the lookup now calls getGlassCLTD() which logs console.error and
 *     returns null instead of a wrong value. Callers return a zero conduction
 *     result on null — making the failure visible rather than silent.
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-GL-02 [HIGH]: Winter solar credit used incorrect CLF for shaded glass.
 *
 *     The CLF table (ASHRAE CHLCM 2nd Ed., Table 13) is a cooling-load concept:
 *     it accounts for radiant heat storage in room mass, reducing the instantaneous
 *     cooling load below peak solar gain. This concept does not apply to heating —
 *     in winter any solar gain immediately offsets the heating requirement,
 *     regardless of room thermal mass. Applying a summer CLF in winter was
 *     understating the solar heating credit.
 *
 *     Fix: CLF = 1.0 for all glass in winter.
 *
 *   BUG-GL-04 [LOW]: Guard added for u=0 glass conduction path.
 *     Consistent with calcWallGain / calcRoofGain — if (area === 0 || u === 0)
 *     the function returns zero rather than computing mathematically-zero
 *     values through the full calculation path.
 */

import {
  GLASS_CLTD,
  CLF,
  CLF_UNSHADED,
  correctCLTD,
} from '../constants/ashraeTables';

import {
  getMeanOutdoorTemp,
  getCorrectedSHGF,
  resolveShgc,
  Season,
} from './envelopeHelpers';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GlassElement {
  area?: string | number;
  uValue?: string | number;
  orientation?: string;
  roomMass?: string;
  shgc?: string | number;
  sc?: string | number;
  shaded?: boolean;
}

export interface ClimateData {
  outside?: Record<string, { db?: string | number }>;
}

export interface GainResult {
  conduction: number;
  solar: number;
  total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal guard: safe GLASS_CLTD lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getGlassCLTD
 *
 * Returns the base glass CLTD for a season, or null if the key is not found.
 *
 * The winter key is intentionally absent from GLASS_CLTD — winter glass
 * conduction uses U×A×ΔT (handled by the season branch in calcGlassGain
 * before this function is ever called).
 *
 * Returns null on failure so callers return zero rather than a phantom load.
 */
const getGlassCLTD = (season: Season): number | null => {
  const table: any = GLASS_CLTD;
  const cltd = table[season];
  
  if (cltd === undefined) {
    console.error(
      `glazingCalc.getGlassCLTD: no GLASS_CLTD entry for season="${season}". ` +
      `Winter callers MUST return U×A×ΔT before reaching the CLTD lookup — ` +
      `see the winter short-circuit in calcGlassGain(). ` +
      `For any other unknown season, add an entry to GLASS_CLTD in ashraeTables.ts. ` +
      `Returning null to prevent phantom load; caller will return zero result.`
    );
    return null;
  }
  return cltd;
};

// ─────────────────────────────────────────────────────────────────────────────
// Glass Heat Gain / Heat Loss
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcGlassGain
 *
 * Returns separate conduction and solar components for transparency in RDS.
 * Total = conduction + solar (signed).
 *
 * ── CLF selection logic ───────────────────────────────────────────────────────
 *
 *   Summer / Monsoon (cooling load):
 *     glass.shaded = true  → CLF[orientation][roomMass]  (interior blind/drape)
 *     glass.shaded = false → CLF_UNSHADED = 1.0          (no interior shading)
 *     glass.shaded absent  → treat as unshaded (conservative for cooling)
 *
 *   Winter (heating credit):
 *     CLF = 1.0 always — solar gain directly offsets heating load with no
 *     radiant storage delay. See BUG-GL-02 in the CHANGELOG.
 */
export const calcGlassGain = (
  glass: GlassElement,
  climate: ClimateData,
  tRoom: number,
  season: Season,
  latitude: number = 28,
  dailyRange: number = 0
): GainResult => {
  const area = parseFloat(String(glass.area)) || 0;
  const u = parseFloat(String(glass.uValue)) || 0;

  if (area === 0 || u === 0) return { conduction: 0, solar: 0, total: 0 };

  const orientation = glass.orientation || 'E';
  const roomMass = glass.roomMass || 'medium';
  const shgc = resolveShgc(glass);
  const dbOut = parseFloat(String(climate?.outside?.[season]?.db)) || 95;
  const shgf = getCorrectedSHGF(orientation, season, latitude);

  // ── Winter: steady-state conduction + full solar credit ───────────────────
  if (season === 'winter') {
    // Conduction: negative when dbOut < tRoom (heat loss through glass).
    const conduction = u * area * (dbOut - tRoom);

    // CLF = 1.0 in winter — solar gain is an immediate heating credit,
    // not subject to radiant storage delay. See BUG-GL-02 in CHANGELOG.
    const solar = shgc * shgf * area * 1.0;

    return {
      conduction: Math.round(conduction),
      solar: Math.round(solar),
      total: Math.round(conduction + solar),
    };
  }

  // ── Summer / Monsoon: CLTD conduction + CLF-weighted solar ────────────────

  // CLF selection: shaded glass uses the interior-shading table;
  // unshaded defaults to CLF_UNSHADED = 1.0 (conservative for cooling).
  const isShaded = glass.shaded === true;
  const clfTable: any = CLF;
  
  const clf = isShaded
    ? clfTable[orientation]?.[roomMass] ?? clfTable['N']['medium']
    : CLF_UNSHADED;

  const solar = shgc * shgf * area * clf;

  // Glass CLTD method (ASHRAE CHLCM §3).
  // lm = 0: no orientation correction for glass — conduction is driven by
  // DB temperature difference, not solar position.
  const glassBaseCLTD = getGlassCLTD(season);
  if (glassBaseCLTD === null) {
    // Should not be reachable in normal operation (winter is handled above).
    // Return solar component intact; suppress only the failed conduction path.
    return { conduction: 0, solar: Math.round(solar), total: Math.round(solar) };
  }

  const tMeanOutdoor = getMeanOutdoorTemp(dbOut, season, dailyRange);
  const correctedGlassCLTD = correctCLTD(glassBaseCLTD, tRoom, tMeanOutdoor, 0);
  const conduction = u * area * correctedGlassCLTD;

  return {
    conduction: Math.round(conduction),
    solar: Math.round(solar),
    total: Math.round(conduction + solar),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Skylight Heat Gain
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcSkylightGain
 *
 * Skylights treated as horizontal glass (orientation = 'Horizontal').
 * All fixes from calcGlassGain apply — including BUG-GL-02 (winter CLF=1.0)
 * and the safe GLASS_CLTD lookup via getGlassCLTD().
 */
export const calcSkylightGain = (
  skylight: GlassElement,
  climate: ClimateData,
  tRoom: number,
  season: Season,
  latitude: number = 28,
  dailyRange: number = 0
): GainResult =>
  calcGlassGain(
    { ...skylight, orientation: 'Horizontal' },
    climate,
    tRoom,
    season,
    latitude,
    dailyRange
  );