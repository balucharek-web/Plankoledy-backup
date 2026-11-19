import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Loader2,
  Map as MapIcon,
  Search,
  X,
} from 'lucide-react';
import {
  OsmHousePoint,
  OsmStreetGroup,
  fetchParishStreetsFromOsm,
  isEvenHouseNumber,
} from '../services/overpassStreets';
import { LatLng, ParishCenter } from '../types/parish';
import { SelectedPlaceData } from './PlaceSearchInput';

interface OsmStreetFetcherModalProps {
  open: boolean;
  parish: ParishCenter | null;
  boundary: LatLng[];
  onClose: () => void;
  onAddPlaces: (places: SelectedPlaceData[]) => void;
}

export const OsmStreetFetcherModal: React.FC<OsmStreetFetcherModalProps> = ({
  open,
  parish,
  boundary,
  onClose,
  onAddPlaces,
}) => {
  const [radiusMeters, setRadiusMeters] = useState(600);
  const [loading, setLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streets, setStreets] = useState<OsmStreetGroup[] | null>(null);
  const [filterText, setFilterText] = useState('');

  const [selectedStreetNames, setSelectedStreetNames] = useState<
    Record<string, boolean>
  >({});
  const [selectedHouses, setSelectedHouses] = useState<
    Record<string, OsmHousePoint>
  >({});
  const [expandedStreet, setExpandedStreet] = useState<string | null>(null);

  const hasBoundary = boundary.length >= 3;

  const handleFetch = useCallback(async () => {
    if (!parish) return;
    setLoading(true);
    setScanProgress(null);
    setError(null);
    setSelectedStreetNames({});
    setSelectedHouses({});
    setExpandedStreet(null);
    try {
      const result = await fetchParishStreetsFromOsm({
        boundary,
        center: parish.location,
        radiusMeters,
        onProgress: (completed, total) => {
          setScanProgress({ completed, total });
        },
      });
      setStreets(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Nie udało się wykryć ulic i adresów dla tego obszaru.'
      );
    } finally {
      setLoading(false);
      setScanProgress(null);
    }
  }, [boundary, parish, radiusMeters]);

  useEffect(() => {
    if (open && parish) {
      void handleFetch();
    } else if (!open) {
      setStreets(null);
      setError(null);
      setFilterText('');
    }
  }, [open, parish?.location.lat, parish?.location.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const filteredStreets = useMemo(() => {
    if (!streets) return [];
    const q = filterText.trim().toLowerCase();
    if (!q) return streets;
    return streets.filter((s) => s.streetName.toLowerCase().includes(q));
  }, [streets, filterText]);

  const totalDetectedHouses = useMemo(
    () =>
      (streets ?? []).reduce((sum, s) => sum + s.houses.length, 0),
    [streets]
  );

  const totalSelectedCount = useMemo(() => {
    const streetCount = Object.values(selectedStreetNames).filter(Boolean).length;
    const houseCount = Object.keys(selectedHouses).length;
    return streetCount + houseCount;
  }, [selectedStreetNames, selectedHouses]);

  if (!open || !parish) return null;

  const toggleStreetAllHouses = (street: OsmStreetGroup) => {
    if (street.houses.length === 0) {
      setSelectedStreetNames((prev) => ({
        ...prev,
        [street.streetName]: !prev[street.streetName],
      }));
      return;
    }

    const allHousesSelected = street.houses.every((h) => !!selectedHouses[h.id]);
    setSelectedHouses((prev) => {
      const next = { ...prev };
      if (allHousesSelected) {
        for (const h of street.houses) delete next[h.id];
      } else {
        for (const h of street.houses) next[h.id] = h;
      }
      return next;
    });
  };

  const toggleHouse = (house: OsmHousePoint) => {
    setSelectedHouses((prev) => {
      const next = { ...prev };
      if (next[house.id]) {
        delete next[house.id];
      } else {
        next[house.id] = house;
      }
      return next;
    });
  };

  const selectHousesByParity = (
    street: OsmStreetGroup,
    mode: 'all' | 'even' | 'odd' | 'none'
  ) => {
    setSelectedHouses((prev) => {
      const next = { ...prev };
      for (const h of street.houses) {
        delete next[h.id];
      }
      if (mode === 'none') return next;

      for (const h of street.houses) {
        if (mode === 'all') {
          next[h.id] = h;
        } else {
          const even = isEvenHouseNumber(h.houseNumber);
          if (mode === 'even' && even === true) next[h.id] = h;
          if (mode === 'odd' && even === false) next[h.id] = h;
        }
      }
      return next;
    });
  };

  const handleSelectAllFilteredHouses = () => {
    setSelectedHouses((prev) => {
      const next = { ...prev };
      for (const street of filteredStreets) {
        for (const h of street.houses) {
          next[h.id] = h;
        }
      }
      return next;
    });
    setSelectedStreetNames((prev) => {
      const next = { ...prev };
      for (const street of filteredStreets) {
        if (street.houses.length === 0) {
          next[street.streetName] = true;
        }
      }
      return next;
    });
  };

  const handleConfirmAdd = () => {
    if (!streets) return;
    const placesToAdd: SelectedPlaceData[] = [];

    for (const s of streets) {
      if (selectedStreetNames[s.streetName]) {
        placesToAdd.push({
          name: s.streetName,
          address: `${s.streetName} (środek ulicy)`,
          location: s.center,
          placeId: '',
        });
      }
    }

    for (const house of Object.values(selectedHouses)) {
      placesToAdd.push({
        name: house.label,
        address: house.fullAddress,
        location: house.location,
        placeId: '',
        ...(house.isMultiUnit
          ? {
              isMultiUnit: true,
              unitsCount: house.suggestedUnitsCount ?? 15,
            }
          : {}),
      });
    }

    if (placesToAdd.length > 0) {
      onAddPlaces(placesToAdd);
      onClose();
    }
  };

  const handleAddAllAreaNow = () => {
    if (!streets || streets.length === 0) return;
    const placesToAdd: SelectedPlaceData[] = [];

    for (const s of streets) {
      if (s.houses.length === 0) {
        placesToAdd.push({
          name: s.streetName,
          address: `${s.streetName} (środek ulicy)`,
          location: s.center,
          placeId: '',
        });
      } else {
        for (const house of s.houses) {
          placesToAdd.push({
            name: house.label,
            address: house.fullAddress,
            location: house.location,
            placeId: '',
            ...(house.isMultiUnit
              ? {
                  isMultiUnit: true,
                  unitsCount: house.suggestedUnitsCount ?? 15,
                }
              : {}),
          });
        }
      }
    }

    if (placesToAdd.length > 0) {
      onAddPlaces(placesToAdd);
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="osm-modal-title"
      className="fixed inset-0 z-[1200] bg-slate-950/50 flex items-end sm:items-center justify-center p-2 sm:p-4"
    >
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xl max-w-2xl w-full max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3.5 sm:px-6 sm:py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <h2
              id="osm-modal-title"
              className="text-sm sm:text-base font-semibold text-slate-900"
            >
              Wykryj ulice i adresy z terenu parafii
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Zaznacz ulice lub konkretne numery domów do zapamiętania dla tej
              parafii.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij"
            className="p-2 text-slate-400 hover:text-slate-700 rounded-lg shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Fetch controls */}
        <div className="px-4 py-3 sm:px-6 sm:py-3.5 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          {hasBoundary ? (
            <div className="text-xs text-slate-700 flex items-center gap-2">
              <MapIcon className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                Obszar: <strong>wyznaczony teren parafii</strong> (
                {boundary.length} punktów)
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
              <span>Promień wokół kościoła:</span>
              <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-lg">
                {[400, 600, 1000].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRadiusMeters(r)}
                    className={`min-h-[34px] px-2.5 py-1 rounded-md font-mono tabular-nums transition-colors ${
                      radiusMeters === r
                        ? 'bg-white text-slate-900 shadow-sm font-medium'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {r} m
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleFetch()}
            disabled={loading}
            className="w-full sm:w-auto min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-400 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {loading
              ? scanProgress && scanProgress.total > 0
                ? `Skanowanie (${scanProgress.completed}/${scanProgress.total})...`
                : 'Skanowanie adresów...'
              : 'Odśwież listę'}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4">
          {loading && !streets && (
            <div className="py-12 text-center space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-amber-700 mx-auto" />
              <p className="text-xs text-slate-600 tabular-nums">
                {scanProgress && scanProgress.total > 0
                  ? `Skanowanie oficjalnych adresów w obszarze parafii (${scanProgress.completed} z ${scanProgress.total} sektorów)...`
                  : 'Wykrywanie ulic i oficjalnych adresów domów w obszarze...'}
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
              {error}
            </div>
          )}

          {streets && streets.length === 0 && !loading && (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-slate-800">
                Nie znaleziono adresów w tym obszarze
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Spróbuj powiększyć wyznaczony obszar lub kliknij konkretną ulicę
                na mapie.
              </p>
            </div>
          )}

          {streets && streets.length > 0 && (
            <>
              <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="text-xs text-emerald-950">
                  Wykryto <strong>{streets.length}</strong> ulic i{' '}
                  <strong>{totalDetectedHouses}</strong> adresów (PRG +
                  OpenStreetMap).
                </div>
                <button
                  type="button"
                  onClick={handleAddAllAreaNow}
                  className="min-h-[38px] px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 shadow-xs transition-colors"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  <span>
                    Dodaj cały teren ({streets.length} ul. /{' '}
                    {totalDetectedHouses > 0
                      ? `${totalDetectedHouses} domów`
                      : 'ulice'}
                    )
                  </span>
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder="Filtruj po nazwie ulicy..."
                    className="w-full pl-9 pr-3 py-2 text-base sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-amber-600"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSelectAllFilteredHouses}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  Zaznacz wszystkie ({filteredStreets.length})
                </button>
              </div>

              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {filteredStreets.map((street) => {
                  const isExpanded = expandedStreet === street.streetName;
                  const selectedHousesCount = street.houses.filter(
                    (h) => !!selectedHouses[h.id]
                  ).length;
                  const streetChecked =
                    street.houses.length > 0
                      ? selectedHousesCount === street.houses.length
                      : !!selectedStreetNames[street.streetName];

                  return (
                    <div key={street.streetName} className="bg-white">
                      <div className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50/70">
                        <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={streetChecked}
                            onChange={() => toggleStreetAllHouses(street)}
                            className="w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600"
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 truncate">
                              {street.streetName}
                            </div>
                            <div className="text-xs text-slate-500 tabular-nums">
                              {street.houses.length > 0
                                ? `${street.houses.length} wykrytych domów`
                                : 'Brak pojedynczych numerów (dodaj punkt ulicy)'}
                              {selectedHousesCount > 0 &&
                                ` · wybrano ${selectedHousesCount}`}
                            </div>
                          </div>
                        </label>

                        {street.houses.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedStreet(
                                isExpanded ? null : street.streetName
                              )
                            }
                            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                            Numery
                          </button>
                        )}
                      </div>

                      {isExpanded && street.houses.length > 0 && (
                        <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 space-y-2.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="text-slate-500 mr-1">
                              Zaznacz:
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                selectHousesByParity(street, 'all')
                              }
                              className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700"
                            >
                              Wszystkie
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                selectHousesByParity(street, 'even')
                              }
                              className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700"
                            >
                              Parzyste
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                selectHousesByParity(street, 'odd')
                              }
                              className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700"
                            >
                              Nieparzyste
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                selectHousesByParity(street, 'none')
                              }
                              className="px-2 py-1 text-slate-500 hover:text-slate-800"
                            >
                              Odznacz
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                            {street.houses.map((house) => {
                              const active = !!selectedHouses[house.id];
                              return (
                                <button
                                  key={house.id}
                                  type="button"
                                  onClick={() => toggleHouse(house)}
                                  className={`px-2.5 py-1 text-xs font-mono tabular-nums rounded-lg border transition-colors ${
                                    active
                                      ? 'bg-amber-700 border-amber-700 text-white font-medium'
                                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                                  }`}
                                >
                                  {house.houseNumber}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-500 tabular-nums">
            Wybrane ulice i adresy zostaną zapamiętane dla tej parafii.
          </div>
          <div className="flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              Anuluj
            </button>
            <button
              type="button"
              disabled={totalSelectedCount === 0}
              onClick={handleConfirmAdd}
              className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl tabular-nums"
            >
              Zapisz do parafii ({totalSelectedCount})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
