/**
 * HeaderBadge.jsx
 * Responsibility: Render a single ASHRAE standard reference badge.
 *
 * Pure presentational — no props beyond the standard string.
 * Extracted so the badge style is defined once and reusable
 * anywhere a standard reference needs to be displayed
 * (e.g. ResultsPage, ProjectDetails reference card).
 */

const HeaderBadge = ({ standard }) => (
  <span className="
    inline-block
    text-[10px] font-bold tracking-widest uppercase
    bg-amber-400/15 text-amber-300
    border border-amber-400/30
    px-2 py-0.5 rounded
    whitespace-nowrap
  ">
    {standard}
  </span>
);

export default HeaderBadge;