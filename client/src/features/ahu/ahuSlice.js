import { createSlice } from '@reduxjs/toolkit';

// Helper to generate IDs
const generateId = () => `ahu_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const initialState = {
  list: [
    {
      id: "ahu_default_1", // Changed to string ID for better linking
      name: "AHU-01",
      roomName: "Production Hall", // Optional display name
      isoClass: "ISO 8",
      designScheme: "Conventional Pharma Ducting",
      configuration: "Draw-through"
    }
  ]
};

const ahuSlice = createSlice({
  name: 'ahus',
  initialState,
  reducers: {
    addAHU: (state) => {
      const newId = generateId();
      state.list.push({
        id: newId,
        name: `AHU-${state.list.length + 1}`,
        isoClass: "ISO 8",
        designScheme: "Conventional Pharma Ducting",
        configuration: "Draw-through"
      });
    },
    updateAHU: (state, action) => {
      const { id, field, value } = action.payload;
      const ahu = state.list.find(item => item.id === id);
      if (ahu) {
        ahu[field] = value;
      }
    },
    deleteAHU: (state, action) => {
      if (state.list.length > 1) {
        state.list = state.list.filter(item => item.id !== action.payload);
      }
    }
  }
});

export const { addAHU, updateAHU, deleteAHU } = ahuSlice.actions;
export const selectAllAHUs = (state) => state.ahus.list;
export default ahuSlice.reducer;