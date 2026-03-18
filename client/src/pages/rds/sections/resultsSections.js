/**
 * resultsSections.js
 * RDS category: results
 * Sections: ACES Summary, Consultant Override, Equipment ON/OFF analysis,
 *           Room Grains, Humidification, Achieved Conditions, Terminal Heating
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   ESHF / Required ADP fields added to acesSummary section.
 *
 *     Five new read-only derived fields surface the psychrometric sufficiency
 *     of the CHW plant for each room. Computed by calculateRequiredADP in
 *     psychro.js (v2.3) and exposed by rdsSelector after STEP 4b.
 *
 *     eshf:          Effective Sensible Heat Factor — total sensible / total load.
 *     requiredADP:   Coil surface temperature the room thermodynamically demands
 *                    to control BOTH temperature AND humidity simultaneously
 *                    (ASHRAE HOF 2021 Ch.18 ESHF line method). °F | null.
 *     coil_adp:      Plant ADP — the actual coil surface temperature being used
 *                    (resolved from project default or per-AHU override).
 *     adpGap:        plantADP − requiredADP (°F). Positive = plant too warm,
 *                    humidity control at risk. Null when ESHF not applicable.
 *     adpSufficient: 'yes' | 'marginal' | 'insufficient' | 'no_solution' |
 *                    'not_applicable'. Use for badge colour in UI.
 *
 *     These five fields replace the previously silent gap between what the
 *     plant can achieve and what the room actually needs. For comfort rooms
 *     with high OA latent load (monsoon, tropical climates) this can flag
 *     rooms where no standard cooling coil at any ADP can control humidity —
 *     the most dangerous failure mode currently undetected by load calculations.
 *
 *   (NEW) labels removed from section comments — audit trail complete.
 */

import { createSeasonColumns, createSeasonPairs } from '../rdsSeasons';

export const RESULTS_SECTIONS = [

  // 11. ACES AHU Summary ─────────────────────────────────────────────────────
  {
    id:       'acesSummary',
    title:    'ACES AHU Summary',
    category: 'results',
    color:    'cyan',
    columns: [
      // ── Air quantities ──────────────────────────────────────────────────────
      { key: 'freshAirAces',       label: 'Fresh Air',              subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'dehumidifiedAir',    label: 'Dehumidified Air',       subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'coilAir',            label: 'Coil Air',               subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'bypassAir',          label: 'Bypass Air',             subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'bleedAir',           label: 'Bleed Air',              subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'supplyAir',          label: 'Supply Air',             subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'returnAir',          label: 'Return Air',             subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'ahuCap',             label: 'AHU Capacity',           subLabel: 'CFM',   type: 'readOnly', derived: true },

      // ── Coil performance ────────────────────────────────────────────────────
      { key: 'coolingLoadHL',      label: 'Cooling Load as per HL', subLabel: 'TR',    type: 'readOnly', derived: true },
      { key: 'coolingCapTR',       label: 'Cooling Capacity',       subLabel: 'TR',    type: 'readOnly', derived: true },
      { key: 'coil_shr',           label: 'Coil SHR',               subLabel: '—',     type: 'readOnly', derived: true },
      { key: 'coil_contactFactor', label: 'Contact Factor',         subLabel: '1−BF',  type: 'readOnly', derived: true },

      // ── CHW system ──────────────────────────────────────────────────────────
      { key: 'chwFlowRate',        label: 'CHW Flow Rate',          subLabel: 'USGPM', type: 'readOnly', derived: true },
      { key: 'chwBranchSize',      label: 'CHW Branch Size',        subLabel: 'DN mm', type: 'readOnly', derived: true },
      { key: 'chwManifoldSize',    label: 'CHW Manifold Size',      subLabel: 'DN mm', type: 'readOnly', derived: true },

      // ── Heating system ──────────────────────────────────────────────────────
      { key: 'heatingCap',         label: 'Heating Capacity',       subLabel: 'KW',    type: 'readOnly', derived: true },
      { key: 'heatingCapMBH',      label: 'Heating Capacity',       subLabel: 'MBH',   type: 'readOnly', derived: true },
      { key: 'terminalHeatingCap', label: 'Terminal Heating Cap.',  subLabel: 'KW',    type: 'readOnly', derived: true },
      { key: 'extraHeatingCap',    label: '+10% Heating Cap.',      subLabel: 'KW',    type: 'readOnly', derived: true },

      // ── HW system ───────────────────────────────────────────────────────────
      { key: 'hwFlowRate',         label: 'HW Flow Rate',           subLabel: 'USGPM', type: 'readOnly', derived: true },
      { key: 'hwBranchSize',       label: 'HW Branch Size',         subLabel: 'DN mm', type: 'readOnly', derived: true },
      { key: 'hwManifoldSize',     label: 'HW Manifold Size',       subLabel: 'DN mm', type: 'readOnly', derived: true },

      // ── OA preheat coil ─────────────────────────────────────────────────────
      { key: 'preheatCap',         label: 'OA Preheat Capacity',    subLabel: 'KW',    type: 'readOnly', derived: true },
      { key: 'preheatHwFlow',      label: 'Preheat HW Flow',        subLabel: 'USGPM', type: 'readOnly', derived: true },
      { key: 'preheatBranchSize',  label: 'Preheat Branch Size',    subLabel: 'DN mm', type: 'readOnly', derived: true },

      // ── ESHF / Required ADP psychrometric sufficiency ────────────────────────
      //
      // These five fields answer: "Can the CHW plant simultaneously control
      // BOTH temperature AND humidity for this room under peak conditions?"
      //
      // requiredADP is derived from the ESHF line intersection with the
      // saturation curve (ASHRAE HOF 2021 Ch.18). It is the minimum coil
      // surface temperature needed for simultaneous temp + humidity control.
      //
      // Comparing it against coil_adp (plant ADP) reveals the gap:
      //   adpGap > 0  → plant too warm → humidity may not be controlled
      //   adpGap ≤ 0  → plant sufficient → adequate margin
      //   null        → not applicable (sensible-only room or desiccant system)
      //
      // adpSufficient badge colours:
      //   'yes'            → green  — plant adequate
      //   'marginal'       → amber  — ≤ 3°F margin, verify coil selection
      //   'insufficient'   → red    — plant too warm, humidity risk
      //   'no_solution'    → red    — no standard coil can control humidity
      //   'not_applicable' → grey   — sensible-only or desiccant room
      { key: 'eshf',          label: 'ESHF',            subLabel: '—',   type: 'readOnly', derived: true },
      { key: 'requiredADP',   label: 'Required ADP',    subLabel: '°F',  type: 'readOnly', derived: true },
      { key: 'coil_adp',      label: 'Plant ADP',       subLabel: '°F',  type: 'readOnly', derived: true },
      { key: 'adpGap',        label: 'ADP Gap',         subLabel: '°F',  type: 'readOnly', derived: true },
      { key: 'adpSufficient', label: 'Humidity Control',subLabel: '—',   type: 'readOnly', derived: true },

      // ── Pre-cooling coil ─────────────────────────────────────────────────────
      // NOTE: preCoolingAhuCap / preCoolChwFlow / preCoolChwManifold are not
      // computed by rdsSelector and will display 0 until the logic layer is
      // extended to calculate pre-cooling coil values.
      { key: 'preCoolingAhuCap',    label: 'Pre-Cooling AHU Cap.',     subLabel: 'CFM',   type: 'readOnly', derived: true },
      { key: 'preCoolChwFlow',      label: 'Pre-Cooling CHW Flow',     subLabel: 'USGPM', type: 'readOnly', derived: true },
      { key: 'preCoolChwManifold',  label: 'Pre-Cooling CHW Manifold', subLabel: 'DN mm', type: 'readOnly', derived: true },
    ],
  },

  // 12. Consultant AHU Summary (Override) ───────────────────────────────────
  // These fields are editable engineer overrides stored as ad-hoc fields on
  // the room state. They are not read by any calculation module — they exist
  // for manual override documentation in the final deliverable.
  {
    id:       'consultantSummary',
    title:    'Consultant AHU Summary (Override)',
    category: 'results',
    color:    'indigo',
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

  // 13. Room Analysis — Equipment ON ────────────────────────────────────────
  // ERLH columns included — latent load is computed by seasonalLoads.js
  // and must be visible to the engineer for coil SHR verification.
  {
    id:       'analysisEquipOn',
    title:    'Room Analysis — Equipment ON',
    category: 'results',
    color:    'yellow',
    columns: [
      ...createSeasonColumns('ershOn',   'ERSH',         'BTU/hr', { readOnly: true, derived: true }),
      ...createSeasonColumns('erlhOn',   'ERLH',         'BTU/hr', { readOnly: true, derived: true }),
      ...createSeasonColumns('pickupOn', 'Room Pick-up', 'Deg.F',  { readOnly: true, derived: true }),
    ],
  },

  // 14. Room Analysis — Equipment OFF ───────────────────────────────────────
  {
    id:       'analysisEquipOff',
    title:    'Room Analysis — Equipment OFF',
    category: 'results',
    color:    'amber',
    columns: [
      ...createSeasonColumns('ershOff',   'ERSH',         'BTU/hr', { readOnly: true, derived: true }),
      ...createSeasonColumns('erlhOff',   'ERLH',         'BTU/hr', { readOnly: true, derived: true }),
      ...createSeasonColumns('pickupOff', 'Room Pick-up', 'Deg.F',  { readOnly: true, derived: true }),
    ],
  },

  // 15. Room Grains ──────────────────────────────────────────────────────────
  {
    id:       'roomGrains',
    title:    'Room Grains',
    category: 'results',
    color:    'lime',
    columns: [
      ...createSeasonColumns('grains', 'Room Grains', 'gr/lb', { readOnly: true, derived: true }),
    ],
  },

  // 16. Winter Humidification ────────────────────────────────────────────────
  // Dominant load in pharma, semiconductor, and battery dry rooms.
  // Source: heatingHumid.js — isothermal steam basis, ASHRAE HVAC S&E Ch.22
  // mixedAirGr included: mixed-air entering the humidifier — critical
  // diagnostic for recirculation systems where grReturn > grOutdoor.
  {
    id:       'humidification',
    title:    'Winter Humidification',
    category: 'results',
    color:    'blue',
    columns: [
      { key: 'winterGrOut',   label: 'Outdoor Winter Grains', subLabel: 'gr/lb',  type: 'readOnly', derived: true },
      { key: 'mixedAirGr',    label: 'Mixed Air Grains',      subLabel: 'gr/lb',  type: 'readOnly', derived: true },
      { key: 'humidGrTarget', label: 'Target Indoor Grains',  subLabel: 'gr/lb',  type: 'readOnly', derived: true },
      { key: 'humidDeltaGr',  label: 'Δ Grains to Add',       subLabel: 'gr/lb',  type: 'readOnly', derived: true },
      { key: 'humidLbsPerHr', label: 'Water Mass Flow',       subLabel: 'lb/hr',  type: 'readOnly', derived: true },
      { key: 'humidKw',       label: 'Humidifier Power',      subLabel: 'kW',     type: 'readOnly', derived: true },
      { key: 'humidLoadBTU',  label: 'Humidification Load',   subLabel: 'BTU/hr', type: 'readOnly', derived: true },
    ],
  },

  // 17. Achieved Room Conditions — Equipment ON ─────────────────────────────
  {
    id:       'achievedEquipOn',
    title:    'Achieved Room Conditions — Equip ON',
    category: 'results',
    color:    'green',
    columns:  createSeasonPairs('achOn', 'Temp', 'RH', '°F', '%', { readOnly: true, derived: true }),
  },

  // 18. Achieved Room Conditions — Equipment OFF ────────────────────────────
  {
    id:       'achievedEquipOff',
    title:    'Achieved Room Conditions — Equip OFF',
    category: 'results',
    color:    'rose',
    columns:  createSeasonPairs('achOff', 'Temp', 'RH', '°F', '%', { readOnly: true, derived: true }),
  },

  // 19. Terminal Heater KW — Equipment ON ───────────────────────────────────
  {
    id:       'terminalHeatEquipOn',
    title:    'Terminal Heater KW — Equip ON',
    category: 'results',
    color:    'purple',
    columns:  createSeasonColumns('termHeatOn', 'Terminal KW', 'KW', { readOnly: true, derived: true }),
  },

  // 20. Achieved After Terminal Heating — Equipment ON ──────────────────────
  {
    id:       'achievedAfterTerminalOn',
    title:    'Achieved after Terminal Heating — Equip ON',
    category: 'results',
    color:    'purple',
    columns:  createSeasonPairs('achTermOn', 'Temp', 'RH', '°F', '%', { readOnly: true, derived: true }),
  },

  // 21. Terminal Heater KW — Equipment OFF ──────────────────────────────────
  {
    id:       'terminalHeatEquipOff',
    title:    'Terminal Heater KW — Equip OFF',
    category: 'results',
    color:    'pink',
    columns:  createSeasonColumns('termHeatOff', 'Terminal KW', 'KW', { readOnly: true, derived: true }),
  },

  // 22. Achieved After Terminal Heating — Equipment OFF ─────────────────────
  {
    id:       'achievedAfterTerminalOff',
    title:    'Achieved after Terminal Heating — Equip OFF',
    category: 'results',
    color:    'pink',
    columns:  createSeasonPairs('achTermOff', 'Temp', 'RH', '°F', '%', { readOnly: true, derived: true }),
  },
];