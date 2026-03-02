import { createSlice, createSelector } from '@reduxjs/toolkit';

const initialState = {
  outside: {
    summer:  { db: 95, wb: 75, rh: 40, dp: 55, gr: 100, time: "15:00", month: "June" },
    monsoon: { db: 85, wb: 80, rh: 80, dp: 78, gr: 130, time: "10:00", month: "August" },
    winter:  { db: 45, wb: 40, rh: 60, dp: 32, gr: 30,  time: "06:00", month: "January" }
  },
  inside: { 
    db: 72, // Standard comfort
    rh: 50, 
    dp: 52, // Approx for 72/50%
    gr: 58  // Approx for 72/50%
  }
};

const climateSlice = createSlice({
  name: 'climate',
  initialState,
  reducers: {
    updateOutsideCondition: (state, action) => {
      const { season, field, value } = action.payload;
      // Ensure we update the specific season
      if (state.outside[season]) {
        state.outside[season][field] = value;
      }
    },
    updateInsideCondition: (state, action) => {
      const { field, value } = action.payload;
      state.inside[field] = value;
    }
  }
});

export const { updateOutsideCondition, updateInsideCondition } = climateSlice.actions;

// ── Selectors ───────────────────────────────────────────────────────────────

export const selectClimate = (state) => state.climate;

// Derived Selector: Calculates the difference (Outside - Inside) for DB and Grains
// This replaces the 'diff()' function in your old component.
export const selectClimateDiffs = createSelector(
  [selectClimate],
  (climate) => {
    const seasons = ['summer', 'monsoon', 'winter'];
    const diffs = {};

    seasons.forEach(season => {
      diffs[season] = {
        db: (climate.outside[season].db - climate.inside.db).toFixed(1),
        gr: (climate.outside[season].gr - climate.inside.gr).toFixed(1)
      };
    });
    
    return diffs;
  }
);

export default climateSlice.reducer;