// src/features/results/rdsSelector.js
import { createSelector } from '@reduxjs/toolkit';
import { calculateGrains } from '../../utils/psychro';
import ASHRAE from '../../constants/ashrae';

// 1. Select raw data from all slices
const selectRooms = (state) => state.room.list;
const selectEnvelopes = (state) => state.envelope.byRoomId;
const selectAhus = (state) => state.ahu.list;
const selectClimate = (state) => state.climate;

// 2. Helper: Calculate loads for a specific season
const calculateSeasonLoad = (room, envelope, climate, season) => {
  // Defaults to prevent crashes if data is missing
  const env = envelope || { internalLoads: {}, infiltration: {} };
  const int = env.internalLoads || {};
  const inf = env.infiltration || {};
  
  // Climate Data
  const outdoor = climate?.outside?.[season] || { db: 95, wb: 75 };
  const dbOut = parseFloat(outdoor.db) || 95;
  const grOut = parseFloat(outdoor.gr) || calculateGrains(dbOut, parseFloat(outdoor.wb) || 75);

  // Room Design Data
  const dbIn = parseFloat(room.designTemp) || 75;
  const rhIn = parseFloat(room.designRH) || 50;
  const grIn = calculateGrains(dbIn, rhIn);

  // --- SENSIBLE LOADS (BTU/hr) ---
  // 1. People
  const pplCount = parseFloat(int.people?.count) || 0;
  const pplSens = pplCount * (int.people?.sensiblePerPerson || ASHRAE.PEOPLE_SENSIBLE_SEATED);

  // 2. Lights (Watts * 3.412)
  const floorArea = parseFloat(room.floorArea) || 0;
  const lightsSens = (parseFloat(int.lights?.wattsPerSqFt) || 0) * floorArea * ASHRAE.BTU_PER_WATT;

  // 3. Equipment (KW * 3412)
  const equipSens = (parseFloat(int.equipment?.kw) || 0) * ASHRAE.KW_TO_BTU;

  // 4. Infiltration (1.08 * CFM * dT)
  const vol = parseFloat(room.volume) || 0;
  const ach = parseFloat(inf.achValue) || 0;
  const infilCFM = (vol * ach) / 60;
  const infilSens = 1.08 * infilCFM * (dbOut - dbIn);

  // Total Sensible
  const rsh = (pplSens + lightsSens + equipSens + infilSens) * 1.10; // 10% Safety

  // --- LATENT LOADS (BTU/hr) ---
  const pplLat = pplCount * (int.people?.latentPerPerson || ASHRAE.PEOPLE_LATENT_SEATED);
  const infilLat = 0.68 * infilCFM * (grOut - grIn);
  
  const rlh = (pplLat + infilLat) * 1.10; // 10% Safety

  return {
    ersh: Math.round(rsh),
    erlh: Math.round(rlh),
    grains: grIn.toFixed(1)
  };
};

// 3. The Main Selector
export const selectRdsData = createSelector(
  [selectRooms, selectEnvelopes, selectAhus, selectClimate],
  (rooms, envelopes, ahus, climate) => {
    
    return rooms.map(room => {
      // Find related data
      const envelope = envelopes[room.id]; // Might be undefined!
      const ahu = ahus.find(a => a.id === room.assignedAhuIds?.[0]) || {};
      
      const seasons = ['summer', 'monsoon', 'winter'];
      const results = {};

      // Run calc for every season
      seasons.forEach(season => {
        const calcs = calculateSeasonLoad(room, envelope, climate, season);
        results[`ershOn_${season}`] = calcs.ersh;
        results[`erlhOn_${season}`] = calcs.erlh;
        results[`grains_${season}`] = calcs.grains;
        
        // Simulating "Off" as same as On minus equipment for this example
        results[`ershOff_${season}`] = Math.round(calcs.ersh * 0.8); 
      });

      // Calculate Supply Air based on Peak Summer Sensible
      const peakSensible = results['ershOn_summer'];
      // Formula: CFM = Q / (1.08 * dT) -> assuming 20F delta T (55F supply)
      const supplyAir = peakSensible > 0 ? Math.ceil(peakSensible / (1.08 * 20)) : 0;
      const coolingCapTR = (supplyAir * 0.0025).toFixed(2); // Rule of thumb approx

      // Flatten everything into one object for the table
      return {
        ...room,
        id: room.id,
        ahuId: ahu.id || '',
        typeOfUnit: ahu.type || '-',
        
        // Flatten Envelope Data for direct table access
        people_count: envelope?.internalLoads?.people?.count || 0,
        equipment_kw: envelope?.internalLoads?.equipment?.kw || 0,
        
        // Calculated Results
        supplyAir,
        coolingCapTR,
        ...results,
        
        // Keep raw ref if needed
        _raw: { room, envelope, ahu }
      };
    });
  }
);