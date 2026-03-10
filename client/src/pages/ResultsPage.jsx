/**
 * ResultsPage.jsx
 * Responsibility: Project dashboard — KPI cards, system load breakdown,
 *                 zone supply air governance summary, design parameters.
 *
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   BUG-UI-05 [CRITICAL — DOUBLE UNIT CONVERSION] — Manual area computation
 *     replaced with useProjectTotals.
 *
 *     Previous code:
 *       const totalAreaM2  = rdsRows.reduce((sum,r) => sum + r.floorArea, 0);
 *       const totalAreaFt2 = totalAreaM2 * M2_TO_FT2;   ← 10.76× too high
 *
 *     This is the EXACT bug fixed as FIX-H01 in useProjectTotals. rdsRow.floorArea
 *     is ft² (post CRIT-RDS-01). The old code labelled ft² as m², then multiplied
 *     by 10.7639 again. Impact on displayed values:
 *       totalAreaM2:  1,076 ft² shown as 1,076 m² — 10.76× wrong
 *       totalAreaFt2: 11,590 ft² for a 100 m² room — 107.6× wrong
 *       sqftPerTR:    check figure appeared correct only because the error
 *                     cancelled (ft² / ft² = ratio was unchanged)
 *       cfmPerSqft:   similarly cancelled — accidentally correct
 *       Export JSON:  totalAreaM2 and totalAreaFt2 both wrong
 *
 *     Fix: consume totalAreaFt2, totalAreaM2, totalTR, totalCFM, checkFigureVal,
 *     checkFigureRating, checkFigureNote from useProjectTotals — the single
 *     source of truth where FIX-H01 already corrects this.
 *
 *   BUG-UI-06 [MEDIUM — MISSING CRITICAL SURFACE] — highHumidRooms banner added.
 *
 *     FIX-H02 (useProjectTotals) added highHumidRooms but ResultsPage never
 *     consumed it. For sub-5%RH dry-room facilities (Exide, TSMC, Cipla),
 *     this is the single most critical mechanical sizing flag.
 *
 *   BUG-UI-07 [MEDIUM — MISSING DATA] — totalCoilLoadBTU KPI card added.
 *
 *     FIX-H04 (useProjectTotals) added totalCoilLoadBTU — the correct CHW
 *     plant sizing basis (excludes fan heat). totalTR (which includes fan
 *     heat via grandTotal) is insufficient for chiller and CHW pipe selection.
 *     The engineer needs both on the same dashboard.
 *
 *   BUG-UI-08 [MEDIUM — MISSING GOVERNED TYPE] — 'regulatoryAcph' added to
 *     GovernedBadge and acphGoverned count.
 *
 *     HIGH-AQ-01 added 'regulatoryAcph' as a supplyAirGoverned value for NFPA 855
 *     battery rooms and GMP Annex 1 pharma suites. GovernedBadge had no style/
 *     label entry for it — rendered a gray fallback badge with the raw key string
 *     'regulatoryAcph' as visible text. The acphGoverned count also excluded these
 *     rooms, undercounting the ACPH-governed total shown in the Airflow KPI card.
 *
 *   BUG-UI-09 [LOW] — unused `import React from 'react'` removed.
 *     Vite with React 17+ automatic JSX transform does not require explicit import.
 */

import { useSelector }      from 'react-redux';
import { selectAllAHUs }    from '../features/ahu/ahuSlice';
import { selectRdsData }    from '../features/results/rdsSelector';
import useProjectTotals     from '../hooks/useProjectTotals';
// BUG-UI-09 FIX: 'import React from react' removed — not needed with Vite JSX transform.

// ── Check figure rating → display color ───────────────────────────────────────
// Maps the checkFigureRating from useProjectTotals to the visual severity color.
// Single source of truth for rating thresholds is useProjectTotals
// CHECK_FIGURE_BENCHMARKS. This map is purely presentational.
//
// 'excellent' means semiconductor / high-density fab (<50 ft²/TR) —
// this is a WARNING color (red), not a success color. The name 'excellent'
// refers to the density for that facility type, not a validation pass/fail.
const RATING_TO_COLOR = {
  excellent: 'red',    // <50 ft²/TR  — semiconductor, extreme density, verify inputs
  good:      'orange', // 50–150      — pharmaceutical / biotech cleanroom
  review:    'green',  // 150–400     — general commercial / light industrial
  high:      'orange', // >400        — low density, verify loads are complete
};

// ── Supply air governance badge ───────────────────────────────────────────────
// Shows whether the room supply air was set by thermal load, ISO ACPH requirement,
// or a statutory regulatory floor (NFPA 855, GMP Annex 1, OSHA).
const GovernedBadge = ({ governed }) => {
  if (!governed) return null;

  const styles = {
    thermal:        'bg-orange-100 text-orange-700 border-orange-200',
    designAcph:     'bg-purple-100 text-purple-700 border-purple-200',
    minAcph:        'bg-blue-100   text-blue-700   border-blue-200',
    // BUG-UI-08 FIX: 'regulatoryAcph' added.
    // Previous: no entry → gray fallback badge with raw key 'regulatoryAcph' as text.
    // NFPA 855 battery rooms and GMP Annex 1 pharma suites are governed by statute,
    // not ISO classification. Red badge distinguishes statutory from design ACH.
    regulatoryAcph: 'bg-red-100    text-red-700    border-red-200',
  };
  const labels = {
    thermal:        'Heat load',
    designAcph:     'Design ACPH',
    minAcph:        'Min ACPH',
    regulatoryAcph: 'Regulatory ACH', // BUG-UI-08 FIX: human-readable label
  };

  return (
    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${styles[governed] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
      {labels[governed] ?? governed}
    </span>
  );
};

export default function ResultsPage() {
  // ── Selectors ──────────────────────────────────────────────────────────────
  // rdsRows kept for: per-room table, systemSummary, handleExport, acphGoverned.
  // Area and load totals come from useProjectTotals (BUG-UI-05 FIX).
  const rdsRows      = useSelector(selectRdsData);
  const ahus         = useSelector(selectAllAHUs);
  const systemDesign = useSelector((state) => state.project.systemDesign);
  const elevation    = useSelector((state) => state.project.ambient.elevation || 0);

  // BUG-UI-05 FIX: Replace manual area computation with useProjectTotals.
  //
  // Previous: totalAreaM2 = rdsRows.reduce(r.floorArea)  ← ft² labelled as m²
  //           totalAreaFt2 = totalAreaM2 * M2_TO_FT2       ← ft² × 10.76 = wrong
  //
  // useProjectTotals FIX-H01 already corrects this. Single source of truth.
  // totalAreaFt2 and totalAreaM2 are now always consistent and correctly labelled.
  const {
    totalTR,
    totalCFM,
    totalAreaFt2,            // BUG-UI-05 FIX: ft² (correct, from hook)
    totalAreaM2,             // BUG-UI-05 FIX: m² derived from ft² / 10.7639 (correct)
    checkFigureVal,          // ft²/TR — correctly computed in FIX-H01
    checkFigureRating,       // 'excellent' | 'good' | 'review' | 'high'
    checkFigureNote,         // human-readable benchmark note
    highHumidRooms,          // BUG-UI-06 FIX: FIX-H02 — sub-5%RH dry-room warnings
    regulatoryAcphRooms,     // BUG-UI-08: FIX-H03 — statutory ACH rooms for banner
    totalCoilLoadBTU,        // BUG-UI-07 FIX: FIX-H04 — CHW plant sizing basis
    hasData,
  } = useProjectTotals();

  // ── ASHRAE check figures ───────────────────────────────────────────────────
  // sqftPerTR: checkFigureVal is already ft²/TR (FIX-H01 in useProjectTotals).
  // cfmPerSqft: CFM per ft² of conditioned floor — not exposed by the hook,
  //             computed locally from hook's correctly-labelled totalAreaFt2.
  const sqftPerTR  = hasData && totalTR > 0 ? checkFigureVal.toFixed(0) : '—';
  const cfmPerSqft = totalAreaFt2 > 0 ? (totalCFM / totalAreaFt2).toFixed(2) : '—';

  // Map rating to display color — see RATING_TO_COLOR above.
  const tipColor = RATING_TO_COLOR[checkFigureRating] ?? 'orange';

  // ── ACPH-governed room count ───────────────────────────────────────────────
  // BUG-UI-08 FIX: include 'regulatoryAcph' in count.
  //
  // Previous: counted only 'designAcph' and 'minAcph'.
  // NFPA 855 battery and GMP rooms (supplyAirGoverned === 'regulatoryAcph') were
  // excluded, undercounting the ACPH-governed total shown in the Airflow KPI card.
  const acphGoverned = rdsRows.filter(
    (r) => ['designAcph', 'minAcph', 'regulatoryAcph'].includes(r.supplyAirGoverned)
  ).length;

  // ── System breakdown grouped by AHU ────────────────────────────────────────
  // Kept local — uses ahus.map() to preserve AHU order and include ahu.type.
  // byAhu from useProjectTotals is keyed object without ordering or ahu metadata.
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
  // BUG-UI-05 FIX: totalAreaM2 and totalAreaFt2 in export payload are now
  // correctly computed (from useProjectTotals, not re-derived from rdsRows).
  const handleExport = () => {
    const payload = {
      project: 'HVAC Design',
      units:   { area: 'm²', airflow: 'CFM', load: 'TR', coilLoad: 'BTU/hr' },
      totals:  {
        totalTR,
        totalCFM,
        totalAreaM2,
        totalAreaFt2,
        totalCoilLoadBTU,  // BUG-UI-07: included in export
      },
      rooms: rdsRows,
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
                (Cf = {Math.pow(1 - 6.8754e-6 * elevation, 5.2559).toFixed(4)})
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
        {/* BUG-UI-07 FIX: 5 cards — totalCoilLoadBTU added as 3rd card.
            Grid updated from grid-cols-4 to grid-cols-2 md:grid-cols-3 lg:grid-cols-5. */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">

          {/* Total Cooling — TR includes fan heat (grand total for equipment sizing) */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">
              Total Cooling
            </div>
            <div className="text-2xl font-bold text-blue-600 mt-2">
              {totalTR.toFixed(1)}{' '}
              <span className="text-sm text-slate-400 font-normal">TR</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              Incl. fan heat
            </div>
          </div>

          {/* Total Airflow */}
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

          {/* CHW Plant Load — BUG-UI-07 FIX: totalCoilLoadBTU (FIX-H04).
              coilLoadBTU EXCLUDES fan heat — correct basis for chiller plant
              and CHW pipe sizing. Different from totalTR × 12,000 because
              totalTR = grandTotal includes fan heat, coilLoadBTU = OA enthalpy
              method without fan heat addition. Engineer needs both. */}
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

          {/* Total Area — BUG-UI-05 FIX: values from useProjectTotals (correct).
              m² is the stored unit (roomSlice SI). ft² is the ASHRAE benchmark unit.
              Both are now correctly derived — not accumulated from rdsRow.floorArea. */}
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

          {/* Check Figure — BUG-UI-05 FIX: sqftPerTR from checkFigureVal (correct ft²/TR).
              Previous: accidentally correct because errors cancelled in the ratio.
              Now explicitly correct — computed from properly-labelled ft² and TR. */}
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

        {/* ── BUG-UI-06 FIX: High humidification warning banner ─────────────────
            FIX-H02 (useProjectTotals) — Δgr > 40 gr/lb, sub-5%RH condition.
            Most critical mechanical sizing flag for Exide / TSMC / Cipla.
            Placed immediately after KPI cards — must be seen before any table. */}
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
                  <div
                    key={r.id}
                    className="text-xs font-mono text-red-800 bg-red-100 rounded px-2 py-1"
                  >
                    <span className="font-bold">{r.name}</span>
                    {' — '}
                    Δ{r.humidDeltaGr} gr/lb
                    {' · '}
                    {r.humidLbsPerHr} lb/hr
                    {' · '}
                    {r.humidKw} kW
                    {r.humidWarning && (
                      <span className="text-red-600 ml-2">({r.humidWarning})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Regulatory ACH banner (FIX-H03) ────────────────────────────────── */}
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
                  <div
                    key={r.id}
                    className="text-xs font-mono text-amber-800 bg-amber-100 rounded px-2 py-1"
                  >
                    <span className="font-bold">{r.name}</span>
                    {' — '}
                    Reg. {Math.round(r.regulatoryAcphCFM).toLocaleString()} CFM
                    {' vs '}
                    {Math.round(r.thermalCFM).toLocaleString()} CFM thermal
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── ISO ACPH governance banner ─────────────────────────────────────── */}
        {/* BUG-UI-08 FIX: acphGoverned now includes regulatoryAcph rooms.
            This banner covers design/min ACPH (ISO 14644, GMP cleanroom
            classification). Regulatory ACH has its own banner above. */}
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
                This is expected for cleanrooms — the thermal CFM would be insufficient
                for particle dilution at the required ISO classification or code compliance.
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

            {/* Per-room supply air governance table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h3 className="text-sm font-bold text-slate-800">Zone Supply Air Summary</h3>
                {/* BUG-UI-08 FIX: label updated to include 'regulatory ACH' */}
                <span className="text-[10px] text-slate-400 font-mono">
                  governed by: thermal load | design ACPH | min ACPH | regulatory ACH
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
                          {/* BUG-UI-08 FIX: GovernedBadge now handles 'regulatoryAcph' */}
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
              <h3 className="text-sm font-bold text-slate-800 mb-4 uppercase">
                Design Parameters
              </h3>
              <ul className="space-y-3 text-sm">
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">Total Zones</span>
                  <span className="font-bold text-slate-700">{rdsRows.length}</span>
                </li>
                {/* BUG-UI-05 FIX: cfmPerSqft computed from corrected ft² */}
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
                {/* BUG-UI-07 FIX: CHW plant load in design parameters */}
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">CHW Plant (coil only)</span>
                  <span className="font-bold text-cyan-600">
                    {(totalCoilLoadBTU / 12000).toFixed(1)} TR
                  </span>
                </li>
              </ul>
            </div>

            {/* Check figure tip — BUG-UI-05 FIX: uses checkFigureNote from hook
                (single source of truth). Thresholds and text are in useProjectTotals
                CHECK_FIGURE_BENCHMARKS — not duplicated here. */}
            {hasData && sqftPerTR !== '—' && (
              <div className={`rounded-xl border p-5 flex items-start gap-3
                ${tipColor === 'red'    ? 'bg-red-50    border-red-200'     : ''}
                ${tipColor === 'orange' ? 'bg-amber-50  border-amber-200'   : ''}
                ${tipColor === 'green'  ? 'bg-emerald-50 border-emerald-200' : ''}
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