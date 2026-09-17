import { PermissionsAndroid, Platform } from 'react-native';
import {
  AudioGuidance,
  NavigationSessionStatus,
  RouteStatus,
  TravelMode,
  type NavigationController,
  type Waypoint,
} from '@googlemaps/react-native-navigation-sdk';
import type { LatLng, RouteResult } from '../types/route';
import {
  CHECKPOINT_RADIUS_METERS,
  closestPointOnPath,
  distanceMeters,
  sameCoord,
} from '../utils/geo';
import { decodePolyline, encodePolyline } from '../utils/polyline';

export type NapNavEventType =
  | 'update'
  | 'checkpoint'
  | 'reroute'
  | 'arrival'
  | 'error'
  | 'status';

export interface NapNavWaypoint {
  lat: number;
  lng: number;
  title: string;
  /** Drive-through nap stop — collected near the pin, no full stop required. */
  checkpoint: boolean;
}

export interface NapNavSnapshot {
  lat: number;
  lng: number;
  heading: number;
  distanceToRouteMeters: number;
  remainingMeters: number;
  remainingSeconds: number;
  maneuver: string;
  instruction: string;
  maneuverDistanceMeters: number;
  offRoute: boolean;
  rerouting: boolean;
  destinationIndex: number;
  destinationTitle: string;
  finalDestination: boolean;
}

export interface NapNavEvent {
  type: NapNavEventType;
  snapshot?: NapNavSnapshot;
  waypoint?: NapNavWaypoint;
  remaining?: NapNavWaypoint[];
  message?: string;
  status?: string;
  code?: string;
}

export const NAV_SDK_ROUTE_HINT =
  'Spoken Google guidance needs a location fix and Navigation SDK on this API key. Your planned route is still on the map.';

export function isNavSdkRouteFailure(message: string | null | undefined): boolean {
  if (!message) return false;
  return /NETWORK_ERROR|QUOTA_CHECK_FAILED|NO_ROUTE_FOUND|LOCATION_DISABLED|LOCATION_UNKNOWN|Could not build a navigation route|not authorized|Enable Navigation SDK/i.test(
    message,
  );
}

export interface StartNavigationOptions {
  destinations: NapNavWaypoint[];
  avoidHighways?: boolean;
  checkpointRadiusMeters?: number;
  voice?: boolean;
}

let boundController: NavigationController | null = null;
/** True only while turn-by-turn is using the Navigation SDK location feed. */
let locationTracking = false;

export function bindNavigationController(
  controller: NavigationController | null,
): void {
  boundController = controller;
  if (controller) applyVoice(controller, false);
}

export function getNavigationController(): NavigationController | null {
  return boundController;
}

export function isNativeNavigationAvailable(): boolean {
  return boundController != null;
}

export function isNativeLocationTracking(): boolean {
  return locationTracking;
}

/** GPS + background updates — only while a nap ride is actively guiding. */
export function startNativeLocation(
  controller: NavigationController | null = boundController,
): void {
  if (!controller) return;
  controller.startUpdatingLocation();
  controller.setBackgroundLocationUpdatesEnabled(true);
  locationTracking = true;
}

/** Stop GPS as soon as guidance is idle so the OS can sleep the radio. */
export function releaseNativeLocation(
  controller: NavigationController | null = boundController,
): void {
  if (!controller) return;
  try {
    controller.setBackgroundLocationUpdatesEnabled(false);
    controller.stopUpdatingLocation();
  } catch {
    // Session may already be idle.
  }
  locationTracking = false;
}

async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const fine = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Location permission',
      message:
        'Naps needs your location for in-app turn-by-turn navigation while you drive.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  );
  return fine === PermissionsAndroid.RESULTS.GRANTED;
}

export function toSdkWaypoints(destinations: NapNavWaypoint[]): Waypoint[] {
  return destinations.map(d => ({
    title: d.title,
    position: { lat: d.lat, lng: d.lng },
    vehicleStopover: !d.checkpoint,
  }));
}

export function routeStatusMessage(status: RouteStatus | string): string {
  const name = String(status);
  switch (name) {
    case RouteStatus.OK:
      return 'OK';
    case RouteStatus.NETWORK_ERROR:
      return 'Could not build a navigation route (NETWORK_ERROR). Confirm Navigation SDK + billing on this API key and that you are online.';
    case RouteStatus.QUOTA_CHECK_FAILED:
      return 'Could not build a navigation route (QUOTA_CHECK_FAILED). Navigation SDK quota/billing failed for this API key.';
    case RouteStatus.NO_ROUTE_FOUND:
      return 'Could not build a navigation route (NO_ROUTE_FOUND). Showing your planned path instead.';
    case RouteStatus.LOCATION_DISABLED:
    case RouteStatus.LOCATION_UNKNOWN:
      return `Could not build a navigation route (${name}). Waiting for a GPS fix.`;
    default:
      return `Could not build a navigation route (${name}). Showing your planned path instead.`;
  }
}

export async function ensureNavigationSession(
  controller: NavigationController = boundController as NavigationController,
): Promise<NavigationSessionStatus> {
  if (!controller) {
    throw new Error('Navigation SDK is not available on this build.');
  }
  const accepted = await controller.areTermsAccepted();
  if (!accepted) {
    const ok = await controller.showTermsAndConditionsDialog();
    if (!ok) {
      throw new Error('Navigation terms were not accepted');
    }
  }
  return controller.init();
}

export async function prepareNativeMaps(
  controller: NavigationController | null = boundController,
): Promise<void> {
  if (!controller) return;
  try {
    await ensureNavigationSession(controller);
    // Do not start GPS here — MapView can render without a live location feed.
    // Location starts in startNativeNavigation and is released when guidance stops.
  } catch {
    // Plan/Results maps still try to render; Begin Nap will show terms if needed.
  }
}

function applyVoice(controller: NavigationController, voice: boolean) {
  controller.setAudioGuidanceType(
    voice
      ? ((AudioGuidance.VOICE_ALERTS_AND_GUIDANCE |
          AudioGuidance.VIBRATION |
          AudioGuidance.BLUETOOTH_AUDIO) as AudioGuidance)
      : AudioGuidance.SILENT,
  );
}

/** Route voice-over is off unless the rider explicitly unmutes. */
export function setVoiceGuidance(
  voice: boolean,
  controller: NavigationController | null = boundController,
): void {
  if (!controller) return;
  applyVoice(controller, voice);
}

export async function startNativeNavigation(
  options: StartNavigationOptions,
  controller: NavigationController | null = boundController,
): Promise<string> {
  if (!controller) {
    throw new Error('Navigation SDK is not available on this build.');
  }
  const ok = await ensureLocationPermission();
  if (!ok) {
    throw new Error('Location access denied');
  }
  if (options.destinations.length === 0) {
    throw new Error('No destinations to navigate to.');
  }
  const session = await ensureNavigationSession(controller);
  if (session !== NavigationSessionStatus.OK) {
    throw new Error(`Navigation SDK failed to start (${session})`);
  }
  startNativeLocation(controller);
  try {
    applyVoice(controller, options.voice === true);
    const status = await controller.setDestinations(
      toSdkWaypoints(options.destinations),
      {
        routingOptions: {
          travelMode: TravelMode.DRIVING,
          avoidHighways: Boolean(options.avoidHighways),
        },
        displayOptions: {
          showDestinationMarkers: true,
        },
      },
    );
    if (status !== RouteStatus.OK) {
      throw new Error(routeStatusMessage(status));
    }
    applyVoice(controller, options.voice === true);
    await controller.startGuidance();
    return 'OK';
  } catch (err) {
    releaseNativeLocation(controller);
    throw err;
  }
}

export async function stopNativeNavigation(
  controller: NavigationController | null = boundController,
): Promise<void> {
  if (!controller) return;
  try {
    applyVoice(controller, false);
    await controller.stopGuidance();
    await controller.clearDestinations();
  } catch {
    // Session may already be idle.
  }
  releaseNativeLocation(controller);
}

export async function updateNativeDestinations(
  options: StartNavigationOptions,
  controller: NavigationController | null = boundController,
): Promise<string> {
  if (!controller) {
    throw new Error('Navigation SDK is not available on this build.');
  }
  applyVoice(controller, options.voice === true);
  const status = await controller.setDestinations(
    toSdkWaypoints(options.destinations),
    {
      routingOptions: {
        travelMode: TravelMode.DRIVING,
        avoidHighways: Boolean(options.avoidHighways),
      },
    },
  );
  if (status !== RouteStatus.OK) {
    throw new Error(routeStatusMessage(status));
  }
  applyVoice(controller, options.voice === true);
  await controller.startGuidance();
  return 'OK';
}

export async function recalculateNativeRoute(
  options: StartNavigationOptions,
  controller: NavigationController | null = boundController,
): Promise<string> {
  return updateNativeDestinations(options, controller);
}

export async function continueToNextNapStop(
  controller: NavigationController | null = boundController,
): Promise<void> {
  if (!controller) return;
  await controller.continueToNextDestination();
  await controller.startGuidance();
}

/**
 * Keep the selected nap path, but start it at the rider's live location
 * instead of the original pickup / planning origin.
 */
export function trimRouteFromLocation(
  route: RouteResult,
  here: LatLng,
): RouteResult {
  const path = route.polyline ? decodePolyline(route.polyline) : [];
  if (path.length < 2) return route;

  const snapped = closestPointOnPath(here, path);
  const fromIndex = snapped.segmentIndex;
  const remaining: LatLng[] = [];
  const start = snapped.distanceMeters > 50 ? here : snapped.point;
  remaining.push(start);
  if (!sameCoord(start, snapped.point)) remaining.push(snapped.point);
  for (const point of path.slice(fromIndex + 1)) {
    const last = remaining[remaining.length - 1];
    if (!last || !sameCoord(last, point)) remaining.push(point);
  }
  if (remaining.length < 2) return route;

  const stops =
    route.allWaypoints != null
      ? route.allWaypoints
      : route.waypoint
        ? [route.waypoint]
        : [];
  const ahead = stops.filter(stop => {
    if (distanceMeters(here, stop) <= CHECKPOINT_RADIUS_METERS) return false;
    return closestPointOnPath(stop, path).segmentIndex > fromIndex;
  });

  const legs = route.legs
    .map(leg => ({
      ...leg,
      steps: leg.steps.filter(step => {
        if (!step.endLocation) return true;
        return closestPointOnPath(step.endLocation, path).segmentIndex > fromIndex;
      }),
    }))
    .filter(leg => leg.steps.length > 0);

  return {
    ...route,
    polyline: encodePolyline(remaining),
    allWaypoints: ahead,
    waypoint: ahead[0] ?? route.waypoint,
    legs: legs.length > 0 ? legs : route.legs,
  };
}

/** Checkpoints first, then the final home / destination pin. */
export function navDestinationsFromRoute(
  route: RouteResult,
  endPin: LatLng | null,
): NapNavWaypoint[] {
  const stops =
    route.allWaypoints != null
      ? route.allWaypoints
      : route.waypoint
        ? [route.waypoint]
        : [];

  const points: NapNavWaypoint[] = stops.map((w, i) => ({
    lat: w.lat,
    lng: w.lng,
    title: i === 0 ? 'Nap stop' : `Stop ${i + 1}`,
    checkpoint: true,
  }));

  if (endPin) {
    const last = points[points.length - 1];
    if (last && sameCoord(last, endPin)) {
      last.checkpoint = false;
      last.title = route.isLoop ? 'Home' : 'Destination';
    } else {
      points.push({
        lat: endPin.lat,
        lng: endPin.lng,
        title: route.isLoop ? 'Home' : 'Destination',
        checkpoint: false,
      });
    }
  }

  return points;
}

export { CHECKPOINT_RADIUS_METERS };
