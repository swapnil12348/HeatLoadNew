/**
 * EnvelopeConfig.jsx
 * Responsibility: Envelope layers and internal heat gains editor.
 *
 * ── CHANGELOG v2.1 ────────────────────────────────────────────────────────────
 *
 *   BUG-UI-17 [MEDIUM — UNIT BUG] — infiltration CFM preview uses correct m³→ft³ factor.
 *
 *     activeRoom.volume is m³ (roomSlice stores SI units).
 *     m³ → ft³ requires × 35.3147, NOT × 10.7639 (which is ft²/m² — an area factor).
 *
 *     Impact: For a 300 m³ room:
 *       Correct:  300 × 35.3147 = 10,594 ft³ → CFM preview is correct
 *       Previous: 300 × 10.7639 =  3,229 ft³ → CFM preview was 3.28× too low
 *
 *     The actual infiltration calculation in envelopeCalc.js is unaffected —
 *     it converts units internally. This was a display-only preview bug, but an
 *     engineer reading "42 CFM" instead of "138 CFM" would have wrong context
 *     when entering ACPH values.
 *
 *   BUG-UI-18 [MEDIUM — UNIT BUG] — equipment preview: ASHRAE.KW_TO_BTU → KW_TO_BTU_HR.
 *
 *     ASHRAE.KW_TO_BTU is not a valid export from ashrae.js. Using it produces
 *     undefined → NaN in all three equipment preview values (sensible, latent,
 *     rejected-to-CW). Engineers see "NaN BTU/hr" for any non-zero equipment kW.
 *
 *     Fix: import KW_TO_BTU_HR from utils/units.js — the same fix applied to
 *     seasonalLoads.js (BUG-SL-02) and heatingHumid.js (BUG-HH-03).
 *
 *   BUG-UI-16 [LOW] — unused React import removed.
 *     Vite with React 17+ automatic JSX transform does not require explicit import.
 */

import { useSelector, useDispatch }      from 'react-redux';
import { selectActiveRoom }              from '../features/room/roomSlice';
import {
  selectActiveEnvelope,
  updateInternalLoad,
  initializeRoom,
  updateInfiltration,
}                                        from '../features/envelope/envelopeSlice';
import RoomSidebar                       from '../components/Layout/RoomSidebar';
import BuildingShell                     from '../features/envelope/BuildingShell';
import ASHRAE                            from '../constants/ashrae';
import { KW_TO_BTU_HR }                  from '../utils/units';

// m³ → ft³ conversion. Standard: 1 m³ = 35.3147 ft³.
// ASHRAE.M2_TO_FT2 (10.7639) is ft²/m² — an AREA factor, not a volume factor.
const M3_TO_FT3 = 35.3147;

// ── Unit conversion ──────────────────────────────────────────────────────────
const celsiusToFahrenheit = (c) => (parseFloat(c) * 9) / 5 + 32;

// ── ASHRAE Fundamentals Table 1, Ch 18 — People Heat Gain by Activity ────────
const ACTIVITY_LEVELS = [
  { label: 'Seated, at rest (theatre, auditorium)',            sensible: 245, latent: 205 },
  { label: 'Seated, light work (office, hotel lobby)',         sensible: 275, latent: 275 },
  { label: 'Seated, eating (restaurant)',                      sensible: 275, latent: 325 },
  { label: 'Light bench work — standing (lab, cleanroom)',     sensible: 315, latent: 245 },
  { label: 'Light machine work / walking (factory floor)',     sensible: 395, latent: 395 },
  { label: 'Moderate work — lifting, assembly',                sensible: 425, latent: 575 },
  { label: 'Heavy work (foundry, heavy machine)',              sensible: 580, latent: 870 },
];

// ── Ballast factor presets — ASHRAE HOF 2021 Ch.18 Table 2 ───────────────────
const BALLAST_PRESETS = [
  { label: 'LED (1.0)',             value: 1.0  },
  { label: 'T5 fluorescent (1.15)', value: 1.15 },
  { label: 'T8 fluorescent (1.2)',  value: 1.2  },
  { label: 'Metal halide (1.1)',    value: 1.1  },
  { label: 'Custom',                value: null },
];

// ── Simple number input ──────────────────────────────────────────────────────
const LoadInput = ({ label, value, onChange, unit, step = '1', note }) => (
  <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">{label}</label>
    <div className="flex items-center gap-2">
      <input
        type="number"
        step={step}
        value={value}
        onChange={onChange}
        className="w-full border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
      />
      <span className="text-gray-400 text-xs font-medium w-10 shrink-0">{unit}</span>
    </div>
    {note && <p className="text-[10px] text-gray-400 mt-1.5">{note}</p>}
  </div>
);

// ── Section header ───────────────────────────────────────────────────────────
const SectionHeader = ({ color, title, sub }) => (
  <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
    <span className={`w-1 h-5 ${color} rounded-full`} />
    {title}
    {sub && <span className="text-xs font-normal text-gray-400 ml-1">{sub}</span>}
  </h2>
);

// ── Main Component ───────────────────────────────────────────────────────────
export default function EnvelopeConfig() {
  const dispatch   = useDispatch();
  const activeRoom = useSelector(selectActiveRoom);
  const envelope   = useSelector(selectActiveEnvelope);
  const climate    = useSelector((state) => state.climate);

  // Use { id, room } payload so initializeRoom can apply the ISO classification
  // guard (achValue = 0 for positively pressurized rooms).
  const ensureRoom = () => {
    dispatch(initializeRoom({ id: activeRoom.id, room: activeRoom }));
  };

  const handleLoadChange = (type, field, val) => {
    ensureRoom();
    dispatch(updateInternalLoad({
      roomId: activeRoom.id,
      type,
      data: { [field]: parseFloat(val) || 0 },
    }));
  };

  const handleActivityChange = (idx) => {
    const activity = ACTIVITY_LEVELS[parseInt(idx)];
    if (!activity) return;
    ensureRoom();
    dispatch(updateInternalLoad({
      roomId: activeRoom.id,
      type: 'people',
      data: {
        sensiblePerPerson: activity.sensible,
        latentPerPerson:   activity.latent,
      },
    }));
  };

  const handleInfiltrationChange = (val) => {
    ensureRoom();
    dispatch(updateInfiltration({
      roomId: activeRoom.id,
      field: 'achValue',
      value: parseFloat(val) || 0,
    }));
  };

  if (!activeRoom) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-400">
        Select a room to configure its envelope.
      </div>
    );
  }

  // tRoomF is passed to BuildingShell as tRoom (°F).
  // All envelope calc functions (calcWallGain, calcRoofGain, calcPartitionGain)
  // expect °F — this conversion is the single point where °C → °F happens for UI.
  const tRoomF = isNaN(parseFloat(activeRoom.designTemp))
    ? 72
    : celsiusToFahrenheit(activeRoom.designTemp);

  const currentSensible    = envelope.internalLoads?.people?.sensiblePerPerson ?? 245;
  const currentActivityIdx = ACTIVITY_LEVELS.findIndex(a => a.sensible === currentSensible);
  const activitySelectVal  = currentActivityIdx >= 0 ? currentActivityIdx : 0;

  const equipSensPct = envelope.internalLoads?.equipment?.sensiblePct ?? 100;
  const equipLatPct  = envelope.internalLoads?.equipment?.latentPct   ?? 0;

  const useSchedule = envelope.internalLoads?.lights?.useSchedule ?? 100;
  const schedFactor = useSchedule / 100;

  const ballastFactor = envelope.internalLoads?.lights?.ballastFactor
    ?? ASHRAE.LIGHTING_BALLAST_FACTOR;
  const isCustomBallast = !BALLAST_PRESETS.some(
    p => p.value !== null && p.value === ballastFactor
  );

  const diversityFactor = envelope.internalLoads?.equipment?.diversityFactor
    ?? ASHRAE.PROCESS_DIVERSITY_FACTOR;

  const equipKW = envelope.internalLoads?.equipment?.kw || 0;

  // Equipment preview — KW_TO_BTU_HR from units.js (3412.14 BTU/hr per kW).
  // ASHRAE.KW_TO_BTU is not a valid export and would produce NaN.
  const equipSensPreview = Math.round(
    equipKW * KW_TO_BTU_HR * (equipSensPct / 100) * diversityFactor
  );
  const equipLatPreview = Math.round(
    equipKW * KW_TO_BTU_HR * (equipLatPct / 100) * diversityFactor
  );
  const equipCwPreview = Math.max(0, Math.round(
    equipKW * KW_TO_BTU_HR * (1 - equipSensPct / 100 - equipLatPct / 100) * diversityFactor
  ));

  // Lighting preview — floorArea is m² (roomSlice SI); × M2_TO_FT2 → ft².
  const lightsWpFt2       = parseFloat(envelope.internalLoads?.lights?.wattsPerSqFt) || 0;
  const lightsSensPreview = Math.round(
    lightsWpFt2 * (activeRoom.floorArea || 0) * ASHRAE.M2_TO_FT2
    * ASHRAE.BTU_PER_WATT * schedFactor * ballastFactor
  );

  // Infiltration preview — volume is m³ (roomSlice SI); × M3_TO_FT3 → ft³.
  const volumeFt3              = (parseFloat(activeRoom.volume) || 0) * M3_TO_FT3;
  const infiltrationCFMPreview = Math.round(
    volumeFt3 * parseFloat(envelope.infiltration?.achValue || 0) / 60
  );

  const isIsoRoom = activeRoom.classInOp && activeRoom.classInOp !== 'Unclassified';

  return (
    <div className="flex h-[calc(100vh-64px)] bg-gray-50">
      <RoomSidebar />

      <div className="flex-1 overflow-y-auto p-8">

        {/* ── Page Header ── */}
        <header className="mb-8 border-b border-gray-200 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-100 text-blue-700">
              Active Zone
            </span>
            <span className="text-sm text-gray-400 font-mono">#{activeRoom.id}</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">{activeRoom.name}</h1>
          <p className="text-gray-500 mt-1">
            Configure envelope layers and internal heat gains.
          </p>
          <p className="text-[11px] text-indigo-500 font-mono mt-1">
            Indoor design: {activeRoom.designTemp ?? '—'}°C
            → {tRoomF.toFixed(1)}°F used for CLTD corrections
          </p>
        </header>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 1 — PEOPLE
        ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-10">
          <SectionHeader
            color="bg-green-500"
            title="People (Occupancy)"
            sub="ASHRAE Fundamentals Table 1, Ch 18"
          />

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <LoadInput
                label="Occupancy Count"
                value={envelope.internalLoads?.people?.count || 0}
                unit="people"
                onChange={(e) => handleLoadChange('people', 'count', e.target.value)}
              />
              <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                  Activity Level
                </label>
                <select
                  value={activitySelectVal}
                  onChange={(e) => handleActivityChange(e.target.value)}
                  className="w-full border-gray-300 rounded-md shadow-sm text-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  {ACTIVITY_LEVELS.map((a, i) => (
                    <option key={i} value={i}>{a.label}</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-1.5">
                  For cleanrooms / pharma labs select "Light bench work — standing"
                </p>
              </div>
            </div>

            <div className="mt-4 flex gap-4 flex-wrap">
              <div className="bg-orange-50 border border-orange-100 rounded-lg px-4 py-2 flex items-center gap-2">
                <span className="text-xs font-bold text-orange-700 uppercase">Sensible</span>
                <span className="font-mono text-sm font-bold text-orange-900">
                  {envelope.internalLoads?.people?.sensiblePerPerson ?? 245} BTU/hr·person
                </span>
              </div>
              <div className="bg-sky-50 border border-sky-100 rounded-lg px-4 py-2 flex items-center gap-2">
                <span className="text-xs font-bold text-sky-700 uppercase">Latent</span>
                <span className="font-mono text-sm font-bold text-sky-900">
                  {envelope.internalLoads?.people?.latentPerPerson ?? 205} BTU/hr·person
                </span>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 flex items-center gap-2">
                <span className="text-xs font-bold text-gray-500 uppercase">Total</span>
                <span className="font-mono text-sm font-bold text-gray-700">
                  {((envelope.internalLoads?.people?.sensiblePerPerson ?? 245)
                    + (envelope.internalLoads?.people?.latentPerPerson ?? 205))
                    * (envelope.internalLoads?.people?.count || 0)
                  } BTU/hr
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 2 — LIGHTING
        ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-10">
          <SectionHeader
            color="bg-yellow-400"
            title="Lighting"
            sub="ASHRAE HOF 2021 Ch.18 — schedule and ballast factor applied"
          />

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

              <LoadInput
                label="Lighting Density"
                value={lightsWpFt2}
                unit="W/ft²"
                step="0.1"
                onChange={(e) => handleLoadChange('lights', 'wattsPerSqFt', e.target.value)}
                note="Typical: 1.0–2.0 office · 1.5–3.0 cleanroom · 0.5 warehouse"
              />

              <LoadInput
                label="Operating Schedule"
                value={useSchedule}
                unit="%"
                step="5"
                onChange={(e) => handleLoadChange('lights', 'useSchedule', e.target.value)}
                note="% of occupied hours lights are ON. 100% = always on (24/7 cleanroom default)"
              />

              <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                  Ballast Factor
                  <span className="ml-1 text-[9px] text-indigo-500 normal-case">ASHRAE HOF Ch.18 Table 2</span>
                </label>
                <select
                  value={isCustomBallast ? 'custom' : ballastFactor}
                  onChange={(e) => {
                    const val = e.target.value === 'custom' ? 1.0 : parseFloat(e.target.value);
                    handleLoadChange('lights', 'ballastFactor', val);
                  }}
                  className="w-full border-gray-300 rounded-md shadow-sm text-sm focus:border-blue-500 focus:ring-blue-500 mb-2"
                >
                  {BALLAST_PRESETS.map((p, i) => (
                    <option key={i} value={p.value === null ? 'custom' : p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {isCustomBallast && (
                  <input
                    type="number"
                    step="0.01"
                    min="0.8"
                    max="1.5"
                    value={ballastFactor}
                    onChange={(e) => handleLoadChange('lights', 'ballastFactor', e.target.value)}
                    className="w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                    placeholder="Custom ballast factor"
                  />
                )}
                <p className="text-[10px] text-gray-400 mt-1">
                  LED = 1.0 · T8 = 1.2 · T5 = 1.15
                </p>
              </div>
            </div>

            {lightsWpFt2 > 0 && (
              <div className="flex gap-4 flex-wrap items-center">
                <div className="bg-yellow-50 border border-yellow-100 rounded-lg px-4 py-2 flex items-center gap-2">
                  <span className="text-xs font-bold text-yellow-700 uppercase">Sensible Load</span>
                  <span className="font-mono text-sm font-bold text-yellow-900">
                    {lightsSensPreview.toLocaleString()} BTU/hr
                  </span>
                </div>
                <p className="text-[10px] text-gray-400">
                  = {lightsWpFt2} W/ft² × {((activeRoom.floorArea || 0) * ASHRAE.M2_TO_FT2).toFixed(0)} ft²
                  × {ASHRAE.BTU_PER_WATT.toFixed(3)} BTU/W
                  × {(schedFactor * 100).toFixed(0)}% schedule
                  × {ballastFactor} BF
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 3 — EQUIPMENT
        ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-10">
          <SectionHeader
            color="bg-purple-500"
            title="Process Equipment"
            sub="ASHRAE Fundamentals Ch 18 — adjust fractions per equipment type"
          />

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

              <LoadInput
                label="Total Equipment Load"
                value={equipKW}
                unit="kW"
                step="0.1"
                onChange={(e) => handleLoadChange('equipment', 'kw', e.target.value)}
                note="Sum of all electrical input power in this room"
              />

              <LoadInput
                label="Sensible Fraction"
                value={equipSensPct}
                unit="%"
                step="1"
                onChange={(e) => handleLoadChange('equipment', 'sensiblePct', e.target.value)}
                note="Motors, drives, lighting ballasts → 100%"
              />

              <LoadInput
                label="Latent Fraction"
                value={equipLatPct}
                unit="%"
                step="1"
                onChange={(e) => handleLoadChange('equipment', 'latentPct', e.target.value)}
                note="Autoclaves, wash stations, open baths → 20–60%"
              />

              <LoadInput
                label="Diversity Factor"
                value={diversityFactor}
                unit="×"
                step="0.05"
                onChange={(e) => handleLoadChange('equipment', 'diversityFactor', e.target.value)}
                note="Fraction of installed kW simultaneously active. ASHRAE default: 0.75. Critical single tool: 1.0"
              />
            </div>

            {(equipSensPct + equipLatPct) > 100 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 font-medium">
                ⚠ Sensible + Latent fractions exceed 100%.
                Valid only if equipment has internal cooling (cooling water removes the difference).
                Verify with equipment data sheet.
              </div>
            )}

            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-[11px] text-indigo-700">
              <strong>Diversity factor</strong> — only the fraction shown of installed kW is assumed
              simultaneously active. ASHRAE PROCESS_DIVERSITY_FACTOR default is 0.75 (75%).
              For a single critical process tool always running, set 1.0.
              Source: ASHRAE HOF 2021 Ch.18; ASHRAE TC 9.9.
            </div>

            <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">
                ASHRAE Reference — Typical Equipment Fractions
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-[11px] text-gray-600">
                <span>Electric motors (totally enclosed): <strong>100% sensible, 0% latent</strong></span>
                <span>PC / server / drives: <strong>100% sensible, 0% latent</strong></span>
                <span>Autoclave / steam sterilizer: <strong>30% sensible, 70% latent</strong></span>
                <span>Washer / parts cleaner (open): <strong>40% sensible, 60% latent</strong></span>
                <span>Refrigeration (condensing unit in room): <strong>100% sensible, 0% latent</strong></span>
                <span>Open-bath chemical process: <strong>20% sensible, 80% latent</strong></span>
                <span>Induction furnace / plasma: <strong>100% sensible, 0% latent</strong></span>
                <span>Battery formation cycling (liquid-cooled): <strong>30% sensible, 0% latent</strong></span>
              </div>
            </div>

            {equipKW > 0 && (
              <div className="flex gap-4 flex-wrap items-center">
                <div className="bg-orange-50 border border-orange-100 rounded-lg px-4 py-2 flex items-center gap-2">
                  <span className="text-xs font-bold text-orange-700 uppercase">Sensible</span>
                  <span className="font-mono text-sm font-bold text-orange-900">
                    {equipSensPreview.toLocaleString()} BTU/hr
                  </span>
                </div>
                <div className="bg-sky-50 border border-sky-100 rounded-lg px-4 py-2 flex items-center gap-2">
                  <span className="text-xs font-bold text-sky-700 uppercase">Latent</span>
                  <span className="font-mono text-sm font-bold text-sky-900">
                    {equipLatPreview.toLocaleString()} BTU/hr
                  </span>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-500 uppercase">Rejected to CW</span>
                  <span className="font-mono text-sm font-bold text-gray-700">
                    {equipCwPreview.toLocaleString()} BTU/hr
                  </span>
                </div>
                <p className="text-[10px] text-gray-400">
                  after {(diversityFactor * 100).toFixed(0)}% diversity factor applied
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 4 — INFILTRATION
        ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-10">
          <SectionHeader color="bg-orange-500" title="Infiltration" />

          {isIsoRoom && (envelope.infiltration?.achValue || 0) > 0 && (
            <div className="mb-4 bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm text-amber-800">
              ⚠ <strong>{activeRoom.classInOp}</strong> is a positively pressurized cleanroom.
              Infiltration should be <strong>0 ACPH</strong> — positive pressure prevents external
              air ingress. Non-zero ACH will add phantom loads to this room.
              Reference: ISO 14644-4:2022 §6.4.
            </div>
          )}

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm max-w-lg">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
              Infiltration Rate
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.05"
                min="0"
                value={envelope.infiltration?.achValue ?? 0}
                onChange={(e) => handleInfiltrationChange(e.target.value)}
                className="w-40 border-gray-300 rounded-md shadow-sm focus:border-blue-500 sm:text-sm"
              />
              <span className="text-gray-500 text-sm font-medium">ACPH</span>
            </div>

            <div className="mt-3 text-[10px] text-gray-400 space-y-1">
              <p>
                CFM = Volume(ft³) × ACPH / 60
                = {volumeFt3.toFixed(0)} ft³
                × {envelope.infiltration?.achValue ?? 0} / 60
                = <strong>{infiltrationCFMPreview} CFM</strong>
              </p>
              <p className="text-[9px] text-gray-300">
                Volume(ft³) = {(parseFloat(activeRoom.volume) || 0).toFixed(1)} m³ × 35.3147 = {volumeFt3.toFixed(0)} ft³
              </p>
              <p>
                <strong>Pressurized rooms (any ISO class):</strong> 0 ACPH — positive pressure blocks ingress. &nbsp;
                <strong>Sealed unpressurized:</strong> 0.1–0.25 ACPH. &nbsp;
                <strong>Office / general:</strong> 0.25–0.5 ACPH. &nbsp;
                <strong>Leaky building:</strong> 0.5–1.5 ACPH.
              </p>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 5 — BUILDING SHELL
        ═══════════════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader color="bg-indigo-500" title="Building Shell" />
          <BuildingShell
            roomId={activeRoom.id}
            elements={envelope.elements}
            climate={climate}
            tRoom={tRoomF}
          />
        </section>

      </div>
    </div>
  );
}