import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updateProjectInfo, updateAmbient, updateSystemDesign } from '../features/project/projectSlice';
import NumberControl from '../components/UI/NumberControl';
import InputField from '../components/UI/InputField';

export default function ProjectDetails() {
  const dispatch = useDispatch();
  const { info, ambient, systemDesign } = useSelector((state) => state.project);

  const handleTextChange   = (e) =>
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

  // Live preview: reference indoor temp 72°F (22.2°C) — typical cleanroom design point
  const refDbInF   = 72;
  const supplyDT   = (1 - systemDesign.bypassFactor) * (refDbInF - systemDesign.adp);
  const safetyDisp = (1 + systemDesign.safetyFactor / 100).toFixed(2);
  const fanDisp    = (1 + systemDesign.fanHeat       / 100).toFixed(2);

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

            {/* Elevation — actively used in calculations */}
            <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide mb-2">
                ↳ Used in load calculations
              </p>
              <NumberControl
                label="Elevation"
                value={ambient.elevation}
                onChange={(val) => handleAmbientChange('elevation', val)}
                unit="ft"
              />
              <p className="text-[10px] text-blue-600 mt-1">
                Corrects 1.08 / 0.68 psychrometric factors and site Patm for altitude.
              </p>
            </div>

            {/* Latitude — stored, reserved for SHGF correction */}
            <div className="mb-5">
              <NumberControl
                label="Latitude"
                value={ambient.latitude}
                onChange={(val) => handleAmbientChange('latitude', val)}
                unit="°"
              />
              <p className="text-[10px] text-gray-400 mt-1">
                Reserved — SHGF latitude correction not yet applied.
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
              <NumberControl label="Dry Bulb Temp"     value={ambient.dryBulbTemp}      onChange={(val) => handleAmbientChange('dryBulbTemp', val)}      unit="°C" />
              <NumberControl label="Wet Bulb Temp"     value={ambient.wetBulbTemp}      onChange={(val) => handleAmbientChange('wetBulbTemp', val)}      unit="°C" />
              <NumberControl label="Relative Humidity" value={ambient.relativeHumidity} onChange={(val) => handleAmbientChange('relativeHumidity', val)} unit="%"  />
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
              These four values drive all load calculations across every room. Changes update results instantly.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <NumberControl
                label="Safety Factor"
                value={systemDesign.safetyFactor}
                onChange={(val) => handleSystemDesignChange('safetyFactor', val)}
                unit="%"
              />
              <NumberControl
                label="Apparatus Dew Point (ADP)"
                value={systemDesign.adp}
                onChange={(val) => handleSystemDesignChange('adp', val)}
                unit="°F"
              />
              <NumberControl
                label="Bypass Factor (BF)"
                value={systemDesign.bypassFactor}
                onChange={(val) => handleSystemDesignChange('bypassFactor', val)}
                unit="—"
              />
              <NumberControl
                label="Fan Heat Allowance"
                value={systemDesign.fanHeat}
                onChange={(val) => handleSystemDesignChange('fanHeat', val)}
                unit="%"
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
                &nbsp;· Fan heat multiplier = <strong>{fanDisp}×</strong>
              </p>
              <p className="text-[10px] text-amber-500 mt-1">
                ΔT preview uses 72°F reference indoor temp (22.2°C). Actual ΔT uses each room's designTemp.
                {supplyDT <= 0 && (
                  <span className="text-red-600 font-bold ml-2">
                    ⚠ ADP ≥ indoor temp — supply air calculation will produce 0 CFM. Lower ADP.
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}