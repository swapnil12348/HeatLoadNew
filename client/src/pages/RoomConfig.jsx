/**
 * RoomConfig.jsx
 * Responsibility: Room geometry, indoor design targets, ISO classification,
 *                 ventilation category, and AHU assignment.
 *
 * Changelog:
 *   v2.0 — Dead React import removed
 *         — useActiveRoom hook replaces raw useSelector/useDispatch boilerplate
 *         — handleUpdate: text fields preserved as string, numeric fields use
 *           parseFloat with NaN fallback (not || 0) to allow negatives
 *         — roomNo field added — was missing from UI entirely
 *         — ventCategory select added — drives ASHRAE 62.1 Rp/Ra in airQuantities
 *         — classInOp + atRestClass selects added — ISO 14644 dual classification
 *         — recOt + flpType selects added — GMP documentation completeness
 *         — value ?? '' nullish guard replaces falsy || '' (preserves 0 values)
 *         — ft² stat card added alongside m² for engineering cross-reference
 *   v2.1 — floorAreaFt2: m2ToFt2(activeRoom.floorArea ?? 0) guards against NaN
 *           display on new rooms before dimensions are entered
 *         — handleUpdate: removed dead ?? rawValue — parseFloat never returns
 *           null/undefined so nullish coalescing never fired
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
import { m2ToFt2 }                            from '../utils/units';

// ── Local helpers ─────────────────────────────────────────────────────────────

// Fields stored as strings — must not be cast to float
const STRING_FIELDS = new Set(['name', 'roomNo', 'classInOp', 'atRestClass',
  'recOt', 'flpType', 'ventCategory']);

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * SectionHeader — coloured left-bar + title, used across all sections.
 */
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

/**
 * SelectGroup — labelled <select> matching InputGroup visual style.
 */
const SelectGroup = ({ label, value, onChange, options }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
      {label}
    </label>
    <select
      value={value ?? ''}
      onChange={onChange}
      className="
        w-full px-3 py-2 text-sm text-gray-800
        bg-white border border-gray-300 rounded-lg
        focus:outline-none focus:ring-2 focus:ring-blue-500
        transition-colors
      "
    >
      {options.map((opt) => {
        const val   = typeof opt === 'object' ? opt.value : opt;
        const label = typeof opt === 'object' ? opt.label : opt;
        return <option key={val} value={val}>{label}</option>;
      })}
    </select>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

export default function RoomConfig() {
  const dispatch = useDispatch();

  // useActiveRoom: replaces raw useSelector(selectActiveRoom) + envelope boilerplate
  const { room: activeRoom } = useActiveRoom();

  // ── Update handler ─────────────────────────────────────────────────────────
  // String fields preserved as-is.
  // Numeric fields use parseFloat — returns NaN for empty string which
  // roomSlice.updateRoom will store; display components handle NaN gracefully.
  // We do NOT || 0 because that destroys legitimate negative values (cold rooms).
  const handleUpdate = (field, rawValue) => {
    const value = STRING_FIELDS.has(field)
      ? rawValue
      : (rawValue === '' ? '' : parseFloat(rawValue));

    dispatch(updateRoom({ id: activeRoom.id, field, value }));
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

  // Guard against undefined/NaN floorArea on new rooms before dimensions are entered
  const floorAreaFt2 = m2ToFt2(activeRoom.floorArea ?? 0).toLocaleString(
    undefined, { maximumFractionDigits: 0 }
  );

  return (
    <div className="flex flex-col md:flex-row h-full bg-gray-50">

      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <RoomSidebar />

      {/* ── Main content ───────────────────────────────────────────────── */}
      <div className="flex-1 max-w-5xl p-4 md:p-8 space-y-8 overflow-y-auto h-full">

        {/* Page header */}
        <div className="border-b border-gray-200 pb-4">
          <h2 className="text-3xl font-bold text-gray-900">Room Geometry & Climate</h2>
          <p className="text-gray-500 text-sm mt-1">
            Define dimensions, indoor climate requirements, ISO classification,
            and AHU assignment.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-12">

          {/* ── Left column ──────────────────────────────────────────── */}
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
                {/* ventCategory drives ASHRAE 62.1 Rp/Ra selection in airQuantities.js */}
                <SelectGroup
                  label="Ventilation Category"
                  value={activeRoom.ventCategory ?? 'general'}
                  onChange={(e) => handleUpdate('ventCategory', e.target.value)}
                  options={VENTILATION_CATEGORY_OPTIONS}
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
                Used against global Outside Climate data to compute cooling/heating loads.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InputGroup
                  label="Target Temperature"
                  value={activeRoom.designTemp ?? ''}
                  unit="°C"
                  className="[&>div>input]:bg-white [&>div>input]:text-amber-900 [&>div>input]:font-bold"
                  onChange={(e) => handleUpdate('designTemp', e.target.value)}
                />
                <InputGroup
                  label="Target RH"
                  value={activeRoom.designRH ?? ''}
                  unit="%"
                  className="[&>div>input]:bg-white [&>div>input]:text-amber-900 [&>div>input]:font-bold"
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
              <StatCard
                label="Floor Area"
                value={activeRoom.floorArea?.toLocaleString() || 0}
                unit="m²"
                color="blue"
              />
              <StatCard
                label="Floor Area"
                value={floorAreaFt2}
                unit="ft²"
                color="blue"
              />
              <StatCard
                label="Room Volume"
                value={activeRoom.volume?.toLocaleString() || 0}
                unit="m³"
                color="indigo"
              />
              <StatCard
                label="Ceiling Height"
                value={activeRoom.height ?? 0}
                unit="m"
                color="indigo"
              />
            </div>

            {/* 5. ISO Classification */}
            <section className="bg-purple-50 p-6 rounded-xl shadow-sm border border-purple-200">
              <SectionHeader
                emoji="🔬"
                title="ISO Classification"
                subtitle="ISO 14644-1:2015 — both at-rest and in-operation classes required"
              />
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

          </div>

          {/* ── Right column — AHU assignment ─────────────────────────── */}
          <div className="lg:col-span-1">
            <AhuAssignment activeRoom={activeRoom} />
          </div>

        </div>
      </div>
    </div>
  );
}