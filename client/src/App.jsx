import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';

// Layout Components
import Header from './components/Layout/Header';
import TabNav from './components/Layout/TabNav';

// Page Components
import Home from './pages/Home'; // Import your new Home page
import ProjectDetails from './pages/ProjectDetails';
import AHUConfig from './pages/AHUConfig';
import RoomConfig from './pages/RoomConfig';
import ClimateConfig from './pages/ClimateConfig';
import EnvelopeConfig from './pages/EnvelopeConfig';
import ResultsPage from './pages/ResultsPage';

// ── Layout Wrapper ─────────────────────────────────────────────────────────
// This component wraps the "Internal" pages so they get the Header and Tabs.
// The Home page will NOT use this, so it stays clean.
const AppLayout = () => (
  <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
    <Header />
    <TabNav />
    <main className="container mx-auto px-4 py-6">
      <Outlet /> {/* This is where the child routes (Project, AHU, etc) render */}
    </main>
  </div>
);

// ── Main App ───────────────────────────────────────────────────────────────
function App() {
  return (
    <BrowserRouter>
      <Routes>
        
        {/* 1. Public Landing Page (No Header/Nav) */}
        <Route path="/" element={<Home />} />

        {/* 2. Application Routes (Wrapped in AppLayout) */}
        <Route element={<AppLayout />}>
          <Route path="/project" element={<ProjectDetails />} />
          <Route path="/ahu" element={<AHUConfig />} />
          <Route path="/room" element={<RoomConfig />} />
          <Route path="/climate" element={<ClimateConfig />} />
          <Route path="/envelope" element={<EnvelopeConfig />} />
          <Route path="/results" element={<ResultsPage />} />
        </Route>

        {/* 3. Catch-all: Redirect to Home */}
        <Route path="*" element={<Navigate to="/" replace />} />
        
      </Routes>
    </BrowserRouter>
  );
}

export default App;