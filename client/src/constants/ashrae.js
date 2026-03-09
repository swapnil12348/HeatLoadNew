/**
 * ASHRAE Constants & Conversion Factors
 * Reference: ASHRAE Handbook — Fundamentals (2021)
 *            ASHRAE 62.1-2022 (Ventilation)
 *            ASHRAE 90.1-2022 (Energy)
 *
 * ALTITUDE DEPENDENCY:
 * SENSIBLE_FACTOR (1.08) and LATENT_FACTOR (0.68) are valid at sea level
 * (29.921 inHg, ~70°F). At elevation these MUST be multiplied by:
 *   Cf = (29.921 × (1 − 6.8754e-6 × elev_ft)^5.2559) / 29.921
 *
 * Use altitudeCorrectionFactor(elev_ft) from utils/psychro.js to apply this.
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
//
// FIX HIGH-01: MOTOR_OUT_SPACE was incorrectly 0.25 (the "motor IN space,
// driven equipment OUT" case). Correct value for motor OUTSIDE / equipment
// INSIDE is motor efficiency ≈ 0.88 — only shaft power enters the space.
export const MOTOR_HEAT_FRACTIONS = {
  MOTOR_IN_SPACE:          1.00, // Motor + driven equipment both in space (all input power → heat)
  MOTOR_OUT_SPACE:         0.88, // FIX HIGH-01: Motor outside, driven equip inside → shaft power only (≈ηmotor)
  MOTOR_IN_SPACE_DRIVEN_OUT: 0.12, // Motor inside, driven equip outside → winding losses only (1 − ηmotor)
  MOTOR_IN_AIR_STREAM:     1.00, // Motor in supply airstream (all heat enters airstream)
};

const ASHRAE = {
  // ── Unit Conversions ──────────────────────────────────────────────────────
  M2_TO_FT2:        10.7639,
  // FIX LOW-01: Use full precision per NIST. 1 W = 3.41214 BTU/hr exactly.
  // Old value 3.412 / 3412 caused rounding drift across modules.
  BTU_PER_WATT:     3.41214,     // 1 W = 3.41214 BTU/hr  (was 3.412)
  KW_TO_BTU:        3412.14,     // 1 kW = 3412.14 BTU/hr (was 3412)
  BTU_PER_TON:      12000,       // 1 TR = 12,000 BTU/hr
  GR_PER_LB:        7000,        // 7,000 grains = 1 lb water vapor
  W_PER_FT2_TO_BTU: 3.41214,     // W/ft² → BTU/hr·ft²  (was 3.412 — FIX LOW-01)

  // ── Psychrometric Factors (sea-level, 70°F) ───────────────────────────────
  SENSIBLE_FACTOR:  1.08,        // Qs = 1.08 × CFM × ΔT°F
  LATENT_FACTOR:    0.68,        // Ql = 0.68 × CFM × Δgr/lb (grains/lb)
  LATENT_FACTOR_LB: 4840,        // Ql = 4840 × CFM × Δlb/lb (lb/lb ratio)

  // ── Supply Air Design Differentials ──────────────────────────────────────
  DT_SUPPLY_COOLING: 20,         // °F — typical cooling supply ΔT (55°F SA, 75°F room)
  DT_SUPPLY_HEATING: 20,         // °F — typical heating supply ΔT

  // ── People Loads BTU/hr — ASHRAE HOF 2021 Table 1, Ch.18 ─────────────────
  // Legacy scalars kept for backward compatibility:
  PEOPLE_SENSIBLE_SEATED: 245,
  PEOPLE_LATENT_SEATED:   205,
  // Full activity table:
  PEOPLE_LOADS: {
    SEATED_OFFICE:    { sensible: 245, latent: 205 }, // sedentary / office
    STANDING_LIGHT:   { sensible: 275, latent: 305 }, // cleanroom operator
    WALKING_MODERATE: { sensible: 305, latent: 545 }, // active lab / pharma
    HEAVY_WORK:       { sensible: 580, latent: 870 }, // industrial assembly
  },

  // ── Ventilation — ASHRAE 62.1-2022, Table 6-1 ────────────────────────────
  // Rp (per-person) — office/general occupancy:
  VENT_PEOPLE_CFM:   5,          // cfm/person — office (Rp)
  VENT_AREA_CFM:     0.06,       // cfm/ft² — general manufacturing (Ra)
  // Critical facility Ra overrides (apply per-room via ventCategory):
  // NOTE INFO-03: ventilation.js uses ra: 0.18 for semicon (ASHRAE 62.1 OA basis).
  // VENT_AREA_SEMICON here is 0.06 (recirculation-governed basis). These serve
  // different purposes — document the distinction clearly in ventilation.js.
  VENT_AREA_PHARMA:  0.18,       // cfm/ft² — pharma/bio hazardous process
  VENT_AREA_BATTERY: 0.12,       // cfm/ft² — battery manufacturing
  VENT_AREA_SEMICON: 0.06,       // cfm/ft² — semiconductor (recirculation governs)

  // ── System Design Defaults ────────────────────────────────────────────────
  DEFAULT_SAFETY_FACTOR_PCT: 10,
  DEFAULT_BYPASS_FACTOR:     0.10,
  DEFAULT_ADP:               55, // °F — general occupancy apparatus dew point
  DEFAULT_ADP_SEMICON:       47, // °F — semiconductor fab
  DEFAULT_ADP_PHARMA:        44, // °F — pharma sterile
  DEFAULT_ADP_BATTERY:       38, // °F — Li-ion battery manufacturing
  DEFAULT_FAN_HEAT_PCT:       5,

  // ── Diversity & Safety Factors ────────────────────────────────────────────
  PROCESS_DIVERSITY_FACTOR:  0.75, // 75% simultaneous demand on process loads (HIGH-02: wire into seasonalLoads)
  PROCESS_SAFETY_FACTOR:     1.25, // 25% safety margin for GMP/pharma rooms (HIGH-03: wire into seasonalLoads)
  LIGHTING_BALLAST_FACTOR:   1.0,  // LED default; use 1.2 for T8 fluorescent (HIGH-05: wire into seasonalLoads)
  DUCT_HEAT_GAIN_PCT:        0.05, // 5% duct heat gain — ASHRAE 90.1 (LOW-05: wire into rdsSelector)

  // FIX HIGH-01: Updated to match MOTOR_HEAT_FRACTIONS.MOTOR_OUT_SPACE (was 0.25).
  // MED-07: This default is still unused — wire MOTOR_HEAT_FRACTIONS into
  // seasonalLoads.js equipment calculation with a motorLocation field on the
  // equipment config: 'in_space' | 'out_space' | 'in_airstream'.
  MOTOR_LOAD_FACTOR: 0.88, // default: motor outside, equipment inside (shaft power only)
};

export default ASHRAE;