/**
 * ahuSlice.js
 * Manages the list of Air Handling Units in the project.
 *
 * State shape:
 *   state.ahu.list  →  AHU[]
 *
 * ── FIELD CONTRACT WITH THE LOGIC LAYER ──────────────────────────────────────
 *
 *   airQuantities.js reads ONE field from the AHU object:
 *     ahu.type  →  'DOAS' | 'Recirculating' | 'MAU' | etc.
 *                  const isDOAS = ahuType === 'DOAS'
 *                  Default 'Recirculating' applied at read site:
 *                    const ahuType = ahu?.type || 'Recirculating'
 *                  So even an empty object or null AHU works for the logic layer.
 *
 *   rdsSelector reads:
 *     ahu.id   — echoed into each RDS row as ahuId
 *     ahu.type — echoed as typeOfUnit
 *
 * ── ADDITIONAL FIELDS (for AHUConfig.jsx UI) ────────────────────────────────
 *
 *   These fields are NOT read by the current logic layer but are required by
 *   the AHUConfig page for the engineer to specify equipment parameters.
 *   They are present in the default factory so the UI always has a bound value.
 *
 *   capacityTR         — cooling capacity in tons of refrigeration
 *   heatingCapKW       — heating coil capacity (kW)
 *   supplyFanCFM       — design supply air volume (CFM)
 *   returnFanCFM       — design return air volume (CFM)
 *   outerAirCFM        — outdoor air intake volume (CFM)   [display / spec]
 *   bypassFactor       — coil bypass factor (overrides project systemDesign.bypassFactor
 *                         if set > 0; 0 = use project-level default)
 *   adp                — apparatus dew point (°F) (same override logic as bypassFactor)
 *   filterClass        — filter classification (e.g. 'HEPA H14', 'G4 + F7')
 *   location           — physical location description
 *   notes              — free-text engineering notes
 *
 * ── AHU TYPE VALUES ──────────────────────────────────────────────────────────
 *
 *   'Recirculating'  — standard recirculating AHU (partial OA)
 *   'DOAS'           — Dedicated Outdoor Air System (100% OA always)
 *   'MAU'            — Make-up Air Unit (100% OA, typically for labs)
 *   'FCU'            — Fan Coil Unit (recirculating, no OA path)
 *
 *   Logic layer only distinguishes DOAS vs non-DOAS. The other type values
 *   are for equipment scheduling and spec documentation.
 *
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   BUG-SLICE-04 FIX — deleteAHU: guidance updated to require deleteAhuWithCleanup.
 *
 *     deleteAHU() (this reducer) only removes the AHU from ahuSlice.list.
 *     It does NOT clear room.assignedAhuIds references. After deletion,
 *     rdsSelector returns ahuId: '' and typeOfUnit: '-' for every affected
 *     room with no warning — silently reverting all those rooms to
 *     Recirculating type regardless of what the engineer configured.
 *
 *     Fix: deleteAhuWithCleanup(ahuId) thunk in roomActions.js clears all
 *     room assignments BEFORE removing the AHU. All UI components that
 *     delete AHUs MUST call deleteAhuWithCleanup, never deleteAHU directly.
 *
 *     deleteAHU is retained as the underlying reducer (the thunk dispatches
 *     it as the final step). Do not call it from UI code.
 */

import { createSlice } from '@reduxjs/toolkit';

// ── AHU factory ───────────────────────────────────────────────────────────────
const makeAhu = (id, index = 0, overrides = {}) => ({
  // ── Identity ──────────────────────────────────────────────────────────────
  id,
  name: `AHU-${String(index + 1).padStart(2, '0')}`,
  tag:  '',          // P&ID tag / equipment number

  // ── Type — READ BY LOGIC LAYER ────────────────────────────────────────────
  // airQuantities.js: const isDOAS = (ahu?.type || 'Recirculating') === 'DOAS'
  type: 'Recirculating',

  // ── Capacity (UI / spec fields) ───────────────────────────────────────────
  capacityTR:    0,    // tons of refrigeration
  heatingCapKW:  0,    // kW

  // ── Airflow (UI / spec fields) ────────────────────────────────────────────
  supplyFanCFM:  0,    // CFM
  returnFanCFM:  0,    // CFM
  outerAirCFM:   0,    // CFM

  // ── Psychrometric overrides ───────────────────────────────────────────────
  // 0 = use project-level systemDesign value (default behaviour).
  // Non-zero overrides the project default for this AHU only.
  // These override fields are NOT yet wired into rdsSelector — they are
  // placeholders for Sprint 3 per-AHU psychro override feature.
  bypassFactor:  0,    // 0 = use project default
  adpMode: 'manual',   // 'manual' | 'calculated'
  adp:           0,    // °F — 0 = use project default

  // ── Filter / location ─────────────────────────────────────────────────────
  filterClass:  '',    // e.g. 'G4 + F9 + HEPA H14'
  location:     '',    // physical location / plantroom description
  notes:        '',    // free-text engineering notes

  ...overrides,
});

// ── Initial state ─────────────────────────────────────────────────────────────
// Two default AHUs to match roomSlice initial room's assignedAhuIds: ['ahu1'].
const initialState = {
  list: [
    makeAhu('ahu1', 0, { name: 'AHU-01', type: 'Recirculating' }),
    makeAhu('ahu2', 1, { name: 'AHU-02', type: 'DOAS' }),
  ],
};

// ── Slice ─────────────────────────────────────────────────────────────────────
const ahuSlice = createSlice({
  name: 'ahu',
  initialState,

  reducers: {
    /**
     * addAHU
     * Adds a new recirculating AHU with a generated ID.
     * Payload optional — pass object overrides to pre-set type/name.
     */
    addAHU: (state, action) => {
      const overrides = action.payload ?? {};
      const id = `ahu_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      state.list.push(makeAhu(id, state.list.length, overrides));
    },

    /**
     * updateAHU
     * { id, field, value }
     * Supports any field in the AHU object — including 'type' which the logic layer reads.
     */
    updateAHU: (state, action) => {
      const { id, field, value } = action.payload;
      const ahu = state.list.find(a => a.id === id);
      if (ahu) ahu[field] = value;
    },

    /**
     * deleteAHU
     * ⚠️  DO NOT CALL FROM UI CODE DIRECTLY.
     *
     * BUG-SLICE-04 FIX: Use deleteAhuWithCleanup(ahuId) from roomActions.js instead.
     *
     * This reducer only removes the AHU from ahuSlice.list. It does NOT clear
     * room.assignedAhuIds references in roomSlice. Calling this directly leaves
     * every assigned room with a stale AHU ID, causing rdsSelector to silently
     * revert those rooms to Recirculating type with ahuId: '' and typeOfUnit: '-'.
     *
     * deleteAhuWithCleanup() thunk in roomActions.js:
     *   1. Clears all room.assignedAhuIds references via setRoomAhu({ ahuId: null })
     *   2. Then dispatches this reducer as the final step
     *
     * This reducer is exported for the thunk to dispatch. Not for direct UI use.
     */
    deleteAHU: (state, action) => {
      state.list = state.list.filter(a => a.id !== action.payload);
    },
  },
});

export const { addAHU, updateAHU, deleteAHU } = ahuSlice.actions;

export default ahuSlice.reducer;

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectAllAHUs = (state) => state.ahu.list;

export const selectAhuById = (state, id) =>
  state.ahu.list.find(a => a.id === id) ?? null;