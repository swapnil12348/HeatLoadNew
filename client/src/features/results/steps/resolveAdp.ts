/**
 * steps/resolveAdp.ts
 * STEP 2-02 — Resolve effective Apparatus Dew Point.
 *
 * Priority chain:
 *   1. ahu.adpMode === 'calculated'  → back-calculate from loads via thermalCFM
 *   2. ahu.adp > 0                  → per-AHU manual override
 *   3. systemDesign.adp             → project-level default
 *
 * Reference: ASHRAE HOF 2021 Ch.18 §17
 */

import { calculateAdpFromLoads } from '../../../utils/psychro';
// @ts-ignore
import { calculateAirQuantities } from '../airQuantities';
import ASHRAE from '../../../constants/ashrae';
import { _log, _warn, _err } from '../rdsLogging';
import type { AdpResolution } from '../rdsTypes';

export function resolveAdp(
  ahu:          any,
  systemDesign: any,
  peakErsh:     number,
  dbInF:        number,
  bf:           number,
  altCf:        number,
  elevation:    number | string,
  room:         any,
  envelope:     any,
  floorAreaFt2: number,
  volumeFt3:    number,
): AdpResolution {
  const projectAdpMode  = systemDesign?.adpMode || 'manual';
  const ahuAdpMode      = ahu?.adpMode || projectAdpMode;
  const projectAdp      = parseFloat(String(systemDesign?.adp)) || ASHRAE.DEFAULT_ADP;
  const ahuAdpOverride  = parseFloat(String(ahu?.adp)) || 0;

  let adpF: number;
  let adpSource: string;

  if (ahuAdpMode === 'calculated') {
    // Preliminary air-quantity run with the project ADP to get a basis CFM.
    // ADP-01: use thermalCFM (not supplyAir) as back-calculation basis.
    const prelimSystemDesign = { ...systemDesign, adp: projectAdp };
    const prelimAirQty = calculateAirQuantities(
      room, envelope, ahu, prelimSystemDesign, altCf, elevation,
      peakErsh, floorAreaFt2, volumeFt3
    );
    const adpBasisCFM = prelimAirQty.thermalCFM > 0
      ? prelimAirQty.thermalCFM
      : prelimAirQty.supplyAir;

    adpF      = calculateAdpFromLoads(dbInF, peakErsh, adpBasisCFM, bf, elevation);
    adpSource = `calculated from loads (basisCFM=${Math.round(adpBasisCFM)})`;

  } else if (ahuAdpOverride > 0) {
    adpF      = ahuAdpOverride;
    adpSource = `per-AHU override (ahu.adp=${ahuAdpOverride})`;

  } else {
    adpF      = projectAdp;
    adpSource = `project default (systemDesign.adp=${projectAdp})`;
  }

  _log(`STEP2-02: adpMode=${ahuAdpMode}, adpF=${adpF.toFixed(1)}°F [${adpSource}]`);

  if (adpF < 40 || adpF > 65) {
    _warn(`STEP2-02: adpF=${adpF.toFixed(1)}°F is outside typical range 40–65°F`);
  }
  if (adpF >= dbInF) {
    _err(
      `STEP2-02: adpF=${adpF.toFixed(1)}°F ≥ dbInF=${dbInF.toFixed(1)}°F ` +
      `— coil cannot cool. supplyDT will be ≤0 and fan heat will be 0.`
    );
  }

  // Inject the resolved ADP back into systemDesign so downstream functions
  // (calculateAirQuantities, calculateHeatingHumid…) see a consistent value.
  const effectiveSystemDesign =
    adpF !== projectAdp ? { ...systemDesign, adp: adpF } : systemDesign;

  return { adpF, adpSource, effectiveSystemDesign, ahuAdpMode };
}