/**
 * AHUConfig.jsx
 * Responsibility: AHU system configuration and per-system load summary.
 *
 * -- CHANGELOG v2.2 -----------------------------------------------------------
 *
 *   ADP-01 — Apparatus Dew Point mode select + calculated ADP readout.
 *
 *     Each AHU now has an adpMode field ('manual' | 'calculated').
 *
 *     'manual':     Engineer enters ADP override (°F). 0 = use project default.
 *                   Same as previous behaviour — no calculation change.
 *
 *     'calculated': ADP is back-calculated from room sensible load in
 *                   rdsSelector.js via calculateAdpFromLoads() (psychro.js):
 *                     T_ADP = T_room − ERSH ÷ (Cs × Coil CFM)
 *                   The manual ADP input is hidden. A live readout table
 *                   shows the calculated ADP for every assigned room.
 *
 *     adpMode dispatches via the existing updateAHU reducer — no slice changes
 *     needed beyond adding the adpMode field to the AHU factory in ahuSlice.js.
 *
 *   BUG-UI-16 — deleteAHU replaced with deleteAhuWithCleanup.
 *
 *     The Delete System button was calling deleteAHU directly from ahuSlice.
 *     ahuSlice.js BUG-SLICE-04 explicitly documents this as unsafe:
 *     deleteAHU only removes the AHU from the list — it does NOT clear
 *     room.assignedAhuIds references, leaving all assigned rooms with a stale
 *     AHU ID. rdsSelector then silently reverts those rooms to Recirculating
 *     type with ahuId: '' and typeOfUnit: '-'.
 *
 *     Fix: dispatch(deleteAhuWithCleanup(selectedAhuId)) from roomActions.js.
 *     deleteAHU removed from the ahuSlice import (not needed in UI code).
 *
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   BUG-UI-13 [CRITICAL — UNIT DOUBLE-CONVERSION] — floorArea × M2_TO_FT2 removed.
 *   BUG-UI-14 [MEDIUM — MISSING GOVERNED TYPE] — 'regulatoryAcph' added.
 *   BUG-UI-15 [LOW] — unused React import removed.
 */

import { useState }                                 from 'react';
import { useSelector, useDispatch }                 from 'react-redux';
import { selectAllAHUs, addAHU, updateAHU }         from '../features/ahu/ahuSlice';
// BUG-UI-16 FIX: deleteAhuWithCleanup instead of deleteAHU directly.
// deleteAHU is retained as the underlying reducer for the thunk to dispatch —
// do NOT re-add it here. See ahuSlice.js BUG-SLICE-04 for the full explanation.
import { deleteAhuWithCleanup }                     from '../features/room/roomActions';
import { selectRdsData }                            from '../features/results/rdsSelector';
import ASHRAE                                       from '../constants/ashrae';

// ── Supply air governance badge ───────────────────────────────────────────────
// Matches ResultsPage v2.1
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

// ── AdpCalculatedReadout ──────────────────────────────────────────────────────

/**
 * AdpCalculatedReadout
 *
 * Displayed when adpMode = 'calculated'. Reads coil_adp from the assembled
 * rdsRows (populated by rdsSelector.js ADP-01 via calculateAdpFromLoads).
 *
 * Shows per-room: ADP (°F) and ΔT between room DB and ADP.
 * If no rooms are assigned yet, shows a placeholder prompt.
 *
 * NOTE: room.designTemp from rdsRow is °C (roomSlice storage convention).
 * It is converted to °F here for display only — the authoritative dbInF
 * used in calculations lives in rdsSelector.js as summerCalcs.dbInF.
 * If you add dbInF: dbInF to the rdsSelector return object, use that here
 * instead to eliminate the duplicate conversion.
 */
const AdpCalculatedReadout = ({ assignedRooms, defaultAdp }) => {
  const roomsWithAdp = assignedRooms.filter(r => r.coil_adp != null);

  if (roomsWithAdp.length === 0) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 mt-1">
        <p className="text-[10px] font-bold text-blue-600 uppercase">
          Calculated from room load
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5">
          Assign rooms to see calculated ADP values.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-1 rounded-md border border-blue-200 overflow-hidden">
      <div className="bg-blue-50 px-3 py-1.5 border-b border-blue-200">
        <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">
          Calculated ADP by Room
        </p>
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="bg-white border-b border-slate-100">
            <th className="px-3 py-1.5 text-[9px] font-bold text-slate-400 uppercase">Room</th>
            <th className="px-3 py-1.5 text-[9px] font-bold text-slate-400 uppercase text-right">ADP (°F)</th>
            <th className="px-3 py-1.5 text-[9px] font-bold text-slate-400 uppercase text-right">ΔT coil</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {roomsWithAdp.map(room => {
            const adp     = parseFloat(room.coil_adp) || defaultAdp;
            const roomDb  = parseFloat(room.designTemp);
            // designTemp stored in °C — convert to °F for display label only
            const roomDbF = !isNaN(roomDb) ? roomDb * 9 / 5 + 32 : 72;
            const deltaT  = (roomDbF - adp).toFixed(1);

            return (
              <tr key={room.id} className="hover:bg-slate-50">
                <td className="px-3 py-1.5 text-[10px] font-medium text-slate-700">
                  {room.name}
                </td>
                <td className="px-3 py-1.5 text-[10px] font-mono text-blue-700 text-right font-bold">
                  {adp.toFixed(1)}
                </td>
                <td className="px-3 py-1.5 text-[10px] font-mono text-slate-500 text-right">
                  {deltaT}°F
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="bg-slate-50 px-3 py-1.5 border-t border-slate-100">
        <p className="text-[9px] text-slate-400">
          ADP = T<sub>room</sub> &minus; ERSH &divide; (C<sub>s</sub> &times; Coil CFM)
          &nbsp;&middot;&nbsp;
          Coil CFM = Supply &times; (1 &minus; BF)
        </p>
      </div>
    </div>
  );
};

// ── Main page component ───────────────────────────────────────────────────────

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

            {/* ── Config form ──────────────────────────────────────────── */}
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 border-b border-slate-100 pb-2">
                  System Specs
                </h3>
                <div className="space-y-4">

                  {/* System Name */}
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

                  {/* System Type */}
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

                  {/* ── ADP-01: Apparatus Dew Point ─────────────────────── */}
                  <div className="pt-4 border-t border-slate-100">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                      Apparatus Dew Point
                    </h4>

                    {/* ADP Mode selector */}
                    <div className="mb-3">
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                        ADP Mode
                      </label>
                      <select
                        value={selectedAhu.adpMode ?? 'manual'}
                        onChange={(e) => handleUpdate('adpMode', e.target.value)}
                        className="w-full border-slate-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                      >
                        <option value="manual">Manual — enter ADP</option>
                        <option value="calculated">Calculated — from sensible load</option>
                      </select>
                      <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                        {(selectedAhu.adpMode ?? 'manual') === 'calculated' ? (
                          <span>
                            T<sub>ADP</sub> = T<sub>room</sub> &minus; ERSH &divide; (C<sub>s</sub> &times; Coil CFM)
                          </span>
                        ) : (
                          '0 = use project default'
                        )}
                      </p>
                    </div>

                    {/* Manual ADP input — hidden in calculated mode */}
                    {(selectedAhu.adpMode ?? 'manual') === 'manual' && (
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                          ADP Override (°F)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min="35"
                          max="65"
                          value={selectedAhu.adp > 0 ? selectedAhu.adp : ''}
                          placeholder={`Default: ${ASHRAE.DEFAULT_ADP}°F`}
                          onChange={(e) => handleUpdate('adp', parseFloat(e.target.value) || 0)}
                          className="w-full border-slate-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                        />
                      </div>
                    )}

                    {/* Calculated ADP live readout */}
                    {(selectedAhu.adpMode ?? 'manual') === 'calculated' && (
                      <AdpCalculatedReadout
                        assignedRooms={assignedRooms}
                        defaultAdp={ASHRAE.DEFAULT_ADP}
                      />
                    )}
                  </div>

                  {/* ── Delete ──────────────────────────────────────────── */}
                  {/* BUG-UI-16 FIX: deleteAhuWithCleanup clears room.assignedAhuIds
                      before removing the AHU. deleteAHU directly only removes the
                      AHU from the list — assigned rooms would retain stale ahuId
                      and silently revert to Recirculating / typeOfUnit: '-'. */}
                  <div className="pt-4">
                    <button
                      onClick={() => dispatch(deleteAhuWithCleanup(selectedAhuId))}
                      className="text-red-500 text-xs font-bold hover:text-red-700 hover:underline"
                    >
                      Delete System
                    </button>
                  </div>

                </div>
              </div>
            </div>

            {/* ── Assigned rooms table ──────────────────────────────────── */}
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
                          {/* BUG-UI-13 FIX: rdsRow.floorArea is already ft² (CRIT-RDS-01). */}
                          <td className="px-6 py-3 text-right font-mono text-slate-500">
                            {parseFloat(room.floorArea || 0).toFixed(0)}
                          </td>
                          <td className="px-6 py-3 text-right font-mono font-bold text-slate-700">
                            {(room.supplyAir || 0).toLocaleString()}
                          </td>
                          <td className="px-6 py-3 text-right">
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