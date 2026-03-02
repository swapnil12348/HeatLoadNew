import { createSlice } from '@reduxjs/toolkit';
import ASHRAE from '../../constants/ashrae';

const initialState = {
  info: {
    projectName: "", 
    projectLocation: "",
    customerName: "",
    consultantName: "",
    industry: "Semiconductor", 
    keyAccountManager: "",
  },
  ambient: {
    elevation: 0,
    dryBulbTemp: 35,
    wetBulbTemp: 24,
    latitude: 0,
    relativeHumidity: 50 
  },
  systemDesign: {
    safetyFactor: ASHRAE?.DEFAULT_SAFETY_FACTOR_PCT || 10,
    bypassFactor: ASHRAE?.DEFAULT_BYPASS_FACTOR || 0.10,
    adp: ASHRAE?.DEFAULT_ADP || 50,
    fanHeat: ASHRAE?.DEFAULT_FAN_HEAT_PCT || 5,
  }
};

const projectSlice = createSlice({
  name: 'project',
  initialState,
  reducers: {
    updateProjectInfo: (state, action) => {
      // payload: { field: "projectName", value: "New Name" }
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
    }
  }
});

export const { updateProjectInfo, updateAmbient, updateSystemDesign } = projectSlice.actions;
export default projectSlice.reducer;