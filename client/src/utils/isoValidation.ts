/**
 * isoValidation.ts
 * Responsibility: ISO 14644-1 compliance checks for room ACPH and pressure.
 *
 * CHANGELOG v2.3:
 *   FIX-ACPH-STD-01 — validateAcph(): pharma rooms now use GMP Annex 1
 *   minimum ACPH instead of IEST-RP-CC012.2 minimum.
 *
 * CHANGELOG v2.2:
 *   MED-ISO-01 — computeActualAcph() now uses rdsRow.supplyAcph as
 *   primary source of truth (single ACPH computation path).
 *
 * CHANGELOG v2.1:
 *   CRITICAL-02 — validateGmpCompliance(): Grade D rooms now match correctly.
 *   MEDIUM-05   — validateRoom() pass logic made explicit and readable.
 *
 * Reference: ISO 14644-1:2015, ISO 14644-4:2022, GMP Annex 1:2022
 */

import {
  ACPH_RANGES,
  GMP_GRADE_MAPPING,
} from '../constants/isoCleanroom';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationRdsRow {
  id?: string | number;
  name?: string;
  classInOp?: string;
  atRestClass?: string;
  supplyAcph?: number | string;
  volume?: number | string;
  supplyAir?: number | string;
  ventCategory?: string;
  pressure?: number | string;
}

export interface AcphValidationResult {
  pass: boolean;
  severity: ValidationSeverity;
  actualAcph: number;
  minAcph: number;
  designAcph: number;
  isoClass: string;
  standardBasis: string;
  message: string;
}

export interface PressureValidationResult {
  pass: boolean;
  severity: ValidationSeverity;
  pressure: number;
  minPa: number;
  message: string;
}

export interface GmpValidationResult {
  pass: boolean;
  severity: ValidationSeverity;
  gmpGrade: string | null;
  message: string;
  atRestOk: boolean;
  inOpOk: boolean;
}

export type AnyValidationCheck = 
  | AcphValidationResult 
  | PressureValidationResult 
  | GmpValidationResult;

export interface RoomValidationResult {
  pass: boolean;
  hasWarnings: boolean;
  flags: AnyValidationCheck[];
  acphCheck: AcphValidationResult;
  pressureCheck: PressureValidationResult;
  gmpCheck: GmpValidationResult;
  isoClass: string;
  roomId: string | number | undefined;
  roomName: string | undefined;
}

export interface AllRoomsValidationResult {
  allPass: boolean;
  totalErrors: number;
  totalWarnings: number;
  rooms: RoomValidationResult[];
  nonCompliantIds: (string | number | undefined)[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * governingClass
 * In-operation class governs during production — the stricter requirement.
 */
const governingClass = (room: ValidationRdsRow): string =>
  room.classInOp && room.classInOp !== 'Unclassified'
    ? room.classInOp
    : (room.atRestClass || 'Unclassified');

/**
 * computeActualAcph
 * Uses rdsRow.supplyAcph as primary source of truth.
 * Fallback recomputes from raw fields if supplyAcph is absent.
 */
const computeActualAcph = (rdsRow: ValidationRdsRow): number => {
  if (rdsRow.supplyAcph != null) {
    const parsedAcph = parseFloat(String(rdsRow.supplyAcph));
    if (parsedAcph > 0) return parsedAcph;
  }

  // Fallback: recompute from raw fields.
  // Requires rdsRow.volume to be in ft³.
  const volumeFt3 = parseFloat(String(rdsRow.volume)) || 0;
  const supplyAir = parseFloat(String(rdsRow.supplyAir)) || 0;
  if (volumeFt3 <= 0) return 0;
  
  return parseFloat(((supplyAir * 60) / volumeFt3).toFixed(1));
};

/**
 * resolveAcphThreshold
 * Determines the governing ACPH minimum and standard basis.
 */
const resolveAcphThreshold = (
  rdsRow: ValidationRdsRow,
  range: { min: number; design: number }
): { minAcph: number; standardBasis: string } => {
  if (rdsRow.ventCategory !== 'pharma') {
    return {
      minAcph: range.min,
      standardBasis: 'IEST-RP-CC012.2 / ISO 14644-4',
    };
  }

  // For pharma rooms, check if a GMP grade applies and has a lower regulatory min.
  // GMP Annex 1:2022 §4.23 mandates ≥20 ACPH for Grade B, C, and D.
  const atRest = rdsRow.atRestClass || 'Unclassified';
  const inOp = rdsRow.classInOp || 'Unclassified';

  const gmpTable: Record<string, any> = GMP_GRADE_MAPPING;
  const matchedGrade = Object.entries(gmpTable).find(([, m]) => {
    const atRestMatch = m.isoAtRest === atRest;
    const inOpMatch = m.isoInOp === null
      ? (inOp === 'Unclassified' || !inOp)
      : m.isoInOp === inOp;
    return atRestMatch && inOpMatch;
  });

  if (matchedGrade && matchedGrade[1].minAcph) {
    const [gradeName, gradeData] = matchedGrade;
    return {
      minAcph: gradeData.minAcph,
      standardBasis: `GMP Annex 1:2022 §4.23 (${gradeName})`,
    };
  }

  // Pharma room but no matching GMP grade — fall back to IEST.
  return {
    minAcph: range.min,
    standardBasis: 'IEST-RP-CC012.2 (no GMP grade matched — review ISO classes)',
  };
};

// ── Minimum pressure requirements by ISO class ────────────────────────────────
const ISO_MIN_PRESSURE_PA: Record<string, number> = {
  'ISO 1': 25,
  'ISO 2': 25,
  'ISO 3': 20,
  'ISO 4': 17.5,
  'ISO 5': 15,
  'ISO 6': 12.5,
  'ISO 7': 10,
  'ISO 8': 5,
  'ISO 9': 0,
  'CNC': 2,
  'Unclassified': 0,
};

// ── ACPH check ────────────────────────────────────────────────────────────────

export const validateAcph = (rdsRow: ValidationRdsRow): AcphValidationResult => {
  const isoClass = governingClass(rdsRow);
  
  const acphTable: Record<string, any> = ACPH_RANGES;
  const range = acphTable[isoClass] ?? acphTable['Unclassified'];
  
  const actualAcph = computeActualAcph(rdsRow);
  const designAcph = range.design;

  const { minAcph, standardBasis } = resolveAcphThreshold(rdsRow, range);
  const deficit = minAcph - actualAcph;

  if (actualAcph < minAcph) {
    return {
      pass: false,
      severity: 'error',
      actualAcph,
      minAcph,
      designAcph,
      isoClass,
      standardBasis,
      message: `ACPH ${actualAcph} is below minimum ${minAcph} for ${isoClass} ` +
               `(${standardBasis}). Deficit: ${deficit.toFixed(1)} ACPH.`,
    };
  }

  if (actualAcph < designAcph) {
    return {
      pass: true,
      severity: 'warning',
      actualAcph,
      minAcph,
      designAcph,
      isoClass,
      standardBasis,
      message: `ACPH ${actualAcph} meets regulatory minimum ${minAcph} ` +
               `(${standardBasis}) but is below IEST design target ` +
               `${designAcph} for ${isoClass}.`,
    };
  }

  return {
    pass: true,
    severity: 'info',
    actualAcph,
    minAcph,
    designAcph,
    isoClass,
    standardBasis,
    message: `ACPH ${actualAcph} meets ${isoClass} design requirement ` +
             `(≥${designAcph}, ${standardBasis}).`,
  };
};

// ── Pressure check ────────────────────────────────────────────────────────────

export const validatePressure = (rdsRow: ValidationRdsRow): PressureValidationResult => {
  const isoClass = governingClass(rdsRow);
  const pressure = parseFloat(String(rdsRow.pressure)) || 0;
  const minPressure = ISO_MIN_PRESSURE_PA[isoClass] ?? 0;

  if (isoClass === 'Unclassified' || isoClass === 'ISO 9') {
    return {
      pass: true,
      severity: 'info',
      pressure,
      minPa: 0,
      message: 'No pressure requirement for unclassified / ambient rooms.',
    };
  }

  if (pressure < minPressure) {
    return {
      pass: false,
      severity: 'error',
      pressure,
      minPa: minPressure,
      message: `Room pressure ${pressure} Pa is below minimum ${minPressure} Pa ` +
               `for ${isoClass}. (ISO 14644-4:2022 Table D.1)`,
    };
  }

  if (pressure < minPressure + 5) {
    return {
      pass: true,
      severity: 'warning',
      pressure,
      minPa: minPressure,
      message: `Room pressure ${pressure} Pa is marginal for ${isoClass} ` +
               `(min ${minPressure} Pa). Consider increasing for control margin.`,
    };
  }

  return {
    pass: true,
    severity: 'info',
    pressure,
    minPa: minPressure,
    message: `Room pressure ${pressure} Pa meets ${isoClass} requirement ` +
             `(min ${minPressure} Pa).`,
  };
};

// ── GMP Annex 1 check ─────────────────────────────────────────────────────────

export const validateGmpCompliance = (rdsRow: ValidationRdsRow): GmpValidationResult => {
  if (rdsRow.ventCategory !== 'pharma') {
    return {
      pass: true,
      severity: 'info',
      gmpGrade: null,
      message: 'GMP Annex 1 check not applicable for non-pharma rooms.',
      atRestOk: true,
      inOpOk: true,
    };
  }

  const atRest = rdsRow.atRestClass || 'Unclassified';
  const inOp = rdsRow.classInOp || 'Unclassified';

  const gmpTable: Record<string, any> = GMP_GRADE_MAPPING;
  const matchedGrade = Object.entries(gmpTable).find(([, mapping]) => {
    const atRestMatch = mapping.isoAtRest === atRest;
    const inOpMatch =
      mapping.isoInOp === null
        ? (inOp === 'Unclassified' || !inOp)
        : mapping.isoInOp === inOp;
    return atRestMatch && inOpMatch;
  });

  if (!matchedGrade) {
    return {
      pass: false,
      severity: 'warning',
      gmpGrade: null,
      message: `ISO combination (At Rest: ${atRest} / In Op: ${inOp}) does not ` +
               'map to a standard GMP Annex 1 grade. Engineering review required.',
      atRestOk: false,
      inOpOk: false,
    };
  }

  const [gradeName, gradeData] = matchedGrade;
  const actualAcph = computeActualAcph(rdsRow);

  if (gradeData.minAcph && actualAcph < gradeData.minAcph) {
    return {
      pass: false,
      severity: 'error',
      gmpGrade: gradeName,
      message: `${gradeName} requires ≥${gradeData.minAcph} ACPH (GMP Annex 1:2022 §4.23). ` +
               `Actual: ${actualAcph.toFixed(1)} ACPH.`,
      atRestOk: true,
      inOpOk: false,
    };
  }

  return {
    pass: true,
    severity: 'info',
    gmpGrade: gradeName,
    message: `Room meets ${gradeName} requirements. ${gradeData.note}`,
    atRestOk: true,
    inOpOk: true,
  };
};

// ── Aggregate validator ───────────────────────────────────────────────────────

export const validateRoom = (rdsRow: ValidationRdsRow): RoomValidationResult => {
  const acphCheck = validateAcph(rdsRow);
  const pressureCheck = validatePressure(rdsRow);
  const gmpCheck = validateGmpCompliance(rdsRow);

  const allChecks: AnyValidationCheck[] = [acphCheck, pressureCheck, gmpCheck];

  const pass = !allChecks.some((c) => c.severity === 'error' && c.pass === false);
  const hasWarnings = allChecks.some((c) => c.severity === 'warning');

  const order: Record<ValidationSeverity, number> = { error: 0, warning: 1, info: 2 };
  
  const flags = [...allChecks].sort((a, b) => {
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });

  return {
    pass,
    hasWarnings,
    flags,
    acphCheck,
    pressureCheck,
    gmpCheck,
    isoClass: governingClass(rdsRow),
    roomId: rdsRow.id,
    roomName: rdsRow.name,
  };
};

export const validateAllRooms = (rdsRows: ValidationRdsRow[] | undefined | null): AllRoomsValidationResult => {
  if (!rdsRows?.length) {
    return { allPass: true, totalErrors: 0, totalWarnings: 0, rooms: [], nonCompliantIds: [] };
  }

  const rooms = rdsRows.map(validateRoom);
  const totalErrors = rooms.filter((r) => !r.pass).length;
  const totalWarnings = rooms.filter((r) => r.hasWarnings).length;

  return {
    allPass: totalErrors === 0,
    totalErrors,
    totalWarnings,
    rooms,
    nonCompliantIds: rooms.filter((r) => !r.pass).map((r) => r.roomId),
  };
};