/**
 * glazingCalc.js
 * Transparent envelope heat gain / loss calculations.
 * Responsibility: glass elements, skylights, solar heat gain.
 *
 * Separated from envelopeCalc.js because glazing involves two distinct load
 * components (conduction + solar) and a different table lookup chain from
 * opaque elements. Keeping them together created a function that returned
 * a different shape ({ conduction, solar, total }) from all its siblings.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Ch.18 & 27
 *            ASHRAE CHLCM 2nd Edition, §3
 *
 * SIGN CONVENTION:
 *   Positive = heat INTO conditioned space  → cooling load
 *   Negative = heat OUT OF conditioned space → heating load / heat loss
 *
 * CHANGELOG:
 *   FIX-05 — Solar gain: SHGC preferred over legacy SC.
 *   FIX-06 — Winter solar gain treated as a credit (reduces heating load).
 *   FIX MED-09 (ashraeTables.js) — CLF_UNSHADED used for glass without interior
 *             shading. Previously CLF (interior-shading table) was applied to all
 *             glass, understating solar load by 15–35% for unshaded E/W glass.
 *             glass.shaded flag (added to DEFAULT_ELEMENTS) now drives selection.
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
// Glass Heat Gain / Heat Loss
// ─────────────────────────────────────────────────────────────────────────────
/**
 * calcGlassGain(glass, climate, tRoom, season, latitude?, dailyRange?)
 *
 * Returns separate conduction and solar components for transparency in the RDS.
 * Total = conduction + solar (signed; solar subtracts from heating load in winter).
 *
 * Shading logic (FIX MED-09):
 *   glass.shaded = true  → interior blind/drape present → use CLF table
 *   glass.shaded = false → no interior shading          → use CLF_UNSHADED (1.0)
 *   glass.shaded absent  → conservative assumption: treat as unshaded
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

  if (area === 0) return { conduction: 0, solar: 0, total: 0 };

  const orientation = glass.orientation || 'E';
  const roomMass    = glass.roomMass    || 'medium';
  const shgc        = resolveShgc(glass);
  const dbOut       = parseFloat(climate?.outside?.[season]?.db) || 95;

  // ── Solar component ──────────────────────────────────────────────────────
  const shgf = getCorrectedSHGF(orientation, season, latitude);

  // FIX MED-09: Select CLF based on shading presence.
  // glass.shaded defaults to false (unshaded) when not set — conservative.
  const isShaded = glass.shaded === true;
  const clf      = isShaded
    ? (CLF[orientation]?.[roomMass] ?? CLF['N']['medium'])
    : CLF_UNSHADED;

  const solar = shgc * shgf * area * clf;

  // ── Winter: steady-state conduction + solar credit ───────────────────────
  if (season === 'winter') {
    // Conduction: negative when dbOut < tRoom (heat loss through glass)
    const conduction = u * area * (dbOut - tRoom);
    // Solar is a credit in winter — reduces the heating load
    // total = conduction + solar: conduction is negative, solar is positive
    return {
      conduction: Math.round(conduction),
      solar:      Math.round(solar),
      total:      Math.round(conduction + solar),
    };
  }

  // ── Summer / Monsoon: CLTD conduction + solar ────────────────────────────
  const glassBaseCLTD = GLASS_CLTD[season] ?? 15;
  const tMeanOutdoor  = getMeanOutdoorTemp(dbOut, season, dailyRange);
  // Glass has no orientation-based LM correction (lm = 0)
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
 * Skylights are treated as horizontal glass (orientation = 'Horizontal').
 * All shading logic from calcGlassGain applies.
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