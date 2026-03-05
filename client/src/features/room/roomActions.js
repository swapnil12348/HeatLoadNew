// src/features/room/roomActions.js
import { addRoom as addRoomAction, deleteRoom } from './roomSlice';
import { initializeRoom, removeRoomEnvelope } from '../envelope/envelopeSlice';

// ── ID generator — duplicated here from roomSlice so the thunk owns the ID ───
// FLOW-06 FIX: previously addNewRoom() dispatched addRoomAction() and then
// read state.room.activeRoomId to get the new room's ID.
// That works only because addRoom() happens to set activeRoomId synchronously.
// If addRoom() were ever refactored to NOT set activeRoomId (e.g. to support
// bulk import), initializeRoom() would receive the wrong ID silently.
//
// Fix: generate the ID HERE in the thunk before any dispatch.
// Pass it explicitly to both addRoomAction and initializeRoom.
// Neither call depends on the other's side-effects — fully decoupled.
const generateRoomId = () =>
  `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

/**
 * addNewRoom()
 * Thunk: creates a new room AND initializes its envelope data atomically.
 *
 * The ID is generated once here and passed explicitly to both slices.
 * This eliminates the dependency on addRoom() setting activeRoomId as a
 * side-effect before getState() is called.
 */
export const addNewRoom = () => (dispatch) => {
  const newId = generateRoomId();

  // Both dispatches use the same pre-generated ID — no getState() needed.
  dispatch(addRoomAction(newId));     // roomSlice: add room with this ID
  dispatch(initializeRoom(newId));    // envelopeSlice: create empty envelope
};

/**
 * deleteRoomWithCleanup(roomId)
 * Thunk: removes room from roomSlice AND its envelope from envelopeSlice.
 * FLOW-05 FIX (applied in RoomDetailPanel.jsx Step 3).
 */
export const deleteRoomWithCleanup = (roomId) => (dispatch) => {
  dispatch(deleteRoom(roomId));
  dispatch(removeRoomEnvelope(roomId));
};