/**
 * RoomConfig.jsx
 * Responsibility: Room geometry, indoor design targets, ISO classification,
 *                 ventilation category, ACPH constraints, exhaust air,
 *                 and AHU assignment.
 *
 * -- CHANGELOG v2.2 -----------------------------------------------------------
 *
 *   ACPH section added — min ACPH and design ACPH now visible and editable.
 *
 *     roomSlice.updateRoom auto-sets minAcph + designAcph from ACPH_RANGES
 *     when ISO class changes. These values were never shown to the engineer
 *     on this page — the only way to see them was deep inside the RDS panel.
 *     A room left at the ISO 8 default (minAcph=10, designAcph=20) would
 *     silently produce ACPH-governed supply air even for a non-cleanroom space.
 *
 *     The section shows:
 *       - Min ACPH (auto-set by ISO class, engineer can override)
 *       - Design ACPH (auto-set by ISO class, engineer can override)
 *       - Live CFM preview so the engineer can see which constraint governs
 *         before looking at the RDS page.
 *
 *     For a general office or production room with no cleanroom class,
 *     the engineer should set both to 0 (or select ISO 9 / CNC which
 *     auto-sets 0 ACPH) so thermal load governs the supply air.
 *
 *   Exhaust air section added — general, BIBO, and machine exhaust CFM.
 *
 *     These fields live in room.exhaustAir but had no UI in RoomConfig.
 *     They were only accessible inside the RDS panel Loads tab —
 *     a first-time user would never find them.
 *
 *     Exhaust matters for two things:
 *       1. Exhaust compensation — when total exhaust > Vbz, the app
 *          automatically increases fresh air to make up for it.
 *          An engineer entering 500 CFM exhaust but not seeing the
 *          resulting fresh air increase would be surprised by higher OA loads.
 *       2. NFPA 855 / GMP regulatory exhaust — battery and pharma rooms
 *          may have mandatory exhaust that governs fresh air entirely.
 *
 *     Fresh air preview added alongside exhaust fields to close this feedback
 *     loop — engineer sees the exhaust → OA compensation immediately.
 *
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   floorAreaFt2: m2ToFt2() guard against NaN on new rooms.
 *   handleUpdate: removed dead ?? rawValue.
 *
 * -- CHANGELOG v2.0 -----------------------------------------------------------
 *
 *   Dead React import removed. useActiveRoom hook added.
 *   handleUpdate: text fields preserved, numeric fields parseFloat.
 *   Missing fields added: roomNo, ventCategory, classInOp/atRestClass,
 *   recOt, flpType. ft² stat card added.
 */

import { useDispatch }                        from 'react-redux';
import { updateRoom }                         from '../features/room/roomSlice';
import useActiveRoom                          from '../hooks/useActiveRoom';
import RoomSidebar                            from '../components/Layout/RoomSidebar';
import InputGroup                             from '../components/UI/InputGroup';
import StatCard                               from '../components/UI/StatCard';
import AhuAssignment                          from '../features/room/AhuAssignment';
import { VENTILATION_CATEGORY_OPTIONS }       from '../constants/ventilation';
import { ISO_CLASS_OPTIONS }                  from '../constants/isoCleanroom';
import { m2ToFt2, m3ToFt3 }                  from '../utils/units';
import { useSelector }                        from 'react-redux';

// ── Local helpers ─────────────────────────────────────────────────────────────
const STRING_FIELDS = new Set([
  'name', 'roomNo', 'classInOp', 'atRestClass',
  'recOt', 'flpType', 'ventCategory',
]);

// ── Sub-components ────────────────────────────────────────────────────────────

const SectionHeader = ({ color = 'blue', emoji, title, subtitle }) => (
  <div className="flex items-center gap-2 mb-4">
    {emoji
      ? <span className="text-xl" aria-hidden="true">{emoji}</span>
      : <span className={`w-1 h-6 bg-${color}-600 rounded-full`} aria-hidden="true" />
    }
    <div>
      <h3 className="text-lg font-bold text-gray-800 leading-tight">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  </div>
);

const SelectGroup = ({ label, value, onChange, options, hint }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
      {label}
    </label>
    <select
      value={value ?? ''}
      onChange={onChange}
      className="w-full px-3 py-2 text-sm text-gray-800 bg-white border border-gray-300
                 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
    >
      {options.map((opt) => {
        const val   = typeof opt === 'object' ? opt.value : opt;
        const label = typeof opt === 'object' ? opt.label : opt;
        return <option key={val} value={val}>{label}</option>;
      })}
    </select>
    {hint && <p className="text-[10px] text-gray-400 leading-relaxed">{hint}</p>}
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

export default function RoomConfig() {
  const dispatch = useDispatch();
  const { room: activeRoom } = useActiveRoom();
  const systemDesign = useSelector((s) => s.project.systemDesign);

  const handleUpdate = (field, rawValue) => {
    const value = STRING_FIELDS.has(field)
      ? rawValue
      : (rawValue === '' ? '' : parseFloat(rawValue));
    dispatch(updateRoom({ id: activeRoom.id, field, value }));
  };

  const handleExhaustUpdate = (subField, rawValue) => {
    dispatch(updateRoom({
      id:    activeRoom.id,
      field: `exhaustAir.${subField}`,
      value: rawValue === '' ? '' : parseFloat(rawValue) || 0,
    }));
  };

  if (!activeRoom) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-3">📐</div>
          <p className="font-medium">No rooms yet</p>
          <p className="text-sm mt-1">Add a room using the sidebar.</p>
        </div>
      </div>
    );
  }

  const floorAreaFt2 = m2ToFt2(activeRoom.floorArea ?? 0).toLocaleString(
    undefined, { maximumFractionDigits: 0 }
  );
  const volumeFt3 = m3ToFt3(activeRoom.volume ?? 0);

  // Live ACPH CFM preview
  const minAcphCFM    = Math.round(volumeFt3 * (parseFloat(activeRoom.minAcph)    || 0) / 60);
  const designAcphCFM = Math.round(volumeFt3 * (parseFloat(activeRoom.designAcph) || 0) / 60);

  // Live thermal CFM preview
  const bf       = parseFloat(systemDesign?.bypassFactor) || 0.10;
  const adp      = parseFloat(systemDesign?.adp)          || 55;
  const dbInF    = (parseFloat(activeRoom.designTemp) || 22) * 9/5 + 32;
  const supplyDT = (1 - bf) * (dbInF - adp);

  // Exhaust totals
  const exhaustGeneral = parseFloat(activeRoom.exhaustAir?.general) || 0;
  const exhaustBibo    = parseFloat(activeRoom.exhaustAir?.bibo)    || 0;
  const exhaustMachine = parseFloat(activeRoom.exhaustAir?.machine) || 0;
  const totalExhaust   = exhaustGeneral + exhaustBibo + exhaustMachine;

  // Governing supply air hint
  const supplyAirHints = [];
  if (designAcphCFM > 0) supplyAirHints.push(`Design ACPH → ${designAcphCFM.toLocaleString()} CFM`);
  if (minAcphCFM    > 0) supplyAirHints.push(`Min ACPH → ${minAcphCFM.toLocaleString()} CFM`);
  if (totalExhaust  > 0) supplyAirHints.push(`Exhaust makeup → ${totalExhaust.toLocaleString()} CFM`);

  return (
    <div className="flex flex-col md:flex-row h-full bg-gray-50">

      {/* ── Sidebar ── */}
      <RoomSidebar />

      {/* ── Main content ── */}
      <div className="flex-1 max-w-5xl p-4 md:p-8 space-y-8 overflow-y-auto h-full">

        {/* Page header */}
        <div className="border-b border-gray-200 pb-4">
          <h2 className="text-3xl font-bold text-gray-900">Room Geometry & Climate</h2>
          <p className="text-gray-500 text-sm mt-1">
            Define dimensions, indoor climate requirements, ISO classification,
            airflow constraints, exhaust, and AHU assignment.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-12">

          {/* ── Left column ── */}
          <div className="lg:col-span-2 space-y-6">

            {/* 1. General Identification */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <SectionHeader color="blue" title="General Identification" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InputGroup
                  label="Room Name"
                  type="text"
                  value={activeRoom.name ?? ''}
                  onChange={(e) => handleUpdate('name', e.target.value)}
                />
                <InputGroup
                  label="Room Number"
                  type="text"
                  value={activeRoom.roomNo ?? ''}
                  placeholder="e.g. P-101"
                  onChange={(e) => handleUpdate('roomNo', e.target.value)}
                />
                <InputGroup
                  label="Room Absolute Pressure"
                  value={activeRoom.pressure ?? ''}
                  unit="Pa"
                  onChange={(e) => handleUpdate('pressure', e.target.value)}
                />
                <SelectGroup
                  label="Ventilation Category"
                  value={activeRoom.ventCategory ?? 'general'}
                  onChange={(e) => handleUpdate('ventCategory', e.target.value)}
                  options={VENTILATION_CATEGORY_OPTIONS}
                  hint="Sets ASHRAE 62.1 Rp/Ra and the regulatory ACH floor (NFPA 855 / GMP / OSHA)."
                />
              </div>
            </section>

            {/* 2. Indoor Design Targets */}
            <section className="bg-amber-50 p-6 rounded-xl shadow-sm border border-amber-200">
              <SectionHeader
                emoji="🌡️"
                title="Indoor Design Targets"
                subtitle={`Desired temperature and humidity for ${activeRoom.name || 'this room'}`}
              />
              <p className="text-xs text-amber-700 mb-4">
                Used against global Outside Climate data to compute cooling / heating loads.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InputGroup
                  label="Target Temperature"
                  value={activeRoom.designTemp ?? ''}
                  unit="°C"
                  onChange={(e) => handleUpdate('designTemp', e.target.value)}
                />
                <InputGroup
                  label="Target RH"
                  value={activeRoom.designRH ?? ''}
                  unit="%"
                  onChange={(e) => handleUpdate('designRH', e.target.value)}
                />
              </div>
            </section>

            {/* 3. Dimensions */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <SectionHeader color="indigo" title="Dimensions" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <InputGroup
                  label="Length"
                  value={activeRoom.length ?? ''}
                  unit="m"
                  onChange={(e) => handleUpdate('length', e.target.value)}
                />
                <InputGroup
                  label="Width"
                  value={activeRoom.width ?? ''}
                  unit="m"
                  onChange={(e) => handleUpdate('width', e.target.value)}
                />
                <InputGroup
                  label="Height"
                  value={activeRoom.height ?? ''}
                  unit="m"
                  onChange={(e) => handleUpdate('height', e.target.value)}
                />
              </div>
            </section>

            {/* 4. Derived geometry stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Floor Area" value={activeRoom.floorArea?.toLocaleString() || 0} unit="m²"  color="blue"   />
              <StatCard label="Floor Area" value={floorAreaFt2}                              unit="ft²" color="blue"   />
              <StatCard label="Room Volume" value={activeRoom.volume?.toLocaleString() || 0} unit="m³"  color="indigo" />
              <StatCard label="Ceiling Height" value={activeRoom.height ?? 0}               unit="m"   color="indigo" />
            </div>

            {/* 5. ISO Classification */}
            <section className="bg-purple-50 p-6 rounded-xl shadow-sm border border-purple-200">
              <SectionHeader
                emoji="🔬"
                title="ISO Classification"
                subtitle="ISO 14644-1:2015 — sets minimum and design ACPH automatically"
              />
              <p className="text-xs text-purple-700 mb-4">
                Selecting an ISO class auto-fills the Min and Design ACPH below.
                For general offices and non-cleanroom spaces, select <strong>ISO 9</strong> or
                <strong> CNC</strong> (not classified) to clear the ACPH constraints.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SelectGroup
                  label="ISO Class — At Rest"
                  value={activeRoom.atRestClass ?? 'ISO 8'}
                  onChange={(e) => handleUpdate('atRestClass', e.target.value)}
                  options={ISO_CLASS_OPTIONS}
                />
                <SelectGroup
                  label="ISO Class — In Operation"
                  value={activeRoom.classInOp ?? 'ISO 8'}
                  onChange={(e) => handleUpdate('classInOp', e.target.value)}
                  options={ISO_CLASS_OPTIONS}
                  hint="Changing this updates Min ACPH and Design ACPH below."
                />
                <SelectGroup
                  label="REC / OT"
                  value={activeRoom.recOt ?? 'REC'}
                  onChange={(e) => handleUpdate('recOt', e.target.value)}
                  options={['REC', 'OT']}
                />
                <SelectGroup
                  label="FLP / NFLP"
                  value={activeRoom.flpType ?? 'NFLP'}
                  onChange={(e) => handleUpdate('flpType', e.target.value)}
                  options={['FLP', 'NFLP']}
                />
              </div>
            </section>

            {/* 6. ACPH Constraints — NEW SECTION ──────────────────────────── */}
            <section className="bg-blue-50 p-6 rounded-xl shadow-sm border border-blue-200">
              <SectionHeader
                emoji="💨"
                title="Air Change Rate Constraints"
                subtitle="Auto-set by ISO class — override here if needed"
              />

              <div className="p-3 bg-blue-100 border border-blue-200 rounded-lg mb-4">
                <p className="text-xs text-blue-800 leading-relaxed">
                  <strong>How supply air is determined:</strong> The app takes the maximum of
                  (thermal CFM, design ACPH CFM, min ACPH CFM, regulatory ACH CFM).
                  If ACPH values are non-zero they can override the thermal load — this is
                  intentional for cleanrooms but unwanted for general office/production spaces.
                  <br />
                  <strong className="text-blue-900">For non-cleanroom spaces: set both to 0
                  so the thermal load governs supply air.</strong>
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <InputGroup
                    label="Min ACPH"
                    value={activeRoom.minAcph ?? ''}
                    unit="ACH"
                    onChange={(e) => handleUpdate('minAcph', e.target.value)}
                  />
                  {minAcphCFM > 0 && (
                    <p className="text-[10px] text-blue-600 mt-1 font-mono">
                      → {minAcphCFM.toLocaleString()} CFM at {activeRoom.volume?.toLocaleString()} m³ room volume
                    </p>
                  )}
                </div>
                <div>
                  <InputGroup
                    label="Design ACPH"
                    value={activeRoom.designAcph ?? ''}
                    unit="ACH"
                    onChange={(e) => handleUpdate('designAcph', e.target.value)}
                  />
                  {designAcphCFM > 0 && (
                    <p className="text-[10px] text-blue-600 mt-1 font-mono">
                      → {designAcphCFM.toLocaleString()} CFM at {activeRoom.volume?.toLocaleString()} m³ room volume
                    </p>
                  )}
                </div>
              </div>

              {/* Supply air governance preview */}
              <div className="bg-white rounded-lg border border-blue-200 p-3">
                <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide mb-2">
                  Supply Air Governance Preview
                </p>
                <div className="space-y-1">
                  {supplyDT > 0 && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-500">Thermal CFM (at current ADP/BF)</span>
                      <span className="font-mono font-bold text-gray-700">
                        computed in RDS
                      </span>
                    </div>
                  )}
                  {designAcphCFM > 0 && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-500">Design ACPH CFM</span>
                      <span className="font-mono font-bold text-blue-700">{designAcphCFM.toLocaleString()} CFM</span>
                    </div>
                  )}
                  {minAcphCFM > 0 && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-500">Min ACPH CFM</span>
                      <span className="font-mono font-bold text-blue-600">{minAcphCFM.toLocaleString()} CFM</span>
                    </div>
                  )}
                  {totalExhaust > 0 && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-500">Exhaust makeup</span>
                      <span className="font-mono font-bold text-orange-600">{totalExhaust.toLocaleString()} CFM</span>
                    </div>
                  )}
                  {supplyAirHints.length === 0 && (
                    <p className="text-[11px] text-emerald-600 font-medium">
                      ✓ No ACPH or exhaust constraints — thermal load will govern supply air
                    </p>
                  )}
                  {supplyAirHints.length > 0 && designAcphCFM === 0 && minAcphCFM === 0 && (
                    <p className="text-[11px] text-orange-600 font-medium">
                      ⚠ Exhaust makeup may govern — verify in RDS page
                    </p>
                  )}
                  {(designAcphCFM > 0 || minAcphCFM > 0) && (
                    <p className="text-[11px] text-amber-700 font-medium mt-1">
                      ⚠ ACPH constraint present — supply air may be ACPH-governed rather than thermal. Set to 0 if this is not a cleanroom.
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* 7. Exhaust Air — NEW SECTION ─────────────────────────────────── */}
            <section className="bg-orange-50 p-6 rounded-xl shadow-sm border border-orange-200">
              <SectionHeader
                emoji="🔄"
                title="Exhaust Air"
                subtitle="All values in CFM — drives fresh air compensation and OA load"
              />

              <div className="p-3 bg-orange-100 border border-orange-200 rounded-lg mb-4">
                <p className="text-xs text-orange-800 leading-relaxed">
                  <strong>Why this matters:</strong> When total exhaust exceeds the ASHRAE 62.1
                  Vbz fresh air requirement, the app automatically increases fresh air to
                  compensate. More fresh air → higher OA enthalpy load → higher tonnage.
                  For NFPA 855 battery rooms and GMP pharma rooms, exhaust often drives
                  the entire fresh air system.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <InputGroup
                    label="General Exhaust"
                    value={activeRoom.exhaustAir?.general ?? ''}
                    unit="CFM"
                    onChange={(e) => handleExhaustUpdate('general', e.target.value)}
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    General room exhaust / toilet exhaust
                  </p>
                </div>
                <div>
                  <InputGroup
                    label="BIBO Exhaust"
                    value={activeRoom.exhaustAir?.bibo ?? ''}
                    unit="CFM"
                    onChange={(e) => handleExhaustUpdate('bibo', e.target.value)}
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Bag-in-bag-out filter housings (pharma / biocontainment)
                  </p>
                </div>
                <div>
                  <InputGroup
                    label="Machine / Process Exhaust"
                    value={activeRoom.exhaustAir?.machine ?? ''}
                    unit="CFM"
                    onChange={(e) => handleExhaustUpdate('machine', e.target.value)}
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Tool exhaust, fume hoods, scrubbers (semicon / battery)
                  </p>
                </div>
              </div>

              {/* Exhaust summary */}
              <div className="bg-white rounded-lg border border-orange-200 p-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600 font-medium">Total exhaust</span>
                  <span className={`font-bold font-mono ${totalExhaust > 0 ? 'text-orange-700' : 'text-gray-400'}`}>
                    {totalExhaust.toLocaleString()} CFM
                  </span>
                </div>
                {totalExhaust > 0 && (
                  <p className="text-[10px] text-orange-600 mt-1">
                    Fresh air will be set to at least {totalExhaust.toLocaleString()} CFM
                    to compensate for this exhaust (max of Vbz and total exhaust).
                  </p>
                )}
                {totalExhaust === 0 && (
                  <p className="text-[10px] text-gray-400 mt-1">
                    No exhaust entered — fresh air governed by ASHRAE 62.1 Vbz only.
                  </p>
                )}
              </div>
            </section>

          </div>

          {/* ── Right column — AHU assignment ── */}
          <div className="lg:col-span-1">
            <AhuAssignment activeRoom={activeRoom} />

            {/* Quick reference card */}
            <div className="mt-6 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
                Input Checklist
              </h4>
              <ul className="space-y-2 text-xs text-gray-600">
                {[
                  { done: !!(activeRoom.name?.trim()),                         label: 'Room name' },
                  { done: (parseFloat(activeRoom.floorArea) || 0) > 0,        label: 'Floor area (L × W)' },
                  { done: activeRoom.designTemp != null && activeRoom.designTemp !== '', label: 'Design temperature' },
                  { done: activeRoom.designRH   != null && activeRoom.designRH   !== '', label: 'Design RH' },
                  { done: activeRoom.ventCategory !== 'general' || (parseFloat(activeRoom.minAcph) === 0 && parseFloat(activeRoom.designAcph) === 0), label: 'ACPH set or zeroed intentionally' },
                  { done: !!(activeRoom.assignedAhuIds?.length),               label: 'Assigned to AHU' },
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${item.done ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                      {item.done ? '✓' : '○'}
                    </span>
                    <span className={item.done ? 'text-gray-700' : 'text-gray-400'}>{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}