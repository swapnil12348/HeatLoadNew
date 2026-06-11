/**
 * rdsLogging.ts
 * Shared logging utilities for the RDS calculation pipeline.
 *
 * Set LOG_RDS = false to silence info/warn logs in production.
 * console.error calls always fire regardless of LOG_RDS.
 */

export const LOG_RDS = true;

export const _log  = (...a: any[]) => { if (LOG_RDS) console.log('[rdsSelector]',    ...a); };
export const _warn = (...a: any[]) => { if (LOG_RDS) console.warn('[rdsSelector] ⚠', ...a); };
export const _err  = (...a: any[]) =>               console.error('[rdsSelector] ✗', ...a);

/**
 * Returns true if val is NOT a finite number.
 * Side-effect: fires console.error describing the bad field.
 * Use for fields where NaN would silently corrupt downstream arithmetic.
 */
export const _badNum = (val: any, field: string, roomId: string): boolean => {
  if (typeof val !== 'number' || !isFinite(val)) {
    _err(`NaN/invalid  field="${field}"  got=${JSON.stringify(val)}  (room ${roomId})`);
    return true;
  }
  return false;
};

/**
 * Safe formatter: coerces strings → numbers before .toFixed(), returns 'n/a' on failure.
 */
export const _fmt = (v: any, d: number): string => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isFinite(n) ? n.toFixed(d) : 'n/a';
};

/**
 * Checks val is a finite number AND not a string.
 * Catches the P1 regression where .toFixed() returned strings.
 */
export const _mustBeNumber = (val: any, field: string, roomId: string): void => {
  if (typeof val === 'string') {
    _err(`TYPE ERROR   field="${field}" is a string "${val}" — should be number  (room ${roomId})`);
  } else if (typeof val !== 'number' || !isFinite(val)) {
    _err(`NaN/invalid  field="${field}"  got=${JSON.stringify(val)}  (room ${roomId})`);
  }
};