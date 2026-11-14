import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  Church,
  Clock,
  Cloud,
  Compass,
  Loader2,
  LocateFixed,
  LogIn,
  Map as MapIcon,
  MapPin,
  Pentagon,
  Plus,
  Route,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import {
  NearbyParishCandidate,
  fetchNearbyParishesOsm,
} from '../services/overpassStreets';
import {
  LatLng,
  PRIEST_PALETTE,
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
  SavedParishRecord,
  VisitStop,
} from '../types/parish';
import { formatDistance, formatDurationMillis } from '../utils/spatial';
import { PlaceSearchInput, SelectedPlaceData } from './PlaceSearchInput';

export type WorkspaceSection =
  | 'overview'
  | 'parish'
  | 'stops'
  | 'routes'
  | 'settings'
  | 'schedule';

interface PlanDashboardProps {
  parish: ParishCenter | null;
  activeParishId: string | null;
  savedParishes: SavedParishRecord[];
  boundary: LatLng[];
  stops: VisitStop[];
  config: PlanConfig;
  routes: PriestRouteResult[];
  isSignedIn: boolean;
  userEmail: string | null;
  isComputing: boolean;
  onSignInGoogle: () => void;
  onSelectParish: (place: SelectedPlaceData) => void;
  onSelectSavedParish: (parishId: string) => void;
  onNavigateSection: (section: WorkspaceSection) => void;
  onOpenMapWithMode: (mode: 'pan' | 'draw_boundary' | 'pick_street') => void;
  onComputeRoutes: () => void;
}

function formatShortDist(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

export const PlanDashboard: React.FC<PlanDashboardProps> = ({
  parish,
  activeParishId,
  savedParishes,
  boundary,
  stops,
  config,
  routes,
  isSignedIn,
  userEmail,
  isComputing,
  onSignInGoogle,
  onSelectParish,
  onSelectSavedParish,
  onNavigateSection,
  onOpenMapWithMode,
  onComputeRoutes,
}) => {
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [nearbyList, setNearbyList] = useState<NearbyParishCandidate[] | null>(
    null
  );

  const streetSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of stops) {
      const firstPart = s.address.split(',')[0]?.trim() || s.label;
      // Extract street name without trailing house number (e.g. "Zielona 14a" -> "Zielona")
      const streetName = firstPart.replace(/\s+\d+[a-zA-Z]?(\/\d+[a-zA-Z]?)?$/, '').trim() || firstPart;
      counts[streetName] = (counts[streetName] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [stops]);

  const routeMetrics = useMemo(() => {
    if (routes.length === 0) return null;
    const totalMeters = routes.reduce((acc, r) => acc + r.totalDistanceMeters, 0);
    const totalMs = routes.reduce(
      (acc, r) => acc + r.totalTravelDurationMillis,
      0
    );
    const latestEnd = routes
      .map((r) => r.endTime)
      .sort()
      .slice(-1)[0];
    return {
      totalMeters,
      totalMs,
      latestEnd,
      count: routes.length,
    };
  }, [routes]);

  const handleFindGps = () => {
    if (!navigator.geolocation) {
      setGpsError('Przeglądarka nie obsługuje lokalizacji GPS.');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const items = await fetchNearbyParishesOsm(
            { lat: pos.coords.latitude, lng: pos.coords.longitude },
            6000
          );
          setNearbyList(items);
          if (items.length === 0) {
            setGpsError('Nie znaleziono kościołów w promieniu 6 km.');
          }
        } catch {
          setGpsError('Nie udało się pobrać kościołów z OpenStreetMap.');
        } finally {
          setGpsLoading(false);
        }
      },
      () => {
        setGpsLoading(false);
        setGpsError('Brak zgody na GPS. Wpisz nazwę parafii lub miasta powyżej.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // Empty / onboarding state when no parish is selected yet
  if (!parish) {
    return (
      <div className="p-4 sm:p-5 space-y-5">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-slate-900 tracking-tight">
            Rozpocznij plan kolędy
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            Wybierz parafię lub miasto, aby wyznaczyć teren, pobrać domy z ulic
            i ułożyć harmonogram odwiedzin.
          </p>
        </div>

        <div className="space-y-2.5">
          <PlaceSearchInput
            placeholder="Wpisz parafię lub miasto, np. św Antoni Mikołów"
            searchScope="parish"
            onSelect={(place) => {
              onSelectParish(place);
              if (place.placeType === 'place') {
                onNavigateSection('parish');
              }
            }}
          />

          <button
            type="button"
            disabled={gpsLoading}
            onClick={handleFindGps}
            className="w-full min-h-[42px] py-2 px-3 text-xs font-medium rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 inline-flex items-center justify-center gap-2 transition-colors"
          >
            {gpsLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-amber-700" />
            ) : (
              <LocateFixed className="w-4 h-4 text-amber-700" />
            )}
            <span>Znajdź parafie w pobliżu (GPS)</span>
          </button>

          {gpsError && <p className="text-xs text-red-600">{gpsError}</p>}

          {nearbyList && nearbyList.length > 0 && (
            <ul className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto bg-white">
              {nearbyList.map((item) => (
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
                      setNearbyList(null);
                    }}
                    className="w-full min-h-[46px] px-3 py-2.5 text-left hover:bg-amber-50/60 flex items-start justify-between gap-2 transition-colors"
                  >
                    <div className="min-w-0 flex items-start gap-2">
                      <Church className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-900 truncate">
                          {item.name}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {item.address}
                        </div>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0">
                      {formatShortDist(item.distanceMeters)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {isSignedIn ? (
          savedParishes.length > 0 && (
            <div className="pt-3 border-t border-slate-200 space-y-2">
              <div className="text-xs font-medium text-slate-700">
                Twoje zapisane parafie ({savedParishes.length})
              </div>
              <ul className="space-y-1.5">
                {savedParishes.map((rec) => (
                  <li key={rec.id}>
                    <button
                      type="button"
                      onClick={() => onSelectSavedParish(rec.id)}
                      className="w-full min-h-[44px] px-3 py-2 text-left rounded-xl border border-slate-200 hover:bg-slate-50 flex items-center justify-between gap-2 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-900 truncate">
                          {rec.parish.name}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {rec.parish.address}
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : (
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5">
            <div className="text-xs font-medium text-slate-800">
              Zapisuj swoje parafie i plany kolędy w chmurze
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Po zalogowaniu przez Google wszystkie wyznaczone granice, domy i
              trasy będą przypisane wyłącznie do Twojego konta.
            </p>
            <button
              type="button"
              onClick={onSignInGoogle}
              className="w-full min-h-[42px] py-2 px-3 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
            >
              <LogIn className="w-4 h-4 text-amber-400" />
              Zaloguj przez Google
            </button>
          </div>
        )}
      </div>
    );
  }

  const hasBoundary = boundary.length >= 3;
  const hasStops = stops.length > 0;
  const hasRoutes = routes.length > 0;

  return (
    <div className="divide-y divide-slate-200">
      {/* Active Parish Card */}
      <section className="p-4 sm:p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-amber-800 flex items-center gap-1.5">
              <Church className="w-3.5 h-3.5 shrink-0" />
              <span>Aktywna parafia</span>
              {isSignedIn && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-normal">
                    <Cloud className="w-3 h-3" />
                    {userEmail?.split('@')[0] || 'Zapisano'}
                  </span>
                </>
              )}
            </div>
            <h2 className="mt-1 text-base font-semibold text-slate-900 leading-snug">
              {parish.name}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{parish.address}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onNavigateSection('parish')}
            className="flex-1 min-w-[130px] min-h-[40px] px-3 py-2 text-xs font-medium text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5 text-amber-700" />
            <span>Zmień / dodaj parafię</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenMapWithMode('pan')}
            className="min-h-[40px] px-3 py-2 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <MapIcon className="w-3.5 h-3.5 text-slate-600" />
            <span>Mapa</span>
          </button>
        </div>

        {isSignedIn && savedParishes.length > 1 && (
          <div className="pt-1">
            <label
              htmlFor="dashboard-parish-switch"
              className="block text-[11px] font-medium text-slate-500 mb-1"
            >
              Szybkie przełączenie zapisanej parafii ({savedParishes.length})
            </label>
            <select
              id="dashboard-parish-switch"
              value={activeParishId ?? ''}
              onChange={(e) => onSelectSavedParish(e.target.value)}
              className="w-full min-h-[40px] px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-amber-600"
            >
              {savedParishes.map((rec) => (
                <option key={rec.id} value={rec.id}>
                  {rec.parish.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {/* Kolęda Plan Key Metrics */}
      <section className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-700">
            Dane planu kolędy
          </h3>
          <span className="text-[11px] text-slate-500 tabular-nums">
            Start {config.startTime} · {config.defaultVisitMinutes} min/dom
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateSection('stops')}
            className="p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left transition-colors"
          >
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Domy</span>
              <MapPin className="w-3.5 h-3.5 text-amber-700" />
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
              {stops.length}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 truncate">
              {streetSummary.length > 0
                ? `${streetSummary.length} ${
                    streetSummary.length === 1 ? 'ulica' : 'ulice/ulic'
                  }`
                : 'Kliknij ulicę na mapie'}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateSection('parish')}
            className="p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left transition-colors"
          >
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Teren parafii</span>
              <Pentagon
                className={`w-3.5 h-3.5 ${
                  hasBoundary ? 'text-emerald-700' : 'text-amber-700'
                }`}
              />
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {hasBoundary ? 'Wyznaczony' : 'Brak obrysu'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              {hasBoundary
                ? `${boundary.length} wierzchołków`
                : 'Ustaw promień lub obrys'}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateSection('settings')}
            className="p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left transition-colors"
          >
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Zespół i tryb</span>
              <Users className="w-3.5 h-3.5 text-slate-600" />
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900 tabular-nums">
              {config.priestCount}{' '}
              {config.priestCount === 1 ? 'ksiądz' : 'księży'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 truncate">
              {config.travelMode === 'WALKING'
                ? 'Pieszo (miasto)'
                : 'Samochodem (wieś)'}
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              hasRoutes
                ? onNavigateSection('routes')
                : hasStops
                  ? onComputeRoutes()
                  : onNavigateSection('stops')
            }
            className="p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left transition-colors"
          >
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Trasy</span>
              <Compass
                className={`w-3.5 h-3.5 ${
                  hasRoutes ? 'text-emerald-700' : 'text-slate-500'
                }`}
              />
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900 tabular-nums">
              {routeMetrics
                ? formatDistance(routeMetrics.totalMeters)
                : hasStops
                  ? 'Do wyznaczenia'
                  : 'Oczekuje'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums truncate">
              {routeMetrics
                ? `Koniec ok. ${routeMetrics.latestEnd} · ${formatDurationMillis(routeMetrics.totalMs)} drogi`
                : hasStops
                  ? 'Kliknij, aby policzyć'
                  : 'Dodaj najpierw domy'}
            </div>
          </button>
        </div>
      </section>

      {/* Quick Plan Workflow Actions */}
      <section className="p-4 sm:p-5 space-y-2">
        <h3 className="text-xs font-semibold text-slate-700 mb-2">
          Szybkie akcje planu
        </h3>

        <button
          type="button"
          onClick={() => onOpenMapWithMode('pick_street')}
          className="w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border border-amber-200 bg-amber-50/70 hover:bg-amber-100/70 text-left flex items-center justify-between gap-3 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Route className="w-4 h-4 text-amber-800 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-amber-950 truncate">
                Kliknij ulicę na mapie i pobierz wszystkie domy
              </div>
              <div className="text-[11px] text-amber-800/80 truncate">
                Automatyczny import numerów domów z OpenStreetMap
              </div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-amber-800 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => onNavigateSection('parish')}
          className="w-full min-h-[46px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left flex items-center justify-between gap-3 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            {hasBoundary ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            ) : (
              <Pentagon className="w-4 h-4 text-slate-500 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-900 truncate">
                {hasBoundary
                  ? 'Edytuj teren parafii lub przełącz parafię'
                  : 'Wyznacz granice terenu parafii'}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                Gotowy promień 300 m / 500 m / 1 km lub rysowanie ręczne
              </div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => onNavigateSection('settings')}
          className="w-full min-h-[46px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left flex items-center justify-between gap-3 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <SlidersHorizontal className="w-4 h-4 text-slate-500 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-900 truncate">
                Ustawienia kolędy (księża, godzina startu, czas)
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {config.priestCount}{' '}
                {config.priestCount === 1 ? 'ksiądz' : 'księży'} · start{' '}
                {config.startTime} · {config.defaultVisitMinutes} min/wizyta
              </div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => onNavigateSection('schedule')}
          className="w-full min-h-[46px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left flex items-center justify-between gap-3 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <CalendarCheck className="w-4 h-4 text-slate-500 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-900 truncate">
                Harmonogram wizyt, druk i eksport CSV
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {hasRoutes
                  ? 'Gotowy plan godzinowy dla księży i parafian'
                  : 'Dostępne po wyznaczeniu tras'}
              </div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>
      </section>

      {/* Street & Priest Breakdown when stops exist */}
      {stops.length > 0 && (
        <section className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-700">
              Podział domów na księży i ulice
            </h3>
            <button
              type="button"
              onClick={() => onNavigateSection('stops')}
              className="text-xs font-medium text-amber-800 hover:underline"
            >
              Edytuj domy
            </button>
          </div>

          <div className="space-y-1.5">
            {PRIEST_PALETTE.slice(0, config.priestCount).map((p) => {
              const count = stops.filter((s) => s.priestId === p.id).length;
              const priestRoute = routes.find((r) => r.priestId === p.id);
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded-lg bg-slate-50"
                >
                  <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: p.color }}
                    />
                    {p.name}
                  </span>
                  <span className="font-mono tabular-nums text-slate-600">
                    {count} {count === 1 ? 'dom' : 'domów'}
                    {priestRoute && ` · do ${priestRoute.endTime}`}
                  </span>
                </div>
              );
            })}
          </div>

          {streetSummary.length > 0 && (
            <div className="pt-1 space-y-1">
              <div className="text-[11px] text-slate-500">
                Ulice na liście:
              </div>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
                {streetSummary.map(([street, count]) => (
                  <div
                    key={street}
                    className="px-3 py-2 flex items-center justify-between text-xs"
                  >
                    <span className="text-slate-800 truncate">{street}</span>
                    <span className="font-mono tabular-nums text-slate-500 shrink-0 ml-2">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={isComputing}
            onClick={onComputeRoutes}
            className="w-full min-h-[44px] py-2.5 px-4 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
          >
            {isComputing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Clock className="w-4 h-4" />
            )}
            <span>
              {isComputing
                ? 'Wyznaczanie optymalnych tras...'
                : hasRoutes
                  ? 'Przelicz optymalne trasy ponownie'
                  : 'Wyznacz optymalne trasy kolędy'}
            </span>
          </button>
        </section>
      )}
    </div>
  );
};
