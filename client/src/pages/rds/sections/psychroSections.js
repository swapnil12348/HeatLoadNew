/**
 * psychroSections.js
 * RDS category: psychro
 * Sections: Ambient, Fresh Air, Return Air, Supply Air, Mixed Air, Coil Leaving
 * All values are read-only derived from psychroStatePoints.js
 */

import { createPsychroColumns, createReturnAirColumns } from '../rdsSeasons';

export const PSYCHRO_SECTIONS = [

  // 23. Ambient Conditions ───────────────────────────────────────────────────
  {
    id:       'psyAmbient',
    title:    'Ambient Conditions',
    category: 'psychro',
    color:    'orange',
    columns:  createPsychroColumns('amb', { readOnly: true, derived: true }),
  },

  // 24. Fresh Air Conditions ─────────────────────────────────────────────────
  {
    id:       'psyFreshAir',
    title:    'Fresh Air Conditions',
    category: 'psychro',
    color:    'sky',
    columns:  createPsychroColumns('fa', { readOnly: true, derived: true }),
  },

  // 25. Return Air Conditions ────────────────────────────────────────────────
  // Uses createReturnAirColumns — no enthalpy column (return air is room setpoint,
  // enthalpy is redundant with DB + gr which are already displayed)
  {
    id:       'psyReturnAir',
    title:    'Return Air Conditions',
    category: 'psychro',
    color:    'violet',
    columns:  createReturnAirColumns('ra', { readOnly: true, derived: true }),
  },

  // 26. Supply Air Conditions ────────────────────────────────────────────────
  {
    id:       'psySupplyAir',
    title:    'Supply Air Conditions',
    category: 'psychro',
    color:    'cyan',
    columns:  createPsychroColumns('sa', { readOnly: true, derived: true }),
  },

  // 27. Mixed Air Conditions ─────────────────────────────────────────────────
  {
    id:       'psyMixedAir',
    title:    'Mixed Air Conditions',
    category: 'psychro',
    color:    'teal',
    columns:  createPsychroColumns('ma', { readOnly: true, derived: true }),
  },

  // 28. Coil Leaving Air Conditions ──────────────────────────────────────────
  // DB = WB = ADP at saturation — all seasons identical unless ADP changes
  {
    id:       'psyCoilAir',
    title:    'Coil Leaving Air Conditions',
    category: 'psychro',
    color:    'blue',
    columns:  createPsychroColumns('coilLeave', { readOnly: true, derived: true }),
  },
];