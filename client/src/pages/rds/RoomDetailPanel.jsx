// RoomDetailPanel.jsx
import React, { useState, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { updateRoom, setRoomAhu } from '../../features/room/roomSlice';

// FLOW-05 FIX: was importing deleteRoom directly from roomSlice.
// That only removes the room from roomSlice.list — it leaves behind the
// room's envelope data in envelopeSlice.byRoomId forever.
// deleteRoomWithCleanup is a thunk that deletes from BOTH slices atomically.
import { deleteRoomWithCleanup } from '../../features/room/roomActions';

import { updateInternalLoad, initializeRoom } from '../../features/envelope/envelopeSlice';
import { FormInput, FormSelect, SeasonBadge } from './RDSCellComponents';
import { RDS_SECTIONS, RDS_CATEGORIES, getFieldValue, buildRoomUpdate } from './RDSConfig';

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

const groupColumnsBySeason = (columns) => {
  const groups    = {};
  const ungrouped = [];

  for (const col of columns) {
    if (col.seasonLabel) {
      if (!groups[col.seasonLabel]) groups[col.seasonLabel] = [];
      groups[col.seasonLabel].push(col);
    } else {
      ungrouped.push(col);
    }
  }

  const result = [];
  if (ungrouped.length) result.push({ groupLabel: null, columns: ungrouped });
  for (const [label, cols] of Object.entries(groups)) {
    result.push({ groupLabel: label, columns: cols });
  }
  return result;
};

// ══════════════════════════════════════════════════════════════════════════════
// RoomDetailPanel
// ══════════════════════════════════════════════════════════════════════════════

export default function RoomDetailPanel({ room, envelope, ahus, onClose }) {
  const dispatch   = useDispatch();
  const [activeTab, setActiveTab] = useState('setup');

  if (!room) return null;

  // ── Update handlers ──────────────────────────────────────────────────────

  const handleRoomUpdate = useCallback((col, rawValue) => {
    const { field, value } = buildRoomUpdate(col, rawValue);
    dispatch(updateRoom({ id: room.id, field, value }));
  }, [dispatch, room.id]);

  const handleEnvUpdate = useCallback((col, rawValue) => {
    dispatch(initializeRoom(room.id));
    dispatch(updateInternalLoad({
      roomId: room.id,
      type:   col.envType,
      data:   { [col.envField]: parseFloat(rawValue) || 0 },
    }));
  }, [dispatch, room.id]);

  // ── Field renderer ────────────────────────────────────────────────────────

  const renderField = (col) => {
    const value = getFieldValue(col, room, envelope);

    if (col.type === 'select-ahu') {
      return (
        <div key={col.key} className="col-span-2">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
            {col.label}
            {col.subLabel && (
              <span className="text-slate-300 font-normal ml-1">({col.subLabel})</span>
            )}
          </label>
          <select
            value={room.assignedAhuIds?.[0] || ''}
            onChange={(e) => dispatch(setRoomAhu({ roomId: room.id, ahuId: e.target.value }))}
            className="w-full text-sm font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 transition-all"
          >
            <option value="">— Select System —</option>
            {ahus.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      );
    }

    if (col.type === 'select') {
      return (
        <div key={col.key}>
          <FormSelect
            label={col.label}
            subLabel={col.subLabel}
            value={value}
            options={col.options || []}
            onChange={(e) => handleRoomUpdate(col, e.target.value)}
          />
        </div>
      );
    }

    return (
      <div key={col.key}>
        <FormInput
          label={col.label}
          subLabel={col.subLabel}
          type={col.inputType || 'number'}
          value={value}
          step={col.step}
          disabled={col.type === 'readOnly'}
          onChange={
            col.isEnv
              ? (e) => handleEnvUpdate(col, e.target.value)
              : (e) => handleRoomUpdate(col, e.target.value)
          }
        />
      </div>
    );
  };

  // ── Tab content ───────────────────────────────────────────────────────────

  const categoryMap    = { setup: 'setup', loads: 'loads', results: 'results', psychro: 'psychro' };
  const activeSections = RDS_SECTIONS.filter((s) => s.category === categoryMap[activeTab]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-y-0 right-0 w-[620px] bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200">

      {/* ── Header ── */}
      <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex justify-between items-start shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
              Room Editor
            </span>
            {room.assignedAhuIds?.[0] && (
              <span className="bg-blue-100 text-blue-700 text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wide">
                Assigned
              </span>
            )}
            {room.atRestClass && (
              <span className="bg-purple-50 text-purple-600 text-[9px] px-2 py-0.5 rounded border border-purple-100 font-bold">
                {room.atRestClass}
              </span>
            )}
            {/* BUG-11 FIX: show classInOp badge alongside atRestClass */}
            {room.classInOp && room.classInOp !== room.atRestClass && (
              <span className="bg-amber-50 text-amber-600 text-[9px] px-2 py-0.5 rounded border border-amber-100 font-bold">
                {room.classInOp} (Op.)
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold text-slate-900 leading-tight">
            {room.name || <span className="text-slate-400 italic">Unnamed Room</span>}
          </h2>
          {room.roomNo && (
            <p className="text-xs text-slate-400 font-mono mt-0.5">#{room.roomNo}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 bg-white hover:bg-slate-100 p-2 rounded-full transition-all"
          title="Close"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex border-b border-slate-100 px-4 bg-white shrink-0">
        {RDS_CATEGORIES.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`py-3 px-3 text-[11px] font-bold uppercase tracking-wide border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap
              ${activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Scrollable Content ── */}
      <div className="flex-1 overflow-y-auto p-5 bg-slate-50/50 space-y-5">
        {activeSections.map((section) => {
          const columnGroups = groupColumnsBySeason(section.columns);
          return (
            <div key={section.id} className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">

              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-widest">
                  {section.title}
                </h3>
                <span className="text-[9px] text-slate-400 font-mono ml-auto">
                  {section.columns.length} fields
                </span>
              </div>

              <div className="p-4 space-y-5">
                {columnGroups.map(({ groupLabel, columns }, gi) => (
                  <div key={gi}>
                    {groupLabel && (
                      <div className="flex items-center gap-2 mb-3">
                        <SeasonBadge season={groupLabel} />
                        <div className="flex-1 h-px bg-slate-100" />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      {columns.map((col) => (
                        <div
                          key={col.key}
                          className={
                            col.width === 'w-40' || (col.inputType === 'text' && !col.subLabel)
                              ? 'col-span-2'
                              : 'col-span-1'
                          }
                        >
                          {renderField(col)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div className="px-5 py-3.5 border-t border-slate-100 bg-white flex justify-between items-center shrink-0">
        <button
          onClick={() => {
            if (window.confirm('Permanently delete this room?')) {
              // FLOW-05 FIX: was dispatch(deleteRoom(room.id)) which only
              // removed the room from roomSlice — envelopeSlice.byRoomId[id]
              // was left behind, leaking memory on every delete.
              // deleteRoomWithCleanup removes from both slices atomically.
              dispatch(deleteRoomWithCleanup(room.id));
              onClose();
            }
          }}
          className="text-red-500 hover:bg-red-50 px-3 py-1.5 rounded text-[11px] font-bold transition-colors"
        >
          Delete Room
        </button>
        <button
          onClick={onClose}
          className="bg-slate-900 text-white px-5 py-1.5 rounded font-bold text-[11px] hover:bg-slate-700 transition-colors shadow"
        >
          Done
        </button>
      </div>
    </div>
  );
}