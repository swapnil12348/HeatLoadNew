/**
 * glazingCalc.js
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
 *     Impact example (S-facing shaded glass, CLF_medium = 0.55, 100 ft²):
 *       Old credit: 0.86 × 118 × 100 × 0.55 = 5,580 BTU/hr
 *       New credit: 0.86 × 118 × 100 × 1.00 = 10,148 BTU/hr  (+4,568 BTU/hr)
 *
 *   BUG-GL-04 [LOW]: Guard added for u=0 glass conduction path.
 *     Consistent with calcWallGain / calcRoofGain — if (area === 0 || u === 0)
 *     the function returns zero rather than computing mathematically-zero
 *     values through the full calculation path.
 *
 * RETAINED FIXES (v1.x):
 *   FIX-05 — Solar gain: SHGC preferred over legacy SC.
 *   FIX-06 — Winter solar gain treated as a credit (reduces heating load).
 *   FIX MED-09 — CLF_UNSHADED used for unshaded glass (not CLF shaded table).
 *                glass.shaded flag drives CLF selection in summer/monsoon.
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
} from './envelopeHelpers';

// ─────────────────────────────────────────────────────────────────────────────
// Internal guard: safe GLASS_CLTD lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getGlassCLTD(season)
 *
 * Returns the base glass CLTD for a season, or null if the key is not found.
 *
 * The winter key is intentionally absent from GLASS_CLTD — winter glass
 * conduction uses U×A×ΔT (handled by the season branch in calcGlassGain
 * before this function is ever called). This guard is a second line of
 * defence against future code additions reaching the CLTD path in winter.
 *
 * Returns null on failure so callers return zero rather than a phantom load.
 *
 * @param {string} season
 * @returns {number|null}
 */
const getGlassCLTD = (season) => {
  const cltd = GLASS_CLTD[season];
  if (cltd === undefined) {
    console.error(
      `glazingCalc.getGlassCLTD: no GLASS_CLTD entry for season="${season}". ` +
      `Winter callers MUST return U×A×ΔT before reaching the CLTD lookup — ` +
      `see the winter short-circuit in calcGlassGain(). ` +
      `For any other unknown season, add an entry to GLASS_CLTD in ashraeTables.js. ` +
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
 * calcGlassGain(glass, climate, tRoom, season, latitude?, dailyRange?)
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
 *
 * @param {object} glass      - glass element from envelopeSlice
 * @param {object} climate    - climate state from climateSlice
 * @param {number} tRoom      - room design dry-bulb (°F)
 * @param {string} season     - 'summer' | 'monsoon' | 'winter'
 * @param {number} latitude   - site latitude (degrees; negative = south)
 * @param {number} dailyRange - diurnal range (°F); 0 = use defaults
 * @returns {{ conduction: number, solar: number, total: number }} BTU/hr, signed
 */
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

  if (area === 0 || u === 0) return { conduction: 0, solar: 0, total: 0 };

  const orientation = glass.orientation || 'E';
  const roomMass    = glass.roomMass    || 'medium';
  const shgc        = resolveShgc(glass);
  const dbOut       = parseFloat(climate?.outside?.[season]?.db) || 95;
  const shgf        = getCorrectedSHGF(orientation, season, latitude);

  // ── Winter: steady-state conduction + full solar credit ───────────────────
  if (season === 'winter') {
    // Conduction: negative when dbOut < tRoom (heat loss through glass).
    const conduction = u * area * (dbOut - tRoom);

    // CLF = 1.0 in winter — solar gain is an immediate heating credit,
    // not subject to radiant storage delay. See BUG-GL-02 in CHANGELOG.
    const solar = shgc * shgf * area * 1.0;

    return {
      conduction: Math.round(conduction),
      solar:      Math.round(solar),
      total:      Math.round(conduction + solar),
    };
  }

  // ── Summer / Monsoon: CLTD conduction + CLF-weighted solar ────────────────

  // CLF selection: shaded glass uses the interior-shading table;
  // unshaded defaults to CLF_UNSHADED = 1.0 (conservative for cooling).
  const isShaded = glass.shaded === true;
  const clf      = isShaded
    ? (CLF[orientation]?.[roomMass] ?? CLF['N']['medium'])
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

  const tMeanOutdoor       = getMeanOutdoorTemp(dbOut, season, dailyRange);
  const correctedGlassCLTD = correctCLTD(glassBaseCLTD, tRoom, tMeanOutdoor, 0);
  const conduction          = u * area * correctedGlassCLTD;

  return {
    conduction: Math.round(conduction),
    solar:      Math.round(solar),
    total:      Math.round(conduction + solar),
  };
};


// ─────────────────────────────────────────────────────────────────────────────
// Skylight Heat Gain
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcSkylightGain(skylight, climate, tRoom, season, latitude?, dailyRange?)
 *
 * Skylights treated as horizontal glass (orientation = 'Horizontal').
 * All fixes from calcGlassGain apply — including BUG-GL-02 (winter CLF=1.0)
 * and the safe GLASS_CLTD lookup via getGlassCLTD().
 *
 * Note: horizontal skylights have the highest summer SHGF (290 BTU/hr·ft²
 * at sea level, 32°N) and the highest winter solar credit. Correct CLF
 * treatment is particularly important for skylit pharma facilities where
 * skylights contribute meaningfully to the winter heating credit balance.
 *
 * @param {object} skylight   - skylight element from envelopeSlice
 * @param {object} climate    - climate state
 * @param {number} tRoom      - room design dry-bulb (°F)
 * @param {string} season     - 'summer' | 'monsoon' | 'winter'
 * @param {number} latitude   - site latitude
 * @param {number} dailyRange - diurnal range (°F)
 * @returns {{ conduction: number, solar: number, total: number }} BTU/hr, signed
 */
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