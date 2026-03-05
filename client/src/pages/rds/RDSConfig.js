// ══════════════════════════════════════════════════════════════════════════════
// RDSConfig.js
// Single source of truth for every column in the Room Data Sheet.
//
// Column shape:
//  key        — unique field key; dot-notation (e.g. "exhaustAir.general")
//               resolves nested room state via getFieldValue / updateField helpers
//  label      — primary header text
//  subLabel   — secondary unit/note (shown in parens)
//  type       — 'number' (default) | 'text' | 'readOnly' | 'select' | 'select-ahu' | 'actions'
//  inputType  — HTML input type override ('text' for string inputs)
//  isEnv      — true → dispatches to envelopeSlice instead of roomSlice
//  envType    — envelope sub-slice key ('people' | 'equipment' | 'lights')
//  envField   — envelope sub-key ('count' | 'kw' | …)
//  derived    — true → value is computed; pair with type:'readOnly'
//  step       — number input step attribute
//  width      — Tailwind width class for the column
//  sticky     — 'left-0' | 'left-8' etc. for sticky positioning
//  seasonLabel— auto-set by helpers (displayed as coloured badge)
//  options    — array of strings for type:'select'
//  color      — Tailwind colour name used for section header tinting
// ══════════════════════════════════════════════════════════════════════════════

import {
  createSeasonColumns,
  createSeasonPairs,
  createPsychroColumns,
  createReturnAirColumns,
} from './rdsSeasons';

// ── Shared option lists ────────────────────────────────────────────────────

const ISO_OPTIONS = ['ISO 5', 'ISO 6', 'ISO 7', 'ISO 8', 'CNC', 'Unclassified'];

// ══════════════════════════════════════════════════════════════════════════════
// RDS_SECTIONS
// ══════════════════════════════════════════════════════════════════════════════

export const RDS_SECTIONS = [

  // ══════════════════════════════════════════════════════════════════════════
  // CATEGORY: setup
  // ══════════════════════════════════════════════════════════════════════════

  // 1. Identification ────────────────────────────────────────────────────────
  {
    id: 'identification',
    title: 'Identification',
    category: 'setup',
    color: 'gray',
    columns: [
      {
        key: 'ahuId',
        label: 'System Name / No.',
        subLabel: 'AHU',
        type: 'select-ahu',
        sticky: 'left-8',
        width: 'w-32',
      },
      { key: 'typeOfUnit', label: 'Type of Unit', inputType: 'text', width: 'w-28' },
      { key: 'roomNo',     label: 'Room No.',     inputType: 'text', width: 'w-20' },
      { key: 'name',       label: 'Room Name',    inputType: 'text', width: 'w-44' },
    ],
  },

  // 2. Room Geometry ─────────────────────────────────────────────────────────
  {
    id: 'geometry',
    title: 'Room Geometry',
    category: 'setup',
    color: 'blue',
    columns: [
      { key: 'length',    label: 'Length',              subLabel: 'm'   },
      { key: 'width',     label: 'Width',               subLabel: 'm'   },
      { key: 'height',    label: 'Ht.',                 subLabel: 'm'   },
      { key: 'floorArea', label: 'Area as per Layout',  subLabel: 'm²',  type: 'readOnly', derived: true },
      { key: 'volume',    label: 'Volume',              subLabel: 'm³',  type: 'readOnly', derived: true },
      { key: 'volFaPct',  label: 'Room wise Vol. %age', subLabel: 'FA Opt', step: 0.01 },
    ],
  },

  // 3. Design Conditions ─────────────────────────────────────────────────────
  {
    id: 'design',
    title: 'Design Conditions',
    category: 'setup',
    color: 'amber',
    columns: [
      { key: 'designTemp', label: 'Temp.',              subLabel: '°C' },
      { key: 'designRH',   label: 'R.H.',               subLabel: '%'  },
      { key: 'pressure',   label: 'Room Abs. Pressure', subLabel: 'Pa' },
    ],
  },

  // 4. Classification ────────────────────────────────────────────────────────
  {
    id: 'classification',
    title: 'Classification',
    category: 'setup',
    color: 'purple',
    columns: [
      { key: 'classInOp',  label: 'ISO Class', subLabel: 'In Operation', type: 'select', options: ISO_OPTIONS, width: 'w-28' },
      { key: 'atRestClass', label: 'ISO Class', subLabel: 'At Rest',      type: 'select', options: ISO_OPTIONS, width: 'w-28' },
      { key: 'recOt',      label: 'REC. / OT', type: 'select', options: ['REC', 'OT'],   width: 'w-20' },
      { key: 'flpType',    label: 'FLP / NFLP', type: 'select', options: ['FLP', 'NFLP'], width: 'w-20' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CATEGORY: loads
  // ══════════════════════════════════════════════════════════════════════════

  // 5. Internal Loads ────────────────────────────────────────────────────────
  {
    id: 'internalLoads',
    title: 'Internal Loads',
    category: 'loads',
    color: 'green',
    columns: [
      { key: 'people_count',  label: 'Occupancy',      subLabel: 'Nos.', isEnv: true, envType: 'people',    envField: 'count' },
      { key: 'equipment_kw',  label: 'Equipment Load', subLabel: 'KW',   isEnv: true, envType: 'equipment', envField: 'kw', step: 0.1 },
    ],
  },

  // 6. Infiltration / Exfiltration ───────────────────────────────────────────
  {
    id: 'infiltration',
    title: 'Infiltration / Exfiltration',
    category: 'loads',
    color: 'red',
    columns: [
      { key: 'totalInfil',          label: 'Total Infil',                    subLabel: 'CFM', type: 'readOnly', derived: true },
      { key: 'totalExfil',          label: 'Total Exfil',                    subLabel: 'CFM', type: 'readOnly', derived: true },
      { key: 'infilWithinSystem',   label: 'Infil/Exfil Within System',      subLabel: 'CFM (-ve=Infil)' },
      { key: 'infilSystem',         label: 'Infil/Exfil System',             subLabel: 'CFM (-ve=Infil)' },
      { key: 'infilOtherSystem',    label: 'Infil/Exfil Other System',       subLabel: 'CFM (-ve=Infil)' },
    ],
  },

  // 7. Room Exhaust ──────────────────────────────────────────────────────────
  {
    id: 'exhaust',
    title: 'Room Exhaust',
    category: 'loads',
    color: 'red',
    columns: [
      { key: 'exhaustAir.general', label: 'Ex Fan / ILF',    subLabel: 'CFM' },
      { key: 'exhaustAir.bibo',    label: 'BIBO',            subLabel: 'CFM' },
      { key: 'exhaustAir.machine', label: 'Machine Exhaust', subLabel: 'CFM' },
    ],
  },

  // 8. Fan Heat Gains ────────────────────────────────────────────────────────
  {
    id: 'fanHeat',
    title: 'Fan Heat Gains',
    category: 'loads',
    color: 'orange',
    columns: [
      { key: 'rsh',               label: 'RSH',                              type: 'readOnly', derived: true },
      { key: 'supplyFanHeatBlow', label: 'Supply Fan Heat Gain – Blow Thru', subLabel: 'BTUH', type: 'readOnly', derived: true },
      { key: 'supplyFanHeatDraw', label: 'Supply Fan Heat Gain – Draw Thru', subLabel: 'KW',   type: 'readOnly', derived: true },
      { key: 'returnFanHeat',     label: 'Return Fan Heat Gain',             subLabel: 'KW',   type: 'readOnly', derived: true },
    ],
  },

  // 9. Fresh Air & Ventilation ───────────────────────────────────────────────
  {
    id: 'freshAir',
    title: 'Fresh Air & Ventilation',
    category: 'loads',
    color: 'teal',
    columns: [
      { key: 'maxPurgeAir',       label: 'Max. Purge Air',                  subLabel: 'CFM', type: 'readOnly', derived: true },
      { key: 'faAshraeAcph',      label: 'FA as per ASHRAE/ACPH & Occ.',    type: 'readOnly', derived: true },
      { key: 'fa25Acph',          label: 'Fresh Air @ 2.5 ACPH',            subLabel: 'CFM', type: 'readOnly', derived: true },
      { key: 'freshAir',          label: 'Fresh Air',                       subLabel: 'CFM', type: 'readOnly', derived: true },
      { key: 'optimisedFreshAir', label: 'Optimised Fresh Air',             subLabel: 'CFM', type: 'readOnly', derived: true },
      { key: 'manualFreshAir',    label: 'Manual Fresh Air for Indv. Room', subLabel: 'CFM' },
      { key: 'freshAirCheck',     label: 'Fresh Air for Indv. Check',       subLabel: 'CFM', type: 'readOnly', derived: true },
      { key: 'minAcph',           label: 'Min ACPH',                        step: 0.1 },
      { key: 'designAcph',        label: 'Design ACPH',                     step: 0.1 },
      { key: 'supplyAirMinAcph',  label: 'Supply Air as per Min ACPH',      subLabel: 'CFM', type: 'readOnly', derived: true },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CATEGORY: results
  // ══════════════════════════════════════════════════════════════════════════

  // 10. ACES AHU Summary ─────────────────────────────────────────────────────
  {
    id: 'acesSummary',
    title: 'ACES AHU Summary',
    category: 'results',
    color: 'cyan',
    columns: [
      { key: 'freshAirAces',       label: 'Fresh Air',                       subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'dehumidifiedAir',    label: 'Dehumidified Air',                subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'coilAir',            label: 'Coil Air',                        subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'bypassAir',          label: 'Bypass Air',                      subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'bleedAir',           label: 'Bleed Air',                       subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'coolingLoadHL',      label: 'Cooling Load as per HL',          subLabel: 'TR',    type: 'readOnly', derived: true },
      { key: 'coolingCapTR',       label: 'Cooling Capacity',                subLabel: 'TR',    type: 'readOnly', derived: true },
      { key: 'chwFlowRate',        label: 'Chilled Water Flow Rate',         subLabel: 'USGPM', type: 'readOnly', derived: true },
      { key: 'chwManifoldSize',    label: 'CHW Manifold Size',               subLabel: 'mm',    type: 'readOnly', derived: true },
      { key: 'heatingCap',         label: 'Heating Capacity',                subLabel: 'KW',    type: 'readOnly', derived: true },
      { key: 'hwFlowRate',         label: 'Hot Water Flow Rate',             subLabel: 'USGPM', type: 'readOnly', derived: true },
      { key: 'hwManifoldSize',     label: 'HW Manifold Size',                subLabel: 'MM',    type: 'readOnly', derived: true },
      { key: 'ahuCap',             label: 'AHU Capacity',                    subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'terminalHeatingCap', label: 'Terminal Heating Capacity',       subLabel: 'KW',    type: 'readOnly', derived: true },
      { key: 'extraHeatingCap',    label: '10% Extra Heating Capacity',      subLabel: 'KW',    type: 'readOnly', derived: true },
      { key: 'preCoolingAhuCap',   label: 'Pre-Cooling AHU Capacity',        subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'preCoolChwFlow',     label: 'Pre-Cooling Coil CHW Flow Rate',  subLabel: 'USGPM', type: 'readOnly', derived: true },
      { key: 'preCoolChwManifold', label: 'Pre-Cooling Coil CHW Manifold',   subLabel: 'MM',    type: 'readOnly', derived: true },
      { key: 'supplyAir',          label: 'Supply Air',                      subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'returnAir',          label: 'Return Air',                      subLabel: 'CFM',   type: 'readOnly', derived: true },
    ],
  },

  // 11. Consultant AHU Summary (Override) ───────────────────────────────────
  {
    id: 'consultantSummary',
    title: 'Consultant AHU Summary (Override)',
    category: 'results',
    color: 'indigo',
    columns: [
      { key: 'cSupplyAir',    label: 'Supply Air',                subLabel: 'CFM' },
      { key: 'cReturnAir',    label: 'Return Air',                subLabel: 'CFM' },
      { key: 'cFreshAir',     label: 'Fresh Air',                 subLabel: 'CFM' },
      { key: 'cDehumidAir',   label: 'Dehumidified Air',          subLabel: 'CFM' },
      { key: 'cCoilAir',      label: 'Coil Air',                  subLabel: 'CFM' },
      { key: 'cBypassAir',    label: 'Bypass Air',                subLabel: 'CFM' },
      { key: 'cBleedAir',     label: 'Bleed Air',                 subLabel: 'CFM' },
      { key: 'cCoolingCap',   label: 'Cooling Capacity',          subLabel: 'TR'  },
      { key: 'cHeatingCap',   label: 'Heating Capacity',          subLabel: 'KW'  },
      { key: 'cAhuCap',       label: 'AHU Capacity',              subLabel: 'CFM' },
      { key: 'cTerminalHeat', label: 'Terminal Heating Capacity', subLabel: 'KW'  },
      { key: 'cExtraHeat',    label: '10% Extra Heating Cap',     subLabel: 'KW'  },
      { key: 'cPreCoolCap',   label: 'Pre-Cooling Coil Capacity', subLabel: 'TR'  },
      { key: 'remark',        label: 'Remark', inputType: 'text', width: 'w-40'   },
    ],
  },

  // 12. Room Analysis – Equipment ON ────────────────────────────────────────
  {
    id: 'analysisEquipOn',
    title: 'Room Analysis — Equipment ON',
    category: 'results',
    color: 'yellow',
    columns: [
      ...createSeasonColumns('ershOn',   'ERSH',         'BTU/Hr', { readOnly: true, derived: true }),
      ...createSeasonColumns('pickupOn', 'Room Pick-up', 'Deg.F',  { readOnly: true, derived: true }),
    ],
  },

  // 13. Room Analysis – Equipment OFF ───────────────────────────────────────
  {
    id: 'analysisEquipOff',
    title: 'Room Analysis — Equipment OFF',
    category: 'results',
    color: 'amber',
    columns: [
      ...createSeasonColumns('ershOff',   'ERSH',         'BTU/Hr', { readOnly: true, derived: true }),
      ...createSeasonColumns('pickupOff', 'Room Pick-up', 'Deg.F',  { readOnly: true, derived: true }),
    ],
  },

  // 14. Room Grains ──────────────────────────────────────────────────────────
  {
    id: 'roomGrains',
    title: 'Room Grains',
    category: 'results',
    color: 'lime',
    columns: [
      ...createSeasonColumns('grains', 'Room Grains', 'gr/lb', { readOnly: true, derived: true }),
    ],
  },

  // 15. Achieved Room Conditions – Equipment ON ─────────────────────────────
  {
    id: 'achievedEquipOn',
    title: 'Achieved Room Conditions — Equip ON',
    category: 'results',
    color: 'green',
    columns: [
      ...createSeasonPairs('achOn', 'Temp', 'RH', '°F', '%', { readOnly: true, derived: true }),
    ],
  },

  // 16. Achieved Room Conditions – Equipment OFF ────────────────────────────
  {
    id: 'achievedEquipOff',
    title: 'Achieved Room Conditions — Equip OFF',
    category: 'results',
    color: 'rose',
    columns: [
      ...createSeasonPairs('achOff', 'Temp', 'RH', '°F', '%', { readOnly: true, derived: true }),
    ],
  },

  // 17. Terminal Heater KW – Equipment ON ───────────────────────────────────
  {
    id: 'terminalHeatEquipOn',
    title: 'Terminal Heater KW — Equip ON',
    category: 'results',
    color: 'purple',
    columns: [
      ...createSeasonColumns('termHeatOn', 'Terminal KW', 'KW', { readOnly: true, derived: true }),
    ],
  },

  // 18. Achieved After Terminal Heating – Equipment ON ──────────────────────
  {
    id: 'achievedAfterTerminalOn',
    title: 'Achieved after Terminal Heating — Equip ON',
    category: 'results',
    color: 'purple',
    columns: [
      ...createSeasonPairs('achTermOn', 'Temp', 'RH', '°F', '%', { readOnly: true, derived: true }),
    ],
  },

  // 19. Terminal Heater KW – Equipment OFF ──────────────────────────────────
  {
    id: 'terminalHeatEquipOff',
    title: 'Terminal Heater KW — Equip OFF',
    category: 'results',
    color: 'pink',
    columns: [
      ...createSeasonColumns('termHeatOff', 'Terminal KW', 'KW', { readOnly: true, derived: true }),
    ],
  },

  // 20. Achieved After Terminal Heating – Equipment OFF ─────────────────────
  {
    id: 'achievedAfterTerminalOff',
    title: 'Achieved after Terminal Heating — Equip OFF',
    category: 'results',
    color: 'pink',
    columns: [
      ...createSeasonPairs('achTermOff', 'Temp', 'RH', '°F', '%', { readOnly: true, derived: true }),
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CATEGORY: psychro
  // ══════════════════════════════════════════════════════════════════════════

  // 21. Ambient Conditions ───────────────────────────────────────────────────
  {
    id: 'psyAmbient',
    title: 'Ambient Conditions',
    category: 'psychro',
    color: 'orange',
    columns: createPsychroColumns('amb', { readOnly: true, derived: true }),
  },

  // 22. Fresh Air Conditions ─────────────────────────────────────────────────
  {
    id: 'psyFreshAir',
    title: 'Fresh Air Conditions',
    category: 'psychro',
    color: 'sky',
    columns: createPsychroColumns('fa', { readOnly: true, derived: true }),
  },

  // 23. Return Air Conditions ────────────────────────────────────────────────
  {
    id: 'psyReturnAir',
    title: 'Return Air Conditions',
    category: 'psychro',
    color: 'violet',
    columns: createReturnAirColumns('ra', { readOnly: true, derived: true }),
  },

  // 24. Supply Air Conditions ────────────────────────────────────────────────
  {
    id: 'psySupplyAir',
    title: 'Supply Air Conditions',
    category: 'psychro',
    color: 'cyan',
    columns: createPsychroColumns('sa', { readOnly: true, derived: true }),
  },

  // 25. Mixed Air Conditions ─────────────────────────────────────────────────
  {
    id: 'psyMixedAir',
    title: 'Mixed Air Conditions',
    category: 'psychro',
    color: 'teal',
    columns: createPsychroColumns('ma', { readOnly: true, derived: true }),
  },

  // 26. Coil Leaving Air Conditions ──────────────────────────────────────────
  {
    id: 'psyCoilAir',
    title: 'Coil Leaving Air Conditions',
    category: 'psychro',
    color: 'blue',
    columns: createPsychroColumns('coilLeave', { readOnly: true, derived: true }),
  },
];

// ══════════════════════════════════════════════════════════════════════════════
// Derived utilities
// ══════════════════════════════════════════════════════════════════════════════

/** Flat map of ALL column definitions, keyed by col.key */
export const RDS_COLUMNS_MAP = Object.fromEntries(
  RDS_SECTIONS.flatMap((s) =>
    s.columns.map((c) => [c.key, { ...c, sectionId: s.id, category: s.category }])
  )
);

/** Keys of every column that dispatches to envelopeSlice */
export const ENV_COLUMN_KEYS = RDS_SECTIONS
  .flatMap((s) => s.columns)
  .filter((c) => c.isEnv)
  .map((c) => c.key);

/** All sections belonging to a given category */
export const getSectionsByCategory = (category) =>
  RDS_SECTIONS.filter((s) => s.category === category);

/** Category tab manifest (used to render tab bar) */
export const RDS_CATEGORIES = [
  { id: 'setup',   label: 'Setup',           icon: '⚙️' },
  { id: 'loads',   label: 'Loads & Exhaust', icon: '🔥' },
  { id: 'results', label: 'Results',          icon: '📊' },
  { id: 'psychro', label: 'Psychrometrics',   icon: '🌡️' },
];

// ══════════════════════════════════════════════════════════════════════════════
// Re-export field utils so all existing consumers keep working unchanged.
// RDSRow and RoomDetailPanel import these from 'RDSConfig' — that still works.
// ══════════════════════════════════════════════════════════════════════════════
export { getFieldValue, buildRoomUpdate } from './rdsFieldUtils';