import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NapMap from '../components/NapMap';
import NapTimer from '../components/NapTimer';
import { ROUTE_TYPE_META } from '../constants/content';
import { useAppAlert } from '../context/AlertContext';
import { useNapSession } from '../context/NapSessionContext';
import { useNapSettings } from '../context/SettingsContext';
import { fetchCurrentPosition } from '../hooks/useGpsLocation';
import { useKeepAwakeWhile } from '../hooks/useKeepAwake';
import { useNapNavigation } from '../hooks/useNapNavigation';
import type { NavigateScreenProps } from '../navigation/types';
import { findDirectRoute, findRoute, RouteError } from '../services/mapsApi';
import {
  navDestinationsFromRoute,
  trimRouteFromLocation,
} from '../services/napNavigation';
import { loadActiveNap, saveActiveNap } from '../services/napSession';
import {
  buildRouteAlerts,
  bypassWaypointForRestricted,
  countSafetyHazards,
  hazardLabel,
  isSafetyHazard,
} from '../services/restrictedAreas';
import type { LatLng, RouteAlert, RouteResult } from '../types/route';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';
import {
  dirIcon,
  formatCoord,
  formatEtaSeconds,
  formatMeters,
  parseLatLng,
  rerouteDestination,
} from '../utils/geo';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function resolveEndDestination(
  route: RouteResult,
  destinationLabel: string | null,
  plannedOrigin: { lat: number; lng: number },
  destination?: string | null,
): string {
  return rerouteDestination({
    plannedOrigin,
    destination: destination ?? route.destination,
    destinationLabel,
    isLoop: route.isLoop,
  });
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
    destination: plannedDestination,
    plannedOrigin,
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
  const [changingRoute, setChangingRoute] = useState(false);
  const [navActive, setNavActive] = useState(Boolean(napStarted));
  const [timerStarted, setTimerStarted] = useState(napStarted);
  const [voiceOn, setVoiceOn] = useState(false);
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const napNav = useNapNavigation();
  const voiceOnRef = useRef(false);
  voiceOnRef.current = voiceOn;
  const rideInProgress =
    mapsOpened || napStarted || timerStarted || headingHome;
  useKeepAwakeWhile(rideInProgress);

  const homeOriginRef = useRef(plannedOrigin ?? initialRoute.origin);
  const plannedDestRef = useRef(plannedDestination);
  const extendCountRef = useRef(0);
  const altRouteCountRef = useRef(0);
  const changeRouteCountRef = useRef(0);
  const recalculatingRef = useRef(false);
  const headedHomeRef = useRef(false);
  const secondsLeftRef = useRef(initialDuration * 60);
  const alertsRef = useRef<RouteAlert[]>([]);
  const guidanceStartedRef = useRef(false);

  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  const endPin = useMemo(() => {
    const planned = parseLatLng(plannedDestRef.current ?? null);
    if (planned) return planned;
    if (route.isLoop) return homeOriginRef.current;
    const fromDest = parseLatLng(route.destination ?? null);
    if (fromDest) return fromDest;
    const lastLeg = route.legs[route.legs.length - 1];
    const lastStep = lastLeg?.steps[lastLeg.steps.length - 1];
    return lastStep?.endLocation ?? homeOriginRef.current;
  }, [route]);

  const displayRoute = useMemo(() => {
    const remainingStops = napNav.remainingDestinations.filter(d => d.checkpoint);
    if (remainingStops.length === 0) return route;
    return {
      ...route,
      allWaypoints: remainingStops.map(d => ({ lat: d.lat, lng: d.lng })),
    };
  }, [napNav.remainingDestinations, route]);

  const followLiveLocation = useMemo(() => {
    if (napNav.usingNative || !napNav.snapshot) return null;
    return {
      lat: napNav.snapshot.lat,
      lng: napNav.snapshot.lng,
      heading: napNav.snapshot.heading,
    };
  }, [
    napNav.snapshot?.heading,
    napNav.snapshot?.lat,
    napNav.snapshot?.lng,
    napNav.usingNative,
  ]);

  const avoidHighwaysForNav =
    activeStyle === 'no-highway' ||
    activeStyle === 'scenic' ||
    activeStyle === 'fewer-lights';

  const startGuidance = useCallback(async () => {
    let liveRoute = route;
    try {
      const here = await fetchCurrentPosition();
      liveRoute = trimRouteFromLocation(route, here);
      if (liveRoute.polyline !== route.polyline) {
        setRoute(liveRoute);
      }
    } catch {
      // Guidance still starts on the planned path if GPS is unavailable.
    }
    const dests = navDestinationsFromRoute(liveRoute, endPin);
    if (dests.length === 0) {
      showAlert({
        title: 'No destination',
        message: 'This nap route has no stops to navigate to.',
        tone: 'warning',
      });
      return;
    }
    setNavActive(true);
    setMapsOpened(true);
    guidanceStartedRef.current = true;
    await napNav.start(
      {
        destinations: dests,
        avoidHighways: avoidHighwaysForNav,
        voice: voiceOnRef.current,
      },
      liveRoute,
    );
  }, [avoidHighwaysForNav, endPin, napNav, route, showAlert]);

  const startGuidanceRef = useRef(startGuidance);
  startGuidanceRef.current = startGuidance;

  useEffect(() => {
    if (!napStarted) return;
    void startGuidanceRef.current();
  }, [napStarted]);

  useEffect(() => {
    if (!guidanceStartedRef.current) return;
    if (napNav.status !== 'active') return;
    const dests = navDestinationsFromRoute(route, endPin);
    void napNav.update(
      {
        destinations: dests,
        avoidHighways: avoidHighwaysForNav,
        voice: voiceOnRef.current,
      },
      route,
    );
  }, [route.polyline]);

  useEffect(() => {
    if (!napNav.hint?.startsWith('Collected')) return;
    ReactNativeHapticFeedback.trigger('notificationSuccess', {
      enableVibrateFallback: true,
      ignoreAndroidSystemSettings: false,
    });
  }, [napNav.hint]);

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

  const handleStartNavigation = async () => {
    await startGuidance();
  };

  const planEndDestination = useCallback(
    () =>
      resolveEndDestination(
        initialRoute,
        destinationLabel,
        homeOriginRef.current,
        plannedDestRef.current,
      ),
    [destinationLabel, initialRoute],
  );

  const rebuildNapRouteFromHere = useCallback(
    async (remainingMinutes: number, variation: number) => {
      const here = await fetchCurrentPosition();
      const destination = planEndDestination();
      const next = await findRoute({
        origin: formatCoord(here.lat, here.lng),
        destination,
        durationMinutes: remainingMinutes,
        routeTypes: [activeStyle],
        extraStops: initialRoute.extraStops ?? [],
        variation,
        minDurationMinutes: 5,
      });

      const patched: RouteResult = {
        ...next,
        isLoop: initialRoute.isLoop,
        destination: initialRoute.isLoop
          ? formatCoord(homeOriginRef.current.lat, homeOriginRef.current.lng)
          : destination,
        extraStops: initialRoute.extraStops,
      };

      setRoute(patched);
    },
    [activeStyle, initialRoute, planEndDestination],
  );

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
        await rebuildNapRouteFromHere(remainingMinutes, extendCountRef.current);
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
          message: `${message}\n\nTimer was extended — tap Begin Nap when you have a signal if you want turn-by-turn.`,
          tone: 'warning',
        });
      } finally {
        recalculatingRef.current = false;
        setRecalculating(false);
      }
    },
    [rebuildNapRouteFromHere, showAlert],
  );

  const handleChangeRoute = useCallback(async () => {
    if (recalculatingRef.current || headedHomeRef.current) return;
    if (secondsLeftRef.current <= 0) return;

    recalculatingRef.current = true;
    setChangingRoute(true);
    setRecalculating(true);
    setRecalcError(null);

    try {
      const remainingMinutes = Math.max(
        5,
        Math.ceil(secondsLeftRef.current / 60),
      );
      changeRouteCountRef.current += 1;
      await rebuildNapRouteFromHere(
        remainingMinutes,
        extendCountRef.current + changeRouteCountRef.current,
      );
    } catch (err) {
      const message =
        err instanceof RouteError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not rebuild the nap route.';
      setRecalcError(message);
      showAlert({
        title: 'Could not change route',
        message: `${message}\n\nYou're still on the current path — try again when you have a signal.`,
        tone: 'warning',
      });
    } finally {
      recalculatingRef.current = false;
      setChangingRoute(false);
      setRecalculating(false);
    }
  }, [rebuildNapRouteFromHere, showAlert]);

  const handleTimerComplete = useCallback(async () => {
    if (headedHomeRef.current || recalculatingRef.current) return;
    headedHomeRef.current = true;
    recalculatingRef.current = true;
    setHeadingHome(true);
    setRecalculating(true);
    setRecalcError(null);

    try {
      const here = await fetchCurrentPosition();
      const destination = planEndDestination();
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
        message: `${message}\n\nStay on the nap map — we'll keep trying to route you home.`,
        tone: 'warning',
      });
    } finally {
      recalculatingRef.current = false;
      setRecalculating(false);
    }
  }, [activeStyle, initialRoute, planEndDestination, showAlert]);

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
      const here = await fetchCurrentPosition();
      const destination = planEndDestination();
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
              : destination,
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
            'Tried alternate paths, but a restricted area, crime, fire, or other incident may still be nearby. You can tap Alt route again to keep looking.',
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
  }, [activeStyle, endPin, initialRoute, planEndDestination, showAlert]);

  const handleSecondsLeftChange = useCallback((secondsLeft: number) => {
    secondsLeftRef.current = secondsLeft;
  }, []);

  const handleToggleVoice = useCallback(() => {
    setVoiceOn(prev => {
      const next = !prev;
      napNav.setVoice(next);
      return next;
    });
  }, [napNav]);

  const handleToggleSheet = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSheetCollapsed(prev => !prev);
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
      // Write storage only — skip session context so the nav map does not re-render.
      void saveActiveNap({
        route: routeRef.current,
        destinationLabel,
        destination: plannedDestRef.current,
        plannedOrigin: homeOriginRef.current,
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
    [activeStyle, destinationLabel, napStarted],
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
      destination: plannedDestRef.current,
      plannedOrigin: homeOriginRef.current,
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
      await napNav.stop();
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
            void (async () => {
              await napNav.stop();
              await endSession();
              if (navigation.canGoBack()) {
                navigation.goBack();
                return;
              }
              navigation.replace('MainTabs');
            })();
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
        route={napNav.usingNative ? route : displayRoute}
        destination={endPin}
        fullBleed
        showsUserLocation
        followUser={!recalculating && napNav.status !== 'active'}
        navigation={napNav.usingNative}
        liveLocation={followLiveLocation}
        loading={recalculating}
        loadingLabel={
          findingAlt
            ? 'Finding a clear route…'
            : changingRoute
              ? 'Finding a new route…'
              : headingHome
                ? 'Routing straight…'
                : 'Updating your route…'
        }
        error={recalcError}
        snappedPath={snappedPath}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        {!(napNav.usingNative) ? (
        <View style={styles.topMeta}>
          <Text style={styles.topTitle} numberOfLines={1}>
            {meta.emoji} {meta.label} · {route.durationText}
          </Text>
          <Text style={styles.topSub} numberOfLines={1}>
            {recalculating
              ? findingAlt
                ? 'Finding alternate route…'
                : changingRoute
                  ? 'Finding a new route…'
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
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Pressable
          onPress={handleToggleVoice}
          style={[styles.voiceBtn, voiceOn && styles.voiceBtnOn]}
          accessibilityRole="button"
          accessibilityLabel={
            voiceOn ? 'Mute route voice-over' : 'Unmute route voice-over'
          }>
          <Text style={styles.voiceBtnText}>{voiceOn ? '🔊' : '🔇'}</Text>
        </Pressable>
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
        {/* {alerts.length > 0 && (
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
        )} */}
        {(recalculating || headingHome) && (
          <View style={styles.overlayHint}>
            <Text style={styles.overlayHintText}>
              {recalculating
                ? findingAlt
                  ? 'Finding an alternate route around the unsafe area…'
                  : changingRoute
                    ? 'Finding a new nap route from where you are…'
                    : headingHome
                      ? 'Nap over — removing remaining stops and routing straight…'
                      : 'Recalculating nap route for the extended time…'
                : 'Nap over · routing straight to your destination'}
            </Text>
          </View>
        )}
        {/* {(napNav.hint ||
          napNav.error ||
          napNav.snapshot?.offRoute ||
          napNav.snapshot?.rerouting) &&
          !recalculating && (
          <View style={styles.overlayHint}>
            <Text style={styles.overlayHintText}>
              {napNav.snapshot?.rerouting
                ? 'Off route — requesting a new path…'
                : napNav.snapshot?.offRoute
                  ? 'Off the nap route — hold the wheel, rerouting'
                  : napNav.hint || napNav.error}
            </Text>
          </View>
        )} */}
        {navActive && napNav.snapshot && !napNav.usingNative && !sheetCollapsed && (
          <View style={styles.navPanel}>
            <View style={styles.navHeader}>
              <View style={styles.navIcon}>
                <Text style={{ fontSize: 22 }}>
                  {dirIcon(napNav.snapshot.instruction || napNav.snapshot.maneuver)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.navInstruction} numberOfLines={2}>
                  {napNav.snapshot.instruction || 'Continue on the nap route'}
                </Text>
                <Text style={styles.navMeta}>
                  {formatMeters(napNav.snapshot.maneuverDistanceMeters)} to turn
                  {' · '}
                  ETA {formatEtaSeconds(napNav.snapshot.remainingSeconds)}
                  {' · '}
                  {formatMeters(napNav.snapshot.remainingMeters)} left
                </Text>
              </View>
            </View>
            <View style={styles.navLiveRow}>
              <Text style={styles.navLiveText}>
                {napNav.snapshot.finalDestination
                  ? napNav.snapshot.destinationTitle
                  : `Next checkpoint · ${napNav.snapshot.destinationTitle}`}
              </Text>
              {napNav.usingNative ? (
                <Text style={styles.navLiveVoice}>
                  {voiceOn ? 'Voice on' : 'Voice muted'}
                </Text>
              ) : (
                <Text style={styles.navLiveVoice}>GPS guide</Text>
              )}
            </View>
          </View>
        )}
        <NapTimer
          variant="overlay"
          collapsed={sheetCollapsed}
          onToggleCollapsed={handleToggleSheet}
          autoStart={napStarted && (initialEndsAt != null || initialSecondsLeft == null)}
          durationMinutes={initialDuration}
          initialEndsAt={initialEndsAt}
          initialTotalSeconds={initialTotalSeconds}
          initialSecondsLeft={initialSecondsLeft}
          alertAtMinutes={settings.notifyAtMinutes}
          alertsEnabled={settings.notificationsEnabled}
          onDismiss={leaveNavigate}
          backAction={{ onPress: leaveNavigate }}
          onExtend={handleExtend}
          changeRouteAction={{
            onPress: handleChangeRoute,
            busy: changingRoute,
            disabled: recalculating || headingHome,
          }}
          onComplete={handleTimerComplete}
          onSecondsLeftChange={handleSecondsLeftChange}
          onTimerStateChange={handleTimerStateChange}
          beginAction={{
            idleLabel: 'Begin Nap',
            activeLabel: 'Navigating',
            active: mapsOpened || napStarted || napNav.status === 'active',
            onPress: handleStartNavigation,
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
  voiceBtn: {
    backgroundColor: colors.overlay,
    borderRadius: 999,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.lavenderBorder,
  },
  voiceBtnOn: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  voiceBtnText: {
    fontSize: 16,
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
  navLiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.lavenderBorder,
  },
  navLiveText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.purple,
  },
  navLiveVoice: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.purpleMuted,
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
