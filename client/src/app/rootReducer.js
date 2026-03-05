import projectReducer from '../features/project/projectSlice';
import ahuReducer from '../features/ahu/ahuSlice';
import roomReducer from '../features/room/roomSlice';
import climateReducer from '../features/climate/climateSlice';
import envelopeReducer from '../features/envelope/envelopeSlice';

const rootReducer = {
  project: projectReducer,
  ahu: ahuReducer,
  room: roomReducer,
  climate: climateReducer,
  envelope: envelopeReducer,
};

export default rootReducer;