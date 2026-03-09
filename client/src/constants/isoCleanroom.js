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
 * ── ISO CLASS COVERAGE ───────────────────────────────────────────────────────
 *
 *   ISO 1   EUV / advanced photolithography (theoretical limit)
 *   ISO 2   Advanced lithography, leading-edge semiconductor nodes
 *   ISO 3   DRAM / NAND front-end, optical component manufacturing
 *   ISO 4   Semiconductor sub-fab, precision optics
 *   ISO 5   Aseptic pharma fill/finish; semiconductor critical zones
 *   ISO 6   Background to ISO 5 operations; non-critical semicon process
 *   ISO 7   Pharma Grade C; medical device assembly; MEMS packaging
 *   ISO 8   Pharma Grade D; gowning; general support
 *   ISO 9   Ambient / uncontrolled — reference point only
 *   CNC     Controlled Not Classified — general industrial
 *   Unclassified
 *
 * ── CRITICAL: TOTAL vs OA ACPH ────────────────────────────────────────────────
 *
 *   For high-recirculation cleanrooms (ISO 3–6 using FFU/UDAF systems):
 *     totalAcph = recircAcph + oaAcph
 *
 *   The ACPH_RANGES values represent TOTAL supply air changes (recirculation
 *   + fresh air combined). For AHU/coil sizing, only oaAcph contributes to
 *   the outdoor air heat load. Using totalAcph for OA coil sizing produces
 *   an order-of-magnitude error for ISO 3–5 rooms.
 *
 *   oaFraction: typical OA fraction of total supply (5–15% for ISO 3–6).
 *   airQuantities.js must use: oaAcph = totalAcph × oaFraction
 *   and then take max(oaAcph-based CFM, calculateVbz(), calculateMinAchCfm()).
 *
 * ── STRUCTURE ─────────────────────────────────────────────────────────────────
 *
 *   ISO_PARTICLE_LIMITS   — particles/m³ per ISO 14644-1:2015, Table 1
 *   ACPH_RANGES           — total supply ACPH per class (recirculation + OA)
 *   ISO_CLASS_DATA        — full per-class descriptor objects
 *   GMP_GRADE_MAPPING     — EU GMP Annex 1 grade → ISO cross-reference
 *   getAcphDefaults()     — returns { minAcph, designAcph, oaFraction }
 *   getIsoClassData()     — returns full ISO_CLASS_DATA entry
 *   ISO_CLASS_OPTIONS     — UI select list
 */

// ── ISO 14644-1:2015 Particle Concentration Limits ───────────────────────────
// Maximum allowable particle concentrations (particles/m³) at rest.
// null = concentration limit not applicable at this class (too large to measure
//        or too small to be meaningful at this classification level).
// Source: ISO 14644-1:2015, Table 1

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
// TOTAL supply air changes per hour (recirculation + OA combined).
//
// ⚠️  For AHU/coil sizing use oaFraction to extract the OA component:
//       oaAcph = designAcph × oaFraction
//     then take max(oaAcph CFM, Vbz, minAchCfm) in airQuantities.js.
//     Using totalAcph directly for OA sizing causes gross overestimation
//     of OA heat load for ISO 3–5 rooms (10–20× error).
//
// Sources:
//   ISO 1–2: IEST-RP-CC012.2; practical UDAF at 0.45+ m/s → 600+ ACPH
//   ISO 3:   IEST-RP-CC012.2 — 480–600 ACPH (UDAF)
//   ISO 4:   IEST-RP-CC012.2 — 300–540 ACPH
//   ISO 5:   IEST-RP-CC012.2 — 240–600 ACPH (UDAF preferred)
//   ISO 6:   IEST-RP-CC012.2 — 90–180 ACPH
//   ISO 7:   GMP Annex 1:2022 §4.23 — ≥60 ACPH
//   ISO 8:   ISO 14644-4:2022 — 10–25 ACPH
//   ISO 9:   Ambient — 4–6 ACPH (reference only, no control requirement)
//   CNC:     ASHRAE HVAC Apps Ch.18 — 6–15 ACPH

export const ACPH_RANGES = {
  'ISO 1': {
    min:         600,
    design:      700,
    max:         900,
    oaFraction:  0.05,   // 5% OA — almost entirely recirculation through HEPA/ULPA
    flowType:    'Unidirectional (UDAF) — theoretical limit; practically achievable in micro-environments only',
    note:        'IEST-RP-CC012.2; ISO 1 achievable only in mini-environments or gloveboxes. '
               + 'Full-room ISO 1 is not practically achievable with conventional HVAC.',
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
    oaFraction:  0.05,   // ~27 OA ACPH at design — governs OA coil
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
    oaFraction:  0.07,   // ~25 OA ACPH at design basis
    flowType:    'Unidirectional (UDAF) preferred; TMF values shown for comparison',
    note:        'IEST-RP-CC012.2 Table B-1; ASHRAE HVAC Apps Ch.18. '
               + 'TMF requires very high ACPH for dilution equivalent; UDAF preferred.',
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
    oaFraction:  0.20,   // Higher OA fraction; lower total ACPH
    flowType:    'Turbulent mixing (TMF)',
    note:        'ISO 14644-4:2022; ASHRAE HVAC Apps Ch.18.',
  },
  'ISO 9': {
    min:         4,
    design:      6,
    max:         10,
    oaFraction:  1.0,    // No recirculation requirement — all OA or general ventilation
    flowType:    'General dilution ventilation (ambient reference)',
    note:        'ISO 14644-1:2015 — ambient outdoor air classification. '
               + 'No active contamination control required. Reference point only.',
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
    fedStd:       null,   // No FED STD 209E equivalent
    acph:         ACPH_RANGES['ISO 1'],
    typicalUse:   [
      'EUV lithography micro-environments',
      'Leading-edge semiconductor research (sub-5nm nodes)',
      'Quantum device fabrication',
    ],
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
    typicalUse:   [
      'Advanced lithography bays (3–7nm nodes)',
      'Extreme precision optical assembly',
      'Electron beam direct write systems',
    ],
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
    typicalUse:   [
      'DRAM / NAND front-end lithography bays',
      'Wafer exposure zones',
      'Optical component manufacturing',
    ],
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
    typicalUse:   [
      'Semiconductor sub-fab process areas',
      'Precision optics assembly',
      'Hard disk drive component manufacturing',
    ],
    pressurePa:   '+10 to +15 Pa vs adjacent ISO 5/6',
    tempRange:    '20–22°C ±0.5°C',
    rhRange:      '40–50% ±3%',
  },

  'ISO 5': {
    isoN:         5,
    label:        'ISO Class 5',
    gmpGrade:     'A/B',     // EU GMP Annex 1 equivalent (Grade A at rest)
    fedStd:       'Class 100',
    acph:         ACPH_RANGES['ISO 5'],
    typicalUse:   [
      'Critical zone — aseptic fill/finish (pharma Grade A)',
      'Semiconductor lithography bay (mature nodes)',
      'Background to ISO 3/4 operations',
    ],
    pressurePa:   '+15 to +20 Pa vs adjacent ISO 6/7',
    tempRange:    '20–22°C (pharma) / 20–23°C (semicon)',
    rhRange:      '30–50% (pharma) / 40–50% (semicon)',
  },

  'ISO 6': {
    isoN:         6,
    label:        'ISO Class 6',
    gmpGrade:     'B',
    fedStd:       'Class 1,000',
    acph:         ACPH_RANGES['ISO 6'],
    typicalUse:   [
      'Background environment for ISO 5 pharma operations',
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
    typicalUse:   [
      'Ambient outdoor air (reference / baseline)',
      'Uncontrolled indoor spaces',
      'Used as reference point in differential pressure cascade design',
    ],
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

// ── GMP Annex 1:2022 Grade Mapping ───────────────────────────────────────────
// EU GMP Annex 1:2022 — Manufacture of Sterile Medicinal Products
// Maps GMP grades to ISO equivalents for cross-reference.

export const GMP_GRADE_MAPPING = {
  'Grade A': {
    isoAtRest:   'ISO 5',
    isoInOp:     'ISO 5',
    minAcph:     null,    // UDAF velocity-based (0.45 m/s ±20%) — not ACPH
    note:        'GMP Annex 1:2022 §4.23: UDAF 0.45 m/s ±20% at working position. '
               + 'ACPH not specified for Grade A — velocity governs.',
  },
  'Grade B': {
    isoAtRest:   'ISO 5',
    isoInOp:     'ISO 7',
    // FIX MED-01: was null. GMP Annex 1:2022 §4.23 mandates ≥20 ACPH for Grade B
    // background environment. null caused isoValidation.js to never flag an
    // under-ventilated Grade B room.
    minAcph:     20,
    note:        'GMP Annex 1:2022 §4.23: ≥20 ACPH mandated for Grade B background. '
               + 'Background environment for Grade A aseptic operations.',
  },
  'Grade C': {
    isoAtRest:   'ISO 7',
    isoInOp:     'ISO 8',
    minAcph:     20,      // GMP Annex 1:2022 §4.23
    note:        'GMP Annex 1:2022 §4.23: ≥20 ACPH mandated. '
               + 'ISO 14644-1 particle limits apply at rest.',
  },
  'Grade D': {
    isoAtRest:   'ISO 8',
    isoInOp:     null,    // No in-operation particle limit defined
    minAcph:     20,      // GMP Annex 1:2022 §4.29
    note:        'GMP Annex 1:2022 §4.29: ≥20 ACPH mandated. '
               + 'At-rest ISO 8 required; in-operation limit defined by risk assessment.',
  },
};

// ── Convenience accessors ─────────────────────────────────────────────────────

/**
 * getAcphDefaults(isoClass)
 *
 * Returns { minAcph, designAcph, oaFraction } for a given ISO class.
 * FIX LOW-01: warns on unknown class instead of silent fallback.
 *
 * oaFraction: proportion of total supply ACPH that is outdoor air.
 * airQuantities.js should use: oaAcph = designAcph × oaFraction
 * to correctly size the OA coil without including recirculation.
 *
 * Used by:
 *   - addNewRoom() in roomActions.js to pre-populate ACPH fields
 *   - RoomConfig when user changes ISO classification
 *   - isoValidation.js for compliance checking
 *
 * @param {string} isoClass - ISO class string or 'CNC' / 'Unclassified'
 * @returns {{ minAcph: number, designAcph: number, oaFraction: number }}
 */
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

/**
 * getIsoClassData(isoClass)
 *
 * Returns the full ISO_CLASS_DATA entry for a given class.
 * Falls back to 'Unclassified' if class is unknown.
 *
 * @param {string} isoClass
 * @returns {object}
 */
export const getIsoClassData = (isoClass) => {
  if (isoClass && !ISO_CLASS_DATA[isoClass]) {
    console.warn(
      `getIsoClassData: unknown isoClass "${isoClass}". Falling back to "Unclassified".`
    );
  }
  return ISO_CLASS_DATA[isoClass] ?? ISO_CLASS_DATA['Unclassified'];
};

// ── UI option list ────────────────────────────────────────────────────────────
// Pre-built for RDSConfig / RoomConfig select columns.
// Ordered from cleanest to least controlled.

export const ISO_CLASS_OPTIONS = [
  'ISO 1',
  'ISO 2',
  'ISO 3',
  'ISO 4',
  'ISO 5',
  'ISO 6',
  'ISO 7',
  'ISO 8',
  'ISO 9',
  'CNC',
  'Unclassified',
];