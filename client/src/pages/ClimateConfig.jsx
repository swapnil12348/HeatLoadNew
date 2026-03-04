import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updateOutsideCondition, selectClimate } from '../features/climate/climateSlice';

const SEASONS = ['summer', 'monsoon', 'winter'];

const SEASON_STYLES = {
  summer:  { border: 'border-orange-400', badge: 'bg-orange-100 text-orange-700' },
  monsoon: { border: 'border-sky-400',    badge: 'bg-sky-100    text-sky-700'    },
  winter:  { border: 'border-blue-400',   badge: 'bg-blue-100   text-blue-700'   },
};

// ── Editable cell ─────────────────────────────────────────────────────────────
const EditCell = ({ value, onChange, step = '0.1', isText = false }) => (
  <td className="p-1 border-b border-gray-100 hover:bg-blue-50 focus-within:bg-blue-50">
    <input
      type={isText ? 'text' : 'number'}
      step={step}
      value={value ?? ''}
      onChange={onChange}
      className="w-full text-center bg-transparent outline-none text-sm p-2 text-gray-900 font-semibold"
    />
  </td>
);

// ── Read-only derived cell ─────────────────────────────────────────────────────
const DerivedCell = ({ value }) => (
  <td className="p-1 border-b border-gray-100 bg-gray-50">
    <div className="w-full text-center text-sm p-2 text-gray-500 font-mono select-none">
      {typeof value === 'number' ? value.toFixed(1) : value}
    </div>
  </td>
);

export default function ClimateConfig() {
  const dispatch = useDispatch();
  const climate  = useSelector(selectClimate);

  const handleChange = (season, field, value) => {
    const isText = field === 'time' || field === 'month';
    dispatch(updateOutsideCondition({
      season,
      field,
      value: isText ? value : (parseFloat(value) || 0),
    }));
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 pb-24">

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row justify-between items-end mb-8 border-b border-gray-200 pb-4 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Outdoor Design Conditions</h2>
          <p className="text-gray-500 mt-2">
            Seasonal outside design conditions used for all load calculations.
          </p>
          <p className="text-blue-600 text-sm font-medium mt-1">
            Indoor design conditions are set per-room on the Room Geometry tab.
          </p>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-6 mb-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-white border border-gray-300" />
          <span className="text-gray-600 font-medium">User-entered</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-gray-100 border border-gray-200" />
          <span className="text-gray-500">
            Auto-derived — changes when DB or RH changes
          </span>
        </div>
        <span className="text-amber-600 font-medium ml-4">
          ⚠ WB is reference only — calculations use DB + RH
        </span>
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-gray-50 text-gray-600 font-bold uppercase text-xs">
              <tr>
                <th className="px-6 py-4 w-28">Season</th>
                <th className="px-2 py-4 text-center">
                  DB<br/>
                  <span className="text-[10px] font-normal normal-case text-gray-400">°F</span>
                </th>
                <th className="px-2 py-4 text-center">
                  WB<br/>
                  <span className="text-[10px] font-normal normal-case text-gray-400">°F ref</span>
                </th>
                <th className="px-2 py-4 text-center">
                  RH<br/>
                  <span className="text-[10px] font-normal normal-case text-gray-400">%</span>
                </th>
                <th className="px-2 py-4 text-center bg-gray-100">
                  DP<br/>
                  <span className="text-[10px] font-normal normal-case text-gray-400">°F derived</span>
                </th>
                <th className="px-2 py-4 text-center bg-gray-100">
                  Gr/lb<br/>
                  <span className="text-[10px] font-normal normal-case text-gray-400">derived ★</span>
                </th>
                <th className="px-2 py-4 text-center">
                  Time<br/>
                  <span className="text-[10px] font-normal normal-case text-gray-400">peak</span>
                </th>
                <th className="px-2 py-4 text-center">
                  Month<br/>
                  <span className="text-[10px] font-normal normal-case text-gray-400">design</span>
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {SEASONS.map((season) => {
                const s     = climate.outside[season];
                const style = SEASON_STYLES[season];
                return (
                  <tr key={season} className="group transition-colors">

                    {/* Season label */}
                    <td className={`px-6 py-3 border-l-4 ${style.border} bg-gray-50/50`}>
                      <span className={`inline-block text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded ${style.badge}`}>
                        {season}
                      </span>
                    </td>

                    {/* DB — editable */}
                    <EditCell
                      value={s.db}
                      onChange={(e) => handleChange(season, 'db', e.target.value)}
                    />

                    {/* WB — editable (reference only) */}
                    <EditCell
                      value={s.wb}
                      onChange={(e) => handleChange(season, 'wb', e.target.value)}
                    />

                    {/* RH — editable, triggers gr+dp recalc */}
                    <EditCell
                      value={s.rh}
                      onChange={(e) => handleChange(season, 'rh', e.target.value)}
                      step="1"
                    />

                    {/* DP — read-only derived */}
                    <DerivedCell value={s.dp} />

                    {/* Gr/lb — read-only derived, used in latent load */}
                    <DerivedCell value={s.gr} />

                    {/* Time — editable text */}
                    <EditCell
                      value={s.time}
                      isText
                      onChange={(e) => handleChange(season, 'time', e.target.value)}
                    />

                    {/* Month — editable text */}
                    <EditCell
                      value={s.month}
                      isText
                      onChange={(e) => handleChange(season, 'month', e.target.value)}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Footer note ── */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-400">
          ★ Gr/lb = 0.62198 × E / (Patm − E) × 7000 &nbsp;·&nbsp;
          DP = Magnus inverse formula &nbsp;·&nbsp;
          Both derived at sea-level Patm (1013.25 hPa) — standard meteorological convention. &nbsp;·&nbsp;
          All temperatures in °F.
        </div>
      </div>
    </div>
  );
}