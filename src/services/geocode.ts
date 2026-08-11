import { GOOGLE_MAPS_API_KEY } from '../config/maps';

export type LatLng = { lat: number; lng: number };

type GeocodeResponse = {
  status: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
};

export async function geocodeAddress(
  address: string,
): Promise<{ location: LatLng; label: string } | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(trimmed)}&key=${GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  const data = (await res.json()) as GeocodeResponse;
  if (data.status !== 'OK' || !data.results[0]) return null;

  const first = data.results[0];
  return {
    location: {
      lat: first.geometry.location.lat,
      lng: first.geometry.location.lng,
    },
    label: first.formatted_address,
  };
}

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string | null> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  const data = (await res.json()) as GeocodeResponse;
  if (data.status !== 'OK' || !data.results[0]) return null;
  return data.results[0].formatted_address;
}
