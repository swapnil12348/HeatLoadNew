/**
 * psychroValidation.js
 * Runtime validation layer for psychrometric state points in critical facilities.
 *
 * CHANGELOG v2.3:
 *
 *   FIX-PVAL-DB-01 — validateRoomHumidity(): designDB fallback + NaN guard.
 *
 *     Two related bugs fixed together:
 *
 *     BUG A — Missing designDB field:
 *       roomSlice stored only designTemp (°C). validateRoomHumidity read
 *       room.designDB (°F), which was always undefined → parseFloat(undefined)
 *       = NaN → the isNaN(db) guard fired immediately, returning an
 *       'Invalid design conditions' error before any humidity check ran.
 *       Every room failed humidity validation unconditionally.
 *
 *       Primary fix: roomSlice.js now derives and stores designDB (°F) from
 *       designTemp (°C) and keeps it in sync via updateRoom().
 *
 *       Secondary fix here: if designDB is still absent (legacy persisted
 *       state, unit tests that don't include designDB), fall back to converting
 *       room.designTemp (°C) to °F. This makes validateRoomHumidity robust
 *       against incomplete room objects regardless of roomSlice version.
 *
 *     BUG B — calculateDewPoint(NaN, rh) returns 0 (not null):
 *       psychro.js calculateDewPoint() returns 0 for non-numeric input (legacy-safe).
 *       If Bug A occurred, db = NaN → calculateDewPoint returned 0 → dpC = −17.8°C
 *       → compared against dpCMax = −40 → false positives for every dry room.
 *
 *       Fix: the rawDB derivation ensures db is always a valid number before
 *       calculateDewPoint is called. An explicit NaN check on db before
 *       calculateDewPoint is added as secondary belt-and-suspenders protection.
 *
 * CHANGELOG v2.2:
 *
 *   BUG-TIER1-02 — validateSupplyAirState(): elevFt now passed to
 *   calculateGrains() and calculateRH().
 *
 * CHANGELOG v2.1:
 *
 *   CRITICAL-01 — Removed import of saturationPressure from psychro.js.
 *   HIGH-05     — HUMIDITY_STANDARDS updated for current industry practice.
 *   MEDIUM-01   — validateSupplyAirState() now accepts elevFt parameter.
 *   MEDIUM-02 (in psychro.js) — calculateDewPoint returns null for out-of-range.
 */

import {
  calculateGrains,
  calculateRH,
  calculateDewPoint,
  sitePressure,
  grainsFromDewPoint,
  sensibleFactor,
} from './psychro';

// ─────────────────────────────────────────────────────────────────────────────
// Reference humidity standards for critical facilities
// ─────────────────────────────────────────────────────────────────────────────

export const HUMIDITY_STANDARDS = {

  'semiconductor-litho': {
    label:    'Semiconductor — Lithography Bay',
    standard: 'SEMI S2-0200, ASHRAE 2019 Applications Ch.18',
    tempMin:  66, tempMax: 72,
    rhMin:    35, rhMax:   45,
    note:     'Photoresist requires tight RH — 1%RH deviation degrades CD uniformity',
  },
  'semiconductor-dry': {
    label:    'Semiconductor — Dry Etch / Diffusion',
    standard: 'SEMI S2-0200',
    tempMin:  66, tempMax: 74,
    rhMin:    30, rhMax:   50,
    note:     'Less sensitive to RH than litho; temperature control dominates',
  },
  'semiconductor-amhs': {
    label:    'Semiconductor — AMHS Corridors',
    standard: 'SEMI E10, facility practice',
    tempMin:  68, tempMax: 76,
    rhMin:    35, rhMax:   55,
    note:     'Wider tolerances acceptable; contaminants more critical than RH',
  },
  'pharma-dry-powder': {
    label:    'Pharma — Dry Powder Filling',
    standard: 'ISPE Baseline Guide Vol.5, WHO TRS 961 Annex 5',
    tempMin:  59, tempMax: 77,
    rhMin:    1,  rhMax:   20,
    note:     'Products with hygroscopic API may require <5%RH. Verify with process engineer.',
  },
  'pharma-tablet': {
    label:    'Pharma — Tablet Compression',
    standard: 'ISPE Baseline Guide Vol.5, FDA Guidance',
    tempMin:  59, tempMax: 77,
    rhMin:    25, rhMax:   50,
    note:     'Standard range; hygroscopic APIs may require lower bound',
  },
  'pharma-lyo': {
    label:    'Pharma — Lyophilisation (Freeze-Dry) Loading',
    standard: 'ISPE Good Practice Guide: Lyophilization',
    tempMin:  59, tempMax: 68,
    rhMin:    1,  rhMax:   10,
    note:     'Must prevent pre-freeze moisture absorption.',
  },
  'battery-liion-electrode': {
    label:    'Battery — Li-ion Electrode Slurry & Coating',
    standard: 'Industry practice, IEC 62133 facility guidance',
    tempMin:  64, tempMax: 77,
    rhMin:    1,  rhMax:   10,
    note:     'Cathode slurry (NMC/LFP) sensitive to moisture',
  },
  'battery-liion-assembly': {
    label:    'Battery — Li-ion Cell Assembly (Dry Room)',
    standard: 'Industry practice (CATL/Panasonic/Samsung SDI, 2024)',
    tempMin:  64, tempMax: 77,
    dpCMax:   -40,
    rhApprox: 0.4,
    note:     'Control by frost-point instrument (chilled mirror). '
            + 'Standard Li-ion: −40°C DP / 70°F ≈ 0.4%RH.',
  },
  'battery-solidstate': {
    label:    'Battery — Solid-State Cell Assembly',
    standard: 'Emerging practice (2024)',
    tempMin:  64, tempMax: 72,
    dpCMax:   -40,
    rhApprox: 0.1,
    note:     'Sulfide-based electrolytes react with moisture at ppm levels.',
  },
  'battery-leadacid': {
    label:    'Battery — Lead-Acid Formation / Charging (Exide / EnerSys)',
    standard: 'OSHA 29 CFR 1926.403(i), IEEE 1184-2006, NFPA 70 Art.480',
    tempMin:  60, tempMax: 90,
    rhMin:    10, rhMax:   70,
    note:     'H₂ evolution during formation charging requires minimum 1 CFM/ft² supply. '
            + 'Do NOT use desiccant dehumidification — sub-10%RH is not required.',
  },
  'iso-8-cleanroom': {
    label:    'ISO 8 Cleanroom (general)',
    standard: 'ISO 14644-1, ASHRAE 170',
    tempMin:  68, tempMax: 77,
    rhMin:    30, rhMax:   60,
    note:     'Occupant comfort and process requirements often conflict.',
  },
  'iso-7-cleanroom': {
    label:    'ISO 7 Cleanroom',
    standard: 'ISO 14644-1',
    tempMin:  66, tempMax: 74,
    rhMin:    30, rhMax:   55,
  },
  'iso-6-cleanroom': {
    label:    'ISO 6 Cleanroom',
    standard: 'ISO 14644-1',
    tempMin:  66, tempMax: 72,
    rhMin:    30, rhMax:   50,
  },
  'data-center': {
    label:    'Data Centre (ASHRAE A1 class)',
    standard: 'ASHRAE TC 9.9 Thermal Guidelines 2021',
    tempMin:  59, tempMax: 95,
    rhMin:    8,  rhMax:   80,
    dpFMin:   -4, dpFMax:  59,
    note:     'ASHRAE A1 allows widest range.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation result factory
// ─────────────────────────────────────────────────────────────────────────────

const makeResult = (errors = [], warnings = [], computed = {}) => ({
  valid:    errors.length === 0,
  errors,
  warnings,
  computed,
});

// ─────────────────────────────────────────────────────────────────────────────
// validateStatePoint
// ─────────────────────────────────────────────────────────────────────────────

export const validateStatePoint = (dbF, rh, grains = null, elevFt = 0) => {
  const errors   = [];
  const warnings = [];

  const dbFNum = parseFloat(dbF);
  const rhNum  = parseFloat(rh);

  if (isNaN(dbFNum)) errors.push('Dry-bulb temperature is not a valid number.');
  if (isNaN(rhNum))  errors.push('Relative humidity is not a valid number.');
  if (errors.length) return makeResult(errors, warnings);

  if (rhNum < 0)     errors.push(`RH cannot be negative (got ${rhNum}%).`);
  if (rhNum > 100)   errors.push(`RH exceeds 100% (got ${rhNum.toFixed(1)}%).`);
  if (dbFNum < -100) errors.push(`DB temperature ${dbFNum}°F is below psychrometric model range.`);
  if (dbFNum >  250) errors.push(`DB temperature ${dbFNum}°F is above psychrometric model range.`);

  const computed_grains = calculateGrains(dbFNum, rhNum, elevFt);

  const computed_dp = calculateDewPoint(dbFNum, rhNum);
  if (computed_dp === null) {
    warnings.push(
      `Frost point is below −100°C or RH is 0% (beyond model range). ` +
      `RH=${rhNum.toFixed(3)}% at DB=${dbFNum}°F. Use a specialist desiccant tool.`
    );
    return makeResult(errors, warnings, { grains: computed_grains, dewPoint: null });
  }

  if (computed_dp > dbFNum + 0.1) {
    errors.push(`Dew point (${computed_dp}°F) exceeds dry-bulb (${dbFNum}°F). Physically impossible.`);
  }

  const computed_rh = grains !== null ? calculateRH(dbFNum, grains, elevFt) : null;

  if (grains !== null) {
    const providedGrains = parseFloat(grains);
    const grainsFromRh   = computed_grains;
    const discrepancy    = Math.abs(providedGrains - grainsFromRh);

    if (discrepancy > 2.0) {
      warnings.push(
        `Humidity ratio mismatch: provided ${providedGrains.toFixed(1)} gr/lb, ` +
        `but RH=${rhNum}% at ${dbFNum}°F implies ${grainsFromRh.toFixed(1)} gr/lb. ` +
        `Discrepancy: ${discrepancy.toFixed(1)} gr/lb.`
      );
    }
  }

  if (rhNum > 0 && rhNum < 1) {
    warnings.push(
      `RH=${rhNum.toFixed(2)}% is below 1%. Use a calibrated chilled-mirror instrument. ` +
      `Frost point: ${computed_dp}°F (${((computed_dp - 32) * 5/9).toFixed(1)}°C).`
    );
  }

  if (computed_dp < 32) {
    warnings.push(
      `Dew/frost point ${computed_dp}°F (${((computed_dp - 32) * 5/9).toFixed(1)}°C) ` +
      `is below freezing — this is a FROST POINT.`
    );
  }

  if (rhNum > 70) {
    warnings.push(
      `RH=${rhNum}% is in the mould growth risk zone (>70%RH per ASHRAE 160).`
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
 * roomSlice v2.1+ stores designDB (°F) derived from designTemp (°C).
 * For legacy persisted state or unit tests that omit designDB, falls back
 * to converting room.designTemp (°C) → °F automatically.
 *
 * Without this fallback, parseFloat(undefined) = NaN causes the isNaN guard
 * to fire before any humidity check runs, producing a misleading
 * 'Invalid design conditions' error for every room.
 */
export const validateRoomHumidity = (room, standardKey) => {
  const errors   = [];
  const warnings = [];

  const standard = HUMIDITY_STANDARDS[standardKey];
  if (!standard) {
    warnings.push(`Unknown humidity standard key: "${standardKey}". Validation skipped.`);
    return makeResult([], warnings);
  }

  const rh       = parseFloat(room.designRH);
  const roomName = room.name || 'Room';

  // Accept designDB (°F) first; fall back to converting designTemp (°C).
  // Conversion: designTemp × 9/5 + 32 (exact per ASHRAE IP units).
  const rawDB = room.designDB != null
    ? parseFloat(room.designDB)
    : room.designTemp != null
      ? parseFloat(room.designTemp) * 9 / 5 + 32
      : NaN;
  const db = rawDB;

  if (isNaN(rh) || isNaN(db)) {
    errors.push(
      `${roomName}: Invalid design conditions ` +
      `(DB=${room.designDB ?? room.designTemp ?? 'missing'}, RH=${room.designRH}). ` +
      `Ensure designTemp (°C) or designDB (°F) and designRH (%) are set.`
    );
    return makeResult(errors, warnings);
  }

  if (db < standard.tempMin || db > standard.tempMax) {
    warnings.push(
      `${roomName} design DB ${db.toFixed(1)}°F is outside ${standard.label} temperature range ` +
      `(${standard.tempMin}–${standard.tempMax}°F per ${standard.standard}).`
    );
  }

  if (standard.rhMin !== undefined && standard.rhMax !== undefined) {
    if (rh < standard.rhMin) {
      warnings.push(
        `${roomName} design RH ${rh}%RH is below the minimum for ${standard.label} ` +
        `(${standard.rhMin}%RH). Verify with process engineer.`
      );
    }
    if (rh > standard.rhMax) {
      errors.push(
        `${roomName} design RH ${rh}%RH exceeds maximum for ${standard.label} ` +
        `(${standard.rhMax}%RH). Room does not comply.`
      );
    }
  }

  if (standard.dpCMax !== undefined) {
    // db is guaranteed valid at this point (isNaN guard above).
    // Secondary belt-and-suspenders: calculateDewPoint(NaN, rh) returns 0,
    // not null — the explicit isNaN(db) check prevents that path.
    if (isNaN(db)) {
      warnings.push(
        `${roomName}: cannot validate frost point — design DB temperature is invalid.`
      );
    } else {
      const dpRaw = calculateDewPoint(db, rh);
      if (dpRaw === null) {
        warnings.push(
          `${roomName}: frost point is below −100°C or RH is 0% (beyond model range). ` +
          `Cannot validate against dpCMax=${standard.dpCMax}°C. Use specialist tool.`
        );
      } else {
        const dpC = (dpRaw - 32) * 5 / 9;
        if (dpC > standard.dpCMax) {
          errors.push(
            `${roomName} frost point ${dpC.toFixed(1)}°C exceeds maximum for ${standard.label} ` +
            `(${standard.dpCMax}°C). Required frost point not achieved at RH=${rh}%.`
          );
        }
      }
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
 * validateSupplyAirState(supply, room, elevFt?)
 *
 * elevFt passed to calculateGrains() and calculateRH() for altitude correction.
 * sensibleFactor(elevFt) replaces hardcoded 1.08.
 * Mirrors the designDB fallback from validateRoomHumidity for legacy room objects.
 */
export const validateSupplyAirState = (supply, room, elevFt = 0) => {
  const errors   = [];
  const warnings = [];

  const supplyGrains = parseFloat(supply.grains);
  const supplyDB     = parseFloat(supply.dbF);
  const supplyCFM    = parseFloat(supply.cfm);

  // Accept designDB (°F) first; fall back to converting designTemp (°C).
  const rawRoomDB = room.designDB != null
    ? parseFloat(room.designDB)
    : room.designTemp != null
      ? parseFloat(room.designTemp) * 9 / 5 + 32
      : NaN;
  const roomDB = rawRoomDB;
  const roomRH = parseFloat(room.designRH);

  if ([supplyGrains, supplyDB, supplyCFM, roomDB, roomRH].some(isNaN)) {
    errors.push('validateSupplyAirState: one or more inputs are not valid numbers.');
    return makeResult(errors, warnings);
  }

  const roomGrains = calculateGrains(roomDB, roomRH, elevFt);

  if (supplyGrains >= roomGrains) {
    errors.push(
      `Supply air humidity ratio (${supplyGrains.toFixed(1)} gr/lb) is ≥ room design ` +
      `(${roomGrains.toFixed(1)} gr/lb at ${roomDB}°F / ${roomRH}%RH). ` +
      `Supply air cannot dehumidify the room.`
    );
  }

  if (supplyDB >= roomDB) {
    errors.push(
      `Supply air DB (${supplyDB}°F) is ≥ room design DB (${roomDB}°F). Supply air cannot cool the room.`
    );
  }

  const supplyRH = calculateRH(supplyDB, supplyGrains, elevFt);

  if (supplyRH < 5 && roomRH > 30) {
    warnings.push(
      `Supply air RH is very low (${supplyRH.toFixed(1)}%RH at ${supplyDB}°F). ` +
      `Verify mixing will achieve target humidity of ${roomRH}%RH.`
    );
  }

  if (supplyCFM > 0 && room.sensLoad) {
    const deltaT = roomDB - supplyDB;
    const sf     = sensibleFactor(elevFt);
    const availableSensible = sf * supplyCFM * deltaT;
    if (availableSensible < room.sensLoad * 0.9) {
      warnings.push(
        `Available sensible capacity (${availableSensible.toFixed(0)} BTU/hr) ` +
        `[at elev=${elevFt}ft, sf=${sf.toFixed(3)}] is less than 90% of room sensible load ` +
        `(${room.sensLoad.toFixed(0)} BTU/hr).`
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
      `Available: ${avail.toFixed(1)} lb/hr. Shortfall: ${shortage.toFixed(1)} lb/hr.`
    );
  } else if (avail > designCapacity * 3) {
    warnings.push(
      `Humidifier may be significantly oversized. ` +
      `Design requirement: ${designCapacity.toFixed(1)} lb/hr. ` +
      `Installed capacity: ${avail.toFixed(1)} lb/hr (${(avail/designCapacity).toFixed(1)}× design).`
    );
  }

  return makeResult(errors, warnings, {
    requiredWithSF: designCapacity,
    margin:         avail - designCapacity,
    marginPct:      ((avail - designCapacity) / designCapacity * 100).toFixed(1),
  });
};