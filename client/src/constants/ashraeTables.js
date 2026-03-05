/**
 * ASHRAE CLTD / CLF / SHGF Reference Tables
 * Reference: ASHRAE Handbook of Fundamentals (2021), Chapter 18
 *            ASHRAE Cooling & Heating Load Calculation Manual (2nd ed)
 *            ASHRAE 90.1-2022 (glazing SHGC values)
 *
 * CHANGELOG vs original:
 *   v2.0 — correctCLTD() now includes diurnal range multiplier (DR/21) per
 *           ASHRAE HOF Ch.28. Missing this caused 15–20% underestimate at
 *           desert / high-DR sites. lmCorrection param also consolidated here.
 *   v2.0 — SC_OPTIONS kept for backward compatibility. GLAZING_OPTIONS added
 *           with dual SC + SHGC columns. SHGC is the current ASHRAE 90.1
 *           standard; SC = SHGC / 0.87 (approx). Users entering manufacturer
 *           SHGC specs should use the shgc column going forward.
 *   v2.0 — SLAB_F_FACTOR table added for slab-on-grade heating load
 *           (F-factor method, ASHRAE HOF Ch.18).
 *   v2.0 — EQUIPMENT_LOAD_DENSITY table added for critical facilities.
 *           Source: ASHRAE HOF 2021 Ch.18 + ASHRAE TC 9.9.
 *   v2.0 — U_VALUE_PRESETS expanded with cleanroom panel, pharma raised floor,
 *           and vapor-barrier wall assembly types.
 *   v2.0 — CALCULATION_METHOD flag added to document CLTD/CLF as legacy method.
 *
 * BUG-07 FIX: Two correction tables added (original):
 *   CLTD_LM  — Latitude Month correction (°F) to add to CLTD.
 *   SHGF_LATITUDE_FACTOR — Multiplier applied to the 32°N SHGF base table.
 *   interpolateLatitude() — Linear interpolation between table rows.
 *
 * BUG-09 FIX: DIURNAL_HALF removed from envelopeCalc.js (hardcoded).
 *   Replaced by DIURNAL_RANGE_DEFAULTS.
 */

// ── Calculation Method Flag ───────────────────────────────────────────────────
// CLTD/CLF is a legacy method (ASHRAE 1997 HOF). It was superseded by the
// Radiant Time Series (RTS) method in ASHRAE 2001+. CLTD/CLF remains acceptable
// for preliminary design and most jurisdictions, but engineers at critical
// facilities (semiconductor fabs, pharma) may ask. Flag this in UI/reports.
export const CALCULATION_METHOD = {
  name:       'CLTD/CLF',
  standard:   'ASHRAE HOF 1997 / CHLCM 2nd ed.',
  status:     'legacy',         // 'legacy' | 'rts' — expand to RTS in v3
  disclaimer: 'CLTD/CLF method uses single peak-hour values (3 PM, July, 40°N). ' +
              'For 24/7 critical facilities, results represent the peak cooling ' +
              'condition and may not capture worst-case off-peak hours. ' +
              'Radiant Time Series (RTS) analysis recommended for final design.',
};

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
// NOTE: ASHRAE organises roof CLTD by assembly group (A–J), not insulation
// thickness alone. Values below are representative midpoints per group.
// Metal deck and concrete slab assemblies with the same insulation thickness
// have different thermal lag — see ASHRAE CHLCM Table 4 for full group details.
export const ROOF_CLTD = {
  'No insulation':                    54,
  '1" insulation':                    40,
  '2" insulation':                    30,
  '3" insulation':                    24,
  '4" insulation':                    20,
  'Heavy concrete (6")':              16,
  'Heavy concrete (8")':              12,
  'Metal deck + 2" insulation':       28,   // NEW — distinct from built-up + 2"
  'Metal deck + 3" insulation':       22,   // NEW
  'Concrete slab + 2" insulation':    20,   // NEW — higher thermal mass → lower peak
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
// Applied as: SHGF_actual = SHGF_32N × factor
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
// Source: ASHRAE Fundamentals Ch 14.
export const DIURNAL_RANGE_DEFAULTS = {
  summer:  18,  // °F — inland typical
  monsoon: 12,  // °F — cloud cover suppresses swing
  winter:  20,  // °F — clear skies increase swing
};

// ── Latitude interpolation helper ─────────────────────────────────────────────
/**
 * Linearly interpolate a value from a latitude-keyed table.
 *
 * @param {Object} table  - Object with numeric latitude keys
 * @param {number} lat    - Actual latitude in degrees (use Math.abs for S hemi)
 * @param {string} key    - Orientation key e.g. 'N', 'E', 'Horizontal'
 * @returns {number} Interpolated value
 */
export const interpolateLatitude = (table, lat, key) => {
  const latitudes = Object.keys(table).map(Number).sort((a, b) => a - b);

  if (lat <= latitudes[0])
    return table[latitudes[0]][key] ?? 0;
  if (lat >= latitudes[latitudes.length - 1])
    return table[latitudes[latitudes.length - 1]][key] ?? 0;

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

// ── Glazing Options — SC and SHGC ────────────────────────────────────────────
// ASHRAE replaced Shading Coefficient (SC) with Solar Heat Gain Coefficient
// (SHGC) in HOF 1997. ASHRAE 90.1-2022 compliance uses SHGC exclusively.
// Relationship: SHGC ≈ SC × 0.87
//
// GLAZING_OPTIONS is the new standard export — use shgc for all new calculations.
// SC_OPTIONS is kept below as a backward-compatible alias.
export const GLAZING_OPTIONS = [
  { label: 'Single Clear Glass',            sc: 1.00, shgc: 0.86 },
  { label: 'Single Tinted (Bronze/Grey)',   sc: 0.70, shgc: 0.61 },
  { label: 'Double Clear Glass',            sc: 0.88, shgc: 0.76 },
  { label: 'Double Tinted',                 sc: 0.60, shgc: 0.52 },
  { label: 'Double Clear + Internal Blind', sc: 0.56, shgc: 0.49 },
  { label: 'Double Clear + External Shade', sc: 0.25, shgc: 0.22 },
  { label: 'Low-E Coating (Clear)',         sc: 0.44, shgc: 0.38 },
  { label: 'Low-E Coating (Tinted)',        sc: 0.30, shgc: 0.26 },
  { label: 'Reflective Glass',              sc: 0.25, shgc: 0.22 },
  { label: 'Triple Clear Glass',            sc: 0.74, shgc: 0.64 },
];

// Backward-compatible alias — existing code using SC_OPTIONS continues to work.
export const SC_OPTIONS = GLAZING_OPTIONS.map(g => ({ label: g.label, value: g.sc }));

// ── U-Value Presets (BTU/hr·ft²·°F) ──────────────────────────────────────────
export const U_VALUE_PRESETS = {
  walls: [
    { label: '8" Concrete Block (uninsulated)',            value: 0.48 },
    { label: '8" Concrete Block + 1" insulation',         value: 0.22 },
    { label: '8" Concrete Block + 2" insulation',         value: 0.14 },
    { label: 'Brick Veneer + Stud + Insulation',          value: 0.08 },
    { label: 'Metal Sandwich Panel (insulated)',           value: 0.10 },
    { label: 'Precast Concrete Panel',                    value: 0.35 },
    // Critical facility additions:
    { label: 'Cleanroom Panel — pharma grade (PIR core)', value: 0.07 },  // NEW
    { label: 'Cleanroom Panel — semiconductor (mineral)', value: 0.08 },  // NEW
    { label: 'Vapor-barrier wall — battery/Li-ion mfg',  value: 0.12 },  // NEW
    { label: 'Radiation-shielded wall (dense concrete)',  value: 1.80 },  // NEW
    { label: 'Custom',                                    value: null  },
  ],
  roofs: [
    { label: 'Built-up Roof (no insulation)',             value: 0.79 },
    { label: 'Built-up + 1" rigid insulation',            value: 0.24 },
    { label: 'Built-up + 2" rigid insulation',            value: 0.15 },
    { label: 'Built-up + 3" rigid insulation',            value: 0.11 },
    { label: 'Metal Deck + 2" insulation',                value: 0.13 },
    { label: 'Metal Deck + 3" insulation',                value: 0.10 },  // NEW
    { label: 'Concrete Slab (6")',                        value: 0.36 },
    { label: 'Concrete Slab + 2" rigid insulation',       value: 0.12 },  // NEW
    { label: 'Custom',                                    value: null  },
  ],
  glass: [
    { label: 'Single Clear (1/4")',        value: 1.04 },
    { label: 'Single Tinted (1/4")',       value: 1.04 },
    { label: 'Double Clear (1/2" air)',    value: 0.55 },
    { label: 'Double Clear (1/2" argon)',  value: 0.48 },
    { label: 'Double Low-E (1/2" air)',    value: 0.38 },
    { label: 'Double Low-E (1/2" argon)', value: 0.30 },
    { label: 'Triple Clear',              value: 0.28 },
    { label: 'Custom',                    value: null  },
  ],
  partitions: [
    { label: 'Gypsum Board + Stud (uninsulated)', value: 0.35 },
    { label: 'Gypsum Board + Stud + Insulation',  value: 0.09 },
    { label: 'Concrete Block (4")',               value: 0.70 },
    { label: 'Concrete Block (8")',               value: 0.53 },
    { label: 'Cleanroom Panel (partition)',        value: 0.07 },  // NEW
    { label: 'Custom',                            value: null  },
  ],
  floors: [
    { label: 'Concrete Slab on Grade',              value: 0.10 },
    { label: 'Concrete + Carpet',                   value: 0.08 },
    { label: 'Raised Floor (plenum below)',          value: 0.25 },
    { label: 'Raised Floor — pharma (adiabatic)',   value: 0.05 },  // NEW
    { label: 'Raised Floor — semiconductor (AL)',   value: 0.15 },  // NEW
    { label: 'Custom',                              value: null  },
  ],
};

// ── Slab-on-Grade F-Factor (BTU/hr·ft·°F) ────────────────────────────────────
// Source: ASHRAE HOF 2021 Ch.18, Table 12
// Used for heating load only: Q_slab = F × perimeter_ft × ΔT
// This is the ASHRAE F-factor (edge loss) method for unheated slabs.
// For heated slabs (pharma process areas), use the full HOF Ch.18 procedure.
export const SLAB_F_FACTOR = {
  'Uninsulated':                         0.73,
  'R-5 vertical insulation (2 ft deep)': 0.55,
  'R-10 vertical insulation (2 ft deep)':0.45,
  'R-15 vertical insulation (4 ft deep)':0.40,
};

// ── Equipment Load Densities — Critical Facilities ───────────────────────────
// Source: ASHRAE HOF 2021 Ch.18 + ASHRAE TC 9.9 (data centers) +
//         ISPE Baseline Guide Vol.5 (pharmaceutical)
//
// diversityFactor: fraction of installed load assumed simultaneously active.
// Use these as fallbacks when actual equipment schedules are unavailable.
// Always replace with measured / vendor nameplate data when available.
export const EQUIPMENT_LOAD_DENSITY = {
  'Semiconductor fab — light tools':   { wPerFt2:  50, diversityFactor: 0.70 },
  'Semiconductor fab — heavy tools':   { wPerFt2: 200, diversityFactor: 0.65 },
  'Pharma process — general':          { wPerFt2:  30, diversityFactor: 0.75 },
  'Pharma process — high intensity':   { wPerFt2:  80, diversityFactor: 0.70 },
  'Battery formation — Li-ion':        { wPerFt2:  80, diversityFactor: 0.80 },
  'Battery formation — solid state':   { wPerFt2: 120, diversityFactor: 0.80 },
  'Solar cell manufacturing':          { wPerFt2:  60, diversityFactor: 0.75 },
  'Data center / server room':         { wPerFt2: 100, diversityFactor: 0.90 },
  'General laboratory':                { wPerFt2:  25, diversityFactor: 0.70 },
  'Office / admin':                    { wPerFt2:   5, diversityFactor: 0.65 },
};

// ── Orientation & Construction Options ───────────────────────────────────────
export const ORIENTATIONS       = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const WALL_CONSTRUCTIONS = ['light', 'medium', 'heavy'];
export const ROOF_CONSTRUCTIONS = Object.keys(ROOF_CLTD);
export const ROOM_MASS_OPTIONS  = ['light', 'medium', 'heavy'];

// ── CLTD Correction Formula ───────────────────────────────────────────────────
/**
 * Corrects tabulated CLTD for actual design conditions.
 * ASHRAE Fundamentals Ch 28, Eq. 2 + diurnal range correction:
 *
 *   CLTD_corrected = [CLTD_table + (78 − t_room) + (t_outdoor_mean − 85) + LM] × (DR / 21)
 *
 * Reference conditions in the table:
 *   t_room         = 78°F
 *   t_outdoor_mean = 85°F  (= (DB_max + DB_min) / 2)
 *   diurnal range  = 21°F  (reference swing in ASHRAE tables)
 *   LM             = 0     (40°N reference latitude)
 *
 * IMPORTANT: Omitting the (DR/21) multiplier causes 15–20% underestimation
 * at desert or high-swing sites (DR > 25°F). Always pass actual site DR.
 *
 * @param {number} cltdTable     - Tabulated CLTD value (°F)
 * @param {number} tRoom         - Room design dry-bulb (°F), reference = 78°F
 * @param {number} tOutdoorMean  - Mean outdoor dry-bulb (°F), reference = 85°F
 * @param {number} diurnalRange  - Actual daily temp swing (°F), reference = 21°F
 * @param {number} lmCorrection  - Latitude-month correction from CLTD_LM (°F)
 * @returns {number} Corrected CLTD in °F
 */
export const correctCLTD = (
  cltdTable,
  tRoom,
  tOutdoorMean,
  diurnalRange  = 21,
  lmCorrection  = 0,
) => {
  const base = cltdTable + (78 - tRoom) + (tOutdoorMean - 85) + lmCorrection;
  return base * (diurnalRange / 21);
};

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
    shgc:        0.76,   // NEW — mirrors sc entry; use shgc for new calcs
    scPreset:    'Double Clear Glass',
    roomMass:    'medium',
  },
  skylights: {
    label:    'Skylight',
    area:     0,
    uValue:   0.55,
    uPreset:  'Double Clear (1/2" air)',
    sc:       0.88,
    shgc:     0.76,      // NEW
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