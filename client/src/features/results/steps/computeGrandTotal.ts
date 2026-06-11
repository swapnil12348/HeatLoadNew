/**
 * steps/computeGrandTotal.ts
 * STEP 4 / STEP5-01 — Peak cooling season selection, fan heat proxy, grand total.
 *
 * ⚠ HIGH-RDS-01 NOTE (comment updated — stale "400–900 BTU" claim removed):
 *   supplyFanHeatBTU uses a percentage-of-capacity proxy:
 *     fanHeatPct × Cs × supplyAir × (dbInF − adpF) × (1 − bf)
 *   = fanHeatPct × (full sensible capacity of the coil-air stream)
 *
 *   For a 14 000 CFM system at 5 %: ≈ 18 000 BTU/hr — comparable in magnitude to the
 *   exact motor-power formula (5 kW fan × 3 412 = 17 060 BTU/hr). The previous comment
 *   that said "~400–900 BTU" was written when the formula was `fanHeatPct × ERSH` (room
 *   sensible only) and was never updated after the formula was upgraded.
 *
 *   ⟶ HIGH-RDS-01 STILL OPEN: ideal formula is `ahu.fanMotorKW × KW_TO_BTU_HR` once
 *     fanMotorKW is added to ahuSlice (exact motor nameplate power). The proxy overstates
 *     fan heat for small DX units (<5 000 CFM) and understates for high-static systems
 *     (>2 inWG). For CHW AHUs in the 5 000–30 000 CFM range the proxy is ±30 %.
 *
 *   returnFanHeatBTU = supplyFanHeatBTU × returnFanHeatFraction.
 *   Interpretation: the return fan contributes X % of what the supply fan adds.
 *   Typical: 5 % (small inline return fan) → 20 % (balanced supply/return system).
 *   This is NOT a second independent percentage-of-capacity calculation.
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

  // Percentage-of-capacity proxy (HIGH-RDS-01 — see file header).
  // Formula: fanHeatPct × |Cs × supplyAir × (dbInF − adpF) × (1 − bf)|
  const coilSensibleBase = Math.abs(Cs * supplyAir * (dbInF - adpF) * (1 - bf));
  const supplyFanHeatBTU = Math.round(coilSensibleBase * supplyFanHeatFraction);
  // Return fan heat = fraction of supply fan heat (NOT an independent capacity %).
  // See file header for interpretation. 5% default → small inline return fan.
  const returnFanHeatBTU = Math.round(supplyFanHeatBTU * returnFanHeatFraction);

  // ── Fan heat audit log — shows formula inputs for traceability ────────────
  _log(
    `STEP5-01: fanHeat proxy — Cs=${Cs}×SA=${Math.round(supplyAir)}` +
    `×(db${dbInF.toFixed(1)}-adp${adpF})×(1-bf${bf})` +
    ` = ${Math.round(coilSensibleBase)} BTU base | ` +
    `supply=${supplyFanHeatBTU} (${(supplyFanHeatFraction * 100).toFixed(0)}% of base) | ` +
    `return=${returnFanHeatBTU} (${(returnFanHeatFraction * 100).toFixed(0)}% of supply fan heat)`
  );

  // Sanity guard: for any real AHU serving >1 000 CFM, fan heat should exceed
  // 0.5 BTU/CFM. A value below this implies a near-zero supplyDT, zero fanHeat%,
  // or a formula path that is not running (HIGH-RDS-01).
  if (supplyAir > 1000 && supplyFanHeatBTU < Math.round(supplyAir * 0.5)) {
    _warn(
      `STEP5-02 HIGH-RDS-01: supplyFanHeatBTU=${supplyFanHeatBTU} BTU/hr is very low ` +
      `for supplyAir=${Math.round(supplyAir)} CFM (< 0.5 BTU/CFM). ` +
      `Expected ≥ ${Math.round(supplyAir * 1.0)}–${Math.round(supplyAir * 2.0)} BTU/hr. ` +
      `Likely causes: (1) fanHeat%≈0, (2) supplyDT≈0 (dbInF≈adpF), ` +
      `or (3) HIGH-RDS-01 — proxy formula receiving unexpected inputs. ` +
      `Inputs: Cs=${Cs}, supplyAir=${Math.round(supplyAir)}, dbInF=${dbInF.toFixed(1)}, adpF=${adpF}, bf=${bf}.`
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