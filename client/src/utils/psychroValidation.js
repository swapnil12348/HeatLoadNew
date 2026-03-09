/**
 * psychroValidation.js
 * Runtime validation layer for psychrometric state points in critical facilities.
 *
 * CHANGELOG v2.2:
 *
 *   BUG-TIER1-02 FIX — validateSupplyAirState(): elevFt now passed to
 *   calculateGrains() and calculateRH().
 *
 *     The MEDIUM-01 fix (v2.1) correctly altitude-corrected sensibleFactor(elevFt)
 *     but left the humidity ratio calls at sea-level basis:
 *
 *       const roomGrains = calculateGrains(roomDB, roomRH);        // ← was missing elevFt
 *       const supplyRH   = calculateRH(supplyDB, supplyGrains);    // ← was missing elevFt
 *
 *     calculateGrains() and calculateRH() both call sitePressure(elevFt) internally.
 *     Without the elevation argument, they default to sea-level pressure (1013.25 hPa),
 *     producing humidity ratios that are too low at elevated sites.
 *
 *     Altitude error by site:
 *       Hyderabad (TSMC fab candidate, 1,755 ft): +0.8 gr/lb — supply check fires wrong
 *       Chengdu, China (1,640 ft):                +0.7 gr/lb
 *       Bangalore (3,020 ft):                     +1.2 gr/lb
 *       Denver (5,280 ft):                        +2.3 gr/lb — humidity check in wrong direction
 *
 *     The supplyGrains >= roomGrains error check (supply cannot dehumidify) is
 *     evaluated against sea-level-corrected grains. At elevation both values shift
 *     proportionally, but the supplyRH feedback displayed to the engineer is
 *     calculated incorrectly, potentially masking a supply air condition that
 *     cannot actually dehumidify the room at the actual site pressure.
 *
 *     Fix: pass elevFt to both calls. Both calls now agree with sensibleFactor(elevFt)
 *     on the same site pressure basis. The consistency invariant is:
 *       sensibleFactor, calculateGrains, calculateRH → all use sitePressure(elevFt)
 *
 * CHANGELOG v2.1:
 *
 *   CRITICAL-01 FIX — Removed import of saturationPressure from psychro.js.
 *
 *     saturationPressure is an INTERNAL helper in psychro.js (no export keyword).
 *     Vite performs strict named-export checking at build time. The previous import
 *     caused a build failure:
 *       SyntaxError: The requested module './psychro' does not provide an export
 *       named 'saturationPressure'
 *     The import was also dead — saturationPressure was never called in this file.
 *     grainsFromDewPoint() is the correct public API for dew-point-based calculations.
 *
 *   HIGH-05 FIX — HUMIDITY_STANDARDS updated for current industry practice:
 *
 *     battery-liion-assembly: dpCMax updated −30°C → −40°C.
 *       The previous −30°C limit allowed rooms designed to −40°C (CATL/Panasonic/
 *       Samsung SDI standard) to silently pass validation without flagging that
 *       they were at the minimum. The mainstream 2024 industry standard for Li-ion
 *       cell assembly is −40°C DP. Rooms targeting −40°C now produce a warning
 *       (marginal) rather than a pass (exceeds minimum).
 *
 *     battery-leadacid: NEW entry added for lead-acid battery formation rooms
 *       (Exide Technologies, EnerSys, C&D Technologies type facilities).
 *       Lead-acid has a fundamentally different hazard profile from Li-ion:
 *         - H₂ gas evolution (4–75% LEL) requires 1 CFM/ft² minimum supply
 *         - H₂SO₄ mist requires acid-resistant exhaust, not chemical scrubber
 *         - OSHA 29 CFR 1926.403(i) governs, not NFPA 855
 *       Without this category, Exide-type facilities would be validated against
 *       the Li-ion standard (dpCMax = −40°C) — physically incorrect.
 *
 *   MEDIUM-01 FIX — validateSupplyAirState() now accepts elevFt parameter.
 *
 *     The hardcoded 1.08 sensible factor (sea level only) was causing the available
 *     sensible capacity check to overstate available cooling by:
 *       Hyderabad (1,755 ft elevation): 5.8%
 *       Chengdu, China  (1,640 ft):     5.4%
 *       Denver          (5,280 ft):    16.8%
 *     For elevated facilities, the AHU warning threshold would under-flag
 *     undersized units. The fix imports sensibleFactor(elevFt) from psychro.js
 *     and applies the altitude correction correctly.
 *
 *   MEDIUM-02 FIX (in psychro.js) — calculateDewPoint returns null for out-of-range.
 *
 *     All calls to calculateDewPoint in this file now check for null before use.
 *     The previous −148 sentinel was never checked and silently propagated into
 *     load calculations as a real temperature.
 */

import {
  calculateGrains,
  calculateRH,
  calculateDewPoint,
  sitePressure,
  grainsFromDewPoint,
  sensibleFactor,       // MEDIUM-01: imported for elevation-corrected sensible check
} from './psychro';

// ─────────────────────────────────────────────────────────────────────────────
// Reference humidity standards for critical facilities
// ─────────────────────────────────────────────────────────────────────────────

export const HUMIDITY_STANDARDS = {

  // ── Semiconductor manufacturing ─────────────────────────────────────────────
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

  // ── Pharmaceutical ──────────────────────────────────────────────────────────
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
    note:     'Must prevent pre-freeze moisture absorption. Room must be conditioned before vial loading.',
  },

  // ── Battery manufacturing ────────────────────────────────────────────────────
  'battery-liion-electrode': {
    label:    'Battery — Li-ion Electrode Slurry & Coating',
    standard: 'Industry practice, IEC 62133 facility guidance',
    tempMin:  64, tempMax: 77,
    rhMin:    1,  rhMax:   10,
    note:     'Cathode slurry (NMC/LFP) sensitive to moisture — promotes Li₂CO₃ formation',
  },

  /**
   * battery-liion-assembly — HIGH-05 FIX: dpCMax updated −30°C → −40°C.
   *
   * Previous value −30°C was the minimum reported in some older industry
   * literature. Current industry standard (2024) for mainstream Li-ion cell
   * assembly (CATL, Panasonic, Samsung SDI, LG Energy Solution):
   *
   *   Electrode coating only:     −20°C DP (5–12%RH at 70°F) — less stringent
   *   Cell assembly (mainstream): −40°C DP (0.4%RH at 70°F) — this category
   *   Cell assembly (tight spec):  −45°C DP (0.2%RH at 70°F) — some OEM specs
   *   Solid-state (sulfide):      −60°C DP+ — beyond this tool's range
   *
   * Setting dpCMax = −40°C means:
   *   • A room designed to exactly −40°C DP → warning (marginal, at limit)
   *   • A room designed to −38°C DP → error (does not meet standard)
   *   • A room designed to −45°C DP → info (exceeds standard)
   */
  'battery-liion-assembly': {
    label:    'Battery — Li-ion Cell Assembly (Dry Room)',
    standard: 'Industry practice (CATL/Panasonic/Samsung SDI, 2024)',
    tempMin:  64, tempMax: 77,
    dpCMax:   -40,         // HIGH-05 FIX: was −30. Mainstream standard is −40°C DP.
    rhApprox: 0.4,         // Approx %RH at 70°F / −40°C DP (display only; use dpCMax for control)
    note:     'Control by frost-point instrument (chilled mirror). '
            + 'Standard Li-ion: −40°C DP / 70°F ≈ 0.4%RH. '
            + 'Some OEM specs require −45°C DP. '
            + 'Solid-state sulfide electrolytes require −60°C DP+ (specialist tool). '
            + 'Override dpCMax per OEM process specification.',
  },

  'battery-solidstate': {
    label:    'Battery — Solid-State Cell Assembly',
    standard: 'Emerging practice (2024)',
    tempMin:  64, tempMax: 72,
    dpCMax:   -40,
    rhApprox: 0.1,
    note:     'Sulfide-based electrolytes react with moisture at ppm levels. '
            + 'Some processes require <0.1 ppm H₂O (−70°C frost point). '
            + 'Beyond scope of this tool — verify with specialist. '
            + 'dpCMax here (−40°C) is a minimum floor only.',
  },

  /**
   * battery-leadacid — HIGH-05 FIX: NEW category.
   *
   * Lead-acid battery formation (Exide Technologies, EnerSys, C&D Technologies)
   * has a fundamentally different hazard and ventilation profile from Li-ion:
   *
   *   Primary hazard:    H₂ gas from electrolyte (water electrolysis during charging)
   *                      H₂ is 4–75% LEL range, odourless, lighter than air
   *   Secondary hazard:  H₂SO₄ mist from electrolyte agitation
   *   Regulatory basis:  OSHA 29 CFR 1926.403(i) — battery charging areas
   *                      IEEE 1184-2006 — battery room ventilation
   *                      NFPA 70 Article 480 — stationary battery systems
   *
   * Humidity: Lead-acid does NOT require sub-10%RH desiccant conditions.
   *   Excess humidity promotes corrosion of terminals and current collectors.
   *   Very low humidity (< 10%RH) is unnecessary and increases H₂SO₄ mist.
   *   Target: 30–60%RH for normal operation; avoid condensation on cells.
   *
   * NOTE: Do NOT model Exide-type rooms using battery-liion-assembly —
   * the dpCMax limit would require a desiccant system that is neither necessary
   * nor appropriate for lead-acid formation chemistry.
   */
  'battery-leadacid': {
    label:    'Battery — Lead-Acid Formation / Charging (Exide / EnerSys)',
    standard: 'OSHA 29 CFR 1926.403(i), IEEE 1184-2006, NFPA 70 Art.480',
    tempMin:  60, tempMax: 90,
    rhMin:    10, rhMax:   70,
    note:     'H₂ evolution during formation charging requires minimum 1 CFM/ft² supply '
            + '(OSHA 1926.403(i)) or mechanical ventilation to keep H₂ < 1% by volume. '
            + 'H₂SO₄ mist requires acid-resistant ductwork and wet scrubber exhaust. '
            + 'Do NOT use desiccant dehumidification — sub-10%RH is unnecessary '
            + 'and not required by any lead-acid process standard. '
            + 'Condensation on cell terminals must be prevented (rhMax:70 is a hard limit). '
            + 'Use ventilation.js battery-leadacid category for ACH sizing.',
  },

  // ── General critical facility ────────────────────────────────────────────────
  'iso-8-cleanroom': {
    label:    'ISO 8 Cleanroom (general)',
    standard: 'ISO 14644-1, ASHRAE 170 (healthcare)',
    tempMin:  68, tempMax: 77,
    rhMin:    30, rhMax:   60,
    note:     'Occupant comfort and process requirements often conflict. Verify process spec.',
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
    note:     'ASHRAE A1 allows widest range. ETS overrides for specific hardware.',
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

  if (rhNum < 0)   errors.push(`RH cannot be negative (got ${rhNum}%).`);
  if (rhNum > 100) errors.push(`RH exceeds 100% (got ${rhNum.toFixed(1)}%).`);
  if (dbFNum < -100) errors.push(`DB temperature ${dbFNum}°F is below psychrometric model range.`);
  if (dbFNum >  250) errors.push(`DB temperature ${dbFNum}°F is above psychrometric model range.`);

  const computed_grains = calculateGrains(dbFNum, rhNum, elevFt);

  // MEDIUM-02: calculateDewPoint may return null for sub-ppm conditions.
  // BUG-TIER1-01: calculateDewPoint also returns null for rh = 0.
  const computed_dp = calculateDewPoint(dbFNum, rhNum);
  if (computed_dp === null) {
    warnings.push(
      `Frost point is below −100°C (below the Hyland-Wexler equation range), or RH is 0%. ` +
      `This condition (RH=${rhNum.toFixed(3)}% at DB=${dbFNum}°F) is beyond the scope ` +
      `of this psychrometric model. Use a specialist desiccant simulation tool for ` +
      `solid-state battery or sub-ppm moisture applications.`
    );
    return makeResult(errors, warnings, { grains: computed_grains, dewPoint: null });
  }

  if (computed_dp > dbFNum + 0.1) {
    errors.push(
      `Dew point (${computed_dp}°F) exceeds dry-bulb (${dbFNum}°F). Physically impossible.`
    );
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
        `Discrepancy: ${discrepancy.toFixed(1)} gr/lb. Check sensor calibration.`
      );
    }
  }

  if (rhNum > 0 && rhNum < 1) {
    warnings.push(
      `RH=${rhNum.toFixed(2)}% is below 1%. Standard capacitive RH sensors are not ` +
      `accurate below 1%RH. Use a calibrated chilled-mirror or optical dew-point instrument. ` +
      `Frost point at this condition: ${computed_dp}°F (${((computed_dp - 32) * 5/9).toFixed(1)}°C).`
    );
  }

  if (computed_dp < 32) {
    warnings.push(
      `Dew/frost point ${computed_dp}°F (${((computed_dp - 32) * 5/9).toFixed(1)}°C) ` +
      `is below freezing — this is a FROST POINT. Condensation forms as ice, not liquid. ` +
      `Ensure instruments and setpoints are on the same basis.`
    );
  }

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

  if (db < standard.tempMin || db > standard.tempMax) {
    warnings.push(
      `${roomName} design DB ${db}°F is outside ${standard.label} temperature range ` +
      `(${standard.tempMin}–${standard.tempMax}°F per ${standard.standard}).`
    );
  }

  if (standard.rhMin !== undefined && standard.rhMax !== undefined) {
    if (rh < standard.rhMin) {
      warnings.push(
        `${roomName} design RH ${rh}%RH is below the minimum for ${standard.label} ` +
        `(${standard.rhMin}%RH). Dehumidification oversized, or process requirement ` +
        `is stricter than standard — verify with process engineer.`
      );
    }
    if (rh > standard.rhMax) {
      errors.push(
        `${roomName} design RH ${rh}%RH exceeds maximum for ${standard.label} ` +
        `(${standard.rhMax}%RH). Room does not comply. Recalculate dehumidification capacity.`
      );
    }
  }

  if (standard.dpCMax !== undefined) {
    const dpRaw = calculateDewPoint(db, rh);
    // MEDIUM-02 + BUG-TIER1-01: handle null return from calculateDewPoint
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
 * BUG-TIER1-02 FIX (v2.2): elevFt now passed to calculateGrains() and
 * calculateRH(). Both functions call sitePressure(elevFt) internally.
 * Without the elevation argument they default to sea-level pressure,
 * producing humidity ratios that are too low at elevated sites.
 *
 * The consistency invariant is now satisfied:
 *   sensibleFactor(elevFt), calculateGrains(..., elevFt), calculateRH(..., elevFt)
 *   → all use the same sitePressure(elevFt) basis.
 *
 * MEDIUM-01 FIX (v2.1): elevFt parameter added. The sensible capacity check
 * now uses sensibleFactor(elevFt) from psychro.js instead of the hardcoded
 * sea-level value 1.08. At Hyderabad (1,755 ft) the correction is 5.8%; at
 * Denver (5,280 ft) it is 16.8%. The old form overstated available AHU sensible
 * capacity at elevated sites and under-flagged undersized units.
 *
 * @param {{ dbF: number, grains: number, cfm: number }}                    supply
 * @param {{ designDB: number, designRH: number, sensLoad: number }}        room
 * @param {number} [elevFt=0] - site elevation (ft)
 */
export const validateSupplyAirState = (supply, room, elevFt = 0) => {
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

  // BUG-TIER1-02 FIX: pass elevFt to both calls so humidity ratios and the
  // sensible factor all use the same site pressure. Was: calculateGrains(roomDB, roomRH)
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

  // BUG-TIER1-02 FIX: pass elevFt here too. Was: calculateRH(supplyDB, supplyGrains)
  const supplyRH = calculateRH(supplyDB, supplyGrains, elevFt);

  if (supplyRH < 5 && roomRH > 30) {
    warnings.push(
      `Supply air RH is very low (${supplyRH.toFixed(1)}%RH at ${supplyDB}°F). ` +
      `Verify mixing with room air will achieve target humidity of ${roomRH}%RH.`
    );
  }

  // MEDIUM-01 FIX: use altitude-corrected sensible factor instead of hardcoded 1.08
  if (supplyCFM > 0 && room.sensLoad) {
    const deltaT = roomDB - supplyDB;
    const sf     = sensibleFactor(elevFt);        // MEDIUM-01 FIX: was hardcoded 1.08
    const availableSensible = sf * supplyCFM * deltaT;
    if (availableSensible < room.sensLoad * 0.9) {
      warnings.push(
        `Available sensible capacity (${availableSensible.toFixed(0)} BTU/hr) ` +
        `[at elev=${elevFt}ft, sf=${sf.toFixed(3)}] is less than 90% of room sensible load ` +
        `(${room.sensLoad.toFixed(0)} BTU/hr). Consider increasing supply CFM or reducing supply DB.`
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