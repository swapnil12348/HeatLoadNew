/**
 * RdsCellRenderer.jsx
 * Responsibility: Route a single RDS column definition to the correct
 *                 cell component. Pure renderer — zero Redux dispatch.
 *
 * Accepts pre-bound handlers from useRdsRow so it stays stateless
 * and testable in isolation.
 *
 * Cell type routing:
 *   'select-ahu' → AHU dropdown (sticky, special styling)
 *   'select'     → Standard option select
 *   'readOnly'   → Disabled input with "calc" hover badge
 *   'number'     → Editable number input (default)
 *   'text'       → Editable text input
 */

import React from 'react';
import { InputCell, SelectCell } from './RDSCellComponents';
import { getFieldValue }         from './RDSConfig';

// ── Section background palette ─────────────────────────────────────────────
// One entry per section color used in RDS_SECTIONS across all category files.
// Add new colors here when new sections are added.
export const SECTION_BG = {
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

// ── Sub-renderers ──────────────────────────────────────────────────────────

/**
 * AHU selector cell — sticky, special blue styling, uses handleAhuChange.
 */
const AhuCell = ({ col, currentAhuId, ahus, onAhuChange }) => (
  <td
    key={col.key}
    className={`
      p-0 border-b border-r border-gray-100
      sticky left-8 z-20 bg-white
      shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]
      ${col.width || 'min-w-[110px]'}
    `}
  >
    <select
      value={currentAhuId}
      onChange={(e) => onAhuChange(e.target.value)}
      className="
        w-full py-[7px] px-2 text-[11px] font-bold text-blue-600
        bg-transparent border-none outline-none cursor-pointer
        hover:bg-blue-50/60 focus:ring-2 focus:ring-inset focus:ring-blue-400
        transition-all appearance-none
      "
    >
      <option value="">— AHU —</option>
      {ahus.map((a) => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </select>
  </td>
);

/**
 * Standard select cell — routes through handleRoomUpdate.
 */
const SelectCellWrapper = ({ col, value, bg, onRoomUpdate }) => (
  <td
    key={col.key}
    className={`p-0 border-b border-r border-gray-100 ${bg} ${col.width || 'min-w-[80px]'}`}
  >
    <SelectCell
      value={value}
      onChange={(e) => onRoomUpdate(col, e.target.value)}
      options={col.options || []}
    />
  </td>
);

/**
 * Input cell — handles number, text, and readOnly variants.
 * Routes to handleEnvUpdate or handleRoomUpdate based on col.isEnv.
 */
const InputCellWrapper = ({ col, value, bg, onRoomUpdate, onEnvUpdate }) => (
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
          ? (e) => onEnvUpdate(col, e.target.value)
          : (e) => onRoomUpdate(col, e.target.value)
      }
      className={col.inputType === 'text' ? 'text-left px-2' : 'text-center'}
    />
  </td>
);

// ── Main export ───────────────────────────────────────────────────────────

/**
 * RdsCellRenderer
 *
 * @param {object}   col           - column definition from RDS_SECTIONS
 * @param {object}   room          - room state object (from rdsSelector)
 * @param {object}   envelope      - envelope state for this room
 * @param {string[]} ahus          - AHU list for AHU selector
 * @param {string}   sectionColor  - section color key (drives bg tint)
 * @param {string}   currentAhuId  - currently assigned AHU id
 * @param {Function} onRoomUpdate  - (col, rawValue) → void
 * @param {Function} onEnvUpdate   - (col, rawValue) → void
 * @param {Function} onAhuChange   - (ahuId) → void
 */
const RdsCellRenderer = ({
  col,
  room,
  envelope,
  ahus,
  sectionColor,
  currentAhuId,
  onRoomUpdate,
  onEnvUpdate,
  onAhuChange,
}) => {
  const value = getFieldValue(col, room, envelope);
  const bg    = SECTION_BG[sectionColor] || 'bg-white';

  if (col.type === 'select-ahu') {
    return (
      <AhuCell
        key={col.key}
        col={col}
        currentAhuId={currentAhuId}
        ahus={ahus}
        onAhuChange={onAhuChange}
      />
    );
  }

  if (col.type === 'select') {
    return (
      <SelectCellWrapper
        key={col.key}
        col={col}
        value={value}
        bg={bg}
        onRoomUpdate={onRoomUpdate}
      />
    );
  }

  return (
    <InputCellWrapper
      key={col.key}
      col={col}
      value={value}
      bg={bg}
      onRoomUpdate={onRoomUpdate}
      onEnvUpdate={onEnvUpdate}
    />
  );
};

export default RdsCellRenderer;