/**
 * RDSCellComponents.jsx
 * Responsibility: Atomic cell and form components shared by RDSRow (table)
 *                 and RoomDetailPanel (form).
 *
 * Exports:
 *   InputCell    — table cell number/text input with calc badge
 *   SelectCell   — table cell <select>
 *   FormInput    — form-style labelled input (RoomDetailPanel)
 *   FormSelect   — form-style labelled select (RoomDetailPanel)
 *   SeasonBadge  — coloured season label badge
 *
 * Fixes vs previous version:
 *   - Dead React import removed
 *   - SeasonBadge SEASON_COLORS keyed lowercase to match rdsSeasons.js output
 *     (was title-case — badge always fell back to gray)
 *   - SelectCell option rendering extracted to resolveOption() helper —
 *     eliminates triple typeof repetition
 *   - FieldLabel sub-component extracted — shared by FormInput + FormSelect
 *   - InputCell placeholder changed from '—' to '' — '—' triggered browser
 *     number input validation warnings
 *   - Disabled cursor unified: cursor-not-allowed across both InputCell + FormInput
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * resolveOption()
 * Normalises a select option that is either a plain string or { value, label }.
 * Eliminates the repeated `typeof opt === 'string' ? ...` ternary.
 *
 * @param {string | { value: string, label: string }} opt
 * @returns {{ value: string, label: string }}
 */
const resolveOption = (opt) =>
  typeof opt === 'string'
    ? { value: opt, label: opt }
    : { value: opt.value, label: opt.label ?? opt.value };

// ── FieldLabel ────────────────────────────────────────────────────────────────
// Shared label rendering between FormInput and FormSelect.

const FieldLabel = ({ label, subLabel }) => {
  if (!label) return null;
  return (
    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
      {label}
      {subLabel && (
        <span className="text-slate-300 font-normal ml-1 normal-case">
          ({subLabel})
        </span>
      )}
    </label>
  );
};

// ── InputCell ─────────────────────────────────────────────────────────────────
// Table cell — editable number/text or read-only derived field.
// Used by RdsCellRenderer for every non-select column in the RDS table.

export const InputCell = ({
  value,
  onChange,
  disabled,
  type      = 'number',
  step,
  placeholder = '',    // FIX: was '—' — invalid for number inputs, browser warning
  className = '',
}) => (
  <div className="relative w-full h-full group/cell">
    <input
      type={type}
      value={value ?? ''}
      disabled={disabled}
      onChange={onChange}
      step={step}
      placeholder={placeholder}
      className={`
        w-full h-full py-[7px] px-2 text-[11px] text-center
        bg-transparent border-none outline-none
        transition-all duration-150
        placeholder:text-gray-300
        ${disabled
          ? 'text-gray-400 cursor-not-allowed select-none'
          : `text-gray-700 font-medium
             group-hover/cell:bg-blue-50/60
             focus:bg-white focus:ring-2 focus:ring-inset
             focus:ring-blue-400 focus:text-gray-900`
        }
        ${className}
      `}
    />
    {/* "calc" badge — shown on hover for derived/read-only cells */}
    {disabled && (
      <span className="
        absolute right-0.5 top-0.5
        text-[7px] text-gray-300
        opacity-0 group-hover/cell:opacity-100
        transition-opacity select-none pointer-events-none
      ">
        calc
      </span>
    )}
  </div>
);

// ── SelectCell ────────────────────────────────────────────────────────────────
// Table cell — dropdown select.
// Used by RdsCellRenderer for select-type columns.

export const SelectCell = ({ value, onChange, options = [] }) => (
  <div className="relative w-full h-full group/cell">
    <select
      value={value ?? ''}
      onChange={onChange}
      className="
        w-full h-full py-[7px] px-1 text-[11px]
        bg-transparent border-none outline-none
        cursor-pointer appearance-none text-center
        font-medium text-slate-700
        group-hover/cell:bg-blue-50/60
        focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-400
        transition-all duration-150
      "
    >
      {options.map((opt) => {
        const { value: v, label: l } = resolveOption(opt);
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>

    {/* Subtle chevron on hover */}
    <div className="
      absolute right-1 top-1/2 -translate-y-1/2
      pointer-events-none text-[8px] text-gray-300
      opacity-0 group-hover/cell:opacity-60
      transition-opacity
    ">
      ▾
    </div>
  </div>
);

// ── FormInput ─────────────────────────────────────────────────────────────────
// Form-style labelled input — used in RoomDetailPanel side panel.

export const FormInput = ({
  value,
  onChange,
  disabled,
  type     = 'number',
  step,
  label,
  subLabel,
}) => (
  <div className="flex flex-col gap-1.5">
    {label && (
      <label className="text-xs font-semibold text-slate-500 flex items-center gap-1">
        {label}
        {subLabel && (
          <span className="text-slate-400 font-normal text-[11px]">({subLabel})</span>
        )}
      </label>
    )}
    <input
      type={type}
      value={value ?? ''}
      disabled={disabled}
      onChange={onChange}
      step={step}
      className={`
        w-full text-sm px-3 py-2 rounded-lg border transition-all
        ${disabled
          ? 'bg-slate-50 text-slate-400 border-slate-100 cursor-not-allowed'
          : `bg-white border-slate-200 text-slate-800 font-medium
             focus:border-blue-500 focus:ring-2 focus:ring-blue-100
             focus:outline-none hover:border-slate-300`
        }
      `}
    />
  </div>
);
// ── FormSelect ────────────────────────────────────────────────────────────────
// Form-style labelled select — used in RoomDetailPanel side panel.

export const FormSelect = ({
  value,
  onChange,
  options  = [],
  label,
  subLabel,
}) => (
  <div className="flex flex-col gap-1.5">
    {label && (
      <label className="text-xs font-semibold text-slate-500 flex items-center gap-1">
        {label}
        {subLabel && (
          <span className="text-slate-400 font-normal text-[11px]">({subLabel})</span>
        )}
      </label>
    )}
    <select
      value={value ?? ''}
      onChange={onChange}
      className="
        w-full text-sm px-3 py-2 rounded-lg border border-slate-200
        bg-white text-slate-800 font-medium
        focus:border-blue-500 focus:ring-2 focus:ring-blue-100
        focus:outline-none transition-all hover:border-slate-300
        cursor-pointer
      "
    >
      {options.map((opt) => {
        const v = typeof opt === 'string' ? opt : opt.value;
        const l = typeof opt === 'string' ? opt : (opt.label ?? opt.value);
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  </div>
);
// ── SeasonBadge ───────────────────────────────────────────────────────────────
// Coloured pill badge for season labels.


// Consumed by RoomDetailPanel section dividers and rdsSeasons column headers.
//
// FIX: keys are now lowercase to match rdsSeasons.js which passes
// 'summer' | 'monsoon' | 'winter' — was title-case so always fell back to gray.

const SEASON_COLORS = {
  summer:  'bg-orange-100 text-orange-700 border-orange-200',
  monsoon: 'bg-sky-100    text-sky-700    border-sky-200',
  winter:  'bg-blue-100   text-blue-700   border-blue-200',
};

export const SeasonBadge = ({ season }) => {
  // Normalise — accept both 'Summer' and 'summer'
  const key = season?.toLowerCase() ?? '';
  return (
    <span className={`
      inline-block text-[8px] font-bold uppercase tracking-wider
      px-1.5 py-0.5 rounded border
      ${SEASON_COLORS[key] ?? 'bg-gray-100 text-gray-500 border-gray-200'}
    `}>
      {season}
    </span>
  );
};