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
 *
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   BUG-SLICE-05 FIX — updateSystemDesign: adp < 38°F now triggers a warning.
 *
 *     The hard lower bound for adp is 32°F (freezing) — physically correct as
 *     a hard limit (ADP cannot be below the freezing point of water on a
 *     standard coil without icing). However, 32°F is not achievable by a
 *     standard chilled-water coil: typical CHW supply 6–8°C (43–46°F) yields
 *     ADP in the 44–50°F range. Values below 38°F require DX refrigerant or
 *     glycol coils.
 *
 *     Engineers setting adp = 32–37°F are either:
 *       (a) making a data-entry error (intended 52°F or 47°F), or
 *       (b) designing a DX/glycol system intentionally.
 *
 *     A warning (not a clamp) allows both cases. Case (b) is legitimate —
 *     the calculation proceeds correctly; the engineer is informed.
 *
 *     Impact of an accidentally low ADP:
 *       supplyDT = (1 - BF) × (dbRoom - ADP) → larger ΔT → lower thermalCFM
 *       Lower supply CFM → smaller AHU selected → undersized for the room.
 *       For a 1000 BTU/hr room at ADP=32°F vs ADP=52°F:
 *         thermalCFM(32°F): 1000 / (1.08 × 0.90 × (72-32)) = 25.7 CFM
 *         thermalCFM(52°F): 1000 / (1.08 × 0.90 × (72-52)) = 51.4 CFM
 *       50% undersizing of supply air — non-conservative for critical facilities.
 */

import { createSlice } from '@reduxjs/toolkit';

// ── Inlined system design defaults ───────────────────────────────────────────
const DEFAULT_SAFETY_FACTOR_PCT  = 10;    // %
const DEFAULT_BYPASS_FACTOR      = 0.10;  // dimensionless
const DEFAULT_ADP                = 55;    // °F
const DEFAULT_FAN_HEAT_PCT       = 5;     // %
const DEFAULT_HUMID_TARGET       = 45;    // %RH

// ── Bounds definitions ────────────────────────────────────────────────────────
const SYSTEM_DESIGN_BOUNDS = {
  safetyFactor:         { min: 0,    max: 50   },
  bypassFactor:         { min: 0.01, max: 0.30 },
  adp:                  { min: 32,   max: 65   },  // °F — hard lower = freezing point
  fanHeat:              { min: 0,    max: 20   },
  humidificationTarget: { min: 0,    max: 95   },
};

const AMBIENT_BOUNDS = {
  elevation:        { min: -1400, max: 30000 },
  latitude:         { min: -90,   max: 90    },
  dailyRange:       { min: 0,     max: 60    },
  dryBulbTemp:      { min: -60,   max: 60    },
  wetBulbTemp:      { min: -60,   max: 40    },
  relativeHumidity: { min: 0,     max: 100   },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// ── Initial state ─────────────────────────────────────────────────────────────
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
    elevation:    0,
    latitude:    28,
    dailyRange:   0,
    dryBulbTemp:      35,
    wetBulbTemp:      24,
    relativeHumidity: 50,
  },

  systemDesign: {
    safetyFactor:         DEFAULT_SAFETY_FACTOR_PCT,
    bypassFactor:         DEFAULT_BYPASS_FACTOR,
    adp:                  DEFAULT_ADP,
    adpMode: 'manual',
    fanHeat:              DEFAULT_FAN_HEAT_PCT,
    humidificationTarget: DEFAULT_HUMID_TARGET,
  },
};

// ── Slice ─────────────────────────────────────────────────────────────────────
const projectSlice = createSlice({
  name: 'project',
  initialState,

  reducers: {
    updateProjectInfo: (state, action) => {
      const { field, value } = action.payload;
      if (!(field in state.info)) {
        console.warn(`updateProjectInfo: unknown field "${field}"`);
        return;
      }
      state.info[field] = typeof value === 'string' ? value.trim() : value;
    },

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
     * BUG-SLICE-05 FIX: adp < 38°F now triggers a warning (not a clamp).
     *   Standard CHW coils achieve ADP 44–55°F. Below 38°F requires DX or glycol.
     *   A data-entry error (e.g. 32 instead of 52) halves thermalCFM → 50%
     *   undersized AHU. The warning makes the engineer's intent explicit.
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

        // ── Field-specific warnings ──────────────────────────────────────────

        if (field === 'safetyFactor' && clamped === 0) {
          console.warn(
            'updateSystemDesign: safetyFactor = 0 — no safety margin will be applied. ' +
            'ASHRAE recommends 5–15% for cooling load calculations.'
          );
        }

        // BUG-SLICE-05 FIX: warn when ADP is below typical CHW coil range.
        // Hard lower bound (32°F) is retained — ADP physically cannot be below
        // the freezing point on a standard coil without icing the coil surface.
        // The warning fires for 32–37°F, which requires DX refrigerant or glycol.
        if (field === 'adp' && clamped < 38) {
          console.warn(
            `updateSystemDesign: adp = ${clamped}°F is below the typical chilled-water ` +
            `coil range (38–55°F). Standard CHW supply at 6–8°C (43–46°F) achieves ` +
            `ADP ≈ 44–50°F. Values below 38°F require DX refrigerant or glycol coils. ` +
            `If this is intentional (DX/glycol system), this warning can be disregarded. ` +
            `If this is a data-entry error (e.g. intended 52°F), correct the value — ` +
            `an ADP that is too low understates thermalCFM and undersizes the AHU ` +
            `by up to 50% for typical room conditions.`
          );
        }

        state.systemDesign[field] = clamped;
      } else {
        state.systemDesign[field] = safe;
      }
    },

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

export const selectProjectInfo   = (state) => state.project.info;
export const selectAmbient       = (state) => state.project.ambient;
export const selectSystemDesign  = (state) => state.project.systemDesign;

export const selectElevation     = (state) => state.project.ambient.elevation;
export const selectLatitude      = (state) => state.project.ambient.latitude;
export const selectDailyRange    = (state) => state.project.ambient.dailyRange;
export const selectSafetyFactor  = (state) => state.project.systemDesign.safetyFactor;
export const selectBypassFactor  = (state) => state.project.systemDesign.bypassFactor;
export const selectAdp           = (state) => state.project.systemDesign.adp;
export const selectFanHeat       = (state) => state.project.systemDesign.fanHeat;
export const selectHumidTarget   = (state) => state.project.systemDesign.humidificationTarget;
export const selectIndustry      = (state) => state.project.info.industry;