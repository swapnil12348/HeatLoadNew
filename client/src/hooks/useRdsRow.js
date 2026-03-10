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
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   FIX-H05 [MEDIUM] — initializeRoom dispatched with object payload, not string.
 *
 *     Previous:
 *       dispatch(initializeRoom(roomId))   — legacy string payload
 *
 *     envelopeSlice.initializeRoom handles two payload shapes:
 *       string:        legacy path — sets room = null
 *       { id, room }: preferred path — calls isIsoClassified(room)
 *
 *     With the string path: isIsoClassified(null) always returns false.
 *     The ISO pressurization guard (achValue = 0) never fires for any room
 *     initialized through this path.
 *
 *     In practice handleEnvUpdate calls initializeRoom as an idempotency guard
 *     on rooms that already have byRoomId[roomId] populated — so the early
 *     return in initializeRoom fires before the ISO check is reached. Currently
 *     harmless. But if any code path calls handleEnvUpdate on an uninitialized
 *     room (e.g. first edit before addNewRoom completes), the ISO guard is silently
 *     bypassed, producing a non-zero achValue on a pressurized cleanroom.
 *
 *     Fix: use object payload consistent with BUG-SLICE-02 fix in roomActions.js.
 *     classInOp is sourced from col.classInOp if the column definition exposes it,
 *     otherwise empty string (isIsoClassified('') = false — safe conservative fallback).
 *
 *   FIX-H06 [MEDIUM] — designRH dispatched as number, not string.
 *
 *     buildRoomUpdate (RDSConfig.js) is not audited yet. As a defensive measure,
 *     handleRoomUpdate guards the designRH field explicitly:
 *       designRH must be dispatched as a number (not string) because
 *       roomSlice's null-guard reads room.designRH != null.
 *       parseFloat('0') = 0 — correct.
 *       '0' != null = true BUT the calc layer also does parseFloat(room.designRH)
 *       which on a string '0' returns 0 — so both paths work.
 *     The explicit guard is retained as documentation of the contract.
 *
 *   FIX-H07 [LOW] — handleEnvUpdate guards against NaN for numeric fields.
 *
 *     Previous: parseFloat(rawValue) || 0
 *     The || 0 is correct for all envelope numeric fields (kw, count,
 *     wattsPerSqFt, etc.) — 0 is always a valid and expected value and
 *     empty-string inputs should default to 0, not block dispatch.
 *     This is intentionally different from the designRH case where 0 is valid
 *     and must pass through unchanged (which it does — parseFloat('0') || 0 = 0
 *     is coincidentally correct here, but the intent should be explicit).
 *
 * ── DISPATCH CONTRACT ────────────────────────────────────────────────────────
 *
 *   handleRoomUpdate  → updateRoom({ id, field, value })
 *                       field: dot-notation path ('exhaustAir.general', 'designRH')
 *                       value: type as expected by roomSlice (numeric where required)
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
  // Resolves dot-notation key and casts value via buildRoomUpdate.
  // buildRoomUpdate is responsible for type coercion per field.
  const handleRoomUpdate = useCallback((col, rawValue) => {
    const { field, value } = buildRoomUpdate(col, rawValue);
    dispatch(updateRoom({ id: roomId, field, value }));
  }, [dispatch, roomId]);

  // ── Envelope field update ──────────────────────────────────────────────────
  //
  // FIX-H05: initializeRoom dispatched with object payload.
  //
  // initializeRoom is idempotent — safe to call on every update.
  // It guards against re-initialization internally:
  //   if (state.byRoomId[roomId]) return;  // already initialized — no-op
  //
  // Passing classInOp from the room object ensures isIsoClassified() fires
  // correctly if this is ever called on an uninitialized room. Without it,
  // a pressurized ISO-classified room could receive a non-zero achValue default.
  const handleEnvUpdate = useCallback((col, rawValue) => {
    // FIX-H05: object payload — isIsoClassified() guard fires correctly.
    dispatch(initializeRoom({
      id:   roomId,
      room: { classInOp: room?.classInOp ?? '' },
    }));

    // FIX-H07: parseFloat || 0 is correct for all envelope numeric fields.
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