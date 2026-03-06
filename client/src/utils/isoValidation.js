/**
 * isoValidation.js
 * Responsibility: ISO 14644-1 compliance checks for room ACPH and pressure.
 *
 * Reference: ISO 14644-1:2015 — Classification of air cleanliness by particle
 *            ISO 14644-4:2022 — Design, construction, and start-up
 *            GMP Annex 1:2022 (EMA) — Manufacture of Sterile Medicinal Products
 *
 * ── WHAT THIS MODULE DOES ─────────────────────────────────────────────────────
 *
 *   Validates a computed room data object (from rdsSelector) against the
 *   minimum requirements for its declared ISO class.
 *
 *   Returns a structured result with:
 *     pass          — boolean, overall compliance
 *     flags         — array of specific failures with severity and message
 *     acphCheck     — ACPH compliance detail
 *     pressureCheck — pressure compliance detail
 *     gmpCheck      — GMP Annex 1 compliance detail (pharma rooms only)
 *
 *   This result is consumed by:
 *     ResultsPage   — compliance summary table
 *     RoomSidebar   — red dot indicator on non-compliant rooms
 *     RDSPage       — row-level compliance badge
 *
 * ── SEVERITY LEVELS ───────────────────────────────────────────────────────────
 *
 *   'error'   — hard non-compliance, room will fail qualification
 *   'warning' — borderline, engineering review required
 *   'info'    — advisory only, not a compliance failure
 */

import {
  ACPH_RANGES,
  ISO_CLASS_DATA,
  GMP_GRADE_MAPPING,
} from '../constants/isoCleanroom';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve the governing ISO class for compliance checking.
 * In-operation class governs during production — the stricter requirement.
 * If classInOp is unset, fall back to atRestClass.
 *
 * @param {object} room
 * @returns {string} governing ISO class string
 */
const governingClass = (room) =>
  room.classInOp && room.classInOp !== 'Unclassified'
    ? room.classInOp
    : (room.atRestClass || 'Unclassified');

// ── ACPH check ────────────────────────────────────────────────────────────────

/**
 * validateAcph()
 * Checks whether the room's computed supply air ACPH meets the minimum
 * for its ISO classification.
 *
 * @param {object} rdsRow   - computed row from rdsSelector
 * @returns {{
 *   pass:         boolean,
 *   severity:     'error' | 'warning' | 'info',
 *   actualAcph:   number,
 *   minAcph:      number,
 *   designAcph:   number,
 *   isoClass:     string,
 *   message:      string,
 * }}
 */
export const validateAcph = (rdsRow) => {
  const isoClass    = governingClass(rdsRow);
  const range       = ACPH_RANGES[isoClass] ?? ACPH_RANGES['Unclassified'];

  // Actual ACPH from supply air and room volume
  // supplyAir is CFM; volume is m³ — convert volume to ft³ first
  const volumeFt3   = (parseFloat(rdsRow.volume) || 0) * 35.3147;
  const actualAcph  = volumeFt3 > 0
    ? parseFloat(((parseFloat(rdsRow.supplyAir) || 0) * 60 / volumeFt3).toFixed(1))
    : 0;

  const minAcph    = range.min;
  const designAcph = range.design;
  const deficit    = minAcph - actualAcph;

  if (actualAcph < minAcph) {
    return {
      pass:        false,
      severity:    'error',
      actualAcph,
      minAcph,
      designAcph,
      isoClass,
      message:     `ACPH ${actualAcph} is below minimum ${minAcph} for ${isoClass}.`
               + ` Deficit: ${deficit.toFixed(1)} ACPH.`,
    };
  }

  if (actualAcph < designAcph) {
    return {
      pass:        true,   // meets minimum but below design — advisory
      severity:    'warning',
      actualAcph,
      minAcph,
      designAcph,
      isoClass,
      message:     `ACPH ${actualAcph} meets minimum (${minAcph}) `
               + `but is below design target (${designAcph}) for ${isoClass}.`,
    };
  }

  return {
    pass:        true,
    severity:    'info',
    actualAcph,
    minAcph,
    designAcph,
    isoClass,
    message:     `ACPH ${actualAcph} meets ${isoClass} design requirement (${designAcph} min).`,
  };
};

// ── Pressure check ────────────────────────────────────────────────────────────

/**
 * validatePressure()
 * Checks room pressure is positive (cleanroom cascade positive pressure).
 * Advisory only for unclassified rooms.
 *
 * @param {object} rdsRow
 * @returns {{
 *   pass:     boolean,
 *   severity: 'error' | 'warning' | 'info',
 *   pressure: number,
 *   minPa:    number,
 *   message:  string,
 * }}
 */
export const validatePressure = (rdsRow) => {
  const isoClass = governingClass(rdsRow);
  const pressure = parseFloat(rdsRow.pressure) || 0;

  // Minimum positive pressure by class
  // Source: ISO 14644-4:2022 Table D.1
  const minPressure = {
    'ISO 5':       15,
    'ISO 6':       12.5,
    'ISO 7':       10,
    'ISO 8':       5,
    'CNC':          2,
    'Unclassified': 0,
  }[isoClass] ?? 0;

  if (isoClass === 'Unclassified') {
    return {
      pass:     true,
      severity: 'info',
      pressure,
      minPa:    0,
      message:  'No pressure requirement for unclassified rooms.',
    };
  }

  if (pressure < minPressure) {
    return {
      pass:     false,
      severity: 'error',
      pressure,
      minPa:    minPressure,
      message:  `Room pressure ${pressure} Pa is below minimum ${minPressure} Pa for ${isoClass}.`,
    };
  }

  if (pressure < minPressure + 5) {
    return {
      pass:     true,
      severity: 'warning',
      pressure,
      minPa:    minPressure,
      message:  `Room pressure ${pressure} Pa is marginal for ${isoClass} (min ${minPressure} Pa).`
              + ' Consider increasing to provide control margin.',
    };
  }

  return {
    pass:     true,
    severity: 'info',
    pressure,
    minPa:    minPressure,
    message:  `Room pressure ${pressure} Pa meets ${isoClass} requirement (min ${minPressure} Pa).`,
  };
};

// ── GMP Annex 1 check ─────────────────────────────────────────────────────────

/**
 * validateGmpCompliance()
 * Cross-checks a room's at-rest and in-operation ISO classes against
 * GMP Annex 1:2022 requirements for pharma manufacturing.
 *
 * Only meaningful for pharmaceutical facilities.
 * Returns 'info' pass for non-pharma ventCategory rooms.
 *
 * @param {object} rdsRow
 * @returns {{
 *   pass:        boolean,
 *   severity:    'error' | 'warning' | 'info',
 *   gmpGrade:    string | null,
 *   message:     string,
 *   atRestOk:    boolean,
 *   inOpOk:      boolean,
 * }}
 */
export const validateGmpCompliance = (rdsRow) => {
  // Only validate pharma rooms
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

  // Find matching GMP grade from the mapping
  const matchedGrade = Object.entries(GMP_GRADE_MAPPING).find(([, mapping]) =>
    mapping.isoAtRest === atRest && mapping.isoInOp === inOp
  );

  if (!matchedGrade) {
    return {
      pass:     false,
      severity: 'warning',
      gmpGrade: null,
      message:  `ISO combination (At Rest: ${atRest} / In Op: ${inOp}) does not`
              + ' map to a standard GMP Annex 1 grade. Engineering review required.',
      atRestOk: false,
      inOpOk:   false,
    };
  }

  const [gradeName, gradeData] = matchedGrade;

  // Check minimum ACPH for GMP grade if specified
  const volumeFt3  = (parseFloat(rdsRow.volume) || 0) * 35.3147;
  const actualAcph = volumeFt3 > 0
    ? (parseFloat(rdsRow.supplyAir) || 0) * 60 / volumeFt3
    : 0;

  if (gradeData.minAcph && actualAcph < gradeData.minAcph) {
    return {
      pass:     false,
      severity: 'error',
      gmpGrade: gradeName,
      message:  `${gradeName} requires ≥${gradeData.minAcph} ACPH. `
              + `Actual: ${actualAcph.toFixed(1)} ACPH. (GMP Annex 1:2022 §4.23)`,
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
 * validateRoom()
 * Runs all validation checks for one room and returns a unified result.
 *
 * @param {object} rdsRow  - computed row from rdsSelector
 * @returns {{
 *   pass:          boolean,   true only if ALL error-level checks pass
 *   hasWarnings:   boolean,   true if any warning-level checks triggered
 *   flags:         Array,     all check results in severity order
 *   acphCheck:     object,
 *   pressureCheck: object,
 *   gmpCheck:      object,
 *   isoClass:      string,    governing class used for checks
 *   roomId:        string,
 *   roomName:      string,
 * }}
 */
export const validateRoom = (rdsRow) => {
  const acphCheck     = validateAcph(rdsRow);
  const pressureCheck = validatePressure(rdsRow);
  const gmpCheck      = validateGmpCompliance(rdsRow);

  const allChecks = [acphCheck, pressureCheck, gmpCheck];

  const pass        = allChecks.every(c => c.pass || c.severity !== 'error');
  const hasWarnings = allChecks.some(c => c.severity === 'warning');

  // Flags ordered: errors first, warnings second, info last
  const flags = [...allChecks].sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
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
 * validateAllRooms()
 * Runs validateRoom() across the full rdsSelector output.
 * Returns a summary plus per-room results.
 *
 * @param {Array}  rdsRows  - full selectRdsData output
 * @returns {{
 *   allPass:         boolean,
 *   totalErrors:     number,
 *   totalWarnings:   number,
 *   rooms:           Array,   per-room validateRoom() results
 *   nonCompliantIds: string[] room IDs with errors
 * }}
 */
export const validateAllRooms = (rdsRows) => {
  if (!rdsRows?.length) {
    return {
      allPass:         true,
      totalErrors:     0,
      totalWarnings:   0,
      rooms:           [],
      nonCompliantIds: [],
    };
  }

  const rooms = rdsRows.map(validateRoom);

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