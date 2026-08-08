import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  type Region,
} from 'react-native-maps';
import type { RouteResult } from '../types/route';
import { colors } from '../theme/colors';
import { decodePolyline } from '../utils/polyline';

interface NapMapProps {
  origin: { lat: number; lng: number } | null;
  route: RouteResult | null;
  loading?: boolean;
  error?: string | null;
  height?: number;
}

export default function NapMap({
  origin,
  route,
  loading = false,
  error = null,
  height = 240,
}: NapMapProps) {
  const mapRef = useRef<MapView>(null);
  const path = useMemo(
    () => (route?.polyline ? decodePolyline(route.polyline) : []),
    [route?.polyline],
  );

  const center = route?.origin ?? origin ?? { lat: 37.7749, lng: -122.4194 };
  const initialRegion: Region = {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  };

  useEffect(() => {
    if (!mapRef.current || path.length < 2) return;
    mapRef.current.fitToCoordinates(
      path.map(p => ({ latitude: p.lat, longitude: p.lng })),
      {
        edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
        animated: true,
      },
    );
  }, [path]);

  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        mapType="standard"
        // Android Google Maps styling is limited; keep default roadmap.
        customMapStyle={Platform.OS === 'android' ? mapStyles : undefined}>
        {origin && (
          <Marker
            coordinate={{ latitude: origin.lat, longitude: origin.lng }}
            title="Start"
            pinColor={colors.purple}
          />
        )}
        {route?.waypoint && (
          <Marker
            coordinate={{
              latitude: route.waypoint.lat,
              longitude: route.waypoint.lng,
            }}
            title="Turnaround"
            pinColor={colors.gold}
          />
        )}
        {path.length > 1 && (
          <Polyline
            coordinates={path.map(p => ({
              latitude: p.lat,
              longitude: p.lng,
            }))}
            strokeColor={colors.gold}
            strokeWidth={5}
          />
        )}
      </MapView>

      {loading && (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.purple} />
          <Text style={styles.overlayText}>Finding your route…</Text>
        </View>
      )}

      {!!error && !loading && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>{error}</Text>
        </View>
      )}

      {route && !loading && (
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

const mapStyles = [
  { elementType: 'geometry', stylers: [{ color: '#f0ecff' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6B5A9E' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c8dff0' }] },
  { featureType: 'park', elementType: 'geometry', stylers: [{ color: '#d4edda' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#e8e0ff',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(240,236,255,0.75)',
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
    backgroundColor: 'rgba(255,248,240,0.92)',
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
