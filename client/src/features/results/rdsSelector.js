import { createSelector } from '@reduxjs/toolkit';
import { calculateGrains } from '../../utils/psychro';

// ── Slice Selectors ────────────────────────────────────────────────────────
const selectRooms = (state) => state.room.list;
const selectEnvelopes = (state) => state.envelope.byRoomId;
const selectAhus = (state) => state.ahu.list;
const selectClimate = (state) => state.climate || {};
const selectProjectParams = (state) => state.project || {};

// ── Helper: Calculation Core ───────────────────────────────────────────────
const calculateSeasonLoad = (room, envelope, climateData, seasonName, isEquipOn) => {
  // 1. Defaults
  // If envelope is missing (Ghost Room), default to empty object to prevent crash
  const env = envelope || { internalLoads: {}, infiltration: {} };
  
  const safetyFactor = 1.10; // 10% Safety
  const floorArea = room.floorArea || 0;
  
  // 2. Climate Setup
  // key is already lowercase from the loop below
  const amb = climateData?.outside?.[seasonName] || { db: 95, wb: 75, gr: 100 };
  const ambientDB = parseFloat(amb.db);
  
  // Calculate Ambient Grains if not present in state, otherwise use state or default
  // Ideally, use psychro util here if 'gr' isn't explicitly stored
  const ambientGr = parseFloat(amb.gr) || calculateGrains(ambientDB, parseFloat(amb.wb) || 75); 

  const roomDB = parseFloat(room.designTemp) || 75; // Default 75F
  const roomRH = parseFloat(room.designRH) || 50;   // Default 50%
  
  // 3. Physics: Calculate Room Grains
  const roomGr = calculateGrains(roomDB, roomRH);

  // 4. Internal Loads
  const peopleCount = env.internalLoads?.people?.count || 0;
  const peopleSens = peopleCount * (env.internalLoads?.people?.sensiblePerPerson || 245);
  const peopleLat = peopleCount * (env.internalLoads?.people?.latentPerPerson || 205);
  
  const lights = (env.internalLoads?.lights?.wattsPerSqFt || 0) * floorArea * 3.412;
  
  let equipmentSens = 0;
  if (isEquipOn) {
    const equipKW = env.internalLoads?.equipment?.kw || 0;
    equipmentSens = equipKW * 3412; 
  }

  // 5. Infiltration
  const ach = env.infiltration?.achValue || 0; 
  const roomVol = room.volume || 0;
  const infilCFM = (roomVol * ach) / 60;
  
  // Sensible: 1.08 * CFM * dT
  const infilSens = 1.08 * infilCFM * (ambientDB - roomDB);
  
  // Latent: 0.68 * CFM * dGr
  const infilLat = 0.68 * infilCFM * (ambientGr - roomGr); 

  // 6. Totals
  const rsh = (peopleSens + lights + equipmentSens + infilSens) * safetyFactor;
  const rlh = (peopleLat + infilLat) * safetyFactor;

  return {
    ersh: Math.round(rsh),
    erlh: Math.round(rlh),
    pickup: 0, 
    roomGrains: roomGr.toFixed(1),
  };
};

// ── Main Selector ──────────────────────────────────────────────────────────
export const selectRdsData = createSelector(
  [selectRooms, selectEnvelopes, selectAhus, selectClimate, selectProjectParams],
  (rooms, envelopes, ahus, climate, project) => {
    
    return rooms.map(room => {
      // Get associated envelope or use empty default
      const envelope = envelopes[room.id] || { internalLoads: {}, infiltration: {} };
      const ahu = ahus.find(a => a.id === room.assignedAhuIds?.[0]) || {};

      const area = room.floorArea;
      const volume = room.volume;

      // 🚨 CRITICAL FIX: Use lowercase keys to match RDSConfig
      const seasons = ['summer', 'monsoon', 'winter']; 
      
      const calcResults = {};

      seasons.forEach(seasonKey => {
        // Calculate Equipment ON
        const resOn = calculateSeasonLoad(room, envelope, climate, seasonKey, true);
        
        // Dynamic keys: ershOn_summer, ershOn_winter ...
        calcResults[`ershOn_${seasonKey}`] = resOn.ersh;
        calcResults[`erlhOn_${seasonKey}`] = resOn.erlh;
        calcResults[`pickupOn_${seasonKey}`] = resOn.pickup;
        calcResults[`grains_${seasonKey}`] = resOn.roomGrains; // Fix for Room Grains column

        // Calculate Equipment OFF
        const resOff = calculateSeasonLoad(room, envelope, climate, seasonKey, false);
        calcResults[`ershOff_${seasonKey}`] = resOff.ersh;
        calcResults[`pickupOff_${seasonKey}`] = resOff.pickup;
      });

      // Airflow Estimate (Summer Peak)
      const peakSensible = calcResults['ershOn_summer'] || 0;
      const supplyAir = peakSensible > 0 ? Math.round(peakSensible / (1.08 * 20)) : 0; // 20F delta T
      const coolingCapTR = (supplyAir * 0.0025); 

      return {
        ...room, // Spread raw room data first (id, name, etc)
        
        // Overwrite/Add Calculated Fields
        id: room.id,
        index: room.id,
        ahuId: room.assignedAhuIds?.[0] || "",
        typeOfUnit: ahu.type || "-",
        
        // Loads
        people_count: envelope.internalLoads?.people?.count || 0,
        equipment_kw: envelope.internalLoads?.equipment?.kw || 0,
        
        // Calculated Results
        supplyAir: supplyAir,
        freshAir: Math.round(area * 0.1),
        coolingCapTR: coolingCapTR.toFixed(2),
        
        // Spread the calculated season data
        ...calcResults,
        
        _raw: { room, envelope, ahu }
      };
    });
  }
);