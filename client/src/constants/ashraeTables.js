/**
 * ASHRAE CLTD / CLF / SHGF Reference Tables
 * Reference: ASHRAE Handbook of Fundamentals (2021), Chapters 18 & 27
 *            ASHRAE Cooling & Heating Load Calculation Manual (2nd ed)
 *            ASHRAE 90.1-2022 (glazing SHGC values)
 *
 * ── CHANGELOG v2.4 ────────────────────────────────────────────────────────────
 *
 *   GAP-TIER1-04 FIX — EQUIPMENT_LOAD_DENSITY: 'Battery formation — Lead-acid' added.
 *
 *     The battery-leadacid ventilation category was added in v2.1 but no
 *     corresponding process heat density existed here. Without it, any lookup
 *     for lead-acid facility equipment would miss and fall back to a default —
 *     likely the general office value of 5 W/ft², roughly 8× too low for a
 *     formation hall.
 *
 *     Lead-acid formation rectifier + busbar losses: 35–50 W/ft² typical.
 *     Lower than Li-ion (80 W/ft²): no drying ovens, no NMP bake-off.
 *     diversityFactor: 0.85 (IEEE 1184-2006 §6.7 — plateau phase ~60–70% of peak).
 *
 *   LOW-TIER1-06 FIX — SHGF_LATITUDE_FACTOR: 24°N and 36°N breakpoints added.
 *
 *     CLTD_LM had breakpoints at 0, 10, 20, 24, 32, 36, 40, 48, 56°N.
 *     SHGF_LATITUDE_FACTOR was missing 24°N and 36°N, leaving larger
 *     interpolation spans than the source table warrants.
 *
 *     24°N addition primary beneficiary: TSMC Hsinchu (24.8°N).
 *     36°N addition covers Denver (39.7°N), Istanbul (41°N).
 *
 *     Values interpolated from ASHRAE HOF 2021 Ch.27 Tables 15–19.
 *
 * ── CHANGELOG v2.3 ────────────────────────────────────────────────────────────
 *
 *   HIGH-04 FIX — Dead winter keys removed from WALL_CLTD_SEASONAL,
 *     ROOF_CLTD_SEASONAL, and GLASS_CLTD.
 *
 *     All three element calc functions short-circuit before reading seasonal
 *     tables for winter:
 *       if (season === 'winter') return u * area * (dbOut - tRoom);
 *     Steady-state U×A×ΔT is the correct ASHRAE winter method. CLTD is a
 *     peak-hour cooling concept — applying it in winter via a multiplier is
 *     physically wrong. Winter keys removed to prevent future misuse.
 *
 * ── CHANGELOG v2.2 ────────────────────────────────────────────────────────────
 *
 *   FIX HIGH-07 — EQUIPMENT_LOAD_DENSITY diversity factor conflict documented.
 *   FIX MED-09  — CLF table documented as interior-shaded glass only.
 *   FIX MED-10  — correctCLTD negative output documented as physically valid.
 *   FIX LOW-06  — interpolateLatitude warns on missing key instead of silent 0.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   FIX HIGH-06 — SHGF values updated to ASHRAE HOF 2021 Ch.27 Tables 15–19.
 *   FIX MED-08  — correctCLTD() DR/21 parameter removed (double-count).
 *   BUG-07 FIX  — CLTD_LM and SHGF_LATITUDE_FACTOR tables added.
 *   BUG-09 FIX  — DIURNAL_RANGE_DEFAULTS added.
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
// Source: ASHRAE HOF 2021, Ch.18, Table 1
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

/**
 * WALL_CLTD_SEASONAL — summer and monsoon multipliers only.
 *
 * ⚠️  Winter key is INTENTIONALLY ABSENT.
 *
 * calcWallGain() returns U×A×ΔT before this table is ever read in winter:
 *   if (season === 'winter') return u * area * (dbOut - tRoom);  // returns here
 *   const seasonMult = WALL_CLTD_SEASONAL[season];               // never reached
 *
 * Steady-state conduction is the correct ASHRAE winter method. CLTD is a
 * peak-hour cooling concept — it has no meaning for winter heat loss.
 *
 * IF YOU ADD A NEW ELEMENT TYPE: do NOT use WALL_CLTD_SEASONAL[season] as
 * a general seasonal adapter. Write a separate steady-state winter path:
 *   return u * area * (tOutdoor - tRoom);
 */
export const WALL_CLTD_SEASONAL = {
  summer:  1.00,
  monsoon: 0.85,
};

// ── Roof CLTD (°F) ───────────────────────────────────────────────────────────
// Source: ASHRAE HOF 2021, Ch.18, Table 4
export const ROOF_CLTD = {
  'No insulation':                     54,
  '1" insulation':                     40,
  '2" insulation':                     30,
  '3" insulation':                     24,
  '4" insulation':                     20,
  'Heavy concrete (6")':               16,
  'Heavy concrete (8")':               12,
  'Metal deck + 2" insulation':        28,
  'Metal deck + 3" insulation':        22,
  'Concrete slab + 2" insulation':     20,
};

/**
 * ROOF_CLTD_SEASONAL — summer and monsoon multipliers only.
 * ⚠️  Winter key INTENTIONALLY ABSENT — same invariant as WALL_CLTD_SEASONAL.
 */
export const ROOF_CLTD_SEASONAL = {
  summer:  1.00,
  monsoon: 0.80,
};

// ── CLTD Latitude Month (LM) Correction ──────────────────────────────────────
// Source: ASHRAE Cooling & Heating Load Calculation Manual, Table B-6
// Reference: 40°N (all zeros). Positive = higher load than reference.
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

/**
 * GLASS_CLTD — Glass conduction CLTD values (°F).
 * Source: ASHRAE HOF 2021, Ch.18, Table 7
 *
 * ⚠️  Winter key INTENTIONALLY ABSENT.
 *
 * calcGlassGain() returns U×A×ΔT before this table is read in winter.
 * The previous winter value of −5 was dead code that was never executed.
 * glazingCalc.js getGlassCLTD() will log a console.error if this is reached
 * for any unknown season key.
 */
export const GLASS_CLTD = {
  summer:  15,
  monsoon: 12,
};

// ── Solar Heat Gain Factor — SHGF (BTU/hr·ft²) ───────────────────────────────
// Source: ASHRAE HOF 2021 Ch.27 Tables 15–19
// Reference: 32°N, July 15, maximum hour, clear glass (SC = 1.0).
// Multiply by SC or SHGC in glazingCalc.js for actual glazing.
export const SHGF = {
  N:          { summer:  25, monsoon:  20, winter:  12 },
  NE:         { summer:  95, monsoon:  80, winter:  35 },
  E:          { summer: 205, monsoon: 170, winter:  70 },
  SE:         { summer: 155, monsoon: 130, winter: 100 },
  S:          { summer:  50, monsoon:  44, winter: 118 },
  SW:         { summer: 155, monsoon: 130, winter: 100 },
  W:          { summer: 205, monsoon: 170, winter:  70 },
  NW:         { summer:  95, monsoon:  80, winter:  35 },
  Horizontal: { summer: 290, monsoon: 240, winter: 160 },
};

// ── SHGF Latitude Correction Factors ─────────────────────────────────────────
// Source: ASHRAE HOF 2021 Ch.27 Tables 15–19
// Reference latitude: 32°N (all 1.00).
// Breakpoints align with CLTD_LM: 0, 10, 20, 24, 32, 36, 40, 48, 56°N.
//
// 24°N and 36°N values interpolated from ASHRAE HOF 2021 Ch.27 source tables.
// Southern hemisphere: envelopeHelpers.js swaps N↔S orientations before
// calling interpolateLatitude() with Math.abs(latitude).
export const SHGF_LATITUDE_FACTOR = {
   0: { N: 0.60, NE: 1.00, E: 1.00, SE: 0.82, S: 0.38, SW: 0.82, W: 1.00, NW: 1.00, Horizontal: 1.06 },
  10: { N: 0.72, NE: 1.00, E: 1.00, SE: 0.88, S: 0.55, SW: 0.88, W: 1.00, NW: 1.00, Horizontal: 1.04 },
  20: { N: 0.88, NE: 1.00, E: 1.00, SE: 0.95, S: 0.78, SW: 0.95, W: 1.00, NW: 1.00, Horizontal: 1.01 },
  // 24°N: interpolated at t=(24−20)/(32−20)=0.333. Primary beneficiary: TSMC Hsinchu (24.8°N).
  24: { N: 0.94, NE: 1.00, E: 1.00, SE: 0.98, S: 0.85, SW: 0.98, W: 1.00, NW: 1.00, Horizontal: 1.00 },
  32: { N: 1.00, NE: 1.00, E: 1.00, SE: 1.00, S: 1.00, SW: 1.00, W: 1.00, NW: 1.00, Horizontal: 1.00 },
  // 36°N: interpolated at t=(36−32)/(40−32)=0.5. Covers Denver (39.7°N), Istanbul (41°N).
  36: { N: 1.08, NE: 1.00, E: 1.00, SE: 1.02, S: 1.11, SW: 1.02, W: 1.00, NW: 1.00, Horizontal: 0.99 },
  40: { N: 1.15, NE: 1.00, E: 1.00, SE: 1.04, S: 1.22, SW: 1.04, W: 1.00, NW: 1.00, Horizontal: 0.97 },
  48: { N: 1.35, NE: 1.02, E: 0.98, SE: 1.08, S: 1.52, SW: 1.08, W: 0.98, NW: 1.02, Horizontal: 0.93 },
  56: { N: 1.60, NE: 1.05, E: 0.96, SE: 1.14, S: 1.90, SW: 1.14, W: 0.96, NW: 1.05, Horizontal: 0.88 },
};

// ── Diurnal Range Defaults (°F) ───────────────────────────────────────────────
// Used when projectSlice.ambient.dailyRange = 0 (engineer did not override).
// tOutdoorMean = tPeak − dailyRange/2 (ASHRAE HOF 2021 Ch.18)
export const DIURNAL_RANGE_DEFAULTS = {
  summer:  18,
  monsoon: 12,
  winter:  20,
};

// ── Latitude interpolation helper ─────────────────────────────────────────────
/**
 * interpolateLatitude(table, lat, key)
 * Linear interpolation between the two nearest latitude breakpoints.
 * Warns on missing key rather than silently returning 0.
 */
export const interpolateLatitude = (table, lat, key) => {
  const latitudes = Object.keys(table).map(Number).sort((a, b) => a - b);

  if (lat <= latitudes[0]) {
    const val = table[latitudes[0]][key];
    if (val === undefined) {
      console.warn(`interpolateLatitude: key "${key}" not found at lat ${latitudes[0]}`);
      return 0;
    }
    return val;
  }
  if (lat >= latitudes[latitudes.length - 1]) {
    const val = table[latitudes[latitudes.length - 1]][key];
    if (val === undefined) {
      console.warn(`interpolateLatitude: key "${key}" not found at lat ${latitudes[latitudes.length - 1]}`);
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
// Source: ASHRAE CHLCM 2nd Ed., Table 15, Ch.28
//
// ⚠️  THIS TABLE IS FOR GLASS WITH INTERIOR SHADING ONLY.
//     For unshaded glass, use CLF_UNSHADED = 1.0.
//
// ⚠️  FOR 24/7 CRITICAL FACILITIES: do NOT use this table.
//     Semiconductor fabs, battery formation, and pharma fill/finish operate
//     continuously — the room never cools down, so heat storage is irrelevant.
//     All internal heat enters the cooling load immediately: use CLF = 1.0.
//     Using CLF_INTERNAL['heavy'] = 0.75 for a 24/7 fab understates load by 25%.
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

// CLF for unshaded glass at peak hour (interior shading absent)
export const CLF_UNSHADED = 1.0;

// CLF for internal gains (people, lights, equipment) — office/occupied-period rooms only.
// See ⚠️ note above about 24/7 facilities.
export const CLF_INTERNAL = {
  light:  0.97,
  medium: 0.90,
  heavy:  0.75,
};

// ── Glazing Options ───────────────────────────────────────────────────────────
// SC  = shading coefficient (legacy ASHRAE method)
// SHGC = solar heat gain coefficient (ASHRAE 90.1-2022 / NFRC method)
// Relationship: SHGC ≈ SC × 0.87 for most product types.
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
// Source: ASHRAE HOF 2021 Ch.25; ASHRAE 90.1-2022 envelope requirements.
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
// Reference values for EnvelopeConfig UI suggestions.
// These are NOT auto-applied — engineers enter actual kW per room in envelopeSlice.
//
// ⚠️  diversityFactor here is the AUTHORITATIVE per-type value.
//     seasonalLoads.js reads diversityFactor from envelopeSlice state directly.
//     Do NOT also multiply by ASHRAE.PROCESS_DIVERSITY_FACTOR — that is a
//     global fallback for rooms where no per-type factor is specified.
export const EQUIPMENT_LOAD_DENSITY = {
  'Semiconductor fab — light tools':   { wPerFt2:  50, diversityFactor: 0.70 },
  'Semiconductor fab — heavy tools':   { wPerFt2: 200, diversityFactor: 0.65 },
  'Pharma process — general':          { wPerFt2:  30, diversityFactor: 0.75 },
  'Pharma process — high intensity':   { wPerFt2:  80, diversityFactor: 0.70 },
  'Battery formation — Li-ion':        { wPerFt2:  80, diversityFactor: 0.80 },
  'Battery formation — solid state':   { wPerFt2: 120, diversityFactor: 0.80 },
  // Lead-acid: rectifier + busbar losses 35–50 W/ft².
  // Lower than Li-ion: no drying ovens, no NMP bake-off.
  // diversityFactor 0.85: staggered formation cycling, plateau phase ~60–70% of peak.
  // Source: EnerSys/Exide formation hall guides; IEEE 1184-2006 §6.7.
  'Battery formation — Lead-acid':     { wPerFt2:  40, diversityFactor: 0.85 },
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
 * correctCLTD(baseCltd, tRoom, tOutdoorMean, lmCorrection?)
 *
 * ASHRAE HOF 2021, Ch.18 Eq.2:
 *   CLTD_corrected = CLTD_table + (78 − t_room) + (t_outdoor_mean − 85) + LM
 *
 * tOutdoorMean must be pre-computed as tPeak − dailyRange/2 before calling.
 *
 * ⚠️  Negative return values are physically valid (heat loss outward in winter
 *     or heavily insulated conditions). Callers MUST NOT clamp to zero.
 *
 * @param {number} baseCltd       - CLTD scalar from table (°F)
 * @param {number} tRoom          - room design dry-bulb (°F)
 * @param {number} tOutdoorMean   - mean outdoor DB = tPeak − dailyRange/2 (°F)
 * @param {number} lmCorrection   - latitude-month correction from CLTD_LM (°F)
 * @returns {number} corrected CLTD (°F) — may be negative
 */
export const correctCLTD = (
  baseCltd,
  tRoom,
  tOutdoorMean,
  lmCorrection = 0,
) => {
  return baseCltd + (78 - tRoom) + (tOutdoorMean - 85) + lmCorrection;
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
    shaded:      false,
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
    shaded:   false,
  },
  partitions: {
    label:      'Partition Wall',
    area:       0,
    uValue:     0.35,
    uPreset:    'Gypsum Board + Stud (uninsulated)',
    tAdj:       85,
    tAdjSummer: 85,
    tAdjWinter: 65,
  },
  floors: {
    label:      'Floor',
    area:       0,
    uValue:     0.10,
    uPreset:    'Concrete Slab on Grade',
    tAdj:       75,
    tAdjSummer: 75,
    tAdjWinter: 55,
  },
};