// src/test-utils.jsx
import React from 'react'
import { render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'

// IMPORT ALL YOUR REDUCERS HERE
import roomReducer from './features/room/roomSlice'
import envelopeReducer from './features/envelope/envelopeSlice'
import ahuReducer from './features/ahu/ahuSlice'
import climateReducer from './features/climate/climateSlice' // <--- Added
import projectReducer from './features/project/projectSlice' // <--- Added
// Add resultsReducer if you have one, though usually results are just selectors.

export function renderWithProviders(
  ui,
  {
    preloadedState = {},
    // Create the store exactly like your real app does
    store = configureStore({
      reducer: { 
          room: roomReducer, 
          envelope: envelopeReducer,
          ahu: ahuReducer,
          climate: climateReducer, // <--- Added
          project: projectReducer  // <--- Added
      },
      preloadedState,
    }),
    ...renderOptions
  } = {}
) {
  function Wrapper({ children }) {
    return <Provider store={store}>{children}</Provider>
  }
  return { store, ...render(ui, { wrapper: Wrapper, ...renderOptions }) }
}