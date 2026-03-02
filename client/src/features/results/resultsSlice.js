import { createSlice, createSelector } from '@reduxjs/toolkit';
import ASHRAE from '../../constants/ashrae';
import { selectActiveRoomEnvelope } from '../envelope/envelopeSlice'; // Import from envelope
import { selectActiveRoom } from '../room/roomSlice'; // Import from room

const initialState = {
  tuning: {
    safetyFactor: ASHRAE.DEFAULT_SAFETY_FACTOR_PCT || 10,
    bypassFactor: ASHRAE.DEFAULT_BYPASS_FACTOR || 0.10,
    adp: ASHRAE.DEFAULT_ADP || 55,
    fanHeat: ASHRAE.DEFAULT_FAN_HEAT_PCT || 5,
  }
};

const resultsSlice = createSlice({
  name: 'results',
  initialState,
  reducers: {
    updateTuning: (state, action) => {
      const { field, value } = action.payload;
      state.tuning[field] = parseFloat(value) || 0;
    }
  }
});

export const { updateTuning } = resultsSlice.actions;
export default resultsSlice.reducer;

// ── Context-Aware Selector ──────────────────────────────────────────────────

export const selectSystemResults = createSelector(
  [
    (state) => state.results.tuning,
    selectActiveRoomEnvelope, // Get envelope for Active Room
    (state) => state.climate,
    selectActiveRoom          // Get dimensions for Active Room
  ],
  (tuning, envelope, climate, room) => {
    // Safety check if room/envelope isn't ready
    if (!room || !envelope) return {
        ersh: 0, erlh: 0, eshf: 1, rise: 0, dehCFM: 0, tonnage: 0, grandTotal: 0, supplyAir: 0, freshAir: 0, designDB: 0, tuning
    };

    const { elements, internalLoads, infiltration } = envelope;
    const floorArea = parseFloat(room.floorArea) || 0;

    // ── 1. Calculate Envelope Sensible Heat (RSH) ──
    let sensible = 0;

    // A. Element Loads
    Object.values(elements).forEach(categoryArray => {
      categoryArray.forEach(item => {
        sensible += (parseFloat(item.area) || 0) * 
                    (parseFloat(item.uValue) || 0) * 
                    (item.diff?.summer || 0);
      });
    });

    // B. Internal Loads
    sensible += (internalLoads.people?.count || 0) * 
                (internalLoads.people?.sensiblePerPerson || ASHRAE.PEOPLE_SENSIBLE_SEATED);
    
    sensible += (internalLoads.equipment?.kw || 0) * ASHRAE.KW_TO_BTU;
    sensible += (internalLoads.lights?.wattsPerSqFt || 0) * floorArea * ASHRAE.BTU_PER_WATT;

    // C. Infiltration Sensible
    const totalInfilCFM = infiltration.doors.reduce((sum, door) => sum + (parseFloat(door.infilCFM) || 0), 0);
    const dbOut = climate.outside.summer?.db || 95;
    const dbIn  = climate.inside?.db || 75;
    const dT    = dbOut - dbIn;
    
    sensible += ASHRAE.SENSIBLE_FACTOR * totalInfilCFM * dT;

    // ── 2. Apply Safety Factor → ERSH ──
    const safetyMult = 1 + (tuning.safetyFactor || 0) / 100;
    const ersh = sensible * safetyMult;

    // ── 3. Calculate Latent Heat (RLH) ──
    let latent = 0;
    latent += (internalLoads.people?.count || 0) * 
              (internalLoads.people?.latentPerPerson || ASHRAE.PEOPLE_LATENT_SEATED);

    const grOut = climate.outside.summer?.gr || 100; 
    const grIn  = climate.inside?.gr || 65; 
    const dGr   = grOut - grIn;

    latent += ASHRAE.LATENT_FACTOR * totalInfilCFM * dGr;
    const erlh = latent * safetyMult;

    // ── 4. Psychrometrics & Tonnage ──
    const totalRoomHeat = ersh + erlh;
    const eshf = totalRoomHeat > 0 ? ersh / totalRoomHeat : 1;
    
    const bf = tuning.bypassFactor || 0.1;
    const adp = tuning.adp || 55;
    const rise = (1 - bf) * (dbIn - adp);
    
    const dehCFM = rise > 0 ? Math.ceil(ersh / (ASHRAE.SENSIBLE_FACTOR * rise)) : 0;
    const grandTotal = totalRoomHeat * (1 + (tuning.fanHeat || 0) / 100);
    const tonnage = grandTotal / ASHRAE.BTU_PER_TON;

    // ── 5. Ventilation ──
    const Rp = ASHRAE.VENT_PEOPLE_CFM || 5;
    const Ra = ASHRAE.VENT_AREA_CFM || 0.06;
    const peopleCount = parseFloat(internalLoads.people?.count) || 0;
    const freshAir = Math.ceil((Rp * peopleCount) + (Ra * floorArea));

    return {
      ersh: Math.round(ersh),
      erlh: Math.round(erlh),
      eshf: eshf.toFixed(3),
      rise: rise.toFixed(2),
      dehCFM,
      tonnage: tonnage.toFixed(2),
      grandTotal: Math.round(grandTotal),
      supplyAir: Math.ceil(dehCFM * 1.05),
      freshAir,
      designDB: dbIn,
      tuning
    };
  }
);