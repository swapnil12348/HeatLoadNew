/**
 * isoCleanroom.js
 * ISO 14644-1:2015 cleanroom classification and air change requirements.
 *
 * CHANGELOG v2.1:
 *
 *   HIGH-01 FIX — ISO_CLASS_DATA['ISO 6'].gmpGrade corrected null → was 'B'.
 *
 *     Previous value 'B' was factually wrong. GMP Annex 1:2022 Grade B is:
 *       At rest:      ISO 5
 *       In operation: ISO 7
 *     ISO 6 alone does not correspond to any single GMP grade.
 *
 *     Downstream impact of the incorrect 'B':
 *       • UI display components reading ISO_CLASS_DATA[room.isoClass].gmpGrade
 *         for an ISO 6 room would show "Grade B" — misleading at pharma audit.
 *       • validateGmpCompliance() in isoValidation.js would attempt to match
 *         an ISO 6 room against Grade B requirements (ISO 5 at-rest) and produce
 *         a false compliance failure. Grade B requires ISO 5 at-rest; an ISO 6
 *         room at rest is by definition not Grade B.
 *       • Any auto-populate logic reading gmpGrade from ISO_CLASS_DATA would
 *         incorrectly tag an ISO 6 room as "Grade B" in the RDS.
 *
 *     ISO 6 is used as a background environment to ISO 5 operations in
 *     semiconductor and research settings. It has no direct GMP Annex 1
 *     equivalent by itself — a room must be classified by its at-rest AND
 *     in-operation conditions together to map to a GMP grade.
 *
 * Reference: ISO 14644-1:2015, ISO 14644-4:2022, GMP Annex 1:2022,
 *            SEMI S2-0200E, IEST-RP-CC012.2, ASHRAE HVAC Applications 2019 Ch.18
 */

// ── ISO 14644-1:2015 Particle Concentration Limits ───────────────────────────
export const ISO_PARTICLE_LIMITS = {
  'ISO 1': { '≥0.1µm': 10,        '≥0.2µm': 2,       '≥0.3µm': null,    '≥0.5µm': null,     '≥1µm': null,    '≥5µm': null     },
  'ISO 2': { '≥0.1µm': 100,       '≥0.2µm': 24,      '≥0.3µm': 10,      '≥0.5µm': 4,        '≥1µm': null,    '≥5µm': null     },
  'ISO 3': { '≥0.1µm': 1000,      '≥0.2µm': 237,     '≥0.3µm': 102,     '≥0.5µm': 35,       '≥1µm': 8,       '≥5µm': null     },
  'ISO 4': { '≥0.1µm': 10000,     '≥0.2µm': 2370,    '≥0.3µm': 1020,    '≥0.5µm': 352,      '≥1µm': 83,      '≥5µm': null     },
  'ISO 5': { '≥0.1µm': 100000,    '≥0.2µm': 23700,   '≥0.3µm': 10200,   '≥0.5µm': 3520,     '≥1µm': 832,     '≥5µm': 29       },
  'ISO 6': { '≥0.1µm': 1000000,   '≥0.2µm': 237000,  '≥0.3µm': 102000,  '≥0.5µm': 35200,    '≥1µm': 8320,    '≥5µm': 293      },
  'ISO 7': { '≥0.1µm': null,      '≥0.2µm': null,    '≥0.3µm': null,    '≥0.5µm': 352000,   '≥1µm': 83200,   '≥5µm': 2930     },
  'ISO 8': { '≥0.1µm': null,      '≥0.2µm': null,    '≥0.3µm': null,    '≥0.5µm': 3520000,  '≥1µm': 832000,  '≥5µm': 29300    },
  'ISO 9': { '≥0.1µm': null,      '≥0.2µm': null,    '≥0.3µm': null,    '≥0.5µm': 35200000, '≥1µm': 8320000, '≥5µm': 293000   },
};

// ── ACPH Ranges ───────────────────────────────────────────────────────────────
export const ACPH_RANGES = {
  'ISO 1': {
    min:         600,
    design:      700,
    max:         900,
    oaFraction:  0.05,
    flowType:    'Unidirectional (UDAF) — theoretical limit; practically achievable in micro-environments only',
    note:        'IEST-RP-CC012.2; ISO 1 achievable only in mini-environments or gloveboxes.',
  },
  'ISO 2': {
    min:         500,
    design:      600,
    max:         800,
    oaFraction:  0.05,
    flowType:    'Unidirectional (UDAF)',
    note:        'IEST-RP-CC012.2; achievable in mini-environments; leading-edge EUV nodes.',
  },
  'ISO 3': {
    min:         480,
    design:      540,
    max:         600,
    oaFraction:  0.05,
    flowType:    'Unidirectional (UDAF)',
    note:        'IEST-RP-CC012.2 Table B-1; DRAM/NAND front-end lithography bays.',
  },
  'ISO 4': {
    min:         300,
    design:      420,
    max:         540,
    oaFraction:  0.06,
    flowType:    'Unidirectional (UDAF) or high-velocity TMF',
    note:        'IEST-RP-CC012.2 Table B-1; semiconductor sub-fab, precision optics.',
  },
  'ISO 5': {
    min:         240,
    design:      360,
    max:         600,
    oaFraction:  0.07,
    flowType:    'Unidirectional (UDAF) preferred; TMF values shown for comparison',
    note:        'IEST-RP-CC012.2 Table B-1; ASHRAE HVAC Apps Ch.18.',
  },
  'ISO 6': {
    min:         90,
    design:      150,
    max:         180,
    oaFraction:  0.08,
    flowType:    'Turbulent mixing (TMF)',
    note:        'IEST-RP-CC012.2 Table B-1.',
  },
  'ISO 7': {
    min:         60,
    design:      90,
    max:         160,
    oaFraction:  0.12,
    flowType:    'Turbulent mixing (TMF)',
    note:        'GMP Annex 1:2022 §4.23 — ≥60 ACPH for Grade C equivalent.',
  },
  'ISO 8': {
    min:         10,
    design:      20,
    max:         25,
    oaFraction:  0.20,
    flowType:    'Turbulent mixing (TMF)',
    note:        'ISO 14644-4:2022; ASHRAE HVAC Apps Ch.18.',
  },
  'ISO 9': {
    min:         4,
    design:      6,
    max:         10,
    oaFraction:  1.0,
    flowType:    'General dilution ventilation (ambient reference)',
    note:        'Ambient outdoor air classification. No active contamination control.',
  },
  'CNC': {
    min:         6,
    design:      10,
    max:         15,
    oaFraction:  0.30,
    flowType:    'General dilution ventilation',
    note:        'ASHRAE HVAC Apps Ch.18 — non-classified industrial.',
  },
  'Unclassified': {
    min:         6,
    design:      10,
    max:         15,
    oaFraction:  0.40,
    flowType:    'General dilution ventilation',
    note:        'ASHRAE 62.1-2022 minimum ventilation basis.',
  },
};

// ── Full ISO class data ───────────────────────────────────────────────────────

export const ISO_CLASS_DATA = {

  'ISO 1': {
    isoN:         1,
    label:        'ISO Class 1',
    gmpGrade:     null,
    fedStd:       null,
    acph:         ACPH_RANGES['ISO 1'],
    typicalUse:   ['EUV lithography micro-environments', 'Leading-edge semiconductor research (sub-5nm nodes)', 'Quantum device fabrication'],
    pressurePa:   '+20 to +30 Pa vs adjacent ISO 2/3',
    tempRange:    '20–22°C ±0.1°C (tight control)',
    rhRange:      '40–50% ±1%',
  },

  'ISO 2': {
    isoN:         2,
    label:        'ISO Class 2',
    gmpGrade:     null,
    fedStd:       null,
    acph:         ACPH_RANGES['ISO 2'],
    typicalUse:   ['Advanced lithography bays (3–7nm nodes)', 'Extreme precision optical assembly'],
    pressurePa:   '+15 to +25 Pa vs adjacent ISO 3',
    tempRange:    '20–22°C ±0.2°C',
    rhRange:      '40–50% ±2%',
  },

  'ISO 3': {
    isoN:         3,
    label:        'ISO Class 3',
    gmpGrade:     null,
    fedStd:       'Class 1',
    acph:         ACPH_RANGES['ISO 3'],
    typicalUse:   ['DRAM / NAND front-end lithography bays', 'Wafer exposure zones', 'Optical component manufacturing'],
    pressurePa:   '+15 to +20 Pa vs adjacent ISO 4/5',
    tempRange:    '20–22°C ±0.5°C',
    rhRange:      '40–50% ±2%',
  },

  'ISO 4': {
    isoN:         4,
    label:        'ISO Class 4',
    gmpGrade:     null,
    fedStd:       'Class 10',
    acph:         ACPH_RANGES['ISO 4'],
    typicalUse:   ['Semiconductor sub-fab process areas', 'Precision optics assembly', 'Hard disk drive component manufacturing'],
    pressurePa:   '+10 to +15 Pa vs adjacent ISO 5/6',
    tempRange:    '20–22°C ±0.5°C',
    rhRange:      '40–50% ±3%',
  },

  'ISO 5': {
    isoN:         5,
    label:        'ISO Class 5',
    gmpGrade:     'A/B',
    fedStd:       'Class 100',
    acph:         ACPH_RANGES['ISO 5'],
    typicalUse:   ['Critical zone — aseptic fill/finish (pharma Grade A)', 'Semiconductor lithography bay (mature nodes)'],
    pressurePa:   '+15 to +20 Pa vs adjacent ISO 6/7',
    tempRange:    '20–22°C (pharma) / 20–23°C (semicon)',
    rhRange:      '30–50% (pharma) / 40–50% (semicon)',
  },

  'ISO 6': {
    isoN:         6,
    label:        'ISO Class 6',
    /**
     * HIGH-01 FIX: gmpGrade corrected from 'B' to null.
     *
     * ISO 6 has no direct GMP Annex 1 equivalent on its own. GMP grades are
     * determined by the combination of at-rest AND in-operation conditions:
     *   Grade B = ISO 5 at-rest + ISO 7 in-operation  (from GMP_GRADE_MAPPING)
     *   Grade C = ISO 7 at-rest + ISO 8 in-operation
     *
     * ISO 6 alone maps to no grade. A room with ISO 6 at-rest is not Grade B
     * (which requires ISO 5 at-rest). A room with ISO 6 in-operation is not
     * covered by any standard GMP Annex 1 grade — it falls between Grade B
     * (in-op ISO 7) and Grade A (in-op ISO 5).
     *
     * If a UI component needs to display something for ISO 6 rooms, use:
     *   "No direct GMP Annex 1 equivalent — classify by at-rest + in-operation pair"
     */
    gmpGrade:     null,   // HIGH-01 FIX: was 'B' — incorrect (see JSDoc above)
    fedStd:       'Class 1,000',
    acph:         ACPH_RANGES['ISO 6'],
    typicalUse:   [
      'Background environment for ISO 5 operations (semiconductor / research)',
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
    typicalUse:   ['Preparation areas for aseptic manufacturing', 'Pharmaceutical compounding', 'Medical device assembly', 'MEMS device packaging'],
    pressurePa:   '+5 to +10 Pa vs corridor / CNC',
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

  'ISO 9': {
    isoN:         9,
    label:        'ISO Class 9',
    gmpGrade:     null,
    fedStd:       null,
    acph:         ACPH_RANGES['ISO 9'],
    typicalUse:   ['Ambient outdoor air (reference / baseline)', 'Uncontrolled indoor spaces'],
    pressurePa:   'Ambient reference — no positive pressure requirement',
    tempRange:    'Ambient / uncontrolled',
    rhRange:      'Ambient / uncontrolled',
  },

  'CNC': {
    isoN:         null,
    label:        'Controlled Not Classified (CNC)',
    gmpGrade:     null,
    fedStd:       null,
    acph:         ACPH_RANGES['CNC'],
    typicalUse:   ['General manufacturing support', 'Non-critical process areas', 'Utility corridors with contamination control'],
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
    typicalUse:   ['Offices, canteens, corridors', 'Warehouse / storage', 'Mechanical / utility rooms'],
    pressurePa:   'No specific requirement',
    tempRange:    '18–28°C',
    rhRange:      '30–70%',
  },
};

// ── GMP Annex 1:2022 Grade Mapping ───────────────────────────────────────────
export const GMP_GRADE_MAPPING = {
  'Grade A': {
    isoAtRest:   'ISO 5',
    isoInOp:     'ISO 5',
    minAcph:     null,
    note:        'GMP Annex 1:2022 §4.23: UDAF 0.45 m/s ±20% at working position. ACPH not specified.',
  },
  'Grade B': {
    isoAtRest:   'ISO 5',
    isoInOp:     'ISO 7',
    minAcph:     20,   // FIX MED-01: was null — GMP Annex 1:2022 §4.23 mandates ≥20 ACPH
    note:        'GMP Annex 1:2022 §4.23: ≥20 ACPH mandated for Grade B background. '
               + 'Background environment for Grade A aseptic operations.',
  },
  'Grade C': {
    isoAtRest:   'ISO 7',
    isoInOp:     'ISO 8',
    minAcph:     20,
    note:        'GMP Annex 1:2022 §4.23: ≥20 ACPH mandated.',
  },
  'Grade D': {
    isoAtRest:   'ISO 8',
    isoInOp:     null,    // GMP Annex 1:2022 §4.7: in-operation limit by risk assessment
    minAcph:     20,      // GMP Annex 1:2022 §4.29
    note:        'GMP Annex 1:2022 §4.29: ≥20 ACPH mandated. '
               + 'In-operation particle limit defined by facility contamination risk assessment — '
               + 'no fixed ISO class mandated. isoInOp: null is correct (not a data error).',
  },
};

// ── Convenience accessors ─────────────────────────────────────────────────────

export const getAcphDefaults = (isoClass) => {
  if (isoClass && !ACPH_RANGES[isoClass]) {
    console.warn(
      `getAcphDefaults: unknown isoClass "${isoClass}". Falling back to "Unclassified". ` +
      `Valid keys: ${Object.keys(ACPH_RANGES).join(', ')}`
    );
  }
  const range = ACPH_RANGES[isoClass] ?? ACPH_RANGES['Unclassified'];
  return {
    minAcph:     range.min,
    designAcph:  range.design,
    oaFraction:  range.oaFraction,
  };
};

export const getIsoClassData = (isoClass) => {
  if (isoClass && !ISO_CLASS_DATA[isoClass]) {
    console.warn(`getIsoClassData: unknown isoClass "${isoClass}". Falling back to "Unclassified".`);
  }
  return ISO_CLASS_DATA[isoClass] ?? ISO_CLASS_DATA['Unclassified'];
};

export const ISO_CLASS_OPTIONS = [
  'ISO 1', 'ISO 2', 'ISO 3', 'ISO 4', 'ISO 5',
  'ISO 6', 'ISO 7', 'ISO 8', 'ISO 9', 'CNC', 'Unclassified',
];