/**
 * psychro.js
 * Psychrometric utilities.
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 1
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   BUG-TIER1-01 FIX — calculateDewPoint returns null for rh ≤ 0.
 *
 *     The previous guard combined two semantically different cases:
 *       if (isNaN(dbFNum) || isNaN(rhNum) || rhNum <= 0) return 0;
 *
 *     Non-numeric input → return 0 is correct (no dew point possible).
 *     rh = 0 (perfectly dry air) → dew point is physically undefined (−∞),
 *     must return null so callers can handle it explicitly.
 *
 *     With return 0, callers checking `if (dp === null)` never triggered, and
 *     0°F (−17.8°C) propagated as a valid frost point. At 70°F DB, a 0°F
 *     frost point implies ~3%RH — a phantom humidity ratio that corrupted
 *     humidification loads in solid-state battery rooms and vacuum process
 *     environments where the engineer sets RH = 0 as a dry reference.
 *
 *     Fix: separate the two guards.
 *       isNaN(input) → return 0   (no dew point possible)
 *       rhNum ≤ 0    → return null (dew point physically undefined)
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   MEDIUM-02 FIX — calculateDewPoint returns null instead of −148 sentinel.
 *
 *     The previous sentinel value was never checked by any caller (psychroValidation,
 *     heatingHumid, rdsSelector) and silently propagated into load calculations
 *     as a real temperature. null forces callers to handle the out-of-range case.
 *
 *     Callers must check:
 *       const dp = calculateDewPoint(db, rh);
 *       if (dp === null) { ... handle out-of-range ... }
 *
 *     This only triggers below −100°C frost point (RH < 0.00056% at 70°F DB) —
 *     solid-state battery and sub-ppm moisture applications only.
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-PSYCH-01 [CRITICAL] — Magnus formula replaced with ASHRAE Hyland-Wexler.
 *
 *     Old: Magnus (Alduchov & Eskridge 1996) — valid to −40°C, ±0.28 hPa at −37°C.
 *     New: ASHRAE HOF 2021 Ch.1, Eq.3 (ice) & Eq.5 (liquid) — valid −100°C to +200°C,
 *          error < 0.001% across full range.
 *
 *     Why this matters at 1%RH: dew point ≈ −37°C. Magnus error at this point
 *     propagates ±10–15% into humidification capacity sizing — non-acceptable for
 *     Li-ion cell assembly, TSMC lithography bays, and pharma dry powder filling.
 *
 *   BUG-PSYCH-02 — calculateDewPoint analytical Magnus inverse replaced with
 *     bisection on Hyland-Wexler curve. Previous formula was wrong below −30°C
 *     — exactly the range critical for sub-1%RH critical facilities.
 *
 * ── PUBLIC API ─────────────────────────────────────────────────────────────────
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
 *   calculateAdpFromLoads(dbInF, peakErsh, supplyAir, bf, elevFt?) → °F ADP
 *     ⚠️  Cooling-coil systems ONLY — do not use for desiccant dry rooms.
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
 * ⚠️  INTERNAL — NOT exported. Other modules must not import this directly.
 *
 * Selects the correct Hyland-Wexler branch automatically:
 *   T < 0°C  → ice surface (Eq.3) — frost point conditions
 *   T ≥ 0°C  → liquid surface (Eq.5) — dew point conditions
 *
 * @param {number} dbC - temperature (°C), valid −100 to +200
 * @returns {number} saturation vapour pressure (hPa)
 */
const saturationPressure = (dbC) => {
  const T = dbC + 273.15;
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

  return Math.exp(lnPws) / 100; // Pa → hPa
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
// Altitude & psychrometric correction factors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * altitudeCorrectionFactor(elevFt)
 *
 * Pressure ratio: Patm_site / Patm_sea-level.
 * ASHRAE HOF 2021 Ch.1:  Cf = (1 − 6.8754×10⁻⁶ × elev_ft)^5.2559
 *
 * @param {number} elevFt - site elevation (ft, ≥ 0)
 * @returns {number} Cf — dimensionless, (0, 1]
 */
export const altitudeCorrectionFactor = (elevFt = 0) => {
  const elev = Math.max(0, parseFloat(elevFt) || 0);
  if (elev === 0) return 1;
  return Math.pow(1 - 6.8754e-6 * elev, 5.2559);
};

/**
 * sitePressure(elevFt) → hPa
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
 * Sea-level basis: 4775 (hfg at 60°F dew-point reference)
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
 * W = 0.62198 × E / (Patm − E)   where E = (rh/100) × Es
 * ASHRAE HOF 2021 Ch.1, Eq.20 (SI) adapted to IP with site pressure correction.
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
 * Reverse of calculateGrains — computes relative humidity (%) from
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
  const E    = (W * Patm) / (0.62198 + W);
  const rh   = (E / Es) * 100;

  return isNaN(rh) ? 0 : Math.min(100, Math.max(0, rh));
};

/**
 * calculateDewPoint(dbF, rh)
 *
 * Dew/frost point by bisection on ASHRAE Hyland-Wexler saturation pressure.
 * Results below 32°F are frost points (ice deposition conditions) — do NOT
 * clamp to 32°F. Label as "Dew/Frost Point" in UI.
 *
 * ⚠️  CALLERS MUST CHECK FOR NULL:
 *   const dp = calculateDewPoint(db, rh);
 *   if (dp === null) {
 *     // rh ≤ 0 (dew point undefined) OR frost point below −100°C.
 *     // For sub-ppm / solid-state battery: use specialist desiccant tool.
 *   }
 *
 * Returns null for:
 *   • rh ≤ 0  — dew point is physically undefined for perfectly dry air
 *   • frost point below −100°C — outside H-W equation range
 *     (only triggers at RH < 0.00056% at 70°F — solid-state battery / sub-ppm only)
 *
 * Reference values (H-W corrected):
 *   1.0%RH @ 70°F  →  −35.1°F (−37.3°C) frost point
 *   2.0%RH @ 72°F  →  −26.4°F (−32.4°C) frost point
 *   5.0%RH @ 72°F  →  −13.3°F (−25.2°C) frost point
 *   35%RH  @ 70°F  →   41.2°F  ( 5.1°C) dew point
 *   50%RH  @ 75°F  →   55.0°F  (12.8°C) dew point
 *
 * @param {number} dbF - dry-bulb temperature (°F)
 * @param {number} rh  - relative humidity (%)
 * @returns {number|null} dew/frost point (°F) or null
 */
export const calculateDewPoint = (dbF, rh) => {
  const dbFNum = parseFloat(dbF);
  const rhNum  = parseFloat(rh);

  // Non-numeric input → 0 (no dew point possible)
  if (isNaN(dbFNum) || isNaN(rhNum)) return 0;
  // rh ≤ 0 → null (dew point physically undefined for dry air)
  if (rhNum <= 0) return null;

  const rhClamped = Math.min(100, Math.max(0.001, rhNum));
  if (rhClamped >= 100) return Math.round(dbFNum * 10) / 10;

  const dbC = (dbFNum - 32) * 5 / 9;
  const Es  = saturationPressure(dbC);
  const Epw = (rhClamped / 100) * Es;

  let lo = -100;
  let hi = dbC;

  // Below −100°C: outside H-W range — return null.
  // Only triggered at sub-ppm moisture levels (solid-state battery, vacuum tools).
  if (saturationPressure(lo) > Epw) {
    console.warn(
      `calculateDewPoint: RH=${rh}% at DB=${dbF}°F yields frost point below −100°C. ` +
      `Returning null — outside Hyland-Wexler range. ` +
      `For solid-state battery / sub-ppm moisture, use a specialist desiccant tool.`
    );
    return null;
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
 * Primary function for dew-point-controlled spaces (semiconductor fabs,
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
 * ASHRAE HOF 2021 Ch.1, Eq.30 (IP):
 *   h = 0.240·t + W·(hfg₀ + 0.444·t)
 *   where hfg₀ = 1061 BTU/lb (latent heat of vaporisation at 32°F)
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
 * Solves ASHRAE HOF 2021 Ch.1, Eq.35 by bisection (SI coefficients, kg system).
 * Accuracy: ±0.01°C. Converges in ≤60 iterations.
 *
 * Equation: (2501 − 2.381·wb)·Ws_wb − 1.006·(db − wb) − W·(2501 + 1.805·db − 4.186·wb) = 0
 * All temperatures in °C; W in kg/kg. Result converted to °F on return.
 *
 * @param {number} dbF    - dry-bulb temperature (°F)
 * @param {number} rh     - relative humidity (%)
 * @param {number} elevFt - site elevation (ft)
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
 * ASHRAE HOF 2021 Ch.1, Eq.28 (IP):
 *   v = 0.370486 × T_R / Patm_psia × (1 + 1.607858·W)
 *   T_R = dbF + 459.67 (Rankine);  1 hPa = 0.014504 psi
 *
 * @param {number} dbF    - dry-bulb temperature (°F)
 * @param {number} grains - humidity ratio (gr/lb)
 * @param {number} elevFt - site elevation (ft)
 * @returns {number} specific volume (ft³/lb dry air)
 */
export const calculateSpecificVolume = (dbF, grains, elevFt = 0) => {
  const T         = (parseFloat(dbF)    || 0) + 459.67;
  const W         = (parseFloat(grains) || 0) / ASHRAE.GR_PER_LB;
  const Patm_psia = sitePressure(elevFt) * 0.014504;
  if (Patm_psia <= 0) return 0;

  const v = 0.370486 * (T / Patm_psia) * (1 + 1.607858 * W);
  return isNaN(v) ? 0 : v;
};

// ─────────────────────────────────────────────────────────────────────────────
// ADP back-calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calculateAdpFromLoads(dbInF, peakErsh, supplyAir, bf, elevFt?)
 *
 * Back-calculates the Apparatus Dew Point (ADP) from room sensible load.
 * ASHRAE HOF 2021, Ch.18 — ADP-bypass model:
 *
 *   Qs = Cs × supplyAir × ΔT_supply
 *   ΔT_supply = (T_room − T_ADP) × (1 − BF)   [ADP-bypass blend]
 *   ∴ T_ADP = T_room − Qs / (Cs × coilAir)
 *   where coilAir = supplyAir × (1 − BF)
 *
 * Physical constraints:
 *   Lower bound 35°F — minimum achievable CHW coil leaving air temp.
 *   Upper bound dbInF − 2°F — ADP must be meaningfully below room DB.
 *
 * ⚠️  COOLING-COIL CONCEPT ONLY.
 *   Do NOT use for desiccant dry rooms (battery Li-ion, sub-10%RH pharma).
 *   For those systems ADP has no physical meaning — dehumidification is
 *   achieved by adsorption, not coil condensation.
 *
 * @param {number} dbInF     - room design dry-bulb (°F)
 * @param {number} peakErsh  - peak effective room sensible heat (BTU/hr)
 * @param {number} supplyAir - total supply air CFM
 * @param {number} bf        - bypass factor (0–1)
 * @param {number} elevFt    - site elevation (ft)
 * @returns {number} ADP (°F), clamped [35, dbInF−2].
 *   Returns ASHRAE.DEFAULT_ADP on invalid inputs, zero load, or zero coilAir.
 */
export const calculateAdpFromLoads = (
  dbInF,
  peakErsh,
  supplyAir,
  bf,
  elevFt = 0,
) => {
  const dbNum = parseFloat(dbInF);
  const ersh  = parseFloat(peakErsh);
  const cfm   = parseFloat(supplyAir);
  const bfNum = parseFloat(bf);

  if (isNaN(dbNum) || isNaN(ersh) || isNaN(cfm) || isNaN(bfNum)) {
    return ASHRAE.DEFAULT_ADP;
  }
  if (ersh <= 0 || cfm <= 0) return ASHRAE.DEFAULT_ADP;

  const coilAir = cfm * (1 - Math.min(0.99, Math.max(0, bfNum)));
  if (coilAir <= 0) return ASHRAE.DEFAULT_ADP;

  const Cs = ASHRAE.SENSIBLE_FACTOR_SEA_LEVEL * altitudeCorrectionFactor(elevFt);
  if (Cs <= 0) return ASHRAE.DEFAULT_ADP;

  const adpRaw     = dbNum - ersh / (Cs * coilAir);
  const adpClamped = Math.max(35, Math.min(adpRaw, dbNum - 2));
  return Math.round(adpClamped * 10) / 10;
};

// This is the addition to append to psychro.js
// After calculateAdpFromLoads, before the end of the file

// ─────────────────────────────────────────────────────────────────────────────
// Required ADP from ESHF line
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calculateRequiredADP(roomDB, roomGr, totalSensible, totalLatent, elevFt?)
 *
 * Finds the Required ADP — the coil surface temperature the room
 * thermodynamically demands to control BOTH temperature AND humidity
 * simultaneously. Derived from the Effective Sensible Heat Factor (ESHF)
 * line on the psychrometric chart.
 *
 * ASHRAE HOF 2021 Ch.18 — ESHF method:
 *
 *   ESHF = totalSensible / (totalSensible + totalLatent)
 *
 *   The ESHF line is drawn from the room condition point through the
 *   saturation curve. The intersection with the saturation curve is the
 *   Required ADP.
 *
 *   At the Required ADP, the coil's sensible/total ratio exactly matches
 *   the room's load ratio:
 *
 *     Cs × (roomDB − adp)
 *     ─────────────────────────────────────────────── = ESHF
 *     Cs × (roomDB − adp) + Cl × (roomGr − satGr(adp))
 *
 *   Bisection solves for adp in range [32°F, roomDewPoint].
 *
 * ── UPPER BOUND = ROOM DEW POINT ─────────────────────────────────────────────
 *
 *   Above the room dew point, satGr(adp) > roomGr — the coil surface holds
 *   more moisture than the room air. The coil would add humidity, not remove
 *   it. This is non-physical. The valid ADP range is [32°F, roomDewPoint].
 *
 * ── THREE OUTCOMES ────────────────────────────────────────────────────────────
 *
 *   'found'         → bisection succeeded. requiredADP is the coil surface
 *                     temperature needed. Compare with plantADP:
 *                       plantADP > requiredADP → plant too warm, humidity risk
 *                       plantADP ≤ requiredADP → plant sufficient
 *
 *   'sensible_only' → Required ADP < 32°F OR ESHF ≥ 99.5% OR room dew point
 *                     below freezing. Room is so sensible-dominated (or so dry)
 *                     that any standard CHW coil can handle the humidity.
 *                     Plant ADP is not a limiting constraint for this room.
 *
 *   'no_solution'   → ESHF line does not intersect the saturation curve.
 *                     Standard cooling coil cannot simultaneously control both
 *                     temperature AND humidity at ANY coil temperature.
 *                     Supplemental dehumidification required (desiccant wheel,
 *                     separate dehumidifier, or pre-cooling + reheat).
 *                     This is the most dangerous silent failure — currently
 *                     undetected by load calculations that only check TR.
 *
 * ── INPUTS ────────────────────────────────────────────────────────────────────
 *
 *   totalSensible = room ERSH + OA sensible load (peakCoolingSeason)
 *   totalLatent   = room ERLH + OA latent load   (peakCoolingSeason)
 *   roomGr        = indoor humidity ratio from seasonalLoads (gr/lb)
 *                   Use peakCalcs.grIn from rdsSelector.
 *
 * ⚠️  COOLING-COIL CONCEPT ONLY.
 *   Not applicable for desiccant dry rooms (battery Li-ion, sub-10%RH pharma).
 *   For those systems the dehumidification mechanism is adsorption, not
 *   coil condensation. ESHF analysis has no meaning for desiccant systems.
 *
 * @param {number} roomDB        - room design dry-bulb (°F)
 * @param {number} roomGr        - room indoor humidity ratio (gr/lb)
 * @param {number} totalSensible - total sensible load incl. OA (BTU/hr)
 * @param {number} totalLatent   - total latent load incl. OA (BTU/hr)
 * @param {number} elevFt        - site elevation (ft)
 *
 * @returns {{
 *   type:        'found' | 'sensible_only' | 'no_solution',
 *   requiredADP: number | null,   — °F when type='found'; null otherwise
 *   eshf:        number,          — effective sensible heat factor (0–1)
 *   note:        string,          — human-readable explanation
 * }}
 */
export const calculateRequiredADP = (
  roomDB,
  roomGr,
  totalSensible,
  totalLatent,
  elevFt = 0,
) => {
  const dbNum   = parseFloat(roomDB);
  const grNum   = parseFloat(roomGr);
  const sensNum = parseFloat(totalSensible);
  const latNum  = parseFloat(totalLatent);

  // Input guards
  if (isNaN(dbNum) || isNaN(grNum) || isNaN(sensNum) || isNaN(latNum)) {
    return { type: 'sensible_only', requiredADP: null, eshf: 1,
             note: 'Invalid inputs — cannot compute Required ADP' };
  }

  const totalLoad = sensNum + latNum;
  if (totalLoad <= 0) {
    return { type: 'sensible_only', requiredADP: null, eshf: 1,
             note: 'Zero total load — ADP not applicable' };
  }

  const eshf = sensNum / totalLoad;

  // Guard: negligible latent load — pure sensible room
  if (eshf >= 0.995) {
    return { type: 'sensible_only', requiredADP: null, eshf,
             note: 'ESHF ≥ 99.5% — negligible latent load, any CHW coil controls humidity' };
  }

  // Site-pressure-corrected saturation grains helper
  // Uses the internal saturationPressure (Hyland-Wexler) already in scope
  const Patm = sitePressure(elevFt);
  const satGr = (tF) => {
    const tC = (tF - 32) * 5 / 9;
    const Es = saturationPressure(tC);
    if (Patm <= Es) return 500;
    return Math.max(0, 0.62198 * Es / (Patm - Es) * ASHRAE.GR_PER_LB);
  };

  // Guard: room so dry that coil at 32°F cannot dehumidify further
  // (room humidity ratio at or below saturation at freezing)
  if (grNum <= satGr(32)) {
    return { type: 'sensible_only', requiredADP: null, eshf,
             note: 'Room dew point ≤ 32°F — coil sensible-only, any standard CHW plant works' };
  }

  // Find room dew point — upper bound for bisection
  // Above room dew point: satGr(adp) > roomGr → coil adds moisture → non-physical
  let dpLo = -100 * 9/5 + 32; // −148°F
  let dpHi = dbNum;
  for (let i = 0; i < 80; i++) {
    const mid = (dpLo + dpHi) / 2;
    if (satGr(mid) < grNum) dpLo = mid; else dpHi = mid;
    if (dpHi - dpLo < 0.01) break;
  }
  const roomDewPointF = (dpLo + dpHi) / 2;
  const upperBound    = roomDewPointF - 0.5; // stay below dew point

  // ESHF bisection target function
  // f(adp) = computedESHF(adp) − targetESHF
  // computedESHF = Cs*(roomDB−adp) / [Cs*(roomDB−adp) + Cl*(roomGr−satGr(adp))]
  const Cs = ASHRAE.SENSIBLE_FACTOR_SEA_LEVEL * altitudeCorrectionFactor(elevFt);
  const Cl = ASHRAE.LATENT_FACTOR_SEA_LEVEL   * altitudeCorrectionFactor(elevFt);

  const f = (adp) => {
    const sens  = Cs * (dbNum - adp);
    const lat   = Cl * (grNum - satGr(adp));
    const total = sens + lat;
    if (total <= 0) return 1.0; // outside valid range
    return (sens / total) - eshf;
  };

  const f_lo = f(32);
  const f_hi = f(upperBound);

  // No sign change in [32°F, roomDewPoint]
  if (f_lo * f_hi > 0) {
    if (f_lo >= 0) {
      // computedESHF ≥ target at 32°F — coil always more sensible than load requires
      // Required ADP is below 32°F — not achievable with standard CHW
      return { type: 'sensible_only', requiredADP: null, eshf,
               note: 'Required ADP < 32°F — room is sensible-dominated, any standard coil works' };
    } else {
      // computedESHF < target even at room dew point — latent load too high
      // ESHF line does not intersect the saturation curve
      return { type: 'no_solution', requiredADP: null, eshf,
               note: 'Latent load exceeds coil capacity — standard cooling coil cannot control humidity. Supplemental dehumidification required (desiccant, separate dehumidifier, or pre-cooling + reheat).' };
    }
  }

  // Normal case: bisect [32°F, roomDewPoint]
  let lo = 32, hi = upperBound;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid;
    if (hi - lo < 0.01) break;
  }

  const requiredADP = Math.round(((lo + hi) / 2) * 10) / 10;

  return {
    type: 'found',
    requiredADP,
    eshf,
    note: '',
  };
};