// src/features/room/roomActions.js
/**
 * roomActions.js
 * Thunks for cross-slice room operations.
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   INTEGRATION-01 FIX — addNewRoom(): sequential dispatch eliminated.
 *
 *     Previously dispatched addRoomAction() then initializeRoom() as two
 *     separate calls. Between those two dispatches the store was in a
 *     structurally inconsistent state: the room existed in roomSlice but its
 *     envelope did not yet exist in envelopeSlice. rdsSelector ran against
 *     that gap, logged "no envelope found", and computed envelopeGains = 0
 *     for one spurious render cycle.
 *
 *     Fix: envelopeSlice now has an extraReducers case for addRoom — the
 *     envelope is initialized in the same Redux mutation as the room, atomically.
 *     The initializeRoom dispatch in addNewRoom() is removed; it is redundant.
 *
 *   INTEGRATION-02 FIX — deleteRoomWithCleanup(): sequential dispatch eliminated.
 *
 *     Previously dispatched deleteRoom() then removeRoomEnvelope() separately.
 *     envelopeSlice.extraReducers now reacts to deleteRoom atomically.
 *     The removeRoomEnvelope dispatch is removed.
 *
 *     The length-guard (cannot delete last room) is duplicated in this thunk
 *     so we short-circuit before any dispatch — avoiding the edge case where
 *     deleteRoom's reducer returns early but envelopeSlice still fires.
 *
 *   INTEGRATION-03 FIX — deleteAhuWithCleanup(): N+1 dispatch loop eliminated.
 *
 *     Previously dispatched setRoomAhu({ ahuId: null }) once per assigned room,
 *     then deleteAHU — N+1 dispatches causing N+1 selector recomputes.
 *     roomSlice.extraReducers now reacts to deleteAHU and clears all assignments
 *     atomically. deleteAhuWithCleanup is now a single dispatch.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   BUG-SLICE-01 FIX — addNewRoom(): ISO class and ACPH now self-consistent.
 *
 *     Previous code called getAcphDefaults('ISO 7') but left the room with
 *     makeRoom()'s default classInOp: 'ISO 8'. Every new room was an ISO 8
 *     room running at ISO 7 ACPH values. Fixed: DEFAULT_NEW_ROOM_CLASS is the
 *     single source of truth for both fields.
 *
 *   BUG-SLICE-02 FIX — initializeRoom dispatched with { id, room } payload.
 *
 *     Previous: dispatch(initializeRoom(newId)) — legacy string form.
 *     envelopeSlice on that path set room = null so isIsoClassified(null)
 *     always returned false, meaning the ISO pressurization guard (achValue = 0)
 *     never fired for thunk-created rooms.
 *     Fixed: initializeRoom now receives { id, room: { classInOp } }.
 *     (This dispatch has been removed in v2.2 — extraReducers replaces it.)
 */

import { addRoom as addRoomAction, deleteRoom } from './roomSlice';
import { deleteAHU }                            from '../ahu/ahuSlice';
import { getAcphDefaults }                      from '../../constants/isoCleanroom';
import { generateId } from '../../utils/generateId';

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
 * Thunk: creates a new room with a single atomic dispatch.
 *
 * envelopeSlice.extraReducers reacts to addRoom and initializes the envelope
 * in the same Redux mutation — the store is NEVER in a room-without-envelope
 * state between dispatches.
 */
export const addNewRoom = () => (dispatch) => {
  const newId = generateId('room');
  const { minAcph, designAcph } = getAcphDefaults(DEFAULT_NEW_ROOM_CLASS);

  dispatch(addRoomAction({
    id:          newId,
    classInOp:   DEFAULT_NEW_ROOM_CLASS,
    atRestClass: DEFAULT_NEW_ROOM_CLASS,
    minAcph,
    designAcph,
  }));
  // initializeRoom dispatch REMOVED (v2.2).
  // envelopeSlice.extraReducers handles envelope initialization atomically.
};

/**
 * deleteRoomWithCleanup(roomId)
 * Thunk: removes a room with a single atomic dispatch.
 *
 * envelopeSlice.extraReducers reacts to deleteRoom and removes the envelope
 * in the same Redux mutation — no envelope leak is possible.
 *
 * The length guard here mirrors deleteRoom's reducer guard so we short-circuit
 * before dispatch: if we dispatched and the reducer returned early (no room
 * deleted), envelopeSlice would still fire and delete the envelope — leaving
 * a room without an envelope. Guard here prevents that edge case.
 *
 * Always use this thunk instead of calling deleteRoom() directly.
 */
export const deleteRoomWithCleanup = (roomId) => (dispatch, getState) => {
  if (getState().room.list.length <= 1) return; // mirrors deleteRoom reducer guard
  dispatch(deleteRoom(roomId));
  // removeRoomEnvelope dispatch REMOVED (v2.2).
  // envelopeSlice.extraReducers handles envelope removal atomically.
};

/**
 * deleteAhuWithCleanup(ahuId)
 * Thunk: removes an AHU with a single atomic dispatch.
 *
 * roomSlice.extraReducers reacts to deleteAHU and clears the ahuId from
 * every room's assignedAhuIds in the same Redux mutation.
 *
 * Always use this thunk instead of calling deleteAHU() directly.
 *
 * @param {string} ahuId — ID of the AHU to delete
 */
export const deleteAhuWithCleanup = (ahuId) => (dispatch) => {
  dispatch(deleteAHU(ahuId));
  // setRoomAhu loop REMOVED (v2.2).
  // roomSlice.extraReducers handles AHU assignment cleanup atomically.
};