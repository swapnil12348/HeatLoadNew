import { createSlice, createSelector } from '@reduxjs/toolkit';
// Assuming ASHRAE constants exist. If not, we can replace them with hardcoded values.
import ASHRAE from '../../constants/ashrae'; 
import { selectActiveEnvelope } from '../envelope/envelopeSlice'; // <--- FIX: Updated Import Name
import { selectActiveRoom } from '../room/roomSlice';

const initialState = {
  tuning: {
    safetyFactor: 10,  // Default if ASHRAE constant missing
    bypassFactor: 0.10,
    adp: 55,
    fanHeat: 5,
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
    selectActiveEnvelope, // <--- FIX: Updated Selector Usage
    (state) => state.climate || {}, // Fallback if climate undefined
    selectActiveRoom
  ],
  (tuning, envelope, climate, room) => {
    // Safety check if room/envelope isn't ready
    if (!room || !envelope) return {
        ersh: 0, erlh: 0, eshf: 1, rise: 0, dehCFM: 0, tonnage: 0, grandTotal: 0, supplyAir: 0, freshAir: 0, designDB: 0, tuning
    };

    const { elements, internalLoads, infiltration } = envelope;
    const floorArea = parseFloat(room.floorArea) || 0;

    // Use ASHRAE constants or defaults to prevent crash if file missing
    const PEOPLE_SENSIBLE = ASHRAE?.PEOPLE_SENSIBLE_SEATED || 245;
    const PEOPLE_LATENT = ASHRAE?.PEOPLE_LATENT_SEATED || 205;
    const KW_TO_BTU = 3412;
    const BTU_PER_WATT = 3.412;
    const SENSIBLE_FACTOR = 1.08;
    const LATENT_FACTOR = 0.68;
    const BTU_PER_TON = 12000;

    // ── 1. Calculate Envelope Sensible Heat (RSH) ──
    let sensible = 0;

    // A. Element Loads (Walls, Glass, etc.)
    if (elements) {
      Object.values(elements).forEach(categoryArray => {
        if (Array.isArray(categoryArray)) {
          categoryArray.forEach(item => {
            sensible += (parseFloat(item.area) || 0) * 
                        (parseFloat(item.uValue) || 0) * 
                        (item.diff?.summer || 0);
          });
        }
      });
    }

    // B. Internal Loads
    sensible += (internalLoads?.people?.count || 0) * 
                (internalLoads?.people?.sensiblePerPerson || PEOPLE_SENSIBLE);
    
    sensible += (internalLoads?.equipment?.kw || 0) * KW_TO_BTU;
    sensible += (internalLoads?.lights?.wattsPerSqFt || 0) * floorArea * BTU_PER_WATT;

    // C. Infiltration Sensible
    const totalInfilCFM = infiltration?.doors?.reduce((sum, door) => sum + (parseFloat(door.infilCFM) || 0), 0) || 0;
    
    // Safety checks for nested climate data
    const dbOut = climate.outside?.summer?.db || 95;
    const dbIn  = room.designTemp || 72; // Use Room Design Temp, fallback to 72
    const dT    = dbOut - dbIn;
    
    sensible += SENSIBLE_FACTOR * totalInfilCFM * dT;

    // ── 2. Apply Safety Factor → ERSH ──
    const safetyMult = 1 + (tuning.safetyFactor || 0) / 100;
    const ersh = sensible * safetyMult;

    // ── 3. Calculate Latent Heat (RLH) ──
    let latent = 0;
    latent += (internalLoads?.people?.count || 0) * 
              (internalLoads?.people?.latentPerPerson || PEOPLE_LATENT);

    const grOut = climate.outside?.summer?.gr || 100; 
    const grIn  = climate.inside?.gr || 65; // Should ideally be calculated from room DB/RH
    const dGr   = grOut - grIn;

    latent += LATENT_FACTOR * totalInfilCFM * dGr;
    const erlh = latent * safetyMult;

    // ── 4. Psychrometrics & Tonnage ──
    const totalRoomHeat = ersh + erlh;
    const eshf = totalRoomHeat > 0 ? ersh / totalRoomHeat : 1;
    
    const bf = tuning.bypassFactor || 0.1;
    const adp = tuning.adp || 55;
    const rise = (1 - bf) * (dbIn - adp);
    
    const dehCFM = rise > 0 ? Math.ceil(ersh / (SENSIBLE_FACTOR * rise)) : 0;
    const grandTotal = totalRoomHeat * (1 + (tuning.fanHeat || 0) / 100);
    const tonnage = grandTotal / BTU_PER_TON;

    // ── 5. Ventilation ──
    const Rp = ASHRAE?.VENT_PEOPLE_CFM || 5;
    const Ra = ASHRAE?.VENT_AREA_CFM || 0.06;
    const peopleCount = parseFloat(internalLoads?.people?.count) || 0;
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