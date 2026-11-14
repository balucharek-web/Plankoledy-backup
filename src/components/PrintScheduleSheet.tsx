import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CalendarDays,
  Download,
  ExternalLink,
  Map as MapIcon,
  Printer,
  Route,
} from 'lucide-react';
import {
  DayPlanSummary,
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
} from '../types/parish';
import {
  exportFullSeasonToCsv,
  formatPolishDateChip,
  formatPolishDateFull,
  formatPolishWeekdayFull,
} from '../utils/seasonScheduler';
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
  isExactRoute: boolean;
  plannedDays: DayPlanSummary[];
  unscheduledCount: number;
  selectedDate: string | null;
  effectiveStartTime: string;
  exactDayKeys: Record<string, boolean>;
  onSelectDate: (date: string | null) => void;
  onInspectDay: (date: string) => void;
  onViewDayOnMap: (date: string | null) => void;
  onComputeDayRoute: (date: string | null) => void;
  onBackToMap: () => void;
}

export const PrintScheduleSheet: React.FC<PrintScheduleSheetProps> = ({
  parish,
  config,
  routes,
  isExactRoute,
  plannedDays,
  unscheduledCount,
  selectedDate,
  effectiveStartTime,
  exactDayKeys,
  onSelectDate,
  onInspectDay,
  onViewDayOnMap,
  onComputeDayRoute,
  onBackToMap,
}) => {
  const [viewMode, setViewMode] = useState<'season' | 'day'>(
    plannedDays.length > 0 ? 'season' : 'day'
  );

  const seasonTotals = useMemo(() => {
    const totalHouses = plannedDays.reduce((acc, d) => acc + d.stops.length, 0);
    const totalMeters = plannedDays.reduce(
      (acc, d) => acc + d.totalDistanceMeters,
      0
    );
    const totalVisitMins = plannedDays.reduce(
      (acc, d) => acc + d.totalVisitMinutes,
      0
    );
    const firstDate = plannedDays[0]?.date ?? null;
    const lastDate = plannedDays[plannedDays.length - 1]?.date ?? null;
    return { totalHouses, totalMeters, totalVisitMins, firstDate, lastDate };
  }, [plannedDays]);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-900">
            Harmonogram odwiedzin duszpasterskich
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 tabular-nums">
            {parish ? parish.name : 'Parafia'} · Tryb:{' '}
            {config.travelMode === 'WALKING' ? 'Pieszo' : 'Samochodem'} ·{' '}
            {config.priestCount}{' '}
            {config.priestCount === 1 ? 'ksiądz' : 'księży'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            type="button"
            onClick={onBackToMap}
            className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl"
          >
            Wróć do mapy
          </button>

          {viewMode === 'season' && plannedDays.length > 0 && (
            <button
              type="button"
              onClick={() => exportFullSeasonToCsv(parish, plannedDays)}
              className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              CSV całego okresu
            </button>
          )}

          {viewMode === 'day' && routes.length > 0 && (
            <button
              type="button"
              onClick={() => exportScheduleToCsv(parish, routes)}
              className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Eksportuj CSV dnia
            </button>
          )}

          {(plannedDays.length > 0 || routes.length > 0) && (
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-xl inline-flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" />
              Drukuj
            </button>
          )}
        </div>
      </div>

      {/* View Mode Switcher (Season vs Selected Day) */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="inline-grid grid-cols-2 p-1 bg-slate-200/70 rounded-xl">
          <button
            type="button"
            onClick={() => setViewMode('season')}
            className={`min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors ${
              viewMode === 'season'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5 text-amber-700" />
            Cały okres ({plannedDays.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode('day')}
            className={`min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors ${
              viewMode === 'day'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-slate-600" />
            Wybrany dzień
          </button>
        </div>

        {viewMode === 'day' && plannedDays.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1">
            {plannedDays.map((d) => (
              <button
                key={d.date}
                type="button"
                onClick={() => onSelectDate(d.date)}
                className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 tabular-nums transition-colors ${
                  selectedDate === d.date
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {formatPolishDateChip(d.date)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* WHOLE SEASON VIEW */}
      {viewMode === 'season' ? (
        plannedDays.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 sm:p-10 text-center space-y-2">
            <p className="text-sm font-medium text-slate-800">
              Brak rozpisanych dni kolędy
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Przejdź do sekcji „Układanie planu” i kliknij „Rozpisz całą parafię
              na okres”, aby automatycznie ułożyć wszystkie dni i godziny kolędy.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Season KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 bg-white border border-slate-200 rounded-xl">
                <div className="text-[11px] text-slate-500">Liczba dni kolędy</div>
                <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                  {plannedDays.length}
                </div>
                {seasonTotals.firstDate && seasonTotals.lastDate && (
                  <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                    {formatPolishDateChip(seasonTotals.firstDate)} –{' '}
                    {formatPolishDateChip(seasonTotals.lastDate)}
                  </div>
                )}
              </div>

              <div className="p-3.5 bg-white border border-slate-200 rounded-xl">
                <div className="text-[11px] text-slate-500">Zaplanowane domy</div>
                <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                  {seasonTotals.totalHouses}
                </div>
                <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                  {unscheduledCount > 0
                    ? `Bez terminu: ${unscheduledCount}`
                    : 'Wszystkie przypisane'}
                </div>
              </div>

              <div className="p-3.5 bg-white border border-slate-200 rounded-xl">
                <div className="text-[11px] text-slate-500">Szacowany dystans</div>
                <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                  {formatDistance(seasonTotals.totalMeters)}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Łącznie dla zespołu
                </div>
              </div>

              <div className="p-3.5 bg-white border border-slate-200 rounded-xl">
                <div className="text-[11px] text-slate-500">Czas samych wizyt</div>
                <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                  {formatMinutesLabel(seasonTotals.totalVisitMins)}
                </div>
                <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                  Śr. {config.defaultVisitMinutes} min/dom
                </div>
              </div>
            </div>

            {/* Desktop Full-Season Table */}
            <div className="hidden md:block print:block bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Data</th>
                    <th className="py-3 px-4">Godziny</th>
                    <th className="py-3 px-4">Ulice i rejony</th>
                    <th className="py-3 px-4">Księża</th>
                    <th className="py-3 px-4 text-right">Domy / Dystans</th>
                    <th className="py-3 px-4 text-right no-print">Podgląd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {plannedDays.map((day) => {
                    const isExact = Boolean(exactDayKeys[day.date]);
                    return (
                      <tr key={day.date} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="text-xs font-semibold text-slate-900 tabular-nums">
                            {day.date}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {formatPolishWeekdayFull(day.date)}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {day.startTime} – {day.estimatedEndTime}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-700 max-w-xs">
                          <div className="font-medium text-slate-900">
                            {day.streetNames.join(', ')}
                          </div>
                          {isExact && (
                            <span className="text-[11px] text-emerald-700 font-medium">
                              Dokładna trasa drogowa
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 tabular-nums">
                          {day.estimatedRoutes.map((r) => (
                            <div
                              key={r.priestId}
                              className="flex items-center gap-1.5"
                            >
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: r.color }}
                              />
                              <span>
                                Ks. {r.priestId}: {r.orderedStops.length} (do{' '}
                                {r.endTime})
                              </span>
                            </div>
                          ))}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            {day.stops.length} domów
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {formatDistance(day.totalDistanceMeters)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right no-print whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onViewDayOnMap(day.date)}
                              className="px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1"
                            >
                              <MapIcon className="w-3.5 h-3.5 text-amber-700" />
                              Mapa
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onInspectDay(day.date);
                                setViewMode('day');
                              }}
                              className="px-2.5 py-1.5 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg"
                            >
                              Szczegóły
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Full-Season Cards */}
            <div className="md:hidden print:hidden space-y-3">
              {plannedDays.map((day, idx) => (
                <div
                  key={day.date}
                  className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-mono font-semibold text-amber-800 tabular-nums">
                        Dzień {idx + 1} · {day.date}
                      </div>
                      <div className="text-sm font-semibold text-slate-900 mt-0.5">
                        {formatPolishWeekdayFull(day.date)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-mono font-semibold text-slate-900 tabular-nums">
                        {day.startTime}–{day.estimatedEndTime}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {day.stops.length} domów ·{' '}
                        {formatDistance(day.totalDistanceMeters)}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-slate-700 leading-relaxed">
                    <span className="text-slate-500">Ulice: </span>
                    <span className="font-medium text-slate-900">
                      {day.streetNames.join(', ')}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onViewDayOnMap(day.date)}
                      className="flex-1 min-h-[40px] px-3 py-2 text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center justify-center gap-1.5"
                    >
                      <MapIcon className="w-3.5 h-3.5 text-amber-700" />
                      Zobacz na mapie
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onInspectDay(day.date);
                        setViewMode('day');
                      }}
                      className="flex-1 min-h-[40px] px-3 py-2 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg inline-flex items-center justify-center gap-1.5"
                    >
                      <Route className="w-3.5 h-3.5" />
                      Plan godzinowy
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ) : /* SELECTED DAY VIEW */
      routes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <p className="text-sm font-medium text-slate-800">
            Brak punktów dla wybranego dnia
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Wybierz dzień kolędy powyżej lub zaznacz ulice i kliknij „Wyznacz
            trasy”.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
            <div className="text-xs sm:text-sm text-slate-700 tabular-nums">
              <strong>
                {selectedDate
                  ? formatPolishDateFull(selectedDate)
                  : 'Bieżący wybór ulic'}
              </strong>{' '}
              · Start: {effectiveStartTime} ·{' '}
              <span
                className={
                  isExactRoute
                    ? 'text-emerald-700 font-medium'
                    : 'text-amber-700 font-medium'
                }
              >
                {isExactRoute ? 'Dokładna trasa drogowa' : 'Szacowany rozkład'}
              </span>
            </div>

            <div className="flex items-center gap-2 no-print">
              <button
                type="button"
                onClick={() => onViewDayOnMap(selectedDate)}
                className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5"
              >
                <MapIcon className="w-3.5 h-3.5 text-amber-700" />
                Pokaż trasę na mapie
              </button>
              {!isExactRoute && (
                <button
                  type="button"
                  onClick={() => onComputeDayRoute(selectedDate)}
                  className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg"
                >
                  Wyznacz trasę drogową
                </button>
              )}
            </div>
          </div>

          {routes.map((route) => (
            <section
              key={route.priestId}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden"
            >
              <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
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
                      <th className="py-2.5 px-3 sm:px-4 w-12">Lp.</th>
                      <th className="py-2.5 px-3 sm:px-4">Godziny</th>
                      <th className="py-2.5 px-3 sm:px-4">Adres domu</th>
                      <th className="py-2.5 px-3 sm:px-4 hidden sm:table-cell print:table-cell">
                        Rodzina / Uwagi
                      </th>
                      <th className="py-2.5 px-3 sm:px-4 text-right hidden sm:table-cell print:table-cell">
                        Dojazd
                      </th>
                      <th className="py-2.5 px-3 sm:px-4 text-right">Wizyta</th>
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
                          <td className="py-2.5 px-3 sm:px-4 font-mono text-xs text-slate-500 tabular-nums">
                            {item.orderIndex}.
                          </td>
                          <td className="py-2.5 px-3 sm:px-4 font-mono text-xs font-medium text-slate-900 tabular-nums whitespace-nowrap">
                            {item.arrivalTime}–{item.departureTime}
                          </td>
                          <td className="py-2.5 px-3 sm:px-4 text-xs sm:text-sm font-medium text-slate-900">
                            <div>{houseAddress}</div>
                            {secondaryParts.length > 0 && (
                              <div className="sm:hidden text-[11px] font-normal text-slate-500 mt-0.5">
                                {secondaryParts.join(' · ')}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 sm:px-4 text-xs text-slate-600 hidden sm:table-cell print:table-cell">
                            {secondaryParts.length > 0
                              ? secondaryParts.join(' · ')
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3 sm:px-4 text-right font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap hidden sm:table-cell print:table-cell">
                            {formatDistance(item.legDistanceMeters)}
                          </td>
                          <td className="py-2.5 px-3 sm:px-4 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
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
