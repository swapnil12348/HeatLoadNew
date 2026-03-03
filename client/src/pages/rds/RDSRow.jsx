// RDSRow.jsx
// Renders one data row in the master RDS table.
// Driven entirely by RDS_SECTIONS from RDSConfig — zero hardcoded columns here.

import React, { memo, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { updateRoom, setRoomAhu, deleteRoom } from '../../features/room/roomSlice';
import { updateInternalLoad, initializeRoom } from '../../features/envelope/envelopeSlice';
import { InputCell, SelectCell } from './RDSCellComponents';
import { RDS_SECTIONS, getFieldValue, buildRoomUpdate } from './RDSConfig';

// ── Section background palette (matches SuperTh in the header) ────────────
const SECTION_BG = {
  gray:   'bg-white',
  blue:   'bg-blue-50/30',
  amber:  'bg-amber-50/30',
  purple: 'bg-purple-50/30',
  green:  'bg-green-50/30',
  red:    'bg-red-50/30',
  orange: 'bg-orange-50/30',
  teal:   'bg-teal-50/30',
  cyan:   'bg-cyan-50/30',
  indigo: 'bg-indigo-50/30',
  yellow: 'bg-yellow-50/20',
  lime:   'bg-lime-50/30',
  rose:   'bg-rose-50/30',
  pink:   'bg-pink-50/30',
  violet: 'bg-violet-50/30',
  sky:    'bg-sky-50/30',
};

const RDSRow = ({ room, envelope, ahus, index }) => {
  const dispatch = useDispatch();
  const currentAhuId = room.assignedAhuIds?.[0] || '';

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleRoomUpdate = useCallback((col, rawValue) => {
    const { field, value } = buildRoomUpdate(col, rawValue);
    dispatch(updateRoom({ id: room.id, field, value }));
  }, [dispatch, room.id]);

  const handleEnvUpdate = useCallback((col, rawValue) => {
    dispatch(initializeRoom(room.id));
    dispatch(updateInternalLoad({
      roomId: room.id,
      type: col.envType,
      data: { [col.envField]: parseFloat(rawValue) || 0 },
    }));
  }, [dispatch, room.id]);

  // ── Cell renderer ─────────────────────────────────────────────────────────

  const renderCell = (col, sectionColor) => {
    const value = getFieldValue(col, room, envelope);
    const bg    = SECTION_BG[sectionColor] || 'bg-white';

    // ── AHU selector ──
    if (col.type === 'select-ahu') {
      return (
        <td
          key={col.key}
          className={`p-0 border-b border-r border-gray-100 sticky left-8 z-20 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)] ${col.width || 'min-w-[110px]'}`}
        >
          <select
            value={currentAhuId}
            onChange={(e) => dispatch(setRoomAhu({ roomId: room.id, ahuId: e.target.value }))}
            className="w-full py-[7px] px-2 text-[11px] font-bold text-blue-600 bg-transparent border-none outline-none cursor-pointer hover:bg-blue-50/60 focus:ring-2 focus:ring-inset focus:ring-blue-400 transition-all"
          >
            <option value="">— AHU —</option>
            {ahus.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </td>
      );
    }

    // ── Regular select ──
    if (col.type === 'select') {
      return (
        <td key={col.key} className={`p-0 border-b border-r border-gray-100 ${bg} ${col.width || 'min-w-[80px]'}`}>
          <SelectCell
            value={value}
            onChange={(e) => handleRoomUpdate(col, e.target.value)}
            options={col.options || []}
          />
        </td>
      );
    }

    // ── Number / Text / ReadOnly ──
    return (
      <td
        key={col.key}
        className={`p-0 border-b border-r border-gray-100 ${bg} ${col.width || 'min-w-[72px]'}`}
      >
        <InputCell
          type={col.inputType || 'number'}
          value={value}
          step={col.step}
          disabled={col.type === 'readOnly'}
          onChange={
            col.isEnv
              ? (e) => handleEnvUpdate(col, e.target.value)
              : (e) => handleRoomUpdate(col, e.target.value)
          }
          className={col.inputType === 'text' ? 'text-left px-2' : 'text-center'}
        />
      </td>
    );
  };

  // ── Row ───────────────────────────────────────────────────────────────────

  return (
    <tr className="hover:bg-blue-50/10 transition-colors group">

      {/* Sr. No. — sticky, always first */}
      <td className="p-0 border-b border-r border-gray-100 bg-gray-50 text-center sticky left-0 z-20 w-8 shadow-[1px_0_3px_-1px_rgba(0,0,0,0.07)]">
        <span className="block py-[7px] text-[10px] font-mono text-gray-400 select-none">
          {index + 1}
        </span>
      </td>

      {/* All config-driven columns */}
      {RDS_SECTIONS.flatMap((section) =>
        section.columns.map((col) => renderCell(col, section.color))
      )}

      {/* Delete action — sticky right */}
      <td className="p-0 border-b border-gray-100 bg-white sticky right-0 z-20 w-8 shadow-[-3px_0_5px_-2px_rgba(0,0,0,0.06)]">
        <button
          onClick={() => window.confirm('Delete this room?') && dispatch(deleteRoom(room.id))}
          className="w-full h-full py-[7px] flex items-center justify-center text-gray-200 group-hover:text-red-300 hover:!text-red-500 transition-colors"
          title="Delete room"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </td>
    </tr>
  );
};

export default memo(RDSRow);