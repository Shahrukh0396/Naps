type LeavePrompt = (proceed: () => void) => void;

let dirty = false;
let promptLeave: LeavePrompt | null = null;

export function setSettingsLeaveGuard(next: {
  dirty: boolean;
  prompt: LeavePrompt;
} | null) {
  dirty = next?.dirty ?? false;
  promptLeave = next?.prompt ?? null;
}

/** Returns true when leave was blocked and the unsaved-changes prompt was shown. */
export function blockLeaveIfSettingsDirty(proceed: () => void): boolean {
  if (!dirty || !promptLeave) return false;
  promptLeave(proceed);
  return true;
}

type NavState = {
  index?: number;
  routes?: Array<{ name: string; state?: NavState }>;
};

export function isNamedTabFocused(
  state: NavState | undefined,
  name: string,
): boolean {
  let current: NavState | undefined = state;
  while (current?.routes && current.routes.length > 0) {
    const route = current.routes[current.index ?? 0];
    if (!route) break;
    if (route.name === name) return true;
    current = route.state;
  }
  return false;
}
