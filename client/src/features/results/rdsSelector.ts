/**
 * rdsSelector.ts
 * Thin memoized selector — orchestrates per-room load calculation by delegating
 * each room to computeRdsRow and assembling the final RDS data array.
 *
 * Responsibilities that remain here (selector scope, not per-room):
 *   • INPUT-01 selector-level validation (rooms, climate, systemDesign, AHUs)
 *   • Psychro constants computed once for all rooms (altCf, Cs, Cl)
 *   • rooms.map → computeRdsRow
 *
 * All per-room logic lives in:
 *   computeRdsRow.ts         — orchestrator
 *   steps/resolveAdp.ts      — ADP resolution chain
 *   steps/computeGrandTotal.ts — peak season + fan heat + totals
 *   steps/computeEshf.ts     — ESHF / ADP sufficiency
 *   steps/computeReheat.ts   — reheat sizing + revised supply air
 *   steps/computeDerivedSeasonals.ts — pickup / ACH / terminal heat fields
 *   assembleRdsRow.ts        — pure field mapping onto the RDS row object
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ASHRAE 62.1-2022 | ISO 14644-1:2015
 *
 * Exports (unchanged for backwards compatibility):
 *   selectRdsData — default memoized selector
 *   RootState     — Redux state shape interface
 */

import { createSelector } from '@reduxjs/toolkit';
import {
  altitudeCorrectionFactor,
  sensibleFactor,
  latentFactor,
} from '../../utils/psychro';

import { _log, _warn, _err } from './rdsLogging';
import { computeRdsRow }     from './computeRdsRow';

// Re-export RootState from rdsTypes so any existing import of RootState
// from this file continues to work without change.
export type { RootState } from './rdsTypes';

type Season = 'summer' | 'monsoon' | 'winter';

// ── Input selectors ───────────────────────────────────────────────────────────

const selectRooms        = (state: any) => state.room.list;
const selectEnvelopes    = (state: any) => state.envelope.byRoomId;
const selectAhus         = (state: any) => state.ahu.list;
const selectClimate      = (state: any) => state.climate;
const selectSystemDesign = (state: any) => state.project.systemDesign;
const selectElevation    = (state: any) => state.project.ambient.elevation  || 0;
const selectLatitude     = (state: any) => state.project.ambient.latitude   ?? 28;
const selectDailyRange   = (state: any) => state.project.ambient.dailyRange ?? 0;

// ── Main memoized selector ────────────────────────────────────────────────────

export const selectRdsData = createSelector(
  [
    selectRooms,
    selectEnvelopes,
    selectAhus,
    selectClimate,
    selectSystemDesign,
    selectElevation,
    selectLatitude,
    selectDailyRange,
  ],
  (
    rooms,
    envelopes,
    ahus,
    climate,
    systemDesign,
    elevation,
    latitude,
    dailyRange,
  ) => {

    // ── INPUT-01: Selector-level validation ───────────────────────────────────
    _log(`selectRdsData fired — ${rooms?.length ?? 0} rooms, ${ahus?.length ?? 0} AHUs`);

    if (!rooms || rooms.length === 0) {
      _warn('INPUT-01: rooms list is empty — selector will return []');
    }

    if (!climate) {
      _err('INPUT-01: climate is null/undefined — all OA loads will be 0 or NaN');
    } else {
      const missingSeasons = (['summer', 'monsoon', 'winter'] as Season[]).filter(
        (s) => !climate?.outside?.[s]
      );
      if (missingSeasons.length > 0) {
        _err(`INPUT-01: climate missing seasons: ${missingSeasons.join(', ')} — check climateSlice`);
      }
    }

    if (!systemDesign) {
      _err('INPUT-01: systemDesign is null/undefined — all project defaults will be ASHRAE fallbacks');
    } else {
      _log(
        `INPUT-01: systemDesign — BF=${systemDesign.bypassFactor}, adp=${systemDesign.adp}, ` +
        `fanHeat=${systemDesign.fanHeat}%, returnFanHeat=${systemDesign.returnFanHeat}%, ` +
        `safety=${systemDesign.safetyFactor}%, ductHG=${systemDesign.ductHeatGain}%`
      );
    }

    if (!ahus || ahus.length === 0) {
      _warn('INPUT-01: AHU list is empty — all rooms will use fallback AHU values');
    }

    // ── Psychro constants (computed once, shared across all rooms) ────────────
    const altCf = altitudeCorrectionFactor(elevation);
    const Cs    = sensibleFactor(elevation);
    const Cl    = latentFactor(elevation);

    _log(
      `Psychro constants — elevation=${elevation}m, ` +
      `altCf=${altCf?.toFixed(4)}, Cs=${Cs?.toFixed(4)}, Cl=${Cl?.toFixed(4)}`
    );

    // ── Per-room calculation ──────────────────────────────────────────────────
    return (rooms ?? []).map((room: any) =>
      computeRdsRow(
        room, envelopes, ahus, climate, systemDesign,
        altCf, elevation, latitude, dailyRange, Cs, Cl,
      )
    );
  }
);