import { GOOGLE_MAPS_API_KEY } from '../config/maps';
import type { LatLng, RouteAlert, SnappedRoutePath } from '../types/route';
import { decodePolyline } from '../utils/polyline';
import { snapRoutePath } from './roadsApi';

/**
 * A "restricted" nap-drive hazard is any unsafe stretch — not only military
 * bases. That includes crime (robbery, law-enforcement warnings), fire/arson,
 * and other active incidents. Google Places covers bases; NWS covers live US
 * fire / civil / emergency alerts along the path. Street-level robbery still
 * needs a dedicated crime feed later.
 */
const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active';
const NWS_USER_AGENT = 'Naps/1.0 (https://vsirj7j0qh.c37.airoapp.ai/privacy)';
const MILITARY_QUERY = 'military base';
/** Keep static places within this distance of the snapped road path. */
const PLACE_PROXIMITY_METERS = 1200;
const MILITARY_RADIUS_METERS = 800;
const CRIME_RADIUS_METERS = 1500;
const FIRE_RADIUS_METERS = 3500;
const INCIDENT_RADIUS_METERS = 2000;
/** Ignore hazards that only sit next to the start or end pin. */
const TERMINAL_EXCLUDE_METERS = 1800;

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

type NwsFeature = {
  id?: string;
  properties?: {
    id?: string;
    event?: string;
    headline?: string;
    areaDesc?: string;
    severity?: string;
    urgency?: string;
  };
};

type NwsResponse = {
  features?: NwsFeature[];
};

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
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

function nearTerminal(
  point: LatLng,
  origin?: LatLng | null,
  destination?: LatLng | null,
): boolean {
  if (origin && haversineMeters(point, origin) <= TERMINAL_EXCLUDE_METERS) {
    return true;
  }
  if (
    destination &&
    haversineMeters(point, destination) <= TERMINAL_EXCLUDE_METERS
  ) {
    return true;
  }
  return false;
}

/** Distance to the drive, ignoring the first/last stretch so home isn't rejected. */
function minDistanceToRouteInterior(
  point: LatLng,
  path: LatLng[],
  origin?: LatLng | null,
  destination?: LatLng | null,
): number {
  const interior = path.filter(p => !nearTerminal(p, origin, destination));
  return minDistanceToPath(point, interior.length >= 8 ? interior : path);
}

function bearingDegrees(from: LatLng, to: LatLng): number {
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function offsetLatLng(
  origin: LatLng,
  bearingDeg: number,
  distanceMeters: number,
): LatLng {
  const R = 6371000;
  const δ = distanceMeters / R;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(origin.lat);
  const λ1 = toRad(origin.lng);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return { lat: toDeg(φ2), lng: toDeg(λ2) };
}

export function isSafetyHazard(alert: RouteAlert): boolean {
  return alert.kind !== 'route_restriction';
}

export function countSafetyHazards(alerts: RouteAlert[]): number {
  return alerts.filter(isSafetyHazard).length;
}

/** @deprecated use countSafetyHazards — hazards include crime, fire, and other incidents. */
export const countMilitaryAlerts = countSafetyHazards;

export function hazardLabel(kind: RouteAlert['kind']): string {
  switch (kind) {
    case 'fire':
      return 'Fire / arson';
    case 'crime':
      return 'Crime incident';
    case 'military':
      return 'Restricted area';
    case 'incident':
      return 'Active incident';
    default:
      return 'Advisory';
  }
}

function radiusForKind(kind: RouteAlert['kind']): number {
  switch (kind) {
    case 'fire':
      return FIRE_RADIUS_METERS;
    case 'crime':
      return CRIME_RADIUS_METERS;
    case 'incident':
      return INCIDENT_RADIUS_METERS;
    default:
      return MILITARY_RADIUS_METERS;
  }
}

function classifyNwsEvent(
  event: string,
  headline?: string,
): RouteAlert['kind'] | null {
  const text = `${event} ${headline ?? ''}`.toLowerCase();
  if (
    /fire|wildfire|red flag|ashfall|smoke|arson|burn (warning|ban)/.test(text)
  ) {
    return 'fire';
  }
  if (
    /law enforcement|civil danger|civil emergency|shelter in place|active shooter|bomb|riot/.test(
      text,
    )
  ) {
    return 'crime';
  }
  if (
    /evacuation|emergency|warning|danger|hazard|tornado|flash flood|hurricane|blizzard|tsunami/.test(
      text,
    )
  ) {
    return 'incident';
  }
  return null;
}

function keepNwsAlert(kind: RouteAlert['kind'], severity?: string): boolean {
  if (kind === 'fire' || kind === 'crime') return true;
  const s = (severity ?? '').toLowerCase();
  return s === 'extreme' || s === 'severe' || s === 'moderate';
}

function samplePathPoints(path: LatLng[], count = 5): LatLng[] {
  if (path.length === 0) return [];
  if (path.length <= count) return path;
  const out: LatLng[] = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.round((i * (path.length - 1)) / (count - 1));
    out.push(path[idx]);
  }
  return out;
}

async function fetchNwsAlertsAtPoint(point: LatLng): Promise<NwsFeature[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `${NWS_ALERTS_URL}?status=actual&point=${point.lat.toFixed(4)},${point.lng.toFixed(4)}`,
      {
        headers: {
          Accept: 'application/geo+json',
          'User-Agent': NWS_USER_AGENT,
        },
        signal: controller.signal,
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as NwsResponse;
    return data.features ?? [];
  } catch (err) {
    if (__DEV__) {
      console.warn('[restrictedAreas] NWS alerts failed', err);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLiveIncidentsNearPath(
  path: LatLng[],
  origin?: LatLng | null,
  destination?: LatLng | null,
): Promise<RouteAlert[]> {
  if (path.length === 0) return [];

  const samples = samplePathPoints(path);
  const batches = await Promise.all(
    samples.map(point => fetchNwsAlertsAtPoint(point)),
  );

  const alerts: RouteAlert[] = [];
  const seen = new Set<string>();

  batches.forEach((features, index) => {
    const sample = samples[index];
    for (const feature of features) {
      const event = feature.properties?.event?.trim() ?? '';
      const headline = feature.properties?.headline?.trim();
      const kind = classifyNwsEvent(event, headline);
      if (!kind) continue;
      if (!keepNwsAlert(kind, feature.properties?.severity)) continue;

      const id =
        feature.properties?.id ??
        feature.id ??
        `nws-${kind}-${sample.lat},${sample.lng}`;
      if (seen.has(id)) continue;

      const coordinate = { lat: sample.lat, lng: sample.lng };
      if (
        minDistanceToRouteInterior(coordinate, path, origin, destination) >
        radiusForKind(kind)
      ) {
        continue;
      }

      seen.add(id);
      const area = feature.properties?.areaDesc?.trim();
      const title = event || headline || hazardLabel(kind);
      alerts.push({
        id,
        kind,
        title,
        message: area
          ? `${hazardLabel(kind)} near this drive · ${area}`
          : `${hazardLabel(kind)} reported near this drive — pick another loop if you can.`,
        coordinate,
        radiusMeters: radiusForKind(kind),
      });
    }
  });

  return alerts;
}

/** Via point ~2.5km off the unsafe area, perpendicular to the drive. */
export function bypassWaypointForRestricted(
  here: LatLng,
  destination: LatLng,
  alerts: RouteAlert[],
  attempt: number,
): string | null {
  const hazards = alerts.filter(isSafetyHazard);
  if (hazards.length === 0) return null;
  const target = hazards[attempt % hazards.length];
  const routeBearing = bearingDegrees(here, destination);
  const side = attempt % 2 === 0 ? -90 : 90;
  const bypass = offsetLatLng(
    target.coordinate,
    (routeBearing + side + 360) % 360,
    Math.max(2500, target.radiusMeters + 1500),
  );
  return `${bypass.lat},${bypass.lng}`;
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
  origin?: LatLng | null,
  destination?: LatLng | null,
): RouteAlert[] {
  const alerts: RouteAlert[] = [];
  const seen = new Set<string>();

  for (const place of places) {
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const coordinate = { lat: lat as number, lng: lng as number };
    if (
      minDistanceToRouteInterior(coordinate, path, origin, destination) >
      PLACE_PROXIMITY_METERS
    ) {
      continue;
    }

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
      radiusMeters: MILITARY_RADIUS_METERS,
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
  destination?: LatLng | null;
  /** Reuse a snapped path already fetched for map rendering. */
  snappedPath?: SnappedRoutePath | null;
};

/**
 * Detect unsafe areas near the route: military bases (Places), live fire /
 * crime / other incidents (NWS in the US), and optional Routes advisories.
 * Soft-fails to [] so navigation is never blocked.
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

    const dest =
      options.destination &&
      (options.origin == null ||
        options.destination.lat !== options.origin.lat ||
        options.destination.lng !== options.origin.lng)
        ? options.destination
        : options.origin;

    const [places, incidents] = await Promise.all([
      searchMilitaryAlongRoute(encodedPolyline),
      fetchLiveIncidentsNearPath(path, options.origin, dest),
    ]);
    const alerts = [
      ...militaryAlertsFromPlaces(places, path, options.origin, dest),
      ...incidents,
    ];

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

export async function safetyHazardsOnRoute(
  encodedPolyline: string,
  origin: LatLng,
  destination?: LatLng | null,
): Promise<RouteAlert[]> {
  const { alerts } = await buildRouteAlerts(encodedPolyline, {
    origin,
    destination,
  });
  return alerts.filter(isSafetyHazard);
}

/** @deprecated use safetyHazardsOnRoute */
export const militaryAlertsOnRoute = safetyHazardsOnRoute;
