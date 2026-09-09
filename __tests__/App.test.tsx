/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {
    GOOGLE_MAPS_API_KEY: 'test-maps-key',
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native-screens', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    enableScreens: jest.fn(),
    Screen: View,
    ScreenContainer: View,
    NativeScreen: View,
    NativeScreenContainer: View,
    FullWindowOverlay: View,
  };
});

jest.mock('react-native-sound', () => {
  const Sound = jest.fn().mockImplementation((_src, cb) => {
    if (typeof cb === 'function') cb();
    return {
      play: jest.fn(),
      stop: jest.fn(cb2 => cb2 && cb2()),
      setVolume: jest.fn(),
      setNumberOfLoops: jest.fn(),
      setCurrentTime: jest.fn(),
      release: jest.fn(),
    };
  });
  // @ts-expect-error mock static
  Sound.setCategory = jest.fn();
  // @ts-expect-error mock static
  Sound.MAIN_BUNDLE = '';
  return Sound;
});

jest.mock('react-native-haptic-feedback', () => ({
  __esModule: true,
  default: { trigger: jest.fn() },
}));

jest.mock('@googlemaps/react-native-navigation-sdk', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Mock = (props: { children?: React.ReactNode }) =>
    React.createElement(View, props, props.children);
  return {
    __esModule: true,
    NavigationProvider: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    NavigationView: Mock,
    MapView: Mock,
    TaskRemovedBehavior: { CONTINUE_SERVICE: 0, QUIT_SERVICE: 1 },
    MapColorScheme: { FOLLOW_SYSTEM: 0, LIGHT: 1, DARK: 2 },
    NavigationNightMode: { AUTO: 0, FORCE_DAY: 1, FORCE_NIGHT: 2 },
    NavigationUIEnabledPreference: { AUTOMATIC: 0, DISABLED: 1 },
    AudioGuidance: { SILENT: 0, VIBRATION: 1, VOICE_ALERTS_AND_GUIDANCE: 4, BLUETOOTH_AUDIO: 8 },
    TravelMode: { DRIVING: 0 },
    RouteStatus: { OK: 'OK' },
    NavigationSessionStatus: { OK: 'ok' },
    useNavigation: () => ({
      navigationController: {
        areTermsAccepted: jest.fn(() => Promise.resolve(true)),
        init: jest.fn(() => Promise.resolve('ok')),
        startUpdatingLocation: jest.fn(() => Promise.resolve()),
        stopUpdatingLocation: jest.fn(),
        setBackgroundLocationUpdatesEnabled: jest.fn(),
        setDestinations: jest.fn(() => Promise.resolve('OK')),
        startGuidance: jest.fn(() => Promise.resolve()),
        stopGuidance: jest.fn(() => Promise.resolve()),
        clearDestinations: jest.fn(() => Promise.resolve()),
        setAudioGuidanceType: jest.fn(),
        showTermsAndConditionsDialog: jest.fn(() => Promise.resolve(true)),
        continueToNextDestination: jest.fn(() => Promise.resolve({})),
      },
      setOnArrival: jest.fn(),
      setOnLocationChanged: jest.fn(),
      setOnRouteChanged: jest.fn(),
      setOnReroutingRequestedByOffRoute: jest.fn(),
      setOnRemainingTimeOrDistanceChanged: jest.fn(),
      setOnTurnByTurn: jest.fn(),
      removeAllListeners: jest.fn(),
    }),
  };
});

jest.mock('@react-native-community/geolocation', () => ({
  getCurrentPosition: jest.fn(),
  requestAuthorization: jest.fn(),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement(View, props, children);
});

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Mock = (props: object) => React.createElement(View, props);
  return {
    __esModule: true,
    default: Mock,
    Svg: Mock,
    Circle: Mock,
    Ellipse: Mock,
    Line: Mock,
    Path: Mock,
    G: Mock,
    Rect: Mock,
  };
});

test('renders correctly', async () => {
  const App = require('../App').default;
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });
});
