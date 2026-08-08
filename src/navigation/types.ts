import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RouteResult, RouteStyleId, RouteVariant } from '../types/route';

export type MainTabParamList = {
  Home: undefined;
  Support: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Results: {
    route: RouteResult;
    variants: RouteVariant[];
    activeStyle: RouteStyleId;
    durationMinutes: number;
    destination: string | null;
    originLabel: string;
    preferredStyle: RouteStyleId;
  };
  About: undefined;
  Privacy: undefined;
};

export type PlanScreenProps = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

export type ResultsScreenProps = NativeStackScreenProps<RootStackParamList, 'Results'>;

export type SettingsScreenProps = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Settings'>,
  NativeStackScreenProps<RootStackParamList>
>;

export type SupportScreenProps = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Support'>,
  NativeStackScreenProps<RootStackParamList>
>;

export type AboutScreenProps = NativeStackScreenProps<RootStackParamList, 'About'>;
export type PrivacyScreenProps = NativeStackScreenProps<RootStackParamList, 'Privacy'>;
