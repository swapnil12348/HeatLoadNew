/**
 * heatingHumid.ts
 * Responsibility: Winter heating load and humidification system sizing.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ASHRAE Handbook — HVAC Systems & Equipment (2020), Chapter 22
 *            ASHRAE 62.1-2022 (minimum OA during heating)
 *            GMP Annex 1:2022 (pharma humidity control requirements)
 *            SEMI S2 (semiconductor fab humidity requirements)
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   BUG-HH-10 FIX — All numeric return fields converted from string to number.
 *
 *     heatingCap, heatingCapMBH, preheatCap, terminalHeatingCap, extraHeatingCap,
 *     hwFlowRate, chwFlowRate, humidDeltaGr, humidGrTarget, winterGrOut,
 *     mixedAirGr, humidLbsPerHr, and humidKw were all returned as strings
 *     (bare .toFixed() calls without parseFloat()). Root crash in rdsSelector:
 *
 *       rdsSelector.ts:733  TypeError: humidLbsPerHr?.toFixed is not a function
 *
 *     The ?. optional chain guards null / undefined but NOT other types.
 *     On a string, humidLbsPerHr?.toFixed → undefined; calling undefined(2)
 *     throws. The throw propagates to the per-room try/catch in rdsSelector,
 *     replacing the entire room row with { _error, _calculationFailed: true }.
 *
 *     Fix: every bare .toFixed() wrapped in parseFloat() throughout.
 *     HeatingHumidResult interface: all formerly-string numeric fields → number.
 *
 *     ⚠ Downstream consumers (RDSCellComponents, ResultsPage etc.) that used
 *       these fields as strings (e.g. display interpolation) will need to call
 *       .toFixed() at the presentation layer. TypeScript will flag those sites.
 *
 *   DIAG-HH-01 — Diagnostic console logging added throughout.
 *     Toggle with LOG_HH flag (~line 110). Mirrors rdsSelector.ts v2.10:
 *       console.log   — checkpoint summaries (inputs resolved, step outputs)
 *       console.warn  — suspicious but non-fatal (high loads, fallbacks taken)
 *       console.error — fatal: NaN in critical fields, impossible physics
 *     Checks added:
 *       INPUT-01 — parameter presence, range guards, climate null check
 *       INPUT-02 — psychro constants; winter climate resolution + shape check
 *       STEP1    — room heating load (heatingCapBTU, needsHeating)
 *       STEP2    — OA preheat load (preheatCapBTU, preheatDeltaT)
 *       STEP3    — hydronic flow rates preview (hwFlowRate, chwFlowRate)
 *       STEP4    — humidity ratios (winterGrOut, humidGrTarget, mixedAirGr)
 *       STEP5    — humidification load (humidLbsPerHr, humidKw, humidLoadBTU)
 *       FINAL    — NaN sweep across all critical outputs + summary log
 *
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   BUG-HH-07 FIX — grReturn: roomDesignRH → humidificationTarget.
 *     'roomDesignRH' was not a parameter of calculateHeatingHumid and was never
 *     assigned anywhere in the function body. At runtime this threw:
 *       ReferenceError: roomDesignRH is not defined
 *     The ReferenceError propagated through rdsSelector createSelector and
 *     crashed selectRdsData for any room on a recirculation AHU. For 100% OA
 *     systems (rcFrac = 0) grReturn × 0 = 0, masking the bug silently in
 *     purely 100% OA projects (pharma/semiconductor fabs).
 *     Fix: grReturn now uses humidificationTarget, which is already a parameter.
 *
 *   BUG-HH-09 FIX — Safe null guard on winter outdoor DB and RH.
 *     parseFloat(undefined) = NaN propagated into all downstream humidity
 *     ratio and preheat calculations when winter climate conditions were not
 *     yet entered. Guards now default to 45°F / 30%RH.
 *
 *   BUG-HH-08 FIX — chwFlowRate computed and returned.
 *     The return contract listed chwFlowRate but the assignment was missing.
 *     Note: rdsSelector.ts does not destructure chwFlowRate from this module
 *     (it uses pipes.chw.flowGPM from calculatePipeSizing instead, which is
 *     based on coilLoadBTU). The field is retained here for direct consumers
 *     but the basis differs — see pipeSizing.ts for the authoritative CHW flow.
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-HH-01 [CRITICAL]: altCf now applied to humidLbsPerHr.
 *   BUG-HH-02 [HIGH]: Constant naming ambiguity resolved (psychro.ts functions).
 *   BUG-HH-03 [HIGH]: ASHRAE.KW_TO_BTU replaced with KW_TO_BTU_HR from units.ts.
 *   BUG-HH-04 [MEDIUM]: Mixed-air humidification correction for recirc systems.
 *   BUG-HH-05 [MEDIUM]: Sub-5%RH humidification warning added.
 *   BUG-HH-06 [LOW]: GR_PER_LB imported from units.ts.
 *
 * ── HEATING LOAD COMPONENTS ──────────────────────────────────────────────────
 *
 *   1. Room transmission loss (envelope)
 *      Already computed in seasonalLoads.ts for the 'winter' season.
 *      ERSH_winter < 0 → net heat loss → room needs heating.
 *      ERSH_winter ≥ 0 → internal gains exceed heat loss → no room heater.
 *
 *   2. Outdoor air preheat load (coil load, not room load)
 *      Q_preheat = Cs × CFM_OA × (T_room − T_outdoor_winter)
 *      Fresh air must be heated from outdoor temp to supply air temp.
 *
 *   3. Terminal reheat
 *      After coil cooling, supply air may need reheating in winter to maintain
 *      the room setpoint. Sized to offset net room heat loss.
 *
 * ── HUMIDIFICATION LOAD ───────────────────────────────────────────────────────
 *
 *   Method: Supply-air humidification — isothermal steam (ASHRAE Ch.22)
 *
 *   FORMULA:
 *   ─────────
 *   ṁ_air  (lb_dry/hr) = CFM × 60 min/hr × ρ_site
 *                       = CFM × 60 × 0.075 × altCf       [lb_dry_air/hr]
 *   ṁ_water(lb/hr)     = ṁ_air × Δgr / 7000
 *                       = CFM × 4.5 × altCf × Δgr / 7000
 *
 *   kW_steam = lb/hr × 0.634  [total electrical input — latent + sensible to
 *                               boiling + ~50% element losses. NOT latent-only.
 *                               Verify constant against Excel before release.]
 *
 *   Reference:
 *     ASHRAE HOF 2021 Ch.1 — ṁ_air = CFM × 60 × ρ
 *     ASHRAE HVAC S&E 2020 Ch.22 — humidification load = ṁ_air × Δω
 *
 * ── PIPE SIZING PREVIEW ───────────────────────────────────────────────────────
 *
 *   CHW flow (GPM) = Q_cooling (BTU/hr) / (500 × ΔT_chw)  ΔT_chw = 10°F
 *   HW  flow (GPM) = Q_heating (BTU/hr) / (500 × ΔT_hw)   ΔT_hw  = 20°F
 *   Authoritative pipe sizing lives in pipeSizing.ts.
 *
 * SIGN CONVENTION:
 *   heatingCapBTU is always positive (magnitude of heat loss).
 *   Callers determine whether to apply as preheat, reheat, or terminal heat.
 */

import { calculateGrains, sensibleFactor, latentFactor } from '../../utils/psychro';
import { GR_PER_LB, KW_TO_BTU_HR }                       from '../../utils/units';
import { ClimateState }                                   from '../../utils/types';

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic logging
// ─────────────────────────────────────────────────────────────────────────────
//
// Set LOG_HH = false to silence info/warn logs in production.
// console.error calls are always active — they indicate data integrity failures.
const LOG_HH = true;

const _log  = (...a: any[]) => { if (LOG_HH) console.log('[heatingHumid]',      ...a); };
const _warn = (...a: any[]) => { if (LOG_HH) console.warn('[heatingHumid] ⚠',   ...a); };
const _err  = (...a: any[]) =>               console.error('[heatingHumid] ✗',  ...a);

/**
 * Checks that val is a finite number.
 * Logs console.error and returns true when the check fails.
 * Use for fields where NaN would silently corrupt downstream arithmetic.
 */
const _badNum = (val: any, field: string): boolean => {
  if (typeof val !== 'number' || !isFinite(val)) {
    _err(`NaN/invalid  field="${field}"  got=${JSON.stringify(val)}`);
    return true;
  }
  return false;
};

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HeatingHumidResult
 *
 * v2.2+: All numeric fields are numbers.
 * Prior to v2.2 many fields were strings (.toFixed() without parseFloat()).
 * See BUG-HH-10 in the changelog above.
 *
 * Units are documented on each field. Presentation layers (RDSCellComponents,
 * ResultsPage, etc.) should call .toFixed() for display rather than relying on
 * pre-formatted strings from this module.
 */
export interface HeatingHumidResult {
  // ── Heating ──────────────────────────────────────────────────────────────
  heatingCapBTU:          number;  // BTU/hr — magnitude of room heat loss
  heatingCap:             number;  // kW     — terminal heater size
  heatingCapMBH:          number;  // MBH    — same in thousand BTU/hr
  preheatCapBTU:          number;  // BTU/hr — OA preheat coil load
  preheatCap:             number;  // kW     — preheat coil capacity
  terminalHeatingCap:     number;  // kW     — alias of heatingCap (terminal unit)
  extraHeatingCap:        number;  // kW     — heatingCap × 1.10 design margin
  needsHeating:           boolean;

  // ── Hydronic flows (preview — see pipeSizing.ts for RDS authoritative) ──
  hwFlowRate:             number;  // GPM — room HW circuit (not preheat coil)
  chwFlowRate:            number;  // GPM — CHW preview; pipeSizing.ts is canonical

  // ── Humidification ────────────────────────────────────────────────────────
  humidDeltaGr:           number;  // gr/lb — moisture the humidifier must add
  humidGrTarget:          number;  // gr/lb — indoor target at (dbInF, humidTarget%)
  winterGrOut:            number;  // gr/lb — outdoor humidity ratio at winter design
  mixedAirGr:             number;  // gr/lb — blended stream entering the humidifier
  humidLbsPerHr:          number;  // lb/hr — steam humidifier capacity (was string v2.1)
  humidKw:                number;  // kW    — humidifier electrical input (was string v2.1)
  humidLoadBTU:           number;  // BTU/hr — latent humidification coil load
  needsHumidification:    boolean;
  highHumidificationLoad: boolean;
  humidWarning:           string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AIR_MASS_FACTOR
 * Converts volumetric airflow (CFM) to mass flow of dry air (lb_dry_air/hr)
 * at standard sea-level conditions.
 *
 * Derivation:
 *   60 min/hr × 0.075 lb/ft³ (std air density at ~70°F, sea level)
 *   = 4.5 lb_dry_air / (hr · CFM)
 *
 * At altitude, multiply by altCf (site density / sea-level density).
 * This constant is also used by outdoorAirLoad.ts — single source of truth.
 *
 * Source: ASHRAE HOF 2021, Ch.28
 */
export const AIR_MASS_FACTOR = 60 * 0.075; // = 4.5

/**
 * STEAM_KW_PER_LB_HR
 * Total electrical input factor for electric isothermal steam humidifiers.
 *
 * Breakdown (approximate):
 *   Latent heat of vaporisation at 212°F  ≈ 0.285 kW/(lb/hr)
 *   Sensible heat feed water to boiling   ≈ 0.044 kW/(lb/hr)
 *   Element losses + standby (~50%)       ≈ 0.305 kW/(lb/hr)
 *   ──────────────────────────────────────────────────
 *   Total                                 ≈ 0.634 kW/(lb/hr)
 *
 * ⚠ Verify against project Excel. If the workbook uses 0.285 (latent only),
 *   this overstates humidifier kW by ~2×. Change this constant to match.
 *
 * Source: ASHRAE HVAC Systems & Equipment 2020, Ch.22 §4 (electric steam)
 */
const STEAM_KW_PER_LB_HR = 0.634;

/** Standard hydronic ΔT for flow rate preview sizing */
const CHW_DELTA_T_F    = 10;   // °F (chilled water)
const HW_DELTA_T_F     = 20;   // °F (hot water)

/**
 * HYDRONIC_CONSTANT
 * 60 min/hr × 8.33 lb/gal × 1 BTU/lb·°F (specific heat of water)
 * Used in: GPM = Q_BTU_hr / (HYDRONIC_CONSTANT × ΔT_F)
 */
const HYDRONIC_CONSTANT = 500;

/**
 * HIGH_HUMID_DELTA_GR
 * Δgr threshold (gr/lb) above which humidification load is flagged as high.
 * 40 gr/lb ≈ indoor 5%RH at 70°F vs dry outdoor conditions.
 * Above this threshold, steam capacity, manifold sizing, and startup
 * sequencing need specialist review.
 */
const HIGH_HUMID_DELTA_GR = 40;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * resolveWinterOutdoor()
 *
 * Resolves the winter outdoor conditions object from the Redux climate state.
 *
 * BUG-HH-11: v2.1 used climate.outside.winter; rdsSelector.ts uses
 * climate.winter directly (and reports INPUT-01 errors when these top-level
 * keys are missing). This helper tries both paths and logs which one wins,
 * so the discrepancy is visible in the console while climateSlice is being
 * audited.
 *
 * Access priority:
 *   1. climate.winter           — canonical (matches rdsSelector.ts)
 *   2. climate.outside.winter   — legacy (from v2.0 slice shape)
 *   3. {}                       — neither found; callers use defaults
 *
 * @returns { source, data } where source is a diagnostic string for logging.
 */
// AFTER
const resolveWinterOutdoor = (
  climate: ClimateState | null | undefined
): { source: string; data: Record<string, any> } => {
  if (!climate) {
    return { source: 'missing', data: {} };
  }

  const c = climate as any;

  // Path 1 — correct current shape: climate.outside.winter = { db, rh, ... }
  // This matches climateSlice.ts which stores seasons under climate.outside.{season}.
  if (c.outside?.winter && typeof c.outside.winter === 'object') {
    return { source: 'climate.outside.winter', data: c.outside.winter };
  }

  // Path 2 — alternative flat shape: climate.winter = { db, rh, ... }
  // Retained as a forward-compatibility fallback if climateSlice is ever restructured.
  if (c.winter && typeof c.winter === 'object') {
    return { source: 'climate.winter (flat alt)', data: c.winter };
  }

  return { source: 'not_found', data: {} };
};
// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calculateHeatingHumid()
 *
 * Computes winter heating capacity and humidification load for one room.
 * Primary consumer: rdsSelector.ts (called once per room in rooms.map()).
 *
 * @param ershWinter            ERSH for winter season (BTU/hr, signed).
 *                              Negative  = net heat loss → room needs heating.
 *                              Positive  = internal gains exceed losses → no heater.
 * @param supplyAir             Total supply air CFM.
 * @param freshAirCFM           Outdoor air CFM (from airQuantities.ts).
 * @param climate               Full climate Redux state (ClimateState).
 * @param dbInF                 Room design dry-bulb temperature (°F).
 * @param humidificationTarget  Target indoor RH% for winter humidification sizing.
 * @param altCf                 Altitude correction factor (dimensionless, ≤ 1.0).
 * @param elevation             Site elevation in feet. Default 0 (sea level).
 * @param grandTotal            Total cooling load BTU/hr — used for CHW flow preview.
 * @param recirculationFraction Fraction of supply air that is recirculated return air.
 *                              0.0 = 100% OA system (pharma/semiconductor fabs).
 *                              0.8 = 80% recirculation (typical comfort AHU).
 *                              Default 0 is conservative (max humidification load).
 */
export const calculateHeatingHumid = (
  ershWinter:            number,
  supplyAir:             number,
  freshAirCFM:           number,
  climate:               ClimateState,
  dbInF:                 number,
  humidificationTarget:  number,
  altCf:                 number,
  elevation:             number = 0,
  grandTotal:            number = 0,
  recirculationFraction: number = 0,
): HeatingHumidResult => {

  // Wrap everything in a collapsible console group (mirrors rdsSelector.ts).
  // The finally block ensures groupEnd() fires even if an exception is thrown.
  if (LOG_HH) console.group('[heatingHumid] ── calculateHeatingHumid ──');

  try {

    // ══════════════════════════════════════════════════════════════════════════
    // INPUT-01 — Parameter validation
    // ══════════════════════════════════════════════════════════════════════════
    _log(
      `INPUT-01: ershWinter=${ershWinter} | supplyAir=${supplyAir} CFM | ` +
      `freshAirCFM=${freshAirCFM} | dbInF=${dbInF}°F | ` +
      `humidTarget=${humidificationTarget}%RH | altCf=${altCf} | ` +
      `elevation=${elevation}ft | grandTotal=${grandTotal} BTU/hr | ` +
      `rcFrac=${recirculationFraction}`
    );

    // Numeric type guards — log errors but do not throw; defaults keep math finite.
    if (_badNum(ershWinter,           'ershWinter'))           { /* logged */ }
    if (_badNum(supplyAir,            'supplyAir'))            { /* logged */ }
    if (_badNum(freshAirCFM,          'freshAirCFM'))          { /* logged */ }
    if (_badNum(dbInF,                'dbInF'))                { /* logged */ }
    if (_badNum(humidificationTarget, 'humidificationTarget')) { /* logged */ }
    if (_badNum(altCf,                'altCf'))                { /* logged */ }

    if (!climate) {
      _err('INPUT-01: climate is null/undefined — winter preheat + humidification will use 45°F / 30%RH fallbacks');
    }

    if (supplyAir <= 0) {
      _warn(`INPUT-01: supplyAir=${supplyAir} CFM — humidification load will be 0 (no airflow to humidify)`);
    }

    if (freshAirCFM < 0) {
      _err(`INPUT-01: freshAirCFM=${freshAirCFM} CFM is negative — preheat load will be wrong. Check airQuantities.ts.`);
    }

    if (humidificationTarget < 1 || humidificationTarget > 95) {
      _warn(
        `INPUT-01: humidificationTarget=${humidificationTarget}%RH is outside 1–95% range. ` +
        `Check room.designRH or projectSlice.humidificationTarget.`
      );
    }

    if (humidificationTarget < 5) {
      _warn(
        `INPUT-01: humidificationTarget=${humidificationTarget}%RH — battery dry-room or ultra-low-humidity space. ` +
        `Expect very high humidification loads and a highHumidificationLoad flag.`
      );
    }

    if (recirculationFraction < 0 || recirculationFraction > 1) {
      _warn(
        `INPUT-01: recirculationFraction=${recirculationFraction} is outside [0,1] — clamped. ` +
        `0 = 100% OA, 1 = 100% recirc (no OA, impossible in practice).`
      );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // INPUT-02 — Psychro constants + winter climate conditions
    // ══════════════════════════════════════════════════════════════════════════
    const Cs = sensibleFactor(elevation);
    const Cl = latentFactor(elevation);

    if (_badNum(Cs, 'Cs')) { /* logged */ }
    if (_badNum(Cl, 'Cl')) { /* logged */ }

    _log(`INPUT-02: Cs=${Cs?.toFixed(4)}, Cl=${Cl?.toFixed(4)}, altCf=${altCf?.toFixed(4)}`);
    // BUG-HH-12 DETECT — elevation/altCf unit-mismatch cross-check.
// sensibleFactor(elevation), latentFactor(elevation), and calculateGrains() all
// expect elevation in FEET. If the caller (computeRdsRow.ts) passed metres,
// Cs/Cl will be near-sea-level while the correctly-computed altCf will reflect
// the true altitude.
//
// Formula: altCf ≈ exp(−elev_ft / 26132)  [ASHRAE ISA, accurate to ±1% < 15 000 ft]
//   Delhi  (   0 ft) → 1.000
//   Hyderabad(1778 ft)→ 0.935
//   Bangalore(2953 ft)→ 0.906   ← 900 m correctly converted
//   900 as feet      → 0.967   ← wrong: 61 pt delta fires the warning
//
// Tolerance 0.05 catches the Bangalore case (Δ ≈ 0.061) while ignoring
// sea-level rounding noise (Δ < 0.001 at 0 ft).
if (elevation > 0 && isFinite(altCf)) {
  const altCfExpected = Math.exp(-elevation / 26132);
  const altCfDelta    = Math.abs(altCfExpected - altCf);
  if (altCfDelta > 0.05) {
    _warn(
      `INPUT-02 ⚠ BUG-HH-12: elevation/altCf unit mismatch suspected. ` +
      `elevation=${elevation} (treated as ft) → altCf_expected=${altCfExpected.toFixed(4)}; ` +
      `passed altCf=${altCf.toFixed(4)} (Δ=${altCfDelta.toFixed(4)} > 0.05). ` +
      `If elevation is stored in metres in Redux, computeRdsRow.ts must convert: ` +
      `elevationFt = elevation_m × 3.28084 before calling calculateHeatingHumid. ` +
      `P1 BUG-HH-12 — see also selectElevation in rdsSelector.ts.`
    );
  } else {
    _log(
      `INPUT-02: elevation/altCf cross-check OK — ` +
      `altCf_expected=${altCfExpected.toFixed(4)} vs passed=${altCf.toFixed(4)} ` +
      `(Δ=${altCfDelta.toFixed(4)} ≤ 0.05)`
    );
  }
}

    // BUG-HH-11: resilient winter climate access — try canonical path first
    const { source: climateSource, data: winterOut } = resolveWinterOutdoor(climate);

    if (climateSource === 'missing') {
      _err('INPUT-02: climate object is null/undefined. Using 45°F / 30%RH fallbacks for ALL winter calculations.');
    } else if (climateSource === 'not_found') {
      _err(
        'INPUT-02: winter outdoor conditions found at neither climate.winter nor climate.outside.winter. ' +
        'Falling back to 45°F / 30%RH. ' +
        'ACTION: check climateSlice.ts — seasons should be stored as top-level keys: ' +
        '{ winter: { db, rh, wb }, summer: {...}, monsoon: {...} }.'
      );
    } else {
      _log(`INPUT-02: winter data resolved from "${climateSource}"`);
    }

    // Parse winter outdoor DB and RH with fallback defaults (BUG-HH-09)
    const parsedWinterDb = parseFloat(String(winterOut.db));
    const winterDbOut    = !isNaN(parsedWinterDb) ? parsedWinterDb : 45;

    const parsedWinterRh = parseFloat(String(winterOut.rh));
    const winterRhOut    = !isNaN(parsedWinterRh) ? parsedWinterRh : 30;

    if (isNaN(parsedWinterDb)) {
      _warn(`INPUT-02: winterOut.db="${winterOut.db}" is not a valid number — using fallback 45°F`);
    }
    if (isNaN(parsedWinterRh)) {
      _warn(`INPUT-02: winterOut.rh="${winterOut.rh}" is not a valid number — using fallback 30%RH`);
    }

    if (winterDbOut > 60) {
      _warn(
        `INPUT-02: winterDbOut=${winterDbOut}°F — unusually warm winter outdoor temp. ` +
        `Preheat load may be zero or negative. Verify climate data.`
      );
    }
    if (winterDbOut < -20) {
      _warn(`INPUT-02: winterDbOut=${winterDbOut}°F — extreme cold. Expect very large preheat and humidification loads.`);
    }

    _log(`INPUT-02: winterDbOut=${winterDbOut}°F, winterRhOut=${winterRhOut}%RH (source: ${climateSource})`);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 1 — Room heating load
    // ══════════════════════════════════════════════════════════════════════════
    //
    //   ERSH_winter < 0 → net heat loss → room heater required
    //   ERSH_winter ≥ 0 → internal gains ≥ heat loss → no room heater
    //
    //   Sign contract: heatingCapBTU is always ≥ 0 (magnitude).
    //   Callers label it as terminal heat, preheat, or reheat as appropriate.
    const winterSensLoss = Math.min(0, ershWinter || 0);
    const heatingCapBTU  = Math.abs(winterSensLoss);
    const needsHeating   = heatingCapBTU > 0;

    // BUG-HH-10: parseFloat() wraps all .toFixed() calls so values are numbers.
    const heatingCap         = parseFloat((heatingCapBTU / KW_TO_BTU_HR).toFixed(2));
    const heatingCapMBH      = parseFloat((heatingCapBTU / 1000).toFixed(2));
    const terminalHeatingCap = heatingCap;                                         // alias
    const extraHeatingCap    = parseFloat((heatingCap * 1.1).toFixed(2));         // +10% margin

    _log(
      `STEP1: needsHeating=${needsHeating} | ` +
      `ershWinter=${Math.round(ershWinter)} BTU/hr | ` +
      `heatingCapBTU=${Math.round(heatingCapBTU)} BTU/hr | ` +
      `heatingCap=${heatingCap} kW | heatingCapMBH=${heatingCapMBH} MBH | ` +
      `extraHeatingCap=${extraHeatingCap} kW (+10% margin)`
    );

    if (needsHeating && heatingCapBTU > 100_000) {
      _warn(
        `STEP1: heatingCapBTU=${Math.round(heatingCapBTU)} BTU/hr (${heatingCap} kW) is very large. ` +
        `Verify room envelope U-values, winterDbOut=${winterDbOut}°F, and room.designTemp.`
      );
    }

    if (!needsHeating && ershWinter > 0) {
      _log(`STEP1: room is heat-gain positive in winter (ERSH=${Math.round(ershWinter)} BTU/hr) — no terminal heater required`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 2 — OA preheat load
    // ══════════════════════════════════════════════════════════════════════════
    //
    //   Q_preheat = Cs × CFM_OA × (T_room − T_outdoor_winter)
    //
    //   This is a COIL load, not a room load. It represents the heat the
    //   preheat coil must supply to bring fresh OA from outdoor temp up to
    //   the room/supply design temperature before distribution.
    //
    //   preheatDeltaT is clamped to ≥ 0: if outdoor is warmer than the room
    //   (e.g. mild climate), there is no preheat requirement.
    const preheatDeltaT = Math.max(0, dbInF - winterDbOut);
    const preheatCapBTU = Math.round(Cs * (freshAirCFM || 0) * preheatDeltaT);
    const preheatCap    = parseFloat((preheatCapBTU / KW_TO_BTU_HR).toFixed(2));

    _log(
      `STEP2: preheatDeltaT=${preheatDeltaT.toFixed(1)}°F | ` +
      `freshAirCFM=${Math.round(freshAirCFM || 0)} | ` +
      `Cs=${Cs.toFixed(4)} | ` +
      `preheatCapBTU=${preheatCapBTU} BTU/hr | preheatCap=${preheatCap} kW`
    );

    if (preheatDeltaT === 0) {
      _warn(
        `STEP2: preheatDeltaT=0 — winter outdoor (${winterDbOut}°F) ≥ room setpoint (${dbInF}°F). ` +
        `No preheat needed. If this is unexpected, check climate data.`
      );
    }

    if (preheatCapBTU > 200_000) {
      _warn(
        `STEP2: preheatCapBTU=${preheatCapBTU} BTU/hr is very large. ` +
        `Verify freshAirCFM=${Math.round(freshAirCFM)} and winterDbOut=${winterDbOut}°F.`
      );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 3 — Hydronic flow rate preview
    // ══════════════════════════════════════════════════════════════════════════
    //
    //   GPM = Q_BTU_hr / (HYDRONIC_CONSTANT × ΔT_F)
    //
    //   hwFlowRate  — room HW terminal circuit (heater coil, not preheat)
    //   chwFlowRate — cooling coil CHW preview; rdsSelector uses
    //                 pipeSizing.ts (coilLoadBTU basis) for the canonical value
    const hwFlowRate = heatingCapBTU > 0
      ? parseFloat((heatingCapBTU / (HYDRONIC_CONSTANT * HW_DELTA_T_F)).toFixed(1))
      : 0;

    const chwFlowRate = grandTotal > 0
      ? parseFloat((grandTotal / (HYDRONIC_CONSTANT * CHW_DELTA_T_F)).toFixed(1))
      : 0;

    _log(
      `STEP3: hwFlowRate=${hwFlowRate} GPM (HW ΔT=${HW_DELTA_T_F}°F) | ` +
      `chwFlowRate=${chwFlowRate} GPM (CHW ΔT=${CHW_DELTA_T_F}°F, grandTotal=${Math.round(grandTotal)} BTU/hr)`
    );

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 4 — Humidity ratios
    // ══════════════════════════════════════════════════════════════════════════
    //
    //   winterGrOut  — outdoor humidity ratio at winter design DB + RH
    //   humidGrTarget — indoor target humidity ratio (room operating setpoint)
    //   mixedAirGr   — humidity of the blended air stream entering the humidifier
    //
    //   For 100% OA (rcFrac = 0, default):
    //     mixedAirGr = winterGrOut  ← identical to v1.x behaviour
    //
    //   For recirculation systems (rcFrac > 0):
    //     mixedAirGr = gr_OA × (1 − rcFrac) + gr_return × rcFrac
    //     Return air is at steady-state room conditions = humidification target.
    //     grReturn === humidGrTarget — no separate calculateGrains call needed.

    const winterGrOut   = calculateGrains(winterDbOut, winterRhOut, elevation);
    const humidGrTarget = calculateGrains(dbInF, humidificationTarget, elevation);

    if (_badNum(winterGrOut,   'winterGrOut'))   { /* logged */ }
    if (_badNum(humidGrTarget, 'humidGrTarget')) { /* logged */ }

    // rcFrac clamped to [0, 1]
    const rcFrac    = Math.min(1, Math.max(0, recirculationFraction || 0));
    const mixedAirGr = winterGrOut * (1 - rcFrac) + humidGrTarget * rcFrac;

    if (_badNum(mixedAirGr, 'mixedAirGr')) { /* logged */ }

    _log(
      `STEP4: winterGrOut=${winterGrOut.toFixed(2)} gr/lb | ` +
      `humidGrTarget=${humidGrTarget.toFixed(2)} gr/lb | ` +
      `rcFrac=${rcFrac.toFixed(2)} | mixedAirGr=${mixedAirGr.toFixed(2)} gr/lb`
    );

    if (winterGrOut > humidGrTarget) {
      _warn(
        `STEP4: winterGrOut=${winterGrOut.toFixed(2)} > humidGrTarget=${humidGrTarget.toFixed(2)} gr/lb — ` +
        `outdoor air is WETTER than the indoor target in winter. ` +
        `Δgr will be 0 and needsHumidification will be false. ` +
        `Verify humidificationTarget=${humidificationTarget}%RH and winter outdoor conditions.`
      );
    }

    if (humidGrTarget > 130) {
      _warn(`STEP4: humidGrTarget=${humidGrTarget.toFixed(1)} gr/lb seems very high — verify dbInF=${dbInF}°F and humidificationTarget=${humidificationTarget}%RH`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 5 — Humidification load
    // ══════════════════════════════════════════════════════════════════════════
    //
    //   Δgr          = max(0, gr_target − gr_mixed_air)
    //   ṁ_water(lb/hr) = CFM × AIR_MASS_FACTOR × altCf × Δgr / GR_PER_LB
    //   kW_steam     = ṁ_water × STEAM_KW_PER_LB_HR
    //   Q_l (BTU/hr) = Cl × CFM_supply × Δgr   (latent load basis)
    //
    //   BUG-HH-01 (v2.0): altCf corrects AIR_MASS_FACTOR for site air density.
    //   BUG-HH-10 (v2.2): parseFloat() wraps — returns number, not string.

    const humidDeltaGr        = Math.max(0, humidGrTarget - mixedAirGr);
    const needsHumidification = humidDeltaGr > 0;

    const humidLbsPerHr = (supplyAir > 0 && needsHumidification)
      ? parseFloat(((supplyAir * humidDeltaGr * AIR_MASS_FACTOR * altCf) / GR_PER_LB).toFixed(2))
      : 0;

    // humidLbsPerHr is now a number — no parseFloat() needed before multiplication
    const humidKw = parseFloat((humidLbsPerHr * STEAM_KW_PER_LB_HR).toFixed(2));

    const humidLoadBTU = (supplyAir > 0 && needsHumidification)
      ? Math.round(Cl * supplyAir * humidDeltaGr)
      : 0;

    if (_badNum(humidLbsPerHr, 'humidLbsPerHr')) { /* logged */ }
    if (_badNum(humidKw,       'humidKw'))        { /* logged */ }
    if (_badNum(humidLoadBTU,  'humidLoadBTU'))   { /* logged */ }

    _log(
      `STEP5: needsHumidification=${needsHumidification} | ` +
      `humidDeltaGr=${humidDeltaGr.toFixed(2)} gr/lb | ` +
      `humidLbsPerHr=${humidLbsPerHr.toFixed(2)} lb/hr | ` +
      `humidKw=${humidKw.toFixed(2)} kW | ` +
      `humidLoadBTU=${humidLoadBTU} BTU/hr`
    );

    if (needsHumidification && humidLbsPerHr > 500) {
      _warn(
        `STEP5: humidLbsPerHr=${humidLbsPerHr.toFixed(1)} lb/hr is very high. ` +
        `Verify supplyAir=${Math.round(supplyAir)} CFM and humidDeltaGr=${humidDeltaGr.toFixed(1)} gr/lb.`
      );
    }

    if (needsHumidification && humidKw > 300) {
      _warn(`STEP5: humidKw=${humidKw.toFixed(1)} kW — verify electrical supply and humidifier capacity`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 6 — Warnings
    // ══════════════════════════════════════════════════════════════════════════
    //   Flag conditions that need specialist engineering review at the RDS level.

    const highHumidificationLoad = humidDeltaGr > HIGH_HUMID_DELTA_GR;
    let humidWarning: string | null = null;

    if (highHumidificationLoad) {
      humidWarning =
        `High humidification load: Δgr = ${humidDeltaGr.toFixed(1)} gr/lb ` +
        `(threshold ${HIGH_HUMID_DELTA_GR} gr/lb). ` +
        `This indicates a sub-5%RH target combined with dry winter outdoor conditions. ` +
        `Verify steam supply capacity, manifold sizing, and AHU humidifier section length. ` +
        `Consider a chilled-mirror or optical dew-point instrument for setpoint control — ` +
        `standard capacitive RH sensors are not accurate below ~10%RH.`;
      _warn(`STEP6: HIGH load flag set — ${humidWarning}`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FINAL — NaN sweep across all critical output fields
    // ══════════════════════════════════════════════════════════════════════════
    const criticalOutputs: Record<string, any> = {
      heatingCapBTU,
      heatingCap,
      heatingCapMBH,
      preheatCapBTU,
      preheatCap,
      hwFlowRate,
      chwFlowRate,
      winterGrOut,
      humidGrTarget,
      mixedAirGr,
      humidDeltaGr,
      humidLbsPerHr,
      humidKw,
      humidLoadBTU,
    };

    let hasNaN = false;
    for (const [k, v] of Object.entries(criticalOutputs)) {
      if (_badNum(v, k)) hasNaN = true;
    }

    if (!hasNaN) {
      _log(
        `✅ OK — heatingCapBTU=${Math.round(heatingCapBTU)} | ` +
        `preheatCapBTU=${preheatCapBTU} | ` +
        `humidLbsPerHr=${humidLbsPerHr.toFixed(2)} lb/hr | ` +
        `humidKw=${humidKw.toFixed(2)} kW | ` +
        `needsHeating=${needsHeating} | ` +
        `needsHumidification=${needsHumidification} | ` +
        `highLoad=${highHumidificationLoad}`
      );
    } else {
      _err('FINAL: NaN detected in critical output fields — this room\'s heating/humidification data is unreliable');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ASSEMBLE — return HeatingHumidResult
    // ══════════════════════════════════════════════════════════════════════════
    return {
      // ── Heating ────────────────────────────────────────────────────────────
      heatingCapBTU,
      heatingCap,
      heatingCapMBH,
      preheatCapBTU,
      preheatCap,
      terminalHeatingCap,
      extraHeatingCap,
      needsHeating,

      // ── Hydronic flows ──────────────────────────────────────────────────────
      hwFlowRate,
      chwFlowRate,

      // ── Humidification ──────────────────────────────────────────────────────
      humidDeltaGr,
      humidGrTarget,
      winterGrOut,
      mixedAirGr,
      humidLbsPerHr,   // number (v2.2) — was string in v2.1 (crash fix BUG-HH-10)
      humidKw,          // number (v2.2) — was string in v2.1 (crash fix BUG-HH-10)
      humidLoadBTU,
      needsHumidification,

      // ── Warnings ────────────────────────────────────────────────────────────
      highHumidificationLoad,
      humidWarning,
    };

  } finally {
    // Always close the group — even if an exception propagates to rdsSelector.
    if (LOG_HH) console.groupEnd();
  }
};