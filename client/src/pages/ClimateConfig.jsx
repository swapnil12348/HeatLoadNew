/**
 * ClimateConfig.jsx
 * Responsibility: Outdoor design conditions per season (Summer, Monsoon, Winter).
 *
 * Changelog:
 *   v2.0 — parseFloat(value) || 0 → parseFloat(value) to preserve winter negatives
 *         — value ?? '' nullish guard in EditCell
 *         — RH step 1 → 0.1
 *         — Elevation note at >1000 ft
 *   v2.1 — WB column changed from editable to read-only (DerivedCell).
 *           climateSlice.deriveFields() computes WB from DB+RH via
 *           calculateWetBulb(). Any manual WB entry was silently overwritten
 *           on the next DB/RH change — read-only is the correct behaviour.
 *         — ASHRAE design tier quick-apply buttons added for Summer DB.
 *           Default in climateSlice is 109.9°F (43.3°C, 0.4% ASHRAE Delhi).
 *           Buttons let users apply 0.4% / 1% / 2% design values without
 *           looking up ASHRAE HOF 2021 Ch.14 Table 1 manually.
 *           Values are for Delhi (28°N) — extend ASHRAE_DESIGN_DB for other cities.
 *   v2.2 — elevation fallback changed from || 0 to ?? 0 (correct nullish intent)
 *         — Removed stale inline fix-tag annotations; domain reasoning preserved
 */

import { useSelector, useDispatch } from 'react-redux';
import { updateOutsideCondition, selectClimate } from '../features/climate/climateSlice';

const SEASONS = ['summer', 'monsoon', 'winter'];

const SEASON_STYLES = {
  summer:  { border: 'border-orange-400', badge: 'bg-orange-100 text-orange-700' },
  monsoon: { border: 'border-sky-400',    badge: 'bg-sky-100    text-sky-700'    },
  winter:  { border: 'border-blue-400',   badge: 'bg-blue-100   text-blue-700'   },
};

// ── ASHRAE HOF 2021 Ch.14 Table 1 — Delhi (28°N) design DB values ────────────
// Quick-apply buttons so users don't need to look up Table 1 manually.
// Extend this object with other cities as the project location library grows.
const ASHRAE_DESIGN_DB = {
  'Delhi (28°N)': {
    '0.4%': { db: 109.9, label: '0.4% — Critical facilities (24/7 semicon / pharma)' },
    '1.0%': { db: 107.1, label: '1.0% — General commercial / industrial'             },
    '2.0%': { db: 104.4, label: '2.0% — Less-critical / comfort cooling'              },
  },
};
const DEFAULT_CITY = 'Delhi (28°N)';

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

// ── Read-only derived cell (WB, DP, Gr/lb) ───────────────────────────────────
// WB uses this component because climateSlice.deriveFields() recomputes it from
// DB+RH on every change — an editable WB would be silently overwritten.
const DerivedCell = ({ value }) => (
  <td className="p-1 border-b border-gray-100 bg-gray-50">
    <div className="w-full text-center text-sm p-2 text-gray-500 font-mono select-none">
      {typeof value === 'number' ? value.toFixed(1) : (value ?? '—')}
    </div>
  </td>
);

// ── Main component ────────────────────────────────────────────────────────────
export default function ClimateConfig() {
  const dispatch  = useDispatch();
  const climate   = useSelector(selectClimate);
  const elevation = useSelector((s) => s.project?.ambient?.elevation ?? 0);

  const handleChange = (season, field, value) => {
    const isText = field === 'time' || field === 'month';
    dispatch(updateOutsideCondition({
      season,
      field,
      // Preserve negatives (winter DB) — don't coerce empty to 0
      value: isText ? value : (value === '' ? '' : parseFloat(value)),
    }));
  };

  // Apply an ASHRAE design tier DB value directly to the summer season
  const applyDesignTier = (tier) => {
    const entry = ASHRAE_DESIGN_DB[DEFAULT_CITY]?.[tier];
    if (!entry) return;
    dispatch(updateOutsideCondition({ season: 'summer', field: 'db', value: entry.db }));
  };

  const showElevationNote = parseFloat(elevation) > 1000;

  // Warn if summer DB is below even the least conservative (2.0%) design tier —
  // the system would be undersized for the majority of summer hours.
  const summerDb        = parseFloat(climate.outside.summer.db) || 0;
  const dbWarnThreshold = ASHRAE_DESIGN_DB[DEFAULT_CITY]?.['2.0%']?.db ?? 104;
  const showDbWarning   = summerDb > 0 && summerDb < dbWarnThreshold;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 pb-24">

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-end
                      mb-8 border-b border-gray-200 pb-4 gap-4">
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

      {/* ── ASHRAE design tier quick-apply ────────────────────────────── */}
      <div className="mb-6 bg-orange-50 border border-orange-200 rounded-xl p-4">
        <p className="text-xs font-bold text-orange-800 uppercase tracking-wide mb-2">
          ASHRAE HOF 2021 Ch.14 — Summer Design DB Quick-Apply ({DEFAULT_CITY})
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {Object.entries(ASHRAE_DESIGN_DB[DEFAULT_CITY]).map(([tier, entry]) => (
            <button
              key={tier}
              onClick={() => applyDesignTier(tier)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors
                bg-white border-orange-300 text-orange-800
                hover:bg-orange-100 hover:border-orange-500"
            >
              {tier} — {entry.db}°F
            </button>
          ))}
        </div>
        <p className="text-[10px] text-orange-600">
          <strong>0.4%</strong> = exceeded only 35 hrs/yr — required for 24/7 semiconductor fabs,
          pharma sterile suites, battery dry rooms. &nbsp;
          <strong>1.0%</strong> = general commercial. &nbsp;
          <strong>2.0%</strong> = comfort / less-critical. &nbsp;
          Current summer DB: <strong>{summerDb}°F</strong>.
        </p>
        {showDbWarning && (
          <div className="mt-2 text-xs text-red-700 font-semibold bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ⚠ Summer DB {summerDb}°F is below the ASHRAE 2.0% design value for {DEFAULT_CITY}.
            The system will be undersized for most summer hours.
            Apply a design tier above or verify against ASHRAE Table 1 for your project location.
          </div>
        )}
      </div>

      {/* ── Elevation note ────────────────────────────────────────────── */}
      {showElevationNote && (
        <div className="mb-4 px-4 py-3 bg-sky-50 border border-sky-200
                        rounded-lg text-sm text-sky-800 flex items-start gap-2">
          <span className="mt-0.5" aria-hidden="true">🏔</span>
          <span>
            <strong>Site elevation {elevation} ft:</strong> displayed Gr/lb values
            use sea-level Patm (meteorological convention). The calculation engine
            automatically corrects humidity ratios to site elevation —
            actual latent loads will differ slightly from these displayed values.
          </span>
        </div>
      )}

      {/* ── Legend ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-6 mb-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-white border border-gray-300" />
          <span className="text-gray-600 font-medium">User-entered</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-gray-100 border border-gray-200" />
          <span className="text-gray-500">Auto-derived — WB, DP, Gr/lb update when DB or RH changes</span>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────── */}
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
                {/* WB is derived — climateSlice.deriveFields() recomputes it from DB+RH */}
                <th className="px-2 py-4 text-center bg-gray-100">
                  WB<br/>
                  <span className="text-[10px] font-normal normal-case text-gray-400">
                    °F derived
                  </span>
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
                  <span className="text-[10px] font-normal normal-case text-gray-400">
                    derived ★
                  </span>
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

                    {/* Season badge */}
                    <td className={`px-6 py-3 border-l-4 ${style.border} bg-gray-50/50`}>
                      <span className={`
                        inline-block text-[11px] font-bold uppercase
                        tracking-wide px-2 py-1 rounded ${style.badge}
                      `}>
                        {season}
                      </span>
                    </td>

                    {/* DB — editable */}
                    <EditCell
                      value={s.db}
                      onChange={(e) => handleChange(season, 'db', e.target.value)}
                    />

                    {/* WB — derived read-only. climateSlice.deriveFields() recomputes
                        WB from DB+RH via calculateWetBulb() on every DB/RH change.
                        Making this editable would silently discard the user's entry. */}
                    <DerivedCell value={s.wb} />

                    {/* RH — editable, step 0.1 for fractional precision */}
                    <EditCell
                      value={s.rh}
                      step="0.1"
                      onChange={(e) => handleChange(season, 'rh', e.target.value)}
                    />

                    {/* DP — derived read-only */}
                    <DerivedCell value={s.dp} />

                    {/* Gr/lb — derived read-only (sea-level display) */}
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

        {/* ── Footer note ───────────────────────────────────────────── */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-100
                        text-[11px] text-gray-400 space-y-1">
          <div>
            ★ Gr/lb = 0.62198 × E / (Patm − E) × 7000 &nbsp;·&nbsp;
            WB = calculateWetBulb(DB, RH) per ASHRAE Ch.1 Eq.35 bisection &nbsp;·&nbsp;
            DP = Magnus inverse — all shown at sea-level Patm (meteorological convention).
          </div>
          <div>
            ⚡ Calculation engine applies site-elevation Patm correction to all
            humidity ratios per ASHRAE Ch.1 Eq.3 — latent loads use corrected values.
            All temperatures in °F.
          </div>
        </div>
      </div>

      {/* ── ASHRAE reference footer ─────────────────────────────────── */}
      <div className="mt-4 text-[11px] text-gray-400">
        Design DB reference: ASHRAE HOF 2021 Ch.14 Table 1 (Climatic Design Information).
        Always verify against the current edition for your specific project location and latitude.
        For critical facilities (semiconductor, pharma, battery), use the 0.4% design condition.
      </div>
    </div>
  );
}