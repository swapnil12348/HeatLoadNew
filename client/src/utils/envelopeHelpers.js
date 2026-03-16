/**
 * envelopeHelpers.js
 * Internal helpers shared across envelope calculation modules.
 *
 * ⚠️  Not part of the public API. Import only from:
 *       envelopeCalc.js
 *       glazingCalc.js
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Ch.18 & 27
 *
 * ── SOUTHERN HEMISPHERE ORIENTATION CONVENTION ────────────────────────────────
 *
 *   All ASHRAE CLTD and SHGF tables are referenced to the northern hemisphere
 *   (40°N for CLTD, 32°N for SHGF). For southern hemisphere sites (latitude < 0),
 *   the sun's azimuth is mirrored: what is S-facing in the north is N-facing in
 *   the south, and the solar exposure pattern for each orientation swaps accordingly.
 *
 *   swapForHemisphere() handles this automatically:
 *     N ↔ S,  NE ↔ SE,  NW ↔ SW,  E and W unchanged (symmetric about equator)
 *
 *   This swap must be applied consistently to ALL orientation-dependent table lookups:
 *     • WALL_CLTD base value (envelopeCalc.js — uses swapForHemisphere exported here)
 *     • CLTD_LM correction (getLM — applied internally)
 *     • SHGF base value (getCorrectedSHGF — applied internally)
 *     • SHGF latitude factor (getCorrectedSHGF — applied internally)
 *     • CLF table (glazingCalc.js — uses swapForHemisphere exported here)
 */

import {
  CLTD_LM,
  SHGF,
  SHGF_LATITUDE_FACTOR,
  DIURNAL_RANGE_DEFAULTS,
  interpolateLatitude,
} from '../constants/ashraeTables';

// ── Southern hemisphere orientation swap ──────────────────────────────────────
// E and W are omitted — they are symmetric about the equator and do not swap.
const SOUTHERN_SWAP = {
  N: 'S', S: 'N',
  NE: 'SE', SE: 'NE',
  SW: 'NW', NW: 'SW',
};

/**
 * swapForHemisphere(orientation, latitude)
 *
 * Returns the effective orientation for ASHRAE table lookups, accounting for
 * southern hemisphere mirroring. Exported so callers (envelopeCalc, glazingCalc)
 * can apply the same swap to their own table lookups.
 *
 * @param {string} orientation - wall/glass orientation ('N','NE','E',...)
 * @param {number} latitude    - site latitude (negative = southern hemisphere)
 * @returns {string} effective orientation for table lookup
 */
export const swapForHemisphere = (orientation, latitude) =>
  latitude < 0
    ? (SOUTHERN_SWAP[orientation] ?? orientation)
    : orientation;

// ── Mean outdoor dry-bulb temperature ─────────────────────────────────────────
/**
 * getMeanOutdoorTemp(dbOutdoor, season, dailyRange?)
 *
 * ASHRAE HOF 2021 Ch.18: tMean = tPeak − DR/2
 * tMean is the value required by correctCLTD() for the mean-temperature correction.
 *
 * @param {number} dbOutdoor  - peak outdoor dry-bulb (°F)
 * @param {string} season     - 'summer' | 'monsoon' | 'winter'
 * @param {number} dailyRange - diurnal temperature range (°F); 0 = use seasonal default
 * @returns {number} mean outdoor dry-bulb (°F)
 */
export const getMeanOutdoorTemp = (dbOutdoor, season, dailyRange = 0) => {
  const dr = dailyRange > 0
    ? dailyRange
    : (DIURNAL_RANGE_DEFAULTS[season] ?? 18);
  return dbOutdoor - dr / 2;
};

// ── Latitude-Month (LM) CLTD correction ───────────────────────────────────────
/**
 * getLM(latitude, orientation)
 *
 * Returns the latitude-month correction (°F) for CLTD.
 * Orientation is swapped for southern hemisphere before table lookup.
 *
 * @param {number} latitude    - site latitude (degrees; negative = south)
 * @param {string} orientation - wall orientation ('N','NE','E',...)
 * @returns {number} LM correction (°F)
 */
export const getLM = (latitude, orientation) => {
  const absLat = Math.abs(latitude);
  const orient = swapForHemisphere(orientation, latitude);
  return interpolateLatitude(CLTD_LM, absLat, orient);
};

// ── Latitude-corrected SHGF ───────────────────────────────────────────────────
/**
 * getCorrectedSHGF(orientation, season, latitude)
 *
 * Returns SHGF (BTU/hr·ft²) corrected for site latitude.
 * Base table is at 32°N. Both the base SHGF and the latitude correction factor
 * use the hemisphere-swapped orientation to correctly represent southern
 * hemisphere solar geometry.
 *
 * @param {string} orientation - 'N','NE','E','SE','S','SW','W','NW','Horizontal'
 * @param {string} season      - 'summer' | 'monsoon' | 'winter'
 * @param {number} latitude    - site latitude (degrees; negative = south)
 * @returns {number} corrected SHGF (BTU/hr·ft²)
 */
export const getCorrectedSHGF = (orientation, season, latitude) => {
  const absLat = Math.abs(latitude);
  const orient = swapForHemisphere(orientation, latitude);

  // Both base SHGF and latitude factor use the swapped orientation.
  // For southern hemisphere, a S-facing element receives the same low summer
  // sun as a N-facing element in the northern hemisphere — so we look up the
  // swapped key in both tables.
  const baseSHGF = SHGF[orient]?.[season] ?? 100;
  const factor   = interpolateLatitude(SHGF_LATITUDE_FACTOR, absLat, orient);
  return baseSHGF * factor;
};

// ── SHGC resolver ─────────────────────────────────────────────────────────────
/**
 * resolveShgc(glass)
 *
 * Extracts SHGC from a glass element.
 * Prefers glass.shgc (modern NFRC field).
 * Falls back to glass.sc × 0.87 (legacy shading coefficient conversion,
 * ASHRAE HOF 2021 Ch.15).
 *
 * @param {object} glass - glass element from envelopeSlice
 * @returns {number} SHGC (dimensionless, 0–1)
 */
export const resolveShgc = (glass) => {
  const shgc = parseFloat(glass?.shgc);
  if (!isNaN(shgc) && shgc > 0) return shgc;
  const sc = parseFloat(glass?.sc) || 1.0;
  return sc * 0.87;
};