// src/features/room/roomActions.js
/**
 * roomActions.js
 * Thunks for cross-slice room operations.
 *
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   BUG-SLICE-01 FIX — addNewRoom(): ISO class and ACPH now self-consistent.
 *
 *     Previous code called getAcphDefaults('ISO 7') but left the room with
 *     makeRoom()'s default classInOp: 'ISO 8'. Result: every new room was an
 *     ISO 8 room (per isoValidation) running at ISO 7 ACPH values — decoupled.
 *
 *     isoValidation.validateAcph() reads governingClass() → classInOp → 'ISO 8',
 *     then checks actual ACPH against ISO 8 minimum (10 ACPH). At designAcph=90
 *     (ISO 7 level) the room trivially passes ISO 8 but is never validated as
 *     ISO 7, masking an energy/cost sizing mismatch.
 *
 *     Fix: DEFAULT_CLASS is the single source of truth for both the room's
 *     classification fields AND the ACPH defaults derived from it.
 *     Changing DEFAULT_CLASS automatically aligns both.
 *
 *   BUG-SLICE-02 FIX — initializeRoom now dispatched with { id, room } payload.
 *
 *     Previous: dispatch(initializeRoom(newId))   — legacy string form.
 *     In envelopeSlice, the legacy string path sets room = null, so
 *     isIsoClassified(null) always returns false — the ISO pressurization
 *     guard (achValue = 0) never fired for any thunk-created room.
 *
 *     The guard exists to enforce that positively pressurized ISO-classified
 *     rooms always start with achValue = 0 (no infiltration). Without it, a
 *     future change to createRoomEnvelope()'s default achValue could silently
 *     add phantom infiltration loads to every new cleanroom.
 *
 *     Fix: dispatch initializeRoom({ id, room: { classInOp } }) so the
 *     isIsoClassified() guard receives a real room object and can fire correctly.
 */

import { addRoom as addRoomAction, deleteRoom, setRoomAhu } from './roomSlice';
import { initializeRoom, removeRoomEnvelope }               from '../envelope/envelopeSlice';
import { deleteAHU }                                        from '../ahu/ahuSlice';
import { getAcphDefaults }                                  from '../../constants/isoCleanroom';

// ── ID generator ──────────────────────────────────────────────────────────────
const generateRoomId = () =>
  `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

/**
 * Default ISO classification for newly created rooms.
 *
 * BUG-SLICE-01 FIX: single source of truth for both classInOp and ACPH defaults.
 * Previously these were decoupled: getAcphDefaults('ISO 7') was called but the
 * room was created with classInOp: 'ISO 8' (makeRoom default).
 *
 * Change this constant to change the default for all new rooms atomically.
 * ISO 8 is the correct default: the most common starting classification for
 * support areas, gowning rooms, and general cleanroom spaces. Engineers
 * upgrade the class via the RoomConfig page.
 */
const DEFAULT_NEW_ROOM_CLASS = 'ISO 8';

/**
 * addNewRoom()
 * Thunk: creates a new room AND initializes its envelope atomically.
 *
 * BUG-SLICE-01 FIX: classInOp, atRestClass, and ACPH defaults all derived
 * from DEFAULT_NEW_ROOM_CLASS — guaranteed self-consistent.
 *
 * BUG-SLICE-02 FIX: initializeRoom dispatched with { id, room } payload so
 * envelopeSlice.isIsoClassified() guard fires correctly for ISO-classified rooms.
 */
export const addNewRoom = () => (dispatch) => {
  const newId = generateRoomId();

  // BUG-SLICE-01 FIX: ACPH defaults derived from the SAME class we assign.
  // getAcphDefaults reads from ACPH_RANGES in isoCleanroom.js.
  const { minAcph, designAcph } = getAcphDefaults(DEFAULT_NEW_ROOM_CLASS);

  dispatch(addRoomAction({
    id:          newId,
    classInOp:   DEFAULT_NEW_ROOM_CLASS,   // BUG-SLICE-01 FIX: was implicit 'ISO 8' from makeRoom
    atRestClass: DEFAULT_NEW_ROOM_CLASS,   // BUG-SLICE-01 FIX: was implicit 'ISO 8' from makeRoom
    minAcph,                               // BUG-SLICE-01 FIX: now matches DEFAULT_NEW_ROOM_CLASS
    designAcph,                            // BUG-SLICE-01 FIX: now matches DEFAULT_NEW_ROOM_CLASS
  }));

  // BUG-SLICE-02 FIX: pass { id, room } payload instead of bare string.
  // envelopeSlice.initializeRoom checks typeof payload === 'string' (legacy path)
  // and only calls isIsoClassified(room) on the object path.
  // With the legacy string: room = null → isIsoClassified(null) = false → guard skipped.
  // With object payload: room = { classInOp } → guard fires correctly for ISO rooms.
  dispatch(initializeRoom({
    id:   newId,
    room: { classInOp: DEFAULT_NEW_ROOM_CLASS },
  }));
};

/**
 * deleteRoomWithCleanup(roomId)
 * Thunk: removes room from roomSlice AND its envelope from envelopeSlice.
 *
 * FLOW-05 FIX (v2.0): plain deleteRoom() only removes from roomSlice.list —
 * envelopeSlice.byRoomId[id] leaked memory on every delete.
 */
export const deleteRoomWithCleanup = (roomId) => (dispatch) => {
  dispatch(deleteRoom(roomId));
  dispatch(removeRoomEnvelope(roomId));
};

/**
 * deleteAhuWithCleanup(ahuId)
 * Thunk: removes AHU from ahuSlice AND clears its assignment from all rooms.
 *
 * BUG-SLICE-04 FIX: plain deleteAHU() left stale ahuId in room.assignedAhuIds.
 * After deletion, rdsSelector's ahus.find() returned undefined → ahu = {} →
 * typeOfUnit: '-' and ahuId: '' for every affected room, with no warning to
 * the engineer. In a project with many rooms on one AHU, all silently reverted
 * to Recirculating type.
 *
 * This thunk clears all room assignments first, then removes the AHU.
 * The order matters: clear assignments before removal so no intermediate
 * state has rooms pointing to a non-existent AHU.
 *
 * @param {string} ahuId — ID of the AHU to delete
 */
export const deleteAhuWithCleanup = (ahuId) => (dispatch, getState) => {
  const rooms = getState().room.list;

  // Clear this AHU from every room that references it.
  // setRoomAhu({ roomId, ahuId: null }) sets assignedAhuIds = [].
  rooms.forEach(room => {
    if (room.assignedAhuIds.includes(ahuId)) {
      dispatch(setRoomAhu({ roomId: room.id, ahuId: null }));
    }
  });

  // Now safe to remove — no room references the deleted AHU.
  dispatch(deleteAHU(ahuId));
};