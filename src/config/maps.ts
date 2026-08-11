/**
 * Same key currently used by naps-app-main Maps endpoints.
 * Restrict this key in Google Cloud Console to:
 * - Maps SDK for Android (package com.googlenaps)
 * - Maps SDK for iOS (bundle id)
 * - Routes API (preferred for traffic-aware ETAs)
 * - Directions API, Geocoding API, Places API
 *
 * Enable billing + Routes API so TRAFFIC_AWARE_OPTIMAL ETAs can match the
 * Google Maps consumer app. Directions API is used as a fallback with
 * departure_time=now&traffic_model=best_guess.
 */
export const GOOGLE_MAPS_API_KEY = 'AIzaSyC0V0SOJrGZ6-6-L0Q6CKpAshTFu889eQE';
