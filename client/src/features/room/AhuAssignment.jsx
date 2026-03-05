import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { selectAllAHUs } from '../ahu/ahuSlice';
import { toggleRoomAhu } from './roomSlice';

const AhuAssignment = ({ activeRoom }) => {
  const dispatch = useDispatch();
  const allAhus  = useSelector(selectAllAHUs);

  const handleToggleAhu = (ahuId) => {
    dispatch(toggleRoomAhu({ roomId: activeRoom.id, ahuId }));
  };

  return (
    <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-full">
      <div className="mb-4">
        <h3 className="text-lg font-bold text-gray-800">Assigned AHUs</h3>
        <p className="text-xs text-gray-500 mt-1">
          Select which Air Handling Units supply air to this room.
        </p>
      </div>

      {allAhus.length === 0 ? (
        <div className="p-4 bg-yellow-50 text-yellow-800 text-xs rounded border border-yellow-200">
          No AHUs configured. Go to <strong>AHU Config</strong> to create units first.
        </div>
      ) : (
        <div className="space-y-3">
          {allAhus.map((ahu) => {
            const isSelected = activeRoom.assignedAhuIds?.includes(ahu.id);
            return (
              <label
                key={ahu.id}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all
                  ${isSelected
                    ? 'bg-blue-50 border-blue-200 shadow-sm'
                    : 'bg-gray-50 border-gray-100 hover:bg-white hover:border-gray-300'
                  }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => handleToggleAhu(ahu.id)}
                  className="mt-1 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
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