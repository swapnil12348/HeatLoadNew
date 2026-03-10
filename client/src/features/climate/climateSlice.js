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
 *   gr, dp, wb  are derived from db + rh and stored in state for display only.
 *   They are NOT read by the logic layer in calculations — every calc module
 *   calls calculateGrains(db, rh, elevation) with the actual site elevation,
 *   whereas these state fields use elevation=0 (sea level, meteorological
 *   convention for weather station data).
 *
 *   They exist so the ClimateConfig UI can render all four properties
 *   (DB, RH, gr, WB) without re-computing on every render.
 *
 *   FIX INFO-02: wb is now derived via calculateWetBulb(db, rh) rather than
 *   hardcoded. The old winter wb: 40 was inconsistent with DB=45°F + RH=60%
 *   (correct WB ≈ 37.7°F). Derived values are self-consistent.
 *
 * ── SEASONAL DESIGN CONDITIONS — ASHRAE HOF 2021 DEFAULTS ────────────────────
 *
 *   FIX CRIT-02: Summer DB changed from 95.7°F → 109.9°F (43.3°C).
 *   95.7°F was approximately the 50th-percentile ambient for Delhi — meaning
 *   the system would be undersized for roughly half of all summer hours.
 *   For 24/7 semiconductor, pharma, and battery facilities this is unsafe.
 *
 *   109.9°F (43.3°C) is the ASHRAE HOF 2021 Ch.14 Table 1 0.4% design
 *   dry-bulb for Delhi (28°N), the correct tier for critical facilities.
 *
 *   ASHRAE design condition tiers for reference:
 *     0.4% DB (critical facilities):  43.3°C / 109.9°F  ← this default
 *     1.0% DB (general commercial):   41.7°C / 107.1°F
 *     2.0% DB (less critical):        40.2°C / 104.4°F
 *
 *   NOTE: These defaults only affect NEW projects. Existing persisted state
 *   retains whatever DB was previously saved.
 *
 * ── TEMPERATURE UNITS ────────────────────────────────────────────────────────
 *
 *   ALL temperatures in this slice are stored in °F (Fahrenheit).
 *   The ClimateConfig UI renders them in °F.
 *   The logic layer reads them in °F directly (no conversion needed).
 *
 *   The project ambient fields (dryBulbTemp, wetBulbTemp) in projectSlice
 *   are stored in °C — those are reference/brief fields, not calculation inputs.
 *
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   BUG-SLICE-03 FIX — deriveFields(): || 0 replaced with explicit NaN guard.
 *
 *     Previous:
 *       const safeDb = parseFloat(db) || 0;
 *       const safeRh = parseFloat(rh) || 0;
 *
 *     The || 0 pattern treats NaN (from null/undefined input) the same as a
 *     deliberate 0 entry. This produces two problems:
 *
 *       1. A blank / missing DB defaults silently to 0°F (−17.8°C) and
 *          derives gr/dp/wb from that temperature, showing wrong values in
 *          ClimateConfig rather than showing that the field is empty.
 *
 *       2. calculateDewPoint(0, 0) returns null (BUG-TIER1-01 fix) so dp
 *          would be null even with the old code — but gr and wb would be
 *          computed from 0°F, misleading the engineer.
 *
 *     These are display-only fields (the logic layer never reads gr/dp/wb
 *     from climate state — it recalculates with real site elevation).
 *     The fix returns null for all three derived fields when inputs are
 *     blank/invalid, so the UI can render "—" rather than wrong numbers.
 *
 *     No calculation correctness impact — only ClimateConfig display quality.
 */

import { createSlice } from '@reduxjs/toolkit';
import {
  calculateGrains,
  calculateDewPoint,
  calculateWetBulb,
} from '../../utils/psychro';

// ── Derive display fields at sea level ───────────────────────────────────────
// gr, dp, wb are for ClimateConfig display only.
// Elevation = 0 (sea-level) is the meteorological convention for weather data.
// Actual load calculations always call calculateGrains(db, rh, elevation)
// with the real site elevation from projectSlice.
//
// BUG-SLICE-03 FIX: explicit NaN guard replaces || 0.
// Returns { gr: null, dp: null, wb: null } when inputs are missing/invalid
// so the UI can show "—" rather than values computed from 0°F.
const deriveFields = (db, rh) => {
  const safeDb = parseFloat(db);
  const safeRh = parseFloat(rh);

  // BUG-SLICE-03 FIX: return nulls on invalid input.
  // The logic layer never reads these fields — safe to return null for display.
  // UI components should render null as "—" or an empty cell.
  if (isNaN(safeDb) || isNaN(safeRh)) {
    return { gr: null, dp: null, wb: null };
  }

  return {
    gr: Math.round(calculateGrains(safeDb, safeRh, 0) * 10) / 10,
    dp: calculateDewPoint(safeDb, safeRh),   // may return null for rh ≤ 0 (correct)
    wb: Math.round(calculateWetBulb(safeDb, safeRh, 0) * 10) / 10,
  };
};

// ── Initial state ─────────────────────────────────────────────────────────────
const initialState = {
  outside: {
    summer: {
      // FIX CRIT-02: DB changed from 95.7 → 109.9°F (0.4% ASHRAE design — Delhi 28°N)
      db:    109.9,          // °F  ASHRAE 0.4% design dry-bulb
      rh:     19,            // %   corresponding coincident RH
      time:  '15:00',        // local solar time of peak occurrence
      month: 'June',
      ...deriveFields(109.9, 19),
    },
    monsoon: {
      db:    95,             // °F
      rh:    70,             // %
      time:  '10:00',
      month: 'August',
      ...deriveFields(95, 70),
    },
    winter: {
      db:    45,             // °F
      rh:    60,             // %
      time:  '06:00',
      month: 'January',
      // FIX INFO-02: wb now derived (≈ 37.7°F at 45°F, 60% RH).
      // Old hardcoded wb: 40 was inconsistent — 40°F WB at 45°F DB requires
      // RH ≈ 73%, not 60%.
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
     * When db or rh changes, automatically re-derives gr, dp, wb so the
     * ClimateConfig UI always shows self-consistent psychrometric data.
     *
     * The calc layer does NOT read gr/dp/wb from this state — it recomputes
     * them with the actual site elevation. These derived fields are display-only.
     *
     * BUG-SLICE-03 FIX: deriveFields() now returns null for invalid inputs.
     * If db or rh is cleared in the UI (empty string → NaN), derived fields
     * are set to null rather than being computed from 0°F.
     */
    updateOutsideCondition: (state, action) => {
      const { season, field, value } = action.payload;
      if (!state.outside[season]) return;

      state.outside[season][field] = value;

      // Re-derive display fields when db or rh changes.
      // deriveFields returns { gr: null, dp: null, wb: null } when inputs are
      // blank/NaN — the UI should render null as "—".
      if (field === 'db' || field === 'rh') {
        const db = state.outside[season].db;
        const rh = state.outside[season].rh;
        const derived = deriveFields(db, rh);   // BUG-SLICE-03 FIX: uses NaN-safe version
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