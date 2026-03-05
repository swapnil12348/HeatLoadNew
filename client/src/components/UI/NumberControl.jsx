import React from 'react';

/**
 * NumberControl
 *
 * MINOR-04 FIX: added optional `min` and `max` props with sensible defaults.
 *
 * Why this matters for HVAC calculations:
 *   - safetyFactor = 0% → multiplier = 1.0 (valid floor)
 *     safetyFactor < 0% → multiplier < 1.0 → loads REDUCED → dangerous undersize
 *   - bypassFactor < 0 → negative coil air → nonsensical
 *   - elevation < 0    → negative altitude correction → wrong Patm
 *   - RH < 0 or > 100  → psychrometric functions return NaN / garbage
 *
 * Physical quantities that CAN be negative (pass min explicitly):
 *   - latitude (southern hemisphere: min={-90})
 *   - designTemp in °C (cold climates: min={-50})
 *   - ADP in °F (can be 32°F minimum for non-freezing coil)
 *
 * Default min = 0 catches the most common accidental negatives.
 * Default max = Infinity — callers set explicit max where needed (e.g. RH max={100}).
 */
const NumberControl = ({
  label,
  value,
  onChange,
  unit  = '',
  min   = 0,
  max   = Infinity,
  step  = 1,
}) => {
  const safeVal = (v) => parseFloat(v) || 0;

  const handleIncrement = () => {
    const next = safeVal(value) + step;
    onChange(max !== Infinity ? Math.min(max, next) : next);
  };

  const handleDecrement = () => {
    // MINOR-04 FIX: clamp to min instead of allowing unconstrained descent.
    const next = safeVal(value) - step;
    onChange(Math.max(min, next));
  };

  const handleChange = (e) => {
    // Allow free typing — clamp only on blur so user can type e.g. "10" digit by digit.
    onChange(e.target.value);
  };

  const handleBlur = (e) => {
    // On blur, enforce min/max so Redux never receives an out-of-range value.
    let v = parseFloat(e.target.value);
    if (isNaN(v)) v = min;
    v = Math.max(min, v);
    if (max !== Infinity) v = Math.min(max, v);
    onChange(v);
  };

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
          disabled={safeVal(value) <= min}
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
          disabled={max !== Infinity && safeVal(value) >= max}
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