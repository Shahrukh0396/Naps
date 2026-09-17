import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActiveRideBanner from '../components/ActiveRideBanner';
import GradientBackground from '../components/GradientBackground';
import NapMap from '../components/NapMap';
import PlacesAutocomplete from '../components/PlacesAutocomplete';
import RestrictedRoutesAlert from '../components/RestrictedRoutesAlert';
import { ROUTE_TYPE_META } from '../constants/content';
import { useAppAlert } from '../context/AlertContext';
import { useNapSession } from '../context/NapSessionContext';
import {
  placesWithAddress,
  useNapSettings,
} from '../context/SettingsContext';
import { fetchCurrentPosition } from '../hooks/useGpsLocation';
import { calcNapMatch, napMatchLabel } from '../mocks/routes';
import { findRoute, findRouteSuggestions, RouteError } from '../services/mapsApi';
import { navigateParamsFromSession } from '../services/napSession';
import { armNapAlerts } from '../services/napTimerNotifications';
import type { ResultsScreenProps } from '../navigation/types';
import type {
  RestrictedRouteOption,
  RouteResult,
  RouteStyleId,
  RouteVariant,
} from '../types/route';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';
import {
  distanceMeters,
  formatCoord,
  ORIGIN_MOVED_METERS,
  parseLatLng,
  rerouteDestination,
  sameCoord,
} from '../utils/geo';

function sameStops(a?: string[], b?: string[]): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((stop, i) => stop === right[i]);
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

export default function ResultsScreen({ navigation, route: navRoute }: ResultsScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { settings } = useNapSettings();
  const showAlert = useAppAlert();
  const { session, refresh: refreshSession, persist } = useNapSession();
  const params = navRoute.params;

  const [route, setRoute] = useState<RouteResult>(params.route);
  const [variants, setVariants] = useState<RouteVariant[]>(params.variants);
  const [activeStyle, setActiveStyle] = useState<RouteStyleId>(params.activeStyle);
  const [activeVariation, setActiveVariation] = useState(
    params.activeVariation ?? params.variants[0]?.variation ?? 0,
  );
  const [routesByVariation, setRoutesByVariation] = useState<
    Record<number, RouteResult>
  >(
    () =>
      params.routesByVariation ?? {
        [params.activeVariation ?? params.variants[0]?.variation ?? 0]:
          params.route,
      },
  );
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [navActive, setNavActive] = useState(false);
  const [navStep, setNavStep] = useState(0);
  const [navExpanded, setNavExpanded] = useState(true);
  const [extraStops, setExtraStopsState] = useState<string[]>([]);
  const extraStopsRef = useRef<string[]>([]);
  const setExtraStops = (stops: string[]) => {
    extraStopsRef.current = stops;
    setExtraStopsState(stops);
  };
  const [addStopOpen, setAddStopOpen] = useState(false);
  const [stopInput, setStopInput] = useState('');
  const [stopLoading, setStopLoading] = useState(false);
  const [startingNap, setStartingNap] = useState(false);
  const [checkingLocation, setCheckingLocation] = useState(false);
  const [restrictedOptions, setRestrictedOptions] = useState<
    RestrictedRouteOption[]
  >(params.restrictedOptions ?? []);
  const [restrictedAlertOpen, setRestrictedAlertOpen] = useState(
    (params.restrictedOptions?.length ?? 0) > 0 && !params.route.polyline,
  );

  const hasChosenRoute = Boolean(route.polyline);
  const activeRideIsThisRoute = Boolean(
    session && session.route.polyline === route.polyline,
  );
  const rideBlocksNewStart = Boolean(session && !activeRideIsThisRoute);

  const durationMinutes = params.durationMinutes;
  const destination = params.destination;
  const destinationLabel = params.destinationLabel ?? null;
  const plannedOrigin = params.origin ?? params.route.origin;
  const destForReroute = rerouteDestination({
    plannedOrigin,
    destination,
    destinationLabel,
    isLoop: params.route.isLoop || !destination,
  });
  const originLabel = params.originLabel;
  const preferredStyle = params.preferredStyle ?? params.activeStyle;
  const meta = ROUTE_TYPE_META[activeStyle];
  const savedPlaces = useMemo(
    () => placesWithAddress(settings.savedPlaces),
    [settings.savedPlaces],
  );

  useFocusEffect(
    useCallback(() => {
      void refreshSession();
    }, [refreshSession]),
  );

  const originForMap = route.origin ?? null;
  const routeRef = useRef(route);
  routeRef.current = route;
  const busy = routeLoading || refreshing || stopLoading || startingNap || checkingLocation;

  const originStr = useMemo(() => {
    if (route.origin) return formatCoord(route.origin.lat, route.origin.lng);
    return originLabel;
  }, [route.origin, originLabel]);

  const liveOriginStr = async () => {
    try {
      const here = await fetchCurrentPosition();
      return formatCoord(here.lat, here.lng);
    } catch {
      return originStr;
    }
  };

  const endPin = useMemo(() => {
    const plannedEnd = parseLatLng(destForReroute);
    if (plannedEnd) return plannedEnd;
    const lastLeg = route.legs[route.legs.length - 1];
    const lastStep = lastLeg?.steps[lastLeg.steps.length - 1];
    return lastStep?.endLocation ?? plannedOrigin;
  }, [destForReroute, plannedOrigin, route]);

  const allNavSteps = useMemo(
    () => route.legs.flatMap(leg => leg.steps),
    [route],
  );
  const safeNavStep = Math.min(navStep, Math.max(0, allNavSteps.length - 1));
  const currentNavStep = allNavSteps[safeNavStep] ?? null;

  const handleSelectRouteVariant = async (variant: RouteVariant) => {
    if (session || busy) return;
    if (
      variant.id === activeStyle &&
      variant.variation === activeVariation
    ) {
      return;
    }
    setActiveStyle(variant.id);
    setActiveVariation(variant.variation);
    setNavActive(false);
    setNavStep(0);
    setRouteError(null);

    const cached = routesByVariation[variant.variation];
    if (cached && sameStops(cached.extraStops, extraStopsRef.current)) {
      setRoute({
        ...cached,
        destination,
        isLoop: !destination,
        extraStops: extraStopsRef.current,
      });
      return;
    }

    const previousStyle = activeStyle;
    const previousVariation = activeVariation;
    setRouteLoading(true);
    try {
      const next = await findRoute({
        origin: await liveOriginStr(),
        destination: destForReroute,
        durationMinutes,
        routeTypes: [variant.id],
        extraStops: extraStopsRef.current,
        variation: variant.variation,
      });
      const withDest = {
        ...next,
        destination,
        isLoop: !destination,
        extraStops: extraStopsRef.current,
      };
      setRoutesByVariation(prev => ({
        ...prev,
        [variant.variation]: withDest,
      }));
      setRoute(withDest);
      setVariants(prev =>
        prev.map(v =>
          v.variation === variant.variation
            ? {
                ...v,
                durationMinutes: Math.round(next.durationSeconds / 60),
                durationText: next.durationText,
                summary: next.summary,
                napMatchScore: calcNapMatch(
                  Math.round(next.durationSeconds / 60),
                  durationMinutes,
                ),
              }
            : v,
        ),
      );
    } catch (err) {
      setActiveStyle(previousStyle);
      setActiveVariation(previousVariation);
      setRouteError(
        err instanceof RouteError
          ? err.message
          : 'Network error switching route. Please try again.',
      );
    } finally {
      setRouteLoading(false);
    }
  };

  const applySuggestions = (
    result: Awaited<ReturnType<typeof findRouteSuggestions>>,
  ) => {
    const stops = extraStopsRef.current;
    const routes = Object.fromEntries(
      Object.entries(result.routesByVariation).map(([key, value]) => [
        key,
        { ...value, destination, isLoop: !destination, extraStops: stops },
      ]),
    );
    setRefreshIndex(result.refreshIndex);
    setVariants(result.variants);
    setRoutesByVariation(routes);
    setActiveStyle(result.activeStyle);
    setActiveVariation(result.activeVariation);
    setRestrictedOptions(result.restrictedOptions);
    setRestrictedAlertOpen(
      result.variants.length === 0 && result.restrictedOptions.length > 0,
    );
    setRoute({
      ...result.primary,
      destination,
      extraStops: stops,
      isLoop: !destination,
    });
  };

  const loadSuggestions = async (origin: string, nextIndex: number) => {
    const result = await findRouteSuggestions({
      origin,
      destination: destForReroute,
      durationMinutes,
      preferredStyle,
      extraStops: extraStopsRef.current,
      refreshIndex: nextIndex,
    });
    applySuggestions(result);
  };

  const handleRefreshSuggestions = async () => {
    if (session || busy) return;
    setRefreshing(true);
    setRouteLoading(true);
    setRouteError(null);
    setNavActive(false);
    setNavStep(0);
    try {
      await loadSuggestions(await liveOriginStr(), refreshIndex + 3);
    } catch (err) {
      setRouteError(
        err instanceof RouteError
          ? err.message
          : 'Could not refresh suggestions. Please try again.',
      );
    } finally {
      setRefreshing(false);
      setRouteLoading(false);
    }
  };

  const findRouteFromNewLocation = async (here: { lat: number; lng: number }) => {
    setRefreshing(true);
    setRouteLoading(true);
    setRouteError(null);
    setNavActive(false);
    setNavStep(0);
    try {
      await loadSuggestions(formatCoord(here.lat, here.lng), 0);
    } catch (err) {
      setRouteError(
        err instanceof RouteError
          ? err.message
          : 'Could not find a route from your new location. Please try again.',
      );
    } finally {
      setRefreshing(false);
      setRouteLoading(false);
    }
  };

  const refetchWithStops = async (stops: string[]): Promise<boolean> => {
    setStopLoading(true);
    setRouteError(null);
    try {
      const next = await findRoute({
        origin: await liveOriginStr(),
        destination: destForReroute,
        durationMinutes,
        routeTypes: [preferredStyle],
        extraStops: stops,
        variation: activeVariation,
      });
      const withDest = {
        ...next,
        destination,
        isLoop: !destination,
        extraStops: stops,
      };
      setRoutesByVariation({ [activeVariation]: withDest });
      setRoute(withDest);
      setVariants(prev =>
        prev.map(v =>
          v.variation === activeVariation
            ? {
                ...v,
                durationMinutes: Math.round(next.durationSeconds / 60),
                durationText: next.durationText,
                summary: next.summary,
                napMatchScore: calcNapMatch(
                  Math.round(next.durationSeconds / 60),
                  durationMinutes,
                ),
              }
            : v,
        ),
      );
      return true;
    } catch (err) {
      setRouteError(
        err instanceof RouteError
          ? err.message
          : 'Could not update stops. Please try again.',
      );
      return false;
    } finally {
      setStopLoading(false);
    }
  };

  const handleAddStop = async () => {
    if (!stopInput.trim() || stopLoading) return;
    const added = stopInput.trim();
    const newStops = [...extraStopsRef.current, added];
    setStopInput('');
    setAddStopOpen(false);
    const ok = await refetchWithStops(newStops);
    if (ok) {
      setExtraStops(newStops);
      return;
    }
    setStopInput(added);
    setAddStopOpen(true);
  };

  const handleRemoveStop = async (idx: number) => {
    if (stopLoading) return;
    const newStops = extraStopsRef.current.filter((_, i) => i !== idx);
    const ok = await refetchWithStops(newStops);
    if (ok) setExtraStops(newStops);
  };

  const applyRestrictedOption = (option: RestrictedRouteOption) => {
    setActiveStyle(option.styleId);
    setActiveVariation(option.variation);
    setRoute({
      ...option.route,
      destination,
      isLoop: !destination,
      extraStops: extraStopsRef.current,
    });
    setRoutesByVariation(prev => ({
      ...prev,
      [option.variation]: {
        ...option.route,
        extraStops: extraStopsRef.current,
      },
    }));
    setVariants(prev => {
      if (prev.some(v => v.variation === option.variation)) {
        return prev.map(v =>
          v.variation === option.variation ? option.variant : v,
        );
      }
      return [option.variant, ...prev];
    });
    setRestrictedAlertOpen(false);
  };

  const resumeActiveRide = () => {
    if (!session) return;
    navigation.navigate('Navigate', navigateParamsFromSession(session));
  };

  const goToNavigate = (
    napStarted: boolean,
    initialEndsAt?: number,
    ride: RouteResult = routeRef.current,
  ) => {
    navigation.navigate('Navigate', {
      route: ride,
      durationMinutes,
      destinationLabel,
      destination,
      plannedOrigin,
      activeStyle,
      napStarted,
      initialEndsAt,
      initialTotalSeconds: napStarted ? durationMinutes * 60 : undefined,
    });
  };

  const startNapNow = async () => {
    const ride = routeRef.current;
    if (!ride.origin) {
      showAlert({
        title: 'Location needed',
        message: 'Could not read your start point for the nap.',
        tone: 'warning',
      });
      return;
    }

    setStartingNap(true);
    try {
      const endsAt = Date.now() + durationMinutes * 60 * 1000;
      await persist({
        route: ride,
        destinationLabel,
        destination,
        plannedOrigin,
        activeStyle,
        mapsOpened: true,
        plannedMinutes: durationMinutes,
        totalSeconds: durationMinutes * 60,
        endsAt,
        running: true,
        secondsLeft: durationMinutes * 60,
        savedAt: Date.now(),
      });
      await armNapAlerts({
        endsAt,
        alertAtMinutes: settings.notifyAtMinutes,
        enabled: settings.notificationsEnabled,
      });
      goToNavigate(true, endsAt, ride);
    } catch {
      showAlert({
        title: 'Could not start nap',
        message:
          'Something went wrong saving this ride. Please try Begin Nap again.',
        tone: 'warning',
      });
    } finally {
      setStartingNap(false);
    }
  };

  const beginNap = async () => {
    if (stopLoading || startingNap || checkingLocation || !hasChosenRoute) {
      return;
    }
    if (session) {
      resumeActiveRide();
      return;
    }
    if (!route.origin) {
      showAlert({
        title: 'Location needed',
        message: 'Could not read your start point for the nap.',
        tone: 'warning',
      });
      return;
    }

    setCheckingLocation(true);
    try {
      const here = await fetchCurrentPosition();
      if (distanceMeters(here, route.origin) > ORIGIN_MOVED_METERS) {
        showAlert({
          title: "Looks like you've moved",
          message:
            'This route was planned from a different spot. We can find a nap route from where you are now, or you can keep the one you already picked.',
          tone: 'warning',
          buttons: [
            {
              label: 'Keep this route',
              variant: 'ghost',
              onPress: () => {
                void startNapNow();
              },
            },
            {
              label: 'Find a new route',
              variant: 'gold',
              onPress: () => {
                void findRouteFromNewLocation(here);
              },
            },
          ],
        });
        return;
      }
    } catch {
      // GPS failed — continue with the planned start so Begin Nap still works.
    } finally {
      setCheckingLocation(false);
    }

    await startNapNow();
  };

  const sortedVariants = variants;

  return (
    <GradientBackground style={styles.flex}>
      <View style={[styles.flex, { paddingTop: insets.top + 8 }]}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            accessibilityLabel="Back to planning">
            <Text style={styles.backArrow}>←</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.topTitle}>
              {hasChosenRoute
                ? `${meta.emoji} ${meta.label} route`
                : 'Choose a nap route'}
            </Text>
            <Text style={styles.topSub}>
              {hasChosenRoute
                ? `${route.durationText} ${route.isLoop ? 'loop' : 'drive'} · via ${route.summary || 'local roads'
                }`
                : 'Empty map · pick a safer loop'}
            </Text>
          </View>
          <View style={styles.durationPill}>
            <Text style={styles.durationPillText}>
              {hasChosenRoute
                ? `${Math.round(route.durationSeconds / 60)} min`
                : '—'}
            </Text>
          </View>
        </View>

        {/* Map */}
        <View style={styles.mapSection}>
          <View style={styles.mapFrame}>
            <NapMap
              height={320}
              origin={originForMap}
              route={hasChosenRoute ? route : null}
              destination={
                hasChosenRoute && endPin && !sameCoord(originForMap, endPin)
                  ? endPin
                  : null
              }
              loading={routeLoading}
              error={null}
            />
          </View>

          {navActive && currentNavStep && (
            <View style={styles.navPanel}>
              <View style={styles.navHeader}>
                <View style={styles.navIcon}>
                  <Text style={{ fontSize: 22 }}>{dirIcon(currentNavStep.instruction)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.navInstruction}>{currentNavStep.instruction}</Text>
                  <Text style={styles.navMeta}>
                    {currentNavStep.distance} · {currentNavStep.duration}
                  </Text>
                </View>
                <Pressable onPress={() => setNavExpanded(v => !v)} style={styles.navSmallBtn}>
                  <Text style={{ color: colors.onPrimary }}>{navExpanded ? '▾' : '▴'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setNavActive(false);
                    setNavStep(0);
                  }}
                  style={styles.navSmallBtn}>
                  <Text style={{ color: colors.onPrimary, fontWeight: '700' }}>✕</Text>
                </Pressable>
              </View>
              {navExpanded && (
                <ScrollView style={{ maxHeight: 160 }}>
                  {allNavSteps.map((step, i) => (
                    <Pressable
                      key={i}
                      onPress={() => setNavStep(i)}
                      style={[
                        styles.stepRow,
                        i === safeNavStep && styles.stepRowActive,
                      ]}>
                      <Text style={{ width: 22, textAlign: 'center' }}>
                        {dirIcon(step.instruction)}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.stepText,
                            i === safeNavStep && { fontWeight: '700' },
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
                  style={[styles.navCtrlBtn, safeNavStep === 0 && { opacity: 0.4 }]}>
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
                    safeNavStep === allNavSteps.length - 1 && { opacity: 0.4 },
                  ]}>
                  <Text
                    style={[
                      styles.navCtrlText,
                      { color: colors.onPrimary },
                    ]}>
                    Next →
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* Bottom tray */}
        <ScrollView
          style={styles.tray}
          contentContainerStyle={{ paddingBottom: insets.bottom + 28, gap: 12 }}
          showsVerticalScrollIndicator={false}>
          {routeError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠️ {routeError}</Text>
              <Pressable onPress={() => setRouteError(null)}>
                <Text style={{ color: colors.lavenderSoft, fontSize: 16 }}>×</Text>
              </Pressable>
            </View>
          )}

          {session ? (
            <ActiveRideBanner
              session={session}
              onResume={resumeActiveRide}
            />
          ) : null}

          <Pressable
            onPress={beginNap}
            disabled={
              stopLoading ||
              startingNap ||
              checkingLocation ||
              !hasChosenRoute ||
              rideBlocksNewStart
            }
            style={[
              styles.navCta,
              (stopLoading ||
                startingNap ||
                checkingLocation ||
                !hasChosenRoute ||
                rideBlocksNewStart) && { opacity: 0.7 },
              { backgroundColor: colors.gold },
            ]}>
            <Text style={[styles.navCtaText, { color: colors.ink }]}>
              {checkingLocation
                ? 'Checking location…'
                : startingNap
                  ? 'Starting navigation…'
                  : rideBlocksNewStart
                  ? 'End current nap to start a new one'
                  : activeRideIsThisRoute
                    ? 'Resume nap'
                    : hasChosenRoute
                      ? 'Begin Nap'
                      : 'Choose a route first'}
            </Text>
          </Pressable>

          <View>
            <View style={styles.suggestionsHeader}>
              <View>
                <Text style={styles.sectionLabel}>Alternate Route Suggestions</Text>
                <Text style={styles.suggestionsSub}>
                  {meta.label} {route.isLoop || !destination ? 'loops' : 'routes'} ranked
                  for your {durationMinutes} min nap
                </Text>
              </View>
              <Pressable
                onPress={handleRefreshSuggestions}
                disabled={refreshing || routeLoading || stopLoading || !!session}
                style={[
                  styles.refreshBtn,
                  (refreshing || routeLoading || session) && { opacity: 0.55 },
                ]}>
                <Text style={styles.refreshBtnText}>
                  {refreshing ? 'Refreshing…' : '↻ Refresh'}
                </Text>
              </Pressable>
            </View>

            <View style={{ gap: 8 }}>
              {sortedVariants.map((v, index) => {
                const isActive =
                  v.id === activeStyle && v.variation === activeVariation;
                const match = napMatchLabel(v.napMatchScore, {
                  good: colors.success,
                  ok: colors.success,
                  close: colors.warning,
                  bad: colors.danger,
                });
                return (
                  <Pressable
                    key={`${v.id}-${v.variation}-${refreshIndex}`}
                    onPress={() => handleSelectRouteVariant(v)}
                    style={[
                      styles.suggestionCard,
                      isActive && styles.suggestionCardActive,
                      (session || busy) && { opacity: 0.55 },
                    ]}>
                    <View style={styles.suggestionRank}>
                      <Text style={styles.suggestionRankText}>{index + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.styleChipTitle, isActive && { color: colors.ink }]}>
                        {v.emoji} {v.label}
                        {isActive ? ' · selected' : ''}
                      </Text>
                      <Text style={[styles.styleChipDur, isActive && { color: colors.ink }]}>
                        {v.durationText}
                        {v.summary ? ` · via ${v.summary}` : ''}
                      </Text>
                      <Text style={[styles.styleChipMatch, { color: match.color }]}>
                        {match.text} · {v.napMatchScore}% nap match
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              {sortedVariants.length === 0 && restrictedOptions.length > 0 && (
                <Pressable
                  onPress={() => setRestrictedAlertOpen(true)}
                  style={styles.suggestionCard}>
                  <Text style={styles.styleChipTitle}>
                    View less-restricted routes
                  </Text>
                  <Text style={styles.styleChipDur}>
                    {restrictedOptions.length} option
                    {restrictedOptions.length === 1 ? '' : 's'} still near
                    restricted areas or active incidents
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={styles.secondaryRow}>
            {allNavSteps.length > 0 && (
              <Pressable
                onPress={() => setNavActive(true)}
                style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>Preview directions</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => setAddStopOpen(v => !v)}
              style={[
                styles.secondaryBtn,
                extraStops.length > 0 && styles.secondaryBtnGold,
              ]}>
              <Text style={styles.secondaryBtnText}>
                {extraStops.length > 0
                  ? `${extraStops.length} stop${extraStops.length > 1 ? 's' : ''}`
                  : 'Add a stop'}
              </Text>
            </Pressable>
          </View>

          {addStopOpen && (
            <View style={styles.stopPanel}>
              <Text style={styles.stopTitle}>Add a stop</Text>
              <PlacesAutocomplete
                value={stopInput}
                onChange={setStopInput}
                onSelect={setStopInput}
                placeholder="Search address or place…"
                icon="📍"
                autoFocus
                savedSuggestions={savedPlaces}
                biasLocation={route.origin}
              />
              {extraStops.map((stop, i) => (
                <View key={i} style={styles.stopChip}>
                  <Text style={styles.stopChipText} numberOfLines={1}>
                    📍 {stop}
                  </Text>
                  <Pressable onPress={() => handleRemoveStop(i)}>
                    <Text style={{ color: colors.lavenderSoft }}>×</Text>
                  </Pressable>
                </View>
              ))}
              <View style={styles.stopActions}>
                <Pressable
                  onPress={() => {
                    setAddStopOpen(false);
                    setStopInput('');
                  }}
                  style={styles.stopCancel}>
                  <Text style={styles.stopCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleAddStop}
                  disabled={!stopInput.trim() || stopLoading}
                  style={[
                    styles.stopAdd,
                    (!stopInput.trim() || stopLoading) && { opacity: 0.4 },
                  ]}>
                  <Text style={styles.stopAddText}>
                    {stopLoading ? '…' : 'Add'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {extraStops.length > 0 && !addStopOpen &&
            extraStops.map((stop, i) => (
              <View key={i} style={styles.persistentStop}>
                <Text style={styles.stopChipText} numberOfLines={1}>
                  📍 {stop}
                </Text>
                <Pressable
                  onPress={() => handleRemoveStop(i)}
                  disabled={stopLoading}>
                  <Text style={{ color: colors.lavenderSoft, fontSize: 15 }}>×</Text>
                </Pressable>
              </View>
            ))}

          {/* {timerVisible ? (
            <NapTimer
              durationMinutes={durationMinutes}
              alertAtMinutes={settings.notifyAtMinutes}
              alertsEnabled={settings.notificationsEnabled}
              onDismiss={() => setTimerVisible(false)}
            />
          ) : (
            <Pressable
              onPress={() => setTimerVisible(true)}
              style={styles.showTimerBtn}>
              <Text style={styles.showTimerText}>
                ⏱ Show nap timer · {durationMinutes} min
              </Text>
            </Pressable>
          )} */}

          {/* Phase - 2  <SpotifyCard durationMinutes={durationMinutes} /> */}

          {/* <Pressable
            onPress={() => navigation.navigate('MainTabs', { screen: 'Home' })}
            style={styles.newRouteBtn}>
            <Text style={styles.newRouteText}>← Plan a new route</Text>
          </Pressable> */}
        </ScrollView>
      </View>
      <RestrictedRoutesAlert
        visible={restrictedAlertOpen}
        options={restrictedOptions}
        onSelect={applyRestrictedOption}
        onDismiss={() => setRestrictedAlertOpen(false)}
      />
    </GradientBackground>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    flex: { flex: 1 },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 10,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backArrow: { fontSize: 18, color: colors.purple, fontWeight: '700', bottom: 3 },
    topTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.purple,
    },
    topSub: { fontSize: 11, color: colors.purpleMuted, marginTop: 1 },
    durationPill: {
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    durationPillText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.purple,
    },
    mapSection: {
      paddingHorizontal: 16,
      marginBottom: 8,
      position: 'relative',
    },
    mapFrame: {
      borderRadius: 24,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    navPanel: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: 8,
      borderRadius: 20,
      backgroundColor: colors.surfaceGlassStrong,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOpacity: 0.25,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
    },
    navHeader: {
      backgroundColor: colors.primary,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    navIcon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: colors.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navInstruction: {
      color: colors.onPrimary,
      fontWeight: '700',
      fontSize: 15,
    },
    navMeta: {
      color: colors.onPrimary,
      fontSize: 12,
      marginTop: 3,
    },
    navSmallBtn: {
      backgroundColor: 'rgba(255,255,255,0.18)',
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderLeftWidth: 3,
      borderLeftColor: 'transparent',
    },
    stepRowActive: {
      backgroundColor: colors.lavenderWash,
      borderLeftColor: colors.primary,
    },
    stepText: { fontSize: 13, color: colors.purple },
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
    navCtrlText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.purple,
    },
    navCount: { fontSize: 11, color: colors.lavenderSoft },
    tray: {
      flex: 1,
      paddingHorizontal: 16,
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surfaceGlass,
      borderRadius: 16,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.lavenderBorder,
    },
    errorText: { flex: 1, fontSize: 12, color: colors.purple },
    navCta: {
      backgroundColor: colors.ink,
      borderRadius: 25,
      paddingVertical: 15,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.gold,
      shadowOpacity: 0.5,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 10,
    },
    navCtaText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '800',
      textAlign: 'center',
    },
    sectionLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.lavenderSoft,
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    suggestionsHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 10,
      gap: 12,
    },
    suggestionsSub: {
      fontSize: 11,
      color: colors.purpleMuted,
      marginTop: 2,
    },
    refreshBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.surfaceGlass,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    refreshBtnText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.purple,
    },
    suggestionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 16,
      backgroundColor: colors.surfaceGlass,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    suggestionCardActive: {
      backgroundColor: 'rgba(244,200,66,0.92)',
      borderColor: colors.gold,
      borderWidth: 2,
    },
    suggestionRank: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: 'rgba(45,27,105,0.1)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    suggestionRankText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.purple,
    },
    styleChipTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.purple,
    },
    styleChipDur: { fontSize: 11, color: colors.purpleMuted, marginTop: 2 },
    styleChipMatch: { fontSize: 10, fontWeight: '600', marginTop: 2 },
    secondaryRow: { flexDirection: 'row', gap: 8 },
    secondaryBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 14,
      backgroundColor: colors.surfaceGlass,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      alignItems: 'center',
    },
    secondaryBtnGold: {
      backgroundColor: 'rgba(244,200,66,0.15)',
      borderColor: 'rgba(244,200,66,0.6)',
    },
    secondaryBtnText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.purple,
    },
    stopPanel: {
      backgroundColor: colors.surfaceGlassStrong,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      gap: 8,
    },
    stopTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.purple,
    },
    stopChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 8,
      backgroundColor: colors.inputBg,
    },
    stopChipText: { flex: 1, fontSize: 11, color: colors.purple },
    stopActions: { flexDirection: 'row', gap: 6 },
    stopCancel: {
      flex: 1,
      padding: 8,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      alignItems: 'center',
    },
    stopCancelText: {
      color: colors.purpleMuted,
      fontWeight: '700',
      fontSize: 12,
    },
    stopAdd: {
      flex: 1,
      padding: 8,
      borderRadius: 10,
      backgroundColor: colors.primary,
      alignItems: 'center',
    },
    stopAddText: { color: colors.onPrimary, fontWeight: '700', fontSize: 12 },
    persistentStop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
      backgroundColor: 'rgba(244,200,66,0.12)',
      borderWidth: 1.5,
      borderColor: 'rgba(244,200,66,0.4)',
    },
    showTimerBtn: {
      padding: 12,
      borderRadius: 16,
      backgroundColor: colors.surfaceGlass,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    showTimerText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.purple,
    },
    newRouteBtn: {
      padding: 14,
      borderRadius: 16,
      backgroundColor: colors.lavenderBorder,
      borderWidth: 1.5,
      borderColor: colors.error,
      alignItems: 'center',
    },
    newRouteText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.purple,
    },
  });
}
