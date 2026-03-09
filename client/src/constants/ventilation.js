/**
 * ventilation.js
 * ASHRAE 62.1-2022 Ventilation Rate Procedure — Table 6-1
 *
 * Reference: ANSI/ASHRAE Standard 62.1-2022,
 *            "Ventilation and Acceptable Indoor Air Quality"
 *            Section 6.2 — Ventilation Rate Procedure (VRP)
 *            Table 6-1 — Breathing Zone Outdoor Airflow
 *
 * ── METHOD ───────────────────────────────────────────────────────────────────
 *
 *   Breathing Zone OA flow:
 *     Vbz = Rp × Pz  +  Ra × Az
 *
 *   where:
 *     Rp  = people outdoor air rate   (cfm/person)  — activity-based
 *     Ra  = area outdoor air rate     (cfm/ft²)     — contaminant dilution
 *     Pz  = zone population           (people)
 *     Az  = zone floor area           (ft²)
 *
 *   Zone OA (accounting for air distribution effectiveness):
 *     Voz = Vbz / Ez
 *
 *   where Ez = zone air distribution effectiveness (ASHRAE 62.1 Table 6-2).
 *   Ez = 1.0 for ceiling supply / ceiling return (most spaces).
 *   Ez = 1.2 for floor supply / ceiling return (UFAD, displacement vent).
 *   Ez = 0.8 for ceiling supply < 15°F above room (heating, ceiling supply).
 *
 * ── CRITICAL FACILITY GOVERNING CRITERIA ─────────────────────────────────────
 *
 *   For semiconductor, pharma, and battery spaces, minimum ACH requirements
 *   often govern over Vbz. The final OA CFM must be the MAXIMUM of:
 *     (a) Vbz / Ez  (62.1 VRP)
 *     (b) minAch × volume / 60  (regulatory / GMP minimum)
 *     (c) Exhaust makeup air requirement
 *
 *   airQuantities.js is responsible for computing (a), (b), (c) and taking
 *   the maximum. minAch values are structured in VENTILATION_CATEGORIES below.
 *
 * ── STRUCTURE ─────────────────────────────────────────────────────────────────
 *
 *   VENTILATION_CATEGORIES
 *     Keyed object — key matches room.ventCategory in roomSlice.
 *     Each entry has:
 *       label     — display name for UI
 *       rp        — cfm/person (Rp) from ASHRAE 62.1-2022 Table 6-1
 *       ra        — cfm/ft²    (Ra) from ASHRAE 62.1-2022 Table 6-1
 *       defaultEz — zone air distribution effectiveness (Table 6-2)
 *       minAch    — minimum ACH from regulatory / GMP / safety codes
 *                   (0 = no minimum ACH requirement; Vbz governs)
 *       note      — source references
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────
 *
 *   import { getRpRa, calculateVbz } from '../constants/ventilation';
 *   const { rp, ra, ez, minAch } = getRpRa(room.ventCategory);
 *   const vbz = calculateVbz(room.ventCategory, pplCount, floorAreaFt2);
 *   // airQuantities.js then takes max(vbz, minAch × vol / 60, exhaustMakeup)
 */

// ── Per-category Rp, Ra, Ez, and minAch values ────────────────────────────────
// Source: ASHRAE 62.1-2022, Table 6-1 (Rp, Ra) and Table 6-2 (Ez).
// minAch sources listed per entry.
// Categories map to room.ventCategory values in roomSlice.

export const VENTILATION_CATEGORIES = {

  // ── General / Office ───────────────────────────────────────────────────────
  // ASHRAE 62.1-2022, Table 6-1: Office Space
  general: {
    label:     'General / Office',
    rp:        5,      // cfm/person
    ra:        0.06,   // cfm/ft²
    defaultEz: 1.0,
    minAch:    0,      // No regulatory minimum ACH; Vbz governs
    note:      'ASHRAE 62.1-2022 Table 6-1, Office Space',
  },

  // ── Conference / Meeting Room ──────────────────────────────────────────────
  conference: {
    label:     'Conference / Meeting Room',
    rp:        5,
    ra:        0.06,
    defaultEz: 1.0,
    minAch:    0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Conference/Meeting',
  },

  // ── Pharmaceutical Cleanroom ───────────────────────────────────────────────
  // GMP Annex 1 (2022) minimum ACH requirements by grade:
  //   Grade A (ISO 5): unidirectional flow — ACH not typically specified;
  //                    0.45 m/s velocity required at working position.
  //   Grade B (ISO 6): ≥ 20 ACPH (GMP Annex 1:2022 §4.29)
  //   Grade C (ISO 7): ≥ 20 ACPH (GMP Annex 1:2022 §4.29)
  //   Grade D (ISO 8): ≥ 6 ACPH  (GMP Annex 1:2022 §4.29)
  //
  // minAch: 20 is conservative (Grade B/C basis) — appropriate for default.
  // For Grade D spaces, override minAch: 6 at room level.
  // Ra: 0.18 — ASHRAE 62.1 Table 6-1, Laboratory (chemical/biological).
  pharma: {
    label:     'Pharmaceutical / Biotech Cleanroom',
    rp:        5,
    ra:        0.18,
    defaultEz: 1.0,    // Ceiling supply / return; unidirectional zones use 1.0
    minAch:    20,     // GMP Annex 1:2022 §4.29, Grade B/C minimum
    note:      'ASHRAE 62.1-2022 Table 6-1, Laboratory — General; '
             + 'GMP Annex 1:2022 §4.29: Grade B/C ≥20 ACPH, Grade D ≥6 ACPH. '
             + 'Override minAch at room level for Grade D spaces.',
  },

  // ── Semiconductor / Electronics Fab ───────────────────────────────────────
  // Note on ra distinction (see also ashrae.js VENT_AREA_SEMICON comment):
  //   ra: 0.18 here is the 62.1 minimum OA component (chemical contaminant basis).
  //   ashrae.js VENT_AREA_SEMICON: 0.06 is the recirculation-governed basis used
  //   for ACH calculations in high-recirculation cleanrooms (ISO 5/6 FFU systems).
  //   These serve different purposes and must NOT be interchanged.
  //
  // minAch: 6 is the 62.1 / SEMI S2 minimum for occupied areas.
  // ISO 5 production areas are governed by recirculation ACH (300–600 ACPH total)
  // but the OA component is typically 5–10% of total supply — compute separately.
  //
  // Ez: 1.2 available if UFAD is used (displacement ventilation).
  // defaultEz: 1.0 — conservative; override per-room if UFAD is confirmed.
  semicon: {
    label:     'Semiconductor / Electronics Fab',
    rp:        5,
    ra:        0.18,   // 62.1 Table 6-1, Laboratory — Chemical (OA component only)
    defaultEz: 1.0,    // Conservative; use 1.2 for UFAD / displacement ventilation
    minAch:    6,      // ASHRAE 62.1 / SEMI S2-0200 minimum for occupied cleanroom
    note:      'ASHRAE 62.1-2022 Table 6-1, Laboratory — Chemical. '
             + 'SEMI S2-0200 requires dedicated exhaust for process chemicals. '
             + 'ISO 5/6 recirculation ACH (300–600 ACPH) computed separately — '
             + 'minAch here is OA-only minimum for occupied areas. '
             + 'Set defaultEz: 1.2 at room level if UFAD/displacement supply confirmed.',
  },

  // ── Battery Manufacturing ──────────────────────────────────────────────────
  // Li-ion electrolyte off-gassing (HF from LiPF6) and H2 evolution during
  // formation cycling require elevated OA and dedicated exhaust.
  // NFPA 855 §15 and IFC §1206 require ventilation to maintain H2 < 25% LFL.
  // For Li-ion formation rooms: minimum 1 CFM/ft² supply or 6 ACPH, whichever
  // is greater. minAch: 10 is conservative for formation / electrolyte areas.
  battery: {
    label:     'Battery Manufacturing',
    rp:        5,
    ra:        0.18,
    defaultEz: 1.0,
    minAch:    10,     // NFPA 855 §15 / IFC §1206 — H2 dilution basis
    note:      'ASHRAE 62.1-2022 Table 6-1, Laboratory — Chemical. '
             + 'NFPA 855 §15 / IFC §1206: H2 dilution requires ≥1 CFM/ft² or '
             + '≥6 ACPH in formation/electrolyte areas; minAch:10 is conservative. '
             + 'Dedicated exhaust for HF, NMP, and H2 required.',
  },

  // ── Solar / PV Manufacturing ───────────────────────────────────────────────
  // Thin-film deposition (CdTe, CIGS), chemical baths (HF etch).
  solar: {
    label:     'Solar / PV Manufacturing',
    rp:        5,
    ra:        0.18,
    defaultEz: 1.0,
    minAch:    6,
    note:      'ASHRAE 62.1-2022 Table 6-1, Laboratory — Chemical. '
             + 'HF acid process areas require dedicated exhaust.',
  },

  // ── Warehouse / Storage ────────────────────────────────────────────────────
  warehouse: {
    label:     'Warehouse / Storage',
    rp:        5,
    ra:        0.06,
    defaultEz: 1.0,
    minAch:    0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Warehousing.',
  },

  // ── Corridor / Lobby ──────────────────────────────────────────────────────
  // FIX HIGH-01: Rp corrected from 5 to 0.
  // ASHRAE 62.1-2022 Table 6-1: Corridor — Rp = 0, Ra = 0.06.
  // Corridors are non-occupiable transitional spaces; no per-person OA credit.
  // The detailed reference table (ASHRAE_621_TABLE_6_1) at the bottom of this
  // file already correctly shows rp: 0 — the VENTILATION_CATEGORIES entry was
  // inconsistent with it. This fix removes the inflation of corridor OA CFM.
  corridor: {
    label:     'Corridor / Lobby',
    rp:        0,      // FIX HIGH-01: was 5 — ASHRAE 62.1 Table 6-1 = 0 for corridors
    ra:        0.06,
    defaultEz: 1.0,
    minAch:    0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Corridor. Rp = 0 (non-occupiable).',
  },

  // ── Utility / Mechanical Room ──────────────────────────────────────────────
  // FIX HIGH-02: Rp corrected from 5 to 0.
  // Mechanical / electrical rooms have no regular occupancy in ASHRAE 62.1.
  // Rp = 0 — only the area component Ra applies for incidental access.
  utility: {
    label:     'Utility / Mechanical Room',
    rp:        0,      // FIX HIGH-02: was 5 — no regular occupancy per 62.1
    ra:        0.06,
    defaultEz: 1.0,
    minAch:    0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Mechanical/Electrical Room. '
             + 'Rp = 0 (non-occupiable); Ra only for incidental access.',
  },

  // ── Gowning / Change Room ──────────────────────────────────────────────────
  gowning: {
    label:     'Gowning / Change Room',
    rp:        5,
    ra:        0.10,
    defaultEz: 1.0,
    minAch:    10,     // Cascade pressure differential maintenance; GMP guidance
    note:      'ASHRAE 62.1-2022 Table 6-1, Locker/Dressing Room. '
             + 'Pressure cascade to adjacent cleanroom typically governs.',
  },

  // ── Canteen / Cafeteria ────────────────────────────────────────────────────
  canteen: {
    label:     'Canteen / Cafeteria',
    rp:        7.5,    // cfm/person — elevated for food odours
    ra:        0.18,
    defaultEz: 1.0,
    minAch:    0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Food and Beverage Service.',
  },
};

// ── Convenience accessor ──────────────────────────────────────────────────────

/**
 * getRpRa(ventCategory)
 *
 * Returns { rp, ra, label, ez, minAch } for a given ventilation category.
 * Falls back to 'general' if category is unknown or undefined, with a
 * console.warn so the fallback is never silent.
 *
 * @param {string} ventCategory - room.ventCategory from roomSlice
 * @returns {{ rp: number, ra: number, label: string, ez: number, minAch: number }}
 */
export const getRpRa = (ventCategory) => {
  if (ventCategory && !VENTILATION_CATEGORIES[ventCategory]) {
    console.warn(
      `getRpRa: unknown ventCategory "${ventCategory}". Falling back to "general". ` +
      `Valid keys: ${Object.keys(VENTILATION_CATEGORIES).join(', ')}`
    );
  }

  const cat = VENTILATION_CATEGORIES[ventCategory]
    ?? VENTILATION_CATEGORIES.general;

  return {
    rp:     cat.rp,
    ra:     cat.ra,
    label:  cat.label,
    ez:     cat.defaultEz,
    minAch: cat.minAch,
  };
};

/**
 * calculateVbz(ventCategory, pplCount, floorAreaFt2, ezOverride?)
 *
 * Computes ASHRAE 62.1-2022 breathing zone outdoor airflow.
 *
 *   Vbz = Rp × Pz + Ra × Az
 *   Voz = Vbz / Ez
 *
 * FIX LOW-01: Returns raw float (not Math.ceil'd).
 * Rounding is the caller's responsibility. Intermediate calcs (e.g. system
 * ventilation efficiency Ev) require the unrounded value for accuracy.
 * airQuantities.js should apply Math.ceil only on the final governing CFM.
 *
 * @param {string} ventCategory  - room.ventCategory
 * @param {number} pplCount      - zone population (Pz)
 * @param {number} floorAreaFt2  - zone floor area in ft² (Az)
 * @param {number} [ezOverride]  - optional Ez override (e.g. 1.2 for UFAD)
 * @returns {number} Voz in CFM (unrounded float)
 */
export const calculateVbz = (ventCategory, pplCount, floorAreaFt2, ezOverride) => {
  const { rp, ra, ez } = getRpRa(ventCategory);
  const effectiveEz = ezOverride ?? ez;
  const vbz = (rp * (parseFloat(pplCount) || 0))
            + (ra * (parseFloat(floorAreaFt2) || 0));
  return vbz / effectiveEz;   // FIX LOW-01: raw float; caller rounds
};

/**
 * calculateMinAchCfm(ventCategory, volumeFt3)
 *
 * Returns the minimum OA CFM required by the regulatory ACH floor for this
 * space type (minAch × volume / 60).
 *
 * airQuantities.js must take the maximum of:
 *   calculateVbz(...)        — 62.1 VRP OA requirement
 *   calculateMinAchCfm(...)  — regulatory ACH floor
 *   exhaust makeup CFM       — process exhaust makeup requirement
 *
 * Returns 0 for categories with minAch: 0 (no regulatory floor).
 *
 * @param {string} ventCategory - room.ventCategory
 * @param {number} volumeFt3    - room volume in ft³ (= area × ceiling height)
 * @returns {number} minimum OA CFM from ACH requirement (unrounded float)
 */
export const calculateMinAchCfm = (ventCategory, volumeFt3) => {
  const { minAch } = getRpRa(ventCategory);
  if (!minAch || !volumeFt3) return 0;
  return (minAch * (parseFloat(volumeFt3) || 0)) / 60;
};

// ── UI option list ────────────────────────────────────────────────────────────
// Pre-built for RDSConfig select column — matches ventCategory keys.

export const VENTILATION_CATEGORY_OPTIONS = Object.entries(VENTILATION_CATEGORIES)
  .map(([value, cat]) => ({ value, label: cat.label }));

// ── ASHRAE 62.1-2022 Table 6-1 reference (detailed) ──────────────────────────
// Full space-type table for engineering reference and future drill-down UI.
// Not used in primary calculations — ventCategory drives Rp/Ra selection above.

export const ASHRAE_621_TABLE_6_1 = [
  // Educational
  { spaceType: 'Classroom (ages 5–8)',         rp: 10,  ra: 0.12, category: 'Educational'   },
  { spaceType: 'Classroom (ages 9+)',           rp: 10,  ra: 0.12, category: 'Educational'   },
  { spaceType: 'Lecture Classroom',             rp: 7.5, ra: 0.06, category: 'Educational'   },
  { spaceType: 'Lecture Hall (fixed seating)',  rp: 7.5, ra: 0.06, category: 'Educational'   },
  { spaceType: 'Art Classroom',                 rp: 10,  ra: 0.18, category: 'Educational'   },
  { spaceType: 'Science Laboratory',            rp: 10,  ra: 0.18, category: 'Educational'   },

  // Office
  { spaceType: 'Office Space',                  rp: 5,   ra: 0.06, category: 'Office'        },
  { spaceType: 'Reception Areas',               rp: 5,   ra: 0.06, category: 'Office'        },
  { spaceType: 'Telephone / Data Entry',        rp: 5,   ra: 0.06, category: 'Office'        },
  { spaceType: 'Conference / Meeting',          rp: 5,   ra: 0.06, category: 'Office'        },

  // General
  { spaceType: 'Corridor',                      rp: 0,   ra: 0.06, category: 'General'       }, // non-occupiable
  { spaceType: 'Storage Rooms',                 rp: 0,   ra: 0.12, category: 'General'       },

  // Industrial
  { spaceType: 'Laboratory — General',          rp: 5,   ra: 0.18, category: 'Industrial'    },
  { spaceType: 'Laboratory — Chemical',         rp: 5,   ra: 0.18, category: 'Industrial'    },
  { spaceType: 'Cleanroom (ISO 5–8)',           rp: 5,   ra: 0.18, category: 'Industrial'    },
  { spaceType: 'Warehousing',                   rp: 5,   ra: 0.06, category: 'Industrial'    },

  // Retail
  { spaceType: 'Sales Floor',                   rp: 7.5, ra: 0.12, category: 'Retail'        },
  { spaceType: 'Mall Common Areas',             rp: 7.5, ra: 0.06, category: 'Retail'        },

  // Food / Beverage
  { spaceType: 'Restaurant Dining Rooms',       rp: 7.5, ra: 0.18, category: 'Food'          },
  { spaceType: 'Cafeteria / Fast Food',         rp: 7.5, ra: 0.18, category: 'Food'          },
  { spaceType: 'Bar / Cocktail Lounge',         rp: 7.5, ra: 0.18, category: 'Food'          },
  { spaceType: 'Kitchen — Commercial',          rp: 7.5, ra: 0.12, category: 'Food'          },

  // Healthcare
  { spaceType: 'Patient Rooms',                 rp: 5,   ra: 0.06, category: 'Healthcare'    },
  { spaceType: 'Medical Procedure Room',        rp: 5,   ra: 0.06, category: 'Healthcare'    },
  { spaceType: 'Operating Rooms',               rp: 5,   ra: 0.06, category: 'Healthcare'    },
  { spaceType: 'Pharmacy',                      rp: 5,   ra: 0.18, category: 'Healthcare'    },

  // Hospitality
  { spaceType: 'Bedroom / Living Room',         rp: 5,   ra: 0.06, category: 'Hospitality'   },
  { spaceType: 'Hotel Lobby',                   rp: 7.5, ra: 0.06, category: 'Hospitality'   },
  { spaceType: 'Laundry Rooms — Commercial',    rp: 5,   ra: 0.12, category: 'Hospitality'   },
];