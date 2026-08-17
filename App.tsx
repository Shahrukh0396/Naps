/**
 * Naps — React Native (Phase 1: frontend + mocks)
 * @format
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SettingsProvider } from './src/context/SettingsContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import RootNavigator from './src/navigation/RootNavigator';

function ThemedStatusBar() {
  const { colors } = useTheme();
  return (
    <StatusBar
      barStyle={colors.statusBar}
      backgroundColor="transparent"
      translucent
    />
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <ThemeProvider>
          <ThemedStatusBar />
          <RootNavigator />
        </ThemeProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

export default App;
