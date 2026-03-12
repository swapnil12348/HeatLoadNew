/**
 * RDSPage.jsx
 * Responsibility: Master project overview — rooms grouped by AHU system,
 *                 with click-to-edit side panel.
 *
 * -- CHANGELOG v2.2 -----------------------------------------------------------
 *
 *   BUG-UI-12 [MEDIUM — FALSY GUARD] — RSH / ERSH / GTSH conditionals in
 *     SummaryRow changed from truthy check to null + NaN guard.
 *
 *     Previous: {roomData.ersh ? value : '—'}
 *     Problem:  0 is falsy in JS. A room with near-zero sensible load displays
 *               '—' instead of the actual value.
 *     Fix:      {roomData.ersh != null && !isNaN(roomData.ersh) ? value : '—'}
 *
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   BUG-UI-03 [CRITICAL — UNIT LABEL] — SummaryRow floorArea label corrected.
 *
 *   BUG-UI-04 [MEDIUM — MISSING CRITICAL SURFACE] — highHumidRooms and
 *     regulatoryAcphRooms banners added.
 */

import { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { ChevronRight } from 'lucide-react';
import { addNewRoom } from '../features/room/roomActions';
import { selectAllAHUs, addAHU } from '../features/ahu/ahuSlice';
import { selectAllRooms } from '../features/room/roomSlice';
import { selectRdsData } from '../features/results/rdsSelector';
import useProjectTotals from '../hooks/useProjectTotals';
import RoomDetailPanel from './rds/RoomDetailPanel';

// ── ISO class colour map ──────────────────────────────────────────────────────
const ISO_BADGE = {
  'ISO 5':       'bg-red-50    text-red-700    border-red-100',
  'ISO 6':       'bg-orange-50 text-orange-700 border-orange-100',
  'ISO 7':       'bg-purple-50 text-purple-700 border-purple-100',
  'ISO 8':       'bg-slate-50  text-slate-600  border-slate-200',
  'CNC':         'bg-teal-50   text-teal-700   border-teal-100',
  'Unclassified':'bg-gray-50   text-gray-500   border-gray-200',
};

// ── SummaryRow ────────────────────────────────────────────────────────────────

const SummaryRow = ({ roomData, ahus, onClick }) => {
  const ahu = ahus.find((a) => a.id === roomData.ahuId);

  return (
    <tr
      onClick={onClick}
      className="group hover:bg-blue-50 cursor-pointer border-b border-gray-100 transition-all duration-200"
    >
      {/* Room name + number */}
      <td className="px-6 py-3 whitespace-nowrap">
        <div className="flex items-center">
          <div className={`w-1 h-8 rounded-l-md mr-3 shrink-0
            ${ahu ? 'bg-blue-500' : 'bg-slate-300'}`}
          />
          <div>
            <div className="text-sm font-bold text-slate-900">
              {roomData.name || <span className="italic text-slate-400">Unnamed</span>}
            </div>
            <div className="text-[10px] font-mono text-slate-400">
              {roomData.roomNo || '—'}
            </div>
          </div>
        </div>
      </td>

      {/* ISO class badge */}
      <td className="px-6 py-3">
        <span className={`
          inline-flex items-center px-2 py-0.5 rounded
          text-[10px] font-bold uppercase tracking-wide border
          ${ISO_BADGE[roomData.atRestClass] ?? ISO_BADGE['Unclassified']}
        `}>
          {roomData.atRestClass || 'Unclassified'}
        </span>
      </td>

      {/* Area — BUG-UI-03 FIX: rdsRow.floorArea is ft² (CRIT-RDS-01). */}
      <td className="px-6 py-3 text-sm text-slate-600 font-mono">
        {roomData.floorArea
          ? parseFloat(roomData.floorArea).toLocaleString(undefined, { maximumFractionDigits: 0 })
          : '—'}
        <span className="text-[10px] text-slate-400 ml-1">ft²</span>
      </td>

      {/* Supply airflow */}
      <td className="px-6 py-3 text-right">
        <div className="text-sm font-bold text-slate-700">
          {roomData.supplyAir ? Math.round(roomData.supplyAir).toLocaleString() : '0'}
        </div>
        <div className="text-[10px] text-slate-400">CFM</div>
      </td>

      {/* Sensible heat — ERSH / RSH / GTSH
          BUG-UI-12 FIX: null + NaN guard replaces plain truthy check.
          0 is a valid sensible load (e.g. room with only latent gains from
          people in a cold space). A plain `roomData.ersh ?` check would show
          '—' for 0, which is incorrect. `!= null` passes 0 through correctly
          while still guarding against undefined and NaN from missing calc fields. */}
      <td className="px-6 py-3 text-right">
        <div className="text-sm font-bold text-violet-600">
          {roomData.ersh != null && !isNaN(roomData.ersh)
            ? Math.round(roomData.ersh).toLocaleString()
            : '—'}
        </div>
        <div className="text-[10px] text-slate-400">
          ERSH · RSH{' '}
          {roomData.rsh != null && !isNaN(roomData.rsh)
            ? Math.round(roomData.rsh).toLocaleString()
            : '—'}
        </div>
        <div className="text-[10px] text-slate-400 font-mono">
          GTSH{' '}
          {roomData.grandTotalSensible != null && !isNaN(roomData.grandTotalSensible)
            ? Math.round(roomData.grandTotalSensible).toLocaleString()
            : '—'}
        </div>
      </td>

      {/* Cooling load */}
      <td className="px-6 py-3 text-right">
        <div className="text-sm font-bold text-blue-600">
          {parseFloat(roomData.coolingCapTR || 0).toFixed(2)}
        </div>
        <div className="text-[10px] text-slate-400">TR</div>
      </td>

      {/* Chevron */}
      <td className="px-6 py-3 text-right">
        <ChevronRight
          className="w-5 h-5 text-slate-300 group-hover:text-blue-500 transition-colors inline-block"
          aria-hidden="true"
        />
      </td>
    </tr>
  );
};

// ── RDSPage ───────────────────────────────────────────────────────────────────

export default function RDSPage() {
  const dispatch = useDispatch();

  const rawRooms   = useSelector(selectAllRooms);
  const ahus       = useSelector(selectAllAHUs);
  const allRdsRows = useSelector(selectRdsData);

  const [selectedRoomId, setSelectedRoomId] = useState(null);

  const selectedEnvelope = useSelector(
    (state) => state.envelope.byRoomId?.[selectedRoomId] ?? null
  );

  const {
    byAhu,
    totalTR,
    totalCFM,
    roomCount,
    hasData,
    highHumidRooms,
    regulatoryAcphRooms,
  } = useProjectTotals();

  const selectedRawRoom = rawRooms.find((r) => r.id === selectedRoomId) ?? null;
  const selectedRdsRow  = allRdsRows.find((r) => r.id === selectedRoomId) ?? null;

  return (
    <div className="flex h-full bg-slate-50 relative overflow-hidden">

      {/* ── Main table area ───────────────────────────────────────────── */}
      <div className={`
        flex-1 flex flex-col transition-all duration-300
        ${selectedRoomId ? 'mr-[620px]' : ''}
      `}>

        {/* Page header */}
        <div className="bg-white px-8 py-5 border-b border-slate-200
                        flex justify-between items-center shadow-sm z-10 shrink-0">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Project Rooms
            </h1>
            <div className="flex items-center gap-4 mt-1">
              <p className="text-slate-500 text-sm">
                {roomCount} zone{roomCount !== 1 ? 's' : ''} configured
              </p>
              {hasData && (
                <>
                  <span className="text-slate-200">·</span>
                  <span className="text-sm font-bold text-blue-600">
                    {totalTR.toFixed(1)} TR total
                  </span>
                  <span className="text-slate-200">·</span>
                  <span className="text-sm font-medium text-slate-500">
                    {totalCFM.toLocaleString()} CFM total
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex gap-3 items-center">
            <button
              onClick={() => {
                if (window.confirm('Reset all project data? This cannot be undone.')) {
                  dispatch({ type: 'RESET_ALL' });
                }
              }}
              className="text-red-400 text-xs font-bold hover:text-red-600 hover:underline px-3 transition-colors"
            >
              Reset
            </button>
            <button
              onClick={() => dispatch(addAHU())}
              className="bg-white border border-slate-300 text-slate-700
                         px-4 py-2 rounded-lg text-sm font-bold shadow-sm
                         hover:bg-slate-50 transition-colors"
            >
              + System
            </button>
            <button
              onClick={() => dispatch(addNewRoom())}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm
                         font-bold shadow-md hover:bg-blue-700 hover:shadow-lg transition-all"
            >
              + Add Room
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-6xl mx-auto space-y-6">

            {/* High humidification warning banner */}
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

            {/* Regulatory ACH statutory floor banner */}
            {regulatoryAcphRooms.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
                <div className="text-xl mt-0.5 shrink-0">📋</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-amber-900">
                    {regulatoryAcphRooms.length} room{regulatoryAcphRooms.length !== 1 ? 's' : ''} governed by statutory ACH floor
                  </p>
                  <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                    NFPA 855 (battery safety), OSHA ventilation, or GMP Annex 1 statutory minimum
                    exceeds the thermal CFM. Supply air is code-driven, not engineering-driven.
                    Confirm code basis with project AHJ before final issue.
                  </p>
                  <div className="mt-2 space-y-1">
                    {regulatoryAcphRooms.map((r) => (
                      <div key={r.id} className="text-xs font-mono text-amber-800 bg-amber-100 rounded px-2 py-1">
                        <span className="font-bold">{r.name}</span>
                        {' — '}Reg. {Math.round(r.regulatoryAcphCFM).toLocaleString()} CFM
                        {' vs '}{Math.round(r.thermalCFM).toLocaleString()} CFM thermal
                        {' ('}
                        {(((r.regulatoryAcphCFM - r.thermalCFM) / r.thermalCFM) * 100).toFixed(0)}% above thermal
                        {')'}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* AHU groups */}
            {Object.entries(byAhu).map(([ahuId, group]) => {
              const ahu = ahus.find((a) => a.id === ahuId);
              const groupRdsRows = allRdsRows.filter(
                (r) => (r.ahuId || 'unassigned') === ahuId
              );

              return (
                <div
                  key={ahuId}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
                >
                  {/* Group header */}
                  <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full shrink-0 ${ahu ? 'bg-blue-500' : 'bg-slate-300'}`} />
                      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
                        {ahu ? ahu.name : 'Unassigned Zones'}
                      </h3>
                      {ahu?.type && (
                        <span className="text-[10px] text-slate-400 font-mono ml-1">({ahu.type})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {ahu && (
                        <span className="text-xs font-bold text-blue-600 font-mono">
                          {group.tr.toFixed(1)} TR
                        </span>
                      )}
                      <span className="bg-white border border-slate-200 px-2 py-0.5 rounded text-xs font-bold text-slate-500">
                        {group.rooms.length} room{group.rooms.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Room table */}
                  <table className="w-full text-left">
                    <thead className="bg-white border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Room</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Class</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Area (ft²)</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Airflow</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Sensible Heat</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Load</th>
                        <th className="px-6 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {groupRdsRows.map((row) => (
                        <SummaryRow
                          key={row.id}
                          roomData={row}
                          ahus={ahus}
                          onClick={() => setSelectedRoomId(row.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}

            {/* Empty state */}
            {!hasData && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-3xl">
                  📐
                </div>
                <p className="font-medium text-slate-600">No rooms yet</p>
                <p className="text-sm mt-1">
                  Click <strong>+ Add Room</strong> to begin your RDS design.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Side panel ────────────────────────────────────────────────── */}
      {selectedRoomId && selectedRawRoom && (
        <>
          <div
            className="absolute inset-0 bg-slate-900/20 backdrop-blur-[2px] z-40 transition-opacity"
            onClick={() => setSelectedRoomId(null)}
          />
          <RoomDetailPanel
            room={selectedRawRoom}
            rdsRow={selectedRdsRow}
            envelope={selectedEnvelope}
            ahus={ahus}
            onClose={() => setSelectedRoomId(null)}
          />
        </>
      )}
    </div>
  );
}