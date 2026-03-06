/**
 * isoCleanroom.js
 * ISO 14644-1:2015 cleanroom classification and air change requirements.
 *
 * Reference: ISO 14644-1:2015 — Cleanrooms and associated controlled environments
 *            ISO 14644-4:2022 — Design, construction, and start-up
 *            GMP Annex 1:2022 (EMA/EC) — Manufacture of Sterile Medicinal Products
 *            SEMI S2-0200E     — Environmental, Health & Safety Guidelines for
 *                                Semiconductor Manufacturing Equipment
 *            IEST-RP-CC012.2  — Considerations in Cleanroom Design
 *            ASHRAE Handbook HVAC Applications (2019), Chapter 18
 *
 * ── STRUCTURE ─────────────────────────────────────────────────────────────────
 *
 *   ISO_CLASS_DATA
 *     Keyed by ISO class string (e.g. 'ISO 5').
 *     Each entry defines particle limits, ACPH ranges, and regulatory mappings.
 *
 *   GMP_GRADE_MAPPING
 *     Maps EU GMP Annex 1 grades (A/B/C/D) to ISO equivalents.
 *
 *   ACPH_RANGES
 *     Per-class min/design/max ACPH for automatic defaulting in roomSlice.
 *
 *   getAcphDefaults()
 *     Returns { minAcph, designAcph } for a given ISO class.
 *     Used by addNewRoom() and RoomConfig when ISO class is set.
 *
 *   validateIsoClass()
 *     Checks if a room's actual ACPH meets the minimum for its ISO class.
 *     Used by isoValidation.js for compliance flag computation.
 */

// ── ISO 14644-1:2015 Particle Concentration Limits ───────────────────────────
// Maximum allowable particle concentrations (particles/m³)
// at rest and in operation.

export const ISO_PARTICLE_LIMITS = {
  'ISO 1': { '≥0.1µm': 10,       '≥0.2µm': 2,      '≥0.3µm': null,   '≥0.5µm': null,   '≥1µm': null,  '≥5µm': null  },
  'ISO 2': { '≥0.1µm': 100,      '≥0.2µm': 24,     '≥0.3µm': 10,     '≥0.5µm': 4,      '≥1µm': null,  '≥5µm': null  },
  'ISO 3': { '≥0.1µm': 1000,     '≥0.2µm': 237,    '≥0.3µm': 102,    '≥0.5µm': 35,     '≥1µm': 8,     '≥5µm': null  },
  'ISO 4': { '≥0.1µm': 10000,    '≥0.2µm': 2370,   '≥0.3µm': 1020,   '≥0.5µm': 352,    '≥1µm': 83,    '≥5µm': null  },
  'ISO 5': { '≥0.1µm': 100000,   '≥0.2µm': 23700,  '≥0.3µm': 10200,  '≥0.5µm': 3520,   '≥1µm': 832,   '≥5µm': 29    },
  'ISO 6': { '≥0.1µm': 1000000,  '≥0.2µm': 237000, '≥0.3µm': 102000, '≥0.5µm': 35200,  '≥1µm': 8320,  '≥5µm': 293   },
  'ISO 7': { '≥0.1µm': null,     '≥0.2µm': null,   '≥0.3µm': null,   '≥0.5µm': 352000, '≥1µm': 83200, '≥5µm': 2930  },
  'ISO 8': { '≥0.1µm': null,     '≥0.2µm': null,   '≥0.3µm': null,   '≥0.5µm': 3520000,'≥1µm': 832000,'≥5µm': 29300 },
};

// ── ACPH Ranges ───────────────────────────────────────────────────────────────
// Air changes per hour (ACPH) — supply air.
//
// Sources:
//   ISO 5:    IEST-RP-CC012.2 — 240–600 ACPH (unidirectional / turbulent mix)
//   ISO 6:    IEST-RP-CC012.2 — 90–180 ACPH
//   ISO 7:    GMP Annex 1:2022 — ≥60 ACPH; ISO 14644-4 — 60–160 ACPH
//   ISO 8:    ISO 14644-4 — 10–25 ACPH (non-classified support areas higher)
//   CNC:      Unclassified — 6–15 ACPH general industrial
//
// Note: ISO 5 ACPH depends on whether unidirectional (UDAF) or turbulent
// mixing (TMF) airflow is used. UDAF achieves ISO 5 at lower velocity;
// TMF requires very high ACPH to achieve dilution equivalent.
// This table uses TMF values as conservative design basis.

export const ACPH_RANGES = {
  'ISO 5': {
    min:         240,
    design:      360,
    max:         600,
    flowType:    'Unidirectional (UDAF) preferred; TMF values shown',
    note:        'IEST-RP-CC012.2 Table B-1; ASHRAE HVAC Apps Ch.18',
  },
  'ISO 6': {
    min:         90,
    design:      150,
    max:         180,
    flowType:    'Turbulent mixing (TMF)',
    note:        'IEST-RP-CC012.2 Table B-1',
  },
  'ISO 7': {
    min:         60,
    design:      90,
    max:         160,
    flowType:    'Turbulent mixing (TMF)',
    note:        'GMP Annex 1:2022 §4.23 — ≥60 ACPH for Grade C equivalent',
  },
  'ISO 8': {
    min:         10,
    design:      20,
    max:         25,
    flowType:    'Turbulent mixing (TMF)',
    note:        'ISO 14644-4:2022; ASHRAE HVAC Apps Ch.18',
  },
  'CNC': {
    min:         6,
    design:      10,
    max:         15,
    flowType:    'General dilution ventilation',
    note:        'ASHRAE HVAC Apps Ch.18 — non-classified industrial',
  },
  'Unclassified': {
    min:         6,
    design:      10,
    max:         15,
    flowType:    'General dilution ventilation',
    note:        'ASHRAE 62.1-2022 minimum ventilation basis',
  },
};

// ── Full ISO class data ───────────────────────────────────────────────────────

export const ISO_CLASS_DATA = {
  'ISO 5': {
    isoN:         5,
    label:        'ISO Class 5',
    gmpGrade:     'A/B',       // EU GMP Annex 1 equivalent
    fedStd:       'Class 100', // US FED STD 209E (superseded, reference only)
    acph:         ACPH_RANGES['ISO 5'],
    typicalUse:   [
      'Critical zone — aseptic fill/finish',
      'Semiconductor lithography bay',
      'Wafer exposure zone',
    ],
    pressurePa:   '+15 to +20 Pa vs adjacent ISO 6/7',
    tempRange:    '20–22°C',
    rhRange:      '30–50% (pharma) / 40–50% (semicon)',
  },

  'ISO 6': {
    isoN:         6,
    label:        'ISO Class 6',
    gmpGrade:     'B',
    fedStd:       'Class 1,000',
    acph:         ACPH_RANGES['ISO 6'],
    typicalUse:   [
      'Background environment for ISO 5 operations',
      'Semiconductor process bay (non-critical)',
      'Optical component assembly',
    ],
    pressurePa:   '+10 to +15 Pa vs adjacent ISO 7',
    tempRange:    '20–22°C',
    rhRange:      '30–50%',
  },

  'ISO 7': {
    isoN:         7,
    label:        'ISO Class 7',
    gmpGrade:     'C',
    fedStd:       'Class 10,000',
    acph:         ACPH_RANGES['ISO 7'],
    typicalUse:   [
      'Preparation areas for aseptic manufacturing',
      'Pharmaceutical compounding',
      'Medical device assembly',
      'MEMS device packaging',
    ],
    pressurePa:   '+5 to +10 Pa vs corridor/CNC',
    tempRange:    '20–24°C',
    rhRange:      '30–60%',
  },

  'ISO 8': {
    isoN:         8,
    label:        'ISO Class 8',
    gmpGrade:     'D',
    fedStd:       'Class 100,000',
    acph:         ACPH_RANGES['ISO 8'],
    typicalUse:   [
      'Gowning and change rooms',
      'Support areas adjoining classified zones',
      'Battery dry room (humidity-critical, not particle-critical)',
      'General pharmaceutical support areas',
    ],
    pressurePa:   '+2 to +5 Pa vs unclassified',
    tempRange:    '18–26°C',
    rhRange:      '30–65%',
  },

  'CNC': {
    isoN:         null,
    label:        'Controlled Not Classified (CNC)',
    gmpGrade:     null,
    fedStd:       null,
    acph:         ACPH_RANGES['CNC'],
    typicalUse:   [
      'General manufacturing support',
      'Non-critical process areas',
      'Utility corridors with contamination control',
    ],
    pressurePa:   '+2 Pa vs exterior / uncontrolled',
    tempRange:    '18–28°C',
    rhRange:      '30–70%',
  },

  'Unclassified': {
    isoN:         null,
    label:        'Unclassified',
    gmpGrade:     null,
    fedStd:       null,
    acph:         ACPH_RANGES['Unclassified'],
    typicalUse:   [
      'Offices, canteens, corridors',
      'Warehouse / storage',
      'Mechanical / utility rooms',
    ],
    pressurePa:   'No specific requirement',
    tempRange:    '18–28°C',
    rhRange:      '30–70%',
  },
};

// ── GMP Annex 1 grade mapping ─────────────────────────────────────────────────
// EU GMP Annex 1:2022 — Manufacture of Sterile Medicinal Products
// Maps GMP grades to ISO equivalents for cross-reference.

export const GMP_GRADE_MAPPING = {
  'Grade A': {
    isoAtRest:     'ISO 5',
    isoInOp:       'ISO 5',
    minAcph:       null,         // Unidirectional — velocity-based, not ACPH
    note:          'UDAF 0.45 m/s ±20% at working position (Annex 1 §4.23)',
  },
  'Grade B': {
    isoAtRest:     'ISO 5',
    isoInOp:       'ISO 7',
    minAcph:       null,         // Background to Grade A — ACPH from ISO class
    note:          'Background environment for Grade A aseptic operations',
  },
  'Grade C': {
    isoAtRest:     'ISO 7',
    isoInOp:       'ISO 8',
    minAcph:       20,           // GMP Annex 1 §4.23 minimum
    note:          'ACPH ≥20 mandated; ISO 14644-1 particle limits apply at rest',
  },
  'Grade D': {
    isoAtRest:     'ISO 8',
    isoInOp:       null,         // No in-operation particle limit specified
    minAcph:       20,
    note:          'At rest ISO 8 required; in-operation limit defined by risk',
  },
};

// ── Convenience accessor ──────────────────────────────────────────────────────

/**
 * getAcphDefaults()
 * Returns default { minAcph, designAcph } for a given ISO class.
 *
 * Used by:
 *   - addNewRoom() in roomActions.js to pre-populate ACPH fields
 *   - RoomConfig when user changes ISO classification
 *   - isoValidation.js for compliance checking
 *
 * @param {string} isoClass - 'ISO 5' | 'ISO 6' | 'ISO 7' | 'ISO 8' | 'CNC' | 'Unclassified'
 * @returns {{ minAcph: number, designAcph: number }}
 */
export const getAcphDefaults = (isoClass) => {
  const range = ACPH_RANGES[isoClass] ?? ACPH_RANGES['Unclassified'];
  return {
    minAcph:    range.min,
    designAcph: range.design,
  };
};

/**
 * getIsoClassData()
 * Returns the full ISO_CLASS_DATA entry for a given class.
 * Falls back to 'Unclassified' if class is unknown.
 *
 * @param {string} isoClass
 * @returns {object}
 */
export const getIsoClassData = (isoClass) =>
  ISO_CLASS_DATA[isoClass] ?? ISO_CLASS_DATA['Unclassified'];

// ── UI option list ────────────────────────────────────────────────────────────
// Pre-built for RDSConfig / RoomConfig select columns.

export const ISO_CLASS_OPTIONS = [
  'ISO 5',
  'ISO 6',
  'ISO 7',
  'ISO 8',
  'CNC',
  'Unclassified',
];