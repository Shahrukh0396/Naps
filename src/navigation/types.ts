import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RestrictedRouteOption, RouteResult, RouteStyleId, RouteVariant } from '../types/route';

export type MainTabParamList = {
  Home: undefined;
  Support: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Landing: undefined;
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Results: {
    route: RouteResult;
    variants: RouteVariant[];
    activeStyle: RouteStyleId;
    activeVariation?: number;
    routesByVariation?: Record<number, RouteResult>;
    durationMinutes: number;
    destination: string | null;
    originLabel: string;
    preferredStyle: RouteStyleId;
    restrictedOptions?: RestrictedRouteOption[];
  };
  Navigate: {
    route: RouteResult;
    durationMinutes: number;
    destinationLabel: string | null;
    activeStyle: RouteStyleId;
    /** True when Results already opened Google Maps and started the nap. */
    napStarted?: boolean;
    /** Wall-clock end time so the timer keeps running in Maps / after kill. */
    initialEndsAt?: number;
    initialTotalSeconds?: number;
    initialSecondsLeft?: number;
  };
  About: undefined;
  Privacy: undefined;
};

export type LandingScreenProps = NativeStackScreenProps<RootStackParamList, 'Landing'>;

export type PlanScreenProps = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

export type ResultsScreenProps = NativeStackScreenProps<RootStackParamList, 'Results'>;
export type NavigateScreenProps = NativeStackScreenProps<RootStackParamList, 'Navigate'>;

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
