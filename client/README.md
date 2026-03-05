# HVAC Heat Load Calculator — Full Codebase Audit
## Logical Errors, ASHRAE Violations & Data Flow Analysis

---

## DATA FLOW MAP (Global)

```
main.jsx
  └── Provider (Redux Store)
        └── App.jsx (BrowserRouter + Routes)
              ├── Home.jsx (standalone)
              └── AppLayout (Header + TabNav + Outlet)
                    ├── ProjectDetails.jsx  ──reads/writes──► projectSlice
                    ├── ClimateConfig.jsx   ──reads/writes──► climateSlice
                    ├── RoomConfig.jsx      ──reads/writes──► roomSlice + ahuSlice
                    ├── EnvelopeConfig.jsx  ──reads/writes──► envelopeSlice + roomSlice
                    │     └── BuildingShell.jsx ──────────────► envelopeSlice
                    ├── AHUConfig.jsx       ──reads/writes──► ahuSlice
                    │     └── selectRdsData (computed)
                    ├── RDSPage.jsx         ──reads──────────► selectRdsData (computed)
                    │     ├── RDSRow.jsx    ──reads/writes──► roomSlice + envelopeSlice
                    │     └── RoomDetailPanel.jsx ──────────► roomSlice + envelopeSlice
                    └── ResultsPage.jsx     ──reads──────────► selectRdsData (computed)

CALCULATION CHAIN:
  roomSlice (geometry, designTemp °C, designRH)
  + envelopeSlice (elements, internalLoads, infiltration)
  + climateSlice (outdoor DB°F, RH, gr/lb per season)
  + projectSlice (elevation ft, safetyFactor, BF, ADP, fanHeat)
  + ahuSlice (AHU type)
        ↓
  rdsSelector.js (createSelector → all computed outputs)
        ↓
  RDS table / AHUConfig / ResultsPage
```

---

# CRITICAL BUGS (Produce Wrong Numerical Results)

---

## BUG-01: Equipment Latent Load Completely Missing

**File:** `src/features/results/rdsSelector.js` — `calculateSeasonLoad()`

**Code:**
```js
const pplLat    = pplCount * (int.people?.latentPerPerson || ASHRAE.PEOPLE_LATENT_SEATED);
const infilLat  = Cl * infilCFM * (grOut - grIn);
const rawLatent = pplLat + infilLat;   // ← Equipment latent NEVER added
```

**What exists in `envelopeSlice.js`:**
```js
equipment: { kw: 0, sensiblePct: 100, latentPct: 0 }
```

`latentPct` is stored but **never read anywhere in the codebase**. Equipment latent is silently dropped.

**ASHRAE standard:** For pharmaceutical manufacturing, open-bath equipment, washers, autoclaves, and process equipment can produce substantial latent loads. ASHRAE Fundamentals Ch 18 requires:
```
Q_equip_latent = kW × 3412 × (latentPct / 100)
```

**Fix required in `calculateSeasonLoad()`:**
```js
const equipLatent = (parseFloat(int.equipment?.kw) || 0)
  * ASHRAE.KW_TO_BTU
  * ((parseFloat(int.equipment?.latentPct) || 0) / 100);
const rawLatent = pplLat + infilLat + equipLatent;
```

**Impact:** For pharma/battery manufacturing with process moisture, this can underestimate ERLH by 20–100%.

---

## BUG-02: Outdoor Grains Calculated at Sea Level, Indoor at Site Elevation — Inconsistent ΔGr

**File:** `src/features/climate/climateSlice.js` + `src/features/results/rdsSelector.js`

**Climate slice (pre-calculates gr at sea level):**
```js
const deriveFields = (db, rh) => ({
  gr: Math.round(calculateGrains(db, rh) * 10) / 10,  // ← NO elevation arg → sea level
});
```

**rdsSelector uses this sea-level value:**
```js
const grOut = parseFloat(outdoor.gr) || 100;           // sea-level gr
```

**But indoor grains are correctly at site elevation:**
```js
const grIn = calculateGrains(dbInF, rhIn, elevation);  // ← site elevation ✓
```

**The latent load uses this mismatched ΔGr:**
```js
const infilLat = Cl * infilCFM * (grOut - grIn);
```

**Psychrometric reality:** At 5000 ft elevation, the same 95°F / 40% RH outdoor air has ~25% more gr/lb than at sea level (because atmospheric pressure is lower). Sea-level grOut ≈ 78 gr/lb; altitude-corrected grOut ≈ 96 gr/lb. This UNDERESTIMATES latent infiltration load by ~23% at 5000 ft.

**Fix:** In `rdsSelector.js`, recalculate outdoor grains at site elevation:
```js
const ambRH  = parseFloat(outdoor.rh) || 0;
const grOut  = calculateGrains(dbOut, ambRH, elevation);   // use site elevation
```

Similarly in the psychro state points block:
```js
const ambGr = calculateGrains(ambDB, ambRH, elevation);   // not parseFloat(out.gr)
```

**Impact:** Any facility above 2000 ft sees underestimated latent loads. Semiconductor fabs (Arizona, Colorado, Korea highlands), pharma plants, and battery gigafactories are commonly sited at altitude.

---

## BUG-03: Minimum ACPH Requirement Never Enforced — Cleanroom Supply Air Undersized

**File:** `src/features/results/rdsSelector.js`

**What is calculated:**
```js
const supplyAir       = ceil(peakErsh / (Cs × supplyDT));    // heat-load CFM
const supplyAirMinAcph = round(volumeFt3 × minAcph / 60);    // ACPH-minimum CFM
```

**What is MISSING — these two are NEVER compared:**
```js
// CRITICAL: final supply air should be MAX(supplyAir, supplyAirMinAcph)
// This selection is never made.
```

**ASHRAE / ISO Cleanroom Standard:**
ISO 14644 and GMP Annex 1 require minimum air change rates that govern supply air volume independently of the thermal load:
- ISO 8: minimum ~20 ACPH
- ISO 7: minimum ~40–60 ACPH
- ISO 6: minimum ~100–150 ACPH
- ISO 5: minimum ~240–480 ACPH

In a small, well-insulated cleanroom, heat-load CFM is often far below the ACPH minimum. Using the thermal CFM alone would dramatically under-supply air, failing the cleanroom classification.

**Fix:**
```js
const supplyAir = Math.max(
  thermalCFM,           // heat load result
  supplyAirMinAcph,     // ACPH minimum
  // optionally: freshAir  (ventilation floor)
);
```

**Impact:** This is one of the most critical errors for pharmaceutical, semiconductor, and battery manufacturing applications — which is the stated target market.

---

## BUG-04: Area Units — m² Stored, Displayed and Calculated as ft²

**Files:** `ResultsPage.jsx`, `AHUConfig.jsx`

**roomSlice.js stores in m²:**
```js
length: 20, width: 15,          // metres
floorArea: 300,                  // m² (auto-calc: 20×15)
// subLabel in RDSConfig: 'm²'
```

**rdsSelector.js correctly converts for ASHRAE calcs:**
```js
const floorAreaFt2 = (parseFloat(room.floorArea) || 0) * M2_TO_FT2;
```

**But ResultsPage.jsx labels the m² value as ft²:**
```js
const totalArea = rdsRows.reduce((sum, r) => sum + (parseFloat(r.floorArea) || 0), 0);
// ...
<div>{totalArea.toLocaleString()} <span className="text-sm">ft²</span></div>
<div>{sqftPerTR} <span className="text-sm">ft²/TR</span></div>
```

`r.floorArea` is still in m² (not converted). The check figure `sqftPerTR` would read ~28 (m²/TR) but is labelled ft²/TR. A correct building would show ~300 ft²/TR ≈ 28 m²/TR — the numbers happen to look "in range" at 28 m²/TR but the unit label is completely wrong.

**AHUConfig.jsx has the same bug:**
```jsx
<th>Area (sqft)</th>          {/* header says sqft */}
<td>{room.floorArea}</td>     {/* value is m² */}
```

**Fix:** Either convert `r.floorArea` to ft² in the display components, or change the label to m².

---

## BUG-05: `dehumidifiedAir`, `bleedAir`, `freshAirAces`, Manifold Sizes, Pre-Cooling Fields — Defined as `readOnly derived` but Never Computed

**File:** `src/pages/rds/RDSConfig.js` vs `src/features/results/rdsSelector.js`

These columns are declared as `type: 'readOnly', derived: true` in `RDS_SECTIONS → acesSummary`:

| Column Key | Computed in rdsSelector? |
|---|---|
| `dehumidifiedAir` | ❌ Never |
| `freshAirAces` | ❌ Never |
| `bleedAir` | ❌ Never |
| `chwManifoldSize` | ❌ Never |
| `hwManifoldSize` | ❌ Never |
| `preCoolingAhuCap` | ❌ Never |
| `preCoolChwFlow` | ❌ Never |
| `preCoolChwManifold` | ❌ Never |
| `infilWithinSystem` | ❌ Never |
| `infilSystem` | ❌ Never |
| `infilOtherSystem` | ❌ Never |

All these columns will render as blank/undefined in the RDS table even though they appear as official output columns.

**Missing formulas (ASHRAE-based):**
```js
// Dehumidified air (air processed through coil, not bypassed)
dehumidifiedAir = coilAir;   // = supplyAir × (1 - BF)

// Bleed air (portion of return bled to exhaust to maintain room pressure)
bleedAir = Math.max(0, supplyAir - returnAir - freshAir);

// Manifold size: pipe sizing requires GPM and velocity — not pure ASHRAE,
// typically from schedule 40 pipe tables at 4 fps
```

---

## BUG-06: Lights `useSchedule` and Equipment `sensiblePct` / `latentPct` Never Read

**File:** `src/features/envelope/envelopeSlice.js` defines:
```js
lights:     { wattsPerSqFt: 0, useSchedule: 100 },
equipment:  { kw: 0, sensiblePct: 100, latentPct: 0 }
```

**File:** `src/features/results/rdsSelector.js` uses:
```js
const lightsSens = (parseFloat(int.lights?.wattsPerSqFt) || 0) * floorAreaFt2 * ASHRAE.BTU_PER_WATT;
// useSchedule is NEVER read → CLF always 1.0

const equipSens  = (parseFloat(int.equipment?.kw) || 0) * ASHRAE.KW_TO_BTU;
// sensiblePct is NEVER read → always 100% sensible
// latentPct   is NEVER read → always 0% latent (see BUG-01)
```

**Impact:** For 8-hour-per-day operations, lights CLF ≈ 0.55–0.70 at peak hour, not 1.0. The lighting load is overestimated by 30–45%. For process equipment that is only partially sensible (e.g., equipment with cooling water, open-basin processes), sensiblePct < 100 is required.

---

# HIGH-SEVERITY ASHRAE STANDARD VIOLATIONS

---

## BUG-07: CLTD Reference Latitude (40°N) vs SHGF Reference Latitude (32°N) — Systematic Mismatch

**File:** `src/constants/ashraeTables.js`

```js
// CLTD values — stated as 40°N latitude, July 15
export const WALL_CLTD = { N: { light: 12, medium: 9, heavy: 6 }, ... };

// SHGF values — stated as 32°N latitude
export const SHGF = { N: { summer: 20, monsoon: 18, winter: 10 }, ... };
```

Using CLTD (40°N) with SHGF (32°N) in the same calculation produces inconsistent results. At 32°N vs 40°N, wall CLTD values for east/west exposures can differ by 15–25% because peak solar exposure and sol-air temperatures are latitude-dependent.

For India (target market per code, ~10°N–35°N), both tables are mismatched. ASHRAE Fundamentals provides latitude correction factors for CLTD; they should be applied.

**Fix required:** Add latitude correction to CLTD:
```
CLTD_corrected_lat = CLTD_table × LM_factor
```
Where LM is the latitude-month correction from ASHRAE Table 1, Ch 28, interpolated from `project.ambient.latitude`.

---

## BUG-08: People Load Defaults Are Sedentary Office — Wrong for Cleanrooms

**File:** `src/constants/ashrae.js`
```js
PEOPLE_SENSIBLE_SEATED: 245,   // sedentary office
PEOPLE_LATENT_SEATED:   205,
```

**ASHRAE Fundamentals Table 1, Chapter 18 — Activity-Level Heat Gains:**

| Activity | Sensible (BTU/hr) | Latent (BTU/hr) |
|---|---|---|
| Seated, at rest | 245 | 205 |
| Light office work | 275 | 275 |
| Light bench work (lab) | 315 | 245 |
| Moderate work (walking) | 395 | 395 |
| Heavy work | 580 | 870 |

Cleanroom operators in pharmaceutical manufacturing perform light bench/standing work (**315/245**). Semiconductor fab operators doing wafer handling perform light-to-moderate work (**315–395 BTU/hr sensible**). Using 245/205 **underestimates people heat by 28–61%** for these applications.

There is currently no UI field to override these defaults (only `count` is editable in the RDS table).

---

## BUG-09: Diurnal Temperature Range Hardcoded — Incorrect CLTD Correction for Global Sites

**File:** `src/utils/envelopeCalc.js`
```js
const DIURNAL_HALF = { summer: 10, monsoon: 7, winter: 9 };

const getMeanOutdoorTemp = (dbOutdoor, season) =>
  dbOutdoor - (DIURNAL_HALF[season] ?? 10);
```

ASHRAE CLTD correction formula:
```
CLTD_corrected = CLTD_table + (78 − t_room) + (t_outdoor_mean − 85)
t_outdoor_mean = t_max − daily_range / 2
```

The daily temperature range is **location-specific** (ASHRAE Fundamentals, Chapter 14, Table 1):
- Coastal humid: 8–12°F range → half = 4–6°F
- Desert: 30–40°F range → half = 15–20°F
- Continental: 20–25°F range → half = 10–12.5°F

Using a fixed 10°F half-range for all summer climates gives incorrect `t_mean`. For a desert location like Riyadh (daily range ~30°F), the mean is actually 15°F below peak, not 10°F — the CLTD correction will be 5°F too high, inflating wall and roof loads by 5–15%.

**Fix:** Add a `dailyRange` field to `projectSlice.ambient` (or `climateSlice`) and use it in `getMeanOutdoorTemp`.

---

## BUG-10: Return Air Calculation Ignores Exhaust Air — Mass Balance Error

**File:** `src/features/results/rdsSelector.js`
```js
const returnAir = Math.max(0, supplyAir - freshAir);
```

**Correct HVAC mass balance for a cleanroom:**
```
Supply = Return + Exhaust (net)
Return = Supply - Exhaust_total - Net_leakage
```

`room.exhaustAir.general`, `room.exhaustAir.bibo`, `room.exhaustAir.machine` are stored in `roomSlice` but **never read** in `rdsSelector.js`.

For a pharmaceutical manufacturing room with 500 CFM BIBO exhaust and 200 CFM machine exhaust, the return air is overcalculated by 700 CFM, which would cause:
1. Wrong return air duct sizing
2. Wrong room pressurization calculation
3. Wrong supply/return CFM balance reported to client

**Fix:**
```js
const totalExhaust = (parseFloat(room.exhaustAir?.general) || 0)
  + (parseFloat(room.exhaustAir?.bibo) || 0)
  + (parseFloat(room.exhaustAir?.machine) || 0);
const returnAir = Math.max(0, supplyAir - freshAir - totalExhaust);
```

---

## BUG-11: `classInOp` (ISO Classification In-Operation) Not in Room State

**File:** `src/pages/rds/RDSConfig.js`
```js
{ key: 'classInOp', label: 'ISO Class', subLabel: 'In Operation', type: 'select', options: ISO_OPTIONS },
```

**File:** `src/features/room/roomSlice.js` — initial state only has:
```js
atRestClass: 'ISO 8',
// classInOp → DOES NOT EXIST in initial state
```

The "In Operation" ISO class is never initialized, meaning `getFieldValue()` returns `0` for it, which doesn't match any `ISO_OPTIONS` value and renders blank. For pharmaceutical GMP documentation, the "In Operation" classification is critical and distinct from "At Rest."

---

## BUG-12: Winter Humidification Load Not Tracked

**File:** `src/features/results/rdsSelector.js`

In winter, `grOut < grIn` for dry climates, so `infilLat = Cl × CFM × (grOut − grIn)` becomes **negative** — meaning infiltrating dry outdoor air removes moisture from the space. The space would need humidification, which is a heating-season load.

The current code:
- Computes `erlhOn_winter` which will be negative or near-zero
- Never calculates a humidification load (kW or lb/hr steam)
- Never sizes a humidifier

For cleanrooms in semiconductor fabs (RH ≥ 45%), pharma suites (RH 30–50%), and battery dry rooms (< 1% RH requiring molecular sieve dehumidification), winter humidification is often the dominant HVAC system driver. This is entirely absent.

---

## BUG-13: `roomNo` Not Initialized in Room State

**File:** `src/features/room/roomSlice.js`

The initial room (`room_default_1`) and every `addRoom()` call have no `roomNo` field. The RDS table and sidebar both reference `room.roomNo`:

```js
// RoomSidebar.jsx
<div>{room.roomNo || 'NO #'} • {room.floorArea} ft²</div>

// RDSConfig.js
{ key: 'roomNo', label: 'Room No.', inputType: 'text' },
```

Users can type a room number into the RDS cell (it gets stored via `updateRoom`), but it starts as `undefined`, not an empty string, which can cause subtle issues with controlled inputs.

---

# MEDIUM-SEVERITY ISSUES

---

## BUG-14: `supplyAir` Sized Off Safety-Factored ERSH — Double Penalizes Fan and ADP

**File:** `src/features/results/rdsSelector.js`
```js
const safetyMult  = 1 + (systemDesign.safetyFactor || 10) / 100;
const ersh        = Math.round(rawSensible * safetyMult);   // includes safety
// ...
const supplyAir   = Math.ceil(peakErsh / (Cs * supplyDT));  // peakErsh includes safety
```

Supply air CFM is sized against ERSH which already includes the safety factor. This means the system is sized for the "worst case" load, which is standard practice — no bug. However:

```js
const grandTotal = (peakErsh + peakErlh) * fanHeatMult;
```

Both `peakErsh` (safety-factored) and `peakErlh` (safety-factored) have the fan heat multiplier applied **on top**. The fan heat allowance should be calculated based on the un-safety-factored supply airflow and actual fan pressure, not as a percentage of the already-inflated ERSH+ERLH.

Using 1.10 safety factor × 1.05 fan heat = 1.155× total multiplier. The correct approach is:
```
Grand Total = (rawSensible + rawLatent + fanHeatBTU) × safetyMult
```
Not:
```
Grand Total = (rawSensible + rawLatent) × safetyMult × fanHeatMult
```

The order of operations matters when both multipliers are > 1.

---

## BUG-15: `achievedConditions` Fields Are Just the Design Setpoint — Not Computed

**File:** `src/features/results/rdsSelector.js`
```js
achFields[`achOn_temp_${s}`] = dbInF.toFixed(1);    // just design setpoint
achFields[`achOn_rh_${s}`]   = raRH.toFixed(1);      // just design setpoint
```

These fields are labelled "Achieved Room Conditions" but they simply return the design setpoint unconditionally. For a properly sized system this is technically valid (the system achieves its design point), but:

1. It's misleading — engineers expect these to reflect calculated leaving conditions
2. For off-season conditions (winter with equipment on), the achieved condition may differ from setpoint
3. The "after terminal heating" achieved conditions are identical to setpoint, which defeats the purpose of showing terminal heating at all

---

## BUG-16: Layout Containers Break Full-Height Pages

**File:** `src/App.jsx`
```jsx
const AppLayout = () => (
  <div className="min-h-screen bg-gray-50">
    <Header />        {/* ~64px height */}
    <TabNav />        {/* ~44px height */}
    <main className="container mx-auto px-4 py-6">   {/* ← py-6 = 24px top+bottom padding */}
      <Outlet />
    </main>
  </div>
);
```

These pages set their own viewport-height:
```jsx
// AHUConfig.jsx
<div className="flex h-[calc(100vh-64px)] bg-slate-50">

// EnvelopeConfig.jsx
<div className="flex h-[calc(100vh-64px)] bg-gray-50">

// RDSPage.jsx
<div className="flex h-[calc(100vh-64px)] bg-slate-50 relative overflow-hidden">
```

The `calc(100vh-64px)` only subtracts the header height, not the TabNav (~44px) or the container's `py-6` (24px). These pages will overflow their container by ~68px, causing scroll issues and misaligned sticky sidebars.

The calculation should be `calc(100vh-64px-44px)` = `calc(100vh-108px)` or the pages should use `flex-1 overflow-hidden` relative to the parent flex layout.

---

## BUG-17: `fa25Acph` Uses Volume in ft³ but Label Claims "2.5 ACPH"

**File:** `src/features/results/rdsSelector.js`
```js
const fa25Acph = Math.round(volumeFt3 * 2.5 / 60);
```

`volumeFt3 * 2.5 / 60` = CFM at 2.5 ACPH (air changes per hour of room volume). This is arithmetic for the **total supply air** at 2.5 ACPH, but it's used as a **fresh air** quantity:

```js
const optimisedFreshAir = Math.max(freshAir, fa25Acph);
```

For a 1000 m³ cleanroom (35,315 ft³) at 2.5 ACPH:
```
fa25Acph = 35,315 × 2.5 / 60 = 1,472 CFM
```

Calling this "fresh air at 2.5 ACPH" implies 2.5 room volume changes per hour of **outdoor air**, which would be extremely high for most classifications. The ASHRAE 62.1 minimum is typically 0.06 cfm/ft² + 5 cfm/person, not 2.5 ACPH of fresh air.

This number appears to be intended as a minimum **supply air** check (not fresh air), but is stored and displayed as a fresh air quantity, which is semantically incorrect.

---

## BUG-18: Stull (2011) WB Approximation — Adequate but Below Business SaaS Standard

**File:** `src/utils/psychro.js`
```js
export const calculateWetBulb = (dbF, rh) => {
  // Stull (2011) approximation — accuracy ±0.65°C
```

For psychrometric chart plotting and coil entering/leaving conditions, ±0.65°C (±1.17°F) error in WB propagates into enthalpy errors. ASHRAE coil selection is sensitive to entering WB. The exact iterative ASHRAE method (solve for WB where enthalpy of air at saturation equals the measured air enthalpy) is standard in commercial calculation software.

---

## BUG-19: `calculateGrains` Sea Level Used Inconsistently in Psychro State Points

**File:** `src/features/results/rdsSelector.js` — psychro block
```js
const ambGr = parseFloat(out.gr) || calculateGrains(ambDB, ambRH);
// ↑ out.gr is sea-level; fallback calculateGrains also sea-level
```

While `grADP` and `raGr` are altitude-corrected:
```js
const grADP = calculateGrains(adpF, 100, elevation);
const raGr  = calculateGrains(dbInF, raRH, elevation);
```

The ambient/fresh-air/mixed-air psychro state points use sea-level grains for the outdoor air. This creates an inconsistent psychrometric diagram at altitude — the outdoor state point will plot at the wrong humidity ratio.

---

## BUG-20: People Activity Level Cannot Be Changed From UI

**Files:** `envelopeSlice.js`, `RDSConfig.js`, `EnvelopeConfig.jsx`

The `sensiblePerPerson` and `latentPerPerson` fields exist in the Redux state but there is no UI control anywhere to change them. The only editable people field in the RDS table is `count`:

```js
{ key: 'people_count', label: 'Occupancy', isEnv: true, envType: 'people', envField: 'count' },
```

There is no `people_sensible` or `people_latent` column. Engineers cannot override the default 245/205 BTU/hr values for their specific activity level without editing source code.

---

## BUG-21: `erlhOn_winter` Can Be Negative — No Guard in Cooling Capacity

**File:** `src/features/results/rdsSelector.js`
```js
const peakErlh = results['erlhOn_summer'];
const grandTotal = (peakErsh + peakErlh) * fanHeatMult;
```

`peakErlh` is `erlhOn_summer` — this is correct (use summer for peak cooling sizing). However, in the seasonal loop, if winter `erlhOn_winter` is negative (dry outdoor air latent removal), it is never flagged and no humidification sizing is triggered. The code silently passes a negative ERLH to any consumer.

---

## BUG-22: `lightsSens` Uses Watts/ft² × ft² (ft² already converted from m²) — Correct but Undocumented

**File:** `src/features/results/rdsSelector.js`
```js
const lightsSens = (parseFloat(int.lights?.wattsPerSqFt) || 0)
  * floorAreaFt2                // ← ft² (correctly converted from m²)
  * ASHRAE.BTU_PER_WATT;
```

The units work out: W/ft² × ft² × BTU/W = BTU/hr ✓

However, the UI label in `EnvelopeConfig.jsx` says "W/ft²" for the lighting density input, and the RDS table shows no lighting column at all. If a user enters density in W/m² (thinking in SI), the result will be off by 10.76×. A unit clarification or SI/IP toggle would prevent this error.

---

# DATA FLOW INCONSISTENCIES

---

## FLOW-01: `designTemp` Mixed Units Throughout Pipeline

| Location | Unit | Value |
|---|---|---|
| `roomSlice.js` initial state | °C | 22 |
| `RDSConfig.js` subLabel | °C | display only |
| `rdsSelector.js` `dbInF` | °F | `cToF(room.designTemp)` |
| `EnvelopeConfig.jsx` display | °C + °F | both shown |
| `ProjectDetails.jsx` ambient | °C | separate field |
| `climateSlice.js` outdoor DB | °F | 95.7 |

The conversion `cToF()` is applied correctly in `rdsSelector.js`, but the inconsistency across files creates maintenance risk and confusion.

---

## FLOW-02: `roomSlice` Exhaust Fields — Stored, Displayed, Never Used in Calculations

`room.exhaustAir.general/bibo/machine` are:
- ✅ Initialized in `roomSlice.js`
- ✅ Editable in RDS table (`RDSConfig.js` exhaust section)
- ✅ Handled by `updateRoom()` via dot-notation path
- ❌ **Never read by `rdsSelector.js`**
- ❌ **Never subtracted from return air**
- ❌ **Never summed for total exhaust in AHU capacity sizing**

---

## FLOW-03: `ahuSlice.type` ('DOAS', 'Recirculating', 'FCU') — Stored, Never Affects Calculation

**AHUConfig.jsx** allows selecting system type. **`rdsSelector.js`** retrieves:
```js
const ahu = ahus.find(a => a.id === room.assignedAhuIds?.[0]) || {};
// ...
typeOfUnit: ahu.type || '-',
```

But `ahu.type` is only displayed; it never changes how supply air, fresh air, or coil loads are calculated. A DOAS system (100% outside air) should set `freshAir = supplyAir`. An FCU has different bypass and coil model. This differentiation is absent.

---

## FLOW-04: `volFaPct` Column in RDS — No Formula

**`RDSConfig.js`:**
```js
{ key: 'volFaPct', label: 'Room wise Vol. %age', subLabel: 'FA Opt', step: 0.01 },
```

This appears to represent each room's volume as a percentage of the total project volume (for fresh air optimization). However:
1. It's not `readOnly`, implying manual entry
2. There's no computed field for it in `rdsSelector.js`
3. It's never used in any calculation

---

## FLOW-05: `RoomDetailPanel` `deleteRoom` vs `deleteRoomWithCleanup`

**RoomDetailPanel.jsx footer:**
```js
dispatch(deleteRoom(room.id));  // ← uses roomSlice directly
```

**RDSRow.jsx:**
```js
dispatch(deleteRoomWithCleanup(room.id));  // ← uses thunk, also cleans envelope
```

Deleting from `RoomDetailPanel` does **not** clean up `envelopeSlice.byRoomId[roomId]`. The envelope data for deleted rooms accumulates in Redux state indefinitely, which leaks memory in long sessions and could cause stale data issues.

**Fix:** Replace in `RoomDetailPanel.jsx`:
```js
dispatch(deleteRoomWithCleanup(room.id));
```

---

## FLOW-06: `addNewRoom` Sets `activeRoomId` Before Dispatch Returns

**File:** `src/features/room/roomActions.js`
```js
export const addNewRoom = () => (dispatch, getState) => {
  dispatch(addRoomAction());
  const state  = getState();
  const newRoomId = state.room.activeRoomId;    // ← reads activeRoomId AFTER addRoom
  dispatch(initializeRoom(newRoomId));
};
```

`addRoom` reducer sets `state.activeRoomId = newId` synchronously before returning. `getState()` after the dispatch returns the updated state, so `state.room.activeRoomId` correctly holds the new room's ID. This works, but it's a fragile pattern — if `addRoom` is ever refactored to not set `activeRoomId`, the envelope won't be initialized for the new room.

**Better pattern:**
```js
export const addNewRoom = () => (dispatch) => {
  const newId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  dispatch(addRoomAction(newId));   // pass explicit ID
  dispatch(initializeRoom(newId));
};
```

---

# MINOR / COSMETIC

---

## MINOR-01: `hvacMath.js` Deprecated but Still in Bundle

`src/utils/hvacMath.js` contains only a comment saying it's deprecated but the file still ships. Remove it to avoid confusion.

---

## MINOR-02: `resultsSlice.js` Is Empty — Remove or Document

```js
const resultsSlice = createSlice({ name: 'results', initialState: {}, reducers: {} });
```

This adds a `results` key to the Redux store with no purpose. Either remove it and clean up `store.js`, or document why it's reserved.

---

## MINOR-03: `TabNav.jsx` Tab Order Comment vs Actual Array Order

```js
const tabs = [
  // 1. RDS is now the FIRST tab as requested
  // 2. Project & Climate follow
  { id: 'project', label: 'Project Info', path: '/project' },   // ← actually first
  { id: 'rds',     label: 'RDS Input (Master)', path: '/rds' }, // ← actually second
```

The comment says RDS should be first but `project` comes first in the array. The RDS route is second. This is a minor discrepancy between comment intent and code reality.

---

## MINOR-04: `NumberControl.jsx` Decrement Can Produce Negative Values for Physical Quantities

```js
const handleDecrement = () => onChange(safeVal(value) - 1);
```

No floor clamping. Clicking decrement on `safetyFactor = 0` gives `-1`, which would invert the safety factor (multiplier < 1.0, meaning loads are artificially reduced). Add `Math.max(0, ...)` guards for non-negative quantities like elevation, RH, ADP, floor area.

---

# PRIORITY FIX ROADMAP

| Priority | Bug ID | Description |
|---|---|---|
| P0 (Blocks accuracy) | BUG-03 | Minimum ACPH never enforced — cleanrooms undersized |
| P0 | BUG-01 | Equipment latent missing from ERLH |
| P0 | BUG-05 | ~11 derived columns always blank |
| P1 | BUG-02 | Outdoor gr at sea level vs indoor at elevation |
| P1 | BUG-04 | m² displayed as ft² — wrong unit labels |
| P1 | BUG-10 | Exhaust air ignored in return/supply balance |
| P1 | BUG-06 | sensiblePct, latentPct, useSchedule never read |
| P1 | BUG-07 | CLTD 40°N vs SHGF 32°N latitude mismatch |
| P2 | BUG-08 | People load uses office values for cleanroom operators |
| P2 | BUG-09 | Diurnal range hardcoded |
| P2 | BUG-12 | No winter humidification load |
| P2 | BUG-11 | classInOp missing from room state |
| P3 | BUG-14 | Safety factor × fan heat multiplier order |
| P3 | FLOW-05 | RoomDetailPanel delete leaks envelope state |
| P3 | BUG-16 | Layout height miscalculation in full-page views |
| P4 | BUG-20 | No UI to change people activity level |
| P4 | BUG-19 | Psychro outdoor grains inconsistent at altitude |
| P4 | FLOW-03 | AHU type (DOAS vs recirculating) never affects calc |

---

*Audit covers: store.js, all slices, all pages, all utils, all constants, all components.*
*Reference standard: ASHRAE Handbook — Fundamentals 2021, ASHRAE 62.1-2019, ISO 14644.*