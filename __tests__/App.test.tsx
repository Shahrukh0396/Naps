/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

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

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Mock = (props: object) => React.createElement(View, props);
  return {
    __esModule: true,
    default: Mock,
    Marker: Mock,
    Polyline: Mock,
    PROVIDER_GOOGLE: 'google',
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
