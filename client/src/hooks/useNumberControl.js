/**
 * useNumberControl.js
 * Encapsulates all clamping / stepping logic for numeric inputs.
 * Keeps NumberControl.jsx a pure presentational component.
 *
 * ── DESIGN RATIONALE ─────────────────────────────────────────────────────────
 *
 *   handleChange allows free typing — does NOT clamp on every keystroke.
 *   Clamping on every keystroke prevents the engineer from typing multi-digit
 *   values (e.g. typing '1' before '10' would be clamped to min if min=5).
 *
 *   handleBlur enforces min/max on focus-leave. This is the ONLY path that
 *   dispatches a clamped numeric value to Redux. The sequence:
 *     1. handleChange  → dispatch string (in-progress typing)
 *     2. handleBlur    → dispatch clamped number (committed value)
 *
 *   Redux selectors use parseFloat() on all numeric fields, so receiving a
 *   string during typing is safe — it will parse to the correct number.
 *
 * ── designRH = 0 CONTRACT ────────────────────────────────────────────────────
 *
 *   This hook uses: const safeVal = (v) => parseFloat(v) || 0
 *
 *   For increment/decrement: safeVal(0) = 0 — correct. Decrement from 1% RH
 *   floors at min (which the caller sets to 0 for dry-room controls).
 *
 *   For handleBlur: if the user clears the field and tabs out, NaN → min.
 *   If min=0 (dry room), the field resets to 0 — correct. The calc layer
 *   uses room.designRH != null (not || 50) so 0 passes through correctly.
 *
 *   For a dry-room RH control: pass min=0, max=100. The hook is correct.
 *
 * @param {object} params
 * @param {number|string} params.value     - current value
 * @param {function}      params.onChange  - called with new value
 * @param {number}        [params.min=0]   - minimum allowed value
 * @param {number}        [params.max]     - maximum allowed value (default: no max)
 * @param {number}        [params.step=1]  - increment/decrement step
 */
const useNumberControl = ({
  value,
  onChange,
  min    = 0,
  max    = Infinity,
  step   = 1,
}) => {
  const safeVal = (v) => parseFloat(v) || 0;

  const handleIncrement = () => {
    const next = safeVal(value) + step;
    onChange(max !== Infinity ? Math.min(max, next) : next);
  };

  const handleDecrement = () => {
    const next = safeVal(value) - step;
    onChange(Math.max(min, next));
  };

  // Allow free typing — clamp only on blur.
  // Dispatching a string during typing is safe: all Redux fields use parseFloat().
  const handleChange = (e) => {
    onChange(e.target.value);
  };

  // On blur, enforce min/max so Redux never receives an out-of-range value.
  // NaN (empty field) → min. This is correct for all numeric HVAC fields.
  const handleBlur = (e) => {
    let v = parseFloat(e.target.value);
    if (isNaN(v)) v = min;
    v = Math.max(min, v);
    if (max !== Infinity) v = Math.min(max, v);
    onChange(v);
  };

  const isAtMin = safeVal(value) <= min;
  const isAtMax = max !== Infinity && safeVal(value) >= max;

  return {
    handleIncrement,
    handleDecrement,
    handleChange,
    handleBlur,
    isAtMin,
    isAtMax,
  };
};

export default useNumberControl;