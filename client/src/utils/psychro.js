// src/utils/psychro.js

export const getSatVaporPressure = (tempF) => {
  // Simple Antoine approximation
  const dbC = (tempF - 32) * 5 / 9;
  return 6.112 * Math.exp((17.67 * dbC) / (dbC + 243.5)); // hPa
};

export const calculateGrains = (dbF, rh) => {
  if (!dbF || !rh) return 0;
  
  const dbC = (dbF - 32) * 5 / 9;
  const Es = 6.112 * Math.exp((17.67 * dbC) / (dbC + 243.5)); // hPa
  const E = (rh / 100) * Es; // Partial pressure
  
  // Humidity Ratio W (kg/kg) at standard pressure (1013.25 hPa)
  // W = 0.62198 * E / (P - E)
  const P = 1013.25;
  const W_kg = 0.62198 * E / (P - E);
  
  // Convert to Grains (1 lb = 7000 grains)
  return W_kg * 7000;
};

export const calculateEnthalpy = (dbF, grains) => {
  const W_lb = grains / 7000;
  return 0.24 * dbF + W_lb * (1061 + 0.444 * dbF);
};