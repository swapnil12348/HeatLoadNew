/**
 * RoomDetailPanel.jsx
 * Responsibility: Fixed side-panel editor for a single room.
 *                 Renders all RDS_SECTIONS fields in a tabbed form layout.
 *
 * ── CHANGELOG v2.3 ────────────────────────────────────────────────────────────
 *
 *   UI-REFRESH — Readability and layout improvements:
 *     - Panel widened from 620px → 820px
 *     - Typography scaled up: labels text-xs (12px), values text-sm (14px)
 *     - Section headers now colour-coded per section.color
 *     - readOnly/derived fields visually distinct (slate-50 bg, italic label)
 *     - Tab bar taller with larger icons and text
 *     - 3-column grid for setup fields, 2-col for others
 *     - Header badges and room name scaled up
 *     - Footer buttons full-size text
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   BUG-UI-01 — useRdsRow called with room object (ISO correctness).
 *     useRdsRow(roomId, room) forwards classInOp so initializeRoom can apply
 *     the ISO pressurization guard (achValue = 0) on first-edit rooms.
 *
 *   BUG-UI-02 — dynamic require() removed, top-level ESM import.
 *
 * ── SEASON DIVIDER ORDER NOTE ─────────────────────────────────────────────────
 *
 *   groupColumnsBySeason iterates Object.entries(groups) which preserves
 *   insertion order in modern JS. Season dividers appear in the order
 *   that column definitions appear in the section files. All section files
 *   define summer → monsoon → winter in that order — maintain this convention
 *   when adding new seasonal column blocks.
 */

import { useState, useCallback }     from 'react';
import { useDispatch }               from 'react-redux';
import { X, Lock }                   from 'lucide-react';
import { FormInput, FormSelect,
         SeasonBadge }               from './RDSCellComponents';
import { RDS_SECTIONS,
         RDS_CATEGORIES,
         getFieldValue }             from './RDSConfig';
import useRdsRow                     from '../../hooks/useRdsRow';
import { deleteRoomWithCleanup }     from '../../features/room/roomActions';

// ── Section colour palette ────────────────────────────────────────────────────
const SECTION_PALETTE = {
  gray:   { header: 'bg-slate-50   border-slate-200', accent: 'bg-slate-400',   text: 'text-slate-600'  },
  blue:   { header: 'bg-blue-50    border-blue-200',  accent: 'bg-blue-500',    text: 'text-blue-700'   },
  amber:  { header: 'bg-amber-50   border-amber-200', accent: 'bg-amber-500',   text: 'text-amber-700'  },
  purple: { header: 'bg-purple-50  border-purple-200',accent: 'bg-purple-500',  text: 'text-purple-700' },
  green:  { header: 'bg-green-50   border-green-200', accent: 'bg-green-500',   text: 'text-green-700'  },
  red:    { header: 'bg-red-50     border-red-200',   accent: 'bg-red-500',     text: 'text-red-700'    },
  orange: { header: 'bg-orange-50  border-orange-200',accent: 'bg-orange-500',  text: 'text-orange-700' },
  teal:   { header: 'bg-teal-50    border-teal-200',  accent: 'bg-teal-500',    text: 'text-teal-700'   },
  cyan:   { header: 'bg-cyan-50    border-cyan-200',  accent: 'bg-cyan-500',    text: 'text-cyan-700'   },
  indigo: { header: 'bg-indigo-50  border-indigo-200',accent: 'bg-indigo-500',  text: 'text-indigo-700' },
  sky:    { header: 'bg-sky-50     border-sky-200',   accent: 'bg-sky-500',     text: 'text-sky-700'    },
  lime:   { header: 'bg-lime-50    border-lime-200',  accent: 'bg-lime-500',    text: 'text-lime-700'   },
  rose:   { header: 'bg-rose-50    border-rose-200',  accent: 'bg-rose-500',    text: 'text-rose-700'   },
  pink:   { header: 'bg-pink-50    border-pink-200',  accent: 'bg-pink-500',    text: 'text-pink-700'   },
  violet: { header: 'bg-violet-50  border-violet-200',accent: 'bg-violet-500',  text: 'text-violet-700' },
  yellow: { header: 'bg-yellow-50  border-yellow-200',accent: 'bg-yellow-500',  text: 'text-yellow-700' },
};

const getPalette = (color) =>
  SECTION_PALETTE[color] ?? SECTION_PALETTE.gray;

// ── Season grouping ───────────────────────────────────────────────────────────
// Groups columns by seasonLabel, preserving definition order (summer → monsoon → winter).
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

// ── ReadOnly display ──────────────────────────────────────────────────────────
// Derived fields shown as display-only tiles, not inputs.
const ReadOnlyField = ({ label, subLabel, value }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
      <Lock className="w-2.5 h-2.5 opacity-50" aria-hidden="true" />
      {label}
      {subLabel && <span className="normal-case font-normal opacity-70">({subLabel})</span>}
    </span>
    <div className="bg-slate-50 border border-slate-100 rounded-md px-3 py-2
                    text-sm font-semibold text-slate-600 font-mono tracking-tight">
      {value === '' || value === null || value === undefined ? (
        <span className="text-slate-300 font-normal not-italic">—</span>
      ) : value}
    </div>
  </div>
);

// ── PanelField ────────────────────────────────────────────────────────────────
const PanelField = ({
  col, room, rdsRow, envelope, ahus,
  onRoomUpdate, onEnvUpdate, onAhuChange,
}) => {
  const value      = getFieldValue(col, room, envelope, rdsRow);
  const isReadOnly = col.type === 'readOnly' || col.derived;

  if (isReadOnly) {
    return (
      <ReadOnlyField
        label={col.label}
        subLabel={col.subLabel}
        value={value}
      />
    );
  }

  if (col.type === 'select-ahu') {
    return (
      <div className="col-span-2">
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">
          {col.label}
          {col.subLabel && (
            <span className="text-slate-400 font-normal ml-1.5 text-[11px]">
              ({col.subLabel})
            </span>
          )}
        </label>
        <select
          value={room.assignedAhuIds?.[0] || ''}
          onChange={(e) => onAhuChange(e.target.value)}
          className="
            w-full text-sm font-bold text-blue-700
            bg-blue-50 border border-blue-200 rounded-lg
            px-3 py-2.5
            focus:outline-none focus:ring-2 focus:ring-blue-300
            transition-all
          "
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
      <FormSelect
        label={col.label}
        subLabel={col.subLabel}
        value={value}
        options={col.options || []}
        onChange={(e) => onRoomUpdate(col, e.target.value)}
      />
    );
  }

  return (
    <FormInput
      label={col.label}
      subLabel={col.subLabel}
      type={col.inputType || 'number'}
      value={value}
      step={col.step}
      disabled={false}
      onChange={
        col.isEnv
          ? (e) => onEnvUpdate(col, e.target.value)
          : (e) => onRoomUpdate(col, e.target.value)
      }
    />
  );
};

// ── ISO badge colour ──────────────────────────────────────────────────────────
const ISO_BADGE_COLOR = {
  'ISO 1': 'bg-red-100    text-red-700    border-red-200',
  'ISO 2': 'bg-red-50     text-red-600    border-red-100',
  'ISO 3': 'bg-orange-100 text-orange-700 border-orange-200',
  'ISO 4': 'bg-orange-50  text-orange-600 border-orange-100',
  'ISO 5': 'bg-amber-100  text-amber-700  border-amber-200',
  'ISO 6': 'bg-yellow-100 text-yellow-700 border-yellow-200',
  'ISO 7': 'bg-purple-100 text-purple-700 border-purple-200',
  'ISO 8': 'bg-slate-100  text-slate-600  border-slate-200',
  'ISO 9': 'bg-gray-100   text-gray-500   border-gray-200',
  'CNC':   'bg-teal-100   text-teal-700   border-teal-200',
};

const isoBadgeClass = (cls) =>
  ISO_BADGE_COLOR[cls] ?? 'bg-gray-100 text-gray-500 border-gray-200';

// ── RoomDetailPanel ───────────────────────────────────────────────────────────

export default function RoomDetailPanel({ room, rdsRow, envelope, ahus, onClose }) {
  const dispatch = useDispatch();
  const [activeTab, setActiveTab] = useState('setup');

  const {
    handleRoomUpdate,
    handleEnvUpdate,
    handleAhuChange,
  } = useRdsRow(room?.id, room);

  const handleDelete = useCallback(() => {
    if (window.confirm('Permanently delete this room and all its data?')) {
      dispatch(deleteRoomWithCleanup(room.id));
      onClose();
    }
  }, [dispatch, room?.id, onClose]);

  if (!room) return null;

  const activeSections = RDS_SECTIONS.filter((s) => s.category === activeTab);
  const assignedAhuId  = room.assignedAhuIds?.[0];
  const isAssigned     = Boolean(assignedAhuId && assignedAhuId.trim() !== '');

  const gridCols = activeTab === 'setup' ? 'grid-cols-3' : 'grid-cols-2';

  return (
    <div className="fixed inset-y-0 right-0 w-[820px] bg-white shadow-2xl z-50
                    flex flex-col border-l border-slate-200 overflow-hidden">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="px-6 py-3.5 border-b border-slate-200 bg-white
                      flex justify-between items-start shrink-0">
        <div className="flex-1 min-w-0">

          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Room Editor
            </span>

            {isAssigned && (
              <span className="bg-blue-100 text-blue-700 text-[10px] px-2.5 py-0.5
                               rounded-full font-bold uppercase tracking-wide border border-blue-200">
                Assigned
              </span>
            )}

            {room.atRestClass && (
              <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold
                                border ${isoBadgeClass(room.atRestClass)}`}>
                {room.atRestClass}
              </span>
            )}

            {room.classInOp && room.classInOp !== room.atRestClass && (
              <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold
                                border ${isoBadgeClass(room.classInOp)}`}>
                {room.classInOp} <span className="opacity-60 font-normal">(Op.)</span>
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-3">
            <h2 className="text-xl font-bold text-slate-900 leading-tight truncate">
              {room.name || (
                <span className="text-slate-300 italic font-normal">Unnamed Room</span>
              )}
            </h2>
            {room.roomNo && (
              <span className="text-sm text-slate-400 font-mono shrink-0">
                #{room.roomNo}
              </span>
            )}
          </div>

          {rdsRow && (
            <div className="flex items-center gap-4 mt-1">
              {rdsRow.supplyAir > 0 && (
                <span className="text-xs text-slate-500">
                  <span className="font-bold text-slate-700">
                    {Math.round(rdsRow.supplyAir).toLocaleString()}
                  </span> CFM
                </span>
              )}
              {rdsRow.coolingCapTR > 0 && (
                <span className="text-xs text-slate-500">
                  <span className="font-bold text-blue-600">
                    {parseFloat(rdsRow.coolingCapTR).toFixed(2)}
                  </span> TR
                </span>
              )}
              {room.designTemp != null && (
                <span className="text-xs text-slate-500">
                  <span className="font-bold text-amber-600">{room.designTemp}°C</span>
                  {' / '}
                  <span className="font-bold text-amber-600">{room.designRH}%RH</span>
                </span>
              )}
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          aria-label="Close panel"
          className="ml-4 text-slate-400 hover:text-slate-700
                     bg-slate-50 hover:bg-slate-100 border border-slate-200
                     p-2 rounded-lg transition-all shrink-0"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────── */}
      <div className="flex border-b border-slate-200 px-6 bg-white shrink-0">
        {RDS_CATEGORIES.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'true' : undefined}
            className={`
              py-3 px-3 text-xs font-bold uppercase tracking-widest
              border-b-2 transition-all
              flex items-center gap-1.5 whitespace-nowrap
              ${activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-400 hover:text-slate-700 hover:border-slate-300'
              }
            `}
          >
            <span className="text-sm" aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Scrollable content ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 bg-slate-50 space-y-3">
        {activeSections.map((section) => {
          const columnGroups = groupColumnsBySeason(section.columns);
          const palette      = getPalette(section.color);

          return (
            <div
              key={section.id}
              className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className={`px-4 py-2 border-b ${palette.header}
                              flex items-center gap-3`}>
                <span className={`w-1 h-5 rounded-full shrink-0 ${palette.accent}`}
                      aria-hidden="true" />
                <h3 className={`text-xs font-bold uppercase tracking-widest ${palette.text}`}>
                  {section.title}
                </h3>
                <span className="text-[10px] text-slate-400 font-mono ml-auto">
                  {section.columns.length} fields
                </span>
              </div>

              <div className="p-4 space-y-3">
                {columnGroups.map(({ groupLabel, columns }, gi) => (
                  <div key={gi}>
                    {groupLabel && (
                      <div className="flex items-center gap-3 mb-4">
                        <SeasonBadge season={groupLabel} />
                        <div className="flex-1 h-px bg-slate-100" />
                      </div>
                    )}

                    <div className={`grid ${gridCols} gap-x-4 gap-y-3`}>
                      {columns.map((col) => {
                        const isWide =
                          col.fullWidth ||
                          col.type === 'select-ahu' ||
                          (col.inputType === 'text' && col.width === 'w-44');

                        return (
                          <div
                            key={col.key}
                            className={isWide ? 'col-span-2' : 'col-span-1'}
                          >
                            <PanelField
                              col={col}
                              room={room}
                              rdsRow={rdsRow}
                              envelope={envelope}
                              ahus={ahus}
                              onRoomUpdate={handleRoomUpdate}
                              onEnvUpdate={handleEnvUpdate}
                              onAhuChange={handleAhuChange}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-t border-slate-200 bg-white
                      flex justify-between items-center shrink-0">
        <button
          onClick={handleDelete}
          className="text-red-500 hover:bg-red-50 border border-transparent
                     hover:border-red-100 px-4 py-2 rounded-lg text-sm
                     font-semibold transition-all"
        >
          Delete Room
        </button>
        <button
          onClick={onClose}
          className="bg-slate-900 text-white px-6 py-2 rounded-lg
                     font-semibold text-sm
                     hover:bg-slate-700 transition-colors shadow-sm"
        >
          Done
        </button>
      </div>
    </div>
  );
}