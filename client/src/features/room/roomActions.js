// src/features/room/roomActions.js
import { addRoom as addRoomAction } from './roomSlice';
import { initializeRoom } from '../envelope/envelopeSlice';

// A Thunk that adds a room AND initializes its envelope
export const addNewRoom = () => (dispatch, getState) => {
  dispatch(addRoomAction());
  
  // Get the ID of the newly created room (it's set as active in addRoomAction)
  const state = getState();
  const newRoomId = state.room.activeRoomId;
  
  // Create the empty envelope entry immediately
  dispatch(initializeRoom(newRoomId));
};