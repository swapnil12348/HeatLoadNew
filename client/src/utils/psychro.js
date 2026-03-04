// src/utils/psychro.js
/**
 * Psychrometric utilities.
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 1
 */

// ── Saturation vapour pressure (hPa) — Magnus formula ────────────────────────
// Alduchov & Eskridge (1996), valid −40°C to +60°C
const saturationPressure = (dbC) =>
  6.112 * Math.exp((17.67 * dbC) / (dbC + 243.5));

// ── Site atmospheric pressure (hPa) — ASHRAE Ch 1, Eq. 3 ────────────────────
const sitePressure = (elevationFt = 0) => {
  const elev = Math.max(0, parseFloat(elevationFt) || 0);
  return elev > 0
    ? 1013.25 * Math.pow(1 - 6.8754e-6 * elev, 5.2559)
    : 1013.25;
};

/**
 * calculateGrains(dbF, rh, elevationFt?)
 * Humidity ratio in gr/lb dry air.
 * Pass elevationFt to correct site Patm — required for indoor grIn in load calcs.
 */
export const calculateGrains = (dbF, rh, elevationFt = 0) => {
  const dbFNum = parseFloat(dbF);
  const rhNum  = parseFloat(rh);
  if (isNaN(dbFNum) || isNaN(rhNum)) return 0;

  const rhClamped = Math.min(100, Math.max(0, rhNum));
  const dbC  = (dbFNum - 32) * 5 / 9;
  const Es   = saturationPressure(dbC);
  const E    = (rhClamped / 100) * Es;
  const Patm = sitePressure(elevationFt);

  if (Patm <= E) return 0;

  const W_kg = 0.62198 * E / (Patm - E);
  const grains = W_kg * 7000;
  return isNaN(grains) || grains < 0 ? 0 : grains;
};

/**
 * calculateDewPoint(dbF, rh)
 * Dew point in °F — Magnus inverse formula.
 * Pressure-independent for practical HVAC temperature ranges.
 */
export const calculateDewPoint = (dbF, rh) => {
  const dbFNum = parseFloat(dbF);
  const rhNum  = parseFloat(rh);
  if (isNaN(dbFNum) || isNaN(rhNum) || rhNum <= 0) return 0;

  const rhClamped = Math.min(100, Math.max(0.01, rhNum));
  const dbC   = (dbFNum - 32) * 5 / 9;
  const gamma = Math.log(rhClamped / 100) + (17.67 * dbC) / (dbC + 243.5);

  if (17.67 - gamma <= 0) return dbFNum;

  const dpC = 243.5 * gamma / (17.67 - gamma);
  const dpF = dpC * 9 / 5 + 32;
  return isNaN(dpF) ? 0 : Math.round(dpF * 10) / 10;
};

/**
 * calculateEnthalpy(dbF, grains)
 * Specific enthalpy of moist air in BTU/lb dry air.
 * ASHRAE Fundamentals Ch 1, Eq. 30:
 *   h = 0.240 × t + W × (1061 + 0.444 × t)
 *   where t = °F, W = humidity ratio lb/lb (= grains / 7000)
 */
export const calculateEnthalpy = (dbF, grains) => {
  const t = parseFloat(dbF)     || 0;
  const W = (parseFloat(grains) || 0) / 7000;
  const h = 0.240 * t + W * (1061 + 0.444 * t);
  return isNaN(h) ? 0 : h;
};

/**
 * calculateWetBulb(dbF, rh)
 * Wet-bulb temperature in °F.
 * Stull (2011) empirical approximation — accuracy ±0.65°C.
 * Valid range: RH 5–99%, T −20°C to +50°C (covers all HVAC design conditions).
 *
 * Reference: Stull, R. 2011. "Wet-Bulb Temperature from Relative Humidity
 * and Air Temperature." J. Applied Meteorology and Climatology 50:2267–2269.
 */
export const calculateWetBulb = (dbF, rh) => {
  const dbFNum = parseFloat(dbF);
  const rhNum  = parseFloat(rh);
  if (isNaN(dbFNum) || isNaN(rhNum)) return dbFNum || 0;

  const T  = (dbFNum - 32) * 5 / 9;                        // °C
  const RH = Math.min(99, Math.max(5, rhNum));

  const WB_C =
    T  * Math.atan(0.151977 * Math.pow(RH + 8.313659, 0.5))
    + Math.atan(T + RH)
    - Math.atan(RH - 1.676331)
    + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH)
    - 4.686035;

  const WB_F = WB_C * 9 / 5 + 32;
  return isNaN(WB_F) ? dbFNum : Math.round(WB_F * 10) / 10;
};