import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarPlus,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Plus,
  Route,
  Search,
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
  StreetStartDirection,
  addDaysToIsoDate,
  estimateDayRoutes,
  formatIsoDateLocal,
  formatPolishDateChip,
  formatPolishDateFull,
  getDayEndTime,
  getDayStartTime,
  parseHHMMToMinutes,
} from '../utils/seasonScheduler';
import {
  extractHouseNumberLabel,
  extractHouseNumberSortKey,
  extractStreetName,
  isEvenHouseNumberStr,
} from '../utils/spatial';

export interface CustomDayPlanPayload {
  date: string;
  startTime: string;
  endTime: string;
  stopIds: string[];
  assignmentMode: 'split' | number;
  startDirection: StreetStartDirection;
  startingStopId?: string;
}

interface SidebarStopsProps {
  parish: ParishCenter | null;
  boundary: LatLng[];
  stops: VisitStop[];
  config: PlanConfig;
  seasonConfig: SeasonPlanConfig;
  plannedDays: DayPlanSummary[];
  selectedDate: string | null;
  plannerLoadDate?: string | null;
  plannerLoadSeq?: number;
  onSelectDate: (date: string | null) => void;
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
  onComputeDayRoute: (date: string | null) => void;
  onPlanCustomDay: (payload: CustomDayPlanPayload) => void;
  onDeleteDayPlan?: (date: string) => void;
  onGoToSetup: () => void;
  onGoToSchedule?: () => void;
  isComputing: boolean;
  progressLabel?: string | null;
}

type StopsViewTab = 'single' | 'houses';

function getNextWeekdayIso(targetDayIndex: number): string {
  const now = new Date();
  const base = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    12,
    0,
    0
  );
  const diff = (targetDayIndex - base.getDay() + 7) % 7;
  base.setDate(base.getDate() + diff);
  return formatIsoDateLocal(base);
}

export const SidebarStops: React.FC<SidebarStopsProps> = ({
  parish,
  boundary,
  stops,
  config,
  seasonConfig,
  plannedDays,
  selectedDate,
  plannerLoadDate,
  plannerLoadSeq = 0,
  onSelectDate,
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
  onComputeDayRoute,
  onPlanCustomDay,
  onDeleteDayPlan,
  onGoToSetup,
  onGoToSchedule,
  isComputing,
  progressLabel,
}) => {
  const [activeTab, setActiveTab] = useState<StopsViewTab>('single');

  // Single-day quick planner state
  const [singleDayDate, setSingleDayDate] = useState<string>(
    () =>
      selectedDate ||
      seasonConfig.startDate ||
      formatIsoDateLocal(new Date())
  );
  const [singleStartTime, setSingleStartTime] = useState<string>(() =>
    getDayStartTime(
      selectedDate || seasonConfig.startDate,
      seasonConfig,
      config.startTime
    )
  );
  const [singleEndTime, setSingleEndTime] = useState<string>(() =>
    getDayEndTime(selectedDate || seasonConfig.startDate, seasonConfig)
  );
  const [singleSelectedStreets, setSingleSelectedStreets] = useState<string[]>(
    () => {
      if (!selectedDate) return [];
      const names = new Set<string>();
      for (const s of stops) {
        if ((s.visitDate ?? '').trim() === selectedDate) {
          names.add(extractStreetName(s));
        }
      }
      return Array.from(names);
    }
  );
  const [singleStreetQuery, setSingleStreetQuery] = useState<string>('');
  const [singleStreetFilter, setSingleStreetFilter] = useState<'all' | 'free'>(
    'all'
  );
  const [singleParity, setSingleParity] = useState<'all' | 'even' | 'odd'>(
    'all'
  );
  const [singleAssignmentMode, setSingleAssignmentMode] = useState<
    'split' | number
  >(() => (config.priestCount > 1 ? 'split' : 1));
  const [singleStartDirection, setSingleStartDirection] =
    useState<StreetStartDirection>('asc');
  const [singleStartStopId, setSingleStartStopId] = useState<string>('');

  // House-by-house database editor state
  const [filterText, setFilterText] = useState('');
  const [streetDateFilter, setStreetDateFilter] = useState<
    'all' | 'unassigned' | string
  >('all');
  const [expandedStreets, setExpandedStreets] = useState<
    Record<string, boolean>
  >({});
  const [visibleStreetsLimit, setVisibleStreetsLimit] = useState<number>(30);
  const [houseLimits, setHouseLimits] = useState<Record<string, number>>({});

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

  const loadDayIntoPlanner = useCallback(
    (date: string) => {
      setActiveTab('single');
      setSingleDayDate(date);
      setSingleStartTime(
        getDayStartTime(date, seasonConfig, config.startTime)
      );
      setSingleEndTime(getDayEndTime(date, seasonConfig));
      const streetNames = new Set<string>();
      for (const s of stops) {
        if ((s.visitDate ?? '').trim() === date) {
          streetNames.add(extractStreetName(s));
        }
      }
      setSingleSelectedStreets(Array.from(streetNames));
      setSingleStartStopId('');
      setSingleParity('all');
      onSelectDate(date);
    },
    [config.startTime, onSelectDate, seasonConfig, stops]
  );

  const resetForNewDay = useCallback(() => {
    setActiveTab('single');
    const lastPlanned = plannedDays[plannedDays.length - 1]?.date;
    const todayIso = formatIsoDateLocal(new Date());
    const suggestedDate = lastPlanned
      ? addDaysToIsoDate(lastPlanned, 1)
      : todayIso;
    setSingleDayDate(suggestedDate);
    setSingleStartTime(
      getDayStartTime(suggestedDate, seasonConfig, config.startTime)
    );
    setSingleEndTime(getDayEndTime(suggestedDate, seasonConfig));
    setSingleSelectedStreets([]);
    setSingleStartStopId('');
    setSingleParity('all');
  }, [config.startTime, plannedDays, seasonConfig]);

  useEffect(() => {
    if (plannerLoadSeq <= 0) return;
    if (plannerLoadDate) {
      loadDayIntoPlanner(plannerLoadDate);
    } else {
      resetForNewDay();
    }
    // Intentionally sync only when caller triggers a new plannerLoadSeq event
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannerLoadSeq]);

  const handleDateChange = useCallback(
    (nextDate: string) => {
      setSingleDayDate(nextDate);
      if (!nextDate) return;
      setSingleStartTime(
        getDayStartTime(nextDate, seasonConfig, config.startTime)
      );
      setSingleEndTime(getDayEndTime(nextDate, seasonConfig));
      const existingNames = new Set<string>();
      for (const s of stops) {
        if ((s.visitDate ?? '').trim() === nextDate) {
          existingNames.add(extractStreetName(s));
        }
      }
      if (existingNames.size > 0 && singleSelectedStreets.length === 0) {
        setSingleSelectedStreets(Array.from(existingNames));
      }
    },
    [config.startTime, seasonConfig, singleSelectedStreets.length, stops]
  );

  const datePresets = useMemo(() => {
    const today = formatIsoDateLocal(new Date());
    const tomorrow = addDaysToIsoDate(today, 1);
    const friday = getNextWeekdayIso(5);
    const saturday = getNextWeekdayIso(6);
    const seen = new Set<string>();
    const items: Array<{ label: string; date: string }> = [];
    for (const candidate of [
      { label: 'Dziś', date: today },
      { label: 'Jutro', date: tomorrow },
      { label: 'Piątek', date: friday },
      { label: 'Sobota', date: saturday },
    ]) {
      if (!seen.has(candidate.date)) {
        seen.add(candidate.date);
        items.push(candidate);
      }
    }
    return items;
  }, []);

  // Streets index for Single-Day Planner
  const allStreetsSummary = useMemo(() => {
    const map = new Map<string, VisitStop[]>();
    for (const stop of stops) {
      const name = extractStreetName(stop);
      const list = map.get(name);
      if (list) list.push(stop);
      else map.set(name, [stop]);
    }
    return Array.from(map.entries())
      .map(([streetName, list]) => {
        const assignedDates = Array.from(
          new Set(
            list.map((s) => (s.visitDate ?? '').trim()).filter(Boolean)
          )
        ).sort();
        const blockCount = list.filter(
          (s) => s.isMultiUnit || (s.units && s.units.length > 0)
        ).length;
        return {
          streetName,
          stops: list,
          assignedDates,
          blockCount,
        };
      })
      .sort((a, b) => a.streetName.localeCompare(b.streetName, 'pl'));
  }, [stops]);

  const freeStreetsCount = useMemo(
    () => allStreetsSummary.filter((s) => s.assignedDates.length === 0).length,
    [allStreetsSummary]
  );

  const filteredSingleStreets = useMemo(() => {
    const q = singleStreetQuery.trim().toLowerCase();
    return allStreetsSummary.filter((s) => {
      if (singleStreetFilter === 'free' && s.assignedDates.length > 0) {
        return false;
      }
      if (q && !s.streetName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allStreetsSummary, singleStreetFilter, singleStreetQuery]);

  const effectiveSingleStreets = useMemo(() => {
    if (singleSelectedStreets.length > 0) {
      const existing = new Set(allStreetsSummary.map((s) => s.streetName));
      return singleSelectedStreets.filter((n) => existing.has(n));
    }
    if (allStreetsSummary.length === 1) {
      return [allStreetsSummary[0].streetName];
    }
    return [];
  }, [allStreetsSummary, singleSelectedStreets]);

  const singleMatchingStops = useMemo(() => {
    const streetSet = new Set(effectiveSingleStreets);
    if (streetSet.size === 0) return [];
    const matching = stops.filter((s) => {
      if (!streetSet.has(extractStreetName(s))) return false;
      if (singleParity === 'all') return true;
      const isEven = isEvenHouseNumberStr(extractHouseNumberLabel(s));
      if (singleParity === 'even') return isEven === true;
      return isEven === false;
    });
    return [...matching].sort((a, b) => {
      const stCmp = extractStreetName(a).localeCompare(
        extractStreetName(b),
        'pl'
      );
      if (stCmp !== 0) return stCmp;
      const numA = extractHouseNumberSortKey(extractHouseNumberLabel(a));
      const numB = extractHouseNumberSortKey(extractHouseNumberLabel(b));
      if (numA !== numB) return numA - numB;
      return (a.address || a.label).localeCompare(b.address || b.label, 'pl', {
        numeric: true,
      });
    });
  }, [effectiveSingleStreets, singleParity, stops]);

  const singlePreviewEstimate = useMemo(() => {
    if (!parish || singleMatchingStops.length === 0) return null;
    const effectiveConfig: PlanConfig = {
      ...config,
      startTime: singleStartTime || config.startTime,
      priestCount:
        singleAssignmentMode === 'split' ? config.priestCount : 1,
    };
    const est = estimateDayRoutes(
      parish,
      singleMatchingStops.map((s) => ({
        ...s,
        priestId:
          singleAssignmentMode === 'split'
            ? s.priestId
            : typeof singleAssignmentMode === 'number'
              ? singleAssignmentMode
              : 1,
      })),
      effectiveConfig,
      singleStartTime
    );
    const estEndMins = parseHHMMToMinutes(est.endTime);
    const limitEndMins = parseHHMMToMinutes(singleEndTime);
    const overLimit =
      Boolean(singleEndTime) &&
      estEndMins > limitEndMins &&
      estEndMins - limitEndMins < 720;
    return {
      endTime: est.endTime,
      overLimit,
      totalDistanceMeters: est.totalDistanceMeters,
    };
  }, [
    config,
    parish,
    singleAssignmentMode,
    singleEndTime,
    singleMatchingStops,
    singleStartTime,
  ]);

  const isEditingPlannedDay = useMemo(
    () => plannedDays.some((d) => d.date === singleDayDate),
    [plannedDays, singleDayDate]
  );

  // House-by-house filter list
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
            Brak ulic w bazie parafii
          </h2>
          <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
            Najpierw pobierz ulice i numery domów z mapy, aby łatwo układać
            plan kolędy na poszczególne dni.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToSetup}
          className="min-h-[42px] px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center gap-1.5 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Dodaj ulice parafii</span>
        </button>
      </div>
    );
  }

  const footerTargetStopsCount = selectedDaySummary
    ? selectedDaySummary.stops.length
    : activeStops.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header + 2 Clean Modes */}
      <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3 bg-white shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Planowanie kolędy na dzień
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              Baza parafii:{' '}
              <strong className="text-slate-900">
                {allStreetsSummary.length}
              </strong>{' '}
              ulic ({stops.length} domów) · bez terminu:{' '}
              <strong className="text-amber-800">
                {unassignedStops.length}
              </strong>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onGoToSetup}
              className="text-xs font-medium text-amber-800 hover:underline whitespace-nowrap min-h-[32px] inline-flex items-center"
            >
              + Ulice
            </button>
            {onGoToSchedule && plannedDays.length > 0 && (
              <button
                type="button"
                onClick={onGoToSchedule}
                className="text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap min-h-[32px] inline-flex items-center"
              >
                Okres ({plannedDays.length}) →
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('single')}
            className={`min-h-[38px] px-2.5 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'single'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarPlus className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>Zaplanuj dzień</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('houses')}
            className={`min-h-[38px] px-2.5 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'houses'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            <span>Domy i bloki</span>
          </button>
        </div>
      </div>

      {/* Scrollable Workspace */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'single' ? (
          <div className="p-4 sm:p-5 space-y-5">
            {/* Existing Planned Days Switcher Strip */}
            {plannedDays.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-slate-500">
                  Nowy dzień lub szybka edycja istniejącego:
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={resetForNewDay}
                    className={`min-h-[34px] px-2.5 py-1 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 inline-flex items-center gap-1 border transition-colors ${
                      !isEditingPlannedDay
                        ? 'bg-amber-700 text-white border-amber-700'
                        : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-50'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Nowy dzień
                  </button>
                  {plannedDays.map((d) => {
                    const active = singleDayDate === d.date;
                    return (
                      <button
                        key={d.date}
                        type="button"
                        onClick={() => loadDayIntoPlanner(d.date)}
                        className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 tabular-nums border transition-colors ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {formatPolishDateChip(d.date)} ({d.stops.length})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* KROK 1: Data i godziny */}
            <section className="space-y-3 bg-slate-50/80 border border-slate-200 rounded-xl p-3.5 sm:p-4">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-700 text-white text-[11px] font-bold inline-flex items-center justify-center shrink-0">
                  1
                </span>
                <h3 className="text-xs font-semibold text-slate-900">
                  Wybierz datę i godziny kolędy
                </h3>
              </div>

              {/* 1-tap quick date presets */}
              <div className="grid grid-cols-4 gap-1.5">
                {datePresets.map((p) => {
                  const active = singleDayDate === p.date;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => handleDateChange(p.date)}
                      className={`min-h-[36px] px-1.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors truncate ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              <div>
                <label
                  htmlFor="single-day-date"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Data{' '}
                  {singleDayDate && (
                    <span className="text-amber-800 font-semibold">
                      ({formatPolishDateFull(singleDayDate)})
                    </span>
                  )}
                </label>
                <input
                  id="single-day-date"
                  type="date"
                  value={singleDayDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label
                    htmlFor="single-start-time"
                    className="block text-[11px] font-medium text-slate-600 mb-1"
                  >
                    Godzina od
                  </label>
                  <input
                    id="single-start-time"
                    type="time"
                    value={singleStartTime}
                    onChange={(e) => setSingleStartTime(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                  />
                </div>
                <div>
                  <label
                    htmlFor="single-end-time"
                    className="block text-[11px] font-medium text-slate-600 mb-1"
                  >
                    Godzina do
                  </label>
                  <input
                    id="single-end-time"
                    type="time"
                    value={singleEndTime}
                    onChange={(e) => setSingleEndTime(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                  />
                </div>
              </div>

              {config.priestCount > 1 && (
                <div>
                  <label
                    htmlFor="single-priest-assign"
                    className="block text-[11px] font-medium text-slate-600 mb-1"
                  >
                    Przydział księży tego dnia
                  </label>
                  <select
                    id="single-priest-assign"
                    value={String(singleAssignmentMode)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSingleAssignmentMode(
                        val === 'split' ? 'split' : Number.parseInt(val, 10)
                      );
                    }}
                    className="w-full min-h-[42px] px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                  >
                    <option value="split">
                      Podziel po równo na {config.priestCount} księży
                    </option>
                    {PRIEST_PALETTE.slice(0, config.priestCount).map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        Całość idzie {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </section>

            {/* KROK 2: Wybór ulic */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-amber-700 text-white text-[11px] font-bold inline-flex items-center justify-center shrink-0">
                    2
                  </span>
                  <h3 className="text-xs font-semibold text-slate-900">
                    Zaznacz ulice na ten dzień ({effectiveSingleStreets.length}/
                    {allStreetsSummary.length})
                  </h3>
                </div>
                {effectiveSingleStreets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSingleSelectedStreets([])}
                    className="text-xs font-medium text-slate-500 hover:text-slate-900"
                  >
                    Wyczyść
                  </button>
                )}
              </div>

              {/* Filter: Wszystkie vs Tylko wolne */}
              {allStreetsSummary.length > 1 && (
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setSingleStreetFilter('all')}
                    className={`min-h-[34px] px-2 py-1 text-xs font-medium rounded-lg transition-colors tabular-nums ${
                      singleStreetFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Wszystkie ({allStreetsSummary.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSingleStreetFilter('free')}
                    className={`min-h-[34px] px-2 py-1 text-xs font-medium rounded-lg transition-colors tabular-nums ${
                      singleStreetFilter === 'free'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Bez terminu ({freeStreetsCount})
                  </button>
                </div>
              )}

              {allStreetsSummary.length > 5 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={singleStreetQuery}
                    onChange={(e) => setSingleStreetQuery(e.target.value)}
                    placeholder="Wpisz nazwę ulicy..."
                    className="w-full min-h-[40px] pl-8 pr-8 py-2 text-base sm:text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-amber-600"
                  />
                  {singleStreetQuery && (
                    <button
                      type="button"
                      onClick={() => setSingleStreetQuery('')}
                      aria-label="Wyczyść szukanie ulicy"
                      className="p-1.5 text-slate-400 hover:text-slate-700 absolute right-1.5 top-1/2 -translate-y-1/2"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-white">
                {filteredSingleStreets.length === 0 ? (
                  <div className="p-5 text-center text-xs text-slate-500">
                    {singleStreetFilter === 'free'
                      ? 'Wszystkie ulice mają już przypisaną datę. Przełącz na „Wszystkie”, aby wybrać dowolną ulicę.'
                      : 'Brak pasujących ulic.'}
                  </div>
                ) : (
                  filteredSingleStreets.map((st) => {
                    const checked = effectiveSingleStreets.includes(
                      st.streetName
                    );
                    const assignedHere =
                      Boolean(singleDayDate) &&
                      st.assignedDates.includes(singleDayDate);
                    const otherDates = st.assignedDates.filter(
                      (d) => d !== singleDayDate
                    );

                    return (
                      <button
                        key={st.streetName}
                        type="button"
                        onClick={() => {
                          setSingleSelectedStreets((prev) => {
                            const base =
                              prev.length === 0 &&
                              effectiveSingleStreets.length === 1 &&
                              st.streetName === effectiveSingleStreets[0]
                                ? effectiveSingleStreets
                                : prev;
                            return base.includes(st.streetName)
                              ? base.filter((x) => x !== st.streetName)
                              : [...base, st.streetName];
                          });
                          setSingleStartStopId('');
                        }}
                        className={`w-full min-h-[48px] flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                          checked
                            ? 'bg-amber-50/80'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                            checked
                              ? 'bg-amber-700 border-amber-700 text-white'
                              : 'bg-white border-slate-300'
                          }`}
                        >
                          {checked && <Check className="w-3.5 h-3.5" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {st.streetName}
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap tabular-nums">
                            <span>
                              {st.stops.length}{' '}
                              {st.stops.length === 1 ? 'dom' : 'domów'}
                            </span>
                            {st.blockCount > 0 && (
                              <span className="text-amber-800">
                                · {st.blockCount}{' '}
                                {st.blockCount === 1 ? 'blok' : 'bloki'}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="shrink-0">
                          {assignedHere ? (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-semibold whitespace-nowrap">
                              ten dzień
                            </span>
                          ) : otherDates.length > 0 ? (
                            <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-medium whitespace-nowrap tabular-nums">
                              {formatPolishDateChip(otherDates[0])}
                              {otherDates.length > 1
                                ? ` +${otherDates.length - 1}`
                                : ''}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-medium whitespace-nowrap">
                              wolna
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            {/* KROK 3: Zakres numerów, START i zapis */}
            <section className="space-y-3 bg-slate-50/80 border border-slate-200 rounded-xl p-3.5 sm:p-4">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-700 text-white text-[11px] font-bold inline-flex items-center justify-center shrink-0">
                  3
                </span>
                <h3 className="text-xs font-semibold text-slate-900">
                  Zakres numerów i punkt START
                </h3>
              </div>

              {effectiveSingleStreets.length === 0 ? (
                <p className="text-xs text-slate-500 leading-relaxed">
                  Wybierz przynajmniej jedną ulicę powyżej, aby wskazać numery
                  domów (wszystkie, parzyste lub nieparzyste) oraz dom startowy.
                </p>
              ) : (
                <>
                  <div>
                    <span className="block text-[11px] font-medium text-slate-600 mb-1.5">
                      Numery na wybranych ulicach
                    </span>
                    <div className="grid grid-cols-3 gap-1 p-1 bg-white border border-slate-200 rounded-xl">
                      {(
                        [
                          { id: 'all', label: 'Wszystkie' },
                          { id: 'even', label: 'Parzyste' },
                          { id: 'odd', label: 'Nieparzyste' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setSingleParity(opt.id);
                            setSingleStartStopId('');
                          }}
                          className={`min-h-[36px] px-2 py-1 text-xs font-semibold rounded-lg transition-colors ${
                            singleParity === opt.id
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="single-start-direction"
                      className="block text-[11px] font-medium text-slate-600 mb-1"
                    >
                      Od którego numeru zacząć
                    </label>
                    <select
                      id="single-start-direction"
                      value={singleStartDirection}
                      onChange={(e) => {
                        const nextDir = e.target.value as StreetStartDirection;
                        setSingleStartDirection(nextDir);
                        if (
                          nextDir === 'from_stop' &&
                          !singleStartStopId &&
                          singleMatchingStops.length > 0
                        ) {
                          setSingleStartStopId(singleMatchingStops[0].id);
                        }
                      }}
                      className="w-full min-h-[42px] px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                    >
                      <option value="asc">
                        Od najniższego numeru (rosnąco: 1, 2, 3...)
                      </option>
                      <option value="desc">
                        Od najwyższego numeru (malejąco)
                      </option>
                      <option value="from_stop">
                        Wskazuję konkretny dom jako START
                      </option>
                      <option value="auto">
                        Automatycznie od strony kościoła
                      </option>
                    </select>
                  </div>

                  {singleStartDirection === 'from_stop' &&
                    singleMatchingStops.length > 0 && (
                      <div>
                        <label
                          htmlFor="single-start-house"
                          className="block text-[11px] font-medium text-emerald-800 mb-1"
                        >
                          Dom początkowy (START #1)
                        </label>
                        <select
                          id="single-start-house"
                          value={
                            singleStartStopId || singleMatchingStops[0].id
                          }
                          onChange={(e) => setSingleStartStopId(e.target.value)}
                          className="w-full min-h-[42px] px-3 py-2 text-xs bg-emerald-50/70 border border-emerald-300 rounded-xl text-slate-900 focus:outline-none focus:border-emerald-600"
                        >
                          {singleMatchingStops.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.address || s.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                  {singleMatchingStops.length > 0 && singlePreviewEstimate && (
                    <div
                      className={`p-3 rounded-xl border text-xs tabular-nums space-y-1 ${
                        singlePreviewEstimate.overLimit
                          ? 'bg-amber-50 border-amber-300 text-amber-950'
                          : 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 font-semibold">
                        <span>
                          Razem: {singleMatchingStops.length}{' '}
                          {singleMatchingStops.length === 1
                            ? 'dom'
                            : singleMatchingStops.length < 5
                              ? 'domy'
                              : 'domów'}
                        </span>
                        <span className="font-mono">
                          {singleStartTime} → ok. {singlePreviewEstimate.endTime}
                        </span>
                      </div>
                      {singlePreviewEstimate.overLimit && (
                        <div className="text-[11px] text-amber-800">
                          Uwaga: przy {config.defaultVisitMinutes} min/dom
                          koniec przekracza godz. {singleEndTime} (możesz wybrać
                          tylko parzyste/nieparzyste albo mniej ulic).
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              <button
                type="button"
                disabled={
                  !singleDayDate ||
                  singleMatchingStops.length === 0 ||
                  isComputing
                }
                onClick={() =>
                  onPlanCustomDay({
                    date: singleDayDate,
                    startTime: singleStartTime,
                    endTime: singleEndTime,
                    stopIds: singleMatchingStops.map((s) => s.id),
                    assignmentMode: singleAssignmentMode,
                    startDirection: singleStartDirection,
                    startingStopId:
                      singleStartDirection === 'from_stop'
                        ? singleStartStopId || singleMatchingStops[0]?.id
                        : undefined,
                  })
                }
                className="w-full min-h-[46px] py-2.5 px-4 text-xs sm:text-sm font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl inline-flex items-center justify-center gap-2 transition-colors shadow-xs"
              >
                <Route className="w-4 h-4 shrink-0" />
                <span>
                  {isEditingPlannedDay
                    ? 'Zaktualizuj dzień i pokaż trasę'
                    : 'Zapisz dzień i pokaż trasę'}
                </span>
              </button>

              {isEditingPlannedDay && onDeleteDayPlan && (
                <button
                  type="button"
                  onClick={() => onDeleteDayPlan(singleDayDate)}
                  className="w-full min-h-[40px] py-2 px-4 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Usuń trasę z tego dnia</span>
                </button>
              )}
            </section>
          </div>
        ) : (
          /* TAB 2: HOUSE-BY-HOUSE & BLOCK DATABASE EDITOR */
          <div className="divide-y divide-slate-200">
            <div className="p-4 space-y-3 bg-white">
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
              streetGroups
                .slice(0, visibleStreetsLimit)
                .map(({ streetName, allStops, visibleStops }) => {
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
                                  (s) =>
                                    s.isMultiUnit ||
                                    (s.units && s.units.length > 0)
                                ).length;
                                const blockUnitsSum = allStops.reduce(
                                  (acc, s) =>
                                    acc +
                                    (s.units?.length || s.unitsCount || 0),
                                  0
                                );
                                if (blockCount === 0) return null;
                                return (
                                  <span className="text-amber-800 font-medium">
                                    {' '}
                                    · {blockCount}{' '}
                                    {blockCount === 1 ? 'blok' : 'bloki/ów'}
                                    {blockUnitsSum > 0
                                      ? ` (${blockUnitsSum} lok.)`
                                      : ''}
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

                        <div className="pl-6 flex flex-wrap items-center gap-1.5">
                          <label className="text-[11px] text-slate-500 whitespace-nowrap">
                            Dzień kolędy:
                          </label>
                          {plannedDays.length > 0 && (
                            <select
                              value={commonDate}
                              onChange={(e) =>
                                onAssignStopsDate(
                                  allStops.map((s) => s.id),
                                  e.target.value
                                )
                              }
                              aria-label={`Przenieś ulicę ${streetName} na zaplanowany dzień`}
                              className="min-h-[32px] max-w-[160px] px-2 py-0.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:border-amber-600"
                            >
                              <option value="">
                                {streetDates.length > 1
                                  ? 'Różne dni...'
                                  : 'Przenieś na dzień...'}
                              </option>
                              {plannedDays.map((d) => (
                                <option key={d.date} value={d.date}>
                                  {formatPolishDateChip(d.date)} (
                                  {d.stops.length})
                                </option>
                              ))}
                            </select>
                          )}
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

                      {isExpanded && (
                        <div className="bg-slate-50/70 border-t border-slate-100 divide-y divide-slate-100">
                          {allStops.length > 2 && (
                            <div className="px-4 py-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span className="text-slate-500 mr-1">
                                Wybierz:
                              </span>
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

                          {visibleStops
                            .slice(0, houseLimits[streetName] ?? 40)
                            .map((stop) => {
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
                                      <span className="truncate">
                                        {stop.address}
                                      </span>
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

                          {visibleStops.length >
                            (houseLimits[streetName] ?? 40) && (
                            <div className="px-4 py-2.5 text-center bg-white">
                              <button
                                type="button"
                                onClick={() =>
                                  setHouseLimits((prev) => ({
                                    ...prev,
                                    [streetName]: (prev[streetName] ?? 40) + 50,
                                  }))
                                }
                                className="text-xs font-semibold text-amber-800 hover:underline tabular-nums"
                              >
                                Pokaż kolejne domy (pozostało{' '}
                                {visibleStops.length -
                                  (houseLimits[streetName] ?? 40)}
                                )
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
            )}

            {streetGroups.length > visibleStreetsLimit && (
              <div className="p-4 text-center bg-slate-50">
                <button
                  type="button"
                  onClick={() => setVisibleStreetsLimit((v) => v + 30)}
                  className="min-h-[38px] px-4 py-2 text-xs font-semibold text-amber-900 bg-white border border-amber-200 hover:bg-amber-50 rounded-xl tabular-nums"
                >
                  Pokaż więcej ulic (pozostało{' '}
                  {streetGroups.length - visibleStreetsLimit})
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer shown ONLY in Domy i bloki mode so single-day planner has zero competing CTAs */}
      {activeTab === 'houses' && (
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
            <span className="truncate">
              {isComputing
                ? progressLabel || 'Wyznaczanie optymalnych tras...'
                : selectedDaySummary
                  ? `Wyznacz trasę na ${formatPolishDateChip(
                      selectedDaySummary.date
                    )} (${selectedDaySummary.stops.length} domów)`
                  : `Wyznacz trasę (${activeStops.length} domów)`}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
