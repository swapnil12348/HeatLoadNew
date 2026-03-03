import { createSlice } from '@reduxjs/toolkit';

// ── Default State Factory ────────────────────────────────────────────────────
// Creates a fresh envelope structure for a new room
const createRoomEnvelope = () => ({
  elements: {
    walls: [],
    roofs: [],
    glass: [],
    skylights: [],
    partitions: [],
    floors: []
  },
  internalLoads: {
    people: { count: 0, sensiblePerPerson: 245, latentPerPerson: 205 },
    lights: { wattsPerSqFt: 0, useSchedule: 100 },
    equipment: { kw: 0, sensiblePct: 100, latentPct: 0 }
  },
  infiltration: {
    method: 'ach', // or 'cfm' or 'crack'
    achValue: 0.5,
    cfmValue: 0,
    doors: [] // Array of door objects for detailed crack method
  }
});

const initialState = {
  byRoomId: {
    // Example Structure:
    // "room_default_1": createRoomEnvelope()
  }
};

const envelopeSlice = createSlice({
  name: 'envelope',
  initialState,
  reducers: {
    // 1. Initialize: Called when a Room is added in RDS or Sidebar
    initializeRoom: (state, action) => {
      const roomId = action.payload;
      if (!state.byRoomId[roomId]) {
        state.byRoomId[roomId] = createRoomEnvelope();
      }
    },

    // 2. Add Element: Walls, Glass, etc.
    addEnvelopeElement: (state, action) => {
      const { roomId, category, element } = action.payload;
      // Ensure room exists
      if (!state.byRoomId[roomId]) state.byRoomId[roomId] = createRoomEnvelope();
      
      state.byRoomId[roomId].elements[category].push({
        ...element,
        id: Date.now().toString() // Simple ID generation
      });
    },

    // 3. Update Element: Edit U-Value, Area, etc.
    updateEnvelopeElement: (state, action) => {
      const { roomId, category, id, field, value } = action.payload;
      const roomEnv = state.byRoomId[roomId];
      if (roomEnv) {
        const item = roomEnv.elements[category].find(e => e.id === id);
        if (item) {
          item[field] = value;
        }
      }
    },

    // 4. Remove Element
    removeEnvelopeElement: (state, action) => {
      const { roomId, category, id } = action.payload;
      const roomEnv = state.byRoomId[roomId];
      if (roomEnv) {
        roomEnv.elements[category] = roomEnv.elements[category].filter(e => e.id !== id);
      }
    },

    // 5. Update Internal Loads (People/Lights/Equip)
    // Used by both Envelope Tab AND RDS Grid (Direct Editing)
    updateInternalLoad: (state, action) => {
      const { roomId, type, data } = action.payload; // type: 'people', 'lights', 'equipment'
      
      if (!state.byRoomId[roomId]) state.byRoomId[roomId] = createRoomEnvelope();
      
      const target = state.byRoomId[roomId].internalLoads[type];
      // Merge updates (e.g., only update 'count' but keep 'sensiblePerPerson')
      Object.assign(target, data);
    },

    // 6. Update Infiltration
    updateInfiltration: (state, action) => {
      const { roomId, field, value } = action.payload;
      if (!state.byRoomId[roomId]) state.byRoomId[roomId] = createRoomEnvelope();
      
      state.byRoomId[roomId].infiltration[field] = value;
    },

    // 7. Cleanup: When a room is deleted in RoomSlice
    removeRoomEnvelope: (state, action) => {
      const roomId = action.payload;
      delete state.byRoomId[roomId];
    }
  }
});

export const {
  initializeRoom,
  addEnvelopeElement,
  updateEnvelopeElement,
  removeEnvelopeElement,
  updateInternalLoad,
  updateInfiltration,
  removeRoomEnvelope
} = envelopeSlice.actions;

// ── Selectors ──────────────────────────────────────────────────────────────

// Get specific envelope (used by Calculation Utilities)
export const selectEnvelopeByRoomId = (state, roomId) => 
  state.envelope.byRoomId[roomId] || createRoomEnvelope();

// Get Active Room's envelope (used by Envelope Config Tab UI)
export const selectActiveEnvelope = (state) => {
  const activeRoomId = state.room.activeRoomId;
  return state.envelope.byRoomId[activeRoomId] || createRoomEnvelope();
};

export default envelopeSlice.reducer;