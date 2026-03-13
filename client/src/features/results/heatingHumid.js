/**
 * heatingHumid.js
 * Responsibility: Winter heating load and humidification system sizing.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ASHRAE Handbook — HVAC Systems & Equipment (2020), Chapter 22
 *            ASHRAE 62.1-2022 (minimum OA during heating)
 *            GMP Annex 1:2022 (pharma humidity control requirements)
 *            SEMI S2 (semiconductor fab humidity requirements)
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   BUG-HH-07 [CRITICAL — ReferenceError]: roomDesignRH → humidificationTarget.
 *
 *     In the BUG-HH-04 mixed-air correction block, grReturn was computed as:
 *       const grReturn = calculateGrains(dbInF, roomDesignRH, elevation);
 *
 *     'roomDesignRH' is not a parameter of calculateHeatingHumid and was never
 *     assigned anywhere in the function body. At runtime this throws:
 *       ReferenceError: roomDesignRH is not defined
 * const winterDbOut = !isNaN(parsedWinterDb) ? parsedWinterDb : 45;   // BUG-HH-09 FIX
const winterRhOut = !isNaN(parsedWinterRh) ? parsedWinterRh : 30;   // BUG-HH-09 FIX
 *
 *     The ReferenceError propagates through the rdsSelector createSelector call
 *     and crashes the entire selectRdsData output for any room on any
 *     recirculation AHU (recirculationFraction > 0). For 100% OA systems
 *     (rcFrac = 0) the mixed-air branch still executes but grReturn × 0 = 0
 *     so the NaN from roomDesignRH is multiplied by 0 — masking the bug
 *     in purely 100% OA projects like pharma/semiconductor fabs.
 *
 *     Fix: roomDesignRH → humidificationTarget.
 *
 *     Basis: BUG-HH-04 comment documents "Return air grains ≈ room target
 *     grains (steady state assumption)." In steady state, the return air
 *     leaving the room is at the room's operating RH — which is the
 *     humidification target for winter sizing. humidificationTarget is
 *     already a parameter of this function.
 *
 *
 *     The return object referenced chwFlowRate but the assignment line was
 *     missing from the function body (blank line where the computation
 *     should have been). rdsSelector.js doesn't destructure chwFlowRate from
 *     heatHumid (it uses pipes.chw.flowGPM from calculatePipeSizing instead),
 *     so this didn't crash — but the return contract was broken and the field
 *     was silently undefined for any consumer that did read it.
 *
 *     Fix: chwFlowRate computed from grandTotal using the same hydronic
 *     constant and CHW_DELTA_T_F already defined in this module.
 *
 * ── CHANGELOG v2.0 ────────────────────────────────────────────────────────────
 *
 *   BUG-HH-01 [CRITICAL]: altCf now applied to humidLbsPerHr.
 *     The comment said "altitude effect captured in altCf" but altCf was never
 *     actually multiplied into the formula. The air mass factor (4.5 lb/ft³/hr
 *     per CFM) is based on sea-level density. At altitude, density is lower —
 *     altCf corrects this.
 *
 *     Old: CFM × Δgr × 4.5 / 7000          ← sea-level density assumed always
 *     New: CFM × Δgr × 4.5 × altCf / 7000  ← actual site density
 *
 *     Impact by elevation:
 *       Hyderabad  (1,755 ft, altCf=0.942): was overstating humidifier by  6%
 *       Denver     (5,280 ft, altCf=0.832): was overstating humidifier by 20%
 *       Mexico City(7,382 ft, altCf=0.782): was overstating humidifier by 28%
 *
 *   BUG-HH-02 [HIGH]: Constant naming ambiguity resolved.
 *     Old code used ASHRAE.SENSIBLE_FACTOR and ASHRAE.LATENT_FACTOR — names
 *     inconsistent with psychro.js (which uses ASHRAE.SENSIBLE_FACTOR_SEA_LEVEL).
 *     Fix: import sensibleFactor(elevFt) and latentFactor(elevFt) directly from
 *     psychro.js. Single source of truth; no raw ASHRAE constant multiplication.
 *
 *   BUG-HH-03 [HIGH]: ASHRAE.KW_TO_BTU replaced.
 *     'KW_TO_BTU' is a wrong unit name — BTU is energy, BTU/hr is power.
 *     Fix: import KW_TO_BTU_HR from utils/units.js.
 *
 *   BUG-HH-04 [MEDIUM]: Mixed-air humidification correction added.
 *     Old: Δgr = gr_indoor_target − gr_outdoor_winter (correct only for 100% OA)
 *     New: Mixed-air grains computed when recirculationFraction > 0.
 *       gr_mixed = gr_OA × (1 − recircFraction) + gr_return × recircFraction
 *     For pharma/semiconductor 100% OA systems: pass recirculationFraction=0
 *     (default) — behaviour is identical to v1.x after BUG-HH-01 fix.
 *
 *   BUG-HH-05 [MEDIUM]: Sub-5%RH humidification warning added.
 *     At battery dry-room (1%RH) + -20°F winter outdoor conditions,
 *     Δgr can exceed 80 gr/lb. humidLbsPerHr at 5000 CFM → 257+ lb/hr steam.
 *     A warning is now returned when Δgr > 40 gr/lb (≈ below 5%RH at 70°F).
 *     Callers (rdsSelector, RDSPage) should surface this to the engineer.
 *
 *   BUG-HH-06 [LOW]: GR_PER_LB imported from units.js.
 *     Consistent with all other modules post-units.js v2.0.
 *
 * ── HEATING LOAD COMPONENTS ──────────────────────────────────────────────────
 *
 *   1. Room transmission loss (envelope)
 *      Already computed in seasonalLoads.js for 'winter' season.
 *      ERSH_winter < 0 means net heat loss — room needs heating.
 *
 *   2. Outdoor air preheat load
 *      Q_preheat = Cs × CFM_OA × (T_room − T_outdoor_winter)
 *      Fresh air must be heated from outdoor temp to supply temp.
 *      This is a COIL load, not a room load.
 *
 *   3. Terminal reheat
 *      After coil cooling, supply air may need reheating to maintain
 *      room setpoint in winter. Sized to offset net room heat loss.
 *
 * ── HUMIDIFICATION LOAD ───────────────────────────────────────────────────────
 *
 *   When supply air arrives drier than the room target, the system must ADD
 *   moisture. This is the dominant load for:
 *     Semiconductor fabs     (RH 40–50%, dry winters)
 *     Battery dry rooms      (RH 1–5%   — massive humidification requirement)
 *     Pharma sterile suites  (RH 30–50% year-round)
 *
 *   Method: Supply air humidification — isothermal steam (ASHRAE Ch.22)
 *
 *   FORMULA (v2.0 — BUG-HH-01 corrected):
 *   ──────────────────────────────────────
 *   ṁ_air  (lb_dry/hr) = CFM × 60 min/hr × ρ_site
 *                       = CFM × 60 × 0.075 × altCf       [lb_dry_air/hr]
 *   ṁ_water(lb/hr)     = ṁ_air × Δgr / 7000
 *                       = CFM × 4.5 × altCf × Δgr / 7000
 *
 *   kW_steam = lb/hr × 0.634   [isothermal steam latent heat factor]
 *
 *   Reference:
 *     ASHRAE HOF 2021 Ch.1 — ṁ_air = CFM × 60 × ρ
 *     ASHRAE HVAC S&E 2020 Ch.22 — humidification load = ṁ_air × Δω
 *
 * ── PIPE SIZING PREVIEW ───────────────────────────────────────────────────────
 *
 *   CHW flow (GPM) = Q_cooling (BTU/hr) / (500 × ΔT_chw)   ΔT_chw = 10°F
 *   HW  flow (GPM) = Q_heating (BTU/hr) / (500 × ΔT_hw)    ΔT_hw  = 20°F
 *   Full pipe sizing lives in pipeSizing.js.
 *
 * SIGN CONVENTION:
 *   heatingCapBTU is always positive (magnitude of heat loss).
 *   Callers determine whether to apply as preheat, reheat, or terminal heat.
 */

import { calculateGrains, sensibleFactor, latentFactor } from '../../utils/psychro';
import { GR_PER_LB, KW_TO_BTU_HR }                       from '../../utils/units';

// ── Module constants ──────────────────────────────────────────────────────────

/**
 * AIR_MASS_FACTOR
 * Converts volumetric airflow (CFM) to mass flow of dry air (lb_dry_air/hr)
 * at standard sea-level conditions.
 *
 * Derivation:
 *   60 min/hr × 0.075 lb/ft³ (standard air density at ~70°F, sea level)
 *   = 4.5 lb_dry_air / (hr · CFM)
 *
 * At altitude: multiply by altCf (density ratio = Patm_site / Patm_sea).
 * This constant is also used by outdoorAirLoad.js — both import from here.
 *
 * Source: ASHRAE HOF 2021, Ch.28 — standard air density 0.075 lb/ft³
 */
export const AIR_MASS_FACTOR = 60 * 0.075; // = 4.5

// Isothermal steam humidifier power factor
// Source: ASHRAE HVAC Systems & Equipment 2020, Ch.22
const STEAM_KW_PER_LB_HR = 0.634;

// Standard hydronic ΔT for flow rate sizing
const CHW_DELTA_T_F   = 10;  // °F
const HW_DELTA_T_F    = 20;  // °F

// 500 = 60 min/hr × 8.33 lb/gal × 1 BTU/lb·°F (specific heat of water)
const HYDRONIC_CONSTANT = 500;

// Threshold above which humidification load is flagged as high-load condition.
// Δgr = 40 gr/lb ≈ indoor 5%RH at 70°F vs dry outdoor conditions.
// Below this threshold, standard steam humidifiers handle the load routinely.
// Above it, steam supply capacity, manifold sizing, and startup sequencing
// need specialist review.
const HIGH_HUMID_DELTA_GR = 40;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * calculateHeatingHumid()
 *
 * Computes winter heating capacity and humidification load for one room.
 * Consumed by rdsSelector.js.
 *
 * @param {number} ershWinter            - ERSH for winter season (BTU/hr, signed)
 *                                         Negative = net heat loss (needs heating)
 *                                         Positive = net heat gain in winter
 * @param {number} supplyAir             - total supply air CFM
 * @param {number} freshAirCFM           - outdoor air CFM (from airQuantities.js)
 * @param {object} climate               - full climate Redux state
 * @param {number} dbInF                 - room design dry-bulb (°F)
 * @param {number} humidificationTarget  - target indoor RH% for winter sizing
 * @param {number} altCf                 - altitude correction factor (dimensionless)
 * @param {number} [elevation=0]         - site elevation (ft)
 * @param {number} [grandTotal=0]        - total cooling load BTU/hr (for CHW sizing)
 * @param {number} [recirculationFraction=0] - fraction of supply air that is
 *                                         recirculated return air (0–1).
 *                                         0   = 100% OA system (pharma / semiconductor)
 *                                         0.8 = 80% recirculation (typical office AHU)
 *                                         Default 0 is conservative (max humidification).
 *
 * @returns {{
 *   heatingCapBTU:         number,   magnitude of heating required (BTU/hr)
 *   heatingCap:            string,   heating capacity (kW), toFixed(2)
 *   heatingCapMBH:         string,   heating capacity (MBH = kBTU/hr), toFixed(2)
 *   preheatCapBTU:         number,   OA preheat load (BTU/hr)
 *   preheatCap:            string,   OA preheat capacity (kW), toFixed(2)
 *   terminalHeatingCap:    string,   terminal reheat capacity (kW)
 *   extraHeatingCap:       string,   +10% safety on terminal heat (kW)
 *   hwFlowRate:            string,   hot water flow rate (USGPM), toFixed(1)
 *   chwFlowRate:           string,   chilled water flow rate (USGPM), toFixed(1)
 *   humidDeltaGr:          string,   gr/lb to add for humidification, toFixed(1)
 *   humidGrTarget:         string,   target indoor gr/lb, toFixed(1)
 *   winterGrOut:           string,   outdoor winter gr/lb, toFixed(1)
 *   mixedAirGr:            string,   mixed-air gr/lb entering humidifier, toFixed(1)
 *   humidLbsPerHr:         string,   water mass to add (lb/hr), toFixed(2)
 *   humidKw:               string,   humidifier power (kW), toFixed(2)
 *   humidLoadBTU:          number,   latent humidification load (BTU/hr)
 *   needsHumidification:   boolean,  true if Δgr > 0
 *   needsHeating:          boolean,  true if net heat loss in winter
 *   highHumidificationLoad:boolean,  true if Δgr > 40 gr/lb (sub-5%RH warning)
 *   humidWarning:          string|null, human-readable warning for UI
 * }}
 */
export const calculateHeatingHumid = (
  ershWinter,
  supplyAir,
  freshAirCFM,
  climate,
  dbInF,
  humidificationTarget,
  altCf,
  elevation              = 0,
  grandTotal             = 0,
  recirculationFraction  = 0,
) => {
  // BUG-HH-02 FIX: Use psychro.js exported functions directly.
  const Cs = sensibleFactor(elevation);
  const Cl = latentFactor(elevation);

  // ── 1. Room heating load ──────────────────────────────────────────────────
  const winterSensLoss = Math.min(0, ershWinter || 0);
  const heatingCapBTU  = Math.abs(winterSensLoss);
  const needsHeating   = heatingCapBTU > 0;

  // BUG-HH-03 FIX: KW_TO_BTU_HR from units.js
  const heatingCap    = (heatingCapBTU / KW_TO_BTU_HR).toFixed(2);
  const heatingCapMBH = (heatingCapBTU / 1000).toFixed(2);

  const terminalHeatingCap = heatingCap;
  const extraHeatingCap    = (parseFloat(heatingCap) * 1.1).toFixed(2);

  // ── 2. OA preheat load ────────────────────────────────────────────────────
  const winterOut     = climate?.outside?.winter || {};
  const parsedWinterDb = parseFloat(winterOut.db);
const winterDbOut = !isNaN(parsedWinterDb) ? parsedWinterDb : 45;   // BUG-HH-09 FIX
  const preheatDeltaT = Math.max(0, dbInF - winterDbOut);
  const preheatCapBTU = Math.round(Cs * (freshAirCFM || 0) * preheatDeltaT);
  const preheatCap    = (preheatCapBTU / KW_TO_BTU_HR).toFixed(2);

  // ── 3. Hydronic flow rates ────────────────────────────────────────────────
  const hwFlowRate = heatingCapBTU > 0
    ? (heatingCapBTU / (HYDRONIC_CONSTANT * HW_DELTA_T_F)).toFixed(1)
    : '0.0';
  
  const chwFlowRate = grandTotal > 0
  ? (grandTotal / (HYDRONIC_CONSTANT * CHW_DELTA_T_F)).toFixed(1)
  : '0.0';



  // ── 4. Humidification load ────────────────────────────────────────────────

  // Outdoor winter humidity ratio
  const parsedWinterRh = parseFloat(winterOut.rh);
const winterRhOut = !isNaN(parsedWinterRh) ? parsedWinterRh : 30;   // BUG-HH-09 FIX
  const winterGrOut = calculateGrains(winterDbOut, winterRhOut, elevation);

  // Indoor target humidity ratio
  const humidGrTarget = calculateGrains(dbInF, humidificationTarget, elevation);

  // BUG-HH-04 FIX: Mixed-air humidity ratio at AHU inlet.
  //
  // For a 100% OA system (recirculationFraction = 0, the default):
  //   gr_mixed = gr_outdoor  ← identical to v1.x behaviour
  //
  // For a recirculation system (recirculationFraction > 0):
  //   gr_mixed = gr_OA × (1 − recircFraction) + gr_return × recircFraction
  //
  // BUG-HH-07 FIX: grReturn now uses humidificationTarget (was: roomDesignRH,
  // an undefined variable that caused ReferenceError at runtime for all
  // recirculation systems).
  //
  // Basis: return air is at steady-state room conditions — the room's winter
  // humidity target IS humidificationTarget. The BUG-HH-04 changelog comment
  // documents this: "Return air grains ≈ room target grains (steady state)."
  const rcFrac   = Math.min(1, Math.max(0, recirculationFraction || 0));
  const grReturn = calculateGrains(dbInF, humidificationTarget, elevation); // BUG-HH-07 FIX
  const mixedAirGr = winterGrOut * (1 - rcFrac) + grReturn * rcFrac;

  // Δgr: how many gr/lb the humidifier must add to the mixed-air stream
  const humidDeltaGr        = Math.max(0, humidGrTarget - mixedAirGr);
  const needsHumidification = humidDeltaGr > 0;

  // BUG-HH-05: Flag high humidification load (sub-5%RH territory)
  const highHumidificationLoad = humidDeltaGr > HIGH_HUMID_DELTA_GR;
  let humidWarning = null;
  if (highHumidificationLoad) {
    humidWarning =
      `High humidification load: Δgr = ${humidDeltaGr.toFixed(1)} gr/lb ` +
      `(threshold ${HIGH_HUMID_DELTA_GR} gr/lb). ` +
      `This indicates a sub-5%RH target combined with dry winter outdoor conditions. ` +
      `Verify steam supply capacity, manifold sizing, and AHU humidifier section length. ` +
      `Consider a chilled-mirror or optical dew-point instrument for setpoint control — ` +
      `standard capacitive RH sensors are not accurate at these conditions.`;
  }

  // BUG-HH-01 FIX: altCf now applied to AIR_MASS_FACTOR.
  //
  // ṁ_water (lb/hr) = CFM × 60 min/hr × ρ_site × Δgr / 7000
  //                 = CFM × AIR_MASS_FACTOR × altCf × Δgr / GR_PER_LB
  const humidLbsPerHr = (supplyAir > 0 && needsHumidification)
    ? ((supplyAir * humidDeltaGr * AIR_MASS_FACTOR * altCf) / GR_PER_LB).toFixed(2)
    : '0.00';

  // Humidifier power — isothermal steam basis.
  const humidKw = (parseFloat(humidLbsPerHr) * STEAM_KW_PER_LB_HR).toFixed(2);

  // Latent humidification load in BTU/hr
  // Q_l = Cl × CFM_supply × Δgr
  const humidLoadBTU = (supplyAir > 0 && needsHumidification)
    ? Math.round(Cl * supplyAir * humidDeltaGr)
    : 0;

  return {
    // Heating
    heatingCapBTU,
    heatingCap,
    heatingCapMBH,
    preheatCapBTU,
    preheatCap,
    terminalHeatingCap,
    extraHeatingCap,
    needsHeating,

    // Hydronic flows
    hwFlowRate,
    chwFlowRate
   

    // Humidification
    humidDeltaGr:          humidDeltaGr.toFixed(1),
    humidGrTarget:         humidGrTarget.toFixed(1),
    winterGrOut:           winterGrOut.toFixed(1),
    mixedAirGr:            mixedAirGr.toFixed(1),
    humidLbsPerHr,
    humidKw,
    humidLoadBTU,
    needsHumidification,

    // Warnings
    highHumidificationLoad,
    humidWarning,
  };
};