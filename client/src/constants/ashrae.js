/**
 * ASHRAE Constants & Conversion Factors
 * Reference: ASHRAE Handbook — Fundamentals (2021)
 *
 * IMPORTANT — Altitude dependency:
 * SENSIBLE_FACTOR (1.08) and LATENT_FACTOR (0.68) are valid at sea level
 * (29.921 inHg, ~70°F). At elevation these MUST be multiplied by the
 * altitude correction factor computed in rdsSelector.js:
 *   Cf = (29.921 × (1 − 6.8754e-6 × elevation_ft)^5.2559) / 29.921
 * Do not use these constants raw in any calculation that involves CFM × ΔT
 * without first applying the Cf correction.
 */
const ASHRAE = {
  // ── Conversion Factors ────────────────────────────────────────────────────
  M2_TO_FT2:   10.7639,
  BTU_PER_WATT: 3.412,   // 1 W = 3.412 BTU/hr
  KW_TO_BTU:   3412,     // 1 kW = 3412 BTU/hr

  // ── Psychrometrics (sea-level, standard atmosphere) ───────────────────────
  BTU_PER_TON:      12000, // 1 TR = 12,000 BTU/hr
  // Qs = SENSIBLE_FACTOR × CFM × ΔT°F  (altitude-correct before use)
  SENSIBLE_FACTOR:  1.08,
  // Ql = LATENT_FACTOR × CFM × Δgr/lb  (altitude-correct before use)
  LATENT_FACTOR:    0.68,

  // ── People Loads (BTU/hr) — ASHRAE Fundamentals Table 1, Ch 18 ───────────
  // Sedentary / office work (nearest applicable for cleanroom operators)
  PEOPLE_SENSIBLE_SEATED: 245,
  PEOPLE_LATENT_SEATED:   205,

  // ── Ventilation Minimums (ASHRAE 62.1-2019, Table 6-1) ───────────────────
  // General office defaults. For ISO cleanrooms the actual design ACPH
  // (set per-room in roomSlice.minAcph / designAcph) governs supply air;
  // these values are used only for the 62.1 fresh-air floor calculation.
  VENT_PEOPLE_CFM: 5,    // Rp — per-person component (cfm/person)
  VENT_AREA_CFM:   0.06, // Ra — area component (cfm/ft²)

  // ── System Design Defaults (overridden by state.project.systemDesign) ─────
  DEFAULT_SAFETY_FACTOR_PCT: 10,
  DEFAULT_BYPASS_FACTOR:     0.10,
  DEFAULT_ADP:               55,  // Apparatus Dew Point (°F)
  DEFAULT_FAN_HEAT_PCT:       5,
};

export default ASHRAE;