import React, { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LandingScreen from '../screens/LandingScreen';
import PlanScreen from '../screens/PlanScreen';
import ResultsScreen from '../screens/ResultsScreen';
import NavigateScreen from '../screens/NavigateScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AboutScreen from '../screens/AboutScreen';
import SupportScreen from '../screens/SupportScreen';
import PrivacyScreen from '../screens/PrivacyScreen';
import type { MainTabParamList, RootStackParamList } from './types';
import { useTheme, type ColorPalette } from '../theme/ThemeContext';
import { blockLeaveIfSettingsDirty, isNamedTabFocused } from './settingsLeaveGuard';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function TabIcon({
  emoji,
  focused,
  label,
  colors,
}: {
  emoji: string;
  focused: boolean;
  label: string;
  colors: ColorPalette;
}) {
  const styles = useMemo(() => makeTabStyles(colors), [colors]);
  return (
    <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
      <View style={[styles.tabIconBubble, focused && styles.tabIconBubbleActive]}>
        <Text style={styles.tabEmoji}>{emoji}</Text>
      </View>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
    </View>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const bottomPad = Math.max(insets.bottom, 10);

  return (
    <Tab.Navigator
      id="MainTabs"
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.purple,
        tabBarInactiveTintColor: colors.lavenderSoft,
        tabBarStyle: {
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: bottomPad,
          height: 72,
          borderRadius: 28,
          backgroundColor: colors.cream,
          borderTopWidth: 0,
          borderWidth: 1.5,
          borderColor: colors.lavenderBorder,
          paddingTop: 10,
          paddingBottom: 10,
          paddingHorizontal: 8,
          justifyContent: 'center',
          alignItems: 'center',
          ...Platform.select({
            ios: {
              shadowColor: colors.shadow,
              shadowOpacity: 0.12,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
            },
            android: { elevation: 10 },
          }),
        },
        tabBarItemStyle: {
          justifyContent: 'center',
          alignItems: 'center',
        },
      }}
      screenListeners={({ navigation, route }) => ({
        tabPress: e => {
          if (route.name === 'Settings') return;
          const onSettings = isNamedTabFocused(navigation.getState(), 'Settings');
          if (!onSettings) return;
          const blocked = blockLeaveIfSettingsDirty(() => {
            navigation.navigate(route.name);
          });
          if (blocked) e.preventDefault();
        },
      })}>
      <Tab.Screen
        name="Home"
        component={PlanScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji="🌙" focused={focused} label="Nap" colors={colors} />
          ),
          tabBarAccessibilityLabel: 'Plan nap route',
        }}
      />
      <Tab.Screen
        name="Support"
        component={SupportScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji="💬" focused={focused} label="Help" colors={colors} />
          ),
          tabBarAccessibilityLabel: 'Support',
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji="⚙️" focused={focused} label="Settings" colors={colors} />
          ),
          tabBarAccessibilityLabel: 'Settings',
        }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { colors, darkMode } = useTheme();
  const navTheme = useMemo(
    () => ({
      ...(darkMode ? DarkTheme : DefaultTheme),
      colors: {
        ...(darkMode ? DarkTheme.colors : DefaultTheme.colors),
        background: colors.gradientMid,
        card: colors.cream,
        text: colors.purple,
        border: colors.lavenderBorder,
        primary: colors.primary,
      },
    }),
    [colors, darkMode],
  );
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        initialRouteName="Landing"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: colors.gradientMid },
        }}>
        <Stack.Screen
          name="Landing"
          component={LandingScreen}
          options={{ animation: 'fade', gestureEnabled: false }}
        />
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen
          name="Results"
          component={ResultsScreen}
          options={{ animation: 'slide_from_right', gestureEnabled: true }}
        />
        <Stack.Screen
          name="Navigate"
          component={NavigateScreen}
          options={{ animation: 'fade', gestureEnabled: false }}
        />
        <Stack.Screen name="About" component={AboutScreen} />
        <Stack.Screen name="Privacy" component={PrivacyScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function makeTabStyles(colors: ColorPalette) {
  return StyleSheet.create({
    tabIconWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 88,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 18,
    },
    tabIconWrapActive: {
      backgroundColor: colors.lavenderWash,
      height: 65,
      borderRadius: 35,
      paddingHorizontal: 16,
      paddingVertical: 6,
      marginTop: 14,
    },
    tabIconBubble: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    tabIconBubbleActive: {
      backgroundColor: colors.goldSoft,
      borderWidth: 1.5,
      borderColor: colors.gold,
    },
    tabEmoji: { fontSize: 17 },
    tabLabel: {
      marginTop: 2,
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0.2,
      color: colors.lavenderSoft,
    },
    tabLabelActive: {
      color: colors.purple,
      fontWeight: '800',
    },
  });
}
