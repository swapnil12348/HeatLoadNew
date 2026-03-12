/**
 * rdsSelector.js
 * Responsibility: Orchestrate per-room load calculation and assemble the
 *                 complete RDS (Room Data Sheet) data object.
 *
 * This file is a PURE ORCHESTRATOR — no calculation logic lives here.
 * Every calculation is delegated to a dedicated module:
 *
 *   seasonalLoads.js      — sensible + latent loads per season
 *   airQuantities.js      — all CFM quantities (supply, fresh, exhaust, return)
 *   outdoorAirLoad.js     — OA coil load (enthalpy method)
 *   heatingHumid.js       — winter heating + humidification sizing
 *   pipeSizing.js         — CHW / HW pipe and manifold sizing
 *   psychroStatePoints.js — all AHU air stream state points
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ASHRAE 62.1-2022
 *            ISO 14644-1:2015
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   ADP-01 — Apparatus Dew Point mode: 'manual' | 'calculated' per AHU.
 *
 *     Each AHU now carries an adpMode field (added to ahuSlice.js makeAhu).
 *     rdsSelector resolves the effective ADP per room before STEP 2 so that
 *     airQuantities.js, psychroStatePoints.js, and all downstream calcs receive
 *     the same consistent value.
 *
 *     Priority chain (most specific wins):
 *       1. ahuAdpMode = 'calculated' → calculateAdpFromLoads() from psychro.js
 *          T_ADP = T_room − ERSH ÷ (Cs × coilAir)
 *          Two-pass approach breaks the supplyAir ↔ ADP circular dependency:
 *            Pass 1: preliminary airQuantities with project-default ADP
 *            Pass 2: calculateAdpFromLoads from preliminary supplyAir → adpF
 *            Final:  effectiveSystemDesign = { ...systemDesign, adp: adpF }
 *                    passed to the real airQuantities call in STEP 2.
 *       2. ahu.adp > 0 → per-AHU manual override (°F)
 *       3. systemDesign.adp → project-level default
 *       4. ASHRAE.DEFAULT_ADP → 55°F hardcoded fallback
 *
 *     ADP resolution block is placed AFTER STEP 1 (seasonal loads) because
 *     'calculated' mode requires peakErsh and dbInF, which are only available
 *     after calculateSeasonLoad() completes. Placing the block before STEP 1
 *     would cause peakErsh = undefined → calculateAdpFromLoads returns
 *     DEFAULT_ADP silently, making 'calculated' mode a no-op.
 *
 *     coil_adp and coil_adpMode are exposed in the assembled return object
 *     for RDS display and AdpCalculatedReadout in AHUConfig.jsx.
 *
 *   BUG-RDS-ADP-01 FIX — ADP block ordering: moved after STEP 1.
 *
 *     Previous placement (before STEP 1) referenced peakErsh and dbInF before
 *     they were defined. In 'calculated' mode:
 *       calculateAdpFromLoads(dbInF=undefined, peakErsh=undefined, ...)
 *       → guard: peakErsh <= 0 → returns ASHRAE.DEFAULT_ADP every time
 *       → 'calculated' mode was silently identical to 'manual' mode
 *
 *   BUG-RDS-ADP-02 FIX — STEP 2 now passes effectiveSystemDesign.
 *
 *     Previous STEP 2 still passed raw systemDesign instead of
 *     effectiveSystemDesign, so the resolved adpF was never actually used
 *     by calculateAirQuantities (which reads systemDesign.adp internally).
 *     airQuantities always used the project-default ADP regardless of mode.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   CRIT-RDS-01 FIX — rdsRow.volume and rdsRow.floorArea now in ft³ / ft².
 *   CRIT-RDS-02 FIX — grandTotal and coilLoadBTU now use oaTotal (enthalpy method).
 *   HIGH-HH-01 FIX  — recirculationFraction now passed to calculateHeatingHumid.
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   FIX CRIT-01: OA coil load included in grandTotal (was missing → 15–40% understatement)
 *   FIX MED-01:  Fan heat is SENSIBLE only
 *   FIX MED-02:  returnFanHeat included in grandTotal
 *   FIX RDS-01:  sensibleFactor(elevation) for Cs (was ASHRAE.SENSIBLE_FACTOR → undefined)
 *   FIX RDS-02:  altitudeCorrectionFactor from psychro.js (no local duplicate)
 *   FIX RDS-03:  KW_TO_BTU_HR from units.js (was ASHRAE.KW_TO_BTU, wrong name)
 *   FIX RDS-04:  supplyAcph computed and exposed for ISO 14644 audit
 *
 * ── SUPPLY AIR FIELD CLARIFICATION ───────────────────────────────────────────
 *
 *   supplyAir = TOTAL supply CFM (recirculation + OA), from airQuantities.js
 *               Math.max(thermalCFM, designAcphCFM, regulatoryAcphCFM, minAcphCFM)
 *   freshAirCheck = OA-only CFM component.
 *   ACPH uses supplyAir (total) — correct for ISO 14644 cleanroom ACH. ✓
 */

import { createSelector } from '@reduxjs/toolkit';

import { calculateSeasonLoad }           from './seasonalLoads';
import { calculateAirQuantities }        from './airQuantities';
import { calculateAllSeasonOALoads }     from './outdoorAirLoad';
import { calculateHeatingHumid }         from './heatingHumid';
import { calculatePipeSizing }           from './pipeSizing';
import { calculateAllSeasonStatePoints } from './psychroStatePoints';

import {
  altitudeCorrectionFactor,
  sensibleFactor,
  calculateAdpFromLoads,   // ADP-01
} from '../../utils/psychro';

import { KW_TO_BTU_HR, m2ToFt2, m3ToFt3 } from '../../utils/units';
import ASHRAE                              from '../../constants/ashrae';

// ── Input selectors ───────────────────────────────────────────────────────────
const selectRooms        = (state) => state.room.list;
const selectEnvelopes    = (state) => state.envelope.byRoomId;
const selectAhus         = (state) => state.ahu.list;
const selectClimate      = (state) => state.climate;
const selectSystemDesign = (state) => state.project.systemDesign;
const selectElevation    = (state) => state.project.ambient.elevation  || 0;
const selectLatitude     = (state) => state.project.ambient.latitude   ?? 28;
const selectDailyRange   = (state) => state.project.ambient.dailyRange ?? 0;
const selectHumidTarget  = (state) =>
  state.project.systemDesign.humidificationTarget ?? 45;

// ── Main memoized selector ────────────────────────────────────────────────────
export const selectRdsData = createSelector(
  [
    selectRooms, selectEnvelopes, selectAhus,
    selectClimate, selectSystemDesign,
    selectElevation, selectLatitude, selectDailyRange,
    selectHumidTarget,
  ],
  (
    rooms, envelopes, ahus, climate, systemDesign,
    elevation, latitude, dailyRange, humidificationTarget,
  ) => {
    const altCf        = altitudeCorrectionFactor(elevation);
    const SEASONS_LIST = ['summer', 'monsoon', 'winter'];
    const Cs           = sensibleFactor(elevation);

    return rooms.map(room => {
      const envelope = envelopes[room.id] || null;
      const ahu      = ahus.find(a => a.id === room.assignedAhuIds?.[0]) || {};

      // Pre-convert units here — used throughout this room's calculations.
      // CRIT-RDS-01 FIX: these converted values are now ALSO written into the
      // assembled return object (see below), overriding the m²/m³ from ...room.
      const floorAreaFt2 = m2ToFt2(room.floorArea);
      const volumeFt3    = m3ToFt3(room.volume);

      const bf = parseFloat(systemDesign.bypassFactor) || 0.10;

      // Null-coalescing guard: preserves 0%RH for battery dry rooms.
      // 0 != null is true in JS → 0 passes through correctly.
      // Safe guard: preserves 0%RH for battery dry rooms but catches empty strings.
      const parsedRaRh = parseFloat(room.designRH);
      const raRH = !isNaN(parsedRaRh) ? parsedRaRh : 50;

      // ════════════════════════════════════════════════════════════════════════
      // STEP 1 — Seasonal loads
      // ════════════════════════════════════════════════════════════════════════
      const seasonResults = {};
      let summerCalcs = null;

      SEASONS_LIST.forEach(season => {
        const calcs = calculateSeasonLoad(
          room, envelope, climate, season, systemDesign,
          altCf, elevation, floorAreaFt2, volumeFt3,
          latitude, dailyRange,
        );

        seasonResults[`ershOn_${season}`]  = calcs.ersh;
        seasonResults[`erlhOn_${season}`]  = calcs.erlh;
        seasonResults[`grains_${season}`]  = calcs.grains;

        const sensSafetyMult = calcs.safetyMult * (calcs.gmpSafetyMult ?? 1.0);
        seasonResults[`ershOff_${season}`] = Math.round(
          calcs.ersh - calcs.equipSens * sensSafetyMult
        );
        seasonResults[`erlhOff_${season}`] = Math.round(
          calcs.erlh - calcs.equipLatent
        );

        if (season === 'summer') summerCalcs = calcs;
      });

      const peakErsh = seasonResults['ershOn_summer'];
      const peakErlh = seasonResults['erlhOn_summer'];
      const dbInF    = summerCalcs?.dbInF ?? 72;

      // ════════════════════════════════════════════════════════════════════════
      // ADP-01 — Resolve effective ADP
      //
      // ⚠️  This block MUST come after STEP 1.
      //     'calculated' mode requires peakErsh and dbInF, which are only
      //     defined after calculateSeasonLoad() completes above.
      //     BUG-RDS-ADP-01: placing this block before STEP 1 caused peakErsh
      //     to be undefined → calculateAdpFromLoads returned DEFAULT_ADP every
      //     time → 'calculated' mode was silently a no-op.
      //
      // Priority chain (most specific wins):
      //   1. ahuAdpMode = 'calculated' → calculateAdpFromLoads(dbInF, peakErsh, ...)
      //   2. ahu.adp > 0               → per-AHU manual override (°F)
      //   3. systemDesign.adp          → project-level default
      //   4. ASHRAE.DEFAULT_ADP        → 55°F hardcoded fallback
      //
      // Two-pass for 'calculated' mode:
      //   Pass 1: preliminaryAirQuantities with projectAdp → preliminary supplyAir
      //   Pass 2: calculateAdpFromLoads(dbInF, peakErsh, prelim.supplyAir, bf)
      //   Result: effectiveSystemDesign = { ...systemDesign, adp: adpF }
      //           passed to STEP 2 so calculateAirQuantities and all downstream
      //           calcs use the resolved ADP consistently.
      //
      // Convergence note:
      //   For THERMALLY-GOVERNED rooms the two-pass is a strict mathematical
      //   identity — calculated ADP equals the ADP used to size preliminary
      //   supplyAir. For ACPH-GOVERNED rooms (cleanrooms), supplyAir > thermalCFM,
      //   so the calculated ADP is lower than DEFAULT_ADP — the physically
      //   correct result (the oversized airflow allows a lower coil leaving temp).
      //
      // ⚠️  'calculated' mode is only valid for cooling-coil AHUs.
      //     Battery dry rooms and desiccant systems must remain 'manual'.
      // ════════════════════════════════════════════════════════════════════════

      const projectAdpMode = systemDesign?.adpMode || 'manual';
      const ahuAdpMode     = ahu?.adpMode           || projectAdpMode;
      const projectAdp     = parseFloat(systemDesign?.adp) || ASHRAE.DEFAULT_ADP;
      const ahuAdpOverride = parseFloat(ahu?.adp)   || 0;

      let adpF;

      if (ahuAdpMode === 'calculated') {
        // Pass 1 — preliminary air quantities using project-default ADP.
        // A synthetic systemDesign ensures airQuantities.js reads a valid adp.
        const prelimSystemDesign = { ...systemDesign, adp: projectAdp };
        const prelimAirQty = calculateAirQuantities(
          room, envelope, ahu, prelimSystemDesign,
          altCf, peakErsh,
          floorAreaFt2, volumeFt3,
        );

        // Pass 2 — back-calculate ADP from preliminary supply air.
        adpF = calculateAdpFromLoads(
          dbInF,
          peakErsh,
          prelimAirQty.supplyAir,
          bf,
          elevation,
        );
      } else {
        // Manual mode: per-AHU override if set; otherwise project default.
        adpF = ahuAdpOverride > 0 ? ahuAdpOverride : projectAdp;
      }

      // Build a room-local effective systemDesign with the resolved ADP.
      // Never mutates the shared systemDesign reference.
      // BUG-RDS-ADP-02 FIX: STEP 2 must receive effectiveSystemDesign —
      // the previous file passed raw systemDesign, so adpF was never used
      // by calculateAirQuantities (it reads systemDesign.adp internally).
      const effectiveSystemDesign = adpF !== projectAdp
        ? { ...systemDesign, adp: adpF }
        : systemDesign; // no allocation if ADP unchanged

      // ════════════════════════════════════════════════════════════════════════
      // STEP 2 — Air quantities
      //
      // BUG-RDS-ADP-02 FIX: effectiveSystemDesign replaces systemDesign.
      // calculateAirQuantities reads systemDesign.adp for thermalCFM:
      //   supplyDT   = (1 − bf) × (dbInF − adp)
      //   thermalCFM = ERSH / (Cs × supplyDT)
      // Without this change, adpF was resolved above but never propagated
      // into the airflow calculation — 'calculated' mode had no effect on
      // supply air sizing.
      // ════════════════════════════════════════════════════════════════════════
      const airQty = calculateAirQuantities(
        room, envelope, ahu, effectiveSystemDesign,   // BUG-RDS-ADP-02 FIX
        altCf, peakErsh,
        floorAreaFt2, volumeFt3,
      );

      const {
        supplyAir, supplyAirGoverned, thermalCFM, supplyAirMinAcph,
        regulatoryAcphCFM,
        vbz,
        freshAir,
        optimisedFreshAir, freshAirCheck,
        minSupplyAcph, faAshraeAcph, maxPurgeAir,
        exhaustCompensation,
        totalExhaust, exhaustGeneral, exhaustBibo, exhaustMachine,
        coilAir, bypassAir, returnAir,
        dehumidifiedAir, freshAirAces, bleedAir,
        isDOAS, pplCount,
      } = airQty;

      const supplyAcph = supplyAir > 0 && volumeFt3 > 0
        ? parseFloat((supplyAir * 60 / volumeFt3).toFixed(1))
        : 0;

      // ════════════════════════════════════════════════════════════════════════
      // STEP 3 — Outdoor air coil loads
      //
      // MED-OA-01 FIX: altCf removed from calculateAllSeasonOALoads call.
      // outdoorAirLoad.js now derives altCf internally from elevation.
      // ════════════════════════════════════════════════════════════════════════
      const oaLoads = calculateAllSeasonOALoads(
        freshAirCheck, climate, dbInF, raRH,
        elevation,
      );

      const oaFields = {};
      SEASONS_LIST.forEach(season => {
        const oa = oaLoads[season];
        oaFields[`oaSensible_${season}`]  = oa.oaSensible;
        oaFields[`oaLatent_${season}`]    = oa.oaLatent;
        oaFields[`oaTotal_${season}`]     = oa.oaTotal;
        oaFields[`oaGrDelta_${season}`]   = (oa.grOut - oa.grIn).toFixed(1);
        oaFields[`oaEnthDelta_${season}`] = oa.oaEnthalpyDelta.toFixed(2);
      });

      // ════════════════════════════════════════════════════════════════════════
      // STEP 4 — Grand total cooling load
      //
      // CRIT-RDS-02 FIX: oaSummer.oaTotal replaces (oaSensible + oaLatent).
      // See changelog for full explanation.
      // ════════════════════════════════════════════════════════════════════════
      const oaSummer = oaLoads.summer;

      const fanHeatFraction  = (parseFloat(systemDesign.fanHeat) || 5) / 100;
      const supplyFanHeatBTU = Math.round(peakErsh * fanHeatFraction);
      const returnFanHeatBTU = Math.round(supplyFanHeatBTU * 0.02);

      const grandTotal = (peakErsh + peakErlh)
        + oaSummer.oaTotal
        + supplyFanHeatBTU
        + returnFanHeatBTU;

      const coolingCapTR = (grandTotal / ASHRAE.BTU_PER_TON).toFixed(2);
      const grandTotalSensible = Math.round(
        peakErsh + oaSummer.oaSensible + supplyFanHeatBTU + returnFanHeatBTU
      );

      const coilLoadBTU = (peakErsh + peakErlh)
        + oaSummer.oaTotal
        + supplyFanHeatBTU;

      const supplyFanHeatBlow = supplyFanHeatBTU;
      const supplyFanHeatDraw = (supplyFanHeatBTU / KW_TO_BTU_HR).toFixed(2);
      const returnFanHeat     = (returnFanHeatBTU  / KW_TO_BTU_HR).toFixed(2);

      const totalInfil = summerCalcs ? Math.round(summerCalcs.infilCFM) : 0;
      const rsh        = summerCalcs ? Math.round(summerCalcs.rawSensible) : 0;

      // ════════════════════════════════════════════════════════════════════════
      // STEP 5 — Heating + humidification
      //
      // HIGH-HH-01 FIX — recirculationFraction passed to calculateHeatingHumid.
      // ════════════════════════════════════════════════════════════════════════
      const recircFraction = supplyAir > 0 ? returnAir / supplyAir : 0;

      const heatHumid = calculateHeatingHumid(
        seasonResults['ershOn_winter'],
        supplyAir,
        freshAirCheck,
        climate,
        dbInF,
        humidificationTarget,
        altCf,
        elevation,
        grandTotal,
        recircFraction,
      );

      const {
        heatingCapBTU, heatingCap, heatingCapMBH,
        preheatCapBTU, preheatCap,
        terminalHeatingCap, extraHeatingCap, needsHeating,
        hwFlowRate,
        humidDeltaGr, mixedAirGr, humidGrTarget, winterGrOut,
        humidLbsPerHr, humidKw, humidLoadBTU, needsHumidification,
        highHumidificationLoad, humidWarning,
      } = heatHumid;

      // ════════════════════════════════════════════════════════════════════════
      // STEP 6 — Pipe sizing
      // ════════════════════════════════════════════════════════════════════════
      const pipes = calculatePipeSizing(
        coilLoadBTU,
        heatingCapBTU,
        preheatCapBTU,
      );

      // ════════════════════════════════════════════════════════════════════════
      // STEP 7 — Psychrometric state points
      // adpF is the fully resolved ADP from the block above — consistent with
      // the effectiveSystemDesign passed to STEP 2.
      // ════════════════════════════════════════════════════════════════════════
      const psychroFields = calculateAllSeasonStatePoints(
        climate, dbInF, raRH, adpF, bf,
        freshAirCheck, supplyAir, elevation,
      );

      // ════════════════════════════════════════════════════════════════════════
      // STEP 8 — Derived seasonal fields
      // ════════════════════════════════════════════════════════════════════════
      const pickupFields   = {};
      const achFields      = {};
      const termHeatFields = {};

      SEASONS_LIST.forEach(s => {
        const e_on  = seasonResults[`ershOn_${s}`]  || 0;
        const e_off = seasonResults[`ershOff_${s}`] || 0;

        pickupFields[`pickupOn_${s}`]  = supplyAir > 0
          ? (e_on  / (Cs * supplyAir)).toFixed(1) : '0.0';
        pickupFields[`pickupOff_${s}`] = supplyAir > 0
          ? (e_off / (Cs * supplyAir)).toFixed(1) : '0.0';

        achFields[`achOn_temp_${s}`]      = dbInF.toFixed(1);
        achFields[`achOn_rh_${s}`]        = raRH.toFixed(1);
        achFields[`achOff_temp_${s}`]     = dbInF.toFixed(1);
        achFields[`achOff_rh_${s}`]       = raRH.toFixed(1);
        achFields[`achTermOn_temp_${s}`]  = dbInF.toFixed(1);
        achFields[`achTermOn_rh_${s}`]    = raRH.toFixed(1);
        achFields[`achTermOff_temp_${s}`] = dbInF.toFixed(1);
        achFields[`achTermOff_rh_${s}`]   = raRH.toFixed(1);

        termHeatFields[`termHeatOn_${s}`]  = e_on  < 0
          ? (Math.abs(e_on)  / KW_TO_BTU_HR).toFixed(2) : '0.00';
        termHeatFields[`termHeatOff_${s}`] = e_off < 0
          ? (Math.abs(e_off) / KW_TO_BTU_HR).toFixed(2) : '0.00';
      });

      // ════════════════════════════════════════════════════════════════════════
      // ASSEMBLE — full RDS row
      //
      // CRIT-RDS-01 FIX: volume and floorArea explicitly set as ft³ / ft²,
      // overriding the m³ / m² values from the ...room spread.
      // ════════════════════════════════════════════════════════════════════════
      return {
        // ── Identity ──────────────────────────────────────────────────────────
        ...room,
        id:           room.id,
        ahuId:        ahu.id   || '',
        typeOfUnit:   ahu.type || '-',
        isDOAS,
        people_count: pplCount,
        equipment_kw: envelope?.internalLoads?.equipment?.kw || 0,

        // CRIT-RDS-01 FIX: override m³/m² from ...room spread with ft³/ft².
        volume:    volumeFt3,
        floorArea: floorAreaFt2,

        // ── Core cooling outputs ───────────────────────────────────────────────
        supplyAir,
        supplyAirGoverned,
        thermalCFM,
        supplyAirMinAcph,
        regulatoryAcphCFM,
        supplyAcph,
        coolingCapTR,
        grandTotal:  Math.round(grandTotal),
        grandTotalSensible,
        coilLoadBTU: Math.round(coilLoadBTU),
        ersh:                peakErsh,

        // ── Fan heat ──────────────────────────────────────────────────────────
        supplyFanHeatBlow,
        supplyFanHeatDraw,
        returnFanHeat,

        // ── RSH + infiltration ─────────────────────────────────────────────────
        rsh,
        totalInfil,

        // ── Fresh air ─────────────────────────────────────────────────────────
        vbz,
        freshAir,
        exhaustCompensation,
        minSupplyAcph,
        faAshraeAcph,
        optimisedFreshAir,
        freshAirCheck,
        maxPurgeAir,

        // ── Exhaust ───────────────────────────────────────────────────────────
        totalExhaust,
        exhaustGeneral,
        exhaustBibo,
        exhaustMachine,

        // ── AHU air balance ───────────────────────────────────────────────────
        coilAir,
        bypassAir,
        returnAir,
        dehumidifiedAir,
        freshAirAces,
        bleedAir,
        ahuCap:        supplyAir,
        coolingLoadHL: coolingCapTR,

        // ── OA coil loads ─────────────────────────────────────────────────────
        ...oaFields,

        // ── Heating ───────────────────────────────────────────────────────────
        heatingCapBTU,
        heatingCap,
        heatingCapMBH,
        preheatCapBTU,
        preheatCap,
        terminalHeatingCap,
        extraHeatingCap,
        needsHeating,
        hwFlowRate,

        // ── Humidification ────────────────────────────────────────────────────
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

        // ── Pipe sizing ───────────────────────────────────────────────────────
        chwBranchSize:     pipes.chw.branchDiamMm,
        chwManifoldSize:   pipes.chw.manifoldDiamMm,
        chwFlowRate:       pipes.chw.flowGPM,
        hwBranchSize:      pipes.hw.branchDiamMm,
        hwManifoldSize:    pipes.hw.manifoldDiamMm,
        hwFlow:            pipes.hw.flowGPM,
        preheatBranchSize: pipes.preheat.branchDiamMm,
        preheatHwFlow:     pipes.preheat.flowGPM,

        // ── Coil performance ──────────────────────────────────────────────────
        coil_shr:           psychroFields['coil_shr'],
        coil_contactFactor: psychroFields['coil_contactFactor'],
        coil_adp:           adpF,        // ADP-01: resolved ADP (°F) for display
        coil_adpMode:       ahuAdpMode,  // ADP-01: 'manual' | 'calculated'

        // ── Seasonal load results ─────────────────────────────────────────────
        ...seasonResults,

        // ── Derived seasonal fields ───────────────────────────────────────────
        ...pickupFields,
        ...achFields,
        ...termHeatFields,

        // ── Psychrometric state points ────────────────────────────────────────
        ...psychroFields,

        // ── Debug / audit trail ───────────────────────────────────────────────
        _raw: { room, envelope, ahu },
      };
    });
  }
);