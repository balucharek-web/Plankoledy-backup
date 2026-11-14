import React from 'react';
import {
  AlertCircle,
  CalendarCheck,
  Download,
  ExternalLink,
  Eye,
  Loader2,
  Map as MapIcon,
  Navigation,
  Printer,
  RefreshCw,
} from 'lucide-react';
import {
  DayPlanSummary,
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
} from '../types/parish';
import {
  formatPolishDateChip,
  formatPolishDateFull,
} from '../utils/seasonScheduler';
import {
  buildGoogleMapsDirectionsUrl,
  exportScheduleToCsv,
  formatDistance,
  formatDurationMillis,
  formatMinutesLabel,
} from '../utils/spatial';

interface SidebarRoutesProps {
  parish: ParishCenter | null;
  config: PlanConfig;
  routes: PriestRouteResult[];
  isExactRoute: boolean;
  plannedDays: DayPlanSummary[];
  selectedDate: string | null;
  effectiveStartTime: string;
  focusedPriestId: number | null;
  isComputing: boolean;
  globalError: string | null;
  onSelectDate: (date: string | null) => void;
  onFocusPriestOnMap: (priestId: number | null) => void;
  onRecompute: () => void;
  onSelectStop: (stopId: string) => void;
  onViewRouteOnMap: (priestId?: number | null) => void;
  onOpenSchedule: () => void;
}

export const SidebarRoutes: React.FC<SidebarRoutesProps> = ({
  parish,
  config,
  routes,
  isExactRoute,
  plannedDays,
  selectedDate,
  effectiveStartTime,
  focusedPriestId,
  isComputing,
  globalError,
  onSelectDate,
  onFocusPriestOnMap,
  onRecompute,
  onSelectStop,
  onViewRouteOnMap,
  onOpenSchedule,
}) => {
  if (isComputing) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center gap-3">
        <Loader2 className="w-6 h-6 text-amber-700 animate-spin" />
        <div>
          <p className="text-sm font-medium text-slate-900">
            Optymalizacja kolejności odwiedzin...
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Algorytm układa najkrótsze trasy drogowe dla każdego księdza.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3 bg-white shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">
              {selectedDate
                ? `Trasy · ${formatPolishDateFull(selectedDate)}`
                : 'Wyznaczone trasy kolędowe'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              Start: {effectiveStartTime} ·{' '}
              {config.travelMode === 'WALKING' ? 'Pieszo' : 'Samochodem'}
              {routes.length > 0 && (
                <>
                  {' '}
                  ·{' '}
                  <span
                    className={
                      isExactRoute
                        ? 'text-emerald-700 font-medium'
                        : 'text-amber-700 font-medium'
                    }
                  >
                    {isExactRoute ? 'Dokładna trasa drogowa' : 'Szacunek trasy'}
                  </span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onRecompute}
            disabled={!parish}
            className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {isExactRoute ? 'Przelicz' : 'Wyznacz drogowo'}
          </button>
        </div>

        {/* Multi-day switcher strip */}
        {plannedDays.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {plannedDays.map((day) => {
              const active = selectedDate === day.date;
              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => onSelectDate(day.date)}
                  className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 tabular-nums transition-colors ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {formatPolishDateChip(day.date)} ({day.stops.length})
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => onSelectDate(null)}
              className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                selectedDate === null
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Wszystkie zaznaczone
            </button>
          </div>
        )}

        {/* Prominent Map Preview & Season Overview Bar */}
        {routes.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onViewRouteOnMap(null)}
              className="min-h-[40px] px-3 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>Zobacz trasy na mapie</span>
            </button>
            <button
              type="button"
              onClick={onOpenSchedule}
              className="min-h-[40px] px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <CalendarCheck className="w-3.5 h-3.5 text-slate-600" />
              <span>Cały harmonogram</span>
            </button>
          </div>
        )}

        {routes.length > 0 && !isExactRoute && (
          <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-2 text-xs text-amber-900">
            <span className="leading-snug">
              Podgląd szacowanego czasu i kolejności. Przelicz po drogach, aby
              dodać dokładny przebieg ulicami.
            </span>
            <button
              type="button"
              onClick={onRecompute}
              className="min-h-[32px] px-2.5 py-1 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg whitespace-nowrap shrink-0"
            >
              Wyznacz
            </button>
          </div>
        )}
      </div>

      {globalError && (
        <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span>{globalError}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
        {routes.length === 0 ? (
          <div className="p-8 text-center">
            <Navigation className="w-6 h-6 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-800">
              Brak wyznaczonych tras
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">
              W zakładce „Układanie planu” rozpisz okres kolędowy albo zaznacz
              ulice i kliknij „Wyznacz trasy”, aby zobaczyć przebieg na mapie.
            </p>
          </div>
        ) : (
          routes.map((route) => {
            const isFocused = focusedPriestId === route.priestId;
            return (
              <section key={route.priestId} className="p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: route.color }}
                      />
                      <h3 className="text-sm font-semibold text-slate-900">
                        {route.priestName}
                      </h3>
                    </div>
                    <div className="mt-1 text-xs text-slate-500 tabular-nums">
                      {route.orderedStops.length}{' '}
                      {route.orderedStops.length === 1
                        ? 'wizyta'
                        : route.orderedStops.length < 5
                          ? 'wizyty'
                          : 'wizyt'}{' '}
                      · {formatDistance(route.totalDistanceMeters)} · Przejście:{' '}
                      {formatDurationMillis(route.totalTravelDurationMillis)} ·
                      Koniec ok. {route.endTime}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const nextFocus = isFocused ? null : route.priestId;
                        onFocusPriestOnMap(nextFocus);
                        onViewRouteOnMap(route.priestId);
                      }}
                      className={`min-h-[34px] px-2.5 py-1.5 text-xs font-medium rounded-lg inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                        isFocused
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Na mapie
                    </button>

                    {parish && route.orderedStops.length > 0 && (
                      <a
                        href={buildGoogleMapsDirectionsUrl(
                          parish,
                          route.orderedStops.map((s) => s.stop),
                          config.returnToParish,
                          config.travelMode
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[34px] px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                      >
                        Nawiguj
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

                {route.error && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                    {route.error}
                  </div>
                )}

                {route.orderedStops.length > 0 && (
                  <ol className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white overflow-hidden">
                    {route.orderedStops.map((item) => (
                      <li key={item.stop.id}>
                        <button
                          type="button"
                          onClick={() => onSelectStop(item.stop.id)}
                          className="w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-colors flex items-start gap-3"
                        >
                          <span
                            className="w-5 h-5 rounded-full text-[11px] font-mono font-semibold text-white flex items-center justify-center shrink-0 mt-0.5 tabular-nums"
                            style={{ backgroundColor: route.color }}
                          >
                            {item.orderIndex}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-900 truncate">
                                {item.stop.address || item.stop.label}
                              </span>
                              <span className="text-xs font-mono text-slate-700 tabular-nums shrink-0">
                                {item.arrivalTime}–{item.departureTime}
                              </span>
                            </div>
                            {(item.stop.notes ||
                              (item.stop.label &&
                                item.stop.label !== item.stop.address)) && (
                              <div className="text-xs text-slate-500 truncate mt-0.5">
                                {item.stop.notes || item.stop.label}
                              </div>
                            )}
                            <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                              Dojazd: {formatDistance(item.legDistanceMeters)} ·{' '}
                              {formatDurationMillis(item.legDurationMillis)} ·
                              Wizyta: {item.stop.durationMinutes} min
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                    {config.returnToParish && parish && (
                      <li className="px-3 py-2 bg-slate-50 text-xs text-slate-600 flex items-center justify-between tabular-nums">
                        <span>Powrót: {parish.name}</span>
                        <span className="font-mono">
                          {formatDistance(route.returnLegDistanceMeters)} ·
                          finisz {route.endTime}
                        </span>
                      </li>
                    )}
                  </ol>
                )}

                <div className="text-xs text-slate-500 tabular-nums">
                  Łączny czas wizyt w domach:{' '}
                  {formatMinutesLabel(route.totalVisitMinutes)}
                </div>
              </section>
            );
          })
        )}
      </div>

      {routes.length > 0 && (
        <div className="p-4 border-t border-slate-200 bg-white grid grid-cols-2 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => exportScheduleToCsv(parish, routes)}
            className="min-h-[40px] py-2 px-3 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Eksportuj CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[40px] py-2 px-3 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            Drukuj dzień
          </button>
        </div>
      )}
    </div>
  );
};
