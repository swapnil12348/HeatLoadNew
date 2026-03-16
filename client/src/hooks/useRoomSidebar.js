/**
 * useRoomSidebar.js
 * Responsibility: All selector and dispatch logic for the room sidebar.
 *
 * Separates data concerns from rendering so RoomSidebarItem
 * stays a pure presentational component.
 *
 * -- CHANGELOG ----------------------------------------------------------------
 *
 *   v2.0 — totalAreaM2 source documented and aligned with useProjectTotals.
 *
 *     This hook reads room.floorArea from roomSlice (m²).
 *     useProjectTotals reads rdsRow.floorArea (ft², converted back to m²).
 *     Both report a "total area" figure — numerically they should agree within
 *     floating-point precision. If they differ significantly, a room's floorArea
 *     has been updated in roomSlice but the RDS row has not yet recomputed
 *     (possible during a dispatch/selector batching edge case).
 *
 *     To keep all KPI figures self-consistent, UI components should read
 *     totalAreaM2 from ONE source. Prefer useProjectTotals.totalAreaM2 for
 *     results pages — it is derived from the same rdsRows that drive all other
 *     KPI figures. useRoomSidebar.totalAreaM2 is acceptable for the sidebar
 *     footer only — it shows a live estimate while the user edits rooms,
 *     before the RDS selector has recomputed.
 *
 *   v2.1 — Duplicate roomActions import merged into single import statement.
 *         — Stale inline fix-tag annotations removed; domain reasoning preserved.
 *
 * Returns:
 *   rooms         — full room list from roomSlice
 *   activeRoomId  — currently active room id
 *   totalAreaM2   — sum of all room floor areas (m², from roomSlice — live)
 *   onAddRoom     — dispatch addNewRoom()
 *   onSelectRoom  — dispatch setActiveRoom(id)
 *   onDeleteRoom  — dispatch deleteRoomWithCleanup(id) with confirm
 */

import { useCallback }              from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  selectAllRooms,
  selectActiveRoomId,
  setActiveRoom,
}                                   from '../features/room/roomSlice';
import {
  addNewRoom,
  deleteRoomWithCleanup,
}                                   from '../features/room/roomActions';

const useRoomSidebar = () => {
  const dispatch     = useDispatch();
  const rooms        = useSelector(selectAllRooms);
  const activeRoomId = useSelector(selectActiveRoomId);

  // totalAreaM2: live sum from roomSlice (m²).
  // Use for sidebar footer display only — see changelog note on source alignment
  // with useProjectTotals before using this value on a results page.
  const totalAreaM2 = rooms.reduce(
    (sum, r) => sum + (parseFloat(r.floorArea) || 0), 0
  );

  const onAddRoom = useCallback(() => {
    dispatch(addNewRoom());
  }, [dispatch]);

  const onSelectRoom = useCallback((id) => {
    dispatch(setActiveRoom(id));
  }, [dispatch]);

  // deleteRoomWithCleanup removes from roomSlice AND envelopeSlice atomically.
  // Using deleteRoom() directly would leave orphaned envelope data behind.
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