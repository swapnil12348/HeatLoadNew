/**
 * assembleRdsRow.ts
 * Pure function: maps every computed piece onto the final RDS row object.
 *
 * No calculations live here — every value arrives pre-computed from a step
 * module or from computeRdsRow's local variables. Adding or renaming an
 * output field should only require a change in this file.
 *
 * The return shape is identical to the v2.12 rdsSelector return statement,
 * preserving full backwards compatibility with RDSConfig.js / RDSRow.jsx.
 */

import type {
  Season,
  GrandTotalResult,
  EshfResult,
  ReheatResult,
  DerivedSeasonalsResult,
} from './rdsTypes';

// ─────────────────────────────────────────────────────────────────────────────
// Parameter bag — keeps the function signature manageable
// ─────────────────────────────────────────────────────────────────────────────

export interface AssembleRdsRowParams {
  // ── Room / AHU / envelope identity ──────────────────────────────────────
  room:         any;
  ahu:          any;
  envelope:     any;
  floorAreaFt2: number;
  volumeFt3:    number;

  // ── Resolved ADP and room setpoints ─────────────────────────────────────
  adpF:      number;
  ahuAdpMode: string;
  raRH:      number;

  // ── Season context ───────────────────────────────────────────────────────
  peakCFMSeason: Season;
  /** Raw season calcs for the CFM-peak season (envelopeGain, pplSens…) */
  peakCalcs:     any;
  seasonResults: Record<string, number>;

  // ── Air-quantity outputs (pre-reheat values for non-overridden fields) ───
  airQty:  any;

  // ── OA loads ────────────────────────────────────────────────────────────
  oaFields: Record<string, number>;
  oaPeak:   any;

  // ── Local intermediates ──────────────────────────────────────────────────
  rsh:       number;
  totalInfil: number;

  // ── Step results ─────────────────────────────────────────────────────────
  gt:              GrandTotalResult;
  eshfRes:         EshfResult;
  reheat:          ReheatResult;
  heatHumid:       any;
  pipes:           any;
  psychroFields:   Record<string, number>;
  derivedSeasonals: DerivedSeasonalsResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assembly
// ─────────────────────────────────────────────────────────────────────────────

export function assembleRdsRow(p: AssembleRdsRowParams): any {
  const {
    room, ahu, envelope,
    floorAreaFt2, volumeFt3,
    adpF, ahuAdpMode, raRH,
    peakCFMSeason, peakCalcs, seasonResults,
    airQty, oaFields, oaPeak,
    rsh, totalInfil,
    gt, eshfRes, reheat, heatHumid, pipes, psychroFields, derivedSeasonals,
  } = p;

  // ── Destructure step results for clean reference below ───────────────────
  const {
    peakCoolingSeason,
    supplyFanHeatBTU, returnFanHeatBTU,
    supplyFanHeatBlow, supplyFanHeatDraw, returnFanHeat,
    grandTotalSensible,
  } = gt;

  const { eshf, requiredADP, adpGap, adpSufficient, eshfType, eshfNote } = eshfRes;

  const {
    coolingCapTR,
    revisedGrandTotal, revisedCoilLoadBTU,
    reheatRequired, reheatBTU, reheatKW,
    minESHF, roomESHF,
    revisedThermalCFM,
    finalSupplyAir, finalSupplyAirGoverned,
    finalCoilAir, finalBypassAir, finalReturnAir, finalSupplyAcph,
  } = reheat;

  const {
    heatingCapBTU, heatingCap, heatingCapMBH,
    preheatCapBTU, preheatCap,
    terminalHeatingCap, extraHeatingCap,
    needsHeating, hwFlowRate,
    humidDeltaGr, mixedAirGr, humidGrTarget, winterGrOut,
    humidLbsPerHr, humidKw, humidLoadBTU,
    needsHumidification, highHumidificationLoad, humidWarning,
  } = heatHumid;

  const {
    supplyAirMinAcph, regulatoryAcphCFM,
    vbz, freshAir, optimisedFreshAir, freshAirCheck,
    minSupplyAcph, faAshraeAcph, maxPurgeAir,
    exhaustCompensation, totalExhaust, exhaustGeneral, exhaustBibo, exhaustMachine,
    freshAirAces, bleedAir, isDOAS, pplCount,
  } = airQty;

  const { pickupFields, achFields, termHeatFields } = derivedSeasonals;

  // ─────────────────────────────────────────────────────────────────────────
  // Final RDS row — field order mirrors original rdsSelector v2.12 return
  // ─────────────────────────────────────────────────────────────────────────
  return {
    // ── Identity ────────────────────────────────────────────────────────────
    ...room,
    id:           room.id,
    ahuId:        ahu.id  || '',
    typeOfUnit:   ahu.type || '-',
    isDOAS,
    people_count: pplCount,
    equipment_kw: envelope?.internalLoads?.equipment?.kw || 0,

    // ft³ / ft² — overrides m³ / m² spread from ...room above
    volume:    volumeFt3,
    floorArea: floorAreaFt2,

    // ── Peak season audit ───────────────────────────────────────────────────
    peakCFMSeason,
    peakCoolingSeason,

    // ── Core cooling outputs ─────────────────────────────────────────────────
    supplyAir:          finalSupplyAir,
    supplyAirGoverned:  finalSupplyAirGoverned,
    thermalCFM:         revisedThermalCFM,
    supplyAirMinAcph,
    regulatoryAcphCFM,
    supplyAcph:         finalSupplyAcph,
    coolingCapTR,                              // number (P1-RDS-01)
    grandTotal:         Math.round(revisedGrandTotal),
    grandTotalSensible,
    coilLoadBTU:        Math.round(revisedCoilLoadBTU),
    ersh:               peakCalcs.ersh,

    // ── Fan heat ─────────────────────────────────────────────────────────────
    supplyFanHeatBlow,
    supplyFanHeatDraw,                         // number (P1-RDS-01)
    returnFanHeat,                             // number (P1-RDS-01)

    // ── RSH + infiltration ───────────────────────────────────────────────────
    rsh,
    totalInfil,

    // ── Fresh air ────────────────────────────────────────────────────────────
    vbz,
    freshAir,
    exhaustCompensation,
    minSupplyAcph,
    faAshraeAcph,
    optimisedFreshAir,
    freshAirCheck,
    maxPurgeAir,

    // ── Exhaust ──────────────────────────────────────────────────────────────
    totalExhaust,
    exhaustGeneral,
    exhaustBibo,
    exhaustMachine,

    // ── AHU air balance ──────────────────────────────────────────────────────
    coilAir:         finalCoilAir,
    bypassAir:       finalBypassAir,
    returnAir:       finalReturnAir,
    dehumidifiedAir: finalCoilAir,
    freshAirAces,
    bleedAir,
    ahuCap:          finalSupplyAir,
    coolingLoadHL:   coolingCapTR,             // number alias

    // ── OA coil loads (all numbers, P1-RDS-01) ───────────────────────────────
    ...oaFields,

    // ── Reheater ─────────────────────────────────────────────────────────────
    reheatRequired,
    reheatBTU:  Math.round(reheatBTU),
    reheatKW,
    minESHF,                                   // already toFixed(3) from computeReheat
    roomESHF,                                  // already toFixed(3) from computeReheat

    // ── Heating ──────────────────────────────────────────────────────────────
    heatingCapBTU,
    heatingCap,
    heatingCapMBH,
    preheatCapBTU,
    preheatCap,
    terminalHeatingCap,
    extraHeatingCap,
    needsHeating,
    hwFlowRate,

    // ── Humidification ───────────────────────────────────────────────────────
    humidLoadBTU,
    humidLbsPerHr,
    humidKw,
    needsHumidification,
    humidDeltaGr,
    mixedAirGr,
    humidGrTarget,
    winterGrOut,
    highHumidificationLoad,
    humidWarning,

    // ── Pipe sizing ──────────────────────────────────────────────────────────
    chwBranchSize:   pipes.chw.branchDiamMm,
    chwManifoldSize: pipes.chw.manifoldDiamMm,
    chwFlowRate:     pipes.chw.flowGPM,
    hwBranchSize:    pipes.hw.branchDiamMm,
    hwManifoldSize:  pipes.hw.manifoldDiamMm,
    hwFlow:          pipes.hw.flowGPM,
    preheatBranchSize: pipes.preheat.branchDiamMm,
    preheatHwFlow:   pipes.preheat.flowGPM,

    // ── Coil performance ─────────────────────────────────────────────────────
    coil_shr:          psychroFields['coil_shr'],
    coil_contactFactor: psychroFields['coil_contactFactor'],
    coil_adp:          adpF,
    coil_adpMode:      ahuAdpMode,

    // ── ESHF / ADP sufficiency ───────────────────────────────────────────────
    eshf,
    requiredADP,
    adpGap,
    adpSufficient,
    eshfType,
    eshfNote,

    // ── Seasonal load results ────────────────────────────────────────────────
    ...seasonResults,

    // ── Derived seasonal fields (all numbers, P1-RDS-01) ─────────────────────
    ...pickupFields,
    ...achFields,
    ...termHeatFields,

    // ── Psychrometric state points ───────────────────────────────────────────
    ...psychroFields,

    // ── Load breakdown (Insights tab) ────────────────────────────────────────
    bd_envelope:     Math.round(peakCalcs.envelopeGain || 0),
    bd_people:       Math.round(peakCalcs.pplSens      || 0),
    bd_lights:       Math.round(peakCalcs.lightsSens   || 0),
    bd_equipment:    Math.round(peakCalcs.equipSens    || 0),
    bd_infiltration: Math.round(peakCalcs.infilSens    || 0),
    bd_oa:           Math.round(oaPeak.oaTotal         || 0),
    bd_fanHeat:      Math.round(supplyFanHeatBTU + returnFanHeatBTU),
    bd_reheat:       Math.round(reheatBTU),
    bd_grandTotal:   Math.round(revisedGrandTotal),
  };
}