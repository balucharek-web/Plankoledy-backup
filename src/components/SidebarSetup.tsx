import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Church,
  Cloud,
  FileSpreadsheet,
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
  computePolygonAreaSqMeters,
  extractHouseNumberLabel,
  extractHouseNumberSortKey,
  extractStreetName,
  findMissingHouseNumberGaps,
  formatPolygonArea,
} from '../utils/spatial';
import { CsvImportModal } from './CsvImportModal';
import { OsmStreetFetcherModal } from './OsmStreetFetcherModal';
import { PlaceSearchInput, SelectedPlaceData } from './PlaceSearchInput';

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

type TerritoryTab = 'area' | 'streets';

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
  const [territoryTab, setTerritoryTab] = useState<TerritoryTab>('area');
  const [areaScannerOpen, setAreaScannerOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [nearbyChurches, setNearbyChurches] = useState<
    NearbyParishCandidate[] | null
  >(null);
  const [localityQuery, setLocalityQuery] = useState('');
  const [localityLoading, setLocalityLoading] = useState(false);
  const [localityError, setLocalityError] = useState<string | null>(null);
  const [expandedStreet, setExpandedStreet] = useState<string | null>(null);

  const isDrawing = interactionMode === 'draw_boundary';
  const isEditingBoundary = interactionMode === 'edit_boundary';
  const isPickingStreet = interactionMode === 'pick_street';
  const isAddingHouse = interactionMode === 'add_stop';

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
          [
            name,
            [...list].sort((a, b) => {
              const labelA =
                extractHouseNumberLabel(a) || a.label || a.address;
              const labelB =
                extractHouseNumberLabel(b) || b.label || b.address;
              return (
                extractHouseNumberSortKey(labelA) -
                  extractHouseNumberSortKey(labelB) ||
                labelA.localeCompare(labelB, 'pl', {
                  numeric: true,
                  sensitivity: 'base',
                })
              );
            }),
          ] as [string, VisitStop[]]
      )
      .sort((a, b) => a[0].localeCompare(b[0], 'pl'));
  }, [stops]);

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

  return (
    <div className="divide-y divide-slate-200">
      {/* Krok 1: Parafia */}
      <section className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-sm font-semibold text-slate-900">
            1. Parafia i punkt startowy
          </h2>
          {parish && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Wybrana
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Wpisz nazwę parafii, patrona lub miejscowość — wybór automatycznie
          zapisuje się w Twojej bazie.
        </p>

        <PlaceSearchInput
          placeholder="np. św Antoni Mikołów, Bazylika lub Mikołów"
          searchScope="parish"
          onSelect={(place) => {
            setNearbyChurches(null);
            setNearbyError(null);
            onSelectParish(place);
            if (place.placeType === 'place') {
              void loadChurchesAround(place.location);
            }
          }}
          initialValue={parish?.name ?? ''}
        />

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={nearbyLoading}
            onClick={() => void handleFindNearbyGps()}
            className="flex-1 min-w-[140px] min-h-[40px] py-1.5 px-3 text-xs font-medium rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
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
              className="flex-1 min-w-[140px] min-h-[40px] py-1.5 px-3 text-xs font-medium rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Church className="w-3.5 h-3.5 text-amber-700" />
              <span>Kościoły w okolicy</span>
            </button>
          )}
        </div>

        {nearbyError && (
          <p className="mt-2 text-xs text-red-600">{nearbyError}</p>
        )}

        {nearbyChurches && nearbyChurches.length > 0 && (
          <div className="mt-3 border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">
                Kościoły i parafie w promieniu 7 km ({nearbyChurches.length})
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
            <ul className="max-h-52 overflow-y-auto divide-y divide-slate-100">
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
                    }}
                    className="w-full min-h-[46px] px-3 py-2 text-left hover:bg-amber-50/60 flex items-start justify-between gap-2 transition-colors"
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
            }}
            className="mt-2 w-full min-h-[42px] px-3 py-2 text-left rounded-xl border border-amber-200 bg-amber-50/70 hover:bg-amber-100/70 flex items-center justify-between gap-2 transition-colors"
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
          <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
            <div className="font-medium text-slate-900">{parish.name}</div>
            <div className="mt-0.5 text-slate-500">{parish.address}</div>
          </div>
        )}

        {isSignedIn ? (
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">
                Zapamiętane parafie ({savedParishes.length})
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                <Cloud className="w-3 h-3" />
                {userEmail?.split('@')[0] || 'Google'}
              </span>
            </div>

            {savedParishes.length === 0 ? (
              <p className="text-xs text-slate-500">
                Wyszukaj pierwszą parafię powyżej — zostanie zapisana na Twoim
                koncie.
              </p>
            ) : (
              <ul className="space-y-1.5 max-h-40 overflow-y-auto">
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
                        onClick={() => onSelectSavedParish(rec.id)}
                        className="flex-1 min-w-0 text-left flex items-start gap-2 min-h-[38px]"
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
                        className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-400 hover:text-red-600 rounded-lg transition-colors shrink-0"
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
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
            <p className="text-xs text-slate-600">
              Zaloguj się przez Google lub dowolny adres e-mail, aby
              zapamiętywać parafie, granice i pobrane ulice na stałe.
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
      </section>

      {/* Krok 2: Konfiguracja terenu — Obszar LUB Wybór ulic z wykrywaniem adresów */}
      <section className="p-4 sm:p-5 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            2. Teren i adresy parafii
          </h2>
          {boundary.length >= 3 && (
            <span className="text-xs text-emerald-700 font-medium tabular-nums">
              {boundaryAreaText ? `${boundaryAreaText} · ` : ''}
              {boundary.length} pkt
            </span>
          )}
        </div>

        {/* Clean 2-method selector */}
        <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl gap-1">
          <button
            type="button"
            onClick={() => setTerritoryTab('area')}
            className={`min-h-[38px] px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
              territoryTab === 'area'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Pentagon className="w-3.5 h-3.5 text-amber-700" />
            <span>Obszar na mapie</span>
          </button>
          <button
            type="button"
            onClick={() => setTerritoryTab('streets')}
            className={`min-h-[38px] px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
              territoryTab === 'streets'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Route className="w-3.5 h-3.5 text-amber-700" />
            <span>Wybierz ulice</span>
          </button>
        </div>

        {territoryTab === 'area' ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 leading-relaxed">
              Zakreśl teren palcem/myszą, ustaw punkty celownikiem albo pobierz
              gotowe granice miejscowości — a potem wykryj domy w środku.
            </p>

            {boundary.length < 3 ? (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={!parish}
                  onClick={onToggleDrawBoundary}
                  className={`w-full min-h-[44px] py-2.5 px-3 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-2 transition-colors ${
                    isDrawing
                      ? 'bg-amber-700 border-amber-700 text-white'
                      : 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:bg-slate-300 disabled:border-slate-300'
                  }`}
                >
                  <Pentagon className="w-4 h-4 shrink-0" />
                  <span>
                    {isDrawing
                      ? 'Rysujesz obszar na mapie...'
                      : 'Zakreśl lub narysuj teren na mapie'}
                  </span>
                </button>

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
                      className="min-h-[38px] py-1.5 px-2 text-xs font-medium rounded-xl border bg-amber-50/70 border-amber-200 text-amber-900 hover:bg-amber-100/70 disabled:opacity-50 disabled:bg-white disabled:border-slate-200 disabled:text-slate-400 transition-colors tabular-nums"
                    >
                      Promień {opt.label}
                    </button>
                  ))}
                </div>

                {stops.length > 0 && (
                  <button
                    type="button"
                    disabled={!parish || isDrawing}
                    onClick={onWrapStopsBoundary}
                    className="w-full min-h-[38px] py-2 px-3 text-xs font-medium rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Layers className="w-3.5 h-3.5 text-amber-700" />
                    <span>Otocz już dodane ulice ({stops.length} pkt)</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-800">
                    Zapisany obszar parafii
                  </span>
                  <span className="text-slate-500 tabular-nums">
                    {boundaryAreaText ? `${boundaryAreaText} · ` : ''}
                    {boundary.length} pkt
                  </span>
                </div>

                <button
                  type="button"
                  disabled={isDrawing}
                  onClick={onToggleEditBoundary}
                  className={`w-full min-h-[42px] py-2 px-3 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-1.5 transition-colors ${
                    isEditingBoundary
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white border-slate-300 text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Pentagon className="w-3.5 h-3.5" />
                  <span>
                    {isEditingBoundary
                      ? 'Kończysz poprawianie punktów...'
                      : 'Popraw narożniki i boki na mapie'}
                  </span>
                </button>

                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    disabled={isDrawing}
                    onClick={() => onScaleBoundary(0.86)}
                    className="min-h-[38px] py-1.5 px-2 text-xs font-medium rounded-xl border bg-white border-slate-200 text-slate-800 hover:bg-slate-100 inline-flex items-center justify-center gap-1 transition-colors"
                  >
                    <Minimize2 className="w-3.5 h-3.5 text-amber-700" />
                    Zmniejsz
                  </button>
                  <button
                    type="button"
                    disabled={isDrawing}
                    onClick={() => onScaleBoundary(1.16)}
                    className="min-h-[38px] py-1.5 px-2 text-xs font-medium rounded-xl border bg-white border-slate-200 text-slate-800 hover:bg-slate-100 inline-flex items-center justify-center gap-1 transition-colors"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-amber-700" />
                    Powiększ
                  </button>
                  {onExpandBoundaryMeters && (
                    <button
                      type="button"
                      disabled={isDrawing}
                      onClick={() => onExpandBoundaryMeters(25)}
                      title="Rozszerz granice o 25 m na zewnątrz, aby objąć domy przy granicy"
                      className="min-h-[38px] py-1.5 px-2 text-xs font-semibold rounded-xl border bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100 inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
                    >
                      +25 m brzeg
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={!parish}
                    onClick={onToggleDrawBoundary}
                    className={`flex-1 min-h-[38px] py-1.5 px-2.5 text-xs font-medium rounded-xl border inline-flex items-center justify-center gap-1.5 transition-colors ${
                      isDrawing
                        ? 'bg-amber-700 border-amber-700 text-white'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Pentagon className="w-3.5 h-3.5" />
                    <span>{isDrawing ? 'Rysujesz...' : 'Przerysuj od zera'}</span>
                  </button>

                  {stops.length > 0 && (
                    <button
                      type="button"
                      disabled={isDrawing}
                      onClick={onWrapStopsBoundary}
                      title="Dopasuj obszar wokół dodanych domów"
                      className="min-h-[38px] py-1.5 px-2.5 text-xs font-medium rounded-xl border bg-white border-slate-200 text-slate-700 hover:bg-slate-100 inline-flex items-center justify-center gap-1 whitespace-nowrap"
                    >
                      <Layers className="w-3.5 h-3.5 text-amber-700" />
                      <span>Otocz ulice</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onClearBoundary}
                    title="Usuń obszar"
                    aria-label="Usuń obszar"
                    className="min-w-[38px] min-h-[38px] inline-flex items-center justify-center text-slate-500 hover:text-red-600 bg-white border border-slate-200 rounded-xl hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Quick 1-click locality / district border lookup */}
            <div className="pt-2 border-t border-slate-100 space-y-1.5">
              <label
                htmlFor="locality-boundary-input"
                className="block text-[11px] font-medium text-slate-600"
              >
                Lub pobierz granice miejscowości / osiedla:
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
                  className="flex-1 min-w-0 min-h-[38px] px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-600/30 focus:border-amber-600"
                />
                <button
                  type="button"
                  disabled={
                    !parish ||
                    localityLoading ||
                    !(localityQuery || localityHint).trim()
                  }
                  onClick={() => void handleFetchLocalityBoundary()}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  {localityLoading && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
                  )}
                  <span>Pobierz obrys</span>
                </button>
              </div>
              {localityError && (
                <p className="text-[11px] text-red-600 leading-snug">
                  {localityError}
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={!parish}
              onClick={() =>
                onOpenAreaScanner
                  ? onOpenAreaScanner()
                  : setAreaScannerOpen(true)
              }
              className="w-full min-h-[44px] py-2.5 px-3 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
            >
              <ScanSearch className="w-4 h-4 shrink-0" />
              <span>
                {boundary.length >= 3
                  ? 'Wykryj ulice i adresy z obszaru'
                  : 'Wykryj ulice i adresy w okolicy kościoła'}
              </span>
            </button>

            {outsideBoundaryCount > 0 && onDeleteOutsideBoundaryStops && (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-2 text-xs">
                <span className="text-amber-950 font-medium">
                  {outsideBoundaryCount}{' '}
                  {outsideBoundaryCount === 1
                    ? 'dom leży'
                    : outsideBoundaryCount < 5
                      ? 'domy leżą'
                      : 'domów leży'}{' '}
                  poza granicą.
                </span>
                <button
                  type="button"
                  onClick={onDeleteOutsideBoundaryStops}
                  className="px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-white hover:bg-red-50 border border-red-200 rounded-lg whitespace-nowrap shrink-0"
                >
                  Usuń spoza granicy ({outsideBoundaryCount})
                </button>
              </div>
            )}

            {parish && (
              <button
                type="button"
                onClick={onViewMap}
                className="lg:hidden w-full min-h-[40px] py-2 px-3 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <MapIcon className="w-3.5 h-3.5 text-amber-700" />
                Podgląd obszaru na mapie
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-xs text-slate-500 leading-relaxed">
              Wskaż wybrane ulice bezpośrednio na mapie — aplikacja automatycznie
              rozpozna ulicę i pobierze wszystkie oficjalne numery domów.
            </p>

            <button
              type="button"
              disabled={!parish}
              onClick={onTogglePickStreetMode}
              className={`w-full min-h-[44px] py-2.5 px-3 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-2 transition-colors ${
                isPickingStreet
                  ? 'bg-amber-700 border-amber-700 text-white shadow-sm'
                  : 'bg-amber-700 border-amber-700 text-white hover:bg-amber-800 disabled:opacity-50 disabled:bg-slate-300 disabled:border-slate-300'
              }`}
            >
              <Route className="w-4 h-4 shrink-0" />
              <span>
                {isPickingStreet
                  ? 'Tryb aktywny — dotknij ulicę na mapie'
                  : 'Kliknij ulicę na mapie (wykryj adresy)'}
              </span>
            </button>

            <button
              type="button"
              disabled={!parish}
              onClick={onToggleMapAddMode}
              className={`w-full min-h-[40px] py-2 px-3 text-xs font-medium rounded-xl border inline-flex items-center justify-center gap-1.5 transition-colors ${
                isAddingHouse
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50 disabled:opacity-50'
              }`}
            >
              <MapPinPlus className="w-3.5 h-3.5 text-amber-700" />
              <span>
                {isAddingHouse
                  ? 'Tryb aktywny — kliknij budynek na mapie'
                  : 'Dodaj pojedynczy dom z mapy'}
              </span>
            </button>

            <div className="pt-1">
              <div className="text-[11px] font-medium text-slate-500 mb-1">
                Lub dopisz konkretny adres ręcznie:
              </div>
              <PlaceSearchInput
                placeholder={
                  parish
                    ? 'np. Mieczysława Dzieńdziela 12, Mikołów'
                    : 'Najpierw wybierz parafię'
                }
                biasLocation={parish?.location}
                onSelect={onAddPlaceStop}
                clearOnSelect={true}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={!parish}
          onClick={() => setCsvImportOpen(true)}
          className="w-full min-h-[40px] py-2 px-3 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 disabled:opacity-50 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-amber-700 shrink-0" />
          <span>Importuj adresy z pliku Excel / CSV</span>
        </button>

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
                className="p-0.5 text-current/70 hover:text-current shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </section>

      {/* Krok 3: Zapamiętane ulice i adresy tej parafii */}
      <section className="p-4 sm:p-5 space-y-3 bg-slate-50/50">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-700" />
            <span>Zapamiętane ulice parafii ({savedStreets.length})</span>
          </h3>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {stops.length} domów
          </span>
        </div>

        {savedStreets.length === 0 ? (
          <p className="text-xs text-slate-500 leading-relaxed">
            Brak zapisanych ulic dla tej parafii. Wyznacz obszar i wykryj ulice
            powyżej lub przełącz na zakładkę <strong>„Wybierz ulice”</strong>.
          </p>
        ) : (
          <ul className="border border-slate-200 rounded-xl bg-white divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {savedStreets.map(([streetName, streetStops]) => {
              const isExpanded = expandedStreet === streetName;
              return (
                <li key={streetName} className="bg-white">
                  <div className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50/70">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedStreet(isExpanded ? null : streetName)
                      }
                      className="flex-1 min-w-0 text-left flex items-center gap-2 min-h-[36px]"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-amber-700 shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-900 truncate">
                          {streetName}
                        </div>
                        <div className="text-[11px] text-slate-500 tabular-nums">
                          {streetStops.length}{' '}
                          {streetStops.length === 1 ? 'adres' : 'adresów'} ·{' '}
                          <span className="text-amber-700 font-medium">
                            {isExpanded ? 'zwiń' : 'zobacz domy'}
                          </span>
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
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {isExpanded && (() => {
                    const missingGaps = findMissingHouseNumberGaps(streetStops);
                    return (
                    <div className="px-3 pb-3 pt-2 bg-slate-50/90 border-t border-slate-100 space-y-2">
                      {onFocusStreetOnMap && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-500">
                            Dotknij numer, aby wskazać dom na mapie:
                          </span>
                          <button
                            type="button"
                            onClick={() => onFocusStreetOnMap(streetName)}
                            className="px-2 py-1 text-[11px] font-medium text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg inline-flex items-center gap-1 shrink-0"
                          >
                            <MapIcon className="w-3 h-3" />
                            <span>Na mapie</span>
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                        {streetStops.map((st) => {
                          const numLabel =
                            extractHouseNumberLabel(st) ||
                            st.label ||
                            st.address;
                          const isBlock = Boolean(
                            st.isMultiUnit || (st.units && st.units.length > 0)
                          );
                          return (
                            <div
                              key={st.id}
                              className={`inline-flex items-center rounded-lg border text-[11px] font-mono tabular-nums ${
                                st.inBoundary === false
                                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                                  : 'bg-white border-slate-200 text-slate-800'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => onSelectStop?.(st.id)}
                                title={st.address || st.label}
                                className="px-2 py-1 hover:bg-slate-100 rounded-l-lg inline-flex items-center gap-1"
                              >
                                <span className="font-semibold">{numLabel}</span>
                                {isBlock && (
                                  <span className="text-[9px] font-sans font-bold text-amber-800">
                                    BLOK
                                  </span>
                                )}
                              </button>
                              {onDeleteStop && (
                                <button
                                  type="button"
                                  onClick={() => onDeleteStop(st.id)}
                                  aria-label={`Usuń ${st.address || numLabel}`}
                                  title={`Usuń ${st.address || numLabel}`}
                                  className="px-1.5 py-1 text-slate-400 hover:text-red-600 border-l border-slate-200/80 rounded-r-lg"
                                >
                                  <X className="w-3 h-3" />
                                </button>
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
                              onClick={() => onAddMissingOnStreet(streetName)}
                              className="px-2 py-1 font-semibold text-amber-900 bg-white hover:bg-amber-100 border border-amber-300 rounded-md inline-flex items-center gap-1 shrink-0"
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

        <button
          type="button"
          onClick={onNextStep}
          disabled={!parish || stops.length === 0}
          className="w-full min-h-[44px] py-2.5 px-4 text-xs sm:text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
        >
          <span>Układaj plan kolędy na tych ulicach</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </section>

      {!onOpenAreaScanner && (
        <OsmStreetFetcherModal
          open={areaScannerOpen}
          parish={parish}
          boundary={boundary}
          onClose={() => setAreaScannerOpen(false)}
          onAddPlaces={onBatchAddStops}
        />
      )}

      <CsvImportModal
        open={csvImportOpen}
        parish={parish}
        existingStops={stops}
        onClose={() => setCsvImportOpen(false)}
        onImportPlaces={onBatchAddStops}
      />
    </div>
  );
};
