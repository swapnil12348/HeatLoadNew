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
 *   RDSPage.jsx         — no conversion — was displaying wrong unit
 *
 * After this file: all of the above import from here instead.
 *
 * ── NAMING CONVENTION ─────────────────────────────────────────────────────────
 *
 *   xToY(value)  — converts a single value from unit X to unit Y
 *   xFromY(value)— inverse of xToY
 *
 *   All constants exported as SCREAMING_SNAKE_CASE for use in
 *   non-function contexts (e.g. column width calculations, display strings).
 */

// ══════════════════════════════════════════════════════════════════════════════
// AREA
// ══════════════════════════════════════════════════════════════════════════════



/** 1 m² = 10.7639 ft² */
export const M2_TO_FT2 = 10.7639;

/** @param {number} m2  @returns {number} ft² */
export const m2ToFt2 = (m2) => (parseFloat(m2) || 0) * M2_TO_FT2;

/** @param {number} ft2  @returns {number} m² */
export const ft2ToM2 = (ft2) => (parseFloat(ft2) || 0) / M2_TO_FT2;

// ══════════════════════════════════════════════════════════════════════════════
// VOLUME
// ══════════════════════════════════════════════════════════════════════════════

/** 1 m³ = 35.3147 ft³ */
export const M3_TO_FT3 = 35.3147;

/** @param {number} m3  @returns {number} ft³ */
export const m3ToFt3 = (m3) => (parseFloat(m3) || 0) * M3_TO_FT3;

/** @param {number} ft3  @returns {number} m³ */
export const ft3ToM3 = (ft3) => (parseFloat(ft3) || 0) / M3_TO_FT3;

// ══════════════════════════════════════════════════════════════════════════════
// TEMPERATURE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @param {number} celsius
 * @returns {number} fahrenheit
 */
export const cToF = (celsius) =>
  (parseFloat(celsius) || 0) * 9 / 5 + 32;

/**
 * @param {number} fahrenheit
 * @returns {number} celsius
 */
export const fToC = (fahrenheit) =>
  ((parseFloat(fahrenheit) || 0) - 32) * 5 / 9;

// ══════════════════════════════════════════════════════════════════════════════
// ENERGY / POWER
// ══════════════════════════════════════════════════════════════════════════════

/** 1 kW = 3412.14 BTU/hr */
export const KW_TO_BTU_HR = 3412.14;

/** 1 BTU/hr = 0.000293071 kW */
export const BTU_HR_TO_KW = 1 / KW_TO_BTU_HR;

/** @param {number} kw  @returns {number} BTU/hr */
export const kwToBtuHr = (kw) => (parseFloat(kw) || 0) * KW_TO_BTU_HR;

/** @param {number} btuHr  @returns {number} kW */
export const btuHrToKw = (btuHr) => (parseFloat(btuHr) || 0) * BTU_HR_TO_KW;

/** 1 ton of refrigeration = 12,000 BTU/hr */
export const BTU_HR_TO_TR = 1 / 12000;

/** @param {number} btuHr  @returns {number} TR (tons of refrigeration) */
export const btuHrToTr = (btuHr) => (parseFloat(btuHr) || 0) / 12000;

/** @param {number} tr  @returns {number} BTU/hr */
export const trToBtuHr = (tr) => (parseFloat(tr) || 0) * 12000;

/** @param {number} kw  @returns {number} TR */
export const kwToTr = (kw) => btuHrToTr(kwToBtuHr(kw));

/** @param {number} tr  @returns {number} kW */
export const trToKw = (tr) => btuHrToKw(trToBtuHr(tr));

/** 1 MBH = 1000 BTU/hr */
export const BTU_HR_TO_MBH = 1 / 1000;

/** @param {number} btuHr  @returns {number} MBH (kBTU/hr) */
export const btuHrToMbh = (btuHr) => (parseFloat(btuHr) || 0) / 1000;

// ══════════════════════════════════════════════════════════════════════════════
// AIRFLOW
// ══════════════════════════════════════════════════════════════════════════════

/** 1 m³/s = 2118.88 CFM */
export const M3S_TO_CFM = 2118.88;

/** @param {number} m3s  @returns {number} CFM */
export const m3sToCfm = (m3s) => (parseFloat(m3s) || 0) * M3S_TO_CFM;

/** @param {number} cfm  @returns {number} m³/s */
export const cfmToM3s = (cfm) => (parseFloat(cfm) || 0) / M3S_TO_CFM;

/** 1 L/s = 2.11888 CFM */
export const LS_TO_CFM = 2.11888;

/** @param {number} ls   @returns {number} CFM */
export const lsToCfm = (ls) => (parseFloat(ls) || 0) * LS_TO_CFM;

/** @param {number} cfm  @returns {number} L/s */
export const cfmToLs = (cfm) => (parseFloat(cfm) || 0) / LS_TO_CFM;

// ══════════════════════════════════════════════════════════════════════════════
// PRESSURE
// ══════════════════════════════════════════════════════════════════════════════

/** 1 inHg = 3386.39 Pa */
export const IN_HG_TO_PA = 3386.39;

/** @param {number} inHg  @returns {number} Pa */
export const inHgToPa = (inHg) => (parseFloat(inHg) || 0) * IN_HG_TO_PA;

/** @param {number} pa    @returns {number} inHg */
export const paToInHg = (pa) => (parseFloat(pa) || 0) / IN_HG_TO_PA;

/** 1 inWG (in. water gauge) = 249.089 Pa */
export const IN_WG_TO_PA = 249.089;

/** @param {number} inWg  @returns {number} Pa */
export const inWgToPa = (inWg) => (parseFloat(inWg) || 0) * IN_WG_TO_PA;

/** @param {number} pa    @returns {number} inWG */
export const paToInWg = (pa) => (parseFloat(pa) || 0) / IN_WG_TO_PA;

// ══════════════════════════════════════════════════════════════════════════════
// MASS FLOW
// ══════════════════════════════════════════════════════════════════════════════

/** 1 GPM = 3.78541 L/min */
export const GPM_TO_LPM = 3.78541;

/** @param {number} gpm  @returns {number} L/min */
export const gpmToLpm = (gpm) => (parseFloat(gpm) || 0) * GPM_TO_LPM;

/** @param {number} lpm  @returns {number} GPM */
export const lpmToGpm = (lpm) => (parseFloat(lpm) || 0) / GPM_TO_LPM;

// ══════════════════════════════════════════════════════════════════════════════
// LENGTH / PIPE SIZING
// ══════════════════════════════════════════════════════════════════════════════

/** 1 ft = 304.8 mm */
export const FT_TO_MM = 304.8;

/** @param {number} ft   @returns {number} mm */
export const ftToMm = (ft) => (parseFloat(ft) || 0) * FT_TO_MM;

/** @param {number} mm   @returns {number} ft */
export const mmToFt = (mm) => (parseFloat(mm) || 0) / FT_TO_MM;

/** @param {number} inch @returns {number} mm */
export const inchToMm = (inch) => (parseFloat(inch) || 0) * 25.4;

/** @param {number} mm   @returns {number} inches */
export const mmToInch = (mm) => (parseFloat(mm) || 0) / 25.4;

// ══════════════════════════════════════════════════════════════════════════════
// DISPLAY FORMATTERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * formatArea()
 * Converts m² to ft² and returns a display string.
 * Used by ResultsPage, AHUConfig check-figure calculations.
 *
 * @param {number}  m2      - area in m²
 * @param {number}  [dp=0]  - decimal places
 * @returns {string}  e.g. "322 ft²"
 */
export const formatArea = (m2, dp = 0) =>
  `${m2ToFt2(m2).toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })} ft²`;

/**
 * formatTR()
 * BTU/hr → TR with 2 decimal places.
 *
 * @param {number} btuHr
 * @returns {string} e.g. "12.50 TR"
 */
export const formatTR = (btuHr) =>
  `${btuHrToTr(btuHr).toFixed(2)} TR`;

/**
 * formatKW()
 * BTU/hr → kW with 2 decimal places.
 *
 * @param {number} btuHr
 * @returns {string} e.g. "3.66 kW"
 */
export const formatKW = (btuHr) =>
  `${btuHrToKw(btuHr).toFixed(2)} kW`;

/**
 * checkFigure()
 * Computes ft²/TR — standard HVAC sanity check.
 * Semiconductor: < 50, Pharma: 50–150, Commercial: 250–400.
 *
 * @param {number} totalAreaM2   - total conditioned area (m²)
 * @param {number} totalTR       - total cooling capacity (TR)
 * @returns {number} ft²/TR, rounded to 1 decimal
 */
export const checkFigure = (totalAreaM2, totalTR) => {
  if (!totalTR || totalTR <= 0) return 0;
  return parseFloat((m2ToFt2(totalAreaM2) / totalTR).toFixed(1));
};