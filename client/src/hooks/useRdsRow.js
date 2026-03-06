/**
 * useRdsRow.js
 * Responsibility: All Redux dispatch logic for one RDS row.
 *
 * Separates side-effects (dispatch) from rendering (RdsCellRenderer).
 * RDSRow and RoomDetailPanel both consume this hook — single owner of
 * update logic, no duplication.
 *
 * Returns stable callback references (useCallback) so memoized row
 * components only re-render when room.id changes.
 */

import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { updateRoom, setRoomAhu }          from '../features/room/roomSlice';
import { updateInternalLoad, initializeRoom } from '../features/envelope/envelopeSlice';
import { deleteRoomWithCleanup }            from '../features/room/roomActions';
import { buildRoomUpdate }                  from '../pages/rds/RDSConfig';

/**
 * @param {string} roomId  - room.id
 * @returns {{
 *   handleRoomUpdate:  (col, rawValue) => void
 *   handleEnvUpdate:   (col, rawValue) => void
 *   handleAhuChange:   (ahuId) => void
 *   handleDeleteRoom:  () => void
 * }}
 */
const useRdsRow = (roomId) => {
  const dispatch = useDispatch();

  // ── Room field update ────────────────────────────────────────────────────
  // Resolves dot-notation key and casts value via buildRoomUpdate.
  const handleRoomUpdate = useCallback((col, rawValue) => {
    const { field, value } = buildRoomUpdate(col, rawValue);
    dispatch(updateRoom({ id: roomId, field, value }));
  }, [dispatch, roomId]);

  // ── Envelope field update ─────────────────────────────────────────────────
  // initializeRoom is idempotent — safe to call every update.
  const handleEnvUpdate = useCallback((col, rawValue) => {
    dispatch(initializeRoom(roomId));
    dispatch(updateInternalLoad({
      roomId,
      type: col.envType,
      data: { [col.envField]: parseFloat(rawValue) || 0 },
    }));
  }, [dispatch, roomId]);

  // ── AHU assignment ────────────────────────────────────────────────────────
  const handleAhuChange = useCallback((ahuId) => {
    dispatch(setRoomAhu({ roomId, ahuId }));
  }, [dispatch, roomId]);

  // ── Room deletion ─────────────────────────────────────────────────────────
  // deleteRoomWithCleanup removes from roomSlice AND envelopeSlice atomically.
  // FLOW-05 FIX: was deleteRoom() which left envelope data behind.
  const handleDeleteRoom = useCallback(() => {
    if (window.confirm('Permanently delete this room and all its data?')) {
      dispatch(deleteRoomWithCleanup(roomId));
    }
  }, [dispatch, roomId]);

  return {
    handleRoomUpdate,
    handleEnvUpdate,
    handleAhuChange,
    handleDeleteRoom,
  };
};

export default useRdsRow;