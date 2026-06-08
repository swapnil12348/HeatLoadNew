/**
 * projectSlice.ts
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
 *                                                      Fallback when an AHU has no override.
 *                                                      Each AHU can override via ahu.adp / ahu.adpMode.
 *                                                      Priority chain (most specific wins):
 *                                                        1. ahu.adpMode = 'calculated' → calculateAdpFromLoads()
 *                                                        2. ahu.adp !== null           → per-AHU manual override
 *                                                        3. systemDesign.adp           → this field
 *                                                        4. 55°F hardcoded fallback    → last resort
 *                                                      NOTE: Step 2 uses !== null (not > 0).
 *                                                      Requires ahuSlice adp field to be null (not 0)
 *                                                      as the "not set" sentinel — see ahuSlice CHANGELOG.
 *   state.project.systemDesign.adpMode               → 'manual' | 'calculated'
 *                                                      Used as fallback when ahu.adpMode is not set.
 *                                                      rdsSelector: ahuAdpMode = ahu?.adpMode || projectAdpMode
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
 *   DEFAULT_ADP                = 45  (°F) — effective coil surface temp for standard CHW systems.
 *                                           CHW supply 6°C / return 12°C → mean water temp 9°C (48°F)
 *                                           → ADP typically 44–48°F (7–9°C).
 *                                           ⚠  Previously 55°F — INCORRECT for humid-climate projects.
 *                                           55°F (12.8°C) is the CHW RETURN temperature, not the ADP.
 *                                           At 55°F ADP, any room at ≥47%RH@72°F has a dew point
 *                                           below the ADP — the coil runs dry and cannot dehumidify.
 *                                           rdsSelector reports adpSufficient=insufficient for ALL rooms.
 *                                           45°F ensures dehumidification to 45%RH in tropical climates
 *                                           (India, SE Asia) and is appropriate for semiconductor/
 *                                           pharmaceutical/cleanroom CHW systems.
 *                                           For DX systems: 40–44°F is typical.
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
 *     2. ahu.adp !== null           → per-AHU manual override  ← null sentinel, not 0
 *     3. systemDesign.adp          → this field (project default)
 *     4. 55°F hardcoded fallback
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
 *   realistic ranges. String fields (adpMode) are validated against
 *   STRING_FIELD_ALLOWED whitelist — invalid values are rejected without mutating state.
 *   Out-of-bounds numeric values are clamped silently with a console.warn.
 *
 *   adp bounds: min 32°F (freezing — hard physical floor; DX/glycol systems can reach here).
 *               Values < 38°F trigger a warning (below typical CHW range).
 *               Values > 50°F trigger a dry-coil risk warning for humid climates.
 *
 * ── CHANGELOG v2.5 ────────────────────────────────────────────────────────────
 *
 *   DEFAULT_ADP changed from 55°F to 45°F — see note in defaults section above.
 *
 *   STRING_FIELD_ALLOWED whitelist added to updateSystemDesign.
 *     adpMode values outside ['manual', 'calculated'] are now rejected with a
 *     warning; state is not mutated. Previously any string was accepted silently.
 *
 *   LOG_PROJECT debug logging added throughout (set LOG_PROJECT=false to silence).
 *
 *   ADP priority chain comment updated: step 2 now reads `ahu.adp !== null`
 *   (was `ahu.adp > 0`) — matches the ahuSlice v2.2 change to null sentinel.
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

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ProjectState, RootState } from '../../utils/types';

// ── Debug logging ─────────────────────────────────────────────────────────────
//
// Set LOG_PROJECT = false to silence info/warn logs in production.
// console.error calls always fire regardless of this flag.
//
// Logging points:
//   [projectSlice] Initialized     — on module load, confirms all defaults
//   [projectSlice] updateAmbient   — elevation/latitude/dailyRange only (affect altCf and CLTD)
//   [projectSlice] updateSystemDesign adp   — before/after + dry-coil risk flag
//   [projectSlice] updateSystemDesign adpMode — mode change confirmation
//   [projectSlice] updateSystemDesign bypassFactor — affects coilAir and supplyDT globally
//   [projectSlice] updateSystemDesign safetyFactor/ductHeatGain — shows combined safetyMult
//   [projectSlice] resetProject    — on full reset
const LOG_PROJECT = true;

const _log  = (...a: any[]) => { if (LOG_PROJECT) console.log('[projectSlice]',    ...a); };
const _warn = (...a: any[]) => { if (LOG_PROJECT) console.warn('[projectSlice] ⚠', ...a); };

// ── System design defaults ────────────────────────────────────────────────────
const DEFAULT_SAFETY_FACTOR_PCT  = 10;    // %
const DEFAULT_DUCT_HEAT_GAIN_PCT = 5;     // % — SA duct heat gain & leak loss
const DEFAULT_BYPASS_FACTOR      = 0.10;  // dimensionless
const DEFAULT_ADP                = 45;    // °F — CHANGED from 55; see CHANGELOG v2.5
const DEFAULT_FAN_HEAT_PCT       = 5;     // % of sensible room load
const DEFAULT_RETURN_FAN_HEAT    = 5;     // % of supply fan heat
const DEFAULT_HUMID_TARGET       = 45;    // %RH — fallback when room.designRH unset

// ── String field whitelist ────────────────────────────────────────────────────
// Fields not in SYSTEM_DESIGN_BOUNDS are treated as string fields.
// Any value not listed here is REJECTED — state is not mutated.
// Add new string fields here when they are added to systemDesign.
const STRING_FIELD_ALLOWED: Record<string, readonly string[]> = {
  adpMode: ['manual', 'calculated'],
};

// ── Bounds definitions ────────────────────────────────────────────────────────
// Only NUMERIC fields appear here. String fields (adpMode) are intentionally
// absent — updateSystemDesign uses this absence to identify string fields.
type NumericBounds = Record<string, { min: number; max: number }>;

const SYSTEM_DESIGN_BOUNDS: NumericBounds = {
  safetyFactor:         { min: 0,    max: 50   },
  ductHeatGain:         { min: 0,    max: 15   },  // % — SA duct heat gain & leak
  bypassFactor:         { min: 0.01, max: 0.30 },
  // adp: hard lower = 32°F (freezing — DX/glycol systems can reach here).
  //      Soft warning at < 38°F (below typical CHW range) and > 50°F (dry-coil risk).
  adp:                  { min: 32,   max: 65   },  // °F
  fanHeat:              { min: 0,    max: 20   },
  returnFanHeat:        { min: 0,    max: 25   },
  humidificationTarget: { min: 0,    max: 95   },
};

const AMBIENT_BOUNDS: NumericBounds = {
  elevation:        { min: -1400, max: 30000 },
  latitude:         { min: -90,   max: 90    },
  dailyRange:       { min: 0,     max: 60    },
  dryBulbTemp:      { min: -60,   max: 60    },
  wetBulbTemp:      { min: -60,   max: 40    },
  relativeHumidity: { min: 0,     max: 100   },
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// ── Initial state ─────────────────────────────────────────────────────────────
const initialState: ProjectState = {
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

// Log once at module load (store creation) to confirm effective defaults.
_log(
  `Initialized — adp=${DEFAULT_ADP}°F (45°F = CHW default for tropical/cleanroom), ` +
  `adpMode=manual, bypassFactor=${DEFAULT_BYPASS_FACTOR}, ` +
  `safety=${DEFAULT_SAFETY_FACTOR_PCT}%, duct=${DEFAULT_DUCT_HEAT_GAIN_PCT}%, ` +
  `latitude=28°N (Delhi default), elevation=0m`
);

// ── Slice ─────────────────────────────────────────────────────────────────────
const projectSlice = createSlice({
  name: 'project',
  initialState,

  reducers: {
    updateProjectInfo: (state, action: PayloadAction<{ field: string; value: any }>) => {
      const { field, value } = action.payload;
      if (!(field in state.info)) {
        _warn(`updateProjectInfo: unknown field "${field}" — no-op`);
        return;
      }
      (state.info as any)[field] = typeof value === 'string' ? value.trim() : value;
    },

    updateAmbient: (state, action: PayloadAction<{ field: string; value: any }>) => {
      const { field, value } = action.payload;
      if (!(field in state.ambient)) {
        _warn(`updateAmbient: unknown field "${field}" — no-op`);
        return;
      }

      const parsed = parseFloat(value);
      const safe   = isNaN(parsed) ? ((state.ambient as any)[field] ?? 0) : parsed;
      const bounds = AMBIENT_BOUNDS[field];

      if (bounds) {
        const clamped = clamp(safe, bounds.min, bounds.max);
        if (clamped !== safe) {
          _warn(`updateAmbient: "${field}" = ${safe} clamped to [${bounds.min}, ${bounds.max}] → ${clamped}`);
        }

        // Log psychro-critical fields: these change altCf (affects ALL calculations)
        // or CLTD correction factors.
        if (field === 'elevation' || field === 'latitude' || field === 'dailyRange') {
          const prev = (state.ambient as any)[field];
          if (prev !== clamped) {
            _log(
              `updateAmbient: ${field} ${prev} → ${clamped}` +
              (field === 'elevation'
                ? ` — altCf and ALL psychrometric constants will change. rdsSelector recomputes all rooms.`
                : field === 'latitude'
                ? ` — CLTD latitude correction (LM) changes. Envelope gains will shift.`
                : ` — CLTD mean-temp correction changes.`)
            );
          }
        }

        (state.ambient as any)[field] = clamped;
      } else {
        (state.ambient as any)[field] = safe;
      }
    },

    /**
     * updateSystemDesign
     * { field, value }
     *
     * String fields (adpMode):
     *   Validated against STRING_FIELD_ALLOWED whitelist.
     *   Fields not present in SYSTEM_DESIGN_BOUNDS are treated as string fields.
     *   Invalid values are rejected with a warning — state is NOT mutated.
     *
     * Numeric fields:
     *   Parsed to float, clamped to SYSTEM_DESIGN_BOUNDS.
     *   Field-specific warnings for: adp dry-coil risk, adp < CHW range, safetyFactor = 0.
     *   Combined safetyMult is logged whenever safetyFactor or ductHeatGain changes.
     */
    updateSystemDesign: (state, action: PayloadAction<{ field: string; value: any }>) => {
      const { field, value } = action.payload;
      if (!(field in state.systemDesign)) {
        _warn(`updateSystemDesign: unknown field "${field}" — no-op`);
        return;
      }

      const bounds = SYSTEM_DESIGN_BOUNDS[field];

      // ── String field path ─────────────────────────────────────────────────
      // No bounds entry → this is a string field. Validate against whitelist.
      if (!bounds) {
        const allowed = STRING_FIELD_ALLOWED[field];
        if (allowed) {
          if (!allowed.includes(String(value))) {
            _warn(
              `updateSystemDesign: "${field}" = "${value}" is not a recognised value. ` +
              `Allowed: [${allowed.map(v => `"${v}"`).join(', ')}]. State NOT mutated.`
            );
            return;
          }
        }
        const prev = (state.systemDesign as any)[field];
        if (prev !== value) {
          _log(`updateSystemDesign: ${field} "${prev}" → "${value}"`);
          if (field === 'adpMode') {
            _log(
              `updateSystemDesign: adpMode change affects all AHUs without a per-AHU adpMode override. ` +
              `All rooms will recompute ADP on next selector pass.`
            );
          }
        }
        (state.systemDesign as any)[field] = value;
        return;
      }

      // ── Numeric field path ────────────────────────────────────────────────
      const parsed  = parseFloat(value);
      const safe    = isNaN(parsed) ? ((state.systemDesign as any)[field] ?? 0) : parsed;
      const clamped = clamp(safe, bounds.min, bounds.max);

      if (clamped !== safe) {
        _warn(
          `updateSystemDesign: "${field}" = ${safe} out of bounds [${bounds.min}, ${bounds.max}] — clamped to ${clamped}`
        );
      }

      // ── Field-specific warnings and diagnostics ───────────────────────────

      if (field === 'adp') {
        const prev = (state.systemDesign as any)['adp'];

        if (clamped < 38) {
          _warn(
            `updateSystemDesign: adp = ${clamped}°F is below the typical chilled-water coil ` +
            `range (38–55°F). Standard CHW supply at 6–8°C (43–46°F) achieves ADP ≈ 44–50°F. ` +
            `Values below 38°F require DX refrigerant or glycol coils. ` +
            `If intentional (DX/glycol system), this warning can be disregarded.`
          );
        }

        // Dry-coil risk: dew point of a 50%RH room at 72°F is ≈ 52°F.
        // Dew point of a 45%RH room at 72°F is ≈ 47°F.
        // ADP must be BELOW the dew point to condense moisture on the coil surface.
        if (clamped > 50) {
          _warn(
            `updateSystemDesign: adp = ${clamped}°F exceeds the dew point of rooms at ≥47%RH@72°F ` +
            `(dew point ≈ ${clamped > 52 ? '52' : '47'}°F). The coil will run DRY — no dehumidification. ` +
            `rdsSelector will report adpSufficient=insufficient for all affected rooms. ` +
            `For tropical/cleanroom projects: recommended range is 44–48°F (CHW) or 40–44°F (DX).`
          );
        }

        _log(
          `updateSystemDesign: adp ${prev}°F → ${clamped}°F — ` +
          `rdsSelector ADP chain will reflect this for all AHUs using the project default.`
        );
      }

      if (field === 'bypassFactor') {
        const prev = (state.systemDesign as any)['bypassFactor'];
        _log(
          `updateSystemDesign: bypassFactor ${prev} → ${clamped}. ` +
          `Affects coilAir = supplyAir × (1 − BF), supplyDT, and the ADP calculated-mode chain.`
        );
      }

      if (field === 'safetyFactor' || field === 'ductHeatGain') {
        const sf  = field === 'safetyFactor' ? clamped : state.systemDesign.safetyFactor;
        const dhg = field === 'ductHeatGain'  ? clamped : state.systemDesign.ductHeatGain;
        const combined = 1 + (sf + dhg) / 100;
        _log(
          `updateSystemDesign: ${field} → ${clamped}%. ` +
          `Combined safetyMult = 1 + (${sf} + ${dhg})/100 = ${combined.toFixed(4)}× ` +
          `(applied to rawSensible → ERSH in seasonalLoads).`
        );
      }

      if (field === 'safetyFactor' && clamped === 0) {
        _warn(
          `updateSystemDesign: safetyFactor = 0 — no safety margin will be applied. ` +
          `ASHRAE HOF recommends 5–15% for cooling load calculations.`
        );
      }

      if (field === 'humidificationTarget') {
        const prev = (state.systemDesign as any)['humidificationTarget'];
        _log(
          `updateSystemDesign: humidificationTarget ${prev}% → ${clamped}%. ` +
          `This is the FALLBACK only — rooms with an explicit designRH use that value instead.`
        );
      }

      (state.systemDesign as any)[field] = clamped;
    },

    resetProject: () => {
      _log('resetProject — all project state restored to defaults');
      return initialState;
    },
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

export const selectProjectInfo    = (state: RootState) => state.project.info;
export const selectAmbient        = (state: RootState) => state.project.ambient;
export const selectSystemDesign   = (state: RootState) => state.project.systemDesign;

export const selectElevation      = (state: RootState) => state.project.ambient.elevation;
export const selectLatitude       = (state: RootState) => state.project.ambient.latitude;
export const selectDailyRange     = (state: RootState) => state.project.ambient.dailyRange;
export const selectSafetyFactor   = (state: RootState) => state.project.systemDesign.safetyFactor;
export const selectDuctHeatGain   = (state: RootState) => state.project.systemDesign.ductHeatGain;
export const selectBypassFactor   = (state: RootState) => state.project.systemDesign.bypassFactor;
export const selectAdp            = (state: RootState) => state.project.systemDesign.adp;
export const selectFanHeat        = (state: RootState) => state.project.systemDesign.fanHeat;
export const selectReturnFanHeat  = (state: RootState) => state.project.systemDesign.returnFanHeat;
export const selectHumidTarget    = (state: RootState) => state.project.systemDesign.humidificationTarget;
export const selectIndustry       = (state: RootState) => state.project.info.industry;