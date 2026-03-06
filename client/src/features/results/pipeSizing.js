/**
 * pipeSizing.js
 * Responsibility: Hydronic pipe sizing for CHW, HW, and condensate systems.
 *
 * Reference: ASHRAE Handbook — HVAC Systems & Equipment (2020), Chapter 22
 *            ASHRAE Handbook — Fundamentals (2021), Chapter 22 (Pipe sizing)
 *            ASHRAE 90.1-2022, Section 6.2 (pipe insulation / flow limits)
 *
 * ── METHOD ───────────────────────────────────────────────────────────────────
 *
 *   ASHRAE pipe sizing uses the pressure drop method:
 *     Recommended friction loss: 1–4 ft w.g. per 100 ft pipe (ASHRAE Ch.22)
 *     Recommended velocity:      2–4 ft/s for branch lines
 *                                4–8 ft/s for mains
 *
 *   Pipe area from flow rate and velocity:
 *     A (ft²) = Q (ft³/s) / V (ft/s)
 *     Q (ft³/s) = GPM / 449
 *       where 449 = 60 s/min × 7.48 gal/ft³
 *
 *   Pipe diameter:
 *     D (ft) = √(4A / π)
 *     D (mm) = D (ft) × 304.8
 *
 *   Nominal pipe size selected as next standard size UP from calculated D.
 *
 * ── STANDARD PIPE SIZES ──────────────────────────────────────────────────────
 *
 *   Nominal sizes (mm): 15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150,
 *                       200, 250, 300, 350, 400
 *   These are DN (nominal diameter) sizes per ISO 6708 / ASME B36.10.
 *   Actual internal diameter varies by schedule — we size on nominal OD
 *   for preliminary design (standard HVAC practice).
 *
 * ── FLOW CONSTANTS ───────────────────────────────────────────────────────────
 *
 *   CHW: Q (GPM) = BTU/hr / (500 × ΔT_chw)    ΔT_chw = 10°F
 *   HW:  Q (GPM) = BTU/hr / (500 × ΔT_hw)     ΔT_hw  = 20°F
 *   500 = 60 min/hr × 8.33 lb/gal × 1 BTU/lb·°F
 *
 * ── MANIFOLD SIZING ──────────────────────────────────────────────────────────
 *
 *   Manifold sized at lower velocity (1.5–2 ft/s) to minimise pressure drop
 *   at the header. Common practice in critical facility HVAC design.
 *   Manifold size = next standard size UP from branch calculation at 1.5 ft/s.
 *
 * UNITS:
 *   Flow rates  — USGPM
 *   Velocities  — ft/s
 *   Diameters   — mm (nominal DN)
 *   Pressures   — ft w.g. per 100 ft pipe
 *   Loads       — BTU/hr
 */

// ── Standard nominal pipe sizes (DN, mm) ─────────────────────────────────────
const NOMINAL_PIPE_SIZES_MM = [
  15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400,
];

// ── Velocity targets (ft/s) ───────────────────────────────────────────────────
const VELOCITY_BRANCH_FT_S   = 3.0;  // branch lines — midpoint of 2–4 ft/s range
const VELOCITY_MANIFOLD_FT_S = 1.5;  // manifold/header — lower for reduced ΔP

// ── Hydronic constants ────────────────────────────────────────────────────────
const HYDRONIC_CONSTANT = 500;   // 60 × 8.33 × 1
const CHW_DELTA_T_F     = 10;    // °F — standard chilled water differential
const HW_DELTA_T_F      = 20;    // °F — standard hot water differential
const GPM_TO_FT3_S      = 449;   // 60 s/min × 7.48 gal/ft³

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Select the next nominal pipe size (DN mm) that meets or exceeds
 * the calculated inside diameter.
 *
 * @param {number} calcDiameterMm - calculated minimum inside diameter (mm)
 * @returns {number} nominal pipe size (mm DN)
 */
const selectNominalSize = (calcDiameterMm) => {
  if (calcDiameterMm <= 0) return NOMINAL_PIPE_SIZES_MM[0];
  const found = NOMINAL_PIPE_SIZES_MM.find((dn) => dn >= calcDiameterMm);
  return found ?? NOMINAL_PIPE_SIZES_MM[NOMINAL_PIPE_SIZES_MM.length - 1];
};

/**
 * Calculate pipe diameter and select nominal size for a given flow and velocity.
 *
 * @param {number} flowGPM      - volumetric flow rate (USGPM)
 * @param {number} velocityFtS  - design velocity (ft/s)
 * @returns {{
 *   flowGPM:       number,
 *   velocityFtS:   number,
 *   calcDiamMm:    number,   calculated minimum diameter (mm)
 *   nominalDnMm:   number,   selected nominal DN size (mm)
 * }}
 */
const sizePipe = (flowGPM, velocityFtS) => {
  if (flowGPM <= 0) {
    return { flowGPM: 0, velocityFtS, calcDiamMm: 0, nominalDnMm: 0 };
  }

  const flowFt3s     = flowGPM / GPM_TO_FT3_S;               // ft³/s
  const areaFt2      = flowFt3s / velocityFtS;                // ft²
  const diamFt       = Math.sqrt((4 * areaFt2) / Math.PI);    // ft
  const calcDiamMm   = diamFt * 304.8;                        // mm
  const nominalDnMm  = selectNominalSize(calcDiamMm);

  return {
    flowGPM:      parseFloat(flowGPM.toFixed(1)),
    velocityFtS,
    calcDiamMm:   parseFloat(calcDiamMm.toFixed(1)),
    nominalDnMm,
  };
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * calculatePipeSizing()
 *
 * Sizes CHW branch, CHW manifold, HW branch, and HW manifold pipes
 * for a single room/AHU coil connection.
 *
 * @param {number} coolingLoadBTU  - total room cooling load (BTU/hr)
 * @param {number} heatingLoadBTU  - total room heating load (BTU/hr, positive magnitude)
 * @param {number} preheatLoadBTU  - OA preheat load (BTU/hr, positive magnitude)
 *
 * @returns {{
 *   chw: {
 *     flowGPM:          number,   CHW branch flow (USGPM)
 *     branchDiamMm:     number,   CHW branch nominal DN (mm)
 *     manifoldDiamMm:   number,   CHW manifold nominal DN (mm)
 *     calcBranchMm:     number,   calculated branch diameter (mm)
 *     calcManifoldMm:   number,   calculated manifold diameter (mm)
 *   },
 *   hw: {
 *     flowGPM:          number,   HW branch flow (USGPM)
 *     branchDiamMm:     number,   HW branch nominal DN (mm)
 *     manifoldDiamMm:   number,   HW manifold nominal DN (mm)
 *     calcBranchMm:     number,   calculated branch diameter (mm)
 *     calcManifoldMm:   number,   calculated manifold diameter (mm)
 *   },
 *   preheat: {
 *     flowGPM:          number,   preheat coil HW flow (USGPM)
 *     branchDiamMm:     number,   preheat branch nominal DN (mm)
 *     calcBranchMm:     number,   calculated branch diameter (mm)
 *   },
 * }}
 */
export const calculatePipeSizing = (
  coolingLoadBTU,
  heatingLoadBTU,
  preheatLoadBTU = 0,
) => {

  // ── CHW sizing ──────────────────────────────────────────────────────────────
  const chwGPM      = coolingLoadBTU > 0
    ? coolingLoadBTU / (HYDRONIC_CONSTANT * CHW_DELTA_T_F)
    : 0;

  const chwBranch   = sizePipe(chwGPM, VELOCITY_BRANCH_FT_S);
  const chwManifold = sizePipe(chwGPM, VELOCITY_MANIFOLD_FT_S);

  // ── HW sizing ───────────────────────────────────────────────────────────────
  const hwGPM       = heatingLoadBTU > 0
    ? heatingLoadBTU / (HYDRONIC_CONSTANT * HW_DELTA_T_F)
    : 0;

  const hwBranch    = sizePipe(hwGPM, VELOCITY_BRANCH_FT_S);
  const hwManifold  = sizePipe(hwGPM, VELOCITY_MANIFOLD_FT_S);

  // ── Preheat coil HW sizing ──────────────────────────────────────────────────
  const preheatGPM    = preheatLoadBTU > 0
    ? preheatLoadBTU / (HYDRONIC_CONSTANT * HW_DELTA_T_F)
    : 0;

  const preheatBranch = sizePipe(preheatGPM, VELOCITY_BRANCH_FT_S);

  return {
    chw: {
      flowGPM:        chwBranch.flowGPM,
      branchDiamMm:   chwBranch.nominalDnMm,
      manifoldDiamMm: chwManifold.nominalDnMm,
      calcBranchMm:   chwBranch.calcDiamMm,
      calcManifoldMm: chwManifold.calcDiamMm,
    },
    hw: {
      flowGPM:        hwBranch.flowGPM,
      branchDiamMm:   hwBranch.nominalDnMm,
      manifoldDiamMm: hwManifold.nominalDnMm,
      calcBranchMm:   hwBranch.calcDiamMm,
      calcManifoldMm: hwManifold.calcDiamMm,
    },
    preheat: {
      flowGPM:      preheatBranch.flowGPM,
      branchDiamMm: preheatBranch.nominalDnMm,
      calcBranchMm: preheatBranch.calcDiamMm,
    },
  };
};

// ── Project-level aggregator ──────────────────────────────────────────────────

/**
 * calculateProjectPipeSizing()
 *
 * Aggregates all room pipe sizing results into project-level
 * main pipe sizing. Used by ResultsPage for plant room sizing.
 *
 * Main CHW/HW pipe sized on TOTAL project load at main velocity (4 ft/s).
 *
 * @param {Array}  rdsRows        - full selectRdsData output array
 * @returns {{
 *   totalCHWFlowGPM:      number,
 *   totalHWFlowGPM:       number,
 *   mainCHWBranchMm:      number,  main CHW pipe nominal DN (mm)
 *   mainHWBranchMm:       number,  main HW pipe nominal DN (mm)
 *   mainCHWManifoldMm:    number,
 *   mainHWManifoldMm:     number,
 * }}
 */
export const calculateProjectPipeSizing = (rdsRows) => {
  if (!rdsRows || rdsRows.length === 0) {
    return {
      totalCHWFlowGPM:   0,
      totalHWFlowGPM:    0,
      mainCHWBranchMm:   0,
      mainHWBranchMm:    0,
      mainCHWManifoldMm: 0,
      mainHWManifoldMm:  0,
    };
  }

  // Sum all room cooling and heating loads
  const totalCoolingBTU = rdsRows.reduce(
    (sum, r) => sum + (parseFloat(r.grandTotal)    || 0), 0
  );
  const totalHeatingBTU = rdsRows.reduce(
    (sum, r) => sum + (parseFloat(r.heatingCapBTU) || 0), 0
  );

  // Total flow rates
  const totalCHWFlowGPM = totalCoolingBTU > 0
    ? totalCoolingBTU / (HYDRONIC_CONSTANT * CHW_DELTA_T_F)
    : 0;

  const totalHWFlowGPM = totalHeatingBTU > 0
    ? totalHeatingBTU / (HYDRONIC_CONSTANT * HW_DELTA_T_F)
    : 0;

  // Main pipe at branch velocity — manifold at manifold velocity
  const mainCHWBranch   = sizePipe(totalCHWFlowGPM, VELOCITY_BRANCH_FT_S);
  const mainHWBranch    = sizePipe(totalHWFlowGPM,  VELOCITY_BRANCH_FT_S);
  const mainCHWManifold = sizePipe(totalCHWFlowGPM, VELOCITY_MANIFOLD_FT_S);
  const mainHWManifold  = sizePipe(totalHWFlowGPM,  VELOCITY_MANIFOLD_FT_S);

  return {
    totalCHWFlowGPM:   parseFloat(totalCHWFlowGPM.toFixed(1)),
    totalHWFlowGPM:    parseFloat(totalHWFlowGPM.toFixed(1)),
    mainCHWBranchMm:   mainCHWBranch.nominalDnMm,
    mainHWBranchMm:    mainHWBranch.nominalDnMm,
    mainCHWManifoldMm: mainCHWManifold.nominalDnMm,
    mainHWManifoldMm:  mainHWManifold.nominalDnMm,
  };
};