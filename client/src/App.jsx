import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';

// Layout Components
import Header from './components/Layout/Header';
import TabNav  from './components/Layout/TabNav';

// Page Components
import Home           from './pages/Home';
import ProjectDetails from './pages/ProjectDetails';
import AHUConfig      from './pages/AHUConfig';
import RDSPage        from './pages/RDSPage';
import RoomConfig     from './pages/RoomConfig';
import ClimateConfig  from './pages/ClimateConfig';
import EnvelopeConfig from './pages/EnvelopeConfig';
import ResultsPage    from './pages/ResultsPage';

// ── AppLayout ──────────────────────────────────────────────────────────────
//
// CHANGELOG
//
//   v2.0 — Fixed full-height layout overflow (was: min-h-screen + py-6 padding).
//
//     The previous layout used min-h-screen on the outer div and py-6 padding
//     on <main>. Pages needing full-height layouts subtracted only the header
//     height (64px) from 100vh, ignoring:
//       - TabNav height  (~44px)
//       - main py-6      (24px top padding)
//     This caused those pages to overflow by ~68px, breaking sticky sidebars
//     and internal scroll areas.
//
//     Fix: outer wrapper is h-screen (fixed height, not min-h-screen).
//     Header and TabNav shrink to natural content height. <main> takes flex-1
//     and overflow-hidden — fills exactly the remaining viewport height
//     regardless of what Header/TabNav actually measure.
//
//     Pages needing full-height internal scroll (AHU, Envelope, RDS, Room)
//     use h-full and manage their own internal overflow.
//     Naturally-scrolling pages (Project, Climate, Results) work unchanged —
//     overflow-auto on <main> lets them scroll within the flex-1 container.
//
const AppLayout = () => (
  <div className="h-screen flex flex-col bg-gray-50 text-gray-900 font-sans overflow-hidden">

    {/* Header — fixed content height, does not scroll */}
    <Header />

    {/* TabNav — fixed content height, does not scroll */}
    <TabNav />

    {/* Main content area — takes ALL remaining height exactly.
        overflow-auto: scrolling pages (Project, Climate, Results) work normally.
        Full-height pages (AHU, Envelope, RDS, Room) should use h-full
        and manage their own internal overflow. */}
    <main className="flex-1 overflow-auto min-h-0">
      <Outlet />
    </main>

  </div>
);

// ── Main App ───────────────────────────────────────────────────────────────
function App() {
  return (
    <BrowserRouter>
      <Routes>

        {/* 1. Public landing page — no header/nav */}
        <Route path="/" element={<Home />} />

        {/* 2. Application routes — wrapped in AppLayout */}
        <Route element={<AppLayout />}>
          <Route path="/project"  element={<ProjectDetails />} />
          <Route path="/ahu"      element={<AHUConfig />}      />
          <Route path="/room"     element={<RoomConfig />}     />
          <Route path="/climate"  element={<ClimateConfig />}  />
          <Route path="/envelope" element={<EnvelopeConfig />} />
          <Route path="/results"  element={<ResultsPage />}    />
          <Route path="/rds"      element={<RDSPage />}        />
        </Route>

        {/* 3. Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;