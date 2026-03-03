import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
// 1. FIX IMPORT PATH:
import { addNewRoom } from '../features/room/roomActions'; 
import { selectAllAHUs, addAHU } from '../features/ahu/ahuSlice';
import { selectRdsData } from '../features/results/rdsSelector';
import { selectEnvelopeByRoomId } from '../features/envelope/envelopeSlice'; 
import RoomDetailPanel from './rds/RoomDetailPanel';

// ── Summary Row Component ──────────────────────────────────────────────────
const SummaryRow = ({ roomData, ahus, onClick }) => {
  const ahu = ahus.find(a => a.id === roomData.ahuId);
  
  return (
    <tr 
      onClick={onClick}
      className="group hover:bg-blue-50 cursor-pointer border-b border-gray-100 transition-all duration-200"
    >
      <td className="px-6 py-3 whitespace-nowrap">
        <div className="flex items-center">
          <div className={`w-1 h-8 rounded-l-md mr-3 ${ahu ? 'bg-blue-500' : 'bg-slate-300'}`}></div>
          <div>
            <div className="text-sm font-bold text-slate-900">{roomData.name}</div>
            <div className="text-[10px] font-mono text-slate-400">{roomData.roomNo || 'NO #'}</div>
          </div>
        </div>
      </td>
      <td className="px-6 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border
          ${roomData.atRestClass === 'ISO 7' ? 'bg-purple-50 text-purple-700 border-purple-100' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
          {roomData.atRestClass || 'ISO 8'}
        </span>
      </td>
      <td className="px-6 py-3 text-sm text-slate-600 font-mono">
        {roomData.floorArea ? roomData.floorArea.toLocaleString() : '-'} <span className="text-[10px] text-slate-400">ft²</span>
      </td>
      <td className="px-6 py-3 text-right">
        <div className="text-sm font-bold text-slate-700">
          {/* This uses the Calculated Supply Air */}
          {roomData.supplyAir ? roomData.supplyAir.toLocaleString() : '0'}
        </div>
        <div className="text-[10px] text-slate-400">CFM</div>
      </td>
      <td className="px-6 py-3 text-right">
        <div className="text-sm font-bold text-blue-600">
          {/* This uses the Calculated TR */}
          {roomData.coolingCapTR || '0.00'}
        </div>
        <div className="text-[10px] text-slate-400">TR</div>
      </td>
      <td className="px-6 py-3 text-right">
        <button className="text-slate-300 group-hover:text-blue-500 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </td>
    </tr>
  );
};

// ── Main Page ──────────────────────────────────────────────────────────────
export default function RDSPage() {
  const dispatch = useDispatch();
  
  const rdsRows = useSelector(selectRdsData); 
  const ahus = useSelector(selectAllAHUs);
  // We need raw envelopes to pass to the Editor Panel
  const rawEnvelopes = useSelector((state) => state.envelope.byRoomId);

  const [selectedRoomId, setSelectedRoomId] = useState(null);
  
  // Find the full calculated object for the selected room
  const selectedRoomData = rdsRows.find(r => r.id === selectedRoomId);

  // Group by AHU using the calculated data
  const roomsByAhu = rdsRows.reduce((acc, row) => {
    const ahuId = row.ahuId || 'unassigned';
    if (!acc[ahuId]) acc[ahuId] = [];
    acc[ahuId].push(row);
    return acc;
  }, {});

  return (
    <div className="flex h-[calc(100vh-64px)] bg-slate-50 relative overflow-hidden">
      
      {/* Main Table Area */}
      <div className={`flex-1 flex flex-col transition-all duration-300 ${selectedRoomId ? 'mr-[600px]' : ''}`}>
        
        {/* Header */}
        <div className="bg-white px-8 py-5 border-b border-slate-200 flex justify-between items-center shadow-sm z-10">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Project Rooms</h1>
            <p className="text-slate-500 text-sm mt-1">{rdsRows.length} Zones configured</p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => {
                 if(window.confirm("Reset Project to Defaults? This clears bad data.")) {
                   localStorage.clear();
                   window.location.reload();
                 }
              }} 
              className="text-red-500 text-xs font-bold hover:underline px-3"
            >
              Reset
            </button>
            <button onClick={() => dispatch(addAHU())} className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-slate-50">+ System</button>
            <button onClick={() => dispatch(addNewRoom())} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md hover:bg-blue-700 hover:shadow-lg transition-all">+ Add Room</button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-6xl mx-auto space-y-8">
            
            {/* AHU Groups */}
            {Object.entries(roomsByAhu).map(([ahuId, groupRows]) => {
              const ahu = ahus.find(a => a.id === ahuId);
              return (
                <div key={ahuId} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  {/* Group Header */}
                  <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${ahu ? 'bg-blue-500' : 'bg-slate-300'}`}></div>
                      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
                        {ahu ? ahu.name : 'Unassigned Zones'}
                      </h3>
                    </div>
                    <span className="bg-white border border-slate-200 px-2 py-0.5 rounded text-xs font-bold text-slate-500">{groupRows.length} Rooms</span>
                  </div>

                  {/* Summary Table */}
                  <table className="w-full text-left">
                    <thead className="bg-white border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Room</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Class</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Area</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Airflow</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Load</th>
                        <th className="px-6 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {groupRows.map(row => (
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

            {rdsRows.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-3xl">📐</div>
                <p className="font-medium text-slate-600">No rooms yet</p>
                <p className="text-sm mt-1">Add a room to begin your RDS design.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Side Panel Overlay */}
      {selectedRoomId && selectedRoomData && (
        <>
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-slate-900/20 backdrop-blur-[2px] z-40 transition-opacity" 
            onClick={() => setSelectedRoomId(null)}
          ></div>
          
          <RoomDetailPanel 
            room={selectedRoomData._raw.room} 
            envelope={rawEnvelopes[selectedRoomId]} 
            ahus={ahus} 
            onClose={() => setSelectedRoomId(null)} 
          />
        </>
      )}

    </div>
  );
}