/**
 * checkFigure(totalAreaM2, totalTR)
 * Computes ft²/TR — standard HVAC sanity check for load density.
 *
 * Typical benchmarks:
 *   Semiconductor fab:    20–50 ft²/TR  (very high process load density)
 *   Pharma cleanroom:     50–150 ft²/TR
 *   General commercial:   250–400 ft²/TR
 *   Data centre:          10–30 ft²/TR
 * Source: ASHRAE HVAC Applications 2019, Ch.18 / industry benchmarks.
 */

import { num, m2ToFt2 } from '../../utils/units';

export const checkFigure = (totalAreaM2: number | string, totalTR: number | string | null | undefined): number => {
  const tr = num(totalTR);
  if (tr <= 0) return 0;
  return parseFloat((m2ToFt2(totalAreaM2) / tr).toFixed(1));
};