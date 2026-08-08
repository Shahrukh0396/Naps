import { Platform, Vibration } from 'react-native';
import Sound from 'react-native-sound';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

type AlarmSound = {
  play: (cb?: (success: boolean) => void) => void;
  stop: (cb?: () => void) => void;
  setVolume: (v: number) => void;
  setNumberOfLoops: (n: number) => void;
  setCurrentTime: (t: number) => void;
  release?: () => void;
};

Sound.setCategory('Playback', true);

// Harsh repeating vibration pattern (ms)
const HARSH_PATTERN = [
  0, 500, 120, 500, 120, 700, 180, 500, 120, 500, 300,
];

/**
 * Android: android/app/src/main/res/raw/timer.mp3 → load as "timer.mp3" / "timer"
 * iOS: bundled Resources/timer.mp3 via MAIN_BUNDLE
 */
const TIMER_SOUND_FILE = 'timer.mp3';

let alarmSound: AlarmSound | null = null;
let hapticInterval: ReturnType<typeof setInterval> | null = null;
let active = false;

function triggerHarshHapticPulse() {
  try {
    ReactNativeHapticFeedback.trigger(
      Platform.OS === 'ios' ? 'notificationError' : 'impactHeavy',
      {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: true,
      },
    );
  } catch {
    // ignore
  }
}

function loadBundleSound(filename: string): Promise<AlarmSound> {
  return new Promise((resolve, reject) => {
    const sound = new Sound(filename, Sound.MAIN_BUNDLE, (error: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      sound.setVolume(1.0);
      sound.setNumberOfLoops(-1);
      resolve(sound as AlarmSound);
    });
  });
}

async function ensureSound(): Promise<AlarmSound> {
  if (alarmSound) return alarmSound;

  // Prefer res/raw (Android) / bundle resource (iOS) — user's timer.mp3
  try {
    alarmSound = await loadBundleSound(TIMER_SOUND_FILE);
    return alarmSound;
  } catch (firstErr) {
    // Some Android builds resolve raw resources without the extension
    try {
      alarmSound = await loadBundleSound('timer');
      return alarmSound;
    } catch {
      if (__DEV__) {
        console.warn('[napAlert] MAIN_BUNDLE timer.mp3 failed, trying require()', firstErr);
      }
      // Fallback: metro-bundled asset
      alarmSound = await new Promise<AlarmSound>((resolve, reject) => {
        const sound = new Sound(
          require('../../assets/sounds/timer.mp3'),
          (error: Error | null) => {
            if (error) {
              reject(error);
              return;
            }
            sound.setVolume(1.0);
            sound.setNumberOfLoops(-1);
            resolve(sound as AlarmSound);
          },
        );
      });
      return alarmSound;
    }
  }
}

export type NapAlertOptions = {
  /** When false, only haptics/vibration (used for early warning). Default true. */
  withSound?: boolean;
};

/** Start alert — loops timer.mp3 (by default) + harsh haptic until stopNapAlert(). */
export async function startNapAlert(options: NapAlertOptions = {}): Promise<void> {
  const withSound = options.withSound !== false;
  if (active) return;
  active = true;

  try {
    Vibration.vibrate(HARSH_PATTERN, true);
  } catch {
    // ignore
  }

  triggerHarshHapticPulse();
  hapticInterval = setInterval(() => {
    if (!active) return;
    triggerHarshHapticPulse();
  }, 700);

  if (!withSound) return;

  try {
    const sound = await ensureSound();
    if (!active) return;
    sound.stop(() => {
      sound.setCurrentTime(0);
      sound.play((success: boolean) => {
        if (!success && __DEV__) {
          console.warn('[napAlert] timer.mp3 playback failed');
        }
      });
    });
  } catch (err) {
    if (__DEV__) console.warn('[napAlert] timer.mp3 load failed', err);
  }
}

/** Stop timer.mp3 + haptics. */
export function stopNapAlert(): void {
  active = false;

  if (hapticInterval) {
    clearInterval(hapticInterval);
    hapticInterval = null;
  }

  try {
    Vibration.cancel();
  } catch {
    // ignore
  }

  if (alarmSound) {
    try {
      alarmSound.stop();
    } catch {
      // ignore
    }
  }
}

export function isNapAlertActive(): boolean {
  return active;
}
