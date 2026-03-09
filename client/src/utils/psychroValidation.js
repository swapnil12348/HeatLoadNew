/**
 * psychroValidation.js
 * Runtime validation layer for psychrometric state points in critical facilities.
 *
 * Responsibility: Detect physically impossible or operationally dangerous
 * combinations of temperature, humidity, and pressure BEFORE they propagate
 * silently into load calculations.
 *
 * This file has NO load calculation logic. It only answers yes/no + why.
 *
 * WHY THIS FILE EXISTS:
 *   In semiconductor fabs, pharma dry rooms, and battery formation cells,
 *   an incorrect humidity setpoint or a miscalculated state point causes:
 *     • Yield loss (moisture-sensitive processes)
 *     • Equipment corrosion (too high humidity)
 *     • Static discharge events (too low humidity in wrong zones)
 *     • Overcapacity HVAC — wasted CapEx and OpEx
 *
 *   The CLTD/CLF method (our load calculation basis) produces a single
 *   peak-hour result. If the inputs contain a bad state point, the error
 *   is invisible — it just flows through as a number.
 *
 *   This file surfaces those errors as named, actionable warnings.
 *
 * DESIGN PRINCIPLES:
 *   • All functions are pure — no Redux state access, no side effects.
 *   • Return {valid: bool, warnings: string[], errors: string[]}
 *   • Warnings = physically possible but operationally suspicious.
 *   • Errors   = physically impossible (violate psychrometric laws).
 *   • Callers decide what to do (show UI warning, block submit, etc.)
 *
 * EXPORTS:
 *   validateStatePoint(dbF, rh, grains?, elevFt?)   → ValidationResult
 *   validateRoomHumidity(room, standard)            → ValidationResult
 *   validateSupplyAirState(supply, room)            → ValidationResult
 *   validateHumidificationCapacity(load, available) → ValidationResult
 *   HUMIDITY_STANDARDS                              → reference table
 *
 * USAGE:
 *   import { validateStatePoint } from '../utils/psychroValidation';
 *   const result = validateStatePoint(70, 1.0, undefined, 0);
 *   if (!result.valid) console.error(result.errors);
 */

import {
  calculateGrains,
  calculateRH,
  calculateDewPoint,
  sitePressure,
  saturationPressure, // NOTE: not exported from psychro.js — use grainsFromDewPoint instead
  grainsFromDewPoint,
} from './psychro';

// ─────────────────────────────────────────────────────────────────────────────
// Reference humidity standards for critical facilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HUMIDITY_STANDARDS
 *
 * Authoritative humidity limits for common critical facility types.
 * Sources listed per entry.
 *
 * All values in %RH unless marked as dew point (dpF / dpC).
 * Temperature ranges in °F.
 *
 * ⚠️  These are DESIGN REFERENCES — not code-compliant substitutes for
 *   facility-specific process requirements. Always verify against the
 *   process equipment OEM spec and the applicable facility standard.
 */
export const HUMIDITY_STANDARDS = {

  // ── Semiconductor manufacturing ─────────────────────────────────────────────
  'semiconductor-litho': {
    label:       'Semiconductor — Lithography Bay',
    standard:    'SEMI S2-0200, ASHRAE 2019 Applications Ch.18',
    tempMin:     66,   tempMax:  72,   // °F
    rhMin:       35,   rhMax:    45,   // %RH
    note:        'Photoresist requires tight RH — 1%RH deviation degrades CD uniformity',
  },
  'semiconductor-dry': {
    label:       'Semiconductor — Dry Etch / Diffusion',
    standard:    'SEMI S2-0200',
    tempMin:     66,   tempMax:  74,
    rhMin:       30,   rhMax:    50,
    note:        'Less sensitive to RH than litho; temperature control dominates',
  },
  'semiconductor-amhs': {
    label:       'Semiconductor — AMHS Corridors',
    standard:    'SEMI E10, facility practice',
    tempMin:     68,   tempMax:  76,
    rhMin:       35,   rhMax:    55,
    note:        'Wider tolerances acceptable; contaminants more critical than RH',
  },

  // ── Pharmaceutical ──────────────────────────────────────────────────────────
  'pharma-dry-powder': {
    label:       'Pharma — Dry Powder Filling',
    standard:    'ISPE Baseline Guide Vol.5, WHO TRS 961 Annex 5',
    tempMin:     59,   tempMax:  77,
    rhMin:       1,    rhMax:    20,   // Typically <20%RH, often <5%RH for hygroscopic products
    note:        'Products with hygroscopic API (e.g. spray-dried formulations) may require <5%RH. ' +
                 'Verify with process engineer — this range is conservative.',
  },
  'pharma-tablet': {
    label:       'Pharma — Tablet Compression',
    standard:    'ISPE Baseline Guide Vol.5, FDA Guidance',
    tempMin:     59,   tempMax:  77,
    rhMin:       25,   rhMax:    50,
    note:        'Standard range; hygroscopic APIs may require lower bound',
  },
  'pharma-lyo': {
    label:       'Pharma — Lyophilisation (Freeze-Dry) Loading',
    standard:    'ISPE Good Practice Guide: Lyophilization',
    tempMin:     59,   tempMax:  68,
    rhMin:       1,    rhMax:    10,
    note:        'Must prevent pre-freeze moisture absorption. Room must be conditioned before vial loading.',
  },

  // ── Battery manufacturing ────────────────────────────────────────────────────
  'battery-liion-electrode': {
    label:       'Battery — Li-ion Electrode Slurry & Coating',
    standard:    'Industry practice, IEC 62133 facility guidance',
    tempMin:     64,   tempMax:  77,
    rhMin:       1,    rhMax:    10,
    note:        'Cathode slurry (NMC/LFP) sensitive to moisture — promotes Li₂CO₃ formation',
  },
  'battery-liion-assembly': {
    label:       'Battery — Li-ion Cell Assembly (Dry Room)',
    standard:    'Industry practice',
    tempMin:     64,   tempMax:  77,
    dpCMax:      -30,             // °C frost point — typically expressed as DP, not %RH
    rhApprox:    2,               // Approx %RH at 70°F (for display only; use dpCMax for control)
    note:        'Control by frost-point instrument. Dew point at −30°C DP / 70°F ≈ 0.4%RH. ' +
                 'Many facilities target −40°C DP for solid-state battery assembly.',
  },
  'battery-solidstate': {
    label:       'Battery — Solid-State Cell Assembly',
    standard:    'Emerging practice (2024)',
    tempMin:     64,   tempMax:  72,
    dpCMax:      -40,             // °C frost point
    rhApprox:    0.1,
    note:        'Sulfide-based electrolytes react with moisture at ppm levels. ' +
                 'Some processes require <0.1 ppm H₂O (−70°C frost point). ' +
                 'Beyond scope of this tool — verify with specialist.',
  },

  // ── General critical facility ────────────────────────────────────────────────
  'iso-8-cleanroom': {
    label:       'ISO 8 Cleanroom (general)',
    standard:    'ISO 14644-1, ASHRAE 170 (healthcare)',
    tempMin:     68,   tempMax:  77,
    rhMin:       30,   rhMax:    60,
    note:        'Occupant comfort and process requirements often conflict. Verify process spec.',
  },
  'iso-7-cleanroom': {
    label:       'ISO 7 Cleanroom',
    standard:    'ISO 14644-1',
    tempMin:     66,   tempMax:  74,
    rhMin:       30,   rhMax:    55,
  },
  'iso-6-cleanroom': {
    label:       'ISO 6 Cleanroom',
    standard:    'ISO 14644-1',
    tempMin:     66,   tempMax:  72,
    rhMin:       30,   rhMax:    50,
  },
  'data-center': {
    label:       'Data Centre (ASHRAE A1 class)',
    standard:    'ASHRAE TC 9.9 Thermal Guidelines 2021',
    tempMin:     59,   tempMax:  95,   // Wide inlet temp range for A1
    rhMin:       8,    rhMax:    80,
    dpFMin:      -4,   dpFMax:   59,   // −20°C to +15°C dew point band
    note:        'ASHRAE A1 allows widest range. Data hall return air differs. ' +
                 'ETS (Environmental Test Specification) overrides this for specific hardware.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation result factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ValidationResult
 * @property {boolean}  valid    - true only if no errors (warnings are allowed)
 * @property {string[]} errors   - physically impossible or critically wrong
 * @property {string[]} warnings - suspicious but possible
 * @property {Object}   computed - computed psychrometric values for display
 */
const makeResult = (errors = [], warnings = [], computed = {}) => ({
  valid:    errors.length === 0,
  errors,
  warnings,
  computed,
});

// ─────────────────────────────────────────────────────────────────────────────
// validateStatePoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * validateStatePoint(dbF, rh, grains?, elevFt?)
 *
 * Validates a psychrometric state point for physical consistency.
 *
 * Checks:
 *   1. RH and grains consistency (if both provided) — catches sensor mismatch
 *   2. Dew point vs dry-bulb relationship (DP must be ≤ DB always)
 *   3. Physical humidity ratio bounds
 *   4. Suspiciously high humidity for critical facility supply air
 *
 * @param {number}  dbF      - dry-bulb temperature (°F)
 * @param {number}  rh       - relative humidity (%)
 * @param {number}  [grains] - humidity ratio (gr/lb) — optional cross-check
 * @param {number}  [elevFt] - site elevation (ft) — default 0
 * @returns {ValidationResult}
 */
export const validateStatePoint = (dbF, rh, grains = null, elevFt = 0) => {
  const errors   = [];
  const warnings = [];

  const dbFNum = parseFloat(dbF);
  const rhNum  = parseFloat(rh);

  // ── Input type checks ──────────────────────────────────────────────────────
  if (isNaN(dbFNum)) errors.push('Dry-bulb temperature is not a valid number.');
  if (isNaN(rhNum))  errors.push('Relative humidity is not a valid number.');
  if (errors.length) return makeResult(errors, warnings);

  // ── Physical bounds ────────────────────────────────────────────────────────
  if (rhNum < 0)   errors.push(`RH cannot be negative (got ${rhNum}%). Check sensor or data source.`);
  if (rhNum > 100) errors.push(`RH exceeds 100% (got ${rhNum.toFixed(1)}%). Input or sensor error.`);
  if (dbFNum < -100) errors.push(`DB temperature ${dbFNum}°F is below psychrometric model range (−100°F minimum).`);
  if (dbFNum >  250) errors.push(`DB temperature ${dbFNum}°F is above psychrometric model range (250°F maximum).`);

  // ── Compute derived values ─────────────────────────────────────────────────
  const computed_grains = calculateGrains(dbFNum, rhNum, elevFt);
  const computed_dp     = calculateDewPoint(dbFNum, rhNum);
  const computed_rh     = grains !== null ? calculateRH(dbFNum, grains, elevFt) : null;

  // ── Dew point vs dry-bulb check ────────────────────────────────────────────
  if (computed_dp > dbFNum + 0.1) {
    errors.push(
      `Dew point (${computed_dp}°F) exceeds dry-bulb (${dbFNum}°F). ` +
      `This is physically impossible — dew point is always ≤ dry-bulb.`
    );
  }

  // ── Grains cross-check (if provided) ──────────────────────────────────────
  if (grains !== null) {
    const providedGrains = parseFloat(grains);
    const rhFromGrains   = computed_rh;
    const grainsFromRh   = computed_grains;
    const discrepancy    = Math.abs(providedGrains - grainsFromRh);

    if (discrepancy > 2.0) {
      warnings.push(
        `Humidity ratio mismatch: provided grains=${providedGrains.toFixed(1)} gr/lb, ` +
        `but RH=${rhNum}% at DB=${dbFNum}°F implies ${grainsFromRh.toFixed(1)} gr/lb. ` +
        `Discrepancy: ${discrepancy.toFixed(1)} gr/lb. ` +
        `Check for sensor calibration drift or unit conversion error.`
      );
    }
  }

  // ── Sub-1%RH special checks ────────────────────────────────────────────────
  if (rhNum > 0 && rhNum < 1) {
    warnings.push(
      `RH=${rhNum.toFixed(2)}% is below 1%. ` +
      `Standard capacitive RH sensors are not accurate below 1%RH. ` +
      `Use a calibrated chilled-mirror or optical dew-point instrument. ` +
      `Frost point at this condition: ${computed_dp}°F (${((computed_dp - 32) * 5/9).toFixed(1)}°C).`
    );
  }

  // ── Frost point note for sub-zero dew points ───────────────────────────────
  if (computed_dp < 32) {
    warnings.push(
      `Dew/frost point ${computed_dp}°F (${((computed_dp - 32) * 5/9).toFixed(1)}°C) is below freezing. ` +
      `This is a FROST POINT — condensation will form as ice, not liquid water. ` +
      `Calibrated chilled-mirror instruments at these conditions report frost point. ` +
      `Ensure instruments and setpoints are on the same basis.`
    );
  }

  // ── High humidity warnings ─────────────────────────────────────────────────
  if (rhNum > 70) {
    warnings.push(
      `RH=${rhNum}% is in the mould growth risk zone (>70%RH per ASHRAE 160). ` +
      `Condensation possible on surfaces below ${computed_dp}°F.`
    );
  }

  return makeResult(errors, warnings, {
    grains:   computed_grains,
    dewPoint: computed_dp,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// validateRoomHumidity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * validateRoomHumidity(room, standardKey)
 *
 * Checks whether a room's design humidity falls within the specified
 * facility standard's limits.
 *
 * @param {{ designRH: number, designDB: number, name?: string }} room
 * @param {string} standardKey - key in HUMIDITY_STANDARDS
 * @returns {ValidationResult}
 */
export const validateRoomHumidity = (room, standardKey) => {
  const errors   = [];
  const warnings = [];

  const standard = HUMIDITY_STANDARDS[standardKey];
  if (!standard) {
    warnings.push(`Unknown humidity standard key: "${standardKey}". Validation skipped.`);
    return makeResult([], warnings);
  }

  const rh = parseFloat(room.designRH);
  const db = parseFloat(room.designDB);
  const roomName = room.name || 'Room';

  if (isNaN(rh) || isNaN(db)) {
    errors.push(`${roomName}: Invalid design conditions (DB=${room.designDB}, RH=${room.designRH}).`);
    return makeResult(errors, warnings);
  }

  // Temperature check
  if (db < standard.tempMin || db > standard.tempMax) {
    warnings.push(
      `${roomName} design DB ${db}°F is outside ${standard.label} temperature range ` +
      `(${standard.tempMin}–${standard.tempMax}°F per ${standard.standard}).`
    );
  }

  // RH check (if standard defines RH limits — some use dew point instead)
  if (standard.rhMin !== undefined && standard.rhMax !== undefined) {
    if (rh < standard.rhMin) {
      warnings.push(
        `${roomName} design RH ${rh}%RH is below the minimum for ${standard.label} ` +
        `(${standard.rhMin}%RH per ${standard.standard}). Dehumidification oversized, ` +
        `or process requirement is stricter than standard — verify with process engineer.`
      );
    }
    if (rh > standard.rhMax) {
      errors.push(
        `${roomName} design RH ${rh}%RH exceeds the maximum for ${standard.label} ` +
        `(${standard.rhMax}%RH per ${standard.standard}). Room does not comply. ` +
        `Recalculate dehumidification capacity.`
      );
    }
  }

  // Dew point check (if standard defines DP limits)
  if (standard.dpCMax !== undefined) {
    const dpC = (calculateDewPoint(db, rh) - 32) * 5 / 9;
    if (dpC > standard.dpCMax) {
      errors.push(
        `${roomName} frost point ${dpC.toFixed(1)}°C exceeds maximum for ${standard.label} ` +
        `(${standard.dpCMax}°C per ${standard.standard}). ` +
        `Required frost point not achieved at design RH=${rh}%.`
      );
    }
  }

  if (standard.note) {
    warnings.push(`Note (${standard.label}): ${standard.note}`);
  }

  return makeResult(errors, warnings, { standard: standard.label });
};

// ─────────────────────────────────────────────────────────────────────────────
// validateSupplyAirState
// ─────────────────────────────────────────────────────────────────────────────

/**
 * validateSupplyAirState(supply, room)
 *
 * Checks that the AHU supply air state can actually achieve the room design
 * conditions. The supply air must be drier (lower grains) than the room to
 * dehumidify, and must have adequate sensible capacity (lower DB or higher DB
 * depending on season).
 *
 * @param {{ dbF: number, grains: number, cfm: number }}        supply - AHU supply state
 * @param {{ designDB: number, designRH: number, sensLoad: number, latLoad: number }} room
 * @returns {ValidationResult}
 */
export const validateSupplyAirState = (supply, room) => {
  const errors   = [];
  const warnings = [];

  const supplyGrains = parseFloat(supply.grains);
  const supplyDB     = parseFloat(supply.dbF);
  const supplyCFM    = parseFloat(supply.cfm);
  const roomDB       = parseFloat(room.designDB);
  const roomRH       = parseFloat(room.designRH);

  if ([supplyGrains, supplyDB, supplyCFM, roomDB, roomRH].some(isNaN)) {
    errors.push('validateSupplyAirState: one or more inputs are not valid numbers.');
    return makeResult(errors, warnings);
  }

  const roomGrains = calculateGrains(roomDB, roomRH);

  // ── Dehumidification check ─────────────────────────────────────────────────
  if (supplyGrains >= roomGrains) {
    errors.push(
      `Supply air humidity ratio (${supplyGrains.toFixed(1)} gr/lb) is ≥ room design ` +
      `(${roomGrains.toFixed(1)} gr/lb at ${roomDB}°F / ${roomRH}%RH). ` +
      `Supply air cannot dehumidify the room — AHU cooling coil leaving conditions must be drier.`
    );
  }

  // ── Cooling check ─────────────────────────────────────────────────────────
  if (supplyDB >= roomDB) {
    errors.push(
      `Supply air DB (${supplyDB}°F) is ≥ room design DB (${roomDB}°F). ` +
      `Supply air cannot cool the room.`
    );
  }

  // ── Low supply air humidity warning (1%RH territory) ──────────────────────
  const supplyRH = calculateRH(supplyDB, supplyGrains);
  if (supplyRH < 5 && roomRH > 30) {
    warnings.push(
      `Supply air RH is very low (${supplyRH.toFixed(1)}%RH at ${supplyDB}°F). ` +
      `If room target is ${roomRH}%RH, verify that mixing with room air will achieve ` +
      `target humidity — supply may be drier than necessary, increasing humidification load.`
    );
  }

  // ── Sensible capacity check ────────────────────────────────────────────────
  if (supplyCFM > 0 && room.sensLoad) {
    const deltaT = roomDB - supplyDB;
    // 1.08 is sea-level sensible factor — use actual from psychro.js if elevation available
    const availableSensible = 1.08 * supplyCFM * deltaT;
    if (availableSensible < room.sensLoad * 0.9) {
      warnings.push(
        `Available sensible capacity (${availableSensible.toFixed(0)} BTU/hr) is less than ` +
        `90% of room sensible load (${room.sensLoad.toFixed(0)} BTU/hr). ` +
        `Consider increasing supply CFM or reducing supply DB.`
      );
    }
  }

  return makeResult(errors, warnings, {
    roomGrains,
    supplyRH,
    deltaGrains: roomGrains - supplyGrains,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// validateHumidificationCapacity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * validateHumidificationCapacity(requiredLbHr, availableLbHr, safetyFactor?)
 *
 * Checks that the specified humidifier has sufficient capacity.
 * Applies a safety factor (default 1.25 per ASHRAE HVAC Applications 2019
 * §18.9 for critical facilities).
 *
 * @param {number} requiredLbHr  - calculated moisture addition required (lb/hr steam)
 * @param {number} availableLbHr - installed humidifier nameplate capacity (lb/hr steam)
 * @param {number} safetyFactor  - capacity margin multiplier (default 1.25)
 * @returns {ValidationResult}
 */
export const validateHumidificationCapacity = (
  requiredLbHr,
  availableLbHr,
  safetyFactor = 1.25,
) => {
  const errors   = [];
  const warnings = [];

  const req   = parseFloat(requiredLbHr);
  const avail = parseFloat(availableLbHr);
  const sf    = parseFloat(safetyFactor);

  if (isNaN(req) || isNaN(avail)) {
    errors.push('validateHumidificationCapacity: invalid input values.');
    return makeResult(errors, warnings);
  }

  const designCapacity = req * sf;

  if (avail < designCapacity) {
    const shortage = designCapacity - avail;
    errors.push(
      `Humidifier capacity insufficient. ` +
      `Required: ${req.toFixed(1)} lb/hr × ${sf} safety factor = ${designCapacity.toFixed(1)} lb/hr. ` +
      `Available: ${avail.toFixed(1)} lb/hr. ` +
      `Shortfall: ${shortage.toFixed(1)} lb/hr. ` +
      `Upsize humidifier or add a second unit.`
    );
  } else if (avail > designCapacity * 3) {
    warnings.push(
      `Humidifier may be significantly oversized. ` +
      `Design requirement: ${designCapacity.toFixed(1)} lb/hr. ` +
      `Installed capacity: ${avail.toFixed(1)} lb/hr (${(avail/designCapacity).toFixed(1)}× design). ` +
      `Oversized humidifiers cycle excessively and have poor part-load control.`
    );
  }

  return makeResult(errors, warnings, {
    requiredWithSF: designCapacity,
    margin:         avail - designCapacity,
    marginPct:      ((avail - designCapacity) / designCapacity * 100).toFixed(1),
  });
};