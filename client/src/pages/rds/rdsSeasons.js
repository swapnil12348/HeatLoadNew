// ── Season constants ───────────────────────────────────────────────────────

export const SEASONS       = ['summer', 'monsoon', 'winter'];
export const SEASON_LABELS = { summer: 'Summer', monsoon: 'Monsoon', winter: 'Winter' };

// ── Column factory helpers ─────────────────────────────────────────────────

/**
 * One column per season.
 * createSeasonColumns('ershOn', 'ERSH', 'BTU/Hr', { readOnly: true })
 */
export const createSeasonColumns = (keyPrefix, label, subLabel, opts = {}) =>
  SEASONS.map((s) => ({
    key: `${keyPrefix}_${s}`,
    label,
    subLabel,
    seasonLabel: SEASON_LABELS[s],
    type: opts.readOnly ? 'readOnly' : (opts.type ?? 'number'),
    derived: opts.derived ?? false,
    ...opts,
  }));

/**
 * Two columns (A + B) per season — e.g. Temp + RH.
 * createSeasonPairs('achOn', 'Temp', 'RH', '°F', '%', { readOnly: true })
 */
export const createSeasonPairs = (
  keyPrefix,
  labelA, labelB,
  subLabelA, subLabelB,
  opts = {}
) =>
  SEASONS.flatMap((s) => [
    {
      key: `${keyPrefix}_temp_${s}`,
      label: labelA,
      subLabel: subLabelA,
      seasonLabel: SEASON_LABELS[s],
      type: opts.readOnly ? 'readOnly' : (opts.type ?? 'number'),
      derived: opts.derived ?? false,
      ...opts,
    },
    {
      key: `${keyPrefix}_rh_${s}`,
      label: labelB,
      subLabel: subLabelB,
      seasonLabel: SEASON_LABELS[s],
      type: opts.readOnly ? 'readOnly' : (opts.type ?? 'number'),
      derived: opts.derived ?? false,
      ...opts,
    },
  ]);

/**
 * Four columns (DB, WB, gr/lb, Enthalpy) per season — full psychrometric block.
 * createPsychroColumns('amb')
 */
export const createPsychroColumns = (keyPrefix, opts = {}) =>
  SEASONS.flatMap((s) => [
    { key: `${keyPrefix}_db_${s}`,   label: 'DB',       subLabel: '°F',     seasonLabel: SEASON_LABELS[s], type: opts.readOnly ? 'readOnly' : 'number', ...opts },
    { key: `${keyPrefix}_wb_${s}`,   label: 'WB',       subLabel: '°F',     seasonLabel: SEASON_LABELS[s], type: opts.readOnly ? 'readOnly' : 'number', ...opts },
    { key: `${keyPrefix}_gr_${s}`,   label: 'gr/lb',    subLabel: 'gr/lb',  seasonLabel: SEASON_LABELS[s], type: 'readOnly', derived: true, ...opts },
    { key: `${keyPrefix}_enth_${s}`, label: 'Enthalpy', subLabel: 'BTU/lb', seasonLabel: SEASON_LABELS[s], type: 'readOnly', derived: true, ...opts },
  ]);

/**
 * Three columns (DB, WB, gr/lb) per season — return air (no enthalpy).
 * createReturnAirColumns('ra')
 */
export const createReturnAirColumns = (keyPrefix, opts = {}) =>
  SEASONS.flatMap((s) => [
    { key: `${keyPrefix}_db_${s}`, label: 'DB',    subLabel: '°F',    seasonLabel: SEASON_LABELS[s], type: opts.readOnly ? 'readOnly' : 'number', ...opts },
    { key: `${keyPrefix}_wb_${s}`, label: 'WB',    subLabel: '°F',    seasonLabel: SEASON_LABELS[s], type: opts.readOnly ? 'readOnly' : 'number', ...opts },
    { key: `${keyPrefix}_gr_${s}`, label: 'gr/lb', subLabel: 'gr/lb', seasonLabel: SEASON_LABELS[s], type: 'readOnly', derived: true, ...opts },
  ]);