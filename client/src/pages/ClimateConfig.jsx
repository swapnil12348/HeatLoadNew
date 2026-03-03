import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updateOutsideCondition, selectClimate } from '../features/climate/climateSlice';

const SEASONS = ["summer", "monsoon", "winter"];

export default function ClimateConfig() {
  const dispatch = useDispatch();
  const climate = useSelector(selectClimate);

  const handleOutsideChange = (season, field, value) => {
    dispatch(updateOutsideCondition({
      season,
      field,
      value: (field === 'time' || field === 'month') ? value : parseFloat(value) || 0
    }));
  };

  const InputCell = ({ value, onChange, readOnly = false }) => (
    <td className={`p-1 border-b border-gray-100 ${readOnly ? 'bg-gray-50' : 'hover:bg-blue-50 focus-within:bg-blue-50'}`}>
      <input
        type={typeof value === 'string' ? "text" : "number"}
        step="0.1"
        value={value}
        readOnly={readOnly}
        onChange={onChange}
        className={`w-full text-center bg-transparent outline-none text-sm p-2 
          ${readOnly ? 'text-gray-500 font-normal' : 'text-gray-900 font-semibold'}`}
      />
    </td>
  );

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 pb-24">
      <div className="flex flex-col md:flex-row justify-between items-end mb-8 border-b border-gray-200 pb-4 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Project Outdoor Weather</h2>
          <p className="text-gray-500 mt-2">
            Configure the global Outside Design Conditions for the building location. 
            <br />
            <span className="text-blue-600 font-medium">Inside design conditions are now set individually on the Room Geometry tab.</span>
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-gray-50 text-gray-600 font-bold uppercase text-xs">
              <tr>
                <th className="px-6 py-4">Season</th>
                <th className="px-2 py-4 text-center">DB (°F)</th>
                <th className="px-2 py-4 text-center">WB (°F)</th>
                <th className="px-2 py-4 text-center">RH (%)</th>
                <th className="px-2 py-4 text-center">DP (°F)</th>
                <th className="px-2 py-4 text-center">Gr/lb</th>
                <th className="px-2 py-4 text-center">Time</th>
                <th className="px-2 py-4 text-center">Month</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {SEASONS.map((season) => (
                <tr key={season} className="group transition-colors">
                  <td className="px-6 py-3 font-bold text-gray-700 capitalize border-l-4 border-transparent group-hover:border-blue-500 bg-gray-50/50">
                    {season}
                  </td>
                  {["db", "wb", "rh", "dp", "gr"].map((f) => (
                    <InputCell 
                      key={f} 
                      value={climate.outside[season][f]} 
                      onChange={(e) => handleOutsideChange(season, f, e.target.value)} 
                    />
                  ))}
                  <InputCell 
                    value={climate.outside[season].time} 
                    onChange={(e) => handleOutsideChange(season, 'time', e.target.value)} 
                  />
                  <InputCell 
                    value={climate.outside[season].month} 
                    onChange={(e) => handleOutsideChange(season, 'month', e.target.value)} 
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}