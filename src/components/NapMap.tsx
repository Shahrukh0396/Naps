import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  type MapPressEvent,
  type Region,
} from 'react-native-maps';
import { GOOGLE_MAPS_API_KEY } from '../config/maps';
import type { LatLng as RouteLatLng, RouteAlert, RouteResult } from '../types/route';
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
  /** Restricted-area alerts (military bases, route advisories). */
  alerts?: RouteAlert[];
  /** Roads-snapped path for smoother Navigate rendering. */
  snappedPath?: RouteLatLng[] | null;
  selectedAlertId?: string | null;
  onAlertPress?: (alert: RouteAlert) => void;
}

type MapViewMode = 'map' | 'street';

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pointNearAnyAlert(point: LatLng, alerts: RouteAlert[]): boolean {
  return alerts.some(
    alert =>
      alert.kind === 'military' &&
      haversineMeters(point, alert.coordinate) <= alert.radiusMeters,
  );
}

/** Split path into contiguous runs that fall inside military alert radii. */
function dangerSegments(path: LatLng[], alerts: RouteAlert[]): LatLng[][] {
  const military = alerts.filter(a => a.kind === 'military');
  if (path.length < 2 || military.length === 0) return [];

  const segments: LatLng[][] = [];
  let current: LatLng[] = [];

  for (const point of path) {
    if (pointNearAnyAlert(point, military)) {
      current.push(point);
    } else if (current.length > 0) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
  }
  if (current.length >= 2) segments.push(current);
  return segments;
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

export default function NapMap({
  origin,
  route,
  destination = null,
  loading = false,
  error = null,
  height = 240,
  preview,
  selectable = false,
  onSelectCoordinate,
  showsUserLocation = false,
  followUser = false,
  fullBleed = false,
  alerts = [],
  snappedPath = null,
  selectedAlertId = null,
  onAlertPress,
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

  const path = useMemo(() => {
    if (snappedPath && snappedPath.length >= 2) return snappedPath;
    return route?.polyline ? decodePolyline(route.polyline) : [];
  }, [route?.polyline, snappedPath]);

  const restrictedSegments = useMemo(
    () => dangerSegments(path, alerts),
    [path, alerts],
  );

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

  useEffect(() => {
    if (followUser || !mapRef.current || path.length < 2) return;
    mapRef.current.fitToCoordinates(
      path.map(p => ({ latitude: p.lat, longitude: p.lng })),
      {
        edgePadding: {
          top: fullBleed ? 80 : 40,
          right: 40,
          bottom: fullBleed ? 220 : 40,
          left: 40,
        },
        animated: true,
      },
    );
  }, [path, followUser, fullBleed]);

  useEffect(() => {
    if (!mapRef.current || path.length >= 2 || !origin) return;

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
      return;
    }

    mapRef.current.animateToRegion(
      {
        latitude: origin.lat,
        longitude: origin.lng,
        latitudeDelta: PREVIEW_DELTA,
        longitudeDelta: PREVIEW_DELTA,
      },
      350,
    );
  }, [origin, destination, path.length]);

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

  const wrapStyle = [
    styles.wrap,
    fullBleed && styles.wrapFullBleed,
    height === '100%' ? styles.wrapFlex : { height },
  ];

  const pathCoords = path.map(p => ({
    latitude: p.lat,
    longitude: p.lng,
  }));

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
          onPress={handlePress}
          showsUserLocation={showsUserLocation}
          followsUserLocation={followUser}
          showsMyLocationButton={false}
          showsCompass={fullBleed}
          toolbarEnabled={false}
          rotateEnabled={fullBleed}
          pitchEnabled={false}
          mapType="standard"
          customMapStyle={mapStyle}>
          {origin && !showsUserLocation && (
            <Marker
              coordinate={{ latitude: origin.lat, longitude: origin.lng }}
              title="Start"
              pinColor={colors.purple}
            />
          )}
          {destination && (
            <Marker
              coordinate={{
                latitude: destination.lat,
                longitude: destination.lng,
              }}
              title="End"
              pinColor={colors.gold}
            />
          )}
          {route?.allWaypoints?.map((wp, i) => (
            <Marker
              key={`wp-${i}`}
              coordinate={{ latitude: wp.lat, longitude: wp.lng }}
              title={i === 0 ? 'Nap stop' : `Stop ${i + 1}`}
              pinColor={colors.lavender}
            />
          ))}
          {route?.allWaypoints == null && route?.waypoint && (
            <Marker
              coordinate={{
                latitude: route.waypoint.lat,
                longitude: route.waypoint.lng,
              }}
              title="Turnaround"
              pinColor={colors.gold}
            />
          )}
          {pathCoords.length > 1 && (
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
          {restrictedSegments.map((segment, i) => (
            <Polyline
              key={`danger-${i}`}
              coordinates={segment.map(p => ({
                latitude: p.lat,
                longitude: p.lng,
              }))}
              strokeColor={colors.danger}
              strokeWidth={6}
              lineCap="round"
              lineJoin="round"
            />
          ))}
          {alerts.map(alert => {
            const selected = alert.id === selectedAlertId;
            return (
              <React.Fragment key={alert.id}>
                <Circle
                  center={{
                    latitude: alert.coordinate.lat,
                    longitude: alert.coordinate.lng,
                  }}
                  radius={
                    selected ? alert.radiusMeters * 1.15 : alert.radiusMeters
                  }
                  fillColor={
                    alert.kind === 'military'
                      ? 'rgba(155,68,68,0.22)'
                      : 'rgba(139,106,0,0.18)'
                  }
                  strokeColor={
                    alert.kind === 'military' ? colors.danger : colors.warning
                  }
                  strokeWidth={selected ? 2.5 : 1.5}
                />
                <Marker
                  coordinate={{
                    latitude: alert.coordinate.lat,
                    longitude: alert.coordinate.lng,
                  }}
                  title={
                    alert.kind === 'military'
                      ? `Restricted · ${alert.title}`
                      : alert.title
                  }
                  description={alert.message}
                  pinColor={
                    alert.kind === 'military' ? colors.dangerSoft : colors.gold
                  }
                  onPress={() => onAlertPress?.(alert)}
                />
              </React.Fragment>
            );
          })}
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

      {loading && (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.overlayText}>Finding your route…</Text>
        </View>
      )}

      {!!error && !loading && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>{error}</Text>
        </View>
      )}

      {route && !loading && !fullBleed && (
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
      backgroundColor: colors.surfaceGlass,
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
