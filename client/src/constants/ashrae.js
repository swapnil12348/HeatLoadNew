/**
 * ASHRAE Constants & Conversion Factors
 * Reference: ASHRAE Handbook — Fundamentals (2021)
 *            ASHRAE 62.1-2022 (Ventilation)
 *            ASHRAE 90.1-2022 (Energy)
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-SL-01 ROOT CAUSE DOCUMENTED HERE:
 *
 *   This file exports SENSIBLE_FACTOR_SEA_LEVEL and LATENT_FACTOR_SEA_LEVEL.
 *   It does NOT export SENSIBLE_FACTOR or LATENT_FACTOR (no _SEA_LEVEL suffix).
 *
 *   seasonalLoads.js was referencing ASHRAE.SENSIBLE_FACTOR — which is
 *   UNDEFINED in this object. JavaScript returns undefined for missing object
 *   keys rather than throwing an error.
 *
 *   The silent propagation:
 *     ASHRAE.SENSIBLE_FACTOR                   → undefined
 *     Cs = undefined * altCf                   → NaN
 *     infilSens = NaN * infilCFM * ΔT          → NaN  (even when infilCFM = 0:
 *                                                       NaN * 0 = NaN, not 0)
 *     rawSensible = envelope + people + ... + NaN → NaN
 *     ersh = Math.round(NaN)                   → NaN
 *     [all downstream: supplyAir, tons, RDS]   → NaN
 *
 *   FIX: seasonalLoads.js (and all load calc files) now import
 *     sensibleFactor(elevFt) / latentFactor(elevFt) directly from psychro.js.
 *     These return the altitude-corrected values and cannot be undefined.
 *
 *   TO PREVENT RECURRENCE:
 *   Do NOT add SENSIBLE_FACTOR or LATENT_FACTOR aliases here pointing to the
 *   _SEA_LEVEL values. That would encourage callers to bypass the altitude
 *   correction. The psychro.js functions are the only correct entry point.
 *
 *   BUG-SL-02 DOCUMENTED HERE:
 *   KW_TO_BTU is numerically correct (3412.14) but the name implies energy
 *   (BTU) rather than power (BTU/hr). Kept for backward compatibility with
 *   any component not yet migrated to units.js. New code should import
 *   KW_TO_BTU_HR from utils/units.js instead.
 *
 * ── ALTITUDE DEPENDENCY NOTE ─────────────────────────────────────────────────
 *
 * SENSIBLE_FACTOR_SEA_LEVEL (1.08) and LATENT_FACTOR_SEA_LEVEL (0.68) are
 * valid ONLY at sea level (29.921 inHg, ~70°F).
 *
 * ⚠️  NEVER use _SEA_LEVEL constants directly in load calculations.
 *     Always use the altitude-corrected helpers from utils/psychro.js:
 *       sensibleFactor(elev_ft)   → 1.08 × Cf
 *       latentFactor(elev_ft)     → 0.68 × Cf
 *     where Cf = altitudeCorrectionFactor(elev_ft)
 *
 * ── LATENT FACTOR DERIVATION (FIX HIGH-01) ───────────────────────────────────
 *
 * Both LATENT_FACTOR_SEA_LEVEL and LATENT_FACTOR_LB are derived from
 * hfg = 1061 BTU/lb (latent heat of vaporization at 60°F dewpoint —
 * ASHRAE HOF 2021, Ch.1). Correct reference condition for A/C coil sizing.
 *
 *   Air density at sea level, 70°F ≈ 0.075 lb/ft³
 *   LATENT_FACTOR_SEA_LEVEL = 0.075 × 60 min/hr × 1061 / 7000 gr/lb = 0.6818 ≈ 0.68
 *   LATENT_FACTOR_LB        = 0.075 × 60 × 1061                      = 4774.5 ≈ 4760
 *
 * Previous: LATENT_FACTOR_LB = 4840 → implied hfg = 1076 BTU/lb (latent heat
 * at 32°F — wrong reference condition). 1.67% error in coil latent sizing.
 */

// ── App-level Standard Badges (consumed by Header) ───────────────────────────
export const ASHRAE_STANDARDS = [
  "ASHRAE 62.1 Ventilation",
  "ASHRAE 55 Comfort",
  "ASHRAE 90.1 Lighting",
  "ASHRAE Handbook — Fundamentals",
];

// ── Motor Load Cases — ASHRAE HOF 2021 Ch.18 Table 4 ────────────────────────
// Fraction of motor heat entering the conditioned space.
// Wire motorLocation field into equipment config (MED-07).
export const MOTOR_HEAT_FRACTIONS = {
  MOTOR_IN_SPACE:             1.00,  // Motor + driven equip in space → all input power → heat
  MOTOR_OUT_SPACE:            0.88,  // Motor outside, driven equip inside → shaft power only
  MOTOR_IN_SPACE_DRIVEN_OUT:  0.12,  // Motor inside, driven equip outside → winding losses only
  MOTOR_IN_AIR_STREAM:        1.00,  // Motor in supply airstream → all heat enters airstream
};

const ASHRAE = {

  // ──────────────────────────────────────────────────────────────────────────
  // UNIT CONVERSIONS
  // ──────────────────────────────────────────────────────────────────────────

  M2_TO_FT2:       10.7639,
  BTU_PER_WATT:    3.41214,   // 1 W = 3.41214 BTU/hr  (NIST exact)

  // BUG-SL-02: Name should be KW_TO_BTU_HR — retained for backward compat.
  // Value is correct: 1 kW = 3412.14 BTU/hr.
  // New code: import KW_TO_BTU_HR from utils/units.js instead.
  KW_TO_BTU:       3412.14,

  BTU_PER_TON:     12000,     // 1 TR = 12,000 BTU/hr
  GR_PER_LB:       7000,      // 7,000 grains = 1 lb water vapor
  W_PER_FT2_TO_BTU: 3.41214,  // W/ft² → BTU/hr·ft²

  // ──────────────────────────────────────────────────────────────────────────
  // PSYCHROMETRIC FACTORS
  // Sea-level only (29.921 inHg, 70°F).
  //
  // ⚠️  DO NOT reference ASHRAE.SENSIBLE_FACTOR or ASHRAE.LATENT_FACTOR —
  //     these do NOT exist in this object (no alias without _SEA_LEVEL suffix).
  //     Use sensibleFactor(elev_ft) / latentFactor(elev_ft) from psychro.js.
  //     See BUG-SL-01 note at the top of this file.
  // ──────────────────────────────────────────────────────────────────────────

  LATENT_HFG_BTU_LB:         1061,   // hfg at 60°F dewpoint (correct coil ref)

  SENSIBLE_FACTOR_SEA_LEVEL:  1.08,  // Qs = 1.08 × CFM × ΔT°F  (sea level only)
  LATENT_FACTOR_SEA_LEVEL:    0.68,  // Ql = 0.68 × CFM × Δgr/lb (sea level only)
  LATENT_FACTOR_LB:           4760,  // Ql = 4760 × CFM × Δlb/lb (sea level only)
  //   FIX HIGH-01: was 4840 — used hfg@32°F = 1076 BTU/lb (wrong ref condition)

  // ──────────────────────────────────────────────────────────────────────────
  // SUPPLY AIR DESIGN DIFFERENTIALS (°F)
  // ΔT = T_room − T_supply. Preliminary CFM sizing only.
  // Final CFM governed by: max(load-based, OA min, cleanroom pressurisation).
  // ──────────────────────────────────────────────────────────────────────────

  DT_SUPPLY_COOLING:          20,    // General occupancy
  DT_SUPPLY_HEATING:          20,    // General occupancy

  // Critical-facility overrides — use per-room via facilityType selector
  DT_SUPPLY_COOLING_SEMICON:  12,    // Semiconductor fab
  DT_SUPPLY_COOLING_PHARMA:   10,    // Pharma ISO
  DT_SUPPLY_COOLING_BATTERY:  15,    // Battery manufacturing

  // ──────────────────────────────────────────────────────────────────────────
  // PEOPLE LOADS — ASHRAE HOF 2021 Ch.18 Table 1 (BTU/hr per person)
  // ──────────────────────────────────────────────────────────────────────────

  // Legacy scalars — retained for backward compatibility.
  // Prefer PEOPLE_LOADS table for new code.
  PEOPLE_SENSIBLE_SEATED:  245,
  PEOPLE_LATENT_SEATED:    205,

  PEOPLE_LOADS: {
    SEATED_OFFICE:   { sensible: 245, latent: 205, total: 450  },
    // FIX MED-01: STANDING_LIGHT latent was 305 — belongs to WALKING_MODERATE.
    // HOF 2021 Ch.18 Table 1: "Standing, light work" = 275S / 275L (total 550).
    STANDING_LIGHT:  { sensible: 275, latent: 275, total: 550  }, // Cleanroom operator, gowned
    WALKING_MODERATE:{ sensible: 305, latent: 545, total: 850  }, // Active lab / pharma process
    HEAVY_WORK:      { sensible: 580, latent: 870, total: 1450 }, // Industrial assembly
  },

  // ──────────────────────────────────────────────────────────────────────────
  // VENTILATION — ASHRAE 62.1-2022, Table 6-1
  // Rp = per-person component (cfm/person)
  // Ra = area component (cfm/ft²)
  // ──────────────────────────────────────────────────────────────────────────

  VENT_PEOPLE_CFM:     5,     // cfm/person — office (Rp)
  VENT_AREA_CFM:       0.06,  // cfm/ft² — general manufacturing (Ra)

  VENT_AREA_PHARMA:    0.18,  // cfm/ft² — pharma / bio-hazardous process
  VENT_AREA_BATTERY:   0.12,  // cfm/ft² — battery manufacturing (H₂ dilution)
  VENT_AREA_SEMICON:   0.06,  // cfm/ft² — semiconductor (62.1 OA min; recirculation governs)

  // ──────────────────────────────────────────────────────────────────────────
  // COIL & SYSTEM DESIGN DEFAULTS
  // ──────────────────────────────────────────────────────────────────────────

  DEFAULT_SAFETY_FACTOR_PCT:     10,    // % added to total capacity
  DEFAULT_FAN_HEAT_PCT:           5,    // % of supply fan heat gain added to cooling load

  // Coil bypass factor (BF). Lower BF → tighter dewpoint control.
  DEFAULT_BYPASS_FACTOR:         0.10,  // General HVAC
  DEFAULT_BYPASS_FACTOR_SEMICON: 0.05,  // Semiconductor fab
  DEFAULT_BYPASS_FACTOR_PHARMA:  0.06,  // Pharma sterile / ISO-classified
  DEFAULT_BYPASS_FACTOR_BATTERY: 0.08,  // Battery manufacturing

  // Apparatus Dew Point (ADP) — °F
  DEFAULT_ADP:                   55,    // General occupancy
  DEFAULT_ADP_SEMICON:           47,    // Semiconductor fab
  DEFAULT_ADP_PHARMA:            44,    // Pharma sterile
  DEFAULT_ADP_BATTERY:           38,    // Li-ion battery manufacturing

  // ──────────────────────────────────────────────────────────────────────────
  // DIVERSITY, SAFETY & CORRECTION FACTORS
  // ──────────────────────────────────────────────────────────────────────────

  // FIX HIGH-07: PROCESS_DIVERSITY_FACTOR is a FALLBACK ONLY.
  // Per ashraeTables.js: when equipment.diversityFactor is set from
  // EQUIPMENT_LOAD_DENSITY, use that value exclusively — do NOT also multiply
  // by PROCESS_DIVERSITY_FACTOR. The ?? operator in seasonalLoads.js ensures
  // only one is applied (per-type if set, global if not). Never compound both.
  PROCESS_DIVERSITY_FACTOR:  0.75,

  // GMP / pharma 25% safety margin — ISPE Baseline Guide Vol.5, GMP Annex 1:2022
  PROCESS_SAFETY_FACTOR:     1.25,

  // Lighting ballast factor. 1.0 for LED, 1.2 for T8 fluorescent, 1.15 for T5.
  LIGHTING_BALLAST_FACTOR:   1.0,

  // Duct heat gain — ASHRAE 90.1 §6. Applied in rdsSelector.js (LOW-05).
  DUCT_HEAT_GAIN_PCT:        0.05,

  // Motor load factor default: motor outside space, driven equipment inside.
  // See MOTOR_HEAT_FRACTIONS above. Wire motorLocation into equipment config (MED-07).
  MOTOR_LOAD_FACTOR:         0.88,

};

export default ASHRAE;