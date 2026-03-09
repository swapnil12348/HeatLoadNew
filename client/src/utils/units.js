/**
 * units.js
 * Responsibility: Unit conversion helpers used across the entire codebase.
 *
 * All functions are pure — no side effects, no imports.
 * Organised by conversion family so callers can import only what they need.
 *
 * Duplication audit — these conversions were previously scattered across:
 *   rdsSelector.js      — M2_TO_FT2, M3_TO_FT3 inline constants
 *   heatingHumid.js     — BTU/kW inline
 *   airQuantities.js    — CFM/m³ inline
 *   AHUConfig.jsx       — M2_TO_FT2 inline constant
 *   ResultsPage.jsx     — M2_TO_FT2 inline constant
 *   RDSPage.jsx         — no conversion (was displaying wrong unit)
 *
 * After this file: all of the above import from here instead.
 *
 * ── NAMING CONVENTION ─────────────────────────────────────────────────────────
 *
 *   xToY(value)   — converts a single value from unit X to unit Y
 *   xFromY(value) — inverse of xToY (alias pattern)
 *
 *   Constants exported as SCREAMING_SNAKE_CASE for non-function contexts
 *   (e.g. column widths, display strings, table lookups).
 *
 * ── INPUT GUARD PATTERN ───────────────────────────────────────────────────────
 *
 *   FIX MED-01: Temperature (and other signed) conversions use an explicit
 *   NaN/null guard rather than `|| 0`.
 *
 *   The `|| 0` pattern silently substitutes 0 for invalid input. For
 *   temperature this produces a physically meaningful but wrong result:
 *     fToC(null) → (0 − 32) × 5/9 = −17.78°C  ← wrong, not NaN
 *
 *   Conversions that have a meaningful zero (airflow, area, power) keep
 *   `parseFloat(x) || 0` because 0 is a safe default for those units.
 *   Conversions where 0 is a meaningful design value (temperature) use
 *   the guard below and return null for invalid input.
 *
 *   const safeTemp = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
 */

// ══════════════════════════════════════════════════════════════════════════════
// INTERNAL GUARD HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/** Safe parse for values where 0 is a valid meaningful result (area, flow, power). */
const num = (v) => parseFloat(v) || 0;

/**
 * Safe parse for signed values where invalid input must NOT default to 0.
 * Returns null for NaN/undefined/null input so callers can detect bad data.
 * Used for temperature conversions.
 */
const numOrNull = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

// ══════════════════════════════════════════════════════════════════════════════
// AREA
// ══════════════════════════════════════════════════════════════════════════════

/** 1 m² = 10.7639 ft² (exact per NIST) */
export const M2_TO_FT2 = 10.7639;

/** @param {number} m2   @returns {number} ft² */
export const m2ToFt2 = (m2) => num(m2) * M2_TO_FT2;

/** @param {number} ft2  @returns {number} m² */
export const ft2ToM2 = (ft2) => num(ft2) / M2_TO_FT2;

// ══════════════════════════════════════════════════════════════════════════════
// VOLUME
// ══════════════════════════════════════════════════════════════════════════════

/** 1 m³ = 35.3147 ft³ */
export const M3_TO_FT3 = 35.3147;

/** @param {number} m3   @returns {number} ft³ */
export const m3ToFt3 = (m3) => num(m3) * M3_TO_FT3;

/** @param {number} ft3  @returns {number} m³ */
export const ft3ToM3 = (ft3) => num(ft3) / M3_TO_FT3;

// ══════════════════════════════════════════════════════════════════════════════
// TEMPERATURE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * cToF(celsius)
 * FIX MED-01: uses numOrNull guard — returns null for invalid input.
 * Callers should check for null before using result in calculations.
 *
 * @param {number} celsius
 * @returns {number|null} fahrenheit, or null if input is invalid
 */
export const cToF = (celsius) => {
  const c = numOrNull(celsius);
  return c === null ? null : c * 9 / 5 + 32;
};

/**
 * fToC(fahrenheit)
 * FIX MED-01: uses numOrNull guard — returns null for invalid input.
 *
 * @param {number} fahrenheit
 * @returns {number|null} celsius, or null if input is invalid
 */
export const fToC = (fahrenheit) => {
  const f = numOrNull(fahrenheit);
  return f === null ? null : (f - 32) * 5 / 9;
};

// ══════════════════════════════════════════════════════════════════════════════
// ENERGY / POWER
// ══════════════════════════════════════════════════════════════════════════════

/** 1 W = 3.41214 BTU/hr (NIST exact) */
export const W_TO_BTU_HR  = 3.41214;
export const BTU_HR_TO_W  = 1 / W_TO_BTU_HR;

/** @param {number} w      @returns {number} BTU/hr */
export const wToBtuHr  = (w)      => num(w)      * W_TO_BTU_HR;

/** @param {number} btuHr  @returns {number} W */
export const btuHrToW  = (btuHr)  => num(btuHr)  * BTU_HR_TO_W;

/** W/ft² → BTU/hr·ft² (same scalar as W → BTU/hr, area cancels) */
export const wPerFt2ToBtuHrFt2 = (wPerFt2) => num(wPerFt2) * W_TO_BTU_HR;

/** 1 kW = 3412.14 BTU/hr */
export const KW_TO_BTU_HR = 3412.14;
export const BTU_HR_TO_KW = 1 / KW_TO_BTU_HR;

/** @param {number} kw     @returns {number} BTU/hr */
export const kwToBtuHr = (kw)     => num(kw)     * KW_TO_BTU_HR;

/** @param {number} btuHr  @returns {number} kW */
export const btuHrToKw = (btuHr)  => num(btuHr)  * BTU_HR_TO_KW;

/** 1 ton of refrigeration = 12,000 BTU/hr */
export const BTU_PER_TON  = 12000;
// FIX LOW-01: constants are now used by the functions below (previously hardcoded 12000)
export const BTU_HR_TO_TR = 1 / BTU_PER_TON;
export const TR_TO_BTU_HR = BTU_PER_TON;

/** @param {number} btuHr  @returns {number} TR */
export const btuHrToTr = (btuHr) => num(btuHr) * BTU_HR_TO_TR;

/** @param {number} tr     @returns {number} BTU/hr */
export const trToBtuHr = (tr)    => num(tr)    * TR_TO_BTU_HR;

/** @param {number} kw     @returns {number} TR */
export const kwToTr = (kw) => btuHrToTr(kwToBtuHr(kw));

/** @param {number} tr     @returns {number} kW */
export const trToKw = (tr) => btuHrToKw(trToBtuHr(tr));

/** 1 MBH = 1000 BTU/hr */
export const BTU_HR_TO_MBH = 1 / 1000;

/** @param {number} btuHr  @returns {number} MBH (kBTU/hr) */
export const btuHrToMbh = (btuHr) => num(btuHr) / 1000;

// ══════════════════════════════════════════════════════════════════════════════
// HUMIDITY
// ══════════════════════════════════════════════════════════════════════════════

/** 7000 grains = 1 lb water vapour */
export const GR_PER_LB = 7000;

/**
 * grToLb(grains)
 * Converts humidity ratio from gr/lb to lb/lb.
 * Used in latent load calculations with latentFactorLb().
 *
 * @param {number} grains - humidity ratio (gr/lb)
 * @returns {number} humidity ratio (lb/lb)
 */
export const grToLb = (grains) => num(grains) / GR_PER_LB;

/**
 * lbToGr(lb)
 * Converts humidity ratio from lb/lb to gr/lb.
 *
 * @param {number} lb - humidity ratio (lb/lb)
 * @returns {number} humidity ratio (gr/lb)
 */
export const lbToGr = (lb) => num(lb) * GR_PER_LB;

// ══════════════════════════════════════════════════════════════════════════════
// AIRFLOW
// ══════════════════════════════════════════════════════════════════════════════

/** 1 m³/s = 2118.88 CFM */
export const M3S_TO_CFM = 2118.88;

/** @param {number} m3s  @returns {number} CFM */
export const m3sToCfm = (m3s) => num(m3s) * M3S_TO_CFM;

/** @param {number} cfm  @returns {number} m³/s */
export const cfmToM3s = (cfm) => num(cfm) / M3S_TO_CFM;

/** 1 L/s = 2.11888 CFM */
export const LS_TO_CFM = 2.11888;

/** @param {number} ls   @returns {number} CFM */
export const lsToCfm = (ls)  => num(ls)  * LS_TO_CFM;

/** @param {number} cfm  @returns {number} L/s */
export const cfmToLs = (cfm) => num(cfm) / LS_TO_CFM;

// ══════════════════════════════════════════════════════════════════════════════
// PRESSURE
// ══════════════════════════════════════════════════════════════════════════════

/** 1 inHg = 3386.39 Pa */
export const IN_HG_TO_PA = 3386.39;

/** @param {number} inHg  @returns {number} Pa */
export const inHgToPa = (inHg) => num(inHg) * IN_HG_TO_PA;

/** @param {number} pa    @returns {number} inHg */
export const paToInHg = (pa)   => num(pa)   / IN_HG_TO_PA;

/** 1 inWG (in. water gauge) = 249.089 Pa */
export const IN_WG_TO_PA = 249.089;

/** @param {number} inWg  @returns {number} Pa */
export const inWgToPa = (inWg) => num(inWg) * IN_WG_TO_PA;

/** @param {number} pa    @returns {number} inWG */
export const paToInWg = (pa)   => num(pa)   / IN_WG_TO_PA;

// ══════════════════════════════════════════════════════════════════════════════
// MASS FLOW / PIPE SIZING
// ══════════════════════════════════════════════════════════════════════════════

/** 1 GPM = 3.78541 L/min */
export const GPM_TO_LPM = 3.78541;

/** @param {number} gpm  @returns {number} L/min */
export const gpmToLpm = (gpm) => num(gpm) * GPM_TO_LPM;

/** @param {number} lpm  @returns {number} GPM */
export const lpmToGpm = (lpm) => num(lpm) / GPM_TO_LPM;

// ══════════════════════════════════════════════════════════════════════════════
// LENGTH
// ══════════════════════════════════════════════════════════════════════════════

/** 1 ft = 304.8 mm */
export const FT_TO_MM = 304.8;

/** @param {number} ft    @returns {number} mm */
export const ftToMm = (ft)   => num(ft)   * FT_TO_MM;

/** @param {number} mm    @returns {number} ft */
export const mmToFt = (mm)   => num(mm)   / FT_TO_MM;

/** @param {number} inch  @returns {number} mm */
export const inchToMm = (inch) => num(inch) * 25.4;

/** @param {number} mm    @returns {number} inches */
export const mmToInch = (mm)   => num(mm)   / 25.4;

// ══════════════════════════════════════════════════════════════════════════════
// DISPLAY FORMATTERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * formatArea(m2, dp?)
 * Converts m² to ft² and returns a display string.
 *
 * @param {number} m2    - area in m²
 * @param {number} [dp=0] - decimal places
 * @returns {string} e.g. "322 ft²"
 */
export const formatArea = (m2, dp = 0) =>
  `${m2ToFt2(m2).toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })} ft²`;

/**
 * formatTR(btuHr)
 * BTU/hr → TR, 2 decimal places.
 *
 * @param {number} btuHr
 * @returns {string} e.g. "12.50 TR"
 */
export const formatTR = (btuHr) =>
  `${btuHrToTr(btuHr).toFixed(2)} TR`;

/**
 * formatKW(btuHr)
 * BTU/hr → kW, 2 decimal places.
 *
 * @param {number} btuHr
 * @returns {string} e.g. "3.66 kW"
 */
export const formatKW = (btuHr) =>
  `${btuHrToKw(btuHr).toFixed(2)} kW`;

/**
 * checkFigure(totalAreaM2, totalTR)
 * Computes ft²/TR — standard HVAC sanity check for load density.
 *
 * Typical benchmarks:
 *   Semiconductor fab:    20–50 ft²/TR  (very high process load density)
 *   Pharma cleanroom:     50–150 ft²/TR
 *   General commercial:   250–400 ft²/TR
 *   Data centre:          10–30 ft²/TR
 * Source: ASHRAE HVAC Applications 2019, Ch.18 / industry benchmarks.
 *
 * @param {number} totalAreaM2 - total conditioned floor area (m²)
 * @param {number} totalTR     - total cooling capacity (TR)
 * @returns {number} ft²/TR, rounded to 1 decimal place; 0 if totalTR ≤ 0
 */
export const checkFigure = (totalAreaM2, totalTR) => {
  if (!totalTR || totalTR <= 0) return 0;
  return parseFloat((m2ToFt2(totalAreaM2) / totalTR).toFixed(1));
};