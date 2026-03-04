import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { selectAllAHUs, addAHU, updateAHU, deleteAHU } from '../features/ahu/ahuSlice';
import { selectRdsData } from '../features/results/rdsSelector'; // Importing the Calculator

export default function AHUConfig() {
  const dispatch = useDispatch();
  
  // 1. Get Data
  const ahus = useSelector(selectAllAHUs);
  const rdsRows = useSelector(selectRdsData); // Contains calculated CFM/TR for every room
  
  // 2. Local UI State


  const [selectedAhuId, setSelectedAhuId] = useState(ahus[0]?.id || null);
  
  // 3. Derived Data: Get the active AHU object
  const selectedAhu = ahus.find(a => a.id === selectedAhuId);

  // 4. Derived Data: Filter rooms assigned to this AHU
  const assignedRooms = rdsRows.filter(row => row.ahuId === selectedAhuId);

  // 5. Derived Data: Calculate System Totals
  const totalCFM = assignedRooms.reduce((sum, r) => sum + (r.supplyAir || 0), 0);
  const totalTR = assignedRooms.reduce((sum, r) => sum + (parseFloat(r.coolingCapTR) || 0), 0);

  // Handlers
  const handleUpdate = (field, value) => {
    dispatch(updateAHU({ id: selectedAhuId, field, value }));
  };

  return (
    <div className="flex h-[calc(100vh-64px)] bg-slate-50">
      
      {/* ── LEFT SIDEBAR: AHU LIST ───────────────────────────────────────── */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Systems</h2>
          <button 
            onClick={() => dispatch(addAHU())}
            className="text-blue-600 hover:bg-blue-50 p-1 rounded transition-colors">
            + New
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {ahus.map(ahu => (
            <button
              key={ahu.id}
              onClick={() => setSelectedAhuId(ahu.id)}
              className={`w-full text-left px-5 py-4 border-l-4 transition-all group
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

      {/* ── RIGHT PANEL: CONFIG & RESULTS ────────────────────────────────── */}
      {selectedAhu ? (
        <div className="flex-1 overflow-y-auto p-8">
          
          {/* Header & Stats */}
          <div className="flex justify-between items-start mb-8">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{selectedAhu.name} Configuration</h1>
              <p className="text-slate-500 text-sm mt-1">Manage system parameters and view connected loads.</p>
            </div>
            
            {/* Real-time System Totals */}
            <div className="flex gap-4">
              <div className="bg-blue-600 text-white px-5 py-3 rounded-lg shadow-md text-center">
                <div className="text-xs font-bold opacity-80 uppercase tracking-wide">Total Airflow</div>
                <div className="text-2xl font-bold">{totalCFM.toLocaleString()} <span className="text-sm font-normal">CFM</span></div>
              </div>
              <div className="bg-white border border-slate-200 text-slate-700 px-5 py-3 rounded-lg shadow-sm text-center">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">Total Load</div>
                <div className="text-2xl font-bold">{totalTR.toFixed(1)} <span className="text-sm font-normal">TR</span></div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* 1. Configuration Form */}
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 border-b border-slate-100 pb-2">System Specs</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">System Name</label>
                    <input 
                      type="text" 
                      value={selectedAhu.name} 
                      onChange={(e) => handleUpdate('name', e.target.value)}
                      className="w-full border-slate-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">System Type</label>
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

            {/* 2. Assigned Rooms List (Read Only Summary) */}
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
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase">Room</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">Area (sqft)</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">Airflow (CFM)</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">Load (TR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 text-sm text-slate-600">
                      {assignedRooms.map(room => (
                        <tr key={room.id} className="hover:bg-slate-50">
                          <td className="px-6 py-3 font-medium text-slate-900">{room.name}</td>
                          <td className="px-6 py-3 text-right font-mono">{room.floorArea}</td>
                          <td className="px-6 py-3 text-right font-mono font-bold text-slate-700">{room.supplyAir}</td>
                          <td className="px-6 py-3 text-right font-mono text-blue-600">{room.coolingCapTR}</td>
                        </tr>
                      ))}
                    </tbody>
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