import { Linking } from 'react-native';
import type { RouteResult } from '../types/route';

/** Build a Google Maps turn-by-turn URL that preserves nap-route waypoints. */
export function buildGoogleMapsNavUrl(route: RouteResult): string | null {
  const oLat = route.origin?.lat;
  const oLng = route.origin?.lng;
  if (oLat == null || oLng == null) return null;

  const originParam = `${oLat},${oLng}`;
  const waypoints =
    route.allWaypoints != null
      ? route.allWaypoints.map(w => `${w.lat},${w.lng}`)
      : route.waypoint
        ? [`${route.waypoint.lat},${route.waypoint.lng}`]
        : [];

  const lastLeg = route.legs[route.legs.length - 1];
  const lastStep = lastLeg?.steps[lastLeg.steps.length - 1];
  const destFromLegs =
    lastStep?.endLocation != null
      ? `${lastStep.endLocation.lat},${lastStep.endLocation.lng}`
      : null;
  const dest = route.destination
    ? route.destination
    : !route.isLoop
      ? destFromLegs || originParam
      : originParam;

  const qs = [
    'api=1',
    `origin=${encodeURIComponent(originParam)}`,
    `destination=${encodeURIComponent(dest)}`,
    'travelmode=driving',
    'dir_action=navigate',
  ];
  if (waypoints.length > 0) {
    qs.push(`waypoints=${encodeURIComponent(waypoints.join('|'))}`);
  }
  return `https://www.google.com/maps/dir/?${qs.join('&')}`;
}

export async function openRouteInGoogleMaps(route: RouteResult): Promise<string | null> {
  const url = buildGoogleMapsNavUrl(route);
  if (!url) return null;
  await Linking.openURL(url);
  return url;
}
