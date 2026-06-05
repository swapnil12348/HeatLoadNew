/**
 * seasonalLoads.ts
 * Responsibility: Per-room, per-season sensible and latent load calculation.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ASHRAE 62.1-2022 (Ventilation Rate Procedure)
 *            ISPE Baseline Guide Vol.5 — Pharmaceutical Cleanrooms
 *            GMP Annex 1:2022 §4.23 — HVAC safety margins
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   ductHeatGain applied additively with safetyFactor (ASHRAE HOF Ch.18 method).
 *
 *     Excel row 80: SA duct heat gain & leak loss (%) is applied as a separate
 *     additive percentage on RSH alongside the safety factor.
 *     Combined: safetyMult = 1 + (safetyFactor + ductHeatGain) / 100
 *
 *     This correctly treats duct gain as a distinct loss mechanism from the
 *     engineering safety margin — not a compounded multiplier:
 *       duct + safety = 1.15× (additive Excel method)
 *       duct × safety = 1.155× (multiplicative — NOT what Excel does)
 *
 *     For a typical project (safety=10%, duct=5%): 1.15× vs previous 1.10×.
 *     That's approximately 5% understatement of ERSH for every room fixed.
 *     For rooms with high envelope loads (pharma, semiconductor fabs),
 *     this was the second-largest systematic error after the reheater omission.
 *
 *     ductHeatGain read from systemDesign — defaults to 0 when not set
 *     (safe fallback for old Redux state without the field, e.g. after
 *     upgrading from a project saved before v2.4 of projectSlice).
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   CRIT-SL-01 FIX — rhIn: `|| 50` replaced with null-coalescing guard.
 *
 *     Old:
 *       const rhIn = parseFloat(room.designRH) || 50;
 *
 *     The `|| 50` pattern in JavaScript treats 0 as falsy:
 *       parseFloat(0) = 0  →  0 || 50 = 50   ← WRONG for dry rooms
 *
 *     For any room with designRH = 0 (battery dry rooms, pharma dry-powder,
 *     Li-ion cell assembly), rhIn was silently set to 50%RH.
 *
 *     Impact cascade for a 1%RH battery dry room designed at 0%RH input:
 *       grIn (indoor humidity ratio):
 *         Correct at 0%: ~1.1 gr/lb
 *         Corrupted at 50%: ~54 gr/lb  (50× too high)
 *
 *       infilLat (infiltration latent load):
 *         Correct: Cl × CFM × max(0, grOut − 1.1) → small positive (cooling) or 0
 *         Corrupted: Cl × CFM × max(0, grOut − 54) → 0 (phantom latent load removed,
 *         but grIn used as the basis for all downstream moisture calcs is wrong)
 *
 *       erlh (effective room latent heat):
 *         Corrupted grIn flows into coil SHR selection, humidification delta,
 *         and all psychroStatePoints moisture calculations.
 *
 *       MOST CRITICAL — heatingHumid.ts humidDeltaGr:
 *         humidDeltaGr = max(0, humidGrTarget − mixedAirGr)
 *         With corrupted grIn ≈ 54 gr/lb and winterGrOut ≈ 10 gr/lb:
 *           humidDeltaGr = max(0, 54 − 10) = 44 gr/lb  ← wrong, room is a DRY room
 *         But the REAL target for a 1%RH room is 1.1 gr/lb:
 *           humidDeltaGr = max(0, 1.1 − 10) = 0 → humidifier sized to ZERO
 *           (because grIn at 50%RH > winterGrOut, so no humidification "needed")
 *
 *         Result: the Li-ion dry room humidifier is never sized. The single most
 *         critical piece of mechanical equipment in the facility is missing from
 *         all output — silently, with no error or warning.
 *
 *     Fix: identical null guard already used correctly in rdsSelector.ts:
 *       const raRH = room.designRH != null ? parseFloat(room.designRH) : 50;
 *     Applied consistently here: 0 passes through correctly; only null/undefined
 *     falls back to the 50%RH default.
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-SL-01 [CRITICAL ★]: ASHRAE.SENSIBLE_FACTOR undefined → NaN cascade.
 *   BUG-SL-02 [LOW]: ASHRAE.KW_TO_BTU replaced with KW_TO_BTU_HR from units.ts.
 *   BUG-SL-03 [LOW]: Local cToF() removed — was a duplicate of utils/units.ts.
 *   BUG-SL-04 [CONFIRMED NOT A BUG]: FIX HIGH-07 double diversity.
 *
 * ── LOAD COMPONENTS (all in BTU/hr) ──────────────────────────────────────────
 *
 *   Sensible:
 *     1. Envelope        — CLTD/CLF method via envelopeCalc.ts
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
 * ── SAFETY FACTOR POLICY ─────────────────────────────────────────────────────
 *
 *   safetyMult = 1 + (safetyFactor + ductHeatGain) / 100
 *
 *   Applied to ERSH only (sensible room load).
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

import { calculateGrains } from '../../utils/psychro';
import { cToF, KW_TO_BTU_HR } from '../../utils/units';
import ASHRAE from '../../constants/ashrae';
import {
  calcTotalEnvelopeGain,
  EnvelopeElements,
} from '../../utils/envelopeAggregator';

// @ts-ignore - Ignore missing types until envelopeCalc.js is converted
import { calcInfiltrationGain } from '../../utils/envelopeCalc';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Season = 'summer' | 'monsoon' | 'winter';

export interface RoomState {
  designTemp?: number | string;
  designRH?: number | string;
  ventCategory?: string;
  [key: string]: any; // Allow other properties
}

export interface EnvelopeState {
  elements?: EnvelopeElements;
  internalLoads?: {
    people?: {
      count?: number | string;
      sensiblePerPerson?: number | string;
      latentPerPerson?: number | string;
    };
    lights?: {
      useSchedule?: number | string;
      ballastFactor?: number | string;
      wattsPerSqFt?: number | string;
    };
    equipment?: {
      kw?: number | string;
      sensiblePct?: number | string;
      latentPct?: number | string;
      diversityFactor?: number | string;
    };
  };
  infiltration?: any; // Type to match inf param in envelopeCalc
}

export interface ClimateState {
  outside?: Record<string, { db?: string | number; rh?: string | number }>;
}

export interface SystemDesignState {
  safetyFactor?: number | string;
  ductHeatGain?: number | string;
  [key: string]: any;
}

export interface SeasonalLoadResult {
  ersh: number;
  erlh: number;
  grains: number;
  dbInF: number;
  grIn: number;
  grOut: number;
  envelopeGain: number;
  pplSens: number;
  pplLat: number;
  lightsSens: number;
  equipSens: number;
  equipLatent: number;
  infilSens: number;
  infilLat: number;
  infilCFM: number;
  rawSensible: number;
  rawLatent: number;
  safetyMult: number;
  gmpSafetyMult: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const parseDef = (val: any, fallback: number): number => {
  const parsed = parseFloat(String(val));
  return !isNaN(parsed) ? parsed : fallback;
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * calculateSeasonLoad
 *
 * Computes the full sensible and latent cooling/heating load for one room
 * in one season. Returns a rich object consumed by rdsSelector.ts.
 *
 * @param room           - room state from roomSlice
 * @param envelope       - envelope state for this room from envelopeSlice
 * @param climate        - full climate state (state.climate)
 * @param season         - 'summer' | 'monsoon' | 'winter'
 * @param systemDesign   - state.project.systemDesign
 * @param altCf          - altitude correction factor (dimensionless, 0–1)
 * @param elevation      - site elevation (ft) — used for Patm-corrected gr
 * @param floorAreaFt2   - room floor area in ft² (pre-converted from m²)
 * @param volumeFt3      - room volume in ft³ (pre-converted from m³)
 * @param latitude       - project latitude (decimal degrees)
 * @param dailyRange     - full daily DB swing (°F). 0 = use CLTD defaults.
 */
export const calculateSeasonLoad = (
  room: RoomState,
  envelope: EnvelopeState | null | undefined,
  climate: ClimateState,
  season: Season,
  systemDesign: SystemDesignState,
  altCf: number, // Required for signature compatibility even if unused directly here
  elevation: number,
  floorAreaFt2: number,
  volumeFt3: number,
  latitude: number = 28,
  dailyRange: number = 0
): SeasonalLoadResult => {
  const env = envelope || { internalLoads: {}, infiltration: {} };
  const int = env.internalLoads || {};
  const inf = env.infiltration || {};

  // ── Outdoor conditions ──────────────────────────────────────────────────────
 const outdoor = climate?.outside?.[season] || { db: 95, rh: 40 };
const dbOut   = parseDef(outdoor?.db, 95);
// Season-appropriate RH defaults — only fire when rh field is absent from the
// climate slice (e.g. progressive form save where DB was entered but RH was not).
// 0% RH is never a valid default: it zeros out grOut and eliminates all latent
// infiltration load, which is the dominant load component in monsoon.
const ambRH   = parseDef(
  outdoor?.rh,
  season === 'monsoon' ? 75 : season === 'winter' ? 30 : 40
);
 

  // Outdoor grains at site elevation (not sea level — Patm affects humidity ratio).
  const grOut = calculateGrains(dbOut, ambRH, elevation);

  // ── Indoor conditions ───────────────────────────────────────────────────────
  // designTemp stored in °C in roomSlice. cToF() from units.ts returns null on
  // invalid input — fall back to 72°F if not set.
  const dbInFRaw = cToF(room.designTemp);
  const dbInF = dbInFRaw === null ? 72 : dbInFRaw;

  // CRIT-SL-01 FIX: null-coalescing guard replaces || 50 pattern.
  // room.designRH != null preserves 0 (0 != null is true in JS).
  // Only null or undefined falls back to the 50%RH default.
  const parsedRhIn = parseFloat(String(room.designRH));
  const rhIn = !isNaN(parsedRhIn) ? parsedRhIn : 50;

  const grIn = calculateGrains(dbInF, rhIn, elevation);

  // ── 1. Envelope gain ────────────────────────────────────────────────────────
  const envelopeGain = calcTotalEnvelopeGain(
    env.elements,
    climate,
    dbInF,
    season,
    latitude,
    dailyRange
  );

  // ── 2. People (ASHRAE HOF 2021 Ch.18 Table 1) ──────────────────────────────
  // CLF = 1.0 assumed — occupants present 100% of occupied hours.
  const pplCount = parseFloat(String(int.people?.count)) || 0;
  const pplSens =
    pplCount * (parseDef(int.people?.sensiblePerPerson, ASHRAE.PEOPLE_SENSIBLE_SEATED));
  const pplLat =
    pplCount * (parseDef(int.people?.latentPerPerson, ASHRAE.PEOPLE_LATENT_SEATED));

  // ── 3. Lighting ─────────────────────────────────────────────────────────────
  const schedFactor = parseDef(int.lights?.useSchedule, 100) / 100;
  const ballastFactor = parseDef(int.lights?.ballastFactor, ASHRAE.LIGHTING_BALLAST_FACTOR);

  const lightsSens =
    (parseFloat(String(int.lights?.wattsPerSqFt)) || 0) *
    floorAreaFt2 *
    ASHRAE.BTU_PER_WATT *
    schedFactor *
    ballastFactor;

  // ── 4. Equipment ───────────────────────────────────────────────────────────
  const equipKW = parseFloat(String(int.equipment?.kw)) || 0;
  const equipSensPct = parseDef(int.equipment?.sensiblePct, 100) / 100;
  const equipLatPct = parseDef(int.equipment?.latentPct, 0) / 100;
  const diversityFactor = parseDef(
    int.equipment?.diversityFactor,
    ASHRAE.PROCESS_DIVERSITY_FACTOR
  );

  const equipSens = equipKW * KW_TO_BTU_HR * equipSensPct * diversityFactor;
  const equipLatent = equipKW * KW_TO_BTU_HR * equipLatPct * diversityFactor;

  // ── 5. Infiltration ────────────────────────────────────────────────────────
  const { sensible: infilSens, latent: infilLat, cfm: infilCFM } = calcInfiltrationGain(
    inf,
    room,
    volumeFt3,
    dbOut,
    dbInF,
    grIn,
    grOut,
    elevation
  );

  // ── Totals ──────────────────────────────────────────────────────────────────
  const rawSensible = envelopeGain + pplSens + lightsSens + equipSens + infilSens;
  const rawLatent = pplLat + equipLatent + infilLat;

  // ── Safety factors (sensible only) ─────────────────────────────────────────
  //
  // safetyMult = 1 + (safetyFactor + ductHeatGain) / 100
  //
  // Applied ADDITIVELY to match the Excel row-80 method:
  //   Excel: RSH × (ductGainPct + safetyPct) / 100 as a single line item.
  //   This means 10% safety + 5% duct = 1.15× multiplier (not 1.10 × 1.05 = 1.155×).
  //
  // ductHeatGain defaults to 0 safely — old Redux state without this field
  // (saved before projectSlice v2.4) won't NaN-cascade; it just applies no duct gain.
  //
  // erlh deliberately excludes safetyMult — applying a safety factor to latent
  // distorts the SHR and coil selection (ASHRAE methodology).
  //
  // gmpSafetyMult: 1.25× for pharma rooms per ISPE / GMP Annex 1.
  // Applied as a MULTIPLICATIVE factor on top of the combined safetyMult.
  const parsedSf = parseFloat(String(systemDesign?.safetyFactor));
  const safetyFactor = !isNaN(parsedSf) ? parsedSf : 10;
  const ductHeatGain = parseFloat(String(systemDesign?.ductHeatGain)) || 0;
  const safetyMult = 1 + (safetyFactor + ductHeatGain) / 100;

  const gmpSafetyMult =
    room.ventCategory === 'pharma' ? ASHRAE.PROCESS_SAFETY_FACTOR : 1.0;

  const ersh = Math.round(rawSensible * safetyMult * gmpSafetyMult);
  const erlh = Math.round(rawLatent); // no safetyMult on latent

  return {
    // Primary outputs consumed by rdsSelector
    ersh,
    erlh,

    // Psychrometric state
    grains: grIn,
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