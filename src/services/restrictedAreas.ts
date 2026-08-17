import { GOOGLE_MAPS_API_KEY } from '../config/maps';
import type { LatLng, RouteAlert, SnappedRoutePath } from '../types/route';
import { decodePolyline } from '../utils/polyline';
import { snapRoutePath } from './roadsApi';

const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const MILITARY_QUERY = 'military base';
/** Keep places within this distance of the snapped road path. */
const PROXIMITY_METERS = 1200;
const ALERT_RADIUS_METERS = 800;

type PlacesSearchPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
};

type PlacesSearchResponse = {
  places?: PlacesSearchPlace[];
  error?: { message?: string; status?: string };
};

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function minDistanceToPath(point: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity;
  let min = Infinity;
  for (const p of path) {
    const d = haversineMeters(point, p);
    if (d < min) min = d;
  }
  return min;
}

async function searchMilitaryAlongRoute(
  encodedPolyline: string,
): Promise<PlacesSearchPlace[]> {
  if (!encodedPolyline || !GOOGLE_MAPS_API_KEY) return [];

  const res = await fetch(PLACES_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.location,places.formattedAddress',
    },
    body: JSON.stringify({
      textQuery: MILITARY_QUERY,
      searchAlongRouteParameters: {
        polyline: { encodedPolyline },
      },
    }),
  });

  const data = (await res.json()) as PlacesSearchResponse;
  if (!res.ok || data.error) {
    if (__DEV__) {
      console.warn(
        '[restrictedAreas] Places search failed',
        data.error?.status || res.status,
        data.error?.message,
      );
    }
    return [];
  }

  return data.places ?? [];
}

function militaryAlertsFromPlaces(
  places: PlacesSearchPlace[],
  path: LatLng[],
): RouteAlert[] {
  const alerts: RouteAlert[] = [];
  const seen = new Set<string>();

  for (const place of places) {
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const coordinate = { lat: lat as number, lng: lng as number };
    if (minDistanceToPath(coordinate, path) > PROXIMITY_METERS) continue;

    const id = place.id ?? `military-${coordinate.lat},${coordinate.lng}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const title = place.displayName?.text?.trim() || 'Military base';
    alerts.push({
      id,
      kind: 'military',
      title,
      message: place.formattedAddress
        ? `Restricted area near route · ${place.formattedAddress}`
        : 'Restricted military area near your route — stay on public roads.',
      coordinate,
      radiusMeters: ALERT_RADIUS_METERS,
    });
  }

  return alerts;
}

function routeRestrictionAlert(
  path: LatLng[],
  origin?: LatLng | null,
): RouteAlert {
  const mid = path[Math.floor(path.length / 2)] ?? origin ?? { lat: 0, lng: 0 };
  return {
    id: 'route-restriction',
    kind: 'route_restriction',
    title: 'Route restrictions',
    message:
      'This route may include road restrictions that were only partially applied.',
    coordinate: mid,
    radiusMeters: 400,
  };
}

export type BuildRouteAlertsOptions = {
  /** When true, append a Routes API restriction advisory alert. */
  routeRestrictionsPartiallyIgnored?: boolean;
  origin?: LatLng | null;
  /** Reuse a snapped path already fetched for map rendering. */
  snappedPath?: SnappedRoutePath | null;
};

/**
 * Detect military bases near the route (Places SAR) and optionally a Routes
 * restriction advisory. Soft-fails to [] so navigation is never blocked.
 */
export async function buildRouteAlerts(
  encodedPolyline: string,
  options: BuildRouteAlertsOptions = {},
): Promise<{ alerts: RouteAlert[]; snappedPath: SnappedRoutePath }> {
  const empty: SnappedRoutePath = { coordinates: [] };
  if (!encodedPolyline) {
    return { alerts: [], snappedPath: empty };
  }

  try {
    const snapped =
      options.snappedPath?.coordinates && options.snappedPath.coordinates.length >= 2
        ? options.snappedPath
        : await snapRoutePath(encodedPolyline);

    const path =
      snapped.coordinates.length >= 2
        ? snapped.coordinates
        : decodePolyline(encodedPolyline);

    const places = await searchMilitaryAlongRoute(encodedPolyline);
    const alerts = militaryAlertsFromPlaces(places, path);

    if (options.routeRestrictionsPartiallyIgnored) {
      alerts.push(routeRestrictionAlert(path, options.origin));
    }

    return { alerts, snappedPath: snapped };
  } catch (err) {
    if (__DEV__) {
      console.warn('[restrictedAreas] buildRouteAlerts threw', err);
    }
    return { alerts: [], snappedPath: empty };
  }
}
