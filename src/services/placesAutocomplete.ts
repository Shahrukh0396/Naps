import { GOOGLE_MAPS_API_KEY } from '../config/maps';

export interface PlacePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

export async function fetchPlacePredictions(params: {
  input: string;
  sessionToken: string;
  types?: string;
}): Promise<PlacePrediction[]> {
  const input = params.input.trim();
  if (input.length < 2) return [];

  const query = new URLSearchParams({
    input,
    key: GOOGLE_MAPS_API_KEY,
    types: params.types ?? 'geocode',
    sessiontoken: params.sessionToken,
  });

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
