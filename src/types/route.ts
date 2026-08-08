export type RouteStyleId = 'highway' | 'no-highway' | 'scenic' | 'fewer-lights';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface NavStep {
  instruction: string;
  distance: string;
  duration: string;
  endLocation?: LatLng;
}

export interface RouteLeg {
  distance: string;
  duration: string;
  steps: NavStep[];
}

export interface RouteResult {
  polyline: string;
  durationSeconds: number;
  durationText: string;
  summary: string;
  isLoop: boolean;
  destination?: string | null;
  streetViewUrl: string | null;
  origin: LatLng;
  waypoint: LatLng;
  allWaypoints?: LatLng[];
  extraStops?: string[];
  legs: RouteLeg[];
}

export interface RouteVariant {
  id: RouteStyleId;
  emoji: string;
  label: string;
  sublabel: string;
  durationMinutes: number;
  durationText: string;
  summary: string;
  napMatchScore: number;
  isLoop: boolean;
}

export interface PlanParams {
  originMode: 'gps' | 'custom';
  customOrigin: string;
  endMode: 'loop' | 'custom';
  customEnd: string;
  durationMinutes: number;
  routeType: RouteStyleId;
  extraStops: string[];
}
