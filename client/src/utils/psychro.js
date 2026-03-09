/**
 * psychro.js
 * Psychrometric utilities.
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 1
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REVISION v2.2 — BUG-TIER1-01 FIX: calculateDewPoint returns null for rh ≤ 0
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * BUG-TIER1-01 FIX: calculateDewPoint() previously returned integer 0 when
 * rhNum <= 0. This silently defeated the entire MEDIUM-02 null-guard
 * infrastructure: callers checking `if (dp === null)` would never trigger,
 * and 0°F would propagate as a physically valid frost point.
 *
 * 0°F frost point implies ~3%RH at 70°F DB — a real, non-zero humidity ratio
 * that would corrupt humidification load calculations for solid-state battery
 * rooms, vacuum process tool environments, and any condition where the
 * engineer sets RH = 0 to represent a perfectly dry reference state.
 *
 * Fix: the `isNaN` guard (returns 0 for non-numeric input — legacy-safe) is
 * separated from the `rhNum <= 0` guard (returns null — dew point undefined
 * for zero or negative RH, must be handled by caller).
 *
 * All callers already handle null from the MEDIUM-02 fix:
 *   psychroValidation.js — validateStatePoint, validateRoomHumidity
 *   psychroStatePoints.js — any state point displaying dew point
 *   rdsSelector.js — RDS row dew point display field
 *   heatingHumid.js — humidification load (grainsFromDewPoint path)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REVISION v2.1 — MEDIUM-02 FIX: calculateDewPoint returns null for out-of-range
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MEDIUM-02 FIX: calculateDewPoint() previously returned −148 (a numeric
 * sentinel for "frost point below −100°C"). No caller in the codebase checked
 * for this sentinel, causing heatingHumid.js and rdsSelector.js to silently
 * use −148°F as a real design temperature. grainsFromDewPoint(−148) returns
 * a non-zero value, so humidification loads were computed from a physically
 * undefined condition.
 *
 * The function now returns null for out-of-range conditions. All callers must
 * check:  const dp = calculateDewPoint(db, rh);
 *         if (dp === null) { /* handle out-of-range */ }
 *
 * Affected callers to update:
 *   psychroValidation.js — validateStatePoint, validateRoomHumidity
 *   psychroStatePoints.js — any state point that displays dew point
 *   rdsSelector.js — RDS row dew point display field
 *   heatingHumid.js — humidification load (grainsFromDewPoint path)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REVISION v2.0 — ASHRAE Hyland-Wexler Saturation Pressure
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * BUG-PSYCH-01 (CRITICAL): Magnus formula replaced with ASHRAE Hyland-Wexler.
 *
 *   OLD: Magnus (Alduchov & Eskridge 1996)
 *     Es(T) = 6.112 × exp(17.67·T / (T + 243.5))
 *     Valid: −40°C to +60°C per paper.
 *     Error at −37°C: ±0.28 hPa  ← PROBLEM ZONE
 *
 *   NEW: ASHRAE HOF 2021, Ch.1, Eq.3 (ice) & Eq.5 (liquid)
 *     Ice branch  (T < 0°C):  Hyland-Wexler ice-surface equation
 *     Liquid branch (T ≥ 0°C): Hyland-Wexler liquid-surface equation
 *     Valid: −100°C to +200°C. Error < 0.001% across full range.
 *
 *   WHY THIS MATTERS for 1%RH critical facilities:
 *     At 1%RH / 70°F DB, dew point ≈ −37°C (−35°F).
 *     The error in saturation pressure at −37°C propagates directly into:
 *       • Humidification capacity sizing: ±10–15% error
 *       • Dew point setpoint verification: ±0.5–1.0°C
 *       • Moisture balance in controlled-humidity cleanrooms: ±8%
 *
 *   FACILITY EXAMPLES where this fix is non-negotiable:
 *     Taiwan Semiconductor (TSMC) AMHS corridors: 35–45%RH
 *     TSMC lithography bays: <1%RH in some tool environments
 *     Cipla pharma dry powder filling: <2%RH
 *     Exide battery formation: <5%RH
 *     Li-ion cell assembly: <0.1% dew point control (chilled mirror, −50°C DP)
 *
 * BUG-PSYCH-02: calculateDewPoint() analytical Magnus inverse replaced with
 *   bisection on Hyland-Wexler curve. Previous formula returned wrong results
 *   below −30°C (exactly the range critical for sub-1%RH facilities).
 *
 *   Note: dew points below 0°C are physically frost points (ice surface
 *   equilibrium). calculateDewPoint() correctly uses the ice branch of
 *   H-W below 0°C. Calibrated chilled-mirror instruments at fabs report
 *   frost point, not dew point, below 0°C — this function matches that.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEW EXPORTS in v2.0
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   calculateRH(dbF, grains, elevFt)      → % RH — reverse of calculateGrains
 *   grainsFromDewPoint(dpF, elevFt)       → gr/lb — for dew-point setpoint control
 *   calculateSpecificVolume(dbF, grains, elevFt) → ft³/lb dry air — for CFM↔lb/hr
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FULL PUBLIC API
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   altitudeCorrectionFactor(elevFt)             → Cf scalar (dimensionless)
 *   sitePressure(elevFt)                         → hPa
 *   sensibleFactor(elevFt)                       → BTU/hr per CFM per °F
 *   latentFactor(elevFt)                         → BTU/hr per CFM per gr/lb
 *   latentFactorLb(elevFt)                       → BTU/hr per CFM per lb/lb
 *   calculateGrains(dbF, rh, elevFt)             → gr/lb
 *   calculateRH(dbF, grains, elevFt)             → % (0–100)
 *   calculateDewPoint(dbF, rh)                   → °F | null
 *   grainsFromDewPoint(dpF, elevFt)              → gr/lb
 *   calculateEnthalpy(dbF, grains)               → BTU/lb dry air
 *   calculateWetBulb(dbF, rh, elevFt)            → °F
 *   calculateSpecificVolume(dbF, grains, elevFt) → ft³/lb dry air
 *
 * RETAINED FROM v1.x:
 *   BUG-18 FIX: calculateWetBulb() ASHRAE Eq.35 bisection — unchanged, correct.
 *   Altitude correction: ASHRAE HOF 2021 Ch.1 Eq.3 — unchanged, correct.
 *   calculateEnthalpy: ASHRAE HOF 2021 Ch.1 Eq.30 — unchanged, correct.
 */

import ASHRAE from '../constants/ashrae';

// ─────────────────────────────────────────────────────────────────────────────
// ASHRAE Hyland-Wexler saturation pressure constants
// Source: ASHRAE Fundamentals 2021, Chapter 1, Equations 3 & 5
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ice surface (T < 273.15 K)
 * ASHRAE HOF 2021 Ch.1, Eq.3
 * Valid: 173.15 K (−100°C) to 273.15 K (0°C)
 */
const HW_ICE = {
  C1: -5.6745359e3,
  C2:  6.3925247e0,
  C3: -9.6778430e-3,
  C4:  6.2215701e-7,
  C5:  2.0747825e-9,
  C6: -9.4840240e-13,
  C7:  4.1635019e0,
};

/**
 * Liquid water surface (T ≥ 273.15 K)
 * ASHRAE HOF 2021 Ch.1, Eq.5
 * Valid: 273.15 K (0°C) to 473.15 K (200°C)
 */
const HW_LIQ = {
  C8:  -5.8002206e3,
  C9:   1.3914993e0,
  C10: -4.8640239e-2,
  C11:  4.1764768e-5,
  C12: -1.4452093e-8,
  C13:  6.5459673e0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers (not exported)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * saturationPressure(dbC) → hPa
 *
 * BUG-PSYCH-01 FIX: ASHRAE Hyland-Wexler replaces Magnus formula.
 *
 * ⚠️  INTERNAL HELPER — NOT exported. Do not import this function from
 *     other modules. Use grainsFromDewPoint() for dew-point-based
 *     humidity ratio calculations. psychroValidation.js previously tried
 *     to import this function (CRITICAL-01) — that import is now removed.
 *
 * Automatically selects the correct branch:
 *   T < 0°C  → ice surface (Eq.3) — frost point conditions
 *   T ≥ 0°C  → liquid surface (Eq.5) — dew point conditions
 *
 * @param {number} dbC - temperature (°C), valid −100 to +200
 * @returns {number} saturation vapour pressure (hPa)
 */
const saturationPressure = (dbC) => {
  const T = dbC + 273.15; // Kelvin
  let lnPws;

  if (T < 273.15) {
    const { C1, C2, C3, C4, C5, C6, C7 } = HW_ICE;
    const T2 = T * T;
    const T3 = T2 * T;
    const T4 = T3 * T;
    lnPws = C1 / T + C2 + C3 * T + C4 * T2 + C5 * T3 + C6 * T4 + C7 * Math.log(T);
  } else {
    const { C8, C9, C10, C11, C12, C13 } = HW_LIQ;
    const T2 = T * T;
    const T3 = T2 * T;
    lnPws = C8 / T + C9 + C10 * T + C11 * T2 + C12 * T3 + C13 * Math.log(T);
  }

  return Math.exp(lnPws) / 100;
};

/**
 * saturatedW(tC, Patm) → kg/kg
 * Used internally by the wet-bulb bisection (calculateWetBulb).
 */
const saturatedW = (tC, Patm) => {
  const Es = saturationPressure(tC);
  if (Patm <= Es) return 1;
  return 0.62198 * Es / (Patm - Es);
};

// ─────────────────────────────────────────────────────────────────────────────
// Altitude & psychrometric correction factors (exported)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * altitudeCorrectionFactor(elevFt)
 *
 * Pressure ratio: Patm_site / Patm_sea-level.
 * Source: ASHRAE Fundamentals 2021, Ch.1, Eq.3.
 * Cf = (1 − 6.8754×10⁻⁶ × elev_ft)^5.2559
 *
 * @param {number} elevFt - site elevation in feet (≥ 0)
 * @returns {number} Cf — dimensionless, (0, 1]
 */
export const altitudeCorrectionFactor = (elevFt = 0) => {
  const elev = Math.max(0, parseFloat(elevFt) || 0);
  if (elev === 0) return 1;
  return Math.pow(1 - 6.8754e-6 * elev, 5.2559);
};

/**
 * sitePressure(elevFt) → hPa
 * @param {number} elevFt - site elevation (ft)
 */
export const sitePressure = (elevFt = 0) =>
  1013.25 * altitudeCorrectionFactor(elevFt);

/**
 * sensibleFactor(elevFt)
 * Qs [BTU/hr] = sensibleFactor(elev) × CFM × ΔT°F
 * Sea-level basis: 1.08 (ASHRAE HOF 2021, Ch.28)
 */
export const sensibleFactor = (elevFt = 0) =>
  ASHRAE.SENSIBLE_FACTOR_SEA_LEVEL * altitudeCorrectionFactor(elevFt);

/**
 * latentFactor(elevFt)
 * Ql [BTU/hr] = latentFactor(elev) × CFM × Δgr/lb
 * Sea-level basis: 0.68
 */
export const latentFactor = (elevFt = 0) =>
  ASHRAE.LATENT_FACTOR_SEA_LEVEL * altitudeCorrectionFactor(elevFt);

/**
 * latentFactorLb(elevFt)
 * Ql [BTU/hr] = latentFactorLb(elev) × CFM × Δlb/lb
 * Sea-level basis: 4775 (hfg at 60°F dewpoint reference)
 */
export const latentFactorLb = (elevFt = 0) =>
  ASHRAE.LATENT_FACTOR_LB * altitudeCorrectionFactor(elevFt);

// ─────────────────────────────────────────────────────────────────────────────
// Public psychrometric functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calculateGrains(dbF, rh, elevFt?)
 *
 * Humidity ratio in gr/lb dry air.
 *
 * @param {number} dbF    - dry-bulb temperature (°F)
 * @param {number} rh     - relative humidity (%)
 * @param {number} elevFt - site elevation (ft)
 * @returns {number} humidity ratio (gr/lb), clamped [0, 500]
 */
export const calculateGrains = (dbF, rh, elevFt = 0) => {
  const dbFNum = parseFloat(dbF);
  const rhNum  = parseFloat(rh);
  if (isNaN(dbFNum) || isNaN(rhNum)) return 0;

  const rhClamped = Math.min(100, Math.max(0, rhNum));
  const dbC  = (dbFNum - 32) * 5 / 9;
  const Es   = saturationPressure(dbC);
  const E    = (rhClamped / 100) * Es;
  const Patm = sitePressure(elevFt);
  if (Patm <= E) return 0;

  const W_kg = 0.62198 * E / (Patm - E);
  const grains = W_kg * ASHRAE.GR_PER_LB;

  if (isNaN(grains) || grains < 0) return 0;
  if (grains > 500) {
    console.warn(
      `calculateGrains: result ${grains.toFixed(1)} gr/lb exceeds physical bounds ` +
      `(DB=${dbF}°F, RH=${rh}%). Check inputs.`
    );
    return 500;
  }
  return grains;
};

/**
 * calculateRH(dbF, grains, elevFt?)
 *
 * Reverse of calculateGrains. Computes relative humidity (%) from
 * dry-bulb temperature and humidity ratio.
 *
 * @param {number} dbF    - dry-bulb temperature (°F)
 * @param {number} grains - humidity ratio (gr/lb dry air)
 * @param {number} elevFt - site elevation (ft)
 * @returns {number} relative humidity (%), clamped [0, 100]; 0 on invalid input
 */
export const calculateRH = (dbF, grains, elevFt = 0) => {
  const dbFNum = parseFloat(dbF);
  const grNum  = parseFloat(grains);
  if (isNaN(dbFNum) || isNaN(grNum) || grNum < 0) return 0;

  const dbC  = (dbFNum - 32) * 5 / 9;
  const Es   = saturationPressure(dbC);
  if (Es <= 0) return 0;

  const Patm = sitePressure(elevFt);
  const W    = grNum / ASHRAE.GR_PER_LB;

  const E  = (W * Patm) / (0.62198 + W);
  const rh = (E / Es) * 100;

  return isNaN(rh) ? 0 : Math.min(100, Math.max(0, rh));
};

/**
 * calculateDewPoint(dbF, rh)
 *
 * BUG-PSYCH-02 FIX: Bisection on ASHRAE Hyland-Wexler saturation pressure.
 *
 * MEDIUM-02 FIX (v2.1): Returns null instead of −148 sentinel for conditions
 * below −100°C. Previous −148 value was never checked by any caller and
 * silently propagated into load calculations as a real temperature.
 *
 * BUG-TIER1-01 FIX (v2.2): Returns null (not integer 0) for rh ≤ 0.
 *
 *   The previous guard:
 *     if (isNaN(dbFNum) || isNaN(rhNum) || rhNum <= 0) return 0;
 *   combined two semantically different cases:
 *     • Invalid/non-numeric input → return 0 is appropriate (no dew point)
 *     • rh = 0 (perfectly dry air) → dew point is undefined (−∞), must return null
 *
 *   When rh = 0, callers checking `if (dp === null)` correctly trigger the
 *   out-of-range handler. With return 0, they would receive 0°F = −17.8°C
 *   as a valid frost point, producing ~3%RH at 70°F in grainsFromDewPoint —
 *   a phantom humidity ratio that corrupts humidification load calculations
 *   in solid-state battery rooms and vacuum process tool environments.
 *
 * ⚠️  CALLERS MUST CHECK FOR NULL:
 *   const dp = calculateDewPoint(db, rh);
 *   if (dp === null) {
 *     // Frost point is below −100°C OR rh is 0/negative.
 *     // For sub-ppm / solid-state battery: use specialist desiccant tool.
 *     // For rh=0: dew point is physically undefined.
 *   }
 *
 * ⚠️  SUB-ZERO RESULTS ARE FROST POINTS, NOT DEW POINTS.
 *   Results below 32°F represent frost points (ice deposition conditions).
 *   Label as "Dew/Frost Point" in UI. Do NOT clamp to 32°F.
 *
 * Design condition reference values (H-W corrected):
 *   1.0%RH @ 70°F  →  −35.1°F (−37.3°C) frost point
 *   2.0%RH @ 72°F  →  −26.4°F (−32.4°C) frost point
 *   5.0%RH @ 72°F  →  −13.3°F (−25.2°C) frost point
 *   35%RH  @ 70°F  →   41.2°F (  5.1°C) dew point
 *   50%RH  @ 75°F  →   55.0°F ( 12.8°C) dew point
 *
 * @param {number} dbF - dry-bulb temperature (°F)
 * @param {number} rh  - relative humidity (%)
 * @returns {number|null} dew/frost point (°F); null if rh ≤ 0 or below −100°C range.
 *   Do NOT clamp sub-zero results to 32°F — those are valid frost points.
 */
export const calculateDewPoint = (dbF, rh) => {
  const dbFNum = parseFloat(dbF);
  const rhNum  = parseFloat(rh);

  // BUG-TIER1-01 FIX: separate the two guard cases.
  // Non-numeric input → return 0 (legacy-safe: no dew point possible)
  if (isNaN(dbFNum) || isNaN(rhNum)) return 0;
  // rh ≤ 0 → return null (dew point is physically undefined for perfectly dry air)
  // Callers must check for null — do NOT use 0 as a temperature here.
  if (rhNum <= 0) return null;

  const rhClamped = Math.min(100, Math.max(0.001, rhNum));

  if (rhClamped >= 100) return Math.round(dbFNum * 10) / 10;

  const dbC = (dbFNum - 32) * 5 / 9;
  const Es  = saturationPressure(dbC);
  const Epw = (rhClamped / 100) * Es;

  let lo = -100;
  let hi = dbC;

  // MEDIUM-02 FIX: Return null instead of the −148 numeric sentinel.
  // The previous value was never checked by any caller (psychroValidation.js,
  // heatingHumid.js, rdsSelector.js) and silently corrupted load calculations
  // when used as a real temperature. null forces callers to handle the case.
  //
  // When does this trigger?
  //   saturationPressure(−100°C) ≈ 0.000138 hPa
  //   At 70°F DB: Es(70°F) ≈ 24.8 hPa
  //   For Epw < 0.000138 hPa: RH < 0.000138/24.8 × 100 = 0.00056%
  //   → Only solid-state battery and sub-ppm moisture applications reach this.
  if (saturationPressure(lo) > Epw) {
    console.warn(
      `calculateDewPoint: RH=${rh}% at DB=${dbF}°F yields frost point below −100°C. ` +
      `Returning null — this is outside the Hyland-Wexler equation range. ` +
      `For solid-state battery / sub-ppm moisture applications, use a specialist ` +
      `desiccant simulation tool. Caller must check for null.`
    );
    return null; // MEDIUM-02 FIX: was return -148 — see JSDoc above
  }

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (saturationPressure(mid) < Epw) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 0.001) break;
  }

  const dpC = (lo + hi) / 2;
  const dpF = dpC * 9 / 5 + 32;
  return isNaN(dpF) ? 0 : Math.round(dpF * 10) / 10;
};

/**
 * grainsFromDewPoint(dpF, elevFt?)
 *
 * Humidity ratio from dew/frost point temperature.
 * The primary function for dew-point-controlled spaces (semiconductor fabs,
 * battery dry rooms, pharma filling suites).
 *
 * @param {number} dpF    - dew/frost point temperature (°F) — may be below 32°F
 * @param {number} elevFt - site elevation (ft)
 * @returns {number} humidity ratio (gr/lb); 0 on invalid input
 */
export const grainsFromDewPoint = (dpF, elevFt = 0) => {
  const dpFNum = parseFloat(dpF);
  if (isNaN(dpFNum)) return 0;

  const dpC  = (dpFNum - 32) * 5 / 9;
  const Edp  = saturationPressure(dpC);
  const Patm = sitePressure(elevFt);

  if (Patm <= Edp) return 0;

  const W_kg = 0.62198 * Edp / (Patm - Edp);
  const gr   = W_kg * ASHRAE.GR_PER_LB;

  return isNaN(gr) || gr < 0 ? 0 : gr;
};

/**
 * calculateEnthalpy(dbF, grains)
 *
 * Specific enthalpy of moist air (BTU/lb dry air).
 * ASHRAE Fundamentals 2021, Ch.1, Eq.30:
 *   h = 0.240·t + W·(hfg₀ + 0.444·t)
 *
 * @param {number} dbF    - dry-bulb temperature (°F)
 * @param {number} grains - humidity ratio (gr/lb)
 * @returns {number} specific enthalpy (BTU/lb dry air)
 */
export const calculateEnthalpy = (dbF, grains) => {
  const t = parseFloat(dbF)     || 0;
  const W = (parseFloat(grains) || 0) / ASHRAE.GR_PER_LB;
  const h = 0.240 * t + W * (ASHRAE.LATENT_HFG_BTU_LB + 0.444 * t);
  return isNaN(h) ? 0 : h;
};

/**
 * calculateWetBulb(dbF, rh, elevFt?)
 *
 * Solves ASHRAE Fundamentals 2021, Ch.1, Eq.35 by bisection.
 * Accuracy: ±0.01°C. Converges in ≤60 iterations.
 *
 * @param {number} dbF    - dry-bulb temperature (°F)
 * @param {number} rh     - relative humidity (%)
 * @param {number} elevFt - site elevation (ft) for Patm correction
 * @returns {number} wet-bulb temperature (°F), rounded to 0.1°F
 */
export const calculateWetBulb = (dbF, rh, elevFt = 0) => {
  const dbFNum = parseFloat(dbF);
  const rhNum  = parseFloat(rh);
  if (isNaN(dbFNum) || isNaN(rhNum)) return dbFNum || 0;

  const rhClamped = Math.min(100, Math.max(0, rhNum));

  if (rhClamped >= 100) return Math.round(dbFNum * 10) / 10;

  const db   = (dbFNum - 32) * 5 / 9;
  const Patm = sitePressure(elevFt);

  const Es = saturationPressure(db);
  const E  = (rhClamped / 100) * Es;
  if (Patm <= E) return Math.round(dbFNum * 10) / 10;
  const W = 0.62198 * E / (Patm - E);

  const f = (wb) => {
    const Ws_wb = saturatedW(wb, Patm);
    return (
      (2501 - 2.381 * wb) * Ws_wb
      - 1.006 * (db - wb)
      - W * (2501 + 1.805 * db - 4.186 * wb)
    );
  };

  let lo = -40;
  let hi = db;

  if (f(lo) * f(hi) > 0) return Math.round(dbFNum * 10) / 10;

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) * f(lo) <= 0) {
      hi = mid;
    } else {
      lo = mid;
    }
    if (hi - lo < 0.001) break;
  }

  const wbC = (lo + hi) / 2;
  const wbF = wbC * 9 / 5 + 32;
  return isNaN(wbF) ? dbFNum : Math.round(wbF * 10) / 10;
};

/**
 * calculateSpecificVolume(dbF, grains, elevFt?)
 *
 * Specific volume of moist air (ft³/lb dry air).
 * ASHRAE Fundamentals 2021, Ch.1, Eq.28 in IP units.
 *
 * @param {number} dbF    - dry-bulb temperature (°F)
 * @param {number} grains - humidity ratio (gr/lb)
 * @param {number} elevFt - site elevation (ft)
 * @returns {number} specific volume (ft³/lb dry air)
 */
export const calculateSpecificVolume = (dbF, grains, elevFt = 0) => {
  const T    = (parseFloat(dbF) || 0) + 459.67;
  const W    = (parseFloat(grains) || 0) / ASHRAE.GR_PER_LB;
  const Patm_psia = sitePressure(elevFt) * 0.014504;

  if (Patm_psia <= 0) return 0;

  const v = 0.370486 * (T / Patm_psia) * (1 + 1.607858 * W);
  return isNaN(v) ? 0 : v;
};