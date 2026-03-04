/**
 * ASHRAE CLTD / CLF / SHGF Reference Tables
 * Reference: ASHRAE Handbook of Fundamentals (2021), Chapter 18
 *            ASHRAE Cooling & Heating Load Calculation Manual
 *
 * CLTD  — Cooling Load Temperature Difference (°F)
 * SHGF  — Solar Heat Gain Factor (BTU/hr·ft²)
 * CLF   — Cooling Load Factor (dimensionless)
 * SC    — Shading Coefficient (dimensionless)
 * U     — Overall Heat Transfer Coefficient (BTU/hr·ft²·°F)
 *
 * Notes:
 *  - CLTD values are for 40°N latitude, July 15, peak hour (15:00 solar time)
 *  - Corrections applied for actual indoor/outdoor design temps via CLTD_corrected
 *  - SHGF values are maximum daily values for 32°N latitude (appropriate for
 *    tropical/subtropical climates — adjust latitude correction as needed)
 *  - All values in IP (Imperial) units — BTU, ft², °F
 */

// ── Wall CLTD (°F) ──────────────────────────────────────────────────────────
// Source: ASHRAE Table 1, Chapter 28 (Cooling Load Calculation Methods)
// Wall Group Classification (by thermal mass):
//   Light  = frame walls, metal panels       (mass < 30 lb/ft²)
//   Medium = brick veneer, concrete block    (mass 30–80 lb/ft²)
//   Heavy  = concrete, brick                 (mass > 80 lb/ft²)
//
// Peak CLTD at 3 PM solar time, July, 40°N

export const WALL_CLTD = {
  // [orientation]: { light, medium, heavy }
  N:  { light: 12, medium: 9,  heavy: 6  },
  NE: { light: 22, medium: 17, heavy: 12 },
  E:  { light: 33, medium: 26, heavy: 18 },
  SE: { light: 30, medium: 24, heavy: 17 },
  S:  { light: 20, medium: 16, heavy: 11 },
  SW: { light: 38, medium: 30, heavy: 21 },
  W:  { light: 42, medium: 33, heavy: 23 },
  NW: { light: 28, medium: 22, heavy: 15 },
};

// Winter — transmission only, no solar (conservative: use outdoor-indoor ΔT)
// Monsoon — use Summer values reduced by 15% (cloud cover attenuates solar)
export const WALL_CLTD_SEASONAL = {
  summer:  1.00, // multiplier on WALL_CLTD base values
  monsoon: 0.85, // reduced solar due to cloud cover
  winter:  0.40, // heating season — transmission dominant, minimal solar gain
};

// ── Roof CLTD (°F) ──────────────────────────────────────────────────────────
// Source: ASHRAE Table 4, Chapter 28
// Flat roofs — peak CLTD at 3 PM, July, 40°N
export const ROOF_CLTD = {
  // [insulation level]: CLTD (°F)
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

// ── Glass Conduction CLTD (°F) ──────────────────────────────────────────────
// Source: ASHRAE Handbook — Fundamentals, Table 7, Ch 18
// For glass: use a single conservative CLTD regardless of orientation.
// Recommended: 15°F for interior-shaded glass (most conservative for cooling)
export const GLASS_CLTD = {
  summer:  15,
  monsoon: 12,
  winter:  -5, // negative in winter → heat loss through glass
};

// ── Solar Heat Gain Factor — SHGF (BTU/hr·ft²) ──────────────────────────────
// Source: ASHRAE Table 15, Chapter 27
// Maximum SHGF for 32°N latitude (suitable for India, Middle East, subtropics)
// For other latitudes apply LATITUDE_CORRECTION_FACTOR below.
export const SHGF = {
  // [orientation]: { summer, monsoon, winter }
  N:          { summer: 20,  monsoon: 18,  winter: 10  },
  NE:         { summer: 73,  monsoon: 65,  winter: 30  },
  E:          { summer: 152, monsoon: 130, winter: 62  },
  SE:         { summer: 124, monsoon: 106, winter: 77  },
  S:          { summer: 48,  monsoon: 42,  winter: 113 }, // higher in winter (sun is lower)
  SW:         { summer: 124, monsoon: 106, winter: 77  },
  W:          { summer: 152, monsoon: 130, winter: 62  },
  NW:         { summer: 73,  monsoon: 65,  winter: 30  },
  Horizontal: { summer: 248, monsoon: 210, winter: 148 },
};

// ── Cooling Load Factor — CLF (dimensionless) ────────────────────────────────
// Source: ASHRAE Table 13, Chapter 28
// CLF accounts for thermal storage effect — fraction of solar gain
// that becomes cooling load at peak hour (3 PM).
// Varies by room mass and presence of internal shading.
//
// Conservative values (no internal shading) used for safety:
export const CLF = {
  // [orientation]: { light room, medium room, heavy room }
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

// ── Shading Coefficient — SC (dimensionless) ────────────────────────────────
// Source: ASHRAE Table 11, Chapter 27
// SC = Solar Heat Gain of glazing / Solar Heat Gain of reference clear single glass
// Lower SC = better solar control
export const SC_OPTIONS = [
  { label: 'Single Clear Glass',               value: 1.00 },
  { label: 'Single Tinted (Bronze/Grey)',       value: 0.70 },
  { label: 'Double Clear Glass',                value: 0.88 },
  { label: 'Double Tinted',                     value: 0.60 },
  { label: 'Double Clear + Internal Blind',     value: 0.56 },
  { label: 'Double Clear + External Shade',     value: 0.25 },
  { label: 'Low-E Coating (Clear)',             value: 0.44 },
  { label: 'Low-E Coating (Tinted)',            value: 0.30 },
  { label: 'Reflective Glass',                  value: 0.25 },
  { label: 'Triple Clear Glass',                value: 0.74 },
];

// ── U-Value Presets (BTU/hr·ft²·°F) ─────────────────────────────────────────
// Source: ASHRAE Table 4 & 22, Chapter 27
// These are "overall" U-values including air films.
export const U_VALUE_PRESETS = {
  walls: [
    { label: '8" Concrete Block (uninsulated)',    value: 0.48 },
    { label: '8" Concrete Block + 1" insulation',  value: 0.22 },
    { label: '8" Concrete Block + 2" insulation',  value: 0.14 },
    { label: 'Brick Veneer + Stud + Insulation',   value: 0.08 },
    { label: 'Metal Sandwich Panel (insulated)',    value: 0.10 },
    { label: 'Precast Concrete Panel',              value: 0.35 },
    { label: 'Custom',                              value: null },
  ],
  roofs: [
    { label: 'Built-up Roof (no insulation)',       value: 0.79 },
    { label: 'Built-up + 1" rigid insulation',      value: 0.24 },
    { label: 'Built-up + 2" rigid insulation',      value: 0.15 },
    { label: 'Built-up + 3" rigid insulation',      value: 0.11 },
    { label: 'Metal Deck + 2" insulation',          value: 0.13 },
    { label: 'Concrete Slab (6")',                  value: 0.36 },
    { label: 'Custom',                              value: null },
  ],
  glass: [
    { label: 'Single Clear (1/4")',                value: 1.04 },
    { label: 'Single Tinted (1/4")',               value: 1.04 },
    { label: 'Double Clear (1/2" air)',            value: 0.55 },
    { label: 'Double Clear (1/2" argon)',          value: 0.48 },
    { label: 'Double Low-E (1/2" air)',            value: 0.38 },
    { label: 'Double Low-E (1/2" argon)',          value: 0.30 },
    { label: 'Triple Clear',                       value: 0.28 },
    { label: 'Custom',                             value: null },
  ],
  partitions: [
    { label: 'Gypsum Board + Stud (uninsulated)',   value: 0.35 },
    { label: 'Gypsum Board + Stud + Insulation',   value: 0.09 },
    { label: 'Concrete Block (4")',                 value: 0.70 },
    { label: 'Concrete Block (8")',                 value: 0.53 },
    { label: 'Custom',                             value: null },
  ],
  floors: [
    { label: 'Concrete Slab on Grade',              value: 0.10 },
    { label: 'Concrete + Carpet',                   value: 0.08 },
    { label: 'Raised Floor (plenum below)',         value: 0.25 },
    { label: 'Custom',                             value: null },
  ],
};

// ── Orientation Options ──────────────────────────────────────────────────────
export const ORIENTATIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// ── Wall Construction Options ────────────────────────────────────────────────
export const WALL_CONSTRUCTIONS = ['light', 'medium', 'heavy'];

// ── Roof Construction Options ────────────────────────────────────────────────
export const ROOF_CONSTRUCTIONS = Object.keys(ROOF_CLTD);

// ── Room Mass Options (for CLF selection) ───────────────────────────────────
export const ROOM_MASS_OPTIONS = ['light', 'medium', 'heavy'];

// ── CLTD Correction Formula ──────────────────────────────────────────────────
// ASHRAE recommends correcting tabulated CLTD for actual design conditions:
// CLTD_corrected = CLTD_table + (78 - t_room) + (t_outdoor_mean - 85)
// where:
//   t_room         = actual indoor design temp (°F)
//   t_outdoor_mean = mean outdoor temp for design day (°F) = (DB_max + DB_min) / 2
//
// This is exported as a pure function for use in envelopeCalc.js
export const correctCLTD = (cltdTable, tRoom, tOutdoorMean) => {
  return cltdTable + (78 - tRoom) + (tOutdoorMean - 85);
};

// ── Default element templates (what gets pushed to Redux on "Add") ───────────
export const DEFAULT_ELEMENTS = {
  walls: {
    label: 'Exposed Wall',
    orientation: 'N',
    construction: 'medium',
    area: 0,
    uValue: 0.35,
    uPreset: '8" Concrete Block (uninsulated)',
  },
  roofs: {
    label: 'Roof Exposed',
    construction: '2" insulation',
    area: 0,
    uValue: 0.15,
    uPreset: 'Built-up + 2" rigid insulation',
  },
  glass: {
    label: 'Exposed Glass',
    orientation: 'E',
    area: 0,
    uValue: 0.55,
    uPreset: 'Double Clear (1/2" air)',
    sc: 0.88,
    scPreset: 'Double Clear Glass',
    roomMass: 'medium',
  },
  skylights: {
    label: 'Skylight',
    area: 0,
    uValue: 0.55,
    uPreset: 'Double Clear (1/2" air)',
    sc: 0.88,
    scPreset: 'Double Clear Glass',
    roomMass: 'medium',
  },
  partitions: {
    label: 'Partition Wall',
    area: 0,
    uValue: 0.35,
    uPreset: 'Gypsum Board + Stud (uninsulated)',
    tAdj: 85, // adjacent unconditioned space temp (°F)
  },
  floors: {
    label: 'Floor',
    area: 0,
    uValue: 0.10,
    uPreset: 'Concrete Slab on Grade',
    tAdj: 75, // below-grade or adjacent space temp (°F)
  },
};