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
 */
const ASHRAE = {

  // ── Unit Conversions ──────────────────────────────────────────────────────
  M2_TO_FT2:      10.7639,
  BTU_PER_WATT:   3.412,        // 1 W = 3.412 BTU/hr
  KW_TO_BTU:      3412,         // 1 kW = 3412 BTU/hr
  BTU_PER_TON:    12000,        // 1 TR = 12,000 BTU/hr
  GR_PER_LB:      7000,         // 7,000 grains = 1 lb water vapor (NEW)
  W_PER_FT2_TO_BTU: 3.412,      // W/ft² → BTU/hr·ft² (NEW)

  // ── Psychrometric Factors (sea-level) ─────────────────────────────────────
  SENSIBLE_FACTOR: 1.08,        // Qs = 1.08 × CFM × ΔT°F
  LATENT_FACTOR:   0.68,        // Ql = 0.68 × CFM × Δgr/lb  ← grains/lb only
  LATENT_FACTOR_LB: 4840,       // Ql = 4840 × CFM × Δlb/lb  ← lb/lb ratio (NEW)

  // ── People Loads BTU/hr — ASHRAE HOF 2021 Table 1, Ch.18 ─────────────────
  // Legacy single values kept for backward compatibility:
  PEOPLE_SENSIBLE_SEATED: 245,
  PEOPLE_LATENT_SEATED:   205,
  // Full activity table for critical facility use (NEW):
  PEOPLE_LOADS: {
    SEATED_OFFICE:    { sensible: 245, latent: 205 }, // office / sedentary
    STANDING_LIGHT:   { sensible: 275, latent: 305 }, // cleanroom operator
    WALKING_MODERATE: { sensible: 305, latent: 545 }, // active lab / pharma
    HEAVY_WORK:       { sensible: 580, latent: 870 }, // industrial assembly
  },

  // ── Ventilation — ASHRAE 62.1-2022, Table 6-1 ────────────────────────────
  VENT_PEOPLE_CFM: 5,           // Rp — per-person (cfm/person)
  VENT_AREA_CFM:   0.06,        // Ra — area component (cfm/ft²) — general mfg
  // Critical facility overrides (applied per-room via roomSlice.ventCategory):
  VENT_AREA_PHARMA:  0.18,      // cfm/ft² — pharma/bio (hazardous process) (NEW)
  VENT_AREA_BATTERY: 0.12,      // cfm/ft² — battery mfg (NEW)
  VENT_AREA_SEMICON: 0.06,      // cfm/ft² — semiconductor fab (recirculation governs)

  // ── System Design Defaults ────────────────────────────────────────────────
  DEFAULT_SAFETY_FACTOR_PCT: 10,
  DEFAULT_BYPASS_FACTOR:     0.10,
  DEFAULT_ADP:               55,   // General — override per facility type
  DEFAULT_ADP_SEMICON:       47,   // Semiconductor fab (NEW)
  DEFAULT_ADP_PHARMA:        44,   // Pharma sterile (NEW)
  DEFAULT_ADP_BATTERY:       38,   // Li-ion battery mfg (NEW)
  DEFAULT_FAN_HEAT_PCT:       5,

  // ── Diversity & Safety Factors (NEW) ─────────────────────────────────────
  PROCESS_DIVERSITY_FACTOR:  0.75, // 75% simultaneous demand on process loads
  PROCESS_SAFETY_FACTOR:     1.25, // 25% safety margin on process loads (GMP)
  LIGHTING_BALLAST_FACTOR:   1.0,  // LED fixture (use 1.2 for T8 fluorescent)
  DUCT_HEAT_GAIN_PCT:        0.05, // 5% duct heat gain, ASHRAE 90.1 (NEW)
  MOTOR_LOAD_FACTOR:         0.25, // fraction of motor heat to conditioned space

};

export default ASHRAE;