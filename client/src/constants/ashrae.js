/**
 * ASHRAE Constants & Conversion Factors
 * Reference: ASHRAE Handbook - Fundamentals (2021)
 */
const ASHRAE = {
  // ── Conversion Factors ──────────────────────────────────────────────────
  M2_TO_FT2: 10.7639,
  BTU_PER_WATT: 3.412,
  KW_TO_BTU: 3412,

  // ── Psychrometrics ──────────────────────────────────────────────────────
  BTU_PER_TON: 12000,
  SENSIBLE_FACTOR: 1.08, // Qs = 1.08 x CFM x dT
  LATENT_FACTOR: 0.68,   // Ql = 0.68 x CFM x dGr

  // ── People Loads (BTU/hr) - Table 1, Ch 18 ─────────────────────────────
  PEOPLE_SENSIBLE_SEATED: 245,
  PEOPLE_LATENT_SEATED: 205,

  // ── Ventilation Defaults (ASHRAE 62.1) ─────────────────────────────────
  VENT_PEOPLE_CFM: 5,  
  VENT_AREA_CFM: 0.06, 

  // ── System Design Defaults ─────────────────────────────────────────────
  DEFAULT_SAFETY_FACTOR_PCT: 10,
  DEFAULT_BYPASS_FACTOR: 0.10,
  DEFAULT_ADP: 55, // Apparatus Dew Point
  DEFAULT_FAN_HEAT_PCT: 5,
};

export default ASHRAE;