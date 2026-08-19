import { Linking, Platform } from 'react-native';
import type { RouteResult } from '../types/route';

type NavEndpoints = {
  origin: string;
  dest: string;
  waypoints: string[];
};

function navEndpoints(route: RouteResult): NavEndpoints | null {
  const oLat = route.origin?.lat;
  const oLng = route.origin?.lng;
  if (oLat == null || oLng == null) return null;

  const origin = `${oLat},${oLng}`;
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
      ? destFromLegs || origin
      : origin;

  return { origin, dest, waypoints };
}

/** Cross-platform Maps URL that preserves nap-route waypoints and starts driving nav. */
export function buildGoogleMapsNavUrl(route: RouteResult): string | null {
  const parts = navEndpoints(route);
  if (!parts) return null;

  const qs = [
    'api=1',
    `origin=${encodeURIComponent(parts.origin)}`,
    `destination=${encodeURIComponent(parts.dest)}`,
    'travelmode=driving',
    'dir_action=navigate',
  ];
  if (parts.waypoints.length > 0) {
    qs.push(`waypoints=${encodeURIComponent(parts.waypoints.join('|'))}`);
  }
  return `https://www.google.com/maps/dir/?${qs.join('&')}`;
}

function nativeGoogleMapsUrls(webUrl: string): string[] {
  const withoutScheme = webUrl.replace(/^https:\/\//, '');
  if (Platform.OS === 'ios') {
    // Opens the full Maps URL inside the Google Maps app (keeps waypoints).
    return [`comgooglemapsurl://${withoutScheme}`];
  }
  return [
    `intent://${withoutScheme}#Intent;scheme=https;package=com.google.android.apps.maps;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`,
  ];
}

async function tryOpen(url: string): Promise<boolean> {
  try {
    const needsCanOpen = url.startsWith('comgooglemaps');
    if (needsCanOpen) {
      const supported = await Linking.canOpenURL(url);
      if (!supported) return false;
    }
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Prefer the Google Maps app so the selected nap route loads there first. */
export async function openRouteInGoogleMaps(route: RouteResult): Promise<string | null> {
  const webUrl = buildGoogleMapsNavUrl(route);
  if (!webUrl) return null;

  for (const nativeUrl of nativeGoogleMapsUrls(webUrl)) {
    if (await tryOpen(nativeUrl)) return nativeUrl;
  }

  const opened = await tryOpen(webUrl);
  if (!opened) {
    throw new Error('Could not open Google Maps');
  }
  return webUrl;
}
