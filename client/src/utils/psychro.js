// src/utils/psychro.js

// Simplified ASHRAE formulas
export const getSatVaporPressure = (tempF) => {
  // Rankine
  const T = tempF + 459.67;
  // Simplified Antoine equation approximation for water
  return Math.exp(23.5771 - 4030.18 / (T - 39.64)); // Result in psi roughly (needs proper constants)
  // OR simpler approximation for HVAC range:
  // e_s = 6.112 * exp((17.67 * T_c) / (T_c + 243.5)) -> returns hPa
};

// A workable approximation for standard air (0-100°F)
export const calculateGrains = (dbF, rh) => {
  // 1. Convert DB to Celsius
  const dbC = (dbF - 32) * 5 / 9;
  
  // 2. Saturation Vapor Pressure (hPa)
  const Es = 6.112 * Math.exp((17.67 * dbC) / (dbC + 243.5));
  
  // 3. Actual Vapor Pressure (hPa)
  const E = (rh / 100) * Es;
  
  // 4. Humidity Ratio (kg/kg) -> W = 0.62198 * E / (P - E) assuming P = 1013.25 hPa
  const W_kg = 0.62198 * E / (1013.25 - E);
  
  // 5. Convert to Grains/lb (1 lb = 7000 grains)
  return W_kg * 7000;
};

// Enthalpy (BTU/lb)
export const calculateEnthalpy = (dbF, grains) => {
  // h = 0.24*DB + W(1061 + 0.444*DB)
  const W_lb = grains / 7000;
  return 0.24 * dbF + W_lb * (1061 + 0.444 * dbF);
};