import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updateOutsideCondition, updateInsideCondition, selectClimate, selectClimateDiffs } from '../features/climate/climateSlice';

const SEASONS = ["summer", "monsoon", "winter"];

export default function ClimateConfig() {
  const dispatch = useDispatch();
  const climate = useSelector(selectClimate);
  const diffs = useSelector(selectClimateDiffs);

  // ── Handlers ─────────────────────────────────────────────────────────────
  
  const handleOutsideChange = (season, field, value) => {
    dispatch(updateOutsideCondition({
      season,
      field,
      value: (field === 'time' || field === 'month') ? value : parseFloat(value) || 0
    }));
  };

  const handleInsideChange = (field, value) => {
    dispatch(updateInsideCondition({
      field,
      value: parseFloat(value) || 0
    }));
  };

  // ── Validation ───────────────────────────────────────────────────────────
  
  // Hardcoded limits matching ASHRAE 55 standards
  const comfortOk =
    climate.inside.db >= 68 &&
    climate.inside.db <= 78 &&
    climate.inside.rh <= 60;

  // ── UI Helpers ───────────────────────────────────────────────────────────
  
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
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-end mb-8 border-b border-gray-200 pb-4 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Climate Conditions</h2>
          <p className="text-gray-500 mt-2">
            Configure Outside Design Conditions and Inside ASHRAE Comfort parameters.
          </p>
        </div>
        
        {/* Comfort Status Badge */}
        <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-bold shadow-sm
          ${comfortOk 
            ? 'bg-green-50 border-green-200 text-green-700' 
            : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {comfortOk ? "✓ ASHRAE 55 COMFORT OK" : "⚠ CHECK COMFORT CONDITIONS"}
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-gray-50 text-gray-600 font-bold uppercase text-xs">
              <tr>
                <th className="px-6 py-4">Condition</th>
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
              
              {/* Outside Seasons */}
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

              {/* Inside Conditions - FIXED: Removed comments between TDs */}
              <tr className="bg-emerald-50/50 border-t-2 border-emerald-100">
                <td className="px-6 py-3 font-bold text-emerald-800 border-l-4 border-emerald-500">
                  Inside <span className="text-xs font-normal text-emerald-600 block">ASHRAE 55</span>
                </td>
                <InputCell value={climate.inside.db} onChange={(e) => handleInsideChange('db', e.target.value)} />
                <td className="bg-gray-50"></td>
                <InputCell value={climate.inside.rh} onChange={(e) => handleInsideChange('rh', e.target.value)} />
                <InputCell value={climate.inside.dp} onChange={(e) => handleInsideChange('dp', e.target.value)} />
                <InputCell value={climate.inside.gr} onChange={(e) => handleInsideChange('gr', e.target.value)} />
                <td className="text-center font-bold text-emerald-600 text-xs bg-emerald-50/30">24 Hrs</td>
                <td className="bg-gray-50"></td>
              </tr>

              {/* Differences Header */}
              <tr className="bg-amber-50">
                <td colSpan={8} className="px-6 py-2 text-xs font-bold text-amber-700 uppercase tracking-wider border-t border-amber-200">
                  Calculated Differences (Outside − Inside) 
                  <span className="ml-2 font-normal normal-case text-amber-600">
                    Used for Sensible (CFM × 1.08 × ΔDB) & Latent (CFM × 0.68 × ΔGr)
                  </span>
                </td>
              </tr>

              {/* Differences Rows */}
              {SEASONS.map((season) => (
                <tr key={`${season}-diff`} className="bg-amber-50/30">
                  <td className="px-6 py-3 font-semibold text-amber-800 capitalize pl-8 text-xs">
                    {season} Diff
                  </td>
                  <td className="text-center py-3 font-mono font-bold text-amber-700">
                    {diffs[season].db}
                  </td>
                  <td className="bg-gray-50"></td>
                  <td className="bg-gray-50"></td>
                  <td className="bg-gray-50"></td>
                  <td className="text-center py-3 font-mono font-bold text-amber-700">
                    {diffs[season].gr}
                  </td>
                  <td className="bg-gray-50"></td>
                  <td className="bg-gray-50"></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer Info */}
        <div className="bg-blue-50 px-6 py-3 border-t border-blue-100 text-xs text-blue-800">
          <strong>Design Note:</strong> Operative Temperature 73–79°F (Summer) / 68–74°F (Winter) per ASHRAE 55-2020.
        </div>
      </div>
    </div>
  );
}