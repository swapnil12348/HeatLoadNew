/**
 * ASHRAE Constants & Conversion Factors
 * Reference: ASHRAE Handbook — Fundamentals (2021)
 *            ASHRAE 62.1-2022 (Ventilation)
 *            ASHRAE 90.1-2022 (Energy)
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   BUG-TIER1-03 FIX — VENT_AREA_BATTERY corrected 0.12 → 0.18
 *                       VENT_AREA_SEMICON  corrected 0.06 → 0.18
 *
 *     Both battery manufacturing and semiconductor fab rooms are classified as
 *     "Laboratory — Chemical" under ASHRAE 62.1-2022 Table 6-1 (ra = 0.18 CFM/ft²).
 *
 *     Previous values:
 *       VENT_AREA_BATTERY: 0.12 → 33% below the 62.1 minimum
 *       VENT_AREA_SEMICON: 0.06 → the general OFFICE area rate; 67% below 62.1 minimum
 *         (critical compliance failure for NFPA 318 / SEMI S2-0200 exhaust make-up sizing)
 *
 *     These values now agree with ventilation.js (ra = 0.18 for both categories).
 *
 *     ⚠️  Preferred pattern for all new code:
 *           import { calculateVbz, calculateMinAchCfm } from '../constants/ventilation';
 *         These constants are retained only for backward compatibility.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   HIGH-02 FIX — DEFAULT_ADP_BATTERY and DEFAULT_BYPASS_FACTOR_BATTERY removed.
 *
 *     Li-ion battery dry rooms use desiccant dehumidifiers, not cooling coils.
 *     ADP and Bypass Factor are cooling-coil sizing parameters with no physical
 *     meaning for desiccant systems. At ADP = 38°F the achievable room RH is
 *     ~42% at 70°F — far too wet for Li-ion assembly (target: −40°C DP / ~0.4%RH).
 *     Replaced with desiccant process defaults (see below).
 *
 *   HIGH-03 FIX — LATENT_FACTOR_LB corrected 4760 → 4775.
 *
 *     Derivation: 0.075 lb/ft³ × 60 min/hr × 1061 BTU/lb = 4774.5 ≈ 4775.
 *     Previous 4760 implied hfg = 1057.8 BTU/lb — no ASHRAE source supports it.
 *     Impact: 14.5 BTU/hr·CFM/(lb/lb) low; for 100,000 CFM dry room: 1,440 BTU/hr
 *     understated per calculation run.
 *
 *   LOW-02 FIX — KW_TO_BTU marked @deprecated.
 *     Name implies energy (BTU) not power (BTU/hr). Value is correct (3412.14).
 *     New code must use KW_TO_BTU_HR from utils/units.js.
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-SL-01 ROOT CAUSE DOCUMENTED:
 *
 *   This file exports SENSIBLE_FACTOR_SEA_LEVEL and LATENT_FACTOR_SEA_LEVEL.
 *   It does NOT export SENSIBLE_FACTOR or LATENT_FACTOR (no _SEA_LEVEL suffix).
 *   seasonalLoads.js was referencing ASHRAE.SENSIBLE_FACTOR → undefined → NaN cascade.
 *
 *   Fix: all load calc files import sensibleFactor(elevFt) / latentFactor(elevFt)
 *   directly from psychro.js. These cannot be undefined.
 *
 *   ⚠️  Do NOT add SENSIBLE_FACTOR or LATENT_FACTOR aliases here.
 *       The psychro.js functions are the only correct entry point for
 *       altitude-corrected psychrometric factors.
 *
 * ── ALTITUDE DEPENDENCY NOTE ─────────────────────────────────────────────────
 *
 *   SENSIBLE_FACTOR_SEA_LEVEL (1.08) and LATENT_FACTOR_SEA_LEVEL (0.68) are
 *   valid ONLY at sea level (29.921 inHg, ~70°F).
 *
 *   ⚠️  NEVER use _SEA_LEVEL constants directly in load calculations.
 *       Always use:  sensibleFactor(elev_ft)  from utils/psychro.js
 *                    latentFactor(elev_ft)     from utils/psychro.js
 */

// ── App-level Standard Badges ──────────────────────────────────────────────
export const ASHRAE_STANDARDS = [
  "ASHRAE 62.1 Ventilation",
  "ASHRAE 55 Comfort",
  "ASHRAE 90.1 Lighting",
  "ASHRAE Handbook — Fundamentals",
];

// ── Motor Load Cases — ASHRAE HOF 2021 Ch.18 Table 4 ────────────────────────
export const MOTOR_HEAT_FRACTIONS = {
  MOTOR_IN_SPACE:             1.00,
  MOTOR_OUT_SPACE:            0.88,
  MOTOR_IN_SPACE_DRIVEN_OUT:  0.12,
  MOTOR_IN_AIR_STREAM:        1.00,
};

const ASHRAE = {

  // ──────────────────────────────────────────────────────────────────────────
  // UNIT CONVERSIONS
  // ──────────────────────────────────────────────────────────────────────────

  M2_TO_FT2:        10.7639,   // 1 m² = 10.7639 ft² (exact)
  BTU_PER_WATT:      3.41214,  // 1 W = 3.41214 BTU/hr
  W_PER_FT2_TO_BTU:  3.41214,  // same conversion, different context alias
  BTU_PER_TON:      12000,     // 1 TR = 12,000 BTU/hr (exact)
  GR_PER_LB:         7000,     // 1 lb = 7000 grains (exact)

  /**
   * @deprecated Use KW_TO_BTU_HR from utils/units.js for new code.
   * Name "KW_TO_BTU" implies energy (BTU) not power (BTU/hr). Value is correct.
   * Retained for backward compatibility only.
   */
  KW_TO_BTU:        3412.14,

  // ──────────────────────────────────────────────────────────────────────────
  // PSYCHROMETRIC FACTORS (sea-level basis)
  //
  // ⚠️  DO NOT add SENSIBLE_FACTOR or LATENT_FACTOR aliases (no _SEA_LEVEL suffix).
  //     Use sensibleFactor(elev_ft) / latentFactor(elev_ft) from psychro.js.
  // ──────────────────────────────────────────────────────────────────────────

  LATENT_HFG_BTU_LB:         1061,   // hfg at 32°F reference (ASHRAE HOF 2021 Ch.1 Eq.30)

  SENSIBLE_FACTOR_SEA_LEVEL:  1.08,  // Qs = 1.08 × CFM × ΔT°F  (sea level only)
  LATENT_FACTOR_SEA_LEVEL:    0.68,  // Ql = 0.68 × CFM × Δgr/lb (sea level only)

  // Latent factor in lb/lb basis.
  // Derivation: 0.075 lb/ft³ × 60 min/hr × 1061 BTU/lb = 4774.5 ≈ 4775
  LATENT_FACTOR_LB:           4775,

  // ──────────────────────────────────────────────────────────────────────────
  // SUPPLY AIR DESIGN DIFFERENTIALS (°F)
  // ──────────────────────────────────────────────────────────────────────────

  DT_SUPPLY_COOLING:          20,
  DT_SUPPLY_HEATING:          20,
  DT_SUPPLY_COOLING_SEMICON:  12,
  DT_SUPPLY_COOLING_PHARMA:   10,
  DT_SUPPLY_COOLING_BATTERY:  15,

  // ──────────────────────────────────────────────────────────────────────────
  // PEOPLE LOADS — ASHRAE HOF 2021 Ch.18 Table 1 (BTU/hr per person)
  // ──────────────────────────────────────────────────────────────────────────

  PEOPLE_SENSIBLE_SEATED:  245,
  PEOPLE_LATENT_SEATED:    205,

  PEOPLE_LOADS: {
    SEATED_OFFICE:    { sensible: 245, latent: 205, total: 450  },
    STANDING_LIGHT:   { sensible: 275, latent: 275, total: 550  }, // Cleanroom operator, gowned
    WALKING_MODERATE: { sensible: 305, latent: 545, total: 850  }, // Active lab / pharma process
    HEAVY_WORK:       { sensible: 580, latent: 870, total: 1450 }, // Industrial assembly
  },

  // ──────────────────────────────────────────────────────────────────────────
  // VENTILATION — ASHRAE 62.1-2022, Table 6-1
  //
  // ⚠️  Prefer calculateVbz() / calculateMinAchCfm() from ventilation.js.
  //     These constants are retained for backward compatibility only.
  // ──────────────────────────────────────────────────────────────────────────

  VENT_PEOPLE_CFM:    5,      // Rp = 5 CFM/person (office)
  VENT_AREA_CFM:      0.06,   // Ra = 0.06 CFM/ft² (office)
  VENT_AREA_PHARMA:   0.18,   // Ra = 0.18 CFM/ft² (Lab-General)
  VENT_AREA_BATTERY:  0.18,   // Ra = 0.18 CFM/ft² (Lab-Chemical, ASHRAE 62.1-2022)
  VENT_AREA_SEMICON:  0.18,   // Ra = 0.18 CFM/ft² (Lab-Chemical, ASHRAE 62.1-2022)

  // ──────────────────────────────────────────────────────────────────────────
  // COIL & SYSTEM DESIGN DEFAULTS
  // ──────────────────────────────────────────────────────────────────────────

  DEFAULT_SAFETY_FACTOR_PCT:     10,
  DEFAULT_FAN_HEAT_PCT:           5,

  // Bypass factor — cooling-coil systems only.
  // ⚠️  Not applicable for desiccant dry rooms (battery, dry powder pharma).
  DEFAULT_BYPASS_FACTOR:         0.10,   // General HVAC
  DEFAULT_BYPASS_FACTOR_SEMICON: 0.05,   // Semiconductor fab (CHW coil)
  DEFAULT_BYPASS_FACTOR_PHARMA:  0.06,   // Pharma sterile / ISO-classified

  // Apparatus Dew Point — cooling-coil systems only.
  // ⚠️  Not applicable for desiccant-based dry rooms.
  DEFAULT_ADP:                   55,     // General occupancy
  DEFAULT_ADP_SEMICON:           47,     // Semiconductor fab
  DEFAULT_ADP_PHARMA:            44,     // Pharma sterile

  // ── Desiccant system defaults ──────────────────────────────────────────────
  //
  // Li-ion battery dry rooms require DESICCANT DEHUMIDIFICATION, not CHW coils.
  // ADP/BF constants above do NOT apply. Desiccant wheels are sized by moisture
  // removal capacity, face velocity, and reactivation temperature.
  //
  // Design workflow:
  //   1. Target DP → gr/lb via grainsFromDewPoint(targetDpF) in psychro.js
  //   2. Moisture removal load (lb/hr) → heatingHumid.js
  //   3. Size desiccant wheel from leaving DP and process temp
  //   4. Size reactivation heater: mass flow × cp × (process temp − inlet)
  //   5. Size after-cooler (leaving air is hot): sensibleFactor × CFM × ΔT
  //
  // Reference: ASHRAE HVAC S&E 2020, Ch.24; Munters Industrial Dry Room Design
  //
  // Li-ion leaving-air targets by facility type:
  //   Electrode slurry / coating:   −20°C DP (≈ −4°F)  → ~5%RH at 70°F
  //   Cell assembly (mainstream):   −40°C DP (≈ −40°F) → ~0.4%RH at 70°F
  //   Cell assembly (conservative): −45°C DP (≈ −49°F) → ~0.2%RH at 70°F
  //   Solid-state sulfide:          −60°C DP (≈ −76°F) → beyond this tool's range

  DEFAULT_DESICCANT_LEAVING_DP_F:   -40,  // °F — mainstream Li-ion cell assembly (−40°C DP)
  DEFAULT_DESICCANT_PROCESS_TEMP_F:  250, // °F — typical silica gel reactivation (230–280°F)

  // ──────────────────────────────────────────────────────────────────────────
  // DIVERSITY, SAFETY & CORRECTION FACTORS
  // ──────────────────────────────────────────────────────────────────────────

  // PROCESS_DIVERSITY_FACTOR is a FALLBACK ONLY.
  // When equipment.diversityFactor is set per-room in envelopeSlice, use that
  // value exclusively — do NOT also multiply by this global factor.
  PROCESS_DIVERSITY_FACTOR:  0.75,

  PROCESS_SAFETY_FACTOR:     1.25,   // GMP Annex 1:2022 §4.23 — pharma rooms only
  LIGHTING_BALLAST_FACTOR:   1.0,    // LED (no ballast loss); T8 = 1.2, T5 = 1.15
  DUCT_HEAT_GAIN_PCT:        0.05,
  MOTOR_LOAD_FACTOR:         0.88,

};

export default ASHRAE;