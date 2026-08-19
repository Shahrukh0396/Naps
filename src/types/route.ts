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

export type RouteAlertKind =
  | 'military'
  | 'crime'
  | 'fire'
  | 'incident'
  | 'route_restriction';

export interface RouteAlert {
  id: string;
  kind: RouteAlertKind;
  title: string;
  message: string;
  coordinate: LatLng;
  /** Approximate alert radius in meters for map Circle */
  radiusMeters: number;
}

/** Roads-snapped path used for Navigate rendering + proximity checks. */
export interface SnappedRoutePath {
  coordinates: LatLng[];
  /** placeIds aligned to snapped points when Roads returns them */
  placeIds?: (string | null)[];
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
  /** True when Routes API reports ignored travel restrictions on this path. */
  routeRestrictionsPartiallyIgnored?: boolean;
  alerts?: RouteAlert[];
  /** Unsafe places this path still passes near (bases, crime, fire, other incidents). */
  restrictedNear?: {
    count: number;
    titles: string[];
  };
}

export interface RestrictedRouteOption {
  styleId: RouteStyleId;
  route: RouteResult;
  variant: RouteVariant;
  restrictedCount: number;
  restrictedTitles: string[];
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
