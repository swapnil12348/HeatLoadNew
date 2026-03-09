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
      const envelope = envelopes[room.id] || null;
      const ahu      = ahus.find(a => a.id === room.assignedAhuIds?.[0]) || {};

      const floorAreaFt2 = m2ToFt2(room.floorArea);
      const volumeFt3    = m3ToFt3(room.volume);

      const bf   = parseFloat(systemDesign.bypassFactor) || 0.10;
      const adpF = parseFloat(systemDesign.adp)          || 55;

      // Null-coalescing guard: preserves 0% RH for battery dry rooms
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

        // FIX MED-06 follow-up: erlh no longer carries safetyMult (fixed in
        // seasonalLoads.js). Equipment OFF delta must use rawLatent directly
        // for the latent side. Sensible side: ersh already includes safetyMult
        // and gmpSafetyMult — strip equipSens contribution scaled by both.
        const sensSafetyMult = calcs.safetyMult * (calcs.gmpSafetyMult ?? 1.0);
        seasonResults[`ershOff_${season}`] = Math.round(
          calcs.ersh - calcs.equipSens * sensSafetyMult
        );
        // Latent OFF: erlh = rawLatent (no safety), strip raw equipment latent
        seasonResults[`erlhOff_${season}`] = Math.round(
          calcs.erlh - calcs.equipLatent
        );

        if (season === 'summer') summerCalcs = calcs;
      });

      // ── Peak summer values ─────────────────────────────────────────────────
      const peakErsh = seasonResults['ershOn_summer'];
      const peakErlh = seasonResults['erlhOn_summer'];
      const dbInF    = summerCalcs?.dbInF ?? 72;

      // ════════════════════════════════════════════════════════════════════════
      // STEP 2 — Air quantities
      // ════════════════════════════════════════════════════════════════════════
      const airQty = calculateAirQuantities(
        room, envelope, ahu, systemDesign,
        altCf, peakErsh,
        floorAreaFt2, volumeFt3,
      );

      const {
        supplyAir, supplyAirGoverned, thermalCFM, supplyAirMinAcph,
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

      // ════════════════════════════════════════════════════════════════════════
      // STEP 3 — Outdoor air coil loads
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
      // STEP 4 — Grand total cooling load
      //
      // FIX CRIT-01: OA coil load was computed by outdoorAirLoad.js but never
      // added to grandTotal or coolingCapTR. For a semiconductor fab with 15%
      // fresh-air ratio the OA load is 15–40% of total — omitting it meant the
      // chiller, AHU, and CHW plant were all undersized by that margin.
      //
      // ASHRAE HOF 2021 Ch.18 Eq.18.1:
      //   Total Cooling Load = Room Load + OA Coil Load
      //
      // FIX MED-01: Fan heat is purely SENSIBLE — it raises supply air DB
      // temperature only and has no effect on latent load or SHR.
      // Previous formula: fanHeatBTU = (peakErsh + peakErlh) × fraction
      //   → inflated effective latent load and distorted SHR.
      // Correct formula:  fanHeatBTU = peakErsh × fraction  (sensible only)
      // Reference: ASHRAE HOF 2021 Ch.18 — Fan heat gain is sensible; added
      //            before cooling coil on the sensible side only.
      //
      // FIX MED-02: returnFanHeat was computed and displayed but never added
      // to grandTotal. If it represents a real system load it must be included.
      // Decision: include it. It is small (≈2%) but excluding it from the total
      // while showing it in the RDS implies it has been accounted for elsewhere,
      // which it was not. Sized as 2% of supply fan heat (conservative estimate).
      // ════════════════════════════════════════════════════════════════════════
      const oaSummer         = oaLoads.summer;

      // FIX MED-01: fan heat on sensible only (was peakErsh + peakErlh)
      const fanHeatFraction  = (parseFloat(systemDesign.fanHeat) || 5) / 100;
      const supplyFanHeatBTU = Math.round(peakErsh * fanHeatFraction); // FIX MED-01

      // FIX MED-02: return fan heat — 2% of supply fan heat, now included in total
      const returnFanHeatBTU = Math.round(supplyFanHeatBTU * 0.02);   // FIX MED-02

      // FIX CRIT-01: add OA sensible + OA latent to grandTotal
      // oaLatent is already floored at 0 in outdoorAirLoad.js (safe to add directly)
      const grandTotal = (peakErsh + peakErlh)
        + oaSummer.oaSensible   // FIX CRIT-01: was missing
        + oaSummer.oaLatent     // FIX CRIT-01: was missing
        + supplyFanHeatBTU      // FIX MED-01: sensible only
        + returnFanHeatBTU;     // FIX MED-02: now included

      // FIX LOW-05: Duct heat gain — ASHRAE 90.1 §6.5.4.4 requires this for
      // exposed duct systems. Applied to sensible side only (supply duct).
      // Uncomment and wire ductExposed flag per room when duct routing is known.
      // const ductHeatBTU = (room.ductExposed ?? false)
      //   ? Math.round(peakErsh * ASHRAE.DUCT_HEAT_GAIN_PCT)
      //   : 0;
      // grandTotal += ductHeatBTU;

      const coolingCapTR = (grandTotal / ASHRAE.BTU_PER_TON).toFixed(2);

      // Coil load = room load + OA load (before fan heat).
      // Fan heat is a system allowance, not a coil heat-transfer quantity.
      // Used for pipe sizing and coil selection.
      const coilLoadBTU = (peakErsh + peakErlh)
        + oaSummer.oaSensible
        + oaSummer.oaLatent;

      // Fan heat display fields
      const supplyFanHeatBlow = supplyFanHeatBTU;
      const supplyFanHeatDraw = (supplyFanHeatBTU / ASHRAE.KW_TO_BTU).toFixed(2);
      // FIX MED-02: returnFanHeat now reflects actual BTU included in total
      const returnFanHeat     = (returnFanHeatBTU / ASHRAE.KW_TO_BTU).toFixed(2);

      // ── Infiltration + RSH summary ─────────────────────────────────────────
      const totalInfil = summerCalcs ? Math.round(summerCalcs.infilCFM) : 0;
      const rsh        = summerCalcs ? Math.round(summerCalcs.rawSensible) : 0;

      // ════════════════════════════════════════════════════════════════════════
      // STEP 5 — Heating + humidification
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
        humidDeltaGr, humidGrTarget, winterGrOut,
        humidLbsPerHr, humidKw, humidLoadBTU, needsHumidification,
      } = heatHumid;

      // ════════════════════════════════════════════════════════════════════════
      // STEP 6 — Pipe sizing
      // Uses coilLoadBTU (room + OA, before fan heat) — correct ASHRAE basis.
      // ════════════════════════════════════════════════════════════════════════
      const pipes = calculatePipeSizing(
        coilLoadBTU,
        heatingCapBTU,
        preheatCapBTU,
      );

      // ════════════════════════════════════════════════════════════════════════
      // STEP 7 — Psychrometric state points
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

        // Room pick-up ΔT
        pickupFields[`pickupOn_${s}`]  = supplyAir > 0
          ? (e_on  / (Cs * supplyAir)).toFixed(1) : '0.0';
        pickupFields[`pickupOff_${s}`] = supplyAir > 0
          ? (e_off / (Cs * supplyAir)).toFixed(1) : '0.0';

        // MED-05 NOTE: achFields currently echo the room setpoint (dbInF, raRH).
        // Correct implementation would derive achieved conditions from supply
        // air temperature pickup via psychroStatePoints.sa_* values.
        // Deferred to Sprint 3 — left as setpoint echo for now.
        achFields[`achOn_temp_${s}`]      = dbInF.toFixed(1);
        achFields[`achOn_rh_${s}`]        = raRH.toFixed(1);
        achFields[`achOff_temp_${s}`]     = dbInF.toFixed(1);
        achFields[`achOff_rh_${s}`]       = raRH.toFixed(1);
        achFields[`achTermOn_temp_${s}`]  = dbInF.toFixed(1);
        achFields[`achTermOn_rh_${s}`]    = raRH.toFixed(1);
        achFields[`achTermOff_temp_${s}`] = dbInF.toFixed(1);
        achFields[`achTermOff_rh_${s}`]   = raRH.toFixed(1);

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
        grandTotal:  Math.round(grandTotal),
        coilLoadBTU: Math.round(coilLoadBTU),

        // ── Fan heat ──────────────────────────────────────────────────────────
        supplyFanHeatBlow, // BTU/hr — FIX MED-01: sensible only
        supplyFanHeatDraw, // kW
        returnFanHeat,     // kW — FIX MED-02: now included in grandTotal

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

        // ── OA coil loads (FIX CRIT-01: now included in grandTotal) ──────────
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
        chwBranchSize:     pipes.chw.branchDiamMm,
        chwManifoldSize:   pipes.chw.manifoldDiamMm,
        // FIX CRIT-04: key was 'chwFlow' — resultsSections.js references 'chwFlowRate'
        // The value was computed correctly by pipeSizing but orphaned by the wrong key.
        chwFlowRate:       pipes.chw.flowGPM,      // FIX CRIT-04: was chwFlow
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