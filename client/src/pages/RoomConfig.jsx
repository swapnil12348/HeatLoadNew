import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { selectActiveRoom, updateRoom } from '../features/room/roomSlice';
import RoomSidebar   from '../components/Layout/RoomSidebar';
import InputGroup    from '../components/UI/InputGroup';
import StatCard      from '../components/UI/StatCard';
import AhuAssignment from '../features/room/AhuAssignment';

export default function RoomConfig() {
  const dispatch   = useDispatch();
  const activeRoom = useSelector(selectActiveRoom);

  const handleUpdate = (field, value) => {
    dispatch(updateRoom({
      id:    activeRoom.id,
      field,
      value: field === 'name' ? value : (parseFloat(value) || 0),
    }));
  };

  if (!activeRoom) {
    return <div className="p-8 text-gray-400">Please add a room via the Sidebar.</div>;
  }

  return (
    // BUG-16 FIX: h-full fills the AppLayout flex-1 main container exactly.
    <div className="flex flex-col md:flex-row h-full bg-gray-50">

      {/* Sidebar */}
      <RoomSidebar />

      {/* Main Content
          BUG-16 FIX: h-full fills remaining space correctly alongside the sidebar. */}
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
            <AhuAssignment activeRoom={activeRoom} />
          </div>

        </div>
      </div>
    </div>
  );
}