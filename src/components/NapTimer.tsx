import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import ExtendTimeSheet from './ExtendTimeSheet';
import { armNapAlerts, cancelNapAlerts } from '../services/napTimerNotifications';
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
  /** Overlay only — hide extend / navigate controls and show a compact timer. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
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
  /** Overlay CTA — starts the nap and opens Google Maps. */
  beginAction?: {
    idleLabel?: string;
    activeLabel?: string;
    active: boolean;
    onPress: () => void | Promise<void>;
  };
  /** Rebuild the nap route from the live GPS using the same planner. */
  changeRouteAction?: {
    onPress: () => void | Promise<void>;
    busy?: boolean;
    disabled?: boolean;
  };
  /** Overlay — leave navigation without ending the nap. */
  backAction?: {
    onPress: () => void;
    label?: string;
  };
  /** Absolute end time so the countdown survives background / process death. */
  initialEndsAt?: number | null;
  /** Total length after extends, used when restoring a session. */
  initialTotalSeconds?: number;
  /** Remaining time when restoring a paused session. */
  initialSecondsLeft?: number;
  onTimerStateChange?: (state: {
    running: boolean;
    secondsLeft: number;
    totalSeconds: number;
    endsAt: number | null;
  }) => void;
}

function secondsUntil(endsAt: number | null, fallback = 0): number {
  if (endsAt == null) return Math.max(0, fallback);
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function PillProgressBorder({
  width,
  height,
  progress,
  color,
  trackColor,
}: {
  width: number;
  height: number;
  progress: number;
  color: string;
  trackColor: string;
}) {
  if (width < 8 || height < 8) return null;
  const stroke = 3;
  const inset = stroke / 2;
  const rw = Math.max(1, width - stroke);
  const rh = Math.max(1, height - stroke);
  const radius = rh / 2;
  const straight = Math.max(0, rw - rh);
  const perimeter = 2 * straight + Math.PI * rh;
  const filled = Math.max(0, Math.min(1, progress)) * perimeter;

  return (
    <Svg
      width={width}
      height={height}
      style={StyleSheet.absoluteFill}
      pointerEvents="none">
      <Rect
        x={inset}
        y={inset}
        width={rw}
        height={rh}
        rx={radius}
        ry={radius}
        fill="none"
        stroke={trackColor}
        strokeWidth={stroke}
      />
      {filled > 0 ? (
        <Rect
          x={inset}
          y={inset}
          width={rw}
          height={rh}
          rx={radius}
          ry={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${Math.max(perimeter, 1)}`}
        />
      ) : null}
    </Svg>
  );
}

function ProgressRing({
  radius,
  progress,
  color,
  trackColor,
}: {
  radius: number;
  progress: number;
  color: string;
  trackColor: string;
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
        stroke={trackColor}
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
  collapsed = false,
  onToggleCollapsed,
  autoStart = false,
  extendByMinutes = EXTEND_MINUTES,
  onExtend,
  onComplete,
  onSecondsLeftChange,
  beginAction,
  changeRouteAction,
  backAction,
  initialEndsAt = null,
  initialTotalSeconds,
  initialSecondsLeft,
  onTimerStateChange,
}: NapTimerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [totalSeconds, setTotalSeconds] = useState(
    () => initialTotalSeconds ?? durationMinutes * 60,
  );
  const [secondsLeft, setSecondsLeft] = useState(() => {
    if (initialEndsAt != null) return secondsUntil(initialEndsAt);
    if (initialSecondsLeft != null) return initialSecondsLeft;
    return initialTotalSeconds ?? durationMinutes * 60;
  });
  const [running, setRunning] = useState(() => {
    if (initialEndsAt != null) return initialEndsAt > Date.now();
    return autoStart;
  });
  const [alertFired, setAlertFired] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [endAlertFired, setEndAlertFired] = useState(false);
  const [localAlertsEnabled, setLocalAlertsEnabled] = useState(alertsEnabled);
  const [extendOpen, setExtendOpen] = useState(false);
  const [chipSize, setChipSize] = useState({ width: 0, height: 0 });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alertingRef = useRef(false);
  const seededDurationRef = useRef(durationMinutes);
  const completeFiredRef = useRef(false);
  const endsAtRef = useRef<number | null>(
    initialEndsAt != null && initialEndsAt > Date.now()
      ? initialEndsAt
      : autoStart
        ? Date.now() + (initialTotalSeconds ?? durationMinutes * 60) * 1000
        : null,
  );
  const alertAtRef = useRef(alertAtMinutes);
  const alertsEnabledRef = useRef(localAlertsEnabled);
  const secondsLeftRef = useRef(secondsLeft);
  alertAtRef.current = alertAtMinutes;
  alertsEnabledRef.current = localAlertsEnabled;
  secondsLeftRef.current = secondsLeft;

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

  const armEndsAt = useCallback((nextEndsAt: number | null) => {
    endsAtRef.current = nextEndsAt;
    if (nextEndsAt == null) {
      void cancelNapAlerts();
      return;
    }
    void armNapAlerts({
      endsAt: nextEndsAt,
      alertAtMinutes: alertAtRef.current,
      enabled: alertsEnabledRef.current,
    });
  }, []);

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
    armEndsAt(autoStart ? Date.now() + next * 1000 : null);
    silenceAlert();
  }, [durationMinutes, autoStart, silenceAlert, armEndsAt]);

  useEffect(() => {
    onSecondsLeftChange?.(secondsLeft);
  }, [secondsLeft, onSecondsLeftChange]);

  useEffect(() => {
    onTimerStateChange?.({
      running,
      secondsLeft,
      totalSeconds,
      endsAt: endsAtRef.current,
    });
  }, [running, secondsLeft, totalSeconds, onTimerStateChange]);

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
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    if (endsAtRef.current == null) {
      armEndsAt(Date.now() + secondsLeftRef.current * 1000);
    } else {
      armEndsAt(endsAtRef.current);
    }

    const tick = () => {
      const left = secondsUntil(endsAtRef.current, 0);
      setSecondsLeft(left);
      if (left <= 0) {
        endsAtRef.current = null;
        setRunning(false);
      }
    };

    tick();
    intervalRef.current = setInterval(tick, 1000);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') tick();
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      sub.remove();
    };
    // secondsLeft is intentionally omitted — the clock is wall-time via endsAtRef.
  }, [running, armEndsAt]);

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
    if (!localAlertsEnabled) {
      silenceAlert();
      if (running && endsAtRef.current != null) {
        void cancelNapAlerts();
      }
      return;
    }
    if (running && endsAtRef.current != null) {
      armEndsAt(endsAtRef.current);
    }
  }, [localAlertsEnabled, running, silenceAlert, armEndsAt]);

  const handleDismissAlert = useCallback(() => {
    setAlertDismissed(true);
    silenceAlert();
  }, [silenceAlert]);

  const handleToggleRunning = useCallback(() => {
    if (secondsLeft <= 0) return;
    if (running) {
      const left = secondsUntil(endsAtRef.current, secondsLeft);
      setSecondsLeft(left);
      armEndsAt(null);
      setRunning(false);
      return;
    }
    armEndsAt(Date.now() + secondsLeft * 1000);
    setRunning(true);
  }, [armEndsAt, running, secondsLeft]);

  const handleReset = useCallback(() => {
    armEndsAt(null);
    setSecondsLeft(totalSeconds);
    setRunning(false);
    setAlertFired(false);
    setAlertDismissed(false);
    setEndAlertFired(false);
    completeFiredRef.current = false;
    silenceAlert();
  }, [armEndsAt, totalSeconds, silenceAlert]);

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
      if (running || beginAction?.active) {
        armEndsAt(Date.now() + nextLeft * 1000);
        if (!running) setRunning(true);
      }
      onExtend?.({
        addedMinutes: mins,
        totalMinutes: Math.round(nextTotal / 60),
        secondsLeft: nextLeft,
      });
    },
    [armEndsAt, beginAction?.active, onExtend, running, secondsLeft, silenceAlert, totalSeconds],
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
    armEndsAt(null);
    silenceAlert();
    onDismiss();
  }, [armEndsAt, onDismiss, silenceAlert]);

  const handleBeginPress = useCallback(() => {
    const start = async () => {
      if (!running && secondsLeft > 0) {
        const endsAt = Date.now() + secondsLeft * 1000;
        endsAtRef.current = endsAt;
        setRunning(true);
        await armNapAlerts({
          endsAt,
          alertAtMinutes: alertAtRef.current,
          enabled: alertsEnabledRef.current,
        });
      } else if (running && endsAtRef.current != null) {
        await armNapAlerts({
          endsAt: endsAtRef.current,
          alertAtMinutes: alertAtRef.current,
          enabled: alertsEnabledRef.current,
        });
      }
      await beginAction?.onPress();
    };
    void start();
  }, [beginAction, running, secondsLeft]);

  const toggleAlerts = useCallback(() => {
    setLocalAlertsEnabled(v => {
      const next = !v;
      if (!next) silenceAlert();
      return next;
    });
  }, [silenceAlert]);

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
  const percentComplete = Math.round((1 - progress) * 100);
  const statusLabel = isDone
    ? 'Time to head to your destination'
    : running
      ? isNearEnd
        ? 'Almost done — wrap up the drive'
        : 'Drive in progress'
      : beginAction
        ? 'Tap Begin Nap to start'
        : 'Tap play to start';
  const napStarted = Boolean(beginAction?.active || running || isDone);
  const beginLabel = napStarted
    ? beginAction?.activeLabel ?? 'Open Maps'
    : beginAction?.idleLabel ?? 'Begin Nap';
  const changeRouteBusy = Boolean(changeRouteAction?.busy);
  const changeRouteDisabled = Boolean(
    !changeRouteAction ||
      changeRouteAction.disabled ||
      changeRouteBusy ||
      isDone,
  );
  const changeRouteLabel = changeRouteBusy
    ? 'Finding route…'
    : 'Change route';

  const handleChangeRoutePress = () => {
    if (changeRouteDisabled) return;
    void changeRouteAction?.onPress();
  };
  const backLabel = backAction?.label ?? 'Back';

  const extendSheet = (
    <ExtendTimeSheet
      visible={extendOpen}
      defaultMinutes={extendByMinutes}
      currentTotalMinutes={plannedMinutes}
      currentSecondsLeft={secondsLeft}
      willRecalculateRoute={!!onExtend}
      onCancel={() => setExtendOpen(false)}
      onConfirm={handleConfirmExtend}
    />
  );

  const alertBanner = showAlert ? (
    <View
      style={[
        styles.alertBanner,
        { backgroundColor: isDone ? colors.dangerSoft : colors.goldSoft },
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
              ? 'Ringing — tap Mute to silence'
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
  ) : null;

  if (isOverlay) {
    const overlayBorder = {
      borderColor: isDone
        ? colors.dangerSoft
        : isNearEnd
          ? colors.gold
          : colors.lavenderBorder,
    };

    if (collapsed) {
      const onBellPress = () => {
        if (isRinging) {
          handleDismissAlert();
          return;
        }
        toggleAlerts();
      };

      return (
        <View
          style={[
            styles.collapsedWrap,
            isRinging && styles.cardAlerting,
          ]}
          onLayout={e => {
            const { width, height } = e.nativeEvent.layout;
            if (width !== chipSize.width || height !== chipSize.height) {
              setChipSize({ width, height });
            }
          }}>
          <PillProgressBorder
            width={chipSize.width}
            height={chipSize.height}
            progress={percentComplete / 100}
            color={ringColor}
            trackColor={colors.lavenderBorder}
          />
          <View style={styles.collapsedChip}>
          {backAction ? (
            <Pressable
              onPress={backAction.onPress}
              hitSlop={8}
              style={styles.collapsedBell}
              accessibilityRole="button"
              accessibilityLabel={backLabel}>
              <Text style={styles.collapsedBackText}>←</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onToggleCollapsed}
            style={styles.collapsedMainPress}
            accessibilityRole="button"
            accessibilityLabel={`Show timer controls, ${formatTime(secondsLeft)} remaining`}>
            <View style={styles.collapsedMain}>
              <Text
                style={[
                  styles.collapsedTime,
                  isDone && { color: colors.danger },
                  isNearEnd && !isDone && { color: colors.warning },
                ]}>
                {formatTime(secondsLeft)}
              </Text>
              <Text style={styles.collapsedHint} numberOfLines={1}>
                {isDone ? 'Done' : running ? 'Nap' : 'Paused'}
              </Text>
            </View>
          </Pressable>
          <Pressable
            onPress={onBellPress}
            hitSlop={8}
            style={[
              styles.collapsedBell,
              isRinging && styles.collapsedBellRinging,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              isRinging
                ? 'Mute ringing alert'
                : localAlertsEnabled
                  ? 'Mute nap alerts'
                  : 'Enable nap alerts'
            }>
            <Text style={styles.collapsedBellIcon}>
              {isRinging ? '🔔' : localAlertsEnabled ? '🔔' : '🔕'}
            </Text>
          </Pressable>
          {changeRouteAction ? (
            <Pressable
              onPress={handleChangeRoutePress}
              disabled={changeRouteDisabled}
              hitSlop={8}
              style={[
                styles.collapsedBell,
                changeRouteDisabled && styles.playBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={changeRouteLabel}>
              <Text style={styles.collapsedBellIcon}>↻</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onToggleCollapsed}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Show timer controls">
            <Text style={styles.collapsedChevron}>▴</Text>
          </Pressable>
          </View>
          {extendSheet}
        </View>
      );
    }

    return (
      <View
        style={[
          styles.overlayCard,
          overlayBorder,
          isRinging && styles.cardAlerting,
        ]}>
        {onToggleCollapsed ? (
          <Pressable
            onPress={onToggleCollapsed}
            style={styles.collapseHandle}
            accessibilityRole="button"
            accessibilityLabel="Hide timer controls">
            <View style={styles.collapseHandleBar} />
            <Text style={styles.collapseHandleText}>Hide</Text>
          </Pressable>
        ) : null}
        {alertBanner}
        <View style={styles.overlayBody}>
          {backAction ? (
            <Pressable
              onPress={backAction.onPress}
              style={styles.overlayBackBtn}
              accessibilityRole="button"
              accessibilityLabel={backLabel}>
              <Text style={styles.overlayBackText}>←  {backLabel}</Text>
            </Pressable>
          ) : null}
          <View style={styles.overlayTop}>
            <View style={styles.overlayTimeBlock}>
              <Text style={styles.overlayTime}>{formatTime(secondsLeft)}</Text>
              <Text style={styles.overlayStatus}>{statusLabel}</Text>
            </View>
            <Pressable
              onPress={toggleAlerts}
              style={styles.iconBtn}
              accessibilityLabel={
                localAlertsEnabled ? 'Mute nap alerts' : 'Enable nap alerts'
              }>
              <Text style={{ fontSize: 16 }}>
                {localAlertsEnabled ? '🔔' : '🔕'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: ringColor,
                  width: `${percentComplete}%`,
                },
              ]}
            />
          </View>
          <Text style={styles.overlayMeta}>
            {plannedMinutes} min nap · {percentComplete}% complete
          </Text>

          <View style={styles.overlayControls}>
            {napStarted && (
              <Pressable
                onPress={handleToggleRunning}
                disabled={isDone}
                style={[
                  styles.playBtn,
                  styles.overlayPlayBtn,
                  isDone && styles.playBtnDisabled,
                ]}>
                <Text
                  style={[
                    styles.playBtnText,
                    { color: isDone ? colors.lavender : colors.onPrimary },
                  ]}>
                  {running ? '⏸ Pause' : '▶ Resume'}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={handleOpenExtend}
              style={[styles.extendBtn, styles.overlayExtendBtn]}
              accessibilityLabel="Choose how long to extend the nap">
              <Text style={styles.extendBtnText}>Extend</Text>
            </Pressable>
          </View>

          {changeRouteAction ? (
            <Pressable
              onPress={handleChangeRoutePress}
              disabled={changeRouteDisabled}
              style={[
                styles.changeRouteBtn,
                changeRouteDisabled && styles.playBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={changeRouteLabel}>
              <Text style={styles.changeRouteText}>
                {changeRouteBusy ? changeRouteLabel : `↻  ${changeRouteLabel}`}
              </Text>
            </Pressable>
          ) : null}

          {beginAction && (
            <Pressable
              onPress={handleBeginPress}
              style={[
                styles.beginNapBtn,
                napStarted && styles.beginNapBtnSecondary,
              ]}
              accessibilityLabel={beginLabel}
              accessibilityRole="button">
              <Text
                style={[
                  styles.beginNapText,
                  napStarted && styles.beginNapTextSecondary,
                ]}>
                {napStarted ? `🗺️  ${beginLabel}` : `🌙  ${beginLabel}`}
              </Text>
            </Pressable>
          )}
        </View>
        {extendSheet}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: isDone
            ? colors.dangerSoft
            : isNearEnd
              ? colors.gold
              : colors.lavenderBorder,
        },
        isRinging && styles.cardAlerting,
      ]}>
      {alertBanner}
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Nap timer</Text>
            <Text style={styles.subtitle}>{statusLabel}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable onPress={toggleAlerts} style={styles.iconBtn}>
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
            <ProgressRing
              radius={40}
              progress={progress}
              color={ringColor}
              trackColor={colors.lavenderWash}
            />
            <View style={styles.ringCenter}>
              <Text style={styles.timeText}>{formatTime(secondsLeft)}</Text>
            </View>
          </View>
          <View style={styles.controlsCol}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: ringColor,
                    width: `${percentComplete}%`,
                  },
                ]}
              />
            </View>
            <Text style={styles.durationHint}>
              {plannedMinutes} min nap · {percentComplete}% complete
            </Text>
            <View style={styles.controlsRow}>
              <Pressable
                onPress={handleToggleRunning}
                disabled={isDone}
                style={[styles.playBtn, isDone && styles.playBtnDisabled]}>
                <Text
                  style={[
                    styles.playBtnText,
                    { color: isDone ? colors.lavender : colors.onPrimary },
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
              {changeRouteAction ? (
                <Pressable
                  onPress={handleChangeRoutePress}
                  disabled={changeRouteDisabled}
                  style={[
                    styles.changeRouteBtnCompact,
                    changeRouteDisabled && styles.playBtnDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={changeRouteLabel}>
                  <Text style={styles.changeRouteTextCompact}>
                    {changeRouteBusy ? '…' : '↻ Route'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable onPress={handleReset} style={styles.resetBtn}>
                <Text style={{ fontSize: 14, color: colors.lavenderSoft }}>↻</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {localAlertsEnabled && !isDone && (
          <Text style={styles.alertHint}>
            {alertAtMinutes === 0
              ? 'Sound + haptic when nap ends'
              : `Haptic ${alertAtMinutes} min before end · sound at 0:00`}
          </Text>
        )}
      </View>
      {extendSheet}
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
      borderRadius: 28,
      borderWidth: 1.5,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOpacity: 0.28,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },
    collapseHandle: {
      alignItems: 'center',
      paddingTop: 8,
      paddingBottom: 2,
    },
    collapseHandleBar: {
      width: 36,
      height: 4,
      borderRadius: 999,
      backgroundColor: colors.lavender,
      opacity: 0.7,
    },
    collapseHandleText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.purpleMuted,
      marginTop: 4,
    },
    collapsedWrap: {
      alignSelf: 'flex-end',
      shadowColor: colors.shadow,
      shadowOpacity: 0.2,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    collapsedChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.overlay,
      borderRadius: 999,
      paddingLeft: 14,
      paddingRight: 8,
      paddingVertical: 8,
    },
    collapsedMainPress: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    collapsedMain: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 6,
    },
    collapsedBell: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.lavenderWash,
    },
    collapsedBellRinging: {
      backgroundColor: colors.gold,
    },
    collapsedBellIcon: {
      fontSize: 15,
    },
    collapsedBackText: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.purple,
      lineHeight: 20,
    },
    collapsedTime: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.purple,
      letterSpacing: -0.6,
      lineHeight: 24,
    },
    collapsedHint: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.purpleMuted,
    },
    collapsedChevron: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.purpleMuted,
    },
    cardAlerting: {
      shadowColor: colors.dangerAlert,
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 6,
    },
    alertBanner: {
      paddingHorizontal: 16,
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
    overlayBody: {
      paddingHorizontal: 18,
      paddingTop: 8,
      paddingBottom: 16,
    },
    overlayBackBtn: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 10,
      backgroundColor: colors.lavenderWash,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    overlayBackText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.purple,
    },
    overlayTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    overlayTimeBlock: {
      flex: 1,
      paddingRight: 12,
    },
    overlayTime: {
      fontSize: 42,
      fontWeight: '800',
      color: colors.purple,
      letterSpacing: -1.5,
      lineHeight: 46,
    },
    overlayStatus: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.purpleMuted,
      marginTop: 4,
    },
    overlayMeta: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.lavenderSoft,
      marginTop: 6,
      marginBottom: 12,
    },
    overlayControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    overlayPlayBtn: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
    },
    overlayExtendBtn: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
    },
    changeRouteBtn: {
      borderRadius: 18,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.lavenderWash,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      marginBottom: 8,
    },
    changeRouteText: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.purple,
    },
    changeRouteBtnCompact: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.lavenderWash,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    changeRouteTextCompact: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.purple,
    },
    beginNapBtn: {
      backgroundColor: colors.gold,
      borderRadius: 18,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
      shadowColor: colors.gold,
      shadowOpacity: 0.45,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    beginNapBtnSecondary: {
      backgroundColor: colors.primary,
      shadowColor: colors.shadow,
      shadowOpacity: 0.18,
    },
    beginNapText: {
      color: colors.ink,
      fontSize: 17,
      fontWeight: '800',
      letterSpacing: 0.2,
    },
    beginNapTextSecondary: {
      color: colors.onPrimary,
    },
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
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.lavenderWash,
    },
    mainRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    ringWrap: { width: 80, height: 80 },
    ringCenter: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    timeText: {
      fontWeight: '800',
      fontSize: 18,
      lineHeight: 22,
      color: colors.purple,
    },
    controlsCol: { flex: 1 },
    progressTrack: {
      height: 6,
      borderRadius: 999,
      backgroundColor: colors.lavenderWash,
      overflow: 'hidden',
    },
    progressFill: { height: '100%', borderRadius: 999 },
    durationHint: {
      fontSize: 10,
      color: colors.lavenderSoft,
      marginTop: 8,
      marginBottom: 8,
    },
    controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    playBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.primary,
    },
    playBtnDisabled: {
      backgroundColor: colors.lavenderWash,
      opacity: 0.6,
    },
    playBtnText: { fontSize: 13, fontWeight: '700' },
    extendBtn: {
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: 999,
      backgroundColor: colors.gold,
    },
    extendBtnText: {
      fontSize: 14,
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
