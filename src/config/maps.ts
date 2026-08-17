/**
 * Loaded from `.env` via react-native-config (never commit the real key).
 * Restrict this key in Google Cloud Console to:
 * - Maps SDK for Android (package com.snaps.app)
 * - Maps SDK for iOS (bundle id com.naps.app)
 * - Routes API (preferred for traffic-aware ETAs)
 * - Directions API, Geocoding API, Places API (legacy autocomplete)
 * - Places API (New) — Text Search along route for military / restricted areas
 * - Roads API — snapToRoads for Navigate map polish + alert proximity
 *
 * Enable billing + Routes API so TRAFFIC_AWARE_OPTIMAL ETAs can match the
 * Google Maps consumer app. Directions API is used as a fallback with
 * departure_time=now&traffic_model=best_guess.
 */
import Config from 'react-native-config';

export const GOOGLE_MAPS_API_KEY = Config.GOOGLE_MAPS_API_KEY ?? '';

if (__DEV__ && !GOOGLE_MAPS_API_KEY) {
  console.warn(
    '[maps] GOOGLE_MAPS_API_KEY is missing. Copy .env.example to .env.',
  );
}
