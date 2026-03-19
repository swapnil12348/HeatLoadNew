/**
 * TabNav.jsx
 * Responsibility: Application tab navigation bar.
 *
 * Lives inside AppLayout's fixed-height flex column as a sibling to <main>.
 * It never scrolls out of view — the fixed flex-column layout holds it in
 * place without needing sticky positioning.
 */

import { NavLink } from 'react-router-dom';

export default function TabNav() {
  const tabs = [
    { id: 'project',  label: 'Project Info',       path: '/project'  },
    
    { id: 'climate',  label: 'Climate',            path: '/climate'  },
    { id: 'rds',      label: 'RDS Input (Master)', path: '/rds'      },
    { id: 'room',     label: 'Room Geometry',      path: '/room'     },
    { id: 'envelope', label: 'Envelope & Loads',   path: '/envelope' },
    { id: 'ahu',      label: 'AHU Config',         path: '/ahu'      },
    { id: 'results',  label: 'Results',            path: '/results'  },
  ];

  return (
    // z-40 retained — keeps the nav above any absolutely-positioned room content.
    // sticky top-0 removed — TabNav is in AppLayout's fixed-height flex column
    // and never scrolls, so sticky has no effect here.
    <nav className="bg-white border-b border-gray-200 z-40 shadow-sm shrink-0">
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