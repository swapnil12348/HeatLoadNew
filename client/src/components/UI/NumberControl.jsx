/**
 * NumberControl.jsx
 * Responsibility: Labelled numeric input with increment/decrement buttons.
 *
 * Presentational component only — all clamping/stepping logic lives in
 * useNumberControl. See that hook for the designRH = 0 contract and the
 * rationale for clamping only on blur, not on every keystroke.
 *
 * Physical quantities that CAN be negative (pass min explicitly):
 *   - latitude (southern hemisphere: min={-90})
 *   - designTemp in °C (cold climates: min={-50})
 *   - ADP in °F (can be 32°F minimum for non-freezing coil)
 *
 * Default min = 0 catches the most common accidental negatives.
 * Default max = Infinity — callers set explicit max where needed (e.g. RH max={100}).
 */

import useNumberControl from '../../hooks/useNumberControl';

const NumberControl = ({
  label,
  value,
  onChange,
  unit = '',
  min  = 0,
  max  = Infinity,
  step = 1,
}) => {
  const {
    handleIncrement,
    handleDecrement,
    handleChange,
    handleBlur,
    isAtMin,
    isAtMax,
  } = useNumberControl({ value, onChange, min, max, step });

  return (
    <div className="flex flex-col">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      <div className="flex items-center w-full border border-gray-300 rounded-md shadow-sm bg-white overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 transition-all">

        {/* Decrement — visually disabled at min */}
        <button
          type="button"
          onClick={handleDecrement}
          disabled={isAtMin}
          className="px-3 py-2 bg-gray-50 text-gray-600 hover:bg-gray-200 border-r border-gray-300
                     disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-gray-50
                     transition-colors"
        >
          −
        </button>

        <input
          type="number"
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          step={step}
          min={min}
          max={max === Infinity ? undefined : max}
          className="w-full text-center py-2 text-gray-800 font-medium focus:outline-none appearance-none"
        />

        <span className="bg-gray-50 text-gray-500 text-sm py-2 px-3 border-l border-r border-gray-300 min-w-[3.5rem] text-center font-medium">
          {unit}
        </span>

        {/* Increment — visually disabled at max */}
        <button
          type="button"
          onClick={handleIncrement}
          disabled={isAtMax}
          className="px-3 py-2 bg-gray-50 text-gray-600 hover:bg-gray-200 border-l border-gray-300
                     disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-gray-50
                     transition-colors"
        >
          +
        </button>

      </div>
    </div>
  );
};

export default NumberControl;