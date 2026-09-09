import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  MapColorScheme,
  MapView,
  NavigationNightMode,
  NavigationUIEnabledPreference,
  NavigationView,
  type MapViewController,
  type NavigationViewController,
} from '@googlemaps/react-native-navigation-sdk';
import { GOOGLE_MAPS_API_KEY } from '../config/maps';
import type { LatLng as RouteLatLng, RouteResult } from '../types/route';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';
import { decodePolyline } from '../utils/polyline';

const PREVIEW_DELTA = 0.004;
const PREVIEW_WITH_END_DELTA = 0.03;
const ROUTE_DELTA = 0.08;

type LatLng = { lat: number; lng: number };
type MapViewMode = 'map' | 'street';

interface NapMapProps {
  origin: LatLng | null;
  route: RouteResult | null;
  destination?: LatLng | null;
  loading?: boolean;
  error?: string | null;
  height?: number | '100%';
  loadingLabel?: string;
  preview?: boolean;
  selectable?: boolean;
  onSelectCoordinate?: (coord: LatLng) => void;
  showsUserLocation?: boolean;
  followUser?: boolean;
  fullBleed?: boolean;
  snappedPath?: RouteLatLng[] | null;
  navigation?: boolean;
  liveLocation?: { lat: number; lng: number; heading?: number } | null;
}

async function fetchStreetViewUrl(
  lat: number,
  lng: number,
): Promise<string | null> {
  const key = GOOGLE_MAPS_API_KEY;
  const metaRes = await fetch(
    `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&radius=120&key=${key}`,
  );
  const meta = (await metaRes.json()) as { status: string };
  if (meta.status !== 'OK') return null;
  return `https://maps.googleapis.com/maps/api/streetview?size=800x400&location=${lat},${lng}&fov=80&pitch=0&radius=120&key=${key}`;
}

function deltaToZoom(delta: number): number {
  if (delta <= 0.004) return 16.5;
  if (delta <= 0.03) return 13.5;
  if (delta <= 0.08) return 12;
  return 11;
}

function cameraForPoints(
  points: LatLng[],
  fallback: LatLng,
  fallbackDelta: number,
): { target: LatLng; zoom: number } {
  if (points.length === 0) {
    return { target: fallback, zoom: deltaToZoom(fallbackDelta) };
  }
  if (points.length === 1) {
    return { target: points[0], zoom: deltaToZoom(fallbackDelta) };
  }
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return {
    target: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
    zoom: deltaToZoom(Math.max(maxLat - minLat, maxLng - minLng) * 1.35),
  };
}

export default function NapMap({
  origin,
  route,
  destination = null,
  loading = false,
  error = null,
  height = 240,
  loadingLabel = 'Updating map…',
  preview,
  selectable = false,
  onSelectCoordinate,
  showsUserLocation = false,
  followUser: _followUser = false,
  fullBleed = false,
  snappedPath = null,
  navigation = false,
  liveLocation = null,
}: NapMapProps) {
  const { colors, mapStyle, navMapStyle, darkMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const mapRef = useRef<MapViewController | null>(null);
  const navViewRef = useRef<NavigationViewController | null>(null);
  const isPreview = preview ?? (!route && !!origin);
  const [viewMode, setViewMode] = useState<MapViewMode>('map');
  const [streetUrl, setStreetUrl] = useState<string | null>(null);
  const [streetStatus, setStreetStatus] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable'
  >('idle');
  const [mapReady, setMapReady] = useState(false);
  const navMode = navigation && fullBleed;

  const path = useMemo(() => {
    if (snappedPath && snappedPath.length >= 2) return snappedPath;
    return route?.polyline ? decodePolyline(route.polyline) : [];
  }, [route?.polyline, snappedPath]);

  const center =
    liveLocation ??
    (showsUserLocation && path[0] ? path[0] : null) ??
    route?.origin ??
    origin ??
    { lat: 37.7749, lng: -122.4194 };
  const delta =
    isPreview && destination
      ? PREVIEW_WITH_END_DELTA
      : isPreview
        ? PREVIEW_DELTA
        : ROUTE_DELTA;

  const initialCamera = useMemo(() => {
    const points: LatLng[] = [...path];
    if (origin && !showsUserLocation && !liveLocation) points.push(origin);
    if (destination) points.push(destination);
    const cam = cameraForPoints(points, center, delta);
    return {
      target: cam.target,
      zoom: cam.zoom,
      tilt: navMode ? 45 : 0,
      bearing: liveLocation?.heading ?? 0,
    };
  }, [
    center,
    delta,
    destination,
    liveLocation,
    navMode,
    origin,
    path,
    showsUserLocation,
  ]);

  const androidStyling = useMemo(
    () => ({
      primaryDayModeThemeColor: '#2D1B69',
      secondaryDayModeThemeColor: '#F4C842',
      primaryNightModeThemeColor: '#2D1B69',
      secondaryNightModeThemeColor: '#F4C842',
      headerInstructionsTextColor: darkMode ? '#FFF8F0' : '#2D1B69',
      headerDistanceValueTextColor: darkMode ? '#FFF8F0' : '#2D1B69',
    }),
    [darkMode],
  );

  const iosStyling = useMemo(
    () => ({
      navigationHeaderPrimaryBackgroundColor: '#2D1B69',
      navigationHeaderSecondaryBackgroundColor: '#F4C842',
      navigationHeaderPrimaryBackgroundColorNightMode: '#2D1B69',
      navigationHeaderSecondaryBackgroundColorNightMode: '#F4C842',
      navigationHeaderInstructionsTextColor: darkMode ? '#FFF8F0' : '#FFF8F0',
      navigationHeaderDistanceValueTextColor: '#F4C842',
    }),
    [darkMode],
  );

  const syncOverlays = useCallback(async () => {
    const map = mapRef.current;
    if (!map || navMode) return;
    try {
      map.clearMapView();
      if (path.length >= 2) {
        await map.addPolyline({
          id: 'nap-route-glow',
          points: path,
          color: colors.routeGlow,
          width: 12,
        });
        await map.addPolyline({
          id: 'nap-route',
          points: path,
          color: colors.gold,
          width: 5,
        });
      }
      if (origin && !showsUserLocation) {
        await map.addMarker({
          id: 'nap-origin',
          position: origin,
          title: 'Start',
        });
      }
      if (destination) {
        await map.addMarker({
          id: 'nap-destination',
          position: destination,
          title: 'End',
        });
      }
      const stops =
        route?.allWaypoints ?? (route?.waypoint ? [route.waypoint] : []);
      for (let i = 0; i < stops.length; i++) {
        await map.addMarker({
          id: `nap-stop-${i}`,
          position: stops[i],
          title: i === 0 ? 'Nap stop' : `Stop ${i + 1}`,
        });
      }
      const points: LatLng[] = [...path];
      if (origin && !showsUserLocation && !liveLocation) points.push(origin);
      if (destination) points.push(destination);
      const cam = cameraForPoints(points, center, delta);
      map.moveCamera({ target: cam.target, zoom: cam.zoom });
    } catch {
      // Map controller can lag a frame behind mount.
    }
  }, [
    center,
    colors.gold,
    colors.routeGlow,
    delta,
    destination,
    navMode,
    liveLocation,
    origin,
    path,
    route?.allWaypoints,
    route?.waypoint,
    showsUserLocation,
  ]);

  useEffect(() => {
    if (!mapReady) return;
    void syncOverlays();
  }, [mapReady, syncOverlays]);

  useEffect(() => {
    if (navMode || !liveLocation || !mapRef.current) return;
    mapRef.current.moveCamera({
      target: { lat: liveLocation.lat, lng: liveLocation.lng },
      bearing: liveLocation.heading ?? 0,
      tilt: 45,
      zoom: 17,
    });
  }, [liveLocation, navMode]);

  useEffect(() => {
    if (!isPreview || !origin || selectable) {
      setStreetUrl(null);
      setStreetStatus('idle');
      setViewMode('map');
      return;
    }

    let cancelled = false;
    setStreetStatus('loading');
    setStreetUrl(null);

    fetchStreetViewUrl(origin.lat, origin.lng)
      .then(url => {
        if (cancelled) return;
        if (url) {
          setStreetUrl(url);
          setStreetStatus('ready');
        } else {
          setStreetStatus('unavailable');
          setViewMode('map');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStreetStatus('unavailable');
        setViewMode('map');
      });

    return () => {
      cancelled = true;
    };
  }, [isPreview, selectable, origin?.lat, origin?.lng]);

  const showStreet =
    isPreview && !selectable && viewMode === 'street' && streetUrl;
  const showOverlay = Boolean(loading) && !navMode;
  const overlayLabel = loadingLabel;
  const mapStyleJson = JSON.stringify(navMode ? navMapStyle : mapStyle);

  const wrapStyle = [
    styles.wrap,
    fullBleed && styles.wrapFullBleed,
    height === '100%' ? styles.wrapFlex : { height },
    Platform.OS === 'android' && styles.wrapAndroid,
  ];

  const sharedMapProps = {
    style: StyleSheet.absoluteFill,
    mapStyle: mapStyleJson,
    mapColorScheme: darkMode ? MapColorScheme.DARK : MapColorScheme.LIGHT,
    mapToolbarEnabled: false,
    myLocationButtonEnabled: false,
    myLocationEnabled: showsUserLocation,
    compassEnabled: fullBleed || navMode,
    trafficEnabled: navMode,
    buildingsEnabled: navMode,
    rotateGesturesEnabled: fullBleed || navMode,
    tiltGesturesEnabled: navMode,
    zoomGesturesEnabled: true,
    scrollGesturesEnabled: true,
    initialCameraPosition: initialCamera,
    onMapReady: () => setMapReady(true),
    onMapViewControllerCreated: (controller: MapViewController) => {
      mapRef.current = controller;
    },
    onMapClick: selectable
      ? (latLng: LatLng) => {
          onSelectCoordinate?.({ lat: latLng.lat, lng: latLng.lng });
          setViewMode('map');
        }
      : undefined,
  };

  return (
    <View style={wrapStyle} collapsable={false}>
      {showStreet ? (
        <Image
          source={{ uri: streetUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : navMode ? (
        <NavigationView
          {...sharedMapProps}
          navigationUIEnabledPreference={
            NavigationUIEnabledPreference.AUTOMATIC
          }
          navigationNightMode={
            darkMode
              ? NavigationNightMode.FORCE_NIGHT
              : NavigationNightMode.FORCE_DAY
          }
          headerEnabled
          footerEnabled={false}
          tripProgressBarEnabled={false}
          speedometerEnabled
          speedLimitIconEnabled
          recenterButtonEnabled
          reportIncidentButtonEnabled={false}
          trafficPromptsEnabled={false}
          androidStylingOptions={androidStyling}
          iOSStylingOptions={iosStyling}
          onNavigationViewControllerCreated={(
            controller: NavigationViewController,
          ) => {
            navViewRef.current = controller;
            void controller.setNavigationUIEnabled(true);
          }}
        />
      ) : (
        <MapView {...sharedMapProps} />
      )}

      {selectable && (
        <View style={styles.pickHint}>
          <Text style={styles.pickHintText}>Tap map to set end</Text>
        </View>
      )}

      {isPreview && !selectable && (
        <View style={styles.modeToggle}>
          <Pressable
            onPress={() => setViewMode('map')}
            style={[styles.modeBtn, viewMode === 'map' && styles.modeBtnActive]}>
            <Text
              style={[
                styles.modeText,
                viewMode === 'map' && styles.modeTextActive,
              ]}>
              Map
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (streetStatus === 'ready') setViewMode('street');
            }}
            disabled={streetStatus !== 'ready'}
            style={[
              styles.modeBtn,
              viewMode === 'street' && styles.modeBtnActive,
              streetStatus !== 'ready' && styles.modeBtnDisabled,
            ]}>
            <Text
              style={[
                styles.modeText,
                viewMode === 'street' && styles.modeTextActive,
                streetStatus !== 'ready' && styles.modeTextDisabled,
              ]}>
              {streetStatus === 'loading' ? 'Street…' : 'Street'}
            </Text>
          </Pressable>
        </View>
      )}

      {showOverlay && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.overlayText}>{overlayLabel}</Text>
        </View>
      )}

      {!!error && !showOverlay && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>{error}</Text>
        </View>
      )}

      {route && !showOverlay && !fullBleed && (
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeStrong}>
              {route.durationText} {route.isLoop ? 'loop' : 'drive'}
            </Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeMuted}>
              via {route.summary || 'local roads'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    wrap: {
      width: '100%',
      borderRadius: 24,
      overflow: 'hidden',
      backgroundColor: colors.mapBg,
    },
    wrapFullBleed: {
      borderRadius: 0,
      backgroundColor: colors.mapBgFull,
    },
    wrapFlex: {
      flex: 1,
    },
    wrapAndroid: {
      overflow: 'visible',
    },
    pickHint: {
      position: 'absolute',
      left: 10,
      bottom: 10,
      backgroundColor: colors.overlay,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    pickHintText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.purple,
    },
    modeToggle: {
      position: 'absolute',
      top: 10,
      right: 10,
      flexDirection: 'row',
      backgroundColor: colors.overlay,
      borderRadius: 999,
      padding: 3,
      gap: 2,
    },
    modeBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
    },
    modeBtnActive: {
      backgroundColor: colors.primary,
    },
    modeBtnDisabled: {
      opacity: 0.55,
    },
    modeText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.purple,
    },
    modeTextActive: {
      color: colors.onPrimary,
    },
    modeTextDisabled: {
      color: colors.lavenderSoft,
    },
    overlay: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 24,
    },
    overlayText: {
      fontSize: 12,
      color: colors.purpleMuted,
      textAlign: 'center',
    },
    badgeRow: {
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: 12,
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 8,
    },
    badge: {
      backgroundColor: colors.overlay,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    badgeStrong: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.purple,
    },
    badgeMuted: {
      fontSize: 11,
      color: colors.purpleMuted,
    },
  });
}
