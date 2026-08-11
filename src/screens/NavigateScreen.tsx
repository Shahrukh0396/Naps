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
import type { RouteResult } from '../types/route';
import { colors } from '../theme/colors';
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

export default function NavigateScreen({ navigation, route: navRoute }: NavigateScreenProps) {
  const insets = useSafeAreaInsets();
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

  const homeOriginRef = useRef(initialRoute.origin);
  const extendCountRef = useRef(0);
  const recalculatingRef = useRef(false);
  const headedHomeRef = useRef(false);

  const endPin = useMemo(() => {
    if (route.isLoop) return homeOriginRef.current;
    const fromDest = parseLatLng(route.destination ?? null);
    if (fromDest) return fromDest;
    const lastLeg = route.legs[route.legs.length - 1];
    const lastStep = lastLeg?.steps[lastLeg.steps.length - 1];
    return lastStep?.endLocation ?? null;
  }, [route]);

  const openMapsForRoute = useCallback(async (next: RouteResult) => {
    try {
      await openRouteInGoogleMaps(next);
      setMapsOpened(true);
    } catch {
      // In-app map still updates; Maps open is best-effort.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await openRouteInGoogleMaps(initialRoute);
        if (!cancelled) setMapsOpened(true);
      } catch {
        if (!cancelled) {
          Alert.alert(
            'Could not open Google Maps',
            'Stay here for the map and nap timer, or try again.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only auto-open on first mount with the planned route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReopenMaps = async () => {
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
        await openMapsForRoute(patched);
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
          `${message}\n\nTimer was extended — try Maps again when you have a signal.`,
        );
      } finally {
        recalculatingRef.current = false;
        setRecalculating(false);
      }
    },
    [activeStyle, destinationLabel, initialRoute, openMapsForRoute],
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
      await openMapsForRoute(straight);
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
        `${message}\n\nOpen Maps and navigate to your destination manually.`,
      );
    } finally {
      recalculatingRef.current = false;
      setRecalculating(false);
    }
  }, [activeStyle, destinationLabel, initialRoute, openMapsForRoute]);

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
              ? headingHome
                ? 'Clearing stops · routing straight…'
                : `Updating for ${durationMinutes} min nap…`
              : headingHome
                ? `Straight to ${destinationLabel || (initialRoute.isLoop ? 'home' : 'destination')}`
                : route.isLoop
                  ? 'Loop back to start'
                  : `To ${destinationLabel || 'your destination'}`}
          </Text>
        </View>
        <Pressable onPress={handleReopenMaps} style={styles.mapsBtn}>
          <Text style={styles.mapsBtnText}>{mapsOpened ? 'Maps' : 'Open'}</Text>
        </Pressable>
      </View>

      <View style={[styles.timerOverlay, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.overlayHint}>
          <Text style={styles.overlayHintText}>
            {recalculating
              ? headingHome
                ? 'Nap over — removing remaining stops and routing straight…'
                : 'Recalculating nap route for the extended time…'
              : headingHome
                ? 'Nap over · Google Maps is taking you straight to your destination'
                : 'Google Maps has your nap route · timer stays here — switch back anytime'}
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
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#dce3ea',
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
    backgroundColor: 'rgba(255,248,240,0.96)',
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
    backgroundColor: 'rgba(255,248,240,0.92)',
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
    color: colors.purple,
  },
  timerOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    gap: 8,
  },
  overlayHint: {
    alignSelf: 'center',
    backgroundColor: 'rgba(45,27,105,0.78)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  overlayHintText: {
    color: colors.cream,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
});
