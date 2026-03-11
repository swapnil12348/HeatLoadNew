/**
 * roomSlice.js
 * Manages the list of conditioned rooms and the active room selection.
 *
 * State shape:
 *   state.room.list          →  Room[]
 *   state.room.activeRoomId  →  string | null
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   FIX-ROOM-DB-01 — designDB field added to room shape.
 *
 *     psychroValidation.validateRoomHumidity() reads room.designDB (°F).
 *     roomSlice previously stored only designTemp (°C) and had no designDB field.
 *
 *     Effect: parseFloat(room.designDB) === parseFloat(undefined) === NaN.
 *     validateRoomHumidity immediately hit:
 *       if (isNaN(rh) || isNaN(db)) {
 *         errors.push('Invalid design conditions...');
 *         return makeResult(errors, warnings);   ← exits before any real check
 *       }
 *     Every room failed humidity validation with an invalid-input error.
 *     No actual humidity standard checks ever ran.
 *
 *     Fix:
 *       1. makeRoom() now includes designDB (°F) derived from designTemp (°C).
 *       2. updateRoom() keeps designDB in sync when designTemp changes.
 *
 *     designDB is a derived/display field — it is NOT the source of truth.
 *     designTemp (°C) remains the canonical storage field, used by:
 *       seasonalLoads.js (cToF conversion), airQuantities.js (cToF).
 *     designDB (°F) is the convenience field for psychroValidation and any
 *     UI components that work in °F (ASHRAE psychrometric display).
 *
 *     Conversion: designDB = designTemp × 9/5 + 32  (exact, no rounding error)
 *
 * ── FIELD CONTRACT WITH THE LOGIC LAYER ──────────────────────────────────────
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
 *   psychroValidation.js:
 *     room.designDB     (°F)      → derived from designTemp; kept in sync by updateRoom
 *     room.designRH     (%)
 *
 *   airQuantities.js:
 *     room.designTemp             (same cToF guard as above)
 *     room.minAcph    (ACH)       — regulatory minimum ACPH floor
 *     room.designAcph (ACH)       — ISO/GMP class design ACPH
 *     room.exhaustAir.general (CFM)
 *     room.exhaustAir.bibo    (CFM)
 *     room.exhaustAir.machine (CFM)
 *     room.manualFreshAir     (CFM)
 *     room.ventCategory
 *
 * ── UNIT CONVENTIONS ─────────────────────────────────────────────────────────
 *
 *   floorArea, volume  → SI (m², m³)     converted to ft²/ft³ in rdsSelector
 *   designTemp         → °C              converted to °F in calc modules
 *   designDB           → °F              derived from designTemp; for psychro display
 *   designRH           → percentage (0–100), not fraction
 *   exhaustAir.*       → CFM (imperial)
 *   minAcph, designAcph → ACH (hr⁻¹)
 *
 * ── designRH = 0 IS VALID ─────────────────────────────────────────────────────
 *
 *   rdsSelector uses:
 *     const raRH = !isNaN(parsedRaRh) ? parsedRaRh : 50;
 *   NOT:
 *     const raRH = parseFloat(room.designRH) || 50;   ← 0 → 50 (wrong)
 *
 *   Keep designRH default as 50 (a number). Never set it to null or undefined.
 */

import { createSlice } from '@reduxjs/toolkit';
import { ACPH_RANGES } from '../../constants/isoCleanroom';

// ── ID generator ──────────────────────────────────────────────────────────────
const generateRoomId = () =>
  `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

// ── Nested field setter ───────────────────────────────────────────────────────
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

// ── Temperature helpers ───────────────────────────────────────────────────────
// Inlined to avoid circular imports from utils/units in the Redux slice.
// units.js cToF() is the canonical version; keep these in sync.
const cToF_inline = (c) => {
  const n = parseFloat(c);
  return isNaN(n) ? null : parseFloat((n * 9 / 5 + 32).toFixed(1));
};

// ── Room factory ──────────────────────────────────────────────────────────────
/**
 * makeRoom(id, index, overrides)
 *
 * Single source of truth for the default room shape.
 *
 * FIX-ROOM-DB-01: designDB (°F) added — derived from designTemp (°C).
 * psychroValidation.validateRoomHumidity() reads room.designDB.
 */
const makeRoom = (id, index = 0, overrides = {}) => {
  // Build base object first so we can derive designDB from designTemp,
  // accounting for any designTemp override passed in.
  const base = {
    // ── Identity ──────────────────────────────────────────────────────────────
    id,
    name: `Room ${index + 1}`,
    roomNo: '',
    level: '',
    function: '',

    // ── Geometry (SI) ─────────────────────────────────────────────────────────
    length: 10,
    width: 10,
    height: 3,
    floorArea: 100,
    volume: 300,

    // ── Environmental design targets ──────────────────────────────────────────
    designTemp: 22,          // °C — source of truth
    // FIX-ROOM-DB-01: designDB is the °F equivalent, kept in sync by updateRoom.
    // psychroValidation reads designDB; calc modules convert designTemp themselves.
    designDB: 71.6,        // °F — derived: 22 × 9/5 + 32 = 71.6
    designRH: 50,          // % (0 is valid for dry rooms — keep as number)
    pressure: 15,          // Pa

    // ── Classification ────────────────────────────────────────────────────────
    classInOp: 'ISO 8',
    atRestClass: 'ISO 8',
    recOt: 'REC',
    flpType: 'NFLP',

    // ── ASHRAE 62.1-2022 ventilation category ────────────────────────────────
    ventCategory: 'general',

    // ── Airflow constraints (ACH) ─────────────────────────────────────────────
    minAcph: 10,
    designAcph: 20,

    // ── Fresh air override ────────────────────────────────────────────────────
    manualFreshAir: 0,

    // ── Exhaust air breakdown ─────────────────────────────────────────────────
    exhaustAir: {
      general: 0,
      bibo: 0,
      machine: 0,
    },

    // ── AHU assignment ────────────────────────────────────────────────────────
    assignedAhuIds: [],
  };

  // Apply overrides, then re-derive designDB if designTemp was overridden.
  const merged = { ...base, ...overrides };

  // FIX-ROOM-DB-01: If the override included a designTemp, recalculate designDB
  // unless the override also explicitly set designDB (engineer override takes precedence).
  if (overrides.designTemp !== undefined && overrides.designDB === undefined) {
    const derivedDB = cToF_inline(overrides.designTemp);
    if (derivedDB !== null) merged.designDB = derivedDB;
  }

  return merged;
};

// ── Initial state ─────────────────────────────────────────────────────────────
const initialState = {
  activeRoomId: 'room_default_1',
  list: [
    makeRoom('room_default_1', 0, {
      name: 'Production Hall',
      length: 20,
      width: 15,
      height: 4,
      floorArea: 300,
      volume: 1200,
      designTemp: 22,       // °C
      // designDB derived automatically by makeRoom: 22 × 9/5 + 32 = 71.6 °F
      designRH: 50,
      pressure: 15,
      classInOp: 'ISO 8',
      atRestClass: 'ISO 8',
      ventCategory: 'general',
      minAcph: 10,
      designAcph: 20,
      assignedAhuIds: ['ahu1'],
    }),
  ],
};

// ── Slice ─────────────────────────────────────────────────────────────────────
const roomSlice = createSlice({
  name: 'room',
  initialState,

  reducers: {
    setActiveRoom: (state, action) => {
      state.activeRoomId = action.payload;
    },

    addRoom: (state, action) => {
      const payload = action.payload;
      const isLegacy = typeof payload === 'string';
      const id = isLegacy ? payload : (payload.id ?? generateRoomId());
      const overrides = isLegacy ? {} : (() => {
        const o = { ...payload };
        delete o.id;
        return o;
      })();

      const newRoom = makeRoom(id, state.list.length, overrides);
      state.list.push(newRoom);
      state.activeRoomId = id;
    },

    /**
     * updateRoom
     * { id, field, value }  —  field supports dot-notation paths.
     *
     * FIX-ROOM-DB-01: When designTemp changes, designDB is updated automatically.
     * Auto-derives floorArea and volume when geometry dimensions change.
     */
    updateRoom: (state, action) => {
      const { id, field, value } = action.payload;
      const room = state.list.find(r => r.id === id);
      if (!room) return;

      setNestedValue(room, field, value);

      // FIX-ROOM-DB-01: keep designDB (°F) in sync with designTemp (°C).
      // This ensures psychroValidation.validateRoomHumidity always has a valid °F value.
      // Only update designDB when designTemp changes — not on direct designDB edits
      // (which would allow an engineer to override for special conditions).
      if (field === 'designTemp') {
        const derivedDB = cToF_inline(value);
        if (derivedDB !== null) {
          room.designDB = derivedDB;
        }
        // If value is '' or NaN (user cleared field), leave existing designDB
        // in place rather than setting it to null — preserves last valid value.
      }

      if (field === 'classInOp') {
        const acph = ACPH_RANGES[value];
        if (acph) {
          room.minAcph = acph.min;
          room.designAcph = acph.design;
        }
      }

      // Keep derived geometry consistent
      const l = parseFloat(room.length) || 0;
      const w = parseFloat(room.width) || 0;
      const h = parseFloat(room.height) || 0;

      if (field === 'length' || field === 'width') {
        room.floorArea = parseFloat((l * w).toFixed(1));
        room.volume = parseFloat((room.floorArea * h).toFixed(1));
      }
      if (field === 'height') {
        room.volume = parseFloat((room.floorArea * h).toFixed(1));
      }
      if (field === 'floorArea') {
        room.volume = parseFloat((parseFloat(value) * h).toFixed(1));
      }
    },

    setRoomAhu: (state, action) => {
      const { roomId, ahuId } = action.payload;
      const room = state.list.find(r => r.id === roomId);
      if (room) room.assignedAhuIds = ahuId ? [ahuId] : [];
    },

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
     * Use deleteRoomWithCleanup() thunk from roomActions.js — it also fires
     * envelopeSlice.removeRoomEnvelope in the same transaction.
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