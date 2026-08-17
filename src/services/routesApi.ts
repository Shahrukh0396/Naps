import { GOOGLE_MAPS_API_KEY } from '../config/maps';
import { RouteError } from './routeError';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const FIELD_MASK = [
  'routes.duration',
  'routes.staticDuration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
  'routes.description',
  'routes.travelAdvisory.routeRestrictionsPartiallyIgnored',
  'routes.legs.duration',
  'routes.legs.staticDuration',
  'routes.legs.distanceMeters',
  'routes.legs.startLocation',
  'routes.legs.endLocation',
  'routes.legs.steps.navigationInstruction',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.startLocation',
  'routes.legs.steps.endLocation',
].join(',');

export type LatLng = { lat: number; lng: number };

export type NormalizedStep = {
  instruction: string;
  distanceText: string;
  durationText: string;
  start: LatLng;
  end: LatLng;
};

export type NormalizedLeg = {
  distanceText: string;
  distanceMeters: number;
  durationSeconds: number;
  durationText: string;
  start: LatLng;
  end: LatLng;
  steps: NormalizedStep[];
};

/** Normalized drive result used by nap route planners. */
export type TrafficAwareRoute = {
  status: 'OK' | string;
  summary: string;
  polyline: string;
  /** Live / predicted traffic duration (preferred for nap matching). */
  durationSeconds: number;
  staticDurationSeconds: number;
  legs: NormalizedLeg[];
  /** Which backend produced the ETA. */
  source: 'routes' | 'directions';
  /** Routes travel advisory — path may ignore some road restrictions. */
  routeRestrictionsPartiallyIgnored?: boolean;
};

export type ComputeDriveParams = {
  origin: LatLng | string;
  destination: LatLng | string;
  /** Intermediate stop waypoints (lat,lng strings or addresses). */
  waypoints?: string[];
  avoidHighways?: boolean;
  avoidTolls?: boolean;
};

function parseDurationSecs(value?: string | null): number {
  if (!value) return 0;
  const match = String(value).match(/^([\d.]+)s$/);
  return match ? Math.round(parseFloat(match[1])) : 0;
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  if (miles < 0.1) {
    return `${Math.max(1, Math.round(meters * 3.28084))} ft`;
  }
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

function formatDuration(secs: number): string {
  const mins = Math.max(1, Math.round(secs / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${h} hr ${rem} min` : `${h} hr`;
}

function isCoordString(value: string): boolean {
  const parts = value.split(',');
  if (parts.length !== 2) return false;
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    parts[1].trim() !== '' &&
    /^-?\d/.test(parts[1].trim())
  );
}

function toLatLng(value: LatLng | string): LatLng | null {
  if (typeof value !== 'string') return value;
  if (!isCoordString(value)) return null;
  const [lat, lng] = value.split(',').map(Number);
  return { lat, lng };
}

function toRoutesWaypoint(value: LatLng | string): Record<string, unknown> {
  if (typeof value !== 'string') {
    return {
      location: {
        latLng: { latitude: value.lat, longitude: value.lng },
      },
    };
  }
  if (isCoordString(value)) {
    const [lat, lng] = value.split(',').map(Number);
    return {
      location: {
        latLng: { latitude: lat, longitude: lng },
      },
    };
  }
  return { address: value };
}

function encodeParam(value: LatLng | string): string {
  if (typeof value === 'string') return encodeURIComponent(value);
  return `${value.lat},${value.lng}`;
}

type RoutesApiRoute = {
  duration?: string;
  staticDuration?: string;
  distanceMeters?: number;
  description?: string;
  polyline?: { encodedPolyline?: string };
  travelAdvisory?: {
    routeRestrictionsPartiallyIgnored?: boolean;
  };
  legs?: Array<{
    duration?: string;
    staticDuration?: string;
    distanceMeters?: number;
    startLocation?: { latLng?: { latitude?: number; longitude?: number } };
    endLocation?: { latLng?: { latitude?: number; longitude?: number } };
    steps?: Array<{
      navigationInstruction?: { instructions?: string };
      distanceMeters?: number;
      staticDuration?: string;
      startLocation?: { latLng?: { latitude?: number; longitude?: number } };
      endLocation?: { latLng?: { latitude?: number; longitude?: number } };
    }>;
  }>;
};

function latLngFromRoutes(loc?: {
  latLng?: { latitude?: number; longitude?: number };
}): LatLng {
  return {
    lat: loc?.latLng?.latitude ?? 0,
    lng: loc?.latLng?.longitude ?? 0,
  };
}

function fromRoutesApi(route: RoutesApiRoute): TrafficAwareRoute {
  const durationSeconds = parseDurationSecs(route.duration);
  const staticDurationSeconds = parseDurationSecs(route.staticDuration);
  const legs: NormalizedLeg[] = (route.legs ?? []).map(leg => {
    const legSecs =
      parseDurationSecs(leg.duration) || parseDurationSecs(leg.staticDuration);
    const meters = leg.distanceMeters ?? 0;
    return {
      distanceText: formatDistance(meters),
      distanceMeters: meters,
      durationSeconds: legSecs,
      durationText: formatDuration(legSecs),
      start: latLngFromRoutes(leg.startLocation),
      end: latLngFromRoutes(leg.endLocation),
      steps: (leg.steps ?? []).map(step => {
        const stepSecs = parseDurationSecs(step.staticDuration);
        const stepMeters = step.distanceMeters ?? 0;
        return {
          instruction: step.navigationInstruction?.instructions ?? '',
          distanceText: formatDistance(stepMeters),
          durationText: formatDuration(stepSecs || 1),
          start: latLngFromRoutes(step.startLocation),
          end: latLngFromRoutes(step.endLocation),
        };
      }),
    };
  });

  return {
    status: 'OK',
    summary: route.description || 'Traffic-aware route',
    polyline: route.polyline?.encodedPolyline ?? '',
    durationSeconds: durationSeconds || staticDurationSeconds,
    staticDurationSeconds,
    legs,
    source: 'routes',
    routeRestrictionsPartiallyIgnored:
      !!route.travelAdvisory?.routeRestrictionsPartiallyIgnored,
  };
}

async function computeViaRoutesApi(
  params: ComputeDriveParams,
): Promise<TrafficAwareRoute | null> {
  const apiKey = GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const body: Record<string, unknown> = {
    origin: toRoutesWaypoint(params.origin),
    destination: toRoutesWaypoint(params.destination),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
    trafficModel: 'BEST_GUESS',
    // Routes API rejects "now" / past timestamps — use a near-future departure.
    departureTime: new Date(Date.now() + 60_000).toISOString(),
    polylineQuality: 'HIGH_QUALITY',
    polylineEncoding: 'ENCODED_POLYLINE',
    units: 'IMPERIAL',
    languageCode: 'en-US',
  };

  if (params.waypoints && params.waypoints.length > 0) {
    body.intermediates = params.waypoints.map(toRoutesWaypoint);
  }

  if (params.avoidHighways || params.avoidTolls) {
    body.routeModifiers = {
      avoidHighways: !!params.avoidHighways,
      avoidTolls: !!params.avoidTolls,
    };
  }

  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as {
    error?: { status?: string; message?: string };
    routes?: RoutesApiRoute[];
  };

  if (!res.ok || data.error || !data.routes?.[0]) {
    if (__DEV__) {
      console.log(
        '[routesApi] computeRoutes failed',
        data.error?.status || res.status,
        data.error?.message,
      );
    }
    return null;
  }

  return fromRoutesApi(data.routes[0]);
}

type DirectionsPayload = {
  status: string;
  routes: Array<{
    overview_polyline: { points: string };
    summary: string;
    legs: Array<{
      duration: { value: number; text: string };
      duration_in_traffic?: { value: number; text: string };
      distance: { value: number; text: string };
      start_location: { lat: number; lng: number };
      end_location: { lat: number; lng: number };
      steps: Array<{
        html_instructions: string;
        distance: { text: string };
        duration: { text: string };
        start_location: { lat: number; lng: number };
        end_location: { lat: number; lng: number };
      }>;
    }>;
  }>;
};

async function computeViaDirectionsApi(
  params: ComputeDriveParams,
): Promise<TrafficAwareRoute> {
  const apiKey = GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new RouteError('Maps API key not configured');
  }

  const avoidParts: string[] = [];
  if (params.avoidHighways) avoidParts.push('highways');
  if (params.avoidTolls) avoidParts.push('tolls');
  const avoidStr = avoidParts.length ? `&avoid=${avoidParts.join('|')}` : '';
  const waypointStr =
    params.waypoints && params.waypoints.length > 0
      ? `&waypoints=${params.waypoints.join('|')}`
      : '';

  // Always request live traffic — required for Maps-app-comparable ETAs.
  // Previously loops omitted these and fell back to static speed-limit durations.
  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${encodeParam(params.origin)}` +
    `&destination=${encodeParam(params.destination)}` +
    waypointStr +
    `&mode=driving` +
    avoidStr +
    `&departure_time=now&traffic_model=best_guess` +
    `&key=${apiKey}`;

  const res = await fetch(url);
  const data = (await res.json()) as DirectionsPayload;

  if (data.status !== 'OK' || !data.routes[0]) {
    return {
      status: data.status || 'UNKNOWN',
      summary: '',
      polyline: '',
      durationSeconds: 0,
      staticDurationSeconds: 0,
      legs: [],
      source: 'directions',
    };
  }

  const route = data.routes[0];
  const durationSeconds = route.legs.reduce(
    (sum, leg) => sum + (leg.duration_in_traffic?.value ?? leg.duration.value),
    0,
  );
  const staticDurationSeconds = route.legs.reduce(
    (sum, leg) => sum + leg.duration.value,
    0,
  );

  return {
    status: 'OK',
    summary: route.summary,
    polyline: route.overview_polyline.points,
    durationSeconds,
    staticDurationSeconds,
    source: 'directions',
    legs: route.legs.map(leg => {
      const secs = leg.duration_in_traffic?.value ?? leg.duration.value;
      return {
        distanceText: leg.distance.text,
        distanceMeters: leg.distance.value,
        durationSeconds: secs,
        durationText: (leg.duration_in_traffic ?? leg.duration).text,
        start: leg.start_location,
        end: leg.end_location,
        steps: leg.steps.map(s => ({
          instruction: s.html_instructions.replace(/<[^>]+>/g, ''),
          distanceText: s.distance.text,
          durationText: s.duration.text,
          start: s.start_location,
          end: s.end_location,
        })),
      };
    }),
  };
}

/**
 * Compute a drive using live traffic, matching Google Maps consumer ETAs as closely
 * as the platform allows:
 * 1) Routes API + TRAFFIC_AWARE_OPTIMAL + BEST_GUESS + departureTime=now
 * 2) Fallback: Directions API with departure_time=now&traffic_model=best_guess
 */
export async function computeTrafficAwareDrive(
  params: ComputeDriveParams,
): Promise<TrafficAwareRoute> {
  try {
    const viaRoutes = await computeViaRoutesApi(params);
    if (viaRoutes?.status === 'OK' && viaRoutes.polyline) {
      if (__DEV__) {
        console.log(
          `[routesApi] source=routes traffic=${Math.round(viaRoutes.durationSeconds / 60)}min ` +
            `static=${Math.round(viaRoutes.staticDurationSeconds / 60)}min`,
        );
      }
      return viaRoutes;
    }
  } catch (err) {
    if (__DEV__) {
      console.log('[routesApi] Routes API threw, falling back to Directions', err);
    }
  }

  const viaDirections = await computeViaDirectionsApi(params);
  if (__DEV__ && viaDirections.status === 'OK') {
    console.log(
      `[routesApi] source=directions traffic=${Math.round(viaDirections.durationSeconds / 60)}min ` +
        `static=${Math.round(viaDirections.staticDurationSeconds / 60)}min`,
    );
  }
  return viaDirections;
}

/** Resolve an address / lat,lng string to coordinates (Geocoding API). */
export async function resolveLatLng(input: string): Promise<LatLng> {
  const asCoord = toLatLng(input);
  if (asCoord) return asCoord;

  const apiKey = GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new RouteError('Maps API key not configured');

  const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(input)}&key=${apiKey}`;
  const geocodeRes = await fetch(geocodeUrl);
  const geocodeData = (await geocodeRes.json()) as {
    status: string;
    results: Array<{ geometry: { location: { lat: number; lng: number } } }>;
  };
  if (geocodeData.status !== 'OK' || !geocodeData.results[0]) {
    throw new RouteError(
      'Could not find that address. Please try a more specific address (e.g. "123 Main St, City, State").',
    );
  }
  return geocodeData.results[0].geometry.location;
}
