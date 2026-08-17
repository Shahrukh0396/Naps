import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXTEND_PRESETS, EXTEND_WHEEL_MINUTES } from '../constants/content';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';

const ITEM_HEIGHT = 44;
const VISIBLE_ROWS = 3;

interface ExtendTimeSheetProps {
  visible: boolean;
  defaultMinutes?: number;
  currentTotalMinutes: number;
  currentSecondsLeft: number;
  willRecalculateRoute?: boolean;
  onCancel: () => void;
  onConfirm: (minutes: number) => void;
}

export default function ExtendTimeSheet({
  visible,
  defaultMinutes = 5,
  currentTotalMinutes,
  currentSecondsLeft,
  willRecalculateRoute = false,
  onCancel,
  onConfirm,
}: ExtendTimeSheetProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const wheelRef = useRef<ScrollView>(null);
  const [selected, setSelected] = useState(defaultMinutes);

  const wheelValues = useMemo(() => [...EXTEND_WHEEL_MINUTES], []);

  useEffect(() => {
    if (!visible) return;
    const initial = wheelValues.includes(defaultMinutes as (typeof wheelValues)[number])
      ? defaultMinutes
      : 5;
    setSelected(initial);
    const index = Math.max(0, wheelValues.indexOf(initial as (typeof wheelValues)[number]));
    requestAnimationFrame(() => {
      wheelRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: false });
    });
  }, [visible, defaultMinutes, wheelValues]);

  const nextTotal = currentTotalMinutes + selected;
  const nextRemaining = Math.max(
    1,
    Math.ceil((currentSecondsLeft + selected * 60) / 60),
  );

  const snapToNearest = (offsetY: number) => {
    const index = Math.round(offsetY / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(wheelValues.length - 1, index));
    setSelected(wheelValues[clamped]);
    wheelRef.current?.scrollTo({ y: clamped * ITEM_HEIGHT, animated: true });
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    snapToNearest(e.nativeEvent.contentOffset.y);
  };

  const selectMinutes = (minutes: number) => {
    setSelected(minutes);
    const index = wheelValues.indexOf(minutes as (typeof wheelValues)[number]);
    if (index >= 0) {
      wheelRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onCancel} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>Extend nap</Text>
          <Text style={styles.subtitle}>
            Choose how much longer the nap should run
          </Text>

          <Text style={styles.sectionLabel}>Quick pick</Text>
          <View style={styles.chipRow}>
            {EXTEND_PRESETS.map(mins => {
              const active = selected === mins;
              return (
                <Pressable
                  key={mins}
                  onPress={() => selectMinutes(mins)}
                  style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    +{mins}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>Or scroll to choose</Text>
          <View style={styles.wheelWrap}>
            <View pointerEvents="none" style={styles.wheelHighlight} />
            <ScrollView
              ref={wheelRef}
              showsVerticalScrollIndicator={false}
              snapToInterval={ITEM_HEIGHT}
              decelerationRate="fast"
              onMomentumScrollEnd={onMomentumEnd}
              onScrollEndDrag={onMomentumEnd}
              contentContainerStyle={{
                paddingVertical: ITEM_HEIGHT * Math.floor(VISIBLE_ROWS / 2),
              }}>
              {wheelValues.map(mins => {
                const active = selected === mins;
                return (
                  <Pressable
                    key={mins}
                    onPress={() => selectMinutes(mins)}
                    style={styles.wheelItem}>
                    <Text
                      style={[
                        styles.wheelText,
                        active && styles.wheelTextActive,
                      ]}>
                      +{mins} minutes
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.preview}>
            <Text style={styles.previewMain}>Add {selected} min</Text>
            <Text style={styles.previewSub}>
              New nap length {nextTotal} min · ~{nextRemaining} min left
            </Text>
            {willRecalculateRoute && (
              <Text style={styles.previewNote}>
                Route will recalculate to match the new time
              </Text>
            )}
          </View>

          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onConfirm(selected)}
              style={styles.confirmBtn}
              accessibilityLabel={`Add ${selected} minutes`}>
              <Text style={styles.confirmText}>
                {willRecalculateRoute
                  ? `Add ${selected} min & update route`
                  : `Add ${selected} min`}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.overlayScrim,
    },
    backdropTap: {
      flex: 1,
    },
    sheet: {
      backgroundColor: colors.cream,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 20,
      paddingTop: 10,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      borderBottomWidth: 0,
    },
    handle: {
      alignSelf: 'center',
      width: 42,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.lavenderBorder,
      marginBottom: 14,
    },
    title: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.purple,
      letterSpacing: -0.3,
    },
    subtitle: {
      marginTop: 4,
      fontSize: 13,
      color: colors.purpleMuted,
      marginBottom: 16,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.lavenderSoft,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 16,
    },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: colors.lavenderWash,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipText: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.purple,
    },
    chipTextActive: {
      color: colors.onPrimary,
    },
    wheelWrap: {
      height: ITEM_HEIGHT * VISIBLE_ROWS,
      borderRadius: 18,
      backgroundColor: colors.inputBg,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      overflow: 'hidden',
      marginBottom: 14,
    },
    wheelHighlight: {
      position: 'absolute',
      left: 8,
      right: 8,
      top: ITEM_HEIGHT,
      height: ITEM_HEIGHT,
      borderRadius: 14,
      backgroundColor: colors.goldSoft,
      borderWidth: 1.5,
      borderColor: colors.gold,
      zIndex: 1,
    },
    wheelItem: {
      height: ITEM_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    wheelText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.lavenderSoft,
    },
    wheelTextActive: {
      color: colors.purple,
      fontWeight: '800',
      fontSize: 18,
    },
    preview: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      marginBottom: 14,
    },
    previewMain: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.purple,
    },
    previewSub: {
      marginTop: 4,
      fontSize: 12,
      color: colors.purpleMuted,
      fontWeight: '600',
    },
    previewNote: {
      marginTop: 6,
      fontSize: 11,
      color: colors.lavenderSoft,
      fontWeight: '600',
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
    },
    cancelBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 999,
      backgroundColor: colors.lavenderWash,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    cancelText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.purpleMuted,
    },
    confirmBtn: {
      flex: 1.4,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: colors.gold,
    },
    confirmText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.ink,
      textAlign: 'center',
    },
  });
}
