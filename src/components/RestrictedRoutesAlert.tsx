import React, { useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { RestrictedRouteOption } from '../types/route';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';

interface RestrictedRoutesAlertProps {
  visible: boolean;
  options: RestrictedRouteOption[];
  onSelect: (option: RestrictedRouteOption) => void;
  onDismiss: () => void;
}

export default function RestrictedRoutesAlert({
  visible,
  options,
  onSelect,
  onDismiss,
}: RestrictedRoutesAlertProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.kicker}>Unsafe areas nearby</Text>
          <Text style={styles.title}>No fully clear nap route</Text>
          <Text style={styles.body}>
            Every loop we found still passes near a restricted area, crime,
            fire, or other incident. These stay the farthest away — pick one to
            preview on the map.
          </Text>

          {options.length === 0 ? (
            <Text style={styles.empty}>
              No alternate loops were available. Try a different start point or
              nap length.
            </Text>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}>
              {options.map(option => (
                <Pressable
                  key={option.styleId}
                  onPress={() => onSelect(option)}
                  style={styles.option}>
                  <View style={styles.optionTop}>
                    <Text style={styles.optionTitle}>
                      {option.variant.emoji} {option.variant.label}
                    </Text>
                    <Text style={styles.optionTime}>
                      {option.variant.durationText}
                    </Text>
                  </View>
                  <Text style={styles.optionMeta} numberOfLines={2}>
                    Near {option.restrictedCount}{' '}
                    {option.restrictedCount === 1 ? 'hazard' : 'hazards'}
                    {option.restrictedTitles[0]
                      ? ` · ${option.restrictedTitles[0]}`
                      : ''}
                    {option.restrictedTitles.length > 1
                      ? ` +${option.restrictedTitles.length - 1} more`
                      : ''}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <Pressable onPress={onDismiss} style={styles.dismiss}>
            <Text style={styles.dismissText}>Keep empty map</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlayScrim,
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    card: {
      backgroundColor: colors.overlay,
      borderRadius: 24,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      paddingHorizontal: 18,
      paddingTop: 20,
      paddingBottom: 14,
      maxHeight: '78%',
    },
    kicker: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.danger,
      marginBottom: 6,
    },
    title: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.purple,
      marginBottom: 8,
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.purpleMuted,
      marginBottom: 14,
    },
    empty: {
      fontSize: 13,
      color: colors.lavenderSoft,
      marginBottom: 12,
    },
    list: {
      maxHeight: 280,
    },
    listContent: {
      gap: 8,
      paddingBottom: 8,
    },
    option: {
      backgroundColor: colors.surfaceGlass,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    optionTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 4,
    },
    optionTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: '800',
      color: colors.purple,
    },
    optionTime: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.ink,
      backgroundColor: colors.gold,
      overflow: 'hidden',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
    },
    optionMeta: {
      fontSize: 12,
      color: colors.danger,
      fontWeight: '600',
    },
    dismiss: {
      marginTop: 8,
      alignItems: 'center',
      paddingVertical: 12,
    },
    dismissText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.purpleMuted,
    },
  });
}
