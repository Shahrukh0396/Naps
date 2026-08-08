module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-screens|react-native-safe-area-context|react-native-gesture-handler|react-native-svg|react-native-linear-gradient|react-native-maps|@react-native-community|@react-native-async-storage)/)',
  ],
};
