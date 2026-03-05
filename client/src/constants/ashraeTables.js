/**
 * ASHRAE CLTD / CLF / SHGF Reference Tables
 * Reference: ASHRAE Handbook of Fundamentals (2021), Chapter 18
 *            ASHRAE Cooling & Heating Load Calculation Manual (2nd ed)
 *
 * BUG-07 FIX: Two new correction tables added:
 *
 *   CLTD_LM  — Latitude Month correction (°F) to add to CLTD.
 *              Shifts the 40°N reference table to actual project latitude.
 *              Source: ASHRAE CHLCM Table B-6, July, northern hemisphere.
 *
 *   SHGF_LATITUDE_FACTOR — Multiplier applied to the 32°N SHGF base table.
 *              Corrects solar heat gain for actual project latitude.
 *              Source: ASHRAE Fundamentals Ch 27, Tables 15–19, interpolated.
 *
 *   interpolateLatitude() — Linear interpolation between table rows.
 *
 * BUG-09 FIX: DIURNAL_HALF removed from envelopeCalc.js (hardcoded).
 *   Replaced by DIURNAL_RANGE_DEFAULTS — used only when the project does
 *   not supply an explicit dailyRange value. Engineers can now set the
 *   actual site daily temperature range in ProjectDetails.
 */

// ── Wall CLTD (°F) ───────────────────────────────────────────────────────────
// Source: ASHRAE Table 1, Chapter 28
// Reference: 40°N latitude, July 15, peak hour (15:00 solar time)
// Wall mass groups:
//   Light  = frame / metal panels       (< 30 lb/ft²)
//   Medium = brick veneer / CMU block   (30–80 lb/ft²)
//   Heavy  = concrete / solid brick     (> 80 lb/ft²)
export const WALL_CLTD = {
  N:  { light: 12, medium:  9, heavy:  6 },
  NE: { light: 22, medium: 17, heavy: 12 },
  E:  { light: 33, medium: 26, heavy: 18 },
  SE: { light: 30, medium: 24, heavy: 17 },
  S:  { light: 20, medium: 16, heavy: 11 },
  SW: { light: 38, medium: 30, heavy: 21 },
  W:  { light: 42, medium: 33, heavy: 23 },
  NW: { light: 28, medium: 22, heavy: 15 },
};

export const WALL_CLTD_SEASONAL = {
  summer:  1.00,
  monsoon: 0.85,
  winter:  0.40,
};

// ── Roof CLTD (°F) ───────────────────────────────────────────────────────────
// Source: ASHRAE Table 4, Chapter 28
// Flat roofs, peak CLTD at 3 PM, July, 40°N
export const ROOF_CLTD = {
  'No insulation':        54,
  '1" insulation':        40,
  '2" insulation':        30,
  '3" insulation':        24,
  '4" insulation':        20,
  'Heavy concrete (6")':  16,
  'Heavy concrete (8")':  12,
};

export const ROOF_CLTD_SEASONAL = {
  summer:  1.00,
  monsoon: 0.80,
  winter:  0.30,
};

// ── BUG-07 FIX: CLTD Latitude Month (LM) Correction ─────────────────────────
// Source: ASHRAE Cooling & Heating Load Calculation Manual, Table B-6
//
// These values are ADDED to the corrected CLTD to shift the 40°N reference
// table to the actual project latitude (July, northern hemisphere).
//
// Physical meaning:
//   Negative LM → less solar exposure at that orientation for that latitude
//                 (e.g. South-facing walls receive less summer sun at low latitudes
//                  because the sun is more directly overhead, not at a low angle)
//   Positive LM → more solar exposure (e.g. high-latitude S-facing surfaces
//                  see more oblique summer sun → higher CLTD)
//
// Latitude 40 = 0 for all orientations (it's the reference).
// Southern hemisphere: use abs(latitude) but swap N↔S.
//
export const CLTD_LM = {
  //        N    NE    E    SE    S    SW    W    NW
   0: { N:  1, NE: -2, E: -5, SE: -3, S: -7, SW: -3, W: -5, NW: -2 },
  10: { N:  0, NE: -1, E: -3, SE: -2, S: -5, SW: -2, W: -3, NW: -1 },
  20: { N: -1, NE:  0, E: -2, SE: -1, S: -3, SW: -1, W: -2, NW:  0 },
  24: { N: -1, NE:  0, E: -1, SE: -1, S: -2, SW: -1, W: -1, NW:  0 },
  32: { N:  0, NE:  0, E: -1, SE:  0, S: -1, SW:  0, W: -1, NW:  0 },
  36: { N:  0, NE:  0, E:  0, SE:  0, S: -1, SW:  0, W:  0, NW:  0 },
  40: { N:  0, NE:  0, E:  0, SE:  0, S:  0, SW:  0, W:  0, NW:  0 },
  48: { N:  1, NE:  1, E:  2, SE:  1, S:  3, SW:  1, W:  2, NW:  1 },
  56: { N:  2, NE:  2, E:  3, SE:  2, S:  5, SW:  2, W:  3, NW:  2 },
};

// ── Glass Conduction CLTD (°F) ───────────────────────────────────────────────
// Source: ASHRAE Handbook — Fundamentals, Table 7, Ch 18
export const GLASS_CLTD = {
  summer:  15,
  monsoon: 12,
  winter:  -5,
};

// ── Solar Heat Gain Factor — SHGF (BTU/hr·ft²) ───────────────────────────────
// Source: ASHRAE Table 15, Chapter 27
// Maximum SHGF — reference latitude: 32°N
// (India, Middle East, subtropics)
export const SHGF = {
  N:          { summer:  20, monsoon:  18, winter:  10 },
  NE:         { summer:  73, monsoon:  65, winter:  30 },
  E:          { summer: 152, monsoon: 130, winter:  62 },
  SE:         { summer: 124, monsoon: 106, winter:  77 },
  S:          { summer:  48, monsoon:  42, winter: 113 },
  SW:         { summer: 124, monsoon: 106, winter:  77 },
  W:          { summer: 152, monsoon: 130, winter:  62 },
  NW:         { summer:  73, monsoon:  65, winter:  30 },
  Horizontal: { summer: 248, monsoon: 210, winter: 148 },
};

// ── BUG-07 FIX: SHGF Latitude Correction Factors ─────────────────────────────
// Source: ASHRAE Fundamentals Ch 27, Tables 15–19, interpolated.
//
// Applied as: SHGF_actual = SHGF_32N × factor
//
// Physical meaning:
//   N-facing: tropical sites (lat < 32°N) get MORE direct sun on N face because
//             the sun passes slightly north of zenith at solstice → factor < 1.0
//             Higher latitudes: sun stays south → N face gets less sun → factor > 1.0
//             Wait — actually at latitudes < 23.5°N the sun IS north at solstice,
//             meaning N-facing gets significant solar → factor < 1.0 vs 32°N ref.
//   S-facing: at low latitudes, summer sun is directly overhead or slightly north,
//             so S-facing surfaces see much less summer radiation → factor < 1.0.
//             At high latitudes, summer sun stays low in south → S face gets more.
//   E/W:      relatively stable across latitudes in summer → factors near 1.0.
//
export const SHGF_LATITUDE_FACTOR = {
  //       N     NE    E     SE    S     SW    W     NW    Horizontal
   0: { N: 0.60, NE: 1.00, E: 1.00, SE: 0.82, S: 0.38, SW: 0.82, W: 1.00, NW: 1.00, Horizontal: 1.06 },
  10: { N: 0.72, NE: 1.00, E: 1.00, SE: 0.88, S: 0.55, SW: 0.88, W: 1.00, NW: 1.00, Horizontal: 1.04 },
  20: { N: 0.88, NE: 1.00, E: 1.00, SE: 0.95, S: 0.78, SW: 0.95, W: 1.00, NW: 1.00, Horizontal: 1.01 },
  32: { N: 1.00, NE: 1.00, E: 1.00, SE: 1.00, S: 1.00, SW: 1.00, W: 1.00, NW: 1.00, Horizontal: 1.00 },
  40: { N: 1.15, NE: 1.00, E: 1.00, SE: 1.04, S: 1.22, SW: 1.04, W: 1.00, NW: 1.00, Horizontal: 0.97 },
  48: { N: 1.35, NE: 1.02, E: 0.98, SE: 1.08, S: 1.52, SW: 1.08, W: 0.98, NW: 1.02, Horizontal: 0.93 },
  56: { N: 1.60, NE: 1.05, E: 0.96, SE: 1.14, S: 1.90, SW: 1.14, W: 0.96, NW: 1.05, Horizontal: 0.88 },
};

// ── BUG-09 FIX: Diurnal Range Defaults ───────────────────────────────────────
// Used ONLY when the project does not supply an explicit dailyRange value.
// Engineers should override this in ProjectDetails → Ambient → Daily Temp Range.
//
// These are typical values by season — NOT site-specific.
// Source: ASHRAE Fundamentals Ch 14.
//
// Site categories:
//   Coastal / humid: 8–12°F (e.g. Mumbai, Chennai)
//   Inland plains:   18–25°F (e.g. Delhi, Karachi)
//   Desert:          28–40°F (e.g. Riyadh, Jodhpur)
//
// Default season splits reflect the fact that monsoon suppresses the diurnal
// range (cloud cover and latent heat buffer the swing).
export const DIURNAL_RANGE_DEFAULTS = {
  summer:  18,  // °F — inland typical (was hardcoded 10×2=20 half)
  monsoon: 12,  // °F — cloud cover suppresses swing
  winter:  20,  // °F — clear skies increase swing
};

// ── Latitude interpolation helper ─────────────────────────────────────────────
/**
 * Linearly interpolate a value from a latitude-keyed table.
 *
 * @param {Object} table  - Object with numeric latitude keys, each mapping to
 *                          an object of { orientationKey: number }
 * @param {number} lat    - Actual latitude in degrees (use Math.abs for S hemi)
 * @param {string} key    - Orientation key e.g. 'N', 'E', 'Horizontal'
 * @returns {number} Interpolated value
 */
export const interpolateLatitude = (table, lat, key) => {
  const latitudes = Object.keys(table).map(Number).sort((a, b) => a - b);

  // Clamp to table bounds
  if (lat <= latitudes[0])                  return table[latitudes[0]][key]                   ?? 0;
  if (lat >= latitudes[latitudes.length - 1]) return table[latitudes[latitudes.length - 1]][key] ?? 0;

  // Find bounding rows
  let lower = latitudes[0];
  let upper = latitudes[latitudes.length - 1];
  for (let i = 0; i < latitudes.length - 1; i++) {
    if (lat >= latitudes[i] && lat <= latitudes[i + 1]) {
      lower = latitudes[i];
      upper = latitudes[i + 1];
      break;
    }
  }

  const lv = table[lower][key] ?? 0;
  const uv = table[upper][key] ?? 0;
  const t  = (lat - lower) / (upper - lower);
  return lv + t * (uv - lv);
};

// ── Cooling Load Factor — CLF (dimensionless) ─────────────────────────────────
// Source: ASHRAE Table 13, Chapter 28
export const CLF = {
  N:          { light: 0.73, medium: 0.62, heavy: 0.49 },
  NE:         { light: 0.38, medium: 0.30, heavy: 0.22 },
  E:          { light: 0.47, medium: 0.38, heavy: 0.28 },
  SE:         { light: 0.53, medium: 0.44, heavy: 0.34 },
  S:          { light: 0.64, medium: 0.55, heavy: 0.44 },
  SW:         { light: 0.69, medium: 0.60, heavy: 0.50 },
  W:          { light: 0.73, medium: 0.65, heavy: 0.55 },
  NW:         { light: 0.68, medium: 0.58, heavy: 0.46 },
  Horizontal: { light: 0.75, medium: 0.65, heavy: 0.55 },
};

// ── Shading Coefficient — SC ──────────────────────────────────────────────────
export const SC_OPTIONS = [
  { label: 'Single Clear Glass',            value: 1.00 },
  { label: 'Single Tinted (Bronze/Grey)',   value: 0.70 },
  { label: 'Double Clear Glass',            value: 0.88 },
  { label: 'Double Tinted',                 value: 0.60 },
  { label: 'Double Clear + Internal Blind', value: 0.56 },
  { label: 'Double Clear + External Shade', value: 0.25 },
  { label: 'Low-E Coating (Clear)',         value: 0.44 },
  { label: 'Low-E Coating (Tinted)',        value: 0.30 },
  { label: 'Reflective Glass',              value: 0.25 },
  { label: 'Triple Clear Glass',            value: 0.74 },
];

// ── U-Value Presets (BTU/hr·ft²·°F) ──────────────────────────────────────────
export const U_VALUE_PRESETS = {
  walls: [
    { label: '8" Concrete Block (uninsulated)',   value: 0.48 },
    { label: '8" Concrete Block + 1" insulation', value: 0.22 },
    { label: '8" Concrete Block + 2" insulation', value: 0.14 },
    { label: 'Brick Veneer + Stud + Insulation',  value: 0.08 },
    { label: 'Metal Sandwich Panel (insulated)',   value: 0.10 },
    { label: 'Precast Concrete Panel',             value: 0.35 },
    { label: 'Custom',                             value: null },
  ],
  roofs: [
    { label: 'Built-up Roof (no insulation)',      value: 0.79 },
    { label: 'Built-up + 1" rigid insulation',     value: 0.24 },
    { label: 'Built-up + 2" rigid insulation',     value: 0.15 },
    { label: 'Built-up + 3" rigid insulation',     value: 0.11 },
    { label: 'Metal Deck + 2" insulation',         value: 0.13 },
    { label: 'Concrete Slab (6")',                 value: 0.36 },
    { label: 'Custom',                             value: null },
  ],
  glass: [
    { label: 'Single Clear (1/4")',        value: 1.04 },
    { label: 'Single Tinted (1/4")',       value: 1.04 },
    { label: 'Double Clear (1/2" air)',    value: 0.55 },
    { label: 'Double Clear (1/2" argon)',  value: 0.48 },
    { label: 'Double Low-E (1/2" air)',    value: 0.38 },
    { label: 'Double Low-E (1/2" argon)',  value: 0.30 },
    { label: 'Triple Clear',              value: 0.28 },
    { label: 'Custom',                    value: null },
  ],
  partitions: [
    { label: 'Gypsum Board + Stud (uninsulated)', value: 0.35 },
    { label: 'Gypsum Board + Stud + Insulation',  value: 0.09 },
    { label: 'Concrete Block (4")',               value: 0.70 },
    { label: 'Concrete Block (8")',               value: 0.53 },
    { label: 'Custom',                            value: null },
  ],
  floors: [
    { label: 'Concrete Slab on Grade',      value: 0.10 },
    { label: 'Concrete + Carpet',           value: 0.08 },
    { label: 'Raised Floor (plenum below)', value: 0.25 },
    { label: 'Custom',                      value: null },
  ],
};

// ── Orientation & Construction Options ───────────────────────────────────────
export const ORIENTATIONS       = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const WALL_CONSTRUCTIONS = ['light', 'medium', 'heavy'];
export const ROOF_CONSTRUCTIONS = Object.keys(ROOF_CLTD);
export const ROOM_MASS_OPTIONS  = ['light', 'medium', 'heavy'];

// ── CLTD Correction Formula ───────────────────────────────────────────────────
/**
 * Corrects tabulated CLTD for actual design conditions.
 * ASHRAE Fundamentals Ch 28, Eq. 2:
 *
 *   CLTD_corrected = CLTD_table + (78 − t_room) + (t_outdoor_mean − 85)
 *
 * Reference conditions in table:
 *   t_room         = 78°F
 *   t_outdoor_mean = 85°F  (= (DB_max + DB_min) / 2)
 */
export const correctCLTD = (cltdTable, tRoom, tOutdoorMean) =>
  cltdTable + (78 - tRoom) + (tOutdoorMean - 85);

// ── Default element templates ─────────────────────────────────────────────────
export const DEFAULT_ELEMENTS = {
  walls: {
    label:        'Exposed Wall',
    orientation:  'N',
    construction: 'medium',
    area:         0,
    uValue:       0.48,
    uPreset:      '8" Concrete Block (uninsulated)',
  },
  roofs: {
    label:        'Roof Exposed',
    construction: '2" insulation',
    area:         0,
    uValue:       0.15,
    uPreset:      'Built-up + 2" rigid insulation',
  },
  glass: {
    label:       'Exposed Glass',
    orientation: 'E',
    area:        0,
    uValue:      0.55,
    uPreset:     'Double Clear (1/2" air)',
    sc:          0.88,
    scPreset:    'Double Clear Glass',
    roomMass:    'medium',
  },
  skylights: {
    label:    'Skylight',
    area:     0,
    uValue:   0.55,
    uPreset:  'Double Clear (1/2" air)',
    sc:       0.88,
    scPreset: 'Double Clear Glass',
    roomMass: 'medium',
  },
  partitions: {
    label:   'Partition Wall',
    area:    0,
    uValue:  0.35,
    uPreset: 'Gypsum Board + Stud (uninsulated)',
    tAdj:    85,
  },
  floors: {
    label:   'Floor',
    area:    0,
    uValue:  0.10,
    uPreset: 'Concrete Slab on Grade',
    tAdj:    75,
  },
};