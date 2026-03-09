/**
 * ASHRAE CLTD / CLF / SHGF Reference Tables
 * Reference: ASHRAE Handbook of Fundamentals (2021), Chapters 18 & 27
 *            ASHRAE Cooling & Heating Load Calculation Manual (2nd ed)
 *            ASHRAE 90.1-2022 (glazing SHGC values)
 *
 * CHANGELOG v2.2:
 *
 *   FIX HIGH-07 — EQUIPMENT_LOAD_DENSITY diversity factor conflict documented.
 *     ashrae.js carries PROCESS_DIVERSITY_FACTOR: 0.75 as a global fallback.
 *     EQUIPMENT_LOAD_DENSITY now carries per-type diversity factors as the
 *     authoritative values. seasonalLoads.js MUST apply ONLY the per-type
 *     diversityFactor from this table — never compound it with the global
 *     PROCESS_DIVERSITY_FACTOR. The global scalar is a fallback for room types
 *     not listed here. Applying both causes a double-diversity understatement
 *     of 35–55% on equipment loads.
 *
 *   FIX MED-09 — CLF table documented as internally-shaded glass only.
 *     Added CLF_UNSHADED (= 1.0 at peak hour) and CLF_INTERNAL for people,
 *     lights, and equipment. Callers must select the correct table based on
 *     room shading configuration.
 *
 *   FIX MED-10 — correctCLTD negative output documented as physically valid.
 *     Negative CLTD means heat flows into the space — a heating contribution.
 *     Callers must NOT clamp to zero. Clamping silently drops the heating load
 *     for that element and corrupts the winter heating calculation.
 *
 *   FIX LOW-06 — interpolateLatitude warns on missing key instead of silent 0.
 *
 * CHANGELOG v2.1:
 *
 *   FIX HIGH-06 — SHGF table values updated to ASHRAE HOF 2021 Ch.27
 *     Tables 15–19 (32°N, July, peak hour).
 *     Previous values were 14–29% below reference for E/W/Horizontal.
 *     E & W: 152 → 205  (+35%)
 *     NE & NW: 73 → 95  (+30%)
 *     SE & SW: 124 → 155 (+25%)
 *     Horizontal: 248 → 290 (+17%)
 *     Winter values reconciled against ASHRAE Table 15.
 *
 *   FIX MED-08 — correctCLTD() diurnalRange parameter removed.
 *     DR/21 multiplier double-counted diurnal range. tMean must be
 *     pre-computed as tPeak − DR/2 before calling correctCLTD().
 *     Reference: ASHRAE CHLCM 2nd Ed. §3.2.
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
// Source: ASHRAE Handbook of Fundamentals 2021, Ch.18, Table 1
// Reference: 40°N latitude, July 15, peak hour (15:00 solar time)
// tRoom = 78°F, tOutdoorMean = 85°F
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
// Source: ASHRAE HOF 2021, Ch.18, Table 4
// Reference: 40°N latitude, July 15, peak hour (15:00 solar time)
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
// Units: °F. Add to CLTD_table before applying the room/outdoor correction.
export const CLTD_LM = {
   0: { N:  1, NE: -2, E: -5, SE: -3, S: -7, SW: -3, W: -5, NW: -2 },
  10: { N:  0, NE: -1, E: -3, SE: -2, S: -5, SW: -2, W: -3, NW: -1 },
  20: { N: -1, NE:  0, E: -2, SE: -1, S: -3, SW: -1, W: -2, NW:  0 },
  24: { N: -1, NE:  0, E: -1, SE: -1, S: -2, SW: -1, W: -1, NW:  0 },
  32: { N:  0, NE:  0, E: -1, SE:  0, S: -1, SW:  0, W: -1, NW:  0 },
  36: { N:  0, NE:  0, E:  0, SE:  0, S: -1, SW:  0, W:  0, NW:  0 },
  40: { N:  0, NE:  0, E:  0, SE:  0, S:  0, SW:  0, W:  0, NW:  0 }, // reference
  48: { N:  1, NE:  1, E:  2, SE:  1, S:  3, SW:  1, W:  2, NW:  1 },
  56: { N:  2, NE:  2, E:  3, SE:  2, S:  5, SW:  2, W:  3, NW:  2 },
};

// ── Glass Conduction CLTD (°F) ───────────────────────────────────────────────
// Source: ASHRAE HOF 2021, Ch.18, Table 7
export const GLASS_CLTD = {
  summer:  15,
  monsoon: 12,
  winter:  -5,   // Negative is correct — heat flows outward in winter
};

// ── Solar Heat Gain Factor — SHGF (BTU/hr·ft²) ───────────────────────────────
// FIX HIGH-06: Values updated to ASHRAE HOF 2021 Ch.27 Tables 15–19.
// Reference latitude: 32°N, July 15, maximum hour.
//
//   Orientation  Old Summer  New Summer  Change
//   ──────────────────────────────────────────
//   E / W          152         205        +35%
//   NE / NW         73          95        +30%
//   SE / SW        124         155        +25%
//   Horizontal     248         290        +17%
//   N               20          25        +25%
//   S               48          50         +4%
//
// Winter values reconciled against Table 15 (December, 32°N).
// Monsoon values interpolated (cloud-cover suppressed).
export const SHGF = {
  N:          { summer:  25, monsoon:  20, winter:  12 },  // FIX HIGH-06
  NE:         { summer:  95, monsoon:  80, winter:  35 },  // FIX HIGH-06
  E:          { summer: 205, monsoon: 170, winter:  70 },  // FIX HIGH-06
  SE:         { summer: 155, monsoon: 130, winter: 100 },  // FIX HIGH-06
  S:          { summer:  50, monsoon:  44, winter: 118 },
  SW:         { summer: 155, monsoon: 130, winter: 100 },  // FIX HIGH-06
  W:          { summer: 205, monsoon: 170, winter:  70 },  // FIX HIGH-06
  NW:         { summer:  95, monsoon:  80, winter:  35 },  // FIX HIGH-06
  Horizontal: { summer: 290, monsoon: 240, winter: 160 },  // FIX HIGH-06
};

// ── BUG-07 FIX: SHGF Latitude Correction Factors ─────────────────────────────
// Source: ASHRAE HOF 2021, Ch.27, Tables 15–19, interpolated.
// Applied as: SHGF_actual = SHGF_32N × factor
// interpolateLatitude() handles latitudes between table entries.
export const SHGF_LATITUDE_FACTOR = {
   0: { N: 0.60, NE: 1.00, E: 1.00, SE: 0.82, S: 0.38, SW: 0.82, W: 1.00, NW: 1.00, Horizontal: 1.06 },
  10: { N: 0.72, NE: 1.00, E: 1.00, SE: 0.88, S: 0.55, SW: 0.88, W: 1.00, NW: 1.00, Horizontal: 1.04 },
  20: { N: 0.88, NE: 1.00, E: 1.00, SE: 0.95, S: 0.78, SW: 0.95, W: 1.00, NW: 1.00, Horizontal: 1.01 },
  32: { N: 1.00, NE: 1.00, E: 1.00, SE: 1.00, S: 1.00, SW: 1.00, W: 1.00, NW: 1.00, Horizontal: 1.00 }, // reference
  40: { N: 1.15, NE: 1.00, E: 1.00, SE: 1.04, S: 1.22, SW: 1.04, W: 1.00, NW: 1.00, Horizontal: 0.97 },
  48: { N: 1.35, NE: 1.02, E: 0.98, SE: 1.08, S: 1.52, SW: 1.08, W: 0.98, NW: 1.02, Horizontal: 0.93 },
  56: { N: 1.60, NE: 1.05, E: 0.96, SE: 1.14, S: 1.90, SW: 1.14, W: 0.96, NW: 1.05, Horizontal: 0.88 },
};

// ── BUG-09 FIX: Diurnal Range Defaults ───────────────────────────────────────
// These are defaults only. Actual DR should come from climate data.
// Used in getMeanOutdoorTemp(): tMean = tPeak − DR/2
export const DIURNAL_RANGE_DEFAULTS = {
  summer:  18,
  monsoon: 12,
  winter:  20,
};

// ── Latitude interpolation helper ─────────────────────────────────────────────
/**
 * interpolateLatitude(table, lat, key)
 *
 * Linearly interpolates a value from a latitude-keyed table.
 * FIX LOW-06: warns on missing key instead of silently returning 0.
 *
 * @param {Object} table - latitude-keyed table (e.g. SHGF_LATITUDE_FACTOR)
 * @param {number} lat   - site latitude (degrees, positive = N)
 * @param {string} key   - orientation or property key (e.g. 'E', 'Horizontal')
 * @returns {number} interpolated value
 */
export const interpolateLatitude = (table, lat, key) => {
  const latitudes = Object.keys(table).map(Number).sort((a, b) => a - b);

  if (lat <= latitudes[0]) {
    const val = table[latitudes[0]][key];
    if (val === undefined) {
      console.warn(`interpolateLatitude: key "${key}" not found in table at lat ${latitudes[0]}`);
      return 0;
    }
    return val;
  }
  if (lat >= latitudes[latitudes.length - 1]) {
    const val = table[latitudes[latitudes.length - 1]][key];
    if (val === undefined) {
      console.warn(`interpolateLatitude: key "${key}" not found in table at lat ${latitudes[latitudes.length - 1]}`);
      return 0;
    }
    return val;
  }

  let lower = latitudes[0];
  let upper = latitudes[latitudes.length - 1];
  for (let i = 0; i < latitudes.length - 1; i++) {
    if (lat >= latitudes[i] && lat <= latitudes[i + 1]) {
      lower = latitudes[i];
      upper = latitudes[i + 1];
      break;
    }
  }

  const lv = table[lower][key];
  const uv = table[upper][key];

  if (lv === undefined || uv === undefined) {
    console.warn(`interpolateLatitude: key "${key}" not found between lat ${lower}–${upper}. Returning 0.`);
    return 0;
  }

  const t = (lat - lower) / (upper - lower);
  return lv + t * (uv - lv);
};

// ── Cooling Load Factor — CLF (dimensionless) ─────────────────────────────────
// FIX MED-09: This table is for glass WITH INTERIOR SHADING (blinds/drapes).
// Source: ASHRAE CHLCM 2nd Ed., Table 13, Ch.28
// Reference: 40°N latitude, July 15, peak hour (15:00 solar time)
//
// ⚠️  DO NOT use this table for unshaded glass — use CLF_UNSHADED instead.
//     For unshaded glass at peak hour, CLF ≈ 1.0 for all orientations.
//     Using the shaded CLF for unshaded glass understates solar load by
//     15–35% for E/W orientations and up to 50% for NE/NW.
//
// Room mass categories: light = minimal thermal mass, heavy = concrete/masonry.
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

// FIX MED-09: CLF for unshaded glass (no interior blind/drape).
// At peak hour (15:00 solar), CLF = 1.0 for all orientations.
// Source: ASHRAE CHLCM 2nd Ed., Table 14, Ch.28 — peak-hour single value.
export const CLF_UNSHADED = 1.0;

// FIX MED-09: CLF for internal gains (people, lights, equipment).
// These account for radiant heat storage in the room mass.
// Source: ASHRAE CHLCM 2nd Ed., Table 15, Ch.28
// Usage: Q_cooling = Q_internal × CLF_INTERNAL[roomMass]
// Note: for 24/7 critical facilities operating continuously,
// CLF_INTERNAL approaches 1.0 — use 'heavy' as a lower bound only.
export const CLF_INTERNAL = {
  light:  0.97,  // Minimal thermal mass — nearly all heat enters cooling load immediately
  medium: 0.90,
  heavy:  0.75,  // Significant thermal mass — some heat stored, cooling load deferred
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
// Source: ASHRAE HOF 2021, Ch.27 / ASHRAE 90.1-2022 Appendix A
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
// Source: ASHRAE HOF 2021, Ch.18, Table 12
export const SLAB_F_FACTOR = {
  'Uninsulated':                          0.73,
  'R-5 vertical insulation (2 ft deep)':  0.55,
  'R-10 vertical insulation (2 ft deep)': 0.45,
  'R-15 vertical insulation (4 ft deep)': 0.40,
};

// ── Equipment Load Densities — Critical Facilities ───────────────────────────
// FIX HIGH-07: diversityFactor here is the AUTHORITATIVE per-type value.
//
// ⚠️  seasonalLoads.js must apply ONLY this diversityFactor — NOT the global
//     PROCESS_DIVERSITY_FACTOR from ashrae.js. The global scalar is a fallback
//     for room types not listed in this table. Applying both causes double-
//     diversity understatement of 35–55% on equipment loads.
//
// Source: industry benchmarks / SEMI S2-0200, ISPE Baseline Guide Vol.5
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
 * correctCLTD(cltdTable, tRoom, tOutdoorMean, lmCorrection?)
 *
 * Corrects tabulated CLTD for actual design conditions.
 * ASHRAE HOF 2021, Ch.18 Eq.2 / CHLCM 2nd Ed. §3.2:
 *
 *   CLTD_corrected = CLTD_table + (78 − t_room) + (t_outdoor_mean − 85) + LM
 *
 * FIX MED-08: DR/21 multiplier removed (v2.1). tOutdoorMean must be
 * pre-computed as tPeak − DR/2 before calling this function.
 *
 * FIX MED-10: Negative return values are physically valid.
 * A negative CLTD means the temperature gradient is reversed — heat flows
 * from the conditioned space outward through that element. This is a
 * heating contribution, not an error.
 *
 * ⚠️  Callers MUST NOT clamp the return value to zero.
 *     In winter load calculations, negative CLTD is the correct signal
 *     that the element is a heat loss, not a heat gain. Clamping to zero
 *     silently drops that element from the heating calculation.
 *
 * Reference conditions encoded in the table:
 *   t_room         = 78°F
 *   t_outdoor_mean = 85°F  (= tPeak − DR/2, reference diurnal range = 21°F)
 *   LM             = 0     (40°N reference latitude)
 *
 * @param {number} cltdTable     - Tabulated CLTD value (°F)
 * @param {number} tRoom         - Room design dry-bulb (°F)
 * @param {number} tOutdoorMean  - Pre-computed mean outdoor DB = tPeak − DR/2 (°F)
 * @param {number} lmCorrection  - Latitude-month correction from CLTD_LM (°F), default 0
 * @returns {number} Corrected CLTD (°F) — may be negative; do NOT clamp.
 */
export const correctCLTD = (
  cltdTable,
  tRoom,
  tOutdoorMean,
  lmCorrection = 0,
) => {
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
    shaded:      false,  // FIX MED-09: drives CLF vs CLF_UNSHADED selection in envelopeCalc.js
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
    shaded:   false,   // FIX MED-09: drives CLF vs CLF_UNSHADED selection
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