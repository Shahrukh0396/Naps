import type { LatLng, RouteAlert, RouteAlertKind } from '../types/route';

export type HeatmapPoint = {
  latitude: number;
  longitude: number;
  weight: number;
};

export const HAZARD_HEAT_GRADIENT = {
  colors: ['#F8E7A0', '#F4C15D', '#E07A2F', '#C4452D', '#8B1E1E'],
  startPoints: [0.12, 0.32, 0.52, 0.74, 1],
  colorMapSize: 256,
};

const MAX_HEAT_POINTS = 250;
const PATH_SAMPLE_METERS = 180;

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

/** Fire/arson hottest (spreading), then crime, then bases / other incidents. */
export function heatWeightForKind(kind: RouteAlertKind): number {
  switch (kind) {
    case 'fire':
      return 1;
    case 'crime':
      return 0.72;
    case 'military':
    case 'incident':
      return 0.5;
    default:
      return 0.22;
  }
}

function toPoint(coord: LatLng, weight: number): HeatmapPoint {
  return { latitude: coord.lat, longitude: coord.lng, weight };
}

function subsamplePath(path: LatLng[], everyMeters: number): LatLng[] {
  if (path.length === 0) return [];
  const out: LatLng[] = [path[0]];
  let acc = 0;
  for (let i = 1; i < path.length; i += 1) {
    acc += haversineMeters(path[i - 1], path[i]);
    if (acc >= everyMeters) {
      out.push(path[i]);
      acc = 0;
    }
  }
  const last = path[path.length - 1];
  const prev = out[out.length - 1];
  if (prev.lat !== last.lat || prev.lng !== last.lng) {
    out.push(last);
  }
  return out;
}

/**
 * Weighted samples around each hazard plus snapped-path points inside those
 * radii so the heat follows the drive, not a single pin.
 */
export function buildHazardHeatPoints(
  alerts: RouteAlert[],
  path: LatLng[],
): HeatmapPoint[] {
  if (alerts.length === 0) return [];

  const points: HeatmapPoint[] = [];

  for (const alert of alerts) {
    const base = heatWeightForKind(alert.kind);
    const radius = Math.max(120, alert.radiusMeters);
    points.push(toPoint(alert.coordinate, base));

    const rings =
      alert.kind === 'fire'
        ? [
            { frac: 0.35, count: 6, weight: base * 0.82 },
            { frac: 0.7, count: 8, weight: base * 0.55 },
            { frac: 0.95, count: 8, weight: base * 0.32 },
          ]
        : [
            { frac: 0.4, count: 6, weight: base * 0.7 },
            { frac: 0.75, count: 8, weight: base * 0.4 },
          ];

    for (const ring of rings) {
      for (let i = 0; i < ring.count; i += 1) {
        const bearing = (360 / ring.count) * i;
        points.push(
          toPoint(
            offsetLatLng(alert.coordinate, bearing, radius * ring.frac),
            ring.weight,
          ),
        );
      }
    }
  }

  for (const point of subsamplePath(path, PATH_SAMPLE_METERS)) {
    let maxWeight = 0;
    for (const alert of alerts) {
      if (haversineMeters(point, alert.coordinate) <= alert.radiusMeters) {
        maxWeight = Math.max(maxWeight, heatWeightForKind(alert.kind) * 0.9);
      }
    }
    if (maxWeight > 0) {
      points.push(toPoint(point, maxWeight));
    }
  }

  if (points.length <= MAX_HEAT_POINTS) return points;
  return points
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_HEAT_POINTS);
}
