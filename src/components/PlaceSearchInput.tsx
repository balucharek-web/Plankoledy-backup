import React, { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { useMapEngine } from '../contexts/MapEngineContext';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions';
import { searchPlacesNominatim } from '../services/osmSearchAndRouting';
import { LatLng } from '../types/parish';
import { notifyIfQuotaExceeded } from '../utils/quota';

export interface SelectedPlaceData {
  name: string;
  address: string;
  location: LatLng;
  placeId: string;
}

interface PlaceSearchInputProps {
  placeholder: string;
  biasLocation?: LatLng | null;
  onSelect: (place: SelectedPlaceData) => void;
  clearOnSelect?: boolean;
  initialValue?: string;
}

const GooglePlaceSearchInput: React.FC<PlaceSearchInputProps> = ({
  placeholder,
  biasLocation,
  onSelect,
  clearOnSelect = false,
  initialValue = '',
}) => {
  const placesLib = useMapsLibrary('places');
  const [inputValue, setInputValue] = useState(initialValue);
  const [isOpen, setIsOpen] = useState(false);
  const [fetchingDetails, setFetchingDetails] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { suggestions, isLoading, error, resetSession } =
    useAutocompleteSuggestions(inputValue, biasLocation);

  useEffect(() => {
    setInputValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const handleOutsideClick = (ev: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(ev.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleSelectSuggestion = async (
    suggestion: google.maps.places.AutocompleteSuggestion
  ) => {
    if (!placesLib || !suggestion.placePrediction) return;

    try {
      setFetchingDetails(true);
      setLocalError(null);
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location', 'id'],
      });

      const loc = place.location;
      if (!loc) {
        setLocalError('Wybrany wynik nie zawiera współrzędnych.');
        setFetchingDetails(false);
        return;
      }

      const name =
        place.displayName ||
        suggestion.placePrediction.mainText?.text ||
        'Wybrana lokalizacja';
      const address =
        place.formattedAddress ||
        suggestion.placePrediction.text?.text ||
        name;

      onSelect({
        name,
        address,
        location: { lat: loc.lat(), lng: loc.lng() },
        placeId: place.id || '',
      });

      resetSession();
      setIsOpen(false);
      setFetchingDetails(false);
      setInputValue(clearOnSelect ? '' : name);
    } catch (err) {
      setFetchingDetails(false);
      notifyIfQuotaExceeded(err);
      setLocalError('Nie udało się pobrać szczegółów miejsca.');
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <Search
          className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setIsOpen(true);
            setLocalError(null);
          }}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2.5 text-base sm:text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600 transition-colors"
        />
        {(isLoading || fetchingDetails) && (
          <Loader2 className="w-4 h-4 text-amber-700 animate-spin absolute right-3" />
        )}
        {!isLoading && !fetchingDetails && inputValue.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setInputValue('');
              resetSession();
              setIsOpen(false);
            }}
            aria-label="Wyczyść wyszukiwanie"
            className="absolute right-2.5 p-0.5 text-slate-400 hover:text-slate-600 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {(error || localError) && (
        <p className="mt-1.5 text-xs text-red-600">{localError || error}</p>
      )}

      {isOpen && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto divide-y divide-slate-100"
        >
          {suggestions.map((suggestion, idx) => {
            const pred = suggestion.placePrediction;
            if (!pred) return null;
            const mainText = pred.mainText?.text || pred.text?.text || '';
            const secondaryText = pred.secondaryText?.text || '';

            return (
              <li key={pred.placeId || idx}>
                <button
                  type="button"
                  onClick={() => handleSelectSuggestion(suggestion)}
                  className="w-full text-left px-3 py-2.5 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none flex items-start gap-2.5 transition-colors"
                >
                  <MapPin className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {mainText}
                    </div>
                    {secondaryText && (
                      <div className="text-xs text-slate-500 truncate">
                        {secondaryText}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const OsmPlaceSearchInput: React.FC<PlaceSearchInputProps> = ({
  placeholder,
  biasLocation,
  onSelect,
  clearOnSelect = false,
  initialValue = '',
}) => {
  const [inputValue, setInputValue] = useState(initialValue);
  const [results, setResults] = useState<SelectedPlaceData[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const suppressSearchRef = useRef(false);

  useEffect(() => {
    suppressSearchRef.current = true;
    setInputValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const handleOutsideClick = (ev: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(ev.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (suppressSearchRef.current) {
      suppressSearchRef.current = false;
      return;
    }

    const q = inputValue.trim();
    if (q.length < 3) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const items = await searchPlacesNominatim(q, biasLocation, 6);
        if (!cancelled) {
          setResults(items);
          setIsOpen(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Nie udało się wyszukać lokalizacji.'
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inputValue, biasLocation]);

  const handleSelectItem = (item: SelectedPlaceData) => {
    suppressSearchRef.current = true;
    onSelect(item);
    setIsOpen(false);
    setResults([]);
    setInputValue(clearOnSelect ? '' : item.name);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <Search
          className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            suppressSearchRef.current = false;
            setInputValue(e.target.value);
            setIsOpen(true);
            setError(null);
          }}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2.5 text-base sm:text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600 transition-colors"
        />
        {isLoading && (
          <Loader2 className="w-4 h-4 text-amber-700 animate-spin absolute right-3" />
        )}
        {!isLoading && inputValue.length > 0 && (
          <button
            type="button"
            onClick={() => {
              suppressSearchRef.current = true;
              setInputValue('');
              setResults([]);
              setIsOpen(false);
            }}
            aria-label="Wyczyść wyszukiwanie"
            className="absolute right-2.5 p-0.5 text-slate-400 hover:text-slate-600 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}

      {isOpen && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto divide-y divide-slate-100"
        >
          {results.map((item) => (
            <li key={item.placeId}>
              <button
                type="button"
                onClick={() => handleSelectItem(item)}
                className="w-full text-left px-3 py-2.5 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none flex items-start gap-2.5 transition-colors"
              >
                <MapPin className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {item.name}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {item.address}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const PlaceSearchInput: React.FC<PlaceSearchInputProps> = (props) => {
  const engine = useMapEngine();
  return engine === 'google' ? (
    <GooglePlaceSearchInput {...props} />
  ) : (
    <OsmPlaceSearchInput {...props} />
  );
};
