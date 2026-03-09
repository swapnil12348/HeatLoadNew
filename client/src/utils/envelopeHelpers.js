/**
 * envelopeHelpers.js
 * Internal helpers shared across envelope calculation modules.
 *
 * ⚠️  Not part of the public API. Import only from:
 *       envelopeCalc.js
 *       glazingCalc.js
 *
 * Reference: ASHRAE Handbook — Fundamentals (2021), Ch.18 & 27
 */

import {
  CLTD_LM,
  SHGF,
  SHGF_LATITUDE_FACTOR,
  DIURNAL_RANGE_DEFAULTS,
  interpolateLatitude,
} from '../constants/ashraeTables';

// ── Southern hemisphere orientation swap ──────────────────────────────────────
// For sites south of the equator, N/S and NE/SE/SW/NW orientations swap.
// E and W are symmetric and do not swap.
const SOUTHERN_SWAP = {
  N: 'S', S: 'N',
  NE: 'SE', SE: 'NE',
  SW: 'NW', NW: 'SW',
};

const swapForHemisphere = (orientation, latitude) =>
  latitude < 0
    ? (SOUTHERN_SWAP[orientation] ?? orientation)
    : orientation;

// ── Mean outdoor dry-bulb temperature ─────────────────────────────────────────
/**
 * getMeanOutdoorTemp(dbOutdoor, season, dailyRange?)
 *
 * ASHRAE: tMean = tPeak − DR/2
 * tMean is the pre-computed value required by correctCLTD().
 *
 * @param {number} dbOutdoor  - peak outdoor dry-bulb (°F)
 * @param {string} season     - 'summer' | 'monsoon' | 'winter'
 * @param {number} dailyRange - diurnal temperature range (°F); 0 = use default
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
 * Handles southern hemisphere orientation swap automatically.
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
 * Base table is at 32°N; SHGF_LATITUDE_FACTOR scales to actual latitude.
 * Handles southern hemisphere orientation swap.
 *
 * @param {string} orientation - 'N','NE','E','SE','S','SW','W','NW','Horizontal'
 * @param {string} season      - 'summer' | 'monsoon' | 'winter'
 * @param {number} latitude    - site latitude (degrees; negative = south)
 * @returns {number} corrected SHGF (BTU/hr·ft²)
 */
export const getCorrectedSHGF = (orientation, season, latitude) => {
  const baseSHGF = SHGF[orientation]?.[season] ?? 100;
  const absLat   = Math.abs(latitude);
  const orient   = swapForHemisphere(orientation, latitude);
  const factor   = interpolateLatitude(SHGF_LATITUDE_FACTOR, absLat, orient);
  return baseSHGF * factor;
};

// ── SHGC resolver ─────────────────────────────────────────────────────────────
/**
 * resolveShgc(glass)
 *
 * Extracts SHGC from a glass element.
 * Prefers glass.shgc (modern field). Falls back to glass.sc × 0.87 (legacy).
 * The 0.87 factor converts shading coefficient to SHGC per ASHRAE HOF Ch.15.
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