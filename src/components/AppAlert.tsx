import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';

export type AppAlertTone = 'default' | 'danger' | 'warning';

export type AppAlertButton = {
  label: string;
  variant?: 'primary' | 'gold' | 'ghost';
  onPress?: () => void;
};

export type AppAlertConfig = {
  title: string;
  message?: string;
  tone?: AppAlertTone;
  buttons?: AppAlertButton[];
};

interface AppAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  tone?: AppAlertTone;
  buttons: AppAlertButton[];
  onRequestClose: () => void;
}

export default function AppAlert({
  visible,
  title,
  message,
  tone = 'default',
  buttons,
  onRequestClose,
}: AppAlertProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const kicker =
    tone === 'danger' ? 'Needs attention' : tone === 'warning' ? 'Heads up' : 'Naps';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onRequestClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text
            style={[
              styles.kicker,
              tone === 'danger' && styles.kickerDanger,
              tone === 'warning' && styles.kickerWarning,
            ]}>
            {kicker}
          </Text>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.body}>{message}</Text> : null}
          <View style={styles.actions}>
            {buttons.map((btn, index) => {
              const variant = btn.variant ?? (index === buttons.length - 1 ? 'gold' : 'ghost');
              return (
                <Pressable
                  key={`${btn.label}-${index}`}
                  onPress={() => {
                    onRequestClose();
                    btn.onPress?.();
                  }}
                  style={[
                    styles.btn,
                    variant === 'gold' && styles.btnGold,
                    variant === 'primary' && styles.btnPrimary,
                    variant === 'ghost' && styles.btnGhost,
                  ]}>
                  <Text
                    style={[
                      styles.btnText,
                      variant === 'gold' && styles.btnTextGold,
                      variant === 'primary' && styles.btnTextPrimary,
                      variant === 'ghost' && styles.btnTextGhost,
                    ]}>
                    {btn.label}
                  </Text>
                </Pressable>
              );
            })}
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
      backgroundColor: colors.overlayScrim,
      justifyContent: 'center',
      paddingHorizontal: 22,
    },
    card: {
      backgroundColor: colors.overlay,
      borderRadius: 24,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
      paddingHorizontal: 18,
      paddingTop: 20,
      paddingBottom: 16,
    },
    kicker: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.purpleMuted,
      marginBottom: 6,
    },
    kickerDanger: {
      color: colors.danger,
    },
    kickerWarning: {
      color: colors.warning,
    },
    title: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.purple,
      marginBottom: 8,
    },
    body: {
      fontSize: 14,
      lineHeight: 21,
      color: colors.purpleMuted,
      marginBottom: 16,
    },
    actions: {
      gap: 8,
    },
    btn: {
      borderRadius: 16,
      paddingVertical: 13,
      alignItems: 'center',
    },
    btnGold: {
      backgroundColor: colors.gold,
    },
    btnPrimary: {
      backgroundColor: colors.primary,
    },
    btnGhost: {
      backgroundColor: colors.lavenderWash,
      borderWidth: 1.5,
      borderColor: colors.lavenderBorder,
    },
    btnText: {
      fontSize: 15,
      fontWeight: '800',
    },
    btnTextGold: {
      color: colors.ink,
    },
    btnTextPrimary: {
      color: colors.onPrimary,
    },
    btnTextGhost: {
      color: colors.purple,
    },
  });
}
