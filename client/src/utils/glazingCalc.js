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
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-GL-02 [HIGH]: Winter solar credit used incorrect CLF for shaded glass.
 *
 *     The clf variable was computed once (before the season branch) using the
 *     summer CLF table for shaded glass. In winter, clf was then applied to
 *     the solar credit calculation:
 *       solar = shgc × shgf × area × clf   ← clf = summer shaded value (e.g. 0.47)
 *
 *     Problem: for shaded glass in winter, this UNDERSTATES the solar credit
 *     by the CLF factor (0.47–0.75). A smaller credit means the calculated
 *     heating load is LARGER than it should be — the heating plant is
 *     oversized, which is non-conservative from a first-cost standpoint but
 *     operationally safe.
 *
 *     More critically: the CLF table (ASHRAE CHLCM 2nd Ed., Table 13) is
 *     defined for COOLING load calculations at peak summer hour. It accounts
 *     for radiant heat storage in the room mass — some solar gain is absorbed
 *     by the structure and released later, so the instantaneous cooling load
 *     is less than the peak solar gain. This concept does not apply to heating:
 *     in winter, any solar gain is immediately beneficial (reduces heating
 *     load) regardless of room mass. CLF < 1 in winter is physically wrong.
 *
 *     Fix: for winter season, always use CLF = 1.0 for solar (both shaded and
 *     unshaded). This correctly represents the full instantaneous solar credit
 *     against the winter heating load.
 *
 *     Impact for 1%RH critical facilities:
 *       South-facing glass (S orientation, 32°N, winter): SHGF = 118 BTU/hr·ft²
 *       For a shaded window (CLF_medium = 0.55), this fix changes:
 *         Old credit: 0.86 × 118 × 100ft² × 0.55 = 5,580 BTU/hr
 *         New credit: 0.86 × 118 × 100ft² × 1.00 = 10,148 BTU/hr
 *       Difference: 4,568 BTU/hr per 100ft² of south-facing shaded glass.
 *       For a pharma facility with significant south glazing, winter heating
 *       load was being overstated by this amount.
 *
 *   BUG-GL-04 [LOW]: Guard added for u=0 glass conduction path.
 *     calcWallGain / calcRoofGain both guard: if (area === 0 || u === 0) return 0
 *     calcGlassGain only guarded area === 0. If u=0 (custom glass with unset
 *     U-value), conduction = 0 mathematically, but the guard makes the intent
 *     explicit and consistent with all opaque element functions.
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
 *     CLF = 1.0 always (BUG-GL-02 FIX).
 *     Summer CLF accounts for radiant storage in room mass — this concept
 *     does not apply when solar is a heating credit. Any solar gain immediately
 *     offsets the heating load regardless of room thermal mass.
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

  // BUG-GL-04 FIX: guard u=0 consistently with calcWallGain / calcRoofGain.
  if (area === 0 || u === 0) return { conduction: 0, solar: 0, total: 0 };

  const orientation = glass.orientation || 'E';
  const roomMass    = glass.roomMass    || 'medium';
  const shgc        = resolveShgc(glass);
  const dbOut       = parseFloat(climate?.outside?.[season]?.db) || 95;
  const shgf        = getCorrectedSHGF(orientation, season, latitude);

  // ── Winter: steady-state conduction + full solar credit ───────────────────
  if (season === 'winter') {
    // Conduction: negative when dbOut < tRoom (heat loss through glass)
    const conduction = u * area * (dbOut - tRoom);

    // BUG-GL-02 FIX: CLF = 1.0 for all glass in winter.
    //
    // The summer CLF table is a COOLING LOAD concept — it accounts for
    // radiant heat storage delaying the cooling load. In winter, solar
    // gain directly reduces the heating requirement with no storage delay.
    // Applying a summer CLF here was understating the heating credit.
    //
    // winter SHGF values (e.g. S at 32°N: 118 BTU/hr·ft²) are already
    // lower than summer values — the season is correctly represented
    // through getCorrectedSHGF(). CLF should not further reduce it.
    const clfWinter = 1.0;
    const solar     = shgc * shgf * area * clfWinter;

    // solar is positive (heat INTO space from sun) — reduces heating load.
    // total = conduction (negative, heat loss) + solar (positive, credit).
    return {
      conduction: Math.round(conduction),
      solar:      Math.round(solar),
      total:      Math.round(conduction + solar),
    };
  }

  // ── Summer / Monsoon: CLTD conduction + CLF-weighted solar ────────────────

  // FIX MED-09: CLF selection based on interior shading presence.
  //   glass.shaded = true  → CLF (interior blind/drape table)
  //   glass.shaded = false/absent → CLF_UNSHADED = 1.0
  //
  // Conservative default: unshaded (higher solar load). If a window has
  // blinds, the engineer must explicitly set glass.shaded = true in the
  // envelope config to receive the CLF reduction.
  const isShaded = glass.shaded === true;
  const clf      = isShaded
    ? (CLF[orientation]?.[roomMass] ?? CLF['N']['medium'])
    : CLF_UNSHADED;

  const solar = shgc * shgf * area * clf;

  // Glass conduction via CLTD method (ASHRAE CHLCM §3).
  // No orientation LM correction for glass — CLTD is position-independent.
  // Glass conduction is driven by DB difference, not solar position.
  const glassBaseCLTD      = GLASS_CLTD[season] ?? 15;
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
 * All fixes from calcGlassGain apply — including BUG-GL-02 (winter CLF=1.0).
 *
 * Note: horizontal skylights have the highest summer SHGF (290 BTU/hr·ft²
 * at sea level, 32°N) and the highest winter solar credit. Correct CLF
 * treatment is particularly important for skylit pharma facilities where
 * skylights are used for circadian lighting and contribute meaningfully to
 * the winter heating credit balance.
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