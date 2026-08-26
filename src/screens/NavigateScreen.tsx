import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NapMap from '../components/NapMap';
import NapTimer from '../components/NapTimer';
import { ROUTE_TYPE_META } from '../constants/content';
import { useAppAlert } from '../context/AlertContext';
import { useNapSession } from '../context/NapSessionContext';
import { useNapSettings } from '../context/SettingsContext';
import type { NavigateScreenProps } from '../navigation/types';
import { findDirectRoute, findRoute, RouteError } from '../services/mapsApi';
import { loadActiveNap } from '../services/napSession';
import {
  buildRouteAlerts,
  bypassWaypointForRestricted,
  countSafetyHazards,
  hazardLabel,
  isSafetyHazard,
} from '../services/restrictedAreas';
import type { LatLng, RouteAlert, RouteResult } from '../types/route';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';
import { openRouteInGoogleMaps } from '../utils/openGoogleMaps';

function parseLatLng(value: string | null | undefined): { lat: number; lng: number } | null {
  if (!value) return null;
  const parts = value.split(',');
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function formatCoord(lat: number, lng: number): string {
  return `${lat},${lng}`;
}

async function ensureAndroidPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Location permission',
      message: 'Naps needs your location to rebuild the nap route after extending.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise(async (resolve, reject) => {
    const ok = await ensureAndroidPermission();
    if (!ok) {
      reject(new Error('Location access denied'));
      return;
    }
    Geolocation.getCurrentPosition(
      pos =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
      err => reject(err),
      {
        timeout: 12000,
        maximumAge: 15000,
        enableHighAccuracy: true,
      },
    );
  });
}

function resolveEndDestination(
  route: RouteResult,
  destinationLabel: string | null,
): string {
  if (!route.isLoop) {
    if (route.destination) return route.destination;
    if (destinationLabel) return destinationLabel;
    const lastLeg = route.legs[route.legs.length - 1];
    const lastStep = lastLeg?.steps[lastLeg.steps.length - 1];
    if (lastStep?.endLocation) {
      return formatCoord(lastStep.endLocation.lat, lastStep.endLocation.lng);
    }
  }
  // Loop (or fallback): end back at the original start / home.
  return formatCoord(route.origin.lat, route.origin.lng);
}

function dirIcon(instruction: string): string {
  const t = instruction.toLowerCase();
  if (t.includes('left')) return '↰';
  if (t.includes('right')) return '↱';
  if (t.includes('u-turn') || t.includes('uturn')) return '↩';
  if (t.includes('roundabout') || t.includes('circle')) return '↻';
  if (t.includes('merge') || t.includes('ramp') || t.includes('exit')) return '↗';
  if (t.includes('arrive') || t.includes('destination')) return '📍';
  return '↑';
}

function alertBannerText(alerts: RouteAlert[]): string {
  const hazards = alerts.filter(isSafetyHazard);
  const lead = hazards[0] ?? alerts[0];
  if (!lead) return 'Route restriction advisory on this path';
  const extra = Math.max(0, (hazards.length || alerts.length) - 1);
  const kind = hazardLabel(lead.kind);
  return extra > 0
    ? `${kind} ahead · ${lead.title} · +${extra} more`
    : `${kind} ahead · ${lead.title}`;
}

export default function NavigateScreen({ navigation, route: navRoute }: NavigateScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { settings } = useNapSettings();
  const showAlert = useAppAlert();
  const { persist, endSession } = useNapSession();
  const {
    route: initialRoute,
    durationMinutes: initialDuration,
    destinationLabel,
    activeStyle,
    napStarted = false,
    initialEndsAt,
    initialTotalSeconds,
    initialSecondsLeft,
  } = navRoute.params;
  const meta = ROUTE_TYPE_META[activeStyle];

  const [route, setRoute] = useState(initialRoute);
  const [durationMinutes, setDurationMinutes] = useState(initialDuration);
  const [mapsOpened, setMapsOpened] = useState(napStarted);
  const [recalculating, setRecalculating] = useState(false);
  const [headingHome, setHeadingHome] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<RouteAlert[]>([]);
  const [snappedPath, setSnappedPath] = useState<LatLng[] | null>(null);
  const [findingAlt, setFindingAlt] = useState(false);
  const [navActive, setNavActive] = useState(false);
  const [navExpanded, setNavExpanded] = useState(false);
  const [navStep, setNavStep] = useState(0);
  const [timerStarted, setTimerStarted] = useState(napStarted);

  const homeOriginRef = useRef(initialRoute.origin);
  const extendCountRef = useRef(0);
  const altRouteCountRef = useRef(0);
  const recalculatingRef = useRef(false);
  const headedHomeRef = useRef(false);
  const secondsLeftRef = useRef(initialDuration * 60);
  const alertsRef = useRef<RouteAlert[]>([]);

  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  const endPin = useMemo(() => {
    if (route.isLoop) return homeOriginRef.current;
    const fromDest = parseLatLng(route.destination ?? null);
    if (fromDest) return fromDest;
    const lastLeg = route.legs[route.legs.length - 1];
    const lastStep = lastLeg?.steps[lastLeg.steps.length - 1];
    return lastStep?.endLocation ?? null;
  }, [route]);

  const allNavSteps = useMemo(
    () => route.legs.flatMap(leg => leg.steps),
    [route],
  );
  const safeNavStep = Math.min(navStep, Math.max(0, allNavSteps.length - 1));
  const currentNavStep = allNavSteps[safeNavStep] ?? null;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await buildRouteAlerts(route.polyline, {
        routeRestrictionsPartiallyIgnored:
          route.routeRestrictionsPartiallyIgnored,
        origin: route.origin,
        destination: endPin,
      });
      if (cancelled) return;
      setAlerts(result.alerts);
      setSnappedPath(
        result.snappedPath.coordinates.length >= 2
          ? result.snappedPath.coordinates
          : null,
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [
    route.polyline,
    route.routeRestrictionsPartiallyIgnored,
    route.origin.lat,
    route.origin.lng,
    endPin?.lat,
    endPin?.lng,
  ]);

  useEffect(() => {
    setNavStep(0);
    const hasSteps = route.legs.some(leg => leg.steps.length > 0);
    if (!hasSteps) setNavActive(false);
  }, [route.polyline]);

  /** Opens Google Maps only when the user taps the Maps button. */
  const handleOpenMaps = async () => {
    try {
      await openRouteInGoogleMaps(route);
      setMapsOpened(true);
    } catch {
      showAlert({
        title: 'Could not open Google Maps',
        message: 'Try again when you have a signal, or use the in-app map.',
        tone: 'warning',
      });
    }
  };

  const handleExtend = useCallback(
    async (info: {
      addedMinutes: number;
      totalMinutes: number;
      secondsLeft: number;
    }) => {
      if (recalculatingRef.current) return;
      // Extending after nap end means resume nap routing (not direct home).
      headedHomeRef.current = false;
      setHeadingHome(false);
      recalculatingRef.current = true;
      setRecalculating(true);
      setRecalcError(null);
      setDurationMinutes(info.totalMinutes);

      const remainingMinutes = Math.max(1, Math.ceil(info.secondsLeft / 60));
      extendCountRef.current += 1;

      try {
        const here = await getCurrentPosition();
        const destination = resolveEndDestination(initialRoute, destinationLabel);
        const next = await findRoute({
          origin: formatCoord(here.lat, here.lng),
          destination,
          durationMinutes: remainingMinutes,
          routeTypes: [activeStyle],
          extraStops: initialRoute.extraStops ?? [],
          variation: extendCountRef.current,
          minDurationMinutes: 5,
        });

        // Keep loop semantics / destination label for UI + Maps.
        const patched: RouteResult = {
          ...next,
          isLoop: initialRoute.isLoop,
          destination: initialRoute.isLoop
            ? formatCoord(homeOriginRef.current.lat, homeOriginRef.current.lng)
            : initialRoute.destination ?? destinationLabel,
          extraStops: initialRoute.extraStops,
        };

        setRoute(patched);
      } catch (err) {
        const message =
          err instanceof RouteError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Could not rebuild the nap route.';
        setRecalcError(message);
        showAlert({
          title: 'Could not update route',
          message: `${message}\n\nTimer was extended — tap Begin Nap or Open Maps when you have a signal if you want turn-by-turn.`,
          tone: 'warning',
        });
      } finally {
        recalculatingRef.current = false;
        setRecalculating(false);
      }
    },
    [activeStyle, destinationLabel, initialRoute, showAlert],
  );

  const handleTimerComplete = useCallback(async () => {
    if (headedHomeRef.current || recalculatingRef.current) return;
    headedHomeRef.current = true;
    recalculatingRef.current = true;
    setHeadingHome(true);
    setRecalculating(true);
    setRecalcError(null);

    try {
      const here = await getCurrentPosition();
      const destination = resolveEndDestination(initialRoute, destinationLabel);
      const avoidHighways =
        activeStyle === 'no-highway' ||
        activeStyle === 'scenic' ||
        activeStyle === 'fewer-lights';

      const direct = await findDirectRoute({
        origin: formatCoord(here.lat, here.lng),
        destination,
        avoidHighways,
      });

      // Strip every remaining nap stop — Maps + in-app map go A→B only.
      const straight: RouteResult = {
        ...direct,
        isLoop: false,
        destination,
        allWaypoints: [],
        extraStops: [],
      };

      setRoute(straight);
    } catch (err) {
      headedHomeRef.current = false;
      setHeadingHome(false);
      const message =
        err instanceof RouteError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not build a direct route.';
      setRecalcError(message);
      showAlert({
        title: 'Could not head to destination',
        message: `${message}\n\nTap Open Maps to navigate manually.`,
        tone: 'warning',
      });
    } finally {
      recalculatingRef.current = false;
      setRecalculating(false);
    }
  }, [activeStyle, destinationLabel, initialRoute, showAlert]);

  const handleTakeAlternativeRoute = useCallback(async () => {
    if (recalculatingRef.current) return;
    const currentAlerts = alertsRef.current;
    if (currentAlerts.length === 0) return;

    recalculatingRef.current = true;
    setFindingAlt(true);
    setRecalculating(true);
    setRecalcError(null);

    const baselineHazards = countSafetyHazards(currentAlerts);
    const maxAttempts = 3;

    try {
      const here = await getCurrentPosition();
      const destination = resolveEndDestination(initialRoute, destinationLabel);
      const remainingMinutes = Math.max(
        5,
        Math.ceil(secondsLeftRef.current / 60),
      );

      let best: RouteResult | null = null;
      let bestHazards = Infinity;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        altRouteCountRef.current += 1;
        const destCoord =
          parseLatLng(destination) ??
          endPin ??
          homeOriginRef.current;
        const bypass = bypassWaypointForRestricted(
          here,
          destCoord,
          currentAlerts,
          attempt,
        );

        let candidate: RouteResult;

        if (headedHomeRef.current) {
          const avoidHighways =
            activeStyle === 'no-highway' ||
            activeStyle === 'scenic' ||
            activeStyle === 'fewer-lights';
          const direct = await findDirectRoute({
            origin: formatCoord(here.lat, here.lng),
            destination,
            avoidHighways,
            waypoints: bypass ? [bypass] : undefined,
          });
          candidate = {
            ...direct,
            isLoop: false,
            destination,
            allWaypoints: [],
            extraStops: [],
          };
        } else {
          const extraStops = [
            ...(bypass ? [bypass] : []),
            ...(initialRoute.extraStops ?? []),
          ];
          const next = await findRoute({
            origin: formatCoord(here.lat, here.lng),
            destination,
            durationMinutes: remainingMinutes,
            routeTypes: [activeStyle],
            extraStops,
            variation: extendCountRef.current + altRouteCountRef.current,
            minDurationMinutes: 5,
          });
          candidate = {
            ...next,
            isLoop: initialRoute.isLoop,
            destination: initialRoute.isLoop
              ? formatCoord(
                  homeOriginRef.current.lat,
                  homeOriginRef.current.lng,
                )
              : initialRoute.destination ?? destinationLabel,
            extraStops: initialRoute.extraStops,
          };
        }

        const check = await buildRouteAlerts(candidate.polyline, {
          routeRestrictionsPartiallyIgnored:
            candidate.routeRestrictionsPartiallyIgnored,
          origin: candidate.origin,
        });
        const hazards = countSafetyHazards(check.alerts);

        if (hazards < bestHazards) {
          bestHazards = hazards;
          best = candidate;
        }
        if (hazards === 0) break;
      }

      if (!best) {
        throw new RouteError('Could not find an alternate route.');
      }

      setRoute(best);

      if (bestHazards > 0 && bestHazards >= baselineHazards) {
        showAlert({
          title: 'Still near an unsafe area',
          message:
            'Tried alternate paths, but a restricted area, crime, fire, or other incident may still be nearby. You can tap Alt route again or Open Maps to navigate around it.',
          tone: 'danger',
        });
      }
    } catch (err) {
      const message =
        err instanceof RouteError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not build an alternate route.';
      setRecalcError(message);
      showAlert({
        title: 'Could not find alternate route',
        message,
        tone: 'warning',
      });
    } finally {
      recalculatingRef.current = false;
      setFindingAlt(false);
      setRecalculating(false);
    }
  }, [activeStyle, destinationLabel, endPin, initialRoute, showAlert]);

  const handleSecondsLeftChange = useCallback((secondsLeft: number) => {
    secondsLeftRef.current = secondsLeft;
  }, []);

  const lastPersistAtRef = useRef(0);
  const mapsOpenedRef = useRef(mapsOpened);
  mapsOpenedRef.current = mapsOpened;
  const routeRef = useRef(route);
  routeRef.current = route;
  const durationRef = useRef(durationMinutes);
  durationRef.current = durationMinutes;
  const timerStateRef = useRef({
    running: Boolean(initialEndsAt && initialEndsAt > Date.now()) || napStarted,
    secondsLeft:
      initialSecondsLeft ?? initialTotalSeconds ?? initialDuration * 60,
    totalSeconds: initialTotalSeconds ?? initialDuration * 60,
    endsAt: initialEndsAt ?? null,
  });

  const handleTimerStateChange = useCallback(
    (state: {
      running: boolean;
      secondsLeft: number;
      totalSeconds: number;
      endsAt: number | null;
    }) => {
      secondsLeftRef.current = state.secondsLeft;
      timerStateRef.current = state;
      const started =
        state.running ||
        mapsOpenedRef.current ||
        napStarted ||
        state.secondsLeft < state.totalSeconds;
      if (!started) return;
      setTimerStarted(true);
      const now = Date.now();
      if (
        state.running &&
        now - lastPersistAtRef.current < 4000 &&
        state.secondsLeft > 0
      ) {
        return;
      }
      lastPersistAtRef.current = now;
      void persist({
        route: routeRef.current,
        destinationLabel,
        activeStyle,
        mapsOpened: mapsOpenedRef.current || napStarted,
        plannedMinutes: durationRef.current,
        totalSeconds: state.totalSeconds,
        endsAt: state.endsAt,
        running: state.running,
        secondsLeft: state.secondsLeft,
        savedAt: now,
      });
    },
    [activeStyle, destinationLabel, napStarted, persist],
  );

  const persistCurrentRide = useCallback(async () => {
    const state = timerStateRef.current;
    const started =
      state.running ||
      mapsOpenedRef.current ||
      napStarted ||
      state.secondsLeft < state.totalSeconds;
    if (!started) return;
    await persist({
      route: routeRef.current,
      destinationLabel,
      activeStyle,
      mapsOpened: mapsOpenedRef.current || napStarted,
      plannedMinutes: durationRef.current,
      totalSeconds: state.totalSeconds,
      endsAt: state.endsAt,
      running: state.running,
      secondsLeft: state.secondsLeft,
      savedAt: Date.now(),
    });
  }, [activeStyle, destinationLabel, napStarted, persist]);

  const leaveNavigate = useCallback(() => {
    void (async () => {
      await persistCurrentRide();
      if (navigation.canGoBack()) {
        navigation.goBack();
        return;
      }
      navigation.replace('MainTabs');
    })();
  }, [navigation, persistCurrentRide]);

  const confirmEndNap = useCallback(() => {
    const state = timerStateRef.current;
    const started =
      state.running ||
      mapsOpenedRef.current ||
      napStarted ||
      timerStarted ||
      state.secondsLeft < state.totalSeconds;
    if (!started) {
      leaveNavigate();
      return;
    }
    showAlert({
      title: 'End this nap?',
      message:
        'Your current ride will stop. You can plan a new route after that.',
      tone: 'danger',
      buttons: [
        { label: 'Keep riding', variant: 'ghost' },
        {
          label: 'End nap',
          variant: 'primary',
          onPress: () => {
            void endSession();
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            navigation.replace('MainTabs');
          },
        },
      ],
    });
  }, [endSession, leaveNavigate, napStarted, navigation, showAlert, timerStarted]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leaveNavigate();
      return true;
    });
    return () => sub.remove();
  }, [leaveNavigate]);

  useEffect(() => {
    if (!napStarted && !mapsOpened) return;
    void (async () => {
      const current = await loadActiveNap();
      if (!current) return;
      await persist({
        ...current,
        route,
        plannedMinutes: durationMinutes,
        savedAt: Date.now(),
      });
    })();
  }, [mapsOpened, napStarted, persist, route, durationMinutes]);

  return (
    <View style={styles.root}>
      <NapMap
        height="100%"
        origin={route.origin}
        route={route}
        destination={endPin}
        fullBleed
        showsUserLocation
        followUser={!recalculating}
        loading={recalculating}
        loadingLabel={
          findingAlt
            ? 'Finding a clear route…'
            : headingHome
              ? 'Routing straight…'
              : 'Updating your route…'
        }
        error={recalcError}
        snappedPath={snappedPath}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={leaveNavigate}
          style={styles.backBtn}
          accessibilityLabel="Back">
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <View style={styles.topMeta}>
          <Text style={styles.topTitle} numberOfLines={1}>
            {meta.emoji} {meta.label} · {route.durationText}
          </Text>
          <Text style={styles.topSub} numberOfLines={1}>
            {recalculating
              ? findingAlt
                ? 'Finding alternate route…'
                : headingHome
                  ? 'Clearing stops · routing straight…'
                  : `Updating for ${durationMinutes} min nap…`
              : headingHome
                ? `Straight to ${destinationLabel || (initialRoute.isLoop ? 'home' : 'destination')}`
                : route.isLoop
                  ? 'Loop back to start'
                  : `To ${destinationLabel || 'your destination'}`}
          </Text>
        </View>
        {timerStarted || mapsOpened || napStarted ? (
          <Pressable
            onPress={confirmEndNap}
            style={styles.endBtn}
            accessibilityLabel="End nap">
            <Text style={styles.endBtnText}>End</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.timerOverlay, { paddingBottom: insets.bottom + 12 }]}>
        {alerts.length > 0 && (
          <View style={styles.alertBanner}>
            <View style={styles.alertBannerMain}>
              <Text style={styles.alertBannerText} numberOfLines={2}>
                {alertBannerText(alerts)}
              </Text>
            </View>
            <Pressable
              onPress={handleTakeAlternativeRoute}
              disabled={recalculating}
              style={[
                styles.alertAltBtn,
                recalculating && styles.alertAltBtnDisabled,
              ]}
              accessibilityLabel="Take alternative route">
              <Text style={styles.alertAltBtnText}>
                {findingAlt ? '…' : 'Alt route'}
              </Text>
            </Pressable>
          </View>
        )}
        {(recalculating || headingHome) && (
          <View style={styles.overlayHint}>
            <Text style={styles.overlayHintText}>
              {recalculating
                ? findingAlt
                  ? 'Finding an alternate route around the unsafe area…'
                  : headingHome
                    ? 'Nap over — removing remaining stops and routing straight…'
                    : 'Recalculating nap route for the extended time…'
                : 'Nap over · route updated straight to your destination — tap Open Maps'}
            </Text>
          </View>
        )}
        {navActive && currentNavStep && (
          <View style={styles.navPanel}>
            <View style={styles.navHeader}>
              <View style={styles.navIcon}>
                <Text style={{ fontSize: 22 }}>
                  {dirIcon(currentNavStep.instruction)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.navInstruction} numberOfLines={2}>
                  {currentNavStep.instruction}
                </Text>
                <Text style={styles.navMeta}>
                  {currentNavStep.distance} · {currentNavStep.duration}
                </Text>
              </View>
              <Pressable
                onPress={() => setNavExpanded(v => !v)}
                style={styles.navSmallBtn}
                accessibilityLabel={
                  navExpanded ? 'Collapse directions' : 'Expand directions'
                }>
                <Text style={styles.navSmallBtnText}>
                  {navExpanded ? '▾' : '▴'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setNavActive(false);
                  setNavStep(0);
                  setNavExpanded(false);
                }}
                style={styles.navSmallBtn}
                accessibilityLabel="Close directions">
                <Text style={styles.navSmallBtnText}>✕</Text>
              </Pressable>
            </View>
            {navExpanded && (
              <ScrollView style={styles.navStepList}>
                {allNavSteps.map((step, i) => (
                  <Pressable
                    key={`${step.instruction}-${i}`}
                    onPress={() => setNavStep(i)}
                    style={[
                      styles.stepRow,
                      i === safeNavStep && styles.stepRowActive,
                    ]}>
                    <Text style={styles.stepIcon}>
                      {dirIcon(step.instruction)}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.stepText,
                          i === safeNavStep && styles.stepTextActive,
                        ]}>
                        {step.instruction}
                      </Text>
                      <Text style={styles.stepDist}>{step.distance}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View style={styles.navControls}>
              <Pressable
                onPress={() => setNavStep(s => Math.max(0, s - 1))}
                disabled={safeNavStep === 0}
                style={[
                  styles.navCtrlBtn,
                  safeNavStep === 0 && styles.navCtrlDisabled,
                ]}>
                <Text style={styles.navCtrlText}>← Prev</Text>
              </Pressable>
              <Text style={styles.navCount}>
                {safeNavStep + 1} / {allNavSteps.length}
              </Text>
              <Pressable
                onPress={() =>
                  setNavStep(s => Math.min(allNavSteps.length - 1, s + 1))
                }
                disabled={safeNavStep === allNavSteps.length - 1}
                style={[
                  styles.navCtrlBtn,
                  styles.navCtrlPrimary,
                  safeNavStep === allNavSteps.length - 1 &&
                    styles.navCtrlDisabled,
                ]}>
                <Text style={styles.navCtrlPrimaryText}>Next →</Text>
              </Pressable>
            </View>
          </View>
        )}
        {!navActive && allNavSteps.length > 0 && (
          <Pressable
            onPress={() => {
              setNavActive(true);
              setNavExpanded(false);
            }}
            style={styles.directionsBtn}
            accessibilityLabel="View directions">
            <Text style={styles.directionsBtnText}>View directions</Text>
          </Pressable>
        )}
        <NapTimer
          variant="overlay"
          autoStart={napStarted && (initialEndsAt != null || initialSecondsLeft == null)}
          durationMinutes={initialDuration}
          initialEndsAt={initialEndsAt}
          initialTotalSeconds={initialTotalSeconds}
          initialSecondsLeft={initialSecondsLeft}
          alertAtMinutes={settings.notifyAtMinutes}
          alertsEnabled={settings.notificationsEnabled}
          onDismiss={leaveNavigate}
          onExtend={handleExtend}
          onComplete={handleTimerComplete}
          onSecondsLeftChange={handleSecondsLeftChange}
          onTimerStateChange={handleTimerStateChange}
          beginAction={{
            idleLabel: 'Begin Nap',
            activeLabel: 'Open Maps',
            active: mapsOpened || napStarted,
            onPress: handleOpenMaps,
          }}
        />
      </View>
    </View>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.mapBgFull,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    backgroundColor: colors.overlay,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: colors.lavenderBorder,
  },
  backText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.purple,
  },
  endBtn: {
    backgroundColor: colors.overlay,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: colors.dangerSoft,
  },
  endBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.danger,
  },
  topMeta: {
    flex: 1,
    backgroundColor: colors.overlay,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: colors.lavenderBorder,
  },
  topTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.purple,
  },
  topSub: {
    fontSize: 11,
    color: colors.purpleMuted,
    marginTop: 2,
  },
  timerOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    gap: 8,
  },
  alertBanner: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay,
    borderRadius: 999,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
    maxWidth: '100%',
    borderWidth: 1.5,
    borderColor: colors.dangerSoft,
    gap: 8,
  },
  alertBannerMain: {
    flexShrink: 1,
    paddingVertical: 4,
  },
  alertBannerText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '700',
  },
  alertAltBtn: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  alertAltBtnDisabled: {
    opacity: 0.55,
  },
  alertAltBtnText: {
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: '800',
  },
  overlayHint: {
    alignSelf: 'center',
    backgroundColor: colors.overlayScrim,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  overlayHintText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  directionsBtn: {
    alignSelf: 'center',
    backgroundColor: colors.overlay,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1.5,
    borderColor: colors.lavenderBorder,
  },
  directionsBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.purple,
  },
  navPanel: {
    borderRadius: 20,
    backgroundColor: colors.overlay,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.lavenderBorder,
  },
  navHeader: {
    backgroundColor: colors.primary,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  navIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navInstruction: {
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  navMeta: {
    color: colors.onPrimary,
    fontSize: 11,
    marginTop: 2,
  },
  navSmallBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  navSmallBtnText: {
    color: colors.onPrimary,
    fontWeight: '700',
  },
  navStepList: {
    maxHeight: 140,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  stepRowActive: {
    backgroundColor: colors.lavenderWash,
    borderLeftColor: colors.primary,
  },
  stepIcon: {
    width: 22,
    textAlign: 'center',
  },
  stepText: { fontSize: 13, color: colors.purple },
  stepTextActive: { fontWeight: '700' },
  stepDist: { fontSize: 11, color: colors.lavenderSoft, marginTop: 2 },
  navControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: colors.lavenderBorder,
  },
  navCtrlBtn: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.lavenderBorder,
    alignItems: 'center',
  },
  navCtrlPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  navCtrlDisabled: {
    opacity: 0.4,
  },
  navCtrlText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.purple,
  },
  navCtrlPrimaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onPrimary,
  },
  navCount: { fontSize: 11, color: colors.lavenderSoft },
  });
}
