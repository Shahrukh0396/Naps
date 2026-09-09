import { useCallback, useEffect, useRef, useState } from 'react';
import Geolocation from '@react-native-community/geolocation';
import { useNavigation } from '@googlemaps/react-native-navigation-sdk';
import type { LatLng, NavStep, RouteResult } from '../types/route';
import {
  bindNavigationController,
  continueToNextNapStop,
  isNavSdkRouteFailure,
  NAV_SDK_ROUTE_HINT,
  navDestinationsFromRoute,
  recalculateNativeRoute,
  releaseNativeLocation,
  startNativeLocation,
  setVoiceGuidance,
  startNativeNavigation,
  stopNativeNavigation,
  updateNativeDestinations,
  type NapNavSnapshot,
  type NapNavWaypoint,
  type StartNavigationOptions,
} from '../services/napNavigation';
import { decodePolyline } from '../utils/polyline';
import {
  CHECKPOINT_RADIUS_METERS,
  distanceMeters,
  distanceToPathMeters,
  OFF_ROUTE_METERS,
} from '../utils/geo';

export type NapNavStatus = 'idle' | 'starting' | 'active' | 'error';

const NATIVE_START_TIMEOUT_MS = 25_000;

function delay(ms: number): Promise<'timeout'> {
  return new Promise(resolve => setTimeout(() => resolve('timeout'), ms));
}

function snapshotFromGps(
  loc: LatLng,
  heading: number,
  route: RouteResult,
  dests: NapNavWaypoint[],
  destIndex: number,
  steps: NavStep[],
): NapNavSnapshot {
  const path = route.polyline ? decodePolyline(route.polyline) : [];
  const distanceToRouteMeters =
    path.length >= 2 ? distanceToPathMeters(loc, path) : 0;
  const dest = dests[destIndex] ?? dests[dests.length - 1];
  const remainingMeters = dest ? distanceMeters(loc, dest) : 0;
  const remainingSeconds = Math.max(30, remainingMeters / 11);
  const next = nextStep(loc, steps);
  return {
    lat: loc.lat,
    lng: loc.lng,
    heading,
    distanceToRouteMeters,
    remainingMeters,
    remainingSeconds,
    maneuver: next?.instruction ?? 'Continue',
    instruction: next?.instruction ?? 'Continue on the nap route',
    maneuverDistanceMeters: next?.endLocation
      ? distanceMeters(loc, next.endLocation)
      : remainingMeters,
    offRoute: distanceToRouteMeters > OFF_ROUTE_METERS,
    rerouting: false,
    destinationIndex: destIndex,
    destinationTitle: dest?.title ?? 'Destination',
    finalDestination: destIndex >= dests.length - 1,
  };
}

function nextStep(loc: LatLng, steps: NavStep[]): NavStep | null {
  for (const step of steps) {
    if (!step.endLocation) continue;
    if (distanceMeters(loc, step.endLocation) > 40) return step;
  }
  return steps[steps.length - 1] ?? null;
}

export function useNapNavigation() {
  const {
    navigationController,
    setOnArrival,
    setOnLocationChanged,
    setOnRouteChanged,
    setOnReroutingRequestedByOffRoute,
    setOnRemainingTimeOrDistanceChanged,
    setOnTurnByTurn,
    removeAllListeners,
  } = useNavigation();

  const [status, setStatus] = useState<NapNavStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<NapNavSnapshot | null>(null);
  const [usingNative, setUsingNative] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [remainingDestinations, setRemainingDestinations] = useState<
    NapNavWaypoint[]
  >([]);

  const destsRef = useRef<NapNavWaypoint[]>([]);
  const destIndexRef = useRef(0);
  const routeRef = useRef<RouteResult | null>(null);
  const watchRef = useRef<number | null>(null);
  const nativeModeRef = useRef(false);
  const lastCheckpointAtRef = useRef(0);
  const startOptsRef = useRef<StartNavigationOptions | null>(null);
  const lastLocRef = useRef<{ lat: number; lng: number; heading: number } | null>(
    null,
  );
  const locReadyRef = useRef<((ok: boolean) => void) | null>(null);
  const remainingRef = useRef({ meters: 0, seconds: 0 });
  const turnRef = useRef({
    maneuver: 'straight',
    instruction: 'Continue on the nap route',
    maneuverDistanceMeters: 0,
  });
  const offRouteRef = useRef(false);
  const reroutingRef = useRef(false);

  useEffect(() => {
    bindNavigationController(navigationController);
  }, [navigationController]);

  const clearWatch = useCallback(() => {
    const watch = watchRef.current;
    if (watch == null) return;
    Geolocation.clearWatch(watch);
    watchRef.current = null;
  }, []);

  const publishSnapshot = useCallback(
    (loc: { lat: number; lng: number; heading: number }) => {
      const dests = destsRef.current;
      const dest = dests[destIndexRef.current] ?? dests[dests.length - 1];
      const route = routeRef.current;
      const path = route?.polyline ? decodePolyline(route.polyline) : [];
      const distanceToRouteMeters =
        path.length >= 2 ? distanceToPathMeters(loc, path) : 0;
      setSnapshot({
        lat: loc.lat,
        lng: loc.lng,
        heading: loc.heading,
        distanceToRouteMeters,
        remainingMeters: remainingRef.current.meters,
        remainingSeconds: remainingRef.current.seconds,
        maneuver: turnRef.current.maneuver,
        instruction: turnRef.current.instruction,
        maneuverDistanceMeters: turnRef.current.maneuverDistanceMeters,
        offRoute: offRouteRef.current || distanceToRouteMeters > OFF_ROUTE_METERS,
        rerouting: reroutingRef.current,
        destinationIndex: destIndexRef.current,
        destinationTitle: dest?.title ?? 'Destination',
        finalDestination: destIndexRef.current >= dests.length - 1,
      });
    },
    [],
  );

  const collectCheckpoint = useCallback(
    async (reason: string) => {
      const now = Date.now();
      if (now - lastCheckpointAtRef.current < 2500) return;
      const dests = destsRef.current;
      const current = dests[destIndexRef.current];
      if (!current?.checkpoint) return;
      if (destIndexRef.current >= dests.length - 1) return;
      lastCheckpointAtRef.current = now;
      destIndexRef.current += 1;
      const remaining = dests.slice(destIndexRef.current);
      destsRef.current = dests;
      setRemainingDestinations(remaining);
      setHint(`Collected ${current.title} — continuing`);
      if (nativeModeRef.current) {
        try {
          await continueToNextNapStop(navigationController);
        } catch {
          setHint(`${reason}: could not advance — staying on this stop`);
        }
      }
    },
    [navigationController],
  );

  const emitJsUpdate = useCallback(
    (loc: LatLng, heading: number) => {
      const route = routeRef.current;
      const dests = destsRef.current;
      if (!route || dests.length === 0) return;
      const steps = route.legs.flatMap(leg => leg.steps);
      const snap = snapshotFromGps(
        loc,
        heading,
        route,
        dests,
        destIndexRef.current,
        steps,
      );
      setSnapshot(snap);

      const dest = dests[destIndexRef.current];
      const now = Date.now();
      if (
        dest?.checkpoint &&
        destIndexRef.current < dests.length - 1 &&
        distanceMeters(loc, dest) <= CHECKPOINT_RADIUS_METERS &&
        now - lastCheckpointAtRef.current > 2500
      ) {
        lastCheckpointAtRef.current = now;
        destIndexRef.current += 1;
        setRemainingDestinations(dests.slice(destIndexRef.current));
        setHint(`Collected ${dest.title} — routing to the next stop`);
      }
    },
    [],
  );

  const startJsFallback = useCallback(() => {
    nativeModeRef.current = false;
    setUsingNative(false);
    clearWatch();
    const watch = Geolocation.watchPosition(
      pos => {
        emitJsUpdate(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          pos.coords.heading ?? 0,
        );
      },
      () => undefined,
      {
        enableHighAccuracy: true,
        distanceFilter: 25,
        interval: 4000,
        fastestInterval: 2000,
      },
    );
    watchRef.current = watch;
    setStatus('active');
  }, [clearWatch, emitJsUpdate]);

  useEffect(() => {
    setOnLocationChanged(location => {
      const loc = {
        lat: location.lat,
        lng: location.lng,
        heading: location.bearing ?? lastLocRef.current?.heading ?? 0,
      };
      lastLocRef.current = loc;
      locReadyRef.current?.(true);
      locReadyRef.current = null;
      if (!nativeModeRef.current) return;
      const dest = destsRef.current[destIndexRef.current];
      if (
        dest?.checkpoint &&
        destIndexRef.current < destsRef.current.length - 1 &&
        distanceMeters(loc, dest) <= CHECKPOINT_RADIUS_METERS
      ) {
        void collectCheckpoint('proximity');
      }
      publishSnapshot(loc);
    });
    setOnArrival(event => {
      if (!nativeModeRef.current) return;
      if (event.isFinalDestination) {
        destIndexRef.current = Math.max(0, destsRef.current.length - 1);
        setHint('You have arrived');
        setRemainingDestinations([]);
        return;
      }
      void collectCheckpoint('sdk-arrival');
    });
    setOnRouteChanged(() => {
      reroutingRef.current = false;
      offRouteRef.current = false;
      setHint(null);
    });
    setOnReroutingRequestedByOffRoute(() => {
      offRouteRef.current = true;
      reroutingRef.current = true;
      setHint('Off route — requesting a new path…');
    });
    setOnRemainingTimeOrDistanceChanged(td => {
      remainingRef.current = {
        meters: td?.meters ?? remainingRef.current.meters,
        seconds: td?.seconds ?? remainingRef.current.seconds,
      };
      if (lastLocRef.current) publishSnapshot(lastLocRef.current);
    });
    setOnTurnByTurn(events => {
      const event = events?.[0] as
        | {
            navState?: number;
            distanceToCurrentStepMeters?: number;
            currentStep?: {
              instruction?: string;
              maneuver?: string;
              fullRoadName?: string;
              distanceMeters?: number;
            };
          }
        | undefined;
      if (!event) return;
      reroutingRef.current = event.navState === 2;
      const step = event.currentStep;
      const road = step?.fullRoadName;
      const maneuver = String(step?.maneuver ?? 'straight');
      const pretty = maneuver.replace(/_/g, ' ').toLowerCase();
      turnRef.current = {
        maneuver,
        instruction: road
          ? `${pretty} onto ${road}`
          : step?.instruction || pretty || turnRef.current.instruction,
        maneuverDistanceMeters:
          event.distanceToCurrentStepMeters ??
          step?.distanceMeters ??
          turnRef.current.maneuverDistanceMeters,
      };
      if (lastLocRef.current) publishSnapshot(lastLocRef.current);
    });
    return () => removeAllListeners();
  }, [
    collectCheckpoint,
    publishSnapshot,
    removeAllListeners,
    setOnArrival,
    setOnLocationChanged,
    setOnRemainingTimeOrDistanceChanged,
    setOnReroutingRequestedByOffRoute,
    setOnRouteChanged,
    setOnTurnByTurn,
  ]);

  const waitForSdkLocation = useCallback(async () => {
    if (lastLocRef.current) return true;
    startNativeLocation(navigationController);
    return Promise.race([
      new Promise<boolean>(resolve => {
        locReadyRef.current = resolve;
      }),
      delay(8000).then(() => false),
    ]);
  }, [navigationController]);

  const start = useCallback(
    async (options: StartNavigationOptions, route: RouteResult) => {
      destsRef.current = options.destinations;
      destIndexRef.current = 0;
      routeRef.current = route;
      startOptsRef.current = options;
      setRemainingDestinations(options.destinations);
      setError(null);
      setHint(null);
      setStatus('starting');

      const nativeAttempt = (async () => {
        await waitForSdkLocation();
        const latest = startOptsRef.current ?? options;
        return startNativeNavigation(latest, navigationController);
      })().then(
        value => ({ ok: true as const, value }),
        err => ({ ok: false as const, err }),
      );

      const adoptNative = () => {
        nativeModeRef.current = true;
        setUsingNative(true);
        clearWatch();
        setStatus('active');
        setError(null);
        if (lastLocRef.current) publishSnapshot(lastLocRef.current);
      };

      const raced = await Promise.race([
        nativeAttempt,
        delay(NATIVE_START_TIMEOUT_MS),
      ]);

      if (raced === 'timeout') {
        startJsFallback();
        void nativeAttempt.then(result => {
          if (result.ok) adoptNative();
          else if (!nativeModeRef.current) {
            releaseNativeLocation(navigationController);
          }
        });
        return;
      }

      if (raced.ok) {
        adoptNative();
        return;
      }

      const raw =
        raced.err instanceof Error ? raced.err.message : 'Using GPS guidance';
      if (isNavSdkRouteFailure(raw)) {
        setHint(NAV_SDK_ROUTE_HINT);
        setError(null);
        startJsFallback();
        releaseNativeLocation(navigationController);
        void delay(2000).then(async () => {
          if (nativeModeRef.current) return;
          try {
            await startNativeNavigation(
              startOptsRef.current ?? options,
              navigationController,
            );
            adoptNative();
            setHint(null);
          } catch {
            // Keep GPS guidance + planned polyline.
          }
        });
        return;
      }
      setHint(raw);
      startJsFallback();
      releaseNativeLocation(navigationController);
    },
    [
      clearWatch,
      navigationController,
      publishSnapshot,
      startJsFallback,
      waitForSdkLocation,
    ],
  );

  const update = useCallback(
    async (options: StartNavigationOptions, route: RouteResult) => {
      destsRef.current = options.destinations;
      destIndexRef.current = 0;
      routeRef.current = route;
      startOptsRef.current = options;
      setRemainingDestinations(options.destinations);
      if (nativeModeRef.current) {
        try {
          await updateNativeDestinations(options, navigationController);
        } catch (err) {
          setHint(
            err instanceof Error ? err.message : 'Could not update destinations',
          );
        }
        return;
      }
      destIndexRef.current = 0;
    },
    [navigationController],
  );

  const recalculate = useCallback(async () => {
    const options = startOptsRef.current;
    if (nativeModeRef.current && options) {
      try {
        await recalculateNativeRoute(options, navigationController);
      } catch (err) {
        setHint(
          err instanceof Error ? err.message : 'Could not recalculate route',
        );
      }
    }
  }, [navigationController]);

  const setVoice = useCallback(
    (voice: boolean) => {
      if (startOptsRef.current) {
        startOptsRef.current = { ...startOptsRef.current, voice };
      }
      setVoiceGuidance(voice, navigationController);
    },
    [navigationController],
  );

  const stop = useCallback(async () => {
    clearWatch();
    destsRef.current = [];
    destIndexRef.current = 0;
    setRemainingDestinations([]);
    await stopNativeNavigation(navigationController);
    nativeModeRef.current = false;
    setUsingNative(false);
    setStatus('idle');
    setSnapshot(null);
    setHint(null);
  }, [clearWatch, navigationController]);

  useEffect(() => {
    return () => {
      clearWatch();
      void stopNativeNavigation(navigationController);
    };
  }, [clearWatch, navigationController]);

  return {
    status,
    error,
    hint,
    snapshot,
    usingNative,
    remainingDestinations,
    start,
    update,
    stop,
    setVoice,
    recalculate,
    navDestinationsFromRoute,
  };
}
