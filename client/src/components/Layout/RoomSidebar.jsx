import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { 
  selectAllRooms, 
  selectActiveRoomId, 
  setActiveRoom, 
} from '../../features/room/roomSlice';
import { addNewRoom } from '../../features/room/roomActions';

export default function RoomSidebar() {
  const dispatch = useDispatch();
  const rooms = useSelector(selectAllRooms);
  const activeRoomId = useSelector(selectActiveRoomId);

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-[calc(100vh-64px)] shrink-0">
      
      {/* Header */}
      <div className="p-4 border-b border-gray-100 flex justify-between items-center">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Project Zones</h3>
        <button 
          onClick={() => dispatch(addNewRoom())}
          className="text-blue-600 hover:bg-blue-50 p-1 rounded transition-colors"
          title="Add New Room"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Room List */}
      <div className="flex-1 overflow-y-auto">
        {rooms.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400 italic">
            No rooms added yet.
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {rooms.map((room) => (
              <li key={room.id}>
                <button
                  onClick={() => dispatch(setActiveRoom(room.id))}
                  className={`w-full text-left px-4 py-3 transition-colors flex items-center justify-between group
                    ${activeRoomId === room.id 
                      ? 'bg-blue-50 border-r-4 border-blue-600' 
                      : 'hover:bg-gray-50 border-r-4 border-transparent'
                    }`}
                >
                  <div>
                    <div className={`text-sm font-bold ${activeRoomId === room.id ? 'text-blue-900' : 'text-gray-700'}`}>
                      {room.name}
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                      {room.roomNo || 'NO #'} • {room.floorArea} ft²
                    </div>
                  </div>
                  
                  {activeRoomId === room.id && (
                    <span className="text-blue-600">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer Stats */}
      <div className="p-4 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 text-center">
        {rooms.length} Total Zones
      </div>
    </div>
  );
}