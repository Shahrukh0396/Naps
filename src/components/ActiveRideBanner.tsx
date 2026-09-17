import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ROUTE_TYPE_META } from '../constants/content';
import { useAppAlert } from '../context/AlertContext';
import { useNapSession } from '../context/NapSessionContext';
import {
  formatNapRemaining,
  remainingSeconds,
  type ActiveNapSession,
} from '../services/napSession';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';

interface ActiveRideBannerProps {
  session: ActiveNapSession;
  onResume: () => void;
}

export default function ActiveRideBanner({
  session,
  onResume,
}: ActiveRideBannerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const showAlert = useAppAlert();
  const { endSession } = useNapSession();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const meta = ROUTE_TYPE_META[session.activeStyle];
  const left = remainingSeconds(session);
  const status =
    left <= 0
      ? 'Nap ended — resume to head home, or end this ride'
      : session.running
        ? 'Ride in progress'
        : 'Ride paused';

  const confirmEnd = () => {
    showAlert({
      title: 'End this nap?',
      message:
        'Your current ride will stop. You can plan a new route after that.',
      tone: 'danger',
      buttons: [
        { label: 'Keep riding', variant: 'ghost' },
        {
          label: 'End nap',
          variant: 'primary',
          onPress: () => {
            void endSession();
          },
        },
      ],
    });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>Current ride</Text>
      <Text style={styles.title}>
        {meta.emoji} {meta.label} · {formatNapRemaining(session)}
      </Text>
      <Text style={styles.status}>{status}</Text>
      <Text style={styles.summary} numberOfLines={1}>
        {session.route.durationText}
        {session.route.summary ? ` · via ${session.route.summary}` : ''}
        {session.route.isLoop ? ' · loop' : ''}
      </Text>
      <View style={styles.actions}>
        <Pressable onPress={confirmEnd} style={styles.endBtn}>
          <Text style={styles.endText}>End nap</Text>
        </Pressable>
        <Pressable onPress={onResume} style={styles.resumeBtn}>
          <Text style={styles.resumeText}>Resume ride</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.goldSoft,
      borderRadius: 24,
      paddingHorizontal: 18,
      paddingTop: 14,
      paddingBottom: 14,
      marginBottom: 12,
      borderWidth: 2,
      borderColor: colors.gold,
    },
    kicker: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      color: colors.warning,
      marginBottom: 4,
    },
    title: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.ink,
    },
    status: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.purple,
      marginTop: 4,
    },
    summary: {
      fontSize: 12,
      color: colors.purpleMuted,
      marginTop: 2,
    },
    actions: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    endBtn: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 14,
      alignItems: 'center',
      backgroundColor: colors.lavenderWash,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    endText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.purpleMuted,
    },
    resumeBtn: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 14,
      alignItems: 'center',
      backgroundColor: colors.primary,
    },
    resumeText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.onPrimary,
    },
  });
}
