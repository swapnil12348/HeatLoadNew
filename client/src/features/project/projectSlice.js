/**
 * projectSlice.js
 * Project-level identity, site reference data, and system design parameters.
 * These fields drive every room calculation downstream via rdsSelector.
 *
 * State shape:
 *   state.project.info          →  project metadata
 *   state.project.ambient       →  site reference conditions
 *   state.project.systemDesign  →  HVAC system sizing parameters
 *
 * ── FIELD CONTRACT WITH THE LOGIC LAYER ──────────────────────────────────────
 *
 *   rdsSelector reads these fields directly via named input selectors:
 *
 *   state.project.ambient.elevation   → altitudeCorrectionFactor(elevation)
 *                                       altCf used by ALL psychrometric calcs.
 *   state.project.ambient.latitude    → CLTD LM correction; SHGF latitude factor
 *                                       (negative = southern hemisphere, valid)
 *                                       Default 28°N = Delhi / S.E. Asia fabs.
 *   state.project.ambient.dailyRange  → CLTD mean-temp correction (°F swing).
 *                                       0 = use DIURNAL_RANGE_DEFAULTS by climate zone.
 *
 *   state.project.systemDesign.safetyFactor       → safety multiplier in seasonalLoads
 *   state.project.systemDesign.bypassFactor        → BF in airQuantities + psychroStatePoints
 *   state.project.systemDesign.adp                 → apparatus dew point in airQuantities + psychro
 *   state.project.systemDesign.fanHeat             → supply fan heat fraction in rdsSelector
 *   state.project.systemDesign.humidificationTarget → winter RH target in heatingHumid
 *
 * ── SYSTEM DESIGN DEFAULTS — INLINED ─────────────────────────────────────────
 *
 *   Previous version referenced ASHRAE.DEFAULT_SAFETY_FACTOR_PCT etc.
 *   These constants may not exist in all versions of ashrae.js and would
 *   silently produce undefined → NaN defaults at startup.
 *
 *   All defaults are now inlined here as named constants.
 *   If ashrae.js is updated, update these constants to match.
 *
 *   DEFAULT_SAFETY_FACTOR_PCT  = 10  (%)  — ASHRAE allows 5–15%; 10% is common practice
 *   DEFAULT_BYPASS_FACTOR      = 0.10     — typical for chilled-water AHUs; use 0.08–0.12
 *   DEFAULT_ADP                = 55  (°F) — CHW coil leaving air at ~13°C; DX: 45–50°F
 *   DEFAULT_FAN_HEAT_PCT       = 5   (%)  — supply fan heat as % of sensible room load
 *   DEFAULT_HUMID_TARGET       = 45  (%)  — winter humidification setpoint
 *
 * ── AMBIENT FIELDS NOTE ────────────────────────────────────────────────────────
 *
 *   ambient.dryBulbTemp / wetBulbTemp / relativeHumidity are project-brief
 *   reference values in °C and % — NOT used in load calculations.
 *   Seasonal design conditions (summer/monsoon/winter DB + RH) live in climateSlice.
 *
 * ── BOUNDS CLAMPING ──────────────────────────────────────────────────────────
 *
 *   Both updateAmbient and updateSystemDesign clamp inputs to physically realistic
 *   ranges. Out-of-bounds values are clamped silently with a console.warn.
 *   This prevents a single bad UI input from producing nonsensical cascade results.
 */

import { createSlice } from '@reduxjs/toolkit';

// ── Inlined system design defaults ───────────────────────────────────────────
// These replace the previous ASHRAE.DEFAULT_* references which were fragile
// (undefined if ashrae.js didn't export them, silently producing NaN defaults).
const DEFAULT_SAFETY_FACTOR_PCT  = 10;    // %
const DEFAULT_BYPASS_FACTOR      = 0.10;  // dimensionless
const DEFAULT_ADP                = 55;    // °F
const DEFAULT_FAN_HEAT_PCT       = 5;     // %
const DEFAULT_HUMID_TARGET       = 45;    // %RH

// ── Bounds definitions ────────────────────────────────────────────────────────
const SYSTEM_DESIGN_BOUNDS = {
  safetyFactor:         { min: 0,    max: 50   },  // % — 0 allowed (deliberate, warns)
  bypassFactor:         { min: 0.01, max: 0.30 },  // dimensionless
  adp:                  { min: 32,   max: 65   },  // °F — below freezing is impossible
  fanHeat:              { min: 0,    max: 20   },  // % — >20% is mechanically unrealistic
  humidificationTarget: { min: 0,    max: 95   },  // %RH — 100% = saturation (not a target)
};

const AMBIENT_BOUNDS = {
  elevation:        { min: -1400, max: 30000 },  // ft — Dead Sea to Everest base camp
  latitude:         { min: -90,   max: 90    },  // ° — full globe
  dailyRange:       { min: 0,     max: 60    },  // °F — 0 = use lookup; 60 = extreme desert
  dryBulbTemp:      { min: -60,   max: 60    },  // °C — reference only
  wetBulbTemp:      { min: -60,   max: 40    },  // °C — reference only
  relativeHumidity: { min: 0,     max: 100   },  // %  — reference only
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// ── Initial state ─────────────────────────────────────────────────────────────
const initialState = {
  info: {
    projectName:       '',
    projectLocation:   '',
    customerName:      '',
    consultantName:    '',
    // industry: used by UI for context-sensitive defaults (e.g. ventCategory suggestions).
    // Not read directly by the current logic layer but available for future use.
    industry:          'Semiconductor',
    keyAccountManager: '',
  },

  ambient: {
    // ── CALCULATION INPUTS — read by rdsSelector ──────────────────────────
    elevation:    0,    // ft — 0 = sea level; drives altCf for ALL psychro calcs
    latitude:    28,    // ° — negative = southern hemisphere; 28 = Delhi default
    dailyRange:   0,    // °F — 0 = use DIURNAL_RANGE_DEFAULTS from ashraeTables.js

    // ── REFERENCE VALUES — project brief only; NOT read by logic layer ────
    dryBulbTemp:      35,  // °C
    wetBulbTemp:      24,  // °C
    relativeHumidity: 50,  // %
  },

  systemDesign: {
    // All values inlined — no ASHRAE constant references that could be undefined
    safetyFactor:         DEFAULT_SAFETY_FACTOR_PCT,   // 10 %
    bypassFactor:         DEFAULT_BYPASS_FACTOR,        // 0.10
    adp:                  DEFAULT_ADP,                  // 55 °F
    fanHeat:              DEFAULT_FAN_HEAT_PCT,         // 5 %
    humidificationTarget: DEFAULT_HUMID_TARGET,         // 45 %RH
  },
};

// ── Slice ─────────────────────────────────────────────────────────────────────
const projectSlice = createSlice({
  name: 'project',
  initialState,

  reducers: {
    /**
     * updateProjectInfo
     * { field, value }  —  string fields, trimmed to prevent whitespace mismatches.
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
     * updateAmbient
     * { field, value }  —  numeric fields, clamped to AMBIENT_BOUNDS.
     *
     * IMPORTANT: latitude and dailyRange can legitimately be 0 (equator,
     * "use defaults"). parseFloat(value) ?? fallback used (not || fallback)
     * so that a deliberate 0 is preserved. NaN falls back to existing state.
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
            `updateAmbient: "${field}" = ${safe} clamped to [${bounds.min}, ${bounds.max}] → ${clamped}`
          );
        }
        state.ambient[field] = clamped;
      } else {
        state.ambient[field] = safe;
      }
    },

    /**
     * updateSystemDesign
     * { field, value }  —  numeric fields, clamped to SYSTEM_DESIGN_BOUNDS.
     *
     * safetyFactor = 0 is permitted (deliberate no-margin choice) but warns.
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
            `updateSystemDesign: "${field}" = ${safe} clamped to [${bounds.min}, ${bounds.max}] → ${clamped}`
          );
        }
        if (field === 'safetyFactor' && clamped === 0) {
          console.warn('updateSystemDesign: safetyFactor = 0 — no safety margin will be applied.');
        }
        state.systemDesign[field] = clamped;
      } else {
        state.systemDesign[field] = safe;
      }
    },

    /** Reset to initial state — used when creating a new project. */
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
// Named selectors so no consumer hardcodes the state shape path.

export const selectProjectInfo   = (state) => state.project.info;
export const selectAmbient       = (state) => state.project.ambient;
export const selectSystemDesign  = (state) => state.project.systemDesign;

// Granular selectors — consumed directly by rdsSelector input selectors
export const selectElevation     = (state) => state.project.ambient.elevation;
export const selectLatitude      = (state) => state.project.ambient.latitude;
export const selectDailyRange    = (state) => state.project.ambient.dailyRange;
export const selectSafetyFactor  = (state) => state.project.systemDesign.safetyFactor;
export const selectBypassFactor  = (state) => state.project.systemDesign.bypassFactor;
export const selectAdp           = (state) => state.project.systemDesign.adp;
export const selectFanHeat       = (state) => state.project.systemDesign.fanHeat;
export const selectHumidTarget   = (state) => state.project.systemDesign.humidificationTarget;
export const selectIndustry      = (state) => state.project.info.industry;