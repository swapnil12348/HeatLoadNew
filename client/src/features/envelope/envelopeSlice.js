import { createSlice } from '@reduxjs/toolkit';

// ── Default State Factory ────────────────────────────────────────────────────
// FIX CRIT-03: Default achValue changed from 0.5 to 0.
//
// Rationale: Positively pressurized rooms (all ISO-classified cleanrooms,
// pharma grades, battery dry rooms) have ZERO infiltration by definition —
// positive differential pressure forces air OUT through leaks, preventing
// external air from entering. Defaulting to 0.5 ACH added phantom sensible
// and latent loads to every cleanroom in the project.
//
// For genuinely unclassified / unpressurized rooms where infiltration IS real,
// the user should explicitly set achValue via the Infiltration section of the
// Envelope Config tab. Typical values: 0.25–0.5 ACH (perimeter offices),
// 0.1–0.25 ACH (well-sealed industrial), 0 (any pressurized space).
//
// Reference: ASHRAE HOF 2021 Ch.16 — Infiltration;
//            ISO 14644-4:2022 §6.4 — Pressurization requirements.
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
    people:    { count: 0, sensiblePerPerson: 245, latentPerPerson: 205 },
    lights:    { wattsPerSqFt: 0, useSchedule: 100 },
    equipment: { kw: 0, sensiblePct: 100, latentPct: 0 },
  },
  infiltration: {
    method:   'ach',
    achValue: 0,   // FIX CRIT-03: was 0.5 — zero is the safe default for pressurized spaces
    cfmValue: 0,
    doors:    [],
  },
});

// ── ISO Classification Guard ─────────────────────────────────────────────────
// Returns true for any room that carries an ISO cleanroom classification.
// These rooms are positively pressurized → infiltration must be 0.
// "Unclassified" and falsy values are treated as unpressurized (user may
// set a non-zero ACH if appropriate for their space).
const isIsoClassified = (room) => {
  const cls = room?.classInOp ?? '';
  return cls !== '' && cls !== 'Unclassified';
};

const initialState = {
  byRoomId: {
    // Initialize the default room defined in roomSlice
    room_default_1: createRoomEnvelope(),
  },
};

const envelopeSlice = createSlice({
  name: 'envelope',
  initialState,
  reducers: {
    // 1. Initialize: Called when a Room is added in RDS or Sidebar
    // FIX CRIT-03: Accept optional room object so we can check ISO classification
    // on creation and keep achValue at 0 for pressurized rooms.
    // Caller signature (both cases supported):
    //   dispatch(initializeRoom(roomId))              — legacy, achValue stays 0
    //   dispatch(initializeRoom({ id, room }))        — preferred, ISO-aware
    initializeRoom: (state, action) => {
      // Support both legacy string payload and new { id, room } object payload
      const isLegacy = typeof action.payload === 'string';
      const roomId   = isLegacy ? action.payload : action.payload.id;
      const room     = isLegacy ? null            : action.payload.room;

      if (state.byRoomId[roomId]) return; // already initialized — don't overwrite

      const envelope = createRoomEnvelope();

      // FIX CRIT-03: ISO-classified rooms are pressurized — achValue must be 0.
      // createRoomEnvelope() already defaults to 0, but we make the intent
      // explicit here so a future change to the factory default can't silently
      // re-introduce phantom loads for classified rooms.
      if (isIsoClassified(room)) {
        envelope.infiltration.achValue = 0;
      }

      state.byRoomId[roomId] = envelope;
    },

    // 2. Add Element: Walls, Glass, etc.
    addEnvelopeElement: (state, action) => {
      const { roomId, category, element } = action.payload;
      if (!state.byRoomId[roomId]) state.byRoomId[roomId] = createRoomEnvelope();

      state.byRoomId[roomId].elements[category].push({
        ...element,
        id: Date.now().toString(),
      });
    },

    // 3. Update Element: Edit U-Value, Area, etc.
    updateEnvelopeElement: (state, action) => {
      const { roomId, category, id, field, value } = action.payload;
      const roomEnv = state.byRoomId[roomId];
      if (roomEnv) {
        const item = roomEnv.elements[category].find(e => e.id === id);
        if (item) item[field] = value;
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

    // 5. Update Internal Loads (People / Lights / Equipment)
    // Used by both Envelope Tab AND RDS Grid (Direct Editing)
    updateInternalLoad: (state, action) => {
      const { roomId, type, data } = action.payload;
      if (!state.byRoomId[roomId]) state.byRoomId[roomId] = createRoomEnvelope();

      const target = state.byRoomId[roomId].internalLoads[type];
      Object.assign(target, data); // merge — preserves unchanged fields
    },

    // 6. Update Infiltration
    updateInfiltration: (state, action) => {
      const { roomId, field, value } = action.payload;
      if (!state.byRoomId[roomId]) state.byRoomId[roomId] = createRoomEnvelope();

      state.byRoomId[roomId].infiltration[field] = value;
    },

    // 7. Cleanup: When a room is deleted in roomSlice
    removeRoomEnvelope: (state, action) => {
      const roomId = action.payload;
      delete state.byRoomId[roomId];
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

// ── Selectors ─────────────────────────────────────────────────────────────────

// Get specific envelope (used by calculation utilities)
export const selectEnvelopeByRoomId = (state, roomId) =>
  state.envelope.byRoomId[roomId] || createRoomEnvelope();

// Get active room's envelope (used by Envelope Config Tab UI)
export const selectActiveEnvelope = (state) => {
  const activeRoomId = state.room.activeRoomId;
  return state.envelope.byRoomId[activeRoomId] || createRoomEnvelope();
};

export default envelopeSlice.reducer;