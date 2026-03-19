/**
 * ResultsPage.jsx
 * Responsibility: Project dashboard — KPI cards, system load breakdown,
 *                 zone supply air governance summary, design parameters.
 *
 * -- CHANGELOG v2.5 -----------------------------------------------------------
 *
 *   CHW plant psychrometric sufficiency banner added.
 *
 *     rdsSelector v2.6 STEP 4b computes requiredADP (ESHF line method) and
 *     adpSufficient per room. useProjectTotals v2.2 aggregates these into
 *     insufficientAdpRooms.
 *
 *     Two failure modes surfaced as separate sections within one banner:
 *       'no_solution'  — CRITICAL (rose): no coil at any ADP can control
 *                        humidity. Supplemental dehumidification required.
 *       'insufficient' — REVIEW (amber): plant ADP too warm by adpGap °F.
 *                        Each affected room listed with the exact gap.
 *
 *     Banner inserted between the monsoon peak banner and the high
 *     humidification banner. 'marginal' rooms (adpGap ≤ 3°F) are handled
 *     per-room in the Insights tab — not surfaced here to avoid noise.
 *
 * -- CHANGELOG v2.4 -----------------------------------------------------------
 *
 *   Monsoon peak season surfaced — rdsSelector v2.4 added peakCoolingSeason
 *     and peakCFMSeason per room. When any room's capacity is governed by
 *     monsoon (not summer), a banner now explains this and each affected room
 *     shows a badge in the zone table. Without this, a Mumbai/Chennai fab
 *     would show a TR number with no indication it came from monsoon design
 *     conditions — the engineer and AHJ have no way to audit the basis.
 *
 *   Heating + humidification KPI cards added — totalHeatingKW and totalHumidKW
 *     were computed by useProjectTotals but invisible on this page. Critical
 *     facility engineers need the HW plant and humidifier totals alongside
 *     the CHW plant total. Both added as a conditional second KPI row (only
 *     shown when the project has non-zero heating or humidification loads).
 *     Both also added to the Design Parameters panel as line items.
 *
 *   systemSummary mutation fixed — const array was mutated with .push().
 *     Rebuilt as a single pure expression using array spread.
 *
 *   RATING_TO_COLOR comment added — 'excellent' maps to red/warning because
 *     <50 ft²/TR is correct for a semiconductor fab but still warrants a
 *     "verify these extreme loads" check. Not a bug — documented as intentional.
 *
 * -- CHANGELOG v2.3 -----------------------------------------------------------
 *
 *   Export fixed — project name now read from Redux.
 *   Export documented as results snapshot, not a project save file.
 *   min-h-[calc(100vh-64px)] → min-h-full.
 *   Inline SVG → lucide-react Download.
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

// ── Check figure color mapping ─────────────────────────────────────────────
//
// 'excellent' (<50 ft²/TR, semiconductor/fab) maps to RED — intentional.
// This is the correct load density for a fab, but the warning colour signals
// "verify these extreme loads before stamping". It is NOT a positive
// confirmation — the engineer should double-check inputs at this density.
//
// 'review' (150–400 ft²/TR, general commercial) maps to GREEN because
// this is the normal range for a conventional building — no action needed.
//
// 'high' (>400 ft²/TR) maps to ORANGE — suspiciously low density,
// likely means loads are incomplete.
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

// Shown in zone table when monsoon governs capacity (peakCoolingSeason !== 'summer').
const MonsoonPeakBadge = () => (
  <span className="inline-block ml-1.5 text-[9px] font-bold uppercase tracking-wide
    bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded">
    monsoon peak
  </span>
);

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
    totalHeatingKW,
    totalHumidKW,
    checkFigureVal,
    checkFigureRating,
    checkFigureNote,
    highHumidRooms,
    regulatoryAcphRooms,
    insufficientAdpRooms,
    totalCoilLoadBTU,
    hasData,
  } = useProjectTotals();

  const sqftPerTR  = hasData && totalTR > 0 ? checkFigureVal.toFixed(0) : '—';
  const cfmPerSqft = totalAreaFt2 > 0 ? (totalCFM / totalAreaFt2).toFixed(2) : '—';
  const tipColor   = RATING_TO_COLOR[checkFigureRating] ?? 'orange';

  const acphGoverned = rdsRows.filter(
    (r) => ['designAcph', 'minAcph', 'regulatoryAcph'].includes(r.supplyAirGoverned)
  ).length;

  // Rooms where the capacity-governing season is not summer.
  // rdsSelector v2.4 tracks peakCoolingSeason independently of peakCFMSeason.
  // For Mumbai/Chennai/Singapore-class climates, monsoon OA enthalpy can push
  // the combined room + OA load above the summer peak.
  const monsoonPeakRooms = rdsRows.filter(
    (r) => r.peakCoolingSeason && r.peakCoolingSeason !== 'summer'
  );

  // CHW plant insufficiency — split by severity for separate banner sections.
  // 'no_solution' is critical (supplemental dehumidification required).
  // 'insufficient' is a review item (lower CHW supply temp or accept elevated RH).
  const noSolutionRooms     = insufficientAdpRooms.filter(r => r.adpSufficient === 'no_solution');
  const adpInsufficientRooms = insufficientAdpRooms.filter(r => r.adpSufficient === 'insufficient');

  // ── System summary — pure expression, no mutation ──────────────────────
  const ahuRows = ahus.map((ahu) => {
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
  const unassignedRow = unassigned.length > 0
    ? [{
        id:        'unassigned',
        name:      'Unassigned Zones',
        type:      'N/A',
        roomCount: unassigned.length,
        totalTR:   unassigned.reduce((s, r) => s + (parseFloat(r.coolingCapTR) || 0), 0),
        totalCFM:  unassigned.reduce((s, r) => s + (parseFloat(r.supplyAir)    || 0), 0),
        loadPct:   totalTR > 0
          ? (unassigned.reduce((s, r) => s + (parseFloat(r.coolingCapTR) || 0), 0) / totalTR) * 100
          : 0,
      }]
    : [];

  const systemSummary = [...ahuRows, ...unassignedRow];

  const handleExport = () => {
    // ⚠ This export is a RESULTS SNAPSHOT — not a project save file.
    // It serialises computed rdsRows and project-level totals.
    // It does NOT include the raw Redux state (rooms, envelopes, AHU configs,
    // climate data). It cannot be re-imported to reconstruct a project.
    const payload = {
      project:    projectName,
      exportedAt: new Date().toISOString(),
      units:      { area: 'm²', airflow: 'CFM', load: 'TR', coilLoad: 'BTU/hr' },
      totals:     { totalTR, totalCFM, totalAreaM2, totalAreaFt2, totalCoilLoadBTU },
      rooms:      rdsRows,
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

        {/* ── KPI Cards — Row 1: Cooling ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">Total Cooling</div>
            <div className="text-2xl font-bold text-blue-600 mt-2">
              {totalTR.toFixed(1)}{' '}
              <span className="text-sm text-slate-400 font-normal">TR</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1">Incl. fan heat</div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">Total Airflow</div>
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
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">CHW Plant Load</div>
            <div className="text-2xl font-bold text-cyan-600 mt-2">
              {(totalCoilLoadBTU / 12000).toFixed(1)}{' '}
              <span className="text-sm text-slate-400 font-normal">TR</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-mono">
              {totalCoilLoadBTU.toLocaleString()} BTU/hr · excl. fan heat
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">Total Area</div>
            <div className="text-2xl font-bold text-slate-700 mt-2">
              {totalAreaM2.toLocaleString(undefined, { maximumFractionDigits: 0 })}{' '}
              <span className="text-sm text-slate-400 font-normal">m²</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-mono">
              = {totalAreaFt2.toLocaleString(undefined, { maximumFractionDigits: 0 })} ft²
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">Check Figure</div>
            <div className="text-2xl font-bold text-emerald-600 mt-2">
              {sqftPerTR}{' '}
              <span className="text-sm text-slate-400 font-normal">ft²/TR</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-mono">{cfmPerSqft} CFM/ft²</div>
          </div>
        </div>

        {/* ── KPI Cards — Row 2: Heating + Humidification ──────────────────────
            Only rendered when the project has non-zero heating or humidification.
            These totals are computed by useProjectTotals but were previously
            invisible — critical facility engineers need HW plant and humidifier
            totals alongside the CHW plant total. */}
        {hasData && (totalHeatingKW > 0 || totalHumidKW > 0) && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

            {totalHeatingKW > 0 && (
              <div className="bg-white p-5 rounded-xl border border-orange-100 shadow-sm">
                <div className="text-xs font-bold text-orange-400 uppercase tracking-wide">Total Heating</div>
                <div className="text-2xl font-bold text-orange-600 mt-2">
                  {totalHeatingKW.toFixed(1)}{' '}
                  <span className="text-sm text-orange-300 font-normal">kW</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">HW plant basis</div>
              </div>
            )}

            {totalHumidKW > 0 && (
              <div className="bg-white p-5 rounded-xl border border-sky-100 shadow-sm">
                <div className="text-xs font-bold text-sky-400 uppercase tracking-wide">Total Humidification</div>
                <div className="text-2xl font-bold text-sky-600 mt-2">
                  {totalHumidKW.toFixed(1)}{' '}
                  <span className="text-sm text-sky-300 font-normal">kW</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {highHumidRooms.length > 0
                    ? `${highHumidRooms.length} room${highHumidRooms.length !== 1 ? 's' : ''} need review`
                    : 'Steam / electric humidifier'}
                </div>
              </div>
            )}

          </div>
        )}

        {/* ── Monsoon peak capacity banner ─────────────────────────────────────
            Shown when any room's cooling capacity is governed by monsoon OA
            enthalpy load rather than summer sensible peak. Added with
            rdsSelector v2.4 multi-season peak selection. */}
        {monsoonPeakRooms.length > 0 && (
          <div className="bg-teal-50 border border-teal-300 rounded-xl p-4 flex items-start gap-3">
            <div className="text-xl mt-0.5 shrink-0">🌧️</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-teal-900">
                {monsoonPeakRooms.length} room{monsoonPeakRooms.length !== 1 ? 's' : ''} — cooling capacity governed by monsoon, not summer
              </p>
              <p className="text-xs text-teal-700 mt-1 leading-relaxed">
                Combined room + outdoor air enthalpy load is higher during monsoon than summer
                for these zones. Cooling capacity (TR) and CHW pipe sizing are based on monsoon
                design conditions. Supply air CFM is still governed by peak sensible (summer).
                Confirm monsoon outdoor conditions in the Climate tab before final issue.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {monsoonPeakRooms.map((r) => (
                  <span key={r.id}
                    className="text-xs font-mono font-bold text-teal-800 bg-teal-100 rounded px-2 py-1">
                    {r.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── CHW plant psychrometric sufficiency banner ────────────────────────
            Shown when any room's ESHF analysis (rdsSelector v2.6 STEP 4b)
            finds that the plant ADP is too warm to simultaneously control
            both temperature and humidity.
            Two sections: no_solution (critical) and insufficient (review).
            'marginal' rooms are handled per-room in the Insights tab. */}
        {insufficientAdpRooms.length > 0 && (
          <div className="bg-rose-50 border border-rose-300 rounded-xl p-4 flex items-start gap-3">
            <div className="text-xl mt-0.5 shrink-0">❄️</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-rose-900">
                CHW plant cannot control humidity in {insufficientAdpRooms.length} room{insufficientAdpRooms.length !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-rose-700 mt-1 leading-relaxed">
                The ESHF analysis (ASHRAE HOF 2021 Ch.18) found that the plant apparatus dew point
                is too warm to simultaneously meet the temperature setpoint and humidity setpoint
                for the rooms below. Sensible cooling and tonnage figures are unaffected.
              </p>

              {/* no_solution rooms — CRITICAL */}
              {noSolutionRooms.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-bold text-rose-800 uppercase tracking-wide mb-1.5">
                    ⛔ Supplemental dehumidification required — no cooling coil can control humidity
                  </p>
                  <div className="space-y-1">
                    {noSolutionRooms.map((r) => (
                      <div key={r.id} className="text-xs font-mono text-rose-900 bg-rose-100 rounded px-2 py-1">
                        <span className="font-bold">{r.name}</span>
                        {r.designRH != null && (
                          <span className="text-rose-600 ml-2">target {r.designRH}%RH</span>
                        )}
                        {r.eshfNote && (
                          <span className="text-rose-600 ml-2">— {r.eshfNote}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-rose-600 mt-1.5 leading-relaxed">
                    Options: desiccant wheel, chilled-water reheat, or a dedicated dehumidifier circuit.
                    The cooling coil can handle sensible load but will not condense moisture at these conditions.
                  </p>
                </div>
              )}

              {/* insufficient rooms — REVIEW */}
              {adpInsufficientRooms.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-1.5">
                    ⚠️ Plant ADP too warm — lower CHW supply temperature or accept elevated RH
                  </p>
                  <div className="space-y-1">
                    {adpInsufficientRooms.map((r) => (
                      <div key={r.id} className="text-xs font-mono text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        <span className="font-bold">{r.name}</span>
                        {r.requiredADP != null && (
                          <span className="text-amber-700 ml-2">
                            needs {r.requiredADP.toFixed(1)}°F ADP
                          </span>
                        )}
                        {r.coil_adp != null && (
                          <span className="text-amber-600 ml-1">
                            · plant {r.coil_adp.toFixed(1)}°F
                          </span>
                        )}
                        {r.adpGap != null && (
                          <span className="font-bold text-amber-800 ml-1">
                            (+{r.adpGap.toFixed(1)}°F gap)
                          </span>
                        )}
                        {r.designRH != null && (
                          <span className="text-amber-600 ml-2">· target {r.designRH}%RH</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-amber-700 mt-1.5 leading-relaxed">
                    Each °F reduction in CHW supply temperature costs ~1.5–2% additional chiller energy annually.
                    Confirm acceptable RH tolerance with the process engineer before specifying CHW supply temperature.
                  </p>
                </div>
              )}

            </div>
          </div>
        )}

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
                  RSH / ERSH / GTSH in BTU/hr · governed by: thermal | design ACPH | min ACPH | regulatory ACH
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
                        <td className="px-4 py-2.5 font-medium text-slate-800">
                          {r.name}
                          {/* Monsoon peak badge — shown when peakCoolingSeason !== 'summer'.
                              TR and CHW pipe sizing came from monsoon design conditions. */}
                          {r.peakCoolingSeason && r.peakCoolingSeason !== 'summer' && (
                            <MonsoonPeakBadge />
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-500">
                          {(r.thermalCFM || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-500">
                          {(r.supplyAirMinAcph || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-800">
                          {(r.supplyAir || 0).toLocaleString()}
                        </td>
                        {/* null + NaN guard: 0 is a valid result for rooms with
                            minimal sensible loads — a truthy check shows '—' for 0. */}
                        <td className="px-4 py-2.5 text-right font-mono text-slate-500">
                          {r.rsh != null && !isNaN(r.rsh) ? Math.round(r.rsh).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-violet-600">
                          {r.ersh != null && !isNaN(r.ersh) ? Math.round(r.ersh).toLocaleString() : '—'}
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
                  <span className="font-bold text-slate-700">{systemDesign.returnFanHeat ?? 5}%</span>
                </li>
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">Site Elevation</span>
                  <span className="font-bold text-slate-700">{elevation} ft</span>
                </li>
                <li className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">CHW Plant (coil only)</span>
                  <span className="font-bold text-cyan-600">{(totalCoilLoadBTU / 12000).toFixed(1)} TR</span>
                </li>
                {totalHeatingKW > 0 && (
                  <li className="flex justify-between border-b border-slate-50 pb-2">
                    <span className="text-slate-500">HW Plant Total</span>
                    <span className="font-bold text-orange-600">{totalHeatingKW.toFixed(1)} kW</span>
                  </li>
                )}
                {totalHumidKW > 0 && (
                  <li className="flex justify-between border-b border-slate-50 pb-2">
                    <span className="text-slate-500">Humidifier Total</span>
                    <span className="font-bold text-sky-600">{totalHumidKW.toFixed(1)} kW</span>
                  </li>
                )}
              </ul>
            </div>

            {hasData && sqftPerTR !== '—' && (
              <div className={`rounded-xl border p-5 flex items-start gap-3
                ${tipColor === 'red'    ? 'bg-red-50    border-red-200'      : ''}
                ${tipColor === 'orange' ? 'bg-amber-50  border-amber-200'    : ''}
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