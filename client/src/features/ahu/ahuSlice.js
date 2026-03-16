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
 *                  Default 'Recirculating' applied at read site.
 *                  Even an empty object or null AHU works for the logic layer.
 *
 *   rdsSelector reads:
 *     ahu.id      — echoed into each RDS row as ahuId
 *     ahu.type    — echoed as typeOfUnit
 *     ahu.adpMode — 'manual' | 'calculated', governs per-AHU ADP resolution
 *     ahu.adp     — per-AHU ADP override (°F); 0 = use project-level default
 *
 * ── ADDITIONAL FIELDS (for AHUConfig.jsx UI) ────────────────────────────────
 *
 *   These fields are used by AHUConfig page for equipment specification.
 *   They are present in the factory so the UI always has a bound value.
 *
 *   capacityTR         — cooling capacity in tons of refrigeration
 *   heatingCapKW       — heating coil capacity (kW)
 *   supplyFanCFM       — design supply air volume (CFM)
 *   returnFanCFM       — design return air volume (CFM)
 *   outerAirCFM        — outdoor air intake volume (CFM)
 *   bypassFactor       — per-AHU bypass factor override.
 *                        NOTE: bypassFactor per-AHU override is NOT yet wired
 *                        into rdsSelector — rdsSelector reads only
 *                        effectiveSystemDesign.bypassFactor (project-level).
 *                        Field is retained for future Sprint implementation.
 *   adp                — apparatus dew point override (°F); 0 = use project default.
 *                        WIRED: rdsSelector ADP-01 chain reads ahu.adp and ahu.adpMode.
 *   adpMode            — 'manual' | 'calculated'.
 *                        WIRED: rdsSelector ADP-01 chain reads this to select
 *                        between calculateAdpFromLoads() and manual override.
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
 *   Logic layer distinguishes DOAS vs non-DOAS only. The other type values
 *   are for equipment scheduling and spec documentation.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   BUG-SLICE-04 FIX — deleteAHU: guidance updated to require deleteAhuWithCleanup.
 *
 *     deleteAHU() (this reducer) only removes the AHU from ahuSlice.list.
 *     It does NOT clear room.assignedAhuIds references. After deletion,
 *     rdsSelector returns ahuId: '' and typeOfUnit: '-' for every affected
 *     room silently — reverting all those rooms to Recirculating type.
 *
 *     Fix: deleteAhuWithCleanup(ahuId) thunk in roomActions.js clears all
 *     room assignments BEFORE removing the AHU. All UI components that
 *     delete AHUs MUST call deleteAhuWithCleanup, never deleteAHU directly.
 */

import { createSlice } from '@reduxjs/toolkit';

// ── AHU factory ───────────────────────────────────────────────────────────────
const makeAhu = (id, index = 0, overrides = {}) => ({
  // ── Identity ──────────────────────────────────────────────────────────────
  id,
  name: `AHU-${String(index + 1).padStart(2, '0')}`,
  tag:  '',

  // ── Type — READ BY LOGIC LAYER ────────────────────────────────────────────
  type: 'Recirculating',

  // ── Capacity (UI / spec fields) ───────────────────────────────────────────
  capacityTR:   0,    // tons of refrigeration
  heatingCapKW: 0,    // kW

  // ── Airflow (UI / spec fields) ────────────────────────────────────────────
  supplyFanCFM: 0,    // CFM
  returnFanCFM: 0,    // CFM
  outerAirCFM:  0,    // CFM

  // ── Psychrometric overrides — READ BY rdsSelector (ADP-01 chain) ─────────
  // adpMode and adp are wired into rdsSelector ADP resolution.
  // bypassFactor per-AHU override is NOT yet wired — rdsSelector uses
  // effectiveSystemDesign.bypassFactor (project-level) only.
  bypassFactor: 0,           // 0 = use project default (not yet wired per-AHU)
  adpMode:      'manual',    // 'manual' | 'calculated' — wired to rdsSelector ADP-01
  adp:          0,           // °F — 0 = use project default; wired to rdsSelector ADP-01

  // ── Filter / location ─────────────────────────────────────────────────────
  filterClass: '',
  location:    '',
  notes:       '',

  ...overrides,
});

// ── Initial state ─────────────────────────────────────────────────────────────
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
     * Pass object overrides to pre-set type/name.
     */
    addAHU: (state, action) => {
      const overrides = action.payload ?? {};
      const id = `ahu_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      state.list.push(makeAhu(id, state.list.length, overrides));
    },

    /**
     * updateAHU
     * { id, field, value }
     * Supports any field in the AHU object including 'type' and 'adpMode'.
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
     * Use deleteAhuWithCleanup(ahuId) from roomActions.js instead.
     * This reducer only removes the AHU from ahuSlice.list — it does NOT
     * clear room.assignedAhuIds references in roomSlice, leaving every
     * assigned room with a stale AHU ID.
     *
     * deleteAhuWithCleanup() thunk:
     *   1. Clears all room.assignedAhuIds references via setRoomAhu({ ahuId: null })
     *   2. Then dispatches this reducer as the final step
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