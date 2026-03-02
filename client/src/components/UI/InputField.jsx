import React from 'react';

const InputField = ({ label, name, value, onChange, placeholder, fullWidth = false, type = "text" }) => (
  <div className={fullWidth ? "col-span-1 md:col-span-2" : "col-span-1"}>
    <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
    {type === 'select' ? (
      <div className="relative">
        {/* Children passed here would be <options> */}
        <select
          name={name}
          value={value}
          onChange={onChange}
          className="w-full appearance-none bg-white border border-gray-300 rounded-md px-3 py-2 pr-8 text-gray-800 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          {placeholder} 
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
           <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
        </div>
      </div>
    ) : (
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-800 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder-gray-400"
      />
    )}
  </div>
);

export default InputField;