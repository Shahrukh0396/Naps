import React, { createContext, useContext, useMemo } from 'react';
import { useNapSettings } from '../context/SettingsContext';
import {
  darkColors,
  darkMapStyle,
  lightColors,
  lightMapStyle,
  navDarkMapStyle,
  navLightMapStyle,
  type ColorPalette,
} from './colors';

interface ThemeContextValue {
  colors: ColorPalette;
  darkMode: boolean;
  mapStyle: typeof lightMapStyle;
  navMapStyle: typeof navLightMapStyle;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  darkMode: false,
  mapStyle: lightMapStyle,
  navMapStyle: navLightMapStyle,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { darkMode } = useNapSettings();

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: darkMode ? darkColors : lightColors,
      darkMode,
      mapStyle: darkMode ? darkMapStyle : lightMapStyle,
      navMapStyle: darkMode ? navDarkMapStyle : navLightMapStyle,
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
