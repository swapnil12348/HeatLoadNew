/**
 * AhuAssignment.jsx
 * Responsibility: Assign a single AHU to a room (RoomConfig right column).
 *
 * -- CHANGELOG v2.1 -----------------------------------------------------------
 *
 *   BUG-UI-18 [CRITICAL — ARCHITECTURAL INCONSISTENCY] — multi-select checkbox
 *     UI replaced with single-select radio UI. Dispatches setRoomAhu (not
 *     toggleRoomAhu) to match the rest of the calculation chain.
 *
 *     Root cause: AhuAssignment used toggleRoomAhu (adds/removes from
 *     assignedAhuIds array), implying a room can serve multiple AHUs. But
 *     every downstream consumer reads only index [0]:
 *
 *       rdsSelector          → room.assignedAhuIds?.[0]
 *       useRdsRow            → handleAhuChange dispatches setRoomAhu (replace)
 *       RDSPage AHU grouping → row.ahuId (singular, from [0])
 *       useProjectTotals     → byAhu aggregation keyed to single ahuId
 *
 *     Consequence: if an engineer checked two AHUs in this panel, the second
 *     assignment was silently ignored by all calculations — no load, no CFM,
 *     no pipe sizing contribution, no error or warning shown.
 *
 *     Fix: radio buttons + setRoomAhu (single replace, matches calc chain).
 *     An "Unassigned" option is surfaced explicitly so engineers can deliberately
 *     detach a room (previously only possible by unchecking in a multi-select).
 *     A small architectural note is shown below the header so the one-AHU-per-room
 *     constraint is visible in the UI, not just in the codebase.
 *
 *     toggleRoomAhu import removed. setRoomAhu import added.
 *
 *   BUG-UI-19 [LOW] — unused React import removed.
 *     Vite with React 17+ automatic JSX transform does not require explicit import.
 */

import { useSelector, useDispatch }      from 'react-redux';
import { selectAllAHUs }                 from '../ahu/ahuSlice';
// BUG-UI-18 FIX: setRoomAhu (single replace) replaces toggleRoomAhu (multi-toggle).
import { setRoomAhu }                    from './roomSlice';

const AhuAssignment = ({ activeRoom }) => {
  const dispatch = useDispatch();
  const allAhus  = useSelector(selectAllAHUs);

  // BUG-UI-18 FIX: single selected AHU is always [0].
  // toggleRoomAhu multi-select was architecturally inconsistent — all
  // downstream consumers only read assignedAhuIds[0].
  const currentAhuId = activeRoom.assignedAhuIds?.[0] ?? '';

  const handleSelect = (ahuId) => {
    dispatch(setRoomAhu({ roomId: activeRoom.id, ahuId }));
  };

  return (
    <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-full">
      <div className="mb-4">
        <h3 className="text-lg font-bold text-gray-800">Assigned AHU</h3>
        {/* BUG-UI-18 FIX: surface the one-AHU-per-room constraint in the UI */}
        <p className="text-xs text-gray-500 mt-1">
          Select the Air Handling Unit that supplies air to this room.
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
          One AHU per room — all load, CFM, and pipe sizing calculations use this assignment.
        </p>
      </div>

      {allAhus.length === 0 ? (
        <div className="p-4 bg-yellow-50 text-yellow-800 text-xs rounded border border-yellow-200">
          No AHUs configured. Go to <strong>AHU Config</strong> to create units first.
        </div>
      ) : (
        <div className="space-y-2">

          {/* BUG-UI-18 FIX: explicit "Unassigned" option.
              Previously unassigning required unchecking in a multi-select.
              Now it's a first-class radio option. */}
          <label
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all
              ${!currentAhuId
                ? 'bg-amber-50 border-amber-200 shadow-sm'
                : 'bg-gray-50 border-gray-100 hover:bg-white hover:border-gray-300'
              }`}
          >
            <input
              type="radio"
              name={`ahu-${activeRoom.id}`}
              value=""
              checked={!currentAhuId}
              onChange={() => handleSelect('')}
              className="mt-1 w-4 h-4 text-amber-500 border-gray-300 focus:ring-amber-400"
            />
            <div>
              <div className={`text-sm font-bold ${!currentAhuId ? 'text-amber-800' : 'text-gray-500'}`}>
                Unassigned
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                Room excluded from all AHU load summaries
              </div>
            </div>
          </label>

          {allAhus.map((ahu) => {
            const isSelected = currentAhuId === ahu.id;
            return (
              <label
                key={ahu.id}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all
                  ${isSelected
                    ? 'bg-blue-50 border-blue-200 shadow-sm'
                    : 'bg-gray-50 border-gray-100 hover:bg-white hover:border-gray-300'
                  }`}
              >
                {/* BUG-UI-18 FIX: radio (single-select) replaces checkbox (multi-select) */}
                <input
                  type="radio"
                  name={`ahu-${activeRoom.id}`}
                  value={ahu.id}
                  checked={isSelected}
                  onChange={() => handleSelect(ahu.id)}
                  className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                />
                <div>
                  <div className={`text-sm font-bold ${isSelected ? 'text-blue-900' : 'text-gray-700'}`}>
                    {ahu.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {ahu.type || 'Standard Config'}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default AhuAssignment;