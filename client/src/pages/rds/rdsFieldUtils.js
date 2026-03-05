// ══════════════════════════════════════════════════════════════════════════════
// Field value resolver — handles dot-notation keys AND env fields.
// Consumed by RDSRow, RoomDetailPanel (via re-export from RDSConfig.js).
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Read a field value given a column config, room state, and envelope state.
 *
 * Handles:
 *  - env fields   (col.isEnv)          → envelope.internalLoads[envType][envField]
 *  - nested keys  (key contains '.')   → room.exhaustAir.general etc.
 *  - flat keys                         → room[key]
 */
export const getFieldValue = (col, room, envelope) => {
  if (!room) return '';

  if (col.isEnv) {
    return envelope?.internalLoads?.[col.envType]?.[col.envField] ?? 0;
  }

  if (col.key.includes('.')) {
    return col.key.split('.').reduce((obj, part) => obj?.[part], room) ?? 0;
  }

  return room[col.key] ?? 0;
};

/**
 * Produce the Redux action payload for updateRoom.
 * Converts dot-notation key to the field string the reducer expects.
 */
export const buildRoomUpdate = (col, rawValue) => ({
  field: col.key,          // roomSlice.updateRoom handles dot-notation internally
  value: col.inputType === 'text' ? rawValue : (parseFloat(rawValue) || 0),
});