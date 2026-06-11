/**
 * computeRdsRow.ts
 * Per-room orchestrator for the RDS calculation pipeline.
 *
 * This is the function that rdsSelector's rooms.map() calls.
 * It owns:
 *   • INPUT validation (per-room)
 *   • STEP 1  — seasonal loads loop
 *   • STEP 2  — air quantities
 *   • STEP 3  — OA coil loads
 *   • STEP 4  — grand total          → computeGrandTotal()
 *   • STEP 4b — ESHF / ADP analysis  → computeEshf()
 *   • STEP 4c — reheat               → computeReheat()
 *   • STEP 5  — heating + humid
 *   • STEP 6  — pipe sizing
 *   • STEP 7  — psychro state points
 *   • STEP 8  — derived seasonals    → computeDerivedSeasonals()
 *   • FINAL   — NaN sweep
 *   • ASSEMBLE                       → assembleRdsRow()
 *
 * No calculation logic lives here — every formula is delegated.
 */

import { LOG_RDS, _log, _warn, _err, _badNum, _mustBeNumber, _fmt } from './rdsLogging';
import { SEASONS_LIST } from './rdsTypes';
import type { Season } from './rdsTypes';
import { m2ToFt2, m3ToFt3 } from '../../utils/units';

// @ts-ignore
import { calculateSeasonLoad }         from './seasonalLoads';
// @ts-ignore
import { calculateAirQuantities }      from './airQuantities';
// @ts-ignore
import { calculateHeatingHumid }       from './heatingHumid';
import { calculateAllSeasonOALoads }   from './outdoorAirLoad';
import { calculatePipeSizing }         from './pipeSizing';
import { calculateAllSeasonStatePoints } from './psychroStatePoints';

import { resolveAdp }               from './steps/resolveAdp';
import { computeGrandTotal }        from './steps/computeGrandTotal';
import { computeEshf }              from './steps/computeEshf';
import { computeReheat }            from './steps/computeReheat';
import { computeDerivedSeasonals }  from './steps/computeDerivedSeasonals';
import { assembleRdsRow }           from './assembleRdsRow';

// ─────────────────────────────────────────────────────────────────────────────

export function computeRdsRow(
  room:         any,
  envelopes:    Record<string, any>,
  ahus:         any[],
  climate:      any,
  systemDesign: any,
  altCf:        number,
  elevation:    number | string,
  latitude:     number,
  dailyRange:   number,
  Cs:           number,
  Cl:           number,
): any {
  if (LOG_RDS) console.group(`[rdsSelector] ── Room ${room.id} "${room.name || '?'}" ──`);

  try {
    const envelope = envelopes[room.id] || null;
    const ahu      = ahus.find((a: any) => a.id === room.assignedAhuIds?.[0]) || {};

    // ── INPUT-01 (per room) ─────────────────────────────────────────────────
    if (!envelope) {
      _warn(`INPUT-01: no envelope found for room ${room.id} — envelope gains will be 0`);
    }
    if (!ahu.id) {
      _warn(
        `INPUT-01: room ${room.id} has no assigned AHU ` +
        `(assignedAhuIds=${JSON.stringify(room.assignedAhuIds)}) — AHU defaults used`
      );
    } else {
      _log(`INPUT-01: AHU resolved — id=${ahu.id}, type=${ahu.type}, adpMode=${ahu.adpMode}, adp=${ahu.adp}`);
    }

    const floorAreaFt2 = m2ToFt2(room.floorArea);
    const volumeFt3    = m3ToFt3(room.volume);

    if (floorAreaFt2 <= 0) _warn(`INPUT-01: floorArea=${room.floorArea} m² → ${floorAreaFt2} ft² — check room dimensions`);
    if (volumeFt3   <= 0) _warn(`INPUT-01: volume=${room.volume} m³ → ${volumeFt3} ft³ — ACPH calculations will be 0`);

    // ── INPUT-02: Resolve BF and raRH ───────────────────────────────────────
    const parsedBf = parseFloat(String(systemDesign.bypassFactor));
    const bf       = !isNaN(parsedBf) ? parsedBf : 0.1;

    if (isNaN(parsedBf)) {
      _warn(`INPUT-02: bypassFactor="${systemDesign.bypassFactor}" is not a number — using default 0.1`);
    } else if (bf === 0) {
      _warn(`INPUT-02: bypassFactor=0 — coilAir = supplyAir (100% through coil). Intentional?`);
    } else if (bf > 0.3) {
      _warn(`INPUT-02: bypassFactor=${bf} is unusually high (>0.30) — check AHU config`);
    }
    _log(`INPUT-02: bf=${bf}, room.designRH=${room.designRH}`);

    const parsedRaRh = parseFloat(String(room.designRH));
    const raRH = !isNaN(parsedRaRh)
      ? parsedRaRh
      : systemDesign.humidificationTarget ?? 50;

    if (isNaN(parsedRaRh)) {
      _warn(
        `INPUT-02: room.designRH="${room.designRH}" invalid — raRH falling back to ` +
        `humidificationTarget=${systemDesign.humidificationTarget ?? 50}%`
      );
    }
    _log(`INPUT-02: raRH resolved=${raRH}%`);

    // ── ELEVATION UNIT CONVERSION ───────────────────────────────────────────────
// P1 BUG-HH-12 FIX: Redux persists elevation in metres (projectSlice log:
// "elevation=0m"). Every downstream psychrometric function — calculateSeasonLoad,
// calculateAirQuantities, resolveAdp, calculateAllSeasonOALoads,
// calculateHeatingHumid, calculateAllSeasonStatePoints — expects feet.
//
// Single conversion here is the canonical fix. Do NOT add conversions at
// individual call sites: that pattern led to the original mismatch.
//
// ⚠ UNRESOLVED: Cs and Cl are computed in rdsSelector.ts before this function
// is called, using the raw elevation value. If sensibleFactor/latentFactor in
// rdsSelector also expect feet, those will also be wrong for non-zero elevation.
// Track as HIGH-RDS-03 — audit rdsSelector.ts next.
const METERS_TO_FEET = 3.28084;
const elevationFt    = Number(elevation) * METERS_TO_FEET;

if (Number(elevation) > 0) {
  _log(
    `INPUT-03: elevation=${Number(elevation)}m → elevationFt=${elevationFt.toFixed(1)}ft ` +
    `(altCf=${altCf.toFixed(4)} passed in from rdsSelector — verify rdsSelector uses feet too)`
  );
}

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 1 — Seasonal loads
    // ══════════════════════════════════════════════════════════════════════════
    const seasonResults: Record<string, number> = {};
    const seasonCalcs:   Record<string, any>    = {};

    SEASONS_LIST.forEach((season) => {
      const calcs = calculateSeasonLoad(
        room, envelope, climate, season, systemDesign,
        altCf, elevationFt, floorAreaFt2, volumeFt3, latitude, dailyRange
      );
      seasonCalcs[season] = calcs;

      seasonResults[`ershOn_${season}`] = calcs.ersh;
      seasonResults[`erlhOn_${season}`] = calcs.erlh;
      seasonResults[`grains_${season}`] = calcs.grains;

      const sensSafetyMult = calcs.safetyMult * (calcs.gmpSafetyMult ?? 1.0);
      seasonResults[`ershOff_${season}`] = Math.round(calcs.ersh - calcs.equipSens * sensSafetyMult);
      seasonResults[`erlhOff_${season}`] = Math.round(calcs.erlh - calcs.equipLatent);

      // STEP1-01: NaN check
      if (_badNum(calcs.ersh,   `ersh[${season}]`,   room.id)) { /* logged */ }
      if (_badNum(calcs.erlh,   `erlh[${season}]`,   room.id)) { /* logged */ }
      if (_badNum(calcs.grains, `grains[${season}]`, room.id)) { /* logged */ }

      // STEP1-03: Negative ERSH is physically impossible for a cooling load
      if (typeof calcs.ersh === 'number' && calcs.ersh < 0) {
        _warn(`STEP1-03: ersh[${season}]=${calcs.ersh} BTU/hr is NEGATIVE — heating-dominant room or sign error in seasonalLoads`);
      }

      _log(
        `STEP1: ${season.padEnd(7)} ` +
        `ERSH=${Math.round(calcs.ersh ?? 0).toString().padStart(7)} | ` +
        `ERLH=${Math.round(calcs.erlh ?? 0).toString().padStart(7)} | ` +
        `grains=${(calcs.grains ?? 0).toFixed(1).padStart(6)} | ` +
        `rawSens=${Math.round(calcs.rawSensible ?? 0).toString().padStart(7)} | ` +
        `safetyMult=${sensSafetyMult.toFixed(3)}`
      );
    });

    // STEP1-02: P0-B — detect identical grains across seasons (indoor grIn bug)
    const grainsSummer  = seasonResults['grains_summer'];
    const grainsMonsoon = seasonResults['grains_monsoon'];
    const grainsWinter  = seasonResults['grains_winter'];
    if (
      typeof grainsSummer === 'number' &&
      grainsSummer === grainsMonsoon &&
      grainsSummer === grainsWinter
    ) {
      _warn(
        `STEP1-02 P0-B: grains_summer=grains_monsoon=grains_winter=${grainsSummer} ` +
        `— all seasons identical. seasonalLoads.ts may be returning indoor grIn ` +
        `instead of outdoor grains.`
      );
    } else {
      _log(
        `STEP1-02 P0-B: grains OK — ` +
        `summer=${grainsSummer?.toFixed(1)}, monsoon=${grainsMonsoon?.toFixed(1)}, winter=${grainsWinter?.toFixed(1)}`
      );
    }

    // STEP1-02 P0-C: flat ERSH across seasons.
// Two legitimate causes exist:
//   (a) Interior room — envelopeGain=0 for all seasons → only season-invariant
//       internal loads remain → flat ERSH is correct physics (DIAG-SL-03 explains it).
//   (b) Envelope present but calcTotalEnvelopeGain not applying season variation
//       → bug in envelopeAggregator.ts or envelopeCalc.js.
//
// Guard: only warn when at least one season has non-zero envelopeGain.
const ershVariance = Math.abs(
  (seasonCalcs.summer.ersh  ?? 0) - (seasonCalcs.winter.ersh ?? 0)
);
const hasEnvelope  = SEASONS_LIST.some(s => (seasonCalcs[s].envelopeGain ?? 0) !== 0);
const maxSeasonErsh = Math.max(...SEASONS_LIST.map(s => seasonCalcs[s].ersh ?? 0));

if (maxSeasonErsh > 0 && ershVariance < 50) {
  if (hasEnvelope) {
    _warn(
      `STEP1-02 P0-C: ERSH is flat across seasons despite non-zero envelope gain ` +
      `(summer=${Math.round(seasonCalcs.summer.ersh)}, ` +
      `winter=${Math.round(seasonCalcs.winter.ersh)}, Δ=${Math.round(ershVariance)} BTU/hr). ` +
      `calcTotalEnvelopeGain appears season-invariant. ` +
      `Check envelopeAggregator.ts — expected Δ ≈ U×A×(summerΔT − winterΔT).`
    );
  } else {
    _log(
      `STEP1-02 P0-C: ERSH flat (Δ=${Math.round(ershVariance)} BTU/hr) — ` +
      `interior room, envelopeGain=0 for all seasons. Expected physics. (DIAG-SL-03)`
    );
  }
}

    

    // ── Peak ERSH season ─────────────────────────────────────────────────────
    // AFTER
// Tropical-climate convention: summer governs CFM when ERSH is tied with monsoon
// (or all seasons identical for interior rooms). For high-latitude or data-centre
// projects where winter drives peak sensible load, this tiebreak needs re-evaluation.
const TIEBREAK_SEASON: Season = 'summer';
const peakCFMSeason = SEASONS_LIST.reduce(
  (best, s) => (seasonCalcs[s].ersh > seasonCalcs[best].ersh ? s : best),
  TIEBREAK_SEASON
);
    const peakCalcs = seasonCalcs[peakCFMSeason];
    const peakErsh  = peakCalcs.ersh;
    const dbInF     = peakCalcs.dbInF ?? 72;

    _log(`STEP2-01: peakCFMSeason=${peakCFMSeason.toUpperCase()} (ERSH=${Math.round(peakErsh)}), dbInF=${dbInF.toFixed(1)}°F`);

    if (dbInF < 60 || dbInF > 85) {
      _warn(`STEP2-01: dbInF=${dbInF.toFixed(1)}°F is outside typical range 60–85°F — check room.designTemp or designDB`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ADP-01 — Resolve effective ADP (STEP2-02)
    // ══════════════════════════════════════════════════════════════════════════
    const { adpF, adpSource, effectiveSystemDesign, ahuAdpMode } = resolveAdp(
      ahu, systemDesign, peakErsh, dbInF, bf,
      altCf, elevationFt, room, envelope,
      floorAreaFt2, volumeFt3
    );

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 2 — Air quantities (STEP3-01)
    // ══════════════════════════════════════════════════════════════════════════
    const airQty = calculateAirQuantities(
      room, envelope, ahu, effectiveSystemDesign, altCf, elevationFt,
      peakErsh, floorAreaFt2, volumeFt3
    );

    const {
      supplyAir, supplyAirGoverned, thermalCFM,
      supplyAirMinAcph, regulatoryAcphCFM,
      vbz, freshAir, optimisedFreshAir, freshAirCheck,
      minSupplyAcph, faAshraeAcph, maxPurgeAir,
      exhaustCompensation, totalExhaust, exhaustGeneral, exhaustBibo, exhaustMachine,
      coilAir, bypassAir, returnAir, dehumidifiedAir,
      freshAirAces, bleedAir, isDOAS, pplCount,
    } = airQty;

    _log(`STEP3-01: supplyAir=${Math.round(supplyAir)} CFM [governed by: ${supplyAirGoverned}]`);
    _log(
      `STEP3-01: thermalCFM=${Math.round(thermalCFM)}, freshAir=${Math.round(freshAir)}, ` +
      `freshAirCheck=${Math.round(freshAirCheck)}, coilAir=${Math.round(coilAir)}, ` +
      `bypassAir=${Math.round(bypassAir)}, returnAir=${Math.round(returnAir)}`
    );
    _log(
      `STEP3-01: exhaust — general=${Math.round(exhaustGeneral ?? 0)}, ` +
      `bibo=${Math.round(exhaustBibo ?? 0)}, machine=${Math.round(exhaustMachine ?? 0)}, ` +
      `total=${Math.round(totalExhaust ?? 0)}`
    );

    if (supplyAir <= 0) {
      _err(`STEP3-02: supplyAir=${supplyAir} CFM — room will show no airflow. thermalCFM=${thermalCFM}, regulatoryAcphCFM=${regulatoryAcphCFM}`);
    }
    if (freshAirCheck < 0) {
      _err(`STEP3-02: freshAirCheck=${freshAirCheck} CFM is negative — impossible. exhaustCompensation=${exhaustCompensation}`);
    }
    if (freshAirCheck > supplyAir && supplyAir > 0) {
      _warn(`STEP3-02: freshAirCheck=${Math.round(freshAirCheck)} > supplyAir=${Math.round(supplyAir)} — 100% OA room or fresh air exceeds supply`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 3 — Outdoor air coil loads (STEP4-01)
    // ══════════════════════════════════════════════════════════════════════════
    const oaLoads = calculateAllSeasonOALoads(
      freshAirCheck, climate, dbInF, raRH, elevationFt
    );

    const oaFields: Record<string, number> = {};
    SEASONS_LIST.forEach((season) => {
      const oa = oaLoads[season];
      oaFields[`oaSensible_${season}`]  = oa.oaSensible;
      oaFields[`oaLatent_${season}`]    = oa.oaLatentSigned;
      oaFields[`oaTotal_${season}`]     = oa.oaTotal;
      oaFields[`oaGrDelta_${season}`]   = parseFloat((oa.grOut - oa.grIn).toFixed(1));
      oaFields[`oaEnthDelta_${season}`] = parseFloat(oa.oaEnthalpyDelta.toFixed(2));

      _badNum(oa.oaTotal, `oaTotal[${season}]`, room.id);
      _log(
        `STEP4-01: OA[${season.padEnd(7)}] ` +
        `sens=${Math.round(oa.oaSensible).toString().padStart(7)} | ` +
        `lat=${Math.round(oa.oaLatent).toString().padStart(7)} | ` +
        `total=${Math.round(oa.oaTotal).toString().padStart(7)} | ` +
        `grDelta=${(oa.grOut - oa.grIn).toFixed(1).padStart(7)} gr`
      );
    });

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 4 — Grand total
    // ══════════════════════════════════════════════════════════════════════════
    const gt = computeGrandTotal(
      seasonResults, oaLoads, systemDesign,
      supplyAir, adpF, dbInF, bf, Cs,
      peakCFMSeason, room.id
    );

    const {
      peakCoolingSeason,
      peakErshForCap, peakErlhForCap, oaPeak,
      supplyFanHeatBTU, returnFanHeatBTU,
      grandTotal, coilLoadBTU,
    } = gt;

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 4b — Required ADP / ESHF
    // ══════════════════════════════════════════════════════════════════════════
    const eshfRes = computeEshf(
      peakCalcs, peakErshForCap, peakErlhForCap, oaPeak,
      adpF, dbInF, elevationFt
    );

    const { grADP_sat } = eshfRes;

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 4c — Reheater requirement
    // ══════════════════════════════════════════════════════════════════════════
    const reheat = computeReheat(
      peakCalcs, seasonCalcs, seasonResults, peakCoolingSeason,
      grandTotal, coilLoadBTU,
      grADP_sat, adpF, dbInF, bf,
      supplyAir, supplyAirGoverned, thermalCFM, freshAirCheck, volumeFt3,
      Cs, Cl, room.id
    );

    const {
      revisedGrandTotal, revisedCoilLoadBTU, coolingCapTR,
      reheatBTU, reheatRequired,
      finalSupplyAir, finalReturnAir,
      revisedThermalCFM, finalSupplyAcph,
      finalCoilAir, finalBypassAir,
    } = reheat;

    // ── RSH + infiltration ────────────────────────────────────────────────────
    const rsh        = Math.round(peakCalcs.rawSensible || 0);
    const totalInfil = Math.round(peakCalcs.infilCFM    || 0);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 5 — Heating + humidification (STEP8-01)
    // ══════════════════════════════════════════════════════════════════════════
    const recircFraction = finalSupplyAir > 0 ? finalReturnAir / finalSupplyAir : 0;

    const heatHumid = calculateHeatingHumid(
      seasonResults['ershOn_winter'],
      finalSupplyAir,
      freshAirCheck,
      climate,
      dbInF,
      raRH,
      altCf,
      elevationFt,
      Math.round(revisedGrandTotal),
      recircFraction
    );

    const {
      heatingCapBTU, preheatCapBTU,
      terminalHeatingCap, needsHeating,
      humidLoadBTU, humidLbsPerHr, humidKw,
      needsHumidification, highHumidificationLoad, humidWarning,
    } = heatHumid;

    _log(
      `STEP8-01: needsHeating=${needsHeating}, ` +
      `heatingCapBTU=${Math.round(heatingCapBTU ?? 0)}, ` +
      `preheatCapBTU=${Math.round(preheatCapBTU ?? 0)}, ` +
      `terminalHeatingCap=${terminalHeatingCap ?? 0}`
    );
    _log(
      `STEP8-01: needsHumidification=${needsHumidification}, ` +
      `humidLoadBTU=${Math.round(humidLoadBTU ?? 0)}, ` +
      `humidLbsPerHr=${humidLbsPerHr?.toFixed(2) ?? 'n/a'}, ` +
      `humidKw=${humidKw?.toFixed(2) ?? 'n/a'}`
    );
    if (humidWarning)           _warn(`STEP8-01: humidWarning="${humidWarning}"`);
    if (highHumidificationLoad) _warn(`STEP8-01: highHumidificationLoad=true — verify winter OA conditions`);
    _badNum(heatingCapBTU, 'heatingCapBTU', room.id);
    _badNum(humidLoadBTU,  'humidLoadBTU',  room.id);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 6 — Pipe sizing
    // HIGH-RDS-02 (v2.11): pass revisedGrandTotal, not revisedCoilLoadBTU.
    // Both heatingHumid and pipeSizing must size from the same coil load basis.
    // ══════════════════════════════════════════════════════════════════════════
    const pipes = calculatePipeSizing(revisedGrandTotal, heatingCapBTU, preheatCapBTU);

    _log(
      `Pipes: CHW branch=${pipes.chw.branchDiamMm}mm, manifold=${pipes.chw.manifoldDiamMm}mm, ` +
      `flow=${pipes.chw.flowGPM?.toFixed(1)}GPM | ` +
      `HW branch=${pipes.hw.branchDiamMm}mm, flow=${pipes.hw.flowGPM?.toFixed(1)}GPM`
    );

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 7 — Psychrometric state points
    // ══════════════════════════════════════════════════════════════════════════
    const psychroFields = calculateAllSeasonStatePoints(
      climate, dbInF, raRH, adpF, bf,
      freshAirCheck, finalSupplyAir, elevationFt, peakCoolingSeason
    );

    if (!psychroFields || Object.keys(psychroFields).length === 0) {
      _err('Psychro: calculateAllSeasonStatePoints returned empty — psychro cells will be blank');
    } else {
      _log(
        `Psychro: ${Object.keys(psychroFields).length} state-point fields computed, ` +
        `coil_shr=${_fmt(psychroFields['coil_shr'], 3)}, ` +
        `coil_contactFactor=${_fmt(psychroFields['coil_contactFactor'], 3)}`
      );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 8 — Derived seasonal fields
    // ══════════════════════════════════════════════════════════════════════════
    const derivedSeasonals = computeDerivedSeasonals(
      seasonResults, finalSupplyAir, dbInF, raRH, Cs
    );

    const { pickupFields, achFields, termHeatFields } = derivedSeasonals;

    // ══════════════════════════════════════════════════════════════════════════
    // FINAL-01: NaN sweep — critical numeric outputs
    // ══════════════════════════════════════════════════════════════════════════
    const criticalNums: Record<string, any> = {
      coolingCapTR,
      grandTotal:   Math.round(revisedGrandTotal),
      supplyAir:    finalSupplyAir,
      thermalCFM:   revisedThermalCFM,
      freshAirCheck,
      coilAir:      finalCoilAir,
      bypassAir:    finalBypassAir,
      returnAir:    finalReturnAir,
      supplyAcph:   finalSupplyAcph,
      heatingCapBTU,
      humidLoadBTU,
      chwFlowRate:  pipes.chw.flowGPM,
      eshf:         eshfRes.eshf,
    };
    let hasNaN = false;
    for (const [k, v] of Object.entries(criticalNums)) {
      if (_badNum(v, k, room.id)) hasNaN = true;
    }

    // FINAL-02: Type check — must be numbers, not strings
    const mustBeNums: Record<string, any> = {
      coolingCapTR,
      supplyFanHeatDraw:                           gt.supplyFanHeatDraw,
      returnFanHeat:                               gt.returnFanHeat,
      [`oaGrDelta_${peakCoolingSeason}`]:          oaFields[`oaGrDelta_${peakCoolingSeason}`],
      [`oaEnthDelta_${peakCoolingSeason}`]:         oaFields[`oaEnthDelta_${peakCoolingSeason}`],
      [`pickupOn_${peakCFMSeason}`]:               pickupFields[`pickupOn_${peakCFMSeason}`],
      [`achOn_temp_summer`]:                       achFields['achOn_temp_summer'],
      [`termHeatOn_winter`]:                       termHeatFields['termHeatOn_winter'],
    };
    for (const [k, v] of Object.entries(mustBeNums)) {
      _mustBeNumber(v, k, room.id);
    }

    // FINAL-03: Summary log
    if (!hasNaN) {
      _log(
        `✅ OK — TR=${coolingCapTR} | SA=${Math.round(finalSupplyAir)} CFM | ` +
        `peakCFM=${peakCFMSeason} | peakCool=${peakCoolingSeason} | ` +
        `reheat=${reheatRequired ? `YES (${Math.round(reheatBTU)} BTU)` : 'no'} | ` +
        `heat=${needsHeating ? `YES (${Math.round(heatingCapBTU)} BTU)` : 'no'}`
      );
    } else {
      _err(`Room ${room.id} has NaN in critical output fields — RDS row is unreliable`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ASSEMBLE
    // ══════════════════════════════════════════════════════════════════════════
    return assembleRdsRow({
      room, ahu, envelope,
      floorAreaFt2, volumeFt3,
      adpF, ahuAdpMode, raRH,
      peakCFMSeason, peakCalcs, seasonResults,
      airQty,
      oaFields, oaPeak,
      rsh, totalInfil,
      gt, eshfRes, reheat,
      heatHumid, pipes, psychroFields,
      derivedSeasonals,
    });

  } catch (err: any) {
    _err(`Room ${room.id} threw an exception:`, err);
    return {
      ...room,
      volume:               0,
      floorArea:            0,
      _error:               err.message,
      _calculationFailed:   true,
    };
  } finally {
    if (LOG_RDS) console.groupEnd();
  }
}