import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GradientBackground from '../components/GradientBackground';
import type { PrivacyScreenProps } from '../navigation/types';
import { colors } from '../theme/colors';

export default function PrivacyScreen({ navigation }: PrivacyScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <GradientBackground style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 20,
        }}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.h1}>Privacy Policy</Text>
        <Text style={styles.p}>
          Naps uses your location only to calculate nap-drive routes in real time.
          Location data is not stored on our servers or sold to third parties.
        </Text>
        <Text style={styles.p}>
          Settings you save (home address, defaults, alert preferences) stay on
          this device via local storage.
        </Text>
        <Text style={styles.p}>
          When Google Maps or Spotify integrations are enabled in a later phase,
          those services process data under their own privacy policies. You can
          disconnect Spotify at any time from the results screen.
        </Text>
        <Text style={styles.p}>
          Questions? Email lilmagdev@gmail.com.
        </Text>
      </ScrollView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  back: { color: colors.purpleMuted, fontSize: 14, marginBottom: 20 },
  h1: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.purple,
    marginBottom: 16,
  },
  p: {
    fontSize: 14,
    color: colors.purpleMuted,
    lineHeight: 22,
    marginBottom: 14,
  },
});
