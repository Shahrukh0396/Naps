import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import { PRIVACY_POLICY_URL } from '../constants/content';
import type { PrivacyScreenProps } from '../navigation/types';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';

export default function PrivacyScreen({ navigation }: PrivacyScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const retry = () => {
    setError(false);
    setLoading(true);
    setReloadKey(k => k + 1);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.chrome}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close privacy policy">
          <Text style={styles.close}>Done</Text>
        </Pressable>
        <View style={styles.urlBar}>
          <Text style={styles.url} numberOfLines={1}>
            {PRIVACY_POLICY_URL}
          </Text>
        </View>
        <View style={styles.closeSpacer} />
      </View>

      <View style={styles.webWrap}>
        {!error && (
          <WebView
            key={reloadKey}
            source={{ uri: PRIVACY_POLICY_URL }}
            onLoadStart={() => {
              setLoading(true);
              setError(false);
            }}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
            onHttpError={() => {
              setLoading(false);
              setError(true);
            }}
            startInLoadingState
            javaScriptEnabled
            originWhitelist={['https://*']}
            setSupportMultipleWindows={false}
            style={styles.webview}
          />
        )}

        {loading && !error && (
          <View style={styles.overlay} pointerEvents="none">
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        )}

        {error && (
          <View style={styles.overlay}>
            <Text style={styles.errorTitle}>Couldn’t load the page</Text>
            <Text style={styles.errorBody}>{PRIVACY_POLICY_URL}</Text>
            <Pressable onPress={retry} style={styles.retryBtn}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.cream,
    },
    chrome: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.lavenderBorder,
      backgroundColor: colors.cream,
    },
    close: {
      color: colors.purple,
      fontWeight: '700',
      fontSize: 15,
      minWidth: 48,
    },
    closeSpacer: {
      minWidth: 48,
    },
    urlBar: {
      flex: 1,
      backgroundColor: colors.inputBg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.lavenderBorder,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    url: {
      color: colors.purpleMuted,
      fontSize: 12,
      fontWeight: '600',
      textAlign: 'center',
    },
    webWrap: {
      flex: 1,
      backgroundColor: colors.white,
    },
    webview: {
      flex: 1,
      backgroundColor: colors.white,
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.cream,
      paddingHorizontal: 24,
    },
    errorTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.purple,
      marginBottom: 6,
      textAlign: 'center',
    },
    errorBody: {
      fontSize: 12,
      color: colors.lavenderSoft,
      textAlign: 'center',
      marginBottom: 16,
    },
    retryBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 999,
    },
    retryText: {
      color: colors.onPrimary,
      fontWeight: '700',
      fontSize: 13,
    },
  });
}
