import { GOOGLE_MAPS_API_KEY } from '../config/maps';

export interface PlacePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

/** Default bias radius (~50km) — nearby ranks first; still allows farther matches. */
const DEFAULT_BIAS_RADIUS_M = 50_000;

export async function fetchPlacePredictions(params: {
  input: string;
  sessionToken: string;
  types?: string;
  /** Bias results toward this point (user GPS / route origin). */
  location?: { lat: number; lng: number } | null;
  /** Bias radius in meters (used with location). */
  radius?: number;
}): Promise<PlacePrediction[]> {
  const input = params.input.trim();
  if (input.length < 2) return [];

  const query = new URLSearchParams({
    input,
    key: GOOGLE_MAPS_API_KEY,
    types: params.types ?? 'geocode',
    sessiontoken: params.sessionToken,
  });

  if (params.location) {
    query.set(
      'location',
      `${params.location.lat},${params.location.lng}`,
    );
    query.set(
      'radius',
      String(params.radius ?? DEFAULT_BIAS_RADIUS_M),
    );
  }

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?${query.toString()}`,
  );
  if (!res.ok) return [];

  const data = (await res.json()) as {
    status?: string;
    predictions?: PlacePrediction[];
  };

  if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    if (__DEV__) {
      console.warn('[places] autocomplete status:', data.status);
    }
    return [];
  }

  return data.predictions ?? [];
}

export function newPlacesSessionToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
