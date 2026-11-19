import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Ban,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Church,
  Cloud,
  FileSpreadsheet,
  Home,
  Layers,
  Loader2,
  LocateFixed,
  LogIn,
  Map as MapIcon,
  MapPin,
  MapPinPlus,
  Maximize2,
  Minimize2,
  Pentagon,
  Route,
  ScanSearch,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { getCurrentPositionResilient } from '../hooks/useUserGpsLocation';
import {
  NearbyParishCandidate,
  describeLocationForGpsFallback,
  extractLocalityQueryHint,
  fetchNearbyParishesOsm,
  fetchPlaceBoundaryPolygonOsm,
} from '../services/overpassStreets';
import {
  LatLng,
  MapInteractionMode,
  ParishCenter,
  SavedParishRecord,
  StreetPickFeedback,
  VisitStop,
} from '../types/parish';
import {
  compareStopsByHouseNumber,
  computePolygonAreaSqMeters,
  computeStreetNumberBounds,
  extractHouseNumberLabel,
  extractStreetName,
  findMissingHouseNumberGaps,
  formatPolygonArea,
  getStopUnitCount,
  isBlockStop,
} from '../utils/spatial';
import { PlaceSearchInput, SelectedPlaceData } from './PlaceSearchInput';

const CsvImportModal = lazy(() =>
  import('./CsvImportModal').then((m) => ({ default: m.CsvImportModal }))
);
const OsmStreetFetcherModal = lazy(() =>
  import('./OsmStreetFetcherModal').then((m) => ({
    default: m.OsmStreetFetcherModal,
  }))
);

export type SetupTab = 'parish' | 'area' | 'streets';

interface SidebarSetupProps {
  parish: ParishCenter | null;
  activeParishId: string | null;
  savedParishes: SavedParishRecord[];
  boundary: LatLng[];
  stops: VisitStop[];
  interactionMode: MapInteractionMode;
  streetPickFeedback: StreetPickFeedback | null;
  isSignedIn: boolean;
  userEmail: string | null;
  requestedTab?: { tab: SetupTab; seq: number; streetName?: string } | null;
  csvImportOpen?: boolean;
  onOpenCsvImport?: () => void;
  onCloseCsvImport?: () => void;
  onDismissStreetFeedback: () => void;
  onSignInGoogle: () => void;
  onSelectParish: (place: SelectedPlaceData) => void;
  onSelectSavedParish: (parishId: string) => void;
  onDeleteSavedParish: (parishId: string) => void;
  onCreatePresetBoundary: (radiusMeters?: number) => void;
  onScaleBoundary: (factor: number) => void;
  onExpandBoundaryMeters?: (meters: number) => void;
  onToggleDrawBoundary: () => void;
  onToggleEditBoundary: () => void;
  onWrapStopsBoundary: () => void;
  onApplyLocalityBoundary: (points: LatLng[], placeName: string) => void;
  onClearBoundary: () => void;
  onTogglePickStreetMode: () => void;
  onToggleMapAddMode: () => void;
  onAddPlaceStop: (place: SelectedPlaceData) => void;
  onBatchAddStops: (places: SelectedPlaceData[]) => void;
  onEnrichExistingStops?: (
    patches: Array<{ id: string; patch: Partial<VisitStop> }>
  ) => void;
  defaultVisitMinutes?: number;
  onUpdateStop?: (id: string, patch: Partial<VisitStop>) => void;
  onOpenBlockUnits?: (stopId: string) => void;
  onClearStops?: () => void;
  onDeleteStreetStops: (stopIds: string[]) => void;
  onDeleteOutsideBoundaryStops?: () => void;
  onDeleteStop?: (stopId: string) => void;
  onSelectStop?: (stopId: string) => void;
  onFocusStreetOnMap?: (streetName: string) => void;
  onAddMissingOnStreet?: (streetName: string) => void;
  onOpenAreaScanner?: () => void;
  onViewMap: () => void;
  onNextStep: () => void;
}

function formatShortDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export const SidebarSetup: React.FC<SidebarSetupProps> = ({
  parish,
  activeParishId,
  savedParishes,
  boundary,
  stops,
  interactionMode,
  streetPickFeedback,
  isSignedIn,
  userEmail,
  requestedTab,
  csvImportOpen: controlledCsvOpen,
  onOpenCsvImport,
  onCloseCsvImport,
  onDismissStreetFeedback,
  onSignInGoogle,
  onSelectParish,
  onSelectSavedParish,
  onDeleteSavedParish,
  onCreatePresetBoundary,
  onScaleBoundary,
  onExpandBoundaryMeters,
  onToggleDrawBoundary,
  onToggleEditBoundary,
  onWrapStopsBoundary,
  onApplyLocalityBoundary,
  onClearBoundary,
  onTogglePickStreetMode,
  onToggleMapAddMode,
  onAddPlaceStop,
  onBatchAddStops,
  onEnrichExistingStops,
  defaultVisitMinutes,
  onUpdateStop,
  onOpenBlockUnits,
  onClearStops,
  onDeleteStreetStops,
  onDeleteOutsideBoundaryStops,
  onDeleteStop,
  onSelectStop,
  onFocusStreetOnMap,
  onAddMissingOnStreet,
  onOpenAreaScanner,
  onViewMap,
  onNextStep,
}) => {
  const [setupTab, setSetupTab] = useState<SetupTab>(() => {
    if (requestedTab?.tab) return requestedTab.tab;
    return !parish ? 'parish' : 'area';
  });
  const [showManualTools, setShowManualTools] = useState(false);
  const [areaScannerOpen, setAreaScannerOpen] = useState(false);
  const [localCsvImportOpen, setLocalCsvImportOpen] = useState(false);
  const csvImportOpen =
    controlledCsvOpen !== undefined ? controlledCsvOpen : localCsvImportOpen;
  const openCsvModal = () => {
    if (onOpenCsvImport) onOpenCsvImport();
    else setLocalCsvImportOpen(true);
  };
  const closeCsvModal = () => {
    if (onCloseCsvImport) onCloseCsvImport();
    else setLocalCsvImportOpen(false);
  };

  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [nearbyChurches, setNearbyChurches] = useState<
    NearbyParishCandidate[] | null
  >(null);
  const [localityQuery, setLocalityQuery] = useState('');
  const [localityLoading, setLocalityLoading] = useState(false);
  const [localityError, setLocalityError] = useState<string | null>(null);
  const [streetFilter, setStreetFilter] = useState('');
  const [streetsTypeFilter, setStreetsTypeFilter] = useState<
    'all' | 'blocks' | 'declined'
  >('all');
  const [expandedStreet, setExpandedStreet] = useState<string | null>(null);
  const [editingStopDetailsId, setEditingStopDetailsId] = useState<string | null>(
    null
  );

  const isDrawing = interactionMode === 'draw_boundary';
  const isEditingBoundary = interactionMode === 'edit_boundary';
  const isPickingStreet = interactionMode === 'pick_street';
  const isAddingHouse = interactionMode === 'add_stop';
  const manualToolsOpen = showManualTools || isPickingStreet || isAddingHouse;

  useEffect(() => {
    if (requestedTab && requestedTab.seq > 0 && parish) {
      setSetupTab(requestedTab.tab);
      if (requestedTab.streetName) {
        setStreetsTypeFilter('all');
        setStreetFilter('');
        setExpandedStreet(requestedTab.streetName);
        const targetName = requestedTab.streetName;
        window.setTimeout(() => {
          const el = document.querySelector<HTMLElement>(
            `[data-street-row="${CSS.escape(targetName)}"]`
          );
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
      }
    }
  }, [requestedTab, parish]);

  // Keep tab aligned if parish is cleared or map drawing/picking mode starts
  useEffect(() => {
    if (!parish) {
      setSetupTab('parish');
    } else if (isDrawing || isEditingBoundary || isPickingStreet || isAddingHouse) {
      setSetupTab('area');
    }
  }, [parish, isDrawing, isEditingBoundary, isPickingStreet, isAddingHouse]);

  const localityHint = useMemo(
    () => extractLocalityQueryHint(parish?.address, parish?.name),
    [parish?.address, parish?.name]
  );

  const boundaryAreaText = useMemo(
    () => formatPolygonArea(computePolygonAreaSqMeters(boundary)),
    [boundary]
  );

  const outsideBoundaryCount = useMemo(
    () =>
      boundary.length >= 3
        ? stops.filter((s) => s.inBoundary === false).length
        : 0,
    [boundary.length, stops]
  );

  const handleFetchLocalityBoundary = async () => {
    const query = (localityQuery || localityHint).trim();
    if (!query || localityLoading) return;
    setLocalityLoading(true);
    setLocalityError(null);
    try {
      const result = await fetchPlaceBoundaryPolygonOsm(query, parish?.location);
      if (!result) {
        setLocalityError(
          `Nie znaleziono oficjalnego obrysu granic dla „${query}”. Spróbuj innej nazwy (np. miasta lub sołectwa) albo zakreśl teren na mapie.`
        );
        return;
      }
      onApplyLocalityBoundary(result.polygon, result.name);
      if (!localityQuery.trim()) setLocalityQuery(result.name);
    } catch {
      setLocalityError(
        'Nie udało się pobrać granic miejscowości — sprawdź połączenie lub narysuj obszar ręcznie.'
      );
    } finally {
      setLocalityLoading(false);
    }
  };

  const savedStreets = useMemo(() => {
    const groups: Record<string, VisitStop[]> = {};
    for (const stop of stops) {
      const street = extractStreetName(stop);
      if (!groups[street]) groups[street] = [];
      groups[street].push(stop);
    }
    return Object.entries(groups)
      .map(
        ([name, list]) =>
          [name, [...list].sort(compareStopsByHouseNumber)] as [
            string,
            VisitStop[],
          ]
      )
      .sort((a, b) => a[0].localeCompare(b[0], 'pl'));
  }, [stops]);

  const parishBuildingStats = useMemo(() => {
    let blocks = 0;
    let units = 0;
    let declined = 0;
    for (const s of stops) {
      if (isBlockStop(s)) {
        blocks += 1;
        units += getStopUnitCount(s);
      }
      if (s.permanentDecline || s.included === false) {
        declined += 1;
      }
    }
    return {
      houses: stops.length - blocks,
      blocks,
      units,
      declined,
    };
  }, [stops]);

  const filteredStreets = useMemo(() => {
    const q = streetFilter.trim().toLowerCase();
    return savedStreets
      .map(([name, list]) => {
        const typeFiltered = list.filter((s) => {
          if (streetsTypeFilter === 'blocks') return isBlockStop(s);
          if (streetsTypeFilter === 'declined') {
            return Boolean(s.permanentDecline || s.included === false);
          }
          return true;
        });
        if (typeFiltered.length === 0) return null;
        if (q) {
          const streetMatches = name.toLowerCase().includes(q);
          if (!streetMatches) {
            const addrMatches = typeFiltered.filter(
              (s) =>
                s.address.toLowerCase().includes(q) ||
                s.label.toLowerCase().includes(q) ||
                (s.notes && s.notes.toLowerCase().includes(q))
            );
            if (addrMatches.length === 0) return null;
            return [name, addrMatches] as [string, VisitStop[]];
          }
        }
        return [name, typeFiltered] as [string, VisitStop[]];
      })
      .filter((entry): entry is [string, VisitStop[]] => entry !== null);
  }, [savedStreets, streetFilter, streetsTypeFilter]);

  const [lastGpsLocation, setLastGpsLocation] = useState<{
    location: LatLng;
    city: string;
    address: string;
  } | null>(null);

  const loadChurchesAround = async (center: LatLng) => {
    setNearbyLoading(true);
    setNearbyError(null);
    try {
      const list = await fetchNearbyParishesOsm(center, 7000);
      setNearbyChurches(list);
      if (list.length === 0) {
        setNearbyError(
          'Nie znaleziono kościołów w promieniu 7 km. Możesz użyć bieżącej pozycji GPS lub wpisać nazwę parafii.'
        );
      }
    } catch (err) {
      setNearbyError(
        err instanceof Error
          ? err.message
          : 'Nie udało się pobrać listy kościołów w okolicy.'
      );
    } finally {
      setNearbyLoading(false);
    }
  };

  const handleFindNearbyGps = async () => {
    setNearbyLoading(true);
    setNearbyError(null);
    setLastGpsLocation(null);
    try {
      const gps = await getCurrentPositionResilient();
      const [listRes, descRes] = await Promise.allSettled([
        fetchNearbyParishesOsm(gps.location, 7000),
        describeLocationForGpsFallback(gps.location),
      ]);
      const list = listRes.status === 'fulfilled' ? listRes.value : [];
      const desc =
        descRes.status === 'fulfilled'
          ? descRes.value
          : {
              city: '',
              address: `${gps.location.lat.toFixed(5)}, ${gps.location.lng.toFixed(5)}`,
            };

      setLastGpsLocation({
        location: gps.location,
        city: desc.city,
        address: desc.address,
      });
      setNearbyChurches(list);
      if (list.length === 0) {
        setNearbyError(
          'Nie znaleziono kościołów w promieniu 7 km. Możesz użyć bieżącej pozycji GPS poniżej.'
        );
      }
    } catch (err) {
      setNearbyError(
        err instanceof Error
          ? err.message
          : 'Nie udało się odczytać lokalizacji GPS.'
      );
    } finally {
      setNearbyLoading(false);
    }
  };

  const handleChooseParishAndAdvance = (place: SelectedPlaceData) => {
    setNearbyChurches(null);
    setNearbyError(null);
    setLastGpsLocation(null);
    onSelectParish(place);
    if (place.placeType === 'place') {
      void loadChurchesAround(place.location);
    } else {
      setSetupTab('area');
    }
  };

  return (
    <div className="min-h-full flex flex-col">
      {/* Sticky Top Step Switcher (Compact on both Mobile & Desktop) */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-slate-200 px-3 pt-2.5 pb-2.5 space-y-2 shrink-0">
        {parish && setupTab !== 'parish' && (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-amber-50/80 border border-amber-200/80">
            <div className="min-w-0 flex items-center gap-1.5">
              <Church className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span className="text-xs font-semibold text-slate-900 truncate">
                {parish.name}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSetupTab('parish')}
              className="px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 rounded-lg shrink-0 transition-colors"
            >
              Zmień
            </button>
          </div>
        )}

        <div
          role="tablist"
          aria-label="Kroki konfiguracji parafii"
          className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100"
        >
          <button
            type="button"
            role="tab"
            aria-selected={setupTab === 'parish'}
            onClick={() => setSetupTab('parish')}
            className={`min-h-[40px] px-2 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
              setupTab === 'parish'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {parish && (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            )}
            <span>1. Parafia</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={setupTab === 'area'}
            disabled={!parish}
            onClick={() => setSetupTab('area')}
            className={`min-h-[40px] px-2 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap disabled:opacity-45 ${
              setupTab === 'area'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {boundary.length >= 3 && (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            )}
            <span>2. Teren</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={setupTab === 'streets'}
            disabled={!parish}
            onClick={() => setSetupTab('streets')}
            className={`min-h-[40px] px-2 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap tabular-nums disabled:opacity-45 ${
              setupTab === 'streets'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>3. Ulice ({savedStreets.length})</span>
          </button>
        </div>
      </div>

      {/* Main Active Tab Body (Zero nested scroll traps!) */}
      <div className="flex-1">
        {/* TAB 1: PARAFIA */}
        {setupTab === 'parish' && (
          <div className="p-4 sm:p-5 space-y-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Wybierz parafię lub kościół
                </h2>
                {parish && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Aktywna
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Wpisz nazwę parafii, wezwanie lub miejscowość — wybór automatycznie
                zapisuje się na Twoim koncie.
              </p>
            </div>

            <PlaceSearchInput
              placeholder="np. św Antoni Mikołów, Bazylika lub Mikołów"
              searchScope="parish"
              onSelect={handleChooseParishAndAdvance}
              initialValue={parish?.name ?? ''}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={nearbyLoading}
                onClick={() => void handleFindNearbyGps()}
                className="min-h-[42px] py-2 px-3 text-xs font-medium rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                {nearbyLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
                ) : (
                  <LocateFixed className="w-3.5 h-3.5 text-amber-700" />
                )}
                <span>Parafie w pobliżu (GPS)</span>
              </button>

              {parish && (
                <button
                  type="button"
                  disabled={nearbyLoading}
                  onClick={() => void loadChurchesAround(parish.location)}
                  className="min-h-[42px] py-2 px-3 text-xs font-medium rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Church className="w-3.5 h-3.5 text-amber-700" />
                  <span>Kościoły w okolicy</span>
                </button>
              )}
            </div>

            {nearbyError && (
              <p className="text-xs text-red-600 leading-snug">{nearbyError}</p>
            )}

            {nearbyChurches && nearbyChurches.length > 0 && (
              <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700">
                    Kościoły w promieniu 7 km ({nearbyChurches.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setNearbyChurches(null)}
                    aria-label="Zamknij listę kościołów"
                    className="p-1 text-slate-400 hover:text-slate-700 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <ul className="divide-y divide-slate-100">
                  {nearbyChurches.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectParish({
                            name: item.name,
                            address: item.address,
                            location: item.location,
                            placeId: item.id,
                            placeType: 'parish',
                          });
                          setNearbyChurches(null);
                          setLastGpsLocation(null);
                          setSetupTab('area');
                        }}
                        className="w-full min-h-[48px] px-3 py-2.5 text-left hover:bg-amber-50/60 flex items-start justify-between gap-2 transition-colors"
                      >
                        <div className="min-w-0 flex items-start gap-2">
                          <Church className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-900 truncate">
                              {item.name}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {item.address}
                            </div>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0 mt-0.5">
                          {formatShortDistance(item.distanceMeters)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {lastGpsLocation && (
              <button
                type="button"
                onClick={() => {
                  onSelectParish({
                    name: lastGpsLocation.city
                      ? `Parafia — ${lastGpsLocation.city}`
                      : 'Moja parafia (punkt GPS)',
                    address: lastGpsLocation.address,
                    location: lastGpsLocation.location,
                    placeId: `gps_${lastGpsLocation.location.lat.toFixed(5)}_${lastGpsLocation.location.lng.toFixed(5)}`,
                    placeType: 'parish',
                  });
                  setNearbyChurches(null);
                  setLastGpsLocation(null);
                  setNearbyError(null);
                  setSetupTab('area');
                }}
                className="w-full min-h-[44px] px-3 py-2 text-left rounded-xl border border-amber-200 bg-amber-50/70 hover:bg-amber-100/70 flex items-center justify-between gap-2 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-amber-950 truncate">
                    Użyj mojej bieżącej pozycji GPS
                  </div>
                  <div className="text-[11px] text-amber-800 truncate">
                    {lastGpsLocation.address}
                  </div>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              </button>
            )}

            {parish && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-2">
                <div>
                  <div className="font-semibold text-slate-900">
                    {parish.name}
                  </div>
                  <div className="mt-0.5 text-slate-500">{parish.address}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSetupTab('area')}
                  className="w-full min-h-[40px] py-2 px-3 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span>Przejdź do granic i ulic</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {isSignedIn ? (
              <div className="pt-3 border-t border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">
                    Zapamiętane parafie ({savedParishes.length})
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                    <Cloud className="w-3 h-3" />
                    {userEmail?.split('@')[0] || 'Google'}
                  </span>
                </div>

                {savedParishes.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Wyszukaj pierwszą parafię powyżej — zostanie zapisana na
                    Twoim koncie.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {savedParishes.map((rec) => {
                      const isActive = rec.id === activeParishId;
                      return (
                        <li
                          key={rec.id}
                          className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors ${
                            isActive
                              ? 'bg-amber-50/70 border-amber-300'
                              : 'bg-white border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onSelectSavedParish(rec.id);
                              setSetupTab('area');
                            }}
                            className="flex-1 min-w-0 text-left flex items-start gap-2 min-h-[40px]"
                          >
                            <MapPin
                              className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                                isActive ? 'text-amber-700' : 'text-slate-400'
                              }`}
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-slate-900 truncate">
                                {rec.parish.name}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {rec.parish.address}
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteSavedParish(rec.id)}
                            title="Usuń zapamiętaną parafię"
                            aria-label="Usuń zapamiętaną parafię"
                            className="min-w-[38px] min-h-[38px] inline-flex items-center justify-center text-slate-400 hover:text-red-600 rounded-lg transition-colors shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : (
              <div className="pt-3 border-t border-slate-200 space-y-2">
                <p className="text-xs text-slate-600">
                  Zaloguj się przez Google lub e-mail, aby zapamiętywać parafie,
                  granice i kartotekę na stałe.
                </p>
                <button
                  type="button"
                  onClick={onSignInGoogle}
                  className="w-full min-h-[42px] py-2 px-3 text-xs font-medium text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <LogIn className="w-3.5 h-3.5 text-amber-700" />
                  Zaloguj się lub załóż konto
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: TEREN I IMPORT */}
        {setupTab === 'area' && (
          <div className="p-4 sm:p-5 space-y-3.5">
            {streetPickFeedback && (
              <div
                className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                  streetPickFeedback.status === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : streetPickFeedback.status === 'error'
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                <span>{streetPickFeedback.message}</span>
                {streetPickFeedback.status !== 'loading' && (
                  <button
                    type="button"
                    onClick={onDismissStreetFeedback}
                    aria-label="Zamknij"
                    className="p-1 text-current/70 hover:text-current shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Karta A: Skan z mapy (najprostsza ścieżka) */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs sm:text-sm font-semibold text-slate-900">
                  Skan z mapy (granice + domy)
                </h2>
                {boundary.length >= 3 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-emerald-700 tabular-nums">
                      {boundaryAreaText || `${boundary.length} pkt`}
                    </span>
                    <button
                      type="button"
                      onClick={onClearBoundary}
                      title="Usuń obszar"
                      aria-label="Usuń obszar"
                      className="p-1 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {boundary.length < 3 ? (
                <button
                  type="button"
                  disabled={!parish}
                  onClick={onToggleDrawBoundary}
                  className={`w-full min-h-[44px] py-2.5 px-3 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-2 transition-colors ${
                    isDrawing
                      ? 'bg-amber-700 border-amber-700 text-white'
                      : 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800 disabled:opacity-50'
                  }`}
                >
                  <Pentagon className="w-4 h-4 shrink-0" />
                  <span>
                    {isDrawing
                      ? 'Rysujesz obszar na mapie...'
                      : '1. Zaznacz teren parafii na mapie'}
                  </span>
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={isDrawing}
                    onClick={onToggleEditBoundary}
                    className={`min-h-[40px] py-1.5 px-2.5 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-1.5 transition-colors ${
                      isEditingBoundary
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-white border-slate-300 text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <Pentagon className="w-3.5 h-3.5" />
                    <span>
                      {isEditingBoundary ? 'Kończysz...' : 'Popraw narożniki'}
                    </span>
                  </button>
                  {onExpandBoundaryMeters ? (
                    <button
                      type="button"
                      disabled={isDrawing}
                      onClick={() => onExpandBoundaryMeters(25)}
                      title="Rozszerz granice o 25 m na zewnątrz"
                      className="min-h-[40px] py-1.5 px-2.5 text-xs font-semibold rounded-xl border bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100 inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
                    >
                      +25 m brzeg
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!parish}
                      onClick={onToggleDrawBoundary}
                      className="min-h-[40px] py-1.5 px-2.5 text-xs font-medium rounded-xl border bg-white border-slate-200 text-slate-700 hover:bg-slate-100 inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      Przerysuj
                    </button>
                  )}
                </div>
              )}

              <button
                type="button"
                disabled={!parish}
                onClick={() =>
                  onOpenAreaScanner
                    ? onOpenAreaScanner()
                    : setAreaScannerOpen(true)
                }
                className="w-full min-h-[44px] py-2.5 px-3 text-xs sm:text-sm font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 rounded-xl inline-flex items-center justify-center gap-2 transition-colors shadow-xs"
              >
                <ScanSearch className="w-4 h-4 shrink-0" />
                <span>
                  {boundary.length >= 3
                    ? '2. Wykryj ulice i adresy z obszaru'
                    : 'Wykryj ulice w okolicy kościoła'}
                </span>
              </button>

              {outsideBoundaryCount > 0 && onDeleteOutsideBoundaryStops && (
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-2 text-xs">
                  <span className="text-amber-950 font-medium">
                    {outsideBoundaryCount}{' '}
                    {outsideBoundaryCount === 1 ? 'dom leży' : 'domów leży'}{' '}
                    poza granicą.
                  </span>
                  <button
                    type="button"
                    onClick={onDeleteOutsideBoundaryStops}
                    className="px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-white hover:bg-red-50 border border-red-200 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Usuń ({outsideBoundaryCount})
                  </button>
                </div>
              )}

              {parish && (
                <button
                  type="button"
                  onClick={onViewMap}
                  className="lg:hidden w-full min-h-[40px] py-2 px-3 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <MapIcon className="w-3.5 h-3.5 text-amber-700" />
                  Podgląd obszaru i domów na mapie
                </button>
              )}
            </div>

            {/* Karta B: Kartoteka parafialna (FARA / Excel / CSV) — na pierwszym planie */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs sm:text-sm font-semibold text-slate-900">
                  Kartoteka (FARA / Excel / CSV)
                </h3>
                <span className="text-[11px] font-medium text-emerald-700">
                  Bez nazwisk
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Wgraj eksport z FARY — aplikacja automatycznie odrzuci nazwiska,
                policzy mieszkańców i rozbije mieszkania w blokach.
              </p>
              <button
                type="button"
                disabled={!parish}
                onClick={openCsvModal}
                className="w-full min-h-[42px] py-2 px-3 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Importuj z kartoteki (FARA / CSV)</span>
              </button>
            </div>

            {/* Karta C: Zwijane narzędzia ręczne i korekta granic */}
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => setShowManualTools((v) => !v)}
                aria-expanded={manualToolsOpen}
                className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50/70 hover:bg-slate-100/80 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700 transition-colors"
              >
                <span>Dodawanie ręczne i precyzyjne granice</span>
                {manualToolsOpen ? (
                  <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                )}
              </button>

              {manualToolsOpen && (
                <div className="p-3.5 space-y-3 border-t border-slate-200">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={!parish}
                      onClick={onTogglePickStreetMode}
                      className={`min-h-[40px] py-2 px-3 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-1.5 transition-colors ${
                        isPickingStreet
                          ? 'bg-amber-700 border-amber-700 text-white shadow-sm'
                          : 'bg-amber-50 border-amber-200 text-amber-950 hover:bg-amber-100 disabled:opacity-50'
                      }`}
                    >
                      <Route className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {isPickingStreet
                          ? 'Dotknij ulicę na mapie'
                          : '+ Ulica z mapy'}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={!parish}
                      onClick={onToggleMapAddMode}
                      className={`min-h-[40px] py-2 px-3 text-xs font-medium rounded-xl border inline-flex items-center justify-center gap-1.5 transition-colors ${
                        isAddingHouse
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50 disabled:opacity-50'
                      }`}
                    >
                      <MapPinPlus className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                      <span>
                        {isAddingHouse
                          ? 'Kliknij dom na mapie'
                          : '+ Pojedynczy dom'}
                      </span>
                    </button>
                  </div>

                  <div>
                    <div className="text-[11px] font-medium text-slate-500 mb-1">
                      Wpisz pojedynczy adres ręcznie:
                    </div>
                    <PlaceSearchInput
                      placeholder={
                        parish
                          ? 'np. Słoneczna 12, Mikołów'
                          : 'Najpierw wybierz parafię'
                      }
                      biasLocation={parish?.location}
                      onSelect={onAddPlaceStop}
                      clearOnSelect={true}
                    />
                  </div>

                  <div className="pt-2.5 border-t border-slate-100 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-500">
                      Szybkie granice wokół kościoła
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { label: '300 m', radius: 300 },
                        { label: '500 m', radius: 500 },
                        { label: '1 km', radius: 1000 },
                      ].map((opt) => (
                        <button
                          key={opt.radius}
                          type="button"
                          disabled={!parish || isDrawing}
                          onClick={() => onCreatePresetBoundary(opt.radius)}
                          className="min-h-[38px] py-1 px-2 text-xs font-medium rounded-xl border bg-amber-50/70 border-amber-200 text-amber-900 hover:bg-amber-100/70 disabled:opacity-50 transition-colors tabular-nums"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {boundary.length >= 3 && (
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          disabled={isDrawing}
                          onClick={() => onScaleBoundary(0.86)}
                          className="min-h-[38px] py-1 px-2 text-xs font-medium rounded-xl border bg-white border-slate-200 text-slate-800 hover:bg-slate-100 inline-flex items-center justify-center gap-1 transition-colors"
                        >
                          <Minimize2 className="w-3.5 h-3.5 text-amber-700" />
                          Zmniejsz
                        </button>
                        <button
                          type="button"
                          disabled={isDrawing}
                          onClick={() => onScaleBoundary(1.16)}
                          className="min-h-[38px] py-1 px-2 text-xs font-medium rounded-xl border bg-white border-slate-200 text-slate-800 hover:bg-slate-100 inline-flex items-center justify-center gap-1 transition-colors"
                        >
                          <Maximize2 className="w-3.5 h-3.5 text-amber-700" />
                          Powiększ
                        </button>
                        <button
                          type="button"
                          disabled={!parish}
                          onClick={onToggleDrawBoundary}
                          className="min-h-[38px] py-1 px-2 text-xs font-medium rounded-xl border bg-white border-slate-200 text-slate-700 hover:bg-slate-100 inline-flex items-center justify-center gap-1 transition-colors"
                        >
                          <Pentagon className="w-3.5 h-3.5 text-amber-700" />
                          Przerysuj
                        </button>
                      </div>
                    )}

                    {stops.length > 0 && (
                      <button
                        type="button"
                        disabled={!parish || isDrawing}
                        onClick={onWrapStopsBoundary}
                        className="w-full min-h-[38px] py-1.5 px-3 text-xs font-medium rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 inline-flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Layers className="w-3.5 h-3.5 text-amber-700" />
                        <span>Otocz dodane ulice ({stops.length} pkt)</span>
                      </button>
                    )}

                    <div className="space-y-1.5">
                      <label
                        htmlFor="locality-boundary-input"
                        className="block text-[11px] font-medium text-slate-600"
                      >
                        Pobierz granice miejscowości / sołectwa:
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          id="locality-boundary-input"
                          type="text"
                          value={localityQuery}
                          onChange={(e) => {
                            setLocalityQuery(e.target.value);
                            if (localityError) setLocalityError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleFetchLocalityBoundary();
                            }
                          }}
                          placeholder={localityHint || 'np. Reta, Mikołów'}
                          disabled={!parish || localityLoading}
                          className="flex-1 min-w-0 min-h-[40px] px-3 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-600/30 focus:border-amber-600"
                        />
                        <button
                          type="button"
                          disabled={
                            !parish ||
                            localityLoading ||
                            !(localityQuery || localityHint).trim()
                          }
                          onClick={() => void handleFetchLocalityBoundary()}
                          className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        >
                          {localityLoading && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
                          )}
                          <span>Pobierz</span>
                        </button>
                      </div>
                      {localityError && (
                        <p className="text-[11px] text-red-600 leading-snug">
                          {localityError}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: ULICE, DOMY I BLOKI (Pełna konfiguracja parafii) */}
        {setupTab === 'streets' && (
          <div className="p-4 sm:p-5 space-y-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs sm:text-sm font-semibold text-slate-900">
                  Ulice, domy i bloki ({savedStreets.length})
                </h2>
                <span className="text-xs font-mono tabular-nums text-slate-600">
                  {parishBuildingStats.houses} domów
                  {parishBuildingStats.blocks > 0
                    ? ` · ${parishBuildingStats.blocks} bl. (${parishBuildingStats.units} lok.)`
                    : ''}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                Tutaj oznaczysz bloki (klatki, mieszkania), stałe odmowy i czas
                wizyty — podczas planowania dnia zostaną wykryte automatycznie.
              </p>
            </div>

            {stops.length > 0 && (
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setStreetsTypeFilter('all')}
                  className={`min-h-[34px] px-2 py-1 text-[11px] font-semibold rounded-lg transition-colors tabular-nums ${
                    streetsTypeFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Wszystkie ({stops.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStreetsTypeFilter('blocks')}
                  className={`min-h-[34px] px-2 py-1 text-[11px] font-semibold rounded-lg transition-colors tabular-nums ${
                    streetsTypeFilter === 'blocks'
                      ? 'bg-white text-amber-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Bloki ({parishBuildingStats.blocks})
                </button>
                <button
                  type="button"
                  onClick={() => setStreetsTypeFilter('declined')}
                  className={`min-h-[34px] px-2 py-1 text-[11px] font-semibold rounded-lg transition-colors tabular-nums ${
                    streetsTypeFilter === 'declined'
                      ? 'bg-white text-red-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Pominięte ({parishBuildingStats.declined})
                </button>
              </div>
            )}

            {savedStreets.length > 3 && (
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={streetFilter}
                  onChange={(e) => setStreetFilter(e.target.value)}
                  placeholder="Szukaj ulicy lub numeru (np. Astrów 12)..."
                  aria-label="Szukaj ulicy lub domu na liście"
                  className="w-full min-h-[42px] pl-9 pr-3 py-2 text-base sm:text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-amber-600"
                />
              </div>
            )}

            {savedStreets.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Brak zapisanych ulic dla tej parafii. Wykryj domy z obszaru
                  mapy albo wgraj kartotekę z FARY.
                </p>
                <button
                  type="button"
                  onClick={() => setSetupTab('area')}
                  className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center gap-1.5"
                >
                  <ScanSearch className="w-3.5 h-3.5" />
                  <span>Przejdź do terenu i importu</span>
                </button>
              </div>
            ) : filteredStreets.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                Brak ulic ani budynków pasujących do wybranego filtra.
              </p>
            ) : (
              <ul className="border border-slate-200 rounded-xl bg-white divide-y divide-slate-100 overflow-hidden">
                {filteredStreets.map(([streetName, streetStops]) => {
                  const isExpanded = expandedStreet === streetName;
                  const streetBlocks = streetStops.filter(isBlockStop);
                  const streetUnits = streetBlocks.reduce(
                    (acc, s) => acc + getStopUnitCount(s),
                    0
                  );
                  const streetBounds = computeStreetNumberBounds(streetStops);
                  const rangeStr =
                    streetBounds.all.minLabel && streetBounds.all.maxLabel
                      ? streetBounds.all.minLabel === streetBounds.all.maxLabel
                        ? `nr ${streetBounds.all.minLabel}`
                        : `nr ${streetBounds.all.minLabel}–${streetBounds.all.maxLabel}`
                      : '';
                  return (
                    <li
                      key={streetName}
                      data-street-row={streetName}
                      className="bg-white"
                    >
                      <div className="px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/70">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedStreet(isExpanded ? null : streetName)
                          }
                          className="flex-1 min-w-0 text-left flex items-center gap-2 min-h-[40px]"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-amber-700 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 truncate">
                              {streetName}
                            </div>
                            <div className="text-[11px] text-slate-500 tabular-nums flex flex-wrap items-center gap-x-1.5">
                              <span>
                                {streetStops.length - streetBlocks.length}{' '}
                                {streetStops.length - streetBlocks.length === 1
                                  ? 'dom'
                                  : 'domów'}
                              </span>
                              {streetBlocks.length > 0 && (
                                <span className="text-amber-800 font-semibold">
                                  · {streetBlocks.length}{' '}
                                  {streetBlocks.length === 1
                                    ? 'blok'
                                    : 'bloki'}
                                  {streetUnits > 0 ? ` (${streetUnits} lok.)` : ''}
                                </span>
                              )}
                              {rangeStr && (
                                <span className="text-slate-400">
                                  · {rangeStr}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onDeleteStreetStops(streetStops.map((s) => s.id))
                          }
                          title={`Usuń ulicę ${streetName} z bazy parafii`}
                          aria-label={`Usuń ulicę ${streetName}`}
                          className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-400 hover:text-red-600 rounded-lg transition-colors shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {isExpanded && (() => {
                        const missingGaps =
                          findMissingHouseNumberGaps(streetStops);
                        return (
                          <div className="px-3 pb-3 pt-2 bg-slate-50/90 border-t border-slate-100 space-y-2">
                            {onFocusStreetOnMap && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-slate-500">
                                  Oznacz bloki lub wyklucz stałe odmowy:
                                </span>
                                <button
                                  type="button"
                                  onClick={() => onFocusStreetOnMap(streetName)}
                                  className="min-h-[32px] px-2.5 py-1 text-[11px] font-medium text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg inline-flex items-center gap-1 shrink-0"
                                >
                                  <MapIcon className="w-3 h-3" />
                                  <span>Na mapie</span>
                                </button>
                              </div>
                            )}

                            <div className="divide-y divide-slate-200/70 rounded-xl border border-slate-200 bg-white overflow-hidden">
                              {streetStops.map((st) => {
                                const numLabel =
                                  extractHouseNumberLabel(st) ||
                                  st.label ||
                                  st.address;
                                const isBlock = isBlockStop(st);
                                const unitCount = getStopUnitCount(st);
                                const isDeclined = Boolean(
                                  st.permanentDecline || st.included === false
                                );
                                const isDetailsOpen =
                                  editingStopDetailsId === st.id;

                                return (
                                  <div
                                    key={st.id}
                                    className={`transition-colors ${
                                      isDeclined ? 'bg-slate-50/80 opacity-75' : 'bg-white'
                                    }`}
                                  >
                                    <div className="px-2.5 py-2 flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => onSelectStop?.(st.id)}
                                        title={`Pokaż ${st.address || st.label} na mapie`}
                                        className="flex-1 min-w-0 min-h-[36px] text-left flex items-center gap-1.5"
                                      >
                                        {isBlock ? (
                                          <Building2 className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                        ) : (
                                          <Home className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                        )}
                                        <span className="text-xs font-mono font-semibold text-slate-900 truncate tabular-nums">
                                          {numLabel}
                                        </span>
                                        {isBlock && (
                                          <span className="text-[10px] font-semibold text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded tabular-nums shrink-0">
                                            Blok{unitCount > 0 ? ` · ${unitCount}` : ''}
                                          </span>
                                        )}
                                        {isDeclined && (
                                          <span className="text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded shrink-0">
                                            Odmowa
                                          </span>
                                        )}
                                        {st.inBoundary === false && (
                                          <span className="text-[10px] font-medium text-amber-800 shrink-0">
                                            · poza
                                          </span>
                                        )}
                                      </button>

                                      {onOpenBlockUnits && (
                                        <button
                                          type="button"
                                          onClick={() => onOpenBlockUnits(st.id)}
                                          title={
                                            isBlock
                                              ? 'Edytuj mieszkania i klatki w bloku'
                                              : 'Ustaw jako blok / dom wielorodzinny'
                                          }
                                          className={`min-h-[34px] px-2 py-1 text-[11px] font-semibold rounded-lg border inline-flex items-center gap-1 shrink-0 transition-colors ${
                                            isBlock
                                              ? 'bg-amber-50 border-amber-300 text-amber-950 hover:bg-amber-100'
                                              : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                                          }`}
                                        >
                                          <Building2 className="w-3 h-3" />
                                          <span>{isBlock ? 'Lokale' : 'Blok'}</span>
                                        </button>
                                      )}

                                      {onUpdateStop && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setEditingStopDetailsId(
                                              isDetailsOpen ? null : st.id
                                            )
                                          }
                                          aria-label={`Opcje budynku ${st.address || numLabel}`}
                                          title="Czas wizyty, uwagi i stała odmowa"
                                          className={`min-h-[34px] min-w-[34px] px-1.5 py-1 rounded-lg border inline-flex items-center justify-center shrink-0 transition-colors ${
                                            isDetailsOpen
                                              ? 'bg-slate-900 border-slate-900 text-white'
                                              : 'bg-white border-slate-200 text-slate-500 hover:text-slate-900'
                                          }`}
                                        >
                                          <SlidersHorizontal className="w-3.5 h-3.5" />
                                        </button>
                                      )}

                                      {onDeleteStop && (
                                        <button
                                          type="button"
                                          onClick={() => onDeleteStop(st.id)}
                                          aria-label={`Usuń ${st.address || numLabel}`}
                                          title={`Usuń ${st.address || numLabel}`}
                                          className="min-h-[34px] min-w-[32px] inline-flex items-center justify-center text-slate-400 hover:text-red-600 rounded-lg shrink-0"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>

                                    {isDetailsOpen && onUpdateStop && (
                                      <div className="px-2.5 pb-2.5 pt-2 bg-slate-50 border-t border-slate-100 space-y-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <div className="flex items-center gap-1">
                                            <label className="text-[11px] text-slate-600">
                                              Czas:
                                            </label>
                                            <input
                                              type="number"
                                              min={3}
                                              max={1440}
                                              value={st.durationMinutes}
                                              onChange={(e) =>
                                                onUpdateStop(st.id, {
                                                  durationMinutes: Math.max(
                                                    3,
                                                    Math.min(
                                                      1440,
                                                      Number.parseInt(
                                                        e.target.value || '15',
                                                        10
                                                      )
                                                    )
                                                  ),
                                                })
                                              }
                                              className="w-16 px-2 py-1 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-900 text-right focus:outline-none focus:border-amber-600"
                                            />
                                            <span className="text-[11px] text-slate-500">
                                              min
                                            </span>
                                          </div>

                                          <button
                                            type="button"
                                            onClick={() =>
                                              onUpdateStop(st.id, {
                                                permanentDecline: !isDeclined,
                                                included: isDeclined ? true : false,
                                              })
                                            }
                                            className={`min-h-[32px] px-2.5 py-1 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 transition-colors ml-auto ${
                                              isDeclined
                                                ? 'bg-red-50 border-red-300 text-red-800 hover:bg-red-100'
                                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                                            }`}
                                          >
                                            <Ban className="w-3 h-3" />
                                            <span>
                                              {isDeclined
                                                ? 'Przywróć do kolędy'
                                                : 'Stała odmowa'}
                                            </span>
                                          </button>
                                        </div>

                                        <input
                                          type="text"
                                          value={st.notes ?? ''}
                                          onChange={(e) =>
                                            onUpdateStop(st.id, {
                                              notes: e.target.value,
                                            })
                                          }
                                          placeholder={
                                            isBlock
                                              ? 'Uwagi do bloku (klatki, kod domofonu)'
                                              : 'Uwagi / liczba rodzin'
                                          }
                                          className="w-full px-2.5 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-amber-600"
                                        />
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {missingGaps.length > 0 && (
                              <div className="p-2 rounded-lg bg-amber-50/90 border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-950">
                                <span>
                                  Możliwe braki numeracji:{' '}
                                  <strong className="font-mono">
                                    nr {missingGaps.join(', ')}
                                  </strong>
                                </span>
                                {onAddMissingOnStreet && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onAddMissingOnStreet(streetName)
                                    }
                                    className="min-h-[32px] px-2.5 py-1 font-semibold text-amber-900 bg-white hover:bg-amber-100 border border-amber-300 rounded-md inline-flex items-center gap-1 shrink-0"
                                  >
                                    <MapPinPlus className="w-3 h-3" />
                                    <span>Dodaj na mapie</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </li>
                  );
                })}
              </ul>
            )}

            {stops.length > 0 && onClearStops && (
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={onClearStops}
                  className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Usuń całą bazę domów ({stops.length})
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticky Bottom Action Bar (Always within thumb reach!) */}
      {parish && stops.length > 0 && (
        <div className="sticky bottom-0 z-10 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2.5 shrink-0">
          <button
            type="button"
            onClick={onNextStep}
            className="w-full min-h-[44px] py-2.5 px-4 text-xs sm:text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl inline-flex items-center justify-center gap-2 transition-colors shadow-xs"
          >
            <span>Układaj plan kolędy ({stops.length} domów)</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {!onOpenAreaScanner && areaScannerOpen && (
        <Suspense fallback={null}>
          <OsmStreetFetcherModal
            open={areaScannerOpen}
            parish={parish}
            boundary={boundary}
            onClose={() => setAreaScannerOpen(false)}
            onAddPlaces={onBatchAddStops}
          />
        </Suspense>
      )}

      {csvImportOpen && (
        <Suspense fallback={null}>
          <CsvImportModal
            open={csvImportOpen}
            parish={parish}
            existingStops={stops}
            defaultVisitMinutes={defaultVisitMinutes}
            onClose={closeCsvModal}
            onImportPlaces={onBatchAddStops}
            onEnrichExistingStops={onEnrichExistingStops}
          />
        </Suspense>
      )}
    </div>
  );
};
