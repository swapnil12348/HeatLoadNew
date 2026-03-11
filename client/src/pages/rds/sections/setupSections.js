/**
 * setupSections.js
 * RDS category: setup
 * Sections: Identification, Room Geometry, Design Conditions, Classification
 */
import { ISO_CLASS_OPTIONS } from '../../../constants/isoCleanroom';


const VENT_CATEGORY_OPTIONS = [
  { value: 'general',  label: 'General / Office'           },
  { value: 'pharma',   label: 'Pharmaceutical / Biotech'   },
  { value: 'battery',  label: 'Battery Manufacturing'      },
  { value: 'semicon',  label: 'Semiconductor / Electronics'},
];

export const SETUP_SECTIONS = [

  // 1. Identification ────────────────────────────────────────────────────────
  {
    id:       'identification',
    title:    'Identification',
    category: 'setup',
    color:    'gray',
    columns: [
      {
        key:    'ahuId',
        label:  'System Name / No.',
        subLabel: 'AHU',
        type:   'select-ahu',
        sticky: 'left-8',
        width:  'w-32',
      },
      { key: 'typeOfUnit', label: 'Type of Unit', inputType: 'text', width: 'w-28' },
      { key: 'roomNo',     label: 'Room No.',     inputType: 'text', width: 'w-20' },
      { key: 'name',       label: 'Room Name',    inputType: 'text', width: 'w-44' },
    ],
  },

  // 2. Room Geometry ─────────────────────────────────────────────────────────
  {
    id:       'geometry',
    title:    'Room Geometry',
    category: 'setup',
    color:    'blue',
    columns: [
      { key: 'length',    label: 'Length',              subLabel: 'm'  },
      { key: 'width',     label: 'Width',               subLabel: 'm'  },
      { key: 'height',    label: 'Ht.',                 subLabel: 'm'  },
      { key: 'floorArea', label: 'Area as per Layout',  subLabel: 'ft²', type: 'readOnly', derived: true },
      { key: 'volume',    label: 'Volume',              subLabel: 'ft³', type: 'readOnly', derived: true },
      { key: 'volFaPct',  label: 'Room wise Vol. %age', subLabel: 'FA Opt', step: 0.01    },
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
        key:     'ventCategory',
        label:   'Vent. Category',
        subLabel: 'ASHRAE 62.1',
        type:    'select',
        options: VENT_CATEGORY_OPTIONS,
        width:   'w-36',
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