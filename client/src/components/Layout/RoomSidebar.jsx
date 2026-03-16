/**
 * RoomSidebar.jsx
 * Responsibility: Render the project room list sidebar.
 *
 * Thin shell — owns only layout structure:
 *   - Header with "Add Room" button
 *   - Scrollable room list (delegates to RoomSidebarItem)
 *   - Footer with aggregate stats
 *
 * All data and dispatch logic lives in useRoomSidebar.
 * All per-room rendering lives in RoomSidebarItem.
 *
 * CHANGELOG
 *
 *   v2.0 — h-[calc(100vh-64px)] → h-full (fills AppLayout flex-1 correctly).
 *         Raw SVG plus icon → lucide-react Plus.
 *         Dead React import removed (React 17+ JSX transform).
 *         Footer shows total area m² in addition to zone count.
 *         aria-label on add button.
 */

import { Plus }        from 'lucide-react';
import useRoomSidebar  from '../../hooks/useRoomSidebar';
import RoomSidebarItem from './RoomSidebarItem';

export default function RoomSidebar() {
  const {
    rooms,
    activeRoomId,
    totalAreaM2,
    onAddRoom,
    onSelectRoom,
    onDeleteRoom,
  } = useRoomSidebar();

  return (
    // h-full fills AppLayout's flex-1 <main> container.
    // Old h-[calc(100vh-64px)] only subtracted header height and broke
    // when TabNav height changed.
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-full shrink-0">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center shrink-0">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
          Project Zones
        </h3>
        <button
          onClick={onAddRoom}
          aria-label="Add new room"
          title="Add new room"
          className="
            text-blue-600 hover:bg-blue-50
            p-1.5 rounded-md transition-colors
          "
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* ── Room list ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {rooms.length === 0 ? (
          <div className="p-6 text-center">
            <div className="text-2xl mb-2">📐</div>
            <p className="text-sm text-gray-500 font-medium">No rooms yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Click <strong>+</strong> to add your first zone.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50" role="list" aria-label="Project rooms">
            {rooms.map((room) => (
              <RoomSidebarItem
                key={room.id}
                room={room}
                isActive={activeRoomId === room.id}
                onSelect={() => onSelectRoom(room.id)}
                onDelete={onDeleteRoom}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── Footer stats ────────────────────────────────────────────────── */}
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 shrink-0">
        <div className="flex justify-between items-center text-xs text-gray-500">
          <span>
            <strong className="text-gray-700">{rooms.length}</strong> zone{rooms.length !== 1 ? 's' : ''}
          </span>
          <span className="font-mono text-gray-400">
            {totalAreaM2.toLocaleString(undefined, { maximumFractionDigits: 0 })} m² total
          </span>
        </div>
      </div>

    </div>
  );
}