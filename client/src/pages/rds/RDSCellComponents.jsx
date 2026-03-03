// RDSCellComponents.jsx
// Shared atomic cell components used by both RDSRow (table) and RoomDetailPanel (form).

import React from 'react';

// ── Table cell input ───────────────────────────────────────────────────────

export const InputCell = ({ value, onChange, disabled, type = 'number', step, placeholder = '—', className = '' }) => (
  <div className="relative w-full h-full group/cell">
    <input
      type={type}
      value={value ?? ''}
      disabled={disabled}
      onChange={onChange}
      step={step}
      placeholder={placeholder}
      className={`
        w-full h-full py-[7px] px-2 text-[11px] text-center bg-transparent border-none outline-none
        transition-all duration-150
        placeholder:text-gray-300
        ${disabled
          ? 'text-gray-400 cursor-default select-none'
          : 'text-gray-700 font-medium group-hover/cell:bg-blue-50/60 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-400 focus:text-gray-900'
        }
        ${className}
      `}
    />
    {/* Derived / read-only lock badge */}
    {disabled && (
      <span className="absolute right-0.5 top-0.5 text-[7px] text-gray-300 opacity-0 group-hover/cell:opacity-100 transition-opacity select-none pointer-events-none">
        calc
      </span>
    )}
  </div>
);

// ── Table cell select ──────────────────────────────────────────────────────

export const SelectCell = ({ value, onChange, options = [] }) => (
  <div className="relative w-full h-full group/cell">
    <select
      value={value ?? ''}
      onChange={onChange}
      className="
        w-full h-full py-[7px] px-1 text-[11px] bg-transparent border-none outline-none
        cursor-pointer appearance-none text-center font-medium text-slate-700
        group-hover/cell:bg-blue-50/60
        focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-400
        transition-all duration-150
      "
    >
      {options.map((opt) => (
        <option key={typeof opt === 'string' ? opt : opt.value} value={typeof opt === 'string' ? opt : opt.value}>
          {typeof opt === 'string' ? opt : opt.label}
        </option>
      ))}
    </select>
    {/* Subtle chevron */}
    <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-[8px] text-gray-300 opacity-0 group-hover/cell:opacity-60 transition-opacity">
      ▾
    </div>
  </div>
);

// ── Form input (used in RoomDetailPanel) ──────────────────────────────────

export const FormInput = ({ value, onChange, disabled, type = 'number', step, label, subLabel }) => (
  <div>
    {label && (
      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
        {label}
        {subLabel && <span className="text-slate-300 font-normal ml-1 normal-case">({subLabel})</span>}
      </label>
    )}
    <input
      type={type}
      value={value ?? ''}
      disabled={disabled}
      onChange={onChange}
      step={step}
      className={`
        w-full text-sm px-3 py-2 rounded-md border transition-all
        ${disabled
          ? 'bg-slate-100 text-slate-400 border-slate-100 cursor-not-allowed'
          : 'bg-white border-slate-200 text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none'
        }
      `}
    />
  </div>
);

// ── Form select (used in RoomDetailPanel) ─────────────────────────────────

export const FormSelect = ({ value, onChange, options = [], label, subLabel }) => (
  <div>
    {label && (
      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
        {label}
        {subLabel && <span className="text-slate-300 font-normal ml-1 normal-case">({subLabel})</span>}
      </label>
    )}
    <select
      value={value ?? ''}
      onChange={onChange}
      className="w-full text-sm px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
    >
      {options.map((opt) => (
        <option key={typeof opt === 'string' ? opt : opt.value} value={typeof opt === 'string' ? opt : opt.value}>
          {typeof opt === 'string' ? opt : opt.label}
        </option>
      ))}
    </select>
  </div>
);

// ── Season badge ───────────────────────────────────────────────────────────

const SEASON_COLORS = {
  Summer:  'bg-orange-100 text-orange-700 border-orange-200',
  Monsoon: 'bg-sky-100    text-sky-700    border-sky-200',
  Winter:  'bg-blue-100   text-blue-700   border-blue-200',
};

export const SeasonBadge = ({ season }) => (
  <span className={`inline-block text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${SEASON_COLORS[season] ?? 'bg-gray-100 text-gray-500'}`}>
    {season}
  </span>
);