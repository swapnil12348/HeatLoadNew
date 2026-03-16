/**
 * loadsSections.js
 * RDS category: loads
 * Sections: Internal Loads, Infiltration, Exhaust, Fan Heat,
 *           Fresh Air & Ventilation, Outdoor Air Coil Loads
 */

import { createSeasonColumns } from '../rdsSeasons';

export const LOADS_SECTIONS = [

  // 5. Internal Loads ────────────────────────────────────────────────────────
  {
    id:       'internalLoads',
    title:    'Internal Loads',
    category: 'loads',
    color:    'green',
    columns: [
      {
        key:      'people_count',
        label:    'Occupancy',
        subLabel: 'Nos.',
        isEnv:    true,
        envType:  'people',
        envField: 'count',
      },
      {
        key:      'equipment_kw',
        label:    'Equipment Load',
        subLabel: 'KW',
        isEnv:    true,
        envType:  'equipment',
        envField: 'kw',
        step:     0.1,
      },
    ],
  },

  // 6. Infiltration ──────────────────────────────────────────────────────────
  // totalInfil is the CFM computed by seasonalLoads.js (summer peak).
  // totalExfil, infilWithinSystem etc. are not computed by the logic layer —
  // these are placeholder columns retained for future implementation.
  // NOTE: infilWithinSystem / infilSystem / infilOtherSystem are NOT in
  // roomSlice's initial state and are not read by any calculation module.
  // They are editable ghost fields until the logic layer is extended to use them.
  {
    id:       'infiltration',
    title:    'Infiltration',
    category: 'loads',
    color:    'red',
    columns: [
      { key: 'totalInfil', label: 'Total Infiltration', subLabel: 'CFM', type: 'readOnly', derived: true },
    ],
  },

  // 7. Room Exhaust ──────────────────────────────────────────────────────────
  {
    id:       'exhaust',
    title:    'Room Exhaust',
    category: 'loads',
    color:    'red',
    columns: [
      { key: 'exhaustAir.general', label: 'Ex Fan / ILF',    subLabel: 'CFM' },
      { key: 'exhaustAir.bibo',    label: 'BIBO',            subLabel: 'CFM' },
      { key: 'exhaustAir.machine', label: 'Machine Exhaust', subLabel: 'CFM' },
    ],
  },

  // 8. Fan Heat Gains ────────────────────────────────────────────────────────
  {
    id:       'fanHeat',
    title:    'Fan Heat Gains',
    category: 'loads',
    color:    'orange',
    columns: [
      { key: 'rsh',               label: 'RSH',                              subLabel: 'BTU/hr', type: 'readOnly', derived: true },
      { key: 'supplyFanHeatBlow', label: 'Supply Fan Heat Gain – Blow Thru', subLabel: 'BTU/hr', type: 'readOnly', derived: true },
      { key: 'supplyFanHeatDraw', label: 'Supply Fan Heat Gain – Draw Thru', subLabel: 'KW',     type: 'readOnly', derived: true },
      { key: 'returnFanHeat',     label: 'Return Fan Heat Gain',             subLabel: 'KW',     type: 'readOnly', derived: true },
    ],
  },

  // 9. Fresh Air & Ventilation ───────────────────────────────────────────────
  {
    id:       'freshAir',
    title:    'Fresh Air & Ventilation',
    category: 'loads',
    color:    'teal',
    columns: [
      { key: 'maxPurgeAir',      label: 'Max. Purge Air',                  subLabel: 'CFM', type: 'readOnly', derived: true },
      { key: 'faAshraeAcph',     label: 'FA as per ASHRAE/ACPH & Occ.',    subLabel: 'CFM', type: 'readOnly', derived: true },
      { key: 'minSupplyAcph',    label: 'Min Supply @ 2.5 ACPH',           subLabel: 'CFM', type: 'readOnly', derived: true },
      { key: 'freshAir',         label: 'Fresh Air',                       subLabel: 'CFM', type: 'readOnly', derived: true },
      { key: 'optimisedFreshAir',label: 'Optimised Fresh Air',             subLabel: 'CFM', type: 'readOnly', derived: true },
      { key: 'manualFreshAir',   label: 'Manual Fresh Air for Indv. Room', subLabel: 'CFM' },
      { key: 'freshAirCheck',    label: 'Fresh Air for Indv. Check',       subLabel: 'CFM', type: 'readOnly', derived: true },
      { key: 'minAcph',          label: 'Min ACPH',                        step: 0.1 },
      { key: 'designAcph',       label: 'Design ACPH',                     step: 0.1 },
      { key: 'supplyAirMinAcph', label: 'Supply Air as per Min ACPH',      subLabel: 'CFM', type: 'readOnly', derived: true },
    ],
  },

  // 10. Outdoor Air Coil Loads ───────────────────────────────────────────────
  // Loads imposed on the AHU COIL by conditioning fresh air.
  // Distinct from room infiltration loads (which act on the room directly).
  // Source: outdoorAirLoad.js — enthalpy method, ASHRAE HOF Ch.18
  {
    id:       'oaCoilLoads',
    title:    'Outdoor Air Coil Loads',
    category: 'loads',
    color:    'sky',
    columns: [
      ...createSeasonColumns('oaSensible', 'OA Sensible', 'BTU/hr', { readOnly: true, derived: true }),
      ...createSeasonColumns('oaLatent',   'OA Latent',   'BTU/hr', { readOnly: true, derived: true }),
      ...createSeasonColumns('oaTotal',    'OA Total',    'BTU/hr', { readOnly: true, derived: true }),
    ],
  },
];