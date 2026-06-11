/**
 * steps/computeReheat.ts
 * STEP 4c / STEP7-01 — Reheater sizing, revised supply air, and coolingCapTR.
 *
 * Changelog incorporated:
 *   CRIT-RDS-04 (v2.12) — Dry-coil guard added BEFORE the reheat formula.
 *     When grADP_sat > grIn: Math.max(0, grIn − grADP_sat) = 0 collapses
 *     minESHF to 1.0, so (1 − minESHF) = 0 and reheatBTU → Infinity.
 *     Reheat is sensible-only; it cannot add latent capacity. The new guard
 *     short-circuits to reheatBTU = 0 and fires a warning.
 *
 *   CRIT-RDS-03 (v2.11) — `&& minESHF < 1.0` guard removed from reheat
 *     condition. When grADP_sat > grIn the old third clause was always false,
 *     silently disabling reheat for rooms with significant latent load served
 *     by a warm ADP. roomESHF < minESHF − 0.001 is sufficient.
 *
 * Reference: ASHRAE HOF 2021 Ch.18 §17.3
 */

import { KW_TO_BTU_HR } from '../../../utils/units';
import ASHRAE from '../../../constants/ashrae';
import { _log, _warn, _err, _badNum, _mustBeNumber } from '../rdsLogging';
import type { Season, ReheatResult } from '../rdsTypes';

export function computeReheat(
  peakCalcs:         any,                    // CFM-peak season calcs — has .grIn
  seasonCalcs:       Record<string, any>,    // all season calcs
  seasonResults:     Record<string, number>,
  peakCoolingSeason: Season,
  grandTotal:        number,
  coilLoadBTU:       number,
  grADP_sat:         number,   // from computeEshf — saturation humidity at ADP
  adpF:              number,
  dbInF:             number,
  bf:                number,
  supplyAir:         number,
  supplyAirGoverned: string,
  thermalCFM:        number,
  freshAirCheck:     number,
  volumeFt3:         number,
  Cs:                number,
  Cl:                number,
  roomId:            string,
): ReheatResult {

  // ── ENTRY ─────────────────────────────────────────────────────────────────
  _log(
    `STEP7-01: ENTER peakCoolingSeason=${peakCoolingSeason}` +
    ` | dbInF=${dbInF.toFixed(1)}°F adpF=${adpF.toFixed(1)}°F bf=${bf}` +
    ` | supplyAir=${Math.round(supplyAir)}CFM thermalCFM=${Math.round(thermalCFM)}` +
    ` | Cs=${Cs.toFixed(4)} Cl=${Cl.toFixed(4)}` +
    ` | grandTotal=${Math.round(grandTotal)} coilLoadBTU=${Math.round(coilLoadBTU)}BTU/hr` +
    ` | grADP_sat=${grADP_sat?.toFixed(2)}gr/lb grIn=${peakCalcs.grIn?.toFixed(2)}gr/lb`
  );

  // ── supplyDT ──────────────────────────────────────────────────────────────
  const supplyDT = (1 - bf) * (dbInF - adpF);

  if (supplyDT <= 0) {
    _err(
      `STEP7-01: supplyDT=${supplyDT.toFixed(2)} ≤ 0 — coil temperature rise is zero or negative. ` +
      `adpF=${adpF.toFixed(1)}, dbInF=${dbInF.toFixed(1)}, bf=${bf}. ` +
      `Fan heat will be 0 and reheat check will be skipped.`
    );
  } else {
    _log(
      `STEP7-01: supplyDT=(1-${bf})×(${dbInF.toFixed(1)}-${adpF.toFixed(1)})` +
      ` = ${(1 - bf).toFixed(3)}×${(dbInF - adpF).toFixed(2)}` +
      ` = ${supplyDT.toFixed(3)}°F`
    );
  }

  // ── minESHF ───────────────────────────────────────────────────────────────
  // Extract grDelta as a named const — used in both the formula and the log.
  // Denominator uses grADP_sat passed in from computeEshf (declared once,
  // avoids recomputing calculateGrains here).
  const minESHFNum   = Cs * supplyDT;
  const grDeltaMinESHF = Math.max(0, peakCalcs.grIn - grADP_sat);
  const minESHFDenom = minESHFNum + Cl * grDeltaMinESHF;
  const minESHF      = supplyDT > 0 && minESHFDenom > 0 ? minESHFNum / minESHFDenom : 1.0;

  _log(
    `STEP7-01: minESHF — sensible_term=Cs×supplyDT=${Cs.toFixed(4)}×${supplyDT.toFixed(3)}=${minESHFNum.toFixed(3)}` +
    ` | grDelta=max(0,${peakCalcs.grIn?.toFixed(2)}-${grADP_sat?.toFixed(2)})=${grDeltaMinESHF.toFixed(3)}gr/lb` +
    ` | latent_term=Cl×grDelta=${Cl.toFixed(4)}×${grDeltaMinESHF.toFixed(3)}=${(Cl * grDeltaMinESHF).toFixed(3)}` +
    ` | denom=${minESHFDenom.toFixed(4)}` +
    ` → minESHF=${minESHFNum.toFixed(3)}/${minESHFDenom.toFixed(3)}=${minESHF.toFixed(4)}` +
    `${supplyDT <= 0 || minESHFDenom <= 0 ? ' [FALLBACK=1.0]' : ''}`
  );

  // ── roomESHF ──────────────────────────────────────────────────────────────
  const reheatCalcs = seasonCalcs[peakCoolingSeason];
  const reheatErsh  = seasonResults[`ershOn_${peakCoolingSeason}`] || 0;
  const reheatErlh  = seasonResults[`erlhOn_${peakCoolingSeason}`] || 0;

  const erthRaw  = reheatCalcs.rawSensible + reheatCalcs.rawLatent;
  const erthSafe = reheatErsh + reheatErlh;
  const roomESHF = erthRaw > 0 ? reheatCalcs.rawSensible / erthRaw : 1.0;

  _log(
    `STEP7-01: roomESHF — season[${peakCoolingSeason}]` +
    ` rawSens=${Math.round(reheatCalcs.rawSensible)} rawLat=${Math.round(reheatCalcs.rawLatent)}` +
    ` | erthRaw=${Math.round(erthRaw)}BTU/hr` +
    ` | reheatErsh=${Math.round(reheatErsh)} reheatErlh=${Math.round(reheatErlh)}` +
    ` | erthSafe=${Math.round(erthSafe)}BTU/hr` +
    ` → roomESHF=${reheatCalcs.rawSensible?.toFixed(0)}/${erthRaw?.toFixed(0)}=${roomESHF.toFixed(4)}` +
    `${erthRaw <= 0 ? ' [FALLBACK=1.0 — zero total load]' : ''}`
  );

  if (
    _badNum(reheatCalcs.rawSensible, 'rawSensible', roomId) ||
    _badNum(reheatCalcs.rawLatent,   'rawLatent',   roomId)
  ) {
    _err(
      `STEP7-01: rawSensible/rawLatent missing from seasonCalcs[${peakCoolingSeason}]` +
      ` — check seasonalLoads.ts returns these fields`
    );
  }

  _log(
    `STEP7-01: roomESHF=${roomESHF.toFixed(3)}, minESHF=${minESHF.toFixed(3)}, ` +
    `supplyDT=${supplyDT.toFixed(2)}°F, grIn=${peakCalcs.grIn?.toFixed(1)}, ` +
    `grADP_sat=${grADP_sat?.toFixed(1)}`
  );

  // ── Reheat decision ───────────────────────────────────────────────────────
  let reheatBTU      = 0;
  let reheatRequired = false;

  if (grADP_sat > peakCalcs.grIn) {
    // CRIT-RDS-04: Dry-coil guard.
    // ADP surface is above the room dew point — no condensation, no latent removal.
    // Math.max(0, grIn − grADP_sat) = 0, so minESHF = 1.0 and (1 − minESHF) = 0,
    // making the reheat formula divide by zero → Infinity. Short-circuit to 0.
    reheatRequired = false;
    reheatBTU = 0;
    _warn(
      `STEP7-01: Reheat skipped — dry coil ` +
      `(grADP_sat=${grADP_sat.toFixed(1)} > grIn=${peakCalcs.grIn?.toFixed(1)} gr/lb). ` +
      `ADP=${adpF.toFixed(1)}°F is above dew point; lower ADP to enable latent removal.`
    );

  } else if (supplyDT > 0 && roomESHF < minESHF - 0.001) {
    // CRIT-RDS-03: `&& minESHF < 1.0` guard intentionally absent — see file header.
    reheatRequired = true;

    // Extract numerator and denominator as named values for auditability.
    const reheatNumerator   = minESHF * erthSafe - reheatErsh;
    const reheatDenominator = 1 - minESHF;
    reheatBTU = Math.max(0, reheatNumerator / reheatDenominator);

    _log(
      `STEP7-01: reheat formula — (minESHF×erthSafe − reheatErsh) / (1 − minESHF)` +
      ` = (${minESHF.toFixed(4)}×${Math.round(erthSafe)} − ${Math.round(reheatErsh)})` +
      ` / (1 − ${minESHF.toFixed(4)})` +
      ` = ${reheatNumerator.toFixed(1)} / ${reheatDenominator.toFixed(5)}` +
      ` = ${(reheatNumerator / reheatDenominator).toFixed(1)}BTU/hr` +
      `${reheatNumerator < 0 ? ' → max(0,·)=0 [numerator negative]' : ''}`
    );

    _warn(
      `STEP7-01: REHEAT REQUIRED — roomESHF=${roomESHF.toFixed(3)} < minESHF=${minESHF.toFixed(3)}. ` +
      `reheatBTU=${Math.round(reheatBTU)}, reheatKW=${(reheatBTU / KW_TO_BTU_HR).toFixed(2)}`
    );

  } else {
    _log(`STEP7-01: No reheat required (roomESHF=${roomESHF.toFixed(3)} ≥ minESHF=${minESHF.toFixed(3)})`);
  }

  const reheatKW = reheatBTU > 0 ? parseFloat((reheatBTU / KW_TO_BTU_HR).toFixed(2)) : 0;

  // ── Revised totals ────────────────────────────────────────────────────────
  const revisedGrandTotal  = grandTotal + reheatBTU;
  const revisedCoilLoadBTU = coilLoadBTU + reheatBTU;

  // P1-RDS-01: coolingCapTR must be a number, not a string.
  const coolingCapTR = parseFloat((revisedGrandTotal / ASHRAE.BTU_PER_TON).toFixed(2));

  // STEP5-03: type guard
  _mustBeNumber(coolingCapTR, 'coolingCapTR', roomId);

  // STEP7-02: sanity check
  if (reheatBTU > grandTotal && grandTotal > 0) {
    _err(
      `STEP7-02: reheatBTU=${Math.round(reheatBTU)} > grandTotal=${Math.round(grandTotal)} ` +
      `— reheat load exceeds total room load. Check minESHF formula inputs.`
    );
  }

  _log(
    `STEP5-01: coolingCapTR=${coolingCapTR} TR (type=${typeof coolingCapTR}), ` +
    `revisedGrandTotal=${Math.round(revisedGrandTotal)} BTU/hr, ` +
    `revisedCoilLoadBTU=${Math.round(revisedCoilLoadBTU)} BTU/hr` +
    ` [grandTotal=${Math.round(grandTotal)} + reheatBTU=${Math.round(reheatBTU)}]`
  );

  // ── Revised air quantities (post-reheat) ──────────────────────────────────
  const revisedThermalCFM =
    supplyDT > 0 && reheatRequired
      ? Math.ceil((reheatErsh + reheatBTU) / (Cs * supplyDT))
      : thermalCFM;

  const finalSupplyAir         = Math.max(supplyAir, revisedThermalCFM);
  const finalCoilAir           = Math.round(finalSupplyAir * (1 - bf));
  const finalBypassAir         = Math.round(finalSupplyAir * bf);
  const finalReturnAir         = Math.max(0, finalSupplyAir - freshAirCheck);
  const finalSupplyAcph        =
    finalSupplyAir > 0 && volumeFt3 > 0
      ? parseFloat(((finalSupplyAir * 60) / volumeFt3).toFixed(1))
      : 0;
  const finalSupplyAirGoverned =
    reheatRequired && finalSupplyAir > supplyAir ? 'reheat' : supplyAirGoverned;

  if (finalSupplyAir !== supplyAir) {
    _log(
      `STEP7-01: reheat lifted supplyAir from ${Math.round(supplyAir)} → ` +
      `${Math.round(finalSupplyAir)} CFM (governed by: reheat)`
    );
  }

  // Always log final air quantities — previous log only fires when supply changed.
  _log(
    `STEP7-01: final air qtys` +
    ` | supply=${Math.round(finalSupplyAir)}CFM (governed=${finalSupplyAirGoverned})` +
    ` | coil=${Math.round(finalCoilAir)} bypass=${Math.round(finalBypassAir)} return=${Math.round(finalReturnAir)}` +
    ` | revisedThermalCFM=${Math.round(revisedThermalCFM)} thermalIn=${Math.round(thermalCFM)}` +
    ` | ACPH=${finalSupplyAcph}`
  );

  return {
    reheatRequired,
    reheatBTU,
    reheatKW,
    minESHF:  parseFloat(minESHF.toFixed(3)),
    roomESHF: parseFloat(roomESHF.toFixed(3)),
    revisedThermalCFM,
    finalSupplyAir,
    finalSupplyAirGoverned,
    finalCoilAir,
    finalBypassAir,
    finalReturnAir,
    finalSupplyAcph,
    coolingCapTR,
    revisedGrandTotal,
    revisedCoilLoadBTU,
  };
}