import type { LatLng } from '../types/route';

export const CHECKPOINT_RADIUS_METERS = 500;
export const OFF_ROUTE_METERS = 75;

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function projectOnSegment(p: LatLng, a: LatLng, b: LatLng): LatLng {
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const px = p.lng;
  const py = p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return a;
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)),
  );
  return { lat: ay + t * dy, lng: ax + t * dx };
}

/** Closest point on a polyline, with the segment index where it sits. */
export function closestPointOnPath(
  point: LatLng,
  path: LatLng[],
): { point: LatLng; segmentIndex: number; distanceMeters: number } {
  if (path.length === 0) {
    return { point, segmentIndex: 0, distanceMeters: Number.POSITIVE_INFINITY };
  }
  if (path.length === 1) {
    return {
      point: path[0],
      segmentIndex: 0,
      distanceMeters: distanceMeters(point, path[0]),
    };
  }

  let bestPoint = path[0];
  let bestIndex = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.length; i++) {
    const projected = projectOnSegment(point, path[i - 1], path[i]);
    const dist = distanceMeters(point, projected);
    if (dist < bestDist) {
      bestDist = dist;
      bestPoint = projected;
      bestIndex = i - 1;
    }
  }
  return { point: bestPoint, segmentIndex: bestIndex, distanceMeters: bestDist };
}

/** Shortest distance from a point to a polyline. */
export function distanceToPathMeters(point: LatLng, path: LatLng[]): number {
  return closestPointOnPath(point, path).distanceMeters;
}

export function formatMeters(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
}

export function formatEtaSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  if (m > 0) return `${m} min`;
  return `${s} sec`;
}

export function dirIcon(instruction: string): string {
  const t = instruction.toLowerCase();
  if (t.includes('left')) return '↰';
  if (t.includes('right')) return '↱';
  if (t.includes('u-turn') || t.includes('uturn') || t.includes('uturn')) {
    return '↩';
  }
  if (t.includes('roundabout') || t.includes('circle')) return '↻';
  if (t.includes('merge') || t.includes('ramp') || t.includes('exit')) return '↗';
  if (t.includes('arrive') || t.includes('destination')) return '📍';
  return '↑';
}

export function sameCoord(
  a: LatLng | null | undefined,
  b: LatLng | null | undefined,
  epsilon = 1e-5,
): boolean {
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) < epsilon && Math.abs(a.lng - b.lng) < epsilon;
}

export function parseLatLng(
  value: string | null | undefined,
): LatLng | null {
  if (!value) return null;
  const parts = value.split(',');
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function formatCoord(lat: number, lng: number): string {
  return `${lat},${lng}`;
}
