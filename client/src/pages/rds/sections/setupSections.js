/**
 * setupSections.js
 * RDS category: setup
 * Sections: Identification, Room Geometry, Design Conditions, Classification
 */

import { ISO_CLASS_OPTIONS }              from '../../../constants/isoCleanroom';
import { VENTILATION_CATEGORY_OPTIONS }   from '../../../constants/ventilation';

// VENTILATION_CATEGORY_OPTIONS is imported directly from ventilation.js rather
// than defined locally. This guarantees the dropdown stays in sync with
// the ventilation calculation layer — any new category added to ventilation.js
// automatically appears here without a manual update.
//
// The previous local definition only listed 4 categories and was missing
// 'battery-leadacid', causing lead-acid rooms to silently use Li-ion
// ventilation parameters (10 ACPH instead of 12 ACPH, ra=0.18 instead of 1.0).

export const SETUP_SECTIONS = [

  // 1. Identification ────────────────────────────────────────────────────────
  {
    id:       'identification',
    title:    'Identification',
    category: 'setup',
    color:    'gray',
    columns: [
      {
        key:      'ahuId',
        label:    'System Name / No.',
        subLabel: 'AHU',
        type:     'select-ahu',
        sticky:   'left-8',
        width:    'w-32',
      },
      {
        // typeOfUnit is assembled by rdsSelector from ahu.type.
        // It is derived — any manual edit would be silently overwritten
        // on the next selector recompute. Rendered read-only accordingly.
        key:       'typeOfUnit',
        label:     'Type of Unit',
        inputType: 'text',
        type:      'readOnly',
        derived:   true,
        width:     'w-28',
      },
      { key: 'roomNo', label: 'Room No.', inputType: 'text', width: 'w-20' },
      { key: 'name',   label: 'Room Name', inputType: 'text', width: 'w-44' },
    ],
  },

  // 2. Room Geometry ─────────────────────────────────────────────────────────
  // length/width/height stored in m (roomSlice SI).
  // floorArea and volume are converted to ft²/ft³ by rdsSelector (CRIT-RDS-01 FIX)
  // and written back to the RDS row — subLabels reflect the displayed unit.
  {
    id:       'geometry',
    title:    'Room Geometry',
    category: 'setup',
    color:    'blue',
    columns: [
      { key: 'length',    label: 'Length',              subLabel: 'm'       },
      { key: 'width',     label: 'Width',               subLabel: 'm'       },
      { key: 'height',    label: 'Ht.',                 subLabel: 'm'       },
      { key: 'floorArea', label: 'Area as per Layout',  subLabel: 'ft²',    type: 'readOnly', derived: true },
      { key: 'volume',    label: 'Volume',              subLabel: 'ft³',    type: 'readOnly', derived: true },
      { key: 'volFaPct',  label: 'Room wise Vol. %age', subLabel: 'FA Opt', step: 0.01 },
    ],
  },

  // 3. Design Conditions ─────────────────────────────────────────────────────
  {
    id:       'design',
    title:    'Design Conditions',
    category: 'setup',
    color:    'amber',
    columns: [
      { key: 'designTemp', label: 'Temp.',              subLabel: '°C' },
      { key: 'designRH',   label: 'R.H.',               subLabel: '%'  },
      { key: 'pressure',   label: 'Room Abs. Pressure', subLabel: 'Pa' },
      {
        key:      'ventCategory',
        label:    'Vent. Category',
        subLabel: 'ASHRAE 62.1',
        type:     'select',
        options:  VENTILATION_CATEGORY_OPTIONS,
        width:    'w-48',
      },
    ],
  },

  // 4. Classification ────────────────────────────────────────────────────────
  {
    id:       'classification',
    title:    'Classification',
    category: 'setup',
    color:    'purple',
    columns: [
      { key: 'classInOp',   label: 'ISO Class', subLabel: 'In Operation', type: 'select', options: ISO_CLASS_OPTIONS, width: 'w-28' },
      { key: 'atRestClass', label: 'ISO Class', subLabel: 'At Rest',      type: 'select', options: ISO_CLASS_OPTIONS, width: 'w-28' },
      { key: 'recOt',       label: 'REC. / OT', type: 'select', options: ['REC', 'OT'],   width: 'w-20' },
      { key: 'flpType',     label: 'FLP / NFLP',type: 'select', options: ['FLP', 'NFLP'], width: 'w-20' },
    ],
  },
];