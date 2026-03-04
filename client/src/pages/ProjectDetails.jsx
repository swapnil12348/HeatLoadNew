import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updateProjectInfo, updateAmbient, updateSystemDesign } from '../features/project/projectSlice';
import NumberControl from '../components/UI/NumberControl';
import InputField from '../components/UI/InputField';

export default function ProjectDetails() {
  const dispatch = useDispatch();

  // Access state from Redux (structure matches projectSlice.js)
  const { info, ambient, systemDesign } = useSelector((state) => state.project);

  // 1. Handle Text Inputs (Dispatches to info object)
  const handleTextChange = (e) => {
    dispatch(updateProjectInfo({ field: e.target.name, value: e.target.value }));
  };

  // 2. Handle Numeric Inputs (Dispatches to ambient object)
  const handleAmbientChange = (field, value) => {
    dispatch(updateAmbient({ field, value }));
  };

  // 3. Handle System Design Inputs
  const handleSystemDesignChange = (field, value) => {
    dispatch(updateSystemDesign({ field, value }));
  };

  // 3. Handle Reset
  const handleReset = () => {
    if (window.confirm("⚠️ Are you sure you want to clear ALL project data?")) {
      localStorage.removeItem("heatLoadProjectData"); // If you implement persistence later
      window.location.reload();
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8">

      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 border-b border-gray-200 pb-4 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Project Details</h2>
          <p className="text-gray-500 mt-2 text-base">
            Manage project details, client information, and environmental design criteria.
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

        {/* ── General Info ── */}
        <div className="lg:col-span-8 space-y-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-lg font-bold text-gray-800 flex items-center mb-6 border-b pb-2">
              <span className="bg-blue-100 text-blue-700 w-8 h-8 flex items-center justify-center rounded-full mr-3 text-sm">1</span>
              General Information
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              <InputField label="Project Name" name="projectName" value={info.projectName} onChange={handleTextChange} placeholder="e.g. Gigafactory" fullWidth />
              <InputField label="Location" name="projectLocation" value={info.projectLocation} onChange={handleTextChange} placeholder="City, Country" fullWidth />
              <InputField label="Customer Name" name="customerName" value={info.customerName} onChange={handleTextChange} />
              <InputField label="Consultant Name" name="consultantName" value={info.consultantName} onChange={handleTextChange} />
              <InputField label="Key Account Manager" name="keyAccountManager" value={info.keyAccountManager} onChange={handleTextChange} />

              {/* Industry Select */}
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

        {/* ── System Design Parameters ── */}
<div className="lg:col-span-8">
  <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
    <h3 className="text-lg font-bold text-gray-800 flex items-center mb-6 border-b pb-2">
      <span className="bg-amber-100 text-amber-700 w-8 h-8 flex items-center justify-center rounded-full mr-3 text-sm">3</span>
      System Design Parameters
    </h3>

    <p className="text-xs text-gray-500 mb-6">
      These values drive all load calculations across every room. Changes here update results instantly.
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
        label="Bypass Factor"
        value={systemDesign.bypassFactor}
        onChange={(val) => handleSystemDesignChange('bypassFactor', val)}
        unit="BF"
      />
      <NumberControl
        label="Fan Heat Allowance"
        value={systemDesign.fanHeat}
        onChange={(val) => handleSystemDesignChange('fanHeat', val)}
        unit="%"
      />
    </div>

    {/* Live preview of what these values mean */}
    <div className="mt-6 p-4 bg-amber-50 border border-amber-100 rounded-lg">
      <p className="text-xs text-amber-800 font-medium">
        Current supply ΔT = <strong>{((1 - systemDesign.bypassFactor) * (72 - systemDesign.adp)).toFixed(1)} °F</strong>
        &nbsp;· Safety multiplier = <strong>{(1 + systemDesign.safetyFactor / 100).toFixed(2)}×</strong>
        &nbsp;· Fan heat multiplier = <strong>{(1 + systemDesign.fanHeat / 100).toFixed(2)}×</strong>
      </p>
    </div>
  </div>
</div>

        {/* ── Ambient Conditions ── */}
        <div className="lg:col-span-4">
          <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 sticky top-4 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center border-b border-slate-200 pb-2">
              <span className="bg-slate-200 text-slate-700 w-8 h-8 flex items-center justify-center rounded-full mr-3 text-sm">2</span>
              Ambient Conditions
            </h3>

            <div className="space-y-5">
              <NumberControl label="Dry Bulb Temperature" value={ambient.dryBulbTemp} onChange={(val) => handleAmbientChange('dryBulbTemp', val)} unit="°C" />
              <NumberControl label="Wet Bulb Temperature" value={ambient.wetBulbTemp} onChange={(val) => handleAmbientChange('wetBulbTemp', val)} unit="°C" />
              <NumberControl label="Relative Humidity" value={ambient.relativeHumidity} onChange={(val) => handleAmbientChange('relativeHumidity', val)} unit="%" />

              <hr className="border-slate-200 my-2" />

              <div className="grid grid-cols-2 gap-3">
                <NumberControl label="Elevation" value={ambient.elevation} onChange={(val) => handleAmbientChange('elevation', val)} unit="ft" />
                <NumberControl label="Latitude" value={ambient.latitude} onChange={(val) => handleAmbientChange('latitude', val)} unit="°" />
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}