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
  | 'pick_street'
  | 'add_stop';

export interface StreetPickFeedback {
  status: 'loading' | 'success' | 'info' | 'error';
  message: string;
}

export interface SavedParishRecord {
  id: string;
  parish: ParishCenter;
  boundary: LatLng[];
  config: PlanConfig;
  updatedAtMs: number;
}

