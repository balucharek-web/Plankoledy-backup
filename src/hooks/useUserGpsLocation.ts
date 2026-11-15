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

export interface GpsPositionResult {
  location: LatLng;
  accuracyMeters: number | null;
}

export async function getCurrentPositionResilient(): Promise<GpsPositionResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('Przeglądarka nie obsługuje lokalizacji GPS.');
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    throw new Error('Lokalizacja GPS wymaga bezpiecznego połączenia HTTPS.');
  }

  const readOnce = (opts: PositionOptions) =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, opts);
    });

  try {
    // Szybka ścieżka (Wi-Fi / sieć / ostatnia zapisana pozycja) — niezawodna w budynkach
    const pos = await readOnce({
      enableHighAccuracy: false,
      maximumAge: 120000,
      timeout: 7000,
    });
    return {
      location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      accuracyMeters:
        typeof pos.coords.accuracy === 'number'
          ? Math.round(pos.coords.accuracy)
          : null,
    };
  } catch (firstErr) {
    const firstCode =
      firstErr && typeof firstErr === 'object' && 'code' in firstErr
        ? Number((firstErr as GeolocationPositionError).code)
        : 0;
    if (firstCode === 1) {
      throw new Error(
        'Brak zgody na lokalizację. Zezwól aplikacji na dostęp do lokalizacji w ustawieniach przeglądarki/telefonu lub wpisz parafię ręcznie powyżej.'
      );
    }

    // Druga próba: moduł GPS z dłuższym limitem czasu
    try {
      const pos = await readOnce({
        enableHighAccuracy: true,
        maximumAge: 300000,
        timeout: 12000,
      });
      return {
        location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        accuracyMeters:
          typeof pos.coords.accuracy === 'number'
            ? Math.round(pos.coords.accuracy)
            : null,
      };
    } catch (secondErr) {
      const secondCode =
        secondErr && typeof secondErr === 'object' && 'code' in secondErr
          ? Number((secondErr as GeolocationPositionError).code)
          : 0;
      if (secondCode === 1) {
        throw new Error(
          'Brak zgody na lokalizację. Zezwól aplikacji na dostęp do lokalizacji w ustawieniach telefonu lub wpisz parafię ręcznie powyżej.'
        );
      }
      if (secondCode === 2) {
        throw new Error(
          'Telefon nie może teraz ustalić pozycji. Włącz „Lokalizację” w panelu Androida lub wpisz parafię powyżej.'
        );
      }
      throw new Error(
        'Przekroczono czas oczekiwania na GPS. Upewnij się, że „Lokalizacja” w telefonie jest włączona, lub wpisz parafię powyżej.'
      );
    }
  }
}

export function useUserGpsLocation(): UserGpsState {
  const [active, setActive] = useState(false);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [accuracyMeters, setAccuracyMeters] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (
      watchIdRef.current !== null &&
      typeof navigator !== 'undefined' &&
      navigator.geolocation
    ) {
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
        maximumAge: 10000,
        timeout: 15000,
      }
    );
  }, [stop]);

  const toggle = useCallback(() => {
    if (active) stop();
    else start();
  }, [active, start, stop]);

  useEffect(() => {
    return () => {
      if (
        watchIdRef.current !== null &&
        typeof navigator !== 'undefined' &&
        navigator.geolocation
      ) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return { active, position, accuracyMeters, error, toggle, stop };
}
