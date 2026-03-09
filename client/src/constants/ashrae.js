/**
 * ASHRAE Constants & Conversion Factors
 * Reference: ASHRAE Handbook — Fundamentals (2021)
 *            ASHRAE 62.1-2022 (Ventilation)
 *            ASHRAE 90.1-2022 (Energy)
 *
 * ALTITUDE DEPENDENCY:
 * SENSIBLE_FACTOR_SEA_LEVEL (1.08) and LATENT_FACTOR_SEA_LEVEL (0.68) are
 * valid ONLY at sea level (29.921 inHg, ~70°F).
 *
 * ⚠️  NEVER use _SEA_LEVEL constants directly in load calculations.
 *     Always use the altitude-corrected helpers from utils/psychro.js:
 *       sensibleFactor(elev_ft)   → 1.08 × Cf
 *       latentFactor(elev_ft)     → 0.68 × Cf
 *     where Cf = altitudeCorrectionFactor(elev_ft)
 *
 * LATENT FACTOR DERIVATION (FIX HIGH-01):
 * Both LATENT_FACTOR_SEA_LEVEL and LATENT_FACTOR_LB are derived from the
 * same hfg = 1061 BTU/lb (latent heat of vaporization at 60°F dewpoint —
 * ASHRAE HOF 2021, Ch.1). This is the correct reference condition for
 * A/C coil sizing.
 *
 *   Air density at sea level, 70°F ≈ 0.075 lb/ft³
 *   LATENT_FACTOR_SEA_LEVEL = 0.075 × 60 min/hr × 1061 / 7000 gr/lb = 0.6818 ≈ 0.68
 *   LATENT_FACTOR_LB        = 0.075 × 60 × 1061                      = 4774.5 ≈ 4760
 *
 * Previous code had LATENT_FACTOR_LB = 4840, which implied hfg ≈ 1076 BTU/lb
 * (latent heat at 32°F — incorrect reference condition). The 1.67% error
 * propagates directly into coil latent sizing and humidity control accuracy.
 */

// ── App-level Standard Badges (consumed by Header) ───────────────────────────
export const ASHRAE_STANDARDS = [
  "ASHRAE 62.1 Ventilation",
  "ASHRAE 55 Comfort",
  "ASHRAE 90.1 Lighting",
  "ASHRAE Handbook — Fundamentals",
];

// ── Motor Load Cases — ASHRAE HOF 2021 Ch.18 Table 4 ────────────────────────
// Fraction of motor heat (as share of motor input power) entering the
// conditioned space. Wire these into seasonalLoads.js via a motorLocation
// selector on the equipment config (see MED-07).
export const MOTOR_HEAT_FRACTIONS = {
  MOTOR_IN_SPACE:              1.00, // Motor + driven equipment both in space → all input power → heat
  MOTOR_OUT_SPACE:             0.88, // Motor outside, driven equip inside → shaft power only (≈η_motor)
  MOTOR_IN_SPACE_DRIVEN_OUT:   0.12, // Motor inside, driven equip outside → winding losses only (1 − η_motor)
  MOTOR_IN_AIR_STREAM:         1.00, // Motor in supply airstream → all heat enters airstream
};

const ASHRAE = {

  // ──────────────────────────────────────────────────────────────────────────
  // UNIT CONVERSIONS
  // ──────────────────────────────────────────────────────────────────────────

  M2_TO_FT2:              10.7639,
  BTU_PER_WATT:           3.41214,    // 1 W = 3.41214 BTU/hr  (NIST exact)
  KW_TO_BTU:              3412.14,    // 1 kW = 3412.14 BTU/hr
  BTU_PER_TON:            12000,      // 1 TR = 12,000 BTU/hr
  GR_PER_LB:              7000,       // 7,000 grains = 1 lb water vapor
  W_PER_FT2_TO_BTU:       3.41214,    // W/ft² → BTU/hr·ft²

  // ──────────────────────────────────────────────────────────────────────────
  // PSYCHROMETRIC FACTORS
  // Sea-level only (29.921 inHg, 70°F). See altitude note at top of file.
  // ──────────────────────────────────────────────────────────────────────────

  // Latent heat of vaporization at 60°F dewpoint — ASHRAE HOF 2021, Ch.1
  // This is the correct reference condition for A/C coil latent sizing.
  LATENT_HFG_BTU_LB:      1061,

  // ⚠️  Use sensibleFactor(elev_ft) / latentFactor(elev_ft) from psychro.js
  //     in all load calculations. These raw values are the sea-level basis only.
  SENSIBLE_FACTOR_SEA_LEVEL: 1.08,   // Qs = 1.08 × CFM × ΔT°F  (sea level)
  LATENT_FACTOR_SEA_LEVEL:   0.68,   // Ql = 0.68 × CFM × Δgr/lb (sea level)
  //   FIX HIGH-01: was 4840 (used hfg@32°F = 1076 BTU/lb — wrong ref condition)
  //   Correct: 0.075 lb/ft³ × 60 min/hr × 1061 BTU/lb = 4774.5 → rounded 4760
  LATENT_FACTOR_LB:          4760,   // Ql = 4760 × CFM × Δlb/lb  (sea level)

  // ──────────────────────────────────────────────────────────────────────────
  // SUPPLY AIR DESIGN DIFFERENTIALS
  // ΔT = T_room − T_supply. Used for preliminary CFM sizing only.
  // Final CFM must always be governed by the greater of: load-based CFM,
  // minimum OA CFM (62.1), or cleanroom pressurisation / dilution CFM.
  // ──────────────────────────────────────────────────────────────────────────

  DT_SUPPLY_COOLING:          20,    // °F — general occupancy (55°F SA, 75°F room)
  DT_SUPPLY_HEATING:          20,    // °F — general occupancy

  // Critical-facility overrides. Use per-room via facilityType selector.
  DT_SUPPLY_COOLING_SEMICON:  12,    // °F — semiconductor fab (55°F SA, 67°F room)
  DT_SUPPLY_COOLING_PHARMA:   10,    // °F — pharma ISO (55°F SA, 65°F room)
  DT_SUPPLY_COOLING_BATTERY:  15,    // °F — battery mfg (55°F SA, 70°F room)

  // ──────────────────────────────────────────────────────────────────────────
  // PEOPLE LOADS — ASHRAE HOF 2021 Ch.18 Table 1
  // All values in BTU/hr per person. Total = sensible + latent.
  // ──────────────────────────────────────────────────────────────────────────

  // Legacy scalars — retained for backward compatibility with older components.
  // Prefer PEOPLE_LOADS table for new code.
  PEOPLE_SENSIBLE_SEATED:     245,
  PEOPLE_LATENT_SEATED:       205,

  PEOPLE_LOADS: {
    SEATED_OFFICE:    { sensible: 245, latent: 205, total: 450  }, // Sedentary / office work
    //   FIX MED-01: STANDING_LIGHT latent was 305 (belongs to WALKING_MODERATE).
    //   HOF 2021 Ch.18 Table 1: "Standing, light work" = 275S / 275L (total 550).
    STANDING_LIGHT:   { sensible: 275, latent: 275, total: 550  }, // Cleanroom operator, gowned
    WALKING_MODERATE: { sensible: 305, latent: 545, total: 850  }, // Active lab / pharma process
    HEAVY_WORK:       { sensible: 580, latent: 870, total: 1450 }, // Industrial assembly
  },

  // ──────────────────────────────────────────────────────────────────────────
  // VENTILATION — ASHRAE 62.1-2022, Table 6-1
  // Rp = per-person component (cfm/person)
  // Ra = area component (cfm/ft²)
  // ──────────────────────────────────────────────────────────────────────────

  VENT_PEOPLE_CFM:            5,     // cfm/person — office (Rp)
  VENT_AREA_CFM:              0.06,  // cfm/ft² — general manufacturing (Ra)

  // Critical-facility Ra values. Apply per-room via ventCategory field.
  // NOTE: ventilation.js uses ra: 0.18 for semiconductor on an OA-per-ACH
  // basis (recirculation-governed rooms). VENT_AREA_SEMICON here is the
  // 62.1 minimum OA component only — the two serve different purposes.
  // See ventilation.js header comment for full explanation.
  VENT_AREA_PHARMA:           0.18,  // cfm/ft² — pharma / bio-hazardous process
  VENT_AREA_BATTERY:          0.12,  // cfm/ft² — battery manufacturing (H₂ dilution)
  VENT_AREA_SEMICON:          0.06,  // cfm/ft² — semiconductor (62.1 OA minimum; recirculation governs)

  // ──────────────────────────────────────────────────────────────────────────
  // COIL & SYSTEM DESIGN DEFAULTS
  // ──────────────────────────────────────────────────────────────────────────

  DEFAULT_SAFETY_FACTOR_PCT:       10,   // % added to total capacity
  DEFAULT_FAN_HEAT_PCT:             5,   // % of supply fan heat gain added to cooling load

  // Coil bypass factor (BF). Lower BF → tighter dewpoint control.
  // Semiconductor and pharma coils are selected for tighter BF.
  DEFAULT_BYPASS_FACTOR:           0.10, // General HVAC
  DEFAULT_BYPASS_FACTOR_SEMICON:   0.05, // Semiconductor fab (tight humidity)
  DEFAULT_BYPASS_FACTOR_PHARMA:    0.06, // Pharma sterile / ISO-classified
  DEFAULT_BYPASS_FACTOR_BATTERY:   0.08, // Battery mfg

  // Apparatus Dew Point (ADP) — °F. Drives coil selection.
  DEFAULT_ADP:                     55,   // °F — general occupancy
  DEFAULT_ADP_SEMICON:             47,   // °F — semiconductor fab
  DEFAULT_ADP_PHARMA:              44,   // °F — pharma sterile
  DEFAULT_ADP_BATTERY:             38,   // °F — Li-ion battery manufacturing

  // ──────────────────────────────────────────────────────────────────────────
  // DIVERSITY, SAFETY & CORRECTION FACTORS
  // ──────────────────────────────────────────────────────────────────────────

  // Process load diversity — 75% simultaneous demand (wire into seasonalLoads.js)
  PROCESS_DIVERSITY_FACTOR:        0.75,

  // GMP / pharma safety margin — 25% added to process loads (wire into seasonalLoads.js)
  PROCESS_SAFETY_FACTOR:           1.25,

  // Lighting ballast factor. Use 1.2 for T8 fluorescent, 1.0 for LED.
  // Wire into seasonalLoads.js with a ballastType selector per room.
  LIGHTING_BALLAST_FACTOR:         1.0,

  // Duct heat gain — ASHRAE 90.1 §6. Apply to supply-side sensible load.
  // Wire into rdsSelector.js (LOW-05).
  DUCT_HEAT_GAIN_PCT:              0.05, // 5% of supply fan heat gain

  // Motor load factor — default: motor outside conditioned space, driven
  // equipment inside (shaft power only ≈ η_motor). See MOTOR_HEAT_FRACTIONS
  // above. Wire motorLocation field into equipment config (MED-07).
  MOTOR_LOAD_FACTOR:               0.88,

};

export default ASHRAE;