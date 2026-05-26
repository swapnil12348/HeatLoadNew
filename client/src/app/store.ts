/// <reference types="vite/client" />

import { configureStore } from '@reduxjs/toolkit';
import rootReducer from './rootReducer';

export const store = configureStore({
  reducer: rootReducer,
  devTools: import.meta.env.MODE !== 'production',
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // climate slice can hold transient NaN while the user is typing
        // a numeric field before blurring. All other slices are safe.
        // Note: calculation results (features/results/*) are pure selectors
        // and never enter Redux state — no path for them is needed here.
        ignoredPaths: ['climate'],
      },
    }),
});

// ── AUTOMATIC TYPE INFERENCE ───────────────────────────────────────────────
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;

// ── GLOBAL WINDOW TYPING ───────────────────────────────────────────────────
declare global {
  interface Window {
    __store?: typeof store;
  }
}

if (import.meta.env.DEV) {
  window.__store = store;
}