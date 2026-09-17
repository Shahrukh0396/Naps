import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActiveRideBanner from '../components/ActiveRideBanner';
import GradientBackground from '../components/GradientBackground';
import NapMap from '../components/NapMap';
import PlacesAutocomplete from '../components/PlacesAutocomplete';
import { DURATIONS, ROUTE_TYPES } from '../constants/content';
import {
  placesWithAddress,
  type SavedPlace,
  useNapSettings,
} from '../context/SettingsContext';
import { useNapSession } from '../context/NapSessionContext';
import { useGpsLocation } from '../hooks/useGpsLocation';
import { geocodeAddress, reverseGeocode } from '../services/geocode';
import { findRouteSuggestions, RouteError } from '../services/mapsApi';
import { navigateParamsFromSession } from '../services/napSession';
import type { RouteStyleId } from '../types/route';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';
import type { PlanScreenProps } from '../navigation/types';

function savedPlaceChipIcon(kind: SavedPlace['kind']): string {
  if (kind === 'home') return '🏠';
  if (kind === 'work') return '🏢';
  return '📌';
}

type EndMode = 'current' | 'search' | 'map';
type LatLng = { lat: number; lng: number };

const END_OPTIONS: Array<{ id: EndMode; label: string }> = [
  { id: 'current', label: 'Current' },
  { id: 'search', label: 'Search' },
  { id: 'map', label: 'Map' },
];

export default function PlanScreen({ navigation }: PlanScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { settings } = useNapSettings();
  const { session, refresh: refreshSession } = useNapSession();
  const {
    location: gpsLocation,
    status: gpsStatus,
    errorMsg: gpsErrorMsg,
    detect: detectGps,
  } = useGpsLocation();

  const [selectedDuration, setSelectedDuration] = useState(settings.defaultDuration || 30);
  const [useCustom, setUseCustom] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('');
  const [endMode, setEndMode] = useState<EndMode>('current');
  const [endQuery, setEndQuery] = useState('');
  const [endLocation, setEndLocation] = useState<LatLng | null>(null);
  const [endLabel, setEndLabel] = useState<string | null>(null);
  const [pendingEnd, setPendingEnd] = useState<{
    location: LatLng;
    label: string | null;
  } | null>(null);
  const [endResolving, setEndResolving] = useState(false);
  const [activeRoute, setActiveRoute] = useState<RouteStyleId>(
    settings.defaultRouteType || 'highway',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingMapPickId = useRef(0);

  const savedPlaces = useMemo(
    () => placesWithAddress(settings.savedPlaces),
    [settings.savedPlaces],
  );

  useEffect(() => {
    detectGps();
  }, [detectGps]);

  useFocusEffect(
    useCallback(() => {
      void refreshSession();
    }, [refreshSession]),
  );

  useEffect(() => {
    setSelectedDuration(settings.defaultDuration || 30);
    setActiveRoute(settings.defaultRouteType || 'highway');
  }, [settings.defaultDuration, settings.defaultRouteType]);

  const applySavedPlace = async (place: SavedPlace) => {
    setEndQuery(place.address);
    setPendingEnd(null);
    setEndResolving(true);
    setError(null);
    try {
      const result = await geocodeAddress(place.address);
      if (!result) {
        setEndLocation(null);
        setEndLabel(null);
        setError('Could not find that address. Try another search.');
        return;
      }
      setEndLocation(result.location);
      setEndLabel(place.label);
    } catch {
      setError('Could not look up that address. Try again.');
    } finally {
      setEndResolving(false);
    }
  };

  const activeDuration = useCustom
    ? Math.max(30, parseInt(customMinutes || '0', 10) || 30)
    : selectedDuration;

  const clearCustomEnd = () => {
    setEndQuery('');
    setEndLocation(null);
    setEndLabel(null);
    setPendingEnd(null);
    setEndResolving(false);
  };

  const switchEndMode = (mode: EndMode) => {
    setEndMode(mode);
    setError(null);
    setPendingEnd(null);
    if (mode === 'current') {
      clearCustomEnd();
    }
  };

  const applyEndFromSearch = async (address: string) => {
    setEndQuery(address);
    setPendingEnd(null);
    setEndResolving(true);
    setError(null);
    try {
      const result = await geocodeAddress(address);
      if (!result) {
        setEndLocation(null);
        setEndLabel(null);
        setError('Could not find that address. Try another search.');
        return;
      }
      setEndLocation(result.location);
      setEndLabel(result.label);
    } catch {
      setError('Could not look up that address. Try again.');
    } finally {
      setEndResolving(false);
    }
  };

  const proposeEndFromMap = async (coord: LatLng) => {
    const pickId = ++pendingMapPickId.current;
    setPendingEnd({ location: coord, label: null });
    setEndResolving(true);
    setError(null);
    try {
      const label = await reverseGeocode(coord.lat, coord.lng);
      if (pickId !== pendingMapPickId.current) return;
      const fallback = `${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`;
      setPendingEnd({ location: coord, label: label || fallback });
    } catch {
      if (pickId !== pendingMapPickId.current) return;
      const fallback = `${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`;
      setPendingEnd({ location: coord, label: fallback });
    } finally {
      if (pickId === pendingMapPickId.current) setEndResolving(false);
    }
  };

  const confirmPendingEnd = () => {
    if (!pendingEnd?.label || endResolving) return;
    setEndLocation(pendingEnd.location);
    setEndLabel(pendingEnd.label);
    setEndQuery(pendingEnd.label);
    setPendingEnd(null);
    setError(null);
  };

  const cancelPendingEnd = () => {
    pendingMapPickId.current += 1;
    setPendingEnd(null);
    setEndResolving(false);
  };

  const handleFindRoute = async () => {
    if (session) {
      setError('End your current nap before planning a new route.');
      return;
    }
    if (!gpsLocation) {
      setError(
        gpsStatus === 'error'
          ? gpsErrorMsg || 'Enable location permission to find a route.'
          : 'Waiting for your location. Allow access when prompted, then try again.',
      );
      if (gpsStatus !== 'detecting') detectGps();
      return;
    }

    if (endMode === 'map' && pendingEnd) {
      setError('Confirm the ending point before finding a route.');
      return;
    }

    if (endMode !== 'current' && !endLocation) {
      setError(
        endMode === 'search'
          ? 'Search and select an ending address.'
          : 'Tap the map and confirm your ending point.',
      );
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const destination =
        endMode === 'current' || !endLocation
          ? null
          : `${endLocation.lat},${endLocation.lng}`;
      const originStr = `${gpsLocation.lat},${gpsLocation.lng}`;

      const {
        variants,
        primary,
        activeStyle,
        activeVariation,
        routesByVariation,
        restrictedOptions,
      } = await findRouteSuggestions({
        origin: originStr,
        durationMinutes: activeDuration,
        destination,
        preferredStyle: activeRoute,
        extraStops: [],
        refreshIndex: 0,
      });
      navigation.navigate('Results', {
        route: primary,
        variants,
        activeStyle,
        activeVariation,
        routesByVariation,
        durationMinutes: activeDuration,
        destination,
        destinationLabel:
          endMode === 'current' || !endLocation
            ? null
            : endLabel || destination,
        origin: gpsLocation,
        preferredStyle: activeRoute,
        originLabel: 'Current location',
        restrictedOptions,
      });
    } catch (err) {
      setError(
        err instanceof RouteError
          ? err.message
          : 'Could not calculate a route. Try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  const mapDestination =
    endMode === 'current'
      ? null
      : pendingEnd?.location ?? (endMode === 'map' || endMode === 'search' ? endLocation : null);
  const mapSelectable = endMode === 'map' && !!gpsLocation;

  return (
    <GradientBackground style={styles.flex}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + 12,
            // Floating tab bar (~68) + safe area + breathing room
            paddingBottom: Math.max(insets.bottom, 8) + 96,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Text style={styles.logoEmoji}>🌙</Text>
            <Text style={styles.brand}>Naps</Text>
          </View>
          <Pressable onPress={() => navigation.navigate('About')} style={styles.linkBtn}>
            <Text style={styles.linkText}>About</Text>
          </Pressable>
        </View>

        <Text style={styles.srOnly}>Naps — GPS Nap-Drive Route Planner</Text>
        <Text style={styles.tagline}>Find a loop that matches the nap</Text>

        {session ? (
          <ActiveRideBanner
            session={session}
            onResume={() =>
              navigation.navigate(
                'Navigate',
                navigateParamsFromSession(session),
              )
            }
          />
        ) : null}

        {/* Starting point */}
        <View style={styles.card}>
          <Text style={styles.label}>Starting point</Text>
          <Text style={styles.subhint}>Always your current location</Text>

          {gpsStatus === 'found' && gpsLocation ? (
            <View style={styles.mapBlock}>
              <NapMap
                origin={gpsLocation}
                route={null}
                destination={mapDestination}
                preview
                selectable={mapSelectable}
                onSelectCoordinate={proposeEndFromMap}
                height={endMode === 'map' ? 260 : 210}
              />
              <View style={styles.locationRow}>
                <View style={styles.readyPill}>
                  <Text style={styles.readyText}>✓ Location ready</Text>
                </View>
                <Pressable onPress={detectGps} hitSlop={8}>
                  <Text style={styles.refreshLink}>Refresh</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => {
                if (gpsStatus !== 'detecting') detectGps();
              }}
              style={styles.gpsBox}>
              {gpsStatus === 'detecting' ? (
                <View style={styles.gpsDetecting}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.gpsText}>Detecting your location…</Text>
                </View>
              ) : (
                <Text style={styles.gpsText}>
                  {gpsStatus === 'error'
                    ? gpsErrorMsg || 'Could not detect location — tap to retry'
                    : 'Tap to enable location and set your start'}
                </Text>
              )}
            </Pressable>
          )}
        </View>

        {/* Ending point */}
        <View style={styles.card}>
          <Text style={styles.label}>Ending point</Text>
          <Text style={styles.subhint}>
            Current location, search an address, or pick on the map
          </Text>

          <View style={styles.toggleRow}>
            {END_OPTIONS.map(opt => (
              <Pressable
                key={opt.id}
                onPress={() => switchEndMode(opt.id)}
                style={[
                  styles.toggleBtn,
                  endMode === opt.id && styles.toggleBtnActive,
                ]}>
                <Text
                  style={[
                    styles.toggleText,
                    endMode === opt.id && styles.toggleTextActive,
                  ]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {endMode === 'current' && (
            <Text style={styles.hint}>
              Route loops back to your current location
            </Text>
          )}

          {endMode === 'search' && (
            <View style={{ zIndex: 30 }}>
              {savedPlaces.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.savedChipsScroll}
                  contentContainerStyle={styles.savedChipsRow}
                  keyboardShouldPersistTaps="handled">
                  {savedPlaces.map(place => (
                    <Pressable
                      key={place.id}
                      onPress={() => applySavedPlace(place)}
                      style={styles.savedChip}>
                      <Text style={styles.savedChipText} numberOfLines={1}>
                        {savedPlaceChipIcon(place.kind)} {place.label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
              <PlacesAutocomplete
                value={endQuery}
                onChange={text => {
                  setEndQuery(text);
                  setEndLocation(null);
                  setEndLabel(null);
                }}
                onSelect={applyEndFromSearch}
                placeholder="Search end destination…"
                variant="gold"
                icon="🏁"
                autoFocus
                savedSuggestions={savedPlaces}
                biasLocation={gpsLocation}
              />
              {endResolving ? (
                <View style={styles.endStatusRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.hint}>Looking up address…</Text>
                </View>
              ) : endLabel ? (
                <Text style={styles.endReady}>✓ {endLabel}</Text>
              ) : (
                <Text style={styles.hint}>
                  Type to search — route will end at the selected place
                </Text>
              )}
            </View>
          )}

          {endMode === 'map' && (
            <View>
              {!gpsLocation ? (
                <Text style={styles.hint}>
                  Enable location first, then tap the map above to set the end
                </Text>
              ) : pendingEnd ? (
                <View style={styles.verifyBox}>
                  {endResolving || !pendingEnd.label ? (
                    <View style={styles.endStatusRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.hint}>Verifying place…</Text>
                    </View>
                  ) : (
                    <>
                      <Text style={styles.verifyLabel}>Verify ending point</Text>
                      <Text style={styles.verifyAddress}>{pendingEnd.label}</Text>
                      <View style={styles.verifyActions}>
                        <Pressable
                          onPress={cancelPendingEnd}
                          style={styles.verifyCancelBtn}>
                          <Text style={styles.verifyCancelText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          onPress={confirmPendingEnd}
                          style={styles.verifyConfirmBtn}>
                          <Text style={styles.verifyConfirmText}>
                            Confirm end
                          </Text>
                        </Pressable>
                      </View>
                      <Text style={styles.hint}>
                        Or tap the map again to choose a different spot
                      </Text>
                    </>
                  )}
                </View>
              ) : endLabel && endLocation ? (
                <View>
                  <Text style={styles.endReady}>✓ End: {endLabel}</Text>
                  <Text style={styles.hint}>
                    Tap the map again if you want to change it
                  </Text>
                </View>
              ) : (
                <Text style={styles.hint}>
                  Tap the map above, then confirm the ending point
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Duration */}
        <View style={styles.card}>
          <Text style={styles.label}>How long is the nap?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={styles.pillsRow}>
              {DURATIONS.map(d => {
                const active = !useCustom && selectedDuration === d.value;
                return (
                  <Pressable
                    key={d.value}
                    onPress={() => {
                      setSelectedDuration(d.value);
                      setUseCustom(false);
                    }}
                    style={[styles.pill, active && styles.pillActive]}>
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>
                      {d.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          <View style={styles.customRow}>
            <Pressable
              onPress={() => setUseCustom(v => !v)}
              style={[styles.customToggle, useCustom && styles.customToggleOn]}>
              <Text style={styles.customToggleText}>✏️ Custom</Text>
            </Pressable>
            {useCustom && (
              <>
                <TextInput
                  value={customMinutes}
                  onChangeText={setCustomMinutes}
                  placeholder="e.g. 50"
                  keyboardType="number-pad"
                  placeholderTextColor={colors.lavenderSoft}
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                />
                <Text style={styles.minLabel}>min</Text>
              </>
            )}
          </View>
        </View>

        {/* Route style */}
        <View style={styles.card}>
          <Text style={styles.label}>Route style</Text>
          <Text style={styles.subhint}>Live traffic from Google Maps</Text>
          <View style={styles.grid}>
            {ROUTE_TYPES.map(rt => {
              const isActive = activeRoute === rt.id;
              return (
                <Pressable
                  key={rt.id}
                  onPress={() => setActiveRoute(rt.id)}
                  style={[styles.routeTile, isActive && styles.routeTileActive]}>
                  <Text style={styles.routeEmoji}>{rt.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.routeLabel, isActive && { fontWeight: '700' }]}>
                      {rt.label}
                    </Text>
                    <Text style={[styles.routeSub, isActive && { color: colors.warning }]}>
                      {rt.sublabel}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* CTA */}
        <Pressable
          onPress={handleFindRoute}
          disabled={loading || !!session}
          style={[styles.cta, (loading || session) && { opacity: 0.6 }]}>
          {loading ? (
            <View style={styles.ctaInner}>
              <ActivityIndicator color={colors.onPrimary} />
              <Text style={styles.ctaText}>Finding your route…</Text>
            </View>
          ) : (
            <Text style={styles.ctaText}>
              {session ? 'End current nap to plan a new route' : 'Find My Route →'}
            </Text>
          )}
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.footerHint}>
          {endMode === 'current'
            ? 'Routes loop back to your current location'
            : 'Route ends at your chosen destination'}
        </Text>
        <Text style={styles.mockBadge}>Google Maps · live routes</Text>
      </ScrollView>
    </GradientBackground>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    flex: { flex: 1 },
    scroll: { paddingHorizontal: 16 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    logoEmoji: { fontSize: 24 },
    brand: {
      fontSize: 24,
      fontWeight: '800',
      color: colors.purple,
      letterSpacing: -0.5,
    },
    linkBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    linkText: { fontSize: 16, fontWeight: '600', color: colors.purpleMuted },
    srOnly: { position: 'absolute', width: 1, height: 1, opacity: 0 },
    tagline: {
      textAlign: 'center',
      color: colors.purpleMuted,
      fontSize: 16,
      marginBottom: 14,
      fontWeight: '500',
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 16,
      marginBottom: 12,
      overflow: 'visible',
      shadowColor: colors.shadow,
      shadowOpacity: 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    label: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.lavenderSoft,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginBottom: 10,
    },
    toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    toggleBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 16,
      backgroundColor: colors.lavenderWash,
      borderWidth: 2,
      borderColor: colors.lavenderBorder,
      alignItems: 'center',
    },
    toggleBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    toggleText: { fontSize: 16, fontWeight: '600', color: colors.purple },
    toggleTextActive: { color: colors.onPrimary },
    input: {
      backgroundColor: colors.inputBg,
      borderWidth: 2,
      borderColor: colors.lavenderBorder,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: colors.purple,
      fontSize: 16,
      marginBottom: 4,
    },
    mapBlock: { gap: 10 },
    locationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    refreshLink: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.purple,
    },
    gpsBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.inputBg,
      borderWidth: 2,
      borderColor: colors.lavenderBorder,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 14,
      minHeight: 56,
    },
    gpsDetecting: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    gpsText: { flex: 1, fontSize: 16, color: colors.purpleMuted },
    readyPill: {
      backgroundColor: 'rgba(100,200,100,0.2)',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
    },
    readyText: { fontSize: 16, color: colors.success, fontWeight: '600' },
    endStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 6,
    },
    endReady: {
      fontSize: 16,
      color: colors.success,
      fontWeight: '600',
      marginTop: 8,
    },
    savedChipsScroll: { marginBottom: 10 },
    savedChipsRow: { flexDirection: 'row', gap: 8, paddingRight: 4 },
    savedChip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.goldSoft,
      borderWidth: 1.5,
      borderColor: 'rgba(244,200,66,0.45)',
      maxWidth: 160,
    },
    savedChipText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.ink,
    },
    verifyBox: {
      marginTop: 4,
      backgroundColor: colors.goldSoft,
      borderWidth: 1.5,
      borderColor: 'rgba(244,200,66,0.4)',
      borderRadius: 16,
      padding: 12,
    },
    verifyLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.lavenderSoft,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 6,
    },
    verifyAddress: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.purple,
      marginBottom: 12,
    },
    verifyActions: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 8,
    },
    verifyCancelBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 14,
      alignItems: 'center',
      backgroundColor: colors.lavenderWash,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    verifyCancelText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.purpleMuted,
    },
    verifyConfirmBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 14,
      alignItems: 'center',
      backgroundColor: colors.primary,
    },
    verifyConfirmText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.onPrimary,
    },
    hint: { fontSize: 16, color: colors.lavenderSoft, marginTop: 6 },
    subhint: {
      fontSize: 16,
      color: colors.lavenderSoft,
      marginTop: -6,
      marginBottom: 10,
    },
    pillsRow: { flexDirection: 'row', gap: 8 },
    pill: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.lavenderWash,
      borderWidth: 2,
      borderColor: colors.lavenderBorder,
    },
    pillActive: {
      backgroundColor: colors.gold,
      borderColor: colors.gold,
    },
    pillText: { fontSize: 16, fontWeight: '600', color: colors.purple },
    pillTextActive: { fontWeight: '700', color: colors.ink },
    customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    customToggle: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 16,
      backgroundColor: colors.inputBg,
      borderWidth: 2,
      borderColor: colors.lavenderBorder,
    },
    customToggleOn: {
      backgroundColor: colors.goldSoft,
      borderColor: colors.gold,
    },
    customToggleText: { fontSize: 16, fontWeight: '600', color: colors.purple },
    minLabel: { fontSize: 16, color: colors.lavenderSoft },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    routeTile: {
      width: '48%',
      flexGrow: 1,
      flexDirection: 'row',
      gap: 8,
      padding: 12,
      borderRadius: 16,
      backgroundColor: colors.inputBg,
      borderWidth: 2,
      borderColor: colors.lavenderBorder,
    },
    routeTileActive: {
      backgroundColor: colors.goldSoft,
      borderColor: colors.gold,
    },
    routeEmoji: { fontSize: 22 },
    routeLabel: { fontSize: 16, color: colors.purple, fontWeight: '500' },
    routeSub: { fontSize: 14, color: colors.lavenderSoft, marginTop: 2 },
    cta: {
      backgroundColor: colors.primary,
      borderRadius: 999,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 4,
      shadowColor: colors.shadow,
      shadowOpacity: 0.35,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4,
    },
    ctaInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    ctaText: { color: colors.onPrimary, fontSize: 18, fontWeight: '700' },
    error: {
      textAlign: 'center',
      color: colors.error,
      fontWeight: '600',
      fontSize: 16,
      marginTop: 10,
    },
    footerHint: {
      textAlign: 'center',
      color: colors.footerHint,
      fontSize: 14,
      marginTop: 10,
    },
    mockBadge: {
      textAlign: 'center',
      fontSize: 14,
      color: colors.lavenderSoft,
      marginTop: 8,
      fontWeight: '600',
    },
  });
}
