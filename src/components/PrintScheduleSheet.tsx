import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Map as MapIcon,
  Megaphone,
  Navigation,
  Pencil,
  Printer,
  RotateCcw,
  Route,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  DayPlanSummary,
  LatLng,
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
  SeasonPlanConfig,
  VisitStop,
} from '../types/parish';
import { PrintableRouteMap } from './PrintableRouteMap';
import {
  WEEKDAY_OPTIONS,
  addDaysToIsoDate,
  buildAnnouncementDays,
  collectReturnVisitCandidates,
  exportFullSeasonToCsv,
  formatAnnouncementsPlainText,
  formatPolishDateChip,
  formatPolishDateFull,
  formatPolishWeekdayFull,
  parseWeekdaysMask,
  toggleWeekdayInMask,
} from '../utils/seasonScheduler';
import {
  buildGoogleMapsStageUrls,
  exportScheduleToCsv,
  extractStreetName,
  formatDistance,
  formatDurationMillis,
  formatMinutesLabel,
} from '../utils/spatial';

interface PrintScheduleSheetProps {
  parish: ParishCenter | null;
  boundary?: LatLng[];
  stops?: VisitStop[];
  config: PlanConfig;
  seasonConfig?: SeasonPlanConfig;
  routes: PriestRouteResult[];
  isExactRoute: boolean;
  plannedDays: DayPlanSummary[];
  unscheduledCount: number;
  selectedDate: string | null;
  effectiveStartTime: string;
  effectiveEndTime?: string;
  exactDayKeys: Record<string, boolean>;
  onSelectDate: (date: string | null) => void;
  onInspectDay: (date: string) => void;
  onViewDayOnMap: (date: string | null) => void;
  onComputeDayRoute: (date: string | null) => void;
  onBackToMap: () => void;
  onChangeSeasonConfig?: (next: SeasonPlanConfig) => void;
  onAutoScheduleSeason?: (targetMode: 'all' | 'unscheduled') => void;
  onClearAllDates?: () => void;
  onUpdateDayTimeWindow?: (
    date: string,
    startTime: string,
    endTime: string
  ) => void;
  onScheduleReturnVisits?: (targetDate: string) => void;
  onGoToDayPlanner?: () => void;
  onEditDayInPlanner?: (date: string) => void;
  onDeleteDayRoute?: (date: string) => void;
  forcedViewMode?: 'season' | 'day' | 'announcements';
}

export const PrintScheduleSheet: React.FC<PrintScheduleSheetProps> = ({
  parish,
  boundary = [],
  stops = [],
  config,
  seasonConfig,
  routes,
  isExactRoute,
  plannedDays,
  unscheduledCount,
  selectedDate,
  effectiveStartTime,
  effectiveEndTime,
  exactDayKeys,
  onSelectDate,
  onInspectDay,
  onViewDayOnMap,
  onComputeDayRoute,
  onBackToMap,
  onChangeSeasonConfig,
  onAutoScheduleSeason,
  onClearAllDates,
  onUpdateDayTimeWindow,
  onScheduleReturnVisits,
  onGoToDayPlanner,
  onEditDayInPlanner,
  onDeleteDayRoute,
  forcedViewMode,
}) => {
  const [viewMode, setViewMode] = useState<'season' | 'day' | 'announcements'>(
    'season'
  );
  const [copiedAnnouncements, setCopiedAnnouncements] = useState(false);
  const [openGmapsMenuPriest, setOpenGmapsMenuPriest] = useState<number | null>(
    null
  );
  const [showAutoScheduler, setShowAutoScheduler] = useState<boolean>(false);
  const [editingHoursDate, setEditingHoursDate] = useState<string | null>(null);
  const [editingHoursStart, setEditingHoursStart] = useState<string>('15:30');
  const [editingHoursEnd, setEditingHoursEnd] = useState<string>('20:30');
  const [returnVisitDate, setReturnVisitDate] = useState<string>('');

  const effectiveViewMode = forcedViewMode ?? viewMode;

  const activeWeekdaysSet = useMemo(
    () => parseWeekdaysMask(seasonConfig?.weekdaysMask ?? '1,2,3,4,5,6'),
    [seasonConfig?.weekdaysMask]
  );

  const returnCandidates = useMemo(
    () => collectReturnVisitCandidates(stops),
    [stops]
  );

  const defaultReturnDate = useMemo(() => {
    const lastPlanned = plannedDays[plannedDays.length - 1]?.date;
    return addDaysToIsoDate(
      lastPlanned || seasonConfig?.startDate || '2026-12-28',
      1
    );
  }, [plannedDays, seasonConfig?.startDate]);

  const effectiveReturnDate = returnVisitDate || defaultReturnDate;

  const announcementDays = useMemo(
    () => buildAnnouncementDays(plannedDays),
    [plannedDays]
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

  const handleCopyAnnouncements = async () => {
    const text = formatAnnouncementsPlainText(parish, plannedDays);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAnnouncements(true);
      window.setTimeout(() => setCopiedAnnouncements(false), 2600);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const handlePrintNow = () => {
    const imgs = Array.from(
      document.querySelectorAll<HTMLImageElement>('img[data-print-map-tile="true"]')
    );
    const pending = imgs.filter((img) => !img.complete);
    if (pending.length === 0) {
      window.print();
      return;
    }

    let printed = false;
    const finish = () => {
      if (printed) return;
      printed = true;
      window.print();
    };

    const timer = window.setTimeout(finish, 900);
    let remaining = pending.length;
    const onDone = () => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearTimeout(timer);
        finish();
      }
    };
    pending.forEach((img) => {
      img.addEventListener('load', onDone, { once: true });
      img.addEventListener('error', onDone, { once: true });
    });
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 md:p-8 print:px-1.5 print:py-0 print:max-w-none space-y-6 print:space-y-3">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5 print:pb-2.5">
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

          {effectiveViewMode === 'season' && plannedDays.length > 0 && (
            <button
              type="button"
              onClick={() => exportFullSeasonToCsv(parish, plannedDays)}
              className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              CSV całego okresu
            </button>
          )}

          {effectiveViewMode === 'day' && routes.length > 0 && (
            <button
              type="button"
              onClick={() => exportScheduleToCsv(parish, routes)}
              className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Eksportuj CSV dnia
            </button>
          )}

          {effectiveViewMode === 'announcements' && plannedDays.length > 0 && (
            <button
              type="button"
              onClick={() => void handleCopyAnnouncements()}
              className={`min-h-[40px] px-3.5 py-2 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 border transition-colors ${
                copiedAnnouncements
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'
              }`}
            >
              {copiedAnnouncements ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>
                {copiedAnnouncements ? 'Skopiowano!' : 'Kopiuj tekst ogłoszeń'}
              </span>
            </button>
          )}

          {(plannedDays.length > 0 || routes.length > 0) && (
            <button
              type="button"
              onClick={handlePrintNow}
              className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-xl inline-flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" />
              Drukuj
            </button>
          )}
        </div>
      </div>

      {/* View Mode Switcher (Season vs Selected Day vs Announcements) */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="inline-grid grid-cols-3 p-1 bg-slate-200/70 rounded-xl w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setViewMode('season')}
            className={`min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors ${
              viewMode === 'season'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span className="truncate">Cały okres ({plannedDays.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('day')}
            className={`min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors ${
              viewMode === 'day'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            <span className="truncate">Wydruk dnia</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('announcements')}
            className={`min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors ${
              viewMode === 'announcements'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Megaphone className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span className="truncate">Ogłoszenia</span>
          </button>
        </div>

        {effectiveViewMode === 'day' && plannedDays.length > 0 && (
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
      {effectiveViewMode === 'season' ? (
        <div className="space-y-5">
          {/* Season Planning Action Bar */}
          {(onGoToDayPlanner || (seasonConfig && onAutoScheduleSeason)) && (
            <div className="no-print bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {onGoToDayPlanner && (
                    <button
                      type="button"
                      onClick={onGoToDayPlanner}
                      className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center gap-1.5 transition-colors"
                    >
                      <CalendarPlus className="w-4 h-4" />
                      <span>Zaplanuj konkretny dzień</span>
                    </button>
                  )}

                  {seasonConfig && onAutoScheduleSeason && (
                    <button
                      type="button"
                      onClick={() => setShowAutoScheduler((v) => !v)}
                      className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Sparkles className="w-4 h-4 text-amber-700" />
                      <span>Rozpisz automatycznie cały okres</span>
                      {showAutoScheduler ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                      )}
                    </button>
                  )}
                </div>

                {plannedDays.length > 0 && onClearAllDates && (
                  <button
                    type="button"
                    onClick={onClearAllDates}
                    className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Usuń wszystkie trasy</span>
                  </button>
                )}
              </div>

              {(showAutoScheduler || plannedDays.length === 0) &&
                seasonConfig &&
                onChangeSeasonConfig &&
                onAutoScheduleSeason && (
                  <div className="pt-3 border-t border-slate-200 space-y-3">
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Automatyczny generator ułoży wszystkie ulice parafii w
                      kolejne dni kolędy według wybranych godzin i dni tygodnia
                      (dla {config.priestCount}{' '}
                      {config.priestCount === 1 ? 'księdza' : 'księży'}).
                    </p>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div>
                        <label
                          htmlFor="season-start-date-hub"
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          Pierwszy dzień
                        </label>
                        <input
                          id="season-start-date-hub"
                          type="date"
                          value={seasonConfig.startDate}
                          onChange={(e) =>
                            onChangeSeasonConfig({
                              ...seasonConfig,
                              startDate: e.target.value,
                            })
                          }
                          className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-amber-600"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="season-daily-end-hub"
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          Koniec dnia do
                        </label>
                        <input
                          id="season-daily-end-hub"
                          type="time"
                          value={seasonConfig.dailyEndTime}
                          onChange={(e) =>
                            onChangeSeasonConfig({
                              ...seasonConfig,
                              dailyEndTime: e.target.value,
                            })
                          }
                          className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-amber-600"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="season-weekday-start-hub"
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          Start (robocze)
                        </label>
                        <input
                          id="season-weekday-start-hub"
                          type="time"
                          value={seasonConfig.weekdayStartTime}
                          onChange={(e) =>
                            onChangeSeasonConfig({
                              ...seasonConfig,
                              weekdayStartTime: e.target.value,
                            })
                          }
                          className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-amber-600"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="season-weekend-start-hub"
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          Start (sob./nd.)
                        </label>
                        <input
                          id="season-weekend-start-hub"
                          type="time"
                          value={seasonConfig.weekendStartTime}
                          onChange={(e) =>
                            onChangeSeasonConfig({
                              ...seasonConfig,
                              weekendStartTime: e.target.value,
                            })
                          }
                          className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-amber-600"
                        />
                      </div>
                    </div>

                    <div>
                      <span className="block text-[11px] font-medium text-slate-600 mb-1.5">
                        Dni tygodnia z kolędą
                      </span>
                      <div className="grid grid-cols-7 gap-1.5">
                        {WEEKDAY_OPTIONS.map((opt) => {
                          const checked = activeWeekdaysSet.has(opt.dayIndex);
                          return (
                            <button
                              key={opt.dayIndex}
                              type="button"
                              onClick={() =>
                                onChangeSeasonConfig({
                                  ...seasonConfig,
                                  weekdaysMask: toggleWeekdayInMask(
                                    seasonConfig.weekdaysMask,
                                    opt.dayIndex
                                  ),
                                })
                              }
                              aria-pressed={checked}
                              title={opt.full}
                              className={`min-h-[38px] rounded-xl text-xs font-semibold transition-colors ${
                                checked
                                  ? 'bg-slate-900 text-white'
                                  : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              {opt.short}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!parish}
                        onClick={() => {
                          onAutoScheduleSeason('all');
                          setShowAutoScheduler(false);
                        }}
                        className="min-h-[42px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        <span>
                          {plannedDays.length > 0
                            ? 'Przeplanuj całą parafię od nowa'
                            : 'Rozpisz automatycznie całą parafię'}
                        </span>
                      </button>

                      {plannedDays.length > 0 && unscheduledCount > 0 && (
                        <button
                          type="button"
                          disabled={!parish}
                          onClick={() => {
                            onAutoScheduleSeason('unscheduled');
                            setShowAutoScheduler(false);
                          }}
                          className="min-h-[42px] px-4 py-2 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
                        >
                          Dopisuj brakujące ({unscheduledCount})
                        </button>
                      )}
                    </div>
                  </div>
                )}
            </div>
          )}

          {/* Return Visits Card */}
          {returnCandidates.length > 0 && onScheduleReturnVisits && (
            <div className="no-print bg-amber-50/80 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <RotateCcw className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xs font-semibold text-amber-950">
                    Powroty i kolęda na zaproszenie ({returnCandidates.length})
                  </h3>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    Domy/lokale oznaczone jako „Nieobecni” lub „Zaproszenie” —
                    wyznacz dla nich osobny dzień dodatkowy.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <input
                  type="date"
                  value={effectiveReturnDate}
                  onChange={(e) => setReturnVisitDate(e.target.value)}
                  aria-label="Data dnia powrotów"
                  className="min-h-[38px] px-2.5 py-1 text-base sm:text-xs font-mono tabular-nums bg-white border border-amber-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                />
                <button
                  type="button"
                  disabled={!effectiveReturnDate}
                  onClick={() => onScheduleReturnVisits(effectiveReturnDate)}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Zaplanuj powroty</span>
                </button>
              </div>
            </div>
          )}

          {plannedDays.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 sm:p-10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-800">
                Brak zaplanowanych dni kolędy
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Kliknij „Zaplanuj konkretny dzień” powyżej, aby wybrać pojedynczą
                datę i ulice, albo użyj automatycznego rozpisania całego okresu.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Unscheduled houses quick info */}
              {unscheduledCount > 0 && (
                <div className="no-print bg-amber-50/70 border border-amber-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950">
                  <span className="tabular-nums">
                    Pozostało <strong>{unscheduledCount}</strong>{' '}
                    {unscheduledCount === 1
                      ? 'dom bez wyznaczonej daty'
                      : 'domów bez wyznaczonej daty'}
                    .
                  </span>
                  {onGoToDayPlanner && (
                    <button
                      type="button"
                      onClick={onGoToDayPlanner}
                      className="font-semibold text-amber-800 hover:underline whitespace-nowrap"
                    >
                      + Zaplanuj kolejny dzień →
                    </button>
                  )}
                </div>
              )}

              {/* Season KPI strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-white border border-slate-200 rounded-xl">
                  <div className="text-[11px] text-slate-500">
                    Liczba dni kolędy
                  </div>
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
                  <div className="text-[11px] text-slate-500">
                    Zaplanowane domy
                  </div>
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
                  <div className="text-[11px] text-slate-500">
                    Szacowany dystans
                  </div>
                  <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                    {formatDistance(seasonTotals.totalMeters)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Łącznie dla zespołu
                  </div>
                </div>

                <div className="p-3.5 bg-white border border-slate-200 rounded-xl">
                  <div className="text-[11px] text-slate-500">
                    Czas samych wizyt
                  </div>
                  <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                    {formatMinutesLabel(seasonTotals.totalVisitMins)}
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                    Śr. {config.defaultVisitMinutes} min/dom
                  </div>
                </div>
              </div>

              {/* Desktop Full-Season Table */}
              <div className="hidden md:block print:block bg-white border border-slate-200 rounded-xl overflow-hidden print:overflow-visible print:border-slate-300">
                <table className="w-full text-left border-collapse text-sm print:text-[11px] print:table-fixed">
                  <colgroup>
                    <col className="w-[104px] print:w-[88px]" />
                    <col className="w-[106px] print:w-[86px]" />
                    <col />
                    <col className="w-[160px] print:w-[126px]" />
                    <col className="w-[110px] print:w-[86px]" />
                    <col className="w-[116px] no-print" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4 print:py-1.5 print:px-2">Data</th>
                      <th className="py-3 px-4 print:py-1.5 print:px-2">Godziny</th>
                      <th className="py-3 px-4 print:py-1.5 print:px-2">Ulice i rejony</th>
                      <th className="py-3 px-4 print:py-1.5 print:px-2">Księża</th>
                      <th className="py-3 px-4 print:py-1.5 print:px-2 text-right">Domy / Dystans</th>
                      <th className="py-3 px-4 text-right no-print">Akcje</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plannedDays.map((day) => {
                      const isExact = Boolean(exactDayKeys[day.date]);
                      const isEditingHours = editingHoursDate === day.date;
                      return (
                        <React.Fragment key={day.date}>
                          <tr className="hover:bg-slate-50/60">
                            <td className="py-3 px-4 print:py-1.5 print:px-2 whitespace-nowrap print:whitespace-normal align-top">
                              <div className="text-xs font-semibold text-slate-900 tabular-nums">
                                {day.date}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {formatPolishWeekdayFull(day.date)}
                              </div>
                            </td>
                            <td className="py-3 px-4 print:py-1.5 print:px-2 font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap print:whitespace-normal align-top">
                              <div>
                                {day.startTime} – {day.estimatedEndTime}
                              </div>
                              {onUpdateDayTimeWindow && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isEditingHours) {
                                      setEditingHoursDate(null);
                                    } else {
                                      setEditingHoursStart(day.startTime);
                                      setEditingHoursEnd(
                                        day.plannedEndTime ||
                                          seasonConfig?.dailyEndTime ||
                                          '20:30'
                                      );
                                      setEditingHoursDate(day.date);
                                    }
                                  }}
                                  className="no-print mt-0.5 text-[11px] font-sans font-medium text-amber-800 hover:underline inline-flex items-center gap-1"
                                >
                                  <Clock className="w-3 h-3" />
                                  Zmień
                                </button>
                              )}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-700 max-w-xs print:max-w-none print:py-1.5 print:px-2 align-top break-words">
                              <div className="font-medium text-slate-900">
                                {day.streetNames.join(', ')}
                              </div>
                              {isExact && (
                                <span className="text-[11px] text-emerald-700 font-medium">
                                  Dokładna trasa drogowa
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-600 tabular-nums print:py-1.5 print:px-2 align-top">
                              {day.estimatedRoutes.map((r) => (
                                <div
                                  key={r.priestId}
                                  className="flex items-center gap-1.5 whitespace-nowrap print:whitespace-normal"
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
                            <td className="py-3 px-4 print:py-1.5 print:px-2 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap print:whitespace-normal align-top">
                              <div className="font-semibold text-slate-900">
                                {day.stops.length} domów
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {formatDistance(day.totalDistanceMeters)}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right no-print whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                {onEditDayInPlanner && (
                                  <button
                                    type="button"
                                    onClick={() => onEditDayInPlanner(day.date)}
                                    className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1"
                                  >
                                    <Pencil className="w-3 h-3 text-slate-500" />
                                    Edytuj
                                  </button>
                                )}
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
                                  className="px-2.5 py-1.5 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg inline-flex items-center gap-1"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                  Wydruk
                                </button>
                                {onDeleteDayRoute && (
                                  <button
                                    type="button"
                                    onClick={() => onDeleteDayRoute(day.date)}
                                    title="Usuń trasę tego dnia"
                                    aria-label={`Usuń trasę z dnia ${day.date}`}
                                    className="px-2 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg inline-flex items-center gap-1"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isEditingHours && onUpdateDayTimeWindow && (
                            <tr className="no-print bg-slate-50">
                              <td colSpan={6} className="px-4 py-2.5">
                                <div className="flex flex-wrap items-center gap-2.5 text-xs">
                                  <span className="font-semibold text-slate-700">
                                    Godziny dla {day.date}:
                                  </span>
                                  <label className="inline-flex items-center gap-1.5">
                                    <span className="text-slate-500">Od</span>
                                    <input
                                      type="time"
                                      value={editingHoursStart}
                                      onChange={(e) =>
                                        setEditingHoursStart(e.target.value)
                                      }
                                      className="min-h-[34px] px-2 py-1 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                                    />
                                  </label>
                                  <label className="inline-flex items-center gap-1.5">
                                    <span className="text-slate-500">Do</span>
                                    <input
                                      type="time"
                                      value={editingHoursEnd}
                                      onChange={(e) =>
                                        setEditingHoursEnd(e.target.value)
                                      }
                                      className="min-h-[34px] px-2 py-1 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onUpdateDayTimeWindow(
                                        day.date,
                                        editingHoursStart,
                                        editingHoursEnd
                                      );
                                      setEditingHoursDate(null);
                                    }}
                                    className="min-h-[34px] px-3 py-1 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg"
                                  >
                                    Zapisz
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingHoursDate(null)}
                                    className="min-h-[34px] px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800"
                                  >
                                    Anuluj
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Full-Season Cards */}
              <div className="md:hidden print:hidden space-y-3">
                {plannedDays.map((day, idx) => {
                  const isEditingHours = editingHoursDate === day.date;
                  return (
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

                      {isEditingHours && onUpdateDayTimeWindow && (
                        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                Od
                              </label>
                              <input
                                type="time"
                                value={editingHoursStart}
                                onChange={(e) =>
                                  setEditingHoursStart(e.target.value)
                                }
                                className="w-full min-h-[38px] px-2 py-1 text-base font-mono bg-white border border-slate-200 rounded-lg"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                Do
                              </label>
                              <input
                                type="time"
                                value={editingHoursEnd}
                                onChange={(e) =>
                                  setEditingHoursEnd(e.target.value)
                                }
                                className="w-full min-h-[38px] px-2 py-1 text-base font-mono bg-white border border-slate-200 rounded-lg"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                onUpdateDayTimeWindow(
                                  day.date,
                                  editingHoursStart,
                                  editingHoursEnd
                                );
                                setEditingHoursDate(null);
                              }}
                              className="flex-1 min-h-[36px] px-3 py-1 text-xs font-semibold text-white bg-amber-700 rounded-lg"
                            >
                              Zapisz godziny
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingHoursDate(null)}
                              className="min-h-[36px] px-3 py-1 text-xs text-slate-600"
                            >
                              Anuluj
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                        {onEditDayInPlanner && (
                          <button
                            type="button"
                            onClick={() => onEditDayInPlanner(day.date)}
                            className="min-h-[40px] px-2.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center justify-center gap-1"
                          >
                            <Pencil className="w-3.5 h-3.5 text-slate-500" />
                            Edytuj ulice
                          </button>
                        )}
                        {onUpdateDayTimeWindow && (
                          <button
                            type="button"
                            onClick={() => {
                              if (isEditingHours) {
                                setEditingHoursDate(null);
                              } else {
                                setEditingHoursStart(day.startTime);
                                setEditingHoursEnd(
                                  day.plannedEndTime ||
                                    seasonConfig?.dailyEndTime ||
                                    '20:30'
                                );
                                setEditingHoursDate(day.date);
                              }
                            }}
                            className="min-h-[40px] px-2.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center justify-center gap-1"
                          >
                            <Clock className="w-3.5 h-3.5 text-slate-500" />
                            Godziny
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onViewDayOnMap(day.date)}
                          className="min-h-[40px] px-2.5 py-2 text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center justify-center gap-1"
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
                          className="min-h-[40px] px-2.5 py-2 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg inline-flex items-center justify-center gap-1"
                        >
                          <Route className="w-3.5 h-3.5" />
                          Wydruk
                        </button>
                      </div>
                      {onDeleteDayRoute && (
                        <button
                          type="button"
                          onClick={() => onDeleteDayRoute(day.date)}
                          className="w-full min-h-[38px] px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50/70 hover:bg-red-100 border border-red-200 rounded-lg inline-flex items-center justify-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Usuń trasę tego dnia
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : effectiveViewMode === 'announcements' ? (
        /* PARISH BULLETIN ANNOUNCEMENTS VIEW (RODO-SAFE) */
        announcementDays.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
            <p className="text-sm font-medium text-slate-800">
              Brak rozpisanych dni kolędy do ogłoszeń
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Najpierw rozpisz okres kolędowy na dni, aby wygenerować gotowe
              ogłoszenia duszpasterskie do gabloty i na stronę parafii.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-7 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  Plan odwiedzin duszpasterskich — ogłoszenia parafialne
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Zestawienie zgodne z RODO — zawiera wyłącznie daty, godziny
                  rozpoczęcia, nazwy ulic oraz przedziały numerów budynków (bez
                  nazwisk).
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyAnnouncements()}
                className="no-print min-h-[38px] px-3.5 py-2 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl inline-flex items-center gap-1.5 shrink-0"
              >
                {copiedAnnouncements ? (
                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>
                  {copiedAnnouncements
                    ? 'Skopiowano do schowka'
                    : 'Kopiuj gotowy tekst'}
                </span>
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {announcementDays.map((item) => (
                <div key={item.date} className="py-3.5 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {item.fullDateLabel}
                    </span>
                    <span className="text-xs font-mono font-semibold text-amber-800 tabular-nums">
                      od godz. {item.startTime}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                    {item.streets
                      .map((s) =>
                        s.rangeLabel
                          ? `${s.streetName} (${s.rangeLabel})`
                          : s.streetName
                      )
                      .join('; ')}
                  </p>
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
        <div className="space-y-6 print:space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 print:px-3 print:py-2 print:border-slate-300 print-break-avoid">
            <div className="text-xs sm:text-sm text-slate-700 tabular-nums space-y-0.5">
              <div>
                <strong className="text-slate-900">
                  {selectedDate
                    ? formatPolishDateFull(selectedDate)
                    : 'Bieżący wybór ulic'}
                </strong>{' '}
                · Godziny:{' '}
                <strong className="font-mono text-slate-900">
                  {effectiveStartTime}
                  {effectiveEndTime ? `–${effectiveEndTime}` : ''}
                </strong>
              </div>
              <div className="text-xs text-slate-500">
                Ulice:{' '}
                <strong className="text-slate-800">
                  {Array.from(
                    new Set(
                      routes.flatMap((r) =>
                        r.orderedStops.map((s) => extractStreetName(s.stop))
                      )
                    )
                  ).join(', ') || '—'}
                </strong>{' '}
                ·{' '}
                <span
                  className={
                    isExactRoute
                      ? 'text-emerald-700 font-medium'
                      : 'text-amber-700 font-medium'
                  }
                >
                  {isExactRoute ? 'Dokładna trasa drogowa' : 'Trasa kolędowa'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 no-print">
              <button
                type="button"
                onClick={() => onViewDayOnMap(selectedDate)}
                className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5"
              >
                <MapIcon className="w-3.5 h-3.5 text-amber-700" />
                Pokaż na mapie
              </button>
              {!isExactRoute && (
                <button
                  type="button"
                  onClick={() => onComputeDayRoute(selectedDate)}
                  className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg"
                >
                  Wyznacz po ulicach
                </button>
              )}
              <button
                type="button"
                onClick={handlePrintNow}
                className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                Drukuj / PDF
              </button>
            </div>
          </div>

          {/* Printable Vector + OSM Tile Route Map */}
          <PrintableRouteMap
            parish={parish}
            boundary={boundary}
            routes={routes}
            isExactRoute={isExactRoute}
            title={
              selectedDate
                ? `Mapa trasy kolędy · ${formatPolishDateFull(selectedDate)}`
                : 'Mapa trasy kolędy (START i kolejne domy)'
            }
          />

          {routes.map((route) => {
            const firstItem = route.orderedStops[0];
            const routeStreets = Array.from(
              new Set(route.orderedStops.map((s) => extractStreetName(s.stop)))
            );
            const gmapsStages =
              parish && route.orderedStops.length > 0
                ? buildGoogleMapsStageUrls(
                    parish,
                    route.orderedStops.map((s) => s.stop),
                    config.returnToParish,
                    config.travelMode
                  )
                : [];
            const gmapsOpen = openGmapsMenuPriest === route.priestId;

            return (
              <section
                key={route.priestId}
                className="print-break-before-page bg-white border border-slate-200 rounded-xl overflow-hidden print:overflow-visible print:border-slate-300"
              >
                <div className="px-4 sm:px-5 py-3.5 print:px-3 print:py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 print-break-after-avoid">
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: route.color }}
                      />
                      <h2 className="text-base print:text-sm font-semibold text-slate-900">
                        Lista domów — {route.priestName}
                        {selectedDate
                          ? ` · ${formatPolishDateFull(selectedDate)}`
                          : ''}
                      </h2>
                      <span className="text-xs font-mono text-slate-600 tabular-nums">
                        ({route.orderedStops.length}{' '}
                        {route.orderedStops.length === 1
                          ? 'punkt'
                          : route.orderedStops.length < 5
                            ? 'punkty'
                            : 'punktów'}
                        )
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 tabular-nums">
                      {firstItem && (
                        <>
                          <span className="font-semibold text-emerald-800">
                            START: {firstItem.stop.address || firstItem.stop.label}
                          </span>{' '}
                          ·{' '}
                        </>
                      )}
                      Ulice: {routeStreets.join(', ')} · Dystans:{' '}
                      {formatDistance(route.totalDistanceMeters)} · Przejście:{' '}
                      {formatDurationMillis(route.totalTravelDurationMillis)} ·
                      Wizyty: {formatMinutesLabel(route.totalVisitMinutes)} ·
                      Koniec ok. {route.endTime}
                    </p>
                  </div>

                  {gmapsStages.length > 0 && (
                    <div className="no-print">
                      {gmapsStages.length === 1 ? (
                        <a
                          href={gmapsStages[0].url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg inline-flex items-center gap-1"
                        >
                          <Navigation className="w-3 h-3" />
                          <span>Nawiguj w Google Maps</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenGmapsMenuPriest(gmapsOpen ? null : route.priestId)
                          }
                          className="px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg inline-flex items-center gap-1"
                        >
                          <Navigation className="w-3 h-3" />
                          <span>Nawiguj w Google Maps</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {gmapsOpen && gmapsStages.length > 1 && (
                  <div className="no-print px-4 sm:px-5 py-2.5 bg-amber-50/70 border-b border-amber-200 space-y-1.5">
                    <p className="text-[11px] text-amber-900">
                      Zewnętrzna aplikacja Google Maps przyjmuje maksymalnie 10
                      punktów na jeden link nawigacji (tutaj na mapie i liście masz
                      jedną pełną trasę bez podziału):
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {gmapsStages.map((st) => (
                        <a
                          key={st.stageIndex}
                          href={st.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 text-xs font-medium text-amber-900 bg-white hover:bg-amber-100 border border-amber-200 rounded-lg inline-flex items-center gap-1"
                        >
                          <span>
                            {st.isReturnLeg
                              ? 'Powrót pod kościół'
                              : `Odcinek nawigacji ${st.startStopNumber}–${st.endStopNumber}`}
                          </span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto print:overflow-visible">
                  <table className="w-full text-left border-collapse text-sm print:text-xs print:table-fixed">
                    <colgroup>
                      <col className="w-[30px] print:w-[24px]" />
                      <col className="w-[42px] print:w-[34px]" />
                      <col className="w-[54px] print:w-[46px]" />
                      <col />
                      <col className="hidden sm:table-cell print:table-cell w-[28%] print:w-[27%]" />
                      <col className="w-[56px] print:w-[46px]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/50 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 print:py-1.5 px-2 print:px-1 text-center whitespace-nowrap">
                          ✓
                        </th>
                        <th className="py-2.5 print:py-1.5 px-2 print:px-1 whitespace-nowrap">
                          Nr
                        </th>
                        <th className="py-2.5 print:py-1.5 px-2 print:px-1 whitespace-nowrap">
                          Godz.
                        </th>
                        <th className="py-2.5 print:py-1.5 px-2.5 print:px-1.5">
                          Adres domu
                        </th>
                        <th className="py-2.5 print:py-1.5 px-2.5 print:px-1.5 hidden sm:table-cell print:table-cell">
                          Rodzina / Notatki w terenie
                        </th>
                        <th className="py-2.5 print:py-1.5 px-2.5 print:px-1.5 text-right whitespace-nowrap">
                          Czas
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 print:divide-slate-200">
                      {route.orderedStops.map((item, idx) => {
                        const houseAddress = item.stop.address || item.stop.label;
                        const isStart = idx === 0;
                        const isBlock = Boolean(
                          item.stop.isMultiUnit ||
                            (item.stop.units && item.stop.units.length > 0)
                        );
                        const unitsTotal =
                          item.stop.units?.length || item.stop.unitsCount || 0;
                        const blockLabel = isBlock
                          ? `Blok${unitsTotal > 0 ? ` (${unitsTotal} lok.)` : ''}`
                          : '';
                        const normalizedAddr = houseAddress
                          .trim()
                          .toLowerCase();
                        const normalizedLabel = (item.stop.label ?? '')
                          .trim()
                          .toLowerCase();
                        const labelDuplicatesAddress =
                          !normalizedLabel ||
                          normalizedLabel === normalizedAddr ||
                          normalizedAddr.startsWith(normalizedLabel);
                        const secondaryParts = [
                          !labelDuplicatesAddress ? item.stop.label : '',
                          item.stop.notes || '',
                        ].filter(Boolean);

                        const unitsSummary =
                          item.stop.units && item.stop.units.length > 0
                            ? item.stop.units
                                .map(
                                  (u) =>
                                    `${u.staircase ? `kl. ${u.staircase} ` : ''}m. ${u.unitNumber}${
                                      u.familyName ? ` (${u.familyName})` : ''
                                    }`
                                )
                                .join(', ')
                            : '';

                        return (
                          <tr
                            key={item.stop.id}
                            className={
                              isStart
                                ? 'bg-emerald-50/40'
                                : 'hover:bg-slate-50/60'
                            }
                          >
                            <td className="py-2 print:py-1.5 px-2 print:px-1 text-center align-top whitespace-nowrap">
                              <span
                                aria-hidden="true"
                                className="inline-block w-4 h-4 mt-0.5 rounded border border-slate-400 bg-white"
                              />
                            </td>
                            <td className="py-2 print:py-1.5 px-2 print:px-1 align-top whitespace-nowrap">
                              <span
                                className={`w-5 h-5 text-[11px] font-mono font-bold text-white inline-flex items-center justify-center shrink-0 tabular-nums ${
                                  isBlock ? 'rounded-md' : 'rounded-full'
                                }`}
                                style={{
                                  backgroundColor: isStart
                                    ? '#15803D'
                                    : route.color,
                                }}
                              >
                                {item.orderIndex}
                              </span>
                            </td>
                            <td className="py-2 print:py-1.5 px-2 print:px-1 font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap align-top">
                              {item.arrivalTime}
                            </td>
                            <td className="py-2 print:py-1.5 px-2.5 print:px-1.5 text-xs sm:text-sm print:text-xs font-semibold text-slate-900 align-top leading-snug">
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                {isStart && (
                                  <span className="px-1 py-0.5 rounded bg-emerald-700 text-white text-[9px] font-extrabold uppercase tracking-wide whitespace-nowrap">
                                    START
                                  </span>
                                )}
                                <span>{houseAddress}</span>
                                {isBlock && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-semibold tabular-nums whitespace-nowrap">
                                    {blockLabel}
                                  </span>
                                )}
                              </div>
                              {unitsSummary && (
                                <div className="text-[11px] font-normal text-slate-600 mt-0.5 leading-snug">
                                  Lokale: {unitsSummary}
                                </div>
                              )}
                              {secondaryParts.length > 0 && (
                                <div className="sm:hidden print:hidden text-[11px] font-normal text-slate-500 mt-0.5">
                                  {secondaryParts.join(' · ')}
                                </div>
                              )}
                            </td>
                            <td className="py-2 print:py-1.5 px-2.5 print:px-1.5 text-xs text-slate-600 hidden sm:table-cell print:table-cell align-top leading-snug">
                              {secondaryParts.length > 0 ? (
                                <span>{secondaryParts.join(' · ')}</span>
                              ) : (
                                <div
                                  aria-hidden="true"
                                  className="h-4 border-b border-dotted border-slate-300 w-full"
                                />
                              )}
                            </td>
                            <td className="py-2 print:py-1.5 px-2.5 print:px-1.5 text-right font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap align-top">
                              {item.stop.durationMinutes} min
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
