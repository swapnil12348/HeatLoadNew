/**
 * steps/computeEshf.ts
 * STEP 4b / STEP6-01 — Effective Sensible Heat Factor and ADP sufficiency.
 *
 * Also computes grADP_sat here (saturation humidity at ADP) because:
 *   • the WARN-RDS-03 pre-check needs it (grADP_sat > grIn → dry coil)
 *   • computeReheat needs the same value for the minESHF denominator
 * Returning grADP_sat from this step avoids computing it twice.
 *
 * Changelog incorporated:
 *   WARN-RDS-03 (v2.11) — pre-check added: grADP_sat > grIn forces adpSufficient
 *     to 'insufficient' regardless of eshfType (masks infeasible coil design).
 *
 * Reference: ASHRAE HOF 2021 Ch.18 §17.3
 */

import { calculateRequiredADP, calculateGrains } from '../../../utils/psychro';
import { _log, _warn, _err } from '../rdsLogging';
import type { AdpSufficiency, EshfResult } from '../rdsTypes';

export function computeEshf(
  peakCalcs:     any,      // season calcs for the CFM-peak season (has .grIn, .dbInF)
  peakErshForCap: number,  // from computeGrandTotal (cooling-peak season ERSH)
  peakErlhForCap: number,  // from computeGrandTotal (cooling-peak season ERLH)
  oaPeak:        any,      // OA load object for cooling-peak season
  adpF:          number,
  dbInF:         number,
  elevation:     number | string,
): EshfResult {

  // grADP_sat is returned so computeReheat can reuse it (see file header).
  const grADP_sat = calculateGrains(adpF, 100, elevation);

  const eshfTotalSensible = (peakErshForCap || 0) + (oaPeak.oaSensible || 0);
  const eshfTotalLatent   = (peakErlhForCap || 0) + (oaPeak.oaLatent   || 0);

  const eshfResult = calculateRequiredADP(
    dbInF, peakCalcs.grIn, eshfTotalSensible, eshfTotalLatent, elevation
  );

  const eshf        = eshfResult.eshf;
  const requiredADP = eshfResult.requiredADP;
  const eshfType    = eshfResult.type;
  const eshfNote    = eshfResult.note;

  const adpGap =
    eshfType === 'found' && requiredADP !== null
      ? parseFloat((adpF - requiredADP).toFixed(1))
      : null;

  // ── WARN-RDS-03 pre-check (v2.11) ────────────────────────────────────────
  // When grADP_sat > grIn the coil delivers supply air wetter than the room.
  // calculateRequiredADP returns a type that maps to 'not_applicable', which
  // silently masked an infeasible design. Force 'insufficient' instead.
  if (grADP_sat > peakCalcs.grIn) {
    _warn(
      `STEP6-01 PRE-CHECK: grADP_sat=${grADP_sat.toFixed(1)} > grIn=${peakCalcs.grIn?.toFixed(1)} gr/lb ` +
      `— ADP=${adpF.toFixed(1)}°F cannot dehumidify (supply air wetter than room). ` +
      `adpSufficient forced to 'insufficient'.`
    );
  }

  const adpSufficient: AdpSufficiency =
    grADP_sat > peakCalcs.grIn   ? 'insufficient'  :  // pre-check (WARN-RDS-03)
    eshfType === 'no_solution'   ? 'no_solution'    :
    eshfType === 'sensible_only' ? 'not_applicable' :
    adpGap === null              ? 'not_applicable' :
    adpGap <= 0                  ? 'yes'            :
    adpGap <= 3                  ? 'marginal'       :
                                   'insufficient';

  _log(
    `STEP6-01: eshf=${eshf?.toFixed(3) ?? 'n/a'}, ` +
    `requiredADP=${requiredADP?.toFixed(1) ?? 'n/a'}°F, ` +
    `adpF=${adpF.toFixed(1)}°F, adpGap=${adpGap?.toFixed(1) ?? 'n/a'}, ` +
    `adpSufficient=${adpSufficient}`
  );

  // ── STEP6-02 warnings ────────────────────────────────────────────────────
  if (adpSufficient === 'insufficient') {
    _warn(
      `STEP6-02: adpSufficient=INSUFFICIENT — required ADP=${requiredADP?.toFixed(1)}°F ` +
      `but selected ADP=${adpF.toFixed(1)}°F. Coil cannot dehumidify to room setpoint.`
    );
  }
  if (adpSufficient === 'no_solution') {
    _err(
      `STEP6-02: adpSufficient=NO_SOLUTION — ESHF line does not intersect any achievable ADP. ` +
      `Psychrometrics are infeasible for this room.`
    );
  }
  if (adpSufficient === 'marginal') {
    _warn(`STEP6-02: adpSufficient=MARGINAL — adpGap=${adpGap?.toFixed(1)}°F (≤3°F). Coil is borderline.`);
  }

  return { grADP_sat, eshf, requiredADP, eshfType, eshfNote, adpGap, adpSufficient };
}