/**
 * useActiveRoom.js
 * Responsibility: Provide the active room and its derived data
 *                 to any component that needs it.
 *
 * Replaces the pattern of:
 *   const rooms        = useSelector(selectAllRooms);
 *   const activeRoomId = useSelector(selectActiveRoomId);
 *   const room         = rooms.find(r => r.id === activeRoomId);
 *   const envelope     = useSelector(s => s.envelope.byRoomId[activeRoomId]);
 *   const rdsRow       = useSelector(selectRdsData).find(r => r.id === activeRoomId);
 *
 * ...which was duplicated across:
 *   RoomConfig.jsx
 *   EnvelopeConfig.jsx
 *   RoomDetailPanel.jsx
 *   RDSPage.jsx
 *
 * Returns stable references — memoized selectors prevent unnecessary re-renders.
 *
 * ── UNIT CONTRACT ────────────────────────────────────────────────────────────
 *
 *   room.floorArea  → m²  (roomSlice — SI)
 *   room.volume     → m³  (roomSlice — SI)
 *   room.designTemp → °C  (roomSlice — SI)
 *
 *   rdsRow.floorArea → ft²  (post CRIT-RDS-01 fix — rdsSelector converts)
 *   rdsRow.volume    → ft³  (post CRIT-RDS-01 fix — rdsSelector converts)
 *   rdsRow.supplyAir → CFM
 *   rdsRow.coolingCapTR → TR
 *
 *   Consumers that display geometry must use room.* for SI display and
 *   rdsRow.* for HVAC calculation results. Never mix sources for the same
 *   displayed value.
 *
 * @returns {{
 *   room:           object | null   raw room state from roomSlice (SI units)
 *   envelope:       object | null   envelope state for active room
 *   rdsRow:         object | null   fully computed RDS row from rdsSelector (imperial units)
 *   activeRoomId:   string | null
 *   isLoading:      boolean         true when rdsRow not yet computed
 *   hasRoom:        boolean         false when room list is empty
 * }}
 */
import { useMemo }        from 'react';
import { useSelector }    from 'react-redux';
import {
  selectActiveRoom,
  selectActiveRoomId,
}                         from '../features/room/roomSlice';
import { selectRdsData }  from '../features/results/rdsSelector';

const useActiveRoom = () => {
  const activeRoomId = useSelector(selectActiveRoomId);
  const room         = useSelector(selectActiveRoom);

  // Envelope for the active room only — avoids re-render when
  // other rooms' envelopes change.
  const envelope = useSelector(
    (state) => state.envelope.byRoomId?.[activeRoomId] ?? null
  );

  // Full computed RDS row — contains all derived fields (CFM, TR, ACPH, etc.)
  // selectRdsData is memoized via createSelector — only recomputes when
  // room/envelope/climate/project state changes.
  const allRdsRows = useSelector(selectRdsData);
  const rdsRow = useMemo(
    () => allRdsRows.find((r) => r.id === activeRoomId) ?? null,
    [allRdsRows, activeRoomId]
  );

  return {
    room,
    envelope,
    rdsRow,
    activeRoomId,
    isLoading: room !== null && rdsRow === null,
    hasRoom:   room !== null,
  };
};

export default useActiveRoom;