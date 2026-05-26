/**
 * InputGroup.tsx
 * Responsibility: Labelled numeric input with inline unit suffix.
 *
 * Used for climate and project detail fields where a simple
 * text/number input with a unit label is sufficient.
 * For increment/decrement controls use NumberControl instead.
 */

import { ChangeEvent } from 'react';

// Define the exact props this component accepts
interface InputGroupProps {
  label: string;
  value: string | number;
  // This tells TS the event specifically comes from an input field
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  unit?: string;               // Optional, some inputs might not have units
  type?: string;               // Optional, defaults to 'number'
  step?: string | number;      // Optional, defaults to '1'
  className?: string;          // Optional, defaults to ''
}

const InputGroup = ({
  label,
  value,
  onChange,
  unit,
  type = 'number',
  step = '1',
  className = '',
}: InputGroupProps) => (
  <div className={`flex flex-col space-y-1 ${className}`}>
    <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">
      {label}
    </label>
    <div className="relative">
      <input
        type={type}
        step={step}
        value={value}
        onChange={onChange}
        className="w-full p-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 font-medium"
      />
      {unit && (
        <span className="absolute right-3 top-2.5 text-gray-400 text-sm font-medium">
          {unit}
        </span>
      )}
    </div>
  </div>
);

export default InputGroup;