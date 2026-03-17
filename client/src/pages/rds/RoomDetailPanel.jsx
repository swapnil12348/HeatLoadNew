/**
 * RoomDetailPanel.jsx
 * Responsibility: Fixed side-panel editor for a single room.
 *                 Renders all RDS_SECTIONS fields in a tabbed form layout.
 *
 * ── CHANGELOG v2.4 ────────────────────────────────────────────────────────────
 *
 *   Insights tab added — fifth tab alongside Setup / Loads / Results / Psychro.
 *
 *     Nine recommendation rules including critical: ADP above room temperature.
 *     When ADP ≥ room DB, supplyDT is negative, thermalCFM = 0, supply air is
 *     warmer than the room, and SHR defaults to 1.0 as a silent fallback.
 *     The rule fires and explains the exact cause with the room's own numbers.
 *
 * ── CHANGELOG v2.3 ────────────────────────────────────────────────────────────
 *
 *   UI-REFRESH — Panel widened to 820px, typography scaled up, section colour
 *     coding, readOnly fields visually distinct, 3-col setup grid.
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   BUG-UI-01 — useRdsRow called with room object (ISO correctness).
 *   BUG-UI-02 — dynamic require() removed, top-level ESM import.
 *
 * ── SEASON DIVIDER ORDER NOTE ─────────────────────────────────────────────────
 *
 *   groupColumnsBySeason iterates Object.entries(groups) which preserves
 *   insertion order in modern JS. Season dividers appear in the order
 *   that column definitions appear in the section files. All section files
 *   define summer → monsoon → winter in that order — maintain this convention
 *   when adding new seasonal column blocks.
 */

import { useState, useCallback }     from 'react';
import { useDispatch }               from 'react-redux';
import { X, Lock }                   from 'lucide-react';
import { FormInput, FormSelect,
         SeasonBadge }               from './RDSCellComponents';
import { RDS_SECTIONS,
         RDS_CATEGORIES,
         getFieldValue }             from './RDSConfig';
import useRdsRow                     from '../../hooks/useRdsRow';
import { deleteRoomWithCleanup }     from '../../features/room/roomActions';

// ── Section colour palette ────────────────────────────────────────────────────
const SECTION_PALETTE = {
  gray:   { header: 'bg-slate-50   border-slate-200', accent: 'bg-slate-400',   text: 'text-slate-600'  },
  blue:   { header: 'bg-blue-50    border-blue-200',  accent: 'bg-blue-500',    text: 'text-blue-700'   },
  amber:  { header: 'bg-amber-50   border-amber-200', accent: 'bg-amber-500',   text: 'text-amber-700'  },
  purple: { header: 'bg-purple-50  border-purple-200',accent: 'bg-purple-500',  text: 'text-purple-700' },
  green:  { header: 'bg-green-50   border-green-200', accent: 'bg-green-500',   text: 'text-green-700'  },
  red:    { header: 'bg-red-50     border-red-200',   accent: 'bg-red-500',     text: 'text-red-700'    },
  orange: { header: 'bg-orange-50  border-orange-200',accent: 'bg-orange-500',  text: 'text-orange-700' },
  teal:   { header: 'bg-teal-50    border-teal-200',  accent: 'bg-teal-500',    text: 'text-teal-700'   },
  cyan:   { header: 'bg-cyan-50    border-cyan-200',  accent: 'bg-cyan-500',    text: 'text-cyan-700'   },
  indigo: { header: 'bg-indigo-50  border-indigo-200',accent: 'bg-indigo-500',  text: 'text-indigo-700' },
  sky:    { header: 'bg-sky-50     border-sky-200',   accent: 'bg-sky-500',     text: 'text-sky-700'    },
  lime:   { header: 'bg-lime-50    border-lime-200',  accent: 'bg-lime-500',    text: 'text-lime-700'   },
  rose:   { header: 'bg-rose-50    border-rose-200',  accent: 'bg-rose-500',    text: 'text-rose-700'   },
  pink:   { header: 'bg-pink-50    border-pink-200',  accent: 'bg-pink-500',    text: 'text-pink-700'   },
  violet: { header: 'bg-violet-50  border-violet-200',accent: 'bg-violet-500',  text: 'text-violet-700' },
  yellow: { header: 'bg-yellow-50  border-yellow-200',accent: 'bg-yellow-500',  text: 'text-yellow-700' },
};

const getPalette = (color) =>
  SECTION_PALETTE[color] ?? SECTION_PALETTE.gray;

// ── Season grouping ───────────────────────────────────────────────────────────
const groupColumnsBySeason = (columns) => {
  const groups    = {};
  const ungrouped = [];
  for (const col of columns) {
    if (col.seasonLabel) {
      if (!groups[col.seasonLabel]) groups[col.seasonLabel] = [];
      groups[col.seasonLabel].push(col);
    } else {
      ungrouped.push(col);
    }
  }
  const result = [];
  if (ungrouped.length) result.push({ groupLabel: null, columns: ungrouped });
  for (const [label, cols] of Object.entries(groups)) {
    result.push({ groupLabel: label, columns: cols });
  }
  return result;
};

// ── ReadOnly display ──────────────────────────────────────────────────────────
const ReadOnlyField = ({ label, subLabel, value }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
      <Lock className="w-2.5 h-2.5 opacity-50" aria-hidden="true" />
      {label}
      {subLabel && <span className="normal-case font-normal opacity-70">({subLabel})</span>}
    </span>
    <div className="bg-slate-50 border border-slate-100 rounded-md px-3 py-2
                    text-sm font-semibold text-slate-600 font-mono tracking-tight">
      {value === '' || value === null || value === undefined ? (
        <span className="text-slate-300 font-normal not-italic">—</span>
      ) : value}
    </div>
  </div>
);

// ── PanelField ────────────────────────────────────────────────────────────────
const PanelField = ({
  col, room, rdsRow, envelope, ahus,
  onRoomUpdate, onEnvUpdate, onAhuChange,
}) => {
  const value      = getFieldValue(col, room, envelope, rdsRow);
  const isReadOnly = col.type === 'readOnly' || col.derived;

  if (isReadOnly) {
    return <ReadOnlyField label={col.label} subLabel={col.subLabel} value={value} />;
  }

  if (col.type === 'select-ahu') {
    return (
      <div className="col-span-2">
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">
          {col.label}
          {col.subLabel && (
            <span className="text-slate-400 font-normal ml-1.5 text-[11px]">
              ({col.subLabel})
            </span>
          )}
        </label>
        <select
          value={room.assignedAhuIds?.[0] || ''}
          onChange={(e) => onAhuChange(e.target.value)}
          className="
            w-full text-sm font-bold text-blue-700
            bg-blue-50 border border-blue-200 rounded-lg
            px-3 py-2.5
            focus:outline-none focus:ring-2 focus:ring-blue-300
            transition-all
          "
        >
          <option value="">— Select System —</option>
          {ahus.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
    );
  }

  if (col.type === 'select') {
    return (
      <FormSelect
        label={col.label}
        subLabel={col.subLabel}
        value={value}
        options={col.options || []}
        onChange={(e) => onRoomUpdate(col, e.target.value)}
      />
    );
  }

  return (
    <FormInput
      label={col.label}
      subLabel={col.subLabel}
      type={col.inputType || 'number'}
      value={value}
      step={col.step}
      disabled={false}
      onChange={
        col.isEnv
          ? (e) => onEnvUpdate(col, e.target.value)
          : (e) => onRoomUpdate(col, e.target.value)
      }
    />
  );
};

// ── ISO badge colour ──────────────────────────────────────────────────────────
const ISO_BADGE_COLOR = {
  'ISO 1': 'bg-red-100    text-red-700    border-red-200',
  'ISO 2': 'bg-red-50     text-red-600    border-red-100',
  'ISO 3': 'bg-orange-100 text-orange-700 border-orange-200',
  'ISO 4': 'bg-orange-50  text-orange-600 border-orange-100',
  'ISO 5': 'bg-amber-100  text-amber-700  border-amber-200',
  'ISO 6': 'bg-yellow-100 text-yellow-700 border-yellow-200',
  'ISO 7': 'bg-purple-100 text-purple-700 border-purple-200',
  'ISO 8': 'bg-slate-100  text-slate-600  border-slate-200',
  'ISO 9': 'bg-gray-100   text-gray-500   border-gray-200',
  'CNC':   'bg-teal-100   text-teal-700   border-teal-200',
};

const isoBadgeClass = (cls) =>
  ISO_BADGE_COLOR[cls] ?? 'bg-gray-100 text-gray-500 border-gray-200';

// ══════════════════════════════════════════════════════════════════════════════
// INSIGHTS TAB
// ══════════════════════════════════════════════════════════════════════════════

// ── Load composition config ───────────────────────────────────────────────────
// Each component: field on rdsRow, display label, tailwind color classes.
const LOAD_COMPONENTS = [
  { key: 'bd_equipment',    label: 'Equipment',    bar: 'bg-red-400',    text: 'text-red-700',    dot: 'bg-red-400'    },
  { key: 'bd_envelope',     label: 'Envelope',     bar: 'bg-amber-400',  text: 'text-amber-700',  dot: 'bg-amber-400'  },
  { key: 'bd_oa',           label: 'Outdoor Air',  bar: 'bg-violet-400', text: 'text-violet-700', dot: 'bg-violet-400' },
  { key: 'bd_people',       label: 'People',       bar: 'bg-blue-400',   text: 'text-blue-700',   dot: 'bg-blue-400'   },
  { key: 'bd_lights',       label: 'Lighting',     bar: 'bg-yellow-400', text: 'text-yellow-700', dot: 'bg-yellow-400' },
  { key: 'bd_infiltration', label: 'Infiltration', bar: 'bg-teal-400',   text: 'text-teal-700',   dot: 'bg-teal-400'   },
  { key: 'bd_fanHeat',      label: 'Fan Heat',     bar: 'bg-slate-400',  text: 'text-slate-600',  dot: 'bg-slate-400'  },
];

// ── Recommendation rules ──────────────────────────────────────────────────────
//
// Each rule receives (rdsRow, positiveTotal) and returns a recommendation
// object or null if the rule doesn't fire.
//
// Levels:
//   critical    — must address before finalising design (red)
//   opportunity — potential improvement with quantified benefit (teal)
//   review      — worth checking before issue (amber)
//   info        — design basis note, no action required (blue)
const RECOMMENDATION_RULES = [

  // High humidification demand
  (r) => {
    const dg = parseFloat(r.humidDeltaGr);
    if (!(dg > 40)) return null;
    return {
      level: 'critical',
      icon:  '💧',
      title: 'High Humidification Demand',
      body:  `Δgr = ${r.humidDeltaGr} gr/lb exceeds the 40 gr/lb threshold — this is a sub-5% RH dry-room condition. Humidifier power is ${r.humidKw} kW at ${r.humidLbsPerHr} lb/hr. Steam supply capacity and AHU humidifier section length require specialist review before equipment procurement.`,
      action: 'Verify steam supply pressure and available capacity. Size the AHU humidifier section for this specific duty — do not use a standard catalogue selection.'
    };
  },

  // OA enthalpy recovery opportunity
  (r, posTotal) => {
    const oaVal = r.bd_oa || 0;
    if (posTotal <= 0 || oaVal <= 0) return null;
    const pct = oaVal / posTotal;
    if (pct < 0.35) return null;
    const recoverableTR = ((oaVal * 0.75) / 12000).toFixed(1);
    return {
      level: 'opportunity',
      icon:  '♻️',
      title: 'Enthalpy Recovery Opportunity',
      body:  `Outdoor air load is ${(pct * 100).toFixed(0)}% of total cooling (${(oaVal / 12000).toFixed(1)} TR). An enthalpy wheel at 75% effectiveness would recover ~${recoverableTR} TR, reducing design tonnage and annual chiller energy. Fresh air fraction is ${r.freshAirCheck > 0 && r.supplyAir > 0 ? ((r.freshAirCheck / r.supplyAir) * 100).toFixed(0) : '—'}% of supply.`,
      action: 'Evaluate enthalpy wheel or run-around coil on the OA stream. Update oaTotal in the calculation after applying recovery efficiency.'
    };
  },

  // Equipment dominated — no passive optimisation available
  (r, posTotal) => {
    const val = r.bd_equipment || 0;
    if (posTotal <= 0 || val / posTotal < 0.55) return null;
    return {
      level: 'info',
      icon:  '⚙️',
      title: 'Equipment-Dominated Load',
      body:  `Process equipment contributes ${((val / posTotal) * 100).toFixed(0)}% of sensible load (${(val / 12000).toFixed(1)} TR). This is typical for semiconductor process tools and cleanroom equipment bays. Passive strategies (insulation, shading, orientation) have negligible impact on total tonnage.`,
      action: 'Confirm equipment kW against vendor data sheets and apply the correct diversity factor. Schedule-based load shedding is the only meaningful operational lever.'
    };
  },

  // Significant envelope load
  (r, posTotal) => {
    const val = r.bd_envelope || 0;
    if (posTotal <= 0 || val <= 0 || val / posTotal < 0.30) return null;
    return {
      level: 'review',
      icon:  '🏗️',
      title: 'Significant Envelope Load',
      body:  `Envelope gains are ${((val / posTotal) * 100).toFixed(0)}% of sensible load (${(val / 12000).toFixed(1)} TR). Review glazing SHGC/U-values and wall construction U-values against ASHRAE 90.1 prescriptive requirements.`,
      action: 'Check east/west glazing for external shading feasibility. Verify wall U-value and roof construction type match the ASHRAE CLTD tables used in the calculation.'
    };
  },

  // Lighting load significant
  (r, posTotal) => {
    const val = r.bd_lights || 0;
    if (posTotal <= 0 || val / posTotal < 0.15) return null;
    return {
      level: 'review',
      icon:  '💡',
      title: 'Lighting Contributes Significant Load',
      body:  `Lighting is ${((val / posTotal) * 100).toFixed(0)}% of sensible load. Verify W/ft² against ASHRAE 90.1 LPD limits for this space type. LED fixtures reduce heat gain vs fluorescent by 30–50%.`,
      action: 'Confirm watts/ft² with the lighting designer. If fluorescent is specified, model LED alternative — reduction in lighting load directly reduces cooling tonnage.'
    };
  },

  // ACPH-governed — coil oversized relative to thermal
  (r) => {
    if (r.supplyAirGoverned === 'thermal' || !r.supplyAirGoverned) return null;
    const governed = {
      designAcph:     'design ACH requirement',
      minAcph:        'minimum ACH floor (ISO 14644)',
      regulatoryAcph: 'statutory regulatory ACH floor (NFPA 855 / GMP / OSHA)',
    }[r.supplyAirGoverned] || r.supplyAirGoverned;
    return {
      level: 'info',
      icon:  '🔵',
      title: 'Supply Air Governed by ACH, Not Thermal Load',
      body:  `This room's ${Math.round(r.supplyAir).toLocaleString()} CFM is set by the ${governed}, not by the ${Math.round(r.thermalCFM).toLocaleString()} CFM thermal requirement. The cooling coil is operating at partial load — actual leaving conditions will differ from ADP design point.`,
      action: 'Confirm supply temperature setpoint for part-load coil operation. Consider VAV or face-and-bypass control if turndown is needed at partial load conditions.'
    };
  },

  // Monsoon governs capacity
  (r) => {
    if (!r.peakCoolingSeason || r.peakCoolingSeason === 'summer') return null;
    return {
      level: 'info',
      icon:  '🌧️',
      title: 'Monsoon Governs Cooling Capacity',
      body:  `Cooling capacity (${r.coolingCapTR} TR) and CHW pipe sizing are based on monsoon OA conditions, not summer. The combined room + OA enthalpy load during monsoon exceeds the summer peak. Supply air CFM is still governed by peak sensible (summer).`,
      action: 'Confirm monsoon outdoor design conditions (DB/WB) in the Climate tab. Ensure CHW plant is sized to the monsoon coil load, not the summer room-only load.'
    };
  },

  // ACPH-governed room with calculated ADP mode
  //
  // When supply air is set by ACH constraints (not thermal load), ADP is
  // back-calculated from thermalCFM (after the v2.5 fix). But the engineer
  // should understand the coil is operating at deep partial load — the coil
  // ΔT is very small and the design is ventilation-driven, not cooling-driven.
  (r) => {
    if (r.supplyAirGoverned === 'thermal') return null;
    if (r.coil_adpMode !== 'calculated') return null;
    const governed = {
      designAcph:     'design ACH requirement',
      minAcph:        'minimum ACH floor',
      regulatoryAcph: 'statutory regulatory ACH floor',
    }[r.supplyAirGoverned] || r.supplyAirGoverned;
    const thermalPct = r.supplyAir > 0
      ? ((r.thermalCFM / r.supplyAir) * 100).toFixed(0) : '—';
    return {
      level: 'review',
      icon:  '🔧',
      title: 'Calculated ADP — Coil at Deep Partial Load',
      body:  `Supply air (${Math.round(r.supplyAir).toLocaleString()} CFM) is governed by ${governed}. Thermal load requires only ${Math.round(r.thermalCFM).toLocaleString()} CFM (${thermalPct}% of supply). The cooling coil is operating at partial load — the ADP is back-calculated from the thermal CFM only, not the full ventilation-inflated supply. Coil ΔT is small and SHR will be high (sensible-dominant operation).`,
      action: 'For ACH-governed rooms, consider switching to Manual ADP mode and setting ADP to match chiller design conditions (typically 42–48°F for standard chilled water systems). This gives a physically meaningful coil state point regardless of supply air governance.'
    };
  },

  // Winter outdoor conditions unconfigured
  //
  // If winter DB ≥ monsoon DB or winter DB > 80°F, the user has almost
  // certainly not set winter conditions — defaults mimic summer/monsoon.
  // This causes humidification and heating loads to be calculated against
  // wrong outdoor conditions, silently producing incorrect winter sizing.
  (r) => {
    // Access winter OA via psychro state points on the rdsRow
    const winterDB = parseFloat(r['amb_db_winter']);
    const monsoonDB = parseFloat(r['amb_db_monsoon']);
    if (isNaN(winterDB) || isNaN(monsoonDB)) return null;
    if (winterDB < 80 && winterDB < monsoonDB) return null;
    return {
      level: 'critical',
      icon:  '🌡️',
      title: 'Winter Outdoor Conditions Appear Unconfigured',
      body:  `Winter outdoor DB is ${winterDB}°F — equal to or warmer than monsoon (${monsoonDB}°F). Winter in most South Asian locations should be 40–65°F DB. Using summer conditions for winter means heating loads are calculated against warm outdoor air, likely producing zero heating capacity and an undersized humidifier.`,
      action: 'Go to Climate tab and enter correct winter design DB/RH for your site. For Delhi: ~45–55°F DB is typical. Use ASHRAE HOF 2021 Ch.14 Table 1 — 99.6% heating design condition for critical facilities.'
    };
  },
  //
  // This is the most important coil configuration error this tool can detect.
  // The ADP-bypass model requires ADP < supply DB < room DB.
  // When ADP >= room DB: supplyDT = (1-BF)×(roomDB - ADP) ≤ 0 → thermalCFM = 0
  // and saDB = ADP×(1-BF) + roomDB×BF > roomDB.
  // The "supply air" is warmer than the room — enthDiff < 0 → SHR defaults to 1.0.
  // All coil state points (SA, MA, CL temperatures) are physically meaningless.
  // The TR and CHW pipe sizes are still valid (calculated before psychro runs)
  // but the coil cannot achieve the room setpoint with this ADP.
  (r) => {
    const adpF    = parseFloat(r.coil_adp);
    const designC = parseFloat(r.designTemp);
    if (isNaN(adpF) || isNaN(designC)) return null;
    const roomDbF = designC * 9 / 5 + 32;
    if (adpF < roomDbF) return null;
    return {
      level: 'critical',
      icon:  '🚨',
      title: 'ADP Above Room Temperature — Coil Model Invalid',
      body:  `Apparatus Dew Point is ${adpF}°F but the room design temperature is ${roomDbF.toFixed(1)}°F (${designC}°C). The ADP-bypass psychrometric model requires ADP < room DB. With ADP above room temperature, supply air (${((adpF * (1 - (parseFloat(r.coil_contactFactor) || 0.9)) + roomDbF * (1 - (parseFloat(r.coil_contactFactor) || 0.9)))).toFixed(0)}°F) is warmer than the room, making the coil state points physically meaningless. SHR = 1.000 is a fallback, not a valid result. Cooling capacity (TR) and pipe sizes are still valid.`,
      action: `Set ADP below ${(roomDbF - 2).toFixed(0)}°F in Project Info or via per-AHU override in AHU Config. For rooms below 15°C, use the ADP 'calculated' mode — it will back-calculate ADP from the actual load and supply air conditions.`
    };
  },

  // Low coil SHR — dehumidification duty
  (r) => {
    const shr = parseFloat(r.coil_shr);
    if (!(shr > 0) || shr >= 0.70) return null;
    return {
      level: 'review',
      icon:  '🌫️',
      title: 'Low Sensible Heat Ratio — Dehumidification Duty',
      body:  `Coil SHR of ${r.coil_shr} is below the 0.70 threshold. Standard AHU coils are designed for SHR 0.75–0.85. At this SHR the coil must remove significant moisture — verify coil rows, fin spacing, and face velocity are suitable for dehumidification duty.`,
      action: 'Specify coil for dehumidification duty explicitly. Consider a lower ADP or deeper coil (more rows) to achieve the required SHR at design airflow.'
    };
  },

  // Envelope negative — winter heat loss room
  (r) => {
    if ((r.bd_envelope || 0) >= 0) return null;
    return {
      level: 'info',
      icon:  '❄️',
      title: 'Net Envelope Heat Loss in Peak Season',
      body:  `Envelope gain is negative (${(Math.abs(r.bd_envelope) / 12000).toFixed(2)} TR heat loss). The building envelope is losing more heat to the outside than it gains — this room may require year-round heating even in summer depending on internal loads.`,
      action: 'Verify terminal heating capacity covers peak heat loss conditions. Check that winter heating load in the Results tab is sized for the worst-case condition.'
    };
  },
];

// ── Severity styling ──────────────────────────────────────────────────────────
const SEVERITY_STYLE = {
  critical:    { card: 'bg-red-50    border-red-200',    badge: 'bg-red-100    text-red-700',    label: 'Critical'     },
  opportunity: { card: 'bg-teal-50   border-teal-200',   badge: 'bg-teal-100   text-teal-700',   label: 'Opportunity'  },
  review:      { card: 'bg-amber-50  border-amber-200',  badge: 'bg-amber-100  text-amber-700',  label: 'Review'       },
  info:        { card: 'bg-blue-50   border-blue-200',   badge: 'bg-blue-100   text-blue-700',   label: 'Info'         },
};

// ── InsightsTab ───────────────────────────────────────────────────────────────
const InsightsTab = ({ rdsRow }) => {
  if (!rdsRow) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p className="text-sm">No data available — add room dimensions and loads first.</p>
      </div>
    );
  }

  if (rdsRow._calculationFailed) {
    return (
      <div className="p-8 text-center text-red-400">
        <p className="text-sm font-bold">Calculation failed — fix the error before viewing insights.</p>
        <p className="text-xs mt-1 font-mono">{rdsRow._error}</p>
      </div>
    );
  }

  const total = rdsRow.bd_grandTotal || 1;

  // Separate positive components (cooling loads) from negative (offsets/credits)
  const positiveComponents = LOAD_COMPONENTS.filter(c => (rdsRow[c.key] || 0) > 0);
  const negativeComponents = LOAD_COMPONENTS.filter(c => (rdsRow[c.key] || 0) < 0);
  const positiveTotal      = positiveComponents.reduce((s, c) => s + (rdsRow[c.key] || 0), 0);

  // Generate recommendations
  const recommendations = RECOMMENDATION_RULES
    .map(rule => rule(rdsRow, positiveTotal))
    .filter(Boolean);

  // Sort: critical first, then opportunity, review, info
  const severityOrder = { critical: 0, opportunity: 1, review: 2, info: 3 };
  recommendations.sort((a, b) => (severityOrder[a.level] ?? 9) - (severityOrder[b.level] ?? 9));

  return (
    <div className="space-y-4">

      {/* ── Load Composition ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-2 border-b bg-slate-50 border-slate-200 flex items-center gap-3">
          <span className="w-1 h-5 rounded-full bg-slate-400 shrink-0" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600">
            Load Composition
          </h3>
          <span className="ml-auto text-[10px] font-mono text-slate-400">
            Grand Total: {(total / 12000).toFixed(2)} TR · {total.toLocaleString()} BTU/hr
          </span>
        </div>

        <div className="p-4 space-y-4">

          {/* Stacked bar — positive components only */}
          {positiveTotal > 0 && (
            <div>
              <div className="flex h-7 rounded-lg overflow-hidden gap-px bg-slate-100">
                {positiveComponents.map(c => {
                  const val = rdsRow[c.key] || 0;
                  const pct = (val / positiveTotal) * 100;
                  if (pct < 0.5) return null;
                  return (
                    <div
                      key={c.key}
                      className={`${c.bar} transition-all`}
                      style={{ width: `${pct}%` }}
                      title={`${c.label}: ${pct.toFixed(1)}%`}
                    />
                  );
                })}
              </div>
              {/* Bar legend */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                {positiveComponents.filter(c => (rdsRow[c.key] || 0) > 0).map(c => (
                  <div key={c.key} className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
                    <span className="text-[10px] text-slate-500">{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Breakdown table */}
          <div className="space-y-1.5">
            {LOAD_COMPONENTS.map(c => {
              const val = rdsRow[c.key] || 0;
              if (val === 0) return null;
              const pctOfTotal = Math.abs(val / total) * 100;
              const isNeg = val < 0;
              const barWidth = Math.min(100, Math.abs(val / positiveTotal) * 100);

              return (
                <div key={c.key} className="flex items-center gap-3">
                  <div className="w-20 text-[10px] font-semibold text-slate-500 shrink-0 truncate">
                    {c.label}
                  </div>
                  <div className="flex-1 h-4 bg-slate-50 rounded overflow-hidden">
                    <div
                      className={`h-full rounded transition-all ${isNeg ? 'bg-blue-200' : c.bar} opacity-70`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <div className="w-28 text-right shrink-0">
                    <span className={`text-[11px] font-bold font-mono ${isNeg ? 'text-blue-600' : c.text}`}>
                      {isNeg ? '−' : ''}{Math.abs(val).toLocaleString()}
                    </span>
                    <span className="text-[10px] text-slate-400 ml-1">BTU/hr</span>
                  </div>
                  <div className="w-10 text-right shrink-0">
                    <span className="text-[11px] font-mono text-slate-400">
                      {pctOfTotal.toFixed(0)}%
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Negative offset note */}
            {negativeComponents.length > 0 && (
              <p className="text-[10px] text-blue-600 mt-1 pt-1 border-t border-slate-100">
                Blue bars are heat loss offsets (reduce cooling load).
              </p>
            )}

            {/* Divider + total row */}
            <div className="flex items-center gap-3 pt-2 border-t border-slate-200">
              <div className="w-20 text-[10px] font-bold text-slate-700 shrink-0">Grand Total</div>
              <div className="flex-1" />
              <div className="w-28 text-right shrink-0">
                <span className="text-[11px] font-bold font-mono text-slate-800">
                  {total.toLocaleString()}
                </span>
                <span className="text-[10px] text-slate-400 ml-1">BTU/hr</span>
              </div>
              <div className="w-10 text-right shrink-0">
                <span className="text-[11px] font-bold font-mono text-slate-700">
                  {(total / 12000).toFixed(2)} TR
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Recommendations ──────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-2 border-b bg-slate-50 border-slate-200 flex items-center gap-3">
          <span className="w-1 h-5 rounded-full bg-slate-400 shrink-0" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600">
            Design Recommendations
          </h3>
          <span className="ml-auto text-[10px] font-mono text-slate-400">
            {recommendations.length} item{recommendations.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="p-4 space-y-3">
          {recommendations.length === 0 ? (
            <div className="py-6 text-center">
              <div className="text-2xl mb-2">✅</div>
              <p className="text-sm font-bold text-slate-600">No issues found</p>
              <p className="text-xs text-slate-400 mt-1">
                Load composition and design parameters are within expected ranges.
              </p>
            </div>
          ) : (
            recommendations.map((rec, i) => {
              const style = SEVERITY_STYLE[rec.level] ?? SEVERITY_STYLE.info;
              return (
                <div key={i} className={`rounded-lg border p-4 ${style.card}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-lg shrink-0 mt-0.5" aria-hidden="true">
                      {rec.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${style.badge}`}>
                          {style.label}
                        </span>
                        <span className="text-sm font-bold text-slate-800">{rec.title}</span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed mb-2">{rec.body}</p>
                      <div className="flex items-start gap-1.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide shrink-0 mt-0.5">
                          Action:
                        </span>
                        <p className="text-[11px] text-slate-500 leading-relaxed">{rec.action}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
};

// ── Panel tabs — RDS_CATEGORIES + Insights ────────────────────────────────────
// Defined locally so RDSConfig and RDSPage are not affected.
// RDS_CATEGORIES drives the four existing tabs; Insights is panel-only.
const PANEL_TABS = [
  ...RDS_CATEGORIES,
  { id: 'insights', label: 'Insights', icon: '🎯' },
];

// ── RoomDetailPanel ───────────────────────────────────────────────────────────

export default function RoomDetailPanel({ room, rdsRow, envelope, ahus, onClose }) {
  const dispatch = useDispatch();
  const [activeTab, setActiveTab] = useState('setup');

  const {
    handleRoomUpdate,
    handleEnvUpdate,
    handleAhuChange,
  } = useRdsRow(room?.id, room);

  const handleDelete = useCallback(() => {
    if (window.confirm('Permanently delete this room and all its data?')) {
      dispatch(deleteRoomWithCleanup(room.id));
      onClose();
    }
  }, [dispatch, room, onClose]);

  if (!room) return null;

  const activeSections = RDS_SECTIONS.filter((s) => s.category === activeTab);
  const assignedAhuId  = room.assignedAhuIds?.[0];
  const isAssigned     = Boolean(assignedAhuId && assignedAhuId.trim() !== '');

  const gridCols = activeTab === 'setup' ? 'grid-cols-3' : 'grid-cols-2';

  return (
    <div className="fixed inset-y-0 right-0 w-[820px] bg-white shadow-2xl z-50
                    flex flex-col border-l border-slate-200 overflow-hidden">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="px-6 py-3.5 border-b border-slate-200 bg-white
                      flex justify-between items-start shrink-0">
        <div className="flex-1 min-w-0">

          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Room Editor
            </span>
            {isAssigned && (
              <span className="bg-blue-100 text-blue-700 text-[10px] px-2.5 py-0.5
                               rounded-full font-bold uppercase tracking-wide border border-blue-200">
                Assigned
              </span>
            )}
            {room.atRestClass && (
              <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold
                                border ${isoBadgeClass(room.atRestClass)}`}>
                {room.atRestClass}
              </span>
            )}
            {room.classInOp && room.classInOp !== room.atRestClass && (
              <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold
                                border ${isoBadgeClass(room.classInOp)}`}>
                {room.classInOp} <span className="opacity-60 font-normal">(Op.)</span>
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-3">
            <h2 className="text-xl font-bold text-slate-900 leading-tight truncate">
              {room.name || (
                <span className="text-slate-300 italic font-normal">Unnamed Room</span>
              )}
            </h2>
            {room.roomNo && (
              <span className="text-sm text-slate-400 font-mono shrink-0">
                #{room.roomNo}
              </span>
            )}
          </div>

          {rdsRow && (
            <div className="flex items-center gap-4 mt-1">
              {rdsRow.supplyAir > 0 && (
                <span className="text-xs text-slate-500">
                  <span className="font-bold text-slate-700">
                    {Math.round(rdsRow.supplyAir).toLocaleString()}
                  </span> CFM
                </span>
              )}
              {rdsRow.coolingCapTR > 0 && (
                <span className="text-xs text-slate-500">
                  <span className="font-bold text-blue-600">
                    {parseFloat(rdsRow.coolingCapTR).toFixed(2)}
                  </span> TR
                </span>
              )}
              {room.designTemp != null && (
                <span className="text-xs text-slate-500">
                  <span className="font-bold text-amber-600">{room.designTemp}°C</span>
                  {' / '}
                  <span className="font-bold text-amber-600">{room.designRH}%RH</span>
                </span>
              )}
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          aria-label="Close panel"
          className="ml-4 text-slate-400 hover:text-slate-700
                     bg-slate-50 hover:bg-slate-100 border border-slate-200
                     p-2 rounded-lg transition-all shrink-0"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────── */}
      <div className="flex border-b border-slate-200 px-6 bg-white shrink-0">
        {PANEL_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'true' : undefined}
            className={`
              py-3 px-3 text-xs font-bold uppercase tracking-widest
              border-b-2 transition-all
              flex items-center gap-1.5 whitespace-nowrap
              ${activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-400 hover:text-slate-700 hover:border-slate-300'
              }
            `}
          >
            <span className="text-sm" aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Scrollable content ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 bg-slate-50 space-y-3">

        {/* Insights tab — rendered instead of the section loop */}
        {activeTab === 'insights' ? (
          <InsightsTab rdsRow={rdsRow} />
        ) : (
          activeSections.map((section) => {
            const columnGroups = groupColumnsBySeason(section.columns);
            const palette      = getPalette(section.color);

            return (
              <div
                key={section.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
              >
                <div className={`px-4 py-2 border-b ${palette.header}
                                flex items-center gap-3`}>
                  <span className={`w-1 h-5 rounded-full shrink-0 ${palette.accent}`}
                        aria-hidden="true" />
                  <h3 className={`text-xs font-bold uppercase tracking-widest ${palette.text}`}>
                    {section.title}
                  </h3>
                  <span className="text-[10px] text-slate-400 font-mono ml-auto">
                    {section.columns.length} fields
                  </span>
                </div>

                <div className="p-4 space-y-3">
                  {columnGroups.map(({ groupLabel, columns }, gi) => (
                    <div key={gi}>
                      {groupLabel && (
                        <div className="flex items-center gap-3 mb-4">
                          <SeasonBadge season={groupLabel} />
                          <div className="flex-1 h-px bg-slate-100" />
                        </div>
                      )}

                      <div className={`grid ${gridCols} gap-x-4 gap-y-3`}>
                        {columns.map((col) => {
                          const isWide =
                            col.fullWidth ||
                            col.type === 'select-ahu' ||
                            (col.inputType === 'text' && col.width === 'w-44');

                          return (
                            <div
                              key={col.key}
                              className={isWide ? 'col-span-2' : 'col-span-1'}
                            >
                              <PanelField
                                col={col}
                                room={room}
                                rdsRow={rdsRow}
                                envelope={envelope}
                                ahus={ahus}
                                onRoomUpdate={handleRoomUpdate}
                                onEnvUpdate={handleEnvUpdate}
                                onAhuChange={handleAhuChange}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-t border-slate-200 bg-white
                      flex justify-between items-center shrink-0">
        <button
          onClick={handleDelete}
          className="text-red-500 hover:bg-red-50 border border-transparent
                     hover:border-red-100 px-4 py-2 rounded-lg text-sm
                     font-semibold transition-all"
        >
          Delete Room
        </button>
        <button
          onClick={onClose}
          className="bg-slate-900 text-white px-6 py-2 rounded-lg
                     font-semibold text-sm
                     hover:bg-slate-700 transition-colors shadow-sm"
        >
          Done
        </button>
      </div>
    </div>
  );
}