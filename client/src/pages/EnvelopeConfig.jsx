import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { selectActiveRoom } from '../features/room/roomSlice';
import {
  selectActiveEnvelope,
  updateInternalLoad,
  initializeRoom,
  updateInfiltration
} from '../features/envelope/envelopeSlice';
import RoomSidebar from '../components/Layout/RoomSidebar';
import BuildingShell from '../features/envelope/BuildingShell';

// ── Unit conversion ──────────────────────────────────────────────────────────
// designTemp is stored in °C (per roomSlice / RDSConfig).
// All ASHRAE CLTD calculations in envelopeCalc.js expect °F.
const celsiusToFahrenheit = (c) => (parseFloat(c) * 9) / 5 + 32;

// ── Simple Input Helper ──────────────────────────────────────────────────────
const LoadInput = ({ label, value, onChange, unit }) => (
  <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">{label}</label>
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        onChange={onChange}
        className="w-full border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
      />
      <span className="text-gray-400 text-xs font-medium w-8">{unit}</span>
    </div>
  </div>
);

export default function EnvelopeConfig() {
  const dispatch = useDispatch();

  const activeRoom = useSelector(selectActiveRoom);
  const envelope   = useSelector(selectActiveEnvelope);
  const climate    = useSelector((state) => state.climate);

  const handleLoadChange = (type, field, val) => {
    dispatch(initializeRoom(activeRoom.id));
    dispatch(updateInternalLoad({
      roomId: activeRoom.id,
      type,
      data: { [field]: parseFloat(val) || 0 },
    }));
  };

  const handleInfiltrationChange = (val) => {
    dispatch(initializeRoom(activeRoom.id));
    dispatch(updateInfiltration({
      roomId: activeRoom.id,
      field: 'achValue',
      value: parseFloat(val) || 0,
    }));
  };

  if (!activeRoom) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-400">
        Select a room to configure envelope.
      </div>
    );
  }

  // Convert stored °C value to °F for all ASHRAE CLTD calculations.
  // Fallback to 72°F (22.2°C) if designTemp is missing.
  const tRoomF = isNaN(parseFloat(activeRoom.designTemp))
    ? 72
    : celsiusToFahrenheit(activeRoom.designTemp);

  return (
    <div className="flex h-[calc(100vh-64px)] bg-gray-50">

      <RoomSidebar />

      <div className="flex-1 overflow-y-auto p-8">

        {/* ── Page Header ── */}
        <header className="mb-8 border-b border-gray-200 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-100 text-blue-700">
              Active Zone
            </span>
            <span className="text-sm text-gray-400 font-mono">#{activeRoom.id}</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">{activeRoom.name}</h1>
          <p className="text-gray-500 mt-1">
            Configure envelope layers and internal heat gains.
          </p>
          <p className="text-[11px] text-indigo-500 font-mono mt-1">
            Indoor design: {activeRoom.designTemp ?? '—'}°C → {tRoomF.toFixed(1)}°F used for CLTD corrections
          </p>
        </header>

        {/* ── Internal Heat Gains ── */}
        <section className="mb-10">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-green-500 rounded-full" />
            Internal Heat Gains
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <LoadInput
              label="People (Occupancy)"
              value={envelope.internalLoads?.people?.count || 0}
              unit="Ppl"
              onChange={(e) => handleLoadChange('people', 'count', e.target.value)}
            />
            <LoadInput
              label="Lighting Density"
              value={envelope.internalLoads?.lights?.wattsPerSqFt || 0}
              unit="W/ft²"
              onChange={(e) => handleLoadChange('lights', 'wattsPerSqFt', e.target.value)}
            />
            <LoadInput
              label="Equipment Load"
              value={envelope.internalLoads?.equipment?.kw || 0}
              unit="kW"
              onChange={(e) => handleLoadChange('equipment', 'kw', e.target.value)}
            />
          </div>
        </section>

        {/* ── Infiltration ── */}
        <section className="mb-10">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-orange-500 rounded-full" />
            Infiltration
          </h2>
          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm max-w-sm">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
              Air Changes / Hour (ACH)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={envelope.infiltration?.achValue || 0}
                onChange={(e) => handleInfiltrationChange(e.target.value)}
                className="w-full border-gray-300 rounded-md shadow-sm focus:border-blue-500 sm:text-sm"
              />
              <span className="text-gray-400 text-xs font-medium w-12">ACPH</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">
              Infiltration CFM = vol(m³) × 35.31 × ACH / 60 &nbsp;·&nbsp; Room volume: {activeRoom.volume} m³
            </p>
          </div>
        </section>

        {/* ── Building Shell ── */}
        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-indigo-500 rounded-full" />
            Building Shell
          </h2>
          <BuildingShell
            roomId={activeRoom.id}
            elements={envelope.elements}
            climate={climate}
            tRoom={tRoomF}
          />
        </section>

      </div>
    </div>
  );
}