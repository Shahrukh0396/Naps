import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../theme/ThemeContext';

/** Matches web: linear-gradient(160deg, #C4B5F4 0%, #D9B8F0 40%, #F9C5D1 100%) */
export default function GradientBackground({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <LinearGradient
      colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]}
      locations={[0, 0.4, 1]}
      // ~160deg: slightly angled top → bottom
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={[styles.root, style]}>
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
