import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { 
  selectAllRooms, 
  selectActiveRoomId, 
  setActiveRoom, 
  addRoom,
  deleteRoom
} from '../../features/room/roomSlice';

export default function RoomSidebar() {
  const dispatch = useDispatch();
  const rooms = useSelector(selectAllRooms);
  const activeId = useSelector(selectActiveRoomId);

  const handleDelete = (e, id) => {
    e.stopPropagation(); // Prevent clicking the row
    if (window.confirm("Delete this room?")) {
      dispatch(deleteRoom(id));
    }
  };

  return (
    <div className="w-full md:w-64 bg-white border-r border-gray-200 flex-shrink-0 flex flex-col h-full min-h-[500px]">
      <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
        <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide">Project Rooms</h3>
        <button 
          onClick={() => dispatch(addRoom())}
          className="bg-blue-600 text-white text-xs px-2 py-1 rounded hover:bg-blue-700 transition"
        >
          + Add
        </button>
      </div>
      
      <div className="overflow-y-auto flex-1 p-2 space-y-1">
        {rooms.map((room) => (
          <div 
            key={room.id}
            onClick={() => dispatch(setActiveRoom(room.id))}
            className={`group flex justify-between items-center p-3 rounded-lg cursor-pointer transition-colors text-sm
              ${room.id === activeId 
                ? 'bg-blue-50 text-blue-700 font-bold border border-blue-200' 
                : 'text-gray-600 hover:bg-gray-100'
              }`}
          >
            <div className="truncate">
              <div className="truncate">{room.name}</div>
              <div className="text-[10px] font-normal opacity-70">
                {room.floorArea} ft² • {room.assignedAhuIds?.length || 0} AHUs
              </div>
            </div>
            
            {/* Delete Button (Only show if not the only room) */}
            {rooms.length > 1 && (
              <button 
                onClick={(e) => handleDelete(e, room.id)}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 font-bold px-1"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}