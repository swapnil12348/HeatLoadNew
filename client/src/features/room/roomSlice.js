// src/features/room/roomSlice.js
import { createSlice } from '@reduxjs/toolkit';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const generateRoomId = () =>
  `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

const createSeasonData = (prefix, val = 0) => ({
  [`${prefix}_Summer`]:  val,
  [`${prefix}_Monsoon`]: val,
  [`${prefix}_Winter`]:  val,
});

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

// ─── Room template factory ────────────────────────────────────────────────────
/**
 * makeRoom()
 * Single definition of a room's default shape.
 * Accepts overrides so callers (addRoom, addNewRoom thunk) can
 * inject pre-computed values (e.g. ACPH defaults from isoCleanroom.js)
 * without duplicating the full default object.
 *
 * @param {string} id        - pre-generated room ID
 * @param {number} index     - room list length at time of creation (for name)
 * @param {object} overrides - any fields to override after defaults are set
 */
const makeRoom = (id, index = 0, overrides = {}) => ({
  id,
  name: `Room ${index + 1}`,

  // BUG-13 FIX: roomNo as empty string — not undefined.
  // Undefined causes React controlled-input warnings.
  roomNo: '',

  // Geometry (m)
  length:    10,
  width:     10,
  height:    10,
  floorArea: 100,   // auto-calculated: length × width
  volume:    1000,  // auto-calculated: floorArea × height

  // Environmental design targets
  designTemp: 22,   // °C
  designRH:   50,   // %
  pressure:   15,   // Pa

  // ASHRAE 62.1-2022 ventilation category
  // Drives Rp and Ra selection in airQuantities.js → calculateVbz()
  ventCategory: 'general',

  // Classification
  // BUG-11 FIX: classInOp was missing — both In-Operation and At-Rest
  // are independent classifications per ISO 14644 and GMP Annex 1.
  classInOp:   'ISO 8',
  atRestClass: 'ISO 8',
  recOt:       'REC',
  flpType:     'NFLP',

  // Airflow parameters (ACPH)
  // Defaults overridden by getAcphDefaults('ISO 8') via addNewRoom thunk.
  // These are the fallback values only — addNewRoom always passes correct ones.
  minAcph:    10,
  designAcph: 20,

  // Fresh air override (0 = use calculated value)
  manualFreshAir: 0,

  // Exhaust air breakdown (CFM)
  exhaustAir: {
    general: 0,
    bibo:    0,
    machine: 0,
  },

  // Seasonal supply/return data
  ...createSeasonData('supplyAir'),
  ...createSeasonData('returnAir'),
  ...createSeasonData('outsideAir'),

  assignedAhuIds: [],

  // Apply caller-supplied overrides last — wins over all defaults above
  ...overrides,
});

// ─── Initial State ────────────────────────────────────────────────────────────

const initialState = {
  activeRoomId: 'room_default_1',
  list: [
    {
      // Default production hall — pre-populated for immediate use
      ...makeRoom('room_default_1', 0, {
        name:          'Production Hall',
        length:        20,
        width:         15,
        height:        10,
        floorArea:     300,
        volume:        3000,
        designTemp:    22,
        designRH:      50,
        pressure:      15,
        classInOp:     'ISO 8',
        atRestClass:   'ISO 8',
        ventCategory:  'general',
        minAcph:       10,
        designAcph:    20,
        assignedAhuIds: ['ahu1'],
      }),
    },
  ],
};

// ─── Slice ────────────────────────────────────────────────────────────────────

const roomSlice = createSlice({
  name: 'room',
  initialState,
  reducers: {

    setActiveRoom: (state, action) => {
      state.activeRoomId = action.payload;
    },

    // ── addRoom ─────────────────────────────────────────────────────────────
    // Receives { id, minAcph, designAcph } from addNewRoom() thunk.
    // The thunk pre-computes ACPH from isoCleanroom.getAcphDefaults()
    // so new rooms always have correct ISO-class ACPH floors from creation.
    //
    // Falls back gracefully if called with just a string ID (legacy path).
    addRoom: (state, action) => {
      const payload = action.payload;

      // Support both legacy string payload and new object payload
      const id       = typeof payload === 'string' ? payload : (payload.id || generateRoomId());
      const overrides = typeof payload === 'object' && payload !== null
        ? {
            minAcph:    payload.minAcph    ?? 10,
            designAcph: payload.designAcph ?? 20,
          }
        : {};

      const newRoom = makeRoom(id, state.list.length, overrides);
      state.list.push(newRoom);
      state.activeRoomId = id;
    },

    // ── updateRoom ───────────────────────────────────────────────────────────
    // Resolves dot-notation paths via setNestedValue.
    // Auto-recalculates floorArea and volume when geometry changes.
    updateRoom: (state, action) => {
      const { id, field, value } = action.payload;
      const room = state.list.find((r) => r.id === id);
      if (!room) return;

      setNestedValue(room, field, value);

      // Auto-calculate derived geometry
      if (field === 'length' || field === 'width') {
        room.floorArea = parseFloat((room.length * room.width).toFixed(1));
        room.volume    = parseFloat((room.floorArea * room.height).toFixed(1));
      }
      if (field === 'height') {
        room.volume = parseFloat((room.floorArea * parseFloat(value)).toFixed(1));
      }
    },

    // ── AHU assignment ────────────────────────────────────────────────────────
    setRoomAhu: (state, action) => {
      const { roomId, ahuId } = action.payload;
      const room = state.list.find((r) => r.id === roomId);
      if (room) room.assignedAhuIds = [ahuId];
    },

    toggleRoomAhu: (state, action) => {
      const { roomId, ahuId } = action.payload;
      const room = state.list.find((r) => r.id === roomId);
      if (!room) return;
      const alreadyAssigned = room.assignedAhuIds.includes(ahuId);
      room.assignedAhuIds = alreadyAssigned ? [] : [ahuId];
    },

    // ── deleteRoom ────────────────────────────────────────────────────────────
    // Never deletes the last room — always leaves at least one.
    // Companion thunk deleteRoomWithCleanup() in roomActions.js handles
    // envelope cleanup — always use the thunk, not this action directly.
    deleteRoom: (state, action) => {
      const idToDelete = action.payload;
      if (state.list.length <= 1) return;
      state.list = state.list.filter((r) => r.id !== idToDelete);
      if (state.activeRoomId === idToDelete) {
        state.activeRoomId = state.list[0].id;
      }
    },
  },
});

// ─── Exports ──────────────────────────────────────────────────────────────────

export const {
  setActiveRoom,
  addRoom,
  updateRoom,
  setRoomAhu,
  toggleRoomAhu,
  deleteRoom,
} = roomSlice.actions;

export const selectAllRooms     = (state) => state.room.list;
export const selectActiveRoomId = (state) => state.room.activeRoomId;
export const selectActiveRoom   = (state) =>
  state.room.list.find((r) => r.id === state.room.activeRoomId) ??
  state.room.list[0];

export default roomSlice.reducer;