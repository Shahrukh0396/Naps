import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme/colors';
import { startNapAlert, stopNapAlert } from '../utils/napAlert';

interface NapTimerProps {
  durationMinutes: number;
  /** Minutes before end to fire the harsh alert (default/settings: 5). */
  alertAtMinutes: number;
  alertsEnabled: boolean;
  onDismiss: () => void;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function ProgressRing({
  radius,
  progress,
  color,
}: {
  radius: number;
  progress: number;
  color: string;
}) {
  const stroke = 5;
  const normalizedRadius = radius - stroke;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - progress * circumference;

  return (
    <Svg
      height={radius * 2}
      width={radius * 2}
      style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle
        stroke="rgba(196,181,244,0.2)"
        fill="transparent"
        strokeWidth={stroke}
        r={normalizedRadius}
        cx={radius}
        cy={radius}
      />
      <Circle
        stroke={color}
        fill="transparent"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={strokeDashoffset}
        r={normalizedRadius}
        cx={radius}
        cy={radius}
      />
    </Svg>
  );
}

export default function NapTimer({
  durationMinutes,
  alertAtMinutes,
  alertsEnabled,
  onDismiss,
}: NapTimerProps) {
  const totalSeconds = durationMinutes * 60;
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  const [running, setRunning] = useState(false);
  const [alertFired, setAlertFired] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [endAlertFired, setEndAlertFired] = useState(false);
  const [localAlertsEnabled, setLocalAlertsEnabled] = useState(alertsEnabled);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alertingRef = useRef(false);

  const silenceAlert = useCallback(() => {
    alertingRef.current = false;
    stopNapAlert();
  }, []);

  const fireAlert = useCallback(
    async (withSound: boolean) => {
      if (!localAlertsEnabled) return;
      // If already ringing with sound, don't restart; if upgrading to sound, restart
      if (alertingRef.current && withSound) {
        silenceAlert();
      } else if (alertingRef.current) {
        return;
      }
      alertingRef.current = true;
      await startNapAlert({ withSound });
    },
    [localAlertsEnabled, silenceAlert],
  );

  useEffect(() => {
    setSecondsLeft(durationMinutes * 60);
    setRunning(false);
    setAlertFired(false);
    setAlertDismissed(false);
    setEndAlertFired(false);
    silenceAlert();
  }, [durationMinutes, silenceAlert]);

  useEffect(() => {
    return () => {
      silenceAlert();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [silenceAlert]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSecondsLeft(s => {
          if (s <= 1) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            setRunning(false);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  // Warning alert: N minutes before end — haptic only
  useEffect(() => {
    if (!localAlertsEnabled || alertFired || alertDismissed) return;
    const threshold = Math.max(0, alertAtMinutes) * 60;
    if (alertAtMinutes > 0 && secondsLeft <= threshold && secondsLeft > 0 && running) {
      setAlertFired(true);
      setAlertDismissed(false);
      void fireAlert(false);
    }
  }, [
    secondsLeft,
    alertAtMinutes,
    localAlertsEnabled,
    alertFired,
    alertDismissed,
    running,
    fireAlert,
  ]);

  // End alert: when timer hits 0 — ring res/raw/timer.mp3 + haptic
  useEffect(() => {
    if (!localAlertsEnabled || endAlertFired) return;
    if (secondsLeft === 0) {
      setEndAlertFired(true);
      setAlertFired(true);
      setAlertDismissed(false);
      void fireAlert(true);
    }
  }, [secondsLeft, localAlertsEnabled, endAlertFired, fireAlert]);

  // Stop ringing if user disables alerts
  useEffect(() => {
    if (!localAlertsEnabled) silenceAlert();
  }, [localAlertsEnabled, silenceAlert]);

  const handleDismissAlert = useCallback(() => {
    setAlertDismissed(true);
    silenceAlert();
  }, [silenceAlert]);

  const handleReset = useCallback(() => {
    setSecondsLeft(totalSeconds);
    setRunning(false);
    setAlertFired(false);
    setAlertDismissed(false);
    setEndAlertFired(false);
    silenceAlert();
  }, [totalSeconds, silenceAlert]);

  const handleDismissTimer = useCallback(() => {
    silenceAlert();
    onDismiss();
  }, [onDismiss, silenceAlert]);

  const progress = secondsLeft / totalSeconds;
  const warnThreshold = Math.max(0, alertAtMinutes) * 60;
  const isNearEnd =
    alertAtMinutes > 0 && secondsLeft <= warnThreshold && secondsLeft > 0;
  const isDone = secondsLeft === 0;
  const minutesLeft = Math.ceil(secondsLeft / 60);
  const ringColor = isDone
    ? colors.dangerSoft
    : isNearEnd
      ? colors.gold
      : colors.lavender;
  const showAlert = alertFired && !alertDismissed && localAlertsEnabled;
  const isRinging = showAlert;

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: isDone
            ? 'rgba(229,115,115,0.55)'
            : isNearEnd
              ? 'rgba(244,200,66,0.65)'
              : 'rgba(196,181,244,0.35)',
        },
        isRinging && styles.cardAlerting,
      ]}>
      {showAlert && (
        <View
          style={[
            styles.alertBanner,
            {
              backgroundColor: isDone
                ? 'rgba(229,115,115,0.22)'
                : 'rgba(244,200,66,0.28)',
            },
          ]}>
          <View style={styles.alertRow}>
            <Text style={styles.alertEmoji}>{isDone ? '🚨' : '🔔'}</Text>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.alertText,
                  { color: isDone ? '#C62828' : colors.warning },
                ]}>
                {isDone
                  ? 'Nap time is up — head home now!'
                  : `${minutesLeft} min left — start heading back`}
              </Text>
              <Text style={styles.alertSub}>
                {isDone
                  ? 'timer.mp3 ringing — tap Mute to silence'
                  : 'Haptic warning — full ring when timer ends'}
              </Text>
            </View>
            <Pressable
              onPress={handleDismissAlert}
              hitSlop={10}
              style={styles.muteBtn}>
              <Text style={styles.muteBtnText}>Mute</Text>
            </Pressable>
          </View>
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Nap timer</Text>
            <Text style={styles.subtitle}>
              {isDone
                ? 'Time to head home!'
                : running
                  ? isNearEnd
                    ? 'Almost done — wrap up the drive'
                    : 'Drive in progress'
                  : 'Tap play to start'}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => {
                setLocalAlertsEnabled(v => {
                  const next = !v;
                  if (!next) silenceAlert();
                  return next;
                });
              }}
              style={[
                styles.iconBtn,
                {
                  backgroundColor: localAlertsEnabled
                    ? 'rgba(196,181,244,0.2)'
                    : 'rgba(196,181,244,0.08)',
                },
              ]}>
              <Text style={{ fontSize: 13 }}>
                {localAlertsEnabled ? '🔔' : '🔕'}
              </Text>
            </Pressable>
            <Pressable onPress={handleDismissTimer} style={styles.iconBtn}>
              <Text style={{ fontSize: 13, color: colors.lavender }}>✕</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.mainRow}>
          <View style={styles.ringWrap}>
            <ProgressRing radius={40} progress={progress} color={ringColor} />
            <View style={styles.ringCenter}>
              <Text
                style={[
                  styles.timeText,
                  {
                    color: isDone
                      ? colors.dangerSoft
                      : isNearEnd
                        ? colors.warning
                        : colors.purple,
                    fontSize: isDone ? 14 : 17,
                  },
                ]}>
                {isDone ? '🌙' : formatTime(secondsLeft)}
              </Text>
              {!isDone && <Text style={styles.remaining}>remaining</Text>}
            </View>
          </View>

          <View style={styles.controlsCol}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: ringColor,
                    width: `${(1 - progress) * 100}%`,
                  },
                ]}
              />
            </View>
            <Text style={styles.durationHint}>
              {durationMinutes} min nap · {Math.round((1 - progress) * 100)}%
              complete
            </Text>
            <View style={styles.controlsRow}>
              <Pressable
                onPress={() => {
                  if (!isDone) setRunning(v => !v);
                }}
                disabled={isDone}
                style={[
                  styles.playBtn,
                  {
                    backgroundColor: isDone
                      ? 'rgba(196,181,244,0.1)'
                      : colors.purple,
                    opacity: isDone ? 0.5 : 1,
                  },
                ]}>
                <Text
                  style={[
                    styles.playBtnText,
                    {
                      color: isDone ? colors.lavender : colors.cream,
                    },
                  ]}>
                  {running ? '⏸ Pause' : '▶ Start'}
                </Text>
              </Pressable>
              <Pressable onPress={handleReset} style={styles.resetBtn}>
                <Text style={{ fontSize: 14, color: colors.lavenderSoft }}>↻</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {localAlertsEnabled && !isDone && (
          <Text style={styles.alertHint}>
            {alertAtMinutes === 0
              ? 'timer.mp3 + haptic when nap ends'
              : `Haptic ${alertAtMinutes} min before end · timer.mp3 at 0:00`}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.whiteGlass,
    borderRadius: 24,
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: colors.purple,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardAlerting: {
    shadowColor: '#C62828',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  alertBanner: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  alertEmoji: { fontSize: 20 },
  alertText: {
    fontSize: 13,
    fontWeight: '800',
  },
  alertSub: {
    fontSize: 10,
    color: colors.purpleMuted,
    marginTop: 2,
    fontWeight: '600',
  },
  muteBtn: {
    backgroundColor: colors.purple,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  muteBtnText: {
    color: colors.cream,
    fontSize: 12,
    fontWeight: '800',
  },
  body: { paddingHorizontal: 20, paddingVertical: 16 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.purple,
  },
  subtitle: {
    fontSize: 10,
    color: colors.lavenderSoft,
    marginTop: 2,
  },
  headerActions: { flexDirection: 'row', gap: 6 },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(196,181,244,0.08)',
  },
  mainRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ringWrap: { width: 80, height: 80 },
  ringCenter: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeText: { fontWeight: '800', lineHeight: 20 },
  remaining: { fontSize: 9, color: colors.lavenderSoft, marginTop: 2 },
  controlsCol: { flex: 1 },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(196,181,244,0.2)',
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: { height: '100%', borderRadius: 2 },
  durationHint: {
    fontSize: 10,
    color: colors.lavenderSoft,
    marginBottom: 8,
  },
  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  playBtnText: { fontSize: 12, fontWeight: '700' },
  resetBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(196,181,244,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertHint: {
    fontSize: 10,
    color: 'rgba(155,142,196,0.7)',
    marginTop: 10,
  },
});
