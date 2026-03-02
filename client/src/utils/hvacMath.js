import ASHRAE from '../constants/ashrae';

export const calculateRoomLoad = (room, envelope, climate, tuning) => {
  // Safe defaults
  if (!room || !envelope) return null;

  const { elements, internalLoads, infiltration } = envelope;
  const floorArea = parseFloat(room.floorArea) || 0;
  const volume = parseFloat(room.volume) || 0;

  // 1. Sensible Heat (RSH)
  let sensible = 0;
  
  // Elements (Walls, Glass, etc)
  Object.values(elements).forEach(cat => {
    cat.forEach(item => {
      sensible += (parseFloat(item.area) || 0) * (parseFloat(item.uValue) || 0) * (item.diff?.summer || 0);
    });
  });

  // Internals
  const peopleSens = (internalLoads.people?.count || 0) * (internalLoads.people?.sensiblePerPerson || 245);
  const equipSens = (internalLoads.equipment?.kw || 0) * 3412; // KW to BTU
  const lightSens = (internalLoads.lights?.wattsPerSqFt || 0) * floorArea * 3.412;
  
  sensible += peopleSens + equipSens + lightSens;

  // Infiltration Sensible
  const totalInfilCFM = infiltration.doors.reduce((sum, d) => sum + (parseFloat(d.infilCFM) || 0), 0);
  const dbOut = climate.outside.summer?.db || 95;
  const dbIn = climate.inside?.db || 75;
  const infilSens = 1.08 * totalInfilCFM * (dbOut - dbIn);
  
  sensible += infilSens;

  // Safety Factor
  const safetyMult = 1 + (tuning.safetyFactor || 0) / 100;
  const ersh = sensible * safetyMult;

  // 2. Latent Heat (RLH)
  let latent = 0;
  const peopleLat = (internalLoads.people?.count || 0) * (internalLoads.people?.latentPerPerson || 205);
  
  // Infiltration Latent
  const grOut = climate.outside.summer?.gr || 100;
  const grIn = climate.inside?.gr || 65;
  const infilLat = 0.68 * totalInfilCFM * (grOut - grIn);
  
  latent += peopleLat + infilLat;
  const erlh = latent * safetyMult;

  // 3. Totals & Airflow
  const totalRoomHeat = ersh + erlh;
  const grandTotal = totalRoomHeat * (1 + (tuning.fanHeat || 0) / 100);
  const tonnage = grandTotal / 12000;

  const bf = tuning.bypassFactor || 0.1;
  const adp = tuning.adp || 55;
  const rise = (1 - bf) * (dbIn - adp);
  const dehCFM = rise > 0 ? Math.ceil(ersh / (1.08 * rise)) : 0;
  const supplyAir = Math.ceil(dehCFM * 1.05); // +5% leakage

  // Fresh Air (Ashrae 62.1 Simplified)
  const freshAirPeople = (internalLoads.people?.count || 0) * 5;
  const freshAirArea = floorArea * 0.06;
  const freshAir = Math.ceil(freshAirPeople + freshAirArea);

  // Air Changes (ACPH)
  const acph = volume > 0 ? (supplyAir * 60) / volume : 0;

  return {
    ersh, erlh, totalRoomHeat, grandTotal, tonnage,
    dehCFM, supplyAir, freshAir, acph,
    internalLoads: { peopleSens, peopleLat, equipSens, lightSens },
    infilSens, infilLat
  };
};