import { configureStore } from '@reduxjs/toolkit';
import rootReducer from './rootReducer';

export const store = configureStore({
  reducer: rootReducer,
  devTools: import.meta.env.MODE !== 'production',
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializabilityCheck: {
        // climate slice can hold transient NaN while the user is typing
        // a numeric field before blurring. All other slices are safe.
        // Note: calculation results (features/results/*) are pure selectors
        // and never enter Redux state — no path for them is needed here.
        ignoredPaths: ['climate'],
      },
    }),
});

export default store;

if (import.meta.env.DEV) window.__store = store;