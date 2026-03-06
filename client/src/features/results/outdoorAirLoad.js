/**
 * outdoorAirLoad.js
 * Responsibility: Outdoor air (fresh air) heat load on the AHU cooling/heating coil.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ASHRAE 62.1-2022, Section 6.2 (Ventilation Rate Procedure)
 *
 * DISTINCTION — Infiltration vs Outdoor Air Load:
 *
 *   Infiltration (seasonalLoads.js):
 *     Uncontrolled air leakage through cracks, gaps, doors.
 *     Acts directly on the ROOM — adds to room sensible/latent load.
 *     CFM_inf = Volume × ACH_inf / 60
 *
 *   Outdoor Air Load (this module):
 *     Deliberate mechanical ventilation — fresh air introduced via AHU.
 *     Acts on the COIL — must be conditioned before entering the room.
 *     CFM_OA = freshAirCheck (from airQuantities.js)
 *
 * COIL LOAD EQUATIONS (ASHRAE HOF Ch.18):
 *
 *   Sensible OA load:
 *     Q_s = Cs × CFM_OA × (T_outdoor − T_room)
 *     where Cs = 1.08 × Cf  (altitude-corrected)
 *
 *   Latent OA load:
 *     Q_l = Cl × CFM_OA × (gr_outdoor − gr_room)
 *     where Cl = 0.68 × Cf  (altitude-corrected)
 *     Floored at 0 for cooling — negative Δgr means OA is drier than room
 *     (a dehumidification benefit, not a load — handled by coil naturally).
 *
 *   Total OA enthalpy load:
 *     Q_total = CFM_OA × 4.5 × Cf × (h_outdoor − h_room)
 *     where 4.5 = 60 min/hr × 0.075 lb/ft³ (sea-level air density)
 *     h = enthalpy in BTU/lb dry air
 *
 * SIGN CONVENTION:
 *   Positive = load ON coil (outdoor hotter/more humid than room → cooling load)
 *   Negative = benefit TO coil (outdoor cooler/drier → economizer potential)
 *
 * WINTER:
 *   Sensible OA load is negative (outdoor colder → heating load on preheat coil).
 *   Latent OA load is negative (outdoor drier → humidification required).
 *   Both are returned signed — callers decide how to apply.
 */

import { calculateGrains, calculateEnthalpy } from '../../utils/psychro';
import ASHRAE from '../../constants/ashrae';

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * calculateOutdoorAirLoad()
 *
 * Computes the sensible, latent, and total enthalpy load imposed on the
 * AHU coil by conditioning the required outdoor air quantity.
 *
 * @param {number} freshAirCFM   - outdoor air CFM (from airQuantities.freshAirCheck)
 * @param {object} climate       - full climate state (state.climate)
 * @param {string} season        - 'summer' | 'monsoon' | 'winter'
 * @param {number} dbInF         - room design dry-bulb (°F)
 * @param {number} rhIn          - room design relative humidity (%)
 * @param {number} altCf         - altitude correction factor (dimensionless)
 * @param {number} elevation     - site elevation (ft) for gr calculation
 *
 * @returns {{
 *   oaSensible:    number,  sensible OA coil load (BTU/hr), signed
 *   oaLatent:      number,  latent OA coil load (BTU/hr), floored at 0 for cooling
 *   oaLatentSigned:number,  latent OA load signed (for heating/humidification calcs)
 *   oaTotal:       number,  total enthalpy-based OA load (BTU/hr), signed
 *   oaEnthalpyDelta: number, h_outdoor − h_room (BTU/lb)
 *   cfmOA:         number,  outdoor air CFM (echo for traceability)
 *   dbOut:         number,  outdoor dry-bulb used (°F)
 *   grOut:         number,  outdoor humidity ratio (gr/lb)
 *   grIn:          number,  indoor humidity ratio (gr/lb)
 *   hOut:          number,  outdoor air enthalpy (BTU/lb)
 *   hIn:           number,  indoor air enthalpy (BTU/lb)
 * }}
 */
export const calculateOutdoorAirLoad = (
  freshAirCFM,
  climate,
  season,
  dbInF,
  rhIn,
  altCf,
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
    };
  }

  const Cs = ASHRAE.SENSIBLE_FACTOR * altCf;
  const Cl = ASHRAE.LATENT_FACTOR   * altCf;

  // ── Outdoor conditions ──────────────────────────────────────────────────────
  const outdoor = climate?.outside?.[season] || { db: 95, rh: 40 };
  const dbOut   = parseFloat(outdoor.db) || 95;
  const rhOut   = parseFloat(outdoor.rh) || 40;

  // Recalculate at site elevation — Patm affects humidity ratio
  const grOut = calculateGrains(dbOut, rhOut, elevation);
  const hOut  = calculateEnthalpy(dbOut, grOut);

  // ── Indoor conditions ───────────────────────────────────────────────────────
  const grIn = calculateGrains(dbInF, rhIn, elevation);
  const hIn  = calculateEnthalpy(dbInF, grIn);

  // ── Sensible OA load ────────────────────────────────────────────────────────
  // Q_s = Cs × CFM_OA × (T_out − T_in)
  // Positive in summer (outdoor hotter), negative in winter (outdoor cooler)
  const oaSensible = Math.round(Cs * freshAirCFM * (dbOut - dbInF));

  // ── Latent OA load ──────────────────────────────────────────────────────────
  // Q_l = Cl × CFM_OA × (gr_out − gr_in)
  // oaLatent: floored at 0 for cooling load summation (drier OA = no latent load)
  // oaLatentSigned: full signed value for heating/humidification calcs
  const rawLatent      = Cl * freshAirCFM * (grOut - grIn);
  const oaLatent       = Math.round(Math.max(0, rawLatent));
  const oaLatentSigned = Math.round(rawLatent);

  // ── Total enthalpy-based OA load ────────────────────────────────────────────
  // Q_total = CFM_OA × 4.5 × Cf × (h_out − h_in)
  // 4.5 = 60 min/hr × 0.075 lb/ft³ (standard air density at sea level)
  // Cf (altCf) corrects for reduced air density at altitude
  const oaEnthalpyDelta = hOut - hIn;
  const oaTotal = Math.round(freshAirCFM * 4.5 * altCf * oaEnthalpyDelta);

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
  };
};

// ── Per-season convenience wrapper ────────────────────────────────────────────

/**
 * calculateAllSeasonOALoads()
 *
 * Runs calculateOutdoorAirLoad() for all three seasons in one call.
 * Consumed by rdsSelector when it needs OA load for each season.
 *
 * @param {number} freshAirCFM  - outdoor air CFM
 * @param {object} climate      - full climate state
 * @param {number} dbInF        - room design dry-bulb (°F)
 * @param {number} rhIn         - room design RH (%)
 * @param {number} altCf        - altitude correction factor
 * @param {number} elevation    - site elevation (ft)
 *
 * @returns {{ summer: object, monsoon: object, winter: object }}
 *   Each value is the full return object from calculateOutdoorAirLoad()
 */
export const calculateAllSeasonOALoads = (
  freshAirCFM,
  climate,
  dbInF,
  rhIn,
  altCf,
  elevation = 0,
) => {
  const seasons = ['summer', 'monsoon', 'winter'];
  return Object.fromEntries(
    seasons.map(season => [
      season,
      calculateOutdoorAirLoad(
        freshAirCFM, climate, season, dbInF, rhIn, altCf, elevation,
      ),
    ])
  );
};