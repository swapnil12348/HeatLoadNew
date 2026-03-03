import { createSelector } from '@reduxjs/toolkit';
import { calculateGrains } from '../../utils/psychro';

// ── Slice Selectors ────────────────────────────────────────────────────────
const selectRooms = (state) => state.room.list;
const selectEnvelopes = (state) => state.envelope.byRoomId;
const selectAhus = (state) => state.ahu.list;
const selectClimate = (state) => state.climate || {}; // Fallback if not set
const selectProjectParams = (state) => state.project || {}; // Safe factors, etc.

// ── Helper: Calculation Core (The Math) ────────────────────────────────────
const calculateSeasonLoad = (room, envelope, climateData, seasonName, isEquipOn) => {
  // 1. SAFETY: Check for envelope to prevent crash on new rooms
  if (!envelope) return { ersh: 0, erlh: 0, pickup: 0, roomGrains: 0 };

  const floorArea = room.floorArea || 0;
  
  // Climate Data
  const ambientDB = climateData?.[seasonName]?.db || 95;
  // Use psychro util to get ambient Grains if not provided, or assume 100
  const ambientGr = climateData?.[seasonName]?.gr || 100; 

  const roomDB = parseFloat(room.designTemp) || 72;
  const roomRH = parseFloat(room.designRH) || 50;
  
  // 2. CALCULATE ROOM GRAINS (Physics!)
  const roomGr = calculateGrains(roomDB, roomRH);

  // 3. Internal Loads
  const peopleSens = (envelope.internalLoads?.people?.count || 0) * 245; 
  const peopleLat = (envelope.internalLoads?.people?.count || 0) * 205; 
  const lights = (envelope.internalLoads?.lights?.wattsPerSqFt || 0) * floorArea * 3.412;
  
  let equipmentSens = 0;
  if (isEquipOn) {
    const equipKW = envelope.internalLoads?.equipment?.kw || 0;
    equipmentSens = equipKW * 3412; 
  }

  // 4. Infiltration (Sensible + Latent)
  const acph = envelope.infiltration?.achValue || 0; 
  const infilCFM = (room.volume * acph) / 60;
  
  const infilSens = 1.08 * infilCFM * (ambientDB - roomDB);
  // Latent Load Formula: Q = 0.68 * CFM * DeltaGrains
  const infilLat = 0.68 * infilCFM * (ambientGr - roomGr); 

  // 5. Totals
  const safetyFactor = 1.10; // 10% safety
  const rsh = (peopleSens + lights + equipmentSens + infilSens) * safetyFactor;
  const rlh = (peopleLat + infilLat) * safetyFactor;

  return {
    ersh: Math.round(rsh),
    erlh: Math.round(rlh),
    pickup: 0, 
    roomGrains: roomGr.toFixed(1), // Return calculated grains
  };
};

// ── Main Selector ──────────────────────────────────────────────────────────
export const selectRdsData = createSelector(
  [selectRooms, selectEnvelopes, selectAhus, selectClimate, selectProjectParams],
  (rooms, envelopes, ahus, climate, project) => {
    
    return rooms.map(room => {
      // 1. Get Associated Data
      const envelope = envelopes[room.id] || { internalLoads: {}, infiltration: {} };
      const ahu = ahus.find(a => a.id === room.assignedAhuIds?.[0]) || {};

      // 2. Calculate Geometry Columns
      const area = room.floorArea;
      const volume = room.volume;

      // 3. Calculate Loads for All Seasons (ON & OFF Modes)
      const seasons = ['Summer', 'Monsoon', 'Winter'];
      
      const calcResults = {};

      seasons.forEach(season => {
        const seasonKey = season.toLowerCase(); // summer, monsoon, winter
        
        // Calculate Equipment ON
        const resOn = calculateSeasonLoad(room, envelope, climate, seasonKey, true);
        calcResults[`ershOn_${season}`] = resOn.ersh;
        calcResults[`pickupOn_${season}`] = resOn.pickup;

        // Calculate Equipment OFF
        const resOff = calculateSeasonLoad(room, envelope, climate, seasonKey, false);
        calcResults[`ershOff_${season}`] = resOff.ersh;
        calcResults[`pickupOff_${season}`] = resOff.pickup;
      });

      // 4. Calculate Airflow (Example: Max of RSH calculation)
      // Taking Summer RSH / (1.08 * dT) as rough sizing
      const supplyAir = Math.round(calcResults['ershOn_Summer'] / (1.08 * 20)) || 0; // Assuming 20F delta T
      const coolingCapTR = (supplyAir * 0.0025); // Rough tonnage est

      // 5. Return The Flattened Object (Matching RDSConfig keys)
      return {
        // Identity
        id: room.id,
        index: room.id, // Row ID
        ahuId: room.assignedAhuIds?.[0] || "",
        typeOfUnit: ahu.type || "-",
        roomNo: room.roomNo,
        name: room.name,
        
        // Geometry
        length: room.length,
        width: room.width,
        height: room.height,
        floorArea: area,
        volume: volume,
        volFaPct: 0, 

        // Design
        designTemp: room.designTemp,
        designRH: room.designRH,
        pressure: room.pressure,

        // Classification
        atRestClass: room.atRestClass,
        recOt: room.recOt,
        flpType: room.flpType,

        // Internal Loads (Direct mapping from envelope slice)
        people_count: envelope.internalLoads?.people?.count || 0,
        equipment_kw: envelope.internalLoads?.equipment?.kw || 0,

        // Infiltration
        totalInfil: 0, // Need full infiltration logic
        totalExfil: 0,
        
        // Exhausts
        'exhaustAir.general': room.exhaustAir?.general || 0,
        'exhaustAir.bibo': room.exhaustAir?.bibo || 0,
        'exhaustAir.machine': room.exhaustAir?.machine || 0,

        // Calculated Airflow Results
        supplyAir: supplyAir,
        freshAir: Math.round(area * 0.1), // Placeholder rule
        coolingCapTR: coolingCapTR.toFixed(2),
        
        // Spread the calculated season data (ershOn_Summer, etc.)
        ...calcResults,
        
        // Pass the raw object for debugging/advanced usage
        _raw: { room, envelope, ahu }
      };
    });
  }
);