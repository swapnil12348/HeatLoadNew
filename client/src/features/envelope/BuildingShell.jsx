/**
 * BuildingShell.jsx
 * Full ASHRAE CLTD/CLF envelope element editor.
 *
 * -- CHANGELOG v2.2 -----------------------------------------------------------
 *
 *   BUG-UI-20 [LOW] — unused React import removed.
 *     Vite with React 17+ automatic JSX transform does not require explicit import.
 *     useState and useCallback are still imported directly from 'react'.
 *
 * -- Previous fixes (retained) ------------------------------------------------
 *
 *   FIX MED-04: PartitionRow and FloorRow now show per-season heat gain.
 *     calcPartitionGain(element, tRoom, season) now accepts a season arg and
 *     selects tAdjSummer (summer/monsoon) or tAdjWinter (winter) from the
 *     element. Two separate inputs replace the single tAdj field.
 *     SectionTotals also updated to pass season for partitions/floors.
 *     Backward-compatible: elements that only have tAdj continue to work
 *     (legacy fallback in calcPartitionGain).
 *
 *   FIX FIX-05 companion: GlassRow now surfaces SHGC (not SC).
 *     envelopeCalc.resolveShgc() prefers element.shgc over element.sc × 0.87.
 *     The UI previously only wrote the sc field — shgc was never set, so
 *     resolveShgc() always fell back to sc × 0.87 (close but not exact).
 *     GlassRow now uses GLAZING_OPTIONS (which has both sc and shgc columns)
 *     and writes both shgc and sc on preset selection. The manual override
 *     input is now the shgc field. SC is shown as a read-only reference.
 */

import { useState, useCallback } from 'react'; // BUG-UI-20 FIX: React removed
import { useDispatch }           from 'react-redux';
import {
  addEnvelopeElement,
  updateEnvelopeElement,
  removeEnvelopeElement,
} from '../../features/envelope/envelopeSlice';
import {
  ORIENTATIONS,
  WALL_CONSTRUCTIONS,
  ROOF_CONSTRUCTIONS,
  GLAZING_OPTIONS,   // FIX FIX-05: replaces SC_OPTIONS — has both shgc and sc
  U_VALUE_PRESETS,
  DEFAULT_ELEMENTS,
} from '../../constants/ashraeTables';
import {
  calcWallGain,
  calcRoofGain,
  calcPartitionGain,
} from '../../utils/envelopeCalc';

// calcGlassGain and calcSkylightGain live in glazingCalc.js (transparent envelope module)
import {
  calcGlassGain,
  calcSkylightGain,
} from '../../utils/glazingCalc';

// ── Seasons ──────────────────────────────────────────────────────────────────
const SEASONS = ['summer', 'monsoon', 'winter'];
const SEASON_COLORS = {
  summer:  'text-orange-600 bg-orange-50 border-orange-200',
  monsoon: 'text-sky-600    bg-sky-50    border-sky-200',
  winter:  'text-blue-600   bg-blue-50   border-blue-200',
};

// ── Category config ──────────────────────────────────────────────────────────
const CATEGORIES = [
  { key: 'walls',      label: 'Walls',      icon: '🧱', color: 'orange' },
  { key: 'roofs',      label: 'Roofs',      icon: '🏠', color: 'red'    },
  { key: 'glass',      label: 'Glass',      icon: '🪟', color: 'sky'    },
  { key: 'skylights',  label: 'Skylights',  icon: '☀️', color: 'amber'  },
  { key: 'partitions', label: 'Partitions', icon: '🚪', color: 'purple' },
  { key: 'floors',     label: 'Floors',     icon: '⬛', color: 'slate'  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const BtuBadge = ({ value }) => {
  const rounded = Math.round(value);
  const color = rounded > 0
    ? 'text-red-600 bg-red-50 border-red-200'
    : 'text-blue-600 bg-blue-50 border-blue-200';
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${color} font-mono`}>
      {rounded > 0 ? '+' : ''}{rounded.toLocaleString()}
    </span>
  );
};

const CellInput = ({ value, onChange, type = 'number', step = '0.01', className = '' }) => (
  <input
    type={type}
    step={step}
    value={value ?? ''}
    onChange={onChange}
    className={`w-full text-xs px-2 py-1.5 border border-gray-200 rounded focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none bg-white ${className}`}
  />
);

const CellSelect = ({ value, onChange, options }) => (
  <select
    value={value ?? ''}
    onChange={onChange}
    className="w-full text-xs px-1.5 py-1.5 border border-gray-200 rounded focus:ring-1 focus:ring-blue-400 outline-none bg-white appearance-none"
  >
    {options.map(opt =>
      typeof opt === 'string'
        ? <option key={opt} value={opt}>{opt}</option>
        : <option key={opt.value} value={opt.value}>{opt.label}</option>
    )}
  </select>
);

// ── Per-category row renderers ───────────────────────────────────────────────

const WallRow = ({ element, roomId, climate, tRoom, onUpdate, onRemove }) => {
  const gains = SEASONS.map(s => calcWallGain(element, climate, tRoom, s));
  return (
    <tr className="group hover:bg-orange-50/30 border-b border-gray-100">
      <td className="px-2 py-2 min-w-[130px]">
        <CellInput type="text" value={element.label} onChange={e => onUpdate('label', e.target.value)} />
      </td>
      <td className="px-2 py-2 w-20">
        <CellSelect
          value={element.orientation}
          onChange={e => onUpdate('orientation', e.target.value)}
          options={ORIENTATIONS}
        />
      </td>
      <td className="px-2 py-2 w-24">
        <CellSelect
          value={element.construction}
          onChange={e => onUpdate('construction', e.target.value)}
          options={WALL_CONSTRUCTIONS}
        />
      </td>
      <td className="px-2 py-2 w-28">
        <CellSelect
          value={element.uPreset}
          onChange={e => {
            const preset = U_VALUE_PRESETS.walls.find(p => p.label === e.target.value);
            onUpdate('uPreset', e.target.value);
            if (preset?.value !== null) onUpdate('uValue', preset.value);
          }}
          options={U_VALUE_PRESETS.walls.map(p => ({ value: p.label, label: p.label }))}
        />
      </td>
      <td className="px-2 py-2 w-16">
        <CellInput value={element.uValue} step="0.01" onChange={e => onUpdate('uValue', parseFloat(e.target.value) || 0)} />
      </td>
      <td className="px-2 py-2 w-20">
        <CellInput value={element.area} step="1" onChange={e => onUpdate('area', parseFloat(e.target.value) || 0)} />
      </td>
      {gains.map((g, i) => (
        <td key={i} className="px-2 py-2 text-center w-24"><BtuBadge value={g} /></td>
      ))}
      <td className="px-2 py-2 text-center">
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500 transition-colors text-xs">✕</button>
      </td>
    </tr>
  );
};

const RoofRow = ({ element, roomId, climate, tRoom, onUpdate, onRemove }) => {
  const gains = SEASONS.map(s => calcRoofGain(element, climate, tRoom, s));
  return (
    <tr className="group hover:bg-red-50/30 border-b border-gray-100">
      <td className="px-2 py-2 min-w-[130px]">
        <CellInput type="text" value={element.label} onChange={e => onUpdate('label', e.target.value)} />
      </td>
      <td className="px-2 py-2 w-36" colSpan={2}>
        <CellSelect
          value={element.construction}
          onChange={e => onUpdate('construction', e.target.value)}
          options={ROOF_CONSTRUCTIONS}
        />
      </td>
      <td className="px-2 py-2 w-28">
        <CellSelect
          value={element.uPreset}
          onChange={e => {
            const preset = U_VALUE_PRESETS.roofs.find(p => p.label === e.target.value);
            onUpdate('uPreset', e.target.value);
            if (preset?.value !== null) onUpdate('uValue', preset.value);
          }}
          options={U_VALUE_PRESETS.roofs.map(p => ({ value: p.label, label: p.label }))}
        />
      </td>
      <td className="px-2 py-2 w-16">
        <CellInput value={element.uValue} step="0.01" onChange={e => onUpdate('uValue', parseFloat(e.target.value) || 0)} />
      </td>
      <td className="px-2 py-2 w-20">
        <CellInput value={element.area} step="1" onChange={e => onUpdate('area', parseFloat(e.target.value) || 0)} />
      </td>
      {gains.map((g, i) => (
        <td key={i} className="px-2 py-2 text-center w-24"><BtuBadge value={g} /></td>
      ))}
      <td className="px-2 py-2 text-center">
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500 transition-colors text-xs">✕</button>
      </td>
    </tr>
  );
};

/**
 * GlassRow / SkylightRow
 * FIX FIX-05: now wired to SHGC (element.shgc) not SC.
 * - Preset selector uses GLAZING_OPTIONS (has both shgc + sc columns).
 * - On preset change: writes both shgc AND sc for full backward compat.
 * - Manual override edits element.shgc directly (resolveShgc() prefers it).
 * - SC is shown as a read-only derived reference (SC ≈ SHGC / 0.87).
 */
const GlassRow = ({ element, isSkylights, climate, tRoom, onUpdate, onRemove }) => {
  const calcFn = isSkylights ? calcSkylightGain : calcGlassGain;
  const gains  = SEASONS.map(s => calcFn(element, climate, tRoom, s));

  const displayShgc = parseFloat(element.shgc) || parseFloat(element.sc) * 0.87 || 0;
  const displaySc   = (displayShgc / 0.87).toFixed(2);

  return (
    <tr className="group hover:bg-sky-50/30 border-b border-gray-100">
      <td className="px-2 py-2 min-w-[130px]">
        <CellInput type="text" value={element.label} onChange={e => onUpdate('label', e.target.value)} />
      </td>
      {!isSkylights && (
        <td className="px-2 py-2 w-20">
          <CellSelect
            value={element.orientation}
            onChange={e => onUpdate('orientation', e.target.value)}
            options={ORIENTATIONS}
          />
        </td>
      )}
      <td className="px-2 py-2 w-28" colSpan={isSkylights ? 2 : 1}>
        <CellSelect
          value={element.uPreset}
          onChange={e => {
            const preset = U_VALUE_PRESETS.glass.find(p => p.label === e.target.value);
            onUpdate('uPreset', e.target.value);
            if (preset?.value !== null) onUpdate('uValue', preset.value);
          }}
          options={U_VALUE_PRESETS.glass.map(p => ({ value: p.label, label: p.label }))}
        />
      </td>
      <td className="px-2 py-2 w-16">
        <CellInput value={element.uValue} step="0.01" onChange={e => onUpdate('uValue', parseFloat(e.target.value) || 0)} />
      </td>
      <td className="px-2 py-2 w-32">
        <CellSelect
          value={element.scPreset}
          onChange={e => {
            const opt = GLAZING_OPTIONS.find(o => o.label === e.target.value);
            onUpdate('scPreset', e.target.value);
            if (opt) {
              onUpdate('shgc', opt.shgc);
              onUpdate('sc',   opt.sc);
            }
          }}
          options={GLAZING_OPTIONS.map(o => ({
            value: o.label,
            label: `${o.label} (SHGC=${o.shgc})`,
          }))}
        />
      </td>
      <td className="px-2 py-2 w-16">
        <CellInput
          value={displayShgc}
          step="0.01"
          onChange={e => {
            const shgc = parseFloat(e.target.value) || 0;
            onUpdate('shgc', shgc);
            onUpdate('sc', parseFloat((shgc / 0.87).toFixed(3)));
          }}
        />
      </td>
      <td className="px-2 py-2 w-14 text-center">
        <span className="text-[10px] text-gray-400 font-mono">{displaySc}</span>
      </td>
      <td className="px-2 py-2 w-20">
        <CellInput value={element.area} step="1" onChange={e => onUpdate('area', parseFloat(e.target.value) || 0)} />
      </td>
      {gains.map((g, i) => (
        <td key={i} className="px-2 py-2 text-center w-24">
          <div className="flex flex-col items-center gap-0.5">
            <BtuBadge value={g.total} />
            <span className="text-[8px] text-gray-400">
              c:{Math.round(g.conduction)} s:{Math.round(g.solar)}
            </span>
          </div>
        </td>
      ))}
      <td className="px-2 py-2 text-center">
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500 transition-colors text-xs">✕</button>
      </td>
    </tr>
  );
};

/**
 * PartitionRow / FloorRow
 * FIX MED-04: now shows per-season heat gain using tAdjSummer / tAdjWinter.
 */
const PartitionRow = ({ element, tRoom, onUpdate, onRemove }) => {
  const gains = SEASONS.map(s => calcPartitionGain(element, tRoom, s));

  const tAdjSummer = element.tAdjSummer ?? element.tAdj ?? 85;
  const tAdjWinter = element.tAdjWinter ?? element.tAdj ?? 65;

  return (
    <tr className="group hover:bg-purple-50/30 border-b border-gray-100">
      <td className="px-2 py-2 min-w-[130px]">
        <CellInput type="text" value={element.label} onChange={e => onUpdate('label', e.target.value)} />
      </td>
      <td className="px-2 py-2 w-28" colSpan={2}>
        <CellSelect
          value={element.uPreset}
          onChange={e => {
            const preset = U_VALUE_PRESETS.partitions.find(p => p.label === e.target.value);
            onUpdate('uPreset', e.target.value);
            if (preset?.value !== null) onUpdate('uValue', preset.value);
          }}
          options={U_VALUE_PRESETS.partitions.map(p => ({ value: p.label, label: p.label }))}
        />
      </td>
      <td className="px-2 py-2 w-16">
        <CellInput value={element.uValue} step="0.01" onChange={e => onUpdate('uValue', parseFloat(e.target.value) || 0)} />
      </td>
      <td className="px-2 py-2 w-20">
        <CellInput value={element.area} step="1" onChange={e => onUpdate('area', parseFloat(e.target.value) || 0)} />
      </td>
      <td className="px-2 py-2 w-20">
        <div className="flex items-center gap-1">
          <CellInput
            value={tAdjSummer}
            step="1"
            onChange={e => onUpdate('tAdjSummer', parseFloat(e.target.value) || 0)}
          />
          <span className="text-[9px] text-orange-500 font-bold shrink-0">S/M</span>
        </div>
      </td>
      <td className="px-2 py-2 w-20">
        <div className="flex items-center gap-1">
          <CellInput
            value={tAdjWinter}
            step="1"
            onChange={e => onUpdate('tAdjWinter', parseFloat(e.target.value) || 0)}
          />
          <span className="text-[9px] text-blue-500 font-bold shrink-0">W</span>
        </div>
      </td>
      {gains.map((g, i) => (
        <td key={i} className="px-2 py-2 text-center w-24">
          <BtuBadge value={g} />
        </td>
      ))}
      <td className="px-2 py-2 text-center">
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500 transition-colors text-xs">✕</button>
      </td>
    </tr>
  );
};

// ── Column headers per category ──────────────────────────────────────────────
const HEADERS = {
  walls:      ['Label', 'Orient.', 'Mass', 'Construction Preset', 'U-Value', 'Area (ft²)'],
  roofs:      ['Label', 'Construction', '', 'Insulation Preset', 'U-Value', 'Area (ft²)'],
  glass:      ['Label', 'Orient.', 'Glazing Preset', 'U-Value', 'SHGC Preset', 'SHGC', 'SC ref', 'Area (ft²)'],
  skylights:  ['Label', 'Glazing Preset', '', 'U-Value', 'SHGC Preset', 'SHGC', 'SC ref', 'Area (ft²)'],
  partitions: ['Label', 'Construction Preset', '', 'U-Value', 'Area (ft²)', 'tAdj S/M °F', 'tAdj W °F'],
  floors:     ['Label', 'Construction Preset', '', 'U-Value', 'Area (ft²)', 'tAdj S/M °F', 'tAdj W °F'],
};

// ── Section totals row ───────────────────────────────────────────────────────
const SectionTotals = ({ elements, category, climate, tRoom }) => {
  const totals = SEASONS.map(season =>
    elements.reduce((sum, el) => {
      if (category === 'walls')      return sum + calcWallGain(el, climate, tRoom, season);
      if (category === 'roofs')      return sum + calcRoofGain(el, climate, tRoom, season);
      if (category === 'glass')      return sum + calcGlassGain(el, climate, tRoom, season).total;
      if (category === 'skylights')  return sum + calcSkylightGain(el, climate, tRoom, season).total;
      if (category === 'partitions') return sum + calcPartitionGain(el, tRoom, season);
      if (category === 'floors')     return sum + calcPartitionGain(el, tRoom, season);
      return sum;
    }, 0)
  );

  const colCount = HEADERS[category]?.length || 6;

  return (
    <tr className="bg-gray-50 border-t-2 border-gray-200">
      <td colSpan={colCount} className="px-2 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-wide">
        Subtotal
      </td>
      {totals.map((t, i) => (
        <td key={i} className="px-2 py-1.5 text-center">
          <span className="text-[10px] font-bold text-gray-700 font-mono">
            {Math.round(t).toLocaleString()} BTU/hr
          </span>
        </td>
      ))}
      <td />
    </tr>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function BuildingShell({ roomId, elements, climate, tRoom }) {
  const dispatch = useDispatch();
  const [activeCategory, setActiveCategory] = useState('walls');

  const handleAdd = useCallback(() => {
    dispatch(addEnvelopeElement({
      roomId,
      category: activeCategory,
      element: { ...DEFAULT_ELEMENTS[activeCategory] },
    }));
  }, [dispatch, roomId, activeCategory]);

  const handleUpdate = useCallback((category, id, field, value) => {
    dispatch(updateEnvelopeElement({ roomId, category, id, field, value }));
  }, [dispatch, roomId]);

  const handleRemove = useCallback((category, id) => {
    dispatch(removeEnvelopeElement({ roomId, category, id }));
  }, [dispatch, roomId]);

  const activeElements = elements?.[activeCategory] || [];
  const headers        = HEADERS[activeCategory] || [];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

      {/* ── Category Tab Bar ── */}
      <div className="flex border-b border-gray-200 bg-gray-50 overflow-x-auto">
        {CATEGORIES.map(cat => {
          const count = elements?.[cat.key]?.length || 0;
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors
                ${activeCategory === cat.key
                  ? 'border-blue-600 text-blue-700 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-white/60'
                }`}
            >
              <span>{cat.icon}</span>
              {cat.label}
              {count > 0 && (
                <span className="bg-blue-100 text-blue-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Season Legend ── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-100">
        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">Heat Gain (BTU/hr):</span>
        {SEASONS.map(s => (
          <span key={s} className={`text-[10px] font-bold px-2 py-0.5 rounded border capitalize ${SEASON_COLORS[s]}`}>
            {s}
          </span>
        ))}
        <span className="text-[9px] text-gray-400 ml-2 italic">
          ASHRAE CLTD/CLF · +red = heat gain · −blue = heat loss · partition gain is now season-dependent
        </span>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse min-w-[900px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="px-2 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
              {SEASONS.map(s => (
                <th key={s} className={`px-2 py-2 text-[10px] font-bold text-center capitalize whitespace-nowrap ${SEASON_COLORS[s].split(' ')[0]}`}>
                  {s}
                </th>
              ))}
              <th className="px-2 py-2 w-8" />
            </tr>
          </thead>

          <tbody>
            {activeElements.length === 0 ? (
              <tr>
                <td
                  colSpan={headers.length + 4}
                  className="px-6 py-8 text-center text-gray-400 text-xs italic"
                >
                  No {activeCategory} added. Click "+ Add {CATEGORIES.find(c => c.key === activeCategory)?.label}" below.
                </td>
              </tr>
            ) : (
              <>
                {activeElements.map(el => {
                  const commonProps = {
                    key:      el.id,
                    element:  el,
                    roomId,
                    climate,
                    tRoom,
                    onUpdate: (field, val) => handleUpdate(activeCategory, el.id, field, val),
                    onRemove: () => handleRemove(activeCategory, el.id),
                  };

                  if (activeCategory === 'walls')      return <WallRow      {...commonProps} />;
                  if (activeCategory === 'roofs')      return <RoofRow      {...commonProps} />;
                  if (activeCategory === 'glass')      return <GlassRow     {...commonProps} isSkylights={false} />;
                  if (activeCategory === 'skylights')  return <GlassRow     {...commonProps} isSkylights={true}  />;
                  if (activeCategory === 'partitions') return <PartitionRow {...commonProps} />;
                  if (activeCategory === 'floors')     return <PartitionRow {...commonProps} />;
                  return null;
                })}

                <SectionTotals
                  elements={activeElements}
                  category={activeCategory}
                  climate={climate}
                  tRoom={tRoom}
                />
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Footer: Add Button ── */}
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Add {CATEGORIES.find(c => c.key === activeCategory)?.label.slice(0, -1) || 'Element'}
        </button>
        <span className="text-[10px] text-gray-400">
          {activeElements.length} element{activeElements.length !== 1 ? 's' : ''} · {activeCategory}
        </span>
      </div>
    </div>
  );
}