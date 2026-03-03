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

// Simple Input Helper
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
  
  // 1. Get Context
  const activeRoom = useSelector(selectActiveRoom);
  const envelope = useSelector(selectActiveEnvelope);

  // 2. Handlers
  const handleLoadChange = (type, field, val) => {
    // Ensure data structure exists first
    dispatch(initializeRoom(activeRoom.id));
    dispatch(updateInternalLoad({
      roomId: activeRoom.id,
      type,
      data: { [field]: parseFloat(val) || 0 }
    }));
  };

  const handleInfiltrationChange = (val) => {
    dispatch(initializeRoom(activeRoom.id));
    dispatch(updateInfiltration({
      roomId: activeRoom.id,
      field: 'achValue',
      value: parseFloat(val) || 0
    }));
  };

  if (!activeRoom) return <div className="flex h-screen items-center justify-center text-gray-400">Select a room to configure envelope.</div>;

  return (
    <div className="flex h-[calc(100vh-64px)] bg-gray-50">
      
      {/* Sidebar Navigation */}
      <RoomSidebar />

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-8">
        <header className="mb-8 border-b border-gray-200 pb-4">
          <div className="flex items-center gap-2 mb-1">
             <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-100 text-blue-700">Active Zone</span>
             <span className="text-sm text-gray-400 font-mono">#{activeRoom.id}</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">{activeRoom.name}</h1>
          <p className="text-gray-500 mt-1">Configure envelope layers and internal heat gains.</p>
        </header>

        {/* Internal Loads Section */}
        <section className="mb-10">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-green-500 rounded-full"></span>
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

        {/* Infiltration Section */}
        <section className="mb-10">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-orange-500 rounded-full"></span>
            Infiltration
          </h2>
          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm max-w-sm">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Air Changes / Hour (ACH)</label>
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
              Used to calculate infiltration CFM based on room volume ({activeRoom.volume} ft³).
            </p>
          </div>
        </section>

        {/* Envelope Construction Section (Placeholder for future Detailed Layer Editor) */}
        <section>
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
            Building Shell
          </h2>
          
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
            <div className="text-4xl mb-3">🧱</div>
            <h3 className="text-sm font-bold text-gray-900">Wall & Glass Construction</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              This module will allow you to define U-Values, Orientation, and Shading Coefficients for specific walls in <b>{activeRoom.name}</b>.
            </p>
            <button className="mt-4 px-4 py-2 bg-gray-50 text-gray-600 text-xs font-bold rounded border border-gray-200 hover:bg-white hover:border-gray-400 transition-all">
              + Add Wall Layer
            </button>
          </div>
        </section>

      </div>
    </div>
  );
}