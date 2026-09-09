import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { stopNativeNavigation } from '../services/napNavigation';
import {
  endActiveNap,
  loadActiveNap,
  saveActiveNap,
  type ActiveNapSession,
} from '../services/napSession';

interface NapSessionContextValue {
  session: ActiveNapSession | null;
  refresh: () => Promise<ActiveNapSession | null>;
  persist: (next: ActiveNapSession) => Promise<void>;
  endSession: () => Promise<void>;
}

const NapSessionContext = createContext<NapSessionContextValue>({
  session: null,
  refresh: async () => null,
  persist: async () => {},
  endSession: async () => {},
});

export function NapSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<ActiveNapSession | null>(null);

  const refresh = useCallback(async () => {
    const next = await loadActiveNap();
    setSession(next);
    return next;
  }, []);

  const persist = useCallback(async (next: ActiveNapSession) => {
    setSession(next);
    await saveActiveNap(next);
  }, []);

  const endSession = useCallback(async () => {
    setSession(null);
    await stopNativeNavigation();
    await endActiveNap();
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const value = useMemo(
    () => ({ session, refresh, persist, endSession }),
    [session, refresh, persist, endSession],
  );

  return (
    <NapSessionContext.Provider value={value}>
      {children}
    </NapSessionContext.Provider>
  );
}

export function useNapSession() {
  return useContext(NapSessionContext);
}
