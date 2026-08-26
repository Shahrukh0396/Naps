import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CompanyTag from '../components/CompanyTag';
import GradientBackground from '../components/GradientBackground';
import PlacesAutocomplete from '../components/PlacesAutocomplete';
import { DURATIONS, NOTIFY_OPTIONS, ROUTE_TYPES } from '../constants/content';
import { useAppAlert } from '../context/AlertContext';
import {
  createCustomPlace,
  createHomePlace,
  createWorkPlace,
  type NapSettings,
  type SavedPlace,
  useNapSettings,
} from '../context/SettingsContext';
import { useGpsLocation } from '../hooks/useGpsLocation';
import { setSettingsLeaveGuard } from '../navigation/settingsLeaveGuard';
import type { SettingsScreenProps } from '../navigation/types';
import type { RouteStyleId } from '../types/route';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';

const MAX_CUSTOM_PLACES = 8;

function draftPlacesFromSettings(places: SavedPlace[]): SavedPlace[] {
  const home = places.find(p => p.kind === 'home') ?? createHomePlace();
  const work = places.find(p => p.kind === 'work') ?? createWorkPlace();
  const customs = places.filter(p => p.kind === 'custom');
  return [home, work, ...customs];
}

function comparablePlaces(places: SavedPlace[]) {
  return draftPlacesFromSettings(places).map(place => ({
    id: place.kind === 'custom' ? place.id : place.kind,
    kind: place.kind,
    label: place.label.trim(),
    address: place.address.trim(),
  }));
}

function settingsAreDirty(draft: NapSettings, saved: NapSettings): boolean {
  if (draft.darkMode !== saved.darkMode) return true;
  if (draft.defaultRouteType !== saved.defaultRouteType) return true;
  if (draft.defaultDuration !== saved.defaultDuration) return true;
  if (draft.notifyAtMinutes !== saved.notifyAtMinutes) return true;
  if (draft.notificationsEnabled !== saved.notificationsEnabled) return true;
  return (
    JSON.stringify(comparablePlaces(draft.savedPlaces)) !==
    JSON.stringify(comparablePlaces(saved.savedPlaces))
  );
}

export default function SettingsScreen({ navigation }: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { settings, updateSettings, setDarkModeOverride } = useNapSettings();
  const showAlert = useAppAlert();
  const { location: gpsLocation, detect: detectGps } = useGpsLocation();
  const [draft, setDraft] = useState<NapSettings>(() => ({
    ...settings,
    savedPlaces: draftPlacesFromSettings(settings.savedPlaces),
  }));
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  const pendingLeaveRef = useRef<null | (() => void)>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    setDraft({
      ...settings,
      savedPlaces: draftPlacesFromSettings(settings.savedPlaces),
    });
  }, [
    settings.savedPlaces,
    settings.defaultRouteType,
    settings.defaultDuration,
    settings.notifyAtMinutes,
    settings.notificationsEnabled,
    settings.darkMode,
  ]);

  useEffect(() => {
    detectGps();
  }, [detectGps]);

  const isDirty = useMemo(
    () => settingsAreDirty(draft, settings),
    [draft, settings],
  );
  dirtyRef.current = isDirty;

  const resetDraft = useCallback(() => {
    const saved = settingsRef.current;
    setDarkModeOverride(null);
    setDraft({
      ...saved,
      savedPlaces: draftPlacesFromSettings(saved.savedPlaces),
    });
  }, [setDarkModeOverride]);

  const discardAndLeave = useCallback(() => {
    resetDraft();
    const leave = pendingLeaveRef.current;
    pendingLeaveRef.current = null;
    leave?.();
  }, [resetDraft]);

  const promptUnsavedLeave = useCallback(() => {
    showAlert({
      title: 'Unsaved changes',
      message:
        'If you leave now, your settings changes will be discarded.',
      tone: 'warning',
      buttons: [
        {
          label: 'Keep editing',
          variant: 'ghost',
          onPress: () => {
            pendingLeaveRef.current = null;
          },
        },
        {
          label: 'Discard',
          variant: 'primary',
          onPress: discardAndLeave,
        },
      ],
    });
  }, [discardAndLeave, showAlert]);

  useEffect(() => {
    setSettingsLeaveGuard({
      dirty: isDirty,
      prompt: proceed => {
        pendingLeaveRef.current = proceed;
        promptUnsavedLeave();
      },
    });
    return () => setSettingsLeaveGuard(null);
  }, [isDirty, promptUnsavedLeave]);

  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        if (!dirtyRef.current) return false;
        pendingLeaveRef.current = () => navigation.navigate('Home');
        promptUnsavedLeave();
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [navigation, promptUnsavedLeave]),
  );

  const home = draft.savedPlaces.find(p => p.kind === 'home');
  const work = draft.savedPlaces.find(p => p.kind === 'work');
  const customs = useMemo(
    () => draft.savedPlaces.filter(p => p.kind === 'custom'),
    [draft.savedPlaces],
  );

  const updatePlace = (id: string, patch: Partial<SavedPlace>) => {
    setDraft(s => ({
      ...s,
      savedPlaces: s.savedPlaces.map(p =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    }));
  };

  const addCustomPlace = () => {
    if (customs.length >= MAX_CUSTOM_PLACES) return;
    setDraft(s => ({
      ...s,
      savedPlaces: [...s.savedPlaces, createCustomPlace()],
    }));
  };

  const removeCustomPlace = (id: string) => {
    setDraft(s => ({
      ...s,
      savedPlaces: s.savedPlaces.filter(p => p.id !== id),
    }));
  };

  const save = async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      await updateSettings({ ...draft });
      showAlert({
        title: 'Settings saved',
        message: 'Your preferences are up to date.',
      });
    } finally {
      setSaving(false);
    }
  };

  const openPrivacy = () => {
    if (isDirty) {
      pendingLeaveRef.current = () => navigation.navigate('Privacy');
      promptUnsavedLeave();
      return;
    }
    navigation.navigate('Privacy');
  };

  return (
    <GradientBackground style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: Math.max(insets.bottom, 8) + 96,
          paddingHorizontal: 16,
        }}
        keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <Text style={styles.title}>Settings</Text>
          <Pressable
            onPress={save}
            disabled={!isDirty || saving}
            style={[styles.saveBtn, (!isDirty || saving) && styles.saveBtnDisabled]}>
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>🌙 Dark mode</Text>
              <Text style={styles.sectionSub}>
                Dim the app for night drives
              </Text>
            </View>
            <Switch
              value={draft.darkMode}
              onValueChange={darkMode => {
                setDraft(s => ({ ...s, darkMode }));
                setDarkModeOverride(darkMode);
              }}
              trackColor={{ false: colors.lavender, true: colors.gold }}
              thumbColor={colors.onPrimary}
            />
          </View>
        </View>

        <View style={[styles.card, { zIndex: 40, overflow: 'visible' }]}>
          <Text style={styles.sectionTitle}>📍 Saved places</Text>
          <Text style={styles.sectionSub}>
            Home, work, and custom places for destination suggestions
          </Text>

          {home && (
            <View style={[styles.placeBlock, { zIndex: 30 }]}>
              <Text style={styles.placeLabel}>🏠 Home</Text>
              <PlacesAutocomplete
                value={home.address}
                onChange={address => updatePlace(home.id, { address })}
                onSelect={address => updatePlace(home.id, { address })}
                placeholder="Home address"
                icon="🏠"
                biasLocation={gpsLocation}
              />
            </View>
          )}

          {work && (
            <View style={[styles.placeBlock, { zIndex: 20 }]}>
              <Text style={styles.placeLabel}>🏢 Work</Text>
              <PlacesAutocomplete
                value={work.address}
                onChange={address => updatePlace(work.id, { address })}
                onSelect={address => updatePlace(work.id, { address })}
                placeholder="Work address"
                icon="🏢"
                biasLocation={gpsLocation}
              />
            </View>
          )}

          {customs.map((place, index) => (
            <View
              key={place.id}
              style={[styles.placeBlock, { zIndex: 10 - index }]}>
              <View style={styles.customHeader}>
                <Text style={styles.placeLabel}>📌 Custom</Text>
                <Pressable
                  onPress={() => removeCustomPlace(place.id)}
                  hitSlop={8}>
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              </View>
              <TextInput
                value={place.label}
                onChangeText={label => updatePlace(place.id, { label })}
                placeholder="Name (e.g. Gym, Mom's)"
                placeholderTextColor={colors.lavenderSoft}
                style={styles.nameInput}
              />
              <PlacesAutocomplete
                value={place.address}
                onChange={address => updatePlace(place.id, { address })}
                onSelect={address => updatePlace(place.id, { address })}
                placeholder="Address"
                icon="📌"
                biasLocation={gpsLocation}
              />
            </View>
          ))}

          {customs.length < MAX_CUSTOM_PLACES && (
            <Pressable onPress={addCustomPlace} style={styles.addPlaceBtn}>
              <Text style={styles.addPlaceText}>+ Add place</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>🛣️ Default route style</Text>
          <View style={styles.grid}>
            {ROUTE_TYPES.map(rt => {
              const active = draft.defaultRouteType === rt.id;
              return (
                <Pressable
                  key={rt.id}
                  onPress={() =>
                    setDraft(s => ({
                      ...s,
                      defaultRouteType: rt.id as RouteStyleId,
                    }))
                  }
                  style={[styles.tile, active && styles.tileActive]}>
                  <Text
                    style={[
                      styles.pillText,
                      active && { color: colors.ink },
                    ]}>
                    {rt.emoji} {rt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>⏱ Default nap length</Text>
          <View style={styles.pills}>
            {DURATIONS.map(d => {
              const active = draft.defaultDuration === d.value;
              return (
                <Pressable
                  key={d.value}
                  onPress={() =>
                    setDraft(s => ({ ...s, defaultDuration: d.value }))
                  }
                  style={[styles.pill, active && styles.pillActive]}>
                  <Text
                    style={[
                      styles.pillText,
                      active && { fontWeight: '700', color: colors.ink },
                    ]}>
                    {d.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>🔔 Nap alerts</Text>
              <Text style={styles.sectionSub}>
                Remind before the nap ends — even in Google Maps
              </Text>
            </View>
            <Switch
              value={draft.notificationsEnabled}
              onValueChange={notificationsEnabled =>
                setDraft(s => ({ ...s, notificationsEnabled }))
              }
              trackColor={{ false: colors.lavender, true: colors.gold }}
              thumbColor={colors.onPrimary}
            />
          </View>
          {draft.notificationsEnabled && (
            <View style={[styles.pills, { marginTop: 12 }]}>
              {NOTIFY_OPTIONS.map(o => {
                const active = draft.notifyAtMinutes === o.value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() =>
                      setDraft(s => ({ ...s, notifyAtMinutes: o.value }))
                    }
                    style={[styles.pill, active && styles.pillActive]}>
                    <Text
                      style={[
                      styles.pillText,
                      active && { fontWeight: '700', color: colors.ink },
                    ]}>
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <Pressable onPress={openPrivacy} style={styles.linkCard}>
          <Text style={styles.linkCardText}>Privacy policy →</Text>
        </Pressable>

        <View style={styles.companyTag}>
          <CompanyTag />
        </View>
      </ScrollView>
    </GradientBackground>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    title: { fontSize: 22, fontWeight: '800', color: colors.purple },
    saveBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
    },
    saveBtnDisabled: {
      opacity: 0.45,
    },
    saveText: { color: colors.onPrimary, fontWeight: '700', fontSize: 13 },
    card: {
      backgroundColor: colors.surfaceGlass,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      padding: 16,
      marginBottom: 12,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.purple,
    },
    sectionSub: {
      fontSize: 11,
      color: colors.lavenderSoft,
      marginTop: 2,
      marginBottom: 10,
    },
    placeBlock: {
      marginBottom: 14,
    },
    placeLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.purpleMuted,
      marginBottom: 6,
    },
    customHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    removeText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.lavenderSoft,
    },
    nameInput: {
      backgroundColor: colors.inputBg,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.purple,
      fontSize: 13,
      marginBottom: 8,
    },
    addPlaceBtn: {
      marginTop: 4,
      paddingVertical: 10,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      borderStyle: 'dashed',
      alignItems: 'center',
      backgroundColor: colors.lavenderWash,
    },
    addPlaceText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.purple,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    tile: {
      width: '48%',
      flexGrow: 1,
      padding: 12,
      borderRadius: 14,
      backgroundColor: colors.lavenderWash,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    tileActive: {
      backgroundColor: colors.goldSoft,
      borderColor: colors.gold,
    },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.lavenderWash,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    pillActive: {
      backgroundColor: colors.gold,
      borderColor: colors.gold,
    },
    pillText: { fontSize: 12, color: colors.purple, fontWeight: '600' },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    linkCard: {
      padding: 16,
      borderRadius: 16,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      marginTop: 4,
    },
    linkCardText: {
      color: colors.purple,
      fontWeight: '700',
      fontSize: 14,
    },
    companyTag: {
      marginTop: 24,
      marginBottom: 8,
    },
  });
}
