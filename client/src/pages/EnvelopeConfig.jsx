import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { 
  addDoor, updateDoor, removeDoor, 
  addElementRow, updateElementRow, deleteElementRow, 
  updateInternalLoad,
  initializeRoom,
  selectActiveRoomEnvelope,
  selectActiveRoomHeatGain
} from '../features/envelope/envelopeSlice';
import { selectActiveRoomId, selectActiveRoom } from '../features/room/roomSlice';
import RoomSidebar from '../components/Layout/RoomSidebar';

// ── Reusable UI Components ──────────────────────────────────────────────────
const SectionHeader = ({ title, subtitle, rightElement }) => (
  <div className="flex justify-between items-end border-b border-gray-200 pb-2 mb-4">
    <div>
      <h3 className="text-lg font-bold text-blue-900">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
    </div>
    {rightElement}
  </div>
);

const Input = ({ value, onChange, className = "", step = "1", type="number" }) => (
  <input
    type={type}
    step={step}
    value={value}
    onChange={onChange}
    className={`w-full p-1.5 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none transition-all ${className}`}
  />
);

const TableHeader = ({ children, className = "" }) => (
  <th className={`px-2 py-2 text-xs font-bold text-gray-600 uppercase bg-gray-50 border-b border-gray-200 ${className}`}>
    {children}
  </th>
);

// ── Row Component ───────────────────────────────────────────────────────────
const EnvelopeRow = ({ item, category, roomId, dispatch }) => {
  const handleChange = (field, value) => {
    dispatch(updateElementRow({ roomId, category, id: item.id, field, value }));
  };

  const handleDiffChange = (season, value) => {
    dispatch(updateElementRow({ 
      roomId, category, id: item.id, field: 'diff', 
      value: { [season]: parseFloat(value) || 0 } 
    }));
  };

  const q = (season) => Math.round((item.area || 0) * (item.diff?.[season] || 0) * (item.uValue || 0)).toLocaleString();

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="p-2 text-sm font-semibold text-gray-700 flex justify-between items-center">
        {item.label}
        <button 
          onClick={() => dispatch(deleteElementRow({ roomId, category, id: item.id }))}
          className="text-red-400 hover:text-red-600 text-lg font-bold px-2"
        >
          ×
        </button>
      </td>
      <td className="p-2"><Input value={item.area} onChange={(e) => handleChange('area', e.target.value)} /></td>
      {['summer', 'monsoon', 'winter'].map(s => (
        <td key={s} className="p-2 bg-amber-50">
          <Input className="bg-amber-50" value={item.diff?.[s] || 0} onChange={(e) => handleDiffChange(s, e.target.value)} />
        </td>
      ))}
      <td className="p-2"><Input step="0.01" value={item.uValue} onChange={(e) => handleChange('uValue', e.target.value)} /></td>
      {['summer', 'monsoon', 'winter'].map(s => (
        <td key={s} className="p-2 text-right font-mono text-blue-700 bg-blue-50/50 text-sm">
          {q(s)}
        </td>
      ))}
    </tr>
  );
};

// ── Main Page ───────────────────────────────────────────────────────────────
export default function EnvelopeConfig() {
  const dispatch = useDispatch();
  
  // 1. Get Active Room Context
  const activeRoomId = useSelector(selectActiveRoomId);
  const activeRoom = useSelector(selectActiveRoom);
  
  // 2. Get Data specifically for this room
  const envelope = useSelector(selectActiveRoomEnvelope);
  const { totals: gainTotals, details: gainDetails } = useSelector(selectActiveRoomHeatGain);

  // Destructure for easier usage
  const { elements, internalLoads, infiltration } = envelope;
  const doors = infiltration?.doors || [];

  // Ensure room exists in envelope store on mount/change
  useEffect(() => {
    if(activeRoomId) dispatch(initializeRoom(activeRoomId));
  }, [activeRoomId, dispatch]);

  // ── Handlers (Now including roomId) ──
  const handleAddRow = (category, label) => {
    const uDefaults = { glass: 0.8, walls: 0.3, roof: 0.2, ceiling: 0.1, floor: 0.1 };
    dispatch(addElementRow({
      roomId: activeRoomId,
      category,
      newItem: {
        id: Date.now(),
        label: label,
        area: 0,
        uValue: uDefaults[category] || 0.5,
        diff: { summer: 0, monsoon: 0, winter: 0 }
      }
    }));
  };

  const handleInternalUpdate = (type, field, value) => {
    dispatch(updateInternalLoad({ 
      roomId: activeRoomId, 
      type, 
      data: { [field]: parseFloat(value) || 0 } 
    }));
  };

  const totalInfil = doors.reduce((sum, d) => sum + (parseFloat(d.infilCFM) || 0), 0);
  const totalExfil = doors.reduce((sum, d) => sum + (parseFloat(d.exfilCFM) || 0), 0);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-50">
      
      {/* LEFT SIDEBAR */}
      <RoomSidebar />

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 max-w-7xl p-4 md:p-8 pb-32 space-y-12 overflow-y-auto h-screen">
        
        {/* Page Title */}
        <div>
          <h2 className="text-3xl font-bold text-gray-900">{activeRoom?.name}</h2>
          <p className="text-gray-500 text-sm">Managing Envelope & Loads for this zone.</p>
        </div>

        {/* ── SECTION 1: HEAT GAIN / LOSS ──────────────────────────────────── */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-6">
            <SectionHeader 
              title="1. Envelope Heat Gain" 
              subtitle="Sensible Heat Calculation (Q = U × A × CLTD)"
              rightElement={
                <div className="flex gap-2">
                  {[{ key: 'glass', label: '+ Glass', bg: 'bg-blue-50', text: 'text-blue-700' },
                    { key: 'walls', label: '+ Wall', bg: 'bg-green-50', text: 'text-green-700' },
                    { key: 'roof', label: '+ Roof', bg: 'bg-orange-50', text: 'text-orange-700' }
                  ].map(btn => (
                    <button key={btn.key} onClick={() => handleAddRow(btn.key, `New ${btn.key}`)}
                      className={`${btn.bg} ${btn.text} px-3 py-1.5 rounded text-xs font-bold hover:opacity-80 transition`}>
                      {btn.label}
                    </button>
                  ))}
                </div>
              }
            />

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <TableHeader className="w-48">Element</TableHeader>
                    <TableHeader>Area (ft²)</TableHeader>
                    <TableHeader className="bg-amber-100 text-amber-800 border-amber-200" colSpan={3}>CLTD / ETD Difference (°F)</TableHeader>
                    <TableHeader>U-Value</TableHeader>
                    <TableHeader className="bg-blue-100 text-blue-800 border-blue-200" colSpan={3}>Heat Gain (BTU/hr)</TableHeader>
                  </tr>
                  <tr>
                    <th colSpan={2}></th>
                    {['Smr', 'Mon', 'Wtr'].map(s => <th key={s} className="px-2 py-1 text-[10px] text-center bg-amber-50 uppercase text-amber-700">{s}</th>)}
                    <th></th>
                    {['Smr', 'Mon', 'Wtr'].map(s => <th key={s} className="px-2 py-1 text-[10px] text-center bg-blue-50 uppercase text-blue-700">{s}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(elements).map(cat => 
                    elements[cat].map(item => (
                      <EnvelopeRow key={item.id} item={item} category={cat} roomId={activeRoomId} dispatch={dispatch} />
                    ))
                  )}
                  {Object.values(elements).every(arr => arr.length === 0) && (
                    <tr><td colSpan={9} className="p-8 text-center text-gray-400 text-sm">No envelope elements added.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Internal Loads Sub-section */}
          <div className="bg-gray-50 p-6 border-t border-gray-200">
             <h4 className="text-sm font-bold text-gray-700 mb-4 uppercase tracking-wider">Internal Loads</h4>
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
               <table className="w-full text-sm">
                 <thead><tr><th className="text-left pb-2 text-xs text-gray-500">Source</th><th className="text-center pb-2 text-xs text-gray-500">Qty / Rating</th><th className="text-center pb-2 text-xs text-gray-500">Sensible</th><th className="text-center pb-2 text-xs text-gray-500">Latent</th></tr></thead>
                 <tbody className="divide-y divide-gray-200">
                   <tr>
                     <td className="py-2 font-medium">People</td>
                     <td className="p-1"><div className="flex items-center gap-1"><Input value={internalLoads.people.count} onChange={(e) => handleInternalUpdate('people', 'count', e.target.value)} /><span className="text-xs text-gray-400">no.</span></div></td>
                     <td className="p-1"><Input value={internalLoads.people.sensiblePerPerson} onChange={(e) => handleInternalUpdate('people', 'sensiblePerPerson', e.target.value)} /></td>
                     <td className="p-1"><Input value={internalLoads.people.latentPerPerson} onChange={(e) => handleInternalUpdate('people', 'latentPerPerson', e.target.value)} /></td>
                   </tr>
                   <tr>
                     <td className="py-2 font-medium">Lighting</td>
                     <td className="p-1"><div className="flex items-center gap-1"><Input step="0.1" value={internalLoads.lights.wattsPerSqFt} onChange={(e) => handleInternalUpdate('lights', 'wattsPerSqFt', e.target.value)} /><span className="text-xs text-gray-400">W/ft²</span></div></td>
                     <td colSpan={2} className="text-center text-xs text-gray-400">Calculated via Floor Area</td>
                   </tr>
                   <tr>
                     <td className="py-2 font-medium">Equipment</td>
                     <td className="p-1"><div className="flex items-center gap-1"><Input step="0.1" value={internalLoads.equipment.kw} onChange={(e) => handleInternalUpdate('equipment', 'kw', e.target.value)} /><span className="text-xs text-gray-400">kW</span></div></td>
                     <td colSpan={2} className="text-center text-xs text-gray-400">x 3412 BTU/kW</td>
                   </tr>
                 </tbody>
               </table>

               <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                 <div className="grid grid-cols-2 gap-4 text-right">
                   <div><div className="text-xs text-gray-500">People Sensible</div><div className="font-mono font-bold text-blue-700">{gainDetails.pplSens.toLocaleString()}</div></div>
                   <div><div className="text-xs text-gray-500">People Latent</div><div className="font-mono font-bold text-purple-700">{gainDetails.pplLat.toLocaleString()}</div></div>
                   <div><div className="text-xs text-gray-500">Lighting Load</div><div className="font-mono font-bold text-blue-700">{gainDetails.lightsBtu.toLocaleString()}</div></div>
                   <div><div className="text-xs text-gray-500">Equipment Load</div><div className="font-mono font-bold text-blue-700">{gainDetails.equipBtu.toLocaleString()}</div></div>
                 </div>
                 <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-2 text-center">
                   {['Summer', 'Monsoon', 'Winter'].map(s => (
                     <div key={s} className="bg-blue-50 rounded p-2">
                        <div className="text-[10px] uppercase font-bold text-blue-400">{s} RSH</div>
                        <div className="font-bold text-blue-900 text-lg">{gainTotals[s.toLowerCase()].toLocaleString()}</div>
                     </div>
                   ))}
                 </div>
               </div>
             </div>
          </div>
        </section>

        {/* ── SECTION 2: INFILTRATION ──────────────────────────────────────── */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-6">
            <SectionHeader 
              title="2. Infiltration & Leakage" 
              subtitle="Enter leakage paths (Doors, Cracks) to determine standard CFM loss."
              rightElement={
                <button onClick={() => dispatch(addDoor({ roomId: activeRoomId }))}
                  className="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-700 transition">
                  + Add Opening
                </button>
              }
            />
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <TableHeader>Type</TableHeader><TableHeader>Qty</TableHeader><TableHeader>Area (ft²)</TableHeader>
                    <TableHeader>W (ft)</TableHeader><TableHeader>H (ft)</TableHeader>
                    <TableHeader className="bg-emerald-50 text-emerald-800">Infil CFM</TableHeader>
                    <TableHeader className="bg-red-50 text-red-800">Exfil CFM</TableHeader><TableHeader className="w-10"></TableHeader>
                  </tr>
                </thead>
                <tbody>
                  {doors.map(door => (
                    <tr key={door.id} className="border-b border-gray-100">
                      <td className="p-2">
                        <select value={door.thru} onChange={(e) => dispatch(updateDoor({ roomId: activeRoomId, id: door.id, field: 'thru', value: e.target.value }))}
                          className="bg-white border border-gray-300 rounded p-1 text-sm w-full"><option>Door</option><option>Window</option><option>Crack/Gap</option></select>
                      </td>
                      <td className="p-2"><Input value={door.nos} onChange={(e) => dispatch(updateDoor({ roomId: activeRoomId, id: door.id, field: 'nos', value: e.target.value }))} /></td>
                      <td className="p-2 bg-gray-50"><Input value={door.area} onChange={(e) => dispatch(updateDoor({ roomId: activeRoomId, id: door.id, field: 'area', value: e.target.value }))} /></td>
                      <td className="p-2 bg-gray-50"><Input value={door.width} onChange={(e) => dispatch(updateDoor({ roomId: activeRoomId, id: door.id, field: 'width', value: e.target.value }))} /></td>
                      <td className="p-2 bg-gray-50"><Input value={door.height} onChange={(e) => dispatch(updateDoor({ roomId: activeRoomId, id: door.id, field: 'height', value: e.target.value }))} /></td>
                      <td className="p-2 bg-emerald-50"><Input className="font-bold text-emerald-700" value={door.infilCFM} onChange={(e) => dispatch(updateDoor({ roomId: activeRoomId, id: door.id, field: 'infilCFM', value: e.target.value }))} /></td>
                      <td className="p-2 bg-red-50"><Input className="font-bold text-red-700" value={door.exfilCFM} onChange={(e) => dispatch(updateDoor({ roomId: activeRoomId, id: door.id, field: 'exfilCFM', value: e.target.value }))} /></td>
                      <td className="p-2 text-center"><button onClick={() => dispatch(removeDoor({ roomId: activeRoomId, id: door.id }))} className="text-gray-400 hover:text-red-500 font-bold text-xl">×</button></td>
                    </tr>
                  ))}
                  {doors.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-400 text-sm">No openings added.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex justify-end gap-8 border-t border-gray-100 pt-4">
              <div className="text-right"><div className="text-[10px] uppercase font-bold text-gray-500">Total Infiltration</div><div className="text-2xl font-extrabold text-emerald-600">{totalInfil.toFixed(1)} <span className="text-sm font-normal text-gray-400">CFM</span></div></div>
              <div className="text-right"><div className="text-[10px] uppercase font-bold text-gray-500">Total Exfiltration</div><div className="text-2xl font-extrabold text-red-600">{totalExfil.toFixed(1)} <span className="text-sm font-normal text-gray-400">CFM</span></div></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}