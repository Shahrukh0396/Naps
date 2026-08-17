import { GOOGLE_MAPS_API_KEY } from '../config/maps';
import type { LatLng, SnappedRoutePath } from '../types/route';
import { decodePolyline } from '../utils/polyline';

const SNAP_URL = 'https://roads.googleapis.com/v1/snapToRoads';
/** Roads snapToRoads accepts at most 100 path points per request. */
const MAX_POINTS_PER_REQUEST = 100;
/** Cap total samples so enrichment stays cheap on long nap loops. */
const MAX_TOTAL_SAMPLES = 300;

type SnapPoint = {
  location?: { latitude?: number; longitude?: number };
  placeId?: string;
  originalIndex?: number;
};

type SnapResponse = {
  snappedPoints?: SnapPoint[];
  error?: { message?: string; status?: string };
};

function subsample(points: LatLng[], maxCount: number): LatLng[] {
  if (points.length <= maxCount) return points;
  if (maxCount < 2) return points.slice(0, 1);

  const result: LatLng[] = [];
  const last = points.length - 1;
  for (let i = 0; i < maxCount; i++) {
    const idx = Math.round((i * last) / (maxCount - 1));
    result.push(points[idx]);
  }
  return result;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function formatPath(points: LatLng[]): string {
  return points.map(p => `${p.lat},${p.lng}`).join('|');
}

async function snapChunk(points: LatLng[]): Promise<SnapPoint[]> {
  if (points.length === 0) return [];

  const url =
    `${SNAP_URL}?interpolate=true` +
    `&path=${encodeURIComponent(formatPath(points))}` +
    `&key=${GOOGLE_MAPS_API_KEY}`;

  const res = await fetch(url);
  const data = (await res.json()) as SnapResponse;

  if (!res.ok || data.error || !data.snappedPoints?.length) {
    if (__DEV__) {
      console.warn(
        '[roadsApi] snapToRoads failed',
        data.error?.status || res.status,
        data.error?.message,
      );
    }
    return [];
  }

  return data.snappedPoints;
}

/**
 * Snap a Routes/Directions encoded polyline onto the road network.
 * Soft-fails to an empty path so callers can fall back to the decoded polyline.
 */
export async function snapRoutePath(
  encodedPolyline: string,
): Promise<SnappedRoutePath> {
  if (!encodedPolyline || !GOOGLE_MAPS_API_KEY) {
    return { coordinates: [] };
  }

  const decoded = decodePolyline(encodedPolyline);
  if (decoded.length < 2) {
    return { coordinates: decoded };
  }

  const samples = subsample(decoded, MAX_TOTAL_SAMPLES);
  const chunks = chunk(samples, MAX_POINTS_PER_REQUEST);

  try {
    const coordinates: LatLng[] = [];
    const placeIds: (string | null)[] = [];

    for (const part of chunks) {
      const snapped = await snapChunk(part);
      for (const point of snapped) {
        const lat = point.location?.latitude;
        const lng = point.location?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        coordinates.push({ lat: lat as number, lng: lng as number });
        placeIds.push(point.placeId ?? null);
      }
    }

    if (coordinates.length < 2) {
      return { coordinates: [] };
    }

    return { coordinates, placeIds };
  } catch (err) {
    if (__DEV__) {
      console.warn('[roadsApi] snapRoutePath threw', err);
    }
    return { coordinates: [] };
  }
}
