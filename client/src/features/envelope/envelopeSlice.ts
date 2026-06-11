/**
 * envelopeSlice.ts
 * Manages per-room envelope data: building elements (walls, glazing, etc.)
 * and internal loads (people, lights, equipment, infiltration).
 *
 * State shape:
 *   state.envelope.byRoomId  →  { [roomId]: RoomEnvelope }
 *
 * ── CHANGELOG v2.3 ────────────────────────────────────────────────────────────
 *
 *   FIX-ENV-01 — addEnvelopeElement: no category guard caused runtime crash.
 *
 *     If `category` was not one of the six valid keys (walls/roofs/glass/
 *     skylights/partitions/floors), elements[category] was undefined and
 *     .push() threw an uncaught runtime error. Same crash in removeEnvelopeElement
 *     via .filter() on undefined.
 *
 *     Fix: both reducers now return early (no-op) on an unrecognised category,
 *     with a dev-mode console.warn pinpointing the bad dispatch.
 *     updateEnvelopeElement was already safe (used optional chaining ?.find).
 *
 *   FIX-ENV-02 — setInternalLoads: new batch action to prevent triple selector fire.
 *
 *     updateInternalLoad updates a single load type (people | lights | equipment)
 *     per dispatch. Any component initialising or resetting multiple load types
 *     was forced to issue N sequential dispatches, each causing a full
 *     rdsSelector recompute. In a default room with people + lights, this
 *     produced three selector fires: initial (all-zero), after-people, after-lights.
 *
 *     Fix: setInternalLoads accepts a partial { people?, lights?, equipment? }
 *     map and merges all provided sub-objects in a single Redux mutation.
 *     One dispatch → one state change → one selector recompute.
 *
 *     updateInternalLoad is unchanged and correct for single-type edits
 *     triggered by UI input events.
 *
 *   FIX-ENV-03 — field contract: corrected int. → internalLoads. prefix.
 *
 *     The FIELD NOTES section used the shorthand "int.people.count" etc.
 *     The actual stored path from the RoomEnvelope root is
 *     "internalLoads.people.count". The "int" alias is used by rdsSelector
 *     when passing the sub-object to seasonalLoads (internal implementation
 *     detail). Fixed to show the authoritative envelope-side path.
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   INTEGRATION-01 FIX — extraReducers for addRoom / deleteRoom.
 *
 *     roomActions.addNewRoom() previously dispatched addRoomAction() then
 *     initializeRoom() as two separate calls. Between those dispatches the
 *     store was inconsistent: room existed in roomSlice, envelope did not yet
 *     exist here. rdsSelector fired in that window and computed envelopeGains = 0.
 *
 *     Fix: extraReducers cases added for addRoom and deleteRoom (from roomSlice).
 *     Both run in the same Redux mutation as the room action — the two slices
 *     are always consistent after any single dispatch.
 *
 *     initializeRoom and removeRoomEnvelope reducers are RETAINED for edge cases
 *     (direct testing, snapshot restore, manual override). They are no longer
 *     dispatched by roomActions in normal flow.
 *
 *   INTEGRATION-02 FIX — selectEnvelopeByRoomId stable fallback.
 *
 *     Previous: state.envelope.byRoomId[roomId] ?? createRoomEnvelope()
 *     createRoomEnvelope() returns a new object reference on every call.
 *     For a missing roomId, every useSelector call got a different reference →
 *     unnecessary re-renders on any component subscribed to this selector.
 *
 *     Fix: module-level EMPTY_ENVELOPE constant. Stable reference; the fallback
 *     path now never creates a new object.
 *
 *   ⚠️  KNOWN ISSUE — deleteRoom extraReducer fires even on last-room bail-out.
 *
 *     roomSlice.deleteRoom returns early if list.length <= 1, so the last room
 *     is never removed. However, Redux extraReducers fire on the ACTION, not on
 *     whether the primary reducer actually mutated state. If deleteRoom is
 *     dispatched for the last room, this addCase(deleteRoom) still fires and
 *     removes the envelope — leaving a room with no envelope (broken state).
 *
 *     Mitigation: deleteRoomWithCleanup() in roomActions.js mirrors the guard
 *     (short-circuits before dispatch). NEVER dispatch deleteRoom directly.
 *
 *     Full fix would require emitting a separate deleteRoomSuccess action only
 *     when the room is actually deleted, and reacting to that instead. Deferred.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   BUG-SLICE-02 FIX — initializeRoom dispatched with { id, room } payload.
 *
 * ── FIELD NOTES — LOGIC LAYER CONTRACT ───────────────────────────────────────
 *
 *   The following fields are READ DIRECTLY by the calculation modules.
 *   All must be present in the default factory so that parseFloat() and ??
 *   in the calc layer receive a numeric value, never undefined.
 *
 *   Paths are from the RoomEnvelope root (state.envelope.byRoomId[roomId]).
 *   Note: rdsSelector aliases internalLoads as "int" when passing to
 *   seasonalLoads — this is an rdsSelector implementation detail, not the
 *   stored field name. (FIX-ENV-03)
 *
 *   PEOPLE (seasonalLoads.js):
 *     internalLoads.people.count                — occupant count
 *     internalLoads.people.sensiblePerPerson     — ASHRAE HOF Table 1 seated (BTU/hr)
 *     internalLoads.people.latentPerPerson       — ASHRAE HOF Table 1 seated (BTU/hr)
 *
 *   LIGHTS (seasonalLoads.js):
 *     internalLoads.lights.wattsPerSqFt          — installed lighting density
 *     internalLoads.lights.useSchedule           — operating fraction (0–100%)
 *     internalLoads.lights.ballastFactor         — lighting ballast loss multiplier.
 *                                                  seasonalLoads reads:
 *                                                    parseFloat(internalLoads.lights?.ballastFactor)
 *                                                      || ASHRAE.LIGHTING_BALLAST_FACTOR
 *                                                  Without this field the fallback fires
 *                                                  silently and the UI has nothing to bind.
 *                                                  1.0 = LED; T8 fluorescent = 1.2
 *
 *   EQUIPMENT (seasonalLoads.js):
 *     internalLoads.equipment.kw                 — connected load
 *     internalLoads.equipment.sensiblePct        — fraction of kW that is sensible (0–100)
 *     internalLoads.equipment.latentPct          — fraction of kW that is latent   (0–100)
 *     internalLoads.equipment.diversityFactor    — simultaneous load fraction.
 *                                                  seasonalLoads reads:
 *                                                    parseFloat(internalLoads.equipment?.diversityFactor)
 *                                                      ?? ASHRAE.PROCESS_DIVERSITY_FACTOR
 *                                                  The ?? operator falls back ONLY on null |
 *                                                  undefined — 0 and 0.5 pass through correctly.
 *                                                  Without this field the fallback fires silently
 *                                                  and the UI cannot expose it per-room.
 *                                                  1.0 = fully loaded (conservative design).
 *                                                  ASHRAE typical process diversity: 0.75–0.85.
 *
 *   INFILTRATION (seasonalLoads.js):
 *     infiltration.achValue                      — infiltration air changes per hour.
 *                                                  Default 0: positively pressurized / ISO-classified
 *                                                  rooms have zero infiltration by definition.
 *                                                  Reference: ISO 14644-4:2022 §6.4; ASHRAE HOF Ch.16.
 *                                                  Only unpressurized rooms should have non-zero achValue.
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

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { RoomEnvelope, EnvelopeState, RootState, EnvelopeElement, InternalPeople, InternalLights, InternalEquipment, RoomInfiltration } from '../../utils/types';

// ── Cross-slice action imports ────────────────────────────────────────────────
// Used in extraReducers to keep envelopeSlice in sync with roomSlice atomically.
// roomSlice does NOT import from envelopeSlice — no circular dependency.
import { addRoom, deleteRoom } from '../room/roomSlice';

// ── Valid element categories ──────────────────────────────────────────────────
// Used by addEnvelopeElement and removeEnvelopeElement to guard against unknown
// category strings that would cause a runtime crash (push/filter on undefined).
const VALID_ELEMENT_CATEGORIES = new Set([
  'walls', 'roofs', 'glass', 'skylights', 'partitions', 'floors',
]);

// ── Default envelope factory ──────────────────────────────────────────────────
const createRoomEnvelope = (): RoomEnvelope => ({
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
// Used by initializeRoom and extraReducers to enforce achValue = 0 for classified rooms.
const isIsoClassified = (room: any): boolean => {
  const cls = room?.classInOp ?? '';
  return cls !== '' && cls !== 'Unclassified';
};

// ── Stable fallback reference ─────────────────────────────────────────────────
// Module-level constant so selectEnvelopeByRoomId never creates a new object
// when a roomId is missing. New object every call = new reference every call
// = unnecessary re-renders for subscribed components.
const EMPTY_ENVELOPE: RoomEnvelope = createRoomEnvelope();

// ── Initial state ─────────────────────────────────────────────────────────────
const initialState: EnvelopeState = {
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
     * ── NOTE (v2.2): no longer dispatched by roomActions.addNewRoom(). ──
     * The extraReducers case for addRoom now handles initialization atomically.
     * This reducer is retained for manual initialization, snapshot restore,
     * and direct testing. Do not remove.
     *
     * Called when a new room is added (legacy path or manual override).
     * Supports two payload shapes:
     *   string:       initializeRoom('room_xyz')      — legacy
     *   { id, room }: initializeRoom({ id, room })    — preferred (ISO-aware)
     *
     * Guards against re-initialization — existing envelope is never overwritten.
     */
    initializeRoom: (state, action: PayloadAction<string | { id: string; room: any }>) => {
      const isLegacy = typeof action.payload === 'string';
      const roomId   = isLegacy ? (action.payload as string) : (action.payload as { id: string }).id;
      const room     = isLegacy ? null : (action.payload as { room: any }).room;

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
     *
     * FIX-ENV-01: returns early (no-op + dev warn) on unknown category to prevent
     * a runtime crash from .push() on undefined.
     */
    addEnvelopeElement: (state, action: PayloadAction<{ roomId: string; category: string; element: any }>) => {
      const { roomId, category, element } = action.payload;

      // FIX-ENV-01: guard against unknown category — push() on undefined crashes.
      if (!VALID_ELEMENT_CATEGORIES.has(category)) {
        if (import.meta.env.DEV) {
          console.warn(`[envelopeSlice] addEnvelopeElement: unknown category "${category}". ` +
            `Valid: ${[...VALID_ELEMENT_CATEGORIES].join(', ')}`);
        }
        return;
      }

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
     *
     * Safe against unknown category — uses optional chaining ?.find().
     */
    updateEnvelopeElement: (state, action: PayloadAction<{ roomId: string; category: string; id: string; field: string; value: any }>) => {
      const { roomId, category, id, field, value } = action.payload;
      const roomEnv = state.byRoomId[roomId];
      if (!roomEnv) return;
      const item = roomEnv.elements[category]?.find((e: EnvelopeElement) => e.id === id);
      if (item) item[field] = value;
    },

    /**
     * removeEnvelopeElement
     * { roomId, category, id }
     *
     * FIX-ENV-01: returns early (no-op + dev warn) on unknown category to prevent
     * a runtime crash from .filter() on undefined.
     */
    removeEnvelopeElement: (state, action: PayloadAction<{ roomId: string; category: string; id: string }>) => {
      const { roomId, category, id } = action.payload;

      // FIX-ENV-01: guard against unknown category — filter() on undefined crashes.
      if (!VALID_ELEMENT_CATEGORIES.has(category)) {
        if (import.meta.env.DEV) {
          console.warn(`[envelopeSlice] removeEnvelopeElement: unknown category "${category}". ` +
            `Valid: ${[...VALID_ELEMENT_CATEGORIES].join(', ')}`);
        }
        return;
      }

      const roomEnv = state.byRoomId[roomId];
      if (!roomEnv) return;
      roomEnv.elements[category] = roomEnv.elements[category].filter((e: EnvelopeElement) => e.id !== id);
    },

    /**
     * updateInternalLoad
     * Merge-update a single sub-object (people | lights | equipment).
     * { roomId, type, data }  —  type: 'people' | 'lights' | 'equipment'
     *
     * Uses Object.assign (merge) so callers can update a single field
     * without passing the entire sub-object.
     *
     * For updating multiple load types in one dispatch, use setInternalLoads.
     * Dispatching updateInternalLoad N times causes N selector recomputes;
     * setInternalLoads causes exactly one. (FIX-ENV-02)
     */
    updateInternalLoad: (state, action: PayloadAction<{ roomId: string; type: 'people' | 'lights' | 'equipment'; data: any }>) => {
      const { roomId, type, data } = action.payload;
      if (!state.byRoomId[roomId]) {
        state.byRoomId[roomId] = createRoomEnvelope();
      }
      const target = state.byRoomId[roomId].internalLoads[type];
      if (target) Object.assign(target, data);
    },

    /**
     * setInternalLoads  (FIX-ENV-02)
     * Merge-update one or more internal load sub-objects in a single dispatch.
     *
     * This is the correct action for initialization or multi-type resets.
     * It replaces N sequential updateInternalLoad dispatches with one, so
     * rdsSelector recomputes exactly once regardless of how many load types
     * are being set.
     *
     * Only the keys present in `data` are updated; omitted keys are unchanged.
     * Within each sub-object, Object.assign merges the provided fields — partial
     * updates are safe (omit any fields you don't want to change).
     *
     * Example (batch initialization — one dispatch, one recompute):
     *   dispatch(setInternalLoads({
     *     roomId: 'room_1',
     *     data: {
     *       people:    { count: 4 },
     *       lights:    { wattsPerSqFt: 0.5, useSchedule: 80 },
     *       equipment: { kw: 5.0, diversityFactor: 0.80 },
     *     },
     *   }));
     */
    setInternalLoads: (state, action: PayloadAction<{
      roomId: string;
      data: {
        people?:    Partial<InternalPeople>;
        lights?:    Partial<InternalLights>;
        equipment?: Partial<InternalEquipment>;
      };
    }>) => {
      const { roomId, data } = action.payload;
      if (!state.byRoomId[roomId]) {
        state.byRoomId[roomId] = createRoomEnvelope();
      }
      const loads = state.byRoomId[roomId].internalLoads;
      if (data.people    && loads.people)    Object.assign(loads.people,    data.people);
      if (data.lights    && loads.lights)    Object.assign(loads.lights,    data.lights);
      if (data.equipment && loads.equipment) Object.assign(loads.equipment, data.equipment);
    },

    /**
     * updateInfiltration
     * Update a single field on the infiltration object.
     * { roomId, field, value }
     */
    updateInfiltration: (state, action: PayloadAction<{ roomId: string; field: keyof RoomInfiltration; value: any }>) => {
      const { roomId, field, value } = action.payload;
      if (!state.byRoomId[roomId]) {
        state.byRoomId[roomId] = createRoomEnvelope();
      }
      (state.byRoomId[roomId].infiltration as any)[field] = value;
    },

    /**
     * removeRoomEnvelope
     * ── NOTE (v2.2): no longer dispatched by roomActions.deleteRoomWithCleanup(). ──
     * The extraReducers case for deleteRoom now handles removal atomically.
     * This reducer is retained for direct testing and manual cleanup. Do not remove.
     *
     * Original note: called by deleteRoomWithCleanup thunk when a room is deleted.
     * Do not call from UI directly — always go through the thunk so both
     * roomSlice and envelopeSlice stay in sync.
     */
    removeRoomEnvelope: (state, action: PayloadAction<string>) => {
      delete state.byRoomId[action.payload];
    },
  },

  // ── Cross-slice reactivity ──────────────────────────────────────────────────
  extraReducers: (builder) => {
    /**
     * React to roomSlice/addRoom:
     * Initialize the envelope in the same dispatch as the room creation.
     * After this, the store has no window where a room exists without an envelope.
     *
     * Handles both payload shapes from roomSlice.addRoom:
     *   string payload  — legacy: id only, classInOp unknown → default envelope
     *   object payload  — preferred: { id, classInOp, ... } → ISO-aware envelope
     */
    builder.addCase(addRoom, (state, action) => {
      const payload   = action.payload as any;
      const id        = typeof payload === 'string' ? payload : payload.id;
      const classInOp = typeof payload === 'string' ? undefined : payload.classInOp;

      if (!id) return;
      if (state.byRoomId[id]) return; // guard: never overwrite existing envelope

      const envelope = createRoomEnvelope();
      if (isIsoClassified({ classInOp })) {
        envelope.infiltration.achValue = 0; // explicit, even though factory default is 0
      }
      state.byRoomId[id] = envelope;
    });

    /**
     * React to roomSlice/deleteRoom:
     * Remove the envelope in the same dispatch as the room deletion.
     * After this, no orphaned envelope entries remain in byRoomId.
     *
     * ⚠️  LAST-ROOM EDGE CASE (see CHANGELOG v2.2 known issue):
     * deleteRoom's reducer guards against deleting the last room (returns
     * early if list.length <= 1). This extraReducers case fires regardless
     * of whether the primary reducer actually deleted the room — so if
     * deleteRoom is dispatched directly for the last room, the envelope
     * is deleted but the room survives. Always use deleteRoomWithCleanup(),
     * never dispatch deleteRoom directly.
     */
    builder.addCase(deleteRoom, (state, action) => {
      delete state.byRoomId[action.payload];
    });
  },
});

export const {
  initializeRoom,
  addEnvelopeElement,
  updateEnvelopeElement,
  removeEnvelopeElement,
  updateInternalLoad,
  setInternalLoads,
  updateInfiltration,
  removeRoomEnvelope,
} = envelopeSlice.actions;

export default envelopeSlice.reducer;

// ── Selectors ─────────────────────────────────────────────────────────────────

/**
 * selectEnvelopeByRoomId
 * Falls back to EMPTY_ENVELOPE (stable module-level reference) when the roomId
 * is missing. Never calls createRoomEnvelope() at selector time — that would
 * return a new object reference on every invocation for a missing room, causing
 * unnecessary re-renders in any subscribed component.
 */
export const selectEnvelopeByRoomId = (state: RootState, roomId: string): RoomEnvelope =>
  state.envelope.byRoomId[roomId] ?? EMPTY_ENVELOPE;

export const selectActiveEnvelope = (state: RootState): RoomEnvelope => {
  const id = state.room.activeRoomId;
  if (!id) return EMPTY_ENVELOPE;
  return state.envelope.byRoomId[id] ?? EMPTY_ENVELOPE;
};

export const selectAllEnvelopes = (state: RootState) => state.envelope.byRoomId;