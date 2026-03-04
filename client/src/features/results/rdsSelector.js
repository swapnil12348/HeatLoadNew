// src/features/results/rdsSelector.js
import { createSelector } from '@reduxjs/toolkit';
import { calculateGrains } from '../../utils/psychro';
import ASHRAE from '../../constants/ashrae';
import { calcTotalEnvelopeGain } from '../../utils/envelopeCalc';

// ── Input selectors ──────────────────────────────────────────────────────────
const selectRooms = (state) => state.room.list;
const selectEnvelopes = (state) => state.envelope.byRoomId;
const selectAhus = (state) => state.ahu.list;
const selectClimate = (state) => state.climate;
const selectSystemDesign = (state) => state.project.systemDesign; // ← NEW

// ── Per-season load calculator ───────────────────────────────────────────────
const calculateSeasonLoad = (room, envelope, climate, season, systemDesign) => {
  const env = envelope || { internalLoads: {}, infiltration: {} };
  const int = env.internalLoads || {};
  const inf = env.infiltration || {};

  // Outdoor conditions
  const outdoor = climate?.outside?.[season] || { db: 95, wb: 75 };
  const dbOut = parseFloat(outdoor.db) || 95;
  const grOut = parseFloat(outdoor.gr) || calculateGrains(dbOut, parseFloat(outdoor.wb) || 75);

  // Indoor (from room design targets)
  const dbIn = parseFloat(room.designTemp) || 75;
  const rhIn = parseFloat(room.designRH) || 50;
  const grIn = calculateGrains(dbIn, rhIn);

  const floorArea = parseFloat(room.floorArea) || 0;
  const envelopeGain = calcTotalEnvelopeGain(env.elements, climate, dbIn, season);

  const vol = parseFloat(room.volume) || 0;

  // ── Sensible loads ─────────────────────────────────────────────────────────
  const pplCount = parseFloat(int.people?.count) || 0;
  const pplSens = pplCount * (int.people?.sensiblePerPerson || ASHRAE.PEOPLE_SENSIBLE_SEATED);
  const lightsSens = (parseFloat(int.lights?.wattsPerSqFt) || 0) * floorArea * ASHRAE.BTU_PER_WATT;
  const equipSens = (parseFloat(int.equipment?.kw) || 0) * ASHRAE.KW_TO_BTU;

  // Infiltration via ACH method
  const infilCFM = (vol * (parseFloat(inf.achValue) || 0)) / 60;
  const infilSens = 1.08 * infilCFM * (dbOut - dbIn);

  const rawSensible = envelopeGain + pplSens + lightsSens + equipSens + infilSens;

  // ── Latent loads ───────────────────────────────────────────────────────────
  const pplLat = pplCount * (int.people?.latentPerPerson || ASHRAE.PEOPLE_LATENT_SEATED);
  const infilLat = 0.68 * infilCFM * (grOut - grIn);

  const rawLatent = pplLat + infilLat;

  // ── Apply safety factor from project settings ──────────────────────────────
  const safetyMult = 1 + (systemDesign.safetyFactor || 10) / 100; // ← was hardcoded 1.10
  const ersh = Math.round(rawSensible * safetyMult);
  const erlh = Math.round(rawLatent * safetyMult);

  return { ersh, erlh, grains: grIn.toFixed(1), dbIn, grIn };
};

// ── Main selector ────────────────────────────────────────────────────────────
export const selectRdsData = createSelector(
  [selectRooms, selectEnvelopes, selectAhus, selectClimate, selectSystemDesign], // ← added
  (rooms, envelopes, ahus, climate, systemDesign) => {

    return rooms.map(room => {
      const envelope = envelopes[room.id] || null;
      const ahu = ahus.find(a => a.id === room.assignedAhuIds?.[0]) || {};

      const seasons = ['summer', 'monsoon', 'winter'];
      const results = {};

      seasons.forEach(season => {
        const calcs = calculateSeasonLoad(room, envelope, climate, season, systemDesign); // ← passed in
        results[`ershOn_${season}`] = calcs.ersh;
        results[`erlhOn_${season}`] = calcs.erlh;
        results[`grains_${season}`] = calcs.grains;

        // Equipment OFF: subtract equipment sensible (re-derived cleanly)
        const env = envelope?.internalLoads || {};
        const equipSens = (parseFloat(env.equipment?.kw) || 0) * ASHRAE.KW_TO_BTU;
        const safetyMult = 1 + (systemDesign.safetyFactor || 10) / 100;
        results[`ershOff_${season}`] = Math.round((calcs.ersh - equipSens * safetyMult));
      });

      // ── Supply air: proper psychrometric formula ─────────────────────────
      // ΔT_supply = (1 - BF) × (dbIn - ADP)
      const peakErsh = results['ershOn_summer'];
      const dbIn = parseFloat(room.designTemp) || 75;
      const bf = systemDesign.bypassFactor || 0.10; // ← from project
      const adp = systemDesign.adp || 55;   // ← from project
      const supplyDT = (1 - bf) * (dbIn - adp);            // ← was hardcoded 20°F

      const supplyAir = (supplyDT > 0 && peakErsh > 0)
        ? Math.ceil(peakErsh / (1.08 * supplyDT))
        : 0;

      // ── Cooling capacity: proper grand total ─────────────────────────────
      // grandTotal = (ERSH + ERLH) × (1 + fanHeat%)
      const peakErlh = results['erlhOn_summer'];
      const fanHeatMult = 1 + (systemDesign.fanHeat || 5) / 100; // ← from project
      const grandTotal = (peakErsh + peakErlh) * fanHeatMult;
      const coolingCapTR = (grandTotal / 12000).toFixed(2);       // ← was supplyAir * 0.0025

      return {
        ...room,
        id: room.id,
        ahuId: ahu.id || '',
        typeOfUnit: ahu.type || '-',

        // Flattened envelope data for table display
        people_count: envelope?.internalLoads?.people?.count || 0,
        equipment_kw: envelope?.internalLoads?.equipment?.kw || 0,

        // Calculated results
        supplyAir,
        coolingCapTR,
        grandTotal: Math.round(grandTotal),
        ...results,

        // Raw reference for RoomDetailPanel
        _raw: { room, envelope, ahu }
      };
    });
  }
);