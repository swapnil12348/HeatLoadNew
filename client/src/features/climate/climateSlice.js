import { createSlice } from '@reduxjs/toolkit';
import { calculateGrains, calculateDewPoint } from '../../utils/psychro';

// ── Auto-derive gr and dp from db + rh ───────────────────────────────────────
// Called at initial state build and in the reducer on every db/rh change.
// Uses sea-level Patm (elevation=0) — outdoor weather data DB+RH are local
// measurements so sea-level derivation is the meteorological convention.
const deriveFields = (db, rh) => ({
  gr: Math.round(calculateGrains(db, rh) * 10) / 10,
  dp: calculateDewPoint(db, rh),
});

// ── Initial state with correct derived gr and dp ──────────────────────────────
// Summer:  DB=95.7°F RH=40% → gr≈101, dp≈68°F
// Monsoon: DB=85°F   RH=80% → gr≈146, dp≈78°F
// Winter:  DB=45°F   RH=60% → gr≈26,  dp≈32°F
const initialState = {
  outside: {
    summer: {
      db: 95.7, wb: 75, rh: 40,
      ...deriveFields(95.7, 40),
      time: '15:00', month: 'June',
    },
    monsoon: {
      db: 85, wb: 80, rh: 80,
      ...deriveFields(85, 80),
      time: '10:00', month: 'August',
    },
    winter: {
      db: 45, wb: 40, rh: 60,
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

      // When db or rh changes, re-derive gr and dp to keep state consistent.
      // gr is used directly by rdsSelector for outdoor latent load.
      // dp is display-only but must stay consistent with db+rh.
      if (field === 'db' || field === 'rh') {
        const { db, rh } = state.outside[season];
        const derived = deriveFields(parseFloat(db) || 0, parseFloat(rh) || 0);
        state.outside[season].gr = derived.gr;
        state.outside[season].dp = derived.dp;
      }
    },
  },
});

export const { updateOutsideCondition } = climateSlice.actions;
export const selectClimate = (state) => state.climate;
export default climateSlice.reducer;