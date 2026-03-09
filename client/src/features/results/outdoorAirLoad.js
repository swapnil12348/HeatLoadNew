/**
 * outdoorAirLoad.js
 * Responsibility: Outdoor air (fresh air) heat load on the AHU cooling/heating coil.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ASHRAE 62.1-2022, Section 6.2 (Ventilation Rate Procedure)
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-OA-01 [MEDIUM]: Hardcoded 4.5 replaced with AIR_MASS_FACTOR import.
 *     The air mass conversion constant (60 min/hr × 0.075 lb/ft³ = 4.5) was
 *     hardcoded as a magic number in the oaTotal formula. It is now imported
 *     from heatingHumid.js where it is defined, named, and documented.
 *     Single definition, single place.
 *
 *   BUG-OA-02 [MEDIUM]: Constant naming ambiguity resolved.
 *     Old: ASHRAE.SENSIBLE_FACTOR / ASHRAE.LATENT_FACTOR (ambiguous names).
 *     New: sensibleFactor(elevation) / latentFactor(elevation) imported from
 *     psychro.js. These return the altitude-corrected values directly.
 *     The separate altCf multiplication is removed — it was being applied twice
 *     in any caller that had already corrected via sensibleFactor().
 *
 *     ⚠️  NOTE FOR CALLERS: If you were calling:
 *           const Cs = ASHRAE.SENSIBLE_FACTOR * altCf;
 *         ...and passing that as altCf to this function, you were double-
 *         correcting. With v2.0, altCf is still accepted as a parameter
 *         (for backward compatibility) but the Cs/Cl internal computation
 *         uses sensibleFactor(elevation) instead.
 *
 *   BUG-OA-03 [LOW]: oaTotal vs oaSensible+oaLatent divergence documented.
 *     The two methods will not give identical results for the same conditions:
 *
 *       Cs/Cl method: approximates latent using 0.68 × Δgr (linear in gr/lb)
 *       Enthalpy method: uses h = 0.240·t + W·(1061 + 0.444·t) — non-linear
 *
 *     The enthalpy method (oaTotal) is more accurate and is the AUTHORITATIVE
 *     value for coil selection. The Cs/Cl outputs (oaSensible, oaLatent) are
 *     provided for component breakdown display only.
 *
 *     rdsSelector.js should use oaTotal for coil capacity sizing.
 *     oaSensible + oaLatent are correct for display/reporting.
 *
 *   BUG-OA-04 [INFO]: Ventilation effectiveness (Ez) documented.
 *     ASHRAE 62.1-2022 §6.2.2 defines: Vbz_actual = Voz / Ez
 *     Ez = zone air distribution effectiveness.
 *       Mixed-air overhead supply: Ez = 1.0 (default — correct for most AHUs)
 *       Displacement ventilation:  Ez = 1.2 (less OA needed for same result)
 *       UFAD (underfloor air):     Ez = 1.0–1.2 depending on configuration
 *       Ceiling supply, floor return (cleanroom UFAD): Ez = 1.0
 *     This function assumes Ez = 1.0. If a room uses displacement or UFAD,
 *     the caller (airQuantities.js) must divide Voz by Ez BEFORE calling
 *     this function. freshAirCFM passed here must already be the corrected
 *     value (Vbz = Voz / Ez).
 *
 * ── DISTINCTION — Infiltration vs Outdoor Air Load ────────────────────────────
 *
 *   Infiltration (seasonalLoads.js):
 *     Uncontrolled air leakage through cracks, gaps, doors.
 *     Acts directly on the ROOM — adds to room sensible/latent load.
 *
 *   Outdoor Air Load (this module):
 *     Deliberate mechanical ventilation introduced via AHU.
 *     Acts on the COIL — conditioned before entering the room.
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

import { calculateGrains, calculateEnthalpy, sensibleFactor, latentFactor } from '../../utils/psychro';
import { AIR_MASS_FACTOR } from './heatingHumid';

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * calculateOutdoorAirLoad()
 *
 * Computes the sensible, latent, and total enthalpy load imposed on the
 * AHU coil by conditioning the required outdoor air quantity.
 *
 * @param {number} freshAirCFM  - outdoor air CFM (Ez-corrected, from airQuantities.js)
 * @param {object} climate      - full climate Redux state (state.climate)
 * @param {string} season       - 'summer' | 'monsoon' | 'winter'
 * @param {number} dbInF        - room design dry-bulb (°F)
 * @param {number} rhIn         - room design relative humidity (%)
 * @param {number} altCf        - altitude correction factor (dimensionless, 0–1)
 * @param {number} [elevation=0] - site elevation (ft) — for gr calculation via
 *                                 sitePressure(); must match the elevation used
 *                                 to derive altCf.
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
      methodNote:      '',
    };
  }

  // BUG-OA-02 FIX: Use psychro.js exported functions.
  // sensibleFactor(elevation) already includes the altCf correction internally.
  // No need to multiply by altCf again.
  const Cs = sensibleFactor(elevation);
  const Cl = latentFactor(elevation);

  // ── Outdoor conditions ────────────────────────────────────────────────────
  const outdoor = climate?.outside?.[season] || { db: 95, rh: 40 };
  const dbOut   = parseFloat(outdoor.db) || 95;
  const rhOut   = parseFloat(outdoor.rh) || 40;

  // Recalculate at site elevation — Patm affects humidity ratio
  const grOut = calculateGrains(dbOut, rhOut, elevation);
  const hOut  = calculateEnthalpy(dbOut, grOut);

  // ── Indoor conditions ─────────────────────────────────────────────────────
  const grIn = calculateGrains(dbInF, rhIn, elevation);
  const hIn  = calculateEnthalpy(dbInF, grIn);

  // ── Sensible OA load ──────────────────────────────────────────────────────
  // Q_s = Cs × CFM_OA × (T_out − T_in)
  // + in summer (outdoor hotter), − in winter (outdoor cooler)
  const oaSensible = Math.round(Cs * freshAirCFM * (dbOut - dbInF));

  // ── Latent OA load ────────────────────────────────────────────────────────
  // Q_l = Cl × CFM_OA × (gr_out − gr_in)
  // oaLatent:       floored at 0 — drier OA provides no latent cooling load
  // oaLatentSigned: full signed value — negative = humidification needed
  const rawLatent      = Cl * freshAirCFM * (grOut - grIn);
  const oaLatent       = Math.round(Math.max(0, rawLatent));
  const oaLatentSigned = Math.round(rawLatent);

  // ── Total enthalpy-based OA load (authoritative) ──────────────────────────
  // BUG-OA-01 FIX: AIR_MASS_FACTOR imported from heatingHumid.js (was magic 4.5).
  //
  // Q_total = CFM_OA × AIR_MASS_FACTOR × altCf × (h_out − h_in)
  //
  // Note: altCf is still used here explicitly because AIR_MASS_FACTOR is the
  // sea-level value (4.5). The enthalpy formula requires explicit density
  // correction — unlike Cs/Cl which already embed it via sensibleFactor().
  //
  // BUG-OA-03 NOTE: This value will differ from (oaSensible + oaLatent) because:
  //   - Cs/Cl method linearises the latent contribution (0.68 × Δgr)
  //   - Enthalpy method uses the full non-linear h = 0.240t + W(1061 + 0.444t)
  //   - At high humidity differences (tropical outdoor + dry indoor), divergence
  //     can reach 3–8%. Use oaTotal for coil selection.
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
    // BUG-OA-03: Reminder for rdsSelector.js
    methodNote: 'Use oaTotal for coil capacity sizing. oaSensible + oaLatent are for display breakdown only.',
  };
};

// ── Per-season convenience wrapper ───────────────────────────────────────────

/**
 * calculateAllSeasonOALoads()
 *
 * Runs calculateOutdoorAirLoad() for all three seasons in one call.
 * Consumed by rdsSelector.js when it needs OA load for each season.
 *
 * @param {number} freshAirCFM  - outdoor air CFM (Ez-corrected)
 * @param {object} climate      - full climate Redux state
 * @param {number} dbInF        - room design dry-bulb (°F)
 * @param {number} rhIn         - room design RH (%)
 * @param {number} altCf        - altitude correction factor
 * @param {number} [elevation=0] - site elevation (ft)
 *
 * @returns {{ summer: OAResult, monsoon: OAResult, winter: OAResult }}
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