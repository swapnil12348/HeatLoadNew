/**
 * RDSRow.jsx
 * Responsibility: Render one data row in the master RDS table.
 *
 * This component is a THIN SHELL — it owns no logic:
 *   - Dispatch logic lives in useRdsRow (src/hooks/useRdsRow.js)
 *   - Cell routing lives in RdsCellRenderer
 *   - Column definitions live in RDSConfig sections
 *
 * The only local concern is the sticky Sr.No. and delete button cells
 * which are layout responsibilities, not data responsibilities.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   BUG-UI-10 [MEDIUM — ISO CORRECTNESS] — useRdsRow called with room object.
 *
 *     Previous: useRdsRow(room.id)
 *     Fixed:    useRdsRow(room.id, room)
 *
 *     useRdsRow uses room?.classInOp inside handleEnvUpdate to dispatch
 *     initializeRoom({ id, room: { classInOp } }). Without the room argument,
 *     classInOp is always undefined → isIsoClassified() never fires for rooms
 *     first edited through the table row. The ISO pressurization guard
 *     (achValue = 0 for ISO-classified rooms) was silently bypassed on every
 *     such edit, identical to BUG-UI-01 fixed in RoomDetailPanel v2.2.
 *
 *   BUG-UI-11 [LOW] — delete icon: raw inline SVG replaced with lucide-react X.
 */

import { memo }          from 'react';
import { X }             from 'lucide-react';
import { RDS_SECTIONS }  from './RDSConfig';
import RdsCellRenderer   from './RdsCellRenderer';
import useRdsRow         from '../../hooks/useRdsRow';

const RDSRow = ({ room, envelope, ahus, index }) => {
  const currentAhuId = room.assignedAhuIds?.[0] || '';

  const {
    handleRoomUpdate,
    handleEnvUpdate,
    handleAhuChange,
    handleDeleteRoom,
  } = useRdsRow(room.id, room);

  return (
    <tr className="hover:bg-blue-50/10 transition-colors group">

      {/* ── Sr. No. — sticky left, always first ───────────────────────── */}
      <td className="
        p-0 border-b border-r border-gray-100
        bg-gray-50 text-center
        sticky left-0 z-20 w-8
        shadow-[1px_0_3px_-1px_rgba(0,0,0,0.07)]
      ">
        <span className="block py-[7px] text-[10px] font-mono text-gray-400 select-none">
          {index + 1}
        </span>
      </td>

      {/* ── Config-driven columns ──────────────────────────────────────── */}
      {RDS_SECTIONS.flatMap((section) =>
        section.columns.map((col) => (
          <RdsCellRenderer
            key={col.key}
            col={col}
            room={room}
            envelope={envelope}
            ahus={ahus}
            sectionColor={section.color}
            currentAhuId={currentAhuId}
            onRoomUpdate={handleRoomUpdate}
            onEnvUpdate={handleEnvUpdate}
            onAhuChange={handleAhuChange}
          />
        ))
      )}

      {/* ── Delete — sticky right ──────────────────────────────────────── */}
      <td className="
        p-0 border-b border-gray-100
        bg-white sticky right-0 z-20 w-8
        shadow-[-3px_0_5px_-2px_rgba(0,0,0,0.06)]
      ">
        <button
          onClick={handleDeleteRoom}
          className="
            w-full h-full py-[7px]
            flex items-center justify-center
            text-gray-200 group-hover:text-red-300 hover:!text-red-500
            transition-colors
          "
          title="Delete room"
          aria-label={`Delete room ${room.name || index + 1}`}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
};

export default memo(RDSRow);