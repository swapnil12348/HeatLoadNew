import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { addAHU, updateAHU, deleteAHU } from '../features/ahu/ahuSlice';

// ── Constants ───────────────────────────────────────────────────────────────
const ISO_CLASSES = [
  { value: "ISO 1", label: "ISO 1 (Highest Cleanliness)" },
  { value: "ISO 2", label: "ISO 2" },
  { value: "ISO 3", label: "ISO 3 (Class 1)" },
  { value: "ISO 4", label: "ISO 4 (Class 10)" },
  { value: "ISO 5", label: "ISO 5 (Class 100)" },
  { value: "ISO 6", label: "ISO 6 (Class 1,000)" },
  { value: "ISO 7", label: "ISO 7 (Class 10,000)" },
  { value: "ISO 8", label: "ISO 8 (Class 100,000)" }, // Standard pharma/industrial
  { value: "ISO 9", label: "ISO 9 (Room Air)" },
];

const DESIGN_SCHEMES = [
  "Conventional Pharma Ducting",
  "Once Through System",
  "Dehumidifier Integration",
  "Plenum / Fan Filter Unit Design"
];

const CONFIGURATIONS = [
  "Draw-through (Fan after Coil)",
  "Blow-through (Fan before Coil)"
];

// ── Main Component ──────────────────────────────────────────────────────────
export default function AHUConfig() {
  const dispatch = useDispatch();
  
  // Access Redux State: Get the list from the 'ahus' slice
  const { list: ahus } = useSelector((state) => state.ahus);

  // ── Handlers ──
  const handleAdd = () => {
    dispatch(addAHU());
  };

  const handleUpdate = (id, field, value) => {
    dispatch(updateAHU({ id, field, value }));
  };

  const handleDelete = (id) => {
    if (ahus.length > 1) {
      if(window.confirm("Are you sure you want to delete this AHU?")) {
        dispatch(deleteAHU(id));
      }
    } else {
      alert("You must have at least one AHU.");
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 pb-24">
      
      {/* Page Header */}
      <div className="flex justify-between items-end mb-8 border-b border-gray-200 pb-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">AHU Selection</h2>
          <p className="text-gray-500 mt-2">
            Configure Air Handling Units, Cleanroom Standards, and System Topologies.
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold shadow-md transition-colors"
        >
          <span>+</span> Add New AHU
        </button>
      </div>

      {/* AHU List Grid */}
      <div className="space-y-6">
        {ahus.map((ahu, index) => (
          <div 
            key={ahu.id || index} 
            className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
          >
            {/* AHU Card Header */}
            <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-700 flex items-center gap-3">
                <span className="bg-blue-100 text-blue-700 w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold">
                  {index + 1}
                </span>
                {ahu.roomName ? ahu.roomName : `AHU-${index + 1}`} Configuration
              </h3>
              
              {ahus.length > 1 && (
                <button 
                  onClick={() => handleDelete(ahu.id)}
                  className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded transition-colors"
                >
                  Delete
                </button>
              )}
            </div>

            {/* Inputs Grid */}
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              
              {/* 1. Room Name Serving */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Serving Room / Zone</label>
                <input
                  type="text"
                  value={ahu.roomName || ''}
                  onChange={(e) => handleUpdate(ahu.id, 'roomName', e.target.value)}
                  placeholder="e.g. Production Hall A"
                  className="w-full border border-gray-300 rounded-md p-2.5 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              {/* 2. ISO Class Dropdown */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">ISO Cleanroom Class</label>
                <div className="relative">
                  <select
                    value={ahu.isoClass || 'ISO 8'}
                    onChange={(e) => handleUpdate(ahu.id, 'isoClass', e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-md p-2.5 pr-8 focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
                  >
                    {ISO_CLASSES.map((iso) => (
                      <option key={iso.value} value={iso.value}>{iso.label}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                    <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                  </div>
                </div>
              </div>

              {/* 3. Design Scheme */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">System Design Scheme</label>
                <div className="relative">
                  <select
                    value={ahu.designScheme || ''}
                    onChange={(e) => handleUpdate(ahu.id, 'designScheme', e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-md p-2.5 pr-8 focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
                  >
                    {DESIGN_SCHEMES.map((scheme) => (
                      <option key={scheme} value={scheme}>{scheme}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                    <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                  </div>
                </div>
              </div>

              {/* 4. Configuration */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Fan Configuration</label>
                <div className="relative">
                  <select
                    value={ahu.configuration || ''}
                    onChange={(e) => handleUpdate(ahu.id, 'configuration', e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-md p-2.5 pr-8 focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
                  >
                    {CONFIGURATIONS.map((config) => (
                      <option key={config} value={config}>{config}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                    <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                  </div>
                </div>
              </div>

            </div>
          </div>
        ))}
      </div>
    </div>
  );
}