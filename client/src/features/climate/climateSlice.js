import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  outside: {
    summer: { db: 95.7, wb: 75, rh: 40, dp: 55, gr: 100, time: "15:00", month: "June" },
    monsoon: { db: 85, wb: 80, rh: 80, dp: 78, gr: 130, time: "10:00", month: "August" },
    winter: { db: 45, wb: 40, rh: 60, dp: 32, gr: 30, time: "06:00", month: "January" }
  }
};

const climateSlice = createSlice({
  name: 'climate',
  initialState,
  reducers: {
    updateOutsideCondition: (state, action) => {
      const { season, field, value } = action.payload;
      if (state.outside[season]) {
        state.outside[season][field] = value;
      }
    }
  }
});

export const { updateOutsideCondition } = climateSlice.actions;
export const selectClimate = (state) => state.climate;

export default climateSlice.reducer;