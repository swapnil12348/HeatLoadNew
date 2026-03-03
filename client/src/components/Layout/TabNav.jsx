import React from 'react';
import { NavLink } from 'react-router-dom';

export default function TabNav() {
  const tabs = [
    // 1. RDS is now the FIRST tab as requested
    
    
    // 2. Project & Climate follow
    { id: 'project', label: 'Project Info', path: '/project' },
    { id: 'rds', label: 'RDS Input (Master)', path: '/rds' },
    { id: 'climate', label: 'Climate', path: '/climate' },
    
    // 3. Detailed Configs
    { id: 'room', label: 'Room Geometry', path: '/room' },
    { id: 'envelope', label: 'Envelope & Loads', path: '/envelope' },
    { id: 'ahu', label: 'AHU Config', path: '/ahu' },
    
    // 4. Output
    { id: 'results', label: 'Results', path: '/results' },
  ];

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex space-x-1 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => (
            <NavLink
              key={tab.id}
              to={tab.path}
              className={({ isActive }) =>
                `px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  isActive
                    ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}