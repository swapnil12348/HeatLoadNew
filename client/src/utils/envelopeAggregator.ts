/**
 * envelopeAggregator.ts
 * Public API for total envelope heat gain/loss.
 * Responsibility: compose envelopeCalc + glazingCalc into a single
 * room-level result. This is the only envelope file that seasonalLoads
 * should import from.
 *
 * Import map:
 *   seasonalLoads.ts   → envelopeAggregator.ts  (this file — ALL envelope imports via here)
 *   envelopeCalc.ts    → opaque elements (walls, roofs, partitions, slabs, infiltration)
 *   glazingCalc.ts     → transparent elements (glass, skylights)
 *   envelopeHelpers.ts → internal helpers (not imported externally)
 *
 * SIGN CONVENTION:
 *   Positive = heat INTO conditioned space  → cooling load contribution
 *   Negative = heat OUT OF conditioned space → heating load contribution
 *
 * Do NOT clamp results to Math.max(0, ...) — negative values are valid
 * and represent heating loads that must reach seasonalLoads intact.
 */

// @ts-ignore - Ignore missing types until these files are converted to TS
import { calcWallGain, calcRoofGain, calcPartitionGain, calcSlabGain, calcInfiltrationGain } from './envelopeCalc';
// @ts-ignore - Ignore missing types until these files are converted to TS
import { calcGlassGain, calcSkylightGain } from './glazingCalc';

// Re-export so external consumers (seasonalLoads.ts etc.) can still import
// individual functions directly from this aggregator if needed.
export {
  calcWallGain,
  calcRoofGain,
  calcPartitionGain,
  calcSlabGain,
  calcInfiltrationGain,
  calcGlassGain,
  calcSkylightGain,
};

// ─── Logging ──────────────────────────────────────────────────────────────────
const logA = (...args: any[]): void => console.log('[envelopeAggr]', ...args);
const warnA = (...args: any[]): void => console.warn('[envelopeAggr]', ...args);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Season = 'summer' | 'monsoon' | 'winter';

export interface SlabElement {
  perimeterFt: number;
  insulationType: string; // e.g., 'none', 'R-5', 'R-10' (depending on your logic)
  tGround?: number;
}

export interface EnvelopeElements {
  // Update these `any` types when envelopeCalc.ts and glazingCalc.ts are typed
  walls?: any[];
  roofs?: any[];
  glass?: any[];
  skylights?: any[];
  partitions?: any[];
  floors?: any[];
  slabs?: SlabElement[];
}

// Ensure your climate slice/types has a defined interface, using any fallback for now
export type ClimateData = any;

export interface DetailedGainResult {
  conduction: number;
  solar: number;
  total: number;
}

export interface DetailedEnvelopeBreakdown {
  walls: number;
  roofs: number;
  glass: DetailedGainResult;
  skylights: DetailedGainResult;
  partitions: number;
  floors: number;
  slabs: number;
  total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Total envelope gain — room level
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcTotalEnvelopeGain
 *
 * Aggregates all envelope element categories for a room.
 * Returns total sensible envelope gain/loss only (BTU/hr), signed.
 * Infiltration and internal loads are computed separately in seasonalLoads.ts.
 *
 * @param elements   - envelope elements from envelopeSlice
 * @param climate    - climate state from climateSlice
 * @param tRoom      - room design dry-bulb (°F)
 * @param season     - 'summer' | 'monsoon' | 'winter'
 * @param latitude   - site latitude (degrees; negative = south)
 * @param dailyRange - diurnal range (°F); 0 = use DIURNAL_RANGE_DEFAULTS
 * @returns total sensible envelope gain (BTU/hr); signed
 */
export const calcTotalEnvelopeGain = (
  elements: EnvelopeElements | undefined | null,
  climate: ClimateData,
  tRoom: number,
  season: Season,
  latitude: number = 28,
  dailyRange: number = 0
): number => {
  logA(`── calcTotalEnvelopeGain [${season}] tRoom=${tRoom}°F lat=${latitude}° dailyRange=${dailyRange}`);

  if (!elements) {
    warnA(`⚠ elements=null/undefined — returning 0 [DIAG-SL-03 root: no envelope object passed for this room]`);
    return 0;
  }

  const wallCnt  = elements.walls?.length      ?? 0;
  const roofCnt  = elements.roofs?.length      ?? 0;
  const glassCnt = elements.glass?.length      ?? 0;
  const skysCnt  = elements.skylights?.length  ?? 0;
  const partCnt  = elements.partitions?.length ?? 0;
  const floorCnt = elements.floors?.length     ?? 0;
  const slabCnt  = elements.slabs?.length      ?? 0;
  const totalEl  = wallCnt + roofCnt + glassCnt + skysCnt + partCnt + floorCnt + slabCnt;

  logA(`   counts: walls=${wallCnt} roofs=${roofCnt} glass=${glassCnt} skylights=${skysCnt} partitions=${partCnt} floors=${floorCnt} slabs=${slabCnt} (total=${totalEl})`);

  if (totalEl === 0) {
    warnA(`⚠ elements object exists but ALL arrays empty — returning 0 [DIAG-SL-03 root: add envelope elements in Envelope tab]`);
    return 0;
  }

  let total = 0;
  let wallSum = 0, roofSum = 0, glassSum = 0, skySum = 0, partSum = 0, floorSum = 0, slabSum = 0;

  (elements.walls || []).forEach((w, i) => {
    const g = calcWallGain(w, climate, tRoom, season, latitude, dailyRange);
    logA(`   wall[${i}] = ${Math.round(g)} BTU/hr`);
    wallSum += g;
    total += g;
  });

  (elements.roofs || []).forEach((r, i) => {
    const g = calcRoofGain(r, climate, tRoom, season, latitude, dailyRange);
    logA(`   roof[${i}] = ${Math.round(g)} BTU/hr`);
    roofSum += g;
    total += g;
  });

  (elements.glass || []).forEach((g_el, i) => {
    const res = calcGlassGain(g_el, climate, tRoom, season, latitude, dailyRange);
    logA(`   glass[${i}] = ${res.total} BTU/hr (cond=${res.conduction} solar=${res.solar})`);
    glassSum += res.total;
    total += res.total;
  });

  (elements.skylights || []).forEach((s, i) => {
    const res = calcSkylightGain(s, climate, tRoom, season, latitude, dailyRange);
    logA(`   skylight[${i}] = ${res.total} BTU/hr (cond=${res.conduction} solar=${res.solar})`);
    skySum += res.total;
    total += res.total;
  });

  // season passed through so tAdjSummer / tAdjWinter is selected correctly.
  (elements.partitions || []).forEach((p, i) => {
    const g = calcPartitionGain(p, tRoom, season);
    logA(`   partition[${i}] = ${Math.round(g)} BTU/hr`);
    partSum += g;
    total += g;
  });

  // Floors between conditioned spaces treated as partitions.
  (elements.floors || []).forEach((f, i) => {
    const g = calcPartitionGain(f, tRoom, season);
    logA(`   floor[${i}] = ${Math.round(g)} BTU/hr`);
    floorSum += g;
    total += g;
  });

  // Slabs: optional array — elements carry { perimeterFt, insulationType, tGround }
  (elements.slabs || []).forEach((s, i) => {
    const g = calcSlabGain(s.perimeterFt, s.insulationType, tRoom, s.tGround ?? 55);
    logA(`   slab[${i}] = ${Math.round(g)} BTU/hr`);
    slabSum += g;
    total += g;
  });

  const rounded = Math.round(total);
  logA(
    `   subtotals[${season}]: walls=${Math.round(wallSum)} | roofs=${Math.round(roofSum)} | glass=${Math.round(glassSum)} | skylights=${Math.round(skySum)} | partitions=${Math.round(partSum)} | floors=${Math.round(floorSum)} | slabs=${Math.round(slabSum)}`
  );
  logA(`   TOTAL[${season}] = ${rounded} BTU/hr`);

  if (rounded === 0 && totalEl > 0) {
    warnA(
      `⚠ TOTAL=0 despite ${totalEl} element(s) — check: U-values all >0? areas all >0? climate.outside.${season}.db populated?`
    );
  }

  return rounded;
};

// ─────────────────────────────────────────────────────────────────────────────
// Detailed envelope gain — per-category breakdown
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calcDetailedEnvelopeGain
 *
 * Same as calcTotalEnvelopeGain but returns a per-category breakdown.
 * Used by RDSPage to populate individual envelope load rows.
 *
 * NOTE: This function independently calls the same underlying calc functions
 * as calcTotalEnvelopeGain. Both will emit [envelopeCalc] logs when called.
 * The [envelopeAggr] tag here identifies this as the UI-breakdown call path.
 */
export const calcDetailedEnvelopeGain = (
  elements: EnvelopeElements | undefined | null,
  climate: ClimateData,
  tRoom: number,
  season: Season,
  latitude: number = 28,
  dailyRange: number = 0
): DetailedEnvelopeBreakdown => {
  logA(`── calcDetailedEnvelopeGain [${season}] (UI breakdown call)`);

  if (!elements) {
    logA(`   elements null — returning zero breakdown`);
    return {
      walls: 0,
      roofs: 0,
      glass: { conduction: 0, solar: 0, total: 0 },
      skylights: { conduction: 0, solar: 0, total: 0 },
      partitions: 0,
      floors: 0,
      slabs: 0,
      total: 0,
    };
  }

  const walls = (elements.walls || []).reduce(
    (sum, w) => sum + calcWallGain(w, climate, tRoom, season, latitude, dailyRange),
    0
  );

  const roofs = (elements.roofs || []).reduce(
    (sum, r) => sum + calcRoofGain(r, climate, tRoom, season, latitude, dailyRange),
    0
  );

  const glass = (elements.glass || []).reduce(
    (acc, g) => {
      const res = calcGlassGain(g, climate, tRoom, season, latitude, dailyRange);
      return {
        conduction: acc.conduction + res.conduction,
        solar: acc.solar + res.solar,
        total: acc.total + res.total,
      };
    },
    { conduction: 0, solar: 0, total: 0 } as DetailedGainResult
  );

  const skylights = (elements.skylights || []).reduce(
    (acc, s) => {
      const res = calcSkylightGain(s, climate, tRoom, season, latitude, dailyRange);
      return {
        conduction: acc.conduction + res.conduction,
        solar: acc.solar + res.solar,
        total: acc.total + res.total,
      };
    },
    { conduction: 0, solar: 0, total: 0 } as DetailedGainResult
  );

  const partitions = (elements.partitions || []).reduce(
    (sum, p) => sum + calcPartitionGain(p, tRoom, season),
    0
  );

  const floors = (elements.floors || []).reduce(
    (sum, f) => sum + calcPartitionGain(f, tRoom, season),
    0
  );

  const slabs = (elements.slabs || []).reduce(
    (sum, s) => sum + calcSlabGain(s.perimeterFt, s.insulationType, tRoom, s.tGround ?? 55),
    0
  );

  const total = Math.round(
    walls + roofs + glass.total + skylights.total + partitions + floors + slabs
  );

  logA(
    `   detailed TOTAL[${season}] = ${total} BTU/hr | walls=${Math.round(walls)} roofs=${Math.round(roofs)} glass=${Math.round(glass.total)} skylights=${Math.round(skylights.total)} partitions=${Math.round(partitions)} floors=${Math.round(floors)} slabs=${Math.round(slabs)}`
  );

  return {
    walls: Math.round(walls),
    roofs: Math.round(roofs),
    glass: {
      conduction: Math.round(glass.conduction),
      solar: Math.round(glass.solar),
      total: Math.round(glass.total),
    },
    skylights: {
      conduction: Math.round(skylights.conduction),
      solar: Math.round(skylights.solar),
      total: Math.round(skylights.total),
    },
    partitions: Math.round(partitions),
    floors: Math.round(floors),
    slabs: Math.round(slabs),
    total,
  };
};