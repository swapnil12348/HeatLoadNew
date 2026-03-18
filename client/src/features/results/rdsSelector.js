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
 * ── CHANGELOG v2.6 ────────────────────────────────────────────────────────────
 *
 *   ESHF / Required ADP analysis added (STEP 4b).
 *
 *     calculateRequiredADP (psychro.js v2.3) finds the coil surface temperature
 *     the room thermodynamically demands to control BOTH temperature AND humidity
 *     simultaneously (ASHRAE HOF 2021 Ch.18 ESHF line method).
 *
 *     Five new fields on rdsRow: eshf, requiredADP, adpGap, adpSufficient, eshfNote.
 *     adpSufficient: 'yes' | 'marginal' | 'insufficient' | 'no_solution' | 'not_applicable'
 *     Consumed by resultsSections.js (ACES Summary) and InsightsTab recommendation rules.
 *
 *   Fan heat basis corrected — Cs × supplyAir × coilDT replaces Math.abs(peakErsh).
 *
 *     Previous basis (peakErsh × fanHeatPct) is correct when supply air is
 *     thermal-governed (supplyAir ≈ thermalCFM). For ACPH-governed rooms
 *     where supplyAir >> thermalCFM, the fan is physically moving much more
 *     air than the thermal load implies — fan heat was understated by up to 80×.
 *
 *     New basis: Cs × supplyAir × (dbInF − adpF) × (1 − bf) × fanHeatPct
 *     — proportional to actual coil air quantity, not room sensible load.
 *
 *     Math.abs guard added: when adpF > dbInF (e.g. 5°C room with default 55°F
 *     project ADP), (dbInF − adpF) is negative → fan heat goes negative →
 *     grandTotal is REDUCED instead of increased. Fan heat is always positive.
 *
 * ── CHANGELOG v2.5 ────────────────────────────────────────────────────────────
 *
 *   ADP-01 calculated mode — use thermalCFM not supplyAir as back-calculation basis.
 *
 *     For ACPH-governed rooms, supplyAir >> thermalCFM.
 *     ADP = roomDB − ERSH/(Cs × coilCFM) collapsed to roomDB − 2°F (the clamp)
 *     when the full ACPH supply was used as the denominator.
 *     Fix: adpBasisCFM = thermalCFM when thermalCFM > 0, else supplyAir fallback.
 *
 *   Load breakdown fields (bd_*) added for Insights tab.
 *
 * ── CHANGELOG v2.4 ────────────────────────────────────────────────────────────
 *
 *   Multi-season peak selection — monsoon vs summer comparison implemented.
 *
 *     peakCFMSeason    — season with highest ERSH → governs supply air CFM.
 *     peakCoolingSeason — season with highest (ERSH + ERLH + OA) → governs TR.
 *
 * ── CHANGELOG v2.3 ────────────────────────────────────────────────────────────
 *
 *   returnFanHeat wired from systemDesign.returnFanHeat.
 *   humidificationTarget wired as raRH fallback.
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   ADP-01 — Apparatus Dew Point mode: 'manual' | 'calculated' per AHU.
 *
 *     Priority chain (most specific wins):
 *       1. ahuAdpMode = 'calculated' → calculateAdpFromLoads() from psychro.js
 *       2. ahu.adp > 0               → per-AHU manual override (°F)
 *       3. systemDesign.adp          → project-level default
 *       4. ASHRAE.DEFAULT_ADP        → 55°F hardcoded fallback
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   CRIT-RDS-01 — rdsRow.volume and rdsRow.floorArea now in ft³ / ft².
 *   CRIT-RDS-02 — grandTotal and coilLoadBTU now use oaTotal (enthalpy method).
 *   HIGH-HH-01  — recirculationFraction now passed to calculateHeatingHumid.
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   CRIT-01: OA coil load included in grandTotal (was missing → 15–40% understatement)
 *   MED-01:  Fan heat is SENSIBLE only
 *   MED-02:  returnFanHeat included in grandTotal
 *   RDS-01:  sensibleFactor(elevation) for Cs (was ASHRAE.SENSIBLE_FACTOR → undefined)
 *   RDS-02:  altitudeCorrectionFactor from psychro.js (no local duplicate)
 *   RDS-03:  KW_TO_BTU_HR from units.js (was ASHRAE.KW_TO_BTU, wrong name)
 *   RDS-04:  supplyAcph computed and exposed for ISO 14644 audit
 *
 * ── SUPPLY AIR FIELD CLARIFICATION ───────────────────────────────────────────
 *
 *   supplyAir     = TOTAL supply CFM (recirculation + OA), from airQuantities.js
 *                   Math.max(thermalCFM, designAcphCFM, regulatoryAcphCFM, minAcphCFM)
 *   freshAirCheck = OA-only CFM component.
 *   ACPH uses supplyAir (total) — correct for ISO 14644 cleanroom ACH. ✓
 *
 * ── PEAK SEASON SELECTION ────────────────────────────────────────────────────
 *
 *   peakCFMSeason     → season with highest ERSH → governs supply air CFM
 *   peakCoolingSeason → season with highest (ERSH + ERLH + OA) → governs TR
 *
 *   In temperate climates both are 'summer'. They diverge for high-humidity
 *   monsoon climates where OA enthalpy load is the dominant cooling driver.
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
  calculateAdpFromLoads,
  calculateRequiredADP,
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

    return rooms.map(room => {
      try {

        const envelope = envelopes[room.id] || null;
        const ahu      = ahus.find(a => a.id === room.assignedAhuIds?.[0]) || {};

        // Pre-convert units here — used throughout this room's calculations.
        // rdsRow.volume and rdsRow.floorArea are written as ft³ / ft² in the
        // assembled return object below, overriding the m³ / m² from ...room.
        const floorAreaFt2 = m2ToFt2(room.floorArea);
        const volumeFt3    = m3ToFt3(room.volume);

        const bf = parseFloat(systemDesign.bypassFactor) || 0.10;

        // raRH: room's winter humidity target for heating/humidification sizing.
        // Preserves 0%RH for battery dry rooms — 0 != null is true in JS, so
        // 0 correctly passes through. Falls back to project humidificationTarget
        // (not hardcoded 50) when the room has no designRH set at all.
        const parsedRaRh = parseFloat(room.designRH);
        const raRH = !isNaN(parsedRaRh)
          ? parsedRaRh
          : (systemDesign.humidificationTarget ?? 50);

        // ════════════════════════════════════════════════════════════════════════
        // STEP 1 — Seasonal loads
        //
        // All three season calcs objects are retained in seasonCalcs so that
        // the post-STEP-1 peak selection can access ersh, erlh, and dbInF
        // for any season without re-running calculateSeasonLoad.
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
        // peakCFMSeason: season with highest ERSH — governs supply air CFM and ADP.
        const peakCFMSeason = SEASONS_LIST.reduce((best, s) =>
          (seasonCalcs[s].ersh > seasonCalcs[best].ersh ? s : best), 'summer'
        );
        const peakCalcs = seasonCalcs[peakCFMSeason];

        const peakErsh = peakCalcs.ersh;
        const dbInF    = peakCalcs.dbInF ?? 72;

        // ════════════════════════════════════════════════════════════════════════
        // ADP-01 — Resolve effective ADP
        //
        // ⚠ This block MUST come after STEP 1.
        //   'calculated' mode requires peakErsh and dbInF.
        //
        // Priority chain (most specific wins):
        //   1. ahuAdpMode = 'calculated' → calculateAdpFromLoads(dbInF, peakErsh, ...)
        //   2. ahu.adp > 0               → per-AHU manual override (°F)
        //   3. systemDesign.adp          → project-level default
        //   4. ASHRAE.DEFAULT_ADP        → 55°F hardcoded fallback
        //
        // Two-pass for 'calculated' mode — adpBasisCFM = thermalCFM, not supplyAir.
        // Using supplyAir collapsed ADP to roomDB−2°F for ACPH-governed rooms.
        //
        // ⚠ 'calculated' mode is only valid for cooling-coil AHUs.
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
        //
        // peakCoolingSeason: season with highest (ERSH + ERLH + OA enthalpy).
        // Governs cooling capacity (TR), coilLoadBTU, and CHW pipe sizing.
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
        // Proportional to actual air volume being moved through the coil —
        // correct for both thermal-governed and ACPH-governed rooms.
        //
        // Math.abs guard: when adpF > dbInF (ADP above room temp — invalid
        // configuration), (dbInF − adpF) is negative. Without Math.abs,
        // supplyFanHeatBTU goes negative and reduces grandTotal instead of
        // adding to it. Fan heat is always physically positive.
        // The Insights tab ADP-above-room-temp rule flags this condition.
        const supplyFanHeatBTU = Math.round(
          Math.abs(Cs * supplyAir * (dbInF - adpF) * (1 - bf)) * supplyFanHeatFraction
        );
        const returnFanHeatBTU = Math.round(supplyFanHeatBTU * returnFanHeatFraction);

        const grandTotal = (peakErshForCap + peakErlhForCap)
          + oaPeak.oaTotal
          + supplyFanHeatBTU
          + returnFanHeatBTU;

        const coolingCapTR = (grandTotal / ASHRAE.BTU_PER_TON).toFixed(2);
        const grandTotalSensible = Math.round(
          peakErshForCap + oaPeak.oaSensible + supplyFanHeatBTU + returnFanHeatBTU
        );

        // coilLoadBTU: basis for CHW pipe sizing — excludes supply fan heat
        // (supply fan is downstream of coil in draw-through configuration).
        const coilLoadBTU = (peakErshForCap + peakErlhForCap)
          + oaPeak.oaTotal
          + returnFanHeatBTU;

        const supplyFanHeatBlow = supplyFanHeatBTU;
        const supplyFanHeatDraw = (supplyFanHeatBTU / KW_TO_BTU_HR).toFixed(2);
        const returnFanHeat     = (returnFanHeatBTU / KW_TO_BTU_HR).toFixed(2);

        // ════════════════════════════════════════════════════════════════════════
        // STEP 4b — Required ADP from ESHF line (psychrometric sufficiency check)
        //
        // Finds the coil surface temperature the room thermodynamically demands
        // to control BOTH temperature AND humidity simultaneously.
        // ASHRAE HOF 2021 Ch.18 — ESHF line intersection with saturation curve.
        //
        // Uses peakCoolingSeason loads so ESHF is consistent with the capacity-
        // governing design point. grIn from peakCalcs gives the room moisture
        // basis with correct Hyland-Wexler Patm correction.
        //
        // Three possible outcomes:
        //   'found'         → requiredADP in °F — compare against plantADP (adpF)
        //   'sensible_only' → room is sensible-dominated, any CHW plant works
        //   'no_solution'   → CRITICAL: coil cannot control humidity at any ADP,
        //                     supplemental dehumidification required
        //
        // ⚠ Only meaningful for cooling-coil AHUs.
        //   Battery dry rooms and desiccant systems: not applicable.
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
        const requiredADP   = eshfResult.requiredADP;  // °F | null
        const eshfType      = eshfResult.type;          // 'found' | 'sensible_only' | 'no_solution'
        const eshfNote      = eshfResult.note;

        // adpGap: plantADP − requiredADP (°F). Positive = plant too warm.
        // null when ESHF analysis is not applicable (sensible_only outcome).
        const adpGap = (eshfType === 'found' && requiredADP !== null)
          ? parseFloat((adpF - requiredADP).toFixed(1))
          : null;

        // adpSufficient: summary of whether the plant can control humidity.
        const adpSufficient = eshfType === 'no_solution'  ? 'no_solution'
          : eshfType === 'sensible_only'                   ? 'not_applicable'
          : adpGap === null                                ? 'not_applicable'
          : adpGap <= 0                                    ? 'yes'
          : adpGap <= 3                                    ? 'marginal'
          :                                                  'insufficient';

        // totalInfil and rsh: from peak ERSH season (sensible peak conditions).
        const totalInfil = Math.round(peakCalcs.infilCFM   || 0);
        const rsh        = Math.round(peakCalcs.rawSensible || 0);

        // ════════════════════════════════════════════════════════════════════════
        // STEP 5 — Heating + humidification
        // ════════════════════════════════════════════════════════════════════════
        const recircFraction = supplyAir > 0 ? returnAir / supplyAir : 0;

        const heatHumid = calculateHeatingHumid(
          seasonResults['ershOn_winter'],
          supplyAir,
          freshAirCheck,
          climate,
          dbInF,
          raRH,
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
        // adpF is the fully resolved ADP — consistent with effectiveSystemDesign.
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
        // volume and floorArea explicitly set as ft³ / ft², overriding the
        // m³ / m² values from the ...room spread.
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

          // ── Core cooling outputs ─────────────────────────────────────────────
          supplyAir,
          supplyAirGoverned,
          thermalCFM,
          supplyAirMinAcph,
          regulatoryAcphCFM,
          supplyAcph,
          coolingCapTR,
          grandTotal:         Math.round(grandTotal),
          grandTotalSensible,
          coilLoadBTU:        Math.round(coilLoadBTU),
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

          // ── AHU air balance ──────────────────────────────────────────────────
          coilAir,
          bypassAir,
          returnAir,
          dehumidifiedAir,
          freshAirAces,
          bleedAir,
          ahuCap:        supplyAir,
          coolingLoadHL: coolingCapTR,

          // ── OA coil loads ────────────────────────────────────────────────────
          ...oaFields,

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
          coil_adp:           adpF,       // resolved ADP (°F) for display
          coil_adpMode:       ahuAdpMode, // 'manual' | 'calculated'

          // ── ESHF / Required ADP psychrometric sufficiency ────────────────────
          // eshf:           effective sensible heat factor (0–1)
          // requiredADP:    coil surface temp needed to control temp + humidity (°F | null)
          // adpGap:         plantADP − requiredADP (°F). Positive = humidity risk.
          // adpSufficient:  'yes' | 'marginal' | 'insufficient' | 'no_solution' | 'not_applicable'
          // eshfType:       raw bisection outcome — for engineering audit / debugging
          // eshfNote:       explanation string when type !== 'found'
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
          // Pre-safety-factor raw components from peakCFMSeason.
          // Signed values: envelopeGain / infilSens can be negative (heat loss,
          // pressurised room infiltration credit).
          // bd_oa uses oaPeak (peakCoolingSeason) to match grandTotal basis.
          bd_envelope:     Math.round(peakCalcs.envelopeGain || 0),
          bd_people:       Math.round(peakCalcs.pplSens      || 0),
          bd_lights:       Math.round(peakCalcs.lightsSens   || 0),
          bd_equipment:    Math.round(peakCalcs.equipSens    || 0),
          bd_infiltration: Math.round(peakCalcs.infilSens    || 0),
          bd_oa:           Math.round(oaPeak.oaTotal         || 0),
          bd_fanHeat:      Math.round(supplyFanHeatBTU + returnFanHeatBTU),
          bd_grandTotal:   Math.round(grandTotal),
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