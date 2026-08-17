import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path } from 'react-native-svg';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';

export default function MockMap({ height = 220 }: { height?: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.wrap, { height }]}>
      <View style={styles.gradient} />
      <Svg width="100%" height="100%" viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice">
        <Line x1="0" y1="90" x2="400" y2="90" stroke="#c8d8e8" strokeWidth="8" strokeLinecap="round" />
        <Line x1="200" y1="0" x2="200" y2="180" stroke="#c8d8e8" strokeWidth="6" strokeLinecap="round" />
        <Line x1="0" y1="45" x2="400" y2="45" stroke="#d8e8d8" strokeWidth="4" strokeLinecap="round" />
        <Line x1="0" y1="135" x2="400" y2="135" stroke="#d8e8d8" strokeWidth="4" strokeLinecap="round" />
        <Line x1="100" y1="0" x2="100" y2="180" stroke="#d8e8d8" strokeWidth="4" strokeLinecap="round" />
        <Line x1="300" y1="0" x2="300" y2="180" stroke="#d8e8d8" strokeWidth="4" strokeLinecap="round" />
        <Ellipse cx="60" cy="60" rx="30" ry="20" fill="#b8ddb8" fillOpacity="0.5" />
        <Ellipse cx="340" cy="130" rx="25" ry="18" fill="#b8ddb8" fillOpacity="0.5" />
        <Ellipse cx="250" cy="40" rx="20" ry="14" fill="#b8ddb8" fillOpacity="0.4" />
        <Ellipse cx="150" cy="150" rx="35" ry="15" fill="#a8c8e8" fillOpacity="0.4" />
        <Path
          d="M 40 90 Q 100 40 160 80 Q 220 120 280 70 Q 330 30 370 60"
          stroke={colors.gold}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="8 6"
          fill="none"
        />
        <Circle cx="40" cy="90" r="7" fill={colors.purple} />
        <Circle cx="40" cy="90" r="4" fill="white" />
        <Circle cx="370" cy="60" r="7" fill={colors.gold} />
        <Circle cx="370" cy="60" r="4" fill="white" />
      </Svg>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>Route preview · mock</Text>
      </View>
    </View>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    wrap: {
      width: '100%',
      overflow: 'hidden',
      borderRadius: 24,
      backgroundColor: colors.mapBg,
    },
    gradient: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.lavenderWash,
      opacity: 0.85,
    },
    badge: {
      position: 'absolute',
      bottom: 10,
      right: 12,
      backgroundColor: colors.overlay,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
    },
    badgeText: {
      fontSize: 10,
      color: colors.purpleMuted,
      fontWeight: '600',
    },
  });
}
