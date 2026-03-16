/**
 * Home.jsx
 * Responsibility: Public landing page — no header/nav wrapper.
 *
 * Standalone full-screen page outside AppLayout.
 * Routes to /project on "Get Started".
 */

import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4 font-sans">
      <div className="max-w-3xl w-full bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row">

        {/* Left Side: Visual/Context */}
        <div className="bg-blue-600 p-8 md:p-12 text-white flex flex-col justify-center md:w-2/5">
          <h2 className="text-3xl font-bold mb-4">HVAC Project</h2>
          <p className="text-blue-100 mb-6">
            Compliant with ASHRAE Fundamentals. Calculate envelope loads, infiltration, and psychrometrics efficiently.
          </p>
          <div className="text-sm font-mono bg-blue-700/50 p-3 rounded border border-blue-500/30">
            System: Multi-Zone<br/>
            Method: CLTD/CLF
          </div>
        </div>

        {/* Right Side: Action */}
        <div className="p-8 md:p-12 flex-1 flex flex-col justify-center items-start">
          <h1 className="text-4xl font-extrabold text-slate-900 mb-2">
            Load Calculator
          </h1>
          <p className="text-slate-500 mb-8">
            Manage AHUs, Room Geometries, and Climate data in one centralized dashboard.
          </p>

          <Link
            to="/project"
            className="group relative inline-flex items-center justify-center px-8 py-3 text-base font-bold text-white transition-all duration-200 bg-slate-900 rounded-lg hover:bg-slate-700 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900"
          >
            Get Started
            <span className="absolute -right-8 opacity-0 group-hover:right-[-40px] group-hover:opacity-100 transition-all duration-300">
              →
            </span>
          </Link>

          <div className="mt-8 pt-6 border-t border-gray-100 w-full flex gap-6 text-xs text-gray-400 font-medium uppercase tracking-wider">
            <span>Free to use</span>
            <span>•</span>
            <span>No Signup</span>
          </div>
        </div>

      </div>
    </div>
  );
}