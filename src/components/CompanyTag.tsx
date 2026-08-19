import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COMPANY_COPYRIGHT, COMPANY_TAGLINE } from '../constants/content';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';

export default function CompanyTag() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${COMPANY_TAGLINE}. ${COMPANY_COPYRIGHT}`}>
      <Text style={styles.powered}>{COMPANY_TAGLINE}</Text>
      <Text style={styles.copy}>{COMPANY_COPYRIGHT}</Text>
    </View>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    wrap: {
      alignItems: 'center',
      gap: 2,
    },
    powered: {
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.2,
      color: colors.lavenderSoft,
      textAlign: 'center',
    },
    copy: {
      fontSize: 10,
      fontWeight: '500',
      color: colors.footerHint,
      textAlign: 'center',
    },
  });
}
