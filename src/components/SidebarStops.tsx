import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  CalendarPlus,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Map as MapIcon,
  MapPin,
  Plus,
  Route,
  Search,
  Sparkles,
  Split,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  DayPlanSummary,
  LatLng,
  PRIEST_PALETTE,
  ParishCenter,
  PlanConfig,
  SeasonPlanConfig,
  VisitStop,
} from '../types/parish';
import {
  WEEKDAY_OPTIONS,
  formatPolishDateChip,
  formatPolishDateFull,
  parseWeekdaysMask,
  toggleWeekdayInMask,
} from '../utils/seasonScheduler';
import {
  extractHouseNumberLabel,
  extractStreetName,
  isEvenHouseNumberStr,
} from '../utils/spatial';

interface SidebarStopsProps {
  parish: ParishCenter | null;
  boundary: LatLng[];
  stops: VisitStop[];
  config: PlanConfig;
  seasonConfig: SeasonPlanConfig;
  plannedDays: DayPlanSummary[];
  selectedDate: string | null;
  exactDayKeys: Record<string, boolean>;
  onSelectDate: (date: string | null) => void;
  onChangeSeasonConfig: (next: SeasonPlanConfig) => void;
  onAutoScheduleSeason: (targetMode: 'all' | 'unscheduled') => void;
  onClearAllDates: () => void;
  onAssignStopsDate: (stopIds: string[], visitDate: string) => void;
  onToggleStreetIncluded: (stopIds: string[], included: boolean) => void;
  onAssignStreetPriest: (stopIds: string[], priestId: number) => void;
  onSetAllIncluded: (included: boolean) => void;
  onUpdateStop: (id: string, patch: Partial<VisitStop>) => void;
  onDeleteStop: (id: string) => void;
  onClearStops: () => void;
  onAutoPartition: () => void;
  onSelectStop: (id: string) => void;
  onOpenBlockUnits: (id: string) => void;
  onViewDayOnMap: (date: string) => void;
  onComputeDayRoute: (date: string | null) => void;
  onGoToSetup: () => void;
  isComputing: boolean;
}

type StopsViewTab = 'days' | 'streets';

export const SidebarStops: React.FC<SidebarStopsProps> = ({
  parish,
  boundary,
  stops,
  config,
  seasonConfig,
  plannedDays,
  selectedDate,
  exactDayKeys,
  onSelectDate,
  onChangeSeasonConfig,
  onAutoScheduleSeason,
  onClearAllDates,
  onAssignStopsDate,
  onToggleStreetIncluded,
  onAssignStreetPriest,
  onSetAllIncluded,
  onUpdateStop,
  onDeleteStop,
  onClearStops,
  onAutoPartition,
  onSelectStop,
  onOpenBlockUnits,
  onViewDayOnMap,
  onComputeDayRoute,
  onGoToSetup,
  isComputing,
}) => {
  const [activeTab, setActiveTab] = useState<StopsViewTab>('days');
  const [showSchedulerSettings, setShowSchedulerSettings] = useState(
    plannedDays.length === 0
  );
  const [filterText, setFilterText] = useState('');
  const [streetDateFilter, setStreetDateFilter] = useState<
    'all' | 'unassigned' | string
  >('all');
  const [expandedStreets, setExpandedStreets] = useState<
    Record<string, boolean>
  >({});

  const activeStops = useMemo(
    () => stops.filter((s) => s.included !== false),
    [stops]
  );

  const unassignedStops = useMemo(
    () => stops.filter((s) => !(s.visitDate ?? '').trim()),
    [stops]
  );

  const selectedDaySummary = useMemo(
    () => plannedDays.find((d) => d.date === selectedDate) ?? null,
    [plannedDays, selectedDate]
  );

  const outsideActiveCount = useMemo(
    () =>
      boundary.length >= 3
        ? activeStops.filter((s) => s.inBoundary === false).length
        : 0,
    [activeStops, boundary.length]
  );

  const activeWeekdaysSet = useMemo(
    () => parseWeekdaysMask(seasonConfig.weekdaysMask),
    [seasonConfig.weekdaysMask]
  );

  const streetGroups = useMemo(() => {
    const map: Record<string, VisitStop[]> = {};
    for (const stop of stops) {
      if (streetDateFilter === 'unassigned' && (stop.visitDate ?? '').trim()) {
        continue;
      }
      if (
        streetDateFilter !== 'all' &&
        streetDateFilter !== 'unassigned' &&
        (stop.visitDate ?? '').trim() !== streetDateFilter
      ) {
        continue;
      }

      const street = extractStreetName(stop);
      if (!map[street]) map[street] = [];
      map[street].push(stop);
    }

    const q = filterText.trim().toLowerCase();
    return Object.entries(map)
      .map(([streetName, groupStops]) => {
        const matchingStops = q
          ? groupStops.filter(
              (s) =>
                streetName.toLowerCase().includes(q) ||
                s.address.toLowerCase().includes(q) ||
                (s.notes && s.notes.toLowerCase().includes(q))
            )
          : groupStops;
        return {
          streetName,
          allStops: groupStops,
          visibleStops: matchingStops,
        };
      })
      .filter((g) => g.visibleStops.length > 0)
      .sort((a, b) => a.streetName.localeCompare(b.streetName, 'pl'));
  }, [stops, filterText, streetDateFilter]);

  const toggleExpand = (streetName: string) => {
    setExpandedStreets((prev) => ({
      ...prev,
      [streetName]: !prev[streetName],
    }));
  };

  const selectStreetParity = (
    groupStops: VisitStop[],
    mode: 'all' | 'even' | 'odd' | 'none'
  ) => {
    if (mode === 'all') {
      onToggleStreetIncluded(
        groupStops.map((s) => s.id),
        true
      );
      return;
    }
    if (mode === 'none') {
      onToggleStreetIncluded(
        groupStops.map((s) => s.id),
        false
      );
      return;
    }

    const toInclude: string[] = [];
    const toExclude: string[] = [];
    for (const s of groupStops) {
      const numStr = extractHouseNumberLabel(s);
      const isEven = isEvenHouseNumberStr(numStr);
      const want =
        (mode === 'even' && isEven === true) ||
        (mode === 'odd' && isEven === false);
      if (want) toInclude.push(s.id);
      else toExclude.push(s.id);
    }
    if (toInclude.length > 0) onToggleStreetIncluded(toInclude, true);
    if (toExclude.length > 0) onToggleStreetIncluded(toExclude, false);
  };

  if (stops.length === 0) {
    return (
      <div className="p-6 sm:p-8 text-center space-y-4">
        <div className="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
          <MapPin className="w-5 h-5" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-sm font-semibold text-slate-900">
            Brak zapamiętanych ulic dla tej parafii
          </h2>
          <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
            Najpierw skonfiguruj teren parafii — zaznacz obszar lub kliknij
            wybrane ulice na mapie, aby pobrać z nich numery domów.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToSetup}
          className="min-h-[42px] px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center gap-1.5 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Skonfiguruj teren i ulice parafii</span>
        </button>
      </div>
    );
  }

  const footerTargetStopsCount = selectedDaySummary
    ? selectedDaySummary.stops.length
    : activeStops.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header + Segmented View Switch */}
      <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3 bg-white shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Układanie planu kolędy
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              {plannedDays.length > 0 ? (
                <>
                  Zaplanowano{' '}
                  <strong className="text-slate-900">
                    {plannedDays.length}
                  </strong>{' '}
                  {plannedDays.length === 1 ? 'dzień' : 'dni'} ·{' '}
                  {stops.length - unassignedStops.length}/{stops.length} domów
                </>
              ) : (
                <>
                  Baza parafii:{' '}
                  <strong className="text-slate-900">{stops.length}</strong>{' '}
                  domów (zaznaczone dziś: {activeStops.length})
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToSetup}
            className="text-xs font-medium text-amber-800 hover:underline whitespace-nowrap shrink-0 min-h-[32px] inline-flex items-center"
          >
            + Dodaj ulice
          </button>
        </div>

        {/* Mode switch: Okres kolędowy (dni) vs Ulice i wybór */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('days')}
            className={`min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'days'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-amber-700" />
            <span className="truncate">Okres kolędowy ({plannedDays.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('streets')}
            className={`min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'streets'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MapPin className="w-3.5 h-3.5 text-slate-600" />
            <span className="truncate">Ulice i ręcznie</span>
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'days' ? (
          <div className="divide-y divide-slate-200">
            {/* Season Auto-Scheduler Config Card */}
            <section className="p-4 sm:p-5 bg-slate-50/70 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setShowSchedulerSettings((v) => !v)}
                  className="flex items-center gap-2 text-left min-h-[32px]"
                >
                  <Sparkles className="w-4 h-4 text-amber-700 shrink-0" />
                  <span className="text-xs font-semibold text-slate-900">
                    Rozpisanie całego okresu kolędowego
                  </span>
                  {showSchedulerSettings ? (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-500" />
                  )}
                </button>
                {plannedDays.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearAllDates}
                    className="text-xs text-slate-500 hover:text-red-600 whitespace-nowrap"
                  >
                    Wyczyść daty
                  </button>
                )}
              </div>

              {showSchedulerSettings && (
                <div className="space-y-3 pt-1">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Określ datę startu, godziny kolędy oraz dni tygodnia. System
                    ułoży sąsiadujące ulice w kolejne dni i podzieli domy na{' '}
                    {config.priestCount}{' '}
                    {config.priestCount === 1 ? 'księdza' : 'księży'}.
                  </p>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="season-start-date"
                        className="block text-[11px] font-medium text-slate-600 mb-1"
                      >
                        Pierwszy dzień kolędy
                      </label>
                      <input
                        id="season-start-date"
                        type="date"
                        value={seasonConfig.startDate}
                        onChange={(e) =>
                          onChangeSeasonConfig({
                            ...seasonConfig,
                            startDate: e.target.value,
                          })
                        }
                        className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="season-daily-end"
                        className="block text-[11px] font-medium text-slate-600 mb-1"
                      >
                        Koniec dnia najpóźniej
                      </label>
                      <input
                        id="season-daily-end"
                        type="time"
                        value={seasonConfig.dailyEndTime}
                        onChange={(e) =>
                          onChangeSeasonConfig({
                            ...seasonConfig,
                            dailyEndTime: e.target.value,
                          })
                        }
                        className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="season-weekday-start"
                        className="block text-[11px] font-medium text-slate-600 mb-1"
                      >
                        Start (dni robocze)
                      </label>
                      <input
                        id="season-weekday-start"
                        type="time"
                        value={seasonConfig.weekdayStartTime}
                        onChange={(e) =>
                          onChangeSeasonConfig({
                            ...seasonConfig,
                            weekdayStartTime: e.target.value,
                          })
                        }
                        className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="season-weekend-start"
                        className="block text-[11px] font-medium text-slate-600 mb-1"
                      >
                        Start (sobota / niedziela)
                      </label>
                      <input
                        id="season-weekend-start"
                        type="time"
                        value={seasonConfig.weekendStartTime}
                        onChange={(e) =>
                          onChangeSeasonConfig({
                            ...seasonConfig,
                            weekendStartTime: e.target.value,
                          })
                        }
                        className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                      />
                    </div>
                  </div>

                  <div>
                    <span className="block text-[11px] font-medium text-slate-600 mb-1.5">
                      Dni tygodnia z kolędą
                    </span>
                    <div className="grid grid-cols-7 gap-1">
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
                            className={`min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                              checked
                                ? 'bg-slate-900 text-white'
                                : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {opt.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      disabled={!parish}
                      onClick={() => {
                        onAutoScheduleSeason('all');
                        setShowSchedulerSettings(false);
                      }}
                      className="flex-1 min-h-[42px] py-2 px-3 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <CalendarPlus className="w-4 h-4" />
                      <span>
                        {plannedDays.length > 0
                          ? 'Przeplanuj całą parafię na dni'
                          : 'Rozpisz całą parafię na okres'}
                      </span>
                    </button>

                    {plannedDays.length > 0 && unassignedStops.length > 0 && (
                      <button
                        type="button"
                        disabled={!parish}
                        onClick={() => {
                          onAutoScheduleSeason('unscheduled');
                          setShowSchedulerSettings(false);
                        }}
                        className="min-h-[42px] py-2 px-3 text-xs font-medium text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                      >
                        Dopisuj brakujące ({unassignedStops.length})
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Unassigned alert banner */}
            {unassignedStops.length > 0 && plannedDays.length > 0 && (
              <div className="px-4 py-3 bg-amber-50/70 flex items-center justify-between gap-2 text-xs text-amber-900">
                <span>
                  <strong className="tabular-nums">
                    {unassignedStops.length}
                  </strong>{' '}
                  {unassignedStops.length === 1
                    ? 'dom nie ma przypisanego dnia'
                    : 'domów nie ma przypisanego dnia'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setStreetDateFilter('unassigned');
                    setActiveTab('streets');
                  }}
                  className="font-semibold text-amber-800 hover:underline whitespace-nowrap shrink-0"
                >
                  Pokaż ulice →
                </button>
              </div>
            )}

            {/* Day-by-Day Cards */}
            {plannedDays.length === 0 ? (
              <div className="p-6 text-center space-y-2.5">
                <Calendar className="w-6 h-6 text-slate-400 mx-auto" />
                <p className="text-xs font-medium text-slate-800">
                  Nie rozpisano jeszcze dni kolędy
                </p>
                <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                  Kliknij „Rozpisz całą parafię na okres” powyżej albo przejdź do
                  zakładki „Ulice i ręcznie”, aby przypisywać konkretne ulice do
                  wybranych dat.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {plannedDays.map((day, idx) => {
                  const isSelected = selectedDate === day.date;
                  const isExact = Boolean(exactDayKeys[day.date]);
                  const streetsPreview =
                    day.streetNames.slice(0, 3).join(', ') +
                    (day.streetNames.length > 3
                      ? ` +${day.streetNames.length - 3}`
                      : '');

                  return (
                    <div
                      key={day.date}
                      className={`p-4 transition-colors ${
                        isSelected ? 'bg-amber-50/60' : 'bg-white hover:bg-slate-50/70'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          onSelectDate(isSelected ? null : day.date)
                        }
                        className="w-full text-left"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-semibold text-amber-800 tabular-nums">
                                Dzień {idx + 1}
                              </span>
                              <span className="text-xs text-slate-300">·</span>
                              <span className="text-xs sm:text-sm font-semibold text-slate-900">
                                {formatPolishDateFull(day.date)}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 mt-1 truncate">
                              {streetsPreview}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="text-xs font-mono font-semibold text-slate-900 tabular-nums">
                              {day.startTime}–{day.estimatedEndTime}
                            </div>
                            <div className="text-[11px] text-slate-500 tabular-nums">
                              {day.stops.length}{' '}
                              {day.stops.length === 1 ? 'dom' : 'domów'}
                            </div>
                          </div>
                        </div>
                      </button>

                      {/* Expanded Day Quick Actions */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onViewDayOnMap(day.date)}
                          className="min-h-[36px] px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 transition-colors"
                        >
                          <MapIcon className="w-3.5 h-3.5 text-amber-700" />
                          <span>Podgląd na mapie</span>
                        </button>

                        <button
                          type="button"
                          disabled={isComputing}
                          onClick={() => onComputeDayRoute(day.date)}
                          className={`min-h-[36px] px-2.5 py-1.5 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 transition-colors ${
                            isExact
                              ? 'text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100'
                              : 'text-amber-900 bg-amber-50 border border-amber-200 hover:bg-amber-100'
                          }`}
                        >
                          <Route className="w-3.5 h-3.5" />
                          <span>
                            {isExact ? 'Dokładna trasa gotowa' : 'Wyznacz trasę dnia'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setStreetDateFilter(day.date);
                            setActiveTab('streets');
                          }}
                          className="min-h-[36px] px-2 py-1.5 text-xs text-slate-500 hover:text-slate-900 ml-auto"
                        >
                          Edytuj ulice
                        </button>
                      </div>

                      {isSelected && day.estimatedRoutes.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-amber-200/70 space-y-1">
                          {day.estimatedRoutes.map((r) => (
                            <div
                              key={r.priestId}
                              className="flex items-center justify-between text-[11px] text-slate-700 tabular-nums"
                            >
                              <span className="inline-flex items-center gap-1.5 truncate">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: r.color }}
                                />
                                <span className="font-medium truncate">
                                  {r.priestName}
                                </span>
                              </span>
                              <span className="font-mono text-slate-600 shrink-0 ml-2">
                                {r.orderedStops.length} domów · do {r.endTime}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* TAB 2: STREETS & MANUAL DAY ASSIGNMENT */
          <div className="divide-y divide-slate-200">
            <div className="p-4 space-y-3 bg-white">
              {/* Date filter bar */}
              {plannedDays.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => setStreetDateFilter('all')}
                    className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                      streetDateFilter === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    Wszystkie ({stops.length})
                  </button>
                  {unassignedStops.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setStreetDateFilter('unassigned')}
                      className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                        streetDateFilter === 'unassigned'
                          ? 'bg-amber-700 text-white'
                          : 'bg-amber-50 text-amber-900 border border-amber-200'
                      }`}
                    >
                      Bez daty ({unassignedStops.length})
                    </button>
                  )}
                  {plannedDays.map((d) => (
                    <button
                      key={d.date}
                      type="button"
                      onClick={() => setStreetDateFilter(d.date)}
                      className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 tabular-nums transition-colors ${
                        streetDateFilter === d.date
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {formatPolishDateChip(d.date)} ({d.stops.length})
                    </button>
                  ))}
                </div>
              )}

              {/* Batch selection bar */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onSetAllIncluded(true)}
                  className="min-h-[34px] px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-amber-700" />
                  Zaznacz wszystkie
                </button>
                <button
                  type="button"
                  onClick={() => onSetAllIncluded(false)}
                  className="min-h-[34px] px-2.5 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1"
                >
                  <Square className="w-3.5 h-3.5" />
                  Odznacz
                </button>
                <button
                  type="button"
                  onClick={onClearStops}
                  className="min-h-[34px] px-2.5 py-1 text-xs text-slate-500 hover:text-red-600 ml-auto"
                >
                  Usuń bazę domów
                </button>
              </div>

              {activeStops.length > 1 && config.priestCount > 1 && (
                <button
                  type="button"
                  onClick={onAutoPartition}
                  className="w-full min-h-[38px] py-2 px-3 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Split className="w-3.5 h-3.5" />
                  Podziel wybrane na {config.priestCount} księży według rejonów
                </button>
              )}

              {outsideActiveCount > 0 && (
                <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>
                    {outsideActiveCount}{' '}
                    {outsideActiveCount === 1
                      ? 'wybrany adres leży'
                      : 'wybrane adresy leżą'}{' '}
                    poza narysowanym terenem parafii.
                  </span>
                </div>
              )}

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Filtruj po ulicy, numerze domu lub rodzinie..."
                  className="w-full pl-8 pr-8 py-2 text-base sm:text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-amber-600"
                />
                {filterText && (
                  <button
                    type="button"
                    onClick={() => setFilterText('')}
                    aria-label="Wyczyść filtr"
                    className="p-1 text-slate-400 hover:text-slate-700 absolute right-2 top-1/2 -translate-y-1/2"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {streetGroups.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Brak zapisanych ulic pasujących do wybranego filtra.
              </div>
            ) : (
              streetGroups.map(({ streetName, allStops, visibleStops }) => {
                const includedCount = allStops.filter(
                  (s) => s.included !== false
                ).length;
                const allChecked = includedCount === allStops.length;
                const someChecked =
                  includedCount > 0 && includedCount < allStops.length;
                const isExpanded = !!expandedStreets[streetName];

                const streetDates = Array.from(
                  new Set(
                    allStops
                      .map((s) => (s.visitDate ?? '').trim())
                      .filter(Boolean)
                  )
                ).sort();
                const commonDate =
                  streetDates.length === 1 ? streetDates[0] : '';

                const activePriestIds = new Set(
                  allStops
                    .filter((s) => s.included !== false)
                    .map((s) => s.priestId)
                );
                const commonPriestId =
                  activePriestIds.size === 1
                    ? Array.from(activePriestIds)[0]
                    : allStops[0]?.priestId ?? 1;

                return (
                  <div key={streetName} className="bg-white">
                    <div className="px-4 py-3 space-y-2 hover:bg-slate-50/70">
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={(el) => {
                            if (el) el.indeterminate = someChecked;
                          }}
                          onChange={() =>
                            onToggleStreetIncluded(
                              allStops.map((s) => s.id),
                              !allChecked
                            )
                          }
                          aria-label={`Włącz ulicę ${streetName} do planu kolędy`}
                          className="w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600 cursor-pointer shrink-0"
                        />

                        <button
                          type="button"
                          onClick={() => toggleExpand(streetName)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <div
                            className={`text-xs sm:text-sm font-semibold truncate ${
                              includedCount > 0
                                ? 'text-slate-900'
                                : 'text-slate-400'
                            }`}
                          >
                            {streetName}
                          </div>
                          <div className="text-[11px] text-slate-500 tabular-nums">
                            {allStops.length}{' '}
                            {allStops.length === 1 ? 'budynek' : 'budynków'}
                            {(() => {
                              const blockCount = allStops.filter(
                                (s) => s.isMultiUnit || (s.units && s.units.length > 0)
                              ).length;
                              const blockUnitsSum = allStops.reduce(
                                (acc, s) =>
                                  acc + (s.units?.length || s.unitsCount || 0),
                                0
                              );
                              if (blockCount === 0) return null;
                              return (
                                <span className="text-amber-800 font-medium">
                                  {' '}
                                  · {blockCount}{' '}
                                  {blockCount === 1 ? 'blok' : 'bloki/ów'}
                                  {blockUnitsSum > 0 ? ` (${blockUnitsSum} lok.)` : ''}
                                </span>
                              );
                            })()}
                            {streetDates.length > 0 && (
                              <>
                                {' '}
                                ·{' '}
                                <span className="text-amber-800 font-medium">
                                  {streetDates
                                    .map((d) => formatPolishDateChip(d))
                                    .join(', ')}
                                </span>
                              </>
                            )}
                          </div>
                        </button>

                        {config.priestCount > 1 && includedCount > 0 && (
                          <select
                            value={commonPriestId}
                            onChange={(e) =>
                              onAssignStreetPriest(
                                allStops.map((s) => s.id),
                                Number.parseInt(e.target.value, 10)
                              )
                            }
                            aria-label={`Przypisz księdza do ulicy ${streetName}`}
                            className="px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-amber-600 shrink-0"
                          >
                            {PRIEST_PALETTE.slice(0, config.priestCount).map(
                              (p) => (
                                <option key={p.id} value={p.id}>
                                  Ks. {p.id}
                                </option>
                              )
                            )}
                          </select>
                        )}

                        <button
                          type="button"
                          onClick={() => toggleExpand(streetName)}
                          aria-label={
                            isExpanded
                              ? 'Zwiń listę domów'
                              : 'Rozwiń listę domów'
                          }
                          className="min-w-[34px] min-h-[34px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 shrink-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      {/* Quick Date Picker for the entire street */}
                      <div className="pl-6 flex items-center gap-2">
                        <label className="text-[11px] text-slate-500 whitespace-nowrap">
                          Dzień kolędy:
                        </label>
                        <input
                          type="date"
                          value={commonDate}
                          onChange={(e) =>
                            onAssignStopsDate(
                              allStops.map((s) => s.id),
                              e.target.value
                            )
                          }
                          aria-label={`Data kolędy dla ulicy ${streetName}`}
                          className="min-h-[32px] px-2 py-0.5 text-base sm:text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:border-amber-600"
                        />
                        {streetDates.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              onAssignStopsDate(
                                allStops.map((s) => s.id),
                                ''
                              )
                            }
                            aria-label={`Usuń datę dla ulicy ${streetName}`}
                            className="text-[11px] text-slate-400 hover:text-red-600"
                          >
                            Wyczyść
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded houses on this street */}
                    {isExpanded && (
                      <div className="bg-slate-50/70 border-t border-slate-100 divide-y divide-slate-100">
                        {allStops.length > 2 && (
                          <div className="px-4 py-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="text-slate-500 mr-1">Wybierz:</span>
                            <button
                              type="button"
                              onClick={() =>
                                selectStreetParity(allStops, 'all')
                              }
                              className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                            >
                              Wszystkie
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                selectStreetParity(allStops, 'even')
                              }
                              className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                            >
                              Parzyste
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                selectStreetParity(allStops, 'odd')
                              }
                              className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                            >
                              Nieparzyste
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                selectStreetParity(allStops, 'none')
                              }
                              className="px-2 py-1 text-slate-500 hover:text-slate-800"
                            >
                              Żaden
                            </button>
                          </div>
                        )}

                        {visibleStops.map((stop) => {
                          const isIncluded = stop.included !== false;
                          const palette =
                            PRIEST_PALETTE.find(
                              (p) => p.id === stop.priestId
                            ) ?? PRIEST_PALETTE[0];
                          const isBlock = Boolean(
                            stop.isMultiUnit ||
                              (stop.units && stop.units.length > 0)
                          );
                          const unitCount =
                            stop.units?.length || stop.unitsCount || 0;
                          return (
                            <div
                              key={stop.id}
                              className={`px-4 py-2.5 transition-colors ${
                                isIncluded ? 'bg-white/80' : 'opacity-60'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isIncluded}
                                  onChange={() =>
                                    onUpdateStop(stop.id, {
                                      included: !isIncluded,
                                    })
                                  }
                                  aria-label={`Uwzględnij ${stop.address}`}
                                  className="w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600 shrink-0"
                                />
                                <span
                                  className={`w-2.5 h-2.5 shrink-0 ${
                                    isBlock ? 'rounded-xs' : 'rounded-full'
                                  }`}
                                  style={{
                                    backgroundColor: isIncluded
                                      ? palette.color
                                      : '#CBD5E1',
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    isBlock
                                      ? onOpenBlockUnits(stop.id)
                                      : onSelectStop(stop.id)
                                  }
                                  title={
                                    isBlock
                                      ? 'Kliknij, aby otworzyć rozpiskę lokali w bloku'
                                      : 'Pokaż na mapie'
                                  }
                                  className="flex-1 min-w-0 text-left text-xs font-medium text-slate-900 hover:text-amber-800 truncate inline-flex items-center gap-1.5"
                                >
                                  <span className="truncate">{stop.address}</span>
                                  {isBlock && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-semibold shrink-0 tabular-nums">
                                      <Building2 className="w-2.5 h-2.5" />
                                      Blok{unitCount > 0 ? ` (${unitCount})` : ''}
                                    </span>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onOpenBlockUnits(stop.id)}
                                  title={
                                    isBlock
                                      ? 'Edytuj lokale i adresy w bloku'
                                      : 'Oznacz jako blok i dodaj lokale'
                                  }
                                  className={`px-2 py-1 text-[11px] font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1 ${
                                    isBlock
                                      ? 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'
                                      : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                                  }`}
                                >
                                  <Building2 className="w-3 h-3" />
                                  <span>{isBlock ? 'Lokale' : 'Blok'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onDeleteStop(stop.id)}
                                  aria-label="Usuń adres z bazy parafii"
                                  title="Usuń na stałe z bazy parafii"
                                  className="p-1 text-slate-400 hover:text-red-600 rounded shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              <div className="mt-2 pl-6 flex flex-wrap items-center gap-1.5">
                                <input
                                  type="date"
                                  value={stop.visitDate ?? ''}
                                  onChange={(e) =>
                                    onUpdateStop(stop.id, {
                                      visitDate: e.target.value,
                                      included: e.target.value
                                        ? true
                                        : stop.included,
                                    })
                                  }
                                  aria-label={`Data wizyty dla ${stop.address}`}
                                  className="px-2 py-1 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-amber-600"
                                />
                                <input
                                  type="text"
                                  value={stop.notes ?? ''}
                                  onChange={(e) =>
                                    onUpdateStop(stop.id, {
                                      notes: e.target.value,
                                    })
                                  }
                                  aria-label="Rodzina lub uwagi"
                                  placeholder={
                                    isBlock
                                      ? 'Uwagi do bloku (klatki, kod)'
                                      : 'Rodzina / uwagi'
                                  }
                                  className="flex-1 min-w-[100px] px-2 py-1 text-base sm:text-xs bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-amber-600"
                                />
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min={3}
                                    max={1440}
                                    value={stop.durationMinutes}
                                    onChange={(e) =>
                                      onUpdateStop(stop.id, {
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
                                    aria-label="Czas wizyty w minutach"
                                    className="w-14 px-1.5 py-1 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-800 text-right focus:outline-none focus:border-amber-600"
                                  />
                                  <span className="text-[11px] text-slate-500">
                                    min
                                  </span>
                                </div>
                                {config.priestCount > 1 && (
                                  <select
                                    value={stop.priestId}
                                    onChange={(e) =>
                                      onUpdateStop(stop.id, {
                                        priestId: Number.parseInt(
                                          e.target.value,
                                          10
                                        ),
                                      })
                                    }
                                    aria-label="Przypisany ksiądz"
                                    className="px-1.5 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-amber-600"
                                  >
                                    {PRIEST_PALETTE.slice(
                                      0,
                                      config.priestCount
                                    ).map((p) => (
                                      <option key={p.id} value={p.id}>
                                        Ks. {p.id}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Primary action footer */}
      <div className="p-4 border-t border-slate-200 bg-white shrink-0">
        <button
          type="button"
          disabled={!parish || footerTargetStopsCount === 0 || isComputing}
          onClick={() => onComputeDayRoute(selectedDaySummary?.date ?? null)}
          className="w-full min-h-[44px] py-2.5 px-4 text-sm font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl inline-flex items-center justify-center gap-2 transition-colors tabular-nums"
        >
          {isComputing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Clock className="w-4 h-4" />
          )}
          <span>
            {isComputing
              ? 'Wyznaczanie optymalnych tras...'
              : selectedDaySummary
                ? `Wyznacz trasę na ${formatPolishDateChip(
                    selectedDaySummary.date
                  )} (${selectedDaySummary.stops.length} ${
                    selectedDaySummary.stops.length === 1 ? 'dom' : 'domów'
                  })`
                : `Wyznacz trasy (${activeStops.length} ${
                    activeStops.length === 1 ? 'dom' : 'domów'
                  })`}
          </span>
        </button>
      </div>
    </div>
  );
};
