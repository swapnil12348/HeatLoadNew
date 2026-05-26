/**
 * rootReducer.js
 * Composes all Redux slice reducers for configureStore().
 *
 * State shape:
 *   project  → project metadata (name, location, design conditions)
 *   ahu      → AHU definitions and assignments
 *   room     → room list, geometry, internal loads
 *   climate  → outdoor design conditions (ASHRAE climate data)
 *   envelope → building shell (walls, roof, glazing U-values/SHGCs)
 *
 * NOTE: features/results/* are pure selector/calculator modules —
 * they derive from the above slices and do NOT need reducer registration.
 * If a results slice is ever added, register it here.
 */

import projectReducer  from '../features/project/projectSlice';
import ahuReducer      from '../features/ahu/ahuSlice';
import roomReducer     from '../features/room/roomSlice';
import climateReducer  from '../features/climate/climateSlice';
import envelopeReducer from '../features/envelope/envelopeSlice';

const rootReducer = {
  project:  projectReducer,
  ahu:      ahuReducer,
  room:     roomReducer,
  climate:  climateReducer,
  envelope: envelopeReducer,
};

export default rootReducer;