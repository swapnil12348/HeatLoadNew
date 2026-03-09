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
 *     pass          — true only if ALL error-severity checks pass
 *     hasWarnings   — true if any warning-severity check triggered
 *                     (room passes but engineering review recommended)
 *     flags         — array of all check results, errors first
 *     acphCheck     — ACPH compliance detail
 *     pressureCheck — pressure compliance detail
 *     gmpCheck      — GMP Annex 1 check (pharma rooms only)
 *
 * ── rdsRow FIELD CONTRACT ─────────────────────────────────────────────────────
 *
 *   This module expects rdsRow (from rdsSelector) to contain:
 *
 *   supplyAir     (CFM) — TOTAL supply air (recirculation + OA combined).
 *                         ⚠️  If rdsSelector provides OA-only CFM here, ACPH
 *                         checks for ISO 3–6 (high-recirculation) rooms will
 *                         fail with enormous deficits. Confirm with rdsSelector.
 *
 *   volume        (ft³) — room volume in CUBIC FEET.
 *                         ⚠️  rdsSelector must output ft³, NOT m³.
 *                         Using m³ here would apply the 35.3147 conversion
 *                         and inflate volume by 35×, making every room fail.
 *                         FIX HIGH-01: removed the × 35.3147 multiplier.
 *                         Volume is computed once in computeVolumeFt3() below.
 *
 *   pressure      (Pa)  — room static pressure differential vs adjacent space
 *   atRestClass   (str) — ISO class at rest (e.g. 'ISO 5')
 *   classInOp     (str) — ISO class in operation
 *   ventCategory  (str) — room ventilation category ('pharma', 'semicon', ...)
 *   id, name            — room identifiers
 *
 * ── SEVERITY LEVELS ───────────────────────────────────────────────────────────
 *
 *   'error'   — hard non-compliance; room will fail qualification
 *   'warning' — borderline; engineering review required; room still passes
 *   'info'    — advisory only; not a compliance failure
 *
 * ── pass vs hasWarnings SEMANTICS ─────────────────────────────────────────────
 *
 *   pass = true  means no error-severity checks failed.
 *   A room can have pass = true AND hasWarnings = true simultaneously —
 *   meaning it meets minimum requirements but is operating below design target
 *   or has marginal pressure. This is intentional and documented here to
 *   prevent future refactors from accidentally treating warnings as failures.
 */

import {
  ACPH_RANGES,
  GMP_GRADE_MAPPING,
} from '../constants/isoCleanroom';

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * governingClass(room)
 * In-operation class governs during production — the stricter requirement.
 * Falls back to atRestClass if classInOp is unset or 'Unclassified'.
 */
const governingClass = (room) =>
  room.classInOp && room.classInOp !== 'Unclassified'
    ? room.classInOp
    : (room.atRestClass || 'Unclassified');

/**
 * computeVolumeFt3(rdsRow)
 *
 * FIX HIGH-01: rdsRow.volume is expected in ft³ (rdsSelector computes
 * volume as floorArea[ft²] × height[ft]). The previous × 35.3147 multiplier
 * assumed m³ input, which inflated volume by 35× and made every room's
 * ACPH appear 35× lower than reality.
 *
 * If rdsSelector changes to output m³, apply the conversion here and
 * update the rdsRow field contract above.
 */
const computeVolumeFt3 = (rdsRow) => parseFloat(rdsRow.volume) || 0;

/**
 * computeActualAcph(rdsRow)
 * Actual ACPH = supplyAir[CFM] × 60 / volume[ft³]
 * See rdsRow field contract above for supplyAir unit assumptions.
 */
const computeActualAcph = (rdsRow) => {
  const volumeFt3  = computeVolumeFt3(rdsRow);
  const supplyAir  = parseFloat(rdsRow.supplyAir) || 0;
  if (volumeFt3 <= 0) return 0;
  return parseFloat((supplyAir * 60 / volumeFt3).toFixed(1));
};

// ── Minimum pressure requirements by ISO class ────────────────────────────────
// Source: ISO 14644-4:2022, Table D.1 / industry practice.
// FIX HIGH-02: Added ISO 1–4 and ISO 9 entries.
// ISO 1–4 require higher differentials due to tighter particle control.
// ISO 9 is ambient reference — no pressure requirement.
const ISO_MIN_PRESSURE_PA = {
  'ISO 1':       25,   // FIX HIGH-02: was missing → fell back to 0
  'ISO 2':       25,   // FIX HIGH-02: was missing
  'ISO 3':       20,   // FIX HIGH-02: was missing
  'ISO 4':       17.5, // FIX HIGH-02: was missing
  'ISO 5':       15,
  'ISO 6':       12.5,
  'ISO 7':       10,
  'ISO 8':       5,
  'ISO 9':       0,    // FIX HIGH-02: ambient reference — no pressure requirement
  'CNC':          2,
  'Unclassified': 0,
};

// ── ACPH check ────────────────────────────────────────────────────────────────

/**
 * validateAcph(rdsRow)
 *
 * Checks whether the room's computed supply air ACPH meets the minimum
 * for its ISO classification.
 *
 * ⚠️  See rdsRow field contract at top of file for supplyAir / volume units.
 *     Ensure rdsSelector is providing total supply CFM and volume in ft³.
 *
 * @param {object} rdsRow - computed row from rdsSelector
 * @returns {{
 *   pass:        boolean,
 *   severity:    'error' | 'warning' | 'info',
 *   actualAcph:  number,
 *   minAcph:     number,
 *   designAcph:  number,
 *   isoClass:    string,
 *   message:     string,
 * }}
 */
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
      // Meets minimum — not an error. Warning signals below-design operation.
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

/**
 * validatePressure(rdsRow)
 *
 * Checks room differential pressure meets the minimum for its ISO class.
 * FIX HIGH-02: Full ISO 1–9 coverage added to ISO_MIN_PRESSURE_PA above.
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
  const isoClass   = governingClass(rdsRow);
  const pressure   = parseFloat(rdsRow.pressure) || 0;
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

  // Marginal: within 5 Pa of minimum
  if (pressure < minPressure + 5) {
    return {
      pass:     true,   // Meets minimum but with little margin
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
 * Cross-checks a room's at-rest and in-operation ISO classes against
 * GMP Annex 1:2022 requirements for pharma manufacturing.
 *
 * Depends on isoCleanroom.js FIX MED-01: GMP Grade B minAcph was null,
 * now correctly set to 20. Grade B rooms are now properly checked.
 *
 * Only meaningful for ventCategory = 'pharma'.
 *
 * @param {object} rdsRow
 * @returns {{
 *   pass:     boolean,
 *   severity: 'error' | 'warning' | 'info',
 *   gmpGrade: string | null,
 *   message:  string,
 *   atRestOk: boolean,
 *   inOpOk:   boolean,
 * }}
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

  const matchedGrade = Object.entries(GMP_GRADE_MAPPING).find(([, mapping]) =>
    mapping.isoAtRest === atRest && mapping.isoInOp === inOp
  );

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

  // FIX HIGH-01: removed × 35.3147 — volume in ft³
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
 * Runs all validation checks for one room and returns a unified result.
 *
 * pass semantics (FIX LOW-01: now explicitly documented):
 *   pass = true  → no error-severity checks failed
 *                  (warnings may still be present — check hasWarnings)
 *   pass = false → at least one error-severity check failed
 *
 * A check with { pass: false, severity: 'warning' } contributes true to the
 * overall pass because severity !== 'error'. This is intentional — warnings
 * mean "meets minimum, review recommended" not "hard failure".
 *
 * @param {object} rdsRow - computed row from rdsSelector
 * @returns {{
 *   pass:          boolean,
 *   hasWarnings:   boolean,
 *   flags:         Array,
 *   acphCheck:     object,
 *   pressureCheck: object,
 *   gmpCheck:      object,
 *   isoClass:      string,
 *   roomId:        string,
 *   roomName:      string,
 * }}
 */
export const validateRoom = (rdsRow) => {
  const acphCheck     = validateAcph(rdsRow);
  const pressureCheck = validatePressure(rdsRow);
  const gmpCheck      = validateGmpCompliance(rdsRow);

  const allChecks = [acphCheck, pressureCheck, gmpCheck];

  // pass: true only when no check has severity='error' AND pass=false
  // A check can have pass=false, severity='warning' — that is NOT a hard failure
  const pass        = allChecks.every(c => c.pass || c.severity !== 'error');
  const hasWarnings = allChecks.some(c => c.severity === 'warning');

  // Flags ordered: errors first, warnings second, info last
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
 *
 * Runs validateRoom() across the full rdsSelector output.
 * Returns a project-level summary plus per-room results.
 *
 * @param {Array} rdsRows - full selectRdsData output
 * @returns {{
 *   allPass:         boolean,
 *   totalErrors:     number,
 *   totalWarnings:   number,
 *   rooms:           Array,
 *   nonCompliantIds: string[],
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