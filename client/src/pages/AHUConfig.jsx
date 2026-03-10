/**
 * AHUConfig.jsx
 * Responsibility: AHU system configuration and per-system load summary.
 *
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   BUG-UI-13 [CRITICAL — UNIT DOUBLE-CONVERSION] — floorArea × M2_TO_FT2 removed.
 *
 *     The previous "BUG-04 FIX" comment and M2_TO_FT2 multiplication was written
 *     before CRIT-RDS-01 changed rdsRow.floorArea from m² to ft². After that fix,
 *     rdsRow.floorArea is already ft². The M2_TO_FT2 multiplication was a 10.76×
 *     error introduced by an outdated fix.
 *
 *     Previous (wrong post CRIT-RDS-01):
 *       ((parseFloat(room.floorArea) || 0) * M2_TO_FT2).toFixed(0)
 *       → 1076 ft² × 10.7639 = 11,590 ft² for a 100 m² room
 *
 *     Fix: use rdsRow.floorArea directly — it is already ft².
 *       parseFloat(room.floorArea || 0).toFixed(0)
 *
 *     M2_TO_FT2 constant removed — no longer needed in this file.
 *
 *   BUG-UI-14 [MEDIUM — MISSING GOVERNED TYPE] — 'regulatoryAcph' added.
 *
 *     GovernedBadge had no style/label entry for 'regulatoryAcph' (added in
 *     HIGH-AQ-01). NFPA 855 battery rooms and GMP Annex 1 pharma suites rendered
 *     a gray fallback badge showing the raw key string as visible text.
 *
 *     acphCount also excluded 'regulatoryAcph' rooms — the count shown in the
 *     header ("N zones ACPH-governed") was wrong for battery / pharma facilities.
 *
 *     Fix: 'regulatoryAcph' entry added to GovernedBadge styles + labels.
 *     acphCount filter updated to include all 3 ACPH governed types.
 *     Matches the fix already applied in ResultsPage v2.1 (BUG-UI-08).
 *
 *   BUG-UI-15 [LOW] — unused React import removed.
 *     Vite with React 17+ automatic JSX transform does not require explicit import.
 */

import { useState }                                    from 'react'; // BUG-UI-15 FIX
import { useSelector, useDispatch }                    from 'react-redux';
import { selectAllAHUs, addAHU, updateAHU, deleteAHU } from '../features/ahu/ahuSlice';
import { selectRdsData }                               from '../features/results/rdsSelector';

// Supply air governance badge — matches ResultsPage v2.1
const GovernedBadge = ({ governed }) => {
  if (!governed) return null;

  const styles = {
    thermal:        'bg-orange-100 text-orange-700 border-orange-200',
    designAcph:     'bg-purple-100 text-purple-700 border-purple-200',
    minAcph:        'bg-blue-100   text-blue-700   border-blue-200',
    // BUG-UI-14 FIX: 'regulatoryAcph' — NFPA 855 battery / GMP Annex 1 pharma.
    // Previous: no entry → gray fallback badge with raw key 'regulatoryAcph' as text.
    regulatoryAcph: 'bg-red-100    text-red-700    border-red-200',
  };
  const labels = {
    thermal:        'Heat load',
    designAcph:     'Design ACPH',
    minAcph:        'Min ACPH',
    regulatoryAcph: 'Regulatory ACH', // BUG-UI-14 FIX
  };

  return (
    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${styles[governed] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
      {labels[governed] ?? governed}
    </span>
  );
};

export default function AHUConfig() {
  const dispatch = useDispatch();

  const ahus    = useSelector(selectAllAHUs);
  const rdsRows = useSelector(selectRdsData);

  const [selectedAhuId, setSelectedAhuId] = useState(ahus[0]?.id || null);

  const selectedAhu   = ahus.find((a) => a.id === selectedAhuId);
  const assignedRooms = rdsRows.filter((row) => row.ahuId === selectedAhuId);

  const totalCFM = assignedRooms.reduce((sum, r) => sum + (r.supplyAir || 0), 0);
  const totalTR  = assignedRooms.reduce((sum, r) => sum + (parseFloat(r.coolingCapTR) || 0), 0);

  // BUG-UI-14 FIX: include 'regulatoryAcph' in ACPH-governed count.
  // Previous filter only counted 'designAcph' and 'minAcph' — excluded
  // NFPA 855 battery rooms and GMP Annex 1 pharma suites.
  const acphCount = assignedRooms.filter(
    (r) => ['designAcph', 'minAcph', 'regulatoryAcph'].includes(r.supplyAirGoverned)
  ).length;

  const handleUpdate = (field, value) => {
    dispatch(updateAHU({ id: selectedAhuId, field, value }));
  };

  return (
    <div className="flex h-[calc(100vh-64px)] bg-slate-50">

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Systems</h2>
          <button
            onClick={() => dispatch(addAHU())}
            className="text-blue-600 hover:bg-blue-50 p-1 rounded transition-colors text-sm font-bold"
          >
            + New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {ahus.map((ahu) => (
            <button
              key={ahu.id}
              onClick={() => setSelectedAhuId(ahu.id)}
              className={`w-full text-left px-5 py-4 border-l-4 transition-all
                ${selectedAhuId === ahu.id
                  ? 'bg-blue-50 border-blue-600'
                  : 'bg-white border-transparent hover:bg-slate-50'
                }`}
            >
              <div className={`font-bold text-sm ${selectedAhuId === ahu.id ? 'text-blue-900' : 'text-slate-700'}`}>
                {ahu.name}
              </div>
              <div className="text-xs text-slate-400 mt-1">{ahu.type}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── RIGHT PANEL ──────────────────────────────────────────────────── */}
      {selectedAhu ? (
        <div className="flex-1 overflow-y-auto p-8">

          {/* Header */}
          <div className="flex justify-between items-start mb-8">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {selectedAhu.name} Configuration
              </h1>
              <p className="text-slate-500 text-sm mt-1">
                Manage system parameters and view connected loads.
              </p>
              {acphCount > 0 && (
                <p className="text-[11px] text-purple-600 font-bold mt-1">
                  {acphCount} zone{acphCount > 1 ? 's' : ''} in this system are ACPH-governed
                  — supply air exceeds thermal requirement.
                </p>
              )}
            </div>

            {/* System totals */}
            <div className="flex gap-4">
              <div className="bg-blue-600 text-white px-5 py-3 rounded-lg shadow-md text-center">
                <div className="text-xs font-bold opacity-80 uppercase tracking-wide">
                  Total Airflow
                </div>
                <div className="text-2xl font-bold">
                  {totalCFM.toLocaleString()}{' '}
                  <span className="text-sm font-normal">CFM</span>
                </div>
              </div>
              <div className="bg-white border border-slate-200 text-slate-700 px-5 py-3 rounded-lg shadow-sm text-center">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                  Total Load
                </div>
                <div className="text-2xl font-bold">
                  {totalTR.toFixed(1)}{' '}
                  <span className="text-sm font-normal">TR</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* Config form */}
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 border-b border-slate-100 pb-2">
                  System Specs
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                      System Name
                    </label>
                    <input
                      type="text"
                      value={selectedAhu.name}
                      onChange={(e) => handleUpdate('name', e.target.value)}
                      className="w-full border-slate-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                      System Type
                    </label>
                    <select
                      value={selectedAhu.type}
                      onChange={(e) => handleUpdate('type', e.target.value)}
                      className="w-full border-slate-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                    >
                      <option value="Recirculating">Recirculating (Mixing)</option>
                      <option value="DOAS">DOAS (100% Fresh Air)</option>
                      <option value="FCU">Fan Coil Unit</option>
                    </select>
                  </div>

                  <div className="pt-4">
                    <button
                      onClick={() => dispatch(deleteAHU(selectedAhuId))}
                      className="text-red-500 text-xs font-bold hover:text-red-700 hover:underline"
                    >
                      Delete System
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Assigned rooms table */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                  <h3 className="text-sm font-bold text-slate-700">Assigned Zones</h3>
                  <span className="text-xs bg-white border border-slate-200 px-2 py-1 rounded text-slate-500 font-bold">
                    {assignedRooms.length} Rooms
                  </span>
                </div>

                {assignedRooms.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-sm">
                    No rooms assigned. Go to the <b>RDS Tab</b> to assign rooms to this system.
                  </div>
                ) : (
                  <table className="w-full text-left">
                    <thead className="bg-white border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase">
                          Room
                        </th>
                        {/* rdsRow.floorArea is ft² (post CRIT-RDS-01) — no conversion needed */}
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">
                          Area (ft²)
                        </th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">
                          Supply (CFM)
                        </th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">
                          Governed
                        </th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">
                          Load (TR)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 text-sm text-slate-600">
                      {assignedRooms.map((room) => (
                        <tr key={room.id} className="hover:bg-slate-50">
                          <td className="px-6 py-3 font-medium text-slate-900">
                            <div>{room.name}</div>
                            {room.classInOp && (
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                {room.classInOp}
                              </div>
                            )}
                          </td>
                          {/* BUG-UI-13 FIX: rdsRow.floorArea is already ft² (CRIT-RDS-01).
                              Previous code multiplied by M2_TO_FT2 (10.7639) again → 10.76× error.
                              The "BUG-04 FIX" comment + M2_TO_FT2 multiplication was written before
                              CRIT-RDS-01 changed rdsRow.floorArea unit from m² to ft². */}
                          <td className="px-6 py-3 text-right font-mono text-slate-500">
                            {parseFloat(room.floorArea || 0).toFixed(0)}
                          </td>
                          <td className="px-6 py-3 text-right font-mono font-bold text-slate-700">
                            {(room.supplyAir || 0).toLocaleString()}
                          </td>
                          <td className="px-6 py-3 text-right">
                            {/* BUG-UI-14 FIX: GovernedBadge now handles 'regulatoryAcph' */}
                            <GovernedBadge governed={room.supplyAirGoverned} />
                          </td>
                          <td className="px-6 py-3 text-right font-mono text-blue-600">
                            {room.coolingCapTR}
                          </td>
                        </tr>
                      ))}
                    </tbody>

                    {/* Footer totals row */}
                    <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                      <tr>
                        <td className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">
                          System Total
                        </td>
                        {/* BUG-UI-13 FIX: sum rdsRow.floorArea directly — already ft². */}
                        <td className="px-6 py-3 text-right font-mono text-xs text-slate-500">
                          {assignedRooms
                            .reduce((s, r) => s + (parseFloat(r.floorArea) || 0), 0)
                            .toFixed(0)} ft²
                        </td>
                        <td className="px-6 py-3 text-right font-mono font-bold text-slate-800">
                          {totalCFM.toLocaleString()}
                        </td>
                        <td />
                        <td className="px-6 py-3 text-right font-mono font-bold text-blue-700">
                          {totalTR.toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>

          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-400">
          Select a system to configure
        </div>
      )}
    </div>
  );
}