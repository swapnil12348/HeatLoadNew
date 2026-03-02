import React from 'react';
import { useSelector } from 'react-redux';
import { selectRdsData } from '../features/results/rdsSelector';

// Helper for table headers to keep code clean
const Th = ({ children, rowSpan = 1, colSpan = 1, className = "" }) => (
  <th 
    rowSpan={rowSpan} 
    colSpan={colSpan} 
    className={`px-3 py-2 border border-gray-300 bg-blue-50 text-blue-900 text-xs font-bold uppercase text-center ${className}`}
  >
    {children}
  </th>
);

const Td = ({ children, className = "" }) => (
  <td className={`px-3 py-2 border border-gray-200 text-xs text-center text-gray-700 font-medium ${className}`}>
    {children}
  </td>
);

export default function RDSPage() {
  const rows = useSelector(selectRdsData);

  // Calculate Project Totals
  const totalTonnage = rows.reduce((acc, r) => acc + parseFloat(r.tonnage), 0);
  const totalSupply = rows.reduce((acc, r) => acc + r.supplyCFM, 0);
  const totalFresh = rows.reduce((acc, r) => acc + r.freshAirCFM, 0);

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] bg-gray-50">
      
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Room Data Sheet (RDS)</h2>
          <p className="text-sm text-gray-500">Comprehensive project summary and load distribution.</p>
        </div>
        <div className="flex gap-4 text-right">
          <div>
            <div className="text-[10px] text-gray-400 uppercase font-bold">Total Tonnage</div>
            <div className="text-xl font-bold text-blue-600">{totalTonnage.toFixed(2)} TR</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase font-bold">Total Supply Air</div>
            <div className="text-xl font-bold text-green-600">{totalSupply.toLocaleString()} CFM</div>
          </div>
        </div>
      </div>

      {/* Scrollable Table Area */}
      <div className="flex-1 overflow-auto p-4">
        <div className="inline-block min-w-full align-middle border border-gray-300 shadow-sm rounded-lg overflow-hidden bg-white">
          <table className="min-w-full divide-y divide-gray-300">
            <thead>
              {/* Header Row 1: Groups */}
              <tr>
                <Th rowSpan={2} className="bg-gray-100">#</Th>
                <Th colSpan={2} className="bg-blue-100">System Info</Th>
                <Th colSpan={5} className="bg-indigo-100">Room Geometry</Th>
                <Th colSpan={3} className="bg-amber-100">Design Conditions</Th>
                <Th colSpan={3} className="bg-purple-100">Internal Loads</Th>
                <Th colSpan={4} className="bg-red-100">Heat Load (BTU/hr)</Th>
                <Th colSpan={3} className="bg-emerald-100">Air Flow (CFM)</Th>
              </tr>
              {/* Header Row 2: Columns */}
              <tr>
                {/* System */}
                <Th>AHU No.</Th>
                <Th>Type</Th>
                
                {/* Geometry */}
                <Th>Room Name</Th>
                <Th>L (ft)</Th>
                <Th>W (ft)</Th>
                <Th>H (ft)</Th>
                <Th>Area (ft²)</Th>
                
                {/* Conditions */}
                <Th>DB (°F)</Th>
                <Th>RH (%)</Th>
                <Th>Pressure</Th>
                
                {/* Internals */}
                <Th>People</Th>
                <Th>Equip (kW)</Th>
                <Th>Light (W/ft²)</Th>
                
                {/* Heat Load */}
                <Th>Sensible</Th>
                <Th>Latent</Th>
                <Th>Total</Th>
                <Th>TR</Th>
                
                {/* Airflow */}
                <Th>Supply</Th>
                <Th>Fresh Air</Th>
                <Th>ACPH</Th>
              </tr>
            </thead>
            
            <tbody className="divide-y divide-gray-200 bg-white">
              {rows.map((row, index) => (
                <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                  <Td className="font-bold text-gray-400">{index + 1}</Td>
                  
                  {/* System */}
                  <Td className="font-bold text-blue-700">{row.ahuName}</Td>
                  <Td className="text-[10px] text-gray-500 max-w-[100px] truncate">{row.unitType}</Td>
                  
                  {/* Geometry */}
                  <Td className="text-left font-semibold">{row.roomName}</Td>
                  <Td>{row.length}</Td>
                  <Td>{row.width}</Td>
                  <Td>{row.height}</Td>
                  <Td className="bg-gray-50 font-mono">{row.area}</Td>
                  
                  {/* Conditions */}
                  <Td>{row.temp}</Td>
                  <Td>{row.rh}</Td>
                  <Td>{row.pressure} Pa</Td>
                  
                  {/* Internals */}
                  <Td>{row.occupancy}</Td>
                  <Td>{row.equipmentKW}</Td>
                  <Td>{row.lightingW}</Td>
                  
                  {/* Loads */}
                  <Td className="text-right font-mono text-amber-700">{row.rsh.toLocaleString()}</Td>
                  <Td className="text-right font-mono text-purple-700">{row.rlh.toLocaleString()}</Td>
                  <Td className="text-right font-mono font-bold">{row.totalHeat.toLocaleString()}</Td>
                  <Td className="bg-red-50 text-red-700 font-bold">{row.tonnage}</Td>
                  
                  {/* Airflow */}
                  <Td className="bg-green-50 text-green-800 font-bold">{row.supplyCFM.toLocaleString()}</Td>
                  <Td>{row.freshAirCFM.toLocaleString()}</Td>
                  <Td className="text-gray-500">{row.acph}</Td>
                </tr>
              ))}
              
              {rows.length === 0 && (
                <tr>
                  <td colSpan={20} className="p-8 text-center text-gray-400">
                    No rooms configured. Go to the "Room" tab to add data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}