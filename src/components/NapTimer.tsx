import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import ExtendTimeSheet from './ExtendTimeSheet';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';
import { startNapAlert, stopNapAlert } from '../utils/napAlert';

const EXTEND_MINUTES = 5;

interface NapTimerProps {
  durationMinutes: number;
  /** Minutes before end to fire the harsh alert (default/settings: 5). */
  alertAtMinutes: number;
  alertsEnabled: boolean;
  onDismiss: () => void;
  /** Compact floating style for overlaying a full-screen map. */
  variant?: 'card' | 'overlay';
  /** Start counting down immediately (navigation mode). */
  autoStart?: boolean;
  /** Default minutes selected in the extend sheet. */
  extendByMinutes?: number;
  /** Fired after Extend updates the timer — use to recalculate the nap route. */
  onExtend?: (info: {
    addedMinutes: number;
    totalMinutes: number;
    secondsLeft: number;
  }) => void;
  /** Fired once when the countdown reaches 0:00. */
  onComplete?: () => void;
  /** Fired whenever the countdown value changes (navigation helpers). */
  onSecondsLeftChange?: (secondsLeft: number) => void;
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
  variant = 'card',
  autoStart = false,
  extendByMinutes = EXTEND_MINUTES,
  onExtend,
  onComplete,
  onSecondsLeftChange,
}: NapTimerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [totalSeconds, setTotalSeconds] = useState(durationMinutes * 60);
  const [secondsLeft, setSecondsLeft] = useState(durationMinutes * 60);
  const [running, setRunning] = useState(autoStart);
  const [alertFired, setAlertFired] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [endAlertFired, setEndAlertFired] = useState(false);
  const [localAlertsEnabled, setLocalAlertsEnabled] = useState(alertsEnabled);
  const [extendOpen, setExtendOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alertingRef = useRef(false);
  const seededDurationRef = useRef(durationMinutes);
  const completeFiredRef = useRef(false);

  const silenceAlert = useCallback(() => {
    alertingRef.current = false;
    stopNapAlert();
  }, []);

  const fireAlert = useCallback(
    async (withSound: boolean) => {
      if (!localAlertsEnabled) return;
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

  // Only reset when the planned nap duration prop changes (not on Extend).
  useEffect(() => {
    if (seededDurationRef.current === durationMinutes) return;
    seededDurationRef.current = durationMinutes;
    const next = durationMinutes * 60;
    setTotalSeconds(next);
    setSecondsLeft(next);
    setRunning(autoStart);
    setAlertFired(false);
    setAlertDismissed(false);
    setEndAlertFired(false);
    completeFiredRef.current = false;
    silenceAlert();
  }, [durationMinutes, autoStart, silenceAlert]);

  useEffect(() => {
    onSecondsLeftChange?.(secondsLeft);
  }, [secondsLeft, onSecondsLeftChange]);

  useEffect(() => {
    if (secondsLeft !== 0 || completeFiredRef.current) return;
    completeFiredRef.current = true;
    onComplete?.();
  }, [secondsLeft, onComplete]);

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

  useEffect(() => {
    if (!localAlertsEnabled || endAlertFired) return;
    if (secondsLeft === 0) {
      setEndAlertFired(true);
      setAlertFired(true);
      setAlertDismissed(false);
      void fireAlert(true);
    }
  }, [secondsLeft, localAlertsEnabled, endAlertFired, fireAlert]);

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
    completeFiredRef.current = false;
    silenceAlert();
  }, [totalSeconds, silenceAlert]);

  const applyExtend = useCallback(
    (addedMinutes: number) => {
      const mins = Math.max(1, addedMinutes);
      const addSecs = mins * 60;
      const nextTotal = totalSeconds + addSecs;
      const nextLeft = secondsLeft + addSecs;
      setTotalSeconds(nextTotal);
      setSecondsLeft(nextLeft);
      setEndAlertFired(false);
      setAlertFired(false);
      setAlertDismissed(false);
      completeFiredRef.current = false;
      silenceAlert();
      if (!running) setRunning(true);
      onExtend?.({
        addedMinutes: mins,
        totalMinutes: Math.round(nextTotal / 60),
        secondsLeft: nextLeft,
      });
    },
    [onExtend, running, secondsLeft, silenceAlert, totalSeconds],
  );

  const handleOpenExtend = useCallback(() => {
    setExtendOpen(true);
  }, []);

  const handleConfirmExtend = useCallback(
    (minutes: number) => {
      setExtendOpen(false);
      applyExtend(minutes);
    },
    [applyExtend],
  );

  const handleDismissTimer = useCallback(() => {
    silenceAlert();
    onDismiss();
  }, [onDismiss, silenceAlert]);

  const progress = totalSeconds > 0 ? secondsLeft / totalSeconds : 0;
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
  const isOverlay = variant === 'overlay';
  const plannedMinutes = Math.round(totalSeconds / 60);

  return (
    <View
      style={[
        isOverlay ? styles.overlayCard : styles.card,
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
                  { color: isDone ? colors.dangerAlert : colors.warning },
                ]}>
                {isDone
                  ? 'Nap time is up — head to your destination!'
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

      <View style={[styles.body, isOverlay && styles.bodyOverlay]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Nap timer</Text>
            <Text style={styles.subtitle}>
              {isDone
                ? 'Time to head to your destination!'
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
            {!isOverlay && (
              <Pressable onPress={handleDismissTimer} style={styles.iconBtn}>
                <Text style={{ fontSize: 13, color: colors.lavender }}>✕</Text>
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.mainRow}>
          <View style={[styles.ringWrap, isOverlay && styles.ringWrapSm]}>
            <ProgressRing
              radius={isOverlay ? 34 : 40}
              progress={progress}
              color={ringColor}
            />
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
                    fontSize: isDone ? 14 : isOverlay ? 15 : 17,
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
              {plannedMinutes} min nap · {Math.round((1 - progress) * 100)}%
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
                      : colors.primary,
                    opacity: isDone ? 0.5 : 1,
                  },
                ]}>
                <Text
                  style={[
                    styles.playBtnText,
                    {
                      color: isDone ? colors.lavender : colors.onPrimary,
                    },
                  ]}>
                  {running ? '⏸ Pause' : '▶ Start'}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleOpenExtend}
                style={styles.extendBtn}
                accessibilityLabel="Choose how long to extend the nap">
                <Text style={styles.extendBtnText}>Extend…</Text>
              </Pressable>
              {!isOverlay && (
                <Pressable onPress={handleReset} style={styles.resetBtn}>
                  <Text style={{ fontSize: 14, color: colors.lavenderSoft }}>↻</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {localAlertsEnabled && !isDone && !isOverlay && (
          <Text style={styles.alertHint}>
            {alertAtMinutes === 0
              ? 'timer.mp3 + haptic when nap ends'
              : `Haptic ${alertAtMinutes} min before end · timer.mp3 at 0:00`}
          </Text>
        )}
      </View>

      <ExtendTimeSheet
        visible={extendOpen}
        defaultMinutes={extendByMinutes}
        currentTotalMinutes={plannedMinutes}
        currentSecondsLeft={secondsLeft}
        willRecalculateRoute={!!onExtend}
        onCancel={() => setExtendOpen(false)}
        onConfirm={handleConfirmExtend}
      />
    </View>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.whiteGlass,
      borderRadius: 24,
      borderWidth: 1.5,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOpacity: 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    overlayCard: {
      backgroundColor: colors.overlay,
      borderRadius: 22,
      borderWidth: 1.5,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOpacity: 0.28,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },
    cardAlerting: {
      shadowColor: colors.dangerAlert,
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
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
    },
    muteBtnText: {
      color: colors.onPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    body: { paddingHorizontal: 20, paddingVertical: 16 },
    bodyOverlay: { paddingHorizontal: 16, paddingVertical: 14 },
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
      backgroundColor: colors.lavenderWash,
    },
    mainRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    ringWrap: { width: 80, height: 80 },
    ringWrapSm: { width: 68, height: 68 },
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
      backgroundColor: colors.lavenderWash,
      overflow: 'hidden',
      marginBottom: 12,
    },
    progressFill: { height: '100%', borderRadius: 2 },
    durationHint: {
      fontSize: 10,
      color: colors.lavenderSoft,
      marginBottom: 8,
    },
    controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    playBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
    },
    playBtnText: { fontSize: 12, fontWeight: '700' },
    extendBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.gold,
    },
    extendBtnText: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.ink,
    },
    resetBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.inputBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    alertHint: {
      fontSize: 10,
      color: colors.lavenderSoft,
      marginTop: 10,
    },
  });
}
