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
 *   ASHRAE Ch.1 Eq.3: Patm = 29.921 × (1 − 6.8754×10⁻⁶ × elev)^5.2559 inHg
 *   This corrects the humidity ratio for reduced atmospheric pressure at altitude.
 *   WB iterative method also uses site Patm (psychro.js handles this internally).
 *
 * ── SIGN / VALUE CONVENTIONS ─────────────────────────────────────────────────
 *
 *   All temperatures in °F.
 *   All humidity ratios in gr/lb (grains per pound of dry air).
 *   All enthalpies in BTU/lb dry air.
 *   All values returned as strings toFixed(1) or toFixed(2) for display.
 *   Numeric versions available as _num suffix for downstream calculations.
 */

import {
  calculateGrains,
  calculateEnthalpy,
  calculateWetBulb,
} from '../../utils/psychro';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive RH from humidity ratio and DB at a given elevation.
 * Used to back-calculate RH for mixed air and supply air state points
 * where we know gr but not RH directly.
 *
 * @param {number} grains    - humidity ratio (gr/lb)
 * @param {number} dbF       - dry-bulb temperature (°F)
 * @param {number} elevation - site elevation (ft)
 * @returns {number} relative humidity (%)
 */
const rhFromGrains = (grains, dbF, elevation = 0) => {
  const grainsSat = calculateGrains(dbF, 100, elevation);
  return grainsSat > 0 ? Math.min(100, (grains / grainsSat) * 100) : 50;
};

/**
 * Compute the full psychrometric state for one air point.
 * Returns both display strings and numeric values.
 *
 * @param {number} dbF       - dry-bulb temperature (°F)
 * @param {number} grains    - humidity ratio (gr/lb)
 * @param {number} elevation - site elevation (ft)
 * @returns {{
 *   db:     string,   DB (°F) toFixed(1)
 *   wb:     string,   WB (°F) toFixed(1)
 *   gr:     string,   gr/lb   toFixed(1)
 *   enth:   string,   BTU/lb  toFixed(2)
 *   rh:     string,   RH%     toFixed(1)
 *   db_num: number,
 *   wb_num: number,
 *   gr_num: number,
 *   enth_num: number,
 *   rh_num:   number,
 * }}
 */
const computeStatePoint = (dbF, grains, elevation = 0) => {
  const rh   = rhFromGrains(grains, dbF, elevation);
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
 * across all three seasons for one room.
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
 *
 * @returns {{
 *   amb:       object,   ambient / outdoor air state point
 *   fa:        object,   fresh air state point (= ambient, no pre-treatment)
 *   ra:        object,   return air state point (room setpoint)
 *   ma:        object,   mixed air state point (RA + FA blend)
 *   cl:        object,   coil leaving air state point (saturated at ADP)
 *   sa:        object,   supply air state point (coil leaving + bypass blend)
 *   sensibleHeatRatio: string,  SHR = sensible / total coil load, toFixed(3)
 *   contactFactor:     string,  CF = 1 − BF, toFixed(3)
 * }}
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
  // If pre-cooling/pre-heating is added in future, this is the place to modify.
  const fa = { ...amb };

  // ── 3. Return air (room setpoint) ──────────────────────────────────────────
  const raGr = calculateGrains(dbInF, rhIn, elevation);
  const ra   = computeStatePoint(dbInF, raGr, elevation);

  // ── 4. Mixed air (RA + FA blend by CFM fraction) ───────────────────────────
  // MA_DB = (RA_CFM × RA_DB + FA_CFM × FA_DB) / total_CFM
  // MA_gr = (RA_CFM × RA_gr + FA_CFM × FA_gr) / total_CFM
  // Guards against divide-by-zero on zero-CFM rooms.
  const totalCFM  = Math.max(1, supplyAir);
  const faCFM     = Math.min(freshAirCFM, totalCFM);
  const raCFM     = Math.max(0, totalCFM - faCFM);

  const maDB = (raCFM * dbInF  + faCFM * ambDB) / totalCFM;
  const maGr = (raCFM * raGr   + faCFM * ambGr) / totalCFM;
  const ma   = computeStatePoint(maDB, maGr, elevation);

  // ── 5. Coil leaving air (saturated at ADP) ─────────────────────────────────
  // By definition: air leaves the cooling coil saturated at ADP.
  // DB = WB = ADP, RH = 100%, gr = humidity ratio at ADP saturated.
  const grADP  = calculateGrains(adpF, 100, elevation);
  const clDB   = adpF;
  const clGr   = grADP;
  const clEnth = calculateEnthalpy(clDB, clGr);
  const cl = {
    db:       clDB.toFixed(1),
    wb:       clDB.toFixed(1),    // WB = DB at saturation
    gr:       clGr.toFixed(1),
    enth:     clEnth.toFixed(2),
    rh:       '100.0',
    db_num:   clDB,
    wb_num:   clDB,
    gr_num:   clGr,
    enth_num: clEnth,
    rh_num:   100,
  };

  // ── 6. Supply air (ADP-bypass blend) ───────────────────────────────────────
  // SA_DB = CL_DB × (1−BF) + RA_DB × BF
  // SA_gr = CL_gr × (1−BF) + RA_gr × BF
  // This is the fundamental ADP-bypass coil model from ASHRAE HOF Ch.18.
  const saDB = clDB * (1 - bf) + dbInF * bf;
  const saGr = clGr * (1 - bf) + raGr  * bf;
  const sa   = computeStatePoint(saDB, saGr, elevation);

  // ── 7. Derived coil performance metrics ───────────────────────────────────

  // Sensible Heat Ratio (SHR):
  //   SHR = (h_ra − h_sa_sensible_only) / (h_ra − h_sa_total)
  //   Simplified using enthalpy difference:
  //   sensible component = 0.240 × (RA_DB − SA_DB)  [BTU/lb]
  //   total component    = RA_enth − SA_enth          [BTU/lb]
  const enthDiff     = ra.enth_num - sa.enth_num;
  const sensDiff     = 0.240 * (dbInF - saDB);
  const shr          = enthDiff > 0
    ? Math.min(1, Math.max(0, sensDiff / enthDiff))
    : 1.0;

  // Contact factor = 1 − bypass factor (ASHRAE definition)
  const contactFactor = 1 - bf;

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
 * Returns a flat keyed object matching the existing rdsSelector
 * psychroFields naming convention:
 *
 *   {amb_db_summer, amb_wb_summer, ..., sa_enth_winter, ...}
 *
 * This allows a clean spread into the rdsSelector return object.
 *
 * @param {object} climate      - full climate state
 * @param {number} dbInF        - room design dry-bulb (°F)
 * @param {number} rhIn         - room design RH (%)
 * @param {number} adpF         - apparatus dew point (°F)
 * @param {number} bf           - bypass factor (0–1)
 * @param {number} freshAirCFM  - fresh air CFM
 * @param {number} supplyAir    - total supply CFM
 * @param {number} elevation    - site elevation (ft)
 *
 * @returns {object} flat psychroFields object for spread into rdsSelector return
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

    // Coil performance (summer only — single season metric)
    if (season === 'summer') {
      fields['coil_shr']           = pts.sensibleHeatRatio;
      fields['coil_contactFactor'] = pts.contactFactor;
    }
  });

  return fields;
};