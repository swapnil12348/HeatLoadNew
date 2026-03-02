import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Layout Components (Now in components/Layout)
import Header from './components/Layout/Header';
import TabNav from './components/Layout/TabNav';

// Page Components (Now in pages/)
import ProjectDetails from './pages/ProjectDetails'; // Was ProjectInfo
import AHUConfig from './pages/AHUConfig';           // Was AHUSelection
import RoomConfig from './pages/RoomConfig';         // Was RoomData
import ClimateConfig from './pages/ClimateConfig';
import EnvelopeConfig from './pages/EnvelopeConfig';
import ResultsPage from './pages/ResultsPage';
// Placeholder Pages (You will create these next)
// For now, I'll comment them out or map them to a temporary placeholder so the app doesn't crash
// import ClimateConfig from './pages/ClimateConfig'; 
// import EnvelopeConfig from './pages/EnvelopeConfig'; 
// import ResultsPage from './pages/ResultsPage';

const Placeholder = ({ title }) => (
  <div className="p-10 text-center text-gray-500 border-2 border-dashed border-gray-300 rounded-lg">
    <h2 className="text-xl font-bold">{title}</h2>
    <p>This page is under construction during migration.</p>
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">

        {/* Top Header */}
        <Header />

        {/* Navigation Tabs */}
        <TabNav />

        {/* Main Content Area */}
        <main className="container mx-auto px-4 py-6">
          <Routes>
            {/* Redirect root to Project Details */}
            <Route path="/" element={<Navigate to="/project" replace />} />

            {/* Core Pages */}
            <Route path="/project" element={<ProjectDetails />} />
            <Route path="/ahu" element={<AHUConfig />} />
            <Route path="/room" element={<RoomConfig />} />

            <Route path="/climate" element={<ClimateConfig />} />
            <Route path="/envelope" element={<EnvelopeConfig />} />
            <Route path="/results" element={<ResultsPage />} />

            {/* Catch-all */}
            <Route path="*" element={<div className="p-10 text-center">Page Not Found</div>} />
          </Routes>
        </main>

      </div>
    </BrowserRouter>
  );
}

export default App;