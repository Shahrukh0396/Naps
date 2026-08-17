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

export type SavedPlaceKind = 'home' | 'work' | 'custom';

export interface SavedPlace {
  id: string;
  kind: SavedPlaceKind;
  label: string;
  address: string;
}

export interface NapSettings {
  savedPlaces: SavedPlace[];
  defaultRouteType: RouteStyleId;
  defaultDuration: number;
  notifyAtMinutes: number;
  notificationsEnabled: boolean;
  darkMode: boolean;
}

const DEFAULT_SETTINGS: NapSettings = {
  savedPlaces: [],
  defaultRouteType: 'highway',
  defaultDuration: 30,
  notifyAtMinutes: 5,
  notificationsEnabled: true,
  darkMode: false,
};

const STORAGE_KEY = 'naps-settings';

const HOME_ID = 'place-home';
const WORK_ID = 'place-work';

export function createHomePlace(address = ''): SavedPlace {
  return { id: HOME_ID, kind: 'home', label: 'Home', address };
}

export function createWorkPlace(address = ''): SavedPlace {
  return { id: WORK_ID, kind: 'work', label: 'Work', address };
}

export function createCustomPlace(
  label = '',
  address = '',
  id?: string,
): SavedPlace {
  return {
    id: id ?? `place-custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'custom',
    label,
    address,
  };
}

/** Places with a non-empty address, ready for suggestions. */
export function placesWithAddress(places: SavedPlace[]): SavedPlace[] {
  return places.filter(p => p.address.trim().length > 0);
}

function normalizeSavedPlaces(places: SavedPlace[]): SavedPlace[] {
  const home = places.find(p => p.kind === 'home');
  const work = places.find(p => p.kind === 'work');
  const customs = places.filter(p => p.kind === 'custom');
  const out: SavedPlace[] = [];
  if (home) {
    out.push({
      ...home,
      id: HOME_ID,
      label: 'Home',
    });
  }
  if (work) {
    out.push({
      ...work,
      id: WORK_ID,
      label: 'Work',
    });
  }
  out.push(...customs);
  return out;
}

/** Drop empty-address places before persist; keep structure for fixed slots via UI draft. */
export function sanitizeSavedPlacesForSave(places: SavedPlace[]): SavedPlace[] {
  return normalizeSavedPlaces(
    places.filter(p => {
      if (p.kind === 'custom') {
        return p.address.trim().length > 0 || p.label.trim().length > 0;
      }
      return p.address.trim().length > 0;
    }),
  ).map(p => ({
    ...p,
    label: p.kind === 'custom' ? p.label.trim() || 'Place' : p.label,
    address: p.address.trim(),
  })).filter(p => p.address.length > 0);
}

type LegacyStored = Partial<NapSettings> & { homeAddress?: string };

function migrateStored(raw: LegacyStored): NapSettings {
  const {
    homeAddress,
    savedPlaces: storedPlaces,
    defaultRouteType,
    defaultDuration,
    notifyAtMinutes,
    notificationsEnabled,
    darkMode,
  } = raw;

  let savedPlaces: SavedPlace[] = Array.isArray(storedPlaces)
    ? normalizeSavedPlaces(storedPlaces)
    : [];

  if (
    typeof homeAddress === 'string' &&
    homeAddress.trim() &&
    !savedPlaces.some(p => p.kind === 'home')
  ) {
    savedPlaces = [createHomePlace(homeAddress.trim()), ...savedPlaces];
  }

  return {
    ...DEFAULT_SETTINGS,
    savedPlaces,
    ...(defaultRouteType != null ? { defaultRouteType } : {}),
    ...(defaultDuration != null ? { defaultDuration } : {}),
    ...(notifyAtMinutes != null ? { notifyAtMinutes } : {}),
    ...(notificationsEnabled != null ? { notificationsEnabled } : {}),
    ...(typeof darkMode === 'boolean' ? { darkMode } : {}),
  };
}

interface SettingsContextValue {
  settings: NapSettings;
  ready: boolean;
  updateSettings: (next: NapSettings) => Promise<void>;
  setDarkMode: (darkMode: boolean) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  ready: false,
  updateSettings: async () => {},
  setDarkMode: async () => {},
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
          const migrated = migrateStored(JSON.parse(raw) as LegacyStored);
          setSettings(migrated);
          // Rewrite storage without legacy homeAddress
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
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

  const persist = useCallback(async (next: NapSettings) => {
    setSettings(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const updateSettings = useCallback(
    async (next: NapSettings) => {
      const cleaned: NapSettings = {
        ...next,
        savedPlaces: sanitizeSavedPlacesForSave(next.savedPlaces),
      };
      await persist(cleaned);
    },
    [persist],
  );

  const setDarkMode = useCallback(async (darkMode: boolean) => {
    setSettings(prev => {
      const next = { ...prev, darkMode };
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ settings, ready, updateSettings, setDarkMode }),
    [settings, ready, updateSettings, setDarkMode],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useNapSettings() {
  return useContext(SettingsContext);
}

export { DEFAULT_SETTINGS };
