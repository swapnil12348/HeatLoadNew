/**
 * envelopeSlice.js
 * Manages per-room envelope data: building elements (walls, glazing, etc.)
 * and internal loads (people, lights, equipment, infiltration).
 *
 * State shape:
 *   state.envelope.byRoomId  →  { [roomId]: RoomEnvelope }
 *
 * ── FIELD NOTES — LOGIC LAYER CONTRACT ───────────────────────────────────────
 *
 *   The following fields are READ DIRECTLY by the calculation modules.
 *   All must be present in the default factory so that parseFloat() and ??
 *   in the calc layer receive a numeric value, never undefined.
 *
 *   PEOPLE (seasonalLoads.js):
 *     int.people.count                — occupant count
 *     int.people.sensiblePerPerson    — ASHRAE HOF Table 1 seated (BTU/hr)
 *     int.people.latentPerPerson      — ASHRAE HOF Table 1 seated (BTU/hr)
 *
 *   LIGHTS (seasonalLoads.js):
 *     int.lights.wattsPerSqFt         — installed lighting density
 *     int.lights.useSchedule          — operating fraction (0–100 %)
 *     int.lights.ballastFactor        — FIX HIGH-05: was MISSING. Must be present
 *                                       so the UI can expose it and the calc reads
 *                                       a real number. Default 1.0 = LED. T8 = 1.2.
 *                                       seasonalLoads line:
 *                                         parseFloat(int.lights?.ballastFactor) || ASHRAE.LIGHTING_BALLAST_FACTOR
 *                                       If this field is absent, that expression silently
 *                                       uses the ASHRAE fallback — but the UI has no
 *                                       bound field to render or edit.
 *
 *   EQUIPMENT (seasonalLoads.js):
 *     int.equipment.kw                — connected load
 *     int.equipment.sensiblePct       — fraction of kW that is sensible (0–100)
 *     int.equipment.latentPct         — fraction of kW that is latent   (0–100)
 *     int.equipment.diversityFactor   — FIX HIGH-07: was MISSING. The ?? operator
 *                                       falls back to ASHRAE.PROCESS_DIVERSITY_FACTOR
 *                                       only when this field is null | undefined.
 *                                       With diversityFactor absent, the default fires
 *                                       silently and the engineer cannot see it in the
 *                                       UI or adjust it per-room.
 *                                       seasonalLoads line:
 *                                         parseFloat(int.equipment?.diversityFactor)
 *                                           ?? ASHRAE.PROCESS_DIVERSITY_FACTOR
 *                                       Default 1.0 = no diversity (conservative).
 *                                       ASHRAE typical: 0.75–0.85 for process equipment.
 *
 *   INFILTRATION (seasonalLoads.js):
 *     inf.achValue                    — infiltration air changes per hour
 *                                       Default 0 (pressurized / ISO-classified spaces).
 *                                       FIX CRIT-03: was 0.5 — that added phantom loads
 *                                       to every cleanroom in the project.
 *
 *   ELEMENTS (envelopeCalc.js + envelopeAggregator.js):
 *     elements.walls / roofs / glass / skylights / partitions / floors
 *     — each is an array of element objects; arrays default empty [].
 *
 * ── PRESSURIZATION POLICY ────────────────────────────────────────────────────
 *
 *   Any positively pressurized room (ISO 14644 class, GMP grade, or explicit
 *   pressure > 0 Pa) has zero infiltration by definition. The default achValue=0
 *   encodes this. Only unpressurized rooms should have non-zero achValue.
 *   Reference: ISO 14644-4:2022 §6.4; ASHRAE HOF 2021 Ch.16.
 */

import { createSlice } from '@reduxjs/toolkit';

// ── Default envelope factory ──────────────────────────────────────────────────
// Single source of truth for the shape of a room's envelope object.
// Any field added here becomes available to both the logic layer and the UI.

const createRoomEnvelope = () => ({
  elements: {
    walls:      [],
    roofs:      [],
    glass:      [],
    skylights:  [],
    partitions: [],
    floors:     [],
  },

  internalLoads: {
    people: {
      count:              0,
      sensiblePerPerson:  245,   // BTU/hr — ASHRAE HOF 2021 Ch.18 Table 1, seated sedentary
      latentPerPerson:    205,   // BTU/hr — ASHRAE HOF 2021 Ch.18 Table 1, seated sedentary
    },
    lights: {
      wattsPerSqFt:  0,
      useSchedule:   100,        // % — 100 = lights on full occupied period
      // FIX HIGH-05: ballastFactor was MISSING. Added here.
      // seasonalLoads: parseFloat(int.lights?.ballastFactor) || ASHRAE.LIGHTING_BALLAST_FACTOR
      // Without this field the UI has nothing to bind to — the fallback fires
      // silently and the engineer cannot see or adjust the ballast factor.
      // 1.0 = LED (no ballast loss) — conservative default.
      // T8 fluorescent = 1.2  |  T5 fluorescent = 1.15  |  LED = 1.0
      ballastFactor: 1.0,
    },
    equipment: {
      kw:           0,
      sensiblePct:  100,         // % — default: all equipment load is sensible
      latentPct:    0,           // % — process moisture sources override this
      // FIX HIGH-07: diversityFactor was MISSING. Added here.
      // seasonalLoads: parseFloat(int.equipment?.diversityFactor) ?? ASHRAE.PROCESS_DIVERSITY_FACTOR
      // The ?? operator means:  null | undefined → use ASHRAE global fallback
      //                         0 | 0.5 | any number → use that value
      // With diversityFactor absent from the object, the UI cannot render a
      // control for it, and the global fallback fires for every room silently.
      // 1.0 = fully loaded (conservative / worst-case design).
      // ASHRAE typical process diversity: 0.75–0.85.
      diversityFactor: 1.0,
    },
  },

  infiltration: {
    method:   'ach',
    // FIX CRIT-03: Default changed from 0.5 → 0.
    // Positive-pressure rooms (all ISO classes, GMP grades) have zero infiltration.
    // Defaulting to 0.5 added phantom sensible + latent loads to every cleanroom.
    // For unpressurized rooms, the engineer sets this explicitly.
    achValue: 0,
    cfmValue: 0,
    doors:    [],
  },
});

// ── ISO classification guard ──────────────────────────────────────────────────
// Returns true for any room with an ISO cleanroom classification (not empty,
// not 'Unclassified'). Used by initializeRoom to guard achValue on creation.
const isIsoClassified = (room) => {
  const cls = room?.classInOp ?? '';
  return cls !== '' && cls !== 'Unclassified';
};

// ── Initial state ─────────────────────────────────────────────────────────────
const initialState = {
  byRoomId: {
    // Pre-initialize the default room defined in roomSlice.
    // Key must match roomSlice initialState list[0].id.
    room_default_1: createRoomEnvelope(),
  },
};

// ── Slice ─────────────────────────────────────────────────────────────────────
const envelopeSlice = createSlice({
  name: 'envelope',
  initialState,

  reducers: {
    /**
     * initializeRoom
     * Called when a new room is added (from roomActions.js addNewRoom thunk).
     * Supports two payload shapes:
     *   string:           initializeRoom('room_xyz')      — legacy
     *   { id, room }:     initializeRoom({ id, room })    — preferred (ISO-aware)
     *
     * Guards against re-initialization — existing envelope is never overwritten.
     */
    initializeRoom: (state, action) => {
      const isLegacy = typeof action.payload === 'string';
      const roomId   = isLegacy ? action.payload : action.payload.id;
      const room     = isLegacy ? null            : action.payload.room;

      if (state.byRoomId[roomId]) return; // already initialized — preserve existing data

      const envelope = createRoomEnvelope();

      // ISO-classified rooms are positively pressurized → achValue must be 0.
      // createRoomEnvelope() already defaults to 0 — this explicit assignment
      // ensures a future factory-default change can't silently affect classified rooms.
      if (isIsoClassified(room)) {
        envelope.infiltration.achValue = 0;
      }

      state.byRoomId[roomId] = envelope;
    },

    /**
     * addEnvelopeElement
     * Append a new element to a category array.
     * { roomId, category, element }  —  category: 'walls' | 'roofs' | 'glass' | etc.
     */
    addEnvelopeElement: (state, action) => {
      const { roomId, category, element } = action.payload;
      if (!state.byRoomId[roomId]) {
        state.byRoomId[roomId] = createRoomEnvelope();
      }
      state.byRoomId[roomId].elements[category].push({
        ...element,
        id: `elem_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      });
    },

    /**
     * updateEnvelopeElement
     * Edit a single field on an existing element.
     * { roomId, category, id, field, value }
     */
    updateEnvelopeElement: (state, action) => {
      const { roomId, category, id, field, value } = action.payload;
      const roomEnv = state.byRoomId[roomId];
      if (!roomEnv) return;
      const item = roomEnv.elements[category]?.find(e => e.id === id);
      if (item) item[field] = value;
    },

    /**
     * removeEnvelopeElement
     * { roomId, category, id }
     */
    removeEnvelopeElement: (state, action) => {
      const { roomId, category, id } = action.payload;
      const roomEnv = state.byRoomId[roomId];
      if (!roomEnv) return;
      roomEnv.elements[category] = roomEnv.elements[category].filter(e => e.id !== id);
    },

    /**
     * updateInternalLoad
     * Merge-update a sub-object (people | lights | equipment).
     * Used by the Envelope Config UI and by direct RDS cell editing.
     * { roomId, type, data }  —  type: 'people' | 'lights' | 'equipment'
     *
     * Uses Object.assign (merge) so callers can update a single field
     * without passing the entire sub-object.
     */
    updateInternalLoad: (state, action) => {
      const { roomId, type, data } = action.payload;
      if (!state.byRoomId[roomId]) {
        state.byRoomId[roomId] = createRoomEnvelope();
      }
      const target = state.byRoomId[roomId].internalLoads[type];
      if (target) {
        Object.assign(target, data);
      }
    },

    /**
     * updateInfiltration
     * Update a single field on the infiltration object.
     * { roomId, field, value }
     */
    updateInfiltration: (state, action) => {
      const { roomId, field, value } = action.payload;
      if (!state.byRoomId[roomId]) {
        state.byRoomId[roomId] = createRoomEnvelope();
      }
      state.byRoomId[roomId].infiltration[field] = value;
    },

    /**
     * removeRoomEnvelope
     * Called by deleteRoomWithCleanup thunk in roomActions.js when a room is deleted.
     * Do not call from UI directly — always go through the thunk so both
     * roomSlice and envelopeSlice stay in sync.
     */
    removeRoomEnvelope: (state, action) => {
      delete state.byRoomId[action.payload];
    },
  },
});

export const {
  initializeRoom,
  addEnvelopeElement,
  updateEnvelopeElement,
  removeEnvelopeElement,
  updateInternalLoad,
  updateInfiltration,
  removeRoomEnvelope,
} = envelopeSlice.actions;

export default envelopeSlice.reducer;

// ── Selectors ─────────────────────────────────────────────────────────────────

/** Get a specific room's envelope. Returns a fresh default if not initialized. */
export const selectEnvelopeByRoomId = (state, roomId) =>
  state.envelope.byRoomId[roomId] ?? createRoomEnvelope();

/** Get the active room's envelope (for Envelope Config tab). */
export const selectActiveEnvelope = (state) => {
  const id = state.room.activeRoomId;
  return state.envelope.byRoomId[id] ?? createRoomEnvelope();
};

/** Full byRoomId map — consumed directly by rdsSelector. */
export const selectAllEnvelopes = (state) => state.envelope.byRoomId;