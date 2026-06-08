/**
 * airQuantities.ts
 * Responsibility: All room-level airflow quantity calculations (CFM).
 *
 * Reference: ASHRAE 62.1-2022 (Ventilation Rate Procedure)
 *            ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ISO 14644-1:2015 (Cleanroom air change rates)
 *            GMP Annex 1:2022 (Pharmaceutical cleanroom ACH requirements)
 * 
 * // ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
//
//   WARN-AQ-01 FIX — bypassFactor `|| 0.10` replaced with null-coalescing guard.
//
//     BF = 0 (100% coil contact — valid for coil selection studies and academic
//     comparisons) silently became 0.10. Impact: thermalCFM, coilAir, bypassAir
//     all computed with wrong BF. Fix: !isNaN() pattern, consistent with
//     seasonalLoads v2.1 (designRH), v2.3 (safetyFactor), rdsSelector v2.8 (bf).
//
//   WARN-AQ-02 FIX — pplCount now explicitly parsed before passing to calculateVbz.
//
//     Redux state stores numeric inputs as strings. `count || 0` returned the
//     raw string "5" (truthy) rather than the number 5. calculateVbz() received
//     "5" and coerced it arithmetically — correct by accident. Explicit parseFloat
//     removes the implicit cast and is consistent with all other numeric inputs.
//
//   INFO-AQ-01 — Mass balance comment in module header corrected.
//
//     Header stated "Return = Supply − freshAirCheck − totalExhaust" which breaks
//     the AHU mass balance identity (return + freshAir = supply). Code was correct;
//     comment was wrong. See updated MASS BALANCE section.
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
 *   Return = Supply − freshAirCheck  (floored at 0)
 *
 *   freshAirCheck already ≥ totalExhaust via exhaust compensation logic:
 *     freshAirMakeup = max(vbz, totalExhaust)
 *   When freshAirCheck > totalExhaust the excess is building pressurisation
 *   (exfiltration). Subtracting totalExhaust again would break the AHU mass
 *   balance: returnAir + freshAirCheck must equal supplyAir.
 */

import ASHRAE                                           from '../../constants/ashrae';
import { cToF }                                        from '../../utils/units';
import { calculateVbz, calculateMinAchCfm }            from '../../constants/ventilation';
import { Room, RoomEnvelope, AHU, SystemDesign }       from '../../utils/types';
import { sensibleFactor }   from '../../utils/psychro'; 



const LOG_AQ = true;

const _log  = (...a: any[]) => { if (LOG_AQ) console.log ('[airQuantities]',   ...a); };
const _warn = (...a: any[]) => { if (LOG_AQ) console.warn('[airQuantities] ⚠', ...a); };
const _err  = (...a: any[]) =>               console.error('[airQuantities] ✗', ...a);

const _badNum = (val: any, field: string): boolean => {
  if (typeof val !== 'number' || !isFinite(val)) {
    _err(`NaN/invalid  field="${field}"  got=${JSON.stringify(val)}`);
    return true;
  }
  return false;
};

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
 *  * @param {number} peakErsh                  - peak ERSH across all three seasons (BTU/hr).
 *                                             Caller must pass max(summer, monsoon, 0) —
 *                                             never summer-only. Verified correct in
 *                                             rdsSelector v2.4+ via SEASONS_LIST.reduce().
 * @param {number} floorAreaFt2              - room floor area in ft²
 * @param {number} volumeFt3                 - room volume in ft³
 */
export const calculateAirQuantities = (
  room:                   Room,
  envelope:               RoomEnvelope | null | undefined,
  ahu:                    AHU          | null | undefined,
  effectiveSystemDesign:  SystemDesign,
  altCf:                  number,
  elevationFt:            number,        // ← ADD: needed for sensibleFactor()
  peakErsh:               number,
  floorAreaFt2:           number,
  volumeFt3:              number,
): AirQuantitiesResult => {

  if (LOG_AQ) console.group('[airQuantities] ── calculateAirQuantities ──');

  try {

    // ── INPUT-01 — parameter validation ────────────────────────────────────
    _log(
      `INPUT-01: roomId=${room?.id} | ventCategory=${room?.ventCategory} | ` +
      `peakErsh=${Math.round(peakErsh)} BTU/hr | area=${floorAreaFt2.toFixed(1)} ft² | ` +
      `volume=${volumeFt3.toFixed(1)} ft³ | altCf=${altCf.toFixed(4)} | elev=${elevationFt}ft`
    );

    if (_badNum(peakErsh,     'peakErsh'))    { /* logged */ }
    if (_badNum(floorAreaFt2, 'floorAreaFt2')){ /* logged */ }
    if (_badNum(volumeFt3,    'volumeFt3'))    { /* logged */ }
    if (_badNum(altCf,        'altCf'))        { /* logged */ }

    if (volumeFt3 <= 0) _err(`INPUT-01: volumeFt3=${volumeFt3} — all ACPH-based CFM will be 0`);
    if (altCf > 1 || altCf <= 0) _warn(`INPUT-01: altCf=${altCf} outside (0,1] — check elevation input`);

    // ── INPUT-02 — design constants ─────────────────────────────────────────
    // FIX BUG-AQ-CS: use sensibleFactor(elevationFt) per ashrae.ts BUG-SL-01 prohibition
    const Cs  = sensibleFactor(elevationFt);
    const parsedBf = parseFloat(String(effectiveSystemDesign.bypassFactor));
    const bf       = !isNaN(parsedBf) ? parsedBf : 0.10;
    const adp      = parseFloat(String(effectiveSystemDesign.adp)) || 55;

    const dbInFRaw = cToF(room.designTemp);
    const dbInF    = dbInFRaw === null ? 72 : dbInFRaw;

    _log(
      `INPUT-02: Cs=${Cs.toFixed(4)} | bf=${bf} | adp=${adp}°F | ` +
      `dbInF=${dbInF}°F | ahuType=${ahu?.type ?? 'Recirculating'}`
    );

    if (_badNum(Cs, 'Cs')) { /* logged */ }
    if (bf === 0.10 && !parseFloat(String(effectiveSystemDesign.bypassFactor))) {
      _warn('INPUT-02: bypassFactor missing — defaulted to 0.10');
    }
    if (adp === 55 && !parseFloat(String(effectiveSystemDesign.adp))) {
      _warn('INPUT-02: adp missing — defaulted to 55°F');
    }

    // ── STEP 1 — Thermal CFM ────────────────────────────────────────────────
    const supplyDT   = (1 - bf) * (dbInF - adp);
    const thermalCFM = (supplyDT > 0 && peakErsh > 0)
      ? Math.ceil(peakErsh / (Cs * supplyDT))
      : 0;

    _log(
      `STEP1: supplyDT=${supplyDT.toFixed(2)}°F | peakErsh=${Math.round(peakErsh)} BTU/hr | ` +
      `thermalCFM=${thermalCFM} CFM`
    );

    if (supplyDT <= 0) _warn(`STEP1: supplyDT=${supplyDT.toFixed(2)}°F ≤ 0 — check adp=${adp}°F vs dbInF=${dbInF}°F`);
    if (thermalCFM > 100_000) _warn(`STEP1: thermalCFM=${thermalCFM} is very high — verify peakErsh and ADP`);

    // ── STEP 2 — ACPH constraints ───────────────────────────────────────────
    const minAcphCFM    = Math.round(volumeFt3 * (parseFloat(String(room.minAcph))    || 0) / 60);
    const designAcphCFM = Math.round(volumeFt3 * (parseFloat(String(room.designAcph)) || 0) / 60);
    const regulatoryAcphCFM = Math.round(calculateMinAchCfm(room.ventCategory, volumeFt3));

    _log(
      `STEP2: minAcphCFM=${minAcphCFM} | designAcphCFM=${designAcphCFM} | ` +
      `regulatoryAcphCFM=${regulatoryAcphCFM} [ventCategory=${room.ventCategory}]`
    );

    if (regulatoryAcphCFM > designAcphCFM && designAcphCFM > 0) {
      _warn(
        `STEP2: regulatoryAcphCFM=${regulatoryAcphCFM} > designAcphCFM=${designAcphCFM} — ` +
        `regulatory floor (OSHA/NFPA/SEMI) overrides design ACH for ventCategory=${room.ventCategory}`
      );
    }

    // ── STEP 3 — Governing supply air ───────────────────────────────────────
    const supplyAir = Math.max(thermalCFM, minAcphCFM, designAcphCFM, regulatoryAcphCFM);

    let supplyAirGoverned: 'thermal' | 'designAcph' | 'regulatoryAcph' | 'minAcph';
    if      (supplyAir === designAcphCFM    && designAcphCFM    > 0) supplyAirGoverned = 'designAcph';
    else if (supplyAir === regulatoryAcphCFM && regulatoryAcphCFM > 0) supplyAirGoverned = 'regulatoryAcph';
    else if (supplyAir === thermalCFM       && thermalCFM       > 0) supplyAirGoverned = 'thermal';
    else                                                               supplyAirGoverned = 'minAcph';

    _log(`STEP3: supplyAir=${supplyAir} CFM [governed by: ${supplyAirGoverned}]`);

    if (supplyAir === 0) _err('STEP3: supplyAir=0 — all constraints resolved to zero. Check room volume and ACPH inputs.');

    // ── STEP 4 — Exhaust ────────────────────────────────────────────────────
    const exhaustGeneral = parseFloat(String(room.exhaustAir?.general)) || 0;
    const exhaustBibo    = parseFloat(String(room.exhaustAir?.bibo))    || 0;
    const exhaustMachine = parseFloat(String(room.exhaustAir?.machine)) || 0;
    const totalExhaust   = exhaustGeneral + exhaustBibo + exhaustMachine;

    _log(`STEP4: exhaust — general=${exhaustGeneral}, bibo=${exhaustBibo}, machine=${exhaustMachine}, total=${totalExhaust}`);

    if (totalExhaust > supplyAir) {
      _warn(
        `STEP4: totalExhaust=${totalExhaust} > supplyAir=${supplyAir} — ` +
        `exhaust exceeds supply. Negative-pressure room or data entry error?`
      );
    }

    // ── STEP 5 — Fresh air ──────────────────────────────────────────────────
    const rawPplCount = parseFloat(String(envelope?.internalLoads?.people?.count));
    const pplCount    = !isNaN(rawPplCount) ? rawPplCount : 0;
    const vbz         = calculateVbz(room.ventCategory, pplCount, floorAreaFt2);
    const ahuType     = ahu?.type || 'Recirculating';
    const isDOAS      = ahuType === 'DOAS';

    const exhaustCompensation = Math.max(0, totalExhaust - vbz);
    const freshAirMakeup      = Math.max(vbz, totalExhaust);
    const freshAir            = isDOAS ? supplyAir : freshAirMakeup;

    // ⚠️ minSupplyAcph stores CFM (volume × 2.5 / 60), NOT an ACH rate.
    // Name retained to avoid breaking changes — see TODO in header.
    // Basis: 2.5 ACH — SOURCE UNVERIFIED. Must confirm against project spec.
    const minSupplyAcph     = Math.round(volumeFt3 * 2.5 / 60);
    // faAshraeAcph stores Vbz in CFM — not an ACH rate despite the name.
    const faAshraeAcph      = vbz;
    const optimisedFreshAir = Math.max(freshAir, minSupplyAcph);
    const manualFA          = parseFloat(String(room.manualFreshAir)) || 0;
    const freshAirCheck     = manualFA > 0 ? manualFA : optimisedFreshAir;
    const maxPurgeAir       = Math.round(volumeFt3 * 20 / 60);

    _log(
      `STEP5: pplCount=${pplCount} | vbz=${vbz.toFixed(1)} CFM | ` +
      `freshAir(62.1)=${freshAir.toFixed(1)} | minSupplyAcph(CFM)=${minSupplyAcph} | ` +
      `optimisedFreshAir=${optimisedFreshAir} | manualFA=${manualFA} | ` +
      `freshAirCheck=${freshAirCheck} [${manualFA > 0 ? 'manual override' : 'auto'}]`
    );

    if (freshAirCheck < vbz) {
      _err(
        `STEP5: freshAirCheck=${freshAirCheck} CFM < vbz=${vbz.toFixed(1)} CFM — ` +
        `OA is below ASHRAE 62.1 minimum. Check manualFreshAir override.`
      );
    }
    if (freshAirCheck < totalExhaust) {
      _warn(`STEP5: freshAirCheck=${freshAirCheck} < totalExhaust=${totalExhaust} — building will go negative pressure`);
    }
    if (manualFA > 0) {
      _warn(`STEP5: manualFreshAir override active (${manualFA} CFM) — 62.1 Vbz compliance not auto-enforced`);
    }

    // ── STEP 6 — AHU air balance ────────────────────────────────────────────
    const coilAir   = Math.round(supplyAir * (1 - bf));
    const bypassAir = Math.round(supplyAir * bf);
    const returnAir = Math.max(0, supplyAir - freshAirCheck);

    _log(
      `STEP6: coilAir=${coilAir} | bypassAir=${bypassAir} | returnAir=${returnAir} | ` +
      `check: coil+bypass=${coilAir + bypassAir} (should = supplyAir=${supplyAir})`
    );

    if (coilAir + bypassAir !== supplyAir) {
      _warn(`STEP6: coilAir(${coilAir}) + bypassAir(${bypassAir}) ≠ supplyAir(${supplyAir}) — rounding gap`);
    }
    if (returnAir + freshAirCheck !== supplyAir) {
      _warn(
        `STEP6: mass balance gap — returnAir(${returnAir}) + freshAirCheck(${freshAirCheck}) ` +
        `= ${returnAir + freshAirCheck} ≠ supplyAir(${supplyAir})`
      );
    }

    const dehumidifiedAir = coilAir;
    const freshAirAces    = freshAirCheck;
    const bleedAir        = Math.max(0, freshAirCheck - totalExhaust);

    // ── FINAL — NaN sweep ───────────────────────────────────────────────────
    const criticalOutputs = { supplyAir, thermalCFM, vbz, freshAirCheck, coilAir, bypassAir, returnAir };
    let hasNaN = false;
    for (const [k, v] of Object.entries(criticalOutputs)) {
      if (_badNum(v, k)) hasNaN = true;
    }

    if (!hasNaN) {
      _log(
        `✅ OK — supply=${supplyAir} CFM [${supplyAirGoverned}] | ` +
        `OA=${freshAirCheck} CFM | coil=${coilAir} | return=${returnAir} | exhaust=${totalExhaust}`
      );
    } else {
      _err('FINAL: NaN in critical outputs — airflow data unreliable for this room');
    }

    return {
      supplyAir, supplyAirGoverned, thermalCFM,
      supplyAirMinAcph: minAcphCFM, regulatoryAcphCFM,
      vbz, freshAir, optimisedFreshAir, freshAirCheck,
      minSupplyAcph, faAshraeAcph, maxPurgeAir, exhaustCompensation,
      totalExhaust, exhaustGeneral, exhaustBibo, exhaustMachine,
      coilAir, bypassAir, returnAir,
      dehumidifiedAir, freshAirAces, bleedAir,
      isDOAS, pplCount,
    };

  } finally {
    if (LOG_AQ) console.groupEnd();
  }
};