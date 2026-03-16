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
 * ── CHANGELOG v2.4 ────────────────────────────────────────────────────────────
 *
 *   Multi-season peak selection — monsoon vs summer comparison implemented.
 *
 *     Previous behaviour: peakErsh and peakErlh were always taken from summer.
 *     For high-humidity monsoon climates (Mumbai, Chennai, Singapore), the
 *     combined room + OA enthalpy load during monsoon can exceed the summer
 *     design point, causing cooling capacity to be undersized.
 *
 *     Two distinct peaks are now tracked and may resolve to different seasons:
 *
 *       peakCFMSeason    — season with highest ERSH.
 *                          Governs supply air CFM and ADP calculation.
 *                          Supply air is a sensible quantity; thermalCFM =
 *                          ERSH / (Cs × supplyDT), so peak sensible governs.
 *
 *       peakCoolingSeason — season with highest (ERSH + ERLH + OA enthalpy).
 *                           Governs cooling capacity (TR), coilLoadBTU, and
 *                           CHW pipe sizing.
 *                           Determined after STEP 3 when OA loads are available.
 *
 *     In temperate northern-hemisphere climates both seasons resolve to
 *     'summer' — no change in output. The split only matters when monsoon
 *     OA enthalpy load tips the peak to a different season.
 *
 *     Both seasons are exposed in the return object (peakCoolingSeason,
 *     peakCFMSeason) for engineering audit and RDS display.
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
 *     Two-pass for 'calculated' mode breaks the supplyAir ↔ ADP circular dependency:
 *       Pass 1: preliminary airQuantities with project-default ADP
 *       Pass 2: calculateAdpFromLoads from preliminary supplyAir → adpF
 *       Final:  effectiveSystemDesign = { ...systemDesign, adp: adpF }
 *
 *     ⚠ The ADP block MUST come after STEP 1 — 'calculated' mode requires
 *       peakErsh and dbInF, which are only available after calculateSeasonLoad().
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
 *   peakCoolingSeason is determined after STEP 3 (requires OA loads).
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
        const seasonCalcs   = {};  // full calcs per season — used for peak selection

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
        // Governs supply air CFM and ADP calculation.
        // Supply air is a sensible quantity — thermalCFM = ERSH / (Cs × supplyDT)
        // — so peak sensible (ERSH) is the correct governing criterion here.
        //
        // In temperate northern-hemisphere climates this always resolves to
        // 'summer'. The reduce is inexpensive (3 items) and future-proofs
        // against unusual climate profiles without any branch logic.
        // peakCFMSeason: season with highest ERSH — governs supply air CFM and ADP.
        // Aliased as peakCFMSeason (not peakErshSeason) so the name in the return
        // object is self-documenting at the RDS display layer.
        const peakCFMSeason = SEASONS_LIST.reduce((best, s) =>
          (seasonCalcs[s].ersh > seasonCalcs[best].ersh ? s : best), 'summer'
        );
        // Full calcs object for the CFM-governing season — needed for dbInF,
        // infilCFM, rawSensible (all sensible-peak quantities).
        const peakCalcs = seasonCalcs[peakCFMSeason];

        const peakErsh = peakCalcs.ersh;
        const peakErlh = peakCalcs.erlh;
        // dbInF from the peak sensible season — feeds ADP calculation and
        // psychrometric state points. Using summer's dbInF when a different
        // season governs CFM would produce a mismatched supply temperature.
        const dbInF    = peakCalcs.dbInF ?? 72;

        // ════════════════════════════════════════════════════════════════════════
        // ADP-01 — Resolve effective ADP
        //
        // ⚠ This block MUST come after STEP 1.
        //   'calculated' mode requires peakErsh and dbInF, which are only
        //   defined after calculateSeasonLoad() completes above. Placing this
        //   block before STEP 1 causes calculateAdpFromLoads to receive
        //   peakErsh=undefined → guard fires → returns DEFAULT_ADP every time
        //   → 'calculated' mode becomes a silent no-op.
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
        //           passed to STEP 2 so calculateAirQuantities uses resolved ADP.
        //
        // ⚠ 'calculated' mode is only valid for cooling-coil AHUs.
        //   Battery dry rooms and desiccant systems must remain 'manual'.
        // ════════════════════════════════════════════════════════════════════════

        const projectAdpMode  = systemDesign?.adpMode || 'manual';
        const ahuAdpMode      = ahu?.adpMode || projectAdpMode;
        const projectAdp      = parseFloat(systemDesign?.adp) || ASHRAE.DEFAULT_ADP;
        const ahuAdpOverride  = parseFloat(ahu?.adp) || 0;

        let adpF;

        if (ahuAdpMode === 'calculated') {
          // Pass 1 — preliminary air quantities using project-default ADP.
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
        // STEP 2 must receive effectiveSystemDesign — raw systemDesign would
        // ignore the resolved adpF since calculateAirQuantities reads adp internally.
        const effectiveSystemDesign = adpF !== projectAdp
          ? { ...systemDesign, adp: adpF }
          : systemDesign; // no allocation if ADP unchanged

        // ════════════════════════════════════════════════════════════════════════
        // STEP 2 — Air quantities
        //
        // effectiveSystemDesign carries the resolved adpF.
        // calculateAirQuantities reads systemDesign.adp for thermalCFM:
        //   supplyDT   = (1 − bf) × (dbInF − adp)
        //   thermalCFM = ERSH / (Cs × supplyDT)
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
        //
        // outdoorAirLoad.js derives altCf internally from elevation.
        // OA loads for all three seasons are computed here — they are required
        // both for the per-season oaFields output AND for the peak cooling
        // season selection that follows in STEP 4.
        // ════════════════════════════════════════════════════════════════════════
        const oaLoads = calculateAllSeasonOALoads(
          freshAirCheck, climate, dbInF, raRH,
          elevation,
        );

        const oaFields = {};
        SEASONS_LIST.forEach(season => {
          const oa = oaLoads[season];
          oaFields[`oaSensible_${season}`]    = oa.oaSensible;
          oaFields[`oaLatent_${season}`]      = oa.oaLatent;
          oaFields[`oaTotal_${season}`]       = oa.oaTotal;
          oaFields[`oaGrDelta_${season}`]     = (oa.grOut - oa.grIn).toFixed(1);
          oaFields[`oaEnthDelta_${season}`]   = oa.oaEnthalpyDelta.toFixed(2);
        });

        // ════════════════════════════════════════════════════════════════════════
        // STEP 4 — Peak cooling season selection + grand total
        //
        // Supply air CFM was sized to peakCFMSeason (peak sensible load).
        // Cooling capacity must be sized to the season with the highest
        // combined room load + OA enthalpy load.
        //
        // For high-humidity monsoon climates (Mumbai OA: ~83°F DB / ~78°F WB,
        // enthalpy ~41 BTU/lb) the monsoon OA load can exceed summer even when
        // summer ERSH is higher, because monsoon latent + OA enthalpy together
        // dominate. A fab that sizes to summer only would be ~10–20% short on
        // cooling capacity.
        //
        // seasonTotals[s] = ERSH_s + ERLH_s + oaTotal_s
        //
        // fan heat basis: peakErsh (from peakCFMSeason) — supply fan is sized
        // to the CFM requirement, not the capacity-governing season.
        // ════════════════════════════════════════════════════════════════════════
        const seasonTotals = {};
        SEASONS_LIST.forEach(s => {
          seasonTotals[s] = (seasonResults[`ershOn_${s}`] || 0)
            + (seasonResults[`erlhOn_${s}`] || 0)
            + (oaLoads[s]?.oaTotal         || 0);
        });

        // Season with highest combined room + OA load governs capacity.
        const peakCoolingSeason = SEASONS_LIST.reduce((best, s) =>
          (seasonTotals[s] > seasonTotals[best] ? s : best), peakCFMSeason
        );

        // Capacity-governing load values.
        const peakErshForCap = seasonResults[`ershOn_${peakCoolingSeason}`];
        const peakErlhForCap = seasonResults[`erlhOn_${peakCoolingSeason}`];
        const oaPeak         = oaLoads[peakCoolingSeason];

        const supplyFanHeatFraction = (parseFloat(systemDesign.fanHeat)       || 5) / 100;
        const returnFanHeatFraction = (parseFloat(systemDesign.returnFanHeat) || 5) / 100;

        // Fan heat is based on peakErsh (CFM-governing season) — supply fan
        // is sized to the airflow requirement, not the capacity-governing season.
        const supplyFanHeatBTU = Math.round(Math.abs(peakErsh) * supplyFanHeatFraction);
        const returnFanHeatBTU = Math.round(supplyFanHeatBTU   * returnFanHeatFraction);

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
        // Uses peakCoolingSeason values — CHW pipe must handle the peak coil load.
        const coilLoadBTU = (peakErshForCap + peakErlhForCap)
          + oaPeak.oaTotal
          + returnFanHeatBTU;

        const supplyFanHeatBlow = supplyFanHeatBTU;
        const supplyFanHeatDraw = (supplyFanHeatBTU / KW_TO_BTU_HR).toFixed(2);
        const returnFanHeat     = (returnFanHeatBTU / KW_TO_BTU_HR).toFixed(2);

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

          achFields[`achOn_temp_${s}`]     = dbInF.toFixed(1);
          achFields[`achOn_rh_${s}`]       = raRH.toFixed(1);
          achFields[`achOff_temp_${s}`]    = dbInF.toFixed(1);
          achFields[`achOff_rh_${s}`]      = raRH.toFixed(1);
          achFields[`achTermOn_temp_${s}`] = dbInF.toFixed(1);
          achFields[`achTermOn_rh_${s}`]   = raRH.toFixed(1);
          achFields[`achTermOff_temp_${s}`]= dbInF.toFixed(1);
          achFields[`achTermOff_rh_${s}`]  = raRH.toFixed(1);

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
          volume:        volumeFt3,
          floorArea:     floorAreaFt2,

          // ── Peak season audit ────────────────────────────────────────────────
          // Exposed for RDS display and engineering review.
          // peakCFMSeason:    season whose ERSH governed supply air CFM.
          // peakCoolingSeason: season whose (ERSH + ERLH + OA) governed TR/coil.
          // These are identical in temperate climates. They differ when monsoon
          // OA enthalpy load tips the capacity peak to a different season.
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
          ahuCap:         supplyAir,
          coolingLoadHL:  coolingCapTR,

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
          chwBranchSize:   pipes.chw.branchDiamMm,
          chwManifoldSize: pipes.chw.manifoldDiamMm,
          chwFlowRate:     pipes.chw.flowGPM,
          hwBranchSize:    pipes.hw.branchDiamMm,
          hwManifoldSize:  pipes.hw.manifoldDiamMm,
          hwFlow:          pipes.hw.flowGPM,
          preheatBranchSize: pipes.preheat.branchDiamMm,
          preheatHwFlow:     pipes.preheat.flowGPM,

          // ── Coil performance ─────────────────────────────────────────────────
          coil_shr:           psychroFields['coil_shr'],
          coil_contactFactor: psychroFields['coil_contactFactor'],
          coil_adp:           adpF,        // resolved ADP (°F) for display
          coil_adpMode:       ahuAdpMode,  // 'manual' | 'calculated'

          // ── Seasonal load results ────────────────────────────────────────────
          ...seasonResults,

          // ── Derived seasonal fields ──────────────────────────────────────────
          ...pickupFields,
          ...achFields,
          ...termHeatFields,

          // ── Psychrometric state points ───────────────────────────────────────
          ...psychroFields,
        };

      } catch (err) {
        console.error(`[rdsSelector] Room ${room.id} failed:`, err);
        return {
          ...room,
          volume:             0,   // SI value from ...room is wrong unit — zero is safer
          floorArea:          0,
          _error:             err.message,
          _calculationFailed: true,
        };
      }
    });
  }
);