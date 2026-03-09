/**
 * roomSlice.js
 * Manages the list of conditioned rooms and the active room selection.
 *
 * State shape:
 *   state.room.list          →  Room[]
 *   state.room.activeRoomId  →  string | null
 *
 * ── FIELD CONTRACT WITH THE LOGIC LAYER ──────────────────────────────────────
 *
 *   The following fields are READ by calculation modules. All must be present
 *   in makeRoom() with a valid numeric default so parseFloat() never returns NaN.
 *
 *   rdsSelector.js:
 *     room.id
 *     room.assignedAhuIds[0]      — first AHU assigned to this room
 *     room.floorArea  (m²)        → m2ToFt2() in rdsSelector
 *     room.volume     (m³)        → m3ToFt3() in rdsSelector
 *
 *   seasonalLoads.js:
 *     room.designTemp   (°C)      → cToF(), null-safe, fallback 72 °F
 *     room.designRH     (%)       → != null guard — 0 is VALID (battery dry rooms)
 *     room.ventCategory (string)  → 'pharma' triggers GMP 1.25× safety factor
 *
 *   airQuantities.js:
 *     room.designTemp             (same cToF guard as above)
 *     room.minAcph    (ACH)       — regulatory minimum ACPH floor
 *     room.designAcph (ACH)       — ISO/GMP class design ACPH
 *     room.exhaustAir.general (CFM)
 *     room.exhaustAir.bibo    (CFM)   — Bag-In-Bag-Out filter change exhaust
 *     room.exhaustAir.machine (CFM)
 *     room.manualFreshAir     (CFM)   — 0 = use ASHRAE 62.1 VRP result
 *     room.ventCategory               — maps to Rp + Ra via ventilation.js
 *
 * ── REMOVED: createSeasonData() ──────────────────────────────────────────────
 *
 *   The previous slice stored supplyAir_Summer / returnAir_Summer / outsideAir_Summer
 *   etc. directly on each room object. These are NOT read by rdsSelector —
 *   it COMPUTES them via airQuantities.js and returns them in the RDS row.
 *   Storing them in room state:
 *     (a) duplicates data that rdsSelector already owns
 *     (b) goes stale when any upstream input changes
 *     (c) created ambiguity in the RDS grid: room.supplyAir vs rds.supplyAir
 *   Removed. The RDS grid reads all computed values from selectRdsData only.
 *
 * ── designRH = 0 IS VALID ─────────────────────────────────────────────────────
 *
 *   rdsSelector uses:
 *     const raRH = room.designRH != null ? parseFloat(room.designRH) : 50;
 *   NOT:
 *     const raRH = parseFloat(room.designRH) || 50;   ← 0 → 50 (wrong)
 *
 *   Keep designRH default as 50 (a number). Never set it to null or undefined.
 *
 * ── UNIT CONVENTIONS ─────────────────────────────────────────────────────────
 *
 *   floorArea, volume  → SI (m², m³)     converted to ft²/ft³ in rdsSelector
 *   designTemp         → °C              converted to °F in calc modules
 *   designRH           → percentage (0–100), not fraction
 *   exhaustAir.*       → CFM (imperial)
 *   minAcph, designAcph → ACH (hr⁻¹)
 */

import { createSlice } from '@reduxjs/toolkit';

// ── ID generator ──────────────────────────────────────────────────────────────
const generateRoomId = () =>
  `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

// ── Nested field setter ───────────────────────────────────────────────────────
// Resolves dot-notation paths: 'exhaustAir.general', 'designTemp', etc.
const setNestedValue = (obj, path, value) => {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
};

// ── Room factory ──────────────────────────────────────────────────────────────
/**
 * makeRoom(id, index, overrides)
 *
 * Single source of truth for the default room shape.
 * addRoom and addNewRoom() thunk both call this — never duplicating defaults.
 *
 * @param {string} id        — pre-generated room ID
 * @param {number} index     — list length at creation time (for default name)
 * @param {object} overrides — any fields to override after all defaults are set
 */
const makeRoom = (id, index = 0, overrides = {}) => ({
  // ── Identity ──────────────────────────────────────────────────────────────
  id,
  name:     `Room ${index + 1}`,
  roomNo:   '',           // room tag / drawing number (empty string, not undefined)
  level:    '',           // floor / level label
  function: '',           // room function description for RDS header

  // ── Geometry (SI) ─────────────────────────────────────────────────────────
  length:    10,           // m
  width:     10,           // m
  height:     3,           // m  — realistic single-storey height (was 10, wrong)
  floorArea: 100,          // m²  auto-derived: length × width
  volume:    300,          // m³  auto-derived: floorArea × height

  // ── Environmental design targets ──────────────────────────────────────────
  designTemp: 22,          // °C
  designRH:   50,          // %   (0 is valid for dry rooms — keep as number)
  pressure:   15,          // Pa  (positive = supply-side pressurized room)

  // ── Classification ────────────────────────────────────────────────────────
  // Used by envelopeSlice.isIsoClassified() to enforce achValue=0 on init.
  // '' or 'Unclassified' → not ISO classified → infiltration may be non-zero.
  classInOp:   'ISO 8',
  atRestClass: 'ISO 8',
  recOt:       'REC',      // Recirculating or once-through flag
  flpType:     'NFLP',     // Non-unidirectional / unidirectional flow pattern

  // ── ASHRAE 62.1-2022 ventilation category ────────────────────────────────
  // Maps to Rp (CFM/person) + Ra (CFM/ft²) via ventilation.js calculateVbz().
  // 'pharma' also triggers GMP Annex 1 1.25× safety factor in seasonalLoads.js.
  ventCategory: 'general',

  // ── Airflow constraints (ACH) ─────────────────────────────────────────────
  // Fallback defaults — addNewRoom() thunk overrides these from
  // isoCleanroom.getAcphDefaults(classInOp) at creation time.
  minAcph:    10,           // ACH  regulatory minimum
  designAcph: 20,           // ACH  design target (headroom above min)

  // ── Fresh air override ────────────────────────────────────────────────────
  // 0 → use ASHRAE 62.1 VRP Vbz result (airQuantities freshAirCheck).
  // > 0 → engineer-specified override (e.g. 100% OA pharmaceutical suites).
  manualFreshAir: 0,        // CFM

  // ── Exhaust air breakdown ─────────────────────────────────────────────────
  // All CFM (imperial — matches ASHRAE 62.1 unit convention).
  exhaustAir: {
    general: 0,             // CFM  general area exhaust
    bibo:    0,             // CFM  Bag-In-Bag-Out filter exchange
    machine: 0,             // CFM  dedicated process / tool exhaust
  },

  // ── AHU assignment ────────────────────────────────────────────────────────
  // Array supports future multi-AHU rooms.
  // Logic layer reads assignedAhuIds[0] only today.
  assignedAhuIds: [],

  // Overrides applied last — wins over every default above.
  ...overrides,
});

// ── Initial state ─────────────────────────────────────────────────────────────
const initialState = {
  activeRoomId: 'room_default_1',
  list: [
    makeRoom('room_default_1', 0, {
      name:           'Production Hall',
      length:         20,
      width:          15,
      height:          4,     // m — realistic fab floor height
      floorArea:      300,    // m²
      volume:        1200,    // m³  (300 × 4)
      designTemp:     22,     // °C
      designRH:       50,     // %
      pressure:       15,     // Pa
      classInOp:     'ISO 8',
      atRestClass:   'ISO 8',
      ventCategory:  'general',
      minAcph:        10,
      designAcph:     20,
      assignedAhuIds: ['ahu1'],
    }),
  ],
};

// ── Slice ─────────────────────────────────────────────────────────────────────
const roomSlice = createSlice({
  name: 'room',
  initialState,

  reducers: {
    /** Set which room is selected in the sidebar / detail panel. */
    setActiveRoom: (state, action) => {
      state.activeRoomId = action.payload;
    },

    /**
     * addRoom
     * Payload: string ID (legacy) OR object { id, minAcph, designAcph, ...overrides }.
     * The addNewRoom() thunk in roomActions.js is the preferred caller —
     * it also dispatches envelopeSlice.initializeRoom in the same transaction.
     */
    addRoom: (state, action) => {
      const payload   = action.payload;
      const isLegacy  = typeof payload === 'string';
      const id        = isLegacy ? payload : (payload.id ?? generateRoomId());
      const overrides = isLegacy ? {} : (() => {
        const o = { ...payload };
        delete o.id; // id is passed separately to makeRoom — don't double it
        return o;
      })();

      const newRoom = makeRoom(id, state.list.length, overrides);
      state.list.push(newRoom);
      state.activeRoomId = id;
    },

    /**
     * updateRoom
     * { id, field, value }  —  field supports dot-notation paths.
     * Auto-derives floorArea and volume when geometry dimensions change.
     */
    updateRoom: (state, action) => {
      const { id, field, value } = action.payload;
      const room = state.list.find(r => r.id === id);
      if (!room) return;

      setNestedValue(room, field, value);

      // Keep derived geometry consistent
      const l = parseFloat(room.length)    || 0;
      const w = parseFloat(room.width)     || 0;
      const h = parseFloat(room.height)    || 0;

      if (field === 'length' || field === 'width') {
        room.floorArea = parseFloat((l * w).toFixed(1));
        room.volume    = parseFloat((room.floorArea * h).toFixed(1));
      }
      if (field === 'height') {
        room.volume = parseFloat((room.floorArea * h).toFixed(1));
      }
      if (field === 'floorArea') {
        // Engineer entered irregular area directly
        room.volume = parseFloat((parseFloat(value) * h).toFixed(1));
      }
    },

    /**
     * setRoomAhu
     * Replace the entire AHU assignment: { roomId, ahuId }.
     * Pass ahuId = null to clear the assignment.
     */
    setRoomAhu: (state, action) => {
      const { roomId, ahuId } = action.payload;
      const room = state.list.find(r => r.id === roomId);
      if (room) room.assignedAhuIds = ahuId ? [ahuId] : [];
    },

    /**
     * toggleRoomAhu
     * Toggle a single AHU in the assignment list (used by AhuAssignment.jsx).
     * { roomId, ahuId }
     */
    toggleRoomAhu: (state, action) => {
      const { roomId, ahuId } = action.payload;
      const room = state.list.find(r => r.id === roomId);
      if (!room) return;
      const idx = room.assignedAhuIds.indexOf(ahuId);
      if (idx >= 0) {
        room.assignedAhuIds.splice(idx, 1);
      } else {
        room.assignedAhuIds.push(ahuId);
      }
    },

    /**
     * deleteRoom
     * Never removes the last room.
     * IMPORTANT: Do NOT call from the UI directly.
     * Always use deleteRoomWithCleanup() thunk from roomActions.js so that
     * envelopeSlice.removeRoomEnvelope also fires in the same transaction.
     */
    deleteRoom: (state, action) => {
      if (state.list.length <= 1) return;
      const id = action.payload;
      state.list = state.list.filter(r => r.id !== id);
      if (state.activeRoomId === id) {
        state.activeRoomId = state.list[0].id;
      }
    },
  },
});

export const {
  setActiveRoom,
  addRoom,
  updateRoom,
  setRoomAhu,
  toggleRoomAhu,
  deleteRoom,
} = roomSlice.actions;

export default roomSlice.reducer;

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectAllRooms = (state) => state.room.list;

export const selectActiveRoomId = (state) => state.room.activeRoomId;

export const selectActiveRoom = (state) =>
  state.room.list.find(r => r.id === state.room.activeRoomId) ??
  state.room.list[0] ??
  null;

export const selectRoomById = (state, id) =>
  state.room.list.find(r => r.id === id) ?? null;