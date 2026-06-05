/**
 * airQuantities.ts
 * Responsibility: All room-level airflow quantity calculations (CFM).
 *
 * Reference: ASHRAE 62.1-2022 (Ventilation Rate Procedure)
 *            ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ISO 14644-1:2015 (Cleanroom air change rates)
 *            GMP Annex 1:2022 (Pharmaceutical cleanroom ACH requirements)
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   HIGH-AQ-01 FIX — calculateMinAchCfm imported and enforced in supply air max.
 *
 *     ventilation.ts exports calculateMinAchCfm(ventCategory, volumeFt3) which
 *     returns the REGULATORY ACH floor per category — the minimum OA the
 *     authority having jurisdiction (OSHA, NFPA 855, SEMI S2) mandates,
 *     independent of what the user enters in room.minAcph.
 *
 *     Previous code only used room.minAcph (user-entered):
 *       supplyAir = Math.max(thermalCFM, minAcphCFM, designAcphCFM)
 *
 *     The regulatory floor was never applied. A user entering room.minAcph = 6
 *     for a battery-liion room (ventilation.ts minAch: 10) produced a supply
 *     that was 40% below the NFPA 855 / IFC §1206 minimum. For a battery-
 *     leadacid room (ventilation.ts minAch: 12), the shortfall was 50%.
 *
 *     Fix: calculateMinAchCfm(room.ventCategory, volumeFt3) is now called and
 *     included in the Math.max(). It is labelled 'regulatoryAcph' in the
 *     supplyAirGoverned output so the engineer can see when the regulatory
 *     floor — not the thermal load or room ACPH setting — is the binding
 *     constraint.
 *
 *     Priority of supplyAirGoverned when values are equal:
 *       designAcph > regulatoryAcph > thermal > minAcph
 *
 *     Rationale: regulatory constraints (OSHA, NFPA 855) are hard floors that
 *     cannot be overridden by design intent. They rank above thermal load.
 *     designAcph (ISO/GMP class compliance) ranks highest because it is the
 *     most project-specific regulatory constraint.
 *
 *     Affected categories:
 *       battery-liion:    minAch = 10 CFM (NFPA 855 §15)
 *       battery-leadacid: minAch = 12 CFM (OSHA 29 CFR 1926.403(i))
 *       pharma:           minAch = 20 CFM (GMP Annex 1:2022 §4.23)
 *       semicon:          minAch = 6  CFM (SEMI S2-0200 §12 basis)
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-AQ-01 [CRITICAL]: ASHRAE.SENSIBLE_FACTOR undefined → NaN cascade.
 *   BUG-AQ-02 [LOW]: Inline cToF calculation removed.
 *   BUG-AQ-03 [LOW]: supplyAirGoverned priority chain made explicit.
 *
 * ── AIRFLOW HIERARCHY ────────────────────────────────────────────────────────
 *
 *   Supply air = max(thermalCFM, designAcphCFM, regulatoryAcphCFM, minAcphCFM)
 *   Governing constraint flagged as supplyAirGoverned.
 *
 *   1. thermalCFM        = ERSH / (Cs × ΔT_supply)
 *      ΔT_supply         = (1 − BF) × (T_room − ADP)
 *
 *   2. designAcphCFM     = Volume_ft³ × designACPH / 60  (ISO/GMP class compliance)
 *
 *   3. regulatoryAcphCFM = calculateMinAchCfm(ventCategory, volumeFt3)
 *                          REGULATORY floor from ventilation.ts — OSHA / NFPA / SEMI
 *
 *   4. minAcphCFM        = Volume_ft³ × minACPH / 60  (user-entered floor)
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

import ASHRAE                                           from '../../constants/ashrae';
import { cToF }                                        from '../../utils/units';
import { calculateVbz, calculateMinAchCfm }            from '../../constants/ventilation';
import { Room, RoomEnvelope, AHU, SystemDesign }       from '../../utils/types';

// ── Types & Interfaces ───────────────────────────────────────────────────────

export interface AirQuantitiesResult {
  supplyAir: number;
  supplyAirGoverned: 'thermal' | 'designAcph' | 'regulatoryAcph' | 'minAcph';
  thermalCFM: number;
  supplyAirMinAcph: number;
  regulatoryAcphCFM: number;
  vbz: number;
  freshAir: number;
  optimisedFreshAir: number;
  freshAirCheck: number;
  minSupplyAcph: number;
  faAshraeAcph: number;
  maxPurgeAir: number;
  exhaustCompensation: number;
  totalExhaust: number;
  exhaustGeneral: number;
  exhaustBibo: number;
  exhaustMachine: number;
  coilAir: number;
  bypassAir: number;
  returnAir: number;
  dehumidifiedAir: number;
  freshAirAces: number;
  bleedAir: number;
  isDOAS: boolean;
  pplCount: number;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * calculateAirQuantities()
 *
 * Computes all room-level airflow quantities for one room.
 * Consumed by rdsSelector.js.
 *
 * @param {Room} room                        - room state from roomSlice
 * @param {RoomEnvelope | null} envelope     - envelope state for this room
 * @param {AHU | null} ahu                   - AHU object assigned to this room
 * @param {SystemDesign} effectiveSystemDesign - state.project.systemDesign
 * @param {number} altCf                     - altitude correction factor (dimensionless, 0–1)
 * @param {number} peakErsh                  - peak (summer) ERSH in BTU/hr
 * @param {number} floorAreaFt2              - room floor area in ft²
 * @param {number} volumeFt3                 - room volume in ft³
 */
export const calculateAirQuantities = (
  room: Room,
  envelope: RoomEnvelope | null | undefined,
  ahu: AHU | null | undefined,
  effectiveSystemDesign: SystemDesign,
  altCf: number,
  peakErsh: number,
  floorAreaFt2: number,
  volumeFt3: number,
): AirQuantitiesResult => {
  const Cs  = ASHRAE.SENSIBLE_FACTOR_SEA_LEVEL * altCf;
  const bf  = parseFloat(String(effectiveSystemDesign.bypassFactor)) || 0.10;
  const adp = parseFloat(String(effectiveSystemDesign.adp))          || 55;

  // ── Room design DB (°F) ───────────────────────────────────────────────────
  const dbInFRaw = cToF(room.designTemp);
  const dbInF    = dbInFRaw === null ? 72 : dbInFRaw;

  // ── 1. Thermal CFM ────────────────────────────────────────────────────────
  const supplyDT   = (1 - bf) * (dbInF - adp);
  const thermalCFM = (supplyDT > 0 && peakErsh > 0)
    ? Math.ceil(peakErsh / (Cs * supplyDT))
    : 0;

  // ── 2. ACPH-based CFM constraints ─────────────────────────────────────────
  const minAcphCFM    = Math.round(volumeFt3 * (parseFloat(String(room.minAcph))    || 0) / 60);
  const designAcphCFM = Math.round(volumeFt3 * (parseFloat(String(room.designAcph)) || 0) / 60);

  // Regulatory ACH floor from ventilation.ts — independent of user-entered minAcph.
  // battery-liion: 10 ACPH (NFPA 855 §15), battery-leadacid: 12 ACPH (OSHA 29 CFR
  // 1926.403(i)), pharma: 20 ACPH (GMP Annex 1:2022 §4.29), semicon: 6 ACPH (SEMI S2).
  const regulatoryAcphCFM = Math.round(
    calculateMinAchCfm(room.ventCategory, volumeFt3)
  );

  // ── 3. Governing supply air ───────────────────────────────────────────────
  const supplyAir = Math.max(thermalCFM, minAcphCFM, designAcphCFM, regulatoryAcphCFM);

  // Priority when values are equal: designAcph > regulatoryAcph > thermal > minAcph.
  // Regulatory constraints (OSHA, NFPA 855) are hard floors that rank above thermal.
  // designAcph (ISO/GMP class) ranks highest as the most project-specific driver.
  let supplyAirGoverned: 'thermal' | 'designAcph' | 'regulatoryAcph' | 'minAcph';
  
  if (supplyAir === designAcphCFM && designAcphCFM > 0) {
    supplyAirGoverned = 'designAcph';
  } else if (supplyAir === regulatoryAcphCFM && regulatoryAcphCFM > 0) {
    supplyAirGoverned = 'regulatoryAcph';
  } else if (supplyAir === thermalCFM && thermalCFM > 0) {
    supplyAirGoverned = 'thermal';
  } else {
    supplyAirGoverned = 'minAcph';
  }

  // ── 4. Exhaust breakdown ──────────────────────────────────────────────────
  const exhaustGeneral = parseFloat(String(room.exhaustAir?.general)) || 0;
  const exhaustBibo    = parseFloat(String(room.exhaustAir?.bibo))    || 0;
  const exhaustMachine = parseFloat(String(room.exhaustAir?.machine)) || 0;
  const totalExhaust   = exhaustGeneral + exhaustBibo + exhaustMachine;

  // ── 5. Fresh air — ASHRAE 62.1-2022 VRP + exhaust compensation ────────────
  const pplCount = envelope?.internalLoads?.people?.count || 0;
  const vbz      = calculateVbz(room.ventCategory, pplCount, floorAreaFt2);

  const ahuType = ahu?.type || 'Recirculating';
  const isDOAS  = ahuType === 'DOAS';

  const exhaustCompensation = Math.max(0, totalExhaust - vbz);
  const freshAirMakeup      = Math.max(vbz, totalExhaust);
  const freshAir            = isDOAS ? supplyAir : freshAirMakeup;

  // ── 6. Fresh air variants ─────────────────────────────────────────────────
  const minSupplyAcph     = Math.round(volumeFt3 * 2.5 / 60);
  const faAshraeAcph      = vbz;
  const optimisedFreshAir = Math.max(freshAir, minSupplyAcph);
  const manualFA          = parseFloat(String(room.manualFreshAir)) || 0;
  const freshAirCheck     = manualFA > 0 ? manualFA : optimisedFreshAir;

  const maxPurgeAir = Math.round(volumeFt3 * 20 / 60);

  // ── 7. AHU air balance ────────────────────────────────────────────────────
  const coilAir   = Math.round(supplyAir * (1 - bf));
  const bypassAir = Math.round(supplyAir * bf);
  const returnAir = Math.max(0, supplyAir - freshAirCheck);

  // ── 8. ACES nomenclature aliases ─────────────────────────────────────────
  const dehumidifiedAir = coilAir;
  const freshAirAces    = freshAirCheck;
  const bleedAir        = Math.max(0, freshAirCheck - totalExhaust);

  return {
    // Supply air
    supplyAir,
    supplyAirGoverned,
    thermalCFM,
    supplyAirMinAcph:  minAcphCFM,
    regulatoryAcphCFM,

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