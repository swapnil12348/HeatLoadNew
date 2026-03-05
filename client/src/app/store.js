import { configureStore } from '@reduxjs/toolkit';
import rootReducer from './rootReducer';

export const store = configureStore({
  reducer: rootReducer,
  devTools: import.meta.env.MODE !== 'production',
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializabilityCheck: {
        // Ignore paths where ASHRAE calcs may produce NaN/Infinity
        ignoredPaths: ['climate', 'results'],
      },
    }),
});

export default store;