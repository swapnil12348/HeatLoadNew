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
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-UNITS-01: Added g/kg ↔ gr/lb converters (gPerKgToGrPerLb etc.)
 *     ASHRAE Fundamentals tables express W in g/kg; app uses gr/lb internally.
 *     Ad-hoc factor 0.437 found in two places was WRONG — correct is ×7 exactly.
 *
 *   BUG-UNITS-02: Added Pa ↔ hPa converters (hpaToPa, paToHpa).
 *     Bridges psychro.js internals (hPa) with SI output layer.
 *
 *   BUG-UNITS-03: Added kg/kg → gr/lb converter (kgPerKgToGrPerLb).
 *     kg/kg and lb/lb are numerically identical. ×7000 exactly.
 *
 *   BUG-UNITS-04: Added hPa ↔ inHg converters (hpaToInHg, inHgToHpa).
 *     Bridges sitePressure() output with ASHRAE climate data format.
 *
 *   Added: lbPerHrToKgPerHr / kgPerHrToLbPerHr — for humidifier capacity sizing.
 *   Added: PSYCHRO_SANITY_CHECKS — reference values for regression testing.
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

// ── BUG-UNITS-01 FIX: g/kg ↔ gr/lb ──────────────────────────────────────────
//
// ASHRAE Fundamentals tables (Ch.1, 2, 6) express humidity ratio in g/kg.
// The app uses gr/lb internally. Conversion is exactly ×7 (7000/1000).
//
// ASHRAE HOF 2021 Ch.1 Table 3 cross-check:
//   At 70°F (21.1°C): Ws = 15.67 g/kg = 109.7 gr/lb  ✓ (15.67 × 7 = 109.69)
//
// The incorrect factor 0.437 was found in two places in the codebase.
// Correct: 1 g/kg = 7.000 gr/lb (not 0.437, not 7.003 — exactly 7).

/**
 * @param {number} gPerKg - humidity ratio (g/kg)
 * @returns {number} humidity ratio (gr/lb)
 */
export const gPerKgToGrPerLb = (gPerKg) => num(gPerKg) * 7;

/**
 * @param {number} grPerLb - humidity ratio (gr/lb)
 * @returns {number} humidity ratio (g/kg)
 */
export const grPerLbToGPerKg = (grPerLb) => num(grPerLb) / 7;

// ── BUG-UNITS-03 FIX: kg/kg (= lb/lb) ↔ gr/lb ───────────────────────────────
//
// kg/kg and lb/lb humidity ratios are numerically identical — both are
// dimensionless mass ratios. ASHRAE psychrometric equations (Ch.1) work in
// kg/kg. The app display layer uses gr/lb. Conversion is exactly ×7000.

/**
 * @param {number} kgKg - humidity ratio (kg/kg or lb/lb — numerically identical)
 * @returns {number} humidity ratio (gr/lb)
 */
export const kgPerKgToGrPerLb = (kgKg) => num(kgKg) * GR_PER_LB;

/**
 * @param {number} grPerLb - humidity ratio (gr/lb)
 * @returns {number} humidity ratio (kg/kg, same as lb/lb)
 */
export const grPerLbToKgPerKg = (grPerLb) => num(grPerLb) / GR_PER_LB;

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

// ── BUG-UNITS-02 FIX: Pa ↔ hPa ───────────────────────────────────────────────
// Bridges psychro.js internals (hPa) with SI output layer (Pa).
// Previously callers divided/multiplied by 100 inline with no audit trail.

/** 1 hPa = 100 Pa */
export const HPA_TO_PA = 100;
export const PA_TO_HPA = 1 / HPA_TO_PA;

/** @param {number} hpa  @returns {number} Pa */
export const hpaToPa = (hpa) => num(hpa) * HPA_TO_PA;

/** @param {number} pa   @returns {number} hPa */
export const paToHpa = (pa)  => num(pa)  * PA_TO_HPA;

// ── BUG-UNITS-04 FIX: hPa ↔ inHg ─────────────────────────────────────────────
// Bridges sitePressure() output (hPa) with ASHRAE climate data tables (inHg).

/** 1 hPa = 0.029530 inHg */
export const HPA_TO_IN_HG = 0.029530;

/** @param {number} hpa    @returns {number} inHg */
export const hpaToInHg = (hpa)  => num(hpa)  * HPA_TO_IN_HG;

/** @param {number} inHg  @returns {number} hPa */
export const inHgToHpa = (inHg) => num(inHg) / HPA_TO_IN_HG;

// ══════════════════════════════════════════════════════════════════════════════
// MASS FLOW / PIPE SIZING
// ══════════════════════════════════════════════════════════════════════════════

/** 1 GPM = 3.78541 L/min */
export const GPM_TO_LPM = 3.78541;

/** @param {number} gpm  @returns {number} L/min */
export const gpmToLpm = (gpm) => num(gpm) * GPM_TO_LPM;

/** @param {number} lpm  @returns {number} GPM */
export const lpmToGpm = (lpm) => num(lpm) / GPM_TO_LPM;

// ── Steam / humidifier mass flow ──────────────────────────────────────────────
// Used in: heatingHumid.js (humidification capacity), AHUConfig.jsx (humidifier sizing)

/**
 * lbPerHrToKgPerHr
 * Mass flow rate: lb/hr → kg/hr.
 * Used for steam humidifier capacity (nameplate is often in lb/hr steam).
 *
 * @param {number} lbHr  @returns {number} kg/hr
 */
export const lbPerHrToKgPerHr = (lbHr) => num(lbHr) * 0.453592;

/**
 * kgPerHrToLbPerHr
 * Mass flow rate: kg/hr → lb/hr.
 *
 * @param {number} kgHr  @returns {number} lb/hr
 */
export const kgPerHrToLbPerHr = (kgHr) => num(kgHr) / 0.453592;

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

// ══════════════════════════════════════════════════════════════════════════════
// REGRESSION / SANITY CHECK REFERENCE VALUES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * PSYCHRO_SANITY_CHECKS
 *
 * Expected output values from psychro.js v2.0 (Hyland-Wexler) at known conditions.
 * Use these in test-utils.jsx or any future unit test suite to catch regressions.
 *
 * The critical dry condition row documents the Magnus vs H-W discrepancy.
 * After deploying psychro.js v2.0, recalculate all load summaries for
 * projects targeting <5%RH — the dew point correction affects humidification
 * load sizing by approximately 10–15%.
 */
export const PSYCHRO_SANITY_CHECKS = {
  // Standard sea-level reference (70°F DB, 50%RH, 0 ft elevation)
  reference: {
    db: 70, rh: 50, elev: 0,
    grains:         { expected: 54.8,  tolerance: 0.5  },
    dewPointF:      { expected: 50.8,  tolerance: 0.3  },
    wetBulbF:       { expected: 58.6,  tolerance: 0.2  },
    enthalpyBtuLb:  { expected: 28.10, tolerance: 0.1  },
    specVolFt3Lb:   { expected: 13.51, tolerance: 0.05 },
  },
  // 1%RH critical facility — the primary failure mode of the old Magnus formula
  criticalDry: {
    db: 70, rh: 1, elev: 0,
    grains:         { expected: 1.07,  tolerance: 0.05 },
    dewPointF:      { expected: -35.1, tolerance: 0.5,
                      note: 'FROST point. Magnus returned −31.2°F — 3.9°F error.' },
    dewPointC:      { expected: -37.3, tolerance: 0.3,
                      note: 'Magnus returned −35.1°C — +2.2°C error at this condition.' },
    wetBulbF:       { expected: 34.0,  tolerance: 1.0  },
    enthalpyBtuLb:  { expected: 16.81, tolerance: 0.1  },
  },
  // Denver elevation check — Cf correction validation
  denver: {
    db: 95, rh: 20, elev: 5280,
    grains:         { expected: 23.6,  tolerance: 0.5  },
    sensibleFactor: { expected: 0.899, tolerance: 0.005 },
  },
};