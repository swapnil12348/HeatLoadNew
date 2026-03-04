// src/pages/RDSPage.test.jsx
import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import RDSPage from './RDSPage';
import { renderWithProviders } from '../test-utils';

// Helper to get a valid empty state structure
const getBaseState = () => ({
  room: { list: [] }, // CORRECT: uses .list
  envelope: { byRoomId: {} },
  ahu: { list: [] },  // CORRECT: uses .list
  climate: { 
    outside: { 
      summer: { db: 95, wb: 75 },
      winter: { db: 40, wb: 35 },
      monsoon: { db: 85, wb: 80 }
    } 
  },
  project: { settings: {} }
});

describe('RDSPage Component', () => {
  
  it('renders the "No rooms" message when store is explicitly empty', () => {
    // 1. Setup empty state
    const emptyState = getBaseState();

    renderWithProviders(<RDSPage />, { preloadedState: emptyState });

    // 2. Assert
    // It should find "No rooms yet" because the list is empty
    expect(screen.getByText(/No rooms yet/i)).toBeInTheDocument();
  });

  it('renders a room row when data exists', () => {
    // 1. Setup state with 1 room
    const filledState = getBaseState();
    filledState.room.list = [
      { id: '99', name: 'Office 99', roomNo: '99', floorArea: 100, volume: 1000 }
    ];
    // We need an envelope entry or the selector might complain
    filledState.envelope.byRoomId = { '99': {} };

    renderWithProviders(<RDSPage />, { preloadedState: filledState });

    // 2. Assert
    // It should find the room name
    expect(screen.getByText('Office 99')).toBeInTheDocument();
    // It should NOT find the empty message
    expect(screen.queryByText(/No rooms yet/i)).not.toBeInTheDocument();
  });

  it('dispatches add room action when button clicked', async () => {
    // 1. Render with default store (uses your actual reducers)
    const { store } = renderWithProviders(<RDSPage />);
    
    // 2. Get initial count (safely check list or empty array)
    const initialCount = store.getState().room.list?.length || 0;
    
    // 3. Click the "Add Room" button
    const addButton = screen.getByText('+ Add Room');
    fireEvent.click(addButton);

    // 4. Assert that count increased
    const newCount = store.getState().room.list?.length || 0;
    expect(newCount).toBeGreaterThan(initialCount);
  });
});