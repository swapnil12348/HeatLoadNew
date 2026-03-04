import { createSlice } from '@reduxjs/toolkit';
import ASHRAE from '../../constants/ashrae';

const initialState = {
  info: {
    projectName:        '',
    projectLocation:    '',
    customerName:       '',
    consultantName:     '',
    industry:           'Semiconductor',
    keyAccountManager:  '',
  },

  // ── Site reference data ───────────────────────────────────────────────────
  // dryBulbTemp, wetBulbTemp, relativeHumidity are project-brief reference
  // fields (used in reports and exports). They do NOT drive load calculations.
  // Seasonal design conditions for calculations are in climateSlice.outside.
  //
  // elevation (ft) and latitude (°) ARE consumed by calculations:
  //   elevation → altitude correction factor in rdsSelector (Cs, Cl, Patm)
  //   latitude  → reserved for SHGF latitude correction (future)
  ambient: {
    elevation:         0,    // ft — drives altitude correction in rdsSelector
    latitude:          0,    // decimal degrees — reserved for SHGF correction
    dryBulbTemp:      35,    // °C — project brief reference only
    wetBulbTemp:      24,    // °C — project brief reference only
    relativeHumidity: 50,    // %  — project brief reference only
  },

  // ── System design parameters ──────────────────────────────────────────────
  // All four fields are read by rdsSelector and drive every room calculation.
  systemDesign: {
    safetyFactor: ASHRAE.DEFAULT_SAFETY_FACTOR_PCT, // %    default 10
    bypassFactor: ASHRAE.DEFAULT_BYPASS_FACTOR,     // —    default 0.10
    adp:          ASHRAE.DEFAULT_ADP,               // °F   default 55
    fanHeat:      ASHRAE.DEFAULT_FAN_HEAT_PCT,       // %    default 5
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