/**
 * ASHRAE Constants & Conversion Factors
 * Reference: ASHRAE Handbook — Fundamentals (2021)
 *            ASHRAE 62.1-2022 (Ventilation)
 *            ASHRAE 90.1-2022 (Energy)
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   BUG-TIER1-03 FIX: VENT_AREA_BATTERY corrected 0.12 → 0.18
 *                      VENT_AREA_SEMICON  corrected 0.06 → 0.18
 *
 *     Both battery manufacturing and semiconductor fab rooms are classified as
 *     "Laboratory — Chemical" under ASHRAE 62.1-2022 Table 6-1, which mandates
 *     ra = 0.18 CFM/ft². The previous values were incorrect:
 *
 *       VENT_AREA_BATTERY: 0.12 → 33% below the 62.1 minimum
 *       VENT_AREA_SEMICON: 0.06 → the OFFICE area rate, not Lab-Chemical;
 *                                  67% below the 62.1 minimum — a critical
 *                                  compliance failure for NFPA 318 / SEMI S2-0200
 *                                  exhaust make-up sizing.
 *
 *     The authoritative values in ventilation.js (ra = 0.18 for both 'battery'
 *     and 'semicon') were already correct and consistent with ASHRAE 62.1-2022.
 *     This file now agrees with ventilation.js.
 *
 *     ⚠️  ACTION REQUIRED: search the codebase for every import of
 *         VENT_AREA_BATTERY and VENT_AREA_SEMICON. If any caller uses these
 *         constants directly as the sole OA sizing basis (rather than calling
 *         calculateVbz() from ventilation.js), it will now produce higher
 *         OA quantities — which is the correct, compliant result.
 *
 *     Preferred pattern for all new code:
 *       import { calculateVbz, calculateMinAchCfm } from '../constants/ventilation';
 *       const vbz = calculateVbz(ventCategory, pplCount, floorAreaFt2);
 *     These constants are retained only for backward compatibility with
 *     components not yet migrated to ventilation.js.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   HIGH-02 FIX: DEFAULT_ADP_BATTERY and DEFAULT_BYPASS_FACTOR_BATTERY removed.
 *
 *     Li-ion battery dry rooms, pharmaceutical dry powder lines, and other
 *     sub-10%RH facilities use DESICCANT DEHUMIDIFIERS, not cooling coils.
 *     The Apparatus Dew Point (ADP) and Bypass Factor are cooling-coil sizing
 *     parameters — they have no physical meaning for desiccant systems.
 *
 *     Storing ADP=38°F for battery implies a cooling coil can achieve the
 *     required dew point. At 38°F ADP, the achievable room RH at 70°F is
 *     approximately 42%RH — four to one hundred times too wet for Li-ion
 *     assembly (target: −30°C to −40°C DP / 0.4–1.5%RH).
 *
 *     Replaced with desiccant process defaults (see below). Cooling ADP/BF
 *     values for semicon and pharma clean cooling systems are retained.
 *
 *   HIGH-03 FIX: LATENT_FACTOR_LB corrected 4760 → 4775.
 *
 *     The file's own derivation:
 *       0.075 lb/ft³ × 60 min/hr × 1061 BTU/lb = 4774.5 ≈ 4775
 *     The stored value (4760) was 14.5 BTU/hr·CFM/(lb/lb) low.
 *     At 100,000 CFM in a Li-ion dry room winter humidification calc,
 *     this understated the humidification load by ~1,440 BTU/hr.
 *
 *   LOW-02 FIX: KW_TO_BTU marked @deprecated — name implies energy (BTU),
 *     not power (BTU/hr). Value is correct. New code must use
 *     KW_TO_BTU_HR from utils/units.js.
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-SL-01 ROOT CAUSE DOCUMENTED HERE:
 *
 *   This file exports SENSIBLE_FACTOR_SEA_LEVEL and LATENT_FACTOR_SEA_LEVEL.
 *   It does NOT export SENSIBLE_FACTOR or LATENT_FACTOR (no _SEA_LEVEL suffix).
 *
 *   seasonalLoads.js was referencing ASHRAE.SENSIBLE_FACTOR — which is
 *   UNDEFINED in this object. The silent propagation:
 *     ASHRAE.SENSIBLE_FACTOR → undefined → NaN → all downstream: NaN
 *
 *   FIX: all load calc files import sensibleFactor(elevFt) / latentFactor(elevFt)
 *   directly from psychro.js. These cannot be undefined.
 *
 *   TO PREVENT RECURRENCE: Do NOT add SENSIBLE_FACTOR or LATENT_FACTOR aliases
 *   here. The psychro.js functions are the only correct entry point for altitude-
 *   corrected psychrometric factors.
 *
 * ── ALTITUDE DEPENDENCY NOTE ─────────────────────────────────────────────────
 *
 * SENSIBLE_FACTOR_SEA_LEVEL (1.08) and LATENT_FACTOR_SEA_LEVEL (0.68) are
 * valid ONLY at sea level (29.921 inHg, ~70°F).
 *
 * ⚠️  NEVER use _SEA_LEVEL constants directly in load calculations.
 *     Always use:  sensibleFactor(elev_ft)   from utils/psychro.js
 *                  latentFactor(elev_ft)      from utils/psychro.js
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

  M2_TO_FT2:       10.7639,
  BTU_PER_WATT:    3.41214,

  /**
   * @deprecated Use KW_TO_BTU_HR from utils/units.js for new code.
   *
   * LOW-02 FIX: Name "KW_TO_BTU" implies energy (BTU) not power (BTU/hr).
   * The value 3412.14 is correct for a power conversion (1 kW = 3412.14 BTU/hr).
   * Retained for backward compatibility with components not yet migrated to units.js.
   * Do NOT use in new load calculation code — import kwToBtuHr from utils/units.js.
   */
  KW_TO_BTU:       3412.14,

  BTU_PER_TON:     12000,
  GR_PER_LB:       7000,
  W_PER_FT2_TO_BTU: 3.41214,

  // ──────────────────────────────────────────────────────────────────────────
  // PSYCHROMETRIC FACTORS (sea-level basis)
  //
  // ⚠️  DO NOT reference ASHRAE.SENSIBLE_FACTOR or ASHRAE.LATENT_FACTOR —
  //     these do NOT exist (no alias without _SEA_LEVEL suffix).
  //     Use sensibleFactor(elev_ft) / latentFactor(elev_ft) from psychro.js.
  // ──────────────────────────────────────────────────────────────────────────

  LATENT_HFG_BTU_LB:         1061,   // hfg at 60°F dewpoint (correct coil ref)

  SENSIBLE_FACTOR_SEA_LEVEL:  1.08,  // Qs = 1.08 × CFM × ΔT°F  (sea level only)
  LATENT_FACTOR_SEA_LEVEL:    0.68,  // Ql = 0.68 × CFM × Δgr/lb (sea level only)

  /**
   * LATENT_FACTOR_LB — HIGH-03 FIX: corrected 4760 → 4775.
   *
   * Derivation (ASHRAE HOF 2021, Ch.1):
   *   air density sea level, 70°F ≈ 0.075 lb/ft³
   *   hfg at 60°F dewpoint = 1061 BTU/lb  (ASHRAE HOF 2021 Ch.1)
   *   LATENT_FACTOR_LB = 0.075 × 60 min/hr × 1061 = 4774.5 → 4775
   *
   * Previous value 4760 implied hfg = 4760 / (0.075 × 60) = 1057.8 BTU/lb.
   * No ASHRAE reference supports that value. The correct hfg at 60°F DP is 1061.
   *
   * Impact: 14.5 BTU/hr·CFM/(lb/lb) low. For a 100,000 CFM Li-ion dry room
   * winter humidification load: 1,440 BTU/hr understated. Systematic across
   * all projects using this constant.
   */
  LATENT_FACTOR_LB:           4775,  // HIGH-03 FIX: was 4760 — see derivation above

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
  // ──────────────────────────────────────────────────────────────────────────

  VENT_PEOPLE_CFM:     5,
  VENT_AREA_CFM:       0.06,
  VENT_AREA_PHARMA:    0.18,

  /**
   * BUG-TIER1-03 FIX: corrected from 0.12 → 0.18.
   *
   * Battery manufacturing rooms (Li-ion electrode, cell assembly, formation)
   * are classified as "Laboratory — Chemical" under ASHRAE 62.1-2022 Table 6-1:
   *   ra = 0.18 CFM/ft²  (not 0.12)
   *
   * The previous 0.12 value understated outdoor air by 33%. For a 50,000 ft²
   * Li-ion formation bay, the shortfall was 3,000 CFM OA — a compliance gap
   * against ASHRAE 62.1 and NFPA 855 §15 exhaust make-up requirements.
   *
   * This value now agrees with ventilation.js 'battery' category ra: 0.18.
   * ⚠️  Prefer calculateVbz('battery', ...) from ventilation.js for all new code.
   */
  VENT_AREA_BATTERY:   0.18,   // BUG-TIER1-03 FIX: was 0.12 — ASHRAE 62.1-2022 Lab-Chemical

  /**
   * BUG-TIER1-03 FIX: corrected from 0.06 → 0.18.
   *
   * Semiconductor fab rooms are "Laboratory — Chemical" under ASHRAE 62.1-2022
   * Table 6-1: ra = 0.18 CFM/ft². The previous 0.06 was the general OFFICE
   * area rate — it does not appear in any semiconductor facility standard.
   *
   * Consequence of the previous value: for a 100,000 ft² fab floor,
   * OA was undersized by 12,000 CFM — a 67% shortfall vs 62.1 minimum.
   * This would fail NFPA 318 exhaust make-up review and SEMI S2-0200 §12.
   *
   * This value now agrees with ventilation.js 'semicon' category ra: 0.18.
   * ⚠️  Prefer calculateVbz('semicon', ...) from ventilation.js for all new code.
   */
  VENT_AREA_SEMICON:   0.18,   // BUG-TIER1-03 FIX: was 0.06 — ASHRAE 62.1-2022 Lab-Chemical

  // ──────────────────────────────────────────────────────────────────────────
  // COIL & SYSTEM DESIGN DEFAULTS
  // ──────────────────────────────────────────────────────────────────────────

  DEFAULT_SAFETY_FACTOR_PCT:     10,
  DEFAULT_FAN_HEAT_PCT:           5,

  // Coil bypass factor — applies only to cooling-coil systems.
  // ⚠️  Li-ion battery dry rooms use desiccant dehumidifiers, not cooling coils.
  //     Do not apply ADP/BF to battery dry room design. See desiccant defaults below.
  DEFAULT_BYPASS_FACTOR:         0.10,  // General HVAC
  DEFAULT_BYPASS_FACTOR_SEMICON: 0.05,  // Semiconductor fab (chilled water coil)
  DEFAULT_BYPASS_FACTOR_PHARMA:  0.06,  // Pharma sterile / ISO-classified

  // Apparatus Dew Point (ADP) — cooling-coil systems only.
  // ⚠️  Not applicable for desiccant-based dry rooms (battery, dry powder pharma).
  DEFAULT_ADP:                   55,    // General occupancy
  DEFAULT_ADP_SEMICON:           47,    // Semiconductor fab
  DEFAULT_ADP_PHARMA:            44,    // Pharma sterile

  // ── HIGH-02 FIX: Battery desiccant system defaults ─────────────────────────
  //
  // Li-ion battery dry rooms (and sub-10%RH pharma filling rooms) require
  // DESICCANT DEHUMIDIFICATION systems, not chilled-water cooling coils.
  //
  // The previous DEFAULT_ADP_BATTERY: 38 and DEFAULT_BYPASS_FACTOR_BATTERY: 0.08
  // were removed because:
  //   1. ADP of 38°F → achievable room RH ≈ 42% at 70°F (far too wet for Li-ion).
  //   2. Bypass Factor is a cooling-coil concept; desiccant wheels are sized by
  //      moisture removal capacity (kg H₂O / kg desiccant), face velocity,
  //      and reactivation temperature — not by ADP or BF.
  //   3. Using these values would cause the cooling plant to be selected and
  //      sized for battery dry rooms, omitting the desiccant system entirely.
  //
  // Desiccant design workflow:
  //   1. Establish target DP: grainsFromDewPoint(targetDpF) → target gr/lb
  //   2. Compute moisture removal load (lb/hr): heatingHumid.js
  //   3. Size desiccant wheel using DESICCANT_LEAVING_DP_F and DESICCANT_PROCESS_TEMP_F
  //   4. Size reactivation heater: process air mass flow × cp × (process temp − inlet)
  //   5. Size after-cooler (desiccant leaving air is hot): sensibleFactor × CFM × ΔT
  //
  // Reference: ASHRAE HVAC Systems & Equipment 2020, Ch.24 (Desiccant Dehumidification)
  //            Munters technical guide (Industrial Dry Room Design)
  //            SEMI S2-0200: environmental control for semiconductor manufacturing
  //
  // Standard Li-ion leaving-air targets by facility type:
  //   Electrode slurry / coating:    −20°C DP (≈ −4°F) → ~5%RH at 70°F
  //   Cell assembly (mainstream):    −40°C DP (≈ −40°F) → ~0.4%RH at 70°F
  //   Cell assembly (conservative):  −45°C DP (≈ −49°F) → ~0.2%RH at 70°F
  //   Solid-state sulfide:           −60°C DP (≈ −76°F) → beyond this tool's range

  DEFAULT_DESICCANT_LEAVING_DP_F:  -40,  // °F frost point — mainstream Li-ion cell assembly
                                          // = −40°C DP (CATL/Panasonic/Samsung SDI standard)
                                          // For electrode coating only: use −4°F (−20°C)
                                          // For solid-state: specialist tool required

  DEFAULT_DESICCANT_PROCESS_TEMP_F: 250, // °F — typical desiccant reactivation (gas/steam)
                                          // Range: 230–300°F depending on wheel type
                                          // Silica gel: 230–280°F; molecular sieve: 300–350°F

  // ──────────────────────────────────────────────────────────────────────────
  // DIVERSITY, SAFETY & CORRECTION FACTORS
  // ──────────────────────────────────────────────────────────────────────────

  // FIX HIGH-07: PROCESS_DIVERSITY_FACTOR is a FALLBACK ONLY.
  // When equipment.diversityFactor is set from EQUIPMENT_LOAD_DENSITY in
  // ashraeTables.js, use that value exclusively — do NOT also multiply by this.
  PROCESS_DIVERSITY_FACTOR:  0.75,

  PROCESS_SAFETY_FACTOR:     1.25,
  LIGHTING_BALLAST_FACTOR:   1.0,
  DUCT_HEAT_GAIN_PCT:        0.05,
  MOTOR_LOAD_FACTOR:         0.88,

};

export default ASHRAE;