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
 * ── CHANGELOG v2.7 ────────────────────────────────────────────────────────────
 *
 *   Reheater logic added (STEP 4c) — ASHRAE HOF 2021 Ch.18 §17.3.
 *
 *     When the room ESHF (ERSH / ERTH) falls below the minimum achievable ESHF
 *     for the selected ADP and BF, the coil cannot simultaneously control
 *     temperature and humidity. A reheater is required.
 *
 *     The minimum achievable ESHF is computed from physics — not Excel's
 *     hardcoded 0.83. The physics-based formula:
 *       minESHF = Cs × DR / (Cs × DR + Cl × max(0, grRoom − grADP_sat))
 *       DR = (1−BF) × (roomDB − ADP) = supply temperature depression
 *
 *     This correctly varies with ADP, BF, and room humidity:
 *       55°F ADP, BF=0.10, 75°F/44%RH  →  minESHF ≈ 0.92 (sensible-only)
 *       55°F ADP, BF=0.10, 75°F/65%RH  →  minESHF ≈ 0.78 (latent load present)
 *       45°F ADP, BF=0.10, 75°F/65%RH  →  minESHF ≈ 0.66 (colder coil, more dehumid)
 *     Excel's hardcoded 0.83 ignores room and coil conditions entirely.
 *
 *     Reheat load (matching Excel row 121):
 *       RH_BTU = (minESHF × ERTH − ERSH) / (1 − minESHF)
 *       where ERTH = peakErsh + peakErlh (room loads only, no OA — Excel method)
 *
 *     Revised cooling capacity:
 *       TR_rev = (grandTotal + RH_BTU) / 12000
 *       The coil must cool air that will subsequently be partially reheated.
 *
 *     Revised supply CFM (matching Excel row 124):
 *       DA_rev = (ERSH + RH_BTU) / (Cs × DR)
 *       The reheater allows the coil to condition more air at a lower ESHF.
 *       Final supply = max(DA_rev, all ACPH constraints).
 *
 *     New fields on rdsRow:
 *       reheatRequired  boolean  — true when reheater is needed
 *       reheatBTU       number   — reheater capacity (BTU/hr)
 *       reheatKW        number   — reheater capacity (kW)
 *       minESHF         number   — minimum achievable ESHF (physics-based)
 *       roomESHF        number   — actual room ESHF (ERSH / ERTH, no OA)
 *       supplyAirGoverned → 'reheat' when reheater drives CFM above ACPH floor
 *
 * ── CHANGELOG v2.6 ────────────────────────────────────────────────────────────
 *
 *   ESHF / Required ADP analysis added (STEP 4b).
 *   Fan heat basis corrected — Cs × supplyAir × coilDT replaces Math.abs(peakErsh).
 *
 * ── CHANGELOG v2.5 ────────────────────────────────────────────────────────────
 *
 *   ADP-01 calculated mode — use thermalCFM not supplyAir as back-calculation basis.
 *   Load breakdown fields (bd_*) added for Insights tab.
 *
 * ── CHANGELOG v2.4 ────────────────────────────────────────────────────────────
 *
 *   Multi-season peak selection — monsoon vs summer comparison implemented.
 *   peakCFMSeason    — season with highest ERSH → governs supply air CFM.
 *   peakCoolingSeason — season with highest (ERSH + ERLH + OA) → governs TR.
 *
 * ── CHANGELOG v2.3 ────────────────────────────────────────────────────────────
 *
 *   returnFanHeat wired from systemDesign.returnFanHeat.
 *   humidificationTarget wired as raRH fallback.
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   ADP-01 — Apparatus Dew Point mode: 'manual' | 'calculated' per AHU.
 *   Priority chain (most specific wins):
 *     1. ahuAdpMode = 'calculated' → calculateAdpFromLoads()
 *     2. ahu.adp > 0               → per-AHU manual override
 *     3. systemDesign.adp          → project-level default
 *     4. ASHRAE.DEFAULT_ADP        → 55°F hardcoded fallback
 *
 * ── SUPPLY AIR FIELD CLARIFICATION ───────────────────────────────────────────
 *
 *   supplyAir = TOTAL supply CFM from airQuantities.js
 *             = Math.max(thermalCFM, designAcphCFM, regulatoryAcphCFM, minAcphCFM)
 *             After reheater: Math.max(above, reheat-adjusted thermalCFM)
 *
 * ── PEAK SEASON SELECTION ────────────────────────────────────────────────────
 *
 *   peakCFMSeason     → season with highest ERSH → governs supply air CFM
 *   peakCoolingSeason → season with highest (ERSH + ERLH + OA) → governs TR
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
  latentFactor,
  calculateAdpFromLoads,
  calculateRequiredADP,
  calculateGrains,
} from '../../utils/psychro';

import { KW_TO_BTU_HR, m2ToFt2, m3ToFt3 } from '../../utils/units';
import ASHRAE from '../../constants/ashrae';

// ── Input selectors ───────────────────────────────────────────────────────────
const selectRooms        = (state) => state.room.list;
const selectEnvelopes    = (state) => state.envelope.byRoomId;
const selectAhus         = (state) => state.ahu.list;
const selectClimate      = (state) => state.climate;
const selectSystemDesign = (state) => state.project.systemDesign;
const selectElevation    = (state) => state.project.ambient.elevation || 0;
const selectLatitude     = (state) => state.project.ambient.latitude ?? 28;
const selectDailyRange   = (state) => state.project.ambient.dailyRange ?? 0;

// ── Main memoized selector ────────────────────────────────────────────────────
export const selectRdsData = createSelector(
  [
    selectRooms, selectEnvelopes, selectAhus,
    selectClimate, selectSystemDesign,
    selectElevation, selectLatitude, selectDailyRange,
  ],
  (
    rooms, envelopes, ahus, climate, systemDesign,
    elevation, latitude, dailyRange
  ) => {
    const altCf        = altitudeCorrectionFactor(elevation);
    const SEASONS_LIST = ['summer', 'monsoon', 'winter'];
    const Cs           = sensibleFactor(elevation);
    const Cl           = latentFactor(elevation);

    return rooms.map(room => {
      try {

        const envelope = envelopes[room.id] || null;
        const ahu      = ahus.find(a => a.id === room.assignedAhuIds?.[0]) || {};

        const floorAreaFt2 = m2ToFt2(room.floorArea);
        const volumeFt3    = m3ToFt3(room.volume);

        const bf = parseFloat(systemDesign.bypassFactor) || 0.10;

        // raRH: room's winter humidity target for heating/humidification sizing.
        const parsedRaRh = parseFloat(room.designRH);
        const raRH = !isNaN(parsedRaRh)
          ? parsedRaRh
          : (systemDesign.humidificationTarget ?? 50);

        // ════════════════════════════════════════════════════════════════════════
        // STEP 1 — Seasonal loads
        // ════════════════════════════════════════════════════════════════════════
        const seasonResults = {};
        const seasonCalcs   = {};

        SEASONS_LIST.forEach(season => {
          const calcs = calculateSeasonLoad(
            room, envelope, climate, season, systemDesign,
            altCf, elevation, floorAreaFt2, volumeFt3,
            latitude, dailyRange,
          );

          seasonCalcs[season] = calcs;

          seasonResults[`ershOn_${season}`] = calcs.ersh;
          seasonResults[`erlhOn_${season}`] = calcs.erlh;
          seasonResults[`grains_${season}`] = calcs.grains;

          const sensSafetyMult = calcs.safetyMult * (calcs.gmpSafetyMult ?? 1.0);
          seasonResults[`ershOff_${season}`] = Math.round(
            calcs.ersh - calcs.equipSens * sensSafetyMult
          );
          seasonResults[`erlhOff_${season}`] = Math.round(
            calcs.erlh - calcs.equipLatent
          );
        });

        // ── Peak ERSH season ────────────────────────────────────────────────
        const peakCFMSeason = SEASONS_LIST.reduce((best, s) =>
          (seasonCalcs[s].ersh > seasonCalcs[best].ersh ? s : best), 'summer'
        );
        const peakCalcs = seasonCalcs[peakCFMSeason];

        const peakErsh = peakCalcs.ersh;
        const dbInF    = peakCalcs.dbInF ?? 72;

        // ════════════════════════════════════════════════════════════════════════
        // ADP-01 — Resolve effective ADP
        //
        // Priority chain (most specific wins):
        //   1. ahuAdpMode = 'calculated' → calculateAdpFromLoads(dbInF, peakErsh, ...)
        //   2. ahu.adp > 0               → per-AHU manual override (°F)
        //   3. systemDesign.adp          → project-level default
        //   4. ASHRAE.DEFAULT_ADP        → 55°F hardcoded fallback
        // ════════════════════════════════════════════════════════════════════════
        const projectAdpMode  = systemDesign?.adpMode || 'manual';
        const ahuAdpMode      = ahu?.adpMode || projectAdpMode;
        const projectAdp      = parseFloat(systemDesign?.adp) || ASHRAE.DEFAULT_ADP;
        const ahuAdpOverride  = parseFloat(ahu?.adp) || 0;

        let adpF;

        if (ahuAdpMode === 'calculated') {
          const prelimSystemDesign = { ...systemDesign, adp: projectAdp };
          const prelimAirQty = calculateAirQuantities(
            room, envelope, ahu, prelimSystemDesign,
            altCf, peakErsh,
            floorAreaFt2, volumeFt3,
          );

          const adpBasisCFM = prelimAirQty.thermalCFM > 0
            ? prelimAirQty.thermalCFM
            : prelimAirQty.supplyAir;

          adpF = calculateAdpFromLoads(
            dbInF,
            peakErsh,
            adpBasisCFM,
            bf,
            elevation,
          );
        } else {
          adpF = ahuAdpOverride > 0 ? ahuAdpOverride : projectAdp;
        }

        const effectiveSystemDesign = adpF !== projectAdp
          ? { ...systemDesign, adp: adpF }
          : systemDesign;

        // ════════════════════════════════════════════════════════════════════════
        // STEP 2 — Air quantities
        // ════════════════════════════════════════════════════════════════════════
        const airQty = calculateAirQuantities(
          room, envelope, ahu, effectiveSystemDesign,
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
        // STEP 4 — Peak cooling season selection + grand total
        // ════════════════════════════════════════════════════════════════════════
        const seasonTotals = {};
        SEASONS_LIST.forEach(s => {
          seasonTotals[s] = (seasonResults[`ershOn_${s}`] || 0)
            + (seasonResults[`erlhOn_${s}`] || 0)
            + (oaLoads[s]?.oaTotal          || 0);
        });

        const peakCoolingSeason = SEASONS_LIST.reduce((best, s) =>
          (seasonTotals[s] > seasonTotals[best] ? s : best), peakCFMSeason
        );

        const peakErshForCap = seasonResults[`ershOn_${peakCoolingSeason}`];
        const peakErlhForCap = seasonResults[`erlhOn_${peakCoolingSeason}`];
        const oaPeak         = oaLoads[peakCoolingSeason];

        const supplyFanHeatFraction = (parseFloat(systemDesign.fanHeat)       || 5) / 100;
        const returnFanHeatFraction = (parseFloat(systemDesign.returnFanHeat) || 5) / 100;

        // Fan heat basis: Cs × supplyAir × coilDT × fanHeatPct.
        // Math.abs guard: when adpF > dbInF, (dbInF − adpF) is negative.
        const supplyFanHeatBTU = Math.round(
          Math.abs(Cs * supplyAir * (dbInF - adpF) * (1 - bf)) * supplyFanHeatFraction
        );
        const returnFanHeatBTU = Math.round(supplyFanHeatBTU * returnFanHeatFraction);

        const grandTotal = (peakErshForCap + peakErlhForCap)
          + oaPeak.oaTotal
          + supplyFanHeatBTU
          + returnFanHeatBTU;

        const grandTotalSensible = Math.round(
          peakErshForCap + oaPeak.oaSensible + supplyFanHeatBTU + returnFanHeatBTU
        );

        // coilLoadBTU: basis for CHW pipe sizing — excludes supply fan heat
        // (draw-through: supply fan is downstream of coil).
        const coilLoadBTU = (peakErshForCap + peakErlhForCap)
          + oaPeak.oaTotal
          + returnFanHeatBTU;

        const supplyFanHeatBlow = supplyFanHeatBTU;
        const supplyFanHeatDraw = (supplyFanHeatBTU / KW_TO_BTU_HR).toFixed(2);
        const returnFanHeat     = (returnFanHeatBTU / KW_TO_BTU_HR).toFixed(2);

        // ════════════════════════════════════════════════════════════════════════
        // STEP 4b — Required ADP from ESHF line (psychrometric sufficiency check)
        // ════════════════════════════════════════════════════════════════════════
        const eshfTotalSensible = (peakErshForCap   || 0) + (oaPeak.oaSensible || 0);
        const eshfTotalLatent   = (peakErlhForCap   || 0) + (oaPeak.oaLatent   || 0);

        const eshfResult = calculateRequiredADP(
          dbInF,
          peakCalcs.grIn,
          eshfTotalSensible,
          eshfTotalLatent,
          elevation,
        );

        const eshf          = eshfResult.eshf;
        const requiredADP   = eshfResult.requiredADP;
        const eshfType      = eshfResult.type;
        const eshfNote      = eshfResult.note;

        const adpGap = (eshfType === 'found' && requiredADP !== null)
          ? parseFloat((adpF - requiredADP).toFixed(1))
          : null;

        const adpSufficient = eshfType === 'no_solution'  ? 'no_solution'
          : eshfType === 'sensible_only'                   ? 'not_applicable'
          : adpGap === null                                ? 'not_applicable'
          : adpGap <= 0                                    ? 'yes'
          : adpGap <= 3                                    ? 'marginal'
          :                                                  'insufficient';

        // ════════════════════════════════════════════════════════════════════════
        // STEP 4c — Reheater requirement (ASHRAE HOF 2021 Ch.18 §17.3)
        //
        // When the room ESHF (ERSH / ERTH) falls below the minimum achievable
        // ESHF for the selected ADP and BF, the coil cannot simultaneously
        // control temperature and humidity. A reheater is required.
        //
        // minESHF — computed from physics, not hardcoded 0.83:
        //   DR (dehumidified rise) = (1−BF) × (roomDB − ADP)
        //   grADP_sat = saturation humidity ratio at ADP
        //   minESHF = Cs×DR / (Cs×DR + Cl×max(0, grRoom − grADP_sat))
        //
        //   When grADP_sat ≥ grRoom (ADP above room dew point, sensible-only):
        //     denominator clamps at Cs×DR → minESHF = 1.0
        //     No reheater needed — SHR = 1.0 is the correct physics.
        //
        // roomESHF = peakErsh / (peakErsh + peakErlh) — room loads only (no OA),
        //   matching Excel row 110 (ERSH/ERTH method).
        //
        // Reheat load (Excel row 121):
        //   RH_BTU = (minESHF × ERTH − ERSH) / (1 − minESHF)
        //
        // Revised tonnage (Excel row 123):
        //   TR_rev = (grandTotal + RH_BTU) / 12000
        //
        // Revised supply CFM (Excel row 124):
        //   DA_rev = (ERSH + RH_BTU) / (Cs × DR)
        //   Final supply = MAX(DA_rev, all ACPH constraints)
        // ════════════════════════════════════════════════════════════════════════
        const grADP_sat = calculateGrains(adpF, 100, elevation);
        const supplyDT  = (1 - bf) * (dbInF - adpF); // dehumidified rise (DR)

        // minESHF: lowest room SHR achievable without reheat
        const minESHFNum   = Cs * supplyDT;
        const minESHFDenom = minESHFNum + Cl * Math.max(0, peakCalcs.grIn - grADP_sat);
        const minESHF = (supplyDT > 0 && minESHFDenom > 0)
          ? minESHFNum / minESHFDenom
          : 1.0; // sensible-only (ADP above room dew point) — no reheat possible or needed

        // Room ESHF: room sensible / room total (no OA, no fan heat — Excel method)
        const erth     = (peakErsh || 0) + (peakErlhForCap || 0);
        const roomESHF = erth > 0 ? (peakErsh || 0) / erth : 1.0;

        let reheatBTU      = 0;
        let reheatRequired = false;

        if (supplyDT > 0 && roomESHF < minESHF - 0.001 && minESHF < 1.0) {
          reheatRequired = true;
          // RH_BTU = (minESHF × ERTH − ERSH) / (1 − minESHF)
          reheatBTU = Math.max(0,
            (minESHF * erth - (peakErsh || 0)) / (1 - minESHF)
          );
        }

        const reheatKW = reheatBTU > 0 ? parseFloat((reheatBTU / KW_TO_BTU_HR).toFixed(2)) : 0;

        // Revised tonnage: original load + reheat (coil conditions all air including
        // the portion subsequently reheated — Excel row 123).
        const revisedGrandTotal = grandTotal + reheatBTU;
        const coolingCapTR = (revisedGrandTotal / ASHRAE.BTU_PER_TON).toFixed(2);

        // Revised coil load: includes reheat (coil must cool air that will be reheated).
        const revisedCoilLoadBTU = coilLoadBTU + reheatBTU;

        // Revised supply CFM when reheater active (Excel row 124):
        //   DA_rev = (ERSH + RH_BTU) / (Cs × DR)
        const revisedThermalCFM = (supplyDT > 0 && reheatRequired)
          ? Math.ceil(((peakErsh || 0) + reheatBTU) / (Cs * supplyDT))
          : thermalCFM;

        // Final supply air: max of all constraints including reheater-adjusted CFM.
        const finalSupplyAir = Math.max(supplyAir, revisedThermalCFM);

        // Update dependent air balance fields if reheat increased supply air.
        const finalCoilAir    = Math.round(finalSupplyAir * (1 - bf));
        const finalBypassAir  = Math.round(finalSupplyAir * bf);
        const finalReturnAir  = Math.max(0, finalSupplyAir - freshAirCheck);
        const finalSupplyAcph = finalSupplyAir > 0 && volumeFt3 > 0
          ? parseFloat((finalSupplyAir * 60 / volumeFt3).toFixed(1))
          : 0;

        // Update supplyAirGoverned if reheat is now the binding constraint.
        const finalSupplyAirGoverned = (reheatRequired && finalSupplyAir > supplyAir)
          ? 'reheat'
          : supplyAirGoverned;

        // ════════════════════════════════════════════════════════════════════════
        // RSH + infiltration (from peak ERSH season)
        // ════════════════════════════════════════════════════════════════════════
        const totalInfil = Math.round(peakCalcs.infilCFM   || 0);
        const rsh        = Math.round(peakCalcs.rawSensible || 0);

        // ════════════════════════════════════════════════════════════════════════
        // STEP 5 — Heating + humidification
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
          revisedCoilLoadBTU,
          heatingCapBTU,
          preheatCapBTU,
        );

        // ════════════════════════════════════════════════════════════════════════
        // STEP 7 — Psychrometric state points
        // ════════════════════════════════════════════════════════════════════════
        const psychroFields = calculateAllSeasonStatePoints(
          climate, dbInF, raRH, adpF, bf,
          freshAirCheck, finalSupplyAir, elevation,
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

          pickupFields[`pickupOn_${s}`]  = finalSupplyAir > 0
            ? (e_on  / (Cs * finalSupplyAir)).toFixed(1) : '0.0';
          pickupFields[`pickupOff_${s}`] = finalSupplyAir > 0
            ? (e_off / (Cs * finalSupplyAir)).toFixed(1) : '0.0';

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
        // ════════════════════════════════════════════════════════════════════════
        return {
          // ── Identity ────────────────────────────────────────────────────────
          ...room,
          id:            room.id,
          ahuId:         ahu.id || '',
          typeOfUnit:    ahu.type || '-',
          isDOAS,
          people_count:  pplCount,
          equipment_kw:  envelope?.internalLoads?.equipment?.kw || 0,

          // ft³ / ft² — override m³ / m² from ...room spread.
          volume:    volumeFt3,
          floorArea: floorAreaFt2,

          // ── Peak season audit ────────────────────────────────────────────────
          peakCFMSeason,
          peakCoolingSeason,

          // ── Core cooling outputs (reheater-revised where applicable) ─────────
          supplyAir:         finalSupplyAir,
          supplyAirGoverned: finalSupplyAirGoverned,
          thermalCFM:        revisedThermalCFM,
          supplyAirMinAcph,
          regulatoryAcphCFM,
          supplyAcph:        finalSupplyAcph,
          coolingCapTR,
          grandTotal:         Math.round(revisedGrandTotal),
          grandTotalSensible,
          coilLoadBTU:        Math.round(revisedCoilLoadBTU),
          ersh:               peakErsh,

          // ── Fan heat ────────────────────────────────────────────────────────
          supplyFanHeatBlow,
          supplyFanHeatDraw,
          returnFanHeat,

          // ── RSH + infiltration ───────────────────────────────────────────────
          rsh,
          totalInfil,

          // ── Fresh air ────────────────────────────────────────────────────────
          vbz,
          freshAir,
          exhaustCompensation,
          minSupplyAcph,
          faAshraeAcph,
          optimisedFreshAir,
          freshAirCheck,
          maxPurgeAir,

          // ── Exhaust ──────────────────────────────────────────────────────────
          totalExhaust,
          exhaustGeneral,
          exhaustBibo,
          exhaustMachine,

          // ── AHU air balance (reheater-revised where applicable) ──────────────
          coilAir:        finalCoilAir,
          bypassAir:      finalBypassAir,
          returnAir:      finalReturnAir,
          dehumidifiedAir: finalCoilAir,
          freshAirAces,
          bleedAir,
          ahuCap:         finalSupplyAir,
          coolingLoadHL:  coolingCapTR,

          // ── OA coil loads ────────────────────────────────────────────────────
          ...oaFields,

          // ── Reheater ─────────────────────────────────────────────────────────
          // reheatRequired: true when room ESHF < minESHF (coil insufficient)
          // reheatBTU:      reheat coil capacity in BTU/hr
          // reheatKW:       reheat coil capacity in kW
          // minESHF:        physics-based minimum achievable ESHF (varies with ADP/BF/room)
          // roomESHF:       actual room ESHF = ERSH / ERTH (no OA, no fan heat — Excel method)
          reheatRequired,
          reheatBTU:     Math.round(reheatBTU),
          reheatKW,
          minESHF:       parseFloat(minESHF.toFixed(3)),
          roomESHF:      parseFloat(roomESHF.toFixed(3)),

          // ── Heating ─────────────────────────────────────────────────────────
          heatingCapBTU,
          heatingCap,
          heatingCapMBH,
          preheatCapBTU,
          preheatCap,
          terminalHeatingCap,
          extraHeatingCap,
          needsHeating,
          hwFlowRate,

          // ── Humidification ───────────────────────────────────────────────────
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

          // ── Pipe sizing ──────────────────────────────────────────────────────
          chwBranchSize:     pipes.chw.branchDiamMm,
          chwManifoldSize:   pipes.chw.manifoldDiamMm,
          chwFlowRate:       pipes.chw.flowGPM,
          hwBranchSize:      pipes.hw.branchDiamMm,
          hwManifoldSize:    pipes.hw.manifoldDiamMm,
          hwFlow:            pipes.hw.flowGPM,
          preheatBranchSize: pipes.preheat.branchDiamMm,
          preheatHwFlow:     pipes.preheat.flowGPM,

          // ── Coil performance ─────────────────────────────────────────────────
          coil_shr:           psychroFields['coil_shr'],
          coil_contactFactor: psychroFields['coil_contactFactor'],
          coil_adp:           adpF,
          coil_adpMode:       ahuAdpMode,

          // ── ESHF / Required ADP psychrometric sufficiency ────────────────────
          eshf,
          requiredADP,
          adpGap,
          adpSufficient,
          eshfType,
          eshfNote,

          // ── Seasonal load results ────────────────────────────────────────────
          ...seasonResults,

          // ── Derived seasonal fields ──────────────────────────────────────────
          ...pickupFields,
          ...achFields,
          ...termHeatFields,

          // ── Psychrometric state points ───────────────────────────────────────
          ...psychroFields,

          // ── Load breakdown — for Insights tab ───────────────────────────────
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

      } catch (err) {
        console.error(`[rdsSelector] Room ${room.id} failed:`, err);
        return {
          ...room,
          volume:             0,
          floorArea:          0,
          _error:             err.message,
          _calculationFailed: true,
        };
      }
    });
  }
);