import { createSlice } from '@reduxjs/toolkit';
import ASHRAE from '../../constants/ashrae';

const initialState = {
  internal: {
    people: { count: 4, sensiblePerPerson: 245, latentPerPerson: 205 },
    equipment: { kw: 0.5 },
    lights: { wattsPerSqFt: 1.1 },
  },
  infiltration: {
    method: "air_change",
    airChangesPerHour: 0.5,
    cfm: 0
  }
};

const loadsSlice = createSlice({
  name: 'loads',
  initialState,
  reducers: {
    updateInternalLoad: (state, action) => {
      const { category, field, value } = action.payload;
      state.internal[category][field] = parseFloat(value) || 0;
    },
    updateInfiltration: (state, action) => {
      const { field, value } = action.payload;
      state.infiltration[field] = value;
    }
  }
});

export const { updateInternalLoad, updateInfiltration } = loadsSlice.actions;
export default loadsSlice.reducer;