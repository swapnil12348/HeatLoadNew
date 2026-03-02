import React from 'react';

const NumberControl = ({ label, value, onChange, unit = "" }) => {
  const safeVal = (v) => parseFloat(v) || 0;

  const handleIncrement = () => onChange(safeVal(value) + 1);
  const handleDecrement = () => onChange(safeVal(value) - 1);
  const handleChange = (e) => onChange(e.target.value);

  return (
    <div className="flex flex-col">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      <div className="flex items-center w-full border border-gray-300 rounded-md shadow-sm bg-white overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 transition-all">
        <button
          type="button"
          onClick={handleDecrement}
          className="px-3 py-2 bg-gray-50 text-gray-600 hover:bg-gray-200 border-r border-gray-300"
        >
          -
        </button>
        
        <input
          type="number"
          value={value}
          onChange={handleChange}
          className="w-full text-center py-2 text-gray-800 font-medium focus:outline-none appearance-none"
        />
        
        <span className="bg-gray-50 text-gray-500 text-sm py-2 px-3 border-l border-r border-gray-300 min-w-[3.5rem] text-center font-medium">
          {unit}
        </span>

        <button
          type="button"
          onClick={handleIncrement}
          className="px-3 py-2 bg-gray-50 text-gray-600 hover:bg-gray-200 border-l border-gray-300"
        >
          +
        </button>
      </div>
    </div>
  );
};

export default NumberControl;