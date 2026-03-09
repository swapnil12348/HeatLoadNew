/**
 * psychroStatePoints.js
 * Responsibility: Psychrometric state points for all AHU air streams.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 1 (Psychrometrics)
 *            ASHRAE Handbook — Fundamentals (2021), Chapter 18 (Load Calc)
 *
 * ── AIR STREAMS MODELLED ─────────────────────────────────────────────────────
 *
 *   1. Ambient (OA)     — outdoor design conditions from climateSlice
 *   2. Fresh Air (FA)   — same as ambient (no pre-treatment assumed)
 *   3. Return Air (RA)  — room design setpoint (DB + RH)
 *   4. Mixed Air (MA)   — blend of RA + FA by CFM fraction
 *                         MA_DB = (RA_CFM × RA_DB + FA_CFM × FA_DB) / total
 *                         MA_gr = (RA_CFM × RA_gr + FA_CFM × FA_gr) / total
 *   5. Coil Leaving (CL)— saturated air leaving cooling coil at ADP
 *                         DB = WB = ADP, RH = 100%, gr = f(ADP, 100%)
 *   6. Supply Air (SA)  — ADP-bypass blend
 *                         SA_DB = CL_DB × (1−BF) + RA_DB × BF
 *                         SA_gr = CL_gr × (1−BF) + RA_gr × BF
 *
 * ── WINTER MODEL BOUNDARY ────────────────────────────────────────────────────
 *
 *   The ADP-bypass model applies to COOLING MODE ONLY.
 *   In winter, the cooling coil is OFF; the ADP concept is meaningless.
 *
 *   Winter state points are therefore set as follows:
 *     CL (coil leaving) = RA (return air) — no cooling, no dehumidification
 *     SA (supply air)   = RA              — supply is room setpoint
 *   This reflects steady-state winter operation where the AHU is in heating/
 *   humidification mode. Actual winter supply air temperature (post-heat coil)
 *   and humidity ratio (post-humidifier) are computed in heatingHumid.js.
 *
 *   CONSEQUENCE: coil_shr and coil_contactFactor are derived from summer only.
 *
 * ── PSYCHROMETRIC PROPERTIES COMPUTED PER POINT ──────────────────────────────
 *
 *   DB    — dry-bulb temperature (°F)
 *   WB    — wet-bulb temperature (°F) — ASHRAE iterative bisection method
 *   gr    — humidity ratio (grains/lb dry air)
 *   enth  — specific enthalpy (BTU/lb dry air)
 *            h = 0.240 × DB + gr/7000 × (1061 + 0.444 × DB)
 *
 * ── ALTITUDE CORRECTION ──────────────────────────────────────────────────────
 *
 *   All gr calculations use site Patm via elevation parameter.
 *   WB iterative method also uses site Patm (psychro.js handles this internally).
 */

import {
  calculateGrains,
  calculateEnthalpy,
  calculateWetBulb,
  calculateRH,          // FIX PSP-01: imported from psychro.js (replaces local rhFromGrains)
} from '../../utils/psychro';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute the full psychrometric state for one air point.
 * Returns both display strings and numeric values.
 *
 * FIX PSP-01: The previous local rhFromGrains(grains, dbF, elevation) function
 * is removed. calculateRH(dbF, grains, elevFt) from psychro.js is the single
 * source of truth — it uses the Hyland-Wexler saturation pressure equation,
 * which is correct for sub-zero dew point conditions (1%RH critical facilities).
 *
 * @param {number} dbF       - dry-bulb temperature (°F)
 * @param {number} grains    - humidity ratio (gr/lb)
 * @param {number} elevation - site elevation (ft)
 */
const computeStatePoint = (dbF, grains, elevation = 0) => {
  const rh   = calculateRH(dbF, grains, elevation); // FIX PSP-01: was local rhFromGrains
  const wb   = calculateWetBulb(dbF, rh, elevation);
  const enth = calculateEnthalpy(dbF, grains);

  return {
    // Display strings
    db:   dbF.toFixed(1),
    wb:   wb.toFixed(1),
    gr:   grains.toFixed(1),
    enth: enth.toFixed(2),
    rh:   rh.toFixed(1),
    // Numeric for downstream calcs
    db_num:   dbF,
    wb_num:   wb,
    gr_num:   grains,
    enth_num: enth,
    rh_num:   rh,
  };
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * calculatePsychroStatePoints()
 *
 * Computes psychrometric state points for all six AHU air streams
 * for one room and one season.
 *
 * @param {object} climate        - full climate state (state.climate)
 * @param {string} season         - 'summer' | 'monsoon' | 'winter'
 * @param {number} dbInF          - room design dry-bulb (°F)
 * @param {number} rhIn           - room design RH (%)
 * @param {number} adpF           - apparatus dew point (°F)
 * @param {number} bf             - bypass factor (0–1)
 * @param {number} freshAirCFM    - fresh air CFM (freshAirCheck)
 * @param {number} supplyAir      - total supply air CFM
 * @param {number} elevation      - site elevation (ft)
 */
export const calculatePsychroStatePoints = (
  climate,
  season,
  dbInF,
  rhIn,
  adpF,
  bf,
  freshAirCFM,
  supplyAir,
  elevation = 0,
) => {
  // ── 1. Ambient / outdoor ───────────────────────────────────────────────────
  const outdoor = climate?.outside?.[season] || { db: 95, rh: 40 };
  const ambDB   = parseFloat(outdoor.db) || 95;
  const ambRH   = parseFloat(outdoor.rh) || 40;
  const ambGr   = calculateGrains(ambDB, ambRH, elevation);
  const amb     = computeStatePoint(ambDB, ambGr, elevation);

  // ── 2. Fresh air ───────────────────────────────────────────────────────────
  // No pre-treatment assumed — FA state = ambient state.
  // If pre-cooling/pre-heating is modelled in future, modify here.
  const fa = { ...amb };

  // ── 3. Return air (room setpoint) ──────────────────────────────────────────
  const raGr = calculateGrains(dbInF, rhIn, elevation);
  const ra   = computeStatePoint(dbInF, raGr, elevation);

  // ── 4. Mixed air (RA + FA blend by CFM fraction) ───────────────────────────
  const totalCFM = Math.max(1, supplyAir);
  const faCFM    = Math.min(freshAirCFM, totalCFM);
  const raCFM    = Math.max(0, totalCFM - faCFM);

  const maDB = (raCFM * dbInF  + faCFM * ambDB) / totalCFM;
  const maGr = (raCFM * raGr   + faCFM * ambGr) / totalCFM;
  const ma   = computeStatePoint(maDB, maGr, elevation);

  // ── 5 + 6: Season-aware coil leaving and supply air ───────────────────────
  // FIX PSP-02: Winter uses heating mode — ADP-bypass model does not apply.
  //
  // COOLING (summer, monsoon):
  //   CL = saturated air at ADP, DB = WB = ADP, RH = 100%.
  //   SA = ADP-bypass blend: SA_DB = CL_DB(1-BF) + RA_DB×BF
  //
  // HEATING (winter):
  //   The cooling coil is OFF. No dehumidification occurs.
  //   CL = RA (return air — coil passes air through unchanged).
  //   SA = RA (steady-state: supply = room conditions before heating coil).
  //   Actual post-heat-coil and post-humidifier conditions are in heatingHumid.js.
  let cl, sa, shr, contactFactor;

  if (season === 'winter') {
    // FIX PSP-02: Winter heating mode — no ADP, no bypass, no dehumidification
    cl = { ...ra };     // coil leaving = return air (coil off)
    sa = { ...ra };     // supply air   = return air (setpoint maintained by heating)
    shr           = 1.0;  // sensible-only in heating mode (no latent exchange at coil)
    contactFactor = 1 - bf;
  } else {
    // Cooling mode: summer and monsoon
    const grADP  = calculateGrains(adpF, 100, elevation);
    const clDB   = adpF;
    const clGr   = grADP;
    const clEnth = calculateEnthalpy(clDB, clGr);
    cl = {
      db:       clDB.toFixed(1),
      wb:       clDB.toFixed(1),   // WB = DB at saturation
      gr:       clGr.toFixed(1),
      enth:     clEnth.toFixed(2),
      rh:       '100.0',
      db_num:   clDB,
      wb_num:   clDB,
      gr_num:   clGr,
      enth_num: clEnth,
      rh_num:   100,
    };

    // Supply air: ADP-bypass blend (ASHRAE HOF Ch.18)
    const saDB = clDB * (1 - bf) + dbInF * bf;
    const saGr = clGr * (1 - bf) + raGr  * bf;
    sa = computeStatePoint(saDB, saGr, elevation);

    // ── 7. Coil SHR ──────────────────────────────────────────────────────────
    // FIX PSP-03: Use moist-air Cp = 0.240 + 0.444×W [BTU/lb·°F]
    //   (was 0.240 — dry air only, ~1.8% error at typical HVAC conditions)
    // W = raGr / 7000 [lb moisture / lb dry air]
    const cpMoist  = 0.240 + 0.444 * (raGr / 7000); // FIX PSP-03
    const enthDiff = ra.enth_num - sa.enth_num;
    const sensDiff = cpMoist * (dbInF - saDB);        // FIX PSP-03
    shr = enthDiff > 0
      ? Math.min(1, Math.max(0, sensDiff / enthDiff))
      : 1.0;

    contactFactor = 1 - bf;
  }

  return {
    amb,
    fa,
    ra,
    ma,
    cl,
    sa,
    sensibleHeatRatio: shr.toFixed(3),
    contactFactor:     contactFactor.toFixed(3),
  };
};

// ── All-seasons wrapper ───────────────────────────────────────────────────────

/**
 * calculateAllSeasonStatePoints()
 *
 * Runs calculatePsychroStatePoints() for all three seasons.
 * Returns a flat keyed object for spread into rdsSelector return.
 *
 * coil_shr and coil_contactFactor are derived from SUMMER ONLY.
 * Winter psychro state points use the heating-mode model (see above).
 */
export const calculateAllSeasonStatePoints = (
  climate,
  dbInF,
  rhIn,
  adpF,
  bf,
  freshAirCFM,
  supplyAir,
  elevation = 0,
) => {
  const SEASONS = ['summer', 'monsoon', 'winter'];
  const fields  = {};

  SEASONS.forEach(season => {
    const pts = calculatePsychroStatePoints(
      climate, season, dbInF, rhIn, adpF, bf,
      freshAirCFM, supplyAir, elevation,
    );

    // Ambient
    fields[`amb_db_${season}`]   = pts.amb.db;
    fields[`amb_wb_${season}`]   = pts.amb.wb;
    fields[`amb_gr_${season}`]   = pts.amb.gr;
    fields[`amb_enth_${season}`] = pts.amb.enth;

    // Fresh air
    fields[`fa_db_${season}`]    = pts.fa.db;
    fields[`fa_wb_${season}`]    = pts.fa.wb;
    fields[`fa_gr_${season}`]    = pts.fa.gr;
    fields[`fa_enth_${season}`]  = pts.fa.enth;

    // Return air
    fields[`ra_db_${season}`]    = pts.ra.db;
    fields[`ra_wb_${season}`]    = pts.ra.wb;
    fields[`ra_gr_${season}`]    = pts.ra.gr;

    // Mixed air
    fields[`ma_db_${season}`]    = pts.ma.db;
    fields[`ma_wb_${season}`]    = pts.ma.wb;
    fields[`ma_gr_${season}`]    = pts.ma.gr;
    fields[`ma_enth_${season}`]  = pts.ma.enth;

    // Coil leaving
    fields[`coilLeave_db_${season}`]   = pts.cl.db;
    fields[`coilLeave_wb_${season}`]   = pts.cl.wb;
    fields[`coilLeave_gr_${season}`]   = pts.cl.gr;
    fields[`coilLeave_enth_${season}`] = pts.cl.enth;

    // Supply air
    fields[`sa_db_${season}`]    = pts.sa.db;
    fields[`sa_wb_${season}`]    = pts.sa.wb;
    fields[`sa_gr_${season}`]    = pts.sa.gr;
    fields[`sa_enth_${season}`]  = pts.sa.enth;

    // Coil performance — summer only (cooling mode metric)
    if (season === 'summer') {
      fields['coil_shr']           = pts.sensibleHeatRatio;
      fields['coil_contactFactor'] = pts.contactFactor;
    }
  });

  return fields;
};