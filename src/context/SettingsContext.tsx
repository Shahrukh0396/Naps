import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RouteStyleId } from '../types/route';

export interface NapSettings {
  homeAddress: string;
  defaultRouteType: RouteStyleId;
  defaultDuration: number;
  notifyAtMinutes: number;
  notificationsEnabled: boolean;
}

const DEFAULT_SETTINGS: NapSettings = {
  homeAddress: '',
  defaultRouteType: 'highway',
  defaultDuration: 30,
  notifyAtMinutes: 5,
  notificationsEnabled: true,
};

const STORAGE_KEY = 'naps-settings';

interface SettingsContextValue {
  settings: NapSettings;
  ready: boolean;
  updateSettings: (next: NapSettings) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  ready: false,
  updateSettings: async () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<NapSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback(async (next: NapSettings) => {
    setSettings(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ settings, ready, updateSettings }),
    [settings, ready, updateSettings],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useNapSettings() {
  return useContext(SettingsContext);
}

export { DEFAULT_SETTINGS };
