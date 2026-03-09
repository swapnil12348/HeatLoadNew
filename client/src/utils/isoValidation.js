/**
 * isoValidation.js
 * Responsibility: ISO 14644-1 compliance checks for room ACPH and pressure.
 *
 * CHANGELOG v2.1:
 *
 *   CRITICAL-02 FIX — validateGmpCompliance(): Grade D rooms now match correctly.
 *
 *     GMP_GRADE_MAPPING['Grade D'].isoInOp = null (correct — GMP Annex 1:2022
 *     §4.7 defines no fixed in-operation ISO class for Grade D; it is set by
 *     a facility contamination risk assessment).
 *
 *     The previous match logic used strict string equality:
 *       mapping.isoInOp === inOp
 *     where inOp comes from governingClass() → returns 'Unclassified' when
 *     room.classInOp is absent. The comparison null === 'Unclassified' is
 *     always false, so Grade D rooms NEVER matched — they always received the
 *     warning "ISO combination does not map to a standard GMP Annex 1 grade."
 *
 *     This was a false compliance failure for the most common room type in
 *     pharma facilities (gowning, inspection, packaging support areas).
 *
 *     Fix: the match function now handles null isoInOp explicitly — a null
 *     in the mapping means "any value or absent" for the in-operation class,
 *     so the match succeeds when room.classInOp is 'Unclassified', null, or
 *     undefined. The at-rest condition still must match exactly.
 *
 *   MEDIUM-05 FIX — validateRoom() pass logic made explicit and readable.
 *
 *     Previous:  allChecks.every(c => c.pass || c.severity !== 'error')
 *     New:       !allChecks.some(c => c.severity === 'error' && c.pass === false)
 *
 *     These are logically equivalent, but the new form directly expresses the
 *     intent: "fail only when a check has BOTH severity='error' AND pass=false."
 *     The previous double-negative form was a trap for future severity levels —
 *     adding a 'critical' severity would have silently been treated as 'info'.
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
 * computeVolumeFt3(rdsRow)
 * FIX HIGH-01: rdsRow.volume is in ft³ (rdsSelector computes floorArea[ft²] × height[ft]).
 */
const computeVolumeFt3 = (rdsRow) => parseFloat(rdsRow.volume) || 0;

/**
 * computeActualAcph(rdsRow)
 * Actual ACPH = supplyAir[CFM] × 60 / volume[ft³]
 */
const computeActualAcph = (rdsRow) => {
  const volumeFt3 = computeVolumeFt3(rdsRow);
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
  const actualAcph = computeActualAcph(rdsRow);
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
 *
 * The match function handles null isoInOp in GMP_GRADE_MAPPING:
 *   null means "in-operation class is defined by risk assessment" (Grade D).
 *   The match succeeds when room.classInOp is absent, 'Unclassified', or null.
 *
 * Match logic:
 *   atRestMatch:  mapping.isoAtRest === room.atRestClass        (exact)
 *   inOpMatch:    if mapping.isoInOp is null → any absent/unclassified inOp
 *                 if mapping.isoInOp is string → exact match required
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
  //
  // GMP_GRADE_MAPPING['Grade D'].isoInOp = null because GMP Annex 1:2022 §4.7
  // does not fix an in-operation ISO class for Grade D — it is set by facility
  // risk assessment. null is the semantically correct data value.
  //
  // The previous code used: mapping.isoInOp === inOp
  //   → null === 'Unclassified' is ALWAYS false
  //   → Grade D rooms NEVER matched, producing a false "unknown grade" warning
  //
  // Fixed: when mapping.isoInOp is null, match succeeds if room.classInOp
  // is absent ('Unclassified') or explicitly null — both indicate the room
  // does not have a fixed in-operation class, consistent with Grade D intent.
  const matchedGrade = Object.entries(GMP_GRADE_MAPPING).find(([, mapping]) => {
    const atRestMatch = mapping.isoAtRest === atRest;
    const inOpMatch =
      mapping.isoInOp === null
        ? (inOp === 'Unclassified' || !inOp)   // null = risk-assessment basis; any absent/unclassified matches
        : mapping.isoInOp === inOp;              // defined grades require exact match
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
 * MEDIUM-05 FIX: pass logic made explicit and readable.
 *
 * pass = false ONLY when a check has BOTH:
 *   severity === 'error'  AND  pass === false
 *
 * A check with pass=false but severity='warning' does NOT fail the room —
 * it means "meets minimum, engineering review recommended."
 *
 * A check with severity='error' but pass=true is logically contradictory
 * (should not occur) but is handled safely by the new form.
 *
 * If a new severity level (e.g. 'critical') is added in future:
 *   - Old form: c.severity !== 'error' would treat 'critical' like 'info' (silent bug)
 *   - New form: c.severity === 'error' would ignore 'critical' (visible omission)
 *   Update the condition explicitly when adding new severities.
 */
export const validateRoom = (rdsRow) => {
  const acphCheck     = validateAcph(rdsRow);
  const pressureCheck = validatePressure(rdsRow);
  const gmpCheck      = validateGmpCompliance(rdsRow);

  const allChecks = [acphCheck, pressureCheck, gmpCheck];

  // MEDIUM-05 FIX: explicit readable form — was: allChecks.every(c => c.pass || c.severity !== 'error')
  // pass = false only when a check has severity='error' AND pass=false.
  // Equivalent boolean logic but directly expresses the intent.
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