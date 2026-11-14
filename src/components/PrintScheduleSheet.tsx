import React from 'react';
import { Download, ExternalLink, Printer } from 'lucide-react';
import { ParishCenter, PlanConfig, PriestRouteResult } from '../types/parish';
import {
  buildGoogleMapsDirectionsUrl,
  exportScheduleToCsv,
  formatDistance,
  formatDurationMillis,
  formatMinutesLabel,
} from '../utils/spatial';

interface PrintScheduleSheetProps {
  parish: ParishCenter | null;
  config: PlanConfig;
  routes: PriestRouteResult[];
  onBackToMap: () => void;
}

export const PrintScheduleSheet: React.FC<PrintScheduleSheetProps> = ({
  parish,
  config,
  routes,
  onBackToMap,
}) => {
  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Harmonogram odwiedzin duszpasterskich
          </h1>
          <p className="text-sm text-slate-500 mt-1 tabular-nums">
            {parish ? parish.name : 'Parafia'} · Start: {config.startTime} ·
            Tryb: {config.travelMode === 'WALKING' ? 'Pieszo' : 'Samochodem'}
          </p>
        </div>

        <div className="flex items-center gap-2 no-print">
          <button
            type="button"
            onClick={onBackToMap}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            Wróć do mapy
          </button>
          {routes.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => exportScheduleToCsv(parish, routes)}
                className="px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Eksportuj CSV
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                Drukuj harmonogram
              </button>
            </>
          )}
        </div>
      </div>

      {routes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <p className="text-sm font-medium text-slate-800">
            Harmonogram jest jeszcze pusty
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Wróć do widoku mapy, dodaj punkty kolędowe i kliknij „Wyznacz
            optymalne trasy”.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {routes.map((route) => (
            <section
              key={route.priestId}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: route.color }}
                    />
                    <h2 className="text-base font-semibold text-slate-900">
                      {route.priestName}
                    </h2>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
                    {route.orderedStops.length} wizyt · Dystans:{' '}
                    {formatDistance(route.totalDistanceMeters)} · Przejście:{' '}
                    {formatDurationMillis(route.totalTravelDurationMillis)} ·
                    Wizyty: {formatMinutesLabel(route.totalVisitMinutes)} ·
                    Koniec ok. {route.endTime}
                  </p>
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
                    className="no-print px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg inline-flex items-center gap-1.5"
                  >
                    Otwórz w Google Maps
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4 w-14">Lp.</th>
                      <th className="py-2.5 px-4">Godziny</th>
                      <th className="py-2.5 px-4">Adres domu</th>
                      <th className="py-2.5 px-4">Rodzina / Uwagi</th>
                      <th className="py-2.5 px-4 text-right">Dojazd</th>
                      <th className="py-2.5 px-4 text-right">Wizyta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {route.orderedStops.map((item) => {
                      const houseAddress = item.stop.address || item.stop.label;
                      const secondaryParts = [
                        item.stop.label && item.stop.label !== houseAddress
                          ? item.stop.label
                          : '',
                        item.stop.notes || '',
                      ].filter(Boolean);

                      return (
                        <tr key={item.stop.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-500 tabular-nums">
                            {item.orderIndex}.
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs font-medium text-slate-900 tabular-nums whitespace-nowrap">
                            {item.arrivalTime} – {item.departureTime}
                          </td>
                          <td className="py-2.5 px-4 font-medium text-slate-900">
                            {houseAddress}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-slate-600">
                            {secondaryParts.length > 0
                              ? secondaryParts.join(' · ')
                              : '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                            {formatDistance(item.legDistanceMeters)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                            {item.stop.durationMinutes} min
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
