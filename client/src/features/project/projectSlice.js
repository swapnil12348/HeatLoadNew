/**
 * projectSlice.js
 * Responsibility: Project-level identity, site reference data, and system
 * design parameters. These fields drive every room calculation downstream.
 *
 * ── FIELD NOTES ───────────────────────────────────────────────────────────────
 *
 * ambient.elevation   → altitude correction factor Cf in psychro.js
 *                        sensibleFactor(elev) / latentFactor(elev)
 * ambient.latitude    → CLTD LM correction + SHGF latitude factor (BUG-07 FIX)
 *                        Negative = southern hemisphere (valid).
 *                        Default 28°N (Delhi / typical South/SE Asia fab).
 * ambient.dailyRange  → full daily DB swing (°F) for CLTD mean-temp correction
 *                        (BUG-09 FIX). 0 = use DIURNAL_RANGE_DEFAULTS from
 *                        ashraeTables.js. Coastal: 8–12°F · Inland: 18–25°F ·
 *                        Desert: 28–40°F.
 *
 * ambient.dryBulbTemp / wetBulbTemp / relativeHumidity:
 *   Project brief reference values only (°C / %).
 *   NOT used in load calculations — seasonal design conditions live in climateSlice.
 *
 * systemDesign.safetyFactor    — % added to total capacity (0–50%)
 * systemDesign.bypassFactor    — coil bypass factor BF (0.01–0.30)
 * systemDesign.adp             — apparatus dew point °F (32–65°F)
 * systemDesign.fanHeat         — supply fan heat gain % of cooling load (0–20%)
 * systemDesign.humidificationTarget — minimum indoor RH% for winter humidification
 *   Pharma: 30–50% · Semiconductor: 40–50% · Battery dry room: 1–5%
 *
 * BUG-14 NOTE: safetyFactor and fanHeat applied independently in rdsSelector:
 *   grandTotal = (rawSensible + rawLatent) × safetyMult × fanHeatMult
 *   NOT: × (safetyMult × fanHeatMult) — avoids compounding two separate margins.
 */

import { createSlice }  from '@reduxjs/toolkit';
import ASHRAE           from '../../constants/ashrae';

// ── Bounds definitions for systemDesign fields ────────────────────────────────
// Applied in updateSystemDesign reducer. Any value outside these bounds is
// clamped silently and a console.warn is emitted so engineers can detect
// bad inputs without breaking the calculation chain.
const SYSTEM_DESIGN_BOUNDS = {
  safetyFactor:         { min: 0,    max: 50   },   // % — 0 = no margin (intentional only)
  bypassFactor:         { min: 0.01, max: 0.30 },   // BF — physically bounded
  adp:                  { min: 32,   max: 65   },   // °F — below freezing or above room = impossible
  fanHeat:              { min: 0,    max: 20   },   // % — >20% is mechanically unrealistic
  humidificationTarget: { min: 0,    max: 95   },   // %RH — 100% = saturation (never a design target)
};

// ── Bounds definitions for ambient fields ────────────────────────────────────
const AMBIENT_BOUNDS = {
  elevation:         { min: -1400, max: 30000 },  // ft — Dead Sea to Everest base camp
  latitude:          { min: -90,   max: 90    },  // ° — full globe
  dailyRange:        { min: 0,     max: 60    },  // °F — 0 = use defaults; 60 = extreme desert
  dryBulbTemp:       { min: -60,   max: 60    },  // °C — reference only
  wetBulbTemp:       { min: -60,   max: 40    },  // °C — reference only
  relativeHumidity:  { min: 0,     max: 100   },  // %
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const initialState = {
  info: {
    projectName:       '',
    projectLocation:   '',
    customerName:      '',
    consultantName:    '',
    industry:          'Semiconductor',
    keyAccountManager: '',
  },

  ambient: {
    elevation:         0,     // ft
    latitude:         28,     // ° (negative = southern hemisphere)
    dailyRange:        0,     // °F (0 = use DIURNAL_RANGE_DEFAULTS)
    dryBulbTemp:      35,     // °C — project brief reference only
    wetBulbTemp:      24,     // °C — project brief reference only
    relativeHumidity: 50,     // %  — project brief reference only
  },

  systemDesign: {
    safetyFactor:         ASHRAE.DEFAULT_SAFETY_FACTOR_PCT,   // % default 10
    bypassFactor:         ASHRAE.DEFAULT_BYPASS_FACTOR,        // — default 0.10
    adp:                  ASHRAE.DEFAULT_ADP,                  // °F default 55
    fanHeat:              ASHRAE.DEFAULT_FAN_HEAT_PCT,         // % default 5
    humidificationTarget: 45,                                   // %RH default 45
  },
};

const projectSlice = createSlice({
  name: 'project',
  initialState,

  reducers: {
    /**
     * updateProjectInfo({ field, value })
     * String fields — trimmed to prevent whitespace mismatches in display / export.
     */
    updateProjectInfo: (state, action) => {
      const { field, value } = action.payload;
      if (!(field in state.info)) {
        console.warn(`updateProjectInfo: unknown field "${field}"`);
        return;
      }
      state.info[field] = typeof value === 'string' ? value.trim() : value;
    },

    /**
     * updateAmbient({ field, value })
     * Numeric fields — parsed and clamped to AMBIENT_BOUNDS.
     * Latitude can legitimately be negative (southern hemisphere) and 0 (equator).
     * parseFloat(value) ?? 0 used (not || 0) so that a deliberate 0 is preserved.
     */
    updateAmbient: (state, action) => {
      const { field, value } = action.payload;
      if (!(field in state.ambient)) {
        console.warn(`updateAmbient: unknown field "${field}"`);
        return;
      }
      const parsed = parseFloat(value);
      const safe   = isNaN(parsed) ? (state.ambient[field] ?? 0) : parsed;
      const bounds = AMBIENT_BOUNDS[field];
      if (bounds) {
        const clamped = clamp(safe, bounds.min, bounds.max);
        if (clamped !== safe) {
          console.warn(
            `updateAmbient: "${field}" value ${safe} clamped to [${bounds.min}, ${bounds.max}] → ${clamped}`
          );
        }
        state.ambient[field] = clamped;
      } else {
        state.ambient[field] = safe;
      }
    },

    /**
     * updateSystemDesign({ field, value })
     * Numeric fields — parsed and clamped to SYSTEM_DESIGN_BOUNDS.
     * safetyFactor = 0 is permitted (engineer's deliberate choice) but warns.
     */
    updateSystemDesign: (state, action) => {
      const { field, value } = action.payload;
      if (!(field in state.systemDesign)) {
        console.warn(`updateSystemDesign: unknown field "${field}"`);
        return;
      }
      const parsed = parseFloat(value);
      const safe   = isNaN(parsed) ? (state.systemDesign[field] ?? 0) : parsed;
      const bounds = SYSTEM_DESIGN_BOUNDS[field];
      if (bounds) {
        const clamped = clamp(safe, bounds.min, bounds.max);
        if (clamped !== safe) {
          console.warn(
            `updateSystemDesign: "${field}" value ${safe} clamped to [${bounds.min}, ${bounds.max}] → ${clamped}`
          );
        }
        // Extra warning for deliberate zero safety factor — not an error but unusual
        if (field === 'safetyFactor' && clamped === 0) {
          console.warn('updateSystemDesign: safetyFactor set to 0 — no safety margin will be applied.');
        }
        state.systemDesign[field] = clamped;
      } else {
        state.systemDesign[field] = safe;
      }
    },

    /** Reset to initial state — useful for new project creation. */
    resetProject: () => initialState,
  },
});

export const {
  updateProjectInfo,
  updateAmbient,
  updateSystemDesign,
  resetProject,
} = projectSlice.actions;

export default projectSlice.reducer;

// ── Selectors ─────────────────────────────────────────────────────────────────
// Named selectors so consumers never hardcode state shape paths.
// rdsSelector, seasonalLoads, airQuantities, envelopeCalc all import from here.

export const selectProjectInfo        = (state) => state.project.info;
export const selectAmbient            = (state) => state.project.ambient;
export const selectSystemDesign       = (state) => state.project.systemDesign;

// Granular selectors for the fields most widely consumed downstream
export const selectElevation          = (state) => state.project.ambient.elevation;
export const selectLatitude           = (state) => state.project.ambient.latitude;
export const selectDailyRange         = (state) => state.project.ambient.dailyRange;
export const selectSafetyFactor       = (state) => state.project.systemDesign.safetyFactor;
export const selectBypassFactor       = (state) => state.project.systemDesign.bypassFactor;
export const selectAdp                = (state) => state.project.systemDesign.adp;
export const selectFanHeat            = (state) => state.project.systemDesign.fanHeat;
export const selectHumidTarget        = (state) => state.project.systemDesign.humidificationTarget;
export const selectIndustry           = (state) => state.project.info.industry;