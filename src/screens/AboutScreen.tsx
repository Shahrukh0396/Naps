import React, { useMemo } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GradientBackground from '../components/GradientBackground';
import type { AboutScreenProps } from '../navigation/types';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';

const FEATURES = [
  {
    emoji: '🧭',
    title: 'Smart Loop Routes',
    desc: 'Naps generates a looping drive so you end up back home when the nap ends.',
  },
  {
    emoji: '📍',
    title: 'GPS-Powered',
    desc: 'Uses your location to match neighborhood roads and timing.',
  },
  {
    emoji: '⏱',
    title: 'Nap Timer',
    desc: 'Built-in timer with alerts so you never overshoot the nap.',
  },
  {
    emoji: '🌙',
    title: 'Route Styles',
    desc: 'Highway, Scenic, No Highway, or Fewer Stops.',
  },
];

export default function AboutScreen({ navigation }: AboutScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <GradientBackground style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 20,
        }}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back to Naps</Text>
        </Pressable>
        <Text style={styles.heroEmoji}>🌙</Text>
        <Text style={styles.h1}>The nap drive app{'\n'}every parent needs</Text>
        <Text style={styles.lead}>
          Naps generates a perfect looping GPS route for your baby’s nap — so you
          always end up back home right when they wake up.
        </Text>
        <Pressable
          style={styles.cta}
          onPress={() => navigation.navigate('MainTabs', { screen: 'Home' })}>
          <Text style={styles.ctaText}>Open the App</Text>
        </Pressable>
        <Pressable
          style={styles.secondary}
          onPress={() => Linking.openURL('mailto:lilmagdev@gmail.com')}>
          <Text style={styles.secondaryText}>Contact Us</Text>
        </Pressable>

        <Text style={styles.h2}>Why parents love it</Text>
        {FEATURES.map(f => (
          <View key={f.title} style={styles.feature}>
            <Text style={styles.featureEmoji}>{f.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.featureTitle}>{f.title}</Text>
              <Text style={styles.featureDesc}>{f.desc}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </GradientBackground>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    back: { color: colors.purpleMuted, fontSize: 14, marginBottom: 24 },
    heroEmoji: { fontSize: 56, textAlign: 'center', marginBottom: 12 },
    h1: {
      fontSize: 28,
      fontWeight: '900',
      color: colors.purple,
      textAlign: 'center',
      lineHeight: 34,
      marginBottom: 12,
    },
    lead: {
      fontSize: 16,
      color: colors.purpleMuted,
      textAlign: 'center',
      lineHeight: 24,
      marginBottom: 24,
    },
    cta: {
      backgroundColor: colors.primary,
      borderRadius: 999,
      paddingVertical: 14,
      alignItems: 'center',
      marginBottom: 10,
    },
    ctaText: { color: colors.onPrimary, fontWeight: '800', fontSize: 16 },
    secondary: {
      backgroundColor: colors.surfaceGlass,
      borderRadius: 999,
      paddingVertical: 14,
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      marginBottom: 36,
    },
    secondaryText: { color: colors.purple, fontWeight: '700', fontSize: 16 },
    h2: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.purple,
      textAlign: 'center',
      marginBottom: 16,
    },
    feature: {
      flexDirection: 'row',
      gap: 12,
      backgroundColor: colors.surfaceGlass,
      borderRadius: 16,
      padding: 14,
      marginBottom: 10,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    featureEmoji: { fontSize: 22 },
    featureTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.purple,
      marginBottom: 4,
    },
    featureDesc: { fontSize: 13, color: colors.purpleMuted, lineHeight: 18 },
  });
}
