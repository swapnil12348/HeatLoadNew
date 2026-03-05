# Codebase Modularization Plan

## Problem Diagnosis — What's Mixed Together Right Now

### Pages doing too much
| File | Lines | What doesn't belong there |
|---|---|---|
| `rdsSelector.js` | ~450 | 6 separate calculation concerns in one `createSelector` |
| `EnvelopeConfig.jsx` | ~300 | Activity level data, unit conversion, local business rules |
| `RDSPage.jsx` | ~220 | Group-by-AHU logic, reset logic |
| `AHUConfig.jsx` | ~230 | Totals aggregation, check figure thresholds |
| `ResultsPage.jsx` | ~290 | Check figure logic, export formatting |
| `RDSRow.jsx` | ~130 | Inline dispatch logic that duplicates RoomDetailPanel |
| `BuildingShell.jsx` | ~350 | Per-category calculation calls, season legend |

### Features that have no home
- Psychrometric state point assembly (lives inside rdsSelector — should be its own module)
- OA load calculation (missing entirely — needs a dedicated file)
- ACPH validation against ISO class (missing — needs a file)
- CHW/HW pipe sizing (missing — needs a file)
- Unit conversion helpers (scattered: cToF in rdsSelector, M2_TO_FT2 duplicated in 4 files)

---

## Target Directory Structure

```
src/
├── app/
│   └── store.js                          (unchanged)
│
├── assets/
│
├── components/
│   ├── Layout/
│   │   ├── Header.jsx                    (unchanged)
│   │   ├── TabNav.jsx                    (unchanged)
│   │   └── RoomSidebar.jsx               (unchanged)
│   └── UI/
│       ├── InputField.jsx                (unchanged)
│       ├── NumberControl.jsx             (unchanged)
│       ├── BtuBadge.jsx                  ← extracted from BuildingShell
│       ├── SeasonBadge.jsx               ← extracted from RDSCellComponents
│       └── GovernedBadge.jsx             ← extracted from AHUConfig + ResultsPage
│
├── constants/
│   ├── ashrae.js                         (unchanged — psychro + system constants)
│   ├── ashraeTables.js                   (unchanged — CLTD/CLF/SHGF tables)
│   ├── isoCleanroom.js                   ← NEW: ISO 14644 ACPH minimums, class options
│   └── ventilation.js                    ← NEW: ASHRAE 62.1 Rp/Ra by occupancy category
│
├── features/
│   ├── ahu/
│   │   └── ahuSlice.js                   (unchanged)
│   │
│   ├── climate/
│   │   └── climateSlice.js               (unchanged)
│   │
│   ├── envelope/
│   │   ├── envelopeSlice.js              (unchanged)
│   │   └── BuildingShell.jsx             (UI only — remove calc calls to utils)
│   │
│   ├── project/
│   │   └── projectSlice.js               (unchanged)
│   │
│   ├── results/
│   │   ├── rdsSelector.js                ← SPLIT into orchestrator only (~100 lines)
│   │   ├── seasonalLoads.js              ← NEW: calculateSeasonLoad()
│   │   ├── outdoorAirLoad.js             ← NEW: OA sensible + latent (C-1 fix)
│   │   ├── psychroStatePoints.js         ← NEW: all amb/fa/ra/sa/ma/coil state points
│   │   ├── airQuantities.js              ← NEW: supplyAir, freshAir, returnAir, exhaust
│   │   ├── heatingHumid.js               ← NEW: winter heating + humidification
│   │   └── pipeSizing.js                 ← NEW: CHW/HW GPM + manifold DN
│   │
│   └── room/
│       ├── roomSlice.js                  (unchanged)
│       └── roomActions.js                (unchanged)
│
├── hooks/                                ← NEW folder
│   ├── useActiveRoom.js                  ← NEW: useSelector(selectActiveRoom) + envelope
│   ├── useRdsRow.js                      ← NEW: single-room computed data for detail panel
│   └── useProjectTotals.js               ← NEW: aggregate TR, CFM, area across all rooms
│
├── pages/
│   ├── rds/
│   │   ├── RDSCellComponents.jsx         (unchanged)
│   │   ├── RDSConfig.js                  (fix fa25Acph key — trivial)
│   │   ├── RDSRow.jsx                    (slimmed — dispatch logic only)
│   │   └── RoomDetailPanel.jsx           (unchanged)
│   │
│   ├── AHUConfig.jsx                     (slim — move totals logic to useProjectTotals)
│   ├── ClimateConfig.jsx                 (unchanged — already clean)
│   ├── EnvelopeConfig.jsx                (slim — move ACTIVITY_LEVELS to constants)
│   ├── Home.jsx                          (unchanged)
│   ├── ProjectDetails.jsx                (unchanged)
│   ├── RDSPage.jsx                       (slim — move groupByAhu to hook)
│   ├── ResultsPage.jsx                   (slim — move check figure logic to hook)
│   └── RoomConfig.jsx                    (unchanged)
│
└── utils/
    ├── envelopeCalc.js                   (fix winter logic — C-2)
    ├── psychro.js                        (unchanged — already clean)
    ├── units.js                          ← NEW: all conversion helpers in one place
    └── isoValidation.js                  ← NEW: ISO class vs ACPH checks
```

---

## Split Plan for `rdsSelector.js` (Most Urgent)

The selector currently does 6 distinct jobs in ~450 lines. Each becomes its own file:

### `features/results/seasonalLoads.js`
**Responsibility:** Given one room + envelope + climate + settings → return ERSH, ERLH, grains, 
raw loads, infiltration CFM for one season.  
**Exports:** `calculateSeasonLoad(room, envelope, climate, season, params)`  
**Size target:** ~80 lines

### `features/results/outdoorAirLoad.js`  ← C-1 FIX LIVES HERE
**Responsibility:** Compute OA sensible + latent given CFM_OA, outdoor conditions, room conditions.  
**Exports:** `calculateOALoad(freshAirCFM, outdoor, room, altCf)`  
**Size target:** ~30 lines

### `features/results/airQuantities.js`
**Responsibility:** Determine supplyAir (thermal vs ACPH constraint), coilAir, bypassAir, freshAir 
variants, returnAir, exhaust totals.  
**Exports:** `calculateAirQuantities(room, envelope, peakErsh, systemDesign, altCf, ahuType)`  
**Size target:** ~70 lines

### `features/results/psychroStatePoints.js`
**Responsibility:** Compute all psychrometric state points (ambient, FA, RA, SA, MA, coil leaving) 
for all 3 seasons.  
**Exports:** `calculatePsychroPoints(room, climate, airQty, systemDesign, elevation)`  
**Size target:** ~80 lines

### `features/results/heatingHumid.js`  ← C-2, C-3 FIXES LIVE HERE
**Responsibility:** Winter heating capacity (U×A×ΔT, not CLTD). Winter humidification using 
freshAirCFM not supplyAir.  
**Exports:** `calculateHeatingHumid(room, envelope, climate, airQty, systemDesign, elevation)`  
**Size target:** ~60 lines

### `features/results/pipeSizing.js`  ← H-2 FIX LIVES HERE
**Responsibility:** CHW GPM, CHW manifold DN, HW GPM, HW manifold DN.  
**Exports:** `calculatePipeSizing(coolingTR, heatingKw, systemDesign)`  
**Size target:** ~40 lines

### `features/results/rdsSelector.js` (orchestrator — after split)
**Responsibility:** Import the 5 modules above. Call them in order. Assemble final room result object. 
Register `createSelector`.  
**Size target:** ~100 lines (down from ~450)

---

## New Constants Files

### `constants/isoCleanroom.js`
```js
// ISO 14644-1 minimum ACPH by class (range: [min, typical, max])
export const ISO_ACPH_REQUIREMENTS = {
  'ISO 5': { min: 240, typical: 300, max: 360 },
  'ISO 6': { min: 90,  typical: 150, max: 180 },
  'ISO 7': { min: 30,  typical: 45,  max: 60  },
  'ISO 8': { min: 10,  typical: 15,  max: 20  },
  'CNC':   { min: 6,   typical: 10,  max: 15  },
};

export const ISO_CLASS_OPTIONS = ['ISO 5', 'ISO 6', 'ISO 7', 'ISO 8', 'CNC', 'Unclassified'];
```

### `constants/ventilation.js`
```js
// ASHRAE 62.1-2019 Table 6-1 — Ventilation Rate Procedure
// Rp = per-person rate (cfm/person), Ra = area rate (cfm/ft²)
export const ASHRAE_621_RATES = {
  'Office / Admin':             { Rp: 5,   Ra: 0.06 },
  'Conference / Meeting':       { Rp: 5,   Ra: 0.06 },
  'Pharma Manufacturing':       { Rp: 5,   Ra: 0.18 },
  'Chemical / Bio Lab':         { Rp: 5,   Ra: 1.00 },
  'Electronic Manufacturing':   { Rp: 5,   Ra: 0.16 },
  'Warehouse / Storage':        { Rp: 5,   Ra: 0.06 },
  'Battery Manufacturing':      { Rp: 10,  Ra: 0.18 },
  'Cleanroom (ISO-governed)':   { Rp: 5,   Ra: 0.00 }, // ACPH governs, not 62.1
};
```

### `utils/units.js`
```js
// Centralise ALL conversions — replace inline duplicates in 4 files
export const M2_TO_FT2  = 10.7639;
export const M3_TO_FT3  = 35.3147;
export const KW_TO_BTU  = 3412;
export const BTU_PER_TON = 12000;

export const cToF  = (c) => parseFloat(c) * 9 / 5 + 32;
export const fToC  = (f) => (parseFloat(f) - 32) * 5 / 9;
export const m2ToFt2 = (m2) => parseFloat(m2) * M2_TO_FT2;
export const m3ToFt3 = (m3) => parseFloat(m3) * M3_TO_FT3;
export const kwToBtu = (kw) => parseFloat(kw) * KW_TO_BTU;
```

---

## New Hooks

### `hooks/useActiveRoom.js`
```js
// Replaces repeated selector pairs across EnvelopeConfig, RoomConfig, BuildingShell
export const useActiveRoom = () => {
  const room     = useSelector(selectActiveRoom);
  const envelope = useSelector(selectActiveEnvelope);
  const climate  = useSelector((s) => s.climate);
  const tRoomF   = room ? cToF(room.designTemp ?? 22) : 72;
  return { room, envelope, climate, tRoomF };
};
```

### `hooks/useProjectTotals.js`
```js
// Replaces inline reduce() calls duplicated across ResultsPage and AHUConfig
export const useProjectTotals = () => {
  const rows = useSelector(selectRdsData);
  const totalTR   = rows.reduce((s, r) => s + parseFloat(r.coolingCapTR || 0), 0);
  const totalCFM  = rows.reduce((s, r) => s + (r.supplyAir || 0), 0);
  const totalAreaM2 = rows.reduce((s, r) => s + parseFloat(r.floorArea || 0), 0);
  const totalAreaFt2 = totalAreaM2 * M2_TO_FT2;
  return { totalTR, totalCFM, totalAreaM2, totalAreaFt2, roomCount: rows.length };
};
```

---

## Extraction Candidates from Pages

| Thing | Currently in | Move to |
|---|---|---|
| `ACTIVITY_LEVELS` array | `EnvelopeConfig.jsx` | `constants/ashrae.js` |
| `getCheckFigureTip()` | `ResultsPage.jsx` | `utils/checkFigures.js` |
| `GovernedBadge` | `AHUConfig.jsx` AND `ResultsPage.jsx` (duplicated!) | `components/UI/GovernedBadge.jsx` |
| `groupByAhu` reduce | `RDSPage.jsx` | `hooks/useRoomGroups.js` |
| `altitudeCorrectionFactor()` | `rdsSelector.js` | `utils/units.js` or `utils/psychro.js` |
| `rhFromGrains()` | `rdsSelector.js` | `utils/psychro.js` |

---

## Migration Order (Least Risk First)

1. **utils/units.js** — pure functions, no Redux, zero risk. Delete inline duplicates.  
2. **constants/isoCleanroom.js + ventilation.js** — pure data, no risk.  
3. **components/UI/GovernedBadge.jsx** — remove duplicate from AHUConfig + ResultsPage.  
4. **hooks/useActiveRoom.js + useProjectTotals.js** — read-only selectors, no dispatch changes.  
5. **features/results/ split** — highest value, moderate risk. Do one module at a time,  
   keep rdsSelector as the glue layer throughout so tests/UI don't change.  
6. **EnvelopeConfig + ResultsPage + AHUConfig slim-down** — cosmetic cleanup after step 4–5.