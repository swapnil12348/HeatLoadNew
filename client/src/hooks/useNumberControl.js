/**
 * useNumberControl
 * Encapsulates all clamping / stepping logic for numeric inputs.
 * Keeps NumberControl.jsx a pure presentational component.
 */
const useNumberControl = ({ value, onChange, min = 0, max = Infinity, step = 1 }) => {
  const safeVal = (v) => parseFloat(v) || 0;

  const handleIncrement = () => {
    const next = safeVal(value) + step;
    onChange(max !== Infinity ? Math.min(max, next) : next);
  };

  const handleDecrement = () => {
    const next = safeVal(value) - step;
    onChange(Math.max(min, next));
  };

  const handleChange = (e) => {
    // Allow free typing — clamp only on blur
    onChange(e.target.value);
  };

  const handleBlur = (e) => {
    // On blur, enforce min/max so Redux never receives an out-of-range value
    let v = parseFloat(e.target.value);
    if (isNaN(v)) v = min;
    v = Math.max(min, v);
    if (max !== Infinity) v = Math.min(max, v);
    onChange(v);
  };

  const isAtMin = safeVal(value) <= min;
  const isAtMax = max !== Infinity && safeVal(value) >= max;

  return { handleIncrement, handleDecrement, handleChange, handleBlur, isAtMin, isAtMax };
};

export default useNumberControl;