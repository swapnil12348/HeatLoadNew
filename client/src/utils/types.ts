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
  adp: number | null;
  filterClass: string;
  location: string;
  notes: string;
}

export interface ProjectInfo {
  projectName: string;
  projectLocation: string;
  customerName: string;
  consultantName: string;
  industry: string;
  keyAccountManager: string;
}

export interface AmbientParams {
  elevation: number;
  latitude: number;
  dailyRange: number;
  dryBulbTemp: number;
  wetBulbTemp: number;
  relativeHumidity: number;
}

export interface SystemDesign {
  safetyFactor: number;
  ductHeatGain: number;
  bypassFactor: number;
  adp: number;
  adpMode: 'manual' | 'calculated' | string;
  fanHeat: number;
  returnFanHeat: number;
  humidificationTarget: number;
}

export interface ProjectState {
  info: ProjectInfo;
  ambient: AmbientParams;
  systemDesign: SystemDesign;
}

// ── Envelope Types ──────────────────────────────────────────────
export interface EnvelopeElement {
  id: string;
  label?: string;
  orientation?: string;
  construction?: string;
  uPreset?: string;
  uValue?: number;
  area?: number;
  scPreset?: string;
  shgc?: number;
  sc?: number;
  tAdj?: number;
  tAdjSummer?: number;
  tAdjWinter?: number;
  [key: string]: any;
}

export interface InternalPeople {
  count: number;
  sensiblePerPerson: number;
  latentPerPerson: number;
}

export interface InternalLights {
  wattsPerSqFt: number;
  useSchedule: number;
  ballastFactor: number;
}

export interface InternalEquipment {
  kw: number;
  sensiblePct: number;
  latentPct: number;
  diversityFactor: number;
}

export interface RoomInfiltration {
  method: string;
  achValue: number;
  cfmValue: number;
  doors: any[];
}

export interface RoomEnvelope {
  elements: {
    walls: EnvelopeElement[];
    roofs: EnvelopeElement[];
    glass: EnvelopeElement[];
    skylights: EnvelopeElement[];
    partitions: EnvelopeElement[];
    floors: EnvelopeElement[];
    [key: string]: EnvelopeElement[];
  };
  internalLoads: {
    people: InternalPeople;
    lights: InternalLights;
    equipment: InternalEquipment;
  };
  infiltration: RoomInfiltration;
}

export interface EnvelopeState {
  byRoomId: Record<string, RoomEnvelope>;
}

// Remember to update your RootState at the bottom of types.ts:
// export interface RootState {
//   room: RoomState;
//   ahu: AhuState;
//   project: ProjectState;
// }

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
// This imports the automatically generated RootState and exports it to the rest of the app!
export type { RootState } from '../app/store';

export interface SeasonCondition {
  db: number | string;
  rh: number | string;
  time: string;
  month: string;
  gr: number | null;
  dp: number | null;
  wb: number | null;
}

export interface ClimateState {
  outside: {
    summer: SeasonCondition;
    monsoon: SeasonCondition;
    winter: SeasonCondition;
    [key: string]: SeasonCondition; 
  };
}