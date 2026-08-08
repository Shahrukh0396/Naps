import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GradientBackground from '../components/GradientBackground';
import { DURATIONS, NOTIFY_OPTIONS, ROUTE_TYPES } from '../constants/content';
import {
  type NapSettings,
  useNapSettings,
} from '../context/SettingsContext';
import type { SettingsScreenProps } from '../navigation/types';
import type { RouteStyleId } from '../types/route';
import { colors } from '../theme/colors';

export default function SettingsScreen({ navigation }: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useNapSettings();
  const [draft, setDraft] = useState<NapSettings>(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const save = async () => {
    await updateSettings(draft);
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
          <Pressable onPress={save} style={styles.saveBtn}>
            <Text style={styles.saveText}>Save</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>🏠 Home base</Text>
          <Text style={styles.sectionSub}>Default starting address</Text>
          <TextInput
            value={draft.homeAddress}
            onChangeText={homeAddress => setDraft(s => ({ ...s, homeAddress }))}
            placeholder="Optional home address"
            placeholderTextColor={colors.lavenderSoft}
            style={styles.input}
          />
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
                  <Text>
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
                  <Text style={[styles.pillText, active && { fontWeight: '700' }]}>
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
              <Text style={styles.sectionSub}>Remind before the nap ends</Text>
            </View>
            <Switch
              value={draft.notificationsEnabled}
              onValueChange={notificationsEnabled =>
                setDraft(s => ({ ...s, notificationsEnabled }))
              }
              trackColor={{ false: colors.lavender, true: colors.gold }}
              thumbColor={colors.cream}
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
                      style={[styles.pillText, active && { fontWeight: '700' }]}>
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <Pressable
          onPress={() => navigation.navigate('Privacy')}
          style={styles.linkCard}>
          <Text style={styles.linkCardText}>Privacy policy →</Text>
        </Pressable>
      </ScrollView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: { fontSize: 22, fontWeight: '800', color: colors.purple },
  saveBtn: {
    backgroundColor: colors.purple,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  saveText: { color: colors.cream, fontWeight: '700', fontSize: 13 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(196,181,244,0.3)',
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
  input: {
    backgroundColor: 'rgba(196,181,244,0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(196,181,244,0.35)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.purple,
    fontSize: 13,
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
    borderColor: 'rgba(196,181,244,0.35)',
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
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderWidth: 1.5,
    borderColor: colors.lavenderBorder,
    marginTop: 4,
  },
  linkCardText: {
    color: colors.purple,
    fontWeight: '700',
    fontSize: 14,
  },
});
