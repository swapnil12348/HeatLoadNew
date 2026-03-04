// src/features/room/roomActions.js
import { addRoom as addRoomAction, deleteRoom } from './roomSlice';
import { initializeRoom, removeRoomEnvelope } from '../envelope/envelopeSlice';

// Thunk: Adds room AND initializes empty envelope data
export const addNewRoom = () => (dispatch, getState) => {
  dispatch(addRoomAction());
  const state = getState();
  const newRoomId = state.room.activeRoomId;
  dispatch(initializeRoom(newRoomId));
};

// Thunk: Deletes room AND cleans up its envelope data
export const deleteRoomWithCleanup = (roomId) => (dispatch) => {
  dispatch(deleteRoom(roomId));
  dispatch(removeRoomEnvelope(roomId));
};