export interface LatLng {
  lat: number;
  lng: number;
}

export interface ParishCenter {
  name: string;
  address: string;
  location: LatLng;
  placeId?: string;
}

export type TravelModeOption = 'WALKING' | 'DRIVING';

export interface PriestProfile {
  id: number;
  name: string;
  color: string;
  borderColor: string;
  textColor: string;
}

export type UnitVisitStatus =
  | 'pending'
  | 'accepted'
  | 'absent'
  | 'declined'
  | 'invited';

export interface BuildingUnit {
  id: string;
  unitNumber: string;
  staircase?: string;
  familyName?: string;
  notes?: string;
  status?: UnitVisitStatus;
  lastYearStatus?: UnitVisitStatus;
  durationMinutes?: number;
}

export interface VisitStop {
  id: string;
  label: string;
  address: string;
  location: LatLng;
  placeId?: string;
  durationMinutes: number;
  priestId: number;
  notes?: string;
  inBoundary?: boolean;
  included?: boolean;
  visitDate?: string; // 'YYYY-MM-DD' or '' if unassigned
  isMultiUnit?: boolean;
  unitsCount?: number;
  minutesPerUnit?: number;
  units?: BuildingUnit[];
  visitStatus?: UnitVisitStatus;
  lastYearStatus?: UnitVisitStatus;
  permanentDecline?: boolean;
  manualOrder?: number;
}

export interface RouteStageLink {
  stageIndex: number;
  startStopNumber: number;
  endStopNumber: number;
  isReturnLeg?: boolean;
  url: string;
}

export interface ScheduledStopItem {
  stop: VisitStop;
  orderIndex: number;
  arrivalTime: string;
  departureTime: string;
  legDistanceMeters: number;
  legDurationMillis: number;
}

export interface PriestRouteResult {
  priestId: number;
  priestName: string;
  color: string;
  orderedStops: ScheduledStopItem[];
  totalDistanceMeters: number;
  totalTravelDurationMillis: number;
  totalVisitMinutes: number;
  endTime: string;
  returnLegDistanceMeters: number;
  returnLegDurationMillis: number;
  encodedPathPoints: LatLng[];
  viewportBounds?: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
  error?: string;
}

export interface PlanConfig {
  priestCount: number;
  startTime: string;
  defaultVisitMinutes: number;
  travelMode: TravelModeOption;
  returnToParish: boolean;
}

export interface DayBreakWindow {
  id: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  label?: string;
}

export interface DayTimeWindow {
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  breaks?: DayBreakWindow[];
}

export type SeasonStreetSplitMode =
  | 'whole_or_half'
  | 'parity'
  | 'strict_budget';

export type SeasonZoneDirection =
  | 'clockwise'
  | 'nearest_first'
  | 'farthest_first';

export type SeasonBlockPreference =
  | 'any'
  | 'blocks_weekdays_houses_weekend';

export interface SeasonPlanningRules {
  splitMode: SeasonStreetSplitMode;
  zoneDirection: SeasonZoneDirection;
  blockPreference: SeasonBlockPreference;
  safetyBufferMinutes: number;
}

export interface SeasonPlanConfig {
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD optional horizon
  weekdayStartTime: string; // HH:MM
  saturdayStartTime?: string; // HH:MM optional override for Saturdays
  weekendStartTime: string; // HH:MM
  dailyEndTime: string; // HH:MM
  weekdaysMask: string; // comma-separated JS day indices 0..6 (e.g. '1,2,3,4,5,6')
  excludedDates?: string[]; // YYYY-MM-DD explicit days off (holidays, funerals, etc.)
  defaultBreaks?: DayBreakWindow[]; // default break windows inside a day
  planningRules?: SeasonPlanningRules;
  dayTimeOverrides?: Record<string, DayTimeWindow>;
}

export interface DayPlanSummary {
  date: string; // YYYY-MM-DD
  weekdayLabel: string;
  shortDateLabel: string;
  startTime: string;
  plannedEndTime?: string;
  estimatedEndTime: string;
  activeBreaks?: DayBreakWindow[];
  stops: VisitStop[];
  streetNames: string[];
  estimatedRoutes: PriestRouteResult[];
  totalDistanceMeters: number;
  totalVisitMinutes: number;
  totalTravelMillis: number;
}

export interface AutoSeasonSimulationResult {
  scheduledStops: VisitStop[];
  simulatedDays: DayPlanSummary[];
  newlyScheduledCount: number;
  preservedDaysCount: number;
  skippedPermanentDeclineCount: number;
  unscheduledRemainingCount: number;
  excludedHolidaysUsed: string[];
  hasOverflowPastHorizon: boolean;
}

export const PRIEST_PALETTE: PriestProfile[] = [
  {
    id: 1,
    name: 'Ksiądz 1 (Proboszcz)',
    color: '#1D4ED8',
    borderColor: '#1E3A8A',
    textColor: '#FFFFFF',
  },
  {
    id: 2,
    name: 'Ksiądz 2 (Wikariusz)',
    color: '#B45309',
    borderColor: '#78350F',
    textColor: '#FFFFFF',
  },
  {
    id: 3,
    name: 'Ksiądz 3 (Wikariusz)',
    color: '#0F766E',
    borderColor: '#134E4A',
    textColor: '#FFFFFF',
  },
  {
    id: 4,
    name: 'Ksiądz 4 (Gość / Rezydent)',
    color: '#6D28D9',
    borderColor: '#4C1D95',
    textColor: '#FFFFFF',
  },
];

export type MapInteractionMode =
  | 'pan'
  | 'draw_boundary'
  | 'edit_boundary'
  | 'lasso_select'
  | 'pick_street'
  | 'add_stop';

export type BoundaryDrawTool = 'lasso' | 'rect' | 'crosshair' | 'points';

export type MarkerLabelMode = 'auto' | 'numbers' | 'dots';

export interface StreetPickFeedback {
  status: 'loading' | 'success' | 'info' | 'error';
  message: string;
}

export interface SavedParishRecord {
  id: string;
  parish: ParishCenter;
  boundary: LatLng[];
  config: PlanConfig;
  seasonConfig?: SeasonPlanConfig;
  updatedAtMs: number;
}


