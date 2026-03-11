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
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   CRIT-RDS-01 FIX — rdsRow.volume and rdsRow.floorArea now in ft³ / ft².
 *
 *     The assembled rdsRow previously spread ...room first, which set
 *     rdsRow.volume = room.volume (m³) and rdsRow.floorArea = room.floorArea (m²).
 *     The converted values (volumeFt3, floorAreaFt2) were only used locally
 *     and never included in the assembled return object.
 *
 *     isoValidation.js reads rdsRow.volume assuming ft³ for its ACPH computation:
 *       actualAcph = supplyAir × 60 / rdsRow.volume
 *
 *     With rdsRow.volume in m³ (e.g. 500 m³ = 17,657 ft³):
 *       actualAcph = 1000 × 60 / 500 = 120 ACPH   ← 35.3× too high
 *     vs correct:
 *       actualAcph = 1000 × 60 / 17,657 = 3.4 ACPH ← fails ISO 8 correctly
 *
 *     Every single ISO 14644 and GMP Annex 1 compliance check was producing
 *     false-pass results. A room failing ISO 8 minimum (10 ACPH) was reported
 *     as meeting ISO 3 (480 ACPH minimum).
 *
 *     Fix: volume: volumeFt3 and floorArea: floorAreaFt2 are now explicitly
 *     set in the return object, overriding the m²/m³ values from ...room spread.
 *
 *   CRIT-RDS-02 FIX — grandTotal and coilLoadBTU now use oaTotal (enthalpy method).
 *
 *     Previous:
 *       grandTotal = peakErsh + peakErlh
 *         + oaSummer.oaSensible   ← Cs/Cl approximation
 *         + oaSummer.oaLatent     ← Cs/Cl approximation
 *         + fanHeat
 *
 *     outdoorAirLoad.js BUG-OA-03 explicitly documents:
 *       "rdsSelector.js should use oaTotal for coil capacity sizing.
 *        oaSensible + oaLatent are for display breakdown only."
 *
 *     The enthalpy method (oaTotal) uses h = 0.240t + W(1061 + 0.444t) —
 *     the full nonlinear ASHRAE enthalpy equation.
 *     The Cs/Cl method linearises the latent term: 0.68 × Δgr.
 *
 *     At high humidity differentials (tropical outdoor + dry indoor):
 *       Divergence: 3–8% of total OA load
 *       For a 100,000 CFM semiconductor fab at 5%RH, Chennai outdoor:
 *         oaTotal ≈ 4.5M BTU/hr vs oaSens+oaLat ≈ 4.2M BTU/hr
 *         Chiller undersized by ~25 TR per room using Cs/Cl method
 *
 *     Fix: oaSummer.oaTotal replaces (oaSummer.oaSensible + oaSummer.oaLatent)
 *     in both grandTotal and coilLoadBTU.
 *     The component display fields (oaSensible, oaLatent per season) are
 *     retained for breakdown display — they are correct for that purpose.
 *
 *   HIGH-HH-01 FIX — recirculationFraction now passed to calculateHeatingHumid.
 *
 *     heatingHumid.js v2.0 added BUG-HH-04 mixed-air humidification fix with
 *     a recirculationFraction parameter. rdsSelector.js never passed this value,
 *     so it always defaulted to 0 (100% OA system).
 *
 *     For a typical office AHU (80% recirculation), humidDeltaGr was calculated
 *     as if all 100% of supply air came from outdoors — 5× overstated.
 *
 *     recirculationFraction = returnAir / supplyAir is already computed from
 *     airQuantities.js. It is now passed to calculateHeatingHumid().
 *
 *     For pharma and semiconductor 100% OA systems: returnAir = 0 →
 *     recirculationFraction = 0 → behaviour unchanged (correct, these systems
 *     do have 100% OA and require humidification of all supply air from outdoor).
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   FIX CRIT-01: OA coil load included in grandTotal (was missing → 15–40% understatement)
 *   FIX MED-01: Fan heat is SENSIBLE only
 *   FIX MED-02: returnFanHeat included in grandTotal
 *   FIX RDS-01: sensibleFactor(elevation) for Cs (was ASHRAE.SENSIBLE_FACTOR → undefined)
 *   FIX RDS-02: altitudeCorrectionFactor from psychro.js (no local duplicate)
 *   FIX RDS-03: KW_TO_BTU_HR from units.js (was ASHRAE.KW_TO_BTU, wrong name)
 *   FIX RDS-04: supplyAcph computed and exposed for ISO 14644 audit
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
  calculateAdpFromLoads
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

      // ── ADP-01: Resolve effective ADP ─────────────────────────────────────
      //
      // Priority chain (most specific wins):
      //   1. adpMode = 'calculated' → back-calculate from room sensible load
      //   2. ahu.adp > 0            → per-AHU manual override
      //   3. systemDesign.adp       → project-level default
      //   4. ASHRAE.DEFAULT_ADP     → 55°F hardcoded fallback
      //
      // For 'calculated' mode we need a preliminary supplyAir estimate to break
      // the circular dependency (supplyAir ↔ ADP). Two-pass approach:
      //
      //   Pass 1: calculateAirQuantities with project-default ADP
      //           → gets preliminary supplyAir (ACPH constraints dominate anyway
      //             for cleanrooms; thermal CFM changes <5% between passes)
      //   Pass 2: calculateAdpFromLoads(dbInF, peakErsh, prelimSupplyAir, bf)
      //           → effective ADP
      //   Final:  all downstream calcs (psychro, state points) use effective ADP
      //
      // ⚠️  'calculated' mode is only physically valid for cooling-coil AHUs.
      //     Battery dry rooms and desiccant systems should remain 'manual'.
      //     ADP < 35°F is clamped inside calculateAdpFromLoads — the function
      //     will return DEFAULT_ADP (55°F) if peakErsh = 0 or supplyAir = 0.
      //
      // Resolution of adpMode:
      //   Per-AHU adpMode → project systemDesign.adpMode → 'manual' hardcoded.
      //   This allows a project-wide default mode to be set from ProjectDetails
      //   and overridden per-AHU in AHUConfig.

      const projectAdpMode = systemDesign?.adpMode   || 'manual';
      const ahuAdpMode     = ahu?.adpMode             || projectAdpMode;
      const projectAdp     = parseFloat(systemDesign?.adp) || ASHRAE.DEFAULT_ADP;
      const ahuAdpOverride = parseFloat(ahu?.adp)     || 0;

      let adpF;

      if (ahuAdpMode === 'calculated') {
        // Two-pass: preliminary air quantities with project-default ADP,
        // then recalculate ADP from the resulting supplyAir.
        //
        // Pass 1 uses a synthetic systemDesign with the project-default ADP
        // so airQuantities.js reads a valid value on the first pass.
        const prelimSystemDesign = { ...systemDesign, adp: projectAdp };
        const prelimAirQty = calculateAirQuantities(
          room, envelope, ahu, prelimSystemDesign,
          altCf, peakErsh,
          floorAreaFt2, volumeFt3,
        );

        adpF = calculateAdpFromLoads(
          dbInF,
          peakErsh,
          prelimAirQty.supplyAir,
          bf,
          elevation,
        );

        // Pass 2 supplyAir is computed below with the final adpF.
        // In practice, the difference between pass-1 and pass-2 supplyAir is
        // small (<5%) for ACPH-governed rooms. For thermally-governed rooms it
        // converges in one iteration because ADP drives thermalCFM, and
        // thermalCFM was already consistent with the preliminary ADP.

      } else {
        // Manual mode: per-AHU override wins; project default as fallback.
        adpF = ahuAdpOverride > 0 ? ahuAdpOverride : projectAdp;
      }

      // Build effective systemDesign with the resolved ADP so that
      // calculateAirQuantities (called in STEP 2 below) and all downstream
      // calcs receive the same effective value.
      // We do NOT mutate systemDesign — this is a local copy for this room only.
      const effectiveSystemDesign = adpF !== projectAdp
        ? { ...systemDesign, adp: adpF }
        : systemDesign; // no copy needed if ADP unchanged

      // Null-coalescing guard: preserves 0%RH for battery dry rooms.
      // 0 != null is true in JS → 0 passes through correctly.
      // Safe guard: preserves 0%RH for battery dry rooms but catches empty strings
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
      // STEP 2 — Air quantities
      // ════════════════════════════════════════════════════════════════════════
      const airQty = calculateAirQuantities(
        room, envelope, ahu, systemDesign,
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
        elevation,     // MED-OA-01 FIX: was (altCf, elevation); altCf removed
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
      //
      //   Previous (Cs/Cl approximation):
      //     grandTotal = peakErsh + peakErlh
      //       + oaSummer.oaSensible + oaSummer.oaLatent  ← linearised latent
      //       + fanHeat
      //
      //   Fixed (enthalpy method — authoritative per BUG-OA-03):
      //     grandTotal = peakErsh + peakErlh
      //       + oaSummer.oaTotal                          ← full enthalpy h = 0.240t + W(1061+0.444t)
      //       + fanHeat
      //
      //   The Cs/Cl method linearises the latent contribution (0.68 × Δgr).
      //   At high humidity differentials, divergence reaches 3–8% of OA load.
      //   For tropical outdoor + dry cleanroom: chiller undersized by ~25 TR/room.
      //
      //   oaSensible and oaLatent per season are retained for display breakdown.
      //   coilLoadBTU also uses oaTotal (same rationale — CHW plant sizing).
      //
      // RETAINED FIXES (v2.0):
      //   FIX CRIT-01: OA load included in grandTotal (was: entirely omitted)
      //   FIX MED-01:  Fan heat is sensible-only (was: (ersh+erlh) × fraction)
      //   FIX MED-02:  returnFanHeat included (was: computed but never added)
      // ════════════════════════════════════════════════════════════════════════
      const oaSummer = oaLoads.summer;

      const fanHeatFraction  = (parseFloat(systemDesign.fanHeat) || 5) / 100;
      const supplyFanHeatBTU = Math.round(peakErsh * fanHeatFraction);  // FIX MED-01: sensible only
      const returnFanHeatBTU = Math.round(supplyFanHeatBTU * 0.02);     // FIX MED-02

      // CRIT-RDS-02 FIX: oaTotal is the authoritative enthalpy-based OA load.
      // oaSensible + oaLatent are Cs/Cl approximations — valid for display only.
      const grandTotal = (peakErsh + peakErlh)
        + oaSummer.oaTotal        // CRIT-RDS-02 FIX: was (oaSensible + oaLatent)
        + supplyFanHeatBTU
        + returnFanHeatBTU;

      const coolingCapTR = (grandTotal / ASHRAE.BTU_PER_TON).toFixed(2);

      // coilLoadBTU: room + OA before fan heat. Used for CHW pipe sizing.
      // CRIT-RDS-02 FIX: oaTotal here too — CHW plant must not be undersized.
      const coilLoadBTU = (peakErsh + peakErlh)
        + oaSummer.oaTotal
        + supplyFanHeatBTU;       // CRIT-RDS-02 FIX: was (oaSensible + oaLatent)

      const supplyFanHeatBlow = supplyFanHeatBTU;
      const supplyFanHeatDraw = (supplyFanHeatBTU / KW_TO_BTU_HR).toFixed(2);
      const returnFanHeat     = (returnFanHeatBTU  / KW_TO_BTU_HR).toFixed(2);

      const totalInfil = summerCalcs ? Math.round(summerCalcs.infilCFM) : 0;
      const rsh        = summerCalcs ? Math.round(summerCalcs.rawSensible) : 0;

      // ════════════════════════════════════════════════════════════════════════
      // STEP 5 — Heating + humidification
      //
      // HIGH-HH-01 FIX — recirculationFraction now passed to calculateHeatingHumid.
      //
      //   heatingHumid.js BUG-HH-04 added mixed-air humidification correction
      //   with a recirculationFraction parameter. This selector never passed it,
      //   so it always defaulted to 0 (100% OA system).
      //
      //   For a typical recirculation AHU (returnAir / supplyAir = 0.8):
      //     Old: gr_mixed = gr_outdoor  (100% OA assumed — wrong for recirculation)
      //     New: gr_mixed = gr_OA × 0.2 + gr_return × 0.8  (correct blend)
      //
      //   The return air is at room conditions (designRH at dbInF). Blending with
      //   outdoor air REDUCES the moisture the humidifier must add, because return
      //   air is already partially conditioned to the room setpoint.
      //
      //   For 100% OA systems (pharma sterile, semiconductor fab):
      //     returnAir = 0 → recircFraction = 0 → behaviour unchanged.
      //
      //   humidLbsPerHr for a recirculation AHU was previously 5× too high.
      //   This affected HW coil sizing, steam plant sizing, and cost estimates.
      // ════════════════════════════════════════════════════════════════════════

      // HIGH-HH-01 FIX: compute recirculation fraction from airQuantities output.
      // recircFraction = 0 for DOAS / 100% OA systems (returnAir = 0 in those cases).
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
        recircFraction,   // HIGH-HH-01 FIX: was always missing → defaulted to 0
      );

      const {
        heatingCapBTU, heatingCap, heatingCapMBH,
        preheatCapBTU, preheatCap,
        terminalHeatingCap, extraHeatingCap, needsHeating,
        hwFlowRate,
        humidDeltaGr, mixedAirGr, humidGrTarget, winterGrOut,
        humidLbsPerHr, humidKw, humidLoadBTU, needsHumidification,highHumidificationLoad, humidWarning,
      } = heatHumid;

      // ════════════════════════════════════════════════════════════════════════
      // STEP 6 — Pipe sizing (coilLoadBTU — correct ASHRAE basis)
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
      // CRIT-RDS-01 FIX: volume and floorArea are now explicitly set as ft³ / ft²,
      // overriding the m³ / m² values that came from the ...room spread.
      //
      // The ...room spread is kept for all other room fields (name, id, designTemp,
      // designRH, ventCategory, etc.). Only the unit-converted dimensions override.
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
        // isoValidation.js reads rdsRow.volume assuming ft³. Without this
        // override, computeActualAcph reads m³ and reports ACPH 35.3× too high,
        // causing every cleanroom to false-pass ISO compliance checks.
        volume:    volumeFt3,    // CRIT-RDS-01 FIX: ft³ (overrides room.volume in m³)
        floorArea: floorAreaFt2, // CRIT-RDS-01 FIX: ft² (overrides room.floorArea in m²)

        // ── Core cooling outputs ───────────────────────────────────────────────
        supplyAir,
        supplyAirGoverned,
        thermalCFM,
        supplyAirMinAcph,
        regulatoryAcphCFM,   // HIGH-AQ-01: regulatory ACH floor for display
        supplyAcph,
        coolingCapTR,
        grandTotal:  Math.round(grandTotal),
        coilLoadBTU: Math.round(coilLoadBTU),

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
        // oaTotal per season now included in grandTotal (CRIT-RDS-02 FIX).
        // oaSensible + oaLatent per season retained for display breakdown.
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
        coil_adp:           adpF,           // ADP-01: resolved ADP for RDS display
        coil_adpMode:       ahuAdpMode,     // ADP-01: 'manual' | 'calculated' — for UI badge

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