import { createSlice } from '@reduxjs/toolkit';

// Helper for IDs
const generateRoomId = () => `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

const initialState = {
  activeRoomId: "room_default_1", // Tracks which room is being edited in UI
  list: [
    {
      id: "room_default_1",
      name: "Main Production Room",
      length: 20,
      width: 15,
      height: 10,
      floorArea: 300, // calculated or manual
      volume: 3000,
      pressure: 15, // Pascals
      // ★ THE LINK: Which AHUs supply this room?
      assignedAhuIds: ["ahu_default_1"] 
    }
  ]
};

const roomSlice = createSlice({
  name: 'room',
  initialState,
  reducers: {
    setActiveRoom: (state, action) => {
      state.activeRoomId = action.payload;
    },
    addRoom: (state) => {
      const newId = generateRoomId();
      const newRoom = {
        id: newId,
        name: `New Room ${state.list.length + 1}`,
        length: 0, width: 0, height: 10,
        floorArea: 0, volume: 0, pressure: 15,
        assignedAhuIds: []
      };
      state.list.push(newRoom);
      state.activeRoomId = newId; // Auto-switch to new room
    },
    updateRoom: (state, action) => {
      const { id, field, value } = action.payload;
      const room = state.list.find(r => r.id === id);
      if (room) {
        room[field] = value;
        // Auto-calc geometry if dimensions change
        if (['length', 'width'].includes(field)) {
          room.floorArea = room.length * room.width;
          room.volume = room.floorArea * room.height;
        }
        if (field === 'height') {
          room.volume = room.floorArea * value;
        }
      }
    },
    // ★ LINKING LOGIC: Toggle an AHU for a Room
    toggleRoomAhu: (state, action) => {
      const { roomId, ahuId } = action.payload;
      const room = state.list.find(r => r.id === roomId);
      if (room) {
        const index = room.assignedAhuIds.indexOf(ahuId);
        if (index === -1) {
          room.assignedAhuIds.push(ahuId); // Add link
        } else {
          room.assignedAhuIds.splice(index, 1); // Remove link
        }
      }
    },
    deleteRoom: (state, action) => {
      const idToDelete = action.payload;
      if (state.list.length > 1) {
        state.list = state.list.filter(r => r.id !== idToDelete);
        // If we deleted the active room, switch to the first available
        if (state.activeRoomId === idToDelete) {
          state.activeRoomId = state.list[0].id;
        }
      }
    }
  }
});

export const { setActiveRoom, addRoom, updateRoom, toggleRoomAhu, deleteRoom } = roomSlice.actions;

// Selectors
export const selectAllRooms = (state) => state.room.list;
export const selectActiveRoomId = (state) => state.room.activeRoomId;
export const selectActiveRoom = (state) => 
  state.room.list.find(r => r.id === state.room.activeRoomId) || state.room.list[0];

export default roomSlice.reducer;