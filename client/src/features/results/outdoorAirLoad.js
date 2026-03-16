/**
 * outdoorAirLoad.js
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
 *     imported from psychro.js replacing ambiguous ASHRAE constant names.
 *   BUG-OA-03 [LOW]: oaTotal vs oaSensible+oaLatent divergence documented.
 *     rdsSelector.js should use oaTotal for coil sizing.
 *   BUG-OA-04 [INFO]: Ventilation effectiveness (Ez) documented.
 *
 * ── DISTINCTION — Infiltration vs Outdoor Air Load ────────────────────────────
 *
 *   Infiltration (seasonalLoads.js):
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
import { AIR_MASS_FACTOR } from './heatingHumid';

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * calculateOutdoorAirLoad()
 *
 * Computes the sensible, latent, and total enthalpy load imposed on the
 * AHU coil by conditioning the required outdoor air quantity.
 *
 * @param {number} freshAirCFM    - outdoor air CFM (Ez-corrected, from airQuantities.js)
 * @param {object} climate        - full climate Redux state (state.climate)
 * @param {string} season         - 'summer' | 'monsoon' | 'winter'
 * @param {number} dbInF          - room design dry-bulb (°F)
 * @param {number} rhIn           - room design relative humidity (%)
 * @param {number} [elevation=0]  - site elevation (ft). altCf is derived internally
 *                                  from elevation to guarantee Cs/Cl and oaTotal
 *                                  use the same air density basis.
 *
 * @returns {{
 *   oaSensible:       number,  sensible OA coil load (BTU/hr), signed
 *   oaLatent:         number,  latent OA coil load (BTU/hr), floored at 0 for cooling
 *   oaLatentSigned:   number,  latent OA load signed (for heating/humidification)
 *   oaTotal:          number,  enthalpy-based OA load (BTU/hr), signed [authoritative]
 *   oaEnthalpyDelta:  number,  h_outdoor − h_room (BTU/lb)
 *   cfmOA:            number,  outdoor air CFM echoed for traceability
 *   dbOut:            number,  outdoor dry-bulb used (°F)
 *   grOut:            number,  outdoor humidity ratio (gr/lb)
 *   grIn:             number,  indoor humidity ratio (gr/lb)
 *   hOut:             number,  outdoor air enthalpy (BTU/lb)
 *   hIn:              number,  indoor air enthalpy (BTU/lb)
 *   methodNote:       string,  reminder that oaTotal is authoritative for coil sizing
 * }}
 */
export const calculateOutdoorAirLoad = (
  freshAirCFM,
  climate,
  season,
  dbInF,
  rhIn,
  elevation = 0,
) => {
  // Guard — no fresh air means no OA load
  if (!freshAirCFM || freshAirCFM <= 0) {
    return {
      oaSensible:      0,
      oaLatent:        0,
      oaLatentSigned:  0,
      oaTotal:         0,
      oaEnthalpyDelta: 0,
      cfmOA:           0,
      dbOut:           0,
      grOut:           0,
      grIn:            0,
      hOut:            0,
      hIn:             0,
      methodNote:      '',
    };
  }

  // altCf derived internally — guarantees oaTotal and Cs/Cl use the same
  // site pressure basis. Passing elevation once is the single source of truth.
  const altCf = altitudeCorrectionFactor(elevation);
  const Cs    = sensibleFactor(elevation);
  const Cl    = latentFactor(elevation);

  // ── Outdoor conditions ────────────────────────────────────────────────────
  const outdoor = climate?.outside?.[season] || { db: 95, rh: 40 };
  const dbOut   = parseFloat(outdoor.db) || 95;
  const rhOut   = parseFloat(outdoor.rh) || 40;

  const grOut = calculateGrains(dbOut, rhOut, elevation);
  const hOut  = calculateEnthalpy(dbOut, grOut);

  // ── Indoor conditions ─────────────────────────────────────────────────────
  const grIn = calculateGrains(dbInF, rhIn, elevation);
  const hIn  = calculateEnthalpy(dbInF, grIn);

  // ── Sensible OA load ──────────────────────────────────────────────────────
  const oaSensible = Math.round(Cs * freshAirCFM * (dbOut - dbInF));

  // ── Latent OA load ────────────────────────────────────────────────────────
  const rawLatent      = Cl * freshAirCFM * (grOut - grIn);
  const oaLatent       = Math.round(Math.max(0, rawLatent));
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
    cfmOA:  freshAirCFM,
    dbOut,
    grOut:  parseFloat(grOut.toFixed(1)),
    grIn:   parseFloat(grIn.toFixed(1)),
    hOut:   parseFloat(hOut.toFixed(2)),
    hIn:    parseFloat(hIn.toFixed(2)),
    methodNote: 'Use oaTotal for coil capacity sizing. oaSensible + oaLatent are for display breakdown only.',
  };
};

// ── Per-season convenience wrapper ───────────────────────────────────────────

/**
 * calculateAllSeasonOALoads()
 *
 * Runs calculateOutdoorAirLoad() for all three seasons in one call.
 * Consumed by rdsSelector.js.
 *
 * @param {number} freshAirCFM   - outdoor air CFM (Ez-corrected)
 * @param {object} climate       - full climate Redux state
 * @param {number} dbInF         - room design dry-bulb (°F)
 * @param {number} rhIn          - room design RH (%)
 * @param {number} [elevation=0] - site elevation (ft)
 *
 * @returns {{ summer: OAResult, monsoon: OAResult, winter: OAResult }}
 */
export const calculateAllSeasonOALoads = (
  freshAirCFM,
  climate,
  dbInF,
  rhIn,
  elevation = 0,
) => {
  const seasons = ['summer', 'monsoon', 'winter'];
  return Object.fromEntries(
    seasons.map(season => [
      season,
      calculateOutdoorAirLoad(freshAirCFM, climate, season, dbInF, rhIn, elevation),
    ])
  );
};