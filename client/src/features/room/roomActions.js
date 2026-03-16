// src/features/room/roomActions.js
/**
 * roomActions.js
 * Thunks for cross-slice room operations.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   BUG-SLICE-01 FIX — addNewRoom(): ISO class and ACPH now self-consistent.
 *
 *     Previous code called getAcphDefaults('ISO 7') but left the room with
 *     makeRoom()'s default classInOp: 'ISO 8'. Every new room was an ISO 8
 *     room running at ISO 7 ACPH values — decoupled. isoValidation read
 *     classInOp: 'ISO 8' so the room never validated correctly as ISO 7.
 *
 *     Fix: DEFAULT_NEW_ROOM_CLASS is the single source of truth for both
 *     classification fields AND ACPH defaults. Changing it aligns both atomically.
 *
 *   BUG-SLICE-02 FIX — initializeRoom dispatched with { id, room } payload.
 *
 *     Previous: dispatch(initializeRoom(newId)) — legacy string form.
 *     envelopeSlice on the legacy path sets room = null, so isIsoClassified(null)
 *     always returned false — the ISO pressurization guard (achValue = 0)
 *     never fired for any thunk-created room, risking phantom infiltration loads
 *     on future factory-default changes.
 *
 *     Fix: dispatch initializeRoom({ id, room: { classInOp } }) so the
 *     isIsoClassified() guard receives a real room object and fires correctly.
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
 * Single source of truth for both classInOp and ACPH defaults in addNewRoom().
 * ISO 8 is the correct default: the most common starting classification for
 * support areas, gowning rooms, and general cleanroom spaces.
 */
const DEFAULT_NEW_ROOM_CLASS = 'ISO 8';

/**
 * addNewRoom()
 * Thunk: creates a new room AND initializes its envelope atomically.
 * classInOp, atRestClass, and ACPH defaults all derived from DEFAULT_NEW_ROOM_CLASS.
 */
export const addNewRoom = () => (dispatch) => {
  const newId = generateRoomId();
  const { minAcph, designAcph } = getAcphDefaults(DEFAULT_NEW_ROOM_CLASS);

  dispatch(addRoomAction({
    id:          newId,
    classInOp:   DEFAULT_NEW_ROOM_CLASS,
    atRestClass: DEFAULT_NEW_ROOM_CLASS,
    minAcph,
    designAcph,
  }));

  // Pass { id, room } payload so envelopeSlice.isIsoClassified() guard
  // receives a real room object and can enforce achValue = 0 for ISO rooms.
  dispatch(initializeRoom({
    id:   newId,
    room: { classInOp: DEFAULT_NEW_ROOM_CLASS },
  }));
};

/**
 * deleteRoomWithCleanup(roomId)
 * Thunk: removes room from roomSlice AND its envelope from envelopeSlice.
 * Plain deleteRoom() only removes from roomSlice.list —
 * envelopeSlice.byRoomId[id] would leak memory on every delete.
 */
export const deleteRoomWithCleanup = (roomId) => (dispatch) => {
  dispatch(deleteRoom(roomId));
  dispatch(removeRoomEnvelope(roomId));
};

/**
 * deleteAhuWithCleanup(ahuId)
 * Thunk: removes AHU from ahuSlice AND clears its assignment from all rooms.
 *
 * Plain deleteAHU() leaves stale ahuId in room.assignedAhuIds. After deletion,
 * rdsSelector returns ahuId: '' and typeOfUnit: '-' for every affected room
 * with no warning — silently reverting all those rooms to Recirculating type.
 *
 * This thunk clears all room assignments BEFORE removing the AHU.
 * Order matters: clear first, then remove, so no intermediate state has
 * rooms pointing to a non-existent AHU.
 *
 * @param {string} ahuId — ID of the AHU to delete
 */
export const deleteAhuWithCleanup = (ahuId) => (dispatch, getState) => {
  const rooms = getState().room.list;

  rooms.forEach(room => {
    if (room.assignedAhuIds.includes(ahuId)) {
      dispatch(setRoomAhu({ roomId: room.id, ahuId: null }));
    }
  });

  dispatch(deleteAHU(ahuId));
};