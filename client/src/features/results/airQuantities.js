/**
 * airQuantities.js
 * Responsibility: All room-level airflow quantity calculations (CFM).
 *
 * Reference: ASHRAE 62.1-2022 (Ventilation Rate Procedure)
 *            ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ISO 14644-1:2015 (Cleanroom air change rates)
 *            GMP Annex 1:2022 (Pharmaceutical cleanroom ACH requirements)
 *
 * AIRFLOW HIERARCHY (supply air governed by highest of three constraints):
 *
 *   1. thermalCFM    — sensible load requirement
 *                      CFM = ERSH / (Cs × ΔT_supply)
 *                      where ΔT_supply = (1 − BF) × (T_room − ADP)
 *
 *   2. designAcphCFM — ISO/GMP classification compliance
 *                      CFM = Volume_ft³ × designACPH / 60
 *
 *   3. minAcphCFM    — absolute regulatory floor
 *                      CFM = Volume_ft³ × minACPH / 60
 *
 *   Supply air = max(thermalCFM, designAcphCFM, minAcphCFM)
 *   The governing constraint is flagged as supplyAirGoverned.
 *
 * FRESH AIR (ASHRAE 62.1-2022 Ventilation Rate Procedure, Section 6.2):
 *
 *   Vbz = Rp × Pz + Ra × Az
 *   where:
 *     Rp = per-person ventilation rate (cfm/person)
 *     Pz = zone population (people)
 *     Ra = area ventilation rate (cfm/ft²) — from ventilation.js per ventCategory
 *     Az = zone floor area (ft²)
 *
 *   EXHAUST COMPENSATION (ASHRAE mass balance):
 *
 *   When room exhaust (general + BIBO + machine) exceeds Vbz, the AHU
 *   must bring in at least as much outdoor air as is exhausted to maintain
 *   room pressure. That makeup OA carries full ambient heat load.
 *
 *   freshAir = isDOAS  ? supplyAir
 *            : Math.max(Vbz, totalExhaust)    ← KEY FIX
 *
 *   This means: increasing exhaust → increases freshAir obligation →
 *   increases oaSensible + oaLatent in outdoorAirLoad.js →
 *   increases coolingCapTR. The chain now works end-to-end.
 *
 * MASS BALANCE (ASHRAE supply/return/exhaust):
 *
 *   Supply = Return + Exhaust + Net exfiltration
 *   Return = Supply − freshAirCheck − totalExhaust   (floored at 0)
 */

import ASHRAE          from '../../constants/ashrae';
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
 * @param {number} altCf         - altitude correction factor (dimensionless)
 * @param {number} peakErsh      - peak (summer) ERSH in BTU/hr
 * @param {number} floorAreaFt2  - room floor area in ft²
 * @param {number} volumeFt3     - room volume in ft³
 *
 * @returns {{
 *   supplyAir:          number,  total supply air (CFM)
 *   supplyAirGoverned:  string,  'thermal' | 'designAcph' | 'minAcph'
 *   thermalCFM:         number,  supply air required by heat load alone
 *   supplyAirMinAcph:   number,  supply air from minAcph constraint
 *   freshAir:           number,  OA obligation — max(Vbz, totalExhaust)
 *   optimisedFreshAir:  number,  max(freshAir, minSupplyAcph)
 *   freshAirCheck:      number,  manual override if set, else optimisedFreshAir
 *   minSupplyAcph:      number,  2.5 ACPH floor — minimum supply (CFM)
 *   faAshraeAcph:       number,  ASHRAE 62.1 VRP result pre-exhaust (CFM)
 *   vbz:                number,  breathing zone OA per ASHRAE 62.1 (CFM)
 *   maxPurgeAir:        number,  20 ACPH purge capacity (CFM)
 *   returnAir:          number,  return air (CFM) — mass balance
 *   coilAir:            number,  air through cooling coil = supply × (1 − BF)
 *   bypassAir:          number,  bypassed air = supply × BF
 *   totalExhaust:       number,  sum of all exhaust streams (CFM)
 *   exhaustGeneral:     number,  general exhaust (CFM)
 *   exhaustBibo:        number,  BIBO exhaust (CFM)
 *   exhaustMachine:     number,  machine exhaust (CFM)
 *   exhaustCompensation:number,  max(0, totalExhaust − vbz) — OA above Vbz floor
 *   dehumidifiedAir:    number,  = coilAir (ACES terminology)
 *   freshAirAces:       number,  = freshAirCheck (ACES terminology)
 *   bleedAir:           number,  supply − return − freshAirCheck (floored 0)
 *   isDOAS:             boolean, true if AHU type is 'DOAS'
 *   pplCount:           number,  occupant count (from envelope)
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
  const Cs  = ASHRAE.SENSIBLE_FACTOR * altCf;
  const bf  = parseFloat(systemDesign.bypassFactor) || 0.10;
  const adp = parseFloat(systemDesign.adp)          || 55;

  // ── Room indoor design DB (°F) ─────────────────────────────────────────────
  const dbInF = isNaN(parseFloat(room.designTemp))
    ? 72
    : (parseFloat(room.designTemp) * 9) / 5 + 32;

  // ── 1. Thermal CFM ─────────────────────────────────────────────────────────
  // ΔT_supply = (1 − BF) × (T_room − ADP)
  // Guard against zero / negative ΔT — ADP ≥ room temp means system is
  // misconfigured; return 0 so the ACPH constraint governs cleanly.
  const supplyDT   = (1 - bf) * (dbInF - adp);
  const thermalCFM = (supplyDT > 0 && peakErsh > 0)
    ? Math.ceil(peakErsh / (Cs * supplyDT))
    : 0;

  // ── 2. ACPH-based CFM constraints ─────────────────────────────────────────
  const minAcphCFM    = Math.round(volumeFt3 * (parseFloat(room.minAcph)    || 0) / 60);
  const designAcphCFM = Math.round(volumeFt3 * (parseFloat(room.designAcph) || 0) / 60);

  // ── 3. Governing supply air ────────────────────────────────────────────────
  // BUG-03 FIX: three-way max — highest of the three constraints governs.
  const supplyAir = Math.max(thermalCFM, minAcphCFM, designAcphCFM);

  const supplyAirGoverned =
    supplyAir === thermalCFM && thermalCFM > 0 ? 'thermal'
    : supplyAir === designAcphCFM              ? 'designAcph'
    :                                             'minAcph';

  // ── 4. Exhaust breakdown ───────────────────────────────────────────────────
  // Exhaust computed BEFORE freshAir — needed for the compensation calc below.
  const exhaustGeneral = parseFloat(room.exhaustAir?.general) || 0;
  const exhaustBibo    = parseFloat(room.exhaustAir?.bibo)    || 0;
  const exhaustMachine = parseFloat(room.exhaustAir?.machine) || 0;
  const totalExhaust   = exhaustGeneral + exhaustBibo + exhaustMachine;

  // ── 5. Fresh air — ASHRAE 62.1-2022 VRP + exhaust compensation ────────────
  //
  // Vbz = breathing zone OA per ASHRAE 62.1-2022 Section 6.2
  // calculateVbz() uses ventCategory to select correct Rp and Ra from Table 6-1
  const pplCount = envelope?.internalLoads?.people?.count || 0;
  const vbz      = calculateVbz(room.ventCategory, pplCount, floorAreaFt2);

  const ahuType = ahu?.type || 'Recirculating';
  const isDOAS  = ahuType === 'DOAS';

  // EXHAUST COMPENSATION FIX:
  // A room exhausting more air than its ventilation minimum must bring in
  // at least as much OA as it exhausts to maintain pressure neutrality.
  // ASHRAE HOF Ch.18: makeup air = max(Vbz, totalExhaust)
  //
  // Before this fix: freshAir = vbz regardless of exhaust quantity.
  // A room with 2000 CFM exhaust and 200 CFM Vbz got freshAir = 200 CFM.
  // The 1800 CFM of makeup OA was invisible to the heat load calculation —
  // increasing exhaust had zero effect on coolingCapTR.
  //
  // After this fix: freshAir = max(vbz, totalExhaust) = 2000 CFM.
  // outdoorAirLoad.js receives cfmOA = 2000 CFM → correct oaSensible + oaLatent.
  const exhaustCompensation = Math.max(0, totalExhaust - vbz);
  const freshAirMakeup      = Math.max(vbz, totalExhaust);
  const freshAir            = isDOAS ? supplyAir : freshAirMakeup;

  // ── 6. Fresh air variants ──────────────────────────────────────────────────
  // BUG-17 FIX: minSupplyAcph is a total supply floor (2.5 ACPH),
  // NOT a fresh air quantity — name clarified.
  const minSupplyAcph     = Math.round(volumeFt3 * 2.5 / 60);
  const faAshraeAcph      = vbz;                              // pure 62.1 result, pre-exhaust
  const optimisedFreshAir = Math.max(freshAir, minSupplyAcph);
  const manualFA          = parseFloat(room.manualFreshAir) || 0;

  // freshAirCheck: what rdsSelector passes to outdoorAirLoad as cfmOA.
  // Manual override respected — engineer can specify higher OA if needed.
  const freshAirCheck = manualFA > 0 ? manualFA : optimisedFreshAir;

  const maxPurgeAir = Math.round(volumeFt3 * 20 / 60);

  // ── 7. AHU air balance ─────────────────────────────────────────────────────
  const coilAir   = Math.round(supplyAir * (1 - bf));
  const bypassAir = Math.round(supplyAir * bf);

  // BUG-10 FIX: Return = Supply − freshAirCheck − totalExhaust (floored 0)
  // ASHRAE mass balance: Supply = Return + OA_intake + Net_exfiltration
  const returnAir = Math.max(0, supplyAir - freshAirCheck - totalExhaust);

  // ── 8. ACES nomenclature aliases ──────────────────────────────────────────
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
    vbz,                   // pure ASHRAE 62.1 breathing zone result
    freshAir,              // max(vbz, totalExhaust) — actual OA obligation
    optimisedFreshAir,
    freshAirCheck,         // passed to outdoorAirLoad.js as cfmOA
    minSupplyAcph,
    faAshraeAcph,          // = vbz, pre-exhaust (for display comparison)
    maxPurgeAir,
    exhaustCompensation,   // OA above Vbz floor driven purely by exhaust

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
