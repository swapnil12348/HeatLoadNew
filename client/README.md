# ASHRAE Heat Load Calculation — Full Codebase Audit Report

**Scope:** Complete logical, data-flow, and ASHRAE-compliance review across all source files  
**Standard references:** ASHRAE Fundamentals 2021 Ch 1, 18, 27–28 · ASHRAE 62.1-2019 · ISO 14644  
**Target applications:** Pharma, Semiconductor Fab, Solar, Battery Manufacturing  

---

## Severity Legend

| Level | Meaning |
|---|---|
| 🔴 CRITICAL | Wrong physics / formula — will produce incorrect sizing, potentially dangerous |
| 🟠 HIGH | Significant accuracy error — affects coil, heater, or humidifier sizing |
| 🟡 MEDIUM | Methodology deviation or missing ASHRAE step — reduces confidence in outputs |
| 🔵 LOW | Code defect, dead code, or confusing naming — does not affect numbers directly |

---

# 🔴 CRITICAL BUGS

---

## C-1 · Outdoor Air Conditioning Load Completely Missing from Cooling Capacity

**Files:** `rdsSelector.js` — `calculateSeasonLoad()` and main selector  
**Impact:** Cooling coil sized 30–600% too small, depending on OA fraction and climate

### What the code does
```js
// calculateSeasonLoad — rawSensible only contains room-side loads:
const rawSensible = envelopeGain + pplSens + lightsSens + equipSens + infilSens;
const rawLatent   = pplLat + infilLat + equipLatent;
// …
const grandTotal  = (peakErsh + peakErlh) + fanHeatBTU;
const coolingCapTR = (grandTotal / ASHRAE.BTU_PER_TON).toFixed(2);
```

### What ASHRAE requires
The cooling coil must condition the **mixed air stream** (return air blended with outdoor fresh air) down to supply conditions. The outdoor air loads are:

```
OA_Sensible = 1.08 × CFM_OA × (T_outdoor − T_room)   [BTU/hr]
OA_Latent   = 0.68 × CFM_OA × (Gr_outdoor − Gr_room) [BTU/hr]
Coil Total  = RSH + RLH + OA_Sensible + OA_Latent + Fan Heat
```

For ASHRAE ERSH/ERLH methodology the bypass fraction of OA must be included:
```
ERSH = RSH + BF × OA_Sensible
ERLH = RLH + BF × OA_Latent
Grand Total Heat (GTH) = RSH + RLH + OA_Sensible + OA_Latent
```

### Worked example — DOAS pharma cleanroom (Delhi summer)
| Parameter | Value |
|---|---|
| Room ERSH | 5,000 BTU/hr |
| Fresh air (DOAS = 100% OA) | 500 CFM |
| Outdoor DB / Gr | 95.7 °F / 101 gr/lb |
| Indoor DB / Gr | 72 °F / 65 gr/lb |
| **OA Sensible** | 1.08 × 500 × (95.7 − 72) = **12,798 BTU/hr** |
| **OA Latent** | 0.68 × 500 × (101 − 65) = **12,240 BTU/hr** |
| **Current code total** | 5,000 / 12,000 = **0.42 TR** |
| **Correct total** | (5,000 + 12,798 + 12,240) / 12,000 = **2.50 TR** |
| **Error** | **6× undersize** |

For recirculating systems with 20 % OA the error is still 35–50 % depending on outdoor conditions. All pharma, semiconductor, and battery rooms with positive pressurization and DOAS AHUs are affected.

### Fix — add to rdsSelector main selector after seasonal loop
```js
// Outdoor air conditioning load (added to peakErsh/peakErlh for coil sizing)
const summerOut    = climate.outside.summer;
const oaDB         = parseFloat(summerOut.db) || 95;
const oaRH         = parseFloat(summerOut.rh) || 40;
const oaGr         = calculateGrains(oaDB, oaRH, elevation);
const oaSens       = Cs * freshAirCheck * (oaDB - summerCalcs.dbInF);
const oaLat        = Cl * freshAirCheck * (oaGr - summerCalcs.grIn);
const coilSensible = peakErsh + Math.max(0, oaSens);
const coilLatent   = peakErlh + Math.max(0, oaLat);
const grandTotal   = (coilSensible + coilLatent) + fanHeatBTU;
const coolingCapTR = (grandTotal / ASHRAE.BTU_PER_TON).toFixed(2);
```

---

## C-2 · Winter Heating Load Uses CLTD (Cooling) Method — Wrong Physics

**Files:** `envelopeCalc.js` — `calcWallGain`, `calcRoofGain`, `calcGlassGain`  
**Files:** `ashraeTables.js` — `WALL_CLTD_SEASONAL.winter = 0.40`, `ROOF_CLTD_SEASONAL.winter = 0.30`  
**Impact:** Winter heating capacity 30–80 % different from correct value depending on wall type

### What the code does
```js
// calcWallGain:
const seasonMult   = WALL_CLTD_SEASONAL[season] ?? 1.0;  // winter → 0.40
const correctedCLTD = correctCLTD(baseCLTD * seasonMult, tRoom, tMeanOutdoor);
// For winter: CLTD × 0.40 + (78 − tRoom) + (tMean − 85)
```

### What ASHRAE requires
CLTD is a solar-driven **cooling** load method. For winter heat loss the correct formula is straightforward conduction:
```
Q_heating = U × A × (T_indoor − T_outdoor)   [always negative = heat loss out]
```

### Worked example — N-facing medium-weight wall, Delhi winter (45 °F outdoor, 72 °F indoor)
```
CLTD method (current code):
  = 9 × 0.40 + (78 − 72) + (45 − 10/2 − 85)    [dailyRange default 20 °F]
  = 3.6 + 6 − 50 = −40.4 °F effective CLTD
  → Q = 0.48 × 100 × (−40.4) = −1,939 BTU/hr

Correct ΔT method:
  → Q = 0.48 × 100 × (45 − 72) = −1,296 BTU/hr

Overestimate: 50 % — over-sizes terminal heaters and HW coils
```

### Fix — add a separate heating-load branch in envelopeCalc.js
```js
export const calcWallGain = (wall, climate, tRoom, season, lat, dailyRange) => {
  if (season === 'winter') {
    // Pure conduction — no solar, no CLTD
    const dbOut = parseFloat(climate?.outside?.winter?.db) || 45;
    return (parseFloat(wall.uValue) || 0) * (parseFloat(wall.area) || 0) * (dbOut - tRoom);
  }
  // … existing CLTD code for summer/monsoon …
};
```
Apply the same change to `calcRoofGain` and the conduction term in `calcGlassGain`.

---

## C-3 · Humidification Load Uses Total Supply Air Instead of Fresh Air CFM

**Files:** `rdsSelector.js` — humidification block  
**Impact:** Humidification capacity overstated by ratio of supply air to fresh air (up to 10–20×)

### What the code does
```js
const humidLoadBTU  = supplyAir > 0
  ? Math.round(Cl * supplyAir * humidDeltaGr) : 0;
const humidLbsPerHr = ((supplyAir * humidDeltaGr) / 7000).toFixed(2);
```

### What ASHRAE requires
In a recirculating AHU the return air is already at room conditions (humidGrTarget). Only the **fresh air portion** arrives with a moisture deficit relative to the room setpoint. The moisture that must be added is:

```
Moisture deficit = freshAirCFM × (humidGrTarget − winterGrOut) / 7000   [lbs/hr]
```
Using `supplyAir` (e.g. 1,000 CFM) instead of `freshAirCheck` (e.g. 100 CFM for 10 % OA) overstates the steam humidifier by 10×.

### Example — recirculating cleanroom, 10 % OA
| | Code (wrong) | Correct |
|---|---|---|
| CFM used | 1,000 (supply) | 100 (fresh air) |
| lbs/hr steam | 2.14 | 0.21 |
| Humidifier kW | 1.36 | 0.13 |

This causes severe capital and operating cost overestimation for pharma and semiconductor humidification systems.

### Fix
```js
// Use fresh air CFM, not supply air
const humidCFM      = freshAirCheck;
const humidLbsPerHr = humidCFM > 0
  ? ((humidCFM * humidDeltaGr) / 7000).toFixed(2) : '0.00';
const humidKw       = (parseFloat(humidLbsPerHr) * 0.634).toFixed(2);
const humidLoadBTU  = humidCFM > 0
  ? Math.round(Cl * humidCFM * humidDeltaGr) : 0;
```

---

## C-4 · `fa25Acph` Key Mismatch — RDS Column Always Shows 0

**Files:** `pages/rds/RDSConfig.js` (line with key `fa25Acph`) vs `rdsSelector.js` (outputs `minSupplyAcph`)  
**Impact:** "Fresh Air @ 2.5 ACPH" column is always blank/0 in the RDS table — broken data binding

### Root cause
BUG-17 correctly renamed the selector output from `fa25Acph` to `minSupplyAcph` but the RDSConfig column key was never updated:

```js
// RDSConfig.js — WRONG key:
{ key: 'fa25Acph', label: 'Fresh Air @ 2.5 ACPH', subLabel: 'CFM', type: 'readOnly', derived: true }

// rdsSelector.js — what is actually output:
const minSupplyAcph = Math.round(volumeFt3 * 2.5 / 60);
return { …, minSupplyAcph, … };  // fa25Acph never output
```

`getFieldValue(col, room)` returns `room['fa25Acph'] ?? 0` → always 0.

### Fix
```js
// RDSConfig.js:
{ key: 'minSupplyAcph', label: 'Supply Air @ 2.5 ACPH Min', subLabel: 'CFM', type: 'readOnly', derived: true }
```

---

# 🟠 HIGH SEVERITY BUGS

---

## H-1 · ERSH / ERLH Definitions Non-Standard — OA Bypass Fraction Missing

**File:** `rdsSelector.js` — `calculateSeasonLoad()`  
**Impact:** Supply air CFM undersized; humidity control verification incorrect

ASHRAE Fundamentals defines:
```
ERSH = RSH + (BF × OASH)      ← bypass fraction of OA sensible
ERLH = RLH + (BF × OALH)      ← bypass fraction of OA latent
```

The code sets `ersh = rawSensible × safetyMult` with no OA bypass contribution. For a room with 20 % OA at 95.7 °F outdoor:
```
BF × OASH = 0.10 × [1.08 × 200 CFM × (95.7 − 72)] = 513 BTU/hr added to ERSH
```
Omitting this term causes `thermalCFM` to be slightly undersized and, more importantly, makes the ERSH label misleading versus ASHRAE documentation.

---

## H-2 · Multiple RDS Columns Defined but Never Calculated

**File:** `pages/rds/RDSConfig.js` vs `rdsSelector.js`  
**Impact:** These columns always display 0/blank regardless of inputs

| Column key | Label | Status |
|---|---|---|
| `chwManifoldSize` | CHW Manifold Size (mm) | Never calculated |
| `hwManifoldSize` | HW Manifold Size (mm) | Never calculated |
| `preCoolingAhuCap` | Pre-Cooling AHU Capacity (CFM) | Never calculated |
| `preCoolChwFlow` | Pre-Cooling Coil CHW Flow (USGPM) | Never calculated |
| `preCoolChwManifold` | Pre-Cooling Coil CHW Manifold (mm) | Never calculated |

These appear in client reports as blank, which is misleading in a business-level SaaS context. Either implement the calculation or remove the columns.

**Pipe sizing formula for reference:**
```js
// CHW manifold size — velocity method (ASHRAE HVAC Systems 2.5 m/s max):
// GPM = coolingCapTR × 12000 / (500 × ΔT)   [ΔT = 10°F standard]
// Pipe area = GPM / (v_ft_min × 7.48 gal/ft³)  → nominal DN from table
```

---

## H-3 · ASHRAE 62.1 Ventilation Rates Are Office Defaults — Wrong for Industrial Spaces

**File:** `constants/ashrae.js`  
**Impact:** Fresh air undersized or oversized for pharma/semiconductor/battery spaces

```js
VENT_PEOPLE_CFM: 5,    // Rp — ASHRAE 62.1 Table 6-1, "Office Space"
VENT_AREA_CFM:   0.06, // Ra — ASHRAE 62.1 Table 6-1, "Office Space"
```

ASHRAE 62.1-2019 Table 6-1 correct values by occupancy category:

| Space type | Rp (cfm/person) | Ra (cfm/ft²) |
|---|---|---|
| Office / admin | 5 | 0.06 |
| Pharma manufacturing | 5 | 0.18 |
| Chemical labs | 5 | 1.00 |
| Electronic equipment | 5 | 0.16 |
| Clean rooms (ISO) | Per ISO 14644 ACPH | — |

For semiconductor fabs, the fresh air calculation using `Ra=0.06` will understate the area-based OA component by 2.7×. Since cleanroom supply air is ACPH-governed anyway, the minimum ACPH floor catches this in most cases, but the `freshAir` calculation and the 62.1 compliance documentation will be wrong.

**Fix:** Either make `VENT_PEOPLE_CFM` and `VENT_AREA_CFM` per-room configurable fields, or add an occupancy category lookup table keyed to `room.industry` or `room.classInOp`.

---

## H-4 · Default Room Height 10 m Creates Unrealistic Volume and Infiltration

**File:** `features/room/roomSlice.js` — `addRoom` reducer and default room  
**Impact:** Default infiltration ~294 CFM instead of ~30 CFM; all volume-based calcs wrong

```js
length: 10, width: 10, height: 10,
volume: 1000,   // m³ — 10m ceiling is a warehouse, not a cleanroom
```

For a 100 m² cleanroom with 10 m height and 0.5 ACH infiltration:
```
volumeFt3 = 1000 × 35.31 = 35,314 ft³
infilCFM  = 35,314 × 0.5 / 60 = 294 CFM (enormous infiltration load)
```

The correct ceiling heights for industry:
- Pharma cleanroom: 3.0–3.5 m
- Semiconductor fab: 3.0–4.0 m
- Battery room: 3.5–5.0 m
- Warehouse: 8–12 m

**Fix:** Change the default height to 3.0 m in both `initialState` and `addRoom`. Change `achValue` default from 0.5 to 0.10 ACH (positively pressurized cleanroom).

---

## H-5 · Monsoon Seasonal CLTD/SHGF Multipliers Have No ASHRAE Basis

**File:** `constants/ashraeTables.js`  
**Impact:** Monsoon loads may be 10–30 % off depending on site

```js
WALL_CLTD_SEASONAL  = { summer: 1.00, monsoon: 0.85, winter: 0.40 }
ROOF_CLTD_SEASONAL  = { summer: 1.00, monsoon: 0.80, winter: 0.30 }
SHGF.N/NE/E...      = { summer: X,    monsoon: X×0.89, winter: X×0.50 }
```

ASHRAE does not define "monsoon" as a design season. These multipliers appear to be empirical approximations with no published basis. For pharma and semiconductor projects in India, monsoon is the **latent-critical** season (80–85 % RH), but its CLTD load being 85 % of summer is an arbitrary guess.

The correct approach is to use actual monsoon design conditions (DB + RH) entered in the Climate tab and compute CLTD corrections using the `correctCLTD` formula with actual monsoon `tMeanOutdoor`. The seasonal multiplier is a shortcut that cannot be correct for all sites.

**Recommendation:** Remove the seasonal multipliers. The `correctCLTD` formula already adjusts for actual outdoor mean temperature; the multiplier double-corrects and is not founded in ASHRAE.

---

## H-6 · No Sensible Heat Ratio (ESHF) Feasibility Check

**Files:** `rdsSelector.js`  
**Impact:** System may be specified at an ADP that physically cannot achieve the required room humidity — silent failure

ASHRAE requires verifying:
```
ESHF = ERSH / (ERSH + ERLH)
```
The ESHF line drawn from the room condition on a psychrometric chart must intersect the saturation curve at a point ≥ ADP. If `ESHF < RSHF` (Room SHF), the ADP is too high and the system will never reach the humidity setpoint — no matter how much air it supplies.

Currently the code never calculates ESHF or flags this condition. For pharma dry rooms (30 % RH) or battery dry rooms (< 5 % RH), this check is critical.

**Fix:**
```js
const rshf = rawSensible / (rawSensible + rawLatent) || 1;
const eshf = peakErsh / (peakErsh + peakErlh) || 1;
const adpOnSatCurve = calculateDewPoint(adpF, 100);
const eshfFeasible  = eshf >= rshf;    // flag in output
```

---

# 🟡 MEDIUM SEVERITY BUGS

---

## M-1 · Safety Factor and Fan Heat ARE Compounded Despite Comment Saying They Are Not

**File:** `rdsSelector.js`  
**Impact:** ~0.5 % overestimate at default 10 % safety / 5 % fan heat — grows at higher values

The BUG-14 comment says "fan heat is NOT compounded with safety factor." The math contradicts this:
```
peakErsh   = rawSensible × safetyMult          (safety already baked in)
fanHeatBTU = (peakErsh + peakErlh) × fanFrac  (fan fraction applied to safety-inflated loads)
grandTotal = (peakErsh + peakErlh) + fanHeatBTU
           = (rawSensible + rawLatent) × safetyMult × (1 + fanFrac)  ← compounded
```

True non-compounded calculation:
```js
const grandTotal = (rawSensible + rawLatent) * safetyMult
                 + (rawSensible + rawLatent) * fanFrac;
// = raw × (safetyMult + fanFrac)  ← additive, not multiplicative
```

At `safetyFactor=20 %, fanHeat=8 %`:
- Current: `× 1.20 × 1.08 = × 1.296`
- Correct: `× (1.20 + 0.08) = × 1.28`
- Overestimate: 1.25 %

Not large, but the comment should be corrected or the formula changed to match the stated intent.

---

## M-2 · `cfmValue` Infiltration Method Exists in State but Is Never Used

**Files:** `envelopeSlice.js`, `rdsSelector.js`  
**Impact:** Users who want to enter infiltration as a fixed CFM value (common in large-door warehouse rooms) cannot

```js
// envelopeSlice.js — defines but:
infiltration: { method: 'ach', achValue: 0.5, cfmValue: 0, doors: [] }

// rdsSelector.js — ignores method and cfmValue entirely:
const infilCFM = (volumeFt3 * (parseFloat(inf.achValue) || 0)) / 60;
```

**Fix:** Honor the `method` field:
```js
const infilCFM = inf.method === 'cfm'
  ? (parseFloat(inf.cfmValue) || 0)
  : (volumeFt3 * (parseFloat(inf.achValue) || 0)) / 60;
```

---

## M-3 · Lighting `useSchedule` Field Exists but Never Affects CLF

**Files:** `envelopeSlice.js`, `rdsSelector.js`  
**Impact:** Lighting load always at 100 % of installed wattage — overestimates load for spaces not 24/7

```js
// envelopeSlice default:
lights: { wattsPerSqFt: 0, useSchedule: 100 }

// rdsSelector — CLF hardcoded 1.0:
const lightsSens = (parseFloat(int.lights?.wattsPerSqFt) || 0) * floorAreaFt2 * ASHRAE.BTU_PER_WATT;
```

For 24/7 cleanrooms this is correct (CLF = 1.0). For pharma admin areas, office spaces, or laboratories with intermittent occupation, CLF from ASHRAE Table 3, Ch 18 should reduce the instantaneous cooling load.

---

## M-4 · HW Flow Rate Assumes Fixed 20 °F ΔT — Not Stated in UI

**File:** `rdsSelector.js`  
**Impact:** HW GPM wrong for any system not using 20 °F design ΔT

```js
const hwFlowRate = heatingCapBTU > 0 ? (heatingCapBTU / 10000).toFixed(1) : '0.0';
// 10000 = 500 BTU/gal·°F × 20 °F ΔT — hardcoded, not user-configurable
```

European systems commonly use 11 °C / 20 °F; North American HW systems range from 15 °F to 30 °F ΔT. This should be a project-level design parameter, same as ADP and bypass factor.

---

## M-5 · Partition and Floor Default `tAdj = 85 °F` Always Creates a Heat Gain

**File:** `constants/ashraeTables.js` — `DEFAULT_ELEMENTS.partitions.tAdj = 85`  
**Impact:** Every partition shows a heat gain into the room by default, even against other conditioned spaces

```js
partitions: { tAdj: 85, … }
// Q = U × A × (85 − tRoom)  →  with tRoom=72: always positive
```

If the adjacent space is also conditioned at 72 °F, `tAdj` should default to `tRoom` (zero gain). Using 85 °F assumes the adjacent space is an unconditioned corridor — appropriate for some rooms, wrong for back-to-back cleanrooms. The UI should either prompt the user for actual adjacent temperature or set the default to room design temp.

---

## M-6 · CLF Values Are Summer Peak — Applied to All Seasons Including Winter Solar

**File:** `constants/ashraeTables.js`  
**Impact:** Winter solar gain through glass slightly overestimated (CLF is unitless, 0–1)

```js
// CLF table has only one set of values — no seasonal variation:
const clf = CLF[orientation]?.[roomMass] ?? 0.55;
```

ASHRAE provides separate CLF tables by month (Tables 7–12, Ch 28). The summer peak CLF for S-facing glass (medium mass) is 0.55. In winter, the lower-angle sun and different thermal storage dynamics give CLF closer to 0.65–0.75 for S-facing. This means winter solar gain is understated slightly. For pharma facilities with significant south-facing glazing, this matters.

---

## M-7 · Winter Heating Capacity Only Uses Sensible Loss — Ignores Latent/Infiltration Heat Loss

**File:** `rdsSelector.js`  
**Impact:** Terminal heater and HW coil may be undersized when infiltration of dry cold air is significant

```js
const winterSensLoss = Math.min(0, results['ershOn_winter'] || 0);
const heatingCapBTU  = Math.abs(winterSensLoss);
```

`ershOn_winter` already includes infiltration sensible load (`infilSens`). But the infiltration latent load (`infilLat`) is included in `erlhOn_winter` (negative in winter = moisture removal). For a true heating season assessment, the total heat loss also includes latent losses. For pharma dry rooms or battery dry rooms, this is significant — the room loses heat AND moisture to infiltration simultaneously.

---

## M-8 · Default People Activity for Cleanrooms Should Not Be "Seated at Rest"

**File:** `features/envelope/envelopeSlice.js`  
**Impact:** Cleanroom people load understated by ~30 % if default is not changed

```js
people: { count: 0, sensiblePerPerson: 245, latentPerPerson: 205 }
// ASHRAE: "Seated, at rest" — correct for theatre/lobby
```

For cleanroom/pharma operators standing at workbenches (ASHRAE Table 1, Ch 18):
```
Light bench work — standing: 315 sensible / 245 latent BTU/hr·person
```

The UI shows an activity selector in EnvelopeConfig but the **default** that new rooms start with (245/205) underestimates pharma/semi cleanroom people load by 25–30 %. Since the RDS Quick Input also shows `sensiblePerPerson: 245` as the initial value and users may not visit EnvelopeConfig, this default propagates silently.

**Fix:** Change default to 315/245 BTU/hr·person for cleanroom applications, or make the initial value conditional on `room.classInOp`.

---

# 🔵 LOW SEVERITY / CODE QUALITY

---

## L-1 · ERSH/ERLH Terminology Non-Standard — Should Be Called RSH/RLH in Code

The variables named `ersh` / `erlh` in `calculateSeasonLoad` are actually **RSH × safetyMult** and **RLH × safetyMult**. ASHRAE "Effective Room Sensible Heat" (ERSH) is a specific ESHF-diagram concept that includes BF × OASH — not just safety-factored RSH.

Using ERSH for safety-factored RSH will confuse any engineer who cross-references the ASHRAE manual.

---

## L-2 · `volFaPct` (Room Volume % of FA Opt) Column Has No Calculation

**File:** `pages/rds/RDSConfig.js`  
This column accepts user input but its value is never used in any downstream calculation. It exists in the RDS table as a user note field. This should be either implemented (total supply air × volFaPct = target fresh air for that zone) or clearly labelled as a comment field.

---

## L-3 · `rsh` in Selector Is Raw Sensible, Not RSH as Defined

```js
const rsh = summerCalcs ? Math.round(summerCalcs.rawSensible) : 0;
```
`rawSensible` is pre-safety-factor. The RSH displayed in the RDS should include safety factor for consistency with ERSH. A downstream engineer reading RSH from the sheet and manually calculating ERSH will get a different number.

---

## L-4 · `designAcphCFM` vs `minAcphCFM` — No ISO 14644 Validation

**File:** `rdsSelector.js`  
The code takes `Math.max(thermalCFM, minAcphCFM, designAcphCFM)`. There is no check that `designAcph` meets the minimum ISO 14644 air change rate for the room's `classInOp`. ISO minimums:

| ISO Class | Min ACPH (typical) |
|---|---|
| ISO 5 | 240–360 |
| ISO 6 | 90–180 |
| ISO 7 | 30–60 |
| ISO 8 | 10–20 |

The code accepts whatever `designAcph` and `minAcph` the user enters without validating against the ISO class. A room classified as ISO 7 with `designAcph = 5` would silently produce an under-ventilated, non-compliant design.

---

## L-5 · `bleedAir` Can Show Negative Values

```js
const bleedAir = Math.max(0, supplyAir - returnAir - freshAirCheck);
```
The floor at 0 is correct, but `bleedAir` conceptually represents pressurization bleed — it should not exceed `totalExhaust`. No upper bound is enforced.

---

## L-6 · `calculateEnthalpy` Uses Approximation Coefficients — Acceptable but Document

```js
const h = 0.240 * t + W * (1061 + 0.444 * t);
```
ASHRAE Fundamentals Eq. 30 is:
```
h = 0.240·t + W·(1061 + 0.444·t)   [BTU/lb]
```
This is the correct ASHRAE formula. However, the more precise ASHRAE Eq. 32 uses:
```
h = 0.240·t + W·(1061.2 + 0.444·t)
```
Difference is 0.2 BTU/lb at 100 % humidity — negligible.

---

## L-7 · `totalExfil` Always Equals `totalInfil` — No Pressure-Balance Logic

```js
const totalInfil = summerCalcs ? Math.round(summerCalcs.infilCFM) : 0;
const totalExfil = totalInfil;  // identical
```

In a positively pressurized cleanroom, exfiltration > infiltration by design. The code sets them equal, which is only correct for a neutral-pressure room. For pharma and semiconductor clean rooms, the pressure differential is intentional (15 Pa typical) and the exfiltration should exceed infiltration. The current model has them equal, which does not represent the intended pressurization.

---

## L-8 · `manualFreshAir` Field Never Dispatches to Redux

**File:** `pages/rds/RDSConfig.js`  
`manualFreshAir` is listed as an editable (non-readOnly) column and is used in rdsSelector:
```js
const manualFA = parseFloat(room.manualFreshAir) || 0;
```
However, there is no `isEnv` flag, so the `handleRoomUpdate` → `updateRoom` path is taken. `roomSlice.updateRoom` uses `setNestedValue(room, 'manualFreshAir', value)` which should work. This one is actually fine — just confirm `manualFreshAir` is initialized in `addRoom`. It is **not** initialized in either `initialState` or `addRoom` in `roomSlice.js`, so it defaults to `undefined` and reads back as `0` in the selector. First time the user saves it, it works; on reload from persisted state the field persists. But the initial state gap means the column header will show a non-persisted blank.

---

# Data Flow Issues

---

## DF-1 · RDSRow and RoomDetailPanel Both Dispatch `initializeRoom` on Every Keystroke

```js
// RDSRow.jsx — handleEnvUpdate:
dispatch(initializeRoom(room.id));
dispatch(updateInternalLoad({ … }));
```

`initializeRoom` is an idempotent no-op if the room already exists (correct), but dispatching it on every envelope cell change adds unnecessary Redux cycles. Minor performance issue for large multi-room projects.

---

## DF-2 · RoomConfig Page Has a Separate `handleUpdate` That Doesn't Support Dot-Notation Fields

**File:** `pages/RoomConfig.jsx`  
```js
const handleUpdate = (field, value) => {
  dispatch(updateRoom({ id: activeRoom.id, field,
    value: field === 'name' ? value : (parseFloat(value) || 0)
  }));
};
```

`exhaustAir.general` would be passed as the field string. The `roomSlice.updateRoom` reducer uses `setNestedValue(room, field, value)` which does handle dot-notation, so this actually works. But unlike `RDSRow` which uses `buildRoomUpdate()` from RDSConfig, `RoomConfig` hardcodes the pattern. If a future dot-notation field is added, it requires a change in two places.

---

## DF-3 · RDSPage Reset Calls `localStorage.clear()` but App Doesn't Use localStorage

```js
// RDSPage.jsx:
if (window.confirm('Reset Project to Defaults? This clears all data.')) {
  localStorage.clear();
  window.location.reload();
}
```

The store uses Redux (in-memory). Unless `redux-persist` is configured (not visible in the provided code), `localStorage.clear()` does nothing and the reload simply reinitializes the Redux store from `initialState`. If `redux-persist` is added later this will work correctly. Currently harmless but misleading.

---

# Priority Fix Roadmap

| Priority | Bug | File | Effort |
|---|---|---|---|
| 1 🔴 | C-1: Add OA conditioning load to coolingCapTR | rdsSelector.js | Medium |
| 2 🔴 | C-2: Use U×A×ΔT for winter wall/roof/glass | envelopeCalc.js | Small |
| 3 🔴 | C-3: Use freshAirCFM for humidification | rdsSelector.js | Small |
| 4 🔴 | C-4: Fix fa25Acph → minSupplyAcph key | RDSConfig.js | Trivial |
| 5 🟠 | H-2: Implement or remove blank RDS columns | rdsSelector.js | Medium |
| 6 🟠 | H-3: Industry-specific 62.1 ventilation rates | ashrae.js + rdsSelector | Medium |
| 7 🟠 | H-4: Fix default room height to 3.0 m | roomSlice.js | Trivial |
| 8 🟠 | H-6: Add ESHF feasibility check & flag | rdsSelector.js | Small |
| 9 🟠 | H-5: Remove arbitrary monsoon CLTD multipliers | ashraeTables.js | Small |
| 10 🟡 | M-1: Fix safety+fan compounding or correct comment | rdsSelector.js | Trivial |
| 11 🟡 | M-2: Honor cfm infiltration method | rdsSelector.js | Trivial |
| 12 🟡 | M-8: Change default people load to 315/245 | envelopeSlice.js | Trivial |

---

*Report generated by complete static analysis of all source files. All ASHRAE formula references verified against Fundamentals 2021 and CHLCM 2nd Ed.*