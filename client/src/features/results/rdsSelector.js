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
 * ── SUPPLY AIR FIELD CLARIFICATION ───────────────────────────────────────────
 * supplyAir = TOTAL supply CFM (recirculation + OA), computed in airQuantities.js
 *   as Math.max(thermalCFM, designAcphCFM, vbz).
 * freshAirCheck = OA-only CFM component.
 * The ACPH calculation uses supplyAir (total), which is correct for ISO 14644
 * cleanroom ACH verification. ✓
 */

import { createSelector } from '@reduxjs/toolkit';

import { calculateSeasonLoad }           from './seasonalLoads';
import { calculateAirQuantities }        from './airQuantities';
import { calculateAllSeasonOALoads }     from './outdoorAirLoad';
import { calculateHeatingHumid }         from './heatingHumid';
import { calculatePipeSizing }           from './pipeSizing';
import { calculateAllSeasonStatePoints } from './psychroStatePoints';

// FIX RDS-02: Import altitudeCorrectionFactor and sensibleFactor from psychro.js.
// The previous local altitudeCorrectionFactor() definition was a duplicate that
// could silently diverge from the psychro.js implementation.
import {
  altitudeCorrectionFactor,
  sensibleFactor,
} from '../../utils/psychro';

// FIX RDS-03: Import KW_TO_BTU_HR from units.js.
// ASHRAE.KW_TO_BTU was numerically correct (3412.14) but misleadingly named
// (BTU/hr per kW, not BTU per kW). Three places in this file divided by it.
import { KW_TO_BTU_HR }                 from '../../utils/units';
import { m2ToFt2, m3ToFt3 }            from '../../utils/units';
import ASHRAE                           from '../../constants/ashrae';

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
    const altCf        = altitudeCorrectionFactor(elevation); // FIX RDS-02: from psychro.js
    const SEASONS_LIST = ['summer', 'monsoon', 'winter'];

    // FIX RDS-01: sensibleFactor(elevation) replaces the broken
    // ASHRAE.SENSIBLE_FACTOR * altCf expression.
    // ASHRAE.SENSIBLE_FACTOR does not exist — accessing it returned undefined,
    // making Cs = NaN and all pickup delta-T fields display as NaN.
    // sensibleFactor(elevation) = ASHRAE.SENSIBLE_FACTOR_SEA_LEVEL × altCf = 1.08 × altCf.
    const Cs = sensibleFactor(elevation); // FIX RDS-01: was ASHRAE.SENSIBLE_FACTOR * altCf

    return rooms.map(room => {
      const envelope = envelopes[room.id] || null;
      const ahu      = ahus.find(a => a.id === room.assignedAhuIds?.[0]) || {};

      const floorAreaFt2 = m2ToFt2(room.floorArea);
      const volumeFt3    = m3ToFt3(room.volume);

      const bf   = parseFloat(systemDesign.bypassFactor) || 0.10;
      const adpF = parseFloat(systemDesign.adp)          || 55;

      // Null-coalescing guard: preserves 0% RH for battery dry rooms.
      // Note: room.designRH != null correctly passes 0 through (0 != null is true).
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

        // Equipment OFF delta: strip equipment contribution scaled by safety factors.
        // erlh carries no safetyMult (fixed in seasonalLoads.js) — strip raw equip latent.
        const sensSafetyMult = calcs.safetyMult * (calcs.gmpSafetyMult ?? 1.0);
        seasonResults[`ershOff_${season}`] = Math.round(
          calcs.ersh - calcs.equipSens * sensSafetyMult
        );
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

      // FIX RDS-04: Compute achieved supply ACPH for ISO 14644 cleanroom audit.
      // supplyAir is TOTAL supply (recirc + OA), volumeFt3 is room volume.
      // ACPH = (CFM × 60 min/hr) / volume_ft³
      const supplyAcph = supplyAir > 0 && volumeFt3 > 0
        ? parseFloat((supplyAir * 60 / volumeFt3).toFixed(1))
        : 0;

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
      // FIX CRIT-01: OA coil load (sensible + latent) is now added to grandTotal.
      //   Omitting it understated chiller/AHU/CHW plant by 15–40% in high-OA
      //   facilities (semiconductor, pharma).
      //   ASHRAE HOF 2021 Ch.18 Eq.18.1: Total = Room Load + OA Coil Load
      //
      // FIX MED-01: Fan heat is SENSIBLE only.
      //   Previous: fanHeatBTU = (peakErsh + peakErlh) × fraction  [wrong]
      //   Correct:  fanHeatBTU = peakErsh × fraction                [sensible only]
      //   Reference: ASHRAE HOF 2021 Ch.18 — fan heat gain is sensible.
      //
      // FIX MED-02: returnFanHeat is now included in grandTotal.
      //   It was computed and displayed but never added — implied to auditors
      //   that it had been accounted for elsewhere, which it was not.
      // ════════════════════════════════════════════════════════════════════════
      const oaSummer = oaLoads.summer;

      const fanHeatFraction  = (parseFloat(systemDesign.fanHeat) || 5) / 100;
      const supplyFanHeatBTU = Math.round(peakErsh * fanHeatFraction); // FIX MED-01: sensible only
      const returnFanHeatBTU = Math.round(supplyFanHeatBTU * 0.02);    // FIX MED-02

      const grandTotal = (peakErsh + peakErlh)
        + oaSummer.oaSensible   // FIX CRIT-01
        + oaSummer.oaLatent     // FIX CRIT-01
        + supplyFanHeatBTU      // FIX MED-01: sensible only
        + returnFanHeatBTU;     // FIX MED-02: now included

      // FIX LOW-05 (deferred): Duct heat gain per ASHRAE 90.1 §6.5.4.4.
      // Uncomment and wire ductExposed flag per room when duct routing is known.
      // const ductHeatBTU = (room.ductExposed ?? false)
      //   ? Math.round(peakErsh * ASHRAE.DUCT_HEAT_GAIN_PCT) : 0;
      // grandTotal += ductHeatBTU;

      const coolingCapTR = (grandTotal / ASHRAE.BTU_PER_TON).toFixed(2);

      // coilLoadBTU = room load + OA load (before fan heat).
      // Fan heat is a system allowance, not a coil heat-transfer quantity.
      // Used for CHW pipe sizing and coil selection. See BUG-PIPE-01.
      const coilLoadBTU = (peakErsh + peakErlh)
        + oaSummer.oaSensible
        + oaSummer.oaLatent;

      // FIX RDS-03: KW_TO_BTU_HR replaces ASHRAE.KW_TO_BTU (same value, correct name).
      const supplyFanHeatBlow = supplyFanHeatBTU;
      const supplyFanHeatDraw = (supplyFanHeatBTU / KW_TO_BTU_HR).toFixed(2); // FIX RDS-03
      const returnFanHeat     = (returnFanHeatBTU  / KW_TO_BTU_HR).toFixed(2); // FIX RDS-03

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
      // See BUG-PIPE-01: grandTotal must NOT be used here.
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

        // Room pick-up ΔT = ERSH / (Cs × supplyAir)
        // Cs = sensibleFactor(elevation) = 1.08 × altCf [BTU/hr per CFM per °F]
        // FIX RDS-01: Cs now defined correctly — was NaN before this fix.
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

        // FIX RDS-03: KW_TO_BTU_HR replaces ASHRAE.KW_TO_BTU
        termHeatFields[`termHeatOn_${s}`]  = e_on  < 0
          ? (Math.abs(e_on)  / KW_TO_BTU_HR).toFixed(2) : '0.00'; // FIX RDS-03
        termHeatFields[`termHeatOff_${s}`] = e_off < 0
          ? (Math.abs(e_off) / KW_TO_BTU_HR).toFixed(2) : '0.00'; // FIX RDS-03
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
        supplyAcph,          // FIX RDS-04: achieved total supply ACH
        coolingCapTR,
        grandTotal:  Math.round(grandTotal),
        coilLoadBTU: Math.round(coilLoadBTU),

        // ── Fan heat ──────────────────────────────────────────────────────────
        supplyFanHeatBlow, // BTU/hr — FIX MED-01: sensible only
        supplyFanHeatDraw, // kW     — FIX RDS-03: KW_TO_BTU_HR
        returnFanHeat,     // kW     — FIX MED-02 + FIX RDS-03

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
        chwFlowRate:       pipes.chw.flowGPM,      // FIX CRIT-04: key confirmed correct
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