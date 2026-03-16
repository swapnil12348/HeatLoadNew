/**
 * climateSlice.js
 * Manages outdoor design conditions for three seasons.
 *
 * State shape:
 *   state.climate.outside  →  { summer, monsoon, winter }
 *
 * ── FIELD CONTRACT WITH THE LOGIC LAYER ──────────────────────────────────────
 *
 *   Every calculation module that needs outdoor conditions reads:
 *     climate.outside[season].db  — dry-bulb temperature (°F)
 *     climate.outside[season].rh  — relative humidity (%)
 *
 *   Modules that use these fields:
 *     seasonalLoads.js      → outdoor.db, outdoor.rh → grOut via calculateGrains()
 *     heatingHumid.js       → climate.outside.winter.db / .rh
 *     outdoorAirLoad.js     → outdoor.db, outdoor.rh per season
 *     psychroStatePoints.js → outdoor.db, outdoor.rh per season
 *
 * ── DISPLAY-ONLY DERIVED FIELDS ──────────────────────────────────────────────
 *
 *   gr, dp, wb  are derived from db + rh and stored for display only.
 *   They are NOT read by the logic layer — every calc module calls
 *   calculateGrains(db, rh, elevation) with the actual site elevation,
 *   whereas these state fields use elevation = 0 (meteorological convention).
 *
 *   They exist so ClimateConfig UI can render all four properties (DB, RH,
 *   gr, WB) without re-computing on every render.
 *   deriveFields() returns null for any of the three when inputs are
 *   blank or invalid — the UI should render null as "—".
 *
 * ── SEASONAL DESIGN CONDITIONS — ASHRAE HOF 2021 DEFAULTS ────────────────────
 *
 *   Summer DB default: 109.9°F (43.3°C) — ASHRAE HOF 2021 Ch.14 Table 1,
 *   0.4% design dry-bulb for Delhi (28°N). This is the correct tier for
 *   24/7 critical facilities (semiconductor, pharma, battery).
 *
 *   ASHRAE design condition tiers for reference:
 *     0.4% DB (critical facilities):  43.3°C / 109.9°F  ← this default
 *     1.0% DB (general commercial):   41.7°C / 107.1°F
 *     2.0% DB (less critical):        40.2°C / 104.4°F
 *
 * ── TEMPERATURE UNITS ────────────────────────────────────────────────────────
 *
 *   ALL temperatures stored in °F (Fahrenheit).
 *   The logic layer reads them in °F directly — no conversion needed.
 *   projectSlice ambient fields (dryBulbTemp etc.) are in °C — those are
 *   brief reference fields, not calculation inputs.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   BUG-SLICE-03 FIX — deriveFields(): || 0 replaced with explicit NaN guard.
 *
 *     Previous code used parseFloat(db) || 0. A blank DB silently defaulted
 *     to 0°F (−17.8°C) and derived gr/dp/wb from that temperature, showing
 *     wrong values in ClimateConfig rather than indicating an empty field.
 *     Fix: return { gr: null, dp: null, wb: null } when inputs are blank/NaN.
 *     No calculation correctness impact — gr/dp/wb are display-only fields.
 */

import { createSlice } from '@reduxjs/toolkit';
import {
  calculateGrains,
  calculateDewPoint,
  calculateWetBulb,
} from '../../utils/psychro';

// ── Derive display fields at sea level ───────────────────────────────────────
// gr, dp, wb are for ClimateConfig display only. Elevation = 0 is the
// meteorological convention for weather station data. Actual load calculations
// always call calculateGrains(db, rh, elevation) with real site elevation.
// Returns nulls on invalid input so the UI can show "—" rather than wrong numbers.
const deriveFields = (db, rh) => {
  const safeDb = parseFloat(db);
  const safeRh = parseFloat(rh);

  if (isNaN(safeDb) || isNaN(safeRh)) {
    return { gr: null, dp: null, wb: null };
  }

  return {
    gr: Math.round(calculateGrains(safeDb, safeRh, 0) * 10) / 10,
    dp: calculateDewPoint(safeDb, safeRh),
    wb: Math.round(calculateWetBulb(safeDb, safeRh, 0) * 10) / 10,
  };
};

// ── Initial state ─────────────────────────────────────────────────────────────
const initialState = {
  outside: {
    summer: {
      db:    109.9,    // °F — ASHRAE 0.4% design dry-bulb, Delhi 28°N
      rh:     19,      // %  — coincident RH at peak DB
      time:  '15:00',
      month: 'June',
      ...deriveFields(109.9, 19),
    },
    monsoon: {
      db:    95,
      rh:    70,
      time:  '10:00',
      month: 'August',
      ...deriveFields(95, 70),
    },
    winter: {
      db:    45,
      rh:    60,
      time:  '06:00',
      month: 'January',
      // wb derived (≈ 37.7°F at 45°F DB, 60% RH). Old hardcoded 40°F was
      // inconsistent — 40°F WB at 45°F DB requires RH ≈ 73%.
      ...deriveFields(45, 60),
    },
  },
};

// ── Slice ─────────────────────────────────────────────────────────────────────
const climateSlice = createSlice({
  name: 'climate',
  initialState,

  reducers: {
    /**
     * updateOutsideCondition
     * { season, field, value }
     *
     * When db or rh changes, re-derives gr, dp, wb so ClimateConfig always
     * shows self-consistent psychrometric data.
     * The calc layer does NOT read gr/dp/wb — it recomputes with actual
     * site elevation. These derived fields are display-only.
     * If db or rh is cleared (empty string → NaN), derived fields are set
     * to null rather than being computed from 0°F.
     */
    updateOutsideCondition: (state, action) => {
      const { season, field, value } = action.payload;
      if (!state.outside[season]) return;

      state.outside[season][field] = value;

      if (field === 'db' || field === 'rh') {
        const db      = state.outside[season].db;
        const rh      = state.outside[season].rh;
        const derived = deriveFields(db, rh);
        state.outside[season].gr = derived.gr;
        state.outside[season].dp = derived.dp;
        state.outside[season].wb = derived.wb;
      }
    },
  },
});

export const { updateOutsideCondition } = climateSlice.actions;

export default climateSlice.reducer;

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectClimate = (state) => state.climate;

export const selectSeasonConditions = (state, season) =>
  state.climate.outside[season] ?? {};