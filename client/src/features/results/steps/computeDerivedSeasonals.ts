/**
 * steps/computeDerivedSeasonals.ts
 * STEP 8 — Derived per-season fields for the RDS grid.
 *
 * Produces three flat Record<string, number> objects that are spread
 * directly into the assembled RDS row:
 *
 *   pickupFields   — pickupOn_{season}, pickupOff_{season}  [°F ΔT]
 *   achFields      — achOn_temp_{season}, achOn_rh_{season} … [°F / %RH]
 *   termHeatFields — termHeatOn_{season}, termHeatOff_{season}  [kW]
 *
 * All values are numbers (P1-RDS-01 compliant).
 */

import { KW_TO_BTU_HR } from '../../../utils/units';
import { SEASONS_LIST } from '../rdsTypes';
import type { DerivedSeasonalsResult } from '../rdsTypes';

export function computeDerivedSeasonals(
  seasonResults: Record<string, number>,
  finalSupplyAir: number,
  dbInF:          number,
  raRH:           number,
  Cs:             number,
): DerivedSeasonalsResult {

  const pickupFields:   Record<string, number> = {};
  const achFields:      Record<string, number> = {};
  const termHeatFields: Record<string, number> = {};

  SEASONS_LIST.forEach((s) => {
    const e_on  = seasonResults[`ershOn_${s}`]  || 0;
    const e_off = seasonResults[`ershOff_${s}`] || 0;

    // Pickup temperature differential (how much the space warms up after setback)
    pickupFields[`pickupOn_${s}`] =
      finalSupplyAir > 0 ? parseFloat((e_on  / (Cs * finalSupplyAir)).toFixed(1)) : 0;
    pickupFields[`pickupOff_${s}`] =
      finalSupplyAir > 0 ? parseFloat((e_off / (Cs * finalSupplyAir)).toFixed(1)) : 0;

    // ACH condition setpoints (design DB and RH) — stored per season for grid display
    achFields[`achOn_temp_${s}`]      = parseFloat(dbInF.toFixed(1));
    achFields[`achOn_rh_${s}`]        = parseFloat(raRH.toFixed(1));
    achFields[`achOff_temp_${s}`]     = parseFloat(dbInF.toFixed(1));
    achFields[`achOff_rh_${s}`]       = parseFloat(raRH.toFixed(1));
    achFields[`achTermOn_temp_${s}`]  = parseFloat(dbInF.toFixed(1));
    achFields[`achTermOn_rh_${s}`]    = parseFloat(raRH.toFixed(1));
    achFields[`achTermOff_temp_${s}`] = parseFloat(dbInF.toFixed(1));
    achFields[`achTermOff_rh_${s}`]   = parseFloat(raRH.toFixed(1));

    // Terminal heating required when ERSH goes negative (heating-dominant period)
    termHeatFields[`termHeatOn_${s}`] =
      e_on  < 0 ? parseFloat((Math.abs(e_on)  / KW_TO_BTU_HR).toFixed(2)) : 0;
    termHeatFields[`termHeatOff_${s}`] =
      e_off < 0 ? parseFloat((Math.abs(e_off) / KW_TO_BTU_HR).toFixed(2)) : 0;
  });

  return { pickupFields, achFields, termHeatFields };
}