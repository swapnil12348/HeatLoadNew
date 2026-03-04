// resultsSlice.js
// This slice holds no state and exports no selectors.
// All calculations live in src/features/results/rdsSelector.js
// which is the single source of truth for computed room data.
import { createSlice } from '@reduxjs/toolkit';

const resultsSlice = createSlice({
  name: 'results',
  initialState: {},
  reducers: {}
});

export default resultsSlice.reducer;