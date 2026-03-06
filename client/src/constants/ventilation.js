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
 *   Default occupancy (Ez = 1.0 for most spaces):
 *     Zone OA = Vbz / Ez
 *
 * ── STRUCTURE ─────────────────────────────────────────────────────────────────
 *
 *   VENTILATION_CATEGORIES
 *     Keyed object — key matches room.ventCategory in roomSlice.
 *     Each entry has:
 *       label        — display name for UI
 *       rp           — cfm/person (Rp)
 *       ra           — cfm/ft²    (Ra)
 *       defaultEz    — zone air distribution effectiveness (default 1.0)
 *       note         — ASHRAE source reference
 *
 *   VENTILATION_SPACE_TYPES
 *     Detailed per-space-type table for reference / future drill-down.
 *     Not used in calculations directly — ventCategory drives Rp/Ra selection.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────
 *
 *   import { getRpRa } from '../constants/ventilation';
 *   const { rp, ra } = getRpRa(room.ventCategory);
 *   const vbz = Math.ceil(rp * pplCount + ra * floorAreaFt2);
 */

// ── Per-category Rp and Ra values ─────────────────────────────────────────────
// Source: ASHRAE 62.1-2022, Table 6-1
// Categories map to room.ventCategory values in roomSlice.

export const VENTILATION_CATEGORIES = {

  // General / office — default for unclassified spaces
  // ASHRAE 62.1 Table 6-1: Office space
  general: {
    label:     'General / Office',
    rp:        5,      // cfm/person
    ra:        0.06,   // cfm/ft²
    defaultEz: 1.0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Office Space',
  },

  // Conference / meeting room — higher occupancy density
  conference: {
    label:     'Conference / Meeting Room',
    rp:        5,
    ra:        0.06,
    defaultEz: 1.0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Conference/Meeting',
  },

  // Pharmaceutical — cleanroom / ISO classified manufacturing
  // Higher Ra for contaminant dilution; low Rp (personnel in gowning)
  pharma: {
    label:     'Pharmaceutical / Biotech Cleanroom',
    rp:        5,
    ra:        0.18,   // cfm/ft² — elevated for chemical/biological contaminants
    defaultEz: 1.0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Laboratory — General; '
             + 'GMP Annex 1:2022 recommends ≥20 ACPH for Grade B/C.',
  },

  // Semiconductor fab — ISO 5/6 cleanrooms, high-purity process areas
  // Very high Ra — chemical contaminants (solvents, acids, dopants) dominate
  semicon: {
    label:     'Semiconductor / Electronics Fab',
    rp:        5,
    ra:        0.18,
    defaultEz: 1.0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Laboratory — Chemical; '
             + 'SEMI S2 requires dedicated exhaust for process chemicals.',
  },

  // Battery manufacturing — Li-ion cell formation, electrolyte handling
  // Off-gas risk (HF from LiPF6 electrolyte) → elevated Ra
  battery: {
    label:     'Battery Manufacturing',
    rp:        5,
    ra:        0.18,
    defaultEz: 1.0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Laboratory — Chemical; '
             + 'Li-ion electrolyte off-gassing requires dedicated exhaust.',
  },

  // Solar / PV manufacturing — thin-film deposition, chemical baths
  solar: {
    label:     'Solar / PV Manufacturing',
    rp:        5,
    ra:        0.18,
    defaultEz: 1.0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Laboratory — Chemical.',
  },

  // Warehouse / logistics — low occupancy density
  warehouse: {
    label:     'Warehouse / Storage',
    rp:        5,
    ra:        0.06,
    defaultEz: 1.0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Warehousing.',
  },

  // Corridor / lobby — transitional space
  corridor: {
    label:     'Corridor / Lobby',
    rp:        5,
    ra:        0.06,
    defaultEz: 1.0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Corridor.',
  },

  // Utility / mechanical room — minimal occupancy, no process contaminants
  utility: {
    label:     'Utility / Mechanical Room',
    rp:        5,
    ra:        0.06,
    defaultEz: 1.0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Mechanical/Electrical Room.',
  },

  // Gowning / change room — transitional, brief occupancy
  gowning: {
    label:     'Gowning / Change Room',
    rp:        5,
    ra:        0.10,
    defaultEz: 1.0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Locker/Dressing Room.',
  },

  // Canteen / cafeteria — food service occupancy
  canteen: {
    label:     'Canteen / Cafeteria',
    rp:        7.5,   // cfm/person — elevated for food odours
    ra:        0.18,
    defaultEz: 1.0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Food and Beverage Service.',
  },
};

// ── Convenience accessor ──────────────────────────────────────────────────────

/**
 * getRpRa()
 * Returns { rp, ra, label, ez } for a given ventilation category.
 * Falls back to 'general' if category is unknown or undefined.
 *
 * @param {string} ventCategory - room.ventCategory from roomSlice
 * @returns {{ rp: number, ra: number, label: string, ez: number }}
 */
export const getRpRa = (ventCategory) => {
  const cat = VENTILATION_CATEGORIES[ventCategory]
    ?? VENTILATION_CATEGORIES.general;

  return {
    rp:    cat.rp,
    ra:    cat.ra,
    label: cat.label,
    ez:    cat.defaultEz,
  };
};

/**
 * calculateVbz()
 * Computes ASHRAE 62.1-2022 breathing zone outdoor airflow.
 *
 * Vbz = Rp × Pz  +  Ra × Az  (cfm)
 *
 * @param {string} ventCategory  - room.ventCategory
 * @param {number} pplCount      - zone population (Pz)
 * @param {number} floorAreaFt2  - zone floor area in ft² (Az)
 * @returns {number} Vbz in CFM (ceiling integer)
 */
export const calculateVbz = (ventCategory, pplCount, floorAreaFt2) => {
  const { rp, ra, ez } = getRpRa(ventCategory);
  const vbz = (rp * (parseFloat(pplCount) || 0))
            + (ra * (parseFloat(floorAreaFt2) || 0));
  return Math.ceil(vbz / ez);
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
  { spaceType: 'Corridor',                      rp: 0,   ra: 0.06, category: 'General'       },
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