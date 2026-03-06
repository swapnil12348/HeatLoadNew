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
 */

import { createSelector } from '@reduxjs/toolkit';

import { calculateSeasonLoad }           from './seasonalLoads';
import { calculateAirQuantities }        from './airQuantities';
import { calculateAllSeasonOALoads }     from './outdoorAirLoad';
import { calculateHeatingHumid }         from './heatingHumid';
import { calculatePipeSizing }           from './pipeSizing';
import { calculateAllSeasonStatePoints } from './psychroStatePoints';

// FIX: use units.js — removes inline M2_TO_FT2 / M3_TO_FT3 constants
// FIX: removed unused calculateGrains import
import { m2ToFt2, m3ToFt3 } from '../../utils/units';
import ASHRAE                from '../../constants/ashrae';

// ── Altitude correction factor ────────────────────────────────────────────────
// Cf = Patm_site / Patm_sea-level
// ASHRAE Ch.1 Eq.3: Patm = 29.921 × (1 − 6.8754×10⁻⁶ × elev)^5.2559 inHg
const altitudeCorrectionFactor = (elevationFt) => {
  const elev = parseFloat(elevationFt) || 0;
  if (elev <= 0) return 1.0;
  const pAlt = 29.921 * Math.pow(1 - 6.8754e-6 * elev, 5.2559);
  return pAlt / 29.921;
};

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
    const Cs           = ASHRAE.SENSIBLE_FACTOR * altCf;
    const SEASONS_LIST = ['summer', 'monsoon', 'winter'];

    return rooms.map(room => {
      const envelope     = envelopes[room.id] || null;
      const ahu          = ahus.find(a => a.id === room.assignedAhuIds?.[0]) || {};

      // FIX: use units.js helpers — removes duplicated inline constants
      const floorAreaFt2 = m2ToFt2(room.floorArea);
      const volumeFt3    = m3ToFt3(room.volume);

      const bf   = parseFloat(systemDesign.bypassFactor) || 0.10;
      const adpF = parseFloat(systemDesign.adp)          || 55;

      // FIX: designRH guard — use null-coalescing not || so 0% RH (battery
      // dry rooms) is preserved. || 50 was silently defaulting dry rooms to 50%.
      const raRH = room.designRH != null
        ? parseFloat(room.designRH)
        : 50;

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

        // Equipment OFF: strip equipment contribution from both S + L
        seasonResults[`ershOff_${season}`] = Math.round(
          calcs.ersh - calcs.equipSens   * calcs.safetyMult
        );
        seasonResults[`erlhOff_${season}`] = Math.round(
          calcs.erlh - calcs.equipLatent * calcs.safetyMult
        );

        if (season === 'summer') summerCalcs = calcs;
      });

      // ── Peak summer values ─────────────────────────────────────────────────
      const peakErsh = seasonResults['ershOn_summer'];
      const peakErlh = seasonResults['erlhOn_summer'];
      const dbInF    = summerCalcs?.dbInF ?? 72;

      // ── BUG-14 FIX: fan heat linear addition, NOT compounded ───────────────
      const fanHeatFraction   = (parseFloat(systemDesign.fanHeat) || 5) / 100;
      const fanHeatBTU        = (peakErsh + peakErlh) * fanHeatFraction;
      const grandTotal        = (peakErsh + peakErlh) + fanHeatBTU;
      const coolingCapTR      = (grandTotal / ASHRAE.BTU_PER_TON).toFixed(2);

      // Coil load = grandTotal before fan heat — used for pipe sizing.
      // Fan heat is a system-level allowance, not a coil heat transfer quantity.
      const coilLoadBTU = peakErsh + peakErlh;

      // Fan heat display fields
      const supplyFanHeatBlow = Math.round(fanHeatBTU);
      const supplyFanHeatDraw = (fanHeatBTU / ASHRAE.KW_TO_BTU).toFixed(2);
      const returnFanHeat     = (0.02 * grandTotal / ASHRAE.KW_TO_BTU).toFixed(2);

      // ── Infiltration summary ───────────────────────────────────────────────
      // totalInfil = uncontrolled air leakage INTO the room (CFM)
      // totalExfil = uncontrolled air leakage OUT of the room (CFM)
      // For a positively pressurised cleanroom, exfiltration > infiltration.
      // They are NOT equal — kept separate for engineering review.
      const totalInfil = summerCalcs ? Math.round(summerCalcs.infilCFM) : 0;
      const rsh        = summerCalcs ? Math.round(summerCalcs.rawSensible) : 0;

      // ════════════════════════════════════════════════════════════════════════
      // STEP 2 — Air quantities
      // airQuantities.js: supply CFM, fresh air (with exhaust compensation),
      //                   exhaust, return, mass balance
      // ════════════════════════════════════════════════════════════════════════
      const airQty = calculateAirQuantities(
        room, envelope, ahu, systemDesign,
        altCf, peakErsh,
        floorAreaFt2, volumeFt3,
      );

      const {
        supplyAir, supplyAirGoverned, thermalCFM, supplyAirMinAcph,
        vbz,                                     // pure ASHRAE 62.1 breathing zone
        freshAir,                                 // max(vbz, totalExhaust)
        optimisedFreshAir, freshAirCheck,
        minSupplyAcph, faAshraeAcph, maxPurgeAir,
        exhaustCompensation,                     // OA above Vbz driven by exhaust
        totalExhaust, exhaustGeneral, exhaustBibo, exhaustMachine,
        coilAir, bypassAir, returnAir,
        dehumidifiedAir, freshAirAces, bleedAir,
        isDOAS, pplCount,
      } = airQty;

      // ════════════════════════════════════════════════════════════════════════
      // STEP 3 — Outdoor air coil loads
      // outdoorAirLoad.js receives freshAirCheck — this includes exhaust
      // compensation (max(vbz, totalExhaust)), so OA heat load correctly
      // reflects the full makeup air obligation including exhaust-driven OA.
      // ════════════════════════════════════════════════════════════════════════
      const oaLoads = calculateAllSeasonOALoads(
        freshAirCheck, climate, dbInF, raRH, altCf, elevation,
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
      // STEP 4 — Heating + humidification
      // ════════════════════════════════════════════════════════════════════════
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
      );

      const {
        heatingCapBTU, heatingCap, heatingCapMBH,
        preheatCapBTU, preheatCap,
        terminalHeatingCap, extraHeatingCap, needsHeating,
        hwFlowRate,
        // FIX: chwFlowRate comes from pipeSizing, not heatingHumid.
        // heatingHumid computes it as a cross-check but pipeSizing is
        // the authoritative source — destructured separately below.
        humidDeltaGr, humidGrTarget, winterGrOut,
        humidLbsPerHr, humidKw, humidLoadBTU, needsHumidification,
      } = heatHumid;

      // ════════════════════════════════════════════════════════════════════════
      // STEP 5 — Pipe sizing
      // FIX: use coilLoadBTU (before fan heat) not grandTotal.
      // Fan heat is a system allowance — not a coil heat transfer quantity.
      // Coil is sized on actual heat transferred to refrigerant.
      // ════════════════════════════════════════════════════════════════════════
      const pipes = calculatePipeSizing(
        coilLoadBTU,
        heatingCapBTU,
        preheatCapBTU,
      );

      // ════════════════════════════════════════════════════════════════════════
      // STEP 6 — Psychrometric state points
      // ════════════════════════════════════════════════════════════════════════
      const psychroFields = calculateAllSeasonStatePoints(
        climate, dbInF, raRH, adpF, bf,
        freshAirCheck, supplyAir, elevation,
      );

      // ════════════════════════════════════════════════════════════════════════
      // STEP 7 — Derived seasonal fields
      // ════════════════════════════════════════════════════════════════════════
      const pickupFields   = {};
      const achFields      = {};
      const termHeatFields = {};

      SEASONS_LIST.forEach(s => {
        const e_on  = seasonResults[`ershOn_${s}`]  || 0;
        const e_off = seasonResults[`ershOff_${s}`] || 0;

        // Room pick-up ΔT — rise imposed on supply air
        pickupFields[`pickupOn_${s}`]  = supplyAir > 0
          ? (e_on  / (Cs * supplyAir)).toFixed(1) : '0.0';
        pickupFields[`pickupOff_${s}`] = supplyAir > 0
          ? (e_off / (Cs * supplyAir)).toFixed(1) : '0.0';

        // Achieved conditions — design setpoint
        achFields[`achOn_temp_${s}`]      = dbInF.toFixed(1);
        achFields[`achOn_rh_${s}`]        = raRH.toFixed(1);
        achFields[`achOff_temp_${s}`]     = dbInF.toFixed(1);
        achFields[`achOff_rh_${s}`]       = raRH.toFixed(1);
        achFields[`achTermOn_temp_${s}`]  = dbInF.toFixed(1);
        achFields[`achTermOn_rh_${s}`]    = raRH.toFixed(1);
        achFields[`achTermOff_temp_${s}`] = dbInF.toFixed(1);
        achFields[`achTermOff_rh_${s}`]   = raRH.toFixed(1);

        // Terminal heater load — only when sensible load is negative
        termHeatFields[`termHeatOn_${s}`]  = e_on  < 0
          ? (Math.abs(e_on)  / ASHRAE.KW_TO_BTU).toFixed(2) : '0.00';
        termHeatFields[`termHeatOff_${s}`] = e_off < 0
          ? (Math.abs(e_off) / ASHRAE.KW_TO_BTU).toFixed(2) : '0.00';
      });

      // ════════════════════════════════════════════════════════════════════════
      // ASSEMBLE — full RDS row
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

        // ── Core cooling outputs ───────────────────────────────────────────────
        supplyAir,
        supplyAirGoverned,
        thermalCFM,
        supplyAirMinAcph,
        coolingCapTR,
        grandTotal:   Math.round(grandTotal),
        coilLoadBTU:  Math.round(coilLoadBTU),

        // ── Fan heat ──────────────────────────────────────────────────────────
        supplyFanHeatBlow,
        supplyFanHeatDraw,
        returnFanHeat,

        // ── RSH + infiltration ─────────────────────────────────────────────────
        rsh,
        totalInfil,

        // ── Fresh air ─────────────────────────────────────────────────────────
        vbz,                  // pure ASHRAE 62.1 breathing zone result
        freshAir,             // max(vbz, totalExhaust) — actual OA obligation
        exhaustCompensation,  // OA above Vbz driven purely by exhaust
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
        humidGrTarget,
        winterGrOut,

        // ── Pipe sizing ───────────────────────────────────────────────────────
        // FIX: chwFlowRate sourced from pipeSizing (authoritative), not heatingHumid
        chwBranchSize:     pipes.chw.branchDiamMm,
        chwManifoldSize:   pipes.chw.manifoldDiamMm,
        chwFlow:           pipes.chw.flowGPM,
        hwBranchSize:      pipes.hw.branchDiamMm,
        hwManifoldSize:    pipes.hw.manifoldDiamMm,
        hwFlow:            pipes.hw.flowGPM,
        preheatBranchSize: pipes.preheat.branchDiamMm,
        preheatHwFlow:     pipes.preheat.flowGPM,

        // ── Coil performance ──────────────────────────────────────────────────
        coil_shr:           psychroFields['coil_shr'],
        coil_contactFactor: psychroFields['coil_contactFactor'],

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