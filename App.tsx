/**
 * Naps — React Native
 * @format
 */

import React, { useEffect } from 'react';
import { AppState, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  NavigationProvider,
  TaskRemovedBehavior,
  useNavigation,
} from '@googlemaps/react-native-navigation-sdk';
import { SettingsProvider } from './src/context/SettingsContext';
import { AlertProvider } from './src/context/AlertContext';
import { NapSessionProvider } from './src/context/NapSessionContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import RootNavigator from './src/navigation/RootNavigator';
import {
  bindNavigationController,
  isNativeLocationTracking,
  prepareNativeMaps,
  releaseNativeLocation,
} from './src/services/napNavigation';

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

function NavigationBootstrap() {
  const { navigationController } = useNavigation();

  useEffect(() => {
    bindNavigationController(navigationController);
    void prepareNativeMaps(navigationController);
  }, [navigationController]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') return;
      if (isNativeLocationTracking()) return;
      releaseNativeLocation(navigationController);
    });
    return () => sub.remove();
  }, [navigationController]);

  return null;
}

function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <ThemeProvider>
          <NavigationProvider
            termsAndConditionsDialogOptions={{
              title: 'Naps navigation',
              companyName: 'Naps',
              showOnlyDisclaimer: false,
              uiParams: {
                backgroundColor: '#FFF8F0',
                titleColor: '#2D1B69',
                mainTextColor: '#2D1B69',
                acceptButtonTextColor: '#2D1B69',
                cancelButtonTextColor: '#6B5A9E',
              },
            }}
            taskRemovedBehavior={TaskRemovedBehavior.QUIT_SERVICE}>
            <NavigationBootstrap />
            <AlertProvider>
              <NapSessionProvider>
                <ThemedStatusBar />
                <RootNavigator />
              </NapSessionProvider>
            </AlertProvider>
          </NavigationProvider>
        </ThemeProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

export default App;
