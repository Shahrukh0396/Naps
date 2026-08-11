import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GradientBackground from '../components/GradientBackground';
import NapMap from '../components/NapMap';
import NapTimer from '../components/NapTimer';
import PlacesAutocomplete from '../components/PlacesAutocomplete';
import SpotifyCard from '../components/SpotifyCard';
import { ROUTE_TYPE_META } from '../constants/content';
import { useNapSettings } from '../context/SettingsContext';
import { calcNapMatch, napMatchLabel } from '../mocks/routes';
import { findRoute, findRouteSuggestions, RouteError } from '../services/mapsApi';
import type { ResultsScreenProps } from '../navigation/types';
import type { RouteResult, RouteStyleId, RouteVariant } from '../types/route';
import { colors } from '../theme/colors';

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
  const { settings } = useNapSettings();
  const params = navRoute.params;

  const [route, setRoute] = useState<RouteResult>(params.route);
  const [variants, setVariants] = useState<RouteVariant[]>(params.variants);
  const [activeStyle, setActiveStyle] = useState<RouteStyleId>(params.activeStyle);
  const [routesById, setRoutesById] = useState<Partial<Record<RouteStyleId, RouteResult>>>(
    () => ({ [params.activeStyle]: params.route }),
  );
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [timerVisible, setTimerVisible] = useState(true);
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

  const durationMinutes = params.durationMinutes;
  const destination = params.destination;
  const originLabel = params.originLabel;
  const preferredStyle = params.preferredStyle ?? params.activeStyle;
  const meta = ROUTE_TYPE_META[activeStyle];

  const originForMap =
    route.origin ?? null;

  const originStr = useMemo(() => {
    if (route.origin) return `${route.origin.lat},${route.origin.lng}`;
    return originLabel;
  }, [route.origin, originLabel]);

  const allNavSteps = useMemo(
    () => route.legs.flatMap(leg => leg.steps),
    [route],
  );
  const safeNavStep = Math.min(navStep, Math.max(0, allNavSteps.length - 1));
  const currentNavStep = allNavSteps[safeNavStep] ?? null;

  const handleSelectRouteVariant = async (styleId: RouteStyleId) => {
    if (styleId === activeStyle) return;
    setActiveStyle(styleId);
    setNavActive(false);
    setNavStep(0);
    setRouteError(null);

    const cached = routesById[styleId];
    if (cached) {
      setRoute({ ...cached, destination, extraStops: extraStopsRef.current });
      return;
    }

    setRouteLoading(true);
    try {
      const next = await findRoute({
        origin: originStr,
        destination,
        durationMinutes,
        routeTypes: [styleId],
        extraStops: extraStopsRef.current,
        variation: refreshIndex,
      });
      const withDest = { ...next, destination };
      setRoutesById(prev => ({ ...prev, [styleId]: withDest }));
      setRoute({ ...withDest, extraStops: extraStopsRef.current });
      setVariants(prev =>
        prev.map(v =>
          v.id === styleId
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
      setRouteError(
        err instanceof RouteError
          ? err.message
          : 'Network error switching route. Please try again.',
      );
    } finally {
      setRouteLoading(false);
    }
  };

  const handleRefreshSuggestions = async () => {
    setRefreshing(true);
    setRouteLoading(true);
    setRouteError(null);
    setNavActive(false);
    setNavStep(0);
    const nextIndex = refreshIndex + 1;
    try {
      const result = await findRouteSuggestions({
        origin: originStr,
        destination,
        durationMinutes,
        preferredStyle,
        extraStops: extraStopsRef.current,
        refreshIndex: nextIndex,
      });
      setRefreshIndex(result.refreshIndex);
      setVariants(result.variants);
      setRoutesById(result.routesById);
      setActiveStyle(result.activeStyle);
      setRoute({
        ...result.primary,
        destination,
        extraStops: extraStopsRef.current,
      });
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

  const refetchWithStops = async (stops: string[]) => {
    setStopLoading(true);
    setRouteError(null);
    try {
      const next = await findRoute({
        origin: originStr,
        destination,
        durationMinutes,
        routeTypes: [activeStyle],
        extraStops: stops,
        variation: refreshIndex,
      });
      const withDest = { ...next, destination, extraStops: stops };
      setRoutesById(prev => ({ ...prev, [activeStyle]: withDest }));
      setRoute(withDest);
    } catch (err) {
      setRouteError(
        err instanceof RouteError
          ? err.message
          : 'Could not update stops. Please try again.',
      );
    } finally {
      setStopLoading(false);
    }
  };

  const handleAddStop = async () => {
    if (!stopInput.trim()) return;
    const newStops = [...extraStopsRef.current, stopInput.trim()];
    setExtraStops(newStops);
    setStopInput('');
    setAddStopOpen(false);
    await refetchWithStops(newStops);
  };

  const handleRemoveStop = async (idx: number) => {
    const newStops = extraStopsRef.current.filter((_, i) => i !== idx);
    setExtraStops(newStops);
    await refetchWithStops(newStops);
  };

  const startNavigation = () => {
    if (stopLoading) return;
    if (!route.origin) {
      Alert.alert('Location needed', 'Could not read your start point for navigation.');
      return;
    }
    navigation.navigate('Navigate', {
      route,
      durationMinutes,
      destinationLabel: destination,
      activeStyle,
    });
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
              {meta.emoji} {meta.label} route
            </Text>
            <Text style={styles.topSub}>
              {route.durationText} {route.isLoop ? 'loop' : 'drive'} · via{' '}
              {route.summary || 'local roads'}
            </Text>
          </View>
          <View style={styles.durationPill}>
            <Text style={styles.durationPillText}>
              {Math.round(route.durationSeconds / 60)} min
            </Text>
          </View>
        </View>

        {/* Map */}
        <View style={styles.mapSection}>
          <View style={styles.mapFrame}>
            <NapMap
              height={240}
              origin={originForMap}
              route={route}
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
                  <Text style={{ color: colors.cream }}>{navExpanded ? '▾' : '▴'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setNavActive(false);
                    setNavStep(0);
                  }}
                  style={styles.navSmallBtn}>
                  <Text style={{ color: colors.cream, fontWeight: '700' }}>✕</Text>
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
                      { color: colors.cream },
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

          <Pressable
            onPress={startNavigation}
            disabled={stopLoading}
            style={[styles.navCta, stopLoading && { opacity: 0.7 }]}>
            <Text style={styles.navCtaText}>
              {stopLoading ? 'Updating route…' : '🧭 Start Navigation'}
            </Text>
          </Pressable>

          <View>
            <View style={styles.suggestionsHeader}>
              <View>
                <Text style={styles.sectionLabel}>3 ROUTE SUGGESTIONS</Text>
                <Text style={styles.suggestionsSub}>
                  Ranked for your {durationMinutes} min nap
                </Text>
              </View>
              <Pressable
                onPress={handleRefreshSuggestions}
                disabled={refreshing || routeLoading || stopLoading}
                style={[
                  styles.refreshBtn,
                  (refreshing || routeLoading) && { opacity: 0.55 },
                ]}>
                <Text style={styles.refreshBtnText}>
                  {refreshing ? 'Refreshing…' : '↻ Refresh'}
                </Text>
              </Pressable>
            </View>

            <View style={{ gap: 8 }}>
              {sortedVariants.map((v, index) => {
                const isActive = v.id === activeStyle;
                const match = napMatchLabel(v.napMatchScore);
                return (
                  <Pressable
                    key={`${v.id}-${refreshIndex}`}
                    onPress={() => handleSelectRouteVariant(v.id)}
                    style={[
                      styles.suggestionCard,
                      isActive && styles.suggestionCardActive,
                    ]}>
                    <View style={styles.suggestionRank}>
                      <Text style={styles.suggestionRankText}>{index + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.styleChipTitle}>
                        {v.emoji} {v.label}
                        {isActive ? ' · selected' : ''}
                      </Text>
                      <Text style={styles.styleChipDur}>
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
            </View>
          </View>

          <View style={styles.secondaryRow}>
            {allNavSteps.length > 0 && (
              <Pressable
                onPress={() => setNavActive(true)}
                style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>View directions</Text>
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

          <Pressable
            onPress={() => navigation.navigate('MainTabs', { screen: 'Home' })}
            style={styles.newRouteBtn}>
            <Text style={styles.newRouteText}>← Plan a new route</Text>
          </Pressable>
        </ScrollView>
      </View>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderWidth: 1.5,
    borderColor: colors.lavenderBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { fontSize: 18, color: colors.purple, fontWeight: '700' },
  topTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.purple,
  },
  topSub: { fontSize: 11, color: colors.purpleMuted, marginTop: 1 },
  durationPill: {
    backgroundColor: 'rgba(255,255,255,0.6)',
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
    shadowColor: colors.purple,
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
    backgroundColor: 'rgba(255,255,255,0.97)',
    overflow: 'hidden',
    shadowColor: colors.purple,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  navHeader: {
    backgroundColor: colors.purple,
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
    color: colors.cream,
    fontWeight: '700',
    fontSize: 15,
  },
  navMeta: {
    color: 'rgba(255,248,240,0.7)',
    fontSize: 12,
    marginTop: 3,
  },
  navSmallBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
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
    backgroundColor: 'rgba(196,181,244,0.25)',
    borderLeftColor: colors.purple,
  },
  stepText: { fontSize: 13, color: colors.purple },
  stepDist: { fontSize: 11, color: colors.lavenderSoft, marginTop: 2 },
  navControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(196,181,244,0.3)',
  },
  navCtrlBtn: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(196,181,244,0.5)',
    alignItems: 'center',
  },
  navCtrlPrimary: {
    backgroundColor: colors.purple,
    borderColor: colors.purple,
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
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.lavenderBorder,
  },
  errorText: { flex: 1, fontSize: 12, color: colors.purple },
  navCta: {
    backgroundColor: colors.gold,
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: colors.gold,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  navCtaText: {
    color: colors.purple,
    fontSize: 16,
    fontWeight: '800',
  },
  sectionLabel: {
    fontSize: 10,
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
    backgroundColor: 'rgba(255,255,255,0.75)',
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
    backgroundColor: 'rgba(255,255,255,0.7)',
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
    backgroundColor: 'rgba(255,255,255,0.7)',
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
    backgroundColor: 'rgba(255,255,255,0.92)',
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
    backgroundColor: 'rgba(196,181,244,0.15)',
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
    backgroundColor: colors.purple,
    alignItems: 'center',
  },
  stopAddText: { color: colors.cream, fontWeight: '700', fontSize: 12 },
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
    backgroundColor: 'rgba(255,255,255,0.7)',
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
    backgroundColor: 'rgba(45,27,105,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(45,27,105,0.2)',
    alignItems: 'center',
  },
  newRouteText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.purple,
  },
});
