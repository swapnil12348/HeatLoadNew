import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  list: [
    { id: 'ahu1', name: 'AHU-01', type: 'Recirculating' },
    { id: 'ahu2', name: 'AHU-02', type: 'DOAS' }
  ]
};

const ahuSlice = createSlice({
  name: 'ahu',
  initialState,
  reducers: {
    addAHU: (state) => {
      const newId = `ahu_${Date.now()}`;
      state.list.push({
        id: newId,
        name: `AHU-${state.list.length + 1}`,
        type: 'Recirculating'
      });
    },
    updateAHU: (state, action) => {
      const { id, field, value } = action.payload;
      const ahu = state.list.find(a => a.id === id);
      if (ahu) {
        ahu[field] = value;
      }
    },
    deleteAHU: (state, action) => {
      state.list = state.list.filter(a => a.id !== action.payload);
    }
  }
});

export const { addAHU, updateAHU, deleteAHU } = ahuSlice.actions;
export const selectAllAHUs = (state) => state.ahu.list;
export default ahuSlice.reducer;