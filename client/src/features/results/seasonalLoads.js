/**
 * seasonalLoads.js
 * Responsibility: Per-room, per-season sensible and latent load calculation.
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Chapter 18
 *            ASHRAE 62.1-2022 (Ventilation Rate Procedure)
 *
 * LOAD COMPONENTS (all in BTU/hr):
 *
 *   Sensible:
 *     1. Envelope        — CLTD/CLF method via envelopeCalc.js
 *     2. People          — sensiblePerPerson × count (ASHRAE HOF Ch.18 Table 1)
 *     3. Lighting        — W/ft² × area × 3.412 × CLF (CLF=1 assumed, always ON)
 *     4. Equipment       — kW × 3412 × sensibleFraction
 *     5. Infiltration    — 1.08 × Cf × CFM × ΔT°F
 *
 *   Latent:
 *     1. People          — latentPerPerson × count
 *     2. Equipment       — kW × 3412 × latentFraction
 *     3. Infiltration    — 0.68 × Cf × CFM × Δgr/lb
 *
 *   Safety factor applied uniformly to rawSensible and rawLatent → ERSH, ERLH.
 *   Fan heat is NOT applied here — it is a system-level addition in rdsSelector.
 *
 * UNIT CONVENTIONS:
 *   Temperatures  — °F throughout (room designTemp converted from °C at call site)
 *   Humidity      — gr/lb
 *   Airflow       — CFM
 *   Area          — ft²  (converted from m² at call site)
 *   Volume        — ft³  (converted from m³ at call site)
 *
 * SIGN CONVENTION (matches envelopeCalc.js):
 *   Positive = heat INTO conditioned space (cooling load)
 *   Negative = heat OUT of conditioned space (heating load / heat loss)
 */

import { calculateGrains } from '../../utils/psychro';
import ASHRAE from '../../constants/ashrae';
import { calcTotalEnvelopeGain } from '../../utils/envelopeCalc';

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Convert Celsius to Fahrenheit.
 * Inline here to keep this module self-contained.
 */
const cToF = (c) => (parseFloat(c) * 9) / 5 + 32;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * calculateSeasonLoad()
 *
 * Computes the full sensible and latent cooling/heating load for one room
 * in one season. Returns a rich object consumed by rdsSelector.js.
 *
 * @param {object} room           - room state from roomSlice
 * @param {object} envelope       - envelope state for this room from envelopeSlice
 * @param {object} climate        - full climate state (state.climate)
 * @param {string} season         - 'summer' | 'monsoon' | 'winter'
 * @param {object} systemDesign   - state.project.systemDesign
 * @param {number} altCf          - altitude correction factor (dimensionless)
 * @param {number} elevation      - site elevation (ft) — for gr recalculation
 * @param {number} floorAreaFt2   - room floor area in ft² (pre-converted)
 * @param {number} volumeFt3      - room volume in ft³ (pre-converted)
 * @param {number} latitude       - project latitude (decimal degrees)
 * @param {number} dailyRange     - full daily DB swing (°F). 0 = use defaults.
 *
 * @returns {{
 *   ersh:         number,   Effective Room Sensible Heat (BTU/hr) with safety
 *   erlh:         number,   Effective Room Latent Heat (BTU/hr) with safety
 *   grains:       string,   indoor gr/lb (toFixed(1)) for RDS display
 *   dbInF:        number,   room design dry-bulb (°F)
 *   grIn:         number,   indoor humidity ratio (gr/lb)
 *   grOut:        number,   outdoor humidity ratio (gr/lb) at site elevation
 *   envelopeGain: number,   envelope sensible subtotal (BTU/hr) signed
 *   pplSens:      number,   people sensible subtotal (BTU/hr)
 *   pplLat:       number,   people latent subtotal (BTU/hr)
 *   lightsSens:   number,   lighting sensible subtotal (BTU/hr)
 *   equipSens:    number,   equipment sensible subtotal (BTU/hr)
 *   equipLatent:  number,   equipment latent subtotal (BTU/hr)
 *   infilSens:    number,   infiltration sensible subtotal (BTU/hr)
 *   infilLat:     number,   infiltration latent subtotal (BTU/hr)
 *   infilCFM:     number,   infiltration airflow (CFM)
 *   rawSensible:  number,   sum of all sensible components before safety
 *   rawLatent:    number,   sum of all latent components before safety
 *   safetyMult:   number,   safety factor multiplier (e.g. 1.10)
 * }}
 */
export const calculateSeasonLoad = (
  room,
  envelope,
  climate,
  season,
  systemDesign,
  altCf,
  elevation,
  floorAreaFt2,
  volumeFt3,
  latitude   = 28,
  dailyRange = 0,
) => {
  const env = envelope || { internalLoads: {}, infiltration: {} };
  const int = env.internalLoads || {};
  const inf = env.infiltration  || {};

  // ── Outdoor conditions ──────────────────────────────────────────────────────
  const outdoor = climate?.outside?.[season] || { db: 95, rh: 40 };
  const dbOut   = parseFloat(outdoor.db) || 95;
  const ambRH   = parseFloat(outdoor.rh) || 0;

  // BUG-02 FIX: recalculate outdoor grains at site elevation, not sea level.
  // Patm affects the humidity ratio calculation — critical at altitude > 3000 ft.
  const grOut = calculateGrains(dbOut, ambRH, elevation);

  // ── Indoor conditions ───────────────────────────────────────────────────────
  // designTemp is stored in °C in roomSlice — convert to °F for all ASHRAE calcs.
  const dbInF = isNaN(parseFloat(room.designTemp)) ? 72 : cToF(room.designTemp);
  const rhIn  = parseFloat(room.designRH) || 50;
  const grIn  = calculateGrains(dbInF, rhIn, elevation);

  // ── Altitude-corrected psychrometric factors ────────────────────────────────
  // ASHRAE: Cs = 1.08 × Cf, Cl = 0.68 × Cf
  // where Cf = Patm_site / Patm_sea-level
  const Cs = ASHRAE.SENSIBLE_FACTOR * altCf;
  const Cl = ASHRAE.LATENT_FACTOR   * altCf;

  // ── 1. Envelope gain ────────────────────────────────────────────────────────
  // Delegates to envelopeCalc.js — CLTD/CLF for walls/roofs/glass,
  // conduction for partitions/floors, latitude+DR corrections applied.
  const envelopeGain = calcTotalEnvelopeGain(
    env.elements,
    climate,
    dbInF,
    season,
    latitude,
    dailyRange,
  );

  // ── 2. People (ASHRAE HOF 2021 Ch.18 Table 1) ──────────────────────────────
  const pplCount = parseFloat(int.people?.count)                           || 0;
  const pplSens  = pplCount * (int.people?.sensiblePerPerson ?? ASHRAE.PEOPLE_SENSIBLE_SEATED);
  const pplLat   = pplCount * (int.people?.latentPerPerson   ?? ASHRAE.PEOPLE_LATENT_SEATED);

  // ── 3. Lighting (CLF = 1.0 — assumed always ON) ────────────────────────────
  // Q_lights = W/ft² × ft² × (BTU/hr per W)
  // For scheduled lighting, CLF < 1.0 per ASHRAE Table 3 Ch.18.
  // CLF schedule support deferred to v2.
  const lightsSens = (parseFloat(int.lights?.wattsPerSqFt) || 0)
    * floorAreaFt2
    * ASHRAE.BTU_PER_WATT;

  // ── 4. Equipment ───────────────────────────────────────────────────────────
  // BUG-01 / BUG-06 FIX: equipment latent load was missing in original.
  // Q_equip_s = kW × 3412 × sensibleFraction
  // Q_equip_l = kW × 3412 × latentFraction
  const equipKW      = parseFloat(int.equipment?.kw)           || 0;
  const equipSensPct = (parseFloat(int.equipment?.sensiblePct) ?? 100) / 100;
  const equipLatPct  = (parseFloat(int.equipment?.latentPct)   ?? 0)   / 100;
  const equipSens    = equipKW * ASHRAE.KW_TO_BTU * equipSensPct;
  const equipLatent  = equipKW * ASHRAE.KW_TO_BTU * equipLatPct;

  // ── 5. Infiltration ────────────────────────────────────────────────────────
  // CFM_inf = (Volume_ft³ × ACH_inf) / 60
  // Q_s = Cs × CFM × (T_out − T_in)   [signed — negative if outdoor < indoor]
  // Q_l = Cl × CFM × (gr_out − gr_in)  [floored at 0 — no latent cooling from infiltration]
  const achValue  = parseFloat(inf.achValue) || 0;
  const infilCFM  = (volumeFt3 * achValue) / 60;
  const infilSens = Cs * infilCFM * (dbOut - dbInF);
  const infilLat  = Cl * infilCFM * Math.max(0, grOut - grIn);

  // ── Totals ──────────────────────────────────────────────────────────────────
  const rawSensible = envelopeGain + pplSens + lightsSens + equipSens + infilSens;
  const rawLatent   = pplLat + equipLatent + infilLat;

  // Safety factor — applied uniformly to both sensible and latent.
  // Fan heat is NOT included here (BUG-14 FIX — applied separately in rdsSelector).
  const safetyMult = 1 + (parseFloat(systemDesign.safetyFactor) || 10) / 100;
  const ersh = Math.round(rawSensible * safetyMult);
  const erlh = Math.round(rawLatent   * safetyMult);

  return {
    // Primary outputs consumed by rdsSelector
    ersh,
    erlh,

    // Psychrometric state
    grains: grIn.toFixed(1),
    dbInF,
    grIn,
    grOut,

    // Load component breakdown — used for Equipment ON/OFF delta
    envelopeGain,
    pplSens,
    pplLat,
    lightsSens,
    equipSens,
    equipLatent,
    infilSens,
    infilLat,
    infilCFM,

    // Pre-safety totals — used by downstream selectors
    rawSensible,
    rawLatent,

    // Multiplier carried forward for Equipment OFF calculation
    safetyMult,
  };
};