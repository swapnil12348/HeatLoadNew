/**
 * isoValidation.js
 * Responsibility: ISO 14644-1 compliance checks for room ACPH and pressure.
 *
 * CHANGELOG v2.2:
 *
 *   MED-ISO-01 FIX — computeActualAcph() now uses rdsRow.supplyAcph as
 *   primary source of truth (single ACPH computation path).
 *
 *     The previous pattern computed ACPH independently inside isoValidation:
 *       const volumeFt3 = parseFloat(rdsRow.volume) || 0;
 *       const actualAcph = supplyAir * 60 / volumeFt3;
 *
 *     This created two separate ACPH computation paths:
 *       1. rdsSelector.js → supplyAcph (uses local volumeFt3 in ft³)
 *       2. isoValidation.js → computeActualAcph (reads rdsRow.volume)
 *
 *     These paths diverge critically when rdsRow.volume is in m³ (CRIT-RDS-01):
 *       A 500 m³ room (= 17,657 ft³) at 1,000 CFM supply:
 *         rdsSelector ACPH: 1000 × 60 / 17,657 = 3.4 ACPH (correct)
 *         isoValidation ACPH: 1000 × 60 / 500  = 120 ACPH (false pass)
 *
 *     After CRIT-RDS-01 fix (rdsRow.volume is now ft³), both paths agree,
 *     but maintaining two computation paths creates ongoing maintenance risk.
 *
 *     Fix: computeActualAcph() now prefers rdsRow.supplyAcph when available.
 *     rdsSelector.js computes supplyAcph correctly using local volumeFt3 (ft³).
 *     The fallback computation remains for contexts where rdsRow.supplyAcph
 *     may not be present (e.g. unit tests that construct rdsRow manually).
 *
 *   CRIT-RDS-01 DEPENDENCY: This file assumes rdsRow.volume is in ft³.
 *   After the CRIT-RDS-01 fix to rdsSelector.js (which adds volume: volumeFt3
 *   to override the m³ value from room spread), the fallback computation here
 *   is correct. Without CRIT-RDS-01 fix, even the fallback would be wrong.
 *
 * CHANGELOG v2.1:
 *
 *   CRITICAL-02 FIX — validateGmpCompliance(): Grade D rooms now match correctly.
 *
 *     GMP_GRADE_MAPPING['Grade D'].isoInOp = null (correct — GMP Annex 1:2022
 *     §4.7 defines no fixed in-operation ISO class for Grade D).
 *
 *     The previous match logic used strict string equality:
 *       mapping.isoInOp === inOp
 *     where inOp = 'Unclassified' when room.classInOp is absent.
 *     null === 'Unclassified' is always false → Grade D rooms NEVER matched.
 *
 *     Fix: null isoInOp means "any absent/unclassified" — match succeeds
 *     when room.classInOp is 'Unclassified', null, or undefined.
 *
 *   MEDIUM-05 FIX — validateRoom() pass logic made explicit and readable.
 *
 *     Previous: allChecks.every(c => c.pass || c.severity !== 'error')
 *     New:      !allChecks.some(c => c.severity === 'error' && c.pass === false)
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
 *
 * rdsSelector.js computes supplyAcph from the correct local volumeFt3 (ft³):
 *   supplyAcph = supplyAir * 60 / volumeFt3   (where volumeFt3 = m3ToFt3(room.volume))
 *
 * Preferring supplyAcph eliminates the second computation path and guarantees
 * the same ACPH value is used for both compliance display and validation.
 *
 * Fallback: compute from rdsRow.supplyAir / rdsRow.volume. After CRIT-RDS-01
 * fix, rdsRow.volume is in ft³. Without that fix, this fallback is wrong.
 *
 * @param {object} rdsRow - assembled rdsRow from rdsSelector.js
 * @returns {number} ACPH, to 1 decimal place
 */
const computeActualAcph = (rdsRow) => {
  // MED-ISO-01 FIX: prefer the pre-computed supplyAcph from rdsSelector.js.
  // This is the single canonical ACPH value — same number shown in the RDS
  // display, same number used for ISO compliance validation.
  if (rdsRow.supplyAcph != null && rdsRow.supplyAcph > 0) {
    return parseFloat(rdsRow.supplyAcph);
  }

  // Fallback: recompute from raw fields.
  // Requires rdsRow.volume to be in ft³ (guaranteed after CRIT-RDS-01 fix).
  // ⚠️  If supplyAcph is missing and rdsRow.volume is still in m³ (CRIT-RDS-01
  //     not yet applied), this fallback will produce ACPH values 35.3× too high.
  const volumeFt3 = parseFloat(rdsRow.volume)    || 0;
  const supplyAir = parseFloat(rdsRow.supplyAir) || 0;
  if (volumeFt3 <= 0) return 0;
  return parseFloat((supplyAir * 60 / volumeFt3).toFixed(1));
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

export const validateAcph = (rdsRow) => {
  const isoClass   = governingClass(rdsRow);
  const range      = ACPH_RANGES[isoClass] ?? ACPH_RANGES['Unclassified'];
  const actualAcph = computeActualAcph(rdsRow);  // MED-ISO-01 FIX: single source
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
      pass:        true,
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
    message:     `ACPH ${actualAcph} meets ${isoClass} design requirement (≥${designAcph}).`,
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
 * computeActualAcph() updated per MED-ISO-01.
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
  const actualAcph = computeActualAcph(rdsRow);  // MED-ISO-01 FIX: single source

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