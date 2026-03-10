/**
 * useRoomSidebar.js
 * Responsibility: All selector and dispatch logic for the room sidebar.
 *
 * Separates data concerns from rendering so RoomSidebarItem
 * stays a pure presentational component.
 *
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   FIX-H08 [LOW] — totalAreaM2 source documented and aligned with useProjectTotals.
 *
 *     This hook reads room.floorArea from roomSlice (m²) — correct and unchanged.
 *     useProjectTotals reads rdsRow.floorArea (ft², post CRIT-RDS-01 fix).
 *     Both hooks report a "total area" figure from different sources.
 *     They will NOT agree numerically — intentionally:
 *
 *       useRoomSidebar.totalAreaM2  → for sidebar footer stat (m²)
 *       useProjectTotals.totalAreaM2 → for results KPI (m², derived from ft²)
 *
 *     Numerically they should agree within floating-point precision.
 *     If they differ significantly, a room's floorArea has been updated in
 *     roomSlice but the RDS row has not yet recomputed — possible during a
 *     dispatch/selector batching edge case.
 *
 *     To avoid any drift, UI components should read totalAreaM2 from ONE source.
 *     Recommendation: use useProjectTotals.totalAreaM2 for all display — it is
 *     derived from the same rdsRows that drive all other KPI figures, so all
 *     numbers on a results page remain self-consistent.
 *
 *     The sidebar footer is the only place useRoomSidebar.totalAreaM2 is used.
 *     That is acceptable — it shows a live room-count × area estimate while
 *     the user is editing rooms, before the RDS has recomputed.
 *
 * Returns:
 *   rooms         — full room list from roomSlice
 *   activeRoomId  — currently active room id
 *   totalAreaM2   — sum of all room floor areas (m², from roomSlice — live)
 *   onAddRoom     — dispatch addNewRoom()
 *   onSelectRoom  — dispatch setActiveRoom(id)
 *   onDeleteRoom  — dispatch deleteRoomWithCleanup(id) with confirm
 */

import { useCallback }             from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  selectAllRooms,
  selectActiveRoomId,
  setActiveRoom,
}                                  from '../features/room/roomSlice';
import { addNewRoom }              from '../features/room/roomActions';
import { deleteRoomWithCleanup }   from '../features/room/roomActions';

const useRoomSidebar = () => {
  const dispatch     = useDispatch();
  const rooms        = useSelector(selectAllRooms);
  const activeRoomId = useSelector(selectActiveRoomId);

  // totalAreaM2: read from roomSlice (m²) — correct.
  // FIX-H08: documented why this source differs from useProjectTotals.
  // roomSlice.floorArea is in m² (SI). rdsRow.floorArea is ft² (post CRIT-RDS-01).
  // This accumulation is correct. Use for sidebar footer display only.
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