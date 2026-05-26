/**
 * HeaderBadge.tsx
 * Responsibility: Render a single ASHRAE standard reference badge.
 *
 * Pure presentational — no props beyond the standard string.
 * Extracted so the badge style is defined once and reusable
 * anywhere a standard reference needs to be displayed
 * (e.g. ResultsPage, ProjectDetails reference card).
 */

// 1. We create an interface to define exactly what props this component accepts
interface HeaderBadgeProps {
  standard: string;
}

// 2. We tell the component to expect HeaderBadgeProps, and promise it will return a JSX.Element
const HeaderBadge = ({ standard }: HeaderBadgeProps) => (
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