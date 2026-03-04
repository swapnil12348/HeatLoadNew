// src/features/room/roomActions.js
import { addRoom as addRoomAction } from './roomSlice';
import { initializeRoom } from '../envelope/envelopeSlice';

// Thunk: Adds room AND initializes empty envelope data
export const addNewRoom = () => (dispatch, getState) => {
  // 1. Create the room in roomSlice
  dispatch(addRoomAction());
  
  // 2. Get the new ID (addRoomAction sets activeRoomId)
  const state = getState();
  const newRoomId = state.room.activeRoomId;
  
  // 3. Create the empty envelope in envelopeSlice
  dispatch(initializeRoom(newRoomId));
};