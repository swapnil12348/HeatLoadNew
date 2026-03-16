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
 *
 * -- CHANGELOG ----------------------------------------------------------------
 *
 *   v2.0 — initializeRoom dispatched with object payload, not string.
 *
 *     envelopeSlice.initializeRoom handles two payload shapes:
 *       string:        legacy path — sets room = null → isIsoClassified(null) = false
 *       { id, room }: preferred path — calls isIsoClassified(room) correctly
 *
 *     With the string path the ISO pressurization guard (achValue = 0) never
 *     fires. In practice handleEnvUpdate calls initializeRoom as an idempotency
 *     guard on already-initialized rooms, so the early-return fires first and
 *     it is harmless. But if called on an uninitialized room (first edit before
 *     addNewRoom completes), the ISO guard would be silently bypassed.
 *     Fix: object payload, classInOp sourced from room prop. Consistent with
 *     the same fix applied in roomActions.js.
 *
 *   v2.1 — designRH type coercion note corrected.
 *
 *     The type guard for designRH (and all other room fields) lives in
 *     buildRoomUpdate (rdsFieldUtils.js), not here. handleRoomUpdate delegates
 *     to buildRoomUpdate entirely — no field-specific logic in this hook.
 *     buildRoomUpdate: text/select fields → string; all others → parseFloat || 0.
 *
 *   v2.2 — parseFloat || 0 for envelope numeric fields documented.
 *
 *     kw, count, wattsPerSqFt, sensiblePct, latentPct, diversityFactor —
 *     0 is a valid and expected value; empty input should default to 0.
 *     This is intentionally || 0 (not ?? 0) for these fields.
 *
 *   v2.3 — Stale inline fix-tag annotations removed; changelog restructured.
 *
 * ── DISPATCH CONTRACT ────────────────────────────────────────────────────────
 *
 *   handleRoomUpdate  → updateRoom({ id, field, value })
 *                       field: dot-notation path ('exhaustAir.general', 'designRH')
 *                       value: typed by buildRoomUpdate (rdsFieldUtils.js)
 *
 *   handleEnvUpdate   → initializeRoom({ id, room: { classInOp } })
 *                     → updateInternalLoad({ roomId, type, data })
 *                       type:  'people' | 'lights' | 'equipment'
 *                       data:  { [envField]: number }
 *
 *   handleAhuChange   → setRoomAhu({ roomId, ahuId })
 *
 *   handleDeleteRoom  → deleteRoomWithCleanup(roomId) (thunk)
 *                       removes from roomSlice + envelopeSlice atomically
 */

import { useCallback }   from 'react';
import { useDispatch }   from 'react-redux';
import { updateRoom, setRoomAhu }               from '../features/room/roomSlice';
import { updateInternalLoad, initializeRoom }   from '../features/envelope/envelopeSlice';
import { deleteRoomWithCleanup }                from '../features/room/roomActions';
import { buildRoomUpdate }                      from '../pages/rds/RDSConfig';

/**
 * @param {string} roomId   — room.id this row represents
 * @param {object} [room]   — room state object (for classInOp on initializeRoom)
 *                            Optional — if omitted, initializeRoom uses empty classInOp.
 *
 * @returns {{
 *   handleRoomUpdate:  (col, rawValue) => void
 *   handleEnvUpdate:   (col, rawValue) => void
 *   handleAhuChange:   (ahuId) => void
 *   handleDeleteRoom:  () => void
 * }}
 */
const useRdsRow = (roomId, room = null) => {
  const dispatch = useDispatch();

  // ── Room field update ──────────────────────────────────────────────────────
  // buildRoomUpdate (rdsFieldUtils.js) handles all type coercion:
  //   text/select fields → string; all others → parseFloat || 0.
  // No field-specific logic needed here.
  const handleRoomUpdate = useCallback((col, rawValue) => {
    const { field, value } = buildRoomUpdate(col, rawValue);
    dispatch(updateRoom({ id: roomId, field, value }));
  }, [dispatch, roomId]);

  // ── Envelope field update ──────────────────────────────────────────────────
  //
  // initializeRoom is idempotent — safe to call on every update.
  // It guards against re-initialization internally:
  //   if (state.byRoomId[roomId]) return;  // already initialized — no-op
  //
  // Object payload ensures isIsoClassified() fires correctly if this is ever
  // called on an uninitialized room. A string payload would set room = null,
  // causing isIsoClassified(null) = false and silently bypassing the ISO
  // pressurization guard (achValue = 0) for classified cleanrooms.
  const handleEnvUpdate = useCallback((col, rawValue) => {
    dispatch(initializeRoom({
      id:   roomId,
      room: { classInOp: room?.classInOp ?? '' },
    }));

    // parseFloat || 0 is correct for all envelope numeric fields.
    // kw, count, wattsPerSqFt, sensiblePct, latentPct, diversityFactor —
    // 0 is a valid value and empty input should default to 0 for all of these.
    dispatch(updateInternalLoad({
      roomId,
      type: col.envType,
      data: { [col.envField]: parseFloat(rawValue) || 0 },
    }));
  }, [dispatch, roomId, room?.classInOp]);

  // ── AHU assignment ─────────────────────────────────────────────────────────
  const handleAhuChange = useCallback((ahuId) => {
    dispatch(setRoomAhu({ roomId, ahuId }));
  }, [dispatch, roomId]);

  // ── Room deletion ──────────────────────────────────────────────────────────
  // deleteRoomWithCleanup removes from roomSlice AND envelopeSlice atomically.
  // Using deleteRoom() directly would leave orphaned envelope data behind.
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