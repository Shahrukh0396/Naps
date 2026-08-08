/**
 * Naps — React Native (Phase 1: frontend + mocks)
 * @format
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SettingsProvider } from './src/context/SettingsContext';
import RootNavigator from './src/navigation/RootNavigator';

function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
        <RootNavigator />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

export default App;
