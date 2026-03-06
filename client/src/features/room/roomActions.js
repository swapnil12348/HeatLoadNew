// src/features/room/roomActions.js
import { addRoom as addRoomAction, deleteRoom } from './roomSlice';
import { initializeRoom, removeRoomEnvelope }   from '../envelope/envelopeSlice';
import { getAcphDefaults }                       from '../../constants/isoCleanroom';

// ── ID generator ──────────────────────────────────────────────────────────────
// FLOW-06 FIX: generate ID here in the thunk before any dispatch.
// Neither addRoomAction nor initializeRoom depend on each other's side-effects.
const generateRoomId = () =>
  `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

/**
 * addNewRoom()
 * Thunk: creates a new room AND initializes its envelope atomically.
 *
 * ACPH defaults are pre-populated from isoCleanroom.js based on the
 * room's default ISO classification (ISO 7 for new rooms).
 * This means minAcph and designAcph are never 0 on a freshly created room —
 * the selector can immediately compute a valid supply air value.
 */
export const addNewRoom = () => (dispatch) => {
  const newId = generateRoomId();

  // getAcphDefaults reads from ACPH_RANGES in isoCleanroom.js.
  // New rooms default to ISO 7 (GMP Grade C — most common in our target markets).
  // This matches makeRoom()'s atRestClass default in roomSlice.
  const { minAcph, designAcph } = getAcphDefaults('ISO 7');

  // Pass the pre-computed ACPH defaults alongside the ID.
  // roomSlice.addRoom() merges these into the makeRoom() template.
  dispatch(addRoomAction({
    id: newId,
    minAcph,
    designAcph,
  }));

  // Envelope initialized with same ID — fully decoupled from addRoomAction.
  dispatch(initializeRoom(newId));
};

/**
 * deleteRoomWithCleanup(roomId)
 * Thunk: removes room from roomSlice AND its envelope from envelopeSlice.
 *
 * FLOW-05 FIX: plain deleteRoom() only removes from roomSlice.list —
 * envelopeSlice.byRoomId[id] leaks memory on every delete.
 * This thunk removes from both slices atomically.
 */
export const deleteRoomWithCleanup = (roomId) => (dispatch) => {
  dispatch(deleteRoom(roomId));
  dispatch(removeRoomEnvelope(roomId));
};