import { createSlice, createSelector } from '@reduxjs/toolkit';
import ASHRAE from '../../constants/ashrae';
import { selectActiveEnvelope } from '../envelope/envelopeSlice';
import { selectActiveRoom } from '../room/roomSlice';
import { calculateGrains } from '../../utils/psychro'; // ← fixes the grIn bug too

// ── No more local tuning state — projectSlice.systemDesign is the source of truth ──

const resultsSlice = createSlice({
  name: 'results',
  initialState: {},
  reducers: {}
});

export default resultsSlice.reducer;

// ── Selector ────────────────────────────────────────────────────────────────

export const selectSystemResults = createSelector(
  [
    (state) => state.project.systemDesign, // ← was state.results.tuning
    selectActiveEnvelope,
    (state) => state.climate || {},
    selectActiveRoom,
  ],
  (systemDesign, envelope, climate, room) => {

    if (!room || !envelope) return {
      ersh: 0, erlh: 0, eshf: 1, rise: 0, dehCFM: 0,
      tonnage: 0, grandTotal: 0, supplyAir: 0, freshAir: 0, designDB: 0,
      systemDesign,
    };

    const { elements, internalLoads, infiltration } = envelope;
    const floorArea  = parseFloat(room.floorArea) || 0;

    const PEOPLE_SENSIBLE = ASHRAE?.PEOPLE_SENSIBLE_SEATED || 245;
    const PEOPLE_LATENT   = ASHRAE?.PEOPLE_LATENT_SEATED   || 205;
    const KW_TO_BTU       = 3412;
    const BTU_PER_WATT    = 3.412;
    const SENSIBLE_FACTOR = 1.08;
    const LATENT_FACTOR   = 0.68;
    const BTU_PER_TON     = 12000;

    // ── 1. Sensible (RSH) ──────────────────────────────────────────────────

    let sensible = 0;

    // Envelope elements (walls, glass, etc.)
    if (elements) {
      Object.values(elements).forEach(categoryArray => {
        if (Array.isArray(categoryArray)) {
          categoryArray.forEach(item => {
            sensible += (parseFloat(item.area)   || 0) *
                        (parseFloat(item.uValue) || 0) *
                        (item.diff?.summer       || 0);
          });
        }
      });
    }

    // Internal loads
    sensible += (internalLoads?.people?.count        || 0) * (internalLoads?.people?.sensiblePerPerson || PEOPLE_SENSIBLE);
    sensible += (internalLoads?.equipment?.kw        || 0) * KW_TO_BTU;
    sensible += (internalLoads?.lights?.wattsPerSqFt || 0) * floorArea * BTU_PER_WATT;

    // Infiltration sensible (doors array — from envelope detail tab)
    const totalInfilCFM = infiltration?.doors?.reduce(
      (sum, door) => sum + (parseFloat(door.infilCFM) || 0), 0
    ) || 0;

    const dbOut = parseFloat(climate.outside?.summer?.db) || 95;
    const dbIn  = parseFloat(room.designTemp)             || 72;

    sensible += SENSIBLE_FACTOR * totalInfilCFM * (dbOut - dbIn);

    // ── 2. Apply safety factor → ERSH ─────────────────────────────────────
    const safetyMult = 1 + (systemDesign.safetyFactor || 0) / 100; // ← reads project
    const ersh = sensible * safetyMult;

    // ── 3. Latent (RLH) ───────────────────────────────────────────────────
    let latent = 0;
    latent += (internalLoads?.people?.count || 0) * (internalLoads?.people?.latentPerPerson || PEOPLE_LATENT);

    const grOut = parseFloat(climate.outside?.summer?.gr) || 100;
    const grIn  = calculateGrains(dbIn, parseFloat(room.designRH) || 50); // ← fixed: was climate.inside?.gr
    latent += LATENT_FACTOR * totalInfilCFM * (grOut - grIn);

    const erlh = latent * safetyMult;

    // ── 4. Psychrometrics & Tonnage ───────────────────────────────────────
    const totalRoomHeat = ersh + erlh;
    const eshf = totalRoomHeat > 0 ? ersh / totalRoomHeat : 1;

    const bf   = systemDesign.bypassFactor || 0.1;  // ← reads project
    const adp  = systemDesign.adp          || 55;   // ← reads project
    const rise = (1 - bf) * (dbIn - adp);

    const dehCFM     = rise > 0 ? Math.ceil(ersh / (SENSIBLE_FACTOR * rise)) : 0;
    const grandTotal = totalRoomHeat * (1 + (systemDesign.fanHeat || 0) / 100); // ← reads project
    const tonnage    = grandTotal / BTU_PER_TON;

    // ── 5. Ventilation (ASHRAE 62.1) ──────────────────────────────────────
    const Rp         = ASHRAE?.VENT_PEOPLE_CFM || 5;
    const Ra         = ASHRAE?.VENT_AREA_CFM   || 0.06;
    const peopleCount = parseFloat(internalLoads?.people?.count) || 0;
    const freshAir   = Math.ceil((Rp * peopleCount) + (Ra * floorArea));

    return {
      ersh:       Math.round(ersh),
      erlh:       Math.round(erlh),
      eshf:       eshf.toFixed(3),
      rise:       rise.toFixed(2),
      dehCFM,
      tonnage:    tonnage.toFixed(2),
      grandTotal: Math.round(grandTotal),
      supplyAir:  Math.ceil(dehCFM * 1.05),
      freshAir,
      designDB:   dbIn,
      systemDesign, // ← returned so UI can display current values
    };
  }
);