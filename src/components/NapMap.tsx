import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  type MapPressEvent,
  type Region,
} from 'react-native-maps';
import { GOOGLE_MAPS_API_KEY } from '../config/maps';
import type { LatLng as RouteLatLng, RouteResult } from '../types/route';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';
import { decodePolyline } from '../utils/polyline';

/** Street-level preview (~few blocks). Wider when an end pin is also shown. */
const PREVIEW_DELTA = 0.004;
const PREVIEW_WITH_END_DELTA = 0.03;
const ROUTE_DELTA = 0.08;

type LatLng = { lat: number; lng: number };

interface NapMapProps {
  origin: LatLng | null;
  route: RouteResult | null;
  /** Optional end / destination pin (plan screen). */
  destination?: LatLng | null;
  loading?: boolean;
  error?: string | null;
  height?: number | '100%';
  /** Overlay copy while the map is fetching or fitting new geometry. */
  loadingLabel?: string;
  /** When true (or when showing origin with no route), zoom in tightly and offer Street View. */
  preview?: boolean;
  /** Allow tapping the map to choose a destination. */
  selectable?: boolean;
  onSelectCoordinate?: (coord: LatLng) => void;
  /** Live GPS blue dot (navigation mode). */
  showsUserLocation?: boolean;
  /** Keep the camera following the user. */
  followUser?: boolean;
  /** Full-bleed map without rounded corners / route badges. */
  fullBleed?: boolean;
  /** Roads-snapped path for smoother Navigate rendering. */
  snappedPath?: RouteLatLng[] | null;
}

type MapViewMode = 'map' | 'street';

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
  followUser = false,
  fullBleed = false,
  snappedPath = null,
}: NapMapProps) {
  const { colors, mapStyle } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const mapRef = useRef<MapView>(null);
  const isPreview = preview ?? (!route && !!origin);
  const [viewMode, setViewMode] = useState<MapViewMode>('map');
  const [streetUrl, setStreetUrl] = useState<string | null>(null);
  const [streetStatus, setStreetStatus] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable'
  >('idle');
  const [mapReady, setMapReady] = useState(false);
  const [settling, setSettling] = useState(fullBleed);
  const preciseUpdates = fullBleed;

  const path = useMemo(() => {
    if (snappedPath && snappedPath.length >= 2) return snappedPath;
    return route?.polyline ? decodePolyline(route.polyline) : [];
  }, [route?.polyline, snappedPath]);

  const center = route?.origin ?? origin ?? { lat: 37.7749, lng: -122.4194 };
  const delta =
    isPreview && destination
      ? PREVIEW_WITH_END_DELTA
      : isPreview
        ? PREVIEW_DELTA
        : ROUTE_DELTA;
  const initialRegion: Region = {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };

  const routeKey = [
    route?.polyline ?? '',
    snappedPath?.length ?? 0,
    destination?.lat ?? '',
    destination?.lng ?? '',
    origin?.lat ?? '',
    origin?.lng ?? '',
  ].join(':');

  const pathCoords = useMemo(
    () => path.map(p => ({ latitude: p.lat, longitude: p.lng })),
    [path],
  );

  const fitCamera = useCallback(() => {
    const map = mapRef.current;
    if (!map) return false;

    const pad = {
      top: fullBleed ? 100 : 48,
      right: 48,
      bottom: fullBleed ? 240 : 48,
      left: 48,
    };

    if (pathCoords.length >= 2) {
      map.fitToCoordinates(pathCoords, {
        edgePadding: pad,
        animated: false,
      });
      return true;
    }

    if (origin && destination) {
      map.fitToCoordinates(
        [
          { latitude: origin.lat, longitude: origin.lng },
          { latitude: destination.lat, longitude: destination.lng },
        ],
        { edgePadding: pad, animated: false },
      );
      return true;
    }

    if (origin) {
      map.animateToRegion(
        {
          latitude: origin.lat,
          longitude: origin.lng,
          latitudeDelta: isPreview ? PREVIEW_DELTA : ROUTE_DELTA,
          longitudeDelta: isPreview ? PREVIEW_DELTA : ROUTE_DELTA,
        },
        0,
      );
      return true;
    }

    return false;
  }, [destination, fullBleed, isPreview, origin, pathCoords]);

  useEffect(() => {
    if (!preciseUpdates) return;
    setSettling(true);
  }, [routeKey, loading, preciseUpdates]);

  useEffect(() => {
    if (preciseUpdates) {
      if (loading || !mapReady) return;
      const fitted = fitCamera();
      if (!fitted) {
        setSettling(false);
        return;
      }
      const timer = setTimeout(() => setSettling(false), 160);
      return () => clearTimeout(timer);
    }

    if (!mapRef.current) return;
    if (followUser || pathCoords.length < 2) {
      if (pathCoords.length < 2 && origin) {
        if (destination) {
          mapRef.current.fitToCoordinates(
            [
              { latitude: origin.lat, longitude: origin.lng },
              { latitude: destination.lat, longitude: destination.lng },
            ],
            {
              edgePadding: { top: 48, right: 48, bottom: 48, left: 48 },
              animated: true,
            },
          );
        } else {
          mapRef.current.animateToRegion(
            {
              latitude: origin.lat,
              longitude: origin.lng,
              latitudeDelta: PREVIEW_DELTA,
              longitudeDelta: PREVIEW_DELTA,
            },
            350,
          );
        }
      }
      return;
    }
    mapRef.current.fitToCoordinates(pathCoords, {
      edgePadding: {
        top: 40,
        right: 40,
        bottom: 40,
        left: 40,
      },
      animated: true,
    });
  }, [
    destination,
    fitCamera,
    followUser,
    loading,
    mapReady,
    origin,
    pathCoords,
    preciseUpdates,
    routeKey,
  ]);

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

  const handlePress = (e: MapPressEvent) => {
    if (!selectable || !onSelectCoordinate) return;
    const { latitude, longitude } = e.nativeEvent.coordinate;
    onSelectCoordinate({ lat: latitude, lng: longitude });
    setViewMode('map');
  };

  const showStreet =
    isPreview && !selectable && viewMode === 'street' && streetUrl;
  const showOverlay = loading || (preciseUpdates && settling);
  const overlayLabel = loadingLabel;
  const revealGeometry = !preciseUpdates || (!loading && !settling);

  const wrapStyle = [
    styles.wrap,
    fullBleed && styles.wrapFullBleed,
    height === '100%' ? styles.wrapFlex : { height },
  ];

  return (
    <View style={wrapStyle}>
      {showStreet ? (
        <Image
          source={{ uri: streetUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          initialRegion={initialRegion}
          onMapReady={() => setMapReady(true)}
          onPress={handlePress}
          showsUserLocation={showsUserLocation}
          followsUserLocation={
            followUser && (!preciseUpdates || (!loading && !settling))
          }
          showsMyLocationButton={false}
          showsCompass={fullBleed}
          toolbarEnabled={false}
          rotateEnabled={fullBleed}
          pitchEnabled={false}
          mapType="standard"
          customMapStyle={mapStyle}>
          {revealGeometry && origin && !showsUserLocation && (
            <Marker
              coordinate={{ latitude: origin.lat, longitude: origin.lng }}
              title="Start"
              pinColor={colors.purple}
            />
          )}
          {revealGeometry && destination && (
            <Marker
              coordinate={{
                latitude: destination.lat,
                longitude: destination.lng,
              }}
              title="End"
              pinColor={colors.gold}
            />
          )}
          {revealGeometry &&
            route?.allWaypoints?.map((wp, i) => (
            <Marker
              key={`wp-${i}`}
              coordinate={{ latitude: wp.lat, longitude: wp.lng }}
              title={i === 0 ? 'Nap stop' : `Stop ${i + 1}`}
              pinColor={colors.lavender}
            />
          ))}
          {revealGeometry && route?.allWaypoints == null && route?.waypoint && (
            <Marker
              coordinate={{
                latitude: route.waypoint.lat,
                longitude: route.waypoint.lng,
              }}
              title="Turnaround"
              pinColor={colors.gold}
            />
          )}
          {revealGeometry && pathCoords.length > 1 && (
            <>
              <Polyline
                coordinates={pathCoords}
                strokeColor={colors.routeGlow}
                strokeWidth={12}
                lineCap="round"
                lineJoin="round"
              />
              <Polyline
                coordinates={pathCoords}
                strokeColor={colors.gold}
                strokeWidth={5}
                lineCap="round"
                lineJoin="round"
              />
            </>
          )}
        </MapView>
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
