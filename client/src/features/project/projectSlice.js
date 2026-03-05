import { createSlice } from '@reduxjs/toolkit';
import ASHRAE from '../../constants/ashrae';

const initialState = {
  info: {
    projectName:       '',
    projectLocation:   '',
    customerName:      '',
    consultantName:    '',
    industry:          'Semiconductor',
    keyAccountManager: '',
  },

  // ── Site reference & calculation parameters ───────────────────────────────
  //
  // elevation   → altitude correction factor Cf in rdsSelector (Cs, Cl, Patm)
  // latitude    → BUG-07 FIX: CLTD LM correction + SHGF latitude factor
  //               Default 28°N (Delhi). Negative = southern hemisphere.
  // dailyRange  → BUG-09 FIX: full daily DB swing (°F) for CLTD mean-temp correction.
  //               0 = use built-in seasonal defaults.
  //               Coastal: 8–12°F · Inland: 18–25°F · Desert: 28–40°F
  //
  // dryBulbTemp, wetBulbTemp, relativeHumidity = project-brief reference only.
  //   NOT used in calculations — seasonal design conditions live in climateSlice.
  ambient: {
    elevation:         0,    // ft  — altitude correction
    latitude:         28,    // °   — CLTD/SHGF latitude correction (BUG-07)
    dailyRange:        0,    // °F  — diurnal range for CLTD correction (BUG-09)
    dryBulbTemp:      35,    // °C  — project brief reference only
    wetBulbTemp:      24,    // °C  — project brief reference only
    relativeHumidity: 50,    // %   — project brief reference only
  },

  // ── System design parameters ──────────────────────────────────────────────
  // All fields read by rdsSelector — drive every room calculation.
  //
  // BUG-14 NOTE: safetyFactor and fanHeat are applied independently.
  //   Correct order: grandTotal = (rawSensible + rawLatent) × safetyMult × fanHeatMult
  //   NOT:           grandTotal = rawLoads × (safetyMult × fanHeatMult) — avoids compounding
  //
  // BUG-12 NOTE: humidificationTarget is the minimum indoor RH% for winter
  //   humidification sizing. When outdoor grains < indoor grains, the system
  //   must ADD moisture. This field sets the floor for that calculation.
  //   Typical values: pharma 30–50% · semiconductor fab 40–50% · battery dry room 1–5%
  systemDesign: {
    safetyFactor:          ASHRAE.DEFAULT_SAFETY_FACTOR_PCT,  // %   default 10
    bypassFactor:          ASHRAE.DEFAULT_BYPASS_FACTOR,      // —   default 0.10
    adp:                   ASHRAE.DEFAULT_ADP,                // °F  default 55
    fanHeat:               ASHRAE.DEFAULT_FAN_HEAT_PCT,       // %   default 5
    humidificationTarget:  45,                                 // %RH default 45
  },
};

const projectSlice = createSlice({
  name: 'project',
  initialState,
  reducers: {
    updateProjectInfo: (state, action) => {
      const { field, value } = action.payload;
      state.info[field] = value;
    },

    updateAmbient: (state, action) => {
      const { field, value } = action.payload;
      // Latitude can be negative (southern hemisphere) — don't floor at 0.
      state.ambient[field] = parseFloat(value) || 0;
    },

    updateSystemDesign: (state, action) => {
      const { field, value } = action.payload;
      state.systemDesign[field] = parseFloat(value) || 0;
    },
  },
});

export const { updateProjectInfo, updateAmbient, updateSystemDesign } = projectSlice.actions;
export default projectSlice.reducer;