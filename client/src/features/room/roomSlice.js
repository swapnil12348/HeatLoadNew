// src/features/room/roomSlice.js
import { createSlice } from '@reduxjs/toolkit';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState = {
  activeRoomId: 'room_default_1',
  list: [
    {
      id: 'room_default_1',
      name: 'Production Hall',

      // BUG-13 FIX: roomNo was missing from initial state.
      // Undefined initial values cause React controlled-input warnings and
      // render blank in RDS table cells even after the user types a value.
      roomNo: '',

      // Geometry
      length:    20,
      width:     15,
      height:    10,
      floorArea: 300,   // auto-calculated: length × width
      volume:    3000,  // auto-calculated: floorArea × height

      // Environmental design targets
      designTemp: 22,
      designRH:   50,
      pressure:   15,

      // Classification
      // BUG-11 FIX: classInOp (ISO class In-Operation) was completely missing
      // from room state. RDSConfig declares it as a select column — without
      // this field the cell rendered blank and GMP documentation was incomplete.
      // "In Operation" and "At Rest" are distinct classifications per ISO 14644
      // and GMP Annex 1 — both must be independently recorded.
      classInOp:  'ISO 8',
      atRestClass: 'ISO 8',
      recOt:      'REC',
      flpType:    'NFLP',

      // Airflow parameters
      minAcph:    10,
      designAcph: 15,

      // Exhaust air breakdown
      exhaustAir: {
        general: 0,
        bibo:    0,
        machine: 0,
      },

      // Seasonal supply/return data
      ...createSeasonData('supplyAir'),
      ...createSeasonData('returnAir'),
      ...createSeasonData('outsideAir'),

      assignedAhuIds: ['ahu1'],
    },
  ],
};

// ─── Slice ───────────────────────────────────────────────────────────────────

const roomSlice = createSlice({
  name: 'room',
  initialState,
  reducers: {

    setActiveRoom: (state, action) => {
      state.activeRoomId = action.payload;
    },

    addRoom: (state, action) => {
      const newId = action.payload || generateRoomId()
      const newRoom = {
        id:   newId,
        name: `Room ${state.list.length + 1}`,

        // BUG-13 FIX: initialize roomNo as empty string, not undefined.
        roomNo: '',

        // Geometry
        length:    10,
        width:     10,
        height:    10,
        floorArea: 100,
        volume:    1000,

        // Environmental design targets
        designTemp: 22,
        designRH:   50,
        pressure:   15,

        // Classification
        // BUG-11 FIX: every new room needs classInOp initialized.
        classInOp:   'ISO 8',
        atRestClass: 'ISO 8',
        recOt:       'REC',
        flpType:     'NFLP',

        // Airflow parameters
        minAcph:    10,
        designAcph: 15,

        // Exhaust air breakdown
        exhaustAir: {
          general: 0,
          bibo:    0,
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

    updateRoom: (state, action) => {
      const { id, field, value } = action.payload;
      const room = state.list.find((r) => r.id === id);
      if (!room) return;

      setNestedValue(room, field, value);

      if (field === 'length' || field === 'width') {
        room.floorArea = parseFloat((room.length * room.width).toFixed(1));
        room.volume    = parseFloat((room.floorArea * room.height).toFixed(1));
      }
      if (field === 'height') {
        room.volume = parseFloat((room.floorArea * parseFloat(value)).toFixed(1));
      }
    },

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

// ─── Exports ─────────────────────────────────────────────────────────────────

export const {
  setActiveRoom,
  addRoom,
  updateRoom,
  setRoomAhu,
  toggleRoomAhu,
  deleteRoom,
} = roomSlice.actions;

export const selectAllRooms    = (state) => state.room.list;
export const selectActiveRoomId = (state) => state.room.activeRoomId;
export const selectActiveRoom  = (state) =>
  state.room.list.find((r) => r.id === state.room.activeRoomId) ??
  state.room.list[0];

export default roomSlice.reducer;