import { useCallback, useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { notifyIfQuotaExceeded } from '../utils/quota';

export interface UseAutocompleteSuggestionsResult {
  suggestions: google.maps.places.AutocompleteSuggestion[];
  isLoading: boolean;
  error: string | null;
  resetSession: () => void;
}

/**
 * Modern Places API (New) Autocomplete hook using AutocompleteSuggestion.fetchAutocompleteSuggestions
 * paired with AutocompleteSessionToken for session-bundled billing.
 */
export function useAutocompleteSuggestions(
  inputString: string,
  biasLocation?: { lat: number; lng: number } | null,
  enabled: boolean = true
): UseAutocompleteSuggestionsResult {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef =
    useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  const [suggestions, setSuggestions] = useState<
    google.maps.places.AutocompleteSuggestion[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = inputString.trim();
    if (!enabled || !placesLib || trimmed.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        if (typeof AutocompleteSuggestion?.fetchAutocompleteSuggestions !== 'function') {
          if (!cancelled) {
            setSuggestions([]);
            setIsLoading(false);
            setError('AutocompleteSuggestion unavailable');
          }
          return;
        }

        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }

        setIsLoading(true);
        setError(null);

        const request: google.maps.places.AutocompleteRequest = {
          input: trimmed,
          sessionToken: sessionTokenRef.current,
          language: 'pl',
          region: 'pl',
          includedRegionCodes: ['pl'],
        };

        if (biasLocation) {
          request.locationBias = {
            center: biasLocation,
            radius: 15000,
          };
        }

        const res =
          await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);

        if (!cancelled) {
          setSuggestions(res?.suggestions ?? []);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setIsLoading(false);
          setSuggestions([]);
          notifyIfQuotaExceeded(err);
          setError('Nie udało się pobrać podpowiedzi adresów.');
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, placesLib, inputString, biasLocation?.lat, biasLocation?.lng]);

  const resetSession = useCallback(() => {
    sessionTokenRef.current = null;
    setSuggestions([]);
    setError(null);
  }, []);

  return {
    suggestions,
    isLoading,
    error,
    resetSession,
  };
}
