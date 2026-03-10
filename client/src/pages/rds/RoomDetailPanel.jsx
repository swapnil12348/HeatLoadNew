/**
 * RoomDetailPanel.jsx
 * Responsibility: Fixed side-panel editor for a single room.
 *                 Renders all RDS_SECTIONS fields in a tabbed form layout.
 *
 * -- CHANGELOG v2.2 -----------------------------------------------------------
 *
 *   BUG-UI-01 [MEDIUM — ISO CORRECTNESS] — useRdsRow called with room object.
 *
 *     Previous: useRdsRow(room?.id)
 *     Fixed:    useRdsRow(room?.id, room)
 *
 *     useRdsRow(roomId, room = null) uses room?.classInOp inside handleEnvUpdate
 *     to dispatch initializeRoom({ id, room: { classInOp } }). This is the
 *     FIX-H05 fix — ensures isIsoClassified() fires correctly when a room is
 *     first edited through the panel before its envelope entry is initialized.
 *
 *     Without the room argument: classInOp is always undefined → '' → false,
 *     meaning isIsoClassified() never fires for any room opened in this panel.
 *     A pressurized ISO-classified room (e.g. ISO 6 semiconductor anteroom)
 *     whose envelope is first touched via this panel could receive a non-zero
 *     achValue default — a silent, uncatchable ASHRAE compliance error.
 *
 *     The panel is the most likely first-edit path for envelope fields (it is
 *     the dedicated room editor), making this the highest-risk entry point.
 *
 *   BUG-UI-02 [LOW — MODULE CORRECTNESS] — dynamic require() removed.
 *
 *     Previous:
 *       dispatch(
 *         require('../../features/room/roomActions').deleteRoomWithCleanup(room.id)
 *       );
 *
 *     This was a CommonJS require() inside a useCallback body in a Vite/ESM
 *     project. It bypasses Vite's module graph (no tree-shaking, no HMR
 *     tracking) and used room.id from props directly instead of the hook-
 *     managed roomId.
 *
 *     Fix: deleteRoomWithCleanup imported at module level (top-level ESM).
 *     handleDelete owns its own window.confirm + onClose() because:
 *       - useRdsRow.handleDeleteRoom also calls window.confirm internally.
 *       - onClose() must NOT fire if the user cancels the confirm dialog.
 *       - Therefore the panel cannot delegate to handleDeleteRoom — it must
 *         own the confirm guard so onClose() is conditional.
 *     The direct dispatch(deleteRoomWithCleanup(room.id)) is the correct
 *     pattern for this specific case.
 *
 * -- Previous changelog (v2.1) ------------------------------------------------
 *   - Dead React import removed
 *   - handleRoomUpdate + handleEnvUpdate replaced by useRdsRow hook
 *   - delete uses useRdsRow.handleDeleteRoom + calls onClose after
 *   - parseFloat(rawValue) || 0 → parseFloat(rawValue) in env updates
 *   - categoryMap { setup:'setup'... } removed — activeTab used directly
 *   - Close button raw SVG → lucide-react X
 *   - AHU selector label uses FieldLabel pattern from RDSCellComponents
 *   - col.width === 'w-40' → col.fullWidth flag for span detection
 *   - assignedAhuIds[0] badge guard checks for non-empty string
 *   - renderField extracted as PanelField sub-component
 */

import { useState, useCallback }        from 'react';
import { useDispatch }                  from 'react-redux';
import { X }                            from 'lucide-react';
import { FormInput, FormSelect,
         SeasonBadge }                  from './RDSCellComponents';
import { RDS_SECTIONS,
         RDS_CATEGORIES,
         getFieldValue }                from './RDSConfig';
import useRdsRow                        from '../../hooks/useRdsRow';
import { deleteRoomWithCleanup }        from '../../features/room/roomActions'; // BUG-UI-02 FIX: top-level ESM import

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Group columns by their seasonLabel for divider rendering.
 * Ungrouped columns (no seasonLabel) come first as a group with label null.
 */
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

// ── PanelField ────────────────────────────────────────────────────────────────
// Renders a single RDS column definition as a form field.
// Pure presentational — all handlers passed as props.

const PanelField = ({
  col, room, envelope, ahus,
  onRoomUpdate, onEnvUpdate, onAhuChange,
}) => {
  const value = getFieldValue(col, room, envelope);

  // ── AHU selector ──────────────────────────────────────────────────────────
  if (col.type === 'select-ahu') {
    return (
      <div className="col-span-2">
        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
          {col.label}
          {col.subLabel && (
            <span className="text-slate-300 font-normal ml-1 normal-case">
              ({col.subLabel})
            </span>
          )}
        </label>
        <select
          value={room.assignedAhuIds?.[0] || ''}
          onChange={(e) => onAhuChange(e.target.value)}
          className="
            w-full text-sm font-bold text-blue-700
            bg-blue-50 border border-blue-200 rounded-md
            px-3 py-2
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

  // ── Select ────────────────────────────────────────────────────────────────
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

  // ── Number / text / readOnly ──────────────────────────────────────────────
  return (
    <FormInput
      label={col.label}
      subLabel={col.subLabel}
      type={col.inputType || 'number'}
      value={value}
      step={col.step}
      disabled={col.type === 'readOnly'}
      onChange={
        col.isEnv
          ? (e) => onEnvUpdate(col, e.target.value)
          : (e) => onRoomUpdate(col, e.target.value)
      }
    />
  );
};

// ── RoomDetailPanel ───────────────────────────────────────────────────────────

export default function RoomDetailPanel({ room, envelope, ahus, onClose }) {
  const dispatch   = useDispatch();
  const [activeTab, setActiveTab] = useState('setup');

  // BUG-UI-01 FIX: pass room as second argument so handleEnvUpdate dispatches
  // initializeRoom({ id, room: { classInOp } }) correctly.
  //
  // Previously: useRdsRow(room?.id)
  //   → room?.classInOp always undefined → '' → isIsoClassified('') = false
  //   → ISO pressurization achValue guard silently bypassed on first envelope edit.
  //
  // Now: useRdsRow(room?.id, room)
  //   → room?.classInOp correctly forwarded to initializeRoom payload
  //   → isIsoClassified() fires correctly for pressurized ISO rooms
  const {
    handleRoomUpdate,
    handleEnvUpdate,
    handleAhuChange,
  } = useRdsRow(room?.id, room); // BUG-UI-01 FIX: room passed as second arg

  // Panel owns its own delete confirm because:
  //   1. useRdsRow.handleDeleteRoom also calls window.confirm internally — would double-prompt.
  //   2. onClose() must be conditional on confirmation — must not fire on cancel.
  //   Therefore: direct dispatch after panel-owned confirm is the correct pattern.
  //
  // BUG-UI-02 FIX: deleteRoomWithCleanup is now a top-level ESM import (see top of file).
  //   Previous: require('../../features/room/roomActions').deleteRoomWithCleanup(room.id)
  //   — CommonJS require() inside useCallback in a Vite/ESM project. Bypassed module
  //   graph, disabled tree-shaking, broke HMR for this module.
  const handleDelete = useCallback(() => {
    if (window.confirm('Permanently delete this room and all its data?')) {
      dispatch(deleteRoomWithCleanup(room.id)); // BUG-UI-02 FIX: ESM import, not require()
      onClose();
    }
  }, [dispatch, room?.id, onClose]);

  if (!room) return null;

  // Active sections — filter by current tab category directly
  const activeSections = RDS_SECTIONS.filter((s) => s.category === activeTab);

  // Assigned AHU — guard against empty string being truthy
  const assignedAhuId = room.assignedAhuIds?.[0];
  const isAssigned    = Boolean(assignedAhuId && assignedAhuId.trim() !== '');

  return (
    <div className="fixed inset-y-0 right-0 w-[620px] bg-white shadow-2xl z-50
                    flex flex-col border-l border-slate-200">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-slate-100 bg-slate-50
                      flex justify-between items-start shrink-0">
        <div>
          {/* Badge row */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
              Room Editor
            </span>

            {isAssigned && (
              <span className="bg-blue-100 text-blue-700 text-[9px] px-2 py-0.5
                               rounded font-bold uppercase tracking-wide">
                Assigned
              </span>
            )}

            {room.atRestClass && (
              <span className="bg-purple-50 text-purple-600 text-[9px] px-2 py-0.5
                               rounded border border-purple-100 font-bold">
                {room.atRestClass}
              </span>
            )}

            {/* BUG-11 FIX: show classInOp only when different from atRestClass */}
            {room.classInOp && room.classInOp !== room.atRestClass && (
              <span className="bg-amber-50 text-amber-600 text-[9px] px-2 py-0.5
                               rounded border border-amber-100 font-bold">
                {room.classInOp} (Op.)
              </span>
            )}
          </div>

          {/* Room name */}
          <h2 className="text-xl font-bold text-slate-900 leading-tight">
            {room.name || (
              <span className="text-slate-400 italic">Unnamed Room</span>
            )}
          </h2>

          {/* Room number */}
          {room.roomNo && (
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              #{room.roomNo}
            </p>
          )}
        </div>

        {/* Close button — lucide-react X */}
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="text-slate-400 hover:text-slate-700
                     bg-white hover:bg-slate-100
                     p-2 rounded-full transition-all"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────── */}
      <div className="flex border-b border-slate-100 px-4 bg-white shrink-0">
        {RDS_CATEGORIES.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'true' : undefined}
            className={`
              py-3 px-3 text-[11px] font-bold uppercase tracking-wide
              border-b-2 transition-colors
              flex items-center gap-1.5 whitespace-nowrap
              ${activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-400 hover:text-slate-600'
              }
            `}
          >
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Scrollable content ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5 bg-slate-50/50 space-y-5">
        {activeSections.map((section) => {
          const columnGroups = groupColumnsBySeason(section.columns);

          return (
            <div
              key={section.id}
              className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden"
            >
              {/* Section header */}
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100
                              flex items-center gap-2">
                <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-widest">
                  {section.title}
                </h3>
                <span className="text-[9px] text-slate-400 font-mono ml-auto">
                  {section.columns.length} fields
                </span>
              </div>

              {/* Section fields */}
              <div className="p-4 space-y-5">
                {columnGroups.map(({ groupLabel, columns }, gi) => (
                  <div key={gi}>
                    {/* Season divider */}
                    {groupLabel && (
                      <div className="flex items-center gap-2 mb-3">
                        <SeasonBadge season={groupLabel} />
                        <div className="flex-1 h-px bg-slate-100" />
                      </div>
                    )}

                    {/* Field grid */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      {columns.map((col) => (
                        <div
                          key={col.key}
                          // fullWidth flag OR wide text fields span both columns
                          className={
                            col.fullWidth ||
                            col.type === 'select-ahu' ||
                            (col.inputType === 'text' && col.width === 'w-44')
                              ? 'col-span-2'
                              : 'col-span-1'
                          }
                        >
                          <PanelField
                            col={col}
                            room={room}
                            envelope={envelope}
                            ahus={ahus}
                            onRoomUpdate={handleRoomUpdate}
                            onEnvUpdate={handleEnvUpdate}
                            onAhuChange={handleAhuChange}
                          />
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

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <div className="px-5 py-3.5 border-t border-slate-100 bg-white
                      flex justify-between items-center shrink-0">
        <button
          onClick={handleDelete}
          className="text-red-500 hover:bg-red-50 px-3 py-1.5
                     rounded text-[11px] font-bold transition-colors"
        >
          Delete Room
        </button>
        <button
          onClick={onClose}
          className="bg-slate-900 text-white px-5 py-1.5
                     rounded font-bold text-[11px]
                     hover:bg-slate-700 transition-colors shadow"
        >
          Done
        </button>
      </div>
    </div>
  );
}