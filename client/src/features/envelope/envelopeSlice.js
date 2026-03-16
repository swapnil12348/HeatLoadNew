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
 *     int.lights.useSchedule          — operating fraction (0–100%)
 *     int.lights.ballastFactor        — lighting ballast loss multiplier.
 *                                       seasonalLoads reads:
 *                                         parseFloat(int.lights?.ballastFactor)
 *                                           || ASHRAE.LIGHTING_BALLAST_FACTOR
 *                                       Without this field the fallback fires
 *                                       silently and the UI has nothing to bind.
 *                                       1.0 = LED; T8 fluorescent = 1.2
 *
 *   EQUIPMENT (seasonalLoads.js):
 *     int.equipment.kw                — connected load
 *     int.equipment.sensiblePct       — fraction of kW that is sensible (0–100)
 *     int.equipment.latentPct         — fraction of kW that is latent   (0–100)
 *     int.equipment.diversityFactor   — simultaneous load fraction.
 *                                       seasonalLoads reads:
 *                                         parseFloat(int.equipment?.diversityFactor)
 *                                           ?? ASHRAE.PROCESS_DIVERSITY_FACTOR
 *                                       The ?? operator falls back ONLY on null |
 *                                       undefined — 0 and 0.5 pass through correctly.
 *                                       Without this field the fallback fires silently
 *                                       and the UI cannot expose it per-room.
 *                                       1.0 = fully loaded (conservative design).
 *                                       ASHRAE typical process diversity: 0.75–0.85.
 *
 *   INFILTRATION (seasonalLoads.js):
 *     inf.achValue                    — infiltration air changes per hour.
 *                                       Default 0: positively pressurized / ISO-classified
 *                                       rooms have zero infiltration by definition.
 *                                       Reference: ISO 14644-4:2022 §6.4; ASHRAE HOF Ch.16.
 *                                       Only unpressurized rooms should have non-zero achValue.
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
 */

import { createSlice } from '@reduxjs/toolkit';

// ── Default envelope factory ──────────────────────────────────────────────────
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
      count:             0,
      sensiblePerPerson: 245,   // BTU/hr — ASHRAE HOF 2021 Ch.18 Table 1, seated sedentary
      latentPerPerson:   205,   // BTU/hr — ASHRAE HOF 2021 Ch.18 Table 1, seated sedentary
    },
    lights: {
      wattsPerSqFt:  0,
      useSchedule:   100,   // % — 100 = lights on full occupied period
      ballastFactor: 1.0,   // 1.0 = LED (no ballast loss); T8 fluorescent = 1.2
    },
    equipment: {
      kw:              0,
      sensiblePct:     100,  // % — default: all equipment load is sensible
      latentPct:       0,    // % — process moisture sources override this
      diversityFactor: 1.0,  // 1.0 = fully loaded (conservative); typical process: 0.75–0.85
    },
  },

  infiltration: {
    method:   'ach',
    achValue: 0,    // 0 = positively pressurized room (all ISO/GMP spaces)
    cfmValue: 0,
    doors:    [],
  },
});

// ── ISO classification guard ──────────────────────────────────────────────────
// Returns true for any room with an ISO cleanroom classification.
// Used by initializeRoom to enforce achValue = 0 for classified rooms.
const isIsoClassified = (room) => {
  const cls = room?.classInOp ?? '';
  return cls !== '' && cls !== 'Unclassified';
};

// ── Initial state ─────────────────────────────────────────────────────────────
const initialState = {
  byRoomId: {
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
     *   string:       initializeRoom('room_xyz')      — legacy
     *   { id, room }: initializeRoom({ id, room })    — preferred (ISO-aware)
     *
     * Guards against re-initialization — existing envelope is never overwritten.
     */
    initializeRoom: (state, action) => {
      const isLegacy = typeof action.payload === 'string';
      const roomId   = isLegacy ? action.payload : action.payload.id;
      const room     = isLegacy ? null            : action.payload.room;

      if (state.byRoomId[roomId]) return;

      const envelope = createRoomEnvelope();

      // ISO-classified rooms are positively pressurized → achValue must be 0.
      // createRoomEnvelope() already defaults to 0. This explicit assignment
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
      if (target) Object.assign(target, data);
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

export const selectEnvelopeByRoomId = (state, roomId) =>
  state.envelope.byRoomId[roomId] ?? createRoomEnvelope();

export const selectActiveEnvelope = (state) => {
  const id = state.room.activeRoomId;
  return state.envelope.byRoomId[id] ?? createRoomEnvelope();
};

export const selectAllEnvelopes = (state) => state.envelope.byRoomId;