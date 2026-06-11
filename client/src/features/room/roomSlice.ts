/**
 * roomSlice.ts
 * Manages the list of conditioned rooms and the active room selection.
 *
 * State shape:
 *   state.room.list          →  Room[]
 *   state.room.activeRoomId  →  string | null
 *
 * ── CHANGELOG v2.4 ────────────────────────────────────────────────────────────
 *
 *   FIX-R7 — makeRoom(): geometry not re-derived after override merge.
 *
 *     makeRoom() accepted overrides verbatim after spreading them into `merged`.
 *     A caller passing conflicting geometry (e.g. { length:20, width:15,
 *     floorArea:400 }) produced a room where length×width ≠ floorArea silently.
 *     The default room overrides happened to be consistent, so no observed failure
 *     — but the factory was unsafe for any programmatic caller.
 *
 *     Fix: after override merge and designDB derivation, re-derive floorArea from
 *     length×width and volume from floorArea×height — matching the invariant
 *     already enforced by updateRoom(). Canonical chain: l → w → floorArea → h → volume.
 *
 *   FIX-R8 — updateRoom(): classInOp change did not sync atRestClass.
 *
 *     Changing classInOp updated minAcph/designAcph from ACPH_RANGES but left
 *     atRestClass at its previous value. The UI displayed a stale atRestClass
 *     after the class changed. Calc layer unaffected (reads minAcph/designAcph
 *     directly), but the inconsistency was misleading.
 *
 *     Fix: atRestClass is synced to the new classInOp value on every classInOp
 *     change. Default behaviour: atRestClass = classInOp (equal classification
 *     at rest). User may subsequently set a stricter (lower ISO number)
 *     atRestClass independently via a direct updateRoom dispatch.
 *
 *   FIX-R9 — selectActiveRoom(): stale activeRoomId silently returned list[0].
 *
 *     If activeRoomId pointed to a non-existent room (stale after a delete bug
 *     or external mutation), the selector silently returned list[0] — the wrong
 *     room — with no diagnostic. Calculations would proceed on wrong room data
 *     with no indication anything was wrong.
 *
 *     Fix: dev-mode console.warn fires when the fallback path is taken and
 *     activeRoomId is non-null. Production behaviour unchanged.
 *
 * ── CHANGELOG v2.3 ────────────────────────────────────────────────────────────
 *
 *   FIX-R1 — makeRoom(): designDB desync when override supplies designDB only.
 *
 *     Guard `if (overrides.designTemp !== undefined && overrides.designDB === undefined)`
 *     left one case unhandled: a caller passing { designDB: X } with no designTemp
 *     produced designTemp=22°C (71.6°F) alongside designDB=X — mismatched inputs
 *     to psychroValidation.validateRoomHumidity().
 *
 *     Fix: remove the conditional entirely. designDB is always re-derived from
 *     merged.designTemp after overrides are merged. It cannot be independently set.
 *
 *   FIX-R2 — updateRoom(): direct volume edit had no height back-calculation.
 *
 *     No `if (field === 'volume')` branch existed. Setting volume directly left
 *     room.height stale (height ≠ volume / floorArea). rdsSelector reads
 *     room.volume directly so calculation was unaffected, but the UI would
 *     display an inconsistent height value.
 *
 *     Fix: added `if (field === 'volume')` branch that back-calculates height
 *     as volume / floorArea (floorArea > 0 guard applied).
 *
 *   FIX-R3 — updateRoom(): direct floorArea edit did not back-calculate width.
 *
 *     The `if (field === 'floorArea')` branch updated volume but left length
 *     and width stale (length × width ≠ floorArea). rdsSelector reads
 *     room.floorArea directly so calculation was unaffected, but the UI
 *     displayed inconsistent dimensions.
 *
 *     Fix: when floorArea is set directly, length is kept fixed and width is
 *     back-calculated as floorArea / length (length > 0 guard applied).
 *
 *   FIX-R5 — generateRoomId exported for shared use with roomActions.js.
 *
 *     The function was duplicated in both files. Now exported from this file;
 *     roomActions.js imports it instead of maintaining its own copy.
 *     TODO: move to src/utils/generateId.ts when convenient.
 *
 *   FIX-R6 — toggleRoomAhu removed from named exports.
 *
 *     Deprecated reducer was still on the public export surface, risking
 *     accidental use by new contributors. Removed from exports. The reducer
 *     body is retained in the slice for backward compatibility with any
 *     in-flight dispatch not yet migrated to setRoomAhu.
 *
 *   NOTE-R4 — New rooms from addNewRoom() start with assignedAhuIds=[].
 *     rdsSelector logs a warning and uses AHU defaults silently. The UI should
 *     surface this as a validation state (badge or icon on rooms where
 *     assignedAhuIds.length === 0). Fix belongs in RoomSidebarItem / RDSRow
 *     — not in this file.
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   INTEGRATION-03 FIX — extraReducers for deleteAHU.
 *
 *     deleteAhuWithCleanup() in roomActions.js previously dispatched
 *     setRoomAhu({ ahuId: null }) N times (once per room that held the AHU)
 *     then dispatched deleteAHU — N+1 separate store mutations, each one
 *     triggering a full rdsSelector recompute.
 *
 *     Fix: extraReducers case added for deleteAHU (from ahuSlice).
 *     All room.assignedAhuIds are cleaned in the same Redux mutation as the
 *     AHU deletion. deleteAhuWithCleanup() is now a single dispatch.
 *
 *     ahuSlice does NOT import from roomSlice — no circular dependency.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   FIX-ROOM-DB-01 — designDB field added to room shape.
 *
 *     psychroValidation.validateRoomHumidity() reads room.designDB (°F).
 *     roomSlice previously stored only designTemp (°C) with no designDB field.
 *     parseFloat(undefined) = NaN caused every room to fail humidity validation
 *     with an invalid-input error before any real humidity check could run.
 *
 *     Fix:
 *       1. makeRoom() includes designDB (°F) derived from designTemp (°C).
 *       2. updateRoom() keeps designDB in sync when designTemp changes.
 *
 *     designDB is a derived/display field — designTemp (°C) remains the canonical
 *     storage field used by seasonalLoads.js and airQuantities.js (cToF conversion).
 *     Conversion: designDB = designTemp × 9/5 + 32  (exact)
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
 *
 * ── designDB IS ALWAYS DERIVED ───────────────────────────────────────────────
 *
 *   designDB (°F) is always computed from designTemp (°C) and can never be
 *   set independently. makeRoom() re-derives it unconditionally after merging
 *   overrides. updateRoom() re-derives it whenever field === 'designTemp'.
 *   Do not dispatch updateRoom({ field: 'designDB', value: X }) — it will be
 *   overwritten on the next designTemp change.
 *
 * ── atRestClass SYNC ──────────────────────────────────────────────────────────
 *
 *   atRestClass is auto-synced to classInOp whenever classInOp changes (FIX-R8).
 *   Default assumption: at-rest classification equals in-operation classification.
 *   To apply a stricter at-rest class (e.g. ISO 6 at rest / ISO 7 in operation),
 *   dispatch a separate updateRoom({ field: 'atRestClass', value: 'ISO 6' })
 *   after the classInOp change. atRestClass will not be overwritten again until
 *   classInOp is next changed.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ACPH_RANGES, IsoClass } from '../../constants/isoCleanroom';
import { Room, RoomState, RootState } from '../../utils/types';

// ── Cross-slice action imports ────────────────────────────────────────────────
// Used in extraReducers to clean up AHU assignments when an AHU is deleted.
// ahuSlice does NOT import from roomSlice — no circular dependency.
import { deleteAHU } from '../ahu/ahuSlice';

// ── ID generator ──────────────────────────────────────────────────────────────
// FIX-R5: exported so roomActions.js can import it instead of duplicating.
// TODO: move to src/utils/generateId.ts when convenient.
export const generateRoomId = (): string =>
  `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

// ── Nested field setter ───────────────────────────────────────────────────────
const setNestedValue = (obj: any, path: string, value: any) => {
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
const cToF_inline = (c: number | string): number | null => {
  const n = parseFloat(String(c));
  return isNaN(n) ? null : parseFloat((n * 9 / 5 + 32).toFixed(1));
};

// ── Room factory ──────────────────────────────────────────────────────────────
/**
 * makeRoom(id, index, overrides)
 * Single source of truth for the default room shape.
 *
 * designDB (°F) is ALWAYS derived from merged.designTemp (°C) after overrides
 * are applied — it cannot be independently set via overrides. (FIX-R1)
 *
 * Geometry (floorArea, volume) is ALWAYS re-derived from the canonical
 * length/width/height chain after overrides are merged — overrides cannot
 * produce an internally inconsistent room. (FIX-R7)
 */
const makeRoom = (id: string, index: number = 0, overrides: Partial<Room> = {}): Room => {
  const base: Room = {
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
    designTemp: 22,    // °C — source of truth; calc modules convert via cToF()
    designDB:   71.6,  // °F — always derived from designTemp; see FIX-R1
    designRH:   50,    // % (0 is valid for dry rooms — keep as number, never null)
    pressure:   15,    // Pa

    // ── Classification ────────────────────────────────────────────────────────
    classInOp:   'ISO 8',
    atRestClass: 'ISO 8',
    recOt:       'REC',
    flpType:     'NFLP',

    // ── ASHRAE 62.1-2022 ventilation category ────────────────────────────────
    ventCategory: 'general',

    // ── Airflow constraints (ACH) ─────────────────────────────────────────────
    minAcph:    10,
    designAcph: 20,

    // ── Fresh air override ────────────────────────────────────────────────────
    manualFreshAir: 0,

    // ── Exhaust air breakdown ─────────────────────────────────────────────────
    exhaustAir: {
      general: 0,
      bibo:    0,
      machine: 0,
    },

    // ── AHU assignment ────────────────────────────────────────────────────────
    assignedAhuIds: [],
  };

  const merged = { ...base, ...overrides } as Room;

  // FIX-R1: designDB is always derived from designTemp — unconditionally.
  // The previous conditional guard left a case unhandled where overrides
  // supplied designDB without designTemp, causing a mismatch.
  const derivedDB = cToF_inline(merged.designTemp);
  if (derivedDB !== null) merged.designDB = derivedDB;

  // FIX-R7: geometry is always re-derived from canonical l/w/h after override merge.
  // Prevents inconsistent rooms if a caller passes conflicting overrides
  // (e.g. { length:20, width:15, floorArea:400 } — l×w≠floorArea).
  // Mirrors the invariant already enforced by updateRoom().
  // Canonical chain: length × width → floorArea → × height → volume.
  const _l = parseFloat(String(merged.length))  || 0;
  const _w = parseFloat(String(merged.width))   || 0;
  const _h = parseFloat(String(merged.height))  || 0;
  if (_l > 0 && _w > 0) merged.floorArea = parseFloat((_l * _w).toFixed(1));
  if (merged.floorArea > 0 && _h > 0) merged.volume = parseFloat((merged.floorArea * _h).toFixed(1));

  return merged;
};

// ── Initial state ─────────────────────────────────────────────────────────────
const initialState: RoomState = {
  activeRoomId: 'room_default_1',
  list: [
    makeRoom('room_default_1', 0, {
      name:        'Production Hall',
      length:      20,
      width:       15,
      height:      4,
      floorArea:   300,
      volume:      1200,
      designTemp:  22,
      designRH:    50,
      pressure:    15,
      classInOp:   'ISO 8',
      atRestClass: 'ISO 8',
      ventCategory: 'general',
      minAcph:     10,
      designAcph:  20,
      assignedAhuIds: ['ahu1'],
    }),
  ],
};

// ── Slice ─────────────────────────────────────────────────────────────────────
const roomSlice = createSlice({
  name: 'room',
  initialState,

  reducers: {
    setActiveRoom: (state, action: PayloadAction<string | null>) => {
      state.activeRoomId = action.payload;
    },

    addRoom: (state, action: PayloadAction<string | Partial<Room>>) => {
      const payload  = action.payload;
      const isLegacy = typeof payload === 'string';
      const id       = isLegacy ? payload : (payload.id ?? generateRoomId());

      let overrides: Partial<Room> = {};
      if (!isLegacy && typeof payload === 'object') {
        overrides = { ...payload };
        delete overrides.id;
      }

      const newRoom = makeRoom(id, state.list.length, overrides);
      state.list.push(newRoom);
      state.activeRoomId = id;
    },

    /**
     * updateRoom
     * { id, field, value }  —  field supports dot-notation paths.
     *
     * Geometry invariants maintained (post-v2.3):
     *   length or width  → floorArea = l × w,  volume = floorArea × h
     *   height           → volume = floorArea × h
     *   floorArea        → volume = fa × h,     width = fa / l  (l > 0)  [FIX-R3]
     *   volume           → height = vol / floorArea  (floorArea > 0)      [FIX-R2]
     *
     * Classification invariant (post-v2.4):
     *   classInOp        → atRestClass synced to same value               [FIX-R8]
     *   User may set atRestClass independently afterward.
     *
     * Note: dispatching field='designDB' directly is not supported — designDB
     * is always derived from designTemp and will be overwritten on the next
     * designTemp change. Set designTemp instead.
     */
    updateRoom: (state, action: PayloadAction<{ id: string; field: string; value: any }>) => {
      const { id, field, value } = action.payload;
      const room = state.list.find(r => r.id === id);
      if (!room) return;

      setNestedValue(room, field, value);

      // Keep designDB (°F) in sync with designTemp (°C).
      if (field === 'designTemp') {
        const derivedDB = cToF_inline(value);
        if (derivedDB !== null) room.designDB = derivedDB;
      }

      if (field === 'classInOp') {
        const acph = ACPH_RANGES[value as IsoClass];
        if (acph) {
          room.minAcph    = acph.min;
          room.designAcph = acph.design;
        }
        // FIX-R8: sync atRestClass to the new classInOp value.
        // Default assumption: at-rest classification = in-operation classification.
        // Dispatch a separate updateRoom({ field: 'atRestClass', value: '...' })
        // afterward to set a stricter at-rest class if required.
        room.atRestClass = value as IsoClass;
      }

      // ── Geometry sync ───────────────────────────────────────────────────────
      // Read current values after setNestedValue has applied the change.
      const l = parseFloat(String(room.length))    || 0;
      const w = parseFloat(String(room.width))     || 0;
      const h = parseFloat(String(room.height))    || 0;

      if (field === 'length' || field === 'width') {
        room.floorArea = parseFloat((l * w).toFixed(1));
        room.volume    = parseFloat((room.floorArea * h).toFixed(1));
      }

      if (field === 'height') {
        room.volume = parseFloat((room.floorArea * h).toFixed(1));
      }

      if (field === 'floorArea') {
        const fa = parseFloat(String(value)) || 0;
        room.volume = parseFloat((fa * h).toFixed(1));
        // FIX-R3: keep length fixed; back-calculate width to stay consistent
        // with the new floor area (length is treated as the primary dimension).
        if (l > 0) room.width = parseFloat((fa / l).toFixed(2));
      }

      // FIX-R2: back-calculate height when volume is set directly.
      if (field === 'volume') {
        const vol = parseFloat(String(value)) || 0;
        if (room.floorArea > 0) room.height = parseFloat((vol / room.floorArea).toFixed(2));
      }
    },

    /**
     * setRoomAhu
     * { roomId, ahuId }  —  assigns a single AHU to a room (radio-button model).
     */
    setRoomAhu: (state, action: PayloadAction<{ roomId: string; ahuId: string | null }>) => {
      const { roomId, ahuId } = action.payload;
      const room = state.list.find(r => r.id === roomId);
      if (room) room.assignedAhuIds = ahuId ? [ahuId] : [];
    },

    /**
     * toggleRoomAhu
     * ⚠️  DEPRECATED — DO NOT USE IN UI CODE.
     *     FIX-R6: removed from named exports (v2.3). Use setRoomAhu instead.
     *     Reducer body retained for backward compatibility with any dispatch
     *     not yet migrated; it will be removed in a future cleanup pass.
     */
    toggleRoomAhu: (state, action: PayloadAction<{ roomId: string; ahuId: string }>) => {
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
     *
     * NOTE: Always call deleteRoomWithCleanup() from roomActions.js rather
     * than dispatching this directly. The thunk mirrors this length guard
     * so it short-circuits before dispatch — preventing the edge case where
     * the guard returns early here but envelopeSlice.extraReducers still fires
     * and deletes the envelope for a room that wasn't actually removed.
     */
    deleteRoom: (state, action: PayloadAction<string>) => {
      if (state.list.length <= 1) return;
      const id   = action.payload;
      state.list = state.list.filter(r => r.id !== id);
      if (state.activeRoomId === id) {
        state.activeRoomId = state.list[0].id;
      }
    },
  },

  // ── Cross-slice reactivity ──────────────────────────────────────────────────
  extraReducers: (builder) => {
    /**
     * React to ahuSlice/deleteAHU:
     * Clear the deleted AHU's ID from every room's assignedAhuIds in the same
     * Redux mutation as the AHU deletion.
     *
     * Previously: deleteAhuWithCleanup() dispatched setRoomAhu({ ahuId: null })
     * N times (once per affected room) then deleteAHU — N+1 store mutations.
     * Each mutation triggered a full rdsSelector recompute.
     *
     * Now: single dispatch, single store mutation, zero intermediate states
     * where rooms hold a reference to a deleted AHU.
     */
    builder.addCase(deleteAHU, (state, action) => {
      const ahuId = action.payload;
      state.list.forEach(room => {
        room.assignedAhuIds = room.assignedAhuIds.filter(id => id !== ahuId);
      });
    });
  },
});

export const {
  setActiveRoom,
  addRoom,
  updateRoom,
  setRoomAhu,
  // toggleRoomAhu intentionally omitted — FIX-R6 (v2.3). Use setRoomAhu.
  deleteRoom,
} = roomSlice.actions;

export default roomSlice.reducer;

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectAllRooms = (state: RootState) => state.room.list;

export const selectActiveRoomId = (state: RootState) => state.room.activeRoomId;

/**
 * selectActiveRoom
 * Returns the room matching activeRoomId, falling back to list[0] if the ID
 * is stale. In development, a console.warn fires on the fallback path to
 * surface stale-ID bugs immediately. (FIX-R9)
 */
export const selectActiveRoom = (state: RootState) => {
  const room = state.room.list.find(r => r.id === state.room.activeRoomId);
  if (!room && import.meta.env.DEV && state.room.activeRoomId !== null) {
    console.warn(
      `[roomSlice] selectActiveRoom: activeRoomId="${state.room.activeRoomId}" ` +
      `not found in list — falling back to list[0]. Possible stale ID.`
    );
  }
  return room ?? state.room.list[0] ?? null;
};

export const selectRoomById = (state: RootState, id: string) =>
  state.room.list.find(r => r.id === id) ?? null;