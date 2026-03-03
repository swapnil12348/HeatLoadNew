// src/features/room/roomSlice.js
import { createSlice } from '@reduxjs/toolkit';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generates a unique room ID based on timestamp + random suffix */
const generateRoomId = () =>
  `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

/**
 * Creates empty seasonal sub-fields for a given prefix.
 * e.g. createSeasonData('supply') → { supply_Summer: 0, supply_Monsoon: 0, supply_Winter: 0 }
 */
const createSeasonData = (prefix, val = 0) => ({
  [`${prefix}_Summer`]: val,
  [`${prefix}_Monsoon`]: val,
  [`${prefix}_Winter`]: val,
});

/**
 * Safely sets a value at a dot-separated nested path inside an object.
 * Supports both flat keys ("length") and nested keys ("exhaustAir.general").
 * Intermediate objects are auto-created if missing.
 */
const setNestedValue = (obj, path, value) => {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] === undefined || current[keys[i]] === null) {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
};

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState = {
  activeRoomId: 'room_default_1',
  list: [
    {
      id: 'room_default_1',
      name: 'Production Hall',

      // Geometry
      length: 20,
      width: 15,
      height: 10,
      floorArea: 300,  // auto-calculated: length × width
      volume: 3000,    // auto-calculated: floorArea × height

      // Environmental design targets
      designTemp: 22,
      designRH: 50,
      pressure: 15,

      // Classification
      atRestClass: 'ISO 8',
      recOt: 'REC',
      flpType: 'NFLP',

      // Airflow parameters
      minAcph: 10,
      designAcph: 15,

      // Exhaust air breakdown (nested object — use "exhaustAir.general" as field path)
      exhaustAir: {
        general: 0,
        bibo: 0,
        machine: 0,
      },

      // Seasonal supply/return data (flat keys for easy table binding)
      ...createSeasonData('supplyAir'),
      ...createSeasonData('returnAir'),
      ...createSeasonData('outsideAir'),

      // Linked AHU IDs (single-select enforced via setRoomAhu / toggleRoomAhu)
      assignedAhuIds: ['ahu_default_1'],
    },
  ],
};

// ─── Slice ───────────────────────────────────────────────────────────────────

const roomSlice = createSlice({
  name: 'room',
  initialState,
  reducers: {

    /** Switch the active room panel */
    setActiveRoom: (state, action) => {
      state.activeRoomId = action.payload;
    },

    /**
     * Append a new room with safe defaults and immediately make it active.
     * All calculated fields (floorArea, volume) start from default geometry.
     */
    addRoom: (state) => {
      const newId = generateRoomId();
      const newRoom = {
        id: newId,
        name: `Room ${state.list.length + 1}`,

        // Geometry
        length: 10,
        width: 10,
        height: 10,
        floorArea: 100,
        volume: 1000,

        // Environmental design targets
        designTemp: 22,
        designRH: 50,
        pressure: 15,

        // Classification
        atRestClass: 'ISO 8',
        recOt: 'REC',
        flpType: 'NFLP',

        // Airflow parameters
        minAcph: 10,
        designAcph: 15,

        // Exhaust air breakdown (nested)
        exhaustAir: {
          general: 0,
          bibo: 0,
          machine: 0,
        },

        // Seasonal data
        ...createSeasonData('supplyAir'),
        ...createSeasonData('returnAir'),
        ...createSeasonData('outsideAir'),

        assignedAhuIds: [],
      };
      state.list.push(newRoom);
      state.activeRoomId = newId;
    },

    /**
     * Update any room field by ID.
     *
     * Supports:
     *   - Flat keys:   { id, field: 'length', value: 12 }
     *   - Nested keys: { id, field: 'exhaustAir.general', value: 150 }
     *
     * Auto-recalculates floorArea and volume when geometry changes.
     */
    updateRoom: (state, action) => {
      const { id, field, value } = action.payload;
      const room = state.list.find((r) => r.id === id);
      if (!room) return;

      // Apply update (handles both flat and nested paths)
      setNestedValue(room, field, value);

      // --- Geometry auto-calc ---
      // When length or width changes → recalculate floorArea then volume
      if (field === 'length' || field === 'width') {
        room.floorArea = parseFloat((room.length * room.width).toFixed(1));
        room.volume = parseFloat((room.floorArea * room.height).toFixed(1));
      }
      // When height changes → only volume needs updating
      if (field === 'height') {
        room.volume = parseFloat((room.floorArea * parseFloat(value)).toFixed(1));
      }
    },

    /**
     * Hard-assign a single AHU to a room (replaces any existing assignment).
     * Use this when the UI enforces one-AHU-per-room strictly.
     */
    setRoomAhu: (state, action) => {
      const { roomId, ahuId } = action.payload;
      const room = state.list.find((r) => r.id === roomId);
      if (room) room.assignedAhuIds = [ahuId];
    },

    /**
     * Toggle a single AHU assignment on a room.
     * If the AHU is already assigned → removes it (empty array).
     * If a different AHU is passed → replaces the current assignment.
     */
    toggleRoomAhu: (state, action) => {
      const { roomId, ahuId } = action.payload;
      const room = state.list.find((r) => r.id === roomId);
      if (!room) return;
      const alreadyAssigned = room.assignedAhuIds.includes(ahuId);
      room.assignedAhuIds = alreadyAssigned ? [] : [ahuId];
    },

    /**
     * Delete a room by ID.
     * Guards against removing the last room.
     * Resets activeRoomId to the first remaining room if needed.
     */
    deleteRoom: (state, action) => {
      const idToDelete = action.payload;
      if (state.list.length <= 1) return; // keep at least one room
      state.list = state.list.filter((r) => r.id !== idToDelete);
      if (state.activeRoomId === idToDelete) {
        state.activeRoomId = state.list[0].id;
      }
    },
  },
});

// ─── Exports ─────────────────────────────────────────────────────────────────

export const {
  setActiveRoom,
  addRoom,
  updateRoom,
  setRoomAhu,
  toggleRoomAhu,
  deleteRoom,
} = roomSlice.actions;

/** All rooms */
export const selectAllRooms = (state) => state.room.list;

/** Currently active room ID */
export const selectActiveRoomId = (state) => state.room.activeRoomId;

/** Currently active room object (falls back to first room for safety) */
export const selectActiveRoom = (state) =>
  state.room.list.find((r) => r.id === state.room.activeRoomId) ??
  state.room.list[0];

export default roomSlice.reducer;