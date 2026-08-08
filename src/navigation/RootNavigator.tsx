import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PlanScreen from '../screens/PlanScreen';
import ResultsScreen from '../screens/ResultsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AboutScreen from '../screens/AboutScreen';
import SupportScreen from '../screens/SupportScreen';
import PrivacyScreen from '../screens/PrivacyScreen';
import type { MainTabParamList, RootStackParamList } from './types';
import { colors } from '../theme/colors';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function TabIcon({
  emoji,
  focused,
  label,
}: {
  emoji: string;
  focused: boolean;
  label: string;
}) {
  return (
    <View style={styles.tabIconWrap}>
      <View style={[styles.tabIconBubble, focused && styles.tabIconBubbleActive]}>
        <Text style={styles.tabEmoji}>{emoji}</Text>
      </View>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
    </View>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: 'absolute',
          left: 10,
          right: 10,
          bottom: bottomPad,
          height: 68,
          borderRadius: 34,
          backgroundColor: 'rgba(255,248,240,0.94)',
          borderTopWidth: 0,
          borderWidth: 1.5,
          borderColor: 'rgba(196,181,244,0.45)',
          paddingTop: 16,
          paddingBottom: 0,
          justifyContent: 'center',
          alignItems: 'center',
          ...Platform.select({
            ios: {
              shadowColor: colors.purple,
              shadowOpacity: 0.14,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
            },
            android: { elevation: 10 },
          }),
        },
      }}>
      <Tab.Screen
        name="Home"
        component={PlanScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji="🌙" focused={focused} label="Nap" />
          ),
          tabBarAccessibilityLabel: 'Plan nap route',
        }}
      />
      <Tab.Screen
        name="Support"
        component={SupportScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji="💬" focused={focused} label="Help" />
          ),
          tabBarAccessibilityLabel: 'Support',
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji="⚙️" focused={focused} label="Settings" />
          ),
          tabBarAccessibilityLabel: 'Settings',
        }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: colors.gradientMid },
        }}>
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen
          name="Results"
          component={ResultsScreen}
          options={{ animation: 'slide_from_right', gestureEnabled: true }}
        />
        <Stack.Screen name="About" component={AboutScreen} />
        <Stack.Screen name="Privacy" component={PrivacyScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
  },
  tabIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  tabIconBubbleActive: {
    backgroundColor: 'rgba(244,200,66,0.35)',
  },
  tabEmoji: { fontSize: 18 },
  tabLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
    color: colors.lavenderSoft,
  },
  tabLabelActive: {
    color: colors.purple,
    fontWeight: '800',
  },
});
