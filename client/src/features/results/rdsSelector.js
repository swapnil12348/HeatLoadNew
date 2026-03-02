import { createSelector } from '@reduxjs/toolkit';
import { calculateRoomLoad } from '../../utils/hvacMath';

// Select all raw data
const selectAllRooms = (state) => state.room.list;
const selectAllEnvelopes = (state) => state.envelope.byRoomId;
const selectAllAhus = (state) => state.ahus.list;
const selectClimate = (state) => state.climate;
const selectTuning = (state) => state.results.tuning;

export const selectRdsData = createSelector(
  [selectAllRooms, selectAllEnvelopes, selectAllAhus, selectClimate, selectTuning],
  (rooms, envelopes, ahus, climate, tuning) => {
    
    return rooms.map(room => {
      // 1. Find Data for this room
      const envelope = envelopes[room.id] || { elements: {}, internalLoads: {}, infiltration: { doors: [] }};
      
      // 2. Find Assigned AHU (Primary)
      const primaryAhuId = room.assignedAhuIds?.[0];
      const ahu = ahus.find(a => a.id === primaryAhuId) || { name: 'Unassigned', designScheme: '-' };

      // 3. Run Calculations
      const calc = calculateRoomLoad(room, envelope, climate, tuning) || {};

      // 4. Return Flat Object for Table
      return {
        id: room.id,
        // System Info
        ahuName: ahu.name,
        unitType: ahu.designScheme,
        
        // Room Info
        roomName: room.name,
        roomNo: room.id.split('_').pop(), // Simple ID extract
        length: room.length,
        width: room.width,
        height: room.height,
        area: room.floorArea,
        volume: room.volume,
        pressure: room.pressure,
        
        // Design Conditions
        temp: climate.inside.db,
        rh: climate.inside.rh,
        iso: ahu.isoClass || "N/A",
        
        // Internals
        occupancy: envelope.internalLoads?.people?.count || 0,
        equipmentKW: envelope.internalLoads?.equipment?.kw || 0,
        lightingW: envelope.internalLoads?.lights?.wattsPerSqFt || 0,
        
        // Loads
        rsh: Math.round(calc.ersh || 0),
        rlh: Math.round(calc.erlh || 0),
        totalHeat: Math.round(calc.grandTotal || 0),
        tonnage: (calc.tonnage || 0).toFixed(2),
        
        // Airflow
        supplyCFM: calc.supplyAir || 0,
        freshAirCFM: calc.freshAir || 0,
        acph: (calc.acph || 0).toFixed(1)
      };
    });
  }
);