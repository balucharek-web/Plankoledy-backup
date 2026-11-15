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
  RotateCcw,
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
  addDaysToIsoDate,
  collectReturnVisitCandidates,
  formatPolishDateChip,
  formatPolishDateFull,
  parseWeekdaysMask,
  toggleWeekdayInMask,
} from '../utils/seasonScheduler';
import {
  extractHouseNumberLabel,
  extractHouseNumberSortKey,
  extractStreetName,
  isEvenHouseNumberStr,
} from '../utils/spatial';
import {
  StreetStartDirection,
  estimateDayRoutes,
  getDayEndTime,
  getDayStartTime,
  parseHHMMToMinutes,
} from '../utils/seasonScheduler';

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
  onScheduleReturnVisits: (targetDate: string) => void;
  onPlanCustomDay: (payload: CustomDayPlanPayload) => void;
  onUpdateDayTimeWindow: (
    date: string,
    startTime: string,
    endTime: string
  ) => void;
  onGoToSetup: () => void;
  isComputing: boolean;
  progressLabel?: string | null;
}

type StopsViewTab = 'single' | 'days' | 'streets';

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
  onScheduleReturnVisits,
  onPlanCustomDay,
  onUpdateDayTimeWindow,
  onGoToSetup,
  isComputing,
  progressLabel,
}) => {
  const [activeTab, setActiveTab] = useState<StopsViewTab>(() =>
    plannedDays.length === 0 ? 'single' : 'days'
  );
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
  const [visibleStreetsLimit, setVisibleStreetsLimit] = useState<number>(30);
  const [houseLimits, setHouseLimits] = useState<Record<string, number>>({});
  const [editingHoursDate, setEditingHoursDate] = useState<string | null>(null);
  const [editingHoursStart, setEditingHoursStart] = useState<string>('15:30');
  const [editingHoursEnd, setEditingHoursEnd] = useState<string>('20:30');

  // Single-Day + Specific Street Quick Planner state
  const [singleDayDate, setSingleDayDate] = useState<string>(
    () => selectedDate || seasonConfig.startDate || '2026-12-28'
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
    []
  );
  const [singleStreetQuery, setSingleStreetQuery] = useState<string>('');
  const [singleParity, setSingleParity] = useState<'all' | 'even' | 'odd'>(
    'all'
  );
  const [singleAssignmentMode, setSingleAssignmentMode] = useState<
    'split' | number
  >(() => (config.priestCount > 1 ? 'split' : 1));
  const [singleStartDirection, setSingleStartDirection] =
    useState<StreetStartDirection>('asc');
  const [singleStartStopId, setSingleStartStopId] = useState<string>('');

  const defaultReturnDate = useMemo(() => {
    const lastPlanned = plannedDays[plannedDays.length - 1]?.date;
    return addDaysToIsoDate(lastPlanned || seasonConfig.startDate, 1);
  }, [plannedDays, seasonConfig.startDate]);
  const [returnVisitDate, setReturnVisitDate] = useState<string>('');
  const effectiveReturnDate = returnVisitDate || defaultReturnDate;

  const returnCandidates = useMemo(
    () => collectReturnVisitCandidates(stops),
    [stops]
  );

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

  // Streets index for Quick Single-Day Planner
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
        return {
          streetName,
          stops: list,
          assignedDates,
        };
      })
      .sort((a, b) => a.streetName.localeCompare(b.streetName, 'pl'));
  }, [stops]);

  const filteredSingleStreets = useMemo(() => {
    const q = singleStreetQuery.trim().toLowerCase();
    if (!q) return allStreetsSummary;
    return allStreetsSummary.filter((s) =>
      s.streetName.toLowerCase().includes(q)
    );
  }, [allStreetsSummary, singleStreetQuery]);

  // Effective selected streets (if only 1 street in parish and nothing chosen yet, auto-preselect it)
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
      singleEndTime &&
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

        {/* Mode switch: Konkretny dzień & ulica vs Okres kolędowy vs Ulice i ręcznie */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('single')}
            className={`min-h-[38px] px-2 py-1.5 text-[11px] sm:text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1 transition-colors ${
              activeTab === 'single'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span className="truncate">Konkretny dzień</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('days')}
            className={`min-h-[38px] px-2 py-1.5 text-[11px] sm:text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1 transition-colors ${
              activeTab === 'days'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            <span className="truncate">Okres ({plannedDays.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('streets')}
            className={`min-h-[38px] px-2 py-1.5 text-[11px] sm:text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1 transition-colors ${
              activeTab === 'streets'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MapPin className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            <span className="truncate">Ulice</span>
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'single' ? (
          /* TAB 0: QUICK SINGLE-DAY & SPECIFIC STREET PLANNER */
          <div className="p-4 sm:p-5 space-y-4">
            <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 space-y-1">
              <h3 className="text-xs font-semibold text-amber-950">
                Zaplanuj wybrany dzień i konkretną ulicę
              </h3>
              <p className="text-[11px] text-amber-900 leading-relaxed">
                Wybierz datę (np. piątek), godziny kolędy (np. 10:00–16:00),
                ulicę oraz dom startowy. Wszystkie numery zobaczysz razem na
                mapie bez dzielenia na etapy.
              </p>
            </div>

            {/* Date & Custom Hours */}
            <div className="space-y-2.5 bg-slate-50/80 border border-slate-200 rounded-xl p-3.5">
              <div>
                <label
                  htmlFor="single-day-date"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Data kolędy{' '}
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
                  onChange={(e) => {
                    const nextDate = e.target.value;
                    setSingleDayDate(nextDate);
                    if (nextDate && seasonConfig.dayTimeOverrides?.[nextDate]) {
                      setSingleStartTime(
                        seasonConfig.dayTimeOverrides[nextDate].startTime
                      );
                      setSingleEndTime(
                        seasonConfig.dayTimeOverrides[nextDate].endTime
                      );
                    }
                  }}
                  className="w-full min-h-[40px] px-3 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
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
                    className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
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
                    className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                  />
                </div>
              </div>

              {config.priestCount > 1 && (
                <div>
                  <label
                    htmlFor="single-priest-assign"
                    className="block text-[11px] font-medium text-slate-600 mb-1"
                  >
                    Przydział księży
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
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
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
            </div>

            {/* Street Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900">
                  Wybierz ulice ({effectiveSingleStreets.length}/
                  {allStreetsSummary.length})
                </span>
                {effectiveSingleStreets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSingleSelectedStreets([])}
                    className="text-[11px] text-slate-500 hover:text-slate-900"
                  >
                    Wyczyść wybór
                  </button>
                )}
              </div>

              {allStreetsSummary.length > 5 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={singleStreetQuery}
                    onChange={(e) => setSingleStreetQuery(e.target.value)}
                    placeholder="Szukaj ulicy z bazy parafii..."
                    className="w-full pl-8 pr-8 py-2 text-base sm:text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-amber-600"
                  />
                  {singleStreetQuery && (
                    <button
                      type="button"
                      onClick={() => setSingleStreetQuery('')}
                      aria-label="Wyczyść szukanie ulicy"
                      className="p-1 text-slate-400 hover:text-slate-700 absolute right-2 top-1/2 -translate-y-1/2"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-white">
                {filteredSingleStreets.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">
                    Brak pasujących ulic.
                  </div>
                ) : (
                  filteredSingleStreets.map((st) => {
                    const checked = effectiveSingleStreets.includes(
                      st.streetName
                    );
                    return (
                      <label
                        key={st.streetName}
                        className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                          checked ? 'bg-amber-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
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
                          className="w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600 shrink-0"
                        />
                        <span className="flex-1 min-w-0 text-xs font-medium text-slate-900 truncate">
                          {st.streetName}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
                          {st.stops.length}{' '}
                          {st.stops.length === 1 ? 'dom' : 'domów'}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* Parity Filter & Start Direction */}
            {effectiveSingleStreets.length > 0 && (
              <div className="space-y-3 bg-slate-50/80 border border-slate-200 rounded-xl p-3.5">
                <div>
                  <span className="block text-[11px] font-medium text-slate-600 mb-1.5">
                    Numery domów na ulicy
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
                        className={`min-h-[32px] px-2 py-1 text-[11px] font-semibold rounded-lg transition-colors ${
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
                    Gdzie zaczynam trasę i w którą stronę
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
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
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
                        className="w-full min-h-[38px] px-2.5 py-1.5 text-xs bg-emerald-50/70 border border-emerald-300 rounded-xl text-slate-900 focus:outline-none focus:border-emerald-600"
                      >
                        {singleMatchingStops.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.address || s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
              </div>
            )}

            {/* Live summary & Save CTA */}
            <div className="space-y-2.5">
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
                      Wybrano {singleMatchingStops.length}{' '}
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
                      Uwaga: przy {config.defaultVisitMinutes} min/dom czas
                      przekracza zaplanowaną godz. {singleEndTime} (możesz
                      zostawić lub skrócić listę np. do parzystych).
                    </div>
                  )}
                </div>
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
                className="w-full min-h-[44px] py-2.5 px-4 text-xs sm:text-sm font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Route className="w-4 h-4" />
                <span>Zapisz dzień i pokaż trasę na mapie</span>
              </button>
            </div>
          </div>
        ) : activeTab === 'days' ? (
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

            {/* Return Visits / Invited Panel */}
            {returnCandidates.length > 0 && (
              <section className="p-4 bg-amber-50/60 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <RotateCcw className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-xs font-semibold text-amber-950">
                        Powroty i kolęda na zaproszenie ({returnCandidates.length})
                      </h3>
                      <p className="text-[11px] text-amber-800 mt-0.5 leading-snug">
                        Oznaczone domy/lokale jako „Nieobecni” lub „Zaproszenie” —
                        wyznacz dla nich osobny dzień dodatkowy.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                    className="flex-1 min-h-[38px] px-3 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Zaplanuj dzień powrotów</span>
                  </button>
                </div>
              </section>
            )}

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
                            {isExact ? 'Dokładna trasa gotowa' : 'Wyznacz po ulicach'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (editingHoursDate === day.date) {
                              setEditingHoursDate(null);
                            } else {
                              setEditingHoursStart(day.startTime);
                              setEditingHoursEnd(
                                day.plannedEndTime || seasonConfig.dailyEndTime
                              );
                              setEditingHoursDate(day.date);
                            }
                          }}
                          className="min-h-[36px] px-2 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                        >
                          Godziny
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

                      {editingHoursDate === day.date && (
                        <div className="mt-2.5 p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-end gap-2">
                          <div className="flex-1 min-w-[90px]">
                            <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                              Od
                            </label>
                            <input
                              type="time"
                              value={editingHoursStart}
                              onChange={(e) =>
                                setEditingHoursStart(e.target.value)
                              }
                              className="w-full min-h-[34px] px-2 py-1 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                            />
                          </div>
                          <div className="flex-1 min-w-[90px]">
                            <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                              Do
                            </label>
                            <input
                              type="time"
                              value={editingHoursEnd}
                              onChange={(e) => setEditingHoursEnd(e.target.value)}
                              className="w-full min-h-[34px] px-2 py-1 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                            />
                          </div>
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
                        </div>
                      )}

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

                      {/* Quick Date Picker & Day Dropdown for the entire street */}
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
                                {formatPolishDateChip(d.date)} ({d.stops.length})
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

                        {visibleStops.length > (houseLimits[streetName] ?? 40) && (
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
          <span className="truncate">
            {isComputing
              ? progressLabel || 'Wyznaczanie optymalnych tras...'
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
