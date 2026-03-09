import { createSlice } from '@reduxjs/toolkit';
import { calculateGrains, calculateDewPoint, calculateWetBulb } from '../../utils/psychro';

// ── Auto-derive gr, dp, and wb from db + rh ──────────────────────────────────
// Called at initial state build and in the reducer on every db/rh change.
// Uses sea-level Patm (elevation=0) — outdoor weather data DB+RH are local
// measurements so sea-level derivation is the meteorological convention.
//
// FIX INFO-02: wb is now derived from DB+RH via calculateWetBulb() rather than
// hardcoded. The old winter wb: 40°F was inconsistent with DB=45°F + RH=60%
// (correct WB ≈ 37.7°F). wb here is display-only — calculations elsewhere use
// calculateWetBulb() dynamically — but deriving it here keeps the state
// self-consistent and avoids confusion when ClimateConfig renders the value.
const deriveFields = (db, rh) => ({
  gr: Math.round(calculateGrains(db, rh) * 10) / 10,
  dp: calculateDewPoint(db, rh),
  wb: Math.round(calculateWetBulb(db, rh) * 10) / 10,
});

// ── Initial state with correct derived gr, dp, and wb ────────────────────────
// FIX CRIT-02: Default summer DB changed from 95.7°F (≈ 35.4°C, ~50th
// percentile) to 109.9°F (43.3°C), which is the ASHRAE HOF 2021 Ch.14 Table 1
// 0.4% design dry-bulb for Delhi (28°N). Using the 50th-percentile ambient
// means the system would be undersized for ~50% of summer hours — unacceptable
// for 24/7 semiconductor, pharma, or battery facilities.
//
// ASHRAE design condition tiers for reference:
//   0.4% DB (use for critical facilities): 43.3°C / 109.9°F  ← new default
//   1.0% DB (general commercial):          41.7°C / 107.1°F
//   2.0% DB (less critical):               40.2°C / 104.4°F
//
// NOTE: This default only affects NEW projects. Existing saved project state
// (persisted Redux / localStorage) will continue to use whatever DB was set.
// Users should verify their climate inputs against ASHRAE Table 1 for their
// specific project location.
const initialState = {
  outside: {
    summer: {
      // FIX CRIT-02: was db: 95.7, wb: 75 (non-conservative 50th-percentile)
      db: 109.9, rh: 19,  // 43.3°C, 0.4% ASHRAE design — Delhi
      ...deriveFields(109.9, 19),
      time: '15:00', month: 'June',
    },
    monsoon: {
      db: 95, rh: 70,
      ...deriveFields(95, 70),
      time: '10:00', month: 'August',
    },
    winter: {
      db: 45, rh: 60,
      // FIX INFO-02: wb was hardcoded 40°F; now derived (≈ 37.7°F at 45°F, 60% RH)
      ...deriveFields(45, 60),
      time: '06:00', month: 'January',
    },
  },
};

const climateSlice = createSlice({
  name: 'climate',
  initialState,
  reducers: {
    updateOutsideCondition: (state, action) => {
      const { season, field, value } = action.payload;
      if (!state.outside[season]) return;
      state.outside[season][field] = value;

      // When db or rh changes, re-derive gr, dp, and wb to keep state consistent.
      // gr  — used directly by rdsSelector for outdoor latent load.
      // dp  — display-only; must stay consistent with db+rh.
      // wb  — display-only (FIX INFO-02); derived, not hardcoded.
      if (field === 'db' || field === 'rh') {
        const { db, rh } = state.outside[season];
        const derived = deriveFields(parseFloat(db) || 0, parseFloat(rh) || 0);
        state.outside[season].gr = derived.gr;
        state.outside[season].dp = derived.dp;
        state.outside[season].wb = derived.wb; // FIX INFO-02
      }
    },
  },
});

export const { updateOutsideCondition } = climateSlice.actions;
export const selectClimate = (state) => state.climate;
export default climateSlice.reducer;