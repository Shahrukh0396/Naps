import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GradientBackground from '../components/GradientBackground';
import { SUPPORT_FAQS } from '../constants/content';
import type { SupportScreenProps } from '../navigation/types';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';

export default function SupportScreen({ navigation }: SupportScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <GradientBackground style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingBottom: Math.max(insets.bottom, 8) + 96,
          paddingHorizontal: 20,
        }}>
        <Text style={styles.emoji}>🌙</Text>
        <Text style={styles.h1}>How can we help?</Text>
        <Text style={styles.lead}>Browse the FAQs below or reach out directly.</Text>

        {SUPPORT_FAQS.map((item, i) => {
          const open = openIndex === i;
          return (
            <View key={item.q} style={styles.faq}>
              <Pressable
                onPress={() => setOpenIndex(open ? null : i)}
                style={styles.faqBtn}>
                <Text style={styles.faqQ}>{item.q}</Text>
                <Text style={styles.chev}>{open ? '▴' : '▾'}</Text>
              </Pressable>
              {open && <Text style={styles.faqA}>{item.a}</Text>}
            </View>
          );
        })}

        <Pressable
          style={styles.mailBtn}
          onPress={() => Linking.openURL('mailto:lilmagdev@gmail.com')}>
          <Text style={styles.mailText}>📧 Email support</Text>
        </Pressable>
        <Pressable
          style={styles.aboutBtn}
          onPress={() => navigation.navigate('About')}>
          <Text style={styles.aboutText}>About Naps →</Text>
        </Pressable>
      </ScrollView>
    </GradientBackground>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    emoji: { fontSize: 48, textAlign: 'center', marginBottom: 8, marginTop: 8 },
    h1: {
      fontSize: 28,
      fontWeight: '800',
      color: colors.purple,
      textAlign: 'center',
      marginBottom: 8,
    },
    lead: {
      fontSize: 15,
      color: colors.purpleMuted,
      textAlign: 'center',
      marginBottom: 28,
    },
    faq: {
      backgroundColor: colors.surfaceGlass,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      borderRadius: 14,
      marginBottom: 10,
      overflow: 'hidden',
    },
    faqBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      gap: 12,
    },
    faqQ: {
      flex: 1,
      fontWeight: '700',
      fontSize: 15,
      color: colors.purple,
    },
    chev: { color: colors.purpleMuted, fontSize: 16 },
    faqA: {
      paddingHorizontal: 16,
      paddingBottom: 16,
      fontSize: 14,
      color: colors.purpleMuted,
      lineHeight: 22,
    },
    mailBtn: {
      marginTop: 16,
      backgroundColor: colors.primary,
      borderRadius: 999,
      paddingVertical: 14,
      alignItems: 'center',
    },
    mailText: { color: colors.onPrimary, fontWeight: '800', fontSize: 15 },
    aboutBtn: {
      marginTop: 12,
      paddingVertical: 14,
      alignItems: 'center',
      borderRadius: 999,
      backgroundColor: colors.surfaceGlass,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    aboutText: { color: colors.purple, fontWeight: '700', fontSize: 14 },
  });
}
