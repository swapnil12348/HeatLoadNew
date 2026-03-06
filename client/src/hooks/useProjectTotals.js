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
 * @returns {{
 *   // Project totals
 *   totalTR:             number   total cooling (TR)
 *   totalCFM:            number   total supply airflow (CFM)
 *   totalAreaM2:         number   total conditioned floor area (m²)
 *   totalAreaFt2:        number   total conditioned floor area (ft²)
 *   totalHeatingKW:      number   total heating capacity (kW)
 *   totalHumidKW:        number   total humidifier power (kW)
 *   totalFreshAirCFM:    number   total fresh air (CFM)
 *   totalExhaustCFM:     number   total exhaust (CFM)
 *   totalPeople:         number   total occupancy (persons)
 *
 *   // Sanity check figure
 *   checkFigureVal:      number   ft²/TR — see ASHRAE benchmarks below
 *   checkFigureRating:   string   'excellent' | 'good' | 'review' | 'high'
 *   checkFigureNote:     string   human-readable benchmark note
 *
 *   // Per-AHU breakdown
 *   byAhu:               object   keyed by ahuId → { tr, cfm, rooms }
 *
 *   // ISO compliance summary
 *   compliance:          object   from validateAllRooms()
 *
 *   // Pipe sizing
 *   projectPipes:        object   from calculateProjectPipeSizing()
 *
 *   // Meta
 *   roomCount:           number
 *   hasData:             boolean  false when no rooms computed yet
 * }}
 */

import { useMemo }     from 'react';
import { useSelector } from 'react-redux';
import { selectRdsData }                from '../features/results/rdsSelector';
import { validateAllRooms }             from '../utils/isoValidation';
import { calculateProjectPipeSizing }   from '../features/results/pipeSizing';
import { m2ToFt2, checkFigure }         from '../utils/units';

// ── Check figure benchmarks ────────────────────────────────────────────────
// ft²/TR — lower = higher heat density = more intensive cooling required
// Source: ASHRAE HVAC Applications Ch.18; industry practice
const CHECK_FIGURE_BENCHMARKS = [
  { max: 50,  rating: 'excellent', note: 'Semiconductor / high-density fab — typical <50 ft²/TR' },
  { max: 150, rating: 'good',      note: 'Pharmaceutical / biotech cleanroom — typical 50–150 ft²/TR' },
  { max: 400, rating: 'review',    note: 'General commercial / light industrial — typical 250–400 ft²/TR' },
  { max: Infinity, rating: 'high', note: 'Low heat density — verify loads are complete' },
];

const rateCheckFigure = (cf) => {
  const benchmark = CHECK_FIGURE_BENCHMARKS.find((b) => cf <= b.max);
  return benchmark ?? CHECK_FIGURE_BENCHMARKS[CHECK_FIGURE_BENCHMARKS.length - 1];
};

// ── Hook ───────────────────────────────────────────────────────────────────

const useProjectTotals = () => {
  const rdsRows = useSelector(selectRdsData);

  const totals = useMemo(() => {
    if (!rdsRows || rdsRows.length === 0) {
      return {
        totalTR:           0,
        totalCFM:          0,
        totalAreaM2:       0,
        totalAreaFt2:      0,
        totalHeatingKW:    0,
        totalHumidKW:      0,
        totalFreshAirCFM:  0,
        totalExhaustCFM:   0,
        totalPeople:       0,
        checkFigureVal:    0,
        checkFigureRating: 'high',
        checkFigureNote:   'No rooms — add rooms to calculate.',
        byAhu:             {},
        compliance:        { allPass: true, totalErrors: 0, totalWarnings: 0, rooms: [], nonCompliantIds: [] },
        projectPipes:      {},
        roomCount:         0,
        hasData:           false,
      };
    }

    // ── Scalar totals ──────────────────────────────────────────────────────
    const totalTR = rdsRows.reduce(
      (sum, r) => sum + (parseFloat(r.coolingCapTR) || 0), 0
    );
    const totalCFM = rdsRows.reduce(
      (sum, r) => sum + (parseFloat(r.supplyAir) || 0), 0
    );
    const totalAreaM2 = rdsRows.reduce(
      (sum, r) => sum + (parseFloat(r.floorArea) || 0), 0
    );
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

    // ── Check figure ───────────────────────────────────────────────────────
    const totalAreaFt2    = m2ToFt2(totalAreaM2);
    const checkFigureVal  = checkFigure(totalAreaM2, totalTR);
    const { rating, note } = rateCheckFigure(checkFigureVal);

    // ── Per-AHU breakdown ──────────────────────────────────────────────────
    // Groups rooms by their assigned AHU for AHUConfig summary table.
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

    // ── Project pipe sizing ────────────────────────────────────────────────
    const projectPipes = calculateProjectPipeSizing(rdsRows);

    return {
      // Totals
      totalTR:           parseFloat(totalTR.toFixed(2)),
      totalCFM:          Math.round(totalCFM),
      totalAreaM2:       parseFloat(totalAreaM2.toFixed(1)),
      totalAreaFt2:      parseFloat(totalAreaFt2.toFixed(0)),
      totalHeatingKW:    parseFloat(totalHeatingKW.toFixed(2)),
      totalHumidKW:      parseFloat(totalHumidKW.toFixed(2)),
      totalFreshAirCFM:  Math.round(totalFreshAirCFM),
      totalExhaustCFM:   Math.round(totalExhaustCFM),
      totalPeople:       Math.round(totalPeople),

      // Check figure
      checkFigureVal,
      checkFigureRating: rating,
      checkFigureNote:   note,

      // Breakdowns
      byAhu,
      compliance,
      projectPipes,

      // Meta
      roomCount: rdsRows.length,
      hasData:   true,
    };
  }, [rdsRows]);

  return totals;
};

export default useProjectTotals;