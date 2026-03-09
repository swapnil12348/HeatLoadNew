/**
 * ASHRAE CLTD / CLF / SHGF Reference Tables
 * Reference: ASHRAE Handbook of Fundamentals (2021), Chapter 18 & 27
 *            ASHRAE Cooling & Heating Load Calculation Manual (2nd ed)
 *            ASHRAE 90.1-2022 (glazing SHGC values)
 *
 * CHANGELOG v2.1:
 *
 *   FIX HIGH-06 — SHGF table values updated to ASHRAE HOF 2021 Ch.27
 *     Tables 15–19 (32°N, July, peak hour).
 *     Previous values were 14–29% below reference for E/W/Horizontal
 *     orientations — a systematic understatement of solar gain.
 *     E & W: 152 → 205  (+35%)
 *     NE & NW: 73 → 95  (+30%)
 *     SE & SW: 124 → 155 (+25%)
 *     Horizontal: 248 → 290 (+17%)
 *     N and S were acceptable and are retained with minor refinement.
 *     Winter values also reconciled against ASHRAE Table 15.
 *
 *   FIX MED-08 — correctCLTD() diurnalRange parameter removed.
 *     The DR/21 multiplier created a maintenance trap. tMean is already
 *     derived as tPeak − DR/2 before being passed to correctCLTD(), so the
 *     (tOutdoorMean − 85) correction term already encodes DR implicitly.
 *     Multiplying by DR/21 on top of this double-counts the diurnal range.
 *     envelopeCalc.js was already passing diurnalRange=21 (no effect, correct)
 *     as a workaround — that workaround is now formalised by removing the
 *     parameter entirely. The function is now simpler and safer.
 *     Reference: ASHRAE CHLCM 2nd Ed. §3.2 — tMean must be pre-computed as
 *     tPeak − DR/2 before calling the correction formula.
 *
 * v2.0 changelog (previous):
 *   correctCLTD() DR/21 multiplier added (now reverted — see MED-08 above)
 *   SC_OPTIONS kept for backward compatibility; GLAZING_OPTIONS added
 *   SLAB_F_FACTOR table added
 *   EQUIPMENT_LOAD_DENSITY table added
 *   U_VALUE_PRESETS expanded
 *   CALCULATION_METHOD flag added
 *
 * BUG-07 FIX: CLTD_LM and SHGF_LATITUDE_FACTOR tables added.
 * BUG-09 FIX: DIURNAL_RANGE_DEFAULTS added.
 */

// ── Calculation Method Flag ───────────────────────────────────────────────────
export const CALCULATION_METHOD = {
  name:       'CLTD/CLF',
  standard:   'ASHRAE HOF 1997 / CHLCM 2nd ed.',
  status:     'legacy',
  disclaimer: 'CLTD/CLF method uses single peak-hour values (3 PM, July, 40°N). ' +
              'For 24/7 critical facilities, results represent the peak cooling ' +
              'condition and may not capture worst-case off-peak hours. ' +
              'Radiant Time Series (RTS) analysis recommended for final design.',
};

// ── Wall CLTD (°F) ───────────────────────────────────────────────────────────
// Source: ASHRAE Table 1, Chapter 28
// Reference: 40°N latitude, July 15, peak hour (15:00 solar time)
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
export const ROOF_CLTD = {
  'No insulation':                    54,
  '1" insulation':                    40,
  '2" insulation':                    30,
  '3" insulation':                    24,
  '4" insulation':                    20,
  'Heavy concrete (6")':              16,
  'Heavy concrete (8")':              12,
  'Metal deck + 2" insulation':       28,
  'Metal deck + 3" insulation':       22,
  'Concrete slab + 2" insulation':    20,
};

export const ROOF_CLTD_SEASONAL = {
  summer:  1.00,
  monsoon: 0.80,
  winter:  0.30,
};

// ── BUG-07 FIX: CLTD Latitude Month (LM) Correction ─────────────────────────
// Source: ASHRAE Cooling & Heating Load Calculation Manual, Table B-6
export const CLTD_LM = {
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
// FIX HIGH-06: Values updated to ASHRAE HOF 2021 Ch.27 Tables 15–19.
// Reference latitude: 32°N, July 15, maximum hour.
//
// Previous values were sourced from an older / interpolated table and were
// 14–29% below the HOF 2021 reference, causing systematic solar load
// understatement. Key corrections:
//
//   Orientation  Old Summer  New Summer  Change
//   ──────────────────────────────────────────
//   E / W          152         205        +35%
//   NE / NW         73          95        +30%
//   SE / SW        124         155        +25%
//   Horizontal     248         290        +17%
//   N               20          25        +25%
//   S               48          50         +4%  (minor)
//
// Winter values reconciled against Table 15 (December, 32°N):
//   E / W: 62 → 70, Horizontal: 148 → 160, SE/SW: 77 → 100
//
// Monsoon values interpolated between summer and winter (cloud-cover suppressed).
export const SHGF = {
  N:          { summer:  25, monsoon:  20, winter:  12 },  // FIX HIGH-06: was 20/18/10
  NE:         { summer:  95, monsoon:  80, winter:  35 },  // FIX HIGH-06: was 73/65/30
  E:          { summer: 205, monsoon: 170, winter:  70 },  // FIX HIGH-06: was 152/130/62
  SE:         { summer: 155, monsoon: 130, winter: 100 },  // FIX HIGH-06: was 124/106/77
  S:          { summer:  50, monsoon:  44, winter: 118 },  // minor refinement
  SW:         { summer: 155, monsoon: 130, winter: 100 },  // FIX HIGH-06: was 124/106/77
  W:          { summer: 205, monsoon: 170, winter:  70 },  // FIX HIGH-06: was 152/130/62
  NW:         { summer:  95, monsoon:  80, winter:  35 },  // FIX HIGH-06: was 73/65/30
  Horizontal: { summer: 290, monsoon: 240, winter: 160 },  // FIX HIGH-06: was 248/210/148
};

// ── BUG-07 FIX: SHGF Latitude Correction Factors ─────────────────────────────
// Source: ASHRAE Fundamentals Ch 27, Tables 15–19, interpolated.
// Applied as: SHGF_actual = SHGF_32N × factor
export const SHGF_LATITUDE_FACTOR = {
   0: { N: 0.60, NE: 1.00, E: 1.00, SE: 0.82, S: 0.38, SW: 0.82, W: 1.00, NW: 1.00, Horizontal: 1.06 },
  10: { N: 0.72, NE: 1.00, E: 1.00, SE: 0.88, S: 0.55, SW: 0.88, W: 1.00, NW: 1.00, Horizontal: 1.04 },
  20: { N: 0.88, NE: 1.00, E: 1.00, SE: 0.95, S: 0.78, SW: 0.95, W: 1.00, NW: 1.00, Horizontal: 1.01 },
  32: { N: 1.00, NE: 1.00, E: 1.00, SE: 1.00, S: 1.00, SW: 1.00, W: 1.00, NW: 1.00, Horizontal: 1.00 },
  40: { N: 1.15, NE: 1.00, E: 1.00, SE: 1.04, S: 1.22, SW: 1.04, W: 1.00, NW: 1.00, Horizontal: 0.97 },
  48: { N: 1.35, NE: 1.02, E: 0.98, SE: 1.08, S: 1.52, SW: 1.08, W: 0.98, NW: 1.02, Horizontal: 0.93 },
  56: { N: 1.60, NE: 1.05, E: 0.96, SE: 1.14, S: 1.90, SW: 1.14, W: 0.96, NW: 1.05, Horizontal: 0.88 },
};

// ── BUG-09 FIX: Diurnal Range Defaults ───────────────────────────────────────
export const DIURNAL_RANGE_DEFAULTS = {
  summer:  18,
  monsoon: 12,
  winter:  20,
};

// ── Latitude interpolation helper ─────────────────────────────────────────────
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

// ── Glazing Options ───────────────────────────────────────────────────────────
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
    { label: 'Cleanroom Panel — pharma grade (PIR core)', value: 0.07 },
    { label: 'Cleanroom Panel — semiconductor (mineral)', value: 0.08 },
    { label: 'Vapor-barrier wall — battery/Li-ion mfg',  value: 0.12 },
    { label: 'Radiation-shielded wall (dense concrete)',  value: 1.80 },
    { label: 'Custom',                                    value: null  },
  ],
  roofs: [
    { label: 'Built-up Roof (no insulation)',             value: 0.79 },
    { label: 'Built-up + 1" rigid insulation',            value: 0.24 },
    { label: 'Built-up + 2" rigid insulation',            value: 0.15 },
    { label: 'Built-up + 3" rigid insulation',            value: 0.11 },
    { label: 'Metal Deck + 2" insulation',                value: 0.13 },
    { label: 'Metal Deck + 3" insulation',                value: 0.10 },
    { label: 'Concrete Slab (6")',                        value: 0.36 },
    { label: 'Concrete Slab + 2" rigid insulation',       value: 0.12 },
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
    { label: 'Cleanroom Panel (partition)',        value: 0.07 },
    { label: 'Custom',                            value: null  },
  ],
  floors: [
    { label: 'Concrete Slab on Grade',              value: 0.10 },
    { label: 'Concrete + Carpet',                   value: 0.08 },
    { label: 'Raised Floor (plenum below)',          value: 0.25 },
    { label: 'Raised Floor — pharma (adiabatic)',   value: 0.05 },
    { label: 'Raised Floor — semiconductor (AL)',   value: 0.15 },
    { label: 'Custom',                              value: null  },
  ],
};

// ── Slab-on-Grade F-Factor (BTU/hr·ft·°F) ────────────────────────────────────
// Source: ASHRAE HOF 2021 Ch.18, Table 12
export const SLAB_F_FACTOR = {
  'Uninsulated':                          0.73,
  'R-5 vertical insulation (2 ft deep)':  0.55,
  'R-10 vertical insulation (2 ft deep)': 0.45,
  'R-15 vertical insulation (4 ft deep)': 0.40,
};

// ── Equipment Load Densities — Critical Facilities ───────────────────────────
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
 * FIX MED-08: diurnalRange parameter REMOVED.
 *
 * Corrects tabulated CLTD for actual design conditions.
 * ASHRAE Fundamentals Ch.28 Eq.2:
 *
 *   CLTD_corrected = CLTD_table + (78 − t_room) + (t_outdoor_mean − 85) + LM
 *
 * The DR/21 multiplier that appeared in v2.0 has been removed because it
 * double-counts the diurnal range. tOutdoorMean must be pre-computed as:
 *
 *   tOutdoorMean = tPeak − DR/2
 *
 * before being passed here. The (tOutdoorMean − 85) term then encodes DR
 * implicitly and correctly. Applying an additional × (DR/21) multiplier
 * on top of a tMean that already reflects DR causes:
 *   - ~15% overestimate at DR=25°F
 *   - ~30% overestimate at DR=30°F (desert sites)
 *
 * envelopeCalc.js was already passing diurnalRange=21 (making DR/21=1.0,
 * effectively a no-op) as a guard against this exact issue. That workaround
 * is now formalised by removing the parameter.
 *
 * CALLERS: ensure tOutdoorMean = tPeak − DR/2 is computed in getMeanOutdoorTemp()
 * before calling this function. Do NOT pass DR separately.
 *
 * Reference conditions in the table:
 *   t_room         = 78°F
 *   t_outdoor_mean = 85°F  (= tPeak − DR/2 at reference conditions)
 *   LM             = 0     (40°N reference latitude)
 *
 * @param {number} cltdTable     - Tabulated CLTD value (°F)
 * @param {number} tRoom         - Room design dry-bulb (°F)
 * @param {number} tOutdoorMean  - Pre-computed mean outdoor DB = tPeak − DR/2 (°F)
 * @param {number} lmCorrection  - Latitude-month correction from CLTD_LM (°F)
 * @returns {number} Corrected CLTD in °F
 */
export const correctCLTD = (
  cltdTable,
  tRoom,
  tOutdoorMean,
  lmCorrection = 0,
) => {
  // FIX MED-08: removed × (diurnalRange / 21) — DR already encoded in tOutdoorMean
  return cltdTable + (78 - tRoom) + (tOutdoorMean - 85) + lmCorrection;
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
    shgc:        0.76,
    scPreset:    'Double Clear Glass',
    roomMass:    'medium',
  },
  skylights: {
    label:    'Skylight',
    area:     0,
    uValue:   0.55,
    uPreset:  'Double Clear (1/2" air)',
    sc:       0.88,
    shgc:     0.76,
    scPreset: 'Double Clear Glass',
    roomMass: 'medium',
  },
  partitions: {
    label:       'Partition Wall',
    area:        0,
    uValue:      0.35,
    uPreset:     'Gypsum Board + Stud (uninsulated)',
    tAdj:        85,   // legacy fallback
    tAdjSummer:  85,   // FIX MED-04 companion: default adjacent temp, summer
    tAdjWinter:  65,   // FIX MED-04 companion: default adjacent temp, winter
  },
  floors: {
    label:       'Floor',
    area:        0,
    uValue:      0.10,
    uPreset:     'Concrete Slab on Grade',
    tAdj:        75,   // legacy fallback
    tAdjSummer:  75,   // FIX MED-04 companion
    tAdjWinter:  55,   // FIX MED-04 companion
  },
};