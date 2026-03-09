/**
 * seasonalLoads.js
 * Responsibility: Per-room, per-season sensible and latent load calculation.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ASHRAE 62.1-2022 (Ventilation Rate Procedure)
 *            ISPE Baseline Guide Vol.5 — Pharmaceutical Cleanrooms
 *            GMP Annex 1:2022 §4.23 — HVAC safety margins
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-SL-01 [CRITICAL ★]: ASHRAE.SENSIBLE_FACTOR undefined → NaN cascade.
 *
 *     Root cause: ashrae.js exports SENSIBLE_FACTOR_SEA_LEVEL and
 *     LATENT_FACTOR_SEA_LEVEL. It does NOT export SENSIBLE_FACTOR or
 *     LATENT_FACTOR. Referencing a missing key on a JS object returns
 *     undefined silently, not an error.
 *
 *     Old code:
 *       const Cs = ASHRAE.SENSIBLE_FACTOR * altCf;  // undefined → NaN
 *       const Cl = ASHRAE.LATENT_FACTOR   * altCf;  // undefined → NaN
 *
 *     NaN propagation (the critical JavaScript trap):
 *       NaN * 0     = NaN  (NOT 0 — this surprises most engineers)
 *       100 + NaN   = NaN
 *       Math.round(NaN) = NaN
 *
 *     Result: infilSens = NaN regardless of infilCFM value.
 *             rawSensible = NaN → ersh = NaN → supplyAir = NaN →
 *             cooling tons = NaN → all RDS rows = NaN.
 *             EVERY room in the application was producing NaN results.
 *
 *     Fix: import sensibleFactor(elevation) and latentFactor(elevation)
 *     directly from psychro.js. These functions always return a valid
 *     number (1.08 × Cf and 0.68 × Cf respectively) and cannot be undefined.
 *     This is the same fix already applied to heatingHumid.js and
 *     outdoorAirLoad.js for the same underlying naming issue.
 *
 *   BUG-SL-02 [LOW]: ASHRAE.KW_TO_BTU replaced with KW_TO_BTU_HR from units.js.
 *     ASHRAE.KW_TO_BTU has the correct value (3412.14) but the name 'BTU'
 *     implies energy rather than power (BTU/hr). Importing KW_TO_BTU_HR from
 *     units.js makes the unit explicit and consistent with all other fixed files.
 *
 *   BUG-SL-03 [LOW]: Local cToF() removed — was a duplicate of utils/units.js.
 *     The local version was: (parseFloat(c) * 9) / 5 + 32
 *     The units.js version uses a null-safe guard and returns null for invalid
 *     input. The call site already has an isNaN guard, so behaviour is identical.
 *     Import from units.js for a single implementation across the codebase.
 *
 *   BUG-SL-04 [CONFIRMED NOT A BUG]: FIX HIGH-07 double diversity.
 *     ashraeTables.js warns about compounding PROCESS_DIVERSITY_FACTOR with
 *     per-type diversityFactor. The ?? (nullish coalescing) operator ensures
 *     only ONE is applied — per-type if equipment.diversityFactor is set,
 *     global fallback if not. These are mutually exclusive. No change needed.
 *
 * ── LOAD COMPONENTS (all in BTU/hr) ──────────────────────────────────────────
 *
 *   Sensible:
 *     1. Envelope        — CLTD/CLF method via envelopeCalc.js
 *     2. People          — sensiblePerPerson × count (HOF Ch.18 Table 1)
 *     3. Lighting        — W/ft² × area × BTU_PER_WATT × schedFactor × ballastFactor
 *     4. Equipment       — kW × KW_TO_BTU_HR × sensibleFraction × diversityFactor
 *     5. Infiltration    — Cs × CFM × ΔT°F
 *
 *   Latent:
 *     1. People          — latentPerPerson × count
 *     2. Equipment       — kW × KW_TO_BTU_HR × latentFraction × diversityFactor
 *     3. Infiltration    — Cl × CFM × Δgr/lb
 *
 * ── SAFETY FACTOR POLICY (FIX MED-06) ───────────────────────────────────────
 *
 *   safetyMult applied to ERSH only (sensible room load).
 *   erlh = rawLatent — no safety factor on latent load.
 *   Applying a safety factor to latent distorts SHR and coil selection.
 *   ASHRAE methodology: safety factors are applied at equipment selection,
 *   not at the load calculation level.
 *   GMP rooms: additional PROCESS_SAFETY_FACTOR (1.25×) on sensible per
 *   ISPE Baseline Guide Vol.5 / GMP Annex 1:2022 §4.23.
 *
 * ── UNIT CONVENTIONS ─────────────────────────────────────────────────────────
 *
 *   Temperatures  — °F throughout (room designTemp converted from °C here)
 *   Humidity      — gr/lb
 *   Airflow       — CFM
 *   Area          — ft²  (converted from m² at call site)
 *   Volume        — ft³  (converted from m³ at call site)
 *
 * ── SIGN CONVENTION ──────────────────────────────────────────────────────────
 *
 *   Positive = heat INTO conditioned space (cooling load)
 *   Negative = heat OUT of conditioned space (heating load / heat loss)
 */

import { calculateGrains, sensibleFactor, latentFactor } from '../../utils/psychro';
import { cToF, KW_TO_BTU_HR }                           from '../../utils/units';
import ASHRAE                                            from '../../constants/ashrae';
import { calcTotalEnvelopeGain }                         from '../../utils/envelopeCalc';

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * calculateSeasonLoad()
 *
 * Computes the full sensible and latent cooling/heating load for one room
 * in one season. Returns a rich object consumed by rdsSelector.js.
 *
 * @param {object} room           - room state from roomSlice
 * @param {object} envelope       - envelope state for this room from envelopeSlice
 * @param {object} climate        - full climate state (state.climate)
 * @param {string} season         - 'summer' | 'monsoon' | 'winter'
 * @param {object} systemDesign   - state.project.systemDesign
 * @param {number} altCf          - altitude correction factor (dimensionless, 0–1)
 * @param {number} elevation      - site elevation (ft) — used for Patm-corrected gr
 * @param {number} floorAreaFt2   - room floor area in ft² (pre-converted from m²)
 * @param {number} volumeFt3      - room volume in ft³ (pre-converted from m³)
 * @param {number} [latitude=28]  - project latitude (decimal degrees)
 * @param {number} [dailyRange=0] - full daily DB swing (°F). 0 = use CLTD defaults.
 *
 * @returns {{
 *   ersh:            number,  Effective Room Sensible Heat (BTU/hr), safety-adjusted
 *   erlh:            number,  Effective Room Latent Heat (BTU/hr), no safety factor
 *   grains:          string,  indoor gr/lb toFixed(1) for RDS display
 *   dbInF:           number,  room design dry-bulb (°F)
 *   grIn:            number,  indoor humidity ratio (gr/lb)
 *   grOut:           number,  outdoor humidity ratio (gr/lb) at site elevation
 *   envelopeGain:    number,  envelope sensible subtotal (BTU/hr), signed
 *   pplSens:         number,  people sensible subtotal (BTU/hr)
 *   pplLat:          number,  people latent subtotal (BTU/hr)
 *   lightsSens:      number,  lighting sensible subtotal (BTU/hr)
 *   equipSens:       number,  equipment sensible subtotal (BTU/hr)
 *   equipLatent:     number,  equipment latent subtotal (BTU/hr)
 *   infilSens:       number,  infiltration sensible subtotal (BTU/hr), signed
 *   infilLat:        number,  infiltration latent subtotal (BTU/hr), ≥ 0
 *   infilCFM:        number,  infiltration airflow (CFM)
 *   rawSensible:     number,  all sensible components summed, before safety
 *   rawLatent:       number,  all latent components summed, before safety
 *   safetyMult:      number,  safety factor multiplier (e.g. 1.10)
 *   gmpSafetyMult:   number,  GMP safety actually applied (1.0 or 1.25)
 * }}
 */
export const calculateSeasonLoad = (
  room,
  envelope,
  climate,
  season,
  systemDesign,
  altCf,
  elevation,
  floorAreaFt2,
  volumeFt3,
  latitude   = 28,
  dailyRange = 0,
) => {
  const env = envelope || { internalLoads: {}, infiltration: {} };
  const int = env.internalLoads || {};
  const inf = env.infiltration  || {};

  // ── Outdoor conditions ──────────────────────────────────────────────────────
  const outdoor = climate?.outside?.[season] || { db: 95, rh: 40 };
  const dbOut   = parseFloat(outdoor.db) || 95;
  const ambRH   = parseFloat(outdoor.rh) || 0;

  // Outdoor grains at site elevation (not sea level — Patm affects humidity ratio).
  const grOut = calculateGrains(dbOut, ambRH, elevation);

  // ── Indoor conditions ───────────────────────────────────────────────────────
  // designTemp stored in °C in roomSlice. cToF() from units.js returns null on
  // invalid input — fall back to 72°F if not set.
  const dbInFRaw = cToF(room.designTemp);
  const dbInF    = dbInFRaw === null ? 72 : dbInFRaw;

  const rhIn = parseFloat(room.designRH) || 50;
  const grIn = calculateGrains(dbInF, rhIn, elevation);

  // ── Altitude-corrected psychrometric factors ────────────────────────────────
  // BUG-SL-01 FIX: Import sensibleFactor() / latentFactor() from psychro.js.
  // These functions return 1.08 × Cf and 0.68 × Cf respectively for the given
  // elevation. They cannot return undefined or NaN on valid numeric input.
  //
  // REPLACED:
  //   const Cs = ASHRAE.SENSIBLE_FACTOR * altCf;  ← ASHRAE.SENSIBLE_FACTOR = undefined → NaN
  //   const Cl = ASHRAE.LATENT_FACTOR   * altCf;  ← ASHRAE.LATENT_FACTOR   = undefined → NaN
  const Cs = sensibleFactor(elevation);   // BUG-SL-01 FIX
  const Cl = latentFactor(elevation);     // BUG-SL-01 FIX

  // ── 1. Envelope gain ────────────────────────────────────────────────────────
  const envelopeGain = calcTotalEnvelopeGain(
    env.elements,
    climate,
    dbInF,
    season,
    latitude,
    dailyRange,
  );

  // ── 2. People (ASHRAE HOF 2021 Ch.18 Table 1) ──────────────────────────────
  // CLF = 1.0 assumed — occupants present 100% of occupied hours.
  // For 24/7 semiconductor / pharma operations this is correct.
  // For part-time occupancy spaces, add a CLF schedule per HOF Ch.18 Table 3.
  const pplCount = parseFloat(int.people?.count) || 0;
  const pplSens  = pplCount * (int.people?.sensiblePerPerson ?? ASHRAE.PEOPLE_SENSIBLE_SEATED);
  const pplLat   = pplCount * (int.people?.latentPerPerson   ?? ASHRAE.PEOPLE_LATENT_SEATED);

  // ── 3. Lighting ─────────────────────────────────────────────────────────────
  // FIX HIGH-04: schedFactor applies useSchedule (0–100%) as operating fraction.
  // Previously useSchedule was stored but never read — lights always ran at 100%.
  const schedFactor = (parseFloat(int.lights?.useSchedule) ?? 100) / 100;

  // FIX HIGH-05: ballastFactor per ASHRAE HOF 2021 Ch.18 Table 2.
  // Previously LIGHTING_BALLAST_FACTOR was defined in ashrae.js but never used.
  // Default: 1.0 (LED). T8 fluorescent = 1.2, T5 = 1.15.
  const ballastFactor = parseFloat(int.lights?.ballastFactor) || ASHRAE.LIGHTING_BALLAST_FACTOR;

  const lightsSens = (parseFloat(int.lights?.wattsPerSqFt) || 0)
    * floorAreaFt2
    * ASHRAE.BTU_PER_WATT
    * schedFactor     // FIX HIGH-04
    * ballastFactor;  // FIX HIGH-05

  // ── 4. Equipment ───────────────────────────────────────────────────────────
  // FIX HIGH-02: Diversity factor applied.
  // FIX HIGH-07 (CONFIRMED CORRECT): ?? operator ensures EITHER per-type
  // diversityFactor from EQUIPMENT_LOAD_DENSITY OR the global fallback
  // PROCESS_DIVERSITY_FACTOR is used — never both. See ashrae.js note.
  //
  // BUG-SL-02 FIX: ASHRAE.KW_TO_BTU replaced with KW_TO_BTU_HR from units.js.
  // Numerically identical (both 3412.14) — this is a naming consistency fix.
  const equipKW         = parseFloat(int.equipment?.kw)           || 0;
  const equipSensPct    = (parseFloat(int.equipment?.sensiblePct) ?? 100) / 100;
  const equipLatPct     = (parseFloat(int.equipment?.latentPct)   ?? 0)   / 100;
  const diversityFactor = parseFloat(int.equipment?.diversityFactor)
    ?? ASHRAE.PROCESS_DIVERSITY_FACTOR;   // FIX HIGH-07: ?? = per-type OR global, never both

  const equipSens   = equipKW * KW_TO_BTU_HR * equipSensPct * diversityFactor;  // BUG-SL-02 FIX
  const equipLatent = equipKW * KW_TO_BTU_HR * equipLatPct  * diversityFactor;  // BUG-SL-02 FIX

  // MED-07 NOTE: MOTOR_HEAT_FRACTIONS is defined in ashrae.js but not yet
  // wired in. When motorLocation is added to equipment config, replace
  // equipSensPct with MOTOR_HEAT_FRACTIONS[motorLocation].

  // ── 5. Infiltration ────────────────────────────────────────────────────────
  // CFM_inf = (Volume_ft³ × ACH_inf) / 60
  // Q_s = Cs × CFM × (T_out − T_in)         [signed — neg if outdoor < indoor]
  // Q_l = Cl × CFM × (gr_out − gr_in)        [floored at 0 for cooling season]
  //
  // Cs and Cl are now valid numbers (BUG-SL-01 FIX). Previously:
  //   Cs = NaN → infilSens = NaN → rawSensible = NaN → ersh = NaN
  //   NaN * 0 = NaN, so even zero-infiltration rooms were corrupted.
  const achValue  = parseFloat(inf.achValue) || 0;
  const infilCFM  = (volumeFt3 * achValue) / 60;
  const infilSens = Cs * infilCFM * (dbOut - dbInF);
  const infilLat  = Cl * infilCFM * Math.max(0, grOut - grIn);

  // ── Totals ──────────────────────────────────────────────────────────────────
  const rawSensible = envelopeGain + pplSens + lightsSens + equipSens + infilSens;
  const rawLatent   = pplLat + equipLatent + infilLat;

  // ── Safety factors (sensible only — FIX MED-06) ────────────────────────────
  // safetyMult: user-configured safety factor (default 10%)
  // gmpSafetyMult: 1.25× for pharma rooms per ISPE / GMP Annex 1 (FIX HIGH-03)
  //
  // erlh deliberately excludes safetyMult — see policy note in file header.
  const safetyMult = 1 + (parseFloat(systemDesign?.safetyFactor) || 10) / 100;

  const gmpSafetyMult = (room.ventCategory === 'pharma')
    ? ASHRAE.PROCESS_SAFETY_FACTOR   // FIX HIGH-03: 1.25×
    : 1.0;

  const ersh = Math.round(rawSensible * safetyMult * gmpSafetyMult);
  const erlh = Math.round(rawLatent);   // FIX MED-06: no safetyMult on latent

  return {
    // Primary outputs consumed by rdsSelector
    ersh,
    erlh,

    // Psychrometric state
    grains: grIn.toFixed(1),
    dbInF,
    grIn,
    grOut,

    // Load component breakdown — for Equipment ON/OFF delta display
    envelopeGain,
    pplSens,
    pplLat,
    lightsSens,
    equipSens,
    equipLatent,
    infilSens,
    infilLat,
    infilCFM,

    // Pre-safety totals — used by downstream selectors
    rawSensible,
    rawLatent,

    // Safety multipliers — carried forward for rdsSelector equipment sizing
    safetyMult,
    gmpSafetyMult,
  };
};