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
 *   state.project.systemDesign.ductHeatGain         → SA duct heat gain & leak loss %
 *                                                      Applied ADDITIVELY with safetyFactor
 *                                                      (matching Excel row 80 method).
 *                                                      Combined multiplier = 1 + (safety + duct)/100
 *                                                      Typical: 5% for insulated duct < 30m;
 *                                                      10% for long or uninsulated runs.
 *   state.project.systemDesign.bypassFactor          → BF in airQuantities + psychroStatePoints
 *   state.project.systemDesign.adp                   → PROJECT-LEVEL DEFAULT ADP (°F).
 *                                                      This is the fallback when an AHU has no
 *                                                      override set. Each AHU can override via
 *                                                      ahu.adp / ahu.adpMode in AHU Config.
 *                                                      Priority: AHU calculated > AHU manual > project default.
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
 *   DEFAULT_DUCT_HEAT_GAIN_PCT = 5   (%)  — SA duct heat gain & leak loss; ASHRAE HOF Ch.18
 *   DEFAULT_BYPASS_FACTOR      = 0.10     — typical for chilled-water AHUs; use 0.08–0.12
 *   DEFAULT_ADP                = 55  (°F) — CHW coil leaving air at ~13°C; DX: 45–50°F
 *   DEFAULT_FAN_HEAT_PCT       = 5   (%)  — supply fan heat as % of sensible room load
 *   DEFAULT_RETURN_FAN_HEAT    = 5   (%)  — return fan heat as % of supply fan heat
 *   DEFAULT_HUMID_TARGET       = 45  (%)  — fallback winter humidification RH
 *
 * ── ADP SCOPE — PROJECT vs PER-AHU ───────────────────────────────────────────
 *
 *   Project ADP is the DEFAULT — applied to all AHUs that have no override.
 *   Per-AHU override lives in ahuSlice (ahu.adp, ahu.adpMode).
 *   Priority chain (most specific wins):
 *     1. ahuAdpMode = 'calculated' → calculateAdpFromLoads()
 *     2. ahu.adp > 0               → per-AHU manual override
 *     3. systemDesign.adp          → this field (project default)
 *     4. 55°F hardcoded fallback
 *   Consequence: the project-level ADP field should stay — it is the base
 *   assumption for all AHUs that are not individually configured.
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
 * ── CHANGELOG v2.4 ────────────────────────────────────────────────────────────
 *
 *   ductHeatGain added to systemDesign.
 *
 *     Excel row 80 applies SA duct heat gain & leak loss as a separate %
 *     additive to the safety factor on RSH → ERSH. The app previously only
 *     applied safetyFactor, leaving out the duct gain entirely. For a 5%
 *     duct gain + 10% safety, Excel gives 1.15× while the app was giving 1.10×
 *     — approximately 5% understatement of ERSH for every room.
 *
 *     Applied additively with safetyFactor in seasonalLoads.js:
 *       safetyMult = 1 + (safetyFactor + ductHeatGain) / 100
 *     This matches the Excel additive method (not multiplicative).
 *
 *     Default 5% per ASHRAE HOF 2021 Ch.18 §17.2 (typical insulated duct).
 *     Range: 0–15%. Set 0 to disable (for exposed in-room air handlers).
 *
 * ── CHANGELOG v2.3 ────────────────────────────────────────────────────────────
 *
 *   returnFanHeat added to systemDesign.
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   BUG-SLICE-06 — updateSystemDesign: string fields bypass parseFloat.
 *     adpMode was permanently stuck at 'manual' regardless of UI dispatch.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   BUG-SLICE-05 — updateSystemDesign: adp < 38°F now triggers a warning.
 */

import { createSlice } from '@reduxjs/toolkit';

// ── Inlined system design defaults ───────────────────────────────────────────
const DEFAULT_SAFETY_FACTOR_PCT  = 10;    // %
const DEFAULT_DUCT_HEAT_GAIN_PCT = 5;     // % — SA duct heat gain & leak loss
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
  ductHeatGain:         { min: 0,    max: 15   },  // % — SA duct heat gain & leak
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
    ductHeatGain:         DEFAULT_DUCT_HEAT_GAIN_PCT,
    bypassFactor:         DEFAULT_BYPASS_FACTOR,
    adp:                  DEFAULT_ADP,
    adpMode:              'manual',
    fanHeat:              DEFAULT_FAN_HEAT_PCT,
    returnFanHeat:        DEFAULT_RETURN_FAN_HEAT,
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

export const selectProjectInfo    = (state) => state.project.info;
export const selectAmbient        = (state) => state.project.ambient;
export const selectSystemDesign   = (state) => state.project.systemDesign;

export const selectElevation      = (state) => state.project.ambient.elevation;
export const selectLatitude       = (state) => state.project.ambient.latitude;
export const selectDailyRange     = (state) => state.project.ambient.dailyRange;
export const selectSafetyFactor   = (state) => state.project.systemDesign.safetyFactor;
export const selectDuctHeatGain   = (state) => state.project.systemDesign.ductHeatGain;
export const selectBypassFactor   = (state) => state.project.systemDesign.bypassFactor;
export const selectAdp            = (state) => state.project.systemDesign.adp;
export const selectFanHeat        = (state) => state.project.systemDesign.fanHeat;
export const selectReturnFanHeat  = (state) => state.project.systemDesign.returnFanHeat;
export const selectHumidTarget    = (state) => state.project.systemDesign.humidificationTarget;
export const selectIndustry       = (state) => state.project.info.industry;