/**
 * ResultsPage.jsx
 * Responsibility: Project dashboard — KPI cards, system load breakdown,
 *                 zone supply air governance summary, design parameters.
 *
 * -- CHANGELOG v2.3 -----------------------------------------------------------
 *
 *   Export fixed — project name now read from Redux (was hardcoded 'HVAC Design').
 *   Export payload documented as a results snapshot, not a project file:
 *     it serialises computed rdsRows and project totals but NOT the raw Redux
 *     state (rooms, envelopes, AHU configs, climate). It cannot be re-imported
 *     to reconstruct a project.
 *   min-h-[calc(100vh-64px)] → min-h-full — stale layout class removed.
 *     Inside AppLayout's flex-1 overflow-auto container, the calc() subtracted
 *     only header height and ignored TabNav, same bug fixed across all other pages.
 *   Inline SVG download icon → lucide-react Download, consistent with codebase.
 *
 * -- CHANGELOG v2.2 -----------------------------------------------------------
 *
 *   BUG-UI-10 [CRITICAL] — RSH / ERSH / GTSH data cells added to tbody rows.
 *   BUG-UI-11 [MEDIUM]   — RSH / ERSH / GTSH conditionals use null + NaN guard.
 *
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   BUG-UI-05 [CRITICAL] — Double unit conversion fixed via useProjectTotals.
 *   BUG-UI-06 [MEDIUM]   — highHumidRooms banner added.
 *   BUG-UI-07 [MEDIUM]   — totalCoilLoadBTU KPI card added.
 *   BUG-UI-08 [MEDIUM]   — 'regulatoryAcph' added to GovernedBadge + acphGoverned.
 *   BUG-UI-09 [LOW]      — Dead React import removed.
 */

import { useSelector }      from 'react-redux';
import { Download }         from 'lucide-react';
import { selectAllAHUs }    from '../features/ahu/ahuSlice';
import { selectRdsData }    from '../features/results/rdsSelector';
import useProjectTotals     from '../hooks/useProjectTotals';

const RATING_TO_COLOR = {
  excellent: 'red',
  good:      'orange',
  review:    'green',
  high:      'orange',
};

const GovernedBadge = ({ governed }) => {
  if (!governed) return null;

  const styles = {
    thermal:        'bg-orange-100 text-orange-700 border-orange-200',
    designAcph:     'bg-purple-100 text-purple-700 border-purple-200',
    minAcph:        'bg-blue-100   text-blue-700   border-blue-200',
    regulatoryAcph: 'bg-red-100    text-red-700    border-red-200',
  };
  const labels = {
    thermal:        'Heat load',
    designAcph:     'Design ACPH',
    minAcph:        'Min ACPH',
    regulatoryAcph: 'Regulatory ACH',
  };

  return (
    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${styles[governed] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
      {labels[governed] ?? governed}
    </span>
  );
};

export default function ResultsPage() {
  const rdsRows      = useSelector(selectRdsData);
  const ahus         = useSelector(selectAllAHUs);
  const systemDesign = useSelector((state) => state.project.systemDesign);
  const elevation    = useSelector((state) => state.project.ambient.elevation || 0);
  const projectName  = useSelector((state) => state.project.name || 'HVAC Project');

  const {
    totalTR,
    totalCFM,
    totalAreaFt2,
    totalAreaM2,
    checkFigureVal,
    checkFigureRating,
    checkFigureNote,
    highHumidRooms,
    regulatoryAcphRooms,
    totalCoilLoadBTU,
    hasData,
  } = useProjectTotals();

  const sqftPerTR  = hasData && totalTR > 0 ? checkFigureVal.toFixed(0) : '—';
  const cfmPerSqft = totalAreaFt2 > 0 ? (totalCFM / totalAreaFt2).toFixed(2) : '—';
  const tipColor   = RATING_TO_COLOR[checkFigureRating] ?? 'orange';

  const acphGoverned = rdsRows.filter(
    (r) => ['designAcph', 'minAcph', 'regulatoryAcph'].includes(r.supplyAirGoverned)
  ).length;

  const systemSummary = ahus.map((ahu) => {
    const assigned = rdsRows.filter((r) => r.ahuId === ahu.id);
    const ahuTR    = assigned.reduce((s, r) => s + (parseFloat(r.coolingCapTR) || 0), 0);
    const ahuCFM   = assigned.reduce((s, r) => s + (parseFloat(r.supplyAir)    || 0), 0);
    return {
      ...ahu,
      roomCount: assigned.length,
      totalTR:   ahuTR,
      totalCFM:  ahuCFM,
      loadPct:   totalTR > 0 ? (ahuTR / totalTR) * 100 : 0,
    };
  });

  const unassigned = rdsRows.filter((r) => !r.ahuId);
  if (unassigned.length > 0) {
    systemSummary.push({
      id:        'unassigned',
      name:      'Unassigned Zones',
      type:      'N/A',
      roomCount: unassigned.length,
      totalTR:   unassigned.reduce((s, r) => s + (parseFloat(r.coolingCapTR) || 0), 0),
      totalCFM:  unassigned.reduce((s, r) => s + (parseFloat(r.supplyAir)    || 0), 0),
      loadPct:   totalTR > 0
        ? (unassigned.reduce((s, r) => s + (parseFloat(r.coolingCapTR) || 0), 0) / totalTR) * 100
        : 0,
    });
  }

  const handleExport = () => {
    // ⚠ This export is a RESULTS SNAPSHOT — not a project save file.
    // It serialises computed rdsRows and project-level totals.
    // It does NOT include the raw Redux state (rooms, envelopes, AHU configs,
    // climate data). It cannot be re-imported to reconstruct a project.
    // Use it as a calculation record / handover document only.
    const payload = {
      project:   projectName,
      exportedAt: new Date().toISOString(),
      units:     { area: 'm²', airflow: 'CFM', load: 'TR', coilLoad: 'BTU/hr' },
      totals:    { totalTR, totalCFM, totalAreaM2, totalAreaFt2, totalCoilLoadBTU },
      rooms:     rdsRows,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${projectName.replace(/\s+/g, '_')}_calculations.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    // min-h-full: AppLayout's flex-1 overflow-auto parent handles page height.
    // Old min-h-[calc(100vh-64px)] only subtracted header height — same stale
    // class removed from every other page during the layout audit.
    <div className="min-h-full bg-slate-50 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* ── Header ── */}
        <div className="flex justify-between items-end border-b border-slate-200 pb-5">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Project Dashboard</h1>
            <p className="text-slate-500 mt-1">
              Executive summary of HVAC calculations and system loads.
            </p>
            {elevation > 0 && (
              <p className="text-[11px] text-blue-600 font-mono mt-1">
                Site elevation: {elevation} ft — altitude correction active
                (Cf = {Math.pow(1 - 6.8754e-6 * elevation, 5.2559).toFixed(4)})
              </p>
            )}
          </div>
          <button
            onClick={handleExport}
            className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-slate-50 flex items-center gap-2"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            Export JSON
          </button>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">
              Total Cooling
            </div>
            <div className="text-2xl font-bold text-blue-600 mt-2">
              {totalTR.toFixed(1)}{' '}
              <span className="text-sm text-slate-400 font-normal">TR</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1">Incl. fan heat</div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">
              Total Airflow
            </div>
            <div className="text-2xl font-bold text-slate-700 mt-2">
              {totalCFM.toLocaleString()}{' '}
              <span className="text-sm text-slate-400 font-normal">CFM</span>
            </div>
            {acphGoverned > 0 && (
              <div className="mt-1 text-[10px] text-purple-600 font-bold">
                ↑ {acphGoverned} zone{acphGoverned > 1 ? 's' : ''} ACPH-governed
              </div>
            )}
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">
              CHW Plant Load
            </div>
            <div className="text-2xl font-bold text-cyan-600 mt-2">
              {(totalCoilLoadBTU / 12000).toFixed(1)}{' '}
              <span className="text-sm text-slate-400 font-normal">TR</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-mono">
              {totalCoilLoadBTU.toLocaleString()} BTU/hr · excl. fan heat
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">
              Total Area
            </div>
            <div className="text-2xl font-bold text-slate-700 mt-2">
              {totalAreaM2.toLocaleString(undefined, { maximumFractionDigits: 0 })}{' '}
              <span className="text-sm text-slate-400 font-normal">m²</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-mono">
              = {totalAreaFt2.toLocaleString(undefined, { maximumFractionDigits: 0 })} ft²
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">
              Check Figure
            </div>
            <div className="text-2xl font-bold text-emerald-600 mt-2">
              {sqftPerTR}{' '}
              <span className="text-sm text-slate-400 font-normal">ft²/TR</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-mono">
              {cfmPerSqft} CFM/ft²
            </div>
          </div>
        </div>

        {/* ── High humidification warning banner ── */}
        {highHumidRooms.length > 0 && (
          <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-start gap-3">
            <div className="text-xl mt-0.5 shrink-0">⚠️</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-red-900">
                {highHumidRooms.length} room{highHumidRooms.length !== 1 ? 's' : ''} require humidifier sizing review
              </p>
              <p className="text-xs text-red-700 mt-1 leading-relaxed">
                Δgr &gt; 40 gr/lb — sub-5% RH winter condition. Verify steam supply capacity,
                manifold sizing, and AHU humidifier section length before finalising equipment schedule.
              </p>
              <div className="mt-2 space-y-1">
                {highHumidRooms.map((r) => (
                  <div key={r.id} className="text-xs font-mono text-red-800 bg-red-100 rounded px-2 py-1">
                    <span className="font-bold">{r.name}</span>
                    {' — '}Δ{r.humidDeltaGr} gr/lb{' · '}{r.humidLbsPerHr} lb/hr{' · '}{r.humidKw} kW
                    {r.humidWarning && <span className="text-red-600 ml-2">({r.humidWarning})</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Regulatory ACH banner ── */}
        {regulatoryAcphRooms.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
            <div className="text-xl mt-0.5 shrink-0">📋</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-900">
                {regulatoryAcphRooms.length} room{regulatoryAcphRooms.length !== 1 ? 's' : ''} governed by statutory ACH floor
              </p>
              <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                NFPA 855 (battery safety), OSHA ventilation, or GMP Annex 1 statutory minimum
                exceeds thermal CFM. Supply air is code-driven. Confirm code basis with AHJ before final issue.
              </p>
              <div className="mt-2 space-y-1">
                {regulatoryAcphRooms.map((r) => (
                  <div key={r.id} className="text-xs font-mono text-amber-800 bg-amber-100 rounded px-2 py-1">
                    <span className="font-bold">{r.name}</span>
                    {' — '}Reg. {Math.round(r.regulatoryAcphCFM).toLocaleString()} CFM
                    {' vs '}{Math.round(r.thermalCFM).toLocaleString()} CFM thermal
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── ISO ACPH governance banner ── */}
        {acphGoverned > 0 && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex items-start gap-3">
            <div className="text-xl mt-0.5">🔵</div>
            <div>
              <p className="text-sm font-bold text-purple-900">
                {acphGoverned} of {rdsRows.length} zones are ACPH-governed
              </p>
              <p className="text-xs text-purple-700 mt-1 leading-relaxed">
                These rooms have supply air set by the minimum or design air change rate
                (ISO 14644 / GMP Annex 1 / NFPA 855), not by the thermal cooling load.
              </p>
            </div>
          </div>
        )}

        {/* ── System Breakdown ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          <div className="lg:col-span-2 space-y-6">

            {/* System Load Distribution */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
                <h3 className="text-sm font-bold text-slate-800">System Load Distribution</h3>
              </div>
              <table className="w-full text-left">
                <thead className="bg-white border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase">System Name</th>
                    <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">Load (TR)</th>
                    <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">Airflow (CFM)</th>
                    <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase w-32">% of Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 text-sm">
                  {systemSummary.map((sys) => (
                    <tr key={sys.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-700">{sys.name}</div>
                        <div className="text-xs text-slate-400">{sys.type} · {sys.roomCount} Rooms</div>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-blue-600 font-bold">
                        {sys.totalTR.toFixed(1)}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-slate-600">
                        {sys.totalCFM.toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${sys.loadPct}%` }} />
                          </div>
                          <span className="text-xs font-bold text-slate-500 w-8 text-right">
                            {Math.round(sys.loadPct)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {systemSummary.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-slate-400">No systems configured.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Zone Supply Air Summary */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h3 className="text-sm font-bold text-slate-800">Zone Supply Air Summary</h3>
                <span className="text-[10px] text-slate-400 font-mono">
                  RSH / ERSH / GTSH in BTU/hr · governed by: thermal load | design ACPH | min ACPH | regulatory ACH
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-3 font-bold text-slate-400 uppercase">Room</th>
                      <th className="px-4 py-3 font-bold text-slate-400 uppercase text-right">Thermal CFM</th>
                      <th className="px-4 py-3 font-bold text-slate-400 uppercase text-right">Min ACPH CFM</th>
                      <th className="px-4 py-3 font-bold text-slate-400 uppercase text-right">Design CFM</th>
                      <th className="px-4 py-3 font-bold text-slate-400 uppercase text-right">RSH</th>
                      <th className="px-4 py-3 font-bold text-slate-400 uppercase text-right">ERSH</th>
                      <th className="px-4 py-3 font-bold text-slate-400 uppercase text-right">GTSH</th>
                      <th className="px-4 py-3 font-bold text-slate-400 uppercase text-right">Governed By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {rdsRows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-500">
                          {(r.thermalCFM || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-500">
                          {(r.supplyAirMinAcph || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-800">
                          {(r.supplyAir || 0).toLocaleString()}
                        </td>

                        {/* null + NaN guard: 0 is a valid engineering result for rooms
                            with minimal sensible loads — a plain truthy check would show
                            '—' for 0 BTU/hr which is incorrect. */}
                        <td className="px-4 py-2.5 text-right font-mono text-slate-500">
                          {r.rsh != null && !isNaN(r.rsh)
                            ? Math.round(r.rsh).toLocaleString()
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-violet-600">
                          {r.ersh != null && !isNaN(r.ersh)
                            ? Math.round(r.ersh).toLocaleString()
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-indigo-600">
                          {r.grandTotalSensible != null && !isNaN(r.grandTotalSensible)
                            ? Math.round(r.grandTotalSensible).toLocaleString()
                            : '—'}
                        </td>

                        <td className="px-4 py-2.5 text-right">
                          <GovernedBadge governed={r.supplyAirGoverned} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right: Design parameters + check figure tip */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <h3 className="text-sm font-bold text-slate-800 mb-4 uppercase">Design Parameters</h3>
              <ul className="space-y-3 text-sm">
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">Total Zones</span>
                  <span className="font-bold text-slate-700">{rdsRows.length}</span>
                </li>
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">Avg CFM / ft²</span>
                  <span className="font-bold text-slate-700">{cfmPerSqft}</span>
                </li>
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">Safety Factor</span>
                  <span className="font-bold text-slate-700">{systemDesign.safetyFactor}%</span>
                </li>
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">Bypass Factor</span>
                  <span className="font-bold text-slate-700">{systemDesign.bypassFactor}</span>
                </li>
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">App. Dew Point</span>
                  <span className="font-bold text-slate-700">{systemDesign.adp} °F</span>
                </li>
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">Supply Fan Heat</span>
                  <span className="font-bold text-slate-700">{systemDesign.fanHeat}%</span>
                </li>
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">Return Fan Heat</span>
                  <span className="font-bold text-slate-700">
                    {systemDesign.returnFanHeat ?? 5}%
                  </span>
                </li>
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">Site Elevation</span>
                  <span className="font-bold text-slate-700">{elevation} ft</span>
                </li>
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">CHW Plant (coil only)</span>
                  <span className="font-bold text-cyan-600">{(totalCoilLoadBTU / 12000).toFixed(1)} TR</span>
                </li>
              </ul>
            </div>

            {hasData && sqftPerTR !== '—' && (
              <div className={`rounded-xl border p-5 flex items-start gap-3
                ${tipColor === 'red'    ? 'bg-red-50    border-red-200'       : ''}
                ${tipColor === 'orange' ? 'bg-amber-50  border-amber-200'     : ''}
                ${tipColor === 'green'  ? 'bg-emerald-50 border-emerald-200'  : ''}
              `}>
                <div className="text-xl">
                  {tipColor === 'red' ? '⚠️' : tipColor === 'orange' ? '🔶' : '💡'}
                </div>
                <div>
                  <h4 className={`text-sm font-bold mb-1
                    ${tipColor === 'red'    ? 'text-red-900'     : ''}
                    ${tipColor === 'orange' ? 'text-amber-900'   : ''}
                    ${tipColor === 'green'  ? 'text-emerald-900' : ''}
                  `}>
                    Check Figure: {sqftPerTR} ft²/TR
                  </h4>
                  <p className={`text-xs leading-relaxed
                    ${tipColor === 'red'    ? 'text-red-700'     : ''}
                    ${tipColor === 'orange' ? 'text-amber-700'   : ''}
                    ${tipColor === 'green'  ? 'text-emerald-700' : ''}
                  `}>
                    {checkFigureNote}
                  </p>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}