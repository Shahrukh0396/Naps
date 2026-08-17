import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GradientBackground from '../components/GradientBackground';
import type { LandingScreenProps } from '../navigation/types';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';

const LOAD_DURATION_MS = 2200;

export default function LandingScreen({ navigation }: LandingScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const progress = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.88)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 7,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.timing(progress, {
      toValue: 1,
      duration: LOAD_DURATION_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        navigation.replace('MainTabs');
      }
    });
  }, [logoOpacity, logoScale, navigation, progress]);

  const barWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <GradientBackground style={styles.root}>
      <View style={styles.center}>
        <Animated.View
          style={[
            styles.logoWrap,
            {
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            },
          ]}>
          <Text style={styles.logoEmoji} accessibilityLabel="Naps logo">
            🌙
          </Text>
          <Text style={styles.brand}>Naps</Text>
        </Animated.View>
      </View>

      <View style={[styles.progressSection, { paddingBottom: Math.max(insets.bottom, 12) + 28 }]}>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { width: barWidth }]} />
        </View>
      </View>
    </GradientBackground>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoWrap: {
      alignItems: 'center',
      gap: 10,
    },
    logoEmoji: {
      fontSize: 72,
      lineHeight: 84,
    },
    brand: {
      fontSize: 42,
      fontWeight: '800',
      color: colors.purple,
      letterSpacing: -1,
    },
    progressSection: {
      paddingHorizontal: 48,
    },
    track: {
      height: 6,
      borderRadius: 999,
      backgroundColor: colors.progressTrack,
      borderWidth: 1,
      borderColor: colors.lavenderBorder,
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: colors.gold,
    },
  });
}
