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
 *     Rp = per-person ventilation rate (cfm/person) — ASHRAE.VENT_PEOPLE_CFM
 *     Pz = zone population (people)
 *     Ra = area ventilation rate (cfm/ft²)  — varies by ventCategory
 *     Az = zone floor area (ft²)
 *
 *   DOAS systems: freshAir = supplyAir (100% outdoor air by definition)
 *   Recirculating: freshAir = Vbz (minimum outdoor air only)
 *
 * MASS BALANCE (ASHRAE supply/return/exhaust):
 *
 *   Supply = Return + Exhaust + Net exfiltration
 *   Return = Supply − freshAir − totalExhaust   (floored at 0)
 *
 * UNIT CONVENTIONS:
 *   All airflow quantities in CFM.
 *   Volume in ft³ (pre-converted at call site).
 *   Area in ft² (pre-converted at call site).
 */

import ASHRAE from '../../constants/ashrae';
import { calculateVbz } from '../../constants/ventilation';

// ── Fresh air Ra selector ─────────────────────────────────────────────────────
/**
 * Select ASHRAE 62.1-2022 Table 6-1 area ventilation rate (Ra)
 * based on room ventilation category.
 *
 * @param {string} ventCategory - 'general' | 'pharma' | 'battery' | 'semicon'
 * @returns {number} Ra in cfm/ft²
 */
const getRaForCategory = (ventCategory) => {
  switch (ventCategory) {
    case 'pharma':  return ASHRAE.VENT_AREA_PHARMA;
    case 'battery': return ASHRAE.VENT_AREA_BATTERY;
    case 'semicon': return ASHRAE.VENT_AREA_SEMICON;
    default:        return ASHRAE.VENT_AREA_CFM;      // 'general' + fallback
  }
};

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
 *   supplyAir:          number,  total supply air (CFM) — governs all downstream
 *   supplyAirGoverned:  string,  'thermal' | 'designAcph' | 'minAcph'
 *   thermalCFM:         number,  supply air required by heat load alone
 *   supplyAirMinAcph:   number,  supply air from minAcph constraint
 *   freshAir:           number,  minimum OA per ASHRAE 62.1 VRP (CFM)
 *   optimisedFreshAir:  number,  max(freshAir, minSupplyAcph)
 *   freshAirCheck:      number,  manual override if set, else optimisedFreshAir
 *   minSupplyAcph:      number,  2.5 ACPH floor — minimum supply air (CFM)
 *   faAshraeAcph:       number,  ASHRAE 62.1 VRP result (CFM)
 *   maxPurgeAir:        number,  20 ACPH purge capacity (CFM)
 *   returnAir:          number,  return air (CFM) — mass balance
 *   coilAir:            number,  air through cooling coil = supply × (1 − BF)
 *   bypassAir:          number,  bypassed air = supply × BF
 *   totalExhaust:       number,  sum of all exhaust streams (CFM)
 *   exhaustGeneral:     number,  general exhaust (CFM)
 *   exhaustBibo:        number,  BIBO exhaust (CFM)
 *   exhaustMachine:     number,  machine exhaust (CFM)
 *   dehumidifiedAir:    number,  = coilAir (ACES terminology)
 *   freshAirAces:       number,  = freshAirCheck (ACES terminology)
 *   bleedAir:           number,  supply − return − freshAirCheck (floored 0)
 *   isDOAS:             boolean, true if AHU type is 'DOAS'
 *   pplCount:           number,  occupant count (sourced from envelope)
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

  // ── Room design indoor DB (°F) ──────────────────────────────────────────────
  const dbInF = isNaN(parseFloat(room.designTemp))
    ? 72
    : (parseFloat(room.designTemp) * 9) / 5 + 32;

  // ── 1. Thermal CFM ──────────────────────────────────────────────────────────
  // ΔT_supply = (1 − BF) × (T_room − ADP)
  // Guard against zero or negative ΔT — prevents division by zero and
  // nonsensical CFM when ADP ≥ room temp (misconfigured system).
  const supplyDT = (1 - bf) * (dbInF - adp);
  const thermalCFM = (supplyDT > 0 && peakErsh > 0)
    ? Math.ceil(peakErsh / (Cs * supplyDT))
    : 0;

  // ── 2. ACPH-based CFM constraints ──────────────────────────────────────────
  const minAcphCFM    = Math.round(volumeFt3 * (parseFloat(room.minAcph)    || 0) / 60);
  const designAcphCFM = Math.round(volumeFt3 * (parseFloat(room.designAcph) || 0) / 60);

  // ── 3. Governing supply air ─────────────────────────────────────────────────
  // BUG-03 FIX: three-way max — highest constraint governs.
  const supplyAir = Math.max(thermalCFM, minAcphCFM, designAcphCFM);

  const supplyAirGoverned =
    supplyAir === thermalCFM && thermalCFM > 0 ? 'thermal'
    : supplyAir === designAcphCFM             ? 'designAcph'
    :                                            'minAcph';

  // ── 4. Fresh air — ASHRAE 62.1-2022 VRP ───────────────────────────────────
  // Vbz = Rp × Pz + Ra × Az
  const pplCount    = envelope?.internalLoads?.people?.count || 0;
  const ahuType     = ahu?.type || 'Recirculating';
  const isDOAS      = ahuType === 'DOAS';
  const ventCategory = room.ventCategory || 'general';
  const vbz = calculateVbz(
  room.ventCategory,
  pplCount,
  floorAreaFt2,
);

  // DOAS: entire supply is outdoor air.
  // Recirculating: minimum outdoor air = Vbz only.
  const freshAir = isDOAS ? supplyAir : vbz;

  // ── 5. Fresh air variants ───────────────────────────────────────────────────
  // BUG-17 FIX: minSupplyAcph is a total supply floor (2.5 ACPH),
  // NOT a fresh air quantity — naming clarified.
  const minSupplyAcph     = Math.round(volumeFt3 * 2.5 / 60);
  const faAshraeAcph      = freshAir;
  const optimisedFreshAir = Math.max(freshAir, minSupplyAcph);
  const manualFA          = parseFloat(room.manualFreshAir) || 0;
  const freshAirCheck     = manualFA > 0 ? manualFA : optimisedFreshAir;
  const maxPurgeAir       = Math.round(volumeFt3 * 20 / 60);

  // ── 6. Exhaust breakdown ────────────────────────────────────────────────────
  const exhaustGeneral = parseFloat(room.exhaustAir?.general) || 0;
  const exhaustBibo    = parseFloat(room.exhaustAir?.bibo)    || 0;
  const exhaustMachine = parseFloat(room.exhaustAir?.machine) || 0;
  const totalExhaust   = exhaustGeneral + exhaustBibo + exhaustMachine;

  // ── 7. AHU air balance ──────────────────────────────────────────────────────
  const coilAir   = Math.round(supplyAir * (1 - bf));
  const bypassAir = Math.round(supplyAir * bf);

  // BUG-10 FIX: Return = Supply − freshAir − all exhausts (floored at 0)
  // ASHRAE mass balance: Supply = Return + Exhaust + Net exfiltration
  const returnAir = Math.max(0, supplyAir - freshAirCheck - totalExhaust);

  // ── 8. ACES nomenclature aliases ───────────────────────────────────────────
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
    freshAir,
    optimisedFreshAir,
    freshAirCheck,
    minSupplyAcph,
    faAshraeAcph,
    maxPurgeAir,

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