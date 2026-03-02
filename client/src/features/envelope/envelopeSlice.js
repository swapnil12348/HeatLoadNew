import { createSlice, createSelector } from '@reduxjs/toolkit';
import ASHRAE from '../../constants/ashrae';

// Initial Template for a new room's envelope/load data
const createRoomData = () => ({
  infiltration: { doors: [] },
  elements: {
    glass: [],
    walls: [],
    roof: [],
    ceiling: [],
    floor: [],
    partitions: []
  },
  internalLoads: {
    people: { count: 0, sensiblePerPerson: 245, latentPerPerson: 205 },
    lights: { wattsPerSqFt: 0 },
    equipment: { kw: 0 }
  }
});

const initialState = {
  // Data is now keyed by roomId
  // Example: { "room_default_1": { ...data } }
  byRoomId: {
    "room_default_1": createRoomData()
  }
};

const envelopeSlice = createSlice({
  name: 'envelope',
  initialState,
  reducers: {
    // ── Helper: Ensure room entry exists (called when active room changes or first load)
    initializeRoom: (state, action) => {
      const roomId = action.payload;
      if (!state.byRoomId[roomId]) {
        state.byRoomId[roomId] = createRoomData();
      }
    },

    // ── Infiltration Actions (Require roomId) ──
    addDoor: (state, action) => {
      const { roomId } = action.payload;
      if (!state.byRoomId[roomId]) state.byRoomId[roomId] = createRoomData();
      
      state.byRoomId[roomId].infiltration.doors.push({
        id: Date.now(),
        thru: "Door", nos: 1, area: 20, width: 3, height: 7, infilCFM: 0, exfilCFM: 0,
      });
    },
    updateDoor: (state, action) => {
      const { roomId, id, field, value } = action.payload;
      const door = state.byRoomId[roomId]?.infiltration.doors.find(d => d.id === id);
      if (door) door[field] = value;
    },
    removeDoor: (state, action) => {
      const { roomId, id } = action.payload;
      const roomData = state.byRoomId[roomId];
      if (roomData) {
        roomData.infiltration.doors = roomData.infiltration.doors.filter(d => d.id !== id);
      }
    },

    // ── Envelope Element Actions (Require roomId) ──
    addElementRow: (state, action) => {
      const { roomId, category, newItem } = action.payload;
      if (!state.byRoomId[roomId]) state.byRoomId[roomId] = createRoomData();
      state.byRoomId[roomId].elements[category].push(newItem);
    },
    updateElementRow: (state, action) => {
      const { roomId, category, id, field, value } = action.payload;
      const item = state.byRoomId[roomId]?.elements[category]?.find(i => i.id === id);
      if (item) {
        if (field === 'diff') item.diff = { ...item.diff, ...value };
        else item[field] = value;
      }
    },
    deleteElementRow: (state, action) => {
      const { roomId, category, id } = action.payload;
      if (state.byRoomId[roomId]) {
        state.byRoomId[roomId].elements[category] = state.byRoomId[roomId].elements[category].filter(i => i.id !== id);
      }
    },

    // ── Internal Load Actions (Require roomId) ──
    updateInternalLoad: (state, action) => {
      const { roomId, type, data } = action.payload;
      if (!state.byRoomId[roomId]) state.byRoomId[roomId] = createRoomData();
      
      if (state.byRoomId[roomId].internalLoads[type]) {
        state.byRoomId[roomId].internalLoads[type] = { 
          ...state.byRoomId[roomId].internalLoads[type], 
          ...data 
        };
      }
    }
  }
});

export const { 
  initializeRoom,
  addDoor, updateDoor, removeDoor, 
  addElementRow, updateElementRow, deleteElementRow, 
  updateInternalLoad 
} = envelopeSlice.actions;

// ── Selectors (Context-Aware) ───────────────────────────────────────────────

// Selects the envelope data ONLY for the currently Active Room
// This keeps the UI clean (it doesn't need to know about other rooms)
export const selectActiveRoomEnvelope = createSelector(
  [
    (state) => state.envelope.byRoomId,
    (state) => state.room.activeRoomId
  ],
  (byRoomId, activeRoomId) => {
    return byRoomId[activeRoomId] || createRoomData();
  }
);

// We'll need a new selector here for Results later, but for now, the UI needs this:
export const selectActiveRoomHeatGain = createSelector(
  [selectActiveRoomEnvelope, (state) => state.room.list.find(r => r.id === state.room.activeRoomId)],
  (envelope, room) => {
    const { elements, internalLoads } = envelope;
    const floorArea = parseFloat(room?.floorArea) || 0;

    let s = 0, m = 0, w = 0; // Summer, Monsoon, Winter Sensible
    let lightsBtu = 0, equipBtu = 0, pplSens = 0, pplLat = 0;

    // 1. Envelope
    Object.keys(elements).forEach(cat => {
      elements[cat].forEach(item => {
        const q = (parseFloat(item.area) || 0) * (parseFloat(item.uValue) || 0);
        s += q * (item.diff?.summer || 0);
        m += q * (item.diff?.monsoon || 0);
        w += q * (item.diff?.winter || 0);
      });
    });

    // 2. Internals
    const pplCount = parseFloat(internalLoads.people?.count) || 0;
    pplSens = pplCount * (parseFloat(internalLoads.people?.sensiblePerPerson) || 0);
    pplLat = pplCount * (parseFloat(internalLoads.people?.latentPerPerson) || 0);
    
    lightsBtu = floorArea * (parseFloat(internalLoads.lights?.wattsPerSqFt) || 0) * ASHRAE.BTU_PER_WATT;
    equipBtu = (parseFloat(internalLoads.equipment?.kw) || 0) * ASHRAE.KW_TO_BTU;

    const internalSensible = pplSens + lightsBtu + equipBtu;

    return {
      totals: { 
        summer: Math.round(s + internalSensible), 
        monsoon: Math.round(m + internalSensible), 
        winter: Math.round(w + internalSensible) 
      },
      details: { lightsBtu, equipBtu, pplSens, pplLat }
    };
  }
);

export default envelopeSlice.reducer;