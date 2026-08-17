import React, { createContext, useContext, useMemo } from 'react';
import { useNapSettings } from '../context/SettingsContext';
import {
  darkColors,
  darkMapStyle,
  lightColors,
  lightMapStyle,
  type ColorPalette,
} from './colors';

interface ThemeContextValue {
  colors: ColorPalette;
  darkMode: boolean;
  mapStyle: typeof lightMapStyle;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  darkMode: false,
  mapStyle: lightMapStyle,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useNapSettings();
  const darkMode = settings.darkMode;

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: darkMode ? darkColors : lightColors,
      darkMode,
      mapStyle: darkMode ? darkMapStyle : lightMapStyle,
    }),
    [darkMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export type { ColorPalette };
