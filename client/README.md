# HVAC Load Calculator — Complete Data Flow Analysis

---

## 1. Redux Store Architecture (`app/store.js`)

Six slices combined into one store:

```
state.project   → projectSlice
state.ahu       → ahuSlice
state.room      → roomSlice
state.climate   → climateSlice
state.envelope  → envelopeSlice
state.results   → resultsSlice  (empty reducer — only exports a selector)
```

---

## 2. Constants Layer

### `constants/ashrae.js`
Pure constants object. **Consumed by:**

| Consumer | Fields Used |
|---|---|
| `projectSlice.js` | `DEFAULT_SAFETY_FACTOR_PCT`, `DEFAULT_BYPASS_FACTOR`, `DEFAULT_ADP`, `DEFAULT_FAN_HEAT_PCT` → seeds `systemDesign` initialState |
| `resultsSlice.js` (selectSystemResults) | `PEOPLE_SENSIBLE_SEATED`, `PEOPLE_LATENT_SEATED`, `KW_TO_BTU`, `BTU_PER_WATT`, `SENSIBLE_FACTOR`, `LATENT_FACTOR`, `BTU_PER_TON`, `VENT_PEOPLE_CFM`, `VENT_AREA_CFM` |
| `rdsSelector.js` | `PEOPLE_SENSIBLE_SEATED`, `PEOPLE_LATENT_SEATED`, `KW_TO_BTU`, `BTU_PER_WATT`, `BTU_PER_TON`, `VENT_PEOPLE_CFM`, `VENT_AREA_CFM` |
| `hvacMath.js` | imported but this file appears legacy/unused by any current page |

---

### `constants/ashraeTables.js`
ASHRAE lookup tables + helpers. **Consumed by:**

| Consumer | Exports Used |
|---|---|
| `utils/envelopeCalc.js` | `WALL_CLTD`, `WALL_CLTD_SEASONAL`, `ROOF_CLTD`, `ROOF_CLTD_SEASONAL`, `GLASS_CLTD`, `SHGF`, `CLF`, `correctCLTD` |
| `features/envelope/BuildingShell.jsx` | `ORIENTATIONS`, `WALL_CONSTRUCTIONS`, `ROOF_CONSTRUCTIONS`, `SC_OPTIONS`, `U_VALUE_PRESETS`, `DEFAULT_ELEMENTS` |

---

## 3. Redux Slices — State Shape & Action/Selector Map

---

### `features/ahu/ahuSlice.js`

**State shape:**
```js
{
  list: [{ id, name, type }]
}
```

**Actions dispatched by:**

| Action | Dispatched From |
|---|---|
| `addAHU` | `AHUConfig.jsx`, `RDSPage.jsx` |
| `updateAHU({ id, field, value })` | `AHUConfig.jsx` |
| `deleteAHU(id)` | `AHUConfig.jsx` |

**Selectors consumed by:**

| Selector | Consumer |
|---|---|
| `selectAllAHUs` | `AHUConfig.jsx`, `RDSPage.jsx`, `ResultsPage.jsx`, `RoomConfig.jsx` |
| `state.ahu.list` (raw, in createSelector) | `rdsSelector.js` |

---

### `features/climate/climateSlice.js`

**State shape:**
```js
{
  outside: {
    summer:  { db, wb, rh, dp, gr, time, month },
    monsoon: { db, wb, rh, dp, gr, time, month },
    winter:  { db, wb, rh, dp, gr, time, month }
  }
}
```

**Actions dispatched by:**

| Action | Dispatched From |
|---|---|
| `updateOutsideCondition({ season, field, value })` | `ClimateConfig.jsx` |

**Selectors / raw state consumed by:**

| Consumer | How accessed |
|---|---|
| `ClimateConfig.jsx` | `selectClimate` selector |
| `EnvelopeConfig.jsx` | `state.climate` via `useSelector` |
| `BuildingShell.jsx` | `climate` prop passed from `EnvelopeConfig` |
| `envelopeCalc.js` | `climate.outside[season].db` — pure function arg |
| `rdsSelector.js` | `state.climate` — createSelector input |
| `resultsSlice.js` (selectSystemResults) | `state.climate` — createSelector input |

---

### `features/envelope/envelopeSlice.js`

**State shape:**
```js
{
  byRoomId: {
    [roomId]: {
      elements: {
        walls:      [{ id, label, orientation, construction, area, uValue, uPreset }],
        roofs:      [{ id, label, construction, area, uValue, uPreset }],
        glass:      [{ id, label, orientation, area, uValue, uPreset, sc, scPreset, roomMass }],
        skylights:  [{ id, label, area, uValue, uPreset, sc, scPreset, roomMass }],
        partitions: [{ id, label, area, uValue, uPreset, tAdj }],
        floors:     [{ id, label, area, uValue, uPreset, tAdj }]
      },
      internalLoads: {
        people:    { count, sensiblePerPerson, latentPerPerson },
        lights:    { wattsPerSqFt, useSchedule },
        equipment: { kw, sensiblePct, latentPct }
      },
      infiltration: {
        method, achValue, cfmValue,
        doors: []
      }
    }
  }
}
```

**Actions dispatched by:**

| Action | Dispatched From |
|---|---|
| `initializeRoom(roomId)` | `roomActions.js`, `EnvelopeConfig.jsx`, `RDSRow.jsx`, `RoomDetailPanel.jsx` |
| `addEnvelopeElement({ roomId, category, element })` | `BuildingShell.jsx` |
| `updateEnvelopeElement({ roomId, category, id, field, value })` | `BuildingShell.jsx` |
| `removeEnvelopeElement({ roomId, category, id })` | `BuildingShell.jsx` |
| `updateInternalLoad({ roomId, type, data })` | `EnvelopeConfig.jsx`, `RDSRow.jsx`, `RoomDetailPanel.jsx` |
| `updateInfiltration({ roomId, field, value })` | `EnvelopeConfig.jsx` |
| `removeRoomEnvelope(roomId)` | ⚠️ **Defined but never dispatched** — room deletion in `roomSlice` does NOT call this, causing a state leak |

**Selectors consumed by:**

| Selector | Consumer |
|---|---|
| `selectActiveEnvelope` (uses `state.room.activeRoomId` internally) | `EnvelopeConfig.jsx`, `resultsSlice.js` (selectSystemResults) |
| `state.envelope.byRoomId` (raw) | `rdsSelector.js`, `RDSPage.jsx` |

---

### `features/project/projectSlice.js`

**State shape:**
```js
{
  info:          { projectName, projectLocation, customerName, consultantName, industry, keyAccountManager },
  ambient:       { elevation, dryBulbTemp, wetBulbTemp, latitude, relativeHumidity },
  systemDesign:  { safetyFactor, bypassFactor, adp, fanHeat }
}
```

**Actions dispatched by:**

| Action | Dispatched From |
|---|---|
| `updateProjectInfo({ field, value })` | `ProjectDetails.jsx` |
| `updateAmbient({ field, value })` | `ProjectDetails.jsx` |
| `updateSystemDesign({ field, value })` | `ProjectDetails.jsx` |

**State consumed by:**

| Consumer | Fields Read |
|---|---|
| `ProjectDetails.jsx` | `state.project` (info, ambient, systemDesign) |
| `rdsSelector.js` (createSelector) | `state.project.systemDesign` → `safetyFactor`, `bypassFactor`, `adp`, `fanHeat` |
| `resultsSlice.js` (selectSystemResults) | `state.project.systemDesign` |
| `ResultsPage.jsx` | `state.project.systemDesign` (display only) |

---

### `features/room/roomSlice.js`

**State shape:**
```js
{
  activeRoomId: 'room_default_1',
  list: [{
    id, name, length, width, height,
    floorArea,    // auto-calculated: length × width
    volume,       // auto-calculated: floorArea × height
    designTemp, designRH, pressure,
    atRestClass, recOt, flpType,
    minAcph, designAcph,
    exhaustAir: { general, bibo, machine },
    supplyAir_Summer, supplyAir_Monsoon, supplyAir_Winter,
    returnAir_Summer, returnAir_Monsoon, returnAir_Winter,
    outsideAir_Summer, outsideAir_Monsoon, outsideAir_Winter,
    assignedAhuIds: [ahuId]
  }]
}
```

**Key logic in `updateRoom`:** dot-notation field paths (e.g. `"exhaustAir.general"`) resolved by `setNestedValue()`. Auto-recalculates `floorArea = length × width` and `volume = floorArea × height` when geometry fields change.

**Actions dispatched by:**

| Action | Dispatched From |
|---|---|
| `setActiveRoom(roomId)` | `RoomSidebar.jsx` |
| `addRoom()` | `roomActions.js` (thunk) |
| `updateRoom({ id, field, value })` | `RoomConfig.jsx`, `RDSRow.jsx`, `RoomDetailPanel.jsx` |
| `setRoomAhu({ roomId, ahuId })` | `RDSRow.jsx`, `RoomDetailPanel.jsx` |
| `toggleRoomAhu({ roomId, ahuId })` | `RoomConfig.jsx` |
| `deleteRoom(id)` | `RDSRow.jsx`, `RoomDetailPanel.jsx` |

**Selectors consumed by:**

| Selector | Consumer |
|---|---|
| `selectAllRooms` | `RoomSidebar.jsx`, `rdsSelector.js` (as `state.room.list`) |
| `selectActiveRoomId` | `RoomSidebar.jsx` |
| `selectActiveRoom` | `RoomConfig.jsx`, `EnvelopeConfig.jsx`, `resultsSlice.js` |
| `state.room.list` (raw in createSelector) | `rdsSelector.js` |
| `state.room.activeRoomId` (used inside `selectActiveEnvelope`) | indirectly via `envelopeSlice` selector |

---

### `features/results/resultsSlice.js`

**State:** empty `{}`. Reducer has no actions.

**Exports only `selectSystemResults`** — a memoized createSelector:

```
Inputs:
  state.project.systemDesign
  selectActiveEnvelope(state)   → envelope of currently active room
  state.climate
  selectActiveRoom(state)       → currently active room object

Output: {
  ersh, erlh, eshf, rise, dehCFM,
  tonnage, grandTotal, supplyAir, freshAir, designDB, systemDesign
}
```

**⚠️ Critical finding:** `selectSystemResults` is **defined but not imported by any current page component**. `ResultsPage.jsx` uses `selectRdsData` from `rdsSelector.js` instead. This selector is a dead export — either legacy or planned for a per-room results view.

---

## 4. Thunks

### `features/room/roomActions.js` — `addNewRoom()`

```
dispatch(addRoom())                          → roomSlice: pushes new room, sets activeRoomId
getState().room.activeRoomId                 → reads new ID
dispatch(initializeRoom(newRoomId))          → envelopeSlice: creates empty envelope for new room
```

**Dispatched from:** `RoomSidebar.jsx`, `RDSPage.jsx`

---

## 5. Utility Functions

### `utils/envelopeCalc.js`

Pure calculation functions — **no Redux**, receive data as arguments.

```
calcWallGain(wall, climate, tRoom, season)
  → reads: WALL_CLTD[orientation][construction], WALL_CLTD_SEASONAL[season], correctCLTD()
  → climate.outside[season].db used to compute tOutdoorMean
  → returns BTU/hr

calcRoofGain(roof, climate, tRoom, season)
  → reads: ROOF_CLTD[construction], ROOF_CLTD_SEASONAL[season], correctCLTD()
  → returns BTU/hr

calcGlassGain(glass, climate, tRoom, season)
  → conduction = U × area × correctedGlassCLTD  (GLASS_CLTD[season])
  → solar      = sc × SHGF[orientation][season] × area × CLF[orientation][roomMass]
  → returns { conduction, solar, total }

calcSkylightGain(skylight, climate, tRoom, season)
  → delegates to calcGlassGain with orientation forced to 'Horizontal'

calcPartitionGain(element, tRoom)
  → Q = U × area × (tAdj - tRoom)
  → returns BTU/hr (can be negative = heat loss)

calcTotalEnvelopeGain(elements, climate, tRoom, season)
  → aggregates all 6 categories
  → calls calcWallGain, calcRoofGain, calcGlassGain, calcSkylightGain, calcPartitionGain
  → returns total sensible BTU/hr
```

**Consumed by:**
- `features/envelope/BuildingShell.jsx` — real-time per-element preview
- `features/results/rdsSelector.js` — `calcTotalEnvelopeGain` for each room × season

---

### `utils/psychro.js` — `calculateGrains(dbF, rh)`

```
dbC = (dbF - 32) × 5/9
Es  = saturation pressure (Magnus formula)
E   = (rh/100) × Es
W   = 0.62198 × E / (Patm - E)   [kg water / kg dry air]
grains = W × 7000
```

**Consumed by:**
- `features/results/rdsSelector.js` — to compute indoor grains (`grIn`) from room `designTemp` + `designRH`
- `features/results/resultsSlice.js` (selectSystemResults)

---

### `utils/hvacMath.js` — `calculateRoomLoad()`

**⚠️ Legacy/dead code.** Performs similar calculations to `rdsSelector.js` but:
- Uses `infiltration.doors` array (envelopeSlice structure that is never populated by the UI)
- Uses `climate.inside` (a key that **does not exist** in climateSlice — only `climate.outside` exists)
- Not imported by any current page or selector

---

## 6. Components

---

### `components/Layout/Header.jsx`
**No Redux.** Static — renders app title + 4 ASHRAE standard badges.

---

### `components/Layout/TabNav.jsx`
**No Redux.** Static — renders 7 `<NavLink>` routes: `/project`, `/rds`, `/climate`, `/room`, `/envelope`, `/ahu`, `/results`.

---

### `components/Layout/RoomSidebar.jsx`

```
Reads:  selectAllRooms, selectActiveRoomId
Acts:   setActiveRoom(room.id)
        addNewRoom() [thunk → addRoom + initializeRoom]
Renders: vertical list of rooms. Highlights active room with blue border.
Used by: RoomConfig.jsx, EnvelopeConfig.jsx
```

---

### `components/UI/InputField.jsx`
**No Redux.** Controlled input wrapper. Receives `label, name, value, onChange, placeholder, type`.

---

### `components/UI/NumberControl.jsx`
**No Redux.** Increment/decrement + direct input. Receives `label, value, onChange, unit`.

---

## 7. Pages

---

### `pages/Home.jsx`
**No Redux.** Static landing page. Contains `<Link to="/project">`.

---

### `pages/ProjectDetails.jsx`

```
Reads:  state.project → { info, ambient, systemDesign }
Acts:   updateProjectInfo({ field, value })    → info fields
        updateAmbient({ field, value })         → ambient fields
        updateSystemDesign({ field, value })    → systemDesign fields

⚠️ systemDesign changes here cascade to:
   → rdsSelector (every room's supplyAir, coolingCapTR recalculates)
   → selectSystemResults (active room results recalculate)
   → ResultsPage KPI cards update
```

---

### `pages/AHUConfig.jsx`

```
Reads:  selectAllAHUs          → AHU list for sidebar
        selectRdsData          → pre-calculated room rows (supplyAir, coolingCapTR per room)

Acts:   addAHU()
        updateAHU({ id, field, value })
        deleteAHU(id)

Derived:
  selectedAhu = ahus.find(a => a.id === selectedAhuId)
  assignedRooms = rdsRows.filter(r => r.ahuId === selectedAhuId)
  totalCFM = sum of assignedRooms.supplyAir
  totalTR  = sum of assignedRooms.coolingCapTR
```

---

### `pages/ClimateConfig.jsx`

```
Reads:  selectClimate → state.climate.outside (3 seasons)
Acts:   updateOutsideCondition({ season, field, value })

String fields (time, month): value kept as string
Numeric fields (db, wb, rh, dp, gr): parsed with parseFloat

⚠️ Changes here cascade to ALL calculations:
   → envelopeCalc functions (db used for CLTD correction)
   → rdsSelector (outdoor db, gr for infiltration latent)
```

---

### `pages/RoomConfig.jsx`

```
Reads:  selectActiveRoom       → currently selected room
        selectAllAHUs          → for AHU assignment checkboxes

Acts:   updateRoom({ id, field, value })
          - 'name' → string (special case, not parseFloat)
          - geometry fields → triggers auto-recalc of floorArea/volume in reducer
        toggleRoomAhu({ roomId, ahuId })

Uses:   RoomSidebar (navigation)
        InputGroup (local helper)
        StatCard (local helper, shows computed floorArea/volume)
```

---

### `pages/EnvelopeConfig.jsx`

```
Reads:  selectActiveRoom       → room (for id, name, volume, designTemp)
        selectActiveEnvelope   → envelope.internalLoads, envelope.infiltration, envelope.elements
        state.climate          → passed as prop to BuildingShell

Acts:   initializeRoom(activeRoom.id)     [guard before any envelope mutation]
        updateInternalLoad({ roomId, type, data })
          - type: 'people' | 'lights' | 'equipment'
        updateInfiltration({ roomId, field:'achValue', value })

Children:
  RoomSidebar
  BuildingShell(roomId, elements, climate, tRoom)
    → tRoom = parseFloat(room.designTemp) || 72
```

---

### `pages/RDSPage.jsx`

```
Reads:  selectRdsData              → array of augmented room objects
        selectAllAHUs              → for RoomDetailPanel prop
        state.envelope.byRoomId    → raw envelopes for RoomDetailPanel prop

Acts:   addNewRoom() [thunk]
        addAHU()

Local state: selectedRoomId (null | roomId)

Derived:
  roomsByAhu = rdsRows grouped by ahuId (or 'unassigned')
  selectedRoomData = rdsRows.find(r => r.id === selectedRoomId)

Children:
  SummaryRow(roomData, ahus, onClick)  [local]
  RoomDetailPanel(room, envelope, ahus, onClose)
    → room = selectedRoomData (augmented with calcs from rdsSelector)
    → envelope = rawEnvelopes[selectedRoomId]

⚠️ RoomDetailPanel receives the rdsSelector-augmented row object as `room`
   (includes supplyAir, coolingCapTR etc.), but its mutations dispatch to
   roomSlice.updateRoom using the same id. This works because the augmented
   object retains all original room fields.
```

---

### `pages/ResultsPage.jsx`

```
Reads:  selectRdsData                 → all room rows with calculated loads
        selectAllAHUs                 → for system grouping
        state.project.systemDesign    → display-only in stats panel

Derived:
  totalArea  = sum of rdsRows.floorArea
  totalTR    = sum of parseFloat(rdsRows.coolingCapTR)
  totalCFM   = sum of rdsRows.supplyAir
  sqftPerTR  = totalArea / totalTR
  cfmPerSqft = totalCFM / totalArea

  systemSummary = ahus.map(ahu → {
    ...ahu,
    roomCount, totalTR, totalCFM, loadPct (% of project total)
  })
  + unassigned rooms appended if any

Export: JSON download of rdsRows + totals
```

---

## 8. RDS Subdirectory

### `pages/rds/RDSConfig.js`

**Central schema file** — no Redux. Exports:

```
RDS_SECTIONS   — 26 section configs, each with:
  { id, title, category, color, columns: [col, ...] }
  
  column shape:
  { key, label, subLabel, type, inputType, isEnv, envType, envField,
    derived, step, width, sticky, seasonLabel, options, color }

RDS_CATEGORIES — 4 tab configs: setup, loads, results, psychro

Helper functions:
  createSeasonColumns(keyPrefix, label, subLabel, opts)
    → 3 columns (summer/monsoon/winter) with seasonLabel set
  createSeasonPairs(keyPrefix, labelA, labelB, ...)
    → 6 columns (2 per season)
  createPsychroColumns(keyPrefix)
    → 12 columns (DB/WB/gr/Enthalpy × 3 seasons)
  createReturnAirColumns(keyPrefix)
    → 9 columns (DB/WB/gr × 3 seasons)

Utility functions (used by RDSRow + RoomDetailPanel):
  getFieldValue(col, room, envelope)
    → if col.isEnv: envelope.internalLoads[envType][envField]
    → if col.key contains '.': resolve dot-path on room
    → else: room[col.key]

  buildRoomUpdate(col, rawValue)
    → { field: col.key, value: (text ? rawValue : parseFloat) }
    → field uses dot-notation which roomSlice.updateRoom handles via setNestedValue()

Derived exports:
  RDS_COLUMNS_MAP  — flat lookup by key
  ENV_COLUMN_KEYS  — keys of isEnv columns
  getSectionsByCategory(category) — filter sections by category
```

---

### `pages/rds/RDSCellComponents.jsx`

**No Redux.** 6 pure presentational components:

| Component | Used By |
|---|---|
| `InputCell` | `RDSRow.jsx` |
| `SelectCell` | `RDSRow.jsx` |
| `FormInput` | `RoomDetailPanel.jsx` |
| `FormSelect` | `RoomDetailPanel.jsx` |
| `SeasonBadge` | `RoomDetailPanel.jsx` |

---

### `pages/rds/RDSRow.jsx`

```
Props: room, envelope, ahus, index

Reads:  getFieldValue(col, room, envelope)  [from RDSConfig]
        RDS_SECTIONS  [drives all columns — no hardcoded cells]

Acts:   handleRoomUpdate(col, rawValue)
          → buildRoomUpdate(col, rawValue)
          → dispatch(updateRoom({ id: room.id, field, value }))

        handleEnvUpdate(col, rawValue)
          → dispatch(initializeRoom(room.id))
          → dispatch(updateInternalLoad({ roomId, type: col.envType, data: { [col.envField]: val } }))

        AHU selector:
          → dispatch(setRoomAhu({ roomId: room.id, ahuId }))

        Delete:
          → dispatch(deleteRoom(room.id))

Renders: one <tr> with cells for every column in RDS_SECTIONS (data-driven)
```

---

### `pages/rds/RoomDetailPanel.jsx`

```
Props: room, envelope, ahus, onClose

Reads:  getFieldValue(col, room, envelope)  [same as RDSRow]
        RDS_SECTIONS, RDS_CATEGORIES  [drives all fields]

Acts:   handleRoomUpdate → dispatch(updateRoom)
        handleEnvUpdate  → dispatch(initializeRoom) + dispatch(updateInternalLoad)
        AHU selector     → dispatch(setRoomAhu)
        Delete           → dispatch(deleteRoom) + onClose()

Renders: slide-in panel with 4 tab categories
         Each tab shows sections → fields grouped by season via groupColumnsBySeason()
```

---

## 9. Feature Components

### `features/envelope/BuildingShell.jsx`

```
Props: roomId, elements, climate, tRoom

Local state: activeCategory ('walls' | 'roofs' | 'glass' | 'skylights' | 'partitions' | 'floors')

Acts:   addEnvelopeElement({ roomId, category, element: DEFAULT_ELEMENTS[category] })
        updateEnvelopeElement({ roomId, category, id, field, value })
        removeEnvelopeElement({ roomId, category, id })

Real-time preview (no Redux read — pure calc):
  WallRow      → calcWallGain(el, climate, tRoom, season)  × 3 seasons
  RoofRow      → calcRoofGain(el, climate, tRoom, season)  × 3 seasons
  GlassRow     → calcGlassGain / calcSkylightGain           × 3 seasons
  PartitionRow → calcPartitionGain(el, tRoom)               (season-independent)

SectionTotals → sums all elements in active category for each season

Dropdown presets:
  U-Value preset → sets uPreset + uValue from U_VALUE_PRESETS[category]
  SC preset      → sets scPreset + sc from SC_OPTIONS
```

---

## 10. The Central Calculation Pipeline: `features/results/rdsSelector.js`

This is the most critical data flow in the app. It is a memoized `createSelector` that recomputes whenever any of its 5 inputs change.

```
Input selectors:
  selectRooms       = state.room.list
  selectEnvelopes   = state.envelope.byRoomId
  selectAhus        = state.ahu.list
  selectClimate     = state.climate
  selectSystemDesign = state.project.systemDesign

For each room in rooms:
  envelope = envelopes[room.id] || null
  ahu      = ahus.find(a => room.assignedAhuIds[0] === a.id) || {}

  For each season in ['summer', 'monsoon', 'winter']:
    calculateSeasonLoad(room, envelope, climate, season, systemDesign):

      outdoor = climate.outside[season]
      dbOut   = outdoor.db
      grOut   = outdoor.gr || calculateGrains(dbOut, outdoor.wb)
      dbIn    = room.designTemp || 75
      rhIn    = room.designRH   || 50
      grIn    = calculateGrains(dbIn, rhIn)   ← psychro.js
      vol     = room.volume

      envelopeGain = calcTotalEnvelopeGain(envelope.elements, climate, dbIn, season)

      [Sensible loads]
      pplSens    = people.count × people.sensiblePerPerson (245)
      lightsSens = lights.wattsPerSqFt × floorArea × 3.412
      equipSens  = equipment.kw × 3412
      infilCFM   = (vol × infiltration.achValue) / 60
      infilSens  = 1.08 × infilCFM × (dbOut - dbIn)

      rawSensible = envelopeGain + pplSens + lightsSens + equipSens + infilSens

      [Latent loads]
      pplLat  = people.count × people.latentPerPerson (205)
      infilLat = 0.68 × infilCFM × (grOut - grIn)
      rawLatent = pplLat + infilLat

      safetyMult = 1 + systemDesign.safetyFactor / 100
      ersh = rawSensible × safetyMult
      erlh = rawLatent   × safetyMult

    ershOn_[season]  = ersh
    erlhOn_[season]  = erlh
    grains_[season]  = grIn
    ershOff_[season] = ersh − (equipSens × safetyMult)  [equip OFF scenario]

  [Supply Air — psychrometric formula]
  peakErsh = ershOn_summer
  bf       = systemDesign.bypassFactor
  adp      = systemDesign.adp
  supplyDT = (1 - bf) × (dbIn - adp)
  supplyAir = ceil(peakErsh / (1.08 × supplyDT))

  [Cooling Capacity]
  peakErlh    = erlhOn_summer
  fanHeatMult = 1 + systemDesign.fanHeat / 100
  grandTotal  = (peakErsh + peakErlh) × fanHeatMult
  coolingCapTR = (grandTotal / 12000).toFixed(2)

Output per room: {
  ...room,        ← all original room fields preserved
  ahuId, typeOfUnit,
  people_count, equipment_kw,
  supplyAir, coolingCapTR, grandTotal,
  ershOn_summer, ershOn_monsoon, ershOn_winter,
  erlhOn_summer, erlhOn_monsoon, erlhOn_winter,
  ershOff_summer, ershOff_monsoon, ershOff_winter,
  grains_summer, grains_monsoon, grains_winter,
  _raw: { room, envelope, ahu }
}
```

**Consumed by:** `AHUConfig.jsx`, `RDSPage.jsx`, `ResultsPage.jsx`

---

## 11. Full Dependency Graph (Text Representation)

```
main.jsx
  └── Provider(store) → App.jsx
        ├── Header (static)
        ├── TabNav (static, routes only)
        └── Routes:
              /project  → ProjectDetails
                            ↔ state.project (info, ambient, systemDesign)
              /ahu      → AHUConfig
                            ← state.ahu.list
                            ← selectRdsData [aggregated calcs]
              /climate  → ClimateConfig
                            ↔ state.climate.outside
              /room     → RoomConfig
                            ← selectActiveRoom
                            ← selectAllAHUs
                            → roomSlice.updateRoom
                            → roomSlice.toggleRoomAhu
                            └── RoomSidebar
                                  ← selectAllRooms, selectActiveRoomId
                                  → setActiveRoom, addNewRoom
              /envelope → EnvelopeConfig
                            ← selectActiveRoom
                            ← selectActiveEnvelope
                            ← state.climate
                            → envelopeSlice (updateInternalLoad, updateInfiltration)
                            └── RoomSidebar
                            └── BuildingShell
                                  ← (props: roomId, elements, climate, tRoom)
                                  ← ashraeTables (lookup tables)
                                  ← envelopeCalc (real-time BTU preview)
                                  → envelopeSlice (add/update/remove elements)
              /rds      → RDSPage
                            ← selectRdsData
                            ← selectAllAHUs
                            ← state.envelope.byRoomId
                            → addNewRoom (thunk), addAHU
                            └── RoomDetailPanel
                                  ← (props: room, envelope, ahus)
                                  ← RDSConfig (getFieldValue, RDS_SECTIONS)
                                  → roomSlice (updateRoom, setRoomAhu, deleteRoom)
                                  → envelopeSlice (updateInternalLoad, initializeRoom)
              /results  → ResultsPage
                            ← selectRdsData
                            ← selectAllAHUs
                            ← state.project.systemDesign

selectRdsData (rdsSelector.js)
  ← state.room.list
  ← state.envelope.byRoomId
  ← state.ahu.list
  ← state.climate
  ← state.project.systemDesign
  → calls calcTotalEnvelopeGain (envelopeCalc.js)
      → calls calcWallGain, calcRoofGain, calcGlassGain,
               calcSkylightGain, calcPartitionGain
              ← ashraeTables (WALL_CLTD, SHGF, CLF, etc.)
  → calls calculateGrains (psychro.js)
```

---

## 12. Known Issues & Inconsistencies

| # | Issue | Location | Impact |
|---|---|---|---|
| 1 | `removeRoomEnvelope` is **never dispatched** when a room is deleted | `roomSlice.deleteRoom` + `envelopeSlice` | Memory leak: orphaned envelope data remains in `byRoomId` after room deletion |
| 2 | `selectSystemResults` in `resultsSlice.js` is **never imported** by any page | `resultsSlice.js` | Dead code — a second parallel calculation engine that is unused |
| 3 | `hvacMath.js` references `climate.inside` which **does not exist** in climateSlice | `hvacMath.js` | Would return `undefined` — but file is not imported anywhere so no runtime error |
| 4 | `infiltration.doors` array is **never populated** by the UI | `EnvelopeConfig.jsx` | Infiltration latent in `resultsSlice.selectSystemResults` would always be 0; `rdsSelector` uses ACH method instead, bypassing `doors` entirely |
| 5 | `EnvelopeConfig.jsx` has **duplicate nested `<section>` for Building Shell** | `EnvelopeConfig.jsx` render | Creates double-rendered heading, placeholder button rendered outside BuildingShell |
| 6 | `RDSPage.jsx` passes the **rdsSelector-augmented row** (not raw room) as `room` prop to `RoomDetailPanel` | `RDSPage.jsx` | Panel works because original fields are spread in (`...room`), but computed fields like `supplyAir` also appear as editable fields if mapped in RDSConfig |
| 7 | `coolingCapTR` is returned as a **string** (`toFixed(2)`) from rdsSelector | `rdsSelector.js` | `ResultsPage.jsx` must call `parseFloat()` on it — it does, but `AHUConfig.jsx` also uses `parseFloat()`, which is correct |
| 8 | `ClimateConfig.jsx` has no inside/room condition inputs | `ClimateConfig.jsx` | Inside conditions (designTemp, designRH) are on `RoomConfig.jsx`, which is the correct design, but a comment in `ClimateConfig` implies they were moved there intentionally |

---

## 13. Data Flow Triggered by a Single User Action

**Example: User changes "Safety Factor" from 10% to 15% on ProjectDetails**

```
1. ProjectDetails.jsx handleSystemDesignChange('safetyFactor', 15)
2. dispatch(updateSystemDesign({ field: 'safetyFactor', value: 15 }))
3. projectSlice reducer: state.project.systemDesign.safetyFactor = 15
4. Redux notifies all subscribers of state change

Cascading re-renders:
  selectRdsData (memoized) detects state.project.systemDesign changed
    → Recomputes all rooms × all seasons
    → New safetyMult = 1.15 (was 1.10)
    → All ersh, erlh, supplyAir, coolingCapTR values update

  AHUConfig.jsx   → totalCFM, totalTR update
  RDSPage.jsx     → SummaryRow cards update (supplyAir, coolingCapTR)
  ResultsPage.jsx → KPI cards (totalTR, totalCFM, sqftPerTR) update
                  → System breakdown table percentages update
                  → "Design Parameters" panel shows new safetyFactor

  selectSystemResults (resultsSlice) also recomputes — but has no consumers
  ProjectDetails.jsx live preview updates:
    "Safety multiplier = 1.15×" (computed inline in JSX, not from Redux)
```

---

## 14. Data Flow for Adding a New Room

```
1. User clicks "+ Add Room" in RoomSidebar or RDSPage
2. dispatch(addNewRoom())  [thunk — roomActions.js]
3.   dispatch(addRoom())
       roomSlice: generateRoomId() → 'room_1234567890_abc'
       pushes default room object to state.room.list
       sets state.room.activeRoomId = newId
4.   getState().room.activeRoomId  → 'room_1234567890_abc'
5.   dispatch(initializeRoom('room_1234567890_abc'))
       envelopeSlice: if !byRoomId[roomId] → creates empty envelope structure

Result:
  state.room.list has +1 room
  state.envelope.byRoomId has +1 key
  RoomSidebar re-renders with new room highlighted
  selectRdsData recomputes — new room row appears with all zeros
```

---

## 15. Props Flow for BuildingShell (Envelope Editing)

```
EnvelopeConfig.jsx
  activeRoom  = useSelector(selectActiveRoom)       → room.designTemp used as tRoom
  envelope    = useSelector(selectActiveEnvelope)   → envelope.elements
  climate     = useSelector(state => state.climate)

  renders: <BuildingShell
    roomId   = {activeRoom.id}
    elements = {envelope.elements}
    climate  = {climate}
    tRoom    = {parseFloat(activeRoom.designTemp) || 72}
  />

BuildingShell.jsx
  On element BTU preview:
    calcWallGain(element, climate, tRoom, season)
      reads: climate.outside[season].db
      reads: ashraeTables.WALL_CLTD[orientation][construction]
      applies: ashraeTables.correctCLTD(base, tRoom, tOutdoorMean)
    → displayed as colored badge (red=gain, blue=loss)

  On "Add Wall" click:
    dispatch(addEnvelopeElement({ roomId, category:'walls', element: DEFAULT_ELEMENTS.walls }))
    → envelopeSlice pushes element with id=Date.now().toString()
    → envelope.elements.walls updates
    → selectActiveEnvelope returns new envelope
    → EnvelopeConfig re-renders → BuildingShell receives new elements prop
    → new row appears in table
```