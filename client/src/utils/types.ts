// src/types.ts

export interface ExhaustAir {
  general: number;
  bibo: number;
  machine: number;
}

export interface Room {
  id: string;
  name: string;
  roomNo: string;
  level: string;
  function: string;
  length: number;
  width: number;
  height: number;
  floorArea: number;
  volume: number;
  designTemp: number;
  designDB: number;
  designRH: number;
  pressure: number;
  classInOp: string;
  atRestClass: string;
  recOt: string;
  flpType: string;
  ventCategory: string;
  minAcph: number;
  designAcph: number;
  manualFreshAir: number;
  exhaustAir: ExhaustAir;
  assignedAhuIds: string[];
}

export interface RoomState {
  activeRoomId: string | null;
  list: Room[];
}

export interface AHU {
  id: string;
  name: string;
  tag: string;
  type: 'Recirculating' | 'DOAS' | 'MAU' | 'FCU' | string;
  capacityTR: number;
  heatingCapKW: number;
  supplyFanCFM: number;
  returnFanCFM: number;
  outerAirCFM: number;
  bypassFactor: number;
  adpMode: 'manual' | 'calculated';
  adp: number;
  filterClass: string;
  location: string;
  notes: string;
}

export interface AhuState {
  list: AHU[];
}

// Ensure your RootState (at the very bottom of types.ts) looks like this now:
// export interface RootState {
//   room: RoomState;
//   ahu: AhuState;
// }

// A temporary root state type so our selectors don't complain.
// Later, when you configure your Redux store, this will be generated automatically.
export interface RootState {
  room: RoomState;
  ahu: AhuState;
}
