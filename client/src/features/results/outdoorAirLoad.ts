/**
 * outdoorAirLoad.ts
 * Responsibility: Outdoor air (fresh air) heat load on the AHU cooling/heating coil.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ASHRAE 62.1-2022, Section 6.2 (Ventilation Rate Procedure)
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   MED-OA-01 FIX — altCf removed from public API; derived internally from elevation.
 *
 *     Previous signature accepted both altCf and elevation separately. Inside
 *     the function, Cs/Cl used sensibleFactor(elevation) while oaTotal used
 *     caller-supplied altCf — two separate density bases. If altCf was pre-
 *     computed at a different elevation path, Cs/Cl and oaTotal diverged silently.
 *
 *     Fix: altCf is now derived internally via altitudeCorrectionFactor(elevation).
 *     The public API takes a single elevation parameter — single source of truth.
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-OA-01 [MEDIUM]: Hardcoded 4.5 replaced with AIR_MASS_FACTOR import.
 *   BUG-OA-02 [MEDIUM]: sensibleFactor(elevation) / latentFactor(elevation)
 *     imported from psychro.ts replacing ambiguous ASHRAE constant names.
 *   BUG-OA-03 [LOW]: oaTotal vs oaSensible+oaLatent divergence documented.
 *     rdsSelector.ts should use oaTotal for coil sizing.
 *   BUG-OA-04 [INFO]: Ventilation effectiveness (Ez) documented.
 *
 * ── DISTINCTION — Infiltration vs Outdoor Air Load ────────────────────────────
 *
 *   Infiltration (seasonalLoads.ts):
 *     Uncontrolled air leakage — acts directly on the ROOM.
 *
 *   Outdoor Air Load (this module):
 *     Deliberate mechanical ventilation introduced via AHU — acts on the COIL.
 *
 * ── COIL LOAD EQUATIONS (ASHRAE HOF Ch.18) ───────────────────────────────────
 *
 *   Sensible OA load:
 *     Q_s = Cs × CFM_OA × (T_outdoor − T_room)
 *     Cs = sensibleFactor(elevation) = 1.08 × altCf
 *
 *   Latent OA load:
 *     Q_l = Cl × CFM_OA × (gr_outdoor − gr_room)
 *     Cl = latentFactor(elevation) = 0.68 × altCf
 *     Floored at 0 for cooling (drier OA → no latent load)
 *
 *   Total OA enthalpy load (authoritative — use for coil sizing):
 *     Q_total = CFM_OA × AIR_MASS_FACTOR × altCf × (h_outdoor − h_room)
 *     = CFM_OA × 4.5 × altCf × Δh
 *
 * SIGN CONVENTION:
 *   Positive = load ON coil (outdoor hotter / more humid → cooling load)
 *   Negative = benefit (outdoor cooler / drier → potential economiser)
 */

import {
  calculateGrains,
  calculateEnthalpy,
  sensibleFactor,
  latentFactor,
  altitudeCorrectionFactor,
} from '../../utils/psychro';

// @ts-ignore - Ignore missing types until heatingHumid.js is converted
import { AIR_MASS_FACTOR } from '../../constants/ashrae';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Season = 'summer' | 'monsoon' | 'winter';

export interface ClimateState {
  outside?: Record<string, { db?: string | number; rh?: string | number }>;
  // The rest of the climate state isn't used by this module.
}

export interface OutdoorAirResult {
  oaSensible: number; // sensible OA coil load (BTU/hr), signed
  oaLatent: number; // latent OA coil load (BTU/hr), floored at 0 for cooling
  oaLatentSigned: number; // latent OA load signed (for heating/humidification)
  oaTotal: number; // enthalpy-based OA load (BTU/hr), signed [authoritative]
  oaEnthalpyDelta: number; // h_outdoor − h_room (BTU/lb)
  cfmOA: number; // outdoor air CFM echoed for traceability
  dbOut: number; // outdoor dry-bulb used (°F)
  grOut: number; // outdoor humidity ratio (gr/lb)
  grIn: number; // indoor humidity ratio (gr/lb)
  hOut: number; // outdoor air enthalpy (BTU/lb)
  hIn: number; // indoor air enthalpy (BTU/lb)
  methodNote: string; // reminder that oaTotal is authoritative for coil sizing
}

export type AllSeasonsOutdoorAirLoads = Record<Season, OutdoorAirResult>;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * calculateOutdoorAirLoad
 *
 * Computes the sensible, latent, and total enthalpy load imposed on the
 * AHU coil by conditioning the required outdoor air quantity.
 *
 * @param freshAirCFM   - outdoor air CFM (Ez-corrected, from airQuantities.ts)
 * @param climate       - full climate Redux state (state.climate)
 * @param season        - 'summer' | 'monsoon' | 'winter'
 * @param dbInF         - room design dry-bulb (°F)
 * @param rhIn          - room design relative humidity (%)
 * @param elevation     - site elevation (ft). altCf is derived internally.
 */
export const calculateOutdoorAirLoad = (
  freshAirCFM: number | null | undefined,
  climate: ClimateState | null | undefined,
  season: Season,
  dbInF: number | string,
  rhIn: number | string,
  elevation: number | string = 0
): OutdoorAirResult => {
  // Guard — no fresh air means no OA load
  if (!freshAirCFM || freshAirCFM <= 0) {
    return {
      oaSensible: 0,
      oaLatent: 0,
      oaLatentSigned: 0,
      oaTotal: 0,
      oaEnthalpyDelta: 0,
      cfmOA: 0,
      dbOut: 0,
      grOut: 0,
      grIn: 0,
      hOut: 0,
      hIn: 0,
      methodNote: '',
    };
  }

  // Parse dbInF and rhIn once
  const dbInFNum = typeof dbInF === 'string' ? parseFloat(dbInF) : dbInF;
  const rhInNum = typeof rhIn === 'string' ? parseFloat(rhIn) : rhIn;
  const elevationNum = typeof elevation === 'string' ? parseFloat(elevation) : elevation;

  // altCf derived internally — guarantees oaTotal and Cs/Cl use the same
  // site pressure basis. Passing elevation once is the single source of truth.
  const altCf = altitudeCorrectionFactor(elevationNum);
  const Cs = sensibleFactor(elevationNum);
  const Cl = latentFactor(elevationNum);

  // ── Outdoor conditions ────────────────────────────────────────────────────
 // Season-appropriate defaults — only fire when the field is absent from the
  // climate slice (e.g. partial form save). Using 40% for monsoon understates
  // grOut, oaEnthalpyDelta, oaTotal, and can suppress monsoon as peakCoolingSeason.
  const SEASON_DB_DEFAULTS: Record<Season, number> = { summer: 95, monsoon: 92, winter: 45 };
  const SEASON_RH_DEFAULTS: Record<Season, number> = { summer: 40, monsoon: 75, winter: 30 };

  const outdoor  = climate?.outside?.[season] ?? {};
  const dbOut = isNaN(parseFloat(String(outdoor.db)))
    ? SEASON_DB_DEFAULTS[season]
    : parseFloat(String(outdoor.db));
  const rhOut = isNaN(parseFloat(String(outdoor.rh)))
    ? SEASON_RH_DEFAULTS[season]
    : parseFloat(String(outdoor.rh));

  const grOut = calculateGrains(dbOut, rhOut, elevationNum);
  const hOut = calculateEnthalpy(dbOut, grOut);

  // ── Indoor conditions ─────────────────────────────────────────────────────
  const grIn = calculateGrains(dbInFNum, rhInNum, elevationNum);
  const hIn = calculateEnthalpy(dbInFNum, grIn);

  // ── Sensible OA load ──────────────────────────────────────────────────────
  const oaSensible = Math.round(Cs * freshAirCFM * (dbOut - dbInFNum));

  // ── Latent OA load ────────────────────────────────────────────────────────
  const rawLatent = Cl * freshAirCFM * (grOut - grIn);
  const oaLatent = Math.round(Math.max(0, rawLatent));
  const oaLatentSigned = Math.round(rawLatent);

  // ── Total enthalpy-based OA load (authoritative for coil sizing) ──────────
  // oaTotal differs from (oaSensible + oaLatent) because the Cs/Cl method
  // linearises the latent contribution (0.68 × Δgr) while the enthalpy method
  // uses h = 0.240t + W(1061 + 0.444t). Use oaTotal for coil selection;
  // oaSensible + oaLatent are for display breakdown only.
  const oaEnthalpyDelta = hOut - hIn;
  const oaTotal = Math.round(freshAirCFM * AIR_MASS_FACTOR * altCf * oaEnthalpyDelta);

  return {
    oaSensible,
    oaLatent,
    oaLatentSigned,
    oaTotal,
    oaEnthalpyDelta: parseFloat(oaEnthalpyDelta.toFixed(2)),
    cfmOA: freshAirCFM,
    dbOut,
    grOut: parseFloat(grOut.toFixed(1)),
    grIn: parseFloat(grIn.toFixed(1)),
    hOut: parseFloat(hOut.toFixed(2)),
    hIn: parseFloat(hIn.toFixed(2)),
    methodNote:
      'Use oaTotal for coil capacity sizing. oaSensible + oaLatent are for display breakdown only.',
  };
};

// ── Per-season convenience wrapper ───────────────────────────────────────────

/**
 * calculateAllSeasonOALoads
 *
 * Runs calculateOutdoorAirLoad() for all three seasons in one call.
 * Consumed by rdsSelector.ts.
 */
export const calculateAllSeasonOALoads = (
  freshAirCFM: number | null | undefined,
  climate: ClimateState | null | undefined,
  dbInF: number | string,
  rhIn: number | string,
  elevation: number | string = 0
): AllSeasonsOutdoorAirLoads => {
  const seasons: Season[] = ['summer', 'monsoon', 'winter'];

  // Type assertion here because Object.fromEntries typing isn't always smart enough
  // to infer that we strictly created an AllSeasonsOutdoorAirLoads.
  return Object.fromEntries(
    seasons.map((season) => [
      season,
      calculateOutdoorAirLoad(freshAirCFM, climate, season, dbInF, rhIn, elevation),
    ])
  ) as AllSeasonsOutdoorAirLoads;
};