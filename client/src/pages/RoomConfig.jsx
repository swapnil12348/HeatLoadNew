import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  selectActiveRoom,
  updateRoom,
  toggleRoomAhu,
} from '../features/room/roomSlice';
import { selectAllAHUs } from '../features/ahu/ahuSlice';
import RoomSidebar from '../components/Layout/RoomSidebar';

// ── Helper Components ─────────────────────────────────────────────────────────

const InputGroup = ({ label, value, onChange, unit, type = 'number', step = '1', className = '' }) => (
  <div className={`flex flex-col space-y-1 ${className}`}>
    <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">
      {label}
    </label>
    <div className="relative">
      <input
        type={type}
        step={step}
        value={value}
        onChange={onChange}
        className="w-full p-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 font-medium"
      />
      {unit && (
        <span className="absolute right-3 top-2.5 text-gray-400 text-sm font-medium">
          {unit}
        </span>
      )}
    </div>
  </div>
);

const StatCard = ({ label, value, unit, color = 'blue' }) => {
  const colors = {
    blue:    'bg-blue-50   text-blue-700   border-blue-100',
    indigo:  'bg-indigo-50 text-indigo-700 border-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  };
  return (
    <div className={`p-4 rounded-xl border ${colors[color] || colors.blue} flex flex-col justify-center items-center`}>
      <span className="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-1">{label}</span>
      <div className="text-2xl font-bold">
        {value} <span className="text-sm font-normal opacity-80">{unit}</span>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function RoomConfig() {
  const dispatch   = useDispatch();
  const activeRoom = useSelector(selectActiveRoom);
  const allAhus    = useSelector(selectAllAHUs);

  const handleUpdate = (field, value) => {
    dispatch(updateRoom({
      id:    activeRoom.id,
      field,
      value: field === 'name' ? value : (parseFloat(value) || 0),
    }));
  };

  const handleToggleAhu = (ahuId) => {
    dispatch(toggleRoomAhu({ roomId: activeRoom.id, ahuId }));
  };

  if (!activeRoom) {
    return <div className="p-8 text-gray-400">Please add a room via the Sidebar.</div>;
  }

  return (
    // BUG-16 FIX: was min-h-[calc(100vh-64px)] on the outer div.
    // Changed to h-full so it fills the AppLayout flex-1 main container exactly.
    <div className="flex flex-col md:flex-row h-full bg-gray-50">

      {/* Sidebar */}
      <RoomSidebar />

      {/* Main Content
          BUG-16 FIX: was h-[calc(100vh-64px)] — only subtracted header.
          Now h-full fills the remaining space correctly alongside the sidebar. */}
      <div className="flex-1 max-w-5xl p-4 md:p-8 space-y-8 overflow-y-auto h-full">

        {/* Header */}
        <div className="border-b border-gray-200 pb-4">
          <h2 className="text-3xl font-bold text-gray-900">Room Geometry & Climate</h2>
          <p className="text-gray-500 text-sm mt-1">
            Define dimensions, indoor climate requirements, and assign AHU sources.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-12">

          {/* Left column */}
          <div className="lg:col-span-2 space-y-6">

            {/* General Info */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span className="w-1 h-6 bg-blue-600 rounded-full" />
                General Identification
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InputGroup
                  label="Room Name"
                  type="text"
                  value={activeRoom.name || ''}
                  onChange={(e) => handleUpdate('name', e.target.value)}
                />
                <InputGroup
                  label="Room Internal Pressure"
                  value={activeRoom.pressure || ''}
                  unit="Pa"
                  onChange={(e) => handleUpdate('pressure', e.target.value)}
                />
              </div>
            </section>

            {/* Indoor Design Targets */}
            <section className="bg-amber-50 p-6 rounded-xl shadow-sm border border-amber-200">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">🌡️</span>
                <h3 className="text-lg font-bold text-amber-900">Indoor Design Targets</h3>
              </div>
              <p className="text-xs text-amber-700 mb-4">
                These values specify the desired temperature and humidity for{' '}
                <b>{activeRoom.name}</b>. The calculator uses these against the
                global Outside Climate data.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InputGroup
                  label="Target Temp"
                  value={activeRoom.designTemp || ''}
                  unit="°C"
                  className="[&>div>input]:bg-white [&>div>input]:text-amber-900 [&>div>input]:font-bold"
                  onChange={(e) => handleUpdate('designTemp', e.target.value)}
                />
                <InputGroup
                  label="Target RH"
                  value={activeRoom.designRH || ''}
                  unit="%"
                  className="[&>div>input]:bg-white [&>div>input]:text-amber-900 [&>div>input]:font-bold"
                  onChange={(e) => handleUpdate('designRH', e.target.value)}
                />
              </div>
            </section>

            {/* Dimensions */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span className="w-1 h-6 bg-indigo-600 rounded-full" />
                Dimensions
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <InputGroup
                  label="Length"
                  value={activeRoom.length || ''}
                  unit="m"
                  onChange={(e) => handleUpdate('length', e.target.value)}
                />
                <InputGroup
                  label="Width"
                  value={activeRoom.width || ''}
                  unit="m"
                  onChange={(e) => handleUpdate('width', e.target.value)}
                />
                <InputGroup
                  label="Height"
                  value={activeRoom.height || ''}
                  unit="m"
                  onChange={(e) => handleUpdate('height', e.target.value)}
                />
              </div>
            </section>

            {/* Calculated stats */}
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                label="Floor Area"
                value={activeRoom.floorArea?.toLocaleString() || 0}
                unit="m²"
                color="blue"
              />
              <StatCard
                label="Room Volume"
                value={activeRoom.volume?.toLocaleString() || 0}
                unit="m³"
                color="indigo"
              />
            </div>
          </div>

          {/* Right column — AHU assignment */}
          <div className="lg:col-span-1">
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-full">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-gray-800">Assigned AHUs</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Select which Air Handling Units supply air to this room.
                </p>
              </div>

              {allAhus.length === 0 ? (
                <div className="p-4 bg-yellow-50 text-yellow-800 text-xs rounded border border-yellow-200">
                  No AHUs configured. Go to <strong>AHU Config</strong> to create units first.
                </div>
              ) : (
                <div className="space-y-3">
                  {allAhus.map((ahu) => {
                    const isSelected = activeRoom.assignedAhuIds?.includes(ahu.id);
                    return (
                      <label
                        key={ahu.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all
                          ${isSelected
                            ? 'bg-blue-50 border-blue-200 shadow-sm'
                            : 'bg-gray-50 border-gray-100 hover:bg-white hover:border-gray-300'
                          }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleAhu(ahu.id)}
                          className="mt-1 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                        />
                        <div>
                          <div className={`text-sm font-bold ${isSelected ? 'text-blue-900' : 'text-gray-700'}`}>
                            {ahu.name}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {ahu.type || 'Standard Config'}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

        </div>
      </div>
    </div>
  );
}