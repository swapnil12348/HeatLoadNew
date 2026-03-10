/**
 * useProjectTotals.js
 * Responsibility: Aggregate project-level totals across all rooms.
 *
 * Consumed by:
 *   ResultsPage   — KPI cards (total TR, CFM, area, check figure)
 *   AHUConfig     — per-AHU totals table
 *   RDSPage       — summary row at bottom of table
 *   Header        — could show live project load (future)
 *
 * All values are memoized — recomputes only when rdsSelector output changes.
 *
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   FIX-H01 [CRITICAL] — totalAreaFt2 / totalAreaM2 double-conversion corrected.
 *
 *     Root cause: CRIT-RDS-01 (rdsSelector v2.1) changed rdsRow.floorArea from
 *     m² to ft³ so that isoValidation.js receives the correct unit for ACPH
 *     calculations. The hook was not updated to match.
 *
 *     Previous code:
 *       const totalAreaM2 = rdsRows.reduce((sum,r) => sum + r.floorArea)
 *       const totalAreaFt2 = m2ToFt2(totalAreaM2)   ← m2ToFt2(ft²) = ft² × 10.764
 *
 *     r.floorArea is now ft² — so totalAreaM2 was accumulating ft² with an m²
 *     label, then m2ToFt2() multiplied by 10.764 again. For a 100 m² room:
 *       r.floorArea = 1076 ft²
 *       totalAreaM2 = 1076  (labelled m², actually ft²)
 *       totalAreaFt2 = m2ToFt2(1076) = 11,590 ft²  — 10.764× too high
 *
 *     The check figure (ft²/TR) accidentally produced the correct number
 *     because checkFigure() received ft² (mislabelled m²). That accident
 *     masked the bug from casual inspection.
 *
 *     Fix: accumulate rdsRow.floorArea as ft² directly. Derive m² by dividing.
 *     checkFigure() now explicitly receives ft² with the correct label.
 *
 *   FIX-H02 [NEW] — highHumidRooms aggregation added.
 *
 *     CRITICAL-02 / CRITICAL-03 (rdsSelector audit) added highHumidificationLoad
 *     and humidWarning to each rdsRow. No hook surfaced these to the UI.
 *     For Li-ion battery rooms (Exide), semiconductor dry-rooms (TSMC), and
 *     pharma dry-powder suites (Cipla), these warnings represent the single
 *     most critical mechanical sizing condition — missing humidification is a
 *     production-stopping failure.
 *
 *     Fix: highHumidRooms array added to return value. UI components (ResultsPage,
 *     RDSPage) should render a banner when highHumidRooms.length > 0.
 *
 *   FIX-H03 [NEW] — regulatoryAcphRooms aggregation added.
 *
 *     HIGH-AQ-01 (airQuantities audit) added regulatoryAcphCFM to each rdsRow
 *     and 'regulatoryAcph' as a possible supplyAirGoverned value. No hook
 *     counted how many rooms are governed by the regulatory ACH floor vs thermal.
 *     For NFPA 855 battery rooms and GMP pharma rooms this is a compliance
 *     audit requirement — the engineer must be able to see at a glance which
 *     rooms are governed by statute vs engineering load.
 *
 *   FIX-H04 [NEW] — totalCoilLoadBTU added.
 *
 *     CRIT-RDS-02 fixed rdsSelector to use oaTotal (enthalpy method) for both
 *     grandTotal and coilLoadBTU. The hook previously only exposed totalTR
 *     (from grandTotal). coilLoadBTU is the correct basis for CHW plant sizing
 *     — different from grandTotal because it excludes fan heat.
 *     Added totalCoilLoadBTU for CHW plant check against projectPipes.
 *
 * @returns {{
 *   // Project totals
 *   totalTR:              number   total cooling (TR)
 *   totalCFM:             number   total supply airflow (CFM)
 *   totalAreaFt2:         number   total conditioned floor area (ft²)  [from rdsRows]
 *   totalAreaM2:          number   total conditioned floor area (m²)   [derived]
 *   totalHeatingKW:       number   total heating capacity (kW)
 *   totalHumidKW:         number   total humidifier power (kW)
 *   totalFreshAirCFM:     number   total fresh air (CFM)
 *   totalExhaustCFM:      number   total exhaust (CFM)
 *   totalPeople:          number   total occupancy (persons)
 *   totalCoilLoadBTU:     number   total coil load excl. fan heat (BTU/hr) — CHW plant basis
 *
 *   // Sanity check figure
 *   checkFigureVal:       number   ft²/TR
 *   checkFigureRating:    string   'excellent' | 'good' | 'review' | 'high'
 *   checkFigureNote:      string   human-readable benchmark note
 *
 *   // Per-AHU breakdown
 *   byAhu:                object   keyed by ahuId → { tr, cfm, heatingKW, freshAirCFM, rooms }
 *
 *   // ISO compliance summary
 *   compliance:           object   from validateAllRooms()
 *
 *   // Dry-room / high humidification warnings (FIX-H02)
 *   highHumidRooms:       Array<{ id, name, humidWarning, humidDeltaGr, humidLbsPerHr }>
 *                         Rooms where Δgr > 40 gr/lb — sub-5%RH warning.
 *                         MUST be surfaced in UI for battery and semiconductor facilities.
 *
 *   // Regulatory ACH governed rooms (FIX-H03)
 *   regulatoryAcphRooms:  Array<{ id, name, ventCategory, regulatoryAcphCFM, supplyAir }>
 *                         Rooms where NFPA 855 / OSHA / GMP ACH floor is the
 *                         binding supply air constraint.
 *
 *   // Pipe sizing
 *   projectPipes:         object   from calculateProjectPipeSizing()
 *
 *   // Meta
 *   roomCount:            number
 *   hasData:              boolean  false when no rooms computed yet
 * }}
 */

import { useMemo }     from 'react';
import { useSelector } from 'react-redux';
import { selectRdsData }                from '../features/results/rdsSelector';
import { validateAllRooms }             from '../utils/isoValidation';
import { calculateProjectPipeSizing }   from '../features/results/pipeSizing';
import { checkFigure }                  from '../utils/units';

// ft² → m² conversion factor (exact reciprocal of 10.7639)
const FT2_TO_M2 = 1 / 10.7639;

// ── Check figure benchmarks ────────────────────────────────────────────────
// ft²/TR — lower = higher heat density = more intensive cooling required
// Source: ASHRAE HVAC Applications Ch.18; industry practice for critical facilities
const CHECK_FIGURE_BENCHMARKS = [
  { max: 50,       rating: 'excellent', note: 'Semiconductor / high-density fab — typical <50 ft²/TR' },
  { max: 150,      rating: 'good',      note: 'Pharmaceutical / biotech cleanroom — typical 50–150 ft²/TR' },
  { max: 400,      rating: 'review',    note: 'General commercial / light industrial — typical 250–400 ft²/TR' },
  { max: Infinity, rating: 'high',      note: 'Low heat density — verify loads are complete' },
];

const rateCheckFigure = (cf) =>
  CHECK_FIGURE_BENCHMARKS.find((b) => cf <= b.max) ??
  CHECK_FIGURE_BENCHMARKS[CHECK_FIGURE_BENCHMARKS.length - 1];

// ── Empty state ────────────────────────────────────────────────────────────
const EMPTY_TOTALS = {
  totalTR:             0,
  totalCFM:            0,
  totalAreaFt2:        0,
  totalAreaM2:         0,
  totalHeatingKW:      0,
  totalHumidKW:        0,
  totalFreshAirCFM:    0,
  totalExhaustCFM:     0,
  totalPeople:         0,
  totalCoilLoadBTU:    0,
  checkFigureVal:      0,
  checkFigureRating:   'high',
  checkFigureNote:     'No rooms — add rooms to calculate.',
  byAhu:               {},
  compliance:          {
    allPass:        true,
    totalErrors:    0,
    totalWarnings:  0,
    rooms:          [],
    nonCompliantIds:[],
  },
  highHumidRooms:      [],
  regulatoryAcphRooms: [],
  projectPipes:        {},
  roomCount:           0,
  hasData:             false,
};

// ── Hook ───────────────────────────────────────────────────────────────────

const useProjectTotals = () => {
  const rdsRows = useSelector(selectRdsData);

  const totals = useMemo(() => {
    if (!rdsRows || rdsRows.length === 0) return EMPTY_TOTALS;

    // ── Scalar totals ──────────────────────────────────────────────────────

    const totalTR = rdsRows.reduce(
      (sum, r) => sum + (parseFloat(r.coolingCapTR) || 0), 0
    );
    const totalCFM = rdsRows.reduce(
      (sum, r) => sum + (parseFloat(r.supplyAir) || 0), 0
    );

    // FIX-H01: rdsRow.floorArea is ft² post CRIT-RDS-01.
    // Accumulate as ft² (the unit rdsRow actually contains).
    // Derive m² by conversion — do NOT pass through m2ToFt2() again.
    const totalAreaFt2 = rdsRows.reduce(
      (sum, r) => sum + (parseFloat(r.floorArea) || 0), 0   // ft² — correct post CRIT-RDS-01
    );
    const totalAreaM2 = totalAreaFt2 * FT2_TO_M2;

    const totalHeatingKW = rdsRows.reduce(
      (sum, r) => sum + (parseFloat(r.heatingCap) || 0), 0
    );
    const totalHumidKW = rdsRows.reduce(
      (sum, r) => sum + (parseFloat(r.humidKw) || 0), 0
    );
    const totalFreshAirCFM = rdsRows.reduce(
      (sum, r) => sum + (parseFloat(r.freshAirCheck) || 0), 0
    );
    const totalExhaustCFM = rdsRows.reduce(
      (sum, r) => sum + (parseFloat(r.totalExhaust) || 0), 0
    );
    const totalPeople = rdsRows.reduce(
      (sum, r) => sum + (parseFloat(r.people_count) || 0), 0
    );

    // FIX-H04: coilLoadBTU excludes fan heat — correct basis for CHW plant sizing.
    // grandTotal (which drives totalTR) includes fan heat. For chiller plant
    // selection and CHW pipe sizing these are different numbers.
    const totalCoilLoadBTU = rdsRows.reduce(
      (sum, r) => sum + (parseFloat(r.coilLoadBTU) || 0), 0
    );

    // ── Check figure ───────────────────────────────────────────────────────
    // FIX-H01: checkFigure() expects ft²/TR. Pass totalAreaFt2 directly —
    // no longer accidentally passing mislabelled ft² as m².
    const checkFigureVal    = checkFigure(totalAreaFt2, totalTR);
    const { rating, note }  = rateCheckFigure(checkFigureVal);

    // ── Per-AHU breakdown ──────────────────────────────────────────────────
    const byAhu = rdsRows.reduce((acc, r) => {
      const ahuId = r.ahuId || 'unassigned';
      if (!acc[ahuId]) {
        acc[ahuId] = { tr: 0, cfm: 0, heatingKW: 0, freshAirCFM: 0, rooms: [] };
      }
      acc[ahuId].tr          += parseFloat(r.coolingCapTR)  || 0;
      acc[ahuId].cfm         += parseFloat(r.supplyAir)     || 0;
      acc[ahuId].heatingKW   += parseFloat(r.heatingCap)    || 0;
      acc[ahuId].freshAirCFM += parseFloat(r.freshAirCheck) || 0;
      acc[ahuId].rooms.push({
        id:       r.id,
        name:     r.name,
        tr:       parseFloat(r.coolingCapTR) || 0,
        cfm:      parseFloat(r.supplyAir)    || 0,
        governed: r.supplyAirGoverned,
      });
      return acc;
    }, {});

    // ── ISO compliance ─────────────────────────────────────────────────────
    const compliance = validateAllRooms(rdsRows);

    // ── High humidification warning rooms (FIX-H02) ────────────────────────
    //
    // highHumidificationLoad (boolean) and humidWarning (string | null) were
    // added to rdsRow in CRITICAL-02 / CRITICAL-03 fixes but no hook surfaced
    // them to the UI.
    //
    // These rooms require specialist review of steam supply capacity, manifold
    // sizing, and AHU humidifier section length. For Li-ion / battery-acid /
    // semiconductor dry-rooms a missing humidifier is a production-stopping failure.
    //
    // UI components MUST render a visible banner when highHumidRooms.length > 0.
    const highHumidRooms = rdsRows
      .filter(r => r.highHumidificationLoad === true)
      .map(r => ({
        id:             r.id,
        name:           r.name,
        ventCategory:   r.ventCategory,
        humidWarning:   r.humidWarning,
        humidDeltaGr:   r.humidDeltaGr,   // string, toFixed(1) from heatingHumid
        humidLbsPerHr:  r.humidLbsPerHr,  // string, toFixed(2) from heatingHumid
        humidKw:        r.humidKw,         // string, toFixed(2) from heatingHumid
      }));

    // ── Regulatory ACH governed rooms (FIX-H03) ────────────────────────────
    //
    // HIGH-AQ-01 added 'regulatoryAcph' as a supplyAirGoverned state and
    // regulatoryAcphCFM to each rdsRow. No hook aggregated this.
    //
    // For a compliance audit (NFPA 855 battery rooms, OSHA lead-acid,
    // GMP Annex 1 pharma), the engineer must see which rooms are governed
    // by statute vs engineering thermal load.
    const regulatoryAcphRooms = rdsRows
      .filter(r => r.supplyAirGoverned === 'regulatoryAcph')
      .map(r => ({
        id:                 r.id,
        name:               r.name,
        ventCategory:       r.ventCategory,
        regulatoryAcphCFM:  r.regulatoryAcphCFM,
        supplyAir:          r.supplyAir,
        thermalCFM:         r.thermalCFM,
      }));

    // ── Project pipe sizing ────────────────────────────────────────────────
    const projectPipes = calculateProjectPipeSizing(rdsRows);

    return {
      // Totals
      totalTR:           parseFloat(totalTR.toFixed(2)),
      totalCFM:          Math.round(totalCFM),
      totalAreaFt2:      parseFloat(totalAreaFt2.toFixed(0)),   // FIX-H01: correct label
      totalAreaM2:       parseFloat(totalAreaM2.toFixed(1)),    // FIX-H01: derived, not accumulated
      totalHeatingKW:    parseFloat(totalHeatingKW.toFixed(2)),
      totalHumidKW:      parseFloat(totalHumidKW.toFixed(2)),
      totalFreshAirCFM:  Math.round(totalFreshAirCFM),
      totalExhaustCFM:   Math.round(totalExhaustCFM),
      totalPeople:       Math.round(totalPeople),
      totalCoilLoadBTU:  Math.round(totalCoilLoadBTU),          // FIX-H04

      // Check figure
      checkFigureVal,                                            // FIX-H01: now receives correct ft²
      checkFigureRating: rating,
      checkFigureNote:   note,

      // Breakdowns
      byAhu,
      compliance,

      // Dry-room / high humidification warnings (FIX-H02)
      highHumidRooms,

      // Regulatory ACH governed rooms (FIX-H03)
      regulatoryAcphRooms,

      // Pipe sizing
      projectPipes,

      // Meta
      roomCount: rdsRows.length,
      hasData:   true,
    };
  }, [rdsRows]);

  return totals;
};

export default useProjectTotals;