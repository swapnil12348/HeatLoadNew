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
 * ── HEATING LOAD COMPONENTS ──────────────────────────────────────────────────
 *
 *   1. Room transmission loss (envelope)
 *      Already computed in seasonalLoads.js for 'winter' season.
 *      ERSH_winter < 0 means net heat loss — room needs heating.
 *
 *   2. Outdoor air preheat load
 *      Q_preheat = Cs × CFM_OA × (T_room − T_outdoor_winter)
 *      Fresh air must be heated from outdoor temp to supply temp before
 *      entering the room. This is a COIL load, not a room load.
 *
 *   3. Terminal reheat
 *      After coil cooling, supply air may need reheating to maintain
 *      room setpoint in winter. Sized to offset net room heat loss.
 *
 * ── HUMIDIFICATION LOAD ───────────────────────────────────────────────────────
 *
 *   When outdoor winter gr/lb < indoor target gr/lb, the supply air
 *   arrives drier than required — the system must ADD moisture.
 *
 *   This is the dominant load for:
 *     - Semiconductor fabs (RH 40–50%, often dry winters)
 *     - Battery dry rooms (RH 1–5% — massive humidification requirement)
 *     - Pharma sterile suites (RH 30–50% year-round)
 *
 *   Method: Supply air humidification (isothermal steam — ASHRAE Ch.22)
 *
 *   Δgr = grTarget − grOutdoor_winter         (gr/lb to add)
 *   lbs/hr = CFM_supply × Δgr / 7000          (mass flow of water to add)
 *   kW = lbs/hr × 0.634                       (isothermal steam power)
 *     where 0.634 kW per lb/hr steam ≈ 1500 BTU/lb latent heat of vaporization
 *
 *   ASHRAE Note: 0.634 kW/lb·hr is the isothermal steam humidifier basis.
 *   Adiabatic (evaporative) humidifiers use ~0.07 kW/lb·hr but cool the air.
 *   For cleanrooms and pharma, isothermal steam is standard.
 *
 * ── PIPE SIZING PREVIEW ───────────────────────────────────────────────────────
 *
 *   CHW flow (GPM) = Q_cooling (BTU/hr) / (500 × ΔT_chw)
 *     ΔT_chw = 10°F (standard chilled water ΔT)
 *
 *   HW flow (GPM)  = Q_heating (BTU/hr) / (500 × ΔT_hw)
 *     ΔT_hw = 20°F (standard hot water ΔT)
 *
 *   Full pipe sizing (velocity, diameter, pressure drop) lives in pipeSizing.js.
 *
 * SIGN CONVENTION:
 *   heatingCapBTU is always positive (magnitude of heat loss)
 *   Callers determine whether to apply as preheat, reheat, or terminal heat.
 */

import { calculateGrains } from '../../utils/psychro';
import ASHRAE from '../../constants/ashrae';

// ── Constants ─────────────────────────────────────────────────────────────────

// Isothermal steam humidifier power factor
// Source: ASHRAE HVAC Systems & Equipment Ch.22
const STEAM_KW_PER_LB_HR = 0.634;

// Standard hydronic ΔT values for flow rate sizing
const CHW_DELTA_T_F = 10;   // °F — chilled water supply/return differential
const HW_DELTA_T_F  = 20;   // °F — hot water supply/return differential

// 500 = 60 min/hr × 8.33 lb/gal × 1 BTU/lb·°F (water specific heat)
const HYDRONIC_CONSTANT = 500;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * calculateHeatingHumid()
 *
 * Computes winter heating capacity and humidification load for one room.
 * Consumed by rdsSelector.js.
 *
 * @param {number} ershWinter         - ERSH for winter season (BTU/hr, signed)
 *                                      Negative = net heat loss (needs heating)
 *                                      Positive = net heat gain (no heating needed)
 * @param {number} supplyAir          - total supply air CFM
 * @param {number} freshAirCFM        - outdoor air CFM (freshAirCheck)
 * @param {object} climate            - full climate state
 * @param {number} dbInF              - room design dry-bulb (°F)
 * @param {number} humidificationTarget - target indoor RH% for winter sizing
 * @param {number} altCf              - altitude correction factor
 * @param {number} elevation          - site elevation (ft)
 * @param {number} grandTotal         - total cooling load BTU/hr (for CHW sizing)
 *
 * @returns {{
 *   heatingCapBTU:        number,  magnitude of heating required (BTU/hr)
 *   heatingCap:           string,  heating capacity (kW), toFixed(2)
 *   heatingCapMBH:        string,  heating capacity (MBH = kBTU/hr), toFixed(2)
 *   preheatCapBTU:        number,  OA preheat load (BTU/hr)
 *   preheatCap:           string,  OA preheat capacity (kW), toFixed(2)
 *   terminalHeatingCap:   string,  terminal reheat capacity (kW) = heatingCap
 *   extraHeatingCap:      string,  +10% safety on terminal heat (kW)
 *   hwFlowRate:           string,  hot water flow rate (USGPM), toFixed(1)
 *   chwFlowRate:          string,  chilled water flow rate (USGPM), toFixed(1)
 *   humidDeltaGr:         string,  gr/lb to add for humidification, toFixed(1)
 *   humidGrTarget:        string,  target indoor gr/lb, toFixed(1)
 *   winterGrOut:          string,  outdoor winter gr/lb, toFixed(1)
 *   humidLbsPerHr:        string,  water mass flow to add (lb/hr), toFixed(2)
 *   humidKw:              string,  humidifier power (kW), toFixed(2)
 *   humidLoadBTU:         number,  latent humidification load (BTU/hr)
 *   needsHumidification:  boolean, true if Δgr > 0
 *   needsHeating:         boolean, true if net heat loss in winter
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
  elevation    = 0,
  grandTotal   = 0,
) => {
  const Cs = ASHRAE.SENSIBLE_FACTOR * altCf;
  const Cl = ASHRAE.LATENT_FACTOR   * altCf;

  // ── 1. Room heating load ────────────────────────────────────────────────────
  // ERSH_winter < 0 = net heat loss. Magnitude = heating required.
  // ERSH_winter > 0 = net heat gain even in winter (high internal loads).
  const winterSensLoss  = Math.min(0, ershWinter || 0);
  const heatingCapBTU   = Math.abs(winterSensLoss);
  const needsHeating    = heatingCapBTU > 0;

  const heatingCap    = (heatingCapBTU / ASHRAE.KW_TO_BTU).toFixed(2);
  const heatingCapMBH = (heatingCapBTU / 1000).toFixed(2);

  // Terminal heating = full heating capacity (sized to recover room heat loss)
  // Extra heating = +10% safety margin for terminal heater selection
  const terminalHeatingCap = heatingCap;
  const extraHeatingCap    = (parseFloat(heatingCap) * 1.1).toFixed(2);

  // ── 2. OA preheat load ──────────────────────────────────────────────────────
  // Fresh air must be heated from winter outdoor temp to at least room temp
  // before entering the space. This is a COIL load additional to room load.
  // Q_preheat = Cs × CFM_OA × (T_room − T_outdoor)
  const winterOut    = climate?.outside?.winter || {};
  const winterDbOut  = parseFloat(winterOut.db) || 45;
  const preheatDeltaT = Math.max(0, dbInF - winterDbOut);
  const preheatCapBTU = Math.round(Cs * (freshAirCFM || 0) * preheatDeltaT);
  const preheatCap    = (preheatCapBTU / ASHRAE.KW_TO_BTU).toFixed(2);

  // ── 3. Hydronic flow rates ──────────────────────────────────────────────────
  // HW flow: sized on heating load
  // CHW flow: sized on total cooling load (grandTotal)
  const hwFlowRate  = heatingCapBTU > 0
    ? (heatingCapBTU / (HYDRONIC_CONSTANT * HW_DELTA_T_F)).toFixed(1)
    : '0.0';

  const chwFlowRate = grandTotal > 0
    ? (grandTotal / (HYDRONIC_CONSTANT * CHW_DELTA_T_F)).toFixed(1)
    : '0.0';

  // ── 4. Humidification load ──────────────────────────────────────────────────
  // Outdoor winter gr/lb vs indoor target gr/lb
  const winterRhOut  = parseFloat(winterOut.rh) || 30;
  const winterGrOut  = calculateGrains(winterDbOut, winterRhOut, elevation);

  // Indoor humidity ratio at humidification target RH
  const humidGrTarget = calculateGrains(dbInF, humidificationTarget, elevation);

  // Δgr to add — floored at 0 (no humidification needed if outdoor is wetter)
  const humidDeltaGr = Math.max(0, humidGrTarget - winterGrOut);
  const needsHumidification = humidDeltaGr > 0;

  // Mass flow of water to add:
  // lbs/hr = CFM_supply × Δgr / 7000
  // 7000 gr/lb (ASHRAE.GR_PER_LB)
  const humidLbsPerHr = (supplyAir > 0 && needsHumidification)
    ? ((supplyAir * humidDeltaGr) / ASHRAE.GR_PER_LB).toFixed(2)
    : '0.00';

  // Humidifier power — isothermal steam basis
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
    chwFlowRate,

    // Humidification
    humidDeltaGr:       humidDeltaGr.toFixed(1),
    humidGrTarget:      humidGrTarget.toFixed(1),
    winterGrOut:        winterGrOut.toFixed(1),
    humidLbsPerHr,
    humidKw,
    humidLoadBTU,
    needsHumidification,
  };
};