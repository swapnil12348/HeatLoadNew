import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updateTuning, selectSystemResults } from '../features/results/resultsSlice';
import { selectActiveRoom } from '../features/room/roomSlice';
import ASHRAE from '../constants/ashrae';
import RoomSidebar from '../components/Layout/RoomSidebar';

// ── Components ─────────────────────────────────────────────────────────────
const TuningInput = ({ label, value, step, onChange }) => (
  <div className="flex flex-col">
    <label className="text-[10px] font-bold text-amber-600 uppercase tracking-wide mb-1.5 h-8 flex items-end">{label}</label>
    <input type="number" step={step} value={value} onChange={onChange}
      className="w-full p-2.5 text-sm border border-amber-200 rounded-lg bg-white focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition-shadow text-gray-900 font-medium"
    />
  </div>
);

const ResultRow = ({ label, value, colorClass = "text-gray-700", large = false }) => (
  <div className="flex justify-between items-center py-2.5 border-b border-gray-100 last:border-0">
    <span className="text-gray-500 text-xs font-medium">{label}</span>
    <span className={`font-mono font-bold ${colorClass} ${large ? 'text-lg' : 'text-sm'}`}>{value}</span>
  </div>
);

const ASHRAE_FORMULAS = [
  ["Envelope Sensible", "Q = U × A × CLTD"],
  ["Infiltration Sensible", "Qs = 1.08 × CFM × ΔDB"],
  ["Infiltration Latent", "Ql = 0.68 × CFM × ΔW"],
  ["Dehumidified Rise", "ΔT = (1 − BF) × (DB_room − ADP)"],
  ["Dehumidified CFM", "CFM = ERSH / (1.08 × ΔT)"],
  ["Tonnage", "TR = GTH / 12,000"],
  ["Lighting", "Q = W × 3.412"],
  ["Ventilation (62.1)", "Vbz = Rp × Pz + Ra × Az"],
];

// ── Main Page ──────────────────────────────────────────────────────────────
export default function ResultsPage() {
  const dispatch = useDispatch();
  const results = useSelector(selectSystemResults);
  const activeRoom = useSelector(selectActiveRoom);
  const { tuning } = results;

  const handleTuning = (field, value) => {
    dispatch(updateTuning({ field, value }));
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-50">
      
      {/* LEFT SIDEBAR */}
      <RoomSidebar />

      {/* MAIN CONTENT */}
      <div className="flex-1 max-w-7xl p-4 md:p-8 pb-32 space-y-8 overflow-y-auto h-screen">
        
        {/* Header */}
        <div className="flex justify-between items-end border-b border-gray-200 pb-4">
          <div>
            <h2 className="text-3xl font-bold text-gray-900">System Selection</h2>
            <p className="text-gray-500 mt-2">
              Results for: <span className="font-bold text-blue-800">{activeRoom?.name}</span>
            </p>
          </div>
          <div className="hidden md:block px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-widest rounded border border-blue-100">
            ASHRAE Design Mode
          </div>
        </div>

        {/* 1. Tuning Parameters */}
        <section className="bg-amber-50/50 border border-amber-200 rounded-xl p-6 shadow-sm">
          <div className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-4">Design Parameters (Tuning)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <TuningInput label={`Safety Factor (%)`} value={tuning.safetyFactor} step="1" onChange={(e) => handleTuning("safetyFactor", e.target.value)} />
            <TuningInput label="Coil Bypass Factor (0–1)" value={tuning.bypassFactor} step="0.01" onChange={(e) => handleTuning("bypassFactor", e.target.value)} />
            <TuningInput label="Apparatus Dew Point (°F)" value={tuning.adp} step="0.5" onChange={(e) => handleTuning("adp", e.target.value)} />
            <TuningInput label={`Fan Heat Gain (%)`} value={tuning.fanHeat} step="1" onChange={(e) => handleTuning("fanHeat", e.target.value)} />
          </div>
        </section>

        {/* 2. Detailed Results Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-blue-50 px-6 py-3 border-b border-blue-100 flex justify-between items-center">
              <h3 className="font-bold text-blue-800">Heat Load Summary</h3>
              <span className="text-xs text-blue-600 font-mono">BTU/hr</span>
            </div>
            <div className="p-6 pt-2">
              <ResultRow label="Effective Room Sensible Heat (ERSH)" value={results.ersh.toLocaleString()} colorClass="text-blue-600" />
              <ResultRow label="Effective Room Latent Heat (ERLH)" value={results.erlh.toLocaleString()} colorClass="text-purple-600" />
              <ResultRow label="ESHF" value={results.eshf} colorClass="text-gray-900" />
              <ResultRow label="Grand Total Heat (incl. fan heat)" value={results.grandTotal.toLocaleString()} colorClass="text-red-600" large />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-emerald-50 px-6 py-3 border-b border-emerald-100 flex justify-between items-center">
              <h3 className="font-bold text-emerald-800">Psychrometrics & Air Flow</h3>
              <span className="text-xs text-emerald-600 font-mono">ASHRAE 55</span>
            </div>
            <div className="p-6 pt-2">
              <ResultRow label="Room Design DB" value={`${results.designDB} °F`} />
              <ResultRow label="Apparatus Dew Point (ADP)" value={`${tuning.adp} °F`} />
              <ResultRow label="Dehumidified Rise (ΔT)" value={`${results.rise} °F`} />
              <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex justify-between items-center">
                <span className="text-xs font-bold text-emerald-800 uppercase">Dehumidified CFM</span>
                <span className="text-xl font-mono font-bold text-emerald-700">{results.dehCFM.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Hero Banner */}
        <div className="bg-gradient-to-br from-blue-900 to-blue-700 rounded-2xl p-8 text-white shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <svg className="w-32 h-32" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14a6 6 0 110-12 6 6 0 010 12z"/></svg>
          </div>
          <div className="relative z-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
              <div>
                <h3 className="text-2xl font-bold">Recommended System Capacity</h3>
                <p className="text-blue-200 text-sm mt-1">Based on Peak Summer Load + {tuning.safetyFactor}% Safety Factor</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-6 py-4 text-center min-w-[180px]">
                <div className="text-[10px] uppercase tracking-widest text-blue-200 font-bold mb-1">Total Tonnage</div>
                <div className="text-5xl font-black tracking-tight">{results.tonnage}</div>
                <div className="text-xs text-blue-200 mt-1">TR (Tons of Refrigeration)</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-0 md:gap-8 border-t border-white/20 pt-6">
              <div className="text-center md:text-left">
                <div className="text-[10px] uppercase tracking-wider text-blue-300 font-bold">Supply Air</div>
                <div className="text-2xl font-bold mt-1">{results.supplyAir.toLocaleString()} <span className="text-sm font-normal text-blue-300">CFM</span></div>
              </div>
              <div className="text-center md:text-left mt-4 md:mt-0 md:border-l md:border-white/20 md:pl-8">
                <div className="text-[10px] uppercase tracking-wider text-blue-300 font-bold">Fresh Air (62.1)</div>
                <div className="text-2xl font-bold mt-1">{results.freshAir.toLocaleString()} <span className="text-sm font-normal text-blue-300">CFM</span></div>
              </div>
              <div className="text-center md:text-left mt-4 md:mt-0 md:border-l md:border-white/20 md:pl-8">
                <div className="text-[10px] uppercase tracking-wider text-blue-300 font-bold">Total Heat</div>
                <div className="text-2xl font-bold mt-1">{results.grandTotal.toLocaleString()} <span className="text-sm font-normal text-blue-300">BTU/hr</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}