/**
 * ventilation.js
 * ASHRAE 62.1-2022 Ventilation Rate Procedure — Table 6-1
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   MEDIUM-03 FIX — Added battery-leadacid ventilation category.
 *
 *     Lead-acid battery formation rooms (Exide Technologies, EnerSys, C&D
 *     Technologies) are a major segment of the battery manufacturing market.
 *     The existing 'battery' (Li-ion) category was the only option, producing
 *     incorrect ventilation requirements for lead-acid facilities:
 *
 *     Li-ion (battery):         ra=0.18, minAch=10 (NFPA 855 / IFC §1206)
 *     Lead-acid (new):          ra=1.0,  minAch=12 (OSHA 29 CFR 1926.403(i))
 *
 *     The OSHA minimum for lead-acid battery charging areas is 1 CFM/ft²
 *     total supply — expressed as an area rate (ra), not an ACPH requirement.
 *     This is 5–10× the 62.1 minimum and governs the OA system design.
 *
 *     For a 10,000 ft² lead-acid formation bay (typical Exide cell):
 *       Li-ion category:     0.18 cfm/ft² → 1,800 CFM OA minimum
 *       Lead-acid category:  1.0  cfm/ft² → 10,000 CFM OA minimum
 *       Difference: 8,200 CFM — a 5.6× error in OA sizing.
 *
 * Reference: ANSI/ASHRAE Standard 62.1-2022, Section 6.2 — VRP
 */

export const VENTILATION_CATEGORIES = {

  // ── General / Office ───────────────────────────────────────────────────────
  general: {
    label:     'General / Office',
    rp:        5,
    ra:        0.06,
    defaultEz: 1.0,
    minAch:    0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Office Space',
  },

  conference: {
    label:     'Conference / Meeting Room',
    rp:        5,
    ra:        0.06,
    defaultEz: 1.0,
    minAch:    0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Conference/Meeting',
  },

  // ── Pharmaceutical Cleanroom ───────────────────────────────────────────────
  pharma: {
    label:     'Pharmaceutical / Biotech Cleanroom',
    rp:        5,
    ra:        0.18,
    defaultEz: 1.0,
    minAch:    20,
    note:      'ASHRAE 62.1-2022 Table 6-1, Laboratory — General; '
             + 'GMP Annex 1:2022 §4.29: Grade B/C ≥20 ACPH, Grade D ≥6 ACPH.',
  },

  // ── Semiconductor / Electronics Fab ───────────────────────────────────────
  semicon: {
    label:     'Semiconductor / Electronics Fab',
    rp:        5,
    ra:        0.18,
    defaultEz: 1.0,
    minAch:    6,
    note:      'ASHRAE 62.1-2022 Table 6-1, Laboratory — Chemical. '
             + 'SEMI S2-0200 requires dedicated exhaust for process chemicals. '
             + 'ISO 5/6 recirculation ACH (300–600 ACPH) computed separately. '
             + 'Set defaultEz: 1.2 at room level if UFAD/displacement supply confirmed.',
  },

  // ── Li-ion Battery Manufacturing ──────────────────────────────────────────
  // For LEAD-ACID battery manufacturing, use battery-leadacid below.
  battery: {
    label:     'Battery Manufacturing — Li-ion',
    rp:        5,
    ra:        0.18,
    defaultEz: 1.0,
    minAch:    10,
    note:      'ASHRAE 62.1-2022 Table 6-1, Laboratory — Chemical. '
             + 'NFPA 855 §15 / IFC §1206: H2 dilution requires ≥1 CFM/ft² or '
             + '≥6 ACPH in formation/electrolyte areas; minAch:10 is conservative. '
             + 'Dedicated exhaust for HF, NMP, and H2 required. '
             + 'For lead-acid facilities (Exide / EnerSys), use battery-leadacid category.',
  },

  /**
   * battery-leadacid — Lead-acid battery formation / charging rooms.
   *
   * Require fundamentally different ventilation from Li-ion due to H₂ gas evolution.
   *
   * REGULATORY BASIS:
   *   OSHA 29 CFR 1926.403(i) — Battery Charging:
   *     Minimum 1 CFM/ft² continuous supply, or engineered ventilation to keep
   *     H₂ < 1% by volume (25% LEL).
   *   IEEE 1184-2006 §6.8: size exhaust from H₂ evolution rate per cell
   *     (0.04 ft³/hr per Ah per cell during formation cycling).
   *   NFPA 70 Article 480.9(A): ventilation per manufacturer spec or AHJ.
   *
   * ra: 1.0 CFM/ft² — OSHA 29 CFR 1926.403(i) minimum for battery charging areas.
   *   Greatly exceeds ASHRAE 62.1 minimum of 0.18 CFM/ft² for labs.
   *   OSHA basis governs — must be applied to comply with 1926.403(i).
   *
   * minAch: 12 — conservative basis for high-bay formation areas.
   *   For a 40-ft ceiling bay (typical Exide formation hall):
   *   12 ACPH × (area × 40 ft) / 60 = 8 cfm/ft² vs OSHA 1 CFM/ft² minimum.
   *   H₂ (lighter than air) stratifies near the ceiling — high-bay spaces
   *   require elevated ACH to ensure adequate dilution near the roof.
   *
   * EXHAUST SYSTEM NOTE:
   *   H₂SO₄ mist requires a SEPARATE acid-resistant exhaust system with wet scrubber.
   *   Duct material: Type 316L SS or FRP. Do NOT combine with general exhaust.
   *   Not the same as Li-ion NMP/HF scrubber systems.
   */
  'battery-leadacid': {
    label:     'Battery — Lead-Acid Formation / Charging',
    rp:        5,
    ra:        1.0,      // OSHA 29 CFR 1926.403(i): 1 CFM/ft² minimum supply
    defaultEz: 1.0,
    minAch:    12,       // H₂ dilution in high-bay — conservative basis
    note:      'OSHA 29 CFR 1926.403(i): minimum 1 CFM/ft² for battery charging rooms. '
             + 'IEEE 1184-2006 §6.8: size exhaust from H₂ evolution rate per cell. '
             + 'H₂SO₄ mist requires acid-resistant (316L SS or FRP) exhaust + wet scrubber. '
             + 'Do NOT combine H₂SO₄ exhaust with general building exhaust system. '
             + 'Humidity target: 30–60%RH. Sub-10%RH desiccant is NOT required here.',
  },

  // ── Solar / PV Manufacturing ───────────────────────────────────────────────
  solar: {
    label:     'Solar / PV Manufacturing',
    rp:        5,
    ra:        0.18,
    defaultEz: 1.0,
    minAch:    6,
    note:      'ASHRAE 62.1-2022 Table 6-1, Laboratory — Chemical. HF acid areas require dedicated exhaust.',
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
  corridor: {
    label:     'Corridor / Lobby',
    rp:        0,        // Non-occupiable transitional space — ASHRAE 62.1 Table 6-1
    ra:        0.06,
    defaultEz: 1.0,
    minAch:    0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Corridor. Rp = 0 (non-occupiable).',
  },

  // ── Utility / Mechanical Room ──────────────────────────────────────────────
  utility: {
    label:     'Utility / Mechanical Room',
    rp:        0,        // No regular occupancy — ASHRAE 62.1 Table 6-1
    ra:        0.06,
    defaultEz: 1.0,
    minAch:    0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Mechanical/Electrical Room. Rp = 0 (non-occupiable).',
  },

  // ── Gowning / Change Room ──────────────────────────────────────────────────
  gowning: {
    label:     'Gowning / Change Room',
    rp:        5,
    ra:        0.10,
    defaultEz: 1.0,
    minAch:    10,
    note:      'ASHRAE 62.1-2022 Table 6-1, Locker/Dressing Room. Pressure cascade to adjacent cleanroom typically governs.',
  },

  // ── Canteen / Cafeteria ────────────────────────────────────────────────────
  canteen: {
    label:     'Canteen / Cafeteria',
    rp:        7.5,
    ra:        0.18,
    defaultEz: 1.0,
    minAch:    0,
    note:      'ASHRAE 62.1-2022 Table 6-1, Food and Beverage Service.',
  },
};

// ── Convenience accessor ──────────────────────────────────────────────────────

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
 * Vbz = Rp × Pz + Ra × Az
 * Returns Voz = Vbz / Ez — the zone OA intake rate (CFM).
 * Rounding is the caller's responsibility.
 */
export const calculateVbz = (ventCategory, pplCount, floorAreaFt2, ezOverride) => {
  const { rp, ra, ez } = getRpRa(ventCategory);
  const effectiveEz = ezOverride ?? ez;
  const vbz = (rp * (parseFloat(pplCount)    || 0))
            + (ra * (parseFloat(floorAreaFt2) || 0));
  return vbz / effectiveEz;
};

/**
 * calculateMinAchCfm(ventCategory, volumeFt3)
 *
 * Returns the minimum supply CFM from the regulatory ACH floor for this
 * ventilation category (NFPA 855, OSHA, GMP Annex 1 etc.).
 * airQuantities.js takes max(calculateVbz, calculateMinAchCfm, exhaustMakeup).
 */
export const calculateMinAchCfm = (ventCategory, volumeFt3) => {
  const { minAch } = getRpRa(ventCategory);
  if (!minAch || !volumeFt3) return 0;
  return (minAch * (parseFloat(volumeFt3) || 0)) / 60;
};

// ── UI option list ────────────────────────────────────────────────────────────
// Auto-generated from VENTILATION_CATEGORIES — always in sync.
// Import this in any component that needs a ventilation category dropdown
// rather than defining a local copy.
export const VENTILATION_CATEGORY_OPTIONS = Object.entries(VENTILATION_CATEGORIES)
  .map(([value, cat]) => ({ value, label: cat.label }));

// ── ASHRAE 62.1-2022 Table 6-1 reference (detailed) ──────────────────────────
export const ASHRAE_621_TABLE_6_1 = [
  { spaceType: 'Classroom (ages 5–8)',         rp: 10,  ra: 0.12, category: 'Educational'   },
  { spaceType: 'Classroom (ages 9+)',           rp: 10,  ra: 0.12, category: 'Educational'   },
  { spaceType: 'Lecture Classroom',             rp: 7.5, ra: 0.06, category: 'Educational'   },
  { spaceType: 'Lecture Hall (fixed seating)',  rp: 7.5, ra: 0.06, category: 'Educational'   },
  { spaceType: 'Art Classroom',                 rp: 10,  ra: 0.18, category: 'Educational'   },
  { spaceType: 'Science Laboratory',            rp: 10,  ra: 0.18, category: 'Educational'   },
  { spaceType: 'Office Space',                  rp: 5,   ra: 0.06, category: 'Office'        },
  { spaceType: 'Reception Areas',               rp: 5,   ra: 0.06, category: 'Office'        },
  { spaceType: 'Telephone / Data Entry',        rp: 5,   ra: 0.06, category: 'Office'        },
  { spaceType: 'Conference / Meeting',          rp: 5,   ra: 0.06, category: 'Office'        },
  { spaceType: 'Corridor',                      rp: 0,   ra: 0.06, category: 'General'       },
  { spaceType: 'Storage Rooms',                 rp: 0,   ra: 0.12, category: 'General'       },
  { spaceType: 'Laboratory — General',          rp: 5,   ra: 0.18, category: 'Industrial'    },
  { spaceType: 'Laboratory — Chemical',         rp: 5,   ra: 0.18, category: 'Industrial'    },
  { spaceType: 'Cleanroom (ISO 5–8)',           rp: 5,   ra: 0.18, category: 'Industrial'    },
  { spaceType: 'Warehousing',                   rp: 5,   ra: 0.06, category: 'Industrial'    },
  { spaceType: 'Sales Floor',                   rp: 7.5, ra: 0.12, category: 'Retail'        },
  { spaceType: 'Mall Common Areas',             rp: 7.5, ra: 0.06, category: 'Retail'        },
  { spaceType: 'Restaurant Dining Rooms',       rp: 7.5, ra: 0.18, category: 'Food'          },
  { spaceType: 'Cafeteria / Fast Food',         rp: 7.5, ra: 0.18, category: 'Food'          },
  { spaceType: 'Bar / Cocktail Lounge',         rp: 7.5, ra: 0.18, category: 'Food'          },
  { spaceType: 'Kitchen — Commercial',          rp: 7.5, ra: 0.12, category: 'Food'          },
  { spaceType: 'Patient Rooms',                 rp: 5,   ra: 0.06, category: 'Healthcare'    },
  { spaceType: 'Medical Procedure Room',        rp: 5,   ra: 0.06, category: 'Healthcare'    },
  { spaceType: 'Operating Rooms',               rp: 5,   ra: 0.06, category: 'Healthcare'    },
  { spaceType: 'Pharmacy',                      rp: 5,   ra: 0.18, category: 'Healthcare'    },
  { spaceType: 'Bedroom / Living Room',         rp: 5,   ra: 0.06, category: 'Hospitality'   },
  { spaceType: 'Hotel Lobby',                   rp: 7.5, ra: 0.06, category: 'Hospitality'   },
  { spaceType: 'Laundry Rooms — Commercial',    rp: 5,   ra: 0.12, category: 'Hospitality'   },
];