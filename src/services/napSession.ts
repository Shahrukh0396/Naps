import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RouteResult, RouteStyleId } from '../types/route';
import { cancelNapAlerts } from './napTimerNotifications';

const STORAGE_KEY = 'naps-active-ride';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface ActiveNapSession {
  route: RouteResult;
  destinationLabel: string | null;
  destination?: string | null;
  plannedOrigin?: { lat: number; lng: number };
  activeStyle: RouteStyleId;
  mapsOpened: boolean;
  plannedMinutes: number;
  totalSeconds: number;
  endsAt: number | null;
  running: boolean;
  secondsLeft: number;
  savedAt: number;
}

export function remainingSeconds(session: ActiveNapSession): number {
  if (session.running && session.endsAt != null) {
    return Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000));
  }
  return Math.max(0, session.secondsLeft);
}

export function formatNapRemaining(session: ActiveNapSession): string {
  const secs = remainingSeconds(session);
  if (secs <= 0) return 'Nap time is up';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')} left`;
}

export function navigateParamsFromSession(session: ActiveNapSession) {
  return {
    route: session.route,
    durationMinutes: Math.max(1, Math.round(session.totalSeconds / 60)),
    destinationLabel: session.destinationLabel,
    destination: session.destination,
    plannedOrigin: session.plannedOrigin,
    activeStyle: session.activeStyle,
    napStarted: session.running || session.mapsOpened,
    initialEndsAt: session.running ? session.endsAt ?? undefined : undefined,
    initialTotalSeconds: session.totalSeconds,
    initialSecondsLeft: session.running ? undefined : session.secondsLeft,
  };
}

export function isNapSessionFresh(session: ActiveNapSession): boolean {
  if (Date.now() - session.savedAt > MAX_AGE_MS) return false;
  const left = remainingSeconds(session);
  if (session.running) return true;
  // Keep a recently finished nap so the user still sees the end state.
  if (left === 0 && Date.now() - session.savedAt < 45 * 60 * 1000) return true;
  return left > 0;
}

export async function saveActiveNap(session: ActiveNapSession): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

export async function loadActiveNap(): Promise<ActiveNapSession | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveNapSession;
    if (!parsed?.route || typeof parsed.totalSeconds !== 'number') return null;
    if (!isNapSessionFresh(parsed)) {
      await clearActiveNap();
      return null;
    }
    return {
      ...parsed,
      secondsLeft: remainingSeconds(parsed),
    };
  } catch {
    return null;
  }
}

export async function clearActiveNap(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export async function endActiveNap(): Promise<void> {
  await clearActiveNap();
  await cancelNapAlerts();
}
