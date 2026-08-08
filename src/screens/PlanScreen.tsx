import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GradientBackground from '../components/GradientBackground';
import PlacesAutocomplete from '../components/PlacesAutocomplete';
import { DURATIONS, ROUTE_TYPES } from '../constants/content';
import { useNapSettings } from '../context/SettingsContext';
import { useGpsLocation } from '../hooks/useGpsLocation';
import { findRouteSuggestions, RouteError } from '../services/mapsApi';
import type { RouteStyleId } from '../types/route';
import { colors } from '../theme/colors';
import type { PlanScreenProps } from '../navigation/types';

export default function PlanScreen({ navigation }: PlanScreenProps) {
  const insets = useSafeAreaInsets();
  const { settings } = useNapSettings();
  const {
    location: gpsLocation,
    status: gpsStatus,
    errorMsg: gpsErrorMsg,
    detect: detectGps,
  } = useGpsLocation();

  const [selectedDuration, setSelectedDuration] = useState(settings.defaultDuration || 30);
  const [useCustom, setUseCustom] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('');
  const [locationMode, setLocationMode] = useState<'gps' | 'custom'>(
    settings.homeAddress ? 'custom' : 'gps',
  );
  const [customLocation, setCustomLocation] = useState(settings.homeAddress || '');
  const [endMode, setEndMode] = useState<'loop' | 'custom'>('loop');
  const [customEnd, setCustomEnd] = useState('');
  const [activeRoute, setActiveRoute] = useState<RouteStyleId>(
    settings.defaultRouteType || 'highway',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.homeAddress) {
      setCustomLocation(settings.homeAddress);
      setLocationMode('custom');
    }
  }, [settings.homeAddress]);

  useEffect(() => {
    setSelectedDuration(settings.defaultDuration || 30);
    setActiveRoute(settings.defaultRouteType || 'highway');
  }, [settings.defaultDuration, settings.defaultRouteType]);

  const activeDuration = useCustom
    ? Math.max(30, parseInt(customMinutes || '0', 10) || 30)
    : selectedDuration;

  const handleFindRoute = async () => {
    if (locationMode === 'gps' && !gpsLocation) {
      setError('Location not detected yet. Tap Use my location or enter an address.');
      return;
    }
    if (locationMode === 'custom' && !customLocation.trim()) {
      setError('Please enter a starting address.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const destination =
        endMode === 'custom' && customEnd.trim() ? customEnd.trim() : null;
      const originStr =
        locationMode === 'gps' && gpsLocation
          ? `${gpsLocation.lat},${gpsLocation.lng}`
          : customLocation.trim();

      const { variants, primary, activeStyle } = await findRouteSuggestions({
        origin: originStr,
        durationMinutes: activeDuration,
        destination,
        preferredStyle: activeRoute,
        extraStops: [],
        refreshIndex: 0,
      });
      setActiveRoute(activeStyle);
      navigation.navigate('Results', {
        route: primary,
        variants,
        activeStyle,
        durationMinutes: activeDuration,
        destination,
        preferredStyle: activeRoute,
        originLabel:
          locationMode === 'gps' && gpsLocation
            ? `${gpsLocation.lat.toFixed(4)}, ${gpsLocation.lng.toFixed(4)}`
            : customLocation.trim(),
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

        {/* Starting point */}
        <View style={styles.card}>
          <Text style={styles.label}>Starting point</Text>
          <View style={styles.toggleRow}>
            {(['gps', 'custom'] as const).map(mode => (
              <Pressable
                key={mode}
                onPress={() => {
                  setLocationMode(mode);
                  if (mode === 'gps' && gpsStatus !== 'found' && gpsStatus !== 'detecting') {
                    detectGps();
                  }
                }}
                style={[
                  styles.toggleBtn,
                  locationMode === mode && styles.toggleBtnActive,
                ]}>
                <Text
                  style={[
                    styles.toggleText,
                    locationMode === mode && styles.toggleTextActive,
                  ]}>
                  {mode === 'gps' ? '📍 Use my location' : '📝 Enter address'}
                </Text>
              </Pressable>
            ))}
          </View>

          {locationMode === 'custom' ? (
            <PlacesAutocomplete
              value={customLocation}
              onChange={setCustomLocation}
              onSelect={setCustomLocation}
              placeholder="123 Main St, Your City…"
              icon="📍"
            />
          ) : (
            <Pressable
              onPress={() => {
                if (gpsStatus !== 'detecting' && gpsStatus !== 'found') detectGps();
              }}
              style={styles.gpsBox}>
              <Text style={styles.gpsText}>
                {gpsStatus === 'detecting' && 'Detecting your location…'}
                {gpsStatus === 'found' &&
                  gpsLocation &&
                  `${gpsLocation.lat.toFixed(4)}, ${gpsLocation.lng.toFixed(4)}`}
                    {gpsStatus === 'error' && (gpsErrorMsg || 'Could not detect location — tap to retry')}
                    {gpsStatus === 'idle' && 'Tap to detect your location'}
              </Text>
              {gpsStatus === 'found' && (
                <View style={styles.readyPill}>
                  <Text style={styles.readyText}>✓ Ready</Text>
                </View>
              )}
            </Pressable>
          )}

          <View style={styles.divider} />
          <Pressable
            onPress={() => setEndMode(endMode === 'loop' ? 'custom' : 'loop')}
            style={styles.checkRow}>
            <View
              style={[
                styles.checkbox,
                endMode === 'custom' && styles.checkboxOn,
              ]}>
              {endMode === 'custom' && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>Different ending point</Text>
          </Pressable>
          {endMode === 'custom' && (
            <View style={{ marginTop: 10, zIndex: 30 }}>
              <PlacesAutocomplete
                value={customEnd}
                onChange={setCustomEnd}
                onSelect={setCustomEnd}
                placeholder="Search end destination…"
                variant="gold"
                icon="🏁"
                autoFocus
              />
              <Text style={styles.hint}>
                Type to search — route will end here instead of looping back
              </Text>
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
          disabled={loading}
          style={[styles.cta, loading && { opacity: 0.6 }]}>
          {loading ? (
            <View style={styles.ctaInner}>
              <ActivityIndicator color={colors.cream} />
              <Text style={styles.ctaText}>Finding your route…</Text>
            </View>
          ) : (
            <Text style={styles.ctaText}>Find My Route →</Text>
          )}
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.footerHint}>
          {endMode === 'loop'
            ? 'Routes loop back home automatically'
            : 'Route ends at your chosen destination'}
        </Text>
        <Text style={styles.mockBadge}>Google Maps · live routes</Text>
      </ScrollView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoEmoji: { fontSize: 22 },
  brand: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.purple,
    letterSpacing: -0.5,
  },
  linkBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.45)',
    borderWidth: 1.5,
    borderColor: 'rgba(196,181,244,0.4)',
  },
  linkText: { fontSize: 13, fontWeight: '600', color: colors.purpleMuted },
  srOnly: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  tagline: {
    textAlign: 'center',
    color: colors.purpleMuted,
    fontSize: 13,
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
    shadowColor: colors.purple,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  label: {
    fontSize: 12,
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
    backgroundColor: colors.purple,
    borderColor: colors.purple,
  },
  toggleText: { fontSize: 12, fontWeight: '600', color: colors.purple },
  toggleTextActive: { color: colors.cream },
  input: {
    backgroundColor: 'rgba(196,181,244,0.15)',
    borderWidth: 2,
    borderColor: colors.lavenderBorder,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.purple,
    fontSize: 14,
    marginBottom: 4,
  },
  gpsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(196,181,244,0.15)',
    borderWidth: 2,
    borderColor: 'rgba(196,181,244,0.3)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  gpsText: { flex: 1, fontSize: 13, color: colors.purpleMuted },
  readyPill: {
    backgroundColor: 'rgba(100,200,100,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  readyText: { fontSize: 11, color: colors.success, fontWeight: '600' },
  divider: {
    height: 1.5,
    backgroundColor: 'rgba(196,181,244,0.25)',
    marginTop: 14,
    marginBottom: 12,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(196,181,244,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.purple, borderColor: colors.purple },
  checkMark: { color: colors.cream, fontSize: 11, fontWeight: '800' },
  checkLabel: { fontSize: 13, color: colors.purple, fontWeight: '500' },
  hint: { fontSize: 11, color: colors.lavenderSoft, marginTop: 6 },
  subhint: {
    fontSize: 11,
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
    borderColor: 'rgba(196,181,244,0.35)',
  },
  pillActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  pillText: { fontSize: 13, fontWeight: '600', color: colors.purple },
  pillTextActive: { fontWeight: '700' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customToggle: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(196,181,244,0.12)',
    borderWidth: 2,
    borderColor: 'rgba(196,181,244,0.35)',
  },
  customToggleOn: {
    backgroundColor: colors.goldSoft,
    borderColor: colors.gold,
  },
  customToggleText: { fontSize: 13, fontWeight: '600', color: colors.purple },
  minLabel: { fontSize: 13, color: colors.lavenderSoft },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  routeTile: {
    width: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(196,181,244,0.15)',
    borderWidth: 2,
    borderColor: colors.lavenderBorder,
  },
  routeTileActive: {
    backgroundColor: colors.goldSoft,
    borderColor: colors.gold,
  },
  routeEmoji: { fontSize: 18 },
  routeLabel: { fontSize: 13, color: colors.purple, fontWeight: '500' },
  routeSub: { fontSize: 10, color: colors.lavenderSoft, marginTop: 2 },
  cta: {
    backgroundColor: colors.purple,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
    shadowColor: colors.purple,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  ctaInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ctaText: { color: colors.cream, fontSize: 16, fontWeight: '700' },
  error: {
    textAlign: 'center',
    color: '#c0392b',
    fontWeight: '600',
    fontSize: 13,
    marginTop: 10,
  },
  footerHint: {
    textAlign: 'center',
    color: 'rgba(45,27,105,0.5)',
    fontSize: 12,
    marginTop: 10,
  },
  mockBadge: {
    textAlign: 'center',
    fontSize: 11,
    color: colors.lavenderSoft,
    marginTop: 8,
    fontWeight: '600',
  },
});
