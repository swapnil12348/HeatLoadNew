
import { useSelector, useDispatch } from 'react-redux';
import { updateProjectInfo, updateAmbient, updateSystemDesign } from '../features/project/projectSlice';
import NumberControl from '../components/UI/NumberControl';
import InputField from '../components/UI/InputField';

export default function ProjectDetails() {
  const dispatch = useDispatch();
  const { info, ambient, systemDesign } = useSelector((state) => state.project);

  const handleTextChange = (e) =>
    dispatch(updateProjectInfo({ field: e.target.name, value: e.target.value }));

  const handleAmbientChange = (field, value) =>
    dispatch(updateAmbient({ field, value }));

  const handleSystemDesignChange = (field, value) =>
    dispatch(updateSystemDesign({ field, value }));

  const handleReset = () => {
    if (window.confirm('⚠️ Are you sure you want to clear ALL project data?')) {
      window.location.reload();
    }
  };

  // Live preview uses 72°F (22.2°C) reference indoor temp
  const refDbInF   = 72;
  const supplyDT   = (1 - systemDesign.bypassFactor) * (refDbInF - systemDesign.adp);
  const safetyDisp = (1 + systemDesign.safetyFactor / 100).toFixed(2);
  const fanDisp    = (1 + systemDesign.fanHeat       / 100).toFixed(2);

  // Live diurnal range label helper
  const getDiurnalLabel = (val) => {
    const v = parseFloat(val) || 0;
    if (v === 0)  return 'Using seasonal defaults (18°F summer / 12°F monsoon / 20°F winter)';
    if (v < 12)   return 'Coastal / humid site (typical: 8–12°F)';
    if (v < 20)   return 'Inland plains site (typical: 14–22°F)';
    if (v < 30)   return 'Semi-arid / continental site (typical: 22–28°F)';
    return              'Desert site — high swing (typical: 28–40°F)';
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8">

      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 border-b border-gray-200 pb-4 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Project Details</h2>
          <p className="text-gray-500 mt-2 text-base">
            Project identification, site data, and global HVAC design parameters.
          </p>
        </div>
        <button
          onClick={handleReset}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 text-sm font-semibold shadow-sm"
        >
          Reset Project
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* ── 1. General Information ── */}
        <div className="lg:col-span-8 space-y-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-lg font-bold text-gray-800 flex items-center mb-6 border-b pb-2">
              <span className="bg-blue-100 text-blue-700 w-8 h-8 flex items-center justify-center rounded-full mr-3 text-sm">1</span>
              General Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              <InputField label="Project Name"        name="projectName"       value={info.projectName}       onChange={handleTextChange} placeholder="e.g. Gigafactory" fullWidth />
              <InputField label="Location"            name="projectLocation"   value={info.projectLocation}   onChange={handleTextChange} placeholder="City, Country"    fullWidth />
              <InputField label="Customer Name"       name="customerName"      value={info.customerName}      onChange={handleTextChange} />
              <InputField label="Consultant Name"     name="consultantName"    value={info.consultantName}    onChange={handleTextChange} />
              <InputField label="Key Account Manager" name="keyAccountManager" value={info.keyAccountManager} onChange={handleTextChange} />
              <InputField
                label="Industry"
                name="industry"
                value={info.industry}
                onChange={handleTextChange}
                type="select"
                placeholder={
                  <>
                    <option value="Semiconductor">Semiconductor</option>
                    <option value="Solar">Solar</option>
                    <option value="Pharma">Pharma</option>
                    <option value="Battery">Battery</option>
                  </>
                }
              />
            </div>
          </div>
        </div>

        {/* ── 2. Site Reference Conditions ── */}
        <div className="lg:col-span-4">
          <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 sticky top-4 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center border-b border-slate-200 pb-2">
              <span className="bg-slate-200 text-slate-700 w-8 h-8 flex items-center justify-center rounded-full mr-3 text-sm">2</span>
              Site Conditions
            </h3>

            {/* Elevation — altitude correction */}
            <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide mb-2">
                ↳ Used in load calculations
              </p>
              <NumberControl
                label="Elevation"
                value={ambient.elevation}
                onChange={(val) => handleAmbientChange('elevation', val)}
                unit="ft"
                min={0}
              />
              <p className="text-[10px] text-blue-600 mt-1">
                Corrects 1.08 / 0.68 psychrometric factors and site Patm for altitude.
              </p>
            </div>

            {/* Latitude — used in CLTD/SHGF corrections */}
            <div className="mb-4 p-3 bg-indigo-50 border border-indigo-100 rounded-lg">
              <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-wide mb-2">
                ↳ Used in CLTD + SHGF calculations
              </p>
              <NumberControl
                label="Project Latitude"
                value={ambient.latitude ?? 28}
                onChange={(val) => handleAmbientChange('latitude', val)}
                unit="°"
                min={-90}
                max={90}
              />
              <p className="text-[10px] text-indigo-600 mt-1 leading-relaxed">
                Shifts wall CLTD from 40°N reference and corrects SHGF from 32°N
                reference to actual site latitude.
                Negative = southern hemisphere (N↔S orientations swapped automatically).
              </p>
            </div>

            {/* Daily Temperature Range — CLTD mean-temp correction */}
            <div className="mb-5 p-3 bg-amber-50 border border-amber-100 rounded-lg">
              <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide mb-2">
                ↳ Used in CLTD mean-temp correction
              </p>
              <NumberControl
                label="Daily Temp Range"
                value={ambient.dailyRange ?? 0}
                onChange={(val) => handleAmbientChange('dailyRange', val)}
                unit="°F"
                min={0}
                max={50}
              />
              <p className="text-[10px] text-amber-600 mt-1 leading-relaxed">
                {getDiurnalLabel(ambient.dailyRange)}
              </p>
              <p className="text-[10px] text-amber-500 mt-1">
                Set 0 to use built-in seasonal defaults.
                ASHRAE: t_mean = t_peak − range/2. Desert sites (Riyadh, Jodhpur)
                need 30–38°F here — hardcoded 20°F understates cooling load by 5–15%.
              </p>
            </div>

            <hr className="border-slate-200 mb-5" />

            {/* DB / WB / RH — project brief reference only */}
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-3">
              Project brief reference only
              <span className="block font-normal normal-case mt-0.5">
                Not used in calculations — set seasonal conditions in the Climate tab.
              </span>
            </p>
            <div className="space-y-4">
              <NumberControl
                label="Dry Bulb Temp"
                value={ambient.dryBulbTemp}
                onChange={(val) => handleAmbientChange('dryBulbTemp', val)}
                unit="°C"
                min={-60}
                max={60}
              />
              <NumberControl
                label="Wet Bulb Temp"
                value={ambient.wetBulbTemp}
                onChange={(val) => handleAmbientChange('wetBulbTemp', val)}
                unit="°C"
                min={-60}
                max={60}
              />
              <NumberControl
                label="Relative Humidity"
                value={ambient.relativeHumidity}
                onChange={(val) => handleAmbientChange('relativeHumidity', val)}
                unit="%"
                min={0}
                max={100}
              />
            </div>
          </div>
        </div>

        {/* ── 3. System Design Parameters ── */}
        <div className="lg:col-span-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-lg font-bold text-gray-800 flex items-center mb-6 border-b pb-2">
              <span className="bg-amber-100 text-amber-700 w-8 h-8 flex items-center justify-center rounded-full mr-3 text-sm">3</span>
              System Design Parameters
            </h3>
            <p className="text-xs text-gray-500 mb-6">
              These values drive all load calculations across every room.
              Changes update results instantly.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <NumberControl
                label="Safety Factor"
                value={systemDesign.safetyFactor}
                onChange={(val) => handleSystemDesignChange('safetyFactor', val)}
                unit="%"
                min={0}
                max={100}
              />
              <NumberControl
                label="Apparatus Dew Point (ADP)"
                value={systemDesign.adp}
                onChange={(val) => handleSystemDesignChange('adp', val)}
                unit="°F"
                min={32}
                max={65}
              />
              <NumberControl
                label="Bypass Factor (BF)"
                value={systemDesign.bypassFactor}
                onChange={(val) => handleSystemDesignChange('bypassFactor', val)}
                unit="—"
                min={0}
                max={0.5}
                step={0.01}
              />
              <NumberControl
                label="Supply Fan Heat Allowance"
                value={systemDesign.fanHeat}
                onChange={(val) => handleSystemDesignChange('fanHeat', val)}
                unit="%"
                min={0}
                max={15}
              />
              {/*
                Return fan heat — separate from supply fan heat.
                Supply fan heat (above) is added to room load downstream of the coil
                (draw-through). Return fan heat is added upstream of the coil and
                increases coil load. Typical values: 2–5% of supply fan heat for
                systems with a small return fan; 10–20% for balanced supply/return fans.
                Default 5% is a conservative estimate for a cleanroom recirculation AHU.

                ⚠ PENDING: projectSlice.systemDesign.initialState must include
                returnFanHeat: 5 and SYSTEM_DESIGN_BOUNDS must include a
                returnFanHeat entry. rdsSelector must read systemDesign.returnFanHeat
                instead of the hardcoded 0.02 multiplier.
              */}
              <NumberControl
                label="Return Fan Heat Allowance"
                value={systemDesign.returnFanHeat ?? 5}
                onChange={(val) => handleSystemDesignChange('returnFanHeat', val)}
                unit="%"
                min={0}
                max={25}
              />
            </div>

            {/* Live preview */}
            <div className="mt-6 p-4 bg-amber-50 border border-amber-100 rounded-lg space-y-1">
              <p className="text-xs text-amber-800 font-medium">
                Supply ΔT = <strong>{supplyDT.toFixed(1)} °F</strong>
                <span className="text-amber-600 font-normal ml-1">
                  = (1 − {systemDesign.bypassFactor}) × (72 − {systemDesign.adp})°F
                </span>
              </p>
              <p className="text-xs text-amber-800 font-medium">
                Safety multiplier = <strong>{safetyDisp}×</strong>
                &nbsp;· Supply fan heat multiplier = <strong>{fanDisp}×</strong>
              </p>
              {/*
                Safety and fan heat are applied independently — not compounded.
                Grand total = (ERSH + ERLH) × safetyMult × fanHeatMult.
                Return fan heat is applied upstream of the coil and increases coilLoadBTU.
              */}
              <p className="text-[10px] text-amber-600 mt-1">
                Safety factor applied to room loads only.
                Supply fan heat is added after — not compounded with safety factor.
                Return fan heat increases coil load (upstream of coil — affects CHW sizing).
              </p>
              <p className="text-[10px] text-amber-500 mt-1">
                ΔT preview uses 72°F reference indoor temp (22.2°C).
                Actual ΔT uses each room's designTemp.
                {supplyDT <= 0 && (
                  <span className="text-red-600 font-bold ml-2">
                    ⚠ ADP ≥ indoor temp — supply air will be 0 CFM. Lower ADP.
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* ── 4. Calculation Reference Card ── */}
        <div className="lg:col-span-4">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-lg font-bold text-gray-800 flex items-center mb-4 border-b pb-2">
              <span className="bg-green-100 text-green-700 w-8 h-8 flex items-center justify-center rounded-full mr-3 text-sm">4</span>
              Active Site Parameters
            </h3>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-bold mb-3">
              Currently applied to all envelope calculations
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between border-b border-gray-50 pb-2">
                <span className="text-gray-500">Latitude</span>
                <span className="font-bold text-indigo-700">
                  {Math.abs(ambient.latitude ?? 28).toFixed(1)}°
                  {(ambient.latitude ?? 28) >= 0 ? ' N' : ' S'}
                </span>
              </li>
              <li className="flex justify-between border-b border-gray-50 pb-2">
                <span className="text-gray-500">Daily Temp Range</span>
                <span className="font-bold text-amber-700">
                  {(ambient.dailyRange ?? 0) > 0
                    ? `${ambient.dailyRange} °F`
                    : 'Seasonal defaults'}
                </span>
              </li>
              <li className="flex justify-between border-b border-gray-50 pb-2">
                <span className="text-gray-500">Elevation</span>
                <span className="font-bold text-blue-700">
                  {ambient.elevation || 0} ft
                </span>
              </li>
              <li className="flex justify-between border-b border-gray-50 pb-2">
                <span className="text-gray-500">Alt. Correction (Cf)</span>
                <span className="font-bold text-blue-700 font-mono">
                  {(ambient.elevation > 0
                    ? Math.pow(1 - 6.8754e-6 * ambient.elevation, 5.2559)
                    : 1.0
                  ).toFixed(4)}
                </span>
              </li>
              <li className="flex justify-between border-b border-gray-50 pb-2">
                <span className="text-gray-500">CLTD Reference</span>
                <span className="font-mono text-xs text-gray-600">40°N Jul (corrected)</span>
              </li>
              <li className="flex justify-between pb-2">
                <span className="text-gray-500">SHGF Reference</span>
                <span className="font-mono text-xs text-gray-600">32°N (corrected)</span>
              </li>
            </ul>

            {/* Southern hemisphere notice */}
            {(ambient.latitude ?? 28) < 0 && (
              <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <p className="text-[10px] font-bold text-purple-700 uppercase mb-1">
                  Southern Hemisphere Active
                </p>
                <p className="text-[10px] text-purple-600 leading-relaxed">
                  N↔S wall orientations are automatically swapped for CLTD LM
                  and SHGF latitude corrections.
                  NE↔SE and SW↔NW are also swapped accordingly.
                </p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}