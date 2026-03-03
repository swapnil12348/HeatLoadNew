import React from 'react';
import { useSelector } from 'react-redux';
import { selectAllAHUs } from '../features/ahu/ahuSlice';
import { selectRdsData } from '../features/results/rdsSelector';

export default function ResultsPage() {
  // 1. Get Calculated Data
  const rdsRows = useSelector(selectRdsData);
  const ahus = useSelector(selectAllAHUs);

  // 2. Calculate Project Totals
  const totalArea = rdsRows.reduce((sum, r) => sum + (parseFloat(r.floorArea) || 0), 0);
  
  // Note: coolingCapTR comes as a string "5.23" from selector, so we parse it
  const totalTR = rdsRows.reduce((sum, r) => sum + (parseFloat(r.coolingCapTR) || 0), 0);
  const totalCFM = rdsRows.reduce((sum, r) => sum + (parseFloat(r.supplyAir) || 0), 0);

  // 3. Calculate Check Figures (KPIs)
  const sqftPerTR = totalTR > 0 ? (totalArea / totalTR).toFixed(0) : 0;
  const cfmPerSqft = totalArea > 0 ? (totalCFM / totalArea).toFixed(2) : 0;

  // 4. Group Data by AHU for the System Breakdown
  const systemSummary = ahus.map(ahu => {
    const assignedRooms = rdsRows.filter(r => r.ahuId === ahu.id);
    const ahuTR = assignedRooms.reduce((sum, r) => sum + (parseFloat(r.coolingCapTR) || 0), 0);
    const ahuCFM = assignedRooms.reduce((sum, r) => sum + (parseFloat(r.supplyAir) || 0), 0);
    
    return {
      ...ahu,
      roomCount: assignedRooms.length,
      totalTR: ahuTR,
      totalCFM: ahuCFM,
      // Calculate % contribution to total project load
      loadPct: totalTR > 0 ? (ahuTR / totalTR) * 100 : 0
    };
  });

  // Handle Unassigned Rooms
  const unassignedRooms = rdsRows.filter(r => !r.ahuId);
  if (unassignedRooms.length > 0) {
    const unassignedTR = unassignedRooms.reduce((sum, r) => sum + (parseFloat(r.coolingCapTR) || 0), 0);
    const unassignedCFM = unassignedRooms.reduce((sum, r) => sum + (parseFloat(r.supplyAir) || 0), 0);
    systemSummary.push({
      id: 'unassigned',
      name: 'Unassigned Zones',
      type: 'N/A',
      roomCount: unassignedRooms.length,
      totalTR: unassignedTR,
      totalCFM: unassignedCFM,
      loadPct: totalTR > 0 ? (unassignedTR / totalTR) * 100 : 0
    });
  }

  const handleExport = () => {
    const dataStr = JSON.stringify({ project: 'HVAC Design', totals: { totalTR, totalCFM }, rooms: rdsRows }, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = "project_calculations.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex justify-between items-end border-b border-slate-200 pb-5">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Project Dashboard</h1>
            <p className="text-slate-500 mt-1">Executive summary of HVAC calculations and system loads.</p>
          </div>
          <button 
            onClick={handleExport}
            className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-slate-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Export JSON
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">Total Cooling</div>
            <div className="text-3xl font-bold text-blue-600 mt-2">{totalTR.toFixed(1)} <span className="text-sm text-slate-400 font-normal">TR</span></div>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">Total Airflow</div>
            <div className="text-3xl font-bold text-slate-700 mt-2">{totalCFM.toLocaleString()} <span className="text-sm text-slate-400 font-normal">CFM</span></div>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">Total Area</div>
            <div className="text-3xl font-bold text-slate-700 mt-2">{totalArea.toLocaleString()} <span className="text-sm text-slate-400 font-normal">ft²</span></div>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">Check Figure</div>
            <div className="text-3xl font-bold text-emerald-600 mt-2">{sqftPerTR} <span className="text-sm text-slate-400 font-normal">ft²/TR</span></div>
          </div>
        </div>

        {/* System Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left: Detailed Metrics */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
                <h3 className="text-sm font-bold text-slate-800">System Load Distribution</h3>
              </div>
              <table className="w-full text-left">
                <thead className="bg-white border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase">System Name</th>
                    <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">Load (TR)</th>
                    <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">Airflow (CFM)</th>
                    <th className="px-6 py-3 text-xs font-bold text-slate-400 uppercase w-32">% of Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 text-sm">
                  {systemSummary.map(sys => (
                    <tr key={sys.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-700">{sys.name}</div>
                        <div className="text-xs text-slate-400">{sys.type} • {sys.roomCount} Rooms</div>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-blue-600 font-bold">
                        {sys.totalTR.toFixed(1)}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-slate-600">
                        {sys.totalCFM.toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-blue-500 rounded-full" 
                              style={{ width: `${sys.loadPct}%` }}
                            ></div>
                          </div>
                          <span className="text-xs font-bold text-slate-500 w-8 text-right">{Math.round(sys.loadPct)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {systemSummary.length === 0 && (
                     <tr>
                        <td colSpan="4" className="px-6 py-8 text-center text-slate-400">
                           No systems configured.
                        </td>
                     </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: Project Statistics */}
          <div className="space-y-6">
             {/* General Stats */}
             <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h3 className="text-sm font-bold text-slate-800 mb-4 uppercase">Design Parameters</h3>
                <ul className="space-y-3 text-sm">
                   <li className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-500">Total Zones</span>
                      <span className="font-bold text-slate-700">{rdsRows.length}</span>
                   </li>
                   <li className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-500">Air Density Factor</span>
                      <span className="font-bold text-slate-700">1.08</span>
                   </li>
                   <li className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-500">Avg CFM / SqFt</span>
                      <span className="font-bold text-slate-700">{cfmPerSqft}</span>
                   </li>
                </ul>
             </div>

             {/* Quick Tip */}
             <div className="bg-blue-50 rounded-xl border border-blue-100 p-6">
                <div className="flex items-start gap-3">
                   <div className="text-2xl">💡</div>
                   <div>
                      <h4 className="text-sm font-bold text-blue-900">Optimization Tip</h4>
                      <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                         Your average check figure is <b>{sqftPerTR} ft²/TR</b>. 
                         {sqftPerTR < 300 
                           ? " This indicates a high cooling load. Check envelope insulation or internal equipment loads." 
                           : " This is within a standard efficiency range for commercial spaces."}
                      </p>
                   </div>
                </div>
             </div>

          </div>

        </div>
      </div>
    </div>
  );
}