import React from 'react';
import { useSelector } from 'react-redux';
import { selectAllAHUs } from '../features/ahu/ahuSlice';
import { selectRdsData } from '../features/results/rdsSelector';

// ── Unit conversion ───────────────────────────────────────────────────────────
// roomSlice stores floorArea in m² (length × width, both in metres).
// All ASHRAE check figures (ft²/TR, CFM/ft²) use ft².
// We display m² as the primary stored unit and ft² as the ASHRAE benchmark unit.
const M2_TO_FT2 = 10.7639;

// ── ASHRAE check figure benchmarks ───────────────────────────────────────────
// These are rule-of-thumb ranges for sanity-checking the cooling load density.
// Source: ASHRAE Handbook — HVAC Applications, Chapter 3.
//
// Commercial office:          250–400 ft²/TR   (23–37 m²/TR)
// Pharmaceutical cleanroom:    50–150 ft²/TR   (4.6–14 m²/TR)
// Semiconductor fab (ISO 5-6): 20–80  ft²/TR   (1.9–7.4 m²/TR)
// Battery manufacturing:       80–200 ft²/TR   (7.4–18.6 m²/TR)
//
const getCheckFigureTip = (sqftPerTR) => {
  const v = parseFloat(sqftPerTR);
  if (v <= 0)   return null;
  if (v < 50)   return { color: 'red',    text: 'Extremely high load density — verify equipment kW and envelope inputs. Typical for ISO 5–6 semiconductor fabs only.' };
  if (v < 150)  return { color: 'orange', text: 'High load density — consistent with pharmaceutical cleanrooms or battery manufacturing.' };
  if (v < 300)  return { color: 'green',  text: 'Moderate load density — consistent with light industrial or cleanroom-support spaces.' };
  if (v < 500)  return { color: 'green',  text: 'Within standard commercial efficiency range.' };
  return         { color: 'orange', text: 'Low load density — verify that envelope loads and equipment inputs are complete.' };
};

// ── Supply air governance badge ───────────────────────────────────────────────
// Shows whether the room supply air was set by the thermal load or by
// the minimum ACPH requirement — useful for engineering review.
const GovernedBadge = ({ governed }) => {
  if (!governed) return null;
  const styles = {
    thermal:    'bg-orange-100 text-orange-700 border-orange-200',
    designAcph: 'bg-purple-100 text-purple-700 border-purple-200',
    minAcph:    'bg-blue-100   text-blue-700   border-blue-200',
  };
  const labels = {
    thermal:    'Heat load',
    designAcph: 'Design ACPH',
    minAcph:    'Min ACPH',
  };
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${styles[governed] ?? 'bg-gray-100 text-gray-500'}`}>
      {labels[governed] ?? governed}
    </span>
  );
};

export default function ResultsPage() {
  const rdsRows     = useSelector(selectRdsData);
  const ahus        = useSelector(selectAllAHUs);
  const systemDesign = useSelector((state) => state.project.systemDesign);
  const elevation    = useSelector((state) => state.project.ambient.elevation || 0);

  // ── Project totals ──────────────────────────────────────────────────────────
  // BUG-04 FIX: floorArea is stored in m². Convert to ft² for ASHRAE benchmarks.
  // Display both units — m² for the project brief, ft² for check figures.
  const totalAreaM2  = rdsRows.reduce((sum, r) => sum + (parseFloat(r.floorArea) || 0), 0);
  const totalAreaFt2 = totalAreaM2 * M2_TO_FT2;

  const totalTR  = rdsRows.reduce((sum, r) => sum + (parseFloat(r.coolingCapTR) || 0), 0);
  const totalCFM = rdsRows.reduce((sum, r) => sum + (parseFloat(r.supplyAir)    || 0), 0);

  // ── ASHRAE check figures (all in ft²) ──────────────────────────────────────
  const sqftPerTR  = totalTR      > 0 ? (totalAreaFt2 / totalTR).toFixed(0)       : '—';
  const cfmPerSqft = totalAreaFt2 > 0 ? (totalCFM     / totalAreaFt2).toFixed(2)  : '—';
  const tip        = getCheckFigureTip(sqftPerTR);

  // ── ACPH-governed room count ───────────────────────────────────────────────
  // How many rooms have supply air set by ACPH rather than thermal load.
  const acphGoverned = rdsRows.filter(
    (r) => r.supplyAirGoverned === 'designAcph' || r.supplyAirGoverned === 'minAcph'
  ).length;

  // ── System breakdown grouped by AHU ────────────────────────────────────────
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

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = () => {
    const payload = {
      project:  'HVAC Design',
      units:    { area: 'm²', airflow: 'CFM', load: 'TR' },
      totals:   { totalTR, totalCFM, totalAreaM2, totalAreaFt2 },
      rooms:    rdsRows,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'project_calculations.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50 p-8 overflow-y-auto">
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
                (Cf = {(29.921 * Math.pow(1 - 6.8754e-6 * elevation, 5.2559) / 29.921).toFixed(4)})
              </p>
            )}
          </div>
          <button
            onClick={handleExport}
            className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-slate-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export JSON
          </button>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

          {/* Total Cooling */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">
              Total Cooling
            </div>
            <div className="text-3xl font-bold text-blue-600 mt-2">
              {totalTR.toFixed(1)}{' '}
              <span className="text-sm text-slate-400 font-normal">TR</span>
            </div>
          </div>

          {/* Total Airflow */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">
              Total Airflow
            </div>
            <div className="text-3xl font-bold text-slate-700 mt-2">
              {totalCFM.toLocaleString()}{' '}
              <span className="text-sm text-slate-400 font-normal">CFM</span>
            </div>
            {acphGoverned > 0 && (
              <div className="mt-2 text-[10px] text-purple-600 font-bold">
                ↑ {acphGoverned} zone{acphGoverned > 1 ? 's' : ''} ACPH-governed
              </div>
            )}
          </div>

          {/* Total Area — BUG-04 FIX: show m² (stored unit) with ft² in sub-label */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">
              Total Area
            </div>
            <div className="text-3xl font-bold text-slate-700 mt-2">
              {totalAreaM2.toLocaleString(undefined, { maximumFractionDigits: 0 })}{' '}
              <span className="text-sm text-slate-400 font-normal">m²</span>
            </div>
            {/* BUG-04 FIX: ft² shown as secondary — was the only value shown
                before this fix, incorrectly labelled as ft² when it was m² */}
            <div className="text-[11px] text-slate-400 mt-1 font-mono">
              = {totalAreaFt2.toLocaleString(undefined, { maximumFractionDigits: 0 })} ft²
            </div>
          </div>

          {/* Check Figure — BUG-04 FIX: now correctly ft²/TR (converted) */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">
              Check Figure
            </div>
            <div className="text-3xl font-bold text-emerald-600 mt-2">
              {sqftPerTR}{' '}
              <span className="text-sm text-slate-400 font-normal">ft²/TR</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1 font-mono">
              {cfmPerSqft} CFM/ft²
            </div>
          </div>
        </div>

        {/* ── ACPH Governance Summary ── */}
        {acphGoverned > 0 && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex items-start gap-3">
            <div className="text-xl mt-0.5">🔵</div>
            <div>
              <p className="text-sm font-bold text-purple-900">
                {acphGoverned} of {rdsRows.length} zones are ACPH-governed
              </p>
              <p className="text-xs text-purple-700 mt-1 leading-relaxed">
                These rooms have supply air set by the minimum or design air change rate
                (ISO 14644 / GMP Annex 1), not by the thermal cooling load.
                This is expected for cleanrooms — the thermal CFM would be insufficient
                for particle dilution at the required ISO classification.
              </p>
            </div>
          </div>
        )}

        {/* ── System Breakdown ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Left: Load distribution table */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
                <h3 className="text-sm font-bold text-slate-800">System Load Distribution</h3>
              </div>
              <table className="w-full text-left">
                <thead className="bg-white border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase">
                      System Name
                    </th>
                    <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">
                      Load (TR)
                    </th>
                    <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">
                      Airflow (CFM)
                    </th>
                    <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase w-32">
                      % of Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 text-sm">
                  {systemSummary.map((sys) => (
                    <tr key={sys.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-700">{sys.name}</div>
                        <div className="text-xs text-slate-400">
                          {sys.type} · {sys.roomCount} Rooms
                        </div>
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
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${sys.loadPct}%` }}
                            />
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
                      <td colSpan={4} className="px-6 py-8 text-center text-slate-400">
                        No systems configured.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Per-room ACPH governance table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h3 className="text-sm font-bold text-slate-800">Zone Supply Air Summary</h3>
                <span className="text-[10px] text-slate-400 font-mono">
                  governed by: thermal load | design ACPH | min ACPH
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-3 font-bold text-slate-400 uppercase">Room</th>
                      <th className="px-4 py-3 font-bold text-slate-400 uppercase text-right">
                        Thermal CFM
                      </th>
                      <th className="px-4 py-3 font-bold text-slate-400 uppercase text-right">
                        Min ACPH CFM
                      </th>
                      <th className="px-4 py-3 font-bold text-slate-400 uppercase text-right">
                        Design CFM
                      </th>
                      <th className="px-4 py-3 font-bold text-slate-400 uppercase text-right">
                        Governed By
                      </th>
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

          {/* Right: Design parameters + tip */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <h3 className="text-sm font-bold text-slate-800 mb-4 uppercase">
                Design Parameters
              </h3>
              <ul className="space-y-3 text-sm">
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">Total Zones</span>
                  <span className="font-bold text-slate-700">{rdsRows.length}</span>
                </li>
                {/* BUG-04 FIX: correctly labelled CFM/ft² (converted from m²) */}
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
                  <span className="text-slate-500">Fan Heat</span>
                  <span className="font-bold text-slate-700">{systemDesign.fanHeat}%</span>
                </li>
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">Site Elevation</span>
                  <span className="font-bold text-slate-700">{elevation} ft</span>
                </li>
              </ul>
            </div>

            {/* Check figure tip — BUG-04 FIX: thresholds now correct for ft²/TR */}
            {tip && (
              <div className={`rounded-xl border p-5 flex items-start gap-3
                ${tip.color === 'red'    ? 'bg-red-50    border-red-200'    : ''}
                ${tip.color === 'orange' ? 'bg-amber-50  border-amber-200'  : ''}
                ${tip.color === 'green'  ? 'bg-emerald-50 border-emerald-200' : ''}
              `}>
                <div className="text-xl">
                  {tip.color === 'red' ? '⚠️' : tip.color === 'orange' ? '🔶' : '💡'}
                </div>
                <div>
                  <h4 className={`text-sm font-bold mb-1
                    ${tip.color === 'red'    ? 'text-red-900'    : ''}
                    ${tip.color === 'orange' ? 'text-amber-900'  : ''}
                    ${tip.color === 'green'  ? 'text-emerald-900' : ''}
                  `}>
                    Check Figure: {sqftPerTR} ft²/TR
                  </h4>
                  <p className={`text-xs leading-relaxed
                    ${tip.color === 'red'    ? 'text-red-700'    : ''}
                    ${tip.color === 'orange' ? 'text-amber-700'  : ''}
                    ${tip.color === 'green'  ? 'text-emerald-700' : ''}
                  `}>
                    {tip.text}
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