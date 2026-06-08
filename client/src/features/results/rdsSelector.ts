/**
 * rdsSelector.ts
 * Responsibility: Orchestrate per-room load calculation and assemble the
 *                 complete RDS (Room Data Sheet) data object.
 *
 * This file is a PURE ORCHESTRATOR — no calculation logic lives here.
 * Every calculation is delegated to a dedicated module:
 *
 *   seasonalLoads.ts      — sensible + latent loads per season
 *   airQuantities.ts      — all CFM quantities (supply, fresh, exhaust, return)
 *   outdoorAirLoad.ts     — OA coil load (enthalpy method)
 *   heatingHumid.ts       — winter heating + humidification sizing
 *   pipeSizing.ts         — CHW / HW pipe and manifold sizing
 *   psychroStatePoints.ts — all AHU air stream state points
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ASHRAE 62.1-2022
 *            ISO 14644-1:2015
 * 
 * * ── CHANGELOG v2.12 ──────────────────────────────────────────────────────────
 *
 *   CRIT-RDS-04 FIX — Dry-coil guard added before reheat formula (STEP 4c).
 *     When grADP_sat > grIn, Math.max(0, grIn − grADP_sat) = 0 collapses minESHF
 *     to 1.0, making (1 − minESHF) = 0 and reheatBTU = Infinity. Reheat is
 *     sensible-only and cannot add latent capacity; the correct remedy is a lower
 *     ADP. The new top branch short-circuits to reheatBTU = 0 and fires a warning.
 *     The CRIT-RDS-03 fix (adpGap > 3 case) is unaffected — that path has
 *     grADP_sat < grIn, skips the new guard, and computes finite reheatBTU normally.
 *
 * ── CHANGELOG v2.11 ──────────────────────────────────────────────────────────
 *
 *   CRIT-RDS-03 FIX — minESHF < 1.0 guard removed from reheat condition (~L480).
 *     When grADP_sat > grIn, Math.max(0, grIn − grADP_sat) = 0 collapses
 *     minESHF to exactly 1.0. The old third clause `minESHF < 1.0` was therefore
 *     always false in that case, silently disabling reheat for any room with
 *     significant latent load served by a warm ADP. roomESHF < minESHF − 0.001
 *     is sufficient to detect the condition; the guard is removed.
 *
 *   HIGH-RDS-02 FIX — calculatePipeSizing now receives revisedGrandTotal (~L510).
 *     Was: revisedCoilLoadBTU (excluded supply fan heat; up to 20.6% undersize).
 *     Now: revisedGrandTotal  (matches heatingHumid coil load basis exactly).
 *     Both heatingHumid and pipeSizing must size from the same coil load.
 *
 *   WARN-RDS-03 FIX — adpSufficient pre-check added before adpSufficient (~L430).
 *     When grADP_sat > peakCalcs.grIn the coil cannot dehumidify; calculateRequired-
 *     ADP returned a type that mapped to 'not_applicable', masking an infeasible
 *     design. adpSufficient is now forced to 'insufficient' when the pre-check
 *     fires. grADP_sat declaration moved from STEP 4c to STEP 4b (declared once).
 *
 * ── CHANGELOG v2.10 ───────────────────────────────────────────────────────────
 *
 *   Diagnostic console logging added throughout.
 *
 *   To disable all logging in production, set LOG_RDS = false (line ~140).
 *   Errors (console.error) always fire regardless of LOG_RDS.
 *
 *   Log levels used:
 *     console.log   — checkpoint summaries (inputs resolved, step outputs)
 *     console.warn  — suspicious but non-fatal values (low fan heat, NaN in
 *                     non-critical fields, P0-B grains identity check)
 *     console.error — fatal for this room: NaN in critical fields, wrong types,
 *                     missing required inputs, impossible physics
 *
 *   Checks added:
 *     INPUT-01  — missing or empty rooms / climate / systemDesign / AHU
 *     INPUT-02  — resolved BF and raRH (catches silent defaults)
 *     STEP1-01  — ERSH / ERLH / grains per season; NaN on any
 *     STEP1-02  — P0-B: all three grains_* identical → likely indoor grIn bug
 *     STEP1-03  — negative ERSH in any season (impossible for cooling loads)
 *     STEP2-01  — peak CFM season and winning ERSH value
 *     STEP2-02  — ADP priority-chain branch taken and resolved adpF
 *     STEP3-01  — air quantities: supplyAir, thermalCFM, freshAir, governed
 *     STEP3-02  — supplyAir = 0 warning (room will show no airflow)
 *     STEP4-01  — OA loads per season
 *     STEP5-01  — grand total breakdown; NaN on any component
 *     STEP5-02  — fan heat suspiciously low (HIGH-RDS-01 pending flag)
 *     STEP5-03  — coolingCapTR type guard (must be number, not string)
 *     STEP6-01  — ESHF and required ADP result
 *     STEP6-02  — adpSufficient = 'insufficient' or 'no_solution' warning
 *     STEP7-01  — reheat decision: roomESHF vs minESHF, reheatBTU
 *     STEP7-02  — reheatBTU > grandTotal sanity check
 *     STEP8-01  — heating cap and humidification load
 *     FINAL-01  — NaN sweep across all critical numeric output fields
 *     FINAL-02  — type check: any string that should be number in return object
 *     FINAL-03  — summary log: TR, SA, peak season per room
 *
 * ── CHANGELOG v2.9 ────────────────────────────────────────────────────────────
 *
 *   P1-RDS-01 FIX — All .toFixed() outputs converted from string to number.
 *
 * ── CHANGELOG v2.8 ────────────────────────────────────────────────────────────
 *
 *   CRIT-RDS-01 FIX — erth mixed peakCFMSeason ERSH with peakCoolingSeason ERLH.
 *   CRIT-RDS-02 FIX — roomESHF used safety-multiplied ERSH instead of rawSensible.
 *   WARN-RDS-01 FIX — bf `|| 0.1` replaced with !isNaN() guard.
 *   WARN-RDS-02 FIX — fanHeat and returnFanHeat `|| 5` replaced with !isNaN() guards.
 *
 * ── CHANGELOG v2.7 ────────────────────────────────────────────────────────────
 *
 *   Reheater logic added (STEP 4c) — ASHRAE HOF 2021 Ch.18 §17.3.
 *
 * ── CHANGELOG v2.6 ────────────────────────────────────────────────────────────
 *
 *   ESHF / Required ADP analysis added (STEP 4b).
 *
 * ── CHANGELOG v2.5 ────────────────────────────────────────────────────────────
 *
 *   ADP-01 calculated mode — use thermalCFM not supplyAir as back-calculation basis.
 *   Load breakdown fields (bd_*) added for Insights tab.
 *
 * ── CHANGELOG v2.4 ────────────────────────────────────────────────────────────
 *
 *   Multi-season peak selection implemented.
 *
 * ── SUPPLY AIR FIELD CLARIFICATION ───────────────────────────────────────────
 *
 *   supplyAir = TOTAL supply CFM from airQuantities.ts
 *             = Math.max(thermalCFM, designAcphCFM, regulatoryAcphCFM, minAcphCFM)
 *             After reheater: Math.max(above, reheat-adjusted thermalCFM)
 *
 * ── PEAK SEASON SELECTION ────────────────────────────────────────────────────
 *
 *   peakCFMSeason     → season with highest ERSH → governs supply air CFM
 *   peakCoolingSeason → season with highest (ERSH + ERLH + OA) → governs TR
 */

import { createSelector } from '@reduxjs/toolkit';

// @ts-ignore
import { calculateSeasonLoad } from './seasonalLoads';
// @ts-ignore
import { calculateAirQuantities } from './airQuantities';
// @ts-ignore
import { calculateHeatingHumid } from './heatingHumid';

import { calculateAllSeasonOALoads } from './outdoorAirLoad';
import { calculatePipeSizing } from './pipeSizing';
import { calculateAllSeasonStatePoints } from './psychroStatePoints';

import {
  altitudeCorrectionFactor,
  sensibleFactor,
  latentFactor,
  calculateAdpFromLoads,
  calculateRequiredADP,
  calculateGrains,
} from '../../utils/psychro';

import { KW_TO_BTU_HR, m2ToFt2, m3ToFt3 } from '../../utils/units';
import ASHRAE from '../../constants/ashrae';

// ─────────────────────────────────────────────────────────────────────────────
// Debug logging
// ─────────────────────────────────────────────────────────────────────────────
//
// Set LOG_RDS = false to silence info/warn logs in production.
// console.error calls are always on — they indicate data integrity failures.
const LOG_RDS = true;

const _log  = (...a: any[]) => { if (LOG_RDS) console.log('[rdsSelector]',       ...a); };
const _warn = (...a: any[]) => { if (LOG_RDS) console.warn('[rdsSelector] ⚠',    ...a); };
const _err  = (...a: any[]) =>               console.error('[rdsSelector] ✗',    ...a);

/**
 * Checks that val is a finite number.
 * Logs a console.error and returns true if the check fails.
 * Use for fields where NaN would silently corrupt downstream arithmetic.
 */
const _badNum = (val: any, field: string, roomId: string): boolean => {
  if (typeof val !== 'number' || !isFinite(val)) {
    _err(`NaN/invalid  field="${field}"  got=${JSON.stringify(val)}  (room ${roomId})`);
    return true;
  }
  return false;
};

/** Safe numeric formatter: coerces strings → numbers before .toFixed(), returns 'n/a' on failure. */
const _fmt = (v: any, d: number): string => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isFinite(n) ? n.toFixed(d) : 'n/a';
};

/**
 * Checks that val is a finite number AND not a string.
 * Catches the P1 regression where .toFixed() returns strings.
 */
const _mustBeNumber = (val: any, field: string, roomId: string): void => {
  if (typeof val === 'string') {
    _err(`TYPE ERROR   field="${field}" is a string "${val}" — should be number  (room ${roomId})`);
  } else if (typeof val !== 'number' || !isFinite(val)) {
    _err(`NaN/invalid  field="${field}"  got=${JSON.stringify(val)}  (room ${roomId})`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface RootState {
  room: { list: any[] };
  envelope: { byRoomId: Record<string, any> };
  ahu: { list: any[] };
  climate: any;
  project: {
    systemDesign: any;
    ambient: {
      elevation?: number | string;
      latitude?: number | string;
      dailyRange?: number | string;
    };
  };
}

type Season = 'summer' | 'monsoon' | 'winter';

// ── Input selectors ───────────────────────────────────────────────────────────
const selectRooms        = (state: RootState) => state.room.list;
const selectEnvelopes    = (state: RootState) => state.envelope.byRoomId;
const selectAhus         = (state: RootState) => state.ahu.list;
const selectClimate      = (state: RootState) => state.climate;
const selectSystemDesign = (state: RootState) => state.project.systemDesign;
const selectElevation    = (state: RootState) => state.project.ambient.elevation || 0;
const selectLatitude     = (state: RootState) => state.project.ambient.latitude ?? 28;
const selectDailyRange   = (state: RootState) => state.project.ambient.dailyRange ?? 0;

// ── Main memoized selector ────────────────────────────────────────────────────
export const selectRdsData = createSelector(
  [
    selectRooms,
    selectEnvelopes,
    selectAhus,
    selectClimate,
    selectSystemDesign,
    selectElevation,
    selectLatitude,
    selectDailyRange,
  ],
  (
    rooms,
    envelopes,
    ahus,
    climate,
    systemDesign,
    elevation,
    latitude,
    dailyRange
  ) => {
    // ── INPUT-01: Selector-level input validation ─────────────────────────────
    _log(`selectRdsData fired — ${rooms?.length ?? 0} rooms, ${ahus?.length ?? 0} AHUs`);

    if (!rooms || rooms.length === 0) {
      _warn('INPUT-01: rooms list is empty — selector will return []');
    }
    if (!climate) {
      _err('INPUT-01: climate is null/undefined — all OA loads will be 0 or NaN');
    } else {
      const missingSeasons = (['summer', 'monsoon', 'winter'] as Season[]).filter(
        s => !climate?.outside?.[s]
      );
      if (missingSeasons.length > 0) {
        _err(`INPUT-01: climate missing seasons: ${missingSeasons.join(', ')} — check climateSlice`);
      }
    }
    if (!systemDesign) {
      _err('INPUT-01: systemDesign is null/undefined — all project defaults will be ASHRAE fallbacks');
    } else {
      _log(`INPUT-01: systemDesign — BF=${systemDesign.bypassFactor}, adp=${systemDesign.adp}, fanHeat=${systemDesign.fanHeat}%, returnFanHeat=${systemDesign.returnFanHeat}%, safety=${systemDesign.safetyFactor}%, ductHG=${systemDesign.ductHeatGain}%`);
    }
    if (!ahus || ahus.length === 0) {
      _warn('INPUT-01: AHU list is empty — all rooms will use fallback AHU values');
    }

    const altCf = altitudeCorrectionFactor(elevation);
    const SEASONS_LIST: Season[] = ['summer', 'monsoon', 'winter'];
    const Cs = sensibleFactor(elevation);
    const Cl = latentFactor(elevation);

    _log(`Psychro constants — elevation=${elevation}m, altCf=${altCf?.toFixed(4)}, Cs=${Cs?.toFixed(4)}, Cl=${Cl?.toFixed(4)}`);

    return rooms.map((room) => {
      // Each room gets its own collapsible group in the browser console.
      // console.groupEnd() is called in the finally block so it always fires.
      if (LOG_RDS) console.group(`[rdsSelector] ── Room ${room.id} "${room.name || '?'}" ──`);

      try {
        const envelope = envelopes[room.id] || null;
        const ahu      = ahus.find((a: any) => a.id === room.assignedAhuIds?.[0]) || {};

        // ── INPUT-01 (per room) ───────────────────────────────────────────────
        if (!envelope) {
          _warn(`INPUT-01: no envelope found for room ${room.id} — envelope gains will be 0`);
        }
        if (!ahu.id) {
          _warn(`INPUT-01: room ${room.id} has no assigned AHU (assignedAhuIds=${JSON.stringify(room.assignedAhuIds)}) — AHU defaults used`);
        } else {
          _log(`INPUT-01: AHU resolved — id=${ahu.id}, type=${ahu.type}, adpMode=${ahu.adpMode}, adp=${ahu.adp}`);
        }

        const floorAreaFt2 = m2ToFt2(room.floorArea);
        const volumeFt3    = m3ToFt3(room.volume);

        if (floorAreaFt2 <= 0) _warn(`INPUT-01: floorArea=${room.floorArea} m² → ${floorAreaFt2} ft² — check room dimensions`);
        if (volumeFt3   <= 0) _warn(`INPUT-01: volume=${room.volume} m³ → ${volumeFt3} ft³ — ACPH calculations will be 0`);

        // ── INPUT-02: Resolved BF and raRH ───────────────────────────────────
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
          _warn(`INPUT-02: room.designRH="${room.designRH}" invalid — raRH falling back to humidificationTarget=${systemDesign.humidificationTarget ?? 50}%`);
        }
        _log(`INPUT-02: raRH resolved=${raRH}%`);

        // ════════════════════════════════════════════════════════════════════════
        // STEP 1 — Seasonal loads
        // ════════════════════════════════════════════════════════════════════════
        const seasonResults: Record<string, number> = {};
        const seasonCalcs:   Record<string, any>    = {};

        SEASONS_LIST.forEach((season) => {
          const calcs = calculateSeasonLoad(
            room, envelope, climate, season, systemDesign,
            altCf, elevation, floorAreaFt2, volumeFt3, latitude, dailyRange
          );

          seasonCalcs[season] = calcs;

          seasonResults[`ershOn_${season}`] = calcs.ersh;
          seasonResults[`erlhOn_${season}`] = calcs.erlh;

          // ⚠ VERIFY (P0-B): calcs.grains must be outdoor grains for this season.
          // See STEP1-02 check below.
          seasonResults[`grains_${season}`] = calcs.grains;

          const sensSafetyMult = calcs.safetyMult * (calcs.gmpSafetyMult ?? 1.0);
          seasonResults[`ershOff_${season}`] = Math.round(calcs.ersh - calcs.equipSens * sensSafetyMult);
          seasonResults[`erlhOff_${season}`] = Math.round(calcs.erlh - calcs.equipLatent);

          // STEP1-01: NaN check on season outputs
          if (_badNum(calcs.ersh,  `ersh[${season}]`,  room.id)) { /* logged */ }
          if (_badNum(calcs.erlh,  `erlh[${season}]`,  room.id)) { /* logged */ }
          if (_badNum(calcs.grains,`grains[${season}]`,room.id)) { /* logged */ }

          // STEP1-03: Negative ERSH is physically impossible for a cooling load
          if (typeof calcs.ersh === 'number' && calcs.ersh < 0) {
            _warn(`STEP1-03: ersh[${season}]=${calcs.ersh} BTU/hr is NEGATIVE — heating-dominant room or sign error in seasonalLoads`);
          }

          _log(`STEP1: ${season.padEnd(7)} ERSH=${Math.round(calcs.ersh ?? 0).toString().padStart(7)} | ERLH=${Math.round(calcs.erlh ?? 0).toString().padStart(7)} | grains=${(calcs.grains ?? 0).toFixed(1).padStart(6)} | rawSens=${Math.round(calcs.rawSensible ?? 0).toString().padStart(7)} | safetyMult=${(sensSafetyMult).toFixed(3)}`);
        });

        // STEP1-02: P0-B — detect if all grains_* are identical (indoor grIn bug)
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
            `instead of outdoor grains. Latent load checks that use these values will be wrong.`
          );
        } else {
          _log(`STEP1-02 P0-B: grains OK — summer=${grainsSummer?.toFixed(1)}, monsoon=${grainsMonsoon?.toFixed(1)}, winter=${grainsWinter?.toFixed(1)}`);
        }

        // ── Peak ERSH season (STEP2-01) ──────────────────────────────────────
        const peakCFMSeason = SEASONS_LIST.reduce(
          (best, s) => (seasonCalcs[s].ersh > seasonCalcs[best].ersh ? s : best),
          'summer' as Season
        );
        const peakCalcs = seasonCalcs[peakCFMSeason];
        const peakErsh  = peakCalcs.ersh;
        const dbInF     = peakCalcs.dbInF ?? 72;

        _log(`STEP2-01: peakCFMSeason=${peakCFMSeason.toUpperCase()} (ERSH=${Math.round(peakErsh)}), dbInF=${dbInF.toFixed(1)}°F`);

        if (dbInF < 60 || dbInF > 85) {
          _warn(`STEP2-01: dbInF=${dbInF.toFixed(1)}°F is outside typical range 60–85°F — check room.designTemp or designDB`);
        }

        // ════════════════════════════════════════════════════════════════════════
        // ADP-01 — Resolve effective ADP (STEP2-02)
        // ════════════════════════════════════════════════════════════════════════
        const projectAdpMode  = systemDesign?.adpMode || 'manual';
        const ahuAdpMode      = ahu?.adpMode || projectAdpMode;
        const projectAdp      = parseFloat(String(systemDesign?.adp)) || ASHRAE.DEFAULT_ADP;
        const ahuAdpOverride  = parseFloat(String(ahu?.adp)) || 0;

        let adpF: number;
        let adpSource: string;

        if (ahuAdpMode === 'calculated') {
          const prelimSystemDesign = { ...systemDesign, adp: projectAdp };
          const prelimAirQty = calculateAirQuantities(
            room, envelope, ahu, prelimSystemDesign, altCf, elevation,  
            peakErsh, floorAreaFt2, volumeFt3
          );
          const adpBasisCFM = prelimAirQty.thermalCFM > 0
            ? prelimAirQty.thermalCFM
            : prelimAirQty.supplyAir;

          adpF      = calculateAdpFromLoads(dbInF, peakErsh, adpBasisCFM, bf, elevation);
          adpSource = `calculated from loads (basisCFM=${Math.round(adpBasisCFM)})`;
        } else if (ahuAdpOverride > 0) {
          adpF      = ahuAdpOverride;
          adpSource = `per-AHU override (ahu.adp=${ahuAdpOverride})`;
        } else {
          adpF      = projectAdp;
          adpSource = `project default (systemDesign.adp=${projectAdp})`;
        }

        _log(`STEP2-02: adpMode=${ahuAdpMode}, adpF=${adpF.toFixed(1)}°F [${adpSource}]`);

        if (adpF < 40 || adpF > 65) {
          _warn(`STEP2-02: adpF=${adpF.toFixed(1)}°F is outside typical range 40–65°F`);
        }
        if (adpF >= dbInF) {
          _err(`STEP2-02: adpF=${adpF.toFixed(1)}°F ≥ dbInF=${dbInF.toFixed(1)}°F — coil cannot cool. supplyDT will be ≤0 and fan heat will be 0.`);
        }

        const effectiveSystemDesign =
          adpF !== projectAdp ? { ...systemDesign, adp: adpF } : systemDesign;

        // ════════════════════════════════════════════════════════════════════════
        // STEP 2 — Air quantities (STEP3-01)
        // ════════════════════════════════════════════════════════════════════════
        const airQty = calculateAirQuantities(
          room, envelope, ahu, effectiveSystemDesign, altCf, elevation,  
          peakErsh, floorAreaFt2, volumeFt3
        );

        const {
          supplyAir,
          supplyAirGoverned,
          thermalCFM,
          supplyAirMinAcph,
          regulatoryAcphCFM,
          vbz,
          freshAir,
          optimisedFreshAir,
          freshAirCheck,
          minSupplyAcph,
          faAshraeAcph,
          maxPurgeAir,
          exhaustCompensation,
          totalExhaust,
          exhaustGeneral,
          exhaustBibo,
          exhaustMachine,
          coilAir,
          bypassAir,
          returnAir,
          dehumidifiedAir,
          freshAirAces,
          bleedAir,
          isDOAS,
          pplCount,
        } = airQty;

        _log(`STEP3-01: supplyAir=${Math.round(supplyAir)} CFM [governed by: ${supplyAirGoverned}]`);
        _log(`STEP3-01: thermalCFM=${Math.round(thermalCFM)}, freshAir=${Math.round(freshAir)}, freshAirCheck=${Math.round(freshAirCheck)}, coilAir=${Math.round(coilAir)}, bypassAir=${Math.round(bypassAir)}, returnAir=${Math.round(returnAir)}`);
        _log(`STEP3-01: exhaust — general=${Math.round(exhaustGeneral ?? 0)}, bibo=${Math.round(exhaustBibo ?? 0)}, machine=${Math.round(exhaustMachine ?? 0)}, total=${Math.round(totalExhaust ?? 0)}`);

        // STEP3-02: Zero supply air is likely a calculation failure
        if (supplyAir <= 0) {
          _err(`STEP3-02: supplyAir=${supplyAir} CFM — room will show no airflow. thermalCFM=${thermalCFM}, regulatoryAcphCFM=${regulatoryAcphCFM}`);
        }
        if (freshAirCheck < 0) {
          _err(`STEP3-02: freshAirCheck=${freshAirCheck} CFM is negative — impossible. exhaustCompensation=${exhaustCompensation}`);
        }
        if (freshAirCheck > supplyAir && supplyAir > 0) {
          _warn(`STEP3-02: freshAirCheck=${Math.round(freshAirCheck)} > supplyAir=${Math.round(supplyAir)} — 100% OA room or fresh air exceeds supply`);
        }

        const supplyAcph =
          supplyAir > 0 && volumeFt3 > 0
            ? parseFloat(((supplyAir * 60) / volumeFt3).toFixed(1))
            : 0;

        // ════════════════════════════════════════════════════════════════════════
        // STEP 3 — Outdoor air coil loads (STEP4-01)
        // ════════════════════════════════════════════════════════════════════════
        const oaLoads = calculateAllSeasonOALoads(
          freshAirCheck, climate, dbInF, raRH, elevation
        );

        // P1-RDS-01: oaFields all numbers.
        const oaFields: Record<string, number> = {};
        SEASONS_LIST.forEach((season) => {
          const oa = oaLoads[season];
          oaFields[`oaSensible_${season}`] = oa.oaSensible;
          oaFields[`oaLatent_${season}`]   = oa.oaLatentSigned;
          oaFields[`oaTotal_${season}`]    = oa.oaTotal;
          oaFields[`oaGrDelta_${season}`]  = parseFloat((oa.grOut - oa.grIn).toFixed(1));
          oaFields[`oaEnthDelta_${season}`]= parseFloat(oa.oaEnthalpyDelta.toFixed(2));

          // STEP4-01: NaN check on OA outputs
          _badNum(oa.oaTotal, `oaTotal[${season}]`, room.id);

          _log(`STEP4-01: OA[${season.padEnd(7)}] sens=${Math.round(oa.oaSensible).toString().padStart(7)} | lat=${Math.round(oa.oaLatent).toString().padStart(7)} | total=${Math.round(oa.oaTotal).toString().padStart(7)} | grDelta=${(oa.grOut - oa.grIn).toFixed(1).padStart(7)} gr`);
        });

        // ════════════════════════════════════════════════════════════════════════
        // STEP 4 — Peak cooling season + grand total (STEP5-01)
        // ════════════════════════════════════════════════════════════════════════
        const seasonTotals: Record<string, number> = {};
        SEASONS_LIST.forEach((s) => {
          seasonTotals[s] =
            (seasonResults[`ershOn_${s}`] || 0) +
            (seasonResults[`erlhOn_${s}`] || 0) +
            (oaLoads[s]?.oaTotal || 0);
        });

        const peakCoolingSeason = SEASONS_LIST.reduce(
          (best, s) => (seasonTotals[s] > seasonTotals[best] ? s : best),
          peakCFMSeason
        );

        if (peakCoolingSeason !== peakCFMSeason) {
          _log(`STEP5-01: ⚡ peakCFMSeason (${peakCFMSeason}) ≠ peakCoolingSeason (${peakCoolingSeason}) — TR season differs from CFM season`);
        }

        const peakErshForCap = seasonResults[`ershOn_${peakCoolingSeason}`];
        const peakErlhForCap = seasonResults[`erlhOn_${peakCoolingSeason}`];
        const oaPeak         = oaLoads[peakCoolingSeason];

        const parsedFanHeat        = parseFloat(String(systemDesign.fanHeat));
        const supplyFanHeatFraction= (!isNaN(parsedFanHeat)       ? parsedFanHeat       : 5) / 100;
        const parsedReturnFanHeat  = parseFloat(String(systemDesign.returnFanHeat));
        const returnFanHeatFraction= (!isNaN(parsedReturnFanHeat) ? parsedReturnFanHeat : 5) / 100;

        if (isNaN(parsedFanHeat)) {
          _warn(`STEP5-01: systemDesign.fanHeat="${systemDesign.fanHeat}" invalid — using 5% default`);
        }
        if (isNaN(parsedReturnFanHeat)) {
          _warn(`STEP5-01: systemDesign.returnFanHeat="${systemDesign.returnFanHeat}" invalid — using 5% default`);
        }

        // ⚠ HIGH-RDS-01: percentage-of-capacity proxy. See comment in v2.9 for fix.
        const supplyFanHeatBTU = Math.round(
          Math.abs(Cs * supplyAir * (dbInF - adpF) * (1 - bf)) * supplyFanHeatFraction
        );
        const returnFanHeatBTU = Math.round(supplyFanHeatBTU * returnFanHeatFraction);

        // STEP5-02: Fan heat sanity — proxy gives ~400–900 BTU for a 5 kW fan;
        // Excel gives ~17,000 BTU. Warn when supply > 1000 CFM and BTU < 500.
        if (supplyAir > 1000 && supplyFanHeatBTU < 500) {
          _warn(
            `STEP5-02 HIGH-RDS-01: supplyFanHeatBTU=${supplyFanHeatBTU} is very low ` +
            `for supplyAir=${Math.round(supplyAir)} CFM. ` +
            `Excel motor-power formula gives ~17,000 BTU/hr for a 5 kW fan. ` +
            `This will understate grandTotal and coolingCapTR until ahu.fanMotorKW is added to ahuSlice.`
          );
        }

        const grandTotal = peakErshForCap + peakErlhForCap + oaPeak.oaTotal + supplyFanHeatBTU + returnFanHeatBTU;
        const grandTotalSensible = Math.round(peakErshForCap + oaPeak.oaSensible + supplyFanHeatBTU + returnFanHeatBTU);
        const coilLoadBTU = peakErshForCap + peakErlhForCap + oaPeak.oaTotal + returnFanHeatBTU;

        // STEP5-01: Log grand total breakdown
        _log(
          `STEP5-01: grandTotal breakdown — ` +
          `ERSH=${Math.round(peakErshForCap)} + ERLH=${Math.round(peakErlhForCap)} + ` +
          `OA=${Math.round(oaPeak.oaTotal)} + fanHeat=${supplyFanHeatBTU} + retFan=${returnFanHeatBTU} ` +
          `= ${Math.round(grandTotal)} BTU/hr [peak: ${peakCoolingSeason.toUpperCase()}]`
        );

        // STEP5-01: NaN check on grand total components
        _badNum(peakErshForCap, 'peakErshForCap', room.id);
        _badNum(peakErlhForCap, 'peakErlhForCap', room.id);
        _badNum(oaPeak.oaTotal, 'oaPeak.oaTotal', room.id);
        _badNum(grandTotal,     'grandTotal',      room.id);

        if (grandTotal <= 0) {
          _err(`STEP5-01: grandTotal=${Math.round(grandTotal)} BTU/hr is ≤ 0 — room has no cooling load or inputs are wrong`);
        }

        // P1-RDS-01: supplyFanHeatDraw and returnFanHeat as numbers.
        const supplyFanHeatBlow = supplyFanHeatBTU;
        const supplyFanHeatDraw = parseFloat((supplyFanHeatBTU / KW_TO_BTU_HR).toFixed(2));
        const returnFanHeat     = parseFloat((returnFanHeatBTU / KW_TO_BTU_HR).toFixed(2));

        // ════════════════════════════════════════════════════════════════════════
        // STEP 4b — Required ADP / ESHF (STEP6-01)
        // ════════════════════════════════════════════════════════════════════════
        // grADP_sat: saturation humidity at ADP [gr/lb]. Declared here (not STEP 4c)
        // so it's available for the dehumidification pre-check below.
        // Also consumed in STEP 4c (minESHF denominator) — declared once, used in both.
        const grADP_sat = calculateGrains(adpF, 100, elevation);
        const eshfTotalSensible = (peakErshForCap || 0) + (oaPeak.oaSensible || 0);
        const eshfTotalLatent   = (peakErlhForCap || 0) + (oaPeak.oaLatent   || 0);

        const eshfResult = calculateRequiredADP(
          dbInF, peakCalcs.grIn, eshfTotalSensible, eshfTotalLatent, elevation
        );

        const eshf        = eshfResult.eshf;
        const requiredADP = eshfResult.requiredADP;
        const eshfType    = eshfResult.type;
        const eshfNote    = eshfResult.note;

        const adpGap =
          eshfType === 'found' && requiredADP !== null
            ? parseFloat((adpF - requiredADP).toFixed(1))
            : null;

        // WARN-RDS-03 FIX (v2.11): pre-check before eshfType evaluation.
        // When grADP_sat (saturation humidity at ADP) exceeds room grains (grIn),
        // the coil delivers supply air wetter than the room — dehumidification is
        // impossible at this ADP regardless of eshfType. Without this guard,
        // calculateRequiredADP returns a type that maps to 'not_applicable',
        // silently masking an infeasible coil design.
        if (grADP_sat > peakCalcs.grIn) {
          _warn(
            `STEP6-01 PRE-CHECK: grADP_sat=${grADP_sat.toFixed(1)} > grIn=${peakCalcs.grIn?.toFixed(1)} gr/lb ` +
            `— ADP=${adpF.toFixed(1)}°F cannot dehumidify (supply air wetter than room). ` +
            `adpSufficient forced to 'insufficient'.`
          );
        }

        const adpSufficient =
          grADP_sat > peakCalcs.grIn   ? 'insufficient'  :  // ADP too warm — supply air wetter than room (pre-check)
          eshfType === 'no_solution'   ? 'no_solution'    :
          eshfType === 'sensible_only' ? 'not_applicable' :
          adpGap === null              ? 'not_applicable' :
          adpGap <= 0                  ? 'yes'            :
          adpGap <= 3                  ? 'marginal'       :
                                         'insufficient';

        _log(`STEP6-01: eshf=${eshf?.toFixed(3) ?? 'n/a'}, requiredADP=${requiredADP?.toFixed(1) ?? 'n/a'}°F, adpF=${adpF.toFixed(1)}°F, adpGap=${adpGap?.toFixed(1) ?? 'n/a'}, adpSufficient=${adpSufficient}`);

        // STEP6-02: Warn on adverse ADP sufficiency results
        if (adpSufficient === 'insufficient') {
          _warn(`STEP6-02: adpSufficient=INSUFFICIENT — required ADP=${requiredADP?.toFixed(1)}°F but selected ADP=${adpF.toFixed(1)}°F. Coil cannot dehumidify to room setpoint.`);
        }
        if (adpSufficient === 'no_solution') {
          _err(`STEP6-02: adpSufficient=NO_SOLUTION — ESHF line does not intersect any achievable ADP. Psychrometrics are infeasible for this room.`);
        }
        if (adpSufficient === 'marginal') {
          _warn(`STEP6-02: adpSufficient=MARGINAL — adpGap=${adpGap?.toFixed(1)}°F (≤3°F). Coil is borderline.`);
        }

        // ════════════════════════════════════════════════════════════════════════
        // STEP 4c — Reheater requirement (STEP7-01)
        // ════════════════════════════════════════════════════════════════════════
        // grADP_sat declared in STEP 4b — available here.
        const supplyDT  = (1 - bf) * (dbInF - adpF);

        if (supplyDT <= 0) {
          _err(`STEP7-01: supplyDT=${supplyDT.toFixed(2)} ≤ 0 — coil temperature rise is zero or negative. adpF=${adpF.toFixed(1)}, dbInF=${dbInF.toFixed(1)}, bf=${bf}. Fan heat will be 0 and reheat check will be skipped.`);
        }

        const minESHFNum   = Cs * supplyDT;
        const minESHFDenom = minESHFNum + Cl * Math.max(0, peakCalcs.grIn - grADP_sat);
        const minESHF      = supplyDT > 0 && minESHFDenom > 0 ? minESHFNum / minESHFDenom : 1.0;

        const reheatCalcs = seasonCalcs[peakCoolingSeason];
        const reheatErsh  = seasonResults[`ershOn_${peakCoolingSeason}`] || 0;
        const reheatErlh  = seasonResults[`erlhOn_${peakCoolingSeason}`] || 0;

        const erthRaw  = reheatCalcs.rawSensible + reheatCalcs.rawLatent;
        const erthSafe = reheatErsh + reheatErlh;
        const roomESHF = erthRaw > 0 ? reheatCalcs.rawSensible / erthRaw : 1.0;

        if (_badNum(reheatCalcs.rawSensible, 'rawSensible', room.id) ||
            _badNum(reheatCalcs.rawLatent,   'rawLatent',   room.id)) {
          _err(`STEP7-01: rawSensible/rawLatent missing from seasonCalcs[${peakCoolingSeason}] — check seasonalLoads.ts returns these fields`);
        }

        _log(`STEP7-01: roomESHF=${roomESHF.toFixed(3)}, minESHF=${minESHF.toFixed(3)}, supplyDT=${supplyDT.toFixed(2)}°F, grIn=${peakCalcs.grIn?.toFixed(1)}, grADP_sat=${grADP_sat?.toFixed(1)}`);

        let reheatBTU      = 0;
        let reheatRequired = false;

        // CRIT-RDS-03 FIX (v2.11): removed `&& minESHF < 1.0`.
        // When grADP_sat > grIn, Math.max(0, grIn − grADP_sat) = 0 collapses
        // minESHF to exactly 1.0, making the old third clause always false and
        // silently disabling reheat even when roomESHF is far below 1.0.
        // roomESHF < minESHF − 0.001 is sufficient to detect the reheat condition;
        // the minESHF < 1.0 guard is not needed and causes incorrect suppression.
        // AFTER (v2.12):
// Dry-coil guard: when grADP_sat > grIn the coil surface is above the room's
// dew point — no condensation, no latent removal. Math.max(0, grIn − grADP_sat) = 0
// collapses minESHF to 1.0, so (1 − minESHF) = 0 and the reheat formula blows up
// to Infinity. Reheat is sensible-only; it cannot add latent capacity.
// Note: adpSufficient = 'insufficient' can also fire when adpGap > 3 (warm but
// condensing coil) — that case has minESHF < 1.0 and correctly reaches the
// else-if branch. The guard here targets only the grADP_sat > grIn pre-check.
if (grADP_sat > peakCalcs.grIn) {
  reheatRequired = false;
  reheatBTU = 0;
  _warn(
    `STEP7-01: Reheat skipped — dry coil ` +
    `(grADP_sat=${grADP_sat.toFixed(1)} > grIn=${peakCalcs.grIn?.toFixed(1)} gr/lb). ` +
    `ADP=${adpF.toFixed(1)}°F is above dew point; lower ADP to enable latent removal.`
  );
} else if (supplyDT > 0 && roomESHF < minESHF - 0.001) {
  reheatRequired = true;
  reheatBTU = Math.max(0, (minESHF * erthSafe - reheatErsh) / (1 - minESHF));
  _warn(
    `STEP7-01: REHEAT REQUIRED — roomESHF=${roomESHF.toFixed(3)} < minESHF=${minESHF.toFixed(3)}. ` +
    `reheatBTU=${Math.round(reheatBTU)}, reheatKW=${(reheatBTU / KW_TO_BTU_HR).toFixed(2)}`
  );
} else {
  _log(`STEP7-01: No reheat required (roomESHF=${roomESHF.toFixed(3)} ≥ minESHF=${minESHF.toFixed(3)})`);
}

        const reheatKW = reheatBTU > 0 ? parseFloat((reheatBTU / KW_TO_BTU_HR).toFixed(2)) : 0;

        // P1-RDS-01: coolingCapTR as number.
        const revisedGrandTotal  = grandTotal + reheatBTU;
        const coolingCapTR       = parseFloat((revisedGrandTotal / ASHRAE.BTU_PER_TON).toFixed(2));
        const revisedCoilLoadBTU = coilLoadBTU + reheatBTU;

        // STEP5-03: coolingCapTR type guard
        _mustBeNumber(coolingCapTR, 'coolingCapTR', room.id);

        // STEP7-02: Reheat > grand total is a sign error in one of the inputs
        if (reheatBTU > grandTotal && grandTotal > 0) {
          _err(`STEP7-02: reheatBTU=${Math.round(reheatBTU)} > grandTotal=${Math.round(grandTotal)} — reheat load exceeds total room load. Check minESHF formula inputs.`);
        }

        _log(`STEP5-01: coolingCapTR=${coolingCapTR} TR (type=${typeof coolingCapTR}), revisedGrandTotal=${Math.round(revisedGrandTotal)} BTU/hr`);

        const revisedThermalCFM =
          supplyDT > 0 && reheatRequired
            ? Math.ceil((reheatErsh + reheatBTU) / (Cs * supplyDT))
            : thermalCFM;

        const finalSupplyAir          = Math.max(supplyAir, revisedThermalCFM);
        const finalCoilAir            = Math.round(finalSupplyAir * (1 - bf));
        const finalBypassAir          = Math.round(finalSupplyAir * bf);
        const finalReturnAir          = Math.max(0, finalSupplyAir - freshAirCheck);
        const finalSupplyAcph         =
          finalSupplyAir > 0 && volumeFt3 > 0
            ? parseFloat(((finalSupplyAir * 60) / volumeFt3).toFixed(1))
            : 0;
        const finalSupplyAirGoverned  =
          reheatRequired && finalSupplyAir > supplyAir ? 'reheat' : supplyAirGoverned;

        if (finalSupplyAir !== supplyAir) {
          _log(`STEP7-01: reheat lifted supplyAir from ${Math.round(supplyAir)} → ${Math.round(finalSupplyAir)} CFM (governed by: reheat)`);
        }

        // ════════════════════════════════════════════════════════════════════════
        // RSH + infiltration
        // ════════════════════════════════════════════════════════════════════════
        const totalInfil = Math.round(peakCalcs.infilCFM || 0);
        const rsh        = Math.round(peakCalcs.rawSensible || 0);

        // ════════════════════════════════════════════════════════════════════════
        // STEP 5 — Heating + humidification (STEP8-01)
        // ════════════════════════════════════════════════════════════════════════
        const recircFraction = finalSupplyAir > 0 ? finalReturnAir / finalSupplyAir : 0;

        const heatHumid = calculateHeatingHumid(
          seasonResults['ershOn_winter'],
          finalSupplyAir,
          freshAirCheck,
          climate,
          dbInF,
          raRH,
          altCf,
          elevation,
          revisedGrandTotal,
          recircFraction
        );

        const {
          heatingCapBTU,
          heatingCap,
          heatingCapMBH,
          preheatCapBTU,
          preheatCap,
          terminalHeatingCap,
          extraHeatingCap,
          needsHeating,
          hwFlowRate,
          humidDeltaGr,
          mixedAirGr,
          humidGrTarget,
          winterGrOut,
          humidLbsPerHr,
          humidKw,
          humidLoadBTU,
          needsHumidification,
          highHumidificationLoad,
          humidWarning,
        } = heatHumid;

        _log(`STEP8-01: needsHeating=${needsHeating}, heatingCapBTU=${Math.round(heatingCapBTU ?? 0)}, preheatCapBTU=${Math.round(preheatCapBTU ?? 0)}, terminalHeatingCap=${terminalHeatingCap ?? 0}`);
        _log(`STEP8-01: needsHumidification=${needsHumidification}, humidLoadBTU=${Math.round(humidLoadBTU ?? 0)}, humidLbsPerHr=${humidLbsPerHr?.toFixed(2) ?? 'n/a'}, humidKw=${humidKw?.toFixed(2) ?? 'n/a'}`);

        if (humidWarning) {
          _warn(`STEP8-01: humidWarning="${humidWarning}"`);
        }
        if (highHumidificationLoad) {
          _warn(`STEP8-01: highHumidificationLoad=true — unusually large humidification requirement, verify winter OA conditions`);
        }
        _badNum(heatingCapBTU, 'heatingCapBTU', room.id);
        _badNum(humidLoadBTU,  'humidLoadBTU',  room.id);

        // ════════════════════════════════════════════════════════════════════════
        // STEP 6 — Pipe sizing
        // ════════════════════════════════════════════════════════════════════════
        // HIGH-RDS-02 FIX (v2.11): was revisedCoilLoadBTU, which excluded
        // supplyFanHeatBTU. For a draw-through AHU the coil overcomes all heat
        // in the airstream — supply fan included. revisedGrandTotal matches
        // the coil load basis already used by heatingHumid (CHW flow parity).
        const pipes = calculatePipeSizing(revisedGrandTotal, heatingCapBTU, preheatCapBTU);

        _log(`Pipes: CHW branch=${pipes.chw.branchDiamMm}mm, manifold=${pipes.chw.manifoldDiamMm}mm, flow=${pipes.chw.flowGPM?.toFixed(1)}GPM | HW branch=${pipes.hw.branchDiamMm}mm, flow=${pipes.hw.flowGPM?.toFixed(1)}GPM`);

        // ════════════════════════════════════════════════════════════════════════
        // STEP 7 — Psychrometric state points
        // ════════════════════════════════════════════════════════════════════════
        const psychroFields = calculateAllSeasonStatePoints(
          climate, dbInF, raRH, adpF, bf,
          freshAirCheck, finalSupplyAir, elevation, peakCoolingSeason
        );

        if (!psychroFields || Object.keys(psychroFields).length === 0) {
          _err('Psychro: calculateAllSeasonStatePoints returned empty — psychro cells will be blank');
        } else {
          _log(`Psychro: ${Object.keys(psychroFields).length} state-point fields computed, coil_shr=${_fmt(psychroFields['coil_shr'], 3)}, coil_contactFactor=${_fmt(psychroFields['coil_contactFactor'], 3)}`);
        }

        // ════════════════════════════════════════════════════════════════════════
        // STEP 8 — Derived seasonal fields
        // ════════════════════════════════════════════════════════════════════════
        // P1-RDS-01: All three Records narrowed to number.
        const pickupFields:   Record<string, number> = {};
        const achFields:      Record<string, number> = {};
        const termHeatFields: Record<string, number> = {};

        SEASONS_LIST.forEach((s) => {
          const e_on  = seasonResults[`ershOn_${s}`]  || 0;
          const e_off = seasonResults[`ershOff_${s}`] || 0;

          pickupFields[`pickupOn_${s}`] =
            finalSupplyAir > 0 ? parseFloat((e_on / (Cs * finalSupplyAir)).toFixed(1)) : 0;
          pickupFields[`pickupOff_${s}`] =
            finalSupplyAir > 0 ? parseFloat((e_off / (Cs * finalSupplyAir)).toFixed(1)) : 0;

          achFields[`achOn_temp_${s}`]      = parseFloat(dbInF.toFixed(1));
          achFields[`achOn_rh_${s}`]        = parseFloat(raRH.toFixed(1));
          achFields[`achOff_temp_${s}`]     = parseFloat(dbInF.toFixed(1));
          achFields[`achOff_rh_${s}`]       = parseFloat(raRH.toFixed(1));
          achFields[`achTermOn_temp_${s}`]  = parseFloat(dbInF.toFixed(1));
          achFields[`achTermOn_rh_${s}`]    = parseFloat(raRH.toFixed(1));
          achFields[`achTermOff_temp_${s}`] = parseFloat(dbInF.toFixed(1));
          achFields[`achTermOff_rh_${s}`]   = parseFloat(raRH.toFixed(1));

          termHeatFields[`termHeatOn_${s}`]  = e_on  < 0 ? parseFloat((Math.abs(e_on)  / KW_TO_BTU_HR).toFixed(2)) : 0;
          termHeatFields[`termHeatOff_${s}`] = e_off < 0 ? parseFloat((Math.abs(e_off) / KW_TO_BTU_HR).toFixed(2)) : 0;
        });

        // ════════════════════════════════════════════════════════════════════════
        // FINAL-01: NaN sweep — critical numeric outputs
        // ════════════════════════════════════════════════════════════════════════
        const criticalNums: Record<string, any> = {
          coolingCapTR,
          grandTotal: Math.round(revisedGrandTotal),
          supplyAir: finalSupplyAir,
          thermalCFM: revisedThermalCFM,
          freshAirCheck,
          coilAir: finalCoilAir,
          bypassAir: finalBypassAir,
          returnAir: finalReturnAir,
          supplyAcph: finalSupplyAcph,
          heatingCapBTU,
          humidLoadBTU,
          chwFlowRate: pipes.chw.flowGPM,
          eshf,
        };
        let hasNaN = false;
        for (const [k, v] of Object.entries(criticalNums)) {
          if (_badNum(v, k, room.id)) hasNaN = true;
        }

        // FINAL-02: Type check — fields that were strings in v2.8 and must be numbers in v2.9+
        const mustBeNums: Record<string, any> = {
          coolingCapTR,
          supplyFanHeatDraw,
          returnFanHeat,
          [`oaGrDelta_${peakCoolingSeason}`]: oaFields[`oaGrDelta_${peakCoolingSeason}`],
          [`oaEnthDelta_${peakCoolingSeason}`]: oaFields[`oaEnthDelta_${peakCoolingSeason}`],
          [`pickupOn_${peakCFMSeason}`]: pickupFields[`pickupOn_${peakCFMSeason}`],
          [`achOn_temp_summer`]: achFields['achOn_temp_summer'],
          [`termHeatOn_winter`]: termHeatFields['termHeatOn_winter'],
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

        // ════════════════════════════════════════════════════════════════════════
        // ASSEMBLE — full RDS row
        // ════════════════════════════════════════════════════════════════════════
        return {
          // ── Identity ────────────────────────────────────────────────────────
          ...room,
          id: room.id,
          ahuId: ahu.id || '',
          typeOfUnit: ahu.type || '-',
          isDOAS,
          people_count: pplCount,
          equipment_kw: envelope?.internalLoads?.equipment?.kw || 0,

          // ft³ / ft² — override m³ / m² from ...room spread.
          volume: volumeFt3,
          floorArea: floorAreaFt2,

          // ── Peak season audit ─────────────────────────────────────────────
          peakCFMSeason,
          peakCoolingSeason,

          // ── Core cooling outputs ──────────────────────────────────────────
          supplyAir: finalSupplyAir,
          supplyAirGoverned: finalSupplyAirGoverned,
          thermalCFM: revisedThermalCFM,
          supplyAirMinAcph,
          regulatoryAcphCFM,
          supplyAcph: finalSupplyAcph,
          coolingCapTR,           // number (v2.9+)
          grandTotal: Math.round(revisedGrandTotal),
          grandTotalSensible,
          coilLoadBTU: Math.round(revisedCoilLoadBTU),
          ersh: peakErsh,

          // ── Fan heat ──────────────────────────────────────────────────────
          supplyFanHeatBlow,
          supplyFanHeatDraw,      // number (v2.9+)
          returnFanHeat,          // number (v2.9+)

          // ── RSH + infiltration ────────────────────────────────────────────
          rsh,
          totalInfil,

          // ── Fresh air ─────────────────────────────────────────────────────
          vbz,
          freshAir,
          exhaustCompensation,
          minSupplyAcph,
          faAshraeAcph,
          optimisedFreshAir,
          freshAirCheck,
          maxPurgeAir,

          // ── Exhaust ───────────────────────────────────────────────────────
          totalExhaust,
          exhaustGeneral,
          exhaustBibo,
          exhaustMachine,

          // ── AHU air balance ───────────────────────────────────────────────
          coilAir: finalCoilAir,
          bypassAir: finalBypassAir,
          returnAir: finalReturnAir,
          dehumidifiedAir: finalCoilAir,
          freshAirAces,
          bleedAir,
          ahuCap: finalSupplyAir,
          coolingLoadHL: coolingCapTR, // number alias

          // ── OA coil loads ─────────────────────────────────────────────────
          ...oaFields,             // all numbers (v2.9+)

          // ── Reheater ──────────────────────────────────────────────────────
          reheatRequired,
          reheatBTU: Math.round(reheatBTU),
          reheatKW,
          minESHF: parseFloat(minESHF.toFixed(3)),
          roomESHF: parseFloat(roomESHF.toFixed(3)),

          // ── Heating ───────────────────────────────────────────────────────
          heatingCapBTU,
          heatingCap,
          heatingCapMBH,
          preheatCapBTU,
          preheatCap,
          terminalHeatingCap,
          extraHeatingCap,
          needsHeating,
          hwFlowRate,

          // ── Humidification ────────────────────────────────────────────────
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

          // ── Pipe sizing ───────────────────────────────────────────────────
          chwBranchSize: pipes.chw.branchDiamMm,
          chwManifoldSize: pipes.chw.manifoldDiamMm,
          chwFlowRate: pipes.chw.flowGPM,
          hwBranchSize: pipes.hw.branchDiamMm,
          hwManifoldSize: pipes.hw.manifoldDiamMm,
          hwFlow: pipes.hw.flowGPM,
          preheatBranchSize: pipes.preheat.branchDiamMm,
          preheatHwFlow: pipes.preheat.flowGPM,

          // ── Coil performance ──────────────────────────────────────────────
          coil_shr: psychroFields['coil_shr'],
          coil_contactFactor: psychroFields['coil_contactFactor'],
          coil_adp: adpF,
          coil_adpMode: ahuAdpMode,

          // ── ESHF / ADP sufficiency ────────────────────────────────────────
          eshf,
          requiredADP,
          adpGap,
          adpSufficient,
          eshfType,
          eshfNote,

          // ── Seasonal load results ─────────────────────────────────────────
          ...seasonResults,

          // ── Derived seasonal fields (all numbers v2.9+) ───────────────────
          ...pickupFields,
          ...achFields,
          ...termHeatFields,

          // ── Psychrometric state points ────────────────────────────────────
          ...psychroFields,

          // ── Load breakdown (Insights tab) ─────────────────────────────────
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

      } catch (err: any) {
        _err(`Room ${room.id} threw an exception:`, err);
        return {
          ...room,
          volume: 0,
          floorArea: 0,
          _error: err.message,
          _calculationFailed: true,
        };
      } finally {
        // Always close the group, even on exception.
        if (LOG_RDS) console.groupEnd();
      }
    });
  }
);