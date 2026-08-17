export type StatusBarStyle = 'light-content' | 'dark-content';

export type ColorPalette = {
  /** Primary text (and some pins). Light: deep purple. Dark: cream. */
  purple: string;
  purpleMuted: string;
  lavender: string;
  lavenderSoft: string;
  lavenderWash: string;
  lavenderBorder: string;
  /** Surfaces: tab bar, sheets, dropdowns. */
  cream: string;
  gold: string;
  goldSoft: string;
  white: string;
  whiteGlass: string;
  card: string;
  success: string;
  warning: string;
  danger: string;
  dangerSoft: string;
  dangerAlert: string;
  error: string;
  spotify: string;
  gradientStart: string;
  gradientMid: string;
  gradientEnd: string;
  /** Filled buttons / active toggles. */
  primary: string;
  /** Text on primary buttons. */
  onPrimary: string;
  /** Always-dark ink for text sitting on gold. */
  ink: string;
  shadow: string;
  surfaceGlass: string;
  surfaceGlassStrong: string;
  surfaceMuted: string;
  overlay: string;
  overlayScrim: string;
  inputBg: string;
  mapBg: string;
  mapBgFull: string;
  progressTrack: string;
  routeGlow: string;
  footerHint: string;
  statusBar: StatusBarStyle;
};

export const lightColors: ColorPalette = {
  purple: '#2D1B69',
  purpleMuted: '#6B5A9E',
  lavender: '#C4B5F4',
  lavenderSoft: '#9B8EC4',
  lavenderWash: 'rgba(196,181,244,0.18)',
  lavenderBorder: 'rgba(196,181,244,0.4)',
  cream: '#FFF8F0',
  gold: '#F4C842',
  goldSoft: 'rgba(244,200,66,0.18)',
  white: '#FFFFFF',
  whiteGlass: 'rgba(255,255,255,0.78)',
  card: '#FFF8F0',
  success: '#2D7D2D',
  warning: '#8B6A00',
  danger: '#9B4444',
  dangerSoft: '#E57373',
  dangerAlert: '#C62828',
  error: '#c0392b',
  spotify: '#1DB954',
  gradientStart: '#C4B5F4',
  gradientMid: '#D9B8F0',
  gradientEnd: '#F9C5D1',
  primary: '#2D1B69',
  onPrimary: '#FFF8F0',
  ink: '#2D1B69',
  shadow: '#2D1B69',
  surfaceGlass: 'rgba(255,255,255,0.72)',
  surfaceGlassStrong: 'rgba(255,255,255,0.92)',
  surfaceMuted: 'rgba(255,255,255,0.6)',
  overlay: 'rgba(255,248,240,0.96)',
  overlayScrim: 'rgba(45,27,105,0.35)',
  inputBg: 'rgba(196,181,244,0.15)',
  mapBg: '#e8e0ff',
  mapBgFull: '#dce3ea',
  progressTrack: 'rgba(255,255,255,0.45)',
  routeGlow: 'rgba(45,27,105,0.22)',
  footerHint: 'rgba(45,27,105,0.5)',
  statusBar: 'dark-content',
};

export const darkColors: ColorPalette = {
  purple: '#F3EEFF',
  purpleMuted: '#C4B5F4',
  lavender: '#A78BFA',
  lavenderSoft: '#B8A9E0',
  lavenderWash: 'rgba(167,139,250,0.18)',
  lavenderBorder: 'rgba(167,139,250,0.38)',
  cream: '#1B1433',
  gold: '#F4C842',
  goldSoft: 'rgba(244,200,66,0.22)',
  white: '#F3EEFF',
  whiteGlass: 'rgba(34,24,58,0.88)',
  card: '#22183A',
  success: '#7DDB7D',
  warning: '#F4C842',
  danger: '#EF9A9A',
  dangerSoft: '#E57373',
  dangerAlert: '#EF9A9A',
  error: '#EF9A9A',
  spotify: '#1DB954',
  gradientStart: '#1A122E',
  gradientMid: '#2A1848',
  gradientEnd: '#3D2048',
  primary: '#A78BFA',
  onPrimary: '#1A122E',
  ink: '#2D1B69',
  shadow: '#000000',
  surfaceGlass: 'rgba(34,24,58,0.82)',
  surfaceGlassStrong: 'rgba(34,24,58,0.94)',
  surfaceMuted: 'rgba(255,255,255,0.08)',
  overlay: 'rgba(34,24,58,0.96)',
  overlayScrim: 'rgba(0,0,0,0.55)',
  inputBg: 'rgba(167,139,250,0.14)',
  mapBg: '#1A1628',
  mapBgFull: '#12101C',
  progressTrack: 'rgba(255,255,255,0.12)',
  routeGlow: 'rgba(167,139,250,0.35)',
  footerHint: 'rgba(243,238,255,0.55)',
  statusBar: 'light-content',
};

/** @deprecated Prefer useTheme(). Kept so unthemed imports still resolve to light. */
export const colors = lightColors;

export const lightMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#f0ecff' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6B5A9E' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c8dff0' }] },
  { featureType: 'park', elementType: 'geometry', stylers: [{ color: '#d4edda' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

export const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1d1b2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#c4b5f4' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d1b2e' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2540' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1628' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#b8a9e0' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f2740' }] },
  { featureType: 'park', elementType: 'geometry', stylers: [{ color: '#1a2e22' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];
