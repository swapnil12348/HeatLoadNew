/**
 * StatCard.tsx
 * Responsibility: Display a single KPI statistic in a coloured card.
 *
 * Pure presentational — no Redux, no hooks.
 * Invalid color values fall back to 'blue'.
 */

// Define the exact colors allowed by this component
export type StatColor = 'blue' | 'indigo' | 'emerald';

// Tell TS this map strictly uses those colors
const COLOR_MAP: Record<StatColor, string> = {
  blue:    'bg-blue-50   text-blue-700   border-blue-100',
  indigo:  'bg-indigo-50 text-indigo-700 border-indigo-100',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
};

// Define exactly what props this component accepts
interface StatCardProps {
  label: string;
  value: string | number; // Accepts numbers (150) or formatted strings ("1,500")
  unit: string;
  color?: StatColor;      // Optional because it defaults to 'blue'
}

const StatCard = ({ label, value, unit, color = 'blue' }: StatCardProps) => (
  // We use the fallback || COLOR_MAP.blue just in case old JavaScript files pass a bad string
  <div className={`p-4 rounded-xl border ${COLOR_MAP[color as StatColor] || COLOR_MAP.blue} flex flex-col justify-center items-center`}>
    <span className="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-1">{label}</span>
    <div className="text-2xl font-bold">
      {value} <span className="text-sm font-normal opacity-80">{unit}</span>
    </div>
  </div>
);

export default StatCard;