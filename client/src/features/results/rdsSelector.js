// src/features/results/rdsSelector.js
import { createSelector } from '@reduxjs/toolkit';
import {
  calculateGrains,
  calculateEnthalpy,
  calculateWetBulb,
} from '../../utils/psychro';
import ASHRAE from '../../constants/ashrae';
import { calcTotalEnvelopeGain } from '../../utils/envelopeCalc';

// ── Unit helpers ──────────────────────────────────────────────────────────────
const cToF      = (c) => (parseFloat(c) * 9) / 5 + 32;
const M2_TO_FT2 = 10.7639;
const M3_TO_FT3 = 35.3147;

const altitudeCorrectionFactor = (elevationFt) => {
  const elev = parseFloat(elevationFt) || 0;
  if (elev <= 0) return 1.0;
  const pAlt = 29.921 * Math.pow(1 - 6.8754e-6 * elev, 5.2559);
  return pAlt / 29.921;
};

// Estimate RH from grains and DB — used to derive WB for psychro state points
const rhFromGrains = (grains, dbF, elevation = 0) => {
  const grainsSat = calculateGrains(dbF, 100, elevation);
  return grainsSat > 0 ? Math.min(100, (grains / grainsSat) * 100) : 50;
};

// ── Input selectors ───────────────────────────────────────────────────────────
const selectRooms        = (state) => state.room.list;
const selectEnvelopes    = (state) => state.envelope.byRoomId;
const selectAhus         = (state) => state.ahu.list;
const selectClimate      = (state) => state.climate;
const selectSystemDesign = (state) => state.project.systemDesign;
const selectElevation    = (state) => state.project.ambient.elevation || 0;

// ── Per-season load calculator ────────────────────────────────────────────────
const calculateSeasonLoad = (
  room, envelope, climate, season, systemDesign,
  altCf, elevation, floorAreaFt2, volumeFt3
) => {
  const env = envelope || { internalLoads: {}, infiltration: {} };
  const int = env.internalLoads || {};
  const inf = env.infiltration  || {};

  const outdoor = climate?.outside?.[season] || { db: 95, rh: 40 };
  const dbOut   = parseFloat(outdoor.db) || 95;

  // BUG-02 FIX: recalculate outdoor grains at site elevation, not sea level.
  const ambRH = parseFloat(outdoor.rh) || 0;
  const grOut = calculateGrains(dbOut, ambRH, elevation);

  const dbInF = isNaN(parseFloat(room.designTemp)) ? 72 : cToF(room.designTemp);
  const rhIn  = parseFloat(room.designRH) || 50;
  const grIn  = calculateGrains(dbInF, rhIn, elevation);

  const envelopeGain = calcTotalEnvelopeGain(env.elements, climate, dbInF, season);

  const Cs = ASHRAE.SENSIBLE_FACTOR * altCf;
  const Cl = ASHRAE.LATENT_FACTOR   * altCf;

  // ── People ─────────────────────────────────────────────────────────────────
  const pplCount = parseFloat(int.people?.count)               || 0;
  const pplSens  = pplCount * (int.people?.sensiblePerPerson   || ASHRAE.PEOPLE_SENSIBLE_SEATED);
  const pplLat   = pplCount * (int.people?.latentPerPerson     || ASHRAE.PEOPLE_LATENT_SEATED);

  // ── Lighting (always ON, CLF = 1.0) ───────────────────────────────────────
  const lightsSens = (parseFloat(int.lights?.wattsPerSqFt) || 0)
    * floorAreaFt2
    * ASHRAE.BTU_PER_WATT;

  // ── Equipment (sensible + latent fractions) ────────────────────────────────
  const equipKW      = parseFloat(int.equipment?.kw)          || 0;
  const equipSensPct = (parseFloat(int.equipment?.sensiblePct) ?? 100) / 100;
  const equipLatPct  = (parseFloat(int.equipment?.latentPct)   ?? 0)   / 100;
  const equipSens    = equipKW * ASHRAE.KW_TO_BTU * equipSensPct;
  const equipLatent  = equipKW * ASHRAE.KW_TO_BTU * equipLatPct;

  // ── Infiltration ───────────────────────────────────────────────────────────
  const infilCFM  = (volumeFt3 * (parseFloat(inf.achValue) || 0)) / 60;
  const infilSens = Cs * infilCFM * (dbOut - dbInF);
  const infilLat  = Cl * infilCFM * (grOut - grIn);

  // ── Totals ─────────────────────────────────────────────────────────────────
  const rawSensible = envelopeGain + pplSens + lightsSens + equipSens + infilSens;
  const rawLatent   = pplLat + infilLat + equipLatent;

  const safetyMult = 1 + (systemDesign.safetyFactor || 10) / 100;
  const ersh = Math.round(rawSensible * safetyMult);
  const erlh = Math.round(rawLatent   * safetyMult);

  return {
    ersh, erlh,
    grains: grIn.toFixed(1),
    dbInF, grIn,
    equipSens, equipLatent,
    safetyMult,
    rawSensible, rawLatent,
    infilCFM,
  };
};

// ── Main selector ─────────────────────────────────────────────────────────────
export const selectRdsData = createSelector(
  [selectRooms, selectEnvelopes, selectAhus, selectClimate, selectSystemDesign, selectElevation],
  (rooms, envelopes, ahus, climate, systemDesign, elevation) => {

    const altCf = altitudeCorrectionFactor(elevation);
    const Cs    = ASHRAE.SENSIBLE_FACTOR * altCf;
    const SEASONS_LIST = ['summer', 'monsoon', 'winter'];

    return rooms.map(room => {
      const envelope     = envelopes[room.id] || null;
      const ahu          = ahus.find(a => a.id === room.assignedAhuIds?.[0]) || {};
      const floorAreaFt2 = (parseFloat(room.floorArea) || 0) * M2_TO_FT2;
      const volumeFt3    = (parseFloat(room.volume)    || 0) * M3_TO_FT3;

      // ── Seasonal loads ──────────────────────────────────────────────────────
      const results = {};
      let summerCalcs = null;

      SEASONS_LIST.forEach(season => {
        const calcs = calculateSeasonLoad(
          room, envelope, climate, season, systemDesign,
          altCf, elevation, floorAreaFt2, volumeFt3
        );
        results[`ershOn_${season}`]  = calcs.ersh;
        results[`erlhOn_${season}`]  = calcs.erlh;
        results[`grains_${season}`]  = calcs.grains;

        // Equipment OFF: remove both sensible AND latent equipment contributions.
        results[`ershOff_${season}`] = Math.round(
          calcs.ersh - calcs.equipSens   * calcs.safetyMult
        );
        results[`erlhOff_${season}`] = Math.round(
          calcs.erlh - calcs.equipLatent * calcs.safetyMult
        );

        if (season === 'summer') summerCalcs = calcs;
      });

      // ── Summer peak & ADP-bypass model ─────────────────────────────────────
      const peakErsh = results['ershOn_summer'];
      const peakErlh = results['erlhOn_summer'];
      const dbInF    = summerCalcs?.dbInF ?? 72;
      const bf       = systemDesign.bypassFactor || 0.10;
      const adpF     = systemDesign.adp          || 55;
      const supplyDT = (1 - bf) * (dbInF - adpF);

      // ── BUG-03 FIX: enforce minimum ACPH for cleanroom classification ───────
      //
      // ASHRAE / ISO 14644 / GMP Annex 1 cleanroom air change requirements
      // MUST govern supply air volume when they exceed the thermal CFM.
      // Without this, a small well-insulated cleanroom would be supplied
      // only enough air to meet the heat load — far below the particle
      // dilution requirement for its ISO classification.
      //
      // minAcph is set per-room in roomSlice (default 10).
      // designAcph is the target ACPH — used here as a second floor check.
      //
      // Precedence (highest wins):
      //   1. designAcph minimum — classification compliance
      //   2. minAcph minimum    — absolute floor per ISO standard
      //   3. Thermal CFM        — heat load requirement
      //
      const minAcphCFM    = Math.round(volumeFt3 * (parseFloat(room.minAcph)    || 0) / 60);
      const designAcphCFM = Math.round(volumeFt3 * (parseFloat(room.designAcph) || 0) / 60);

      const thermalCFM = (supplyDT > 0 && peakErsh > 0)
        ? Math.ceil(peakErsh / (Cs * supplyDT))
        : 0;

      // Take the maximum of all three constraints.
      // supplyAir is the ACTUAL design supply air — governs everything downstream.
      const supplyAir = Math.max(thermalCFM, minAcphCFM, designAcphCFM);

      // Track which constraint governed — useful for the RDS report.
      const supplyAirGoverned =
        supplyAir === thermalCFM && thermalCFM > 0 ? 'thermal'
        : supplyAir === designAcphCFM             ? 'designAcph'
        :                                           'minAcph';

      // supplyAirMinAcph kept for display in the RDS fresh-air section
      const supplyAirMinAcph = minAcphCFM;

      // ── Fan heat & grand total ──────────────────────────────────────────────
      const fanHeatMult  = 1 + (systemDesign.fanHeat || 5) / 100;
      const grandTotal   = (peakErsh + peakErlh) * fanHeatMult;
      const coolingCapTR = (grandTotal / ASHRAE.BTU_PER_TON).toFixed(2);

      // ── ASHRAE 62.1 fresh air ───────────────────────────────────────────────
      const pplCount  = envelope?.internalLoads?.people?.count || 0;
      const freshAir  = Math.ceil(
        (ASHRAE.VENT_PEOPLE_CFM * pplCount) + (ASHRAE.VENT_AREA_CFM * floorAreaFt2)
      );

      // ── RSH & infiltration summary ──────────────────────────────────────────
      const rsh        = summerCalcs ? Math.round(summerCalcs.rawSensible) : 0;
      const totalInfil = summerCalcs ? Math.round(summerCalcs.infilCFM)   : 0;
      const totalExfil = totalInfil;

      // ── Fan heat breakdown ──────────────────────────────────────────────────
      const fanHeatBTU        = Math.max(0, grandTotal - (peakErsh + peakErlh));
      const supplyFanHeatBlow = Math.round(fanHeatBTU);
      const supplyFanHeatDraw = (fanHeatBTU / ASHRAE.KW_TO_BTU).toFixed(2);
      const returnFanHeat     = (0.02 * grandTotal / ASHRAE.KW_TO_BTU).toFixed(2);

      // ── Fresh air variants ──────────────────────────────────────────────────
      const fa25Acph          = Math.round(volumeFt3 * 2.5 / 60);
      const faAshraeAcph      = freshAir;
      const optimisedFreshAir = Math.max(freshAir, fa25Acph);
      const manualFA          = parseFloat(room.manualFreshAir) || 0;
      const freshAirCheck     = manualFA > 0 ? manualFA : optimisedFreshAir;
      const maxPurgeAir       = Math.round(volumeFt3 * 20 / 60);

      // ── BUG-10 FIX: exhaust air subtracted from return air ─────────────────
      //
      // ASHRAE mass balance for a pressurized room:
      //   Supply = Return + Exhaust_total + Net_exfiltration_through_envelope
      //
      // All three exhaust streams are stored in roomSlice.exhaustAir
      // but were previously never read here. Without this, return air is
      // overcalculated and duct sizing / pressurization data are wrong.
      //
      const exhaustGeneral = parseFloat(room.exhaustAir?.general) || 0;
      const exhaustBibo    = parseFloat(room.exhaustAir?.bibo)    || 0;
      const exhaustMachine = parseFloat(room.exhaustAir?.machine) || 0;
      const totalExhaust   = exhaustGeneral + exhaustBibo + exhaustMachine;

      // AHU air quantities — all now derived from the ACPH-governed supplyAir
      const coilAir   = Math.round(supplyAir * (1 - bf));
      const bypassAir = Math.round(supplyAir * bf);

      // Return air = supply minus fresh air minus all exhaust streams.
      // Clamped to 0 — cannot be negative (would imply more exhaust than supply,
      // which means the AHU supply air is undersized for the exhaust requirement).
      const returnAir = Math.max(0, supplyAir - freshAirCheck - totalExhaust);

      const ahuCap        = supplyAir;
      const coolingLoadHL = coolingCapTR;

      // ── BUG-05 FIX: ACES summary derived fields ────────────────────────────
      //
      // These were declared as readOnly/derived in RDSConfig but never computed.
      //
      // dehumidifiedAir: portion of supply air that passes through the cooling
      //   coil (i.e. not bypassed). In the ADP-bypass model this equals coilAir.
      //   ASHRAE: dehumidified air is the air that exits at near-ADP conditions;
      //   it is then mixed with bypass air to produce supply air at the desired
      //   supply DB and gr/lb.
      //
      // freshAirAces: fresh air quantity used in the ACES AHU summary context.
      //   We use freshAirCheck (which respects manual override if set).
      //
      // bleedAir: in a recirculating system, bleed air is the portion of return
      //   air exhausted to prevent CO2/contaminant buildup beyond fresh air alone.
      //   For cleanrooms with positive pressure and exhaust, this equals
      //   supply minus return minus fresh air, floored at 0.
      //
      const dehumidifiedAir = coilAir;
      const freshAirAces    = freshAirCheck;
      const bleedAir        = Math.max(0, supplyAir - returnAir - freshAirCheck);

      // CHW flow rate: GPM = BTU/hr / (500 × ΔT°F), ΔT = 10°F standard
      const chwFlowRate = grandTotal > 0 ? (grandTotal / 5000).toFixed(1) : '0.0';

      // ── Winter heating ──────────────────────────────────────────────────────
      const winterSensLoss  = Math.min(0, results['ershOn_winter'] || 0);
      const heatingCapBTU   = Math.abs(winterSensLoss);
      const heatingCap      = (heatingCapBTU / ASHRAE.KW_TO_BTU).toFixed(2);
      const hwFlowRate      = heatingCapBTU > 0 ? (heatingCapBTU / 10000).toFixed(1) : '0.0';
      const terminalHeatingCap = heatingCap;
      const extraHeatingCap    = (parseFloat(heatingCap) * 1.1).toFixed(2);

      // ── Room pick-up loads ──────────────────────────────────────────────────
      // ΔT rise imposed on supply air: Pickup = ERSH / (Cs × supplyAir)
      // supplyAir here is the ACPH-governed value — correct denominator.
      const pickupFields = {};
      SEASONS_LIST.forEach(s => {
        const e_on  = results[`ershOn_${s}`]  || 0;
        const e_off = results[`ershOff_${s}`] || 0;
        pickupFields[`pickupOn_${s}`]  = supplyAir > 0
          ? (e_on  / (Cs * supplyAir)).toFixed(1) : '0.0';
        pickupFields[`pickupOff_${s}`] = supplyAir > 0
          ? (e_off / (Cs * supplyAir)).toFixed(1) : '0.0';
      });

      // ── Achieved conditions (design setpoint for correctly sized system) ────
      const raRH = parseFloat(room.designRH) || 50;
      const achFields = {};
      SEASONS_LIST.forEach(s => {
        achFields[`achOn_temp_${s}`]      = dbInF.toFixed(1);
        achFields[`achOn_rh_${s}`]        = raRH.toFixed(1);
        achFields[`achOff_temp_${s}`]     = dbInF.toFixed(1);
        achFields[`achOff_rh_${s}`]       = raRH.toFixed(1);
        achFields[`achTermOn_temp_${s}`]  = dbInF.toFixed(1);
        achFields[`achTermOn_rh_${s}`]    = raRH.toFixed(1);
        achFields[`achTermOff_temp_${s}`] = dbInF.toFixed(1);
        achFields[`achTermOff_rh_${s}`]   = raRH.toFixed(1);
      });

      // ── Terminal heater loads ───────────────────────────────────────────────
      const termHeatFields = {};
      SEASONS_LIST.forEach(s => {
        const e_on  = results[`ershOn_${s}`]  || 0;
        const e_off = results[`ershOff_${s}`] || 0;
        termHeatFields[`termHeatOn_${s}`]  = e_on  < 0
          ? (Math.abs(e_on)  / ASHRAE.KW_TO_BTU).toFixed(2) : '0.00';
        termHeatFields[`termHeatOff_${s}`] = e_off < 0
          ? (Math.abs(e_off) / ASHRAE.KW_TO_BTU).toFixed(2) : '0.00';
      });

      // ── Psychrometric state points ──────────────────────────────────────────
      const psychroFields = {};
      const grADP = calculateGrains(adpF, 100, elevation);
      const raGr  = calculateGrains(dbInF, raRH, elevation);

      SEASONS_LIST.forEach(s => {
        const out   = climate.outside[s] || {};
        const ambDB = parseFloat(out.db) || 0;
        const ambRH = parseFloat(out.rh) || 0;

        // BUG-19 FIX: recalculate ambient gr at site elevation.
        // Previously used the sea-level cached out.gr — wrong at altitude.
        // This makes the psychro diagram consistent with the load calculations
        // which already use elevation-corrected grains.
        const ambGr   = calculateGrains(ambDB, ambRH, elevation);
        const ambWB   = calculateWetBulb(ambDB, ambRH);
        const ambEnth = calculateEnthalpy(ambDB, ambGr);

        // Ambient
        psychroFields[`amb_db_${s}`]   = ambDB.toFixed(1);
        psychroFields[`amb_wb_${s}`]   = ambWB.toFixed(1);
        psychroFields[`amb_gr_${s}`]   = ambGr.toFixed(1);
        psychroFields[`amb_enth_${s}`] = ambEnth.toFixed(2);

        // Fresh air = ambient (no pre-treatment assumed)
        psychroFields[`fa_db_${s}`]   = ambDB.toFixed(1);
        psychroFields[`fa_wb_${s}`]   = ambWB.toFixed(1);
        psychroFields[`fa_gr_${s}`]   = ambGr.toFixed(1);
        psychroFields[`fa_enth_${s}`] = ambEnth.toFixed(2);

        // Return air = room design setpoint
        const raWB = calculateWetBulb(dbInF, raRH);
        psychroFields[`ra_db_${s}`] = dbInF.toFixed(1);
        psychroFields[`ra_wb_${s}`] = raWB.toFixed(1);
        psychroFields[`ra_gr_${s}`] = raGr.toFixed(1);

        // Supply air = coil leaving + bypass (ADP-bypass model)
        const saDB   = adpF    * (1 - bf) + dbInF * bf;
        const saGr   = grADP   * (1 - bf) + raGr  * bf;
        const saRH   = rhFromGrains(saGr, saDB, elevation);
        const saWB   = calculateWetBulb(saDB, saRH);
        const saEnth = calculateEnthalpy(saDB, saGr);

        psychroFields[`sa_db_${s}`]   = saDB.toFixed(1);
        psychroFields[`sa_wb_${s}`]   = saWB.toFixed(1);
        psychroFields[`sa_gr_${s}`]   = saGr.toFixed(1);
        psychroFields[`sa_enth_${s}`] = saEnth.toFixed(2);

        // Mixed air = return + fresh blended by CFM fraction
        const totalCFM = Math.max(1, supplyAir);
        const faCFM    = freshAirCheck;
        const raCFM    = Math.max(0, totalCFM - faCFM);
        const maDB     = (raCFM * dbInF  + faCFM * ambDB) / totalCFM;
        const maGr     = (raCFM * raGr   + faCFM * ambGr) / totalCFM;
        const maRH     = rhFromGrains(maGr, maDB, elevation);
        const maWB     = calculateWetBulb(maDB, maRH);
        const maEnth   = calculateEnthalpy(maDB, maGr);

        psychroFields[`ma_db_${s}`]   = maDB.toFixed(1);
        psychroFields[`ma_wb_${s}`]   = maWB.toFixed(1);
        psychroFields[`ma_gr_${s}`]   = maGr.toFixed(1);
        psychroFields[`ma_enth_${s}`] = maEnth.toFixed(2);

        // Coil leaving = saturated at ADP
        const clEnth = calculateEnthalpy(adpF, grADP);
        psychroFields[`coilLeave_db_${s}`]   = adpF.toFixed(1);
        psychroFields[`coilLeave_wb_${s}`]   = adpF.toFixed(1);
        psychroFields[`coilLeave_gr_${s}`]   = grADP.toFixed(1);
        psychroFields[`coilLeave_enth_${s}`] = clEnth.toFixed(2);
      });

      return {
        ...room,
        id:         room.id,
        ahuId:      ahu.id   || '',
        typeOfUnit: ahu.type || '-',
        people_count: envelope?.internalLoads?.people?.count  || 0,
        equipment_kw: envelope?.internalLoads?.equipment?.kw  || 0,

        // Core outputs
        supplyAir,
        supplyAirGoverned,   // 'thermal' | 'designAcph' | 'minAcph'
        thermalCFM,          // pure heat-load CFM before ACPH enforcement
        coolingCapTR,
        grandTotal: Math.round(grandTotal),
        freshAir,

        // Infiltration / RSH
        rsh,
        totalInfil,
        totalExfil,

        // Fan heat
        supplyFanHeatBlow,
        supplyFanHeatDraw,
        returnFanHeat,

        // Fresh air variants
        fa25Acph,
        faAshraeAcph,
        optimisedFreshAir,
        freshAirCheck,
        maxPurgeAir,
        supplyAirMinAcph,

        // Exhaust
        totalExhaust,
        exhaustGeneral,
        exhaustBibo,
        exhaustMachine,

        // AHU air quantities
        coilAir,
        bypassAir,
        returnAir,
        dehumidifiedAir,   // BUG-05 FIX
        freshAirAces,      // BUG-05 FIX
        bleedAir,          // BUG-05 FIX
        ahuCap,
        coolingLoadHL,
        chwFlowRate,

        // Heating
        heatingCap,
        hwFlowRate,
        terminalHeatingCap,
        extraHeatingCap,

        // Seasonal load results
        ...results,

        // Derived seasonal results
        ...pickupFields,
        ...achFields,
        ...termHeatFields,
        ...psychroFields,

        _raw: { room, envelope, ahu },
      };
    });
  }
);