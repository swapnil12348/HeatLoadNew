/**
 * useRoomSidebar.js
 * Responsibility: All selector and dispatch logic for the room sidebar.
 *
 * Separates data concerns from rendering so RoomSidebarItem
 * stays a pure presentational component.
 *
 * Returns:
 *   rooms         — full room list from roomSlice
 *   activeRoomId  — currently active room id
 *   totalAreaM2   — sum of all room floor areas (m²)
 *   onAddRoom     — dispatch addNewRoom()
 *   onSelectRoom  — dispatch setActiveRoom(id)
 *   onDeleteRoom  — dispatch deleteRoomWithCleanup(id) with confirm
 */

import { useCallback }   from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  selectAllRooms,
  selectActiveRoomId,
  setActiveRoom,
} from '../features/room/roomSlice';
import { addNewRoom }              from '../features/room/roomActions';
import { deleteRoomWithCleanup }   from '../features/room/roomActions';

const useRoomSidebar = () => {
  const dispatch     = useDispatch();
  const rooms        = useSelector(selectAllRooms);
  const activeRoomId = useSelector(selectActiveRoomId);

  // Pre-compute total conditioned area for footer stat
  const totalAreaM2 = rooms.reduce(
    (sum, r) => sum + (parseFloat(r.floorArea) || 0), 0
  );

  const onAddRoom = useCallback(() => {
    dispatch(addNewRoom());
  }, [dispatch]);

  const onSelectRoom = useCallback((id) => {
    dispatch(setActiveRoom(id));
  }, [dispatch]);

  // FLOW-05 FIX: deleteRoomWithCleanup removes from roomSlice AND
  // envelopeSlice atomically — plain deleteRoom leaves envelope data behind.
  const onDeleteRoom = useCallback((id, name) => {
    if (window.confirm(`Delete "${name || 'this room'}"? This cannot be undone.`)) {
      dispatch(deleteRoomWithCleanup(id));
    }
  }, [dispatch]);

  return {
    rooms,
    activeRoomId,
    totalAreaM2,
    onAddRoom,
    onSelectRoom,
    onDeleteRoom,
  };
};

export default useRoomSidebar;