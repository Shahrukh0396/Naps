import { useCallback, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';

async function ensureAndroidPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Location permission',
      message: 'Naps needs your location to build a nap-drive loop from where you are.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export function fetchCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise(async (resolve, reject) => {
    const ok = await ensureAndroidPermission();
    if (!ok) {
      reject(new Error('Location access denied'));
      return;
    }
    Geolocation.getCurrentPosition(
      pos =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
      err => reject(err),
      {
        timeout: 12000,
        maximumAge: 8000,
        enableHighAccuracy: true,
      },
    );
  });
}

export function useGpsLocation() {
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<'idle' | 'detecting' | 'found' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const detect = useCallback(() => {
    setStatus('detecting');
    setErrorMsg(null);

    (async () => {
      const ok = await ensureAndroidPermission();
      if (!ok) {
        setStatus('error');
        setErrorMsg('Location access denied — enable it in Settings.');
        return;
      }

      Geolocation.getCurrentPosition(
        pos => {
          setLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
          setStatus('found');
        },
        err => {
          setStatus('error');
          if (err.code === 1) {
            setErrorMsg('Location access denied — enable it in Settings to plan a nap route.');
          } else if (err.code === 2) {
            setErrorMsg('Location unavailable. Check that Location Services are on, then retry.');
          } else {
            setErrorMsg('Location timed out. Move somewhere with a clearer signal and retry.');
          }
        },
        {
          timeout: 15000,
          maximumAge: 120000,
          enableHighAccuracy: false,
        },
      );
    })();
  }, []);

  return { location, status, errorMsg, detect };
}
