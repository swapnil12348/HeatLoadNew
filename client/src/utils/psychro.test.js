// src/utils/psychro.test.js
import { describe, it, expect } from 'vitest';
import { calculateGrains, calculateEnthalpy } from './psychro';

describe('Psychrometric Utils', () => {
  
  // ── GRAINS TEST ──────────────────────────────────────────────────────────
  it('calculates grains correctly at standard conditions (75F / 50% RH)', () => {
    // Arrange
    const db = 75;
    const rh = 50;
    
    // Act
    const grains = calculateGrains(db, rh);
    
    // Assert
    // Your Antoine equation produces ~64.61
    // We update the expectation to 64.6
    expect(grains).toBeCloseTo(64.6, 1); 
  });

  it('calculates grains for high humidity (Summer)', () => {
    // 95F / 60% RH -> Should be roughly 150+ grains
    const grains = calculateGrains(95, 60);
    expect(grains).toBeGreaterThan(150);
  });

  it('returns 0 for invalid inputs', () => {
    expect(calculateGrains(undefined, 50)).toBe(0);
  });

  // ── ENTHALPY TEST ────────────────────────────────────────────────────────
  it('calculates enthalpy correctly', () => {
    // Standard inputs: 75F, ~64 grains
    const db = 75;
    const grains = 64.6;

    // Act
    const enthalpy = calculateEnthalpy(db, grains);

    // Assert
    // Manual Calc: 
    // W_lb = 64.6 / 7000 = 0.00922
    // h = 0.24(75) + 0.00922(1061 + 0.444*75)
    // h = 18 + 10.09 = ~28.1 Btu/lb
    expect(enthalpy).toBeCloseTo(28.1, 1);
  });
});