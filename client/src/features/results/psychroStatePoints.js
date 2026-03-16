/**
 * psychroStatePoints.js
 * Responsibility: Psychrometric state points for all AHU air streams.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 1 (Psychrometrics)
 *            ASHRAE Handbook — Fundamentals (2021), Chapter 18 (Load Calc)
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   MED-PSP-01 FIX — contactFactor = 1.0 in winter (was: 1 − bf).
 *
 *     Bypass Factor (BF) is a COOLING COIL concept — it represents the fraction
 *     of supply air that bypasses the cooling coil surface without making full
 *     contact (ASHRAE HOF 2021 Ch.18). It is defined only when the cooling
 *     coil is operating.
 *
 *     In winter heating mode, the cooling coil is OFF. No bypass occurs. The
 *     Contact Factor (1 − BF) has no physical meaning in this mode.
 *
 *     Fix: contactFactor = 1.0 in winter.
 *     Meaning: all supply air makes full "contact" with the heating coil
 *     (or more precisely: the bypass concept does not apply to heating mode).
 *
 *     This does not affect current output — coil_contactFactor is only exported
 *     for summer in calculateAllSeasonStatePoints. This fix prevents future code
 *     that reads winter contactFactor from silently applying a bypass correction
 *     to a non-operating coil.
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   FIX PSP-01: calculateRH(dbF, grains, elevFt) from psychro.js replaces
 *     local rhFromGrains — uses Hyland-Wexler equation, correct for sub-zero DP.
 *
 *   FIX PSP-02: Winter uses heating mode — ADP-bypass model does not apply.
 *     CL = RA, SA = RA for winter (coil off).
 *
 *   FIX PSP-03: Moist-air Cp = 0.240 + 0.444×W used for SHR calculation.
 *     Was: dry-air Cp = 0.240 only (~1.8% error at typical HVAC conditions).
 *
 * ── AIR STREAMS MODELLED ─────────────────────────────────────────────────────
 *
 *   1. Ambient (OA)     — outdoor design conditions from climateSlice
 *   2. Fresh Air (FA)   — same as ambient (no pre-treatment assumed)
 *   3. Return Air (RA)  — room design setpoint (DB + RH)
 *   4. Mixed Air (MA)   — blend of RA + FA by CFM fraction
 *   5. Coil Leaving (CL)— saturated air at ADP (cooling only; = RA in winter)
 *   6. Supply Air (SA)  — ADP-bypass blend (cooling); = RA in winter
 *
 * ── WINTER MODEL BOUNDARY ────────────────────────────────────────────────────
 *
 *   The ADP-bypass model applies to COOLING MODE ONLY.
 *   In winter, the cooling coil is OFF:
 *     CL = RA (coil off, no dehumidification)
 *     SA = RA (supply = room setpoint, maintained by heating coil)
 *     shr = 1.0 (sensible-only heating mode)
 *     contactFactor = 1.0 (bypass concept does not apply to heating mode)
 */

import {
  calculateGrains,
  calculateEnthalpy,
  calculateWetBulb,
  calculateRH,
} from '../../utils/psychro';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute the full psychrometric state for one air point.
 * calculateRH from psychro.js uses the Hyland-Wexler saturation pressure
 * equation — correct for sub-zero dew point conditions (1%RH critical facilities).
 *
 * @param {number} dbF       - dry-bulb temperature (°F)
 * @param {number} grains    - humidity ratio (gr/lb)
 * @param {number} elevation - site elevation (ft)
 */
const computeStatePoint = (dbF, grains, elevation = 0) => {
  const rh   = calculateRH(dbF, grains, elevation);
  const wb   = calculateWetBulb(dbF, rh, elevation);
  const enth = calculateEnthalpy(dbF, grains);

  return {
    db:   dbF.toFixed(1),
    wb:   wb.toFixed(1),
    gr:   grains.toFixed(1),
    enth: enth.toFixed(2),
    rh:   rh.toFixed(1),
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
  const fa = { ...amb };

  // ── 3. Return air (room setpoint) ──────────────────────────────────────────
  const raGr = calculateGrains(dbInF, rhIn, elevation);
  const ra   = computeStatePoint(dbInF, raGr, elevation);

  // ── 4. Mixed air (RA + FA blend by CFM fraction) ───────────────────────────
  const totalCFM = Math.max(1, supplyAir);
  const faCFM    = Math.min(freshAirCFM, totalCFM);
  const raCFM    = Math.max(0, totalCFM - faCFM);

  const maDB = (raCFM * dbInF + faCFM * ambDB) / totalCFM;
  const maGr = (raCFM * raGr  + faCFM * ambGr) / totalCFM;
  const ma   = computeStatePoint(maDB, maGr, elevation);

  // ── 5 + 6: Season-aware coil leaving and supply air ───────────────────────
  let cl, sa, shr, contactFactor;

  if (season === 'winter') {
    // Winter heating mode — cooling coil is OFF.
    // CL = RA: coil passes air through unchanged (no dehumidification).
    // SA = RA: supply air = room setpoint, maintained by heating coil.
    cl = { ...ra };
    sa = { ...ra };

    // shr = 1.0: sensible-only in heating mode (no latent exchange at coil).
    shr = 1.0;

    // contactFactor = 1.0: bypass concept does not apply when the cooling
    // coil is off. Setting (1 - bf) in winter would imply 10% of air
    // bypasses a coil that is not operating — physically meaningless.
    contactFactor = 1.0;

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

    // Coil SHR — moist-air Cp = 0.240 + 0.444×W captures ~1.8% correction
    // over dry-air Cp = 0.240 alone at typical HVAC conditions.
    const cpMoist  = 0.240 + 0.444 * (raGr / 7000);
    const enthDiff = ra.enth_num - sa.enth_num;
    const sensDiff = cpMoist * (dbInF - saDB);
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
 * coil_shr and coil_contactFactor are derived from SUMMER ONLY —
 * these are cooling coil design parameters, not winter heating performance.
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

    fields[`amb_db_${season}`]   = pts.amb.db;
    fields[`amb_wb_${season}`]   = pts.amb.wb;
    fields[`amb_gr_${season}`]   = pts.amb.gr;
    fields[`amb_enth_${season}`] = pts.amb.enth;

    fields[`fa_db_${season}`]    = pts.fa.db;
    fields[`fa_wb_${season}`]    = pts.fa.wb;
    fields[`fa_gr_${season}`]    = pts.fa.gr;
    fields[`fa_enth_${season}`]  = pts.fa.enth;

    fields[`ra_db_${season}`]    = pts.ra.db;
    fields[`ra_wb_${season}`]    = pts.ra.wb;
    fields[`ra_gr_${season}`]    = pts.ra.gr;

    fields[`ma_db_${season}`]    = pts.ma.db;
    fields[`ma_wb_${season}`]    = pts.ma.wb;
    fields[`ma_gr_${season}`]    = pts.ma.gr;
    fields[`ma_enth_${season}`]  = pts.ma.enth;

    fields[`coilLeave_db_${season}`]   = pts.cl.db;
    fields[`coilLeave_wb_${season}`]   = pts.cl.wb;
    fields[`coilLeave_gr_${season}`]   = pts.cl.gr;
    fields[`coilLeave_enth_${season}`] = pts.cl.enth;

    fields[`sa_db_${season}`]    = pts.sa.db;
    fields[`sa_wb_${season}`]    = pts.sa.wb;
    fields[`sa_gr_${season}`]    = pts.sa.gr;
    fields[`sa_enth_${season}`]  = pts.sa.enth;

    if (season === 'summer') {
      fields['coil_shr']           = pts.sensibleHeatRatio;
      fields['coil_contactFactor'] = pts.contactFactor;
    }
  });

  return fields;
};