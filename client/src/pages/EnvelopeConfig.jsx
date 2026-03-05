import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { selectActiveRoom } from '../features/room/roomSlice';
import {
  selectActiveEnvelope,
  updateInternalLoad,
  initializeRoom,
  updateInfiltration,
} from '../features/envelope/envelopeSlice';
import RoomSidebar from '../components/Layout/RoomSidebar';
import BuildingShell from '../features/envelope/BuildingShell';

// ── Unit conversion ──────────────────────────────────────────────────────────
const celsiusToFahrenheit = (c) => (parseFloat(c) * 9) / 5 + 32;

// ── ASHRAE Fundamentals Table 1, Ch 18 — People Heat Gain by Activity ────────
// Values: [sensible BTU/hr, latent BTU/hr]
// Use the closest activity description for the actual room occupancy type.
const ACTIVITY_LEVELS = [
  { label: 'Seated, at rest (theatre, auditorium)',            sensible: 245, latent: 205 },
  { label: 'Seated, light work (office, hotel lobby)',         sensible: 275, latent: 275 },
  { label: 'Seated, eating (restaurant)',                      sensible: 275, latent: 325 },
  { label: 'Light bench work — standing (lab, cleanroom)',     sensible: 315, latent: 245 },
  { label: 'Light machine work / walking (factory floor)',     sensible: 395, latent: 395 },
  { label: 'Moderate work — lifting, assembly',                sensible: 425, latent: 575 },
  { label: 'Heavy work (foundry, heavy machine)',              sensible: 580, latent: 870 },
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

  const handleLoadChange = (type, field, val) => {
    dispatch(initializeRoom(activeRoom.id));
    dispatch(updateInternalLoad({
      roomId: activeRoom.id,
      type,
      data: { [field]: parseFloat(val) || 0 },
    }));
  };

  // Activity level selector — writes both sensiblePerPerson and latentPerPerson
  // in a single dispatch so the two values stay in sync.
  const handleActivityChange = (idx) => {
    const activity = ACTIVITY_LEVELS[parseInt(idx)];
    if (!activity) return;
    dispatch(initializeRoom(activeRoom.id));
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
    dispatch(initializeRoom(activeRoom.id));
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

  const tRoomF = isNaN(parseFloat(activeRoom.designTemp))
    ? 72
    : celsiusToFahrenheit(activeRoom.designTemp);

  // Derive current activity index for the <select> controlled value
  const currentSensible  = envelope.internalLoads?.people?.sensiblePerPerson
    ?? 245;
  const currentActivityIdx = ACTIVITY_LEVELS.findIndex(
    (a) => a.sensible === currentSensible
  );
  const activitySelectVal = currentActivityIdx >= 0 ? currentActivityIdx : 0;

  // Equipment pct values — clamp display to 0–100
  const equipSensPct = envelope.internalLoads?.equipment?.sensiblePct ?? 100;
  const equipLatPct  = envelope.internalLoads?.equipment?.latentPct   ?? 0;

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

              {/* Headcount */}
              <LoadInput
                label="Occupancy Count"
                value={envelope.internalLoads?.people?.count || 0}
                unit="people"
                onChange={(e) => handleLoadChange('people', 'count', e.target.value)}
              />

              {/* Activity level */}
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
                    <option key={i} value={i}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-1.5">
                  For cleanrooms / pharma labs select "Light bench work — standing"
                </p>
              </div>
            </div>

            {/* Live read-back of the selected per-person values */}
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
            sub="Lights assumed always ON — CLF = 1.0"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <LoadInput
              label="Lighting Density"
              value={envelope.internalLoads?.lights?.wattsPerSqFt || 0}
              unit="W/ft²"
              step="0.1"
              onChange={(e) => handleLoadChange('lights', 'wattsPerSqFt', e.target.value)}
              note="Typical: 1.0–2.0 W/ft² office · 1.5–3.0 W/ft² cleanroom · 0.5 W/ft² warehouse"
            />
            <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-4 flex flex-col justify-center">
              <p className="text-xs font-bold text-yellow-800 uppercase mb-1">
                Schedule: Always ON
              </p>
              <p className="text-[11px] text-yellow-700 leading-relaxed">
                CLF = 1.0 applied. For rooms with scheduled lighting, contact support
                to enable schedule-based CLF correction per ASHRAE Table 3, Ch 18.
              </p>
            </div>
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

            {/* Total kW */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <LoadInput
                label="Total Equipment Load"
                value={envelope.internalLoads?.equipment?.kw || 0}
                unit="kW"
                step="0.1"
                onChange={(e) => handleLoadChange('equipment', 'kw', e.target.value)}
                note="Sum of all electrical input power for process equipment in this room"
              />

              {/* Sensible % */}
              <LoadInput
                label="Sensible Fraction"
                value={equipSensPct}
                unit="%"
                step="1"
                onChange={(e) => handleLoadChange('equipment', 'sensiblePct', e.target.value)}
                note="Heat added as dry heat. Motors, drives, lighting ballasts → 100%"
              />

              {/* Latent % */}
              <LoadInput
                label="Latent Fraction"
                value={equipLatPct}
                unit="%"
                step="1"
                onChange={(e) => handleLoadChange('equipment', 'latentPct', e.target.value)}
                note="Heat added as moisture. Autoclaves, wash stations, open baths → 20–60%"
              />
            </div>

            {/* Fraction validation warning */}
            {(equipSensPct + equipLatPct) > 100 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 font-medium">
                ⚠ Sensible + Latent fractions exceed 100%.
                Valid only if equipment has internal cooling (cooling water removes the difference).
                Verify with equipment data sheet.
              </div>
            )}

            {/* Reference guide */}
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

            {/* Live computed preview */}
            {(envelope.internalLoads?.equipment?.kw || 0) > 0 && (
              <div className="flex gap-4 flex-wrap">
                <div className="bg-orange-50 border border-orange-100 rounded-lg px-4 py-2 flex items-center gap-2">
                  <span className="text-xs font-bold text-orange-700 uppercase">Sensible</span>
                  <span className="font-mono text-sm font-bold text-orange-900">
                    {Math.round(
                      (envelope.internalLoads?.equipment?.kw || 0)
                      * 3412
                      * (equipSensPct / 100)
                    ).toLocaleString()} BTU/hr
                  </span>
                </div>
                <div className="bg-sky-50 border border-sky-100 rounded-lg px-4 py-2 flex items-center gap-2">
                  <span className="text-xs font-bold text-sky-700 uppercase">Latent</span>
                  <span className="font-mono text-sm font-bold text-sky-900">
                    {Math.round(
                      (envelope.internalLoads?.equipment?.kw || 0)
                      * 3412
                      * (equipLatPct / 100)
                    ).toLocaleString()} BTU/hr
                  </span>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-500 uppercase">Rejected to CW</span>
                  <span className="font-mono text-sm font-bold text-gray-700">
                    {Math.max(0, Math.round(
                      (envelope.internalLoads?.equipment?.kw || 0)
                      * 3412
                      * (1 - equipSensPct / 100 - equipLatPct / 100)
                    )).toLocaleString()} BTU/hr
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 4 — INFILTRATION
        ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-10">
          <SectionHeader color="bg-orange-500" title="Infiltration" />
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm max-w-lg">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
              Infiltration Rate
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.1"
                value={envelope.infiltration?.achValue || 0}
                onChange={(e) => handleInfiltrationChange(e.target.value)}
                className="w-40 border-gray-300 rounded-md shadow-sm focus:border-blue-500 sm:text-sm"
              />
              <span className="text-gray-500 text-sm font-medium">ACPH</span>
            </div>
            <div className="mt-3 text-[10px] text-gray-400 space-y-0.5">
              <p>CFM = Volume(ft³) × ACPH / 60 = {activeRoom.volume} m³
                × 35.31 × {envelope.infiltration?.achValue || 0} / 60
                = <strong>{
                  Math.round(
                    parseFloat(activeRoom.volume || 0)
                    * 35.3147
                    * parseFloat(envelope.infiltration?.achValue || 0)
                    / 60
                  )
                } CFM</strong>
              </p>
              <p>
                Typical values: Cleanroom positively pressurized = 0.05–0.15 ACPH ·
                Open-plan office = 0.25–0.5 · Leaky old building = 0.5–1.5
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