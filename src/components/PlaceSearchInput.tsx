import React, { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions';
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

export const PlaceSearchInput: React.FC<PlaceSearchInputProps> = ({
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
          className="w-full pl-9 pr-9 py-2.5 text-base sm:text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600 transition-colors"
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
          className="absolute z-30 mt-1.5 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto divide-y divide-slate-100"
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
