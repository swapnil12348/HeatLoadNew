// src/features/results/rdsSelector.js
import { createSelector } from '@reduxjs/toolkit';
import { calculateGrains } from '../../utils/psychro';
import ASHRAE from '../../constants/ashrae';
import { calcTotalEnvelopeGain } from '../../utils/envelopeCalc';

// ── Unit helpers ─────────────────────────────────────────────────────────────
// designTemp is stored in °C throughout roomSlice / RDSConfig.
// All ASHRAE CLTD, psychrometric, and supply-air formulas require °F.
const cToF = (c) => (parseFloat(c) * 9) / 5 + 32;

/**
 * Altitude correction factor for psychrometric constants (1.08 and 0.68).
 *
 * At sea level: 1.08 = 60 min/hr × 0.075 lb/ft³ × 0.24 BTU/lb·°F
 *               0.68 = 60 min/hr × 0.075 lb/ft³ × (1/7000) lb/gr × 1061 BTU/lb
 * Both depend on air density which decreases with altitude.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 1, Eq. 3
 * p_alt = 29.921 × (1 − 6.8754×10⁻⁶ × elevation_ft)^5.2559  [inHg]
 * Cf = p_alt / 29.921
 */
const altitudeCorrectionFactor = (elevationFt) => {
  const elev = parseFloat(elevationFt) || 0;
  if (elev <= 0) return 1.0;
  const pAlt = 29.921 * Math.pow(1 - 6.8754e-6 * elev, 5.2559);
  return pAlt / 29.921;
};

// ── Input selectors ───────────────────────────────────────────────────────────
const selectRooms        = (state) => state.room.list;
const selectEnvelopes    = (state) => state.envelope.byRoomId;
const selectAhus         = (state) => state.ahu.list;
const selectClimate      = (state) => state.climate;
const selectSystemDesign = (state) => state.project.systemDesign;
const selectElevation    = (state) => state.project.ambient.elevation || 0;

// ── Per-season load calculator ────────────────────────────────────────────────
const calculateSeasonLoad = (room, envelope, climate, season, systemDesign, altCf) => {
  const env = envelope || { internalLoads: {}, infiltration: {} };
  const int = env.internalLoads || {};
  const inf = env.infiltration  || {};

  // ── Outdoor conditions ────────────────────────────────────────────────────
  // climateSlice stores db in °F (initial values: 95.7, 85, 45).
  // gr is user-entered directly in gr/lb — use as-is.
  // Do NOT fall back to calculateGrains(db, wb): calculateGrains expects
  // RH% as its second argument, not wet-bulb temperature.
  const outdoor = climate?.outside?.[season] || { db: 95, gr: 100 };
  const dbOut   = parseFloat(outdoor.db) || 95;
  const grOut   = parseFloat(outdoor.gr) || 100;

  // ── Indoor conditions ─────────────────────────────────────────────────────
  // room.designTemp is stored in °C — convert to °F for all ASHRAE formulas.
  const dbInF = isNaN(parseFloat(room.designTemp))
    ? 72
    : cToF(room.designTemp);
  const rhIn  = parseFloat(room.designRH) || 50;
  // calculateGrains(dbF, rh%) — both arguments now correct
  const grIn  = calculateGrains(dbInF, rhIn);

  const floorArea = parseFloat(room.floorArea) || 0;
  const vol       = parseFloat(room.volume)    || 0;

  // Envelope CLTD gain — tRoom must be °F for correctCLTD() formula
  const envelopeGain = calcTotalEnvelopeGain(env.elements, climate, dbInF, season);

  // ── Altitude-corrected psychrometric factors ──────────────────────────────
  const Cs = ASHRAE.SENSIBLE_FACTOR * altCf; // adjusted 1.08
  const Cl = ASHRAE.LATENT_FACTOR   * altCf; // adjusted 0.68

  // ── Sensible loads ────────────────────────────────────────────────────────
  const pplCount   = parseFloat(int.people?.count)        || 0;
  const pplSens    = pplCount * (int.people?.sensiblePerPerson || ASHRAE.PEOPLE_SENSIBLE_SEATED);
  const lightsSens = (parseFloat(int.lights?.wattsPerSqFt) || 0) * floorArea * ASHRAE.BTU_PER_WATT;
  const equipSens  = (parseFloat(int.equipment?.kw)        || 0) * ASHRAE.KW_TO_BTU;
  const infilCFM   = (vol * (parseFloat(inf.achValue)      || 0)) / 60;
  const infilSens  = Cs * infilCFM * (dbOut - dbInF);

  const rawSensible = envelopeGain + pplSens + lightsSens + equipSens + infilSens;

  // ── Latent loads ──────────────────────────────────────────────────────────
  const pplLat    = pplCount * (int.people?.latentPerPerson || ASHRAE.PEOPLE_LATENT_SEATED);
  const infilLat  = Cl * infilCFM * (grOut - grIn);
  const rawLatent = pplLat + infilLat;

  // ── Safety factor ─────────────────────────────────────────────────────────
  const safetyMult = 1 + (systemDesign.safetyFactor || 10) / 100;
  const ersh = Math.round(rawSensible * safetyMult);
  const erlh = Math.round(rawLatent   * safetyMult);

  // Return equipSens and safetyMult so the caller can derive ershOff
  // without re-computing them independently (was a duplication bug).
  return { ersh, erlh, grains: grIn.toFixed(1), dbInF, grIn, equipSens, safetyMult };
};

// ── Main selector ─────────────────────────────────────────────────────────────
export const selectRdsData = createSelector(
  [selectRooms, selectEnvelopes, selectAhus, selectClimate, selectSystemDesign, selectElevation],
  (rooms, envelopes, ahus, climate, systemDesign, elevation) => {

    // Compute once — same altitude for all rooms in the project
    const altCf = altitudeCorrectionFactor(elevation);
    const Cs    = ASHRAE.SENSIBLE_FACTOR * altCf;

    return rooms.map(room => {
      const envelope = envelopes[room.id] || null;
      const ahu      = ahus.find(a => a.id === room.assignedAhuIds?.[0]) || {};

      const seasons = ['summer', 'monsoon', 'winter'];
      const results = {};
      let summerCalcs = null;

      seasons.forEach(season => {
        const calcs = calculateSeasonLoad(
          room, envelope, climate, season, systemDesign, altCf
        );

        results[`ershOn_${season}`]  = calcs.ersh;
        results[`erlhOn_${season}`]  = calcs.erlh;
        results[`grains_${season}`]  = calcs.grains;
        // ershOff: remove equipment contribution (already safety-factored)
        results[`ershOff_${season}`] = Math.round(
          calcs.ersh - calcs.equipSens * calcs.safetyMult
        );

        if (season === 'summer') summerCalcs = calcs;
      });

      // ── Supply air — summer peak ──────────────────────────────────────────
      // CFM = ERSH / (Cs × ΔT_supply)
      // ΔT_supply = (1 − BF) × (dbIn°F − ADP°F)
      // ADP is stored in °F in systemDesign (set on ProjectDetails page)
      const peakErsh = results['ershOn_summer'];
      const peakErlh = results['erlhOn_summer'];
      const dbInF    = summerCalcs?.dbInF ?? 72;
      const bf       = systemDesign.bypassFactor || 0.10;
      const adp      = systemDesign.adp          || 55; // °F
      const supplyDT = (1 - bf) * (dbInF - adp);

      const supplyAir = (supplyDT > 0 && peakErsh > 0)
        ? Math.ceil(peakErsh / (Cs * supplyDT))
        : 0;

      // ── Cooling capacity ──────────────────────────────────────────────────
      const fanHeatMult  = 1 + (systemDesign.fanHeat || 5) / 100;
      const grandTotal   = (peakErsh + peakErlh) * fanHeatMult;
      const coolingCapTR = (grandTotal / ASHRAE.BTU_PER_TON).toFixed(2);

      return {
        ...room,
        id:         room.id,
        ahuId:      ahu.id   || '',
        typeOfUnit: ahu.type || '-',

        people_count: envelope?.internalLoads?.people?.count || 0,
        equipment_kw: envelope?.internalLoads?.equipment?.kw || 0,

        supplyAir,
        coolingCapTR,
        grandTotal: Math.round(grandTotal),
        ...results,

        _raw: { room, envelope, ahu },
      };
    });
  }
);