import React, { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Building2, Church, Loader2, MapPin, Search, X } from 'lucide-react';
import { useMapEngine } from '../contexts/MapEngineContext';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions';
import {
  searchParishesOsm,
  searchPlacesNominatim,
} from '../services/osmSearchAndRouting';
import { BuildingUnit, LatLng, UnitVisitStatus } from '../types/parish';
import { notifyIfQuotaExceeded } from '../utils/quota';

export interface SelectedPlaceData {
  name: string;
  address: string;
  location: LatLng;
  placeId: string;
  placeType?: 'parish' | 'place' | 'address';
  isMultiUnit?: boolean;
  unitsCount?: number;
  minutesPerUnit?: number;
  durationMinutes?: number;
  units?: BuildingUnit[];
  notes?: string;
  permanentDecline?: boolean;
  lastYearStatus?: UnitVisitStatus;
}

interface PlaceSearchInputProps {
  placeholder: string;
  biasLocation?: LatLng | null;
  onSelect: (place: SelectedPlaceData) => void;
  clearOnSelect?: boolean;
  initialValue?: string;
  searchScope?: 'parish' | 'address';
}

function getTypeLabel(placeType?: SelectedPlaceData['placeType']): string {
  if (placeType === 'parish') return 'Parafia / kościół';
  if (placeType === 'place') return 'Miejscowość';
  return 'Adres';
}

function ResultIcon({
  placeType,
}: {
  placeType?: SelectedPlaceData['placeType'];
}) {
  if (placeType === 'parish') {
    return <Church className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />;
  }
  if (placeType === 'place') {
    return <Building2 className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />;
  }
  return <MapPin className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />;
}

const GooglePlaceSearchInput: React.FC<PlaceSearchInputProps> = ({
  placeholder,
  biasLocation,
  onSelect,
  clearOnSelect = false,
  initialValue = '',
  searchScope = 'address',
}) => {
  const placesLib = useMapsLibrary('places');
  const [inputValue, setInputValue] = useState(initialValue);
  const [isUserEditing, setIsUserEditing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [fetchingDetails, setFetchingDetails] = useState(false);
  const [textFallbackResults, setTextFallbackResults] = useState<
    SelectedPlaceData[]
  >([]);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [fallbackCompleted, setFallbackCompleted] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [localError, setLocalError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const trimmedQuery = inputValue.trim();
  const autocompleteEnabled =
    isUserEditing && isOpen && trimmedQuery.length >= 2;

  const { suggestions, isLoading, error, resetSession } =
    useAutocompleteSuggestions(inputValue, biasLocation, autocompleteEnabled);

  useEffect(() => {
    setIsUserEditing(false);
    setInputValue(initialValue);
    setTextFallbackResults([]);
    setFallbackCompleted(false);
    setFallbackFailed(false);
    setLocalError(null);
  }, [initialValue]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [suggestions, textFallbackResults]);

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

  // Automatically fall back to Text Search + OSM/Nominatim whenever the user is
  // actively searching and Google Autocomplete fails, is unavailable, or returns sparse results.
  const needsFallback =
    autocompleteEnabled &&
    !isLoading &&
    (Boolean(error) ||
      !placesLib ||
      suggestions.length === 0 ||
      (searchScope === 'parish' && suggestions.length < 2));

  useEffect(() => {
    if (!needsFallback) {
      if (
        !autocompleteEnabled ||
        suggestions.length >= 2 ||
        (searchScope === 'address' && suggestions.length > 0)
      ) {
        setTextFallbackResults([]);
        setFallbackCompleted(false);
        setFallbackFailed(false);
      }
      return;
    }

    let cancelled = false;
    const delayMs = error ? 80 : 280;
    const timer = window.setTimeout(async () => {
      setFallbackLoading(true);
      setFallbackCompleted(false);
      setFallbackFailed(false);
      try {
        let fallbackItems: SelectedPlaceData[] = [];
        if (placesLib?.Place?.searchByText && !error) {
          try {
            const textRes = await placesLib.Place.searchByText({
              textQuery: trimmedQuery,
              fields: ['displayName', 'formattedAddress', 'location', 'id'],
              locationBias: biasLocation
                ? { center: biasLocation, radius: 15000 }
                : undefined,
              language: 'pl',
              region: 'pl',
              maxResultCount: 6,
            });
            fallbackItems = (textRes?.places ?? [])
              .filter((p) => p.location)
              .map((p) => ({
                name: p.displayName || trimmedQuery,
                address: p.formattedAddress || p.displayName || trimmedQuery,
                location: { lat: p.location!.lat(), lng: p.location!.lng() },
                placeId: p.id || `g_${p.location!.lat()}_${p.location!.lng()}`,
                placeType:
                  searchScope === 'parish'
                    ? ('parish' as const)
                    : ('address' as const),
              }));
          } catch (searchErr) {
            notifyIfQuotaExceeded(searchErr);
            // Fall through to OSM / Nominatim fallback
          }
        }

        if (fallbackItems.length === 0) {
          fallbackItems =
            searchScope === 'parish'
              ? await searchParishesOsm(trimmedQuery, biasLocation, 8)
              : await searchPlacesNominatim(trimmedQuery, biasLocation, 6);
        }

        if (!cancelled) {
          setTextFallbackResults(fallbackItems);
          setFallbackCompleted(true);
          setFallbackFailed(false);
        }
      } catch {
        if (!cancelled) {
          try {
            const osmItems =
              searchScope === 'parish'
                ? await searchParishesOsm(trimmedQuery, biasLocation, 8)
                : await searchPlacesNominatim(trimmedQuery, biasLocation, 6);
            if (!cancelled) {
              setTextFallbackResults(osmItems);
              setFallbackCompleted(true);
              setFallbackFailed(false);
            }
          } catch {
            if (!cancelled) {
              setFallbackCompleted(true);
              setFallbackFailed(true);
            }
          }
        }
      } finally {
        if (!cancelled) setFallbackLoading(false);
      }
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    needsFallback,
    autocompleteEnabled,
    trimmedQuery,
    error,
    suggestions.length,
    searchScope,
    placesLib,
    biasLocation,
  ]);

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
        placeType: searchScope === 'parish' ? 'parish' : 'address',
      });

      setIsUserEditing(false);
      resetSession();
      setTextFallbackResults([]);
      setFallbackCompleted(false);
      setFallbackFailed(false);
      setIsOpen(false);
      setFetchingDetails(false);
      setInputValue(clearOnSelect ? '' : name);
    } catch (err) {
      setFetchingDetails(false);
      notifyIfQuotaExceeded(err);
      setLocalError('Nie udało się pobrać szczegółów miejsca.');
    }
  };

  const handleSelectFallbackItem = (item: SelectedPlaceData) => {
    setIsUserEditing(false);
    onSelect(item);
    resetSession();
    setTextFallbackResults([]);
    setFallbackCompleted(false);
    setFallbackFailed(false);
    setLocalError(null);
    setIsOpen(false);
    setInputValue(clearOnSelect ? '' : item.name);
  };

  const usingFallback =
    suggestions.length === 0 && textFallbackResults.length > 0;
  const totalCount = usingFallback
    ? textFallbackResults.length
    : suggestions.length;
  const visibleError =
    localError ||
    (error && fallbackFailed && totalCount === 0
      ? 'Nie udało się połączyć z wyszukiwarką adresów. Sprawdź internet i spróbuj ponownie.'
      : null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' && totalCount > 0) {
      e.preventDefault();
      setIsOpen(true);
      setActiveIndex((prev) => (prev + 1) % totalCount);
      return;
    }
    if (e.key === 'ArrowUp' && totalCount > 0) {
      e.preventDefault();
      setIsOpen(true);
      setActiveIndex((prev) => (prev <= 0 ? totalCount - 1 : prev - 1));
      return;
    }
    if (e.key === 'Enter' && totalCount > 0) {
      e.preventDefault();
      const targetIdx = activeIndex >= 0 ? activeIndex : 0;
      if (usingFallback) {
        const picked = textFallbackResults[targetIdx];
        if (picked) handleSelectFallbackItem(picked);
      } else {
        const picked = suggestions[targetIdx];
        if (picked) void handleSelectSuggestion(picked);
      }
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
            setIsUserEditing(true);
            setInputValue(e.target.value);
            setIsOpen(true);
            setLocalError(null);
            setFallbackFailed(false);
          }}
          onFocus={(e) => {
            if (initialValue && e.currentTarget.value === initialValue) {
              e.currentTarget.select();
            }
            if (totalCount > 0) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-expanded={isOpen}
          aria-autocomplete="list"
          className="w-full min-h-[44px] pl-9 pr-10 py-2.5 text-base sm:text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600 transition-colors"
        />
        {(isLoading || fetchingDetails || fallbackLoading) && (
          <Loader2 className="w-4 h-4 text-amber-700 animate-spin absolute right-3" />
        )}
        {!isLoading &&
          !fetchingDetails &&
          !fallbackLoading &&
          inputValue.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setIsUserEditing(false);
                setInputValue('');
                resetSession();
                setTextFallbackResults([]);
                setFallbackCompleted(false);
                setFallbackFailed(false);
                setLocalError(null);
                setIsOpen(false);
              }}
              aria-label="Wyczyść wyszukiwanie"
              className="absolute right-1.5 min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
      </div>

      {visibleError && (
        <p className="mt-1.5 text-xs text-red-600">{visibleError}</p>
      )}

      {isOpen &&
        isUserEditing &&
        (totalCount > 0 ||
          (trimmedQuery.length >= 2 &&
            (isLoading || fallbackLoading || fallbackCompleted))) && (
          <div className="absolute z-30 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-72 overflow-y-auto">
            {totalCount === 0 && (isLoading || fallbackLoading) ? (
              <div className="px-3.5 py-3 text-xs text-slate-500 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 text-amber-700 animate-spin shrink-0" />
                <span>
                  {searchScope === 'parish'
                    ? 'Szukam parafii, kościołów i miejscowości...'
                    : 'Szukam pasujących adresów...'}
                </span>
              </div>
            ) : totalCount === 0 ? (
              <div className="px-3.5 py-3 text-xs text-slate-500 leading-relaxed">
                {searchScope === 'parish'
                  ? 'Brak dokładnego dopasowania. Wpisz samo miasto (np. Mikołów) lub kliknij „Parafie w pobliżu” poniżej.'
                  : 'Nie znaleziono pasującego adresu.'}
              </div>
            ) : usingFallback ? (
              <ul role="listbox" className="divide-y divide-slate-100">
                {textFallbackResults.map((item, idx) => (
                  <li key={item.placeId}>
                    <button
                      type="button"
                      onClick={() => handleSelectFallbackItem(item)}
                      className={`w-full min-h-[46px] text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors ${
                        activeIndex === idx
                          ? 'bg-amber-50/70'
                          : 'hover:bg-slate-50 focus:bg-slate-50'
                      } focus:outline-none`}
                    >
                      <ResultIcon placeType={item.placeType} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {item.name}
                        </div>
                        <div className="text-xs text-slate-500 truncate mt-0.5">
                          <span>{getTypeLabel(item.placeType)}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{item.address}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <ul role="listbox" className="divide-y divide-slate-100">
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
                        className={`w-full min-h-[46px] text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors ${
                          activeIndex === idx
                            ? 'bg-amber-50/70'
                            : 'hover:bg-slate-50 focus:bg-slate-50'
                        } focus:outline-none`}
                      >
                        <ResultIcon
                          placeType={
                            searchScope === 'parish' ? 'parish' : 'address'
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-900 truncate">
                            {mainText}
                          </div>
                          {secondaryText && (
                            <div className="text-xs text-slate-500 truncate mt-0.5">
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
  searchScope = 'address',
}) => {
  const [inputValue, setInputValue] = useState(initialValue);
  const [results, setResults] = useState<SelectedPlaceData[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const suppressSearchRef = useRef(false);

  useEffect(() => {
    suppressSearchRef.current = true;
    setInputValue(initialValue);
    setError(null);
  }, [initialValue]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

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
    if (q.length < 2) {
      setResults([]);
      setIsLoading(false);
      setHasSearched(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const items =
          searchScope === 'parish'
            ? await searchParishesOsm(q, biasLocation, 8)
            : await searchPlacesNominatim(q, biasLocation, 6);
        if (!cancelled) {
          setResults(items);
          setHasSearched(true);
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
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inputValue, biasLocation, searchScope]);

  const handleSelectItem = (item: SelectedPlaceData) => {
    suppressSearchRef.current = true;
    onSelect(item);
    setIsOpen(false);
    setResults([]);
    setHasSearched(false);
    setInputValue(clearOnSelect ? '' : item.name);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setIsOpen(true);
      setActiveIndex((prev) => (prev + 1) % results.length);
      return;
    }
    if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setIsOpen(true);
      setActiveIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
      return;
    }
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      const picked = results[activeIndex >= 0 ? activeIndex : 0];
      if (picked) handleSelectItem(picked);
    }
  };

  const trimmed = inputValue.trim();
  const showDropdown =
    isOpen &&
    (results.length > 0 ||
      (trimmed.length >= 2 && (isLoading || hasSearched)));

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
          onFocus={(e) => {
            if (initialValue && e.currentTarget.value === initialValue) {
              e.currentTarget.select();
            }
            if (results.length > 0) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-expanded={isOpen}
          aria-autocomplete="list"
          className="w-full min-h-[44px] pl-9 pr-10 py-2.5 text-base sm:text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600 transition-colors"
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
              setHasSearched(false);
              setError(null);
              setIsOpen(false);
            }}
            aria-label="Wyczyść wyszukiwanie"
            className="absolute right-1.5 min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}

      {showDropdown && (
        <div className="absolute z-30 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-72 overflow-y-auto">
          {results.length > 0 ? (
            <ul role="listbox" className="divide-y divide-slate-100">
              {results.map((item, idx) => (
                <li key={item.placeId}>
                  <button
                    type="button"
                    onClick={() => handleSelectItem(item)}
                    className={`w-full min-h-[46px] text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors ${
                      activeIndex === idx
                        ? 'bg-amber-50/70'
                        : 'hover:bg-slate-50 focus:bg-slate-50'
                    } focus:outline-none`}
                  >
                    <ResultIcon placeType={item.placeType} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {item.name}
                      </div>
                      <div className="text-xs text-slate-500 truncate mt-0.5">
                        {searchScope === 'parish' && (
                          <>
                            <span>{getTypeLabel(item.placeType)}</span>
                            <span aria-hidden="true"> · </span>
                          </>
                        )}
                        <span>{item.address}</span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : isLoading ? (
            <div className="px-3.5 py-3 text-xs text-slate-500 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 text-amber-700 animate-spin shrink-0" />
              <span>
                {searchScope === 'parish'
                  ? 'Szukam parafii, kościołów i miejscowości...'
                  : 'Szukam adresu...'}
              </span>
            </div>
          ) : (
            <div className="px-3.5 py-3 text-xs text-slate-500 leading-relaxed">
              {searchScope === 'parish'
                ? 'Brak dokładnego dopasowania. Wpisz samo miasto (np. Mikołów) lub kliknij „Parafie w pobliżu” poniżej.'
                : 'Nie znaleziono pasującego adresu.'}
            </div>
          )}
        </div>
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
