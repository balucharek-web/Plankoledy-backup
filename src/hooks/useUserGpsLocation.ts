import { useCallback, useEffect, useRef, useState } from 'react';
import { LatLng } from '../types/parish';

export interface UserGpsState {
  active: boolean;
  position: LatLng | null;
  accuracyMeters: number | null;
  error: string | null;
  toggle: () => void;
  stop: () => void;
}

export function useUserGpsLocation(): UserGpsState {
  const [active, setActive] = useState(false);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [accuracyMeters, setAccuracyMeters] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setActive(false);
  }, []);

  const start = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Przeglądarka nie obsługuje modułu GPS.');
      return;
    }
    setError(null);
    setActive(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setAccuracyMeters(
          typeof pos.coords.accuracy === 'number'
            ? Math.round(pos.coords.accuracy)
            : null
        );
        setError(null);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setError('Brak zgody na odczyt lokalizacji GPS.');
          stop();
        } else {
          setError('Słaby sygnał GPS — czekam na odświeżenie.');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 12000,
      }
    );
  }, [stop]);

  const toggle = useCallback(() => {
    if (active) stop();
    else start();
  }, [active, start, stop]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return { active, position, accuracyMeters, error, toggle, stop };
}
