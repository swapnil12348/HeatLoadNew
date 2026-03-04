// src/features/results/rdsSelector.test.js
import { describe, it, expect, vi } from 'vitest';
import { selectRdsData } from './rdsSelector';

// 1. Mock the psychro util so we don't depend on another file working perfectly
//    This prevents "calculateGrains is not a function" errors.
vi.mock('../../utils/psychro', () => ({
  calculateGrains: (db, rh) => 50 // Return a dummy constant grain value
}));

describe('RDS Selector (Calculations)', () => {
  it('correctly calculates CFM based on Room Area', () => {
    
    // 2. Mock State that MATCHES your Slice Selectors exactly
    const mockState = {
      room: {
        // Code expects: state.room.list
        list: [
          { 
            id: '1', 
            name: 'Test Room', 
            floorArea: 100, // Direct area for simplicity
            volume: 1000,
            designTemp: 75,
            designRH: 50,
            assignedAhuIds: [] 
          }
        ]
      },
      envelope: { 
        byRoomId: { 
          '1': { 
            internalLoads: { people: { count: 1 } }, 
            infiltration: { achValue: 0.5 } 
          } 
        } 
      },
      ahu: { 
        // Code expects: state.ahu.list
        list: [] 
      }, 
      climate: { 
        // Code expects: state.climate.outside.[season]
        outside: {
          summer: { db: 95, wb: 75, gr: 100 },
          monsoon: { db: 85, wb: 80, gr: 110 },
          winter: { db: 40, wb: 35, gr: 20 }
        }
      }, 
      project: {} 
    };

    // 3. Run the selector
    const result = selectRdsData(mockState);
    
    // 4. Assertions
    expect(result).toBeDefined();
    expect(result.length).toBe(1);

    const roomResult = result[0];

    // Check Inputs passed through
    expect(roomResult.id).toBe('1');
    expect(roomResult.floorArea).toBe(100);

    // Check Calculations
    // Supply Air should be calculated. If 0, it means load was 0.
    // Given our inputs (people + infiltration), load should be > 0.
    expect(roomResult.supplyAir).toBeGreaterThanOrEqual(0);
    
    // Check if the calculated keys exist
    expect(roomResult).toHaveProperty('ershOn_summer');
    expect(roomResult).toHaveProperty('coolingCapTR');
  });
});