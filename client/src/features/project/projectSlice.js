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
 *   state.project.systemDesign.safetyFactor         → safety multiplier in seasonalLoads
 *   state.project.systemDesign.bypassFactor          → BF in airQuantities + psychroStatePoints
 *   state.project.systemDesign.adp                   → apparatus dew point in airQuantities + psychro
 *   state.project.systemDesign.adpMode               → 'manual' | 'calculated' — read by rdsSelector ADP chain
 *   state.project.systemDesign.fanHeat               → supply fan heat fraction in rdsSelector
 *   state.project.systemDesign.returnFanHeat         → return fan heat fraction in rdsSelector
 *                                                      Applied upstream of coil — increases coilLoadBTU.
 *                                                      Typical: 2–5% for small return fans; 10–20% for
 *                                                      balanced supply/return systems.
 *   state.project.systemDesign.humidificationTarget  → winter RH fallback in rdsSelector
 *                                                      Used when room.designRH is not set. Rooms with
 *                                                      an explicit designRH (including 0%RH dry rooms)
 *                                                      always use room.designRH directly.
 *
 * ── SYSTEM DESIGN DEFAULTS — INLINED ─────────────────────────────────────────
 *
 *   All defaults are inlined here as named constants to avoid silent undefined
 *   when ashrae.js constant names differ between versions.
 *
 *   DEFAULT_SAFETY_FACTOR_PCT  = 10  (%)  — ASHRAE allows 5–15%; 10% is common practice
 *   DEFAULT_BYPASS_FACTOR      = 0.10     — typical for chilled-water AHUs; use 0.08–0.12
 *   DEFAULT_ADP                = 55  (°F) — CHW coil leaving air at ~13°C; DX: 45–50°F
 *   DEFAULT_FAN_HEAT_PCT       = 5   (%)  — supply fan heat as % of sensible room load
 *   DEFAULT_RETURN_FAN_HEAT    = 5   (%)  — return fan heat as % of supply fan heat
 *   DEFAULT_HUMID_TARGET       = 45  (%)  — fallback winter humidification RH
 *
 * ── AMBIENT FIELDS NOTE ────────────────────────────────────────────────────────
 *
 *   ambient.dryBulbTemp / wetBulbTemp / relativeHumidity are project-brief
 *   reference values in °C and % — NOT used in load calculations.
 *   Seasonal design conditions (summer/monsoon/winter DB + RH) live in climateSlice.
 *
 * ── BOUNDS CLAMPING ──────────────────────────────────────────────────────────
 *
 *   Both updateAmbient and updateSystemDesign clamp numeric inputs to physically
 *   realistic ranges. String fields (adpMode) bypass numeric parsing entirely.
 *   Out-of-bounds numeric values are clamped silently with a console.warn.
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   BUG-SLICE-06 — updateSystemDesign: string fields bypass parseFloat.
 *
 *     Previous code applied parseFloat(value) universally to all systemDesign
 *     fields. For string fields like adpMode:
 *       parseFloat('calculated') = NaN
 *       safe = isNaN(NaN) ? (state.systemDesign['adpMode'] ?? 0) : NaN
 *            = current value ('manual')     ← NOT the new value
 *       state.systemDesign['adpMode'] = 'manual'   ← writes old value back
 *
 *     adpMode was permanently stuck at 'manual' regardless of UI dispatch.
 *
 *     Fix: fields not in SYSTEM_DESIGN_BOUNDS (no numeric bounds defined)
 *     are treated as string fields and written directly without parseFloat.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   BUG-SLICE-05 — updateSystemDesign: adp < 38°F now triggers a warning.
 *
 *     Standard CHW coils achieve ADP 44–55°F. Below 38°F requires DX or glycol.
 *     A data-entry error (e.g. 32 instead of 52) halves thermalCFM, undersizing
 *     the AHU by up to 50%. A warning (not a clamp) fires for 32–37°F.
 *
 * ── CHANGELOG v2.3 ────────────────────────────────────────────────────────────
 *
 *   returnFanHeat added to systemDesign.
 *
 *     The previous hardcoded 0.02 multiplier in rdsSelector (returnFanHeat =
 *     supplyFanHeat × 2%) was non-configurable and likely too conservative for
 *     most systems (typical return fans are 10–20% of supply fan power).
 *     Now exposed as a project-level input (0–25%) defaulting to 5%.
 *     Return fan heat is applied upstream of the cooling coil — it increases
 *     coilLoadBTU and therefore CHW pipe sizing.
 */

import { createSlice } from '@reduxjs/toolkit';

// ── Inlined system design defaults ───────────────────────────────────────────
const DEFAULT_SAFETY_FACTOR_PCT  = 10;    // %
const DEFAULT_BYPASS_FACTOR      = 0.10;  // dimensionless
const DEFAULT_ADP                = 55;    // °F
const DEFAULT_FAN_HEAT_PCT       = 5;     // % of sensible room load
const DEFAULT_RETURN_FAN_HEAT    = 5;     // % of supply fan heat
const DEFAULT_HUMID_TARGET       = 45;    // %RH — fallback when room.designRH unset

// ── Bounds definitions ────────────────────────────────────────────────────────
// Only NUMERIC fields appear here. String fields (adpMode) are intentionally
// absent — updateSystemDesign uses this absence to identify string fields and
// bypass parseFloat, writing the value directly.
const SYSTEM_DESIGN_BOUNDS = {
  safetyFactor:         { min: 0,    max: 50   },
  bypassFactor:         { min: 0.01, max: 0.30 },
  adp:                  { min: 32,   max: 65   },  // °F — hard lower = freezing point
  fanHeat:              { min: 0,    max: 20   },
  returnFanHeat:        { min: 0,    max: 25   },
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
    elevation:        0,
    latitude:        28,
    dailyRange:       0,
    dryBulbTemp:      35,
    wetBulbTemp:      24,
    relativeHumidity: 50,
  },

  systemDesign: {
    safetyFactor:         DEFAULT_SAFETY_FACTOR_PCT,
    bypassFactor:         DEFAULT_BYPASS_FACTOR,
    adp:                  DEFAULT_ADP,
    adpMode:              'manual',               // 'manual' | 'calculated' — string field, no bounds
    fanHeat:              DEFAULT_FAN_HEAT_PCT,
    returnFanHeat:        DEFAULT_RETURN_FAN_HEAT, // % of supply fan heat; applied upstream of coil
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
     * { field, value }
     *
     * String fields (adpMode): written directly — no parseFloat, no bounds clamping.
     *   Fields not present in SYSTEM_DESIGN_BOUNDS are treated as string fields.
     *
     * Numeric fields: parsed, clamped to SYSTEM_DESIGN_BOUNDS, and field-specific
     *   warnings applied (adp below CHW range, safetyFactor = 0).
     */
    updateSystemDesign: (state, action) => {
      const { field, value } = action.payload;
      if (!(field in state.systemDesign)) {
        console.warn(`updateSystemDesign: unknown field "${field}"`);
        return;
      }

      const bounds = SYSTEM_DESIGN_BOUNDS[field];

      // String fields have no entry in SYSTEM_DESIGN_BOUNDS.
      // Bypass numeric parsing entirely — write the value directly.
      if (!bounds) {
        state.systemDesign[field] = value;
        return;
      }

      const parsed  = parseFloat(value);
      const safe    = isNaN(parsed) ? (state.systemDesign[field] ?? 0) : parsed;
      const clamped = clamp(safe, bounds.min, bounds.max);

      if (clamped !== safe) {
        console.warn(
          `updateSystemDesign: "${field}" = ${safe} clamped to [${bounds.min}, ${bounds.max}] → ${clamped}`
        );
      }

      if (field === 'safetyFactor' && clamped === 0) {
        console.warn(
          'updateSystemDesign: safetyFactor = 0 — no safety margin will be applied. ' +
          'ASHRAE recommends 5–15% for cooling load calculations.'
        );
      }

      // Warn when ADP is below typical CHW coil range (38–55°F).
      // Hard lower bound (32°F) is retained — ADP cannot be below the freezing
      // point on a standard coil without icing. The warning fires for 32–37°F,
      // which requires DX refrigerant or glycol — legitimate but rare.
      // An accidental low ADP (e.g. 32 instead of 52) halves thermalCFM,
      // undersizing the AHU by up to 50% for typical room conditions.
      if (field === 'adp' && clamped < 38) {
        console.warn(
          `updateSystemDesign: adp = ${clamped}°F is below the typical chilled-water ` +
          `coil range (38–55°F). Standard CHW supply at 6–8°C (43–46°F) achieves ` +
          `ADP ≈ 44–50°F. Values below 38°F require DX refrigerant or glycol coils. ` +
          `If this is intentional (DX/glycol system), this warning can be disregarded.`
        );
      }

      state.systemDesign[field] = clamped;
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
export const selectReturnFanHeat = (state) => state.project.systemDesign.returnFanHeat;
export const selectHumidTarget   = (state) => state.project.systemDesign.humidificationTarget;
export const selectIndustry      = (state) => state.project.info.industry;