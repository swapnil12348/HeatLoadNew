/**
 * StatCard.jsx
 * Responsibility: Display a single KPI statistic in a coloured card.
 *
 * Pure presentational — no Redux, no hooks.
 * Invalid color values fall back to 'blue'.
 */

const COLOR_MAP = {
  blue:    'bg-blue-50   text-blue-700   border-blue-100',
  indigo:  'bg-indigo-50 text-indigo-700 border-indigo-100',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
};

const StatCard = ({ label, value, unit, color = 'blue' }) => (
  <div className={`p-4 rounded-xl border ${COLOR_MAP[color] || COLOR_MAP.blue} flex flex-col justify-center items-center`}>
    <span className="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-1">{label}</span>
    <div className="text-2xl font-bold">
      {value} <span className="text-sm font-normal opacity-80">{unit}</span>
    </div>
  </div>
);

export default StatCard;