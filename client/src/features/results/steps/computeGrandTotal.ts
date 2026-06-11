/**
 * steps/computeGrandTotal.ts
 * STEP 4 / STEP5-01 — Peak cooling season selection, fan heat proxy, grand total.
 *
 * ⚠ HIGH-RDS-01 NOTE:
 *   supplyFanHeatBTU uses a percentage-of-capacity proxy because ahu.fanMotorKW is
 *   not yet in ahuSlice. The Excel formula (motor kW × 3412) gives ~17 000 BTU/hr
 *   for a 5 kW fan; this proxy gives ~400–900 BTU. Fix: add fanMotorKW to ahuSlice
 *   and replace the proxy with `ahu.fanMotorKW * KW_TO_BTU_HR`.
 *
 * Reference: ASHRAE HOF 2021 Ch.18
 */

import { KW_TO_BTU_HR } from '../../../utils/units';
import { _log, _warn, _err, _badNum } from '../rdsLogging';
import { SEASONS_LIST } from '../rdsTypes';
import type { Season, GrandTotalResult } from '../rdsTypes';

export function computeGrandTotal(
  seasonResults:  Record<string, number>,
  oaLoads:        Record<string, any>,
  systemDesign:   any,
  supplyAir:      number,
  adpF:           number,
  dbInF:          number,
  bf:             number,
  Cs:             number,
  peakCFMSeason:  Season,
  roomId:         string,
): GrandTotalResult {

  // ── Pick peak cooling season (highest ERSH + ERLH + OA) ──────────────────
  const seasonTotals: Record<string, number> = {};
  SEASONS_LIST.forEach((s) => {
    seasonTotals[s] =
      (seasonResults[`ershOn_${s}`] || 0) +
      (seasonResults[`erlhOn_${s}`] || 0) +
      (oaLoads[s]?.oaTotal         || 0);
  });

  const peakCoolingSeason = SEASONS_LIST.reduce(
    (best, s) => (seasonTotals[s] > seasonTotals[best] ? s : best),
    peakCFMSeason
  );

  if (peakCoolingSeason !== peakCFMSeason) {
    _log(
      `STEP5-01: ⚡ peakCFMSeason (${peakCFMSeason}) ≠ peakCoolingSeason (${peakCoolingSeason})` +
      ` — TR season differs from CFM season`
    );
  }

  const peakErshForCap = seasonResults[`ershOn_${peakCoolingSeason}`];
  const peakErlhForCap = seasonResults[`erlhOn_${peakCoolingSeason}`];
  const oaPeak         = oaLoads[peakCoolingSeason];

  // ── Fan heat fractions ────────────────────────────────────────────────────
  const parsedFanHeat         = parseFloat(String(systemDesign.fanHeat));
  const supplyFanHeatFraction = (!isNaN(parsedFanHeat)       ? parsedFanHeat       : 5) / 100;
  const parsedReturnFanHeat   = parseFloat(String(systemDesign.returnFanHeat));
  const returnFanHeatFraction = (!isNaN(parsedReturnFanHeat) ? parsedReturnFanHeat : 5) / 100;

  if (isNaN(parsedFanHeat)) {
    _warn(`STEP5-01: systemDesign.fanHeat="${systemDesign.fanHeat}" invalid — using 5% default`);
  }
  if (isNaN(parsedReturnFanHeat)) {
    _warn(`STEP5-01: systemDesign.returnFanHeat="${systemDesign.returnFanHeat}" invalid — using 5% default`);
  }

  // Percentage-of-capacity proxy (HIGH-RDS-01 pending fix — see file header).
  const supplyFanHeatBTU = Math.round(
    Math.abs(Cs * supplyAir * (dbInF - adpF) * (1 - bf)) * supplyFanHeatFraction
  );
  const returnFanHeatBTU = Math.round(supplyFanHeatBTU * returnFanHeatFraction);

  if (supplyAir > 1000 && supplyFanHeatBTU < 500) {
    _warn(
      `STEP5-02 HIGH-RDS-01: supplyFanHeatBTU=${supplyFanHeatBTU} is very low ` +
      `for supplyAir=${Math.round(supplyAir)} CFM. ` +
      `Excel motor-power formula gives ~17,000 BTU/hr for a 5 kW fan. ` +
      `This will understate grandTotal and coolingCapTR until ahu.fanMotorKW is added to ahuSlice.`
    );
  }

  // ── Grand total ───────────────────────────────────────────────────────────
  const grandTotal = peakErshForCap + peakErlhForCap + oaPeak.oaTotal +
                     supplyFanHeatBTU + returnFanHeatBTU;

  const grandTotalSensible = Math.round(
    peakErshForCap + oaPeak.oaSensible + supplyFanHeatBTU + returnFanHeatBTU
  );

  // HIGH-RDS-02 NOTE: coilLoadBTU excludes supplyFanHeat for draw-through AHU
  // basis; heatingHumid and pipeSizing receive revisedGrandTotal (which includes
  // supplyFanHeat) so CHW sizing stays consistent with the coil load. See v2.11.
  const coilLoadBTU = peakErshForCap + peakErlhForCap + oaPeak.oaTotal + returnFanHeatBTU;

  // ── Logging & validation ──────────────────────────────────────────────────
  _log(
    `STEP5-01: grandTotal breakdown — ` +
    `ERSH=${Math.round(peakErshForCap)} + ERLH=${Math.round(peakErlhForCap)} + ` +
    `OA=${Math.round(oaPeak.oaTotal)} + fanHeat=${supplyFanHeatBTU} + retFan=${returnFanHeatBTU} ` +
    `= ${Math.round(grandTotal)} BTU/hr [peak: ${peakCoolingSeason.toUpperCase()}]`
  );

  _badNum(peakErshForCap,  'peakErshForCap',  roomId);
  _badNum(peakErlhForCap,  'peakErlhForCap',  roomId);
  _badNum(oaPeak.oaTotal,  'oaPeak.oaTotal',   roomId);
  _badNum(grandTotal,       'grandTotal',        roomId);

  if (grandTotal <= 0) {
    _err(`STEP5-01: grandTotal=${Math.round(grandTotal)} BTU/hr is ≤ 0 — room has no cooling load or inputs are wrong`);
  }

  // ── Unit conversions for the RDS row ─────────────────────────────────────
  const supplyFanHeatBlow = supplyFanHeatBTU;
  const supplyFanHeatDraw = parseFloat((supplyFanHeatBTU / KW_TO_BTU_HR).toFixed(2));
  const returnFanHeat     = parseFloat((returnFanHeatBTU / KW_TO_BTU_HR).toFixed(2));

  return {
    peakCoolingSeason,
    peakErshForCap,
    peakErlhForCap,
    oaPeak,
    supplyFanHeatBTU,
    returnFanHeatBTU,
    supplyFanHeatBlow,
    supplyFanHeatDraw,
    returnFanHeat,
    grandTotal,
    grandTotalSensible,
    coilLoadBTU,
  };
}