import React from 'react';
import {
  AlertCircle,
  Download,
  ExternalLink,
  Loader2,
  Navigation,
  Printer,
  RefreshCw,
} from 'lucide-react';
import {
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
} from '../types/parish';
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
  isComputing: boolean;
  globalError: string | null;
  onRecompute: () => void;
  onSelectStop: (stopId: string) => void;
}

export const SidebarRoutes: React.FC<SidebarRoutesProps> = ({
  parish,
  config,
  routes,
  isComputing,
  globalError,
  onRecompute,
  onSelectStop,
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
            Google Routes API układa najkrótsze trasy dla każdego księdza.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-5 border-b border-slate-200 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Wyznaczone trasy kolędowe
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            Start: {config.startTime} ·{' '}
            {config.travelMode === 'WALKING' ? 'Pieszo' : 'Samochodem'}
          </p>
        </div>
        <button
          type="button"
          onClick={onRecompute}
          disabled={!parish}
          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Przelicz
        </button>
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
            <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
              Dodaj co najmniej jeden punkt odwiedzin i kliknij „Wyznacz
              optymalne trasy”, aby ułożyć kolejność wizyt.
            </p>
          </div>
        ) : (
          routes.map((route) => (
            <section key={route.priestId} className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
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
                    className="px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                  >
                    Nawiguj
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {route.error ? (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                  {route.error}
                </div>
              ) : (
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
                        {formatDistance(route.returnLegDistanceMeters)} · finisz{' '}
                        {route.endTime}
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
          ))
        )}
      </div>

      {routes.length > 0 && (
        <div className="p-4 border-t border-slate-200 bg-white grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => exportScheduleToCsv(parish, routes)}
            className="py-2 px-3 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Eksportuj CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="py-2 px-3 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            Drukuj plan
          </button>
        </div>
      )}
    </div>
  );
};
