import { NativeModules } from 'react-native';

type KeepAwakeNative = {
  activate?: () => void;
  deactivate?: () => void;
};

const Native = NativeModules.NapsKeepAwake as KeepAwakeNative | undefined;

export function activateKeepAwake() {
  try {
    Native?.activate?.();
  } catch {
    // Keep-awake must never block starting a ride.
  }
}

export function deactivateKeepAwake() {
  try {
    Native?.deactivate?.();
  } catch {
    // ignore
  }
}
