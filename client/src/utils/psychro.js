// src/utils/psychro.js

export const getSatVaporPressure = (tempF) => {
  // Antoine Equation Approximation
  // Tc = (Tf - 32) * 5/9
  const dbC = (tempF - 32) * 5 / 9;
  // Es (hPa)
  return 6.112 * Math.exp((17.67 * dbC) / (dbC + 243.5)); 
};

export const calculateGrains = (dbF, rh) => {
  // Safety check
  if (dbF === undefined || rh === undefined) return 0;

  const dbC = (dbF - 32) * 5 / 9;
  
  // Saturation Pressure (hPa)
  const Es = 6.112 * Math.exp((17.67 * dbC) / (dbC + 243.5));
  
  // Partial Pressure (hPa)
  const E = (rh / 100) * Es;
  
  // Atmospheric Pressure (Standard Sea Level) ~ 1013.25 hPa
  const Patm = 1013.25;
  
  // Humidity Ratio (kg water / kg dry air)
  // W = 0.62198 * E / (Patm - E)
  const W_kg = 0.62198 * E / (Patm - E);
  
  // Convert to Grains (1 lb = 7000 grains)
  const grains = W_kg * 7000;
  
  return isNaN(grains) ? 0 : grains;
};

export const calculateEnthalpy = (dbF, grains) => {
  // Enthalpy (Btu/lb)
  const W_lb = grains / 7000;
  return 0.24 * dbF + W_lb * (1061 + 0.444 * dbF);
};