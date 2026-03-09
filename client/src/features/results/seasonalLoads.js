/**
 * seasonalLoads.js
 * Responsibility: Per-room, per-season sensible and latent load calculation.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ASHRAE 62.1-2022 (Ventilation Rate Procedure)
 *            ISPE Baseline Guide Vol.5 — Pharmaceutical Cleanrooms
 *            GMP Annex 1:2022 §4.23 — HVAC safety margins
 *
 * LOAD COMPONENTS (all in BTU/hr):
 *
 *   Sensible:
 *     1. Envelope        — CLTD/CLF method via envelopeCalc.js
 *     2. People          — sensiblePerPerson × count (ASHRAE HOF Ch.18 Table 1)
 *     3. Lighting        — W/ft² × area × BTU_PER_WATT × schedFactor × ballastFactor
 *     4. Equipment       — kW × KW_TO_BTU × sensibleFraction × diversityFactor
 *     5. Infiltration    — 1.08 × Cf × CFM × ΔT°F
 *
 *   Latent:
 *     1. People          — latentPerPerson × count
 *     2. Equipment       — kW × KW_TO_BTU × latentFraction × diversityFactor
 *     3. Infiltration    — 0.68 × Cf × CFM × Δgr/lb
 *
 * SAFETY FACTOR POLICY (FIX MED-06):
 *   safetyMult is applied to ERSH only (sensible room load).
 *   erlh = rawLatent (no safety factor on latent) — applying a safety factor
 *   to latent load distorts SHR and coil selection. ASHRAE methodology applies
 *   safety factors at equipment selection, not at the load calculation level.
 *   GMP rooms additionally receive PROCESS_SAFETY_FACTOR (1.25×) on sensible
 *   per ISPE Baseline Guide / GMP Annex 1 requirements.
 *   Fan heat is NOT applied here — system-level addition in rdsSelector.
 *
 * UNIT CONVENTIONS:
 *   Temperatures  — °F throughout (room designTemp converted from °C at call site)
 *   Humidity      — gr/lb
 *   Airflow       — CFM
 *   Area          — ft²  (converted from m² at call site)
 *   Volume        — ft³  (converted from m³ at call site)
 *
 * SIGN CONVENTION (matches envelopeCalc.js):
 *   Positive = heat INTO conditioned space (cooling load)
 *   Negative = heat OUT of conditioned space (heating load / heat loss)
 */

import { calculateGrains } from '../../utils/psychro';
import ASHRAE from '../../constants/ashrae';
import { calcTotalEnvelopeGain } from '../../utils/envelopeCalc';

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Convert Celsius to Fahrenheit. */
const cToF = (c) => (parseFloat(c) * 9) / 5 + 32;

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
 * @param {number} altCf          - altitude correction factor (dimensionless)
 * @param {number} elevation      - site elevation (ft) — for gr recalculation
 * @param {number} floorAreaFt2   - room floor area in ft² (pre-converted)
 * @param {number} volumeFt3      - room volume in ft³ (pre-converted)
 * @param {number} latitude       - project latitude (decimal degrees)
 * @param {number} dailyRange     - full daily DB swing (°F). 0 = use defaults.
 *
 * @returns {{
 *   ersh:           number,   Effective Room Sensible Heat (BTU/hr), safety-adjusted
 *   erlh:           number,   Effective Room Latent Heat (BTU/hr), NO safety factor (MED-06)
 *   grains:         string,   indoor gr/lb (toFixed(1)) for RDS display
 *   dbInF:          number,   room design dry-bulb (°F)
 *   grIn:           number,   indoor humidity ratio (gr/lb)
 *   grOut:          number,   outdoor humidity ratio (gr/lb) at site elevation
 *   envelopeGain:   number,   envelope sensible subtotal (BTU/hr) signed
 *   pplSens:        number,   people sensible subtotal (BTU/hr)
 *   pplLat:         number,   people latent subtotal (BTU/hr)
 *   lightsSens:     number,   lighting sensible subtotal (BTU/hr)
 *   equipSens:      number,   equipment sensible subtotal (BTU/hr)
 *   equipLatent:    number,   equipment latent subtotal (BTU/hr)
 *   infilSens:      number,   infiltration sensible subtotal (BTU/hr)
 *   infilLat:       number,   infiltration latent subtotal (BTU/hr)
 *   infilCFM:       number,   infiltration airflow (CFM)
 *   rawSensible:    number,   sum of all sensible components before safety
 *   rawLatent:      number,   sum of all latent components before safety
 *   safetyMult:     number,   safety factor multiplier (e.g. 1.10) — for rdsSelector equipment sizing
 *   gmpSafetyMult:  number,   GMP safety factor actually applied to ersh (1.0 or 1.25)
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

  // BUG-02 FIX: recalculate outdoor grains at site elevation, not sea level.
  const grOut = calculateGrains(dbOut, ambRH, elevation);

  // ── Indoor conditions ───────────────────────────────────────────────────────
  // designTemp stored in °C in roomSlice — convert to °F for all ASHRAE calcs.
  const dbInF = isNaN(parseFloat(room.designTemp)) ? 72 : cToF(room.designTemp);
  const rhIn  = parseFloat(room.designRH) || 50;
  const grIn  = calculateGrains(dbInF, rhIn, elevation);

  // ── Altitude-corrected psychrometric factors ────────────────────────────────
  const Cs = ASHRAE.SENSIBLE_FACTOR * altCf;
  const Cl = ASHRAE.LATENT_FACTOR   * altCf;

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
  // LOW-04 NOTE: CLF = 1.0 assumed (occupants present 100% of occupied hours).
  // For 24/7 semiconductor / pharma operations this is correct. For part-time
  // occupancy spaces, add a CLF schedule per ASHRAE HOF Ch.18 Table 3.
  const pplCount = parseFloat(int.people?.count)                              || 0;
  const pplSens  = pplCount * (int.people?.sensiblePerPerson ?? ASHRAE.PEOPLE_SENSIBLE_SEATED);
  const pplLat   = pplCount * (int.people?.latentPerPerson   ?? ASHRAE.PEOPLE_LATENT_SEATED);

  // ── 3. Lighting ─────────────────────────────────────────────────────────────
  // FIX HIGH-04: Apply useSchedule (0–100%) as an operating fraction.
  // Previously useSchedule was stored but never read — lights were always
  // calculated as if running 100% of the time.
  // Reference: ASHRAE HOF 2021 Ch.18 — Cooling Load Factor for Lighting (CLF)
  const schedFactor = (parseFloat(int.lights?.useSchedule) ?? 100) / 100;

  // FIX HIGH-05: Apply ballastFactor per ASHRAE HOF 2021 Ch.18 Table 2.
  // Previously LIGHTING_BALLAST_FACTOR was defined in ashrae.js but never used.
  // Default is 1.0 (LED). T8 fluorescent = 1.2, T5 = 1.15.
  // User can override via envelope config lights.ballastFactor field.
  const ballastFactor = parseFloat(int.lights?.ballastFactor) || ASHRAE.LIGHTING_BALLAST_FACTOR;

  // Q_lights = W/ft² × ft² × BTU_PER_WATT × schedFactor × ballastFactor
  const lightsSens = (parseFloat(int.lights?.wattsPerSqFt) || 0)
    * floorAreaFt2
    * ASHRAE.BTU_PER_WATT
    * schedFactor    // FIX HIGH-04
    * ballastFactor; // FIX HIGH-05

  // ── 4. Equipment ───────────────────────────────────────────────────────────
  // FIX HIGH-02: Apply process diversity factor.
  // PROCESS_DIVERSITY_FACTOR = 0.75 — only 75% of installed kW operates
  // simultaneously. Previously 100% was always assumed (factor never applied).
  // Per-room override: set equipment.diversityFactor in envelope config.
  // Reference: ASHRAE HOF 2021 Ch.18 — Equipment diversity.
  const equipKW      = parseFloat(int.equipment?.kw)           || 0;
  const equipSensPct = (parseFloat(int.equipment?.sensiblePct) ?? 100) / 100;
  const equipLatPct  = (parseFloat(int.equipment?.latentPct)   ?? 0)   / 100;
  const diversityFactor = parseFloat(int.equipment?.diversityFactor)
    ?? ASHRAE.PROCESS_DIVERSITY_FACTOR; // FIX HIGH-02: was implicitly 1.0

  // MED-07 NOTE: MOTOR_HEAT_FRACTIONS is defined in ashrae.js but not yet wired
  // in. When a motorLocation field is added to equipment config, replace
  // equipSensPct with MOTOR_HEAT_FRACTIONS[motorLocation] here.
  const equipSens   = equipKW * ASHRAE.KW_TO_BTU * equipSensPct * diversityFactor;  // FIX HIGH-02
  const equipLatent = equipKW * ASHRAE.KW_TO_BTU * equipLatPct  * diversityFactor;  // FIX HIGH-02

  // ── 5. Infiltration ────────────────────────────────────────────────────────
  // CFM_inf = (Volume_ft³ × ACH_inf) / 60
  // Q_s = Cs × CFM × (T_out − T_in)   [signed — negative if outdoor < indoor]
  // Q_l = Cl × CFM × (gr_out − gr_in)  [floored at 0 — no latent cooling]
  const achValue  = parseFloat(inf.achValue) || 0;
  const infilCFM  = (volumeFt3 * achValue) / 60;
  const infilSens = Cs * infilCFM * (dbOut - dbInF);
  const infilLat  = Cl * infilCFM * Math.max(0, grOut - grIn);

  // ── Totals ──────────────────────────────────────────────────────────────────
  const rawSensible = envelopeGain + pplSens + lightsSens + equipSens + infilSens;
  const rawLatent   = pplLat + equipLatent + infilLat;

  // ── Safety factor (sensible only) ──────────────────────────────────────────
  // FIX MED-06: Safety factor no longer applied to rawLatent.
  // ASHRAE cooling load methodology: safety factors are oversizing factors for
  // equipment selection, not adjustments to the calculated physical load.
  // Applying safetyMult to latent load distorts SHR and coil dehumidification
  // selection. rdsSelector applies safetyMult to coolingCapTR for equipment sizing.
  // erlh is kept as the physically computed latent load.
  const safetyMult = 1 + (parseFloat(systemDesign?.safetyFactor) || 10) / 100;

  // FIX HIGH-03: GMP / pharma rooms require an additional 1.25× safety margin
  // on sensible capacity per ISPE Baseline Guide Vol.5 and GMP Annex 1:2022 §4.23.
  // Previously PROCESS_SAFETY_FACTOR was defined in ashrae.js but never applied.
  // Applied only to rooms with ventCategory === 'pharma'.
  // For non-pharma rooms gmpSafetyMult = 1.0 (no effect).
  const gmpSafetyMult = (room.ventCategory === 'pharma')
    ? ASHRAE.PROCESS_SAFETY_FACTOR  // FIX HIGH-03: 1.25×
    : 1.0;

  const ersh = Math.round(rawSensible * safetyMult * gmpSafetyMult); // FIX HIGH-03, MED-06
  const erlh = Math.round(rawLatent);                                  // FIX MED-06: no safetyMult

  return {
    // Primary outputs consumed by rdsSelector
    ersh,
    erlh,

    // Psychrometric state
    grains: grIn.toFixed(1),
    dbInF,
    grIn,
    grOut,

    // Load component breakdown — used for Equipment ON/OFF delta
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

    // Safety multipliers carried forward for rdsSelector equipment sizing
    safetyMult,
    gmpSafetyMult,
  };
};