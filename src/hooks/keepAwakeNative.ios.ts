import {
  activateKeepAwake as activate,
  deactivateKeepAwake as deactivate,
} from '@sayem314/react-native-keep-awake';

export function activateKeepAwake() {
  try {
    activate();
  } catch {
    // Keep-awake must never block starting a ride.
  }
}

export function deactivateKeepAwake() {
  try {
    deactivate();
  } catch {
    // ignore
  }
}
