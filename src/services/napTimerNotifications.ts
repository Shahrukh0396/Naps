import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

const Native = NativeModules.NapTimerNotifications as
  | {
      requestPermission: () => Promise<boolean>;
      schedule: (options: {
        warningAtMs: number;
        endsAtMs: number;
        warningTitle: string;
        warningBody: string;
        endTitle: string;
        endBody: string;
      }) => Promise<void>;
      cancel: () => Promise<void>;
    }
  | undefined;

export type ArmNapAlertsParams = {
  endsAt: number;
  alertAtMinutes: number;
  enabled: boolean;
};

function hasNativeModule(): boolean {
  return Native != null && typeof Native.schedule === 'function';
}

export async function requestNapNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
      const granted = await PermissionsAndroid.request(
        'android.permission.POST_NOTIFICATIONS',
        {
          title: 'Nap alerts',
          message:
            'Naps needs notifications so the timer can warn you while Google Maps is open.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  }

  if (!hasNativeModule() || !Native) return false;
  try {
    return await Native.requestPermission();
  } catch {
    return false;
  }
}

export async function cancelNapAlerts(): Promise<void> {
  if (!hasNativeModule() || !Native) return;
  try {
    await Native.cancel();
  } catch {
    // Native module may be missing until a rebuild.
  }
}

/** Schedule OS local notifications that fire even if Naps is backgrounded or killed. */
export async function armNapAlerts(
  params: ArmNapAlertsParams,
): Promise<void> {
  if (!params.enabled || params.endsAt <= Date.now()) {
    await cancelNapAlerts();
    return;
  }

  const allowed = await requestNapNotificationPermission();
  if (!allowed) return;
  if (!hasNativeModule() || !Native) {
    if (__DEV__) {
      console.warn(
        '[napTimer] Native notifications unavailable — rebuild the iOS/Android app.',
      );
    }
    return;
  }

  const warningAtMs =
    params.alertAtMinutes > 0
      ? params.endsAt - params.alertAtMinutes * 60 * 1000
      : 0;
  const warningBody =
    params.alertAtMinutes > 0
      ? `${params.alertAtMinutes} min left — start heading back`
      : '';

  try {
    await Native.schedule({
      warningAtMs: warningAtMs > Date.now() + 1500 ? warningAtMs : 0,
      endsAtMs: params.endsAt,
      warningTitle: 'Naps',
      warningBody,
      endTitle: 'Naps',
      endBody: 'Nap time is up — head to your destination!',
    });
  } catch (err) {
    if (__DEV__) console.warn('[napTimer] schedule failed', err);
  }
}
