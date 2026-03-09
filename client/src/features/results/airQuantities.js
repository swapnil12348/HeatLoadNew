/**
 * airQuantities.js
 * Responsibility: All room-level airflow quantity calculations (CFM).
 *
 * Reference: ASHRAE 62.1-2022 (Ventilation Rate Procedure)
 *            ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ISO 14644-1:2015 (Cleanroom air change rates)
 *            GMP Annex 1:2022 (Pharmaceutical cleanroom ACH requirements)
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-AQ-01 [CRITICAL]: ASHRAE.SENSIBLE_FACTOR undefined → NaN cascade.
 *
 *     Identical root cause to BUG-SL-01 in seasonalLoads.js.
 *     ashrae.js exports SENSIBLE_FACTOR_SEA_LEVEL, not SENSIBLE_FACTOR.
 *
 *     Old:
 *       const Cs = ASHRAE.SENSIBLE_FACTOR * altCf;  // undefined → NaN
 *
 *     NaN propagation:
 *       Cs = NaN
 *       Cs * supplyDT = NaN
 *       peakErsh / NaN = NaN
 *       Math.ceil(NaN) = NaN   → thermalCFM = NaN
 *       Math.max(NaN, 100, 200) = NaN   ← JS: ANY NaN arg → NaN result
 *       supplyAir = NaN
 *       returnAir, coilAir, bypassAir → all NaN
 *
 *     Fix: ASHRAE.SENSIBLE_FACTOR_SEA_LEVEL * altCf
 *     Note: altCf is already passed as a parameter (computed by the caller
 *     from altitudeCorrectionFactor(elevation)). This is numerically identical
 *     to sensibleFactor(elevation) without adding an elevation parameter.
 *       ASHRAE.SENSIBLE_FACTOR_SEA_LEVEL × altCf = 1.08 × Cf = sensibleFactor(elev)
 *
 *   BUG-AQ-02 [LOW]: Inline cToF calculation removed.
 *     Old: (parseFloat(room.designTemp) * 9) / 5 + 32
 *     Problem: parseFloat(null) = 0 → 0 × 9/5 + 32 = 32°F (wrong, not 72°F)
 *     Fix: cToF() from utils/units.js — returns null on invalid input,
 *     which the null-safe fallback catches correctly.
 *
 *   BUG-AQ-03 [LOW]: supplyAirGoverned priority chain made explicit.
 *     Old ternary chain had two fragile edge cases:
 *       (a) When BUG-AQ-01 was active, thermalCFM = NaN → NaN === NaN = false
 *           so 'thermal' never appeared even when thermal load governed
 *       (b) When thermalCFM === designAcphCFM (equal values), 'thermal' won
 *           over 'designAcph' — masking the ACPH compliance constraint
 *     Fix: explicit if/else priority — designAcph > thermal > minAcph when
 *     values are equal, because the ACPH compliance constraint is the
 *     regulatory reason and should be surfaced to the engineer.
 *
 * ── AIRFLOW HIERARCHY ────────────────────────────────────────────────────────
 *
 *   Supply air = max(thermalCFM, designAcphCFM, minAcphCFM)
 *   Governing constraint flagged as supplyAirGoverned.
 *
 *   1. thermalCFM    = ERSH / (Cs × ΔT_supply)
 *      ΔT_supply     = (1 − BF) × (T_room − ADP)
 *
 *   2. designAcphCFM = Volume_ft³ × designACPH / 60  (ISO/GMP class compliance)
 *
 *   3. minAcphCFM    = Volume_ft³ × minACPH / 60     (regulatory absolute floor)
 *
 * ── FRESH AIR (ASHRAE 62.1-2022 VRP §6.2) ────────────────────────────────────
 *
 *   Vbz = Rp × Pz + Ra × Az
 *
 *   EXHAUST COMPENSATION:
 *   When exhaust > Vbz: freshAir = max(Vbz, totalExhaust)
 *   Increasing exhaust increases OA obligation → increases oaSensible / oaLatent
 *   in outdoorAirLoad.js → correctly increases coolingCapTR end-to-end.
 *
 * ── MASS BALANCE ──────────────────────────────────────────────────────────────
 *
 *   Supply = Return + OA intake + Net exfiltration
 *   Return = Supply − freshAirCheck − totalExhaust  (floored at 0)
 */

import ASHRAE          from '../../constants/ashrae';
import { cToF }        from '../../utils/units';
import { calculateVbz } from '../../constants/ventilation';

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * calculateAirQuantities()
 *
 * Computes all room-level airflow quantities for one room.
 * Consumed by rdsSelector.js.
 *
 * @param {object} room          - room state from roomSlice
 * @param {object} envelope      - envelope state for this room
 * @param {object} ahu           - AHU object assigned to this room
 * @param {object} systemDesign  - state.project.systemDesign
 * @param {number} altCf         - altitude correction factor (dimensionless, 0–1)
 * @param {number} peakErsh      - peak (summer) ERSH in BTU/hr
 * @param {number} floorAreaFt2  - room floor area in ft²
 * @param {number} volumeFt3     - room volume in ft³
 *
 * @returns {{
 *   supplyAir:           number,  total supply air (CFM)
 *   supplyAirGoverned:   string,  'thermal' | 'designAcph' | 'minAcph'
 *   thermalCFM:          number,  supply air required by heat load alone
 *   supplyAirMinAcph:    number,  supply air from minAcph constraint
 *   vbz:                 number,  ASHRAE 62.1 breathing zone OA (CFM)
 *   freshAir:            number,  max(vbz, totalExhaust) — actual OA obligation
 *   optimisedFreshAir:   number,  max(freshAir, minSupplyAcph)
 *   freshAirCheck:       number,  manual override if set, else optimisedFreshAir
 *   minSupplyAcph:       number,  2.5 ACPH total supply floor (CFM)
 *   faAshraeAcph:        number,  pure ASHRAE 62.1 Vbz result pre-exhaust (CFM)
 *   maxPurgeAir:         number,  20 ACPH purge capacity (CFM)
 *   returnAir:           number,  return air (CFM) — mass balance
 *   coilAir:             number,  air through cooling coil = supply × (1 − BF)
 *   bypassAir:           number,  bypassed air = supply × BF
 *   totalExhaust:        number,  sum of all exhaust streams (CFM)
 *   exhaustGeneral:      number,  general exhaust (CFM)
 *   exhaustBibo:         number,  BIBO exhaust (CFM)
 *   exhaustMachine:      number,  machine exhaust (CFM)
 *   exhaustCompensation: number,  max(0, totalExhaust − vbz)
 *   dehumidifiedAir:     number,  = coilAir (ACES terminology)
 *   freshAirAces:        number,  = freshAirCheck (ACES terminology)
 *   bleedAir:            number,  supply − return − freshAirCheck (floored 0)
 *   isDOAS:              boolean, true if AHU type is 'DOAS'
 *   pplCount:            number,  occupant count (from envelope)
 * }}
 */
export const calculateAirQuantities = (
  room,
  envelope,
  ahu,
  systemDesign,
  altCf,
  peakErsh,
  floorAreaFt2,
  volumeFt3,
) => {
  // BUG-AQ-01 FIX: ASHRAE.SENSIBLE_FACTOR_SEA_LEVEL (exists) × altCf.
  // ASHRAE.SENSIBLE_FACTOR (no suffix) does NOT exist — was returning undefined.
  // undefined × altCf = NaN → Math.max(NaN, ...) = NaN → supplyAir = NaN.
  const Cs  = ASHRAE.SENSIBLE_FACTOR_SEA_LEVEL * altCf;
  const bf  = parseFloat(systemDesign.bypassFactor) || 0.10;
  const adp = parseFloat(systemDesign.adp)          || 55;

  // ── Room design DB (°F) ───────────────────────────────────────────────────
  // BUG-AQ-02 FIX: cToF() from units.js — null-safe, returns null on invalid input.
  // Old inline: (parseFloat(null) * 9/5 + 32) = 32°F (wrong, not the 72°F fallback).
  const dbInFRaw = cToF(room.designTemp);
  const dbInF    = dbInFRaw === null ? 72 : dbInFRaw;

  // ── 1. Thermal CFM ────────────────────────────────────────────────────────
  // ΔT_supply = (1 − BF) × (T_room − ADP)
  // Guard against ΔT ≤ 0: ADP ≥ room temp is a configuration error —
  // fall through to ACPH constraint rather than producing a negative CFM.
  const supplyDT   = (1 - bf) * (dbInF - adp);
  const thermalCFM = (supplyDT > 0 && peakErsh > 0)
    ? Math.ceil(peakErsh / (Cs * supplyDT))
    : 0;

  // ── 2. ACPH-based CFM constraints ─────────────────────────────────────────
  const minAcphCFM    = Math.round(volumeFt3 * (parseFloat(room.minAcph)    || 0) / 60);
  const designAcphCFM = Math.round(volumeFt3 * (parseFloat(room.designAcph) || 0) / 60);

  // ── 3. Governing supply air ───────────────────────────────────────────────
  const supplyAir = Math.max(thermalCFM, minAcphCFM, designAcphCFM);

  // BUG-AQ-03 FIX: Explicit priority chain replaces fragile ternary.
  //
  // Priority when values are equal: designAcph > thermal > minAcph.
  // Rationale: the ISO/GMP ACPH compliance constraint should be surfaced
  // to the engineer — if thermal load happens to equal the ACPH CFM, the
  // engineer needs to know that ACPH is the binding regulatory driver.
  //
  // Old logic failed silently when thermalCFM = NaN (BUG-AQ-01):
  //   NaN === NaN → false → 'thermal' never appeared in that state.
  let supplyAirGoverned;
  if (supplyAir === designAcphCFM && designAcphCFM > 0) {
    supplyAirGoverned = 'designAcph';
  } else if (supplyAir === thermalCFM && thermalCFM > 0) {
    supplyAirGoverned = 'thermal';
  } else {
    supplyAirGoverned = 'minAcph';
  }

  // ── 4. Exhaust breakdown ──────────────────────────────────────────────────
  const exhaustGeneral = parseFloat(room.exhaustAir?.general) || 0;
  const exhaustBibo    = parseFloat(room.exhaustAir?.bibo)    || 0;
  const exhaustMachine = parseFloat(room.exhaustAir?.machine) || 0;
  const totalExhaust   = exhaustGeneral + exhaustBibo + exhaustMachine;

  // ── 5. Fresh air — ASHRAE 62.1-2022 VRP + exhaust compensation ────────────
  const pplCount = envelope?.internalLoads?.people?.count || 0;
  const vbz      = calculateVbz(room.ventCategory, pplCount, floorAreaFt2);

  const ahuType = ahu?.type || 'Recirculating';
  const isDOAS  = ahuType === 'DOAS';

  // EXHAUST COMPENSATION:
  // Rooms exhausting more air than their ventilation minimum must bring in
  // at least as much OA as exhausted to maintain pressure.
  // ASHRAE HOF Ch.18 mass balance: makeup OA = max(Vbz, totalExhaust).
  //
  // Before this fix: freshAir = vbz even when exhaust >> vbz.
  // A room with 2000 CFM exhaust + 200 CFM Vbz got freshAir = 200 CFM.
  // The 1800 CFM makeup OA was invisible to the heat load — increasing
  // exhaust had zero effect on coolingCapTR.
  const exhaustCompensation = Math.max(0, totalExhaust - vbz);
  const freshAirMakeup      = Math.max(vbz, totalExhaust);
  const freshAir            = isDOAS ? supplyAir : freshAirMakeup;

  // ── 6. Fresh air variants ─────────────────────────────────────────────────
  // minSupplyAcph is a TOTAL SUPPLY floor (2.5 ACPH minimum), not a fresh
  // air quantity. Name intentionally differs from minAcphCFM (which comes
  // from room.minAcph and is used for the thermalCFM comparison above).
  const minSupplyAcph     = Math.round(volumeFt3 * 2.5 / 60);
  const faAshraeAcph      = vbz;                               // pure 62.1, pre-exhaust
  const optimisedFreshAir = Math.max(freshAir, minSupplyAcph);
  const manualFA          = parseFloat(room.manualFreshAir) || 0;

  // freshAirCheck is what rdsSelector passes to outdoorAirLoad.js as cfmOA.
  // Manual override respected — engineer can specify higher OA.
  const freshAirCheck = manualFA > 0 ? manualFA : optimisedFreshAir;

  const maxPurgeAir = Math.round(volumeFt3 * 20 / 60);

  // ── 7. AHU air balance ────────────────────────────────────────────────────
  const coilAir   = Math.round(supplyAir * (1 - bf));
  const bypassAir = Math.round(supplyAir * bf);

  // Mass balance: Return = Supply − OA_intake − Exhaust (floored at 0).
  // ASHRAE HOF Ch.18: Supply = Return + OA + Net_exfiltration.
  const returnAir = Math.max(0, supplyAir - freshAirCheck - totalExhaust);

  // ── 8. ACES nomenclature aliases ─────────────────────────────────────────
  const dehumidifiedAir = coilAir;
  const freshAirAces    = freshAirCheck;
  const bleedAir        = Math.max(0, supplyAir - returnAir - freshAirCheck);

  return {
    // Supply air
    supplyAir,
    supplyAirGoverned,
    thermalCFM,
    supplyAirMinAcph: minAcphCFM,

    // Fresh air
    vbz,
    freshAir,
    optimisedFreshAir,
    freshAirCheck,
    minSupplyAcph,
    faAshraeAcph,
    maxPurgeAir,
    exhaustCompensation,

    // Exhaust
    totalExhaust,
    exhaustGeneral,
    exhaustBibo,
    exhaustMachine,

    // AHU balance
    coilAir,
    bypassAir,
    returnAir,

    // ACES aliases
    dehumidifiedAir,
    freshAirAces,
    bleedAir,

    // Metadata
    isDOAS,
    pplCount,
  };
};