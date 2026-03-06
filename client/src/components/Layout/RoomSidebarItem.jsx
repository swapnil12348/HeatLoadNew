/**
 * RoomSidebarItem.jsx
 * Responsibility: Render a single room entry in the sidebar list.
 *
 * Pure presentational component — zero Redux, zero dispatch.
 * All interaction is via callbacks from useRoomSidebar.
 *
 * Fixes vs old RoomSidebar inline render:
 *   - Raw SVGs replaced with lucide-react
 *   - floorArea displayed in m² (stored unit) — was incorrectly labelled ft²
 *   - roomNo fallback is '—' not 'NO #'
 *   - border-r-4 active indicator replaced with border-l-4 — no layout shift
 *   - Delete button visible on hover — was missing entirely
 *   - aria-labels on all interactive elements
 *   - ISO class badge shown when atRestClass is set
 */

import React, { memo }       from 'react';
import { ChevronRight, X }   from 'lucide-react';

const RoomSidebarItem = ({
  room,
  isActive,
  onSelect,
  onDelete,
}) => {
  const isActiveClass = isActive
    ? 'bg-blue-50 border-l-4 border-blue-600'
    : 'border-l-4 border-transparent hover:bg-gray-50';

  return (
    <li className="relative group/item">
      {/* ── Select button ─────────────────────────────────────────────── */}
      <button
        onClick={onSelect}
        aria-current={isActive ? 'true' : undefined}
        aria-label={`Select room ${room.name || 'unnamed'}`}
        className={`
          w-full text-left px-4 py-3 transition-all duration-150
          flex items-center justify-between gap-2
          ${isActiveClass}
        `}
      >
        <div className="flex-1 min-w-0">

          {/* Room name */}
          <div className={`
            text-sm font-bold truncate
            ${isActive ? 'text-blue-900' : 'text-gray-700'}
          `}>
            {room.name || <span className="italic text-gray-400">Unnamed Room</span>}
          </div>

          {/* Sub-line: room number + area */}
          <div className="text-[10px] text-gray-400 font-mono mt-0.5 flex items-center gap-1.5">
            <span>{room.roomNo || '—'}</span>
            <span className="text-gray-200">·</span>
            {/* BUG-04 FIX: floorArea is stored in m² — was labelled ft² */}
            <span>
              {room.floorArea
                ? `${parseFloat(room.floorArea).toLocaleString(undefined, { maximumFractionDigits: 1 })} m²`
                : '— m²'
              }
            </span>
          </div>

          {/* ISO class badge — shown when set */}
          {room.atRestClass && (
            <span className="inline-block mt-1 text-[9px] font-bold uppercase tracking-wide
              bg-purple-50 text-purple-600 border border-purple-100 px-1.5 py-0.5 rounded">
              {room.atRestClass}
            </span>
          )}
        </div>

        {/* Chevron — only when active */}
        {isActive && (
          <ChevronRight
            className="w-4 h-4 text-blue-500 shrink-0"
            aria-hidden="true"
          />
        )}
      </button>

      {/* ── Delete button — visible on row hover ────────────────────── */}
      {/* Positioned absolute so it doesn't shift layout */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(room.id, room.name);
        }}
        aria-label={`Delete room ${room.name || 'unnamed'}`}
        className="
          absolute right-2 top-1/2 -translate-y-1/2
          opacity-0 group-hover/item:opacity-100
          text-gray-300 hover:text-red-500
          p-1 rounded transition-all duration-150
          bg-white/80 hover:bg-red-50
        "
        title="Delete room"
      >
        <X className="w-3 h-3" aria-hidden="true" />
      </button>
    </li>
  );
};

export default memo(RoomSidebarItem);