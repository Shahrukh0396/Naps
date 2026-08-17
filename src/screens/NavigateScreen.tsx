import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NapMap from '../components/NapMap';
import NapTimer from '../components/NapTimer';
import { ROUTE_TYPE_META } from '../constants/content';
import { useNapSettings } from '../context/SettingsContext';
import type { NavigateScreenProps } from '../navigation/types';
import { findDirectRoute, findRoute, RouteError } from '../services/mapsApi';
import { buildRouteAlerts } from '../services/restrictedAreas';
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

function alertBannerText(alerts: RouteAlert[]): string {
  const military = alerts.filter(a => a.kind === 'military');
  if (military.length > 0) {
    const first = military[0].title;
    const extra = military.length - 1;
    return extra > 0
      ? `Restricted area ahead · ${first} · +${extra} more`
      : `Restricted area ahead · ${first}`;
  }
  return alerts[0]?.message || 'Route restriction advisory on this path';
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function bearingDegrees(from: LatLng, to: LatLng): number {
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
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

/** Via point ~2.5km off the restricted area, perpendicular to the drive. */
function bypassWaypointForAlerts(
  here: LatLng,
  destination: LatLng,
  alerts: RouteAlert[],
  attempt: number,
): string | null {
  const military = alerts.filter(a => a.kind === 'military');
  if (military.length === 0) return null;
  const target = military[attempt % military.length];
  const routeBearing = bearingDegrees(here, destination);
  const side = attempt % 2 === 0 ? -90 : 90;
  const bypass = offsetLatLng(
    target.coordinate,
    (routeBearing + side + 360) % 360,
    Math.max(2500, target.radiusMeters + 1500),
  );
  return formatCoord(bypass.lat, bypass.lng);
}

function countMilitaryAlerts(alerts: RouteAlert[]): number {
  return alerts.filter(a => a.kind === 'military').length;
}

export default function NavigateScreen({ navigation, route: navRoute }: NavigateScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { settings } = useNapSettings();
  const {
    route: initialRoute,
    durationMinutes: initialDuration,
    destinationLabel,
    activeStyle,
  } = navRoute.params;
  const meta = ROUTE_TYPE_META[activeStyle];

  const [route, setRoute] = useState(initialRoute);
  const [durationMinutes, setDurationMinutes] = useState(initialDuration);
  const [mapsOpened, setMapsOpened] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [headingHome, setHeadingHome] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<RouteAlert[]>([]);
  const [snappedPath, setSnappedPath] = useState<LatLng[] | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [findingAlt, setFindingAlt] = useState(false);

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

  const selectedAlert = useMemo(
    () => alerts.find(a => a.id === selectedAlertId) ?? null,
    [alerts, selectedAlertId],
  );

  useEffect(() => {
    let cancelled = false;
    setSelectedAlertId(null);

    (async () => {
      const result = await buildRouteAlerts(route.polyline, {
        routeRestrictionsPartiallyIgnored:
          route.routeRestrictionsPartiallyIgnored,
        origin: route.origin,
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
  ]);

  /** Opens Google Maps only when the user taps the Maps button. */
  const handleOpenMaps = async () => {
    try {
      await openRouteInGoogleMaps(route);
      setMapsOpened(true);
    } catch {
      Alert.alert('Could not open Google Maps');
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
        Alert.alert(
          'Could not update route',
          `${message}\n\nTimer was extended — open Maps when you have a signal if you want turn-by-turn.`,
        );
      } finally {
        recalculatingRef.current = false;
        setRecalculating(false);
      }
    },
    [activeStyle, destinationLabel, initialRoute],
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
      Alert.alert(
        'Could not head to destination',
        `${message}\n\nOpen Maps from the button above to navigate manually.`,
      );
    } finally {
      recalculatingRef.current = false;
      setRecalculating(false);
    }
  }, [activeStyle, destinationLabel, initialRoute]);

  const handleTakeAlternativeRoute = useCallback(async () => {
    if (recalculatingRef.current) return;
    const currentAlerts = alertsRef.current;
    if (currentAlerts.length === 0) return;

    recalculatingRef.current = true;
    setFindingAlt(true);
    setRecalculating(true);
    setRecalcError(null);
    setSelectedAlertId(null);

    const baselineMilitary = countMilitaryAlerts(currentAlerts);
    const maxAttempts = 3;

    try {
      const here = await getCurrentPosition();
      const destination = resolveEndDestination(initialRoute, destinationLabel);
      const remainingMinutes = Math.max(
        5,
        Math.ceil(secondsLeftRef.current / 60),
      );

      let best: RouteResult | null = null;
      let bestMilitary = Infinity;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        altRouteCountRef.current += 1;
        const destCoord =
          parseLatLng(destination) ??
          endPin ??
          homeOriginRef.current;
        const bypass = bypassWaypointForAlerts(
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
        const military = countMilitaryAlerts(check.alerts);

        if (military < bestMilitary) {
          bestMilitary = military;
          best = candidate;
        }
        if (military === 0) break;
      }

      if (!best) {
        throw new RouteError('Could not find an alternate route.');
      }

      setRoute(best);

      if (bestMilitary > 0 && bestMilitary >= baselineMilitary) {
        Alert.alert(
          'Still near a restricted area',
          'Tried alternate paths, but a restricted area may still be nearby. You can tap Alt route again or open Maps to navigate around it.',
        );
      }
    } catch (err) {
      const message =
        err instanceof RouteError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not build an alternate route.';
      setRecalcError(message);
      Alert.alert('Could not find alternate route', message);
    } finally {
      recalculatingRef.current = false;
      setFindingAlt(false);
      setRecalculating(false);
    }
  }, [activeStyle, destinationLabel, endPin, initialRoute]);

  const handleAlertPress = useCallback((alert: RouteAlert) => {
    setSelectedAlertId(prev => (prev === alert.id ? null : alert.id));
  }, []);

  const handleSecondsLeftChange = useCallback((secondsLeft: number) => {
    secondsLeftRef.current = secondsLeft;
  }, []);

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
        error={recalcError}
        alerts={alerts}
        snappedPath={snappedPath}
        selectedAlertId={selectedAlertId}
        onAlertPress={handleAlertPress}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityLabel="End navigation">
          <Text style={styles.backText}>← End</Text>
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
        <Pressable onPress={handleOpenMaps} style={styles.mapsBtn}>
          <Text style={styles.mapsBtnText}>{mapsOpened ? 'Maps' : 'Open'}</Text>
        </Pressable>
      </View>

      {selectedAlert && (
        <View style={[styles.callout, { top: insets.top + 64 }]}>
          <Text style={styles.calloutTitle} numberOfLines={1}>
            {selectedAlert.kind === 'military'
              ? `Restricted · ${selectedAlert.title}`
              : selectedAlert.title}
          </Text>
          <Text style={styles.calloutBody} numberOfLines={2}>
            {selectedAlert.kind === 'military'
              ? 'Restricted area · stay on public roads'
              : selectedAlert.message}
          </Text>
          <View style={styles.calloutActions}>
            <Pressable
              onPress={handleTakeAlternativeRoute}
              disabled={recalculating}
              style={[
                styles.calloutAltBtn,
                recalculating && styles.calloutAltBtnDisabled,
              ]}>
              <Text style={styles.calloutAltBtnText}>
                {findingAlt ? 'Finding…' : 'Take alt route'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setSelectedAlertId(null)}
              hitSlop={8}
              style={styles.calloutDismiss}>
              <Text style={styles.calloutDismissText}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      )}

      <View style={[styles.timerOverlay, { paddingBottom: insets.bottom + 12 }]}>
        {alerts.length > 0 && (
          <View style={styles.alertBanner}>
            <Pressable
              style={styles.alertBannerMain}
              onPress={() => {
                const first =
                  alerts.find(a => a.kind === 'military') ?? alerts[0];
                setSelectedAlertId(first.id);
              }}>
              <Text style={styles.alertBannerText} numberOfLines={2}>
                {alertBannerText(alerts)}
              </Text>
            </Pressable>
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
        <View style={styles.overlayHint}>
          <Text style={styles.overlayHintText}>
            {recalculating
              ? findingAlt
                ? 'Finding an alternate route around the restricted area…'
                : headingHome
                  ? 'Nap over — removing remaining stops and routing straight…'
                  : 'Recalculating nap route for the extended time…'
              : headingHome
                ? 'Nap over · route updated straight to your destination — tap Open for Google Maps'
                : 'Nap timer is running here · tap Open anytime for Google Maps turn-by-turn'}
          </Text>
        </View>
        <NapTimer
          variant="overlay"
          autoStart
          durationMinutes={initialDuration}
          alertAtMinutes={settings.notifyAtMinutes}
          alertsEnabled={settings.notificationsEnabled}
          onDismiss={() => navigation.goBack()}
          onExtend={handleExtend}
          onComplete={handleTimerComplete}
          onSecondsLeftChange={handleSecondsLeftChange}
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
  mapsBtn: {
    backgroundColor: colors.gold,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  mapsBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.ink,
  },
  callout: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: colors.overlay,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: colors.dangerSoft,
    gap: 2,
  },
  calloutTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.danger,
  },
  calloutBody: {
    fontSize: 11,
    color: colors.purpleMuted,
  },
  calloutActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 10,
  },
  calloutAltBtn: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  calloutAltBtnDisabled: {
    opacity: 0.55,
  },
  calloutAltBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.onPrimary,
  },
  calloutDismiss: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  calloutDismissText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.purple,
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
  });
}
