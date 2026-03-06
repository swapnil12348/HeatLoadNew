/**
 * RDSConfig.js
 * Single source of truth for all RDS column definitions.
 *
 * This file is a PURE ASSEMBLER — it contains no column definitions.
 * All sections live in ./sections/ and are categorised by concern:
 *
 *   setupSections.js    — room identity, geometry, design conditions, ISO class
 *   loadsSections.js    — internal loads, exhaust, fan heat, fresh air, OA loads
 *   resultsSections.js  — ACES summary, analysis, humidification, terminal heating
 *   psychroSections.js  — all AHU air stream psychrometric state points
 *
 * To add a column: find the relevant section file and add the column there.
 * To add a section: create it in the right category file and it appears automatically.
 * To reorder sections within a category: reorder the array in that file.
 */

import { SETUP_SECTIONS }   from './sections/setupSections';
import { LOADS_SECTIONS }   from './sections/loadsSections';
import { RESULTS_SECTIONS } from './sections/resultsSections';
import { PSYCHRO_SECTIONS } from './sections/psychroSections';

// ── Assembled section list ─────────────────────────────────────────────────
export const RDS_SECTIONS = [
  ...SETUP_SECTIONS,
  ...LOADS_SECTIONS,
  ...RESULTS_SECTIONS,
  ...PSYCHRO_SECTIONS,
];

// ── Derived utilities ──────────────────────────────────────────────────────

/**
 * Flat map of ALL column definitions keyed by col.key.
 * Used by RDSRow and RoomDetailPanel for O(1) column lookup.
 */
export const RDS_COLUMNS_MAP = Object.fromEntries(
  RDS_SECTIONS.flatMap((s) =>
    s.columns.map((c) => [c.key, { ...c, sectionId: s.id, category: s.category }])
  )
);

/**
 * Keys of every column that dispatches to envelopeSlice (isEnv: true).
 * Used by RDSRow to route updates correctly.
 */
export const ENV_COLUMN_KEYS = RDS_SECTIONS
  .flatMap((s) => s.columns)
  .filter((c) => c.isEnv)
  .map((c) => c.key);

/**
 * All sections belonging to a given category.
 * Used by RoomDetailPanel tab rendering.
 */
export const getSectionsByCategory = (category) =>
  RDS_SECTIONS.filter((s) => s.category === category);

/**
 * Category tab manifest — drives the tab bar in RoomDetailPanel and RDSPage.
 * Order here controls tab order in the UI.
 */
export const RDS_CATEGORIES = [
  { id: 'setup',   label: 'Setup',           icon: '⚙️'  },
  { id: 'loads',   label: 'Loads & Exhaust', icon: '🔥'  },
  { id: 'results', label: 'Results',          icon: '📊'  },
  { id: 'psychro', label: 'Psychrometrics',   icon: '🌡️' },
];

// ── Re-export field utils ──────────────────────────────────────────────────
// RDSRow and RoomDetailPanel import these from 'RDSConfig' — unchanged.
export { getFieldValue, buildRoomUpdate } from './rdsFieldUtils';