/**
 * rdsTypes.ts
 * Shared types, constants, and step-result interfaces for the RDS pipeline.
 *
 * Import Season / SEASONS_LIST wherever a season loop or type annotation is needed.
 * Import the step-result interfaces in computeRdsRow and assembleRdsRow.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Core domain types
// ─────────────────────────────────────────────────────────────────────────────

export type Season = 'summer' | 'monsoon' | 'winter';

/** Canonical iteration order — do not change; peak-season reduce depends on it. */
export const SEASONS_LIST: Season[] = ['summer', 'monsoon', 'winter'];

export type AdpSufficiency =
  | 'yes'
  | 'marginal'
  | 'insufficient'
  | 'no_solution'
  | 'not_applicable';

// ─────────────────────────────────────────────────────────────────────────────
// Step result interfaces
// ─────────────────────────────────────────────────────────────────────────────

/** Returned by steps/resolveAdp.ts */
export interface AdpResolution {
  adpF: number;
  adpSource: string;
  /** systemDesign spread with adpF injected when adpF ≠ projectAdp */
  effectiveSystemDesign: any;
  ahuAdpMode: string;
}

/** Returned by steps/computeGrandTotal.ts */
export interface GrandTotalResult {
  peakCoolingSeason: Season;
  peakErshForCap: number;
  peakErlhForCap: number;
  /** Full OA-load object for peak cooling season (oaTotal, oaSensible, oaLatent…) */
  oaPeak: any;
  supplyFanHeatBTU: number;   // BTU/hr, rounded integer
  returnFanHeatBTU: number;   // BTU/hr, rounded integer
  supplyFanHeatBlow: number;  // alias = supplyFanHeatBTU
  supplyFanHeatDraw: number;  // kW, 2 dp
  returnFanHeat: number;      // kW, 2 dp
  grandTotal: number;
  grandTotalSensible: number;
  coilLoadBTU: number;        // excludes supplyFanHeat (draw-through basis)
}

/** Returned by steps/computeEshf.ts */
export interface EshfResult {
  /**
   * Saturation humidity ratio at the ADP [gr/lb].
   * Declared here (STEP 4b) and consumed again in STEP 4c (minESHF denominator).
   */
  grADP_sat: number;
  eshf: number | null;
  requiredADP: number | null;
  eshfType: string;
  eshfNote: string;
  adpGap: number | null;
  adpSufficient: AdpSufficiency;
}

/** Returned by steps/computeReheat.ts */
export interface ReheatResult {
  reheatRequired: boolean;
  /** Unrounded BTU/hr — assembleRdsRow applies Math.round for the row field */
  reheatBTU: number;
  reheatKW: number;
  minESHF: number;   // already parseFloat(...toFixed(3))
  roomESHF: number;  // already parseFloat(...toFixed(3))
  revisedThermalCFM: number;
  finalSupplyAir: number;
  finalSupplyAirGoverned: string;
  finalCoilAir: number;
  finalBypassAir: number;
  finalReturnAir: number;
  finalSupplyAcph: number;
  coolingCapTR: number;
  /** grandTotal + reheatBTU — used for pipe sizing and heating basis */
  revisedGrandTotal: number;
  revisedCoilLoadBTU: number;
}

/** Returned by steps/computeDerivedSeasonals.ts */
export interface DerivedSeasonalsResult {
  pickupFields:   Record<string, number>;  // pickupOn_*, pickupOff_*
  achFields:      Record<string, number>;  // achOn_temp_*, achOn_rh_*, …
  termHeatFields: Record<string, number>;  // termHeatOn_*, termHeatOff_*
}

// ─────────────────────────────────────────────────────────────────────────────
// RootState interface (re-exported from rdsSelector for backwards compatibility)
// ─────────────────────────────────────────────────────────────────────────────

export interface RootState {
  room:     { list: any[] };
  envelope: { byRoomId: Record<string, any> };
  ahu:      { list: any[] };
  climate:  any;
  project: {
    systemDesign: any;
    ambient: {
      elevation?: number | string;
      latitude?:  number | string;
      dailyRange?: number | string;
    };
  };
}