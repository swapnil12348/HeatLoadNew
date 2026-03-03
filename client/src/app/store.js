import { configureStore } from '@reduxjs/toolkit';
import projectReducer from '../features/project/projectSlice';
import ahuReducer from '../features/ahu/ahuSlice';
import roomReducer from '../features/room/roomSlice';
import climateReducer from '../features/climate/climateSlice';
import envelopeReducer from '../features/envelope/envelopeSlice';
import resultsReducer from '../features/results/resultsSlice'

export const store = configureStore({
  reducer: {
    project: projectReducer,
    ahu: ahuReducer,
    room: roomReducer,
    climate: climateReducer,
    envelope: envelopeReducer,
    results: resultsReducer,
  },
});

export default store;