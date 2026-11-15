import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Church,
  Clock,
  Cloud,
  Layers,
  Loader2,
  LocateFixed,
  LogIn,
  Map as MapIcon,
  Pencil,
  Pentagon,
  RotateCcw,
  Route,
  SlidersHorizontal,
} from 'lucide-react';
import { getCurrentPositionResilient } from '../hooks/useUserGpsLocation';
import {
  NearbyParishCandidate,
  describeLocationForGpsFallback,
  fetchNearbyParishesOsm,
} from '../services/overpassStreets';
import {
  DayPlanSummary,
  LatLng,
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
  SavedParishRecord,
  VisitStop,
} from '../types/parish';
import {
  collectReturnVisitCandidates,
  formatIsoDateLocal,
} from '../utils/seasonScheduler';
import { extractStreetName, formatDistance } from '../utils/spatial';
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
  plannedDays: DayPlanSummary[];
  selectedDate: string | null;
  isSignedIn: boolean;
  userEmail: string | null;
  onSignInGoogle: () => void;
  onSelectParish: (place: SelectedPlaceData) => void;
  onSelectSavedParish: (parishId: string) => void;
  onNavigateSection: (section: WorkspaceSection) => void;
  onOpenDayRoute: (date: string) => void;
  onViewDayOnMap: (date: string) => void;
  onEditDay: (date: string) => void;
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
  plannedDays,
  selectedDate,
  isSignedIn,
  userEmail,
  onSignInGoogle,
  onSelectParish,
  onSelectSavedParish,
  onNavigateSection,
  onOpenDayRoute,
  onViewDayOnMap,
  onEditDay,
}) => {
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [nearbyList, setNearbyList] = useState<NearbyParishCandidate[] | null>(
    null
  );

  const savedStreetCount = useMemo(() => {
    const names = new Set<string>();
    for (const s of stops) {
      names.add(extractStreetName(s));
    }
    return names.size;
  }, [stops]);

  const returnCandidatesCount = useMemo(
    () => collectReturnVisitCandidates(stops).length,
    [stops]
  );

  const currentDayPlan = useMemo<{
    kind: 'today' | 'upcoming' | 'past';
    badge: string;
    day: DayPlanSummary;
    visitedCount: number;
  } | null>(() => {
    if (plannedDays.length === 0) return null;
    const todayIso = formatIsoDateLocal(new Date());
    const todayMatch = plannedDays.find((d) => d.date === todayIso);
    const upcomingMatch = !todayMatch
      ? plannedDays.find((d) => d.date > todayIso)
      : undefined;
    const targetDay =
      todayMatch ?? upcomingMatch ?? plannedDays[plannedDays.length - 1];
    const kind: 'today' | 'upcoming' | 'past' = todayMatch
      ? 'today'
      : upcomingMatch
        ? 'upcoming'
        : 'past';
    const badge =
      kind === 'today'
        ? 'Dzisiaj w planie'
        : kind === 'upcoming'
          ? 'Najbliższy dzień kolędy'
          : 'Ostatni dzień w planie';

    let visitedCount = 0;
    for (const s of targetDay.stops) {
      const isBlock = Boolean(s.isMultiUnit || (s.units && s.units.length > 0));
      if (isBlock && s.units && s.units.length > 0) {
        if (s.units.every((u) => u.status !== 'pending')) visitedCount += 1;
      } else if ((s.visitStatus ?? 'pending') !== 'pending') {
        visitedCount += 1;
      }
    }

    return { kind, badge, day: targetDay, visitedCount };
  }, [plannedDays]);

  const [lastGpsLocation, setLastGpsLocation] = useState<{
    location: LatLng;
    address: string;
    city: string;
  } | null>(null);

  const handleFindGps = async () => {
    setGpsLoading(true);
    setGpsError(null);
    setLastGpsLocation(null);
    try {
      const gps = await getCurrentPositionResilient();
      const [itemsResult, descResult] = await Promise.allSettled([
        fetchNearbyParishesOsm(gps.location, 7000),
        describeLocationForGpsFallback(gps.location),
      ]);
      const items =
        itemsResult.status === 'fulfilled' ? itemsResult.value : [];
      const desc =
        descResult.status === 'fulfilled'
          ? descResult.value
          : {
              city: '',
              address: `${gps.location.lat.toFixed(5)}, ${gps.location.lng.toFixed(5)}`,
            };

      setLastGpsLocation({
        location: gps.location,
        city: desc.city,
        address: desc.address,
      });
      setNearbyList(items);
      if (items.length === 0) {
        setGpsError(
          'Nie znaleziono kościołów w promieniu 7 km. Możesz użyć swojej obecnej pozycji GPS poniżej lub wpisać nazwę parafii.'
        );
      }
    } catch (err) {
      setGpsError(
        err instanceof Error
          ? err.message
          : 'Nie udało się odczytać lokalizacji GPS.'
      );
    } finally {
      setGpsLoading(false);
    }
  };

  if (!parish) {
    return (
      <div className="p-4 sm:p-5 space-y-5">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-slate-900 tracking-tight">
            Rozpocznij plan kolędy
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            Wyszukaj parafię, pobierz ulice z mapy, a potem w 3 krokach
            zaplanuj dowolny dzień lub zobacz podsumowanie całego okresu.
          </p>
        </div>

        <div className="space-y-2.5">
          <PlaceSearchInput
            placeholder="Wpisz parafię lub miasto, np. św Antoni Mikołów"
            searchScope="parish"
            onSelect={(place) => {
              onSelectParish(place);
              onNavigateSection('parish');
            }}
          />

          <button
            type="button"
            disabled={gpsLoading}
            onClick={() => void handleFindGps()}
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
                      setLastGpsLocation(null);
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
                setNearbyList(null);
                setLastGpsLocation(null);
                setGpsError(null);
                onNavigateSection('parish');
              }}
              className="w-full min-h-[42px] px-3 py-2 text-left rounded-xl border border-amber-200 bg-amber-50/70 hover:bg-amber-100/70 flex items-center justify-between gap-2 transition-colors"
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
              Zaloguj się przez Google lub załóż darmowe konto na dowolny
              adres e-mail — wszystkie tereny i plany będą przypisane wyłącznie
              do Twojego konta.
            </p>
            <button
              type="button"
              onClick={onSignInGoogle}
              className="w-full min-h-[42px] py-2 px-3 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
            >
              <LogIn className="w-4 h-4 text-amber-400" />
              Zaloguj się lub załóż konto
            </button>
          </div>
        )}
      </div>
    );
  }

  const hasSavedStops = stops.length > 0;
  const hasBoundary = boundary.length >= 3;

  return (
    <div className="divide-y divide-slate-200">
      {/* Compact Active Parish Header */}
      <section className="p-4 sm:p-5 space-y-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-amber-800 flex items-center gap-1.5">
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
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {parish.address}
          </p>
          <p className="text-xs text-slate-600 mt-2 tabular-nums">
            {hasSavedStops ? (
              <>
                <strong className="text-slate-900">{savedStreetCount}</strong>{' '}
                ulic · <strong className="text-slate-900">{stops.length}</strong>{' '}
                domów ·{' '}
                <strong className="text-amber-800">{plannedDays.length}</strong>{' '}
                {plannedDays.length === 1 ? 'dzień zaplanowany' : 'dni zaplanowane'}
              </>
            ) : (
              'Dodaj ulice parafii, aby rozpocząć planowanie.'
            )}
          </p>
        </div>

        {isSignedIn && savedParishes.length > 1 && (
          <select
            aria-label="Zmień zapisaną parafię"
            value={activeParishId ?? ''}
            onChange={(e) => onSelectSavedParish(e.target.value)}
            className="w-full min-h-[40px] px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:bg-white focus:outline-none focus:border-amber-600"
          >
            {savedParishes.map((rec) => (
              <option key={rec.id} value={rec.id}>
                {rec.parish.name}
              </option>
            ))}
          </select>
        )}
      </section>

      {/* Current / Upcoming Planned Day */}
      {hasSavedStops && currentDayPlan && (
        <section className="p-4 sm:p-5">
          <div
            className={`rounded-xl border p-3.5 space-y-2.5 ${
              currentDayPlan.kind === 'today'
                ? 'border-amber-300 bg-amber-50/85'
                : 'border-slate-200 bg-slate-50/75'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                  currentDayPlan.kind === 'today'
                    ? 'bg-amber-700 text-white'
                    : 'bg-slate-200/80 text-slate-800'
                }`}
              >
                <CalendarDays className="w-3 h-3 shrink-0" />
                {currentDayPlan.badge}
              </span>
              <span className="text-xs font-medium text-slate-700 tabular-nums">
                {currentDayPlan.day.startTime}–
                {currentDayPlan.day.plannedEndTime ||
                  currentDayPlan.day.estimatedEndTime}
              </span>
            </div>

            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">
                {currentDayPlan.day.weekdayLabel},{' '}
                {currentDayPlan.day.shortDateLabel}
              </div>
              <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                {currentDayPlan.day.streetNames.length > 0
                  ? `${currentDayPlan.day.streetNames.slice(0, 3).join(', ')}${
                      currentDayPlan.day.streetNames.length > 3
                        ? ` +${currentDayPlan.day.streetNames.length - 3}`
                        : ''
                    }`
                  : 'Wybrane punkty na mapie'}
              </p>
              <div className="text-[11px] text-slate-500 mt-1 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>
                  <strong className="text-slate-800">
                    {currentDayPlan.day.stops.length}
                  </strong>{' '}
                  {currentDayPlan.day.stops.length === 1 ? 'dom' : 'domów'}
                </span>
                {currentDayPlan.day.totalDistanceMeters > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {formatDistance(currentDayPlan.day.totalDistanceMeters)}
                    </span>
                  </>
                )}
                {currentDayPlan.visitedCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-700 font-medium">
                      Odwiedzono {currentDayPlan.visitedCount}/
                      {currentDayPlan.day.stops.length}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => onOpenDayRoute(currentDayPlan.day.date)}
                className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Route className="w-3.5 h-3.5 shrink-0" />
                Trasa
              </button>
              <button
                type="button"
                onClick={() => onViewDayOnMap(currentDayPlan.day.date)}
                className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-800 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <MapIcon className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                Mapa
              </button>
              <button
                type="button"
                onClick={() => onEditDay(currentDayPlan.day.date)}
                className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-800 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                Edytuj
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Main Clean Actions */}
      <section className="p-4 sm:p-5 space-y-2.5">
        {!hasSavedStops ? (
          <button
            type="button"
            onClick={() => onNavigateSection('parish')}
            className="w-full min-h-[56px] px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100/80 text-left flex items-center justify-between gap-3 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              {hasBoundary ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
              ) : (
                <Pentagon className="w-5 h-5 text-amber-800 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  Dodaj ulice parafii
                </div>
                <div className="text-xs text-slate-600 mt-0.5">
                  Kliknij ulice na mapie lub pobierz teren
                </div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-amber-800 shrink-0" />
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onNavigateSection('stops')}
              className="w-full min-h-[56px] px-4 py-3 rounded-xl border border-amber-300 bg-amber-50/90 hover:bg-amber-100/80 text-left flex items-center justify-between gap-3 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-700 text-white flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">
                    Zaplanuj konkretny dzień
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    Data, godziny, ulice i punkt START
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-amber-800 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigateSection('schedule')}
              className="w-full min-h-[56px] px-4 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left flex items-center justify-between gap-3 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                  <CalendarCheck className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">
                    Cały okres i wydruk PDF
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {plannedDays.length > 0
                      ? `${plannedDays.length} ${
                          plannedDays.length === 1 ? 'dzień' : 'dni'
                        } · ogłoszenia, edycja i usuwanie tras`
                      : 'Automatyczny grafik, lista dni i ogłoszenia'}
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
            </button>

            {routes.length > 0 &&
              (!currentDayPlan ||
                selectedDate !== currentDayPlan.day.date) && (
                <button
                  type="button"
                  onClick={() => onNavigateSection('routes')}
                  className="w-full min-h-[50px] px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100/60 text-left flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Route className="w-4 h-4 text-emerald-700 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-emerald-950">
                        Trasa dnia (
                        {routes.reduce((a, r) => a + r.orderedStops.length, 0)}{' '}
                        domów)
                      </div>
                      <div className="text-[11px] text-emerald-800">
                        Kolejność domów i tryb w terenie
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-emerald-700 shrink-0" />
                </button>
              )}
          </>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={() => onNavigateSection('parish')}
            className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left flex items-center gap-2 transition-colors"
          >
            <Layers className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span className="text-xs font-medium text-slate-800 truncate">
              Ulice ({savedStreetCount})
            </span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateSection('settings')}
            className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left flex items-center gap-2 transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-xs font-medium text-slate-800 truncate">
              {config.priestCount} ks. · {config.defaultVisitMinutes} min
            </span>
          </button>
        </div>

        {returnCandidatesCount > 0 && (
          <button
            type="button"
            onClick={() => onNavigateSection('schedule')}
            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-amber-200 bg-amber-50/70 hover:bg-amber-100/70 text-left flex items-center justify-between gap-3 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <RotateCcw className="w-4 h-4 text-amber-800 shrink-0" />
              <span className="text-xs font-semibold text-amber-950 truncate tabular-nums">
                Powroty i zaproszenia ({returnCandidatesCount})
              </span>
            </div>
            <ArrowRight className="w-4 h-4 text-amber-700 shrink-0" />
          </button>
        )}
      </section>
    </div>
  );
};
