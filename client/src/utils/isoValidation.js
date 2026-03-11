/**
 * isoValidation.js
 * Responsibility: ISO 14644-1 compliance checks for room ACPH and pressure.
 *
 * CHANGELOG v2.3:
 *
 *   FIX-ACPH-STD-01 — validateAcph(): pharma rooms now use GMP Annex 1
 *   minimum ACPH instead of IEST-RP-CC012.2 minimum.
 *
 *     PREVIOUS BEHAVIOUR (contradictory):
 *       validateAcph()         used ACPH_RANGES['ISO 7'].min = 60  (IEST)
 *       validateGmpCompliance() used GMP_GRADE_MAPPING['Grade C'].minAcph = 20 (GMP)
 *
 *       For a pharma ISO 7 / Grade C room at 30 ACPH:
 *         validateAcph()         → FAIL  (30 < 60 IEST minimum) → pass: false
 *         validateGmpCompliance() → PASS  (30 ≥ 20 GMP minimum)  → pass: true
 *         validateRoom()         → pass: false (acphCheck dominated)
 *
 *       Both values are correct for their respective standards. The bug was
 *       using IEST as the regulatory pass/fail threshold for pharma — IEST
 *       values are DESIGN TARGETS for cleanroom particle-count certification,
 *       not the regulatory minimum for GMP pharmaceutical manufacturing.
 *
 *     STANDARD HIERARCHY FOR PHARMA ROOMS:
 *       Regulatory minimum (pass/fail): GMP Annex 1:2022 §4.23
 *         Grade B: ≥20 ACPH,  Grade C: ≥20 ACPH,  Grade D: ≥20 ACPH
 *       Design target (warning only):   IEST-RP-CC012.2 Table B-1
 *         ISO 7: 90 ACPH design,  ISO 8: 20 ACPH design
 *
 *     FIX: when ventCategory === 'pharma' and a GMP grade is matched,
 *     validateAcph() uses gradeData.minAcph (GMP) as the pass/fail threshold.
 *     The IEST designAcph is retained as a warning-level design target.
 *
 *     RESULT for the above example (30 ACPH pharma ISO 7 / Grade C room):
 *       validateAcph()         → WARNING (30 ≥ 20 GMP min; 30 < 90 IEST design)
 *       validateGmpCompliance() → PASS
 *       validateRoom()         → pass: true, hasWarnings: true
 *
 *     A 'standardBasis' field is added to the validateAcph result object
 *     so UI components can cite the governing standard in reports.
 *
 * CHANGELOG v2.2:
 *
 *   MED-ISO-01 FIX — computeActualAcph() now uses rdsRow.supplyAcph as
 *   primary source of truth (single ACPH computation path).
 *
 * CHANGELOG v2.1:
 *
 *   CRITICAL-02 FIX — validateGmpCompliance(): Grade D rooms now match correctly.
 *   MEDIUM-05 FIX — validateRoom() pass logic made explicit and readable.
 *
 * Reference: ISO 14644-1:2015, ISO 14644-4:2022, GMP Annex 1:2022
 */

import {
  ACPH_RANGES,
  GMP_GRADE_MAPPING,
} from '../constants/isoCleanroom';

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * governingClass(room)
 * In-operation class governs during production — the stricter requirement.
 */
const governingClass = (room) =>
  room.classInOp && room.classInOp !== 'Unclassified'
    ? room.classInOp
    : (room.atRestClass || 'Unclassified');

/**
 * computeActualAcph(rdsRow)
 *
 * MED-ISO-01 FIX: Uses rdsRow.supplyAcph as primary source of truth.
 */
const computeActualAcph = (rdsRow) => {
  if (rdsRow.supplyAcph != null && rdsRow.supplyAcph > 0) {
    return parseFloat(rdsRow.supplyAcph);
  }

  // Fallback: recompute from raw fields.
  // Requires rdsRow.volume to be in ft³ (guaranteed after CRIT-RDS-01 fix).
  const volumeFt3 = parseFloat(rdsRow.volume)    || 0;
  const supplyAir = parseFloat(rdsRow.supplyAir) || 0;
  if (volumeFt3 <= 0) return 0;
  return parseFloat((supplyAir * 60 / volumeFt3).toFixed(1));
};

/**
 * resolveAcphThreshold(rdsRow, range)
 *
 * FIX-ACPH-STD-01: Determines the governing ACPH minimum and standard basis.
 *
 * For pharma rooms: GMP Annex 1:2022 regulatory minimum governs pass/fail.
 * For all other rooms: IEST-RP-CC012.2 / ISO 14644-4 minimum governs.
 *
 * The IEST designAcph is always retained as the design target (warning level).
 *
 * @param {object} rdsRow - RDS row from rdsSelector
 * @param {object} range  - ACPH_RANGES entry for the governing ISO class
 * @returns {{ minAcph: number, standardBasis: string }}
 */
const resolveAcphThreshold = (rdsRow, range) => {
  if (rdsRow.ventCategory !== 'pharma') {
    return {
      minAcph:       range.min,
      standardBasis: 'IEST-RP-CC012.2 / ISO 14644-4',
    };
  }

  // For pharma rooms, check if a GMP grade applies and has a lower regulatory min.
  // GMP Annex 1:2022 §4.23 mandates ≥20 ACPH for Grade B, C, and D.
  // This is the legally binding minimum — IEST targets are design recommendations.
  const atRest = rdsRow.atRestClass || 'Unclassified';
  const inOp   = rdsRow.classInOp   || 'Unclassified';

  const matchedGrade = Object.entries(GMP_GRADE_MAPPING).find(([, m]) => {
    const atRestMatch = m.isoAtRest === atRest;
    const inOpMatch   = m.isoInOp === null
      ? (inOp === 'Unclassified' || !inOp)
      : m.isoInOp === inOp;
    return atRestMatch && inOpMatch;
  });

  if (matchedGrade && matchedGrade[1].minAcph) {
    const [gradeName, gradeData] = matchedGrade;
    return {
      minAcph:       gradeData.minAcph,
      standardBasis: `GMP Annex 1:2022 §4.23 (${gradeName})`,
    };
  }

  // Pharma room but no matching GMP grade — fall back to IEST.
  // Engineer should review the ISO class combination.
  return {
    minAcph:       range.min,
    standardBasis: 'IEST-RP-CC012.2 (no GMP grade matched — review ISO classes)',
  };
};

// ── Minimum pressure requirements by ISO class ────────────────────────────────
const ISO_MIN_PRESSURE_PA = {
  'ISO 1':       25,
  'ISO 2':       25,
  'ISO 3':       20,
  'ISO 4':       17.5,
  'ISO 5':       15,
  'ISO 6':       12.5,
  'ISO 7':       10,
  'ISO 8':       5,
  'ISO 9':       0,
  'CNC':          2,
  'Unclassified': 0,
};

// ── ACPH check ────────────────────────────────────────────────────────────────

/**
 * validateAcph(rdsRow)
 *
 * FIX-ACPH-STD-01: Pharma rooms now use GMP Annex 1 regulatory minimum
 * instead of IEST-RP-CC012.2 minimum. See module-level CHANGELOG.
 *
 * Result object includes `standardBasis` field for UI citation.
 */
export const validateAcph = (rdsRow) => {
  const isoClass   = governingClass(rdsRow);
  const range      = ACPH_RANGES[isoClass] ?? ACPH_RANGES['Unclassified'];
  const actualAcph = computeActualAcph(rdsRow);
  const designAcph = range.design;

  // FIX-ACPH-STD-01: resolve governing standard and minimum for this room type.
  const { minAcph, standardBasis } = resolveAcphThreshold(rdsRow, range);
  const deficit = minAcph - actualAcph;

  if (actualAcph < minAcph) {
    return {
      pass:          false,
      severity:      'error',
      actualAcph,
      minAcph,
      designAcph,
      isoClass,
      standardBasis,
      message: `ACPH ${actualAcph} is below minimum ${minAcph} for ${isoClass} `
             + `(${standardBasis}). Deficit: ${deficit.toFixed(1)} ACPH.`,
    };
  }

  if (actualAcph < designAcph) {
    return {
      pass:          true,
      severity:      'warning',
      actualAcph,
      minAcph,
      designAcph,
      isoClass,
      standardBasis,
      message: `ACPH ${actualAcph} meets regulatory minimum ${minAcph} `
             + `(${standardBasis}) but is below IEST design target `
             + `${designAcph} for ${isoClass}.`,
    };
  }

  return {
    pass:          true,
    severity:      'info',
    actualAcph,
    minAcph,
    designAcph,
    isoClass,
    standardBasis,
    message: `ACPH ${actualAcph} meets ${isoClass} design requirement `
           + `(≥${designAcph}, ${standardBasis}).`,
  };
};

// ── Pressure check ────────────────────────────────────────────────────────────

export const validatePressure = (rdsRow) => {
  const isoClass    = governingClass(rdsRow);
  const pressure    = parseFloat(rdsRow.pressure) || 0;
  const minPressure = ISO_MIN_PRESSURE_PA[isoClass] ?? 0;

  if (isoClass === 'Unclassified' || isoClass === 'ISO 9') {
    return {
      pass:     true,
      severity: 'info',
      pressure,
      minPa:    0,
      message:  'No pressure requirement for unclassified / ambient rooms.',
    };
  }

  if (pressure < minPressure) {
    return {
      pass:     false,
      severity: 'error',
      pressure,
      minPa:    minPressure,
      message:  `Room pressure ${pressure} Pa is below minimum ${minPressure} Pa `
              + `for ${isoClass}. (ISO 14644-4:2022 Table D.1)`,
    };
  }

  if (pressure < minPressure + 5) {
    return {
      pass:     true,
      severity: 'warning',
      pressure,
      minPa:    minPressure,
      message:  `Room pressure ${pressure} Pa is marginal for ${isoClass} `
              + `(min ${minPressure} Pa). Consider increasing for control margin.`,
    };
  }

  return {
    pass:     true,
    severity: 'info',
    pressure,
    minPa:    minPressure,
    message:  `Room pressure ${pressure} Pa meets ${isoClass} requirement `
            + `(min ${minPressure} Pa).`,
  };
};

// ── GMP Annex 1 check ─────────────────────────────────────────────────────────

/**
 * validateGmpCompliance(rdsRow)
 *
 * CRITICAL-02 FIX: Grade D rooms now match correctly.
 * MED-ISO-01 FIX: uses computeActualAcph() single source.
 */
export const validateGmpCompliance = (rdsRow) => {
  if (rdsRow.ventCategory !== 'pharma') {
    return {
      pass:     true,
      severity: 'info',
      gmpGrade: null,
      message:  'GMP Annex 1 check not applicable for non-pharma rooms.',
      atRestOk: true,
      inOpOk:   true,
    };
  }

  const atRest = rdsRow.atRestClass || 'Unclassified';
  const inOp   = rdsRow.classInOp   || 'Unclassified';

  // CRITICAL-02 FIX: Handle null isoInOp (Grade D) correctly.
  const matchedGrade = Object.entries(GMP_GRADE_MAPPING).find(([, mapping]) => {
    const atRestMatch = mapping.isoAtRest === atRest;
    const inOpMatch =
      mapping.isoInOp === null
        ? (inOp === 'Unclassified' || !inOp)
        : mapping.isoInOp === inOp;
    return atRestMatch && inOpMatch;
  });

  if (!matchedGrade) {
    return {
      pass:     false,
      severity: 'warning',
      gmpGrade: null,
      message:  `ISO combination (At Rest: ${atRest} / In Op: ${inOp}) does not `
              + 'map to a standard GMP Annex 1 grade. Engineering review required.',
      atRestOk: false,
      inOpOk:   false,
    };
  }

  const [gradeName, gradeData] = matchedGrade;
  const actualAcph = computeActualAcph(rdsRow);

  if (gradeData.minAcph && actualAcph < gradeData.minAcph) {
    return {
      pass:     false,
      severity: 'error',
      gmpGrade: gradeName,
      message:  `${gradeName} requires ≥${gradeData.minAcph} ACPH (GMP Annex 1:2022 §4.23). `
              + `Actual: ${actualAcph.toFixed(1)} ACPH.`,
      atRestOk: true,
      inOpOk:   false,
    };
  }

  return {
    pass:     true,
    severity: 'info',
    gmpGrade: gradeName,
    message:  `Room meets ${gradeName} requirements. ${gradeData.note}`,
    atRestOk: true,
    inOpOk:   true,
  };
};

// ── Aggregate validator ───────────────────────────────────────────────────────

/**
 * validateRoom(rdsRow)
 *
 * MEDIUM-05 FIX: pass logic explicit and readable.
 * pass = false ONLY when a check has severity='error' AND pass=false.
 */
export const validateRoom = (rdsRow) => {
  const acphCheck     = validateAcph(rdsRow);
  const pressureCheck = validatePressure(rdsRow);
  const gmpCheck      = validateGmpCompliance(rdsRow);

  const allChecks = [acphCheck, pressureCheck, gmpCheck];

  const pass        = !allChecks.some(c => c.severity === 'error' && c.pass === false);
  const hasWarnings = allChecks.some(c => c.severity === 'warning');

  const flags = [...allChecks].sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 };
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });

  return {
    pass,
    hasWarnings,
    flags,
    acphCheck,
    pressureCheck,
    gmpCheck,
    isoClass:  governingClass(rdsRow),
    roomId:    rdsRow.id,
    roomName:  rdsRow.name,
  };
};

/**
 * validateAllRooms(rdsRows)
 */
export const validateAllRooms = (rdsRows) => {
  if (!rdsRows?.length) {
    return { allPass: true, totalErrors: 0, totalWarnings: 0, rooms: [], nonCompliantIds: [] };
  }

  const rooms         = rdsRows.map(validateRoom);
  const totalErrors   = rooms.filter(r => !r.pass).length;
  const totalWarnings = rooms.filter(r => r.hasWarnings).length;

  return {
    allPass:         totalErrors === 0,
    totalErrors,
    totalWarnings,
    rooms,
    nonCompliantIds: rooms.filter(r => !r.pass).map(r => r.roomId),
  };
};