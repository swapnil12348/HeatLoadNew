/**
 * Header.jsx
 * Responsibility: App-level header — title, subtitle, ASHRAE standard badges.
 *
 * Fixes vs old version:
 *   - All inline styles replaced with Tailwind utility classes
 *   - Dead `import React` removed (React 17+ JSX transform)
 *   - Badge rendering delegated to HeaderBadge component
 *   - ASHRAE_STANDARDS import retained — single source of truth in ashrae.js
 *   - Gradient and amber accent border expressed as Tailwind classes
 *   - Icon box uses Tailwind — no inline style objects
 *   - `role="banner"` retained for accessibility
 */

import { ASHRAE_STANDARDS } from '../../constants/ashrae';
import HeaderBadge           from './HeaderBadge';

export default function Header() {
  return (
    <header
      role="banner"
      className="
        bg-gradient-to-br from-[#1e3a5f] via-[#0f4c81] to-[#1565c0]
        border-b-[3px] border-amber-400
        shrink-0
      "
    >
      <div className="container mx-auto px-4 py-4">

        {/* ── Title row ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-3.5">

          {/* Icon box */}
          <div className="
            w-11 h-11 shrink-0
            bg-amber-400/20 border-2 border-amber-400
            rounded-lg
            flex items-center justify-center
            text-[22px]
            select-none
          "
            aria-hidden="true"
          >
            🌡
          </div>

          {/* Title + subtitle */}
          <div>
            <h1 className="
              text-[22px] font-extrabold text-white
              tracking-tight leading-tight m-0
            ">
              AHU Heat Load Calculator
            </h1>
            <p className="
              text-xs font-medium text-white/70 mt-0.5 m-0
            ">
              ASHRAE Fundamentals — Air Conditioning Heat Load Analysis
            </p>
          </div>
        </div>

        {/* ── ASHRAE standard badges ───────────────────────────────────── */}
        <div className="mt-2.5 flex flex-wrap gap-2">
          {ASHRAE_STANDARDS.map((standard) => (
            <HeaderBadge key={standard} standard={standard} />
          ))}
        </div>

      </div>
    </header>
  );
}
