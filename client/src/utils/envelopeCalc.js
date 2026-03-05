/**
 * envelopeCalc.js
 * Pure ASHRAE CLTD/CLF/SHGF calculation functions.
 * Reference: ASHRAE Handbook of Fundamentals (2021), Ch 18 & 27-28
 *
 * CHANGELOG v2.0:
 *
 *   FIX-01 — Seasonal multiplier now applied AFTER correctCLTD(), not before.
 *            Applying it before caused the temperature correction terms
 *            (78−tRoom) and (tMean−85) to be scaled down incorrectly.
 *            Old: correctCLTD(base × mult, tRoom, tMean)
 *            New: correctCLTD(base, tRoom, tMean, lm) × mult
 *
 *   FIX-02 — LM latitude correction consolidated into correctCLTD() call
 *            (5th argument). Previously it was added as a separate step after
 *            the call, which worked but was inconsistent with ashraeTables API.
 *
 *   FIX-03 — DR/21 multiplier removed from correctCLTD() usage here.
 *            tMeanOutdoor already encodes the diurnal range via:
 *              tMean = tPeak − DR/2
 *            Adding a separate × (DR/21) multiplier would double-count DR.
 *            NOTE: The DR/21 multiplier added in ashraeTables.js v2.0 should
 *            be removed from correctCLTD() or kept with diurnalRange defaulting
 *            to 21 (no effect) — callers must NOT pass diurnalRange there.
 *
 *   FIX-04 — Winter heating load now uses straight U×A×ΔT (conduction only),
 *            not a scaled CLTD. The CLTD method is a cooling-load technique.
 *            Applying CLTD × 0.4 for winter is a rough approximation that
 *            underestimates heat loss in cold climates and is not ASHRAE-correct
 *            for heating design. Winter walls and roofs now return:
 *              Q = U × A × (tRoom − tOutdoor_winter)    [signed — negative = heat loss]
 *
 *   FIX-05 — Glass solar gain: SHGC preferred over SC when available.
 *            Reads glass.shgc if set, falls back to glass.sc × 0.87 if only
 *            SC is stored (legacy entries). SC ≈ SHGC / 0.87.
 *            ASHRAE 90.1 and all modern glazing specs use SHGC.
 *
 *   FIX-06 — Winter solar gain treated as a CREDIT (reduces heating load).
 *            Solar gain in winter offsets heat loss — total glass gain in
 *            winter is: (U×A×ΔT) − (SHGC×SHGF×A×CLF).
 *            Sign convention preserved: negative total = net heat loss.
 *
 *   FIX-07 — calcInfiltrationGain() added. Significant omission for
 *            critical facilities. Uses ASHRAE crack method approximation:
 *              Q_s = 1.08 × CFM_inf × ΔT
 *              Q_l = 0.68 × CFM_inf × Δgr
 *            CFM_inf estimated from room volume, ACH_inf, and pressurization.
 *            For positively pressurized cleanrooms, infiltration = 0.
 *
 *   FIX-08 — calcSlabGain() added using ASHRAE F-factor method (HOF Ch.18):
 *              Q_slab = F × perimeter_ft × (tRoom − tGround)
 *            Only applies to heating season (negative in winter).
 *
 * BUG-07 FIX (original): Latitude corrections applied to CLTD and SHGF.
 * BUG-09 FIX (original): Diurnal range no longer hardcoded.
 *
 * SIGN CONVENTION (unchanged):
 *   Positive = heat INTO conditioned space (cooling load)
 *   Negative = heat OUT of conditioned space (heat loss / heating load)
 */

import {
  WALL_CLTD,
  WALL_CLTD_SEASONAL,
  ROOF_CLTD,
  ROOF_CLTD_SEASONAL,
  GLASS_CLTD,
  SHGF,
  CLF,
  correctCLTD,
  CLTD_LM,
  SHGF_LATITUDE_FACTOR,
  DIURNAL_RANGE_DEFAULTS,
  SLAB_F_FACTOR,
  interpolateLatitude,
} from '../constants/ashraeTables';

import ASHRAE from '../constants/ashrae';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute mean outdoor dry-bulb temperature.
 * ASHRAE: tMean = tPeak − DR/2
 * The diurnal range (DR) is already baked into tMean, so correctCLTD()
 * must NOT apply an additional DR/21 multiplier on top of this.
 *
 * @param {number} dbOutdoor  - peak design dry bulb (°F)
 * @param {string} season     - 'summer' | 'monsoon' | 'winter'
 * @param {number} dailyRange - full daily temp swing (°F). 0 = use defaults.
 */
const getMeanOutdoorTemp = (dbOutdoor, season, dailyRange) => {
  const range = (dailyRange > 0)
    ? dailyRange
    : (DIURNAL_RANGE_DEFAULTS[season] ?? 18);
  return dbOutdoor - range / 2;
};

/**
 * Latitude-month (LM) correction for CLTD.
 * Southern hemisphere: swap N↔S orientations, use abs(lat).
 */
const getLM = (latitude, orientation) => {
  const absLat = Math.abs(latitude);
  let orient = orientation;
  if (latitude < 0) {
    const swapMap = { N: 'S', S: 'N', NE: 'SE', SE: 'NE', SW: 'NW', NW: 'SW' };
    orient = swapMap[orientation] ?? orientation;
  }
  return interpolateLatitude(CLTD_LM, absLat, orient);
};

/**
 * Latitude-corrected SHGF (BTU/hr·ft²).
 * Base table is 32°N. Multiply by latitude correction factor.
 */
const getCorrectedSHGF = (orientation, season, latitude) => {
  const baseSHGF = SHGF[orientation]?.[season] ?? 100;
  const absLat   = Math.abs(latitude);
  let orient     = orientation;
  if (latitude < 0) {
    const swapMap = { N: 'S', S: 'N', NE: 'SE', SE: 'NE', SW: 'NW', NW: 'SW' };
    orient = swapMap[orientation] ?? orientation;
  }
  const factor = interpolateLatitude(SHGF_LATITUDE_FACTOR, absLat, orient);
  return baseSHGF * factor;
};

/**
 * Resolve SHGC from a glass element.
 * Prefer glass.shgc (new field). Fall back to glass.sc × 0.87 (legacy).
 * SHGC is the ASHRAE 90.1 standard; SC is the legacy pre-1997 coefficient.
 */
const resolveShgc = (glass) => {
  if (glass.shgc != null && parseFloat(glass.shgc) > 0) {
    return parseFloat(glass.shgc);
  }
  // Legacy fallback: SC × 0.87 ≈ SHGC
  const sc = parseFloat(glass.sc) || 1.0;
  return sc * 0.87;
};


// ─────────────────────────────────────────────────────────────────────────────
// 1. Wall Heat Gain / Heat Loss
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Cooling (summer/monsoon):
 *   Q_wall = U × A × CLTD_corrected × seasonMult
 *
 *   FIX-01: seasonMult applied AFTER correctCLTD.
 *   FIX-02: LM consolidated as 5th arg to correctCLTD.
 *
 * Heating (winter):
 *   Q_wall = U × A × (tRoom − tOutdoor_winter)
 *
 *   FIX-04: proper conduction formula replaces CLTD × 0.4.
 *   Result is negative (heat loss).
 */
export const calcWallGain = (
  wall,
  climate,
  tRoom,
  season,
  latitude   = 28,
  dailyRange = 0,
) => {
  const area = parseFloat(wall.area)   || 0;
  const u    = parseFloat(wall.uValue) || 0;
  if (area === 0 || u === 0) return 0;

  const orientation  = wall.orientation  || 'N';
  const construction = wall.construction || 'medium';
  const dbOut        = parseFloat(climate?.outside?.[season]?.db) || 95;

  // ── Winter: straight conduction ────────────────────────────────────────────
  if (season === 'winter') {
    // Heat loss is negative (out of space). Min clamp removed — callers sum signed values.
    return u * area * (tRoom - dbOut);
  }

  // ── Summer / Monsoon: CLTD method ─────────────────────────────────────────
  const baseCLTD     = WALL_CLTD[orientation]?.[construction] ?? 15;
  const seasonMult   = WALL_CLTD_SEASONAL[season] ?? 1.0;
  const tMeanOutdoor = getMeanOutdoorTemp(dbOut, season, dailyRange);
  const lm           = getLM(latitude, orientation);

  // FIX-01 & FIX-02: correctCLTD on raw baseCLTD, lm as 5th arg, mult after.
  // NOTE: pass diurnalRange=21 (default) so no DR/21 scaling inside correctCLTD.
  const correctedCLTD = correctCLTD(baseCLTD, tRoom, tMeanOutdoor, 21, lm) * seasonMult;

  return u * area * Math.max(0, correctedCLTD);
};


// ─────────────────────────────────────────────────────────────────────────────
// 2. Roof Heat Gain / Heat Loss
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Cooling: Q_roof = U × A × CLTD_corrected × seasonMult  (FIX-01)
 * Heating: Q_roof = U × A × (tRoom − tOutdoor)            (FIX-04)
 * No LM applied to roofs (orientation-independent surface).
 */
export const calcRoofGain = (
  roof,
  climate,
  tRoom,
  season,
  latitude   = 28,   // kept for API consistency; not used in CLTD for roofs
  dailyRange = 0,
) => {
  const area = parseFloat(roof.area)   || 0;
  const u    = parseFloat(roof.uValue) || 0;
  if (area === 0 || u === 0) return 0;

  const construction = roof.construction || '2" insulation';
  const dbOut        = parseFloat(climate?.outside?.[season]?.db) || 95;

  // ── Winter: straight conduction ────────────────────────────────────────────
  if (season === 'winter') {
    return u * area * (tRoom - dbOut);
  }

  // ── Summer / Monsoon: CLTD method ─────────────────────────────────────────
  const baseCLTD     = ROOF_CLTD[construction] ?? 30;
  const seasonMult   = ROOF_CLTD_SEASONAL[season] ?? 1.0;
  const tMeanOutdoor = getMeanOutdoorTemp(dbOut, season, dailyRange);

  // FIX-01: seasonMult after correctCLTD. No LM for roofs.
  const correctedCLTD = correctCLTD(baseCLTD, tRoom, tMeanOutdoor, 21, 0) * seasonMult;

  return u * area * Math.max(0, correctedCLTD);
};


// ─────────────────────────────────────────────────────────────────────────────
// 3. Glass Heat Gain / Heat Loss
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Q_glass = Q_conduction + Q_solar
 *
 * Conduction:
 *   Cooling: U × A × CLTD_glass (seasonal, signed)
 *   Heating: U × A × (tRoom − tOutdoor)  — negative (heat loss)
 *
 * Solar:
 *   Q_solar = SHGC × SHGF_corrected × A × CLF
 *   FIX-05: uses SHGC not SC. Reads glass.shgc, falls back via resolveShgc().
 *   FIX-06: In winter, solar gain is a CREDIT — subtracted from heat loss.
 *           Net = conduction_loss − solar_gain  (more negative = more loss)
 */
export const calcGlassGain = (
  glass,
  climate,
  tRoom,
  season,
  latitude   = 28,
  dailyRange = 0,
) => {
  const area = parseFloat(glass.area)   || 0;
  const u    = parseFloat(glass.uValue) || 0;
  if (area === 0) return { conduction: 0, solar: 0, total: 0 };

  const orientation = glass.orientation || 'E';
  const roomMass    = glass.roomMass    || 'medium';
  const shgc        = resolveShgc(glass);               // FIX-05
  const dbOut       = parseFloat(climate?.outside?.[season]?.db) || 95;

  // ── Solar (all seasons) ────────────────────────────────────────────────────
  const shgf  = getCorrectedSHGF(orientation, season, latitude);
  const clf   = CLF[orientation]?.[roomMass] ?? 0.55;
  const solar = shgc * shgf * area * clf;               // always positive

  // ── Winter: conduction loss − solar credit ─────────────────────────────────
  if (season === 'winter') {
    const conduction = u * area * (tRoom - dbOut);      // negative (heat loss)
    // FIX-06: solar is a credit in winter — reduces heating requirement.
    const total = conduction - solar;                   // more negative = worse
    return {
      conduction: Math.round(conduction),
      solar:      Math.round(solar),     // positive = credit
      total:      Math.round(total),     // signed
    };
  }

  // ── Summer / Monsoon ───────────────────────────────────────────────────────
  const glassBaseCLTD      = GLASS_CLTD[season] ?? 15;
  const tMeanOutdoor       = getMeanOutdoorTemp(dbOut, season, dailyRange);
  const correctedGlassCLTD = correctCLTD(glassBaseCLTD, tRoom, tMeanOutdoor, 21, 0);
  const conduction         = u * area * correctedGlassCLTD;

  return {
    conduction: Math.round(conduction),
    solar:      Math.round(solar),
    total:      Math.round(conduction + solar),
  };
};


// ─────────────────────────────────────────────────────────────────────────────
// 4. Skylight Heat Gain
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Same as glass but forced Horizontal orientation.
 * All FIX-05 / FIX-06 corrections flow through calcGlassGain.
 */
export const calcSkylightGain = (
  skylight,
  climate,
  tRoom,
  season,
  latitude   = 28,
  dailyRange = 0,
) =>
  calcGlassGain(
    { ...skylight, orientation: 'Horizontal' },
    climate,
    tRoom,
    season,
    latitude,
    dailyRange,
  );


// ─────────────────────────────────────────────────────────────────────────────
// 5. Partition / Internal Floor Heat Transfer
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Q = U × A × (tAdj − tRoom)
 * Signed — positive if adjacent space is hotter, negative if cooler.
 */
export const calcPartitionGain = (element, tRoom) => {
  const area = parseFloat(element.area)   || 0;
  const u    = parseFloat(element.uValue) || 0;
  const tAdj = parseFloat(element.tAdj)   || 85;
  return u * area * (tAdj - tRoom);
};


// ─────────────────────────────────────────────────────────────────────────────
// 6. Slab-on-Grade Heat Loss  [NEW — FIX-08]
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ASHRAE F-factor method for unheated slab-on-grade (HOF 2021 Ch.18 Table 12).
 *
 *   Q_slab = F × perimeter_ft × (tRoom − tGround)
 *
 * Sign: negative in heating season (heat loss to ground).
 *       Near zero in summer (ground temp ≈ mean annual air temp).
 *
 * @param {number} perimeterFt   - Exposed slab perimeter (ft). Interior slabs = 0.
 * @param {string} insulationType - Key from SLAB_F_FACTOR table.
 * @param {number} tRoom          - Room design temp (°F).
 * @param {number} tGround        - Mean ground temp at slab depth (°F).
 *                                  Use mean annual air temp if unknown (~55–65°F).
 * @returns {number} Heat loss (BTU/hr), negative = loss
 */
export const calcSlabGain = (
  perimeterFt,
  insulationType = 'Uninsulated',
  tRoom,
  tGround = 60,
) => {
  const perimeter = parseFloat(perimeterFt) || 0;
  if (perimeter === 0) return 0;

  const fFactor = SLAB_F_FACTOR[insulationType] ?? SLAB_F_FACTOR['Uninsulated'];
  // Heat loss is negative
  return -(fFactor * perimeter * Math.max(0, tRoom - tGround));
};


// ─────────────────────────────────────────────────────────────────────────────
// 7. Infiltration Heat Gain / Loss  [NEW — FIX-07]
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Estimates infiltration sensible and latent load.
 * ASHRAE HOF 2021 Ch.16 — simplified crack/ACH method.
 *
 *   CFM_inf = (volume_ft3 × ACH_inf) / 60
 *   Q_s     = 1.08 × CFM_inf × (tOutdoor − tRoom)    [BTU/hr, signed]
 *   Q_l     = 0.68 × CFM_inf × (grOutdoor − grRoom)  [BTU/hr, positive = gain]
 *
 * For positively pressurized rooms (cleanrooms, pharma, battery mfg),
 * infiltration = 0 — return zeros. Pressurization is maintained by supply
 * air exceeding return air (handled in airQuantities.js).
 *
 * @param {object} room      - room state (volume, pressurization flag)
 * @param {object} climate   - climate state
 * @param {string} season    - 'summer' | 'monsoon' | 'winter'
 * @param {number} tRoom     - room design dry-bulb (°F)
 * @param {number} grRoom    - room design humidity ratio (gr/lb)
 * @returns {{ sensible: number, latent: number }}
 */
export const calcInfiltrationGain = (room, climate, season, tRoom, grRoom = 50) => {
  // Pressurized rooms have zero infiltration — outward exfiltration prevents it.
  const isPressurized = room?.pressurized ?? false;
  if (isPressurized) return { sensible: 0, latent: 0 };

  const volumeFt3  = (parseFloat(room?.area) || 0) * (parseFloat(room?.height) || 10) * 10.7639;
  const achInf     = parseFloat(room?.infiltrationAch) || 0.25; // default 0.25 ACH (ASHRAE HOF Ch.16)
  const cfmInf     = (volumeFt3 * achInf) / 60;

  if (cfmInf <= 0) return { sensible: 0, latent: 0 };

  const dbOut = parseFloat(climate?.outside?.[season]?.db) || 95;
  const grOut = parseFloat(climate?.outside?.[season]?.grains) || 85; // gr/lb

  const sensible = ASHRAE.SENSIBLE_FACTOR * cfmInf * (dbOut - tRoom);
  const latent   = ASHRAE.LATENT_FACTOR   * cfmInf * Math.max(0, grOut - grRoom);

  return {
    sensible: Math.round(sensible),
    latent:   Math.round(latent),
  };
};


// ─────────────────────────────────────────────────────────────────────────────
// 8. Total Envelope Sensible Gain for a Room
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Aggregates all envelope element categories for a given season.
 * Returns sensible envelope gain only (BTU/hr), signed.
 * Infiltration and internal loads are summed separately in seasonalLoads.js.
 *
 * @param {object} elements   - envelope.elements from envelopeSlice
 * @param {object} climate    - state.climate
 * @param {number} tRoom      - room design temp (°F)
 * @param {string} season     - 'summer' | 'monsoon' | 'winter'
 * @param {number} latitude   - project latitude (decimal degrees). Default 28°N.
 * @param {number} dailyRange - full daily DB swing (°F). 0 = use seasonal default.
 * @returns {number} Total envelope sensible gain (BTU/hr), signed
 */
export const calcTotalEnvelopeGain = (
  elements,
  climate,
  tRoom,
  season,
  latitude   = 28,
  dailyRange = 0,
) => {
  if (!elements) return 0;

  let total = 0;

  (elements.walls      || []).forEach(w => {
    total += calcWallGain(w, climate, tRoom, season, latitude, dailyRange);
  });
  (elements.roofs      || []).forEach(r => {
    total += calcRoofGain(r, climate, tRoom, season, latitude, dailyRange);
  });
  (elements.glass      || []).forEach(g => {
    total += calcGlassGain(g, climate, tRoom, season, latitude, dailyRange).total;
  });
  (elements.skylights  || []).forEach(s => {
    total += calcSkylightGain(s, climate, tRoom, season, latitude, dailyRange).total;
  });
  (elements.partitions || []).forEach(p => {
    total += calcPartitionGain(p, tRoom);
  });
  (elements.floors     || []).forEach(f => {
    total += calcPartitionGain(f, tRoom);
  });

  return Math.round(total);
};