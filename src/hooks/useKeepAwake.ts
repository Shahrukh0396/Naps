import { useEffect } from 'react';
import {
  activateKeepAwake,
  deactivateKeepAwake,
} from './keepAwakeNative';

let holders = 0;

function acquireKeepAwake() {
  holders += 1;
  if (holders === 1) activateKeepAwake();
}

function releaseKeepAwake() {
  holders = Math.max(0, holders - 1);
  if (holders === 0) deactivateKeepAwake();
}

/** Keep the screen on while `enabled` is true. Safe to use in more than one place. */
export function useKeepAwakeWhile(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    acquireKeepAwake();
    return () => {
      releaseKeepAwake();
    };
  }, [enabled]);
}
