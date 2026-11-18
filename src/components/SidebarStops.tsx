import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Building2,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Home,
  MapPin,
  Plus,
  Route,
  Search,
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
  computeManualOrderForStops,
  estimateDayRoutes,
  formatIsoDateLocal,
  formatPolishDateChip,
  formatPolishDateFull,
  getDayEndTime,
  getDayStartTime,
  parseHHMMToMinutes,
} from '../utils/seasonScheduler';
import {
  compareStopsByHouseNumber,
  computeStreetNumberBounds,
  extractHouseNumberLabel,
  extractHouseNumberSortKey,
  extractStreetName,
  findMissingHouseNumberGaps,
  getStopUnitCount,
  isBlockStop,
  isEvenHouseNumberStr,
  partitionStopsBySector,
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
  draftSelectedStreets?: string[];
  onDraftSelectedStreetsChange?: (streets: string[]) => void;
  onSelectDate: (date: string | null) => void;
  onSelectStop: (id: string) => void;
  onPlanCustomDay: (payload: CustomDayPlanPayload) => void;
  onDeleteDayPlan?: (date: string) => void;
  onAddMissingOnStreet?: (streetName: string) => void;
  onGoToSetup: () => void;
  onGoToSchedule?: () => void;
  isComputing: boolean;
}

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

function formatHousesNoun(count: number): string {
  if (count === 1) return 'dom';
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'domy';
  return 'domów';
}

function formatBlocksNoun(count: number): string {
  if (count === 1) return 'blok';
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'bloki';
  return 'bloków';
}

export const SidebarStops: React.FC<SidebarStopsProps> = ({
  parish,
  stops,
  config,
  seasonConfig,
  plannedDays,
  selectedDate,
  plannerLoadDate,
  plannerLoadSeq = 0,
  draftSelectedStreets,
  onDraftSelectedStreetsChange,
  onSelectDate,
  onSelectStop,
  onPlanCustomDay,
  onDeleteDayPlan,
  onAddMissingOnStreet,
  onGoToSetup,
  onGoToSchedule,
  isComputing,
}) => {
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
  const [localSelectedStreets, setLocalSelectedStreets] = useState<string[]>(
    () => {
      if (draftSelectedStreets && draftSelectedStreets.length > 0) {
        return draftSelectedStreets;
      }
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
  const singleSelectedStreets =
    draftSelectedStreets ?? localSelectedStreets;
  const setSingleSelectedStreets = useCallback(
    (updater: string[] | ((prev: string[]) => string[])) => {
      if (onDraftSelectedStreetsChange) {
        const next =
          typeof updater === 'function'
            ? updater(draftSelectedStreets ?? localSelectedStreets)
            : updater;
        onDraftSelectedStreetsChange(next);
      } else {
        setLocalSelectedStreets(updater);
      }
    },
    [draftSelectedStreets, localSelectedStreets, onDraftSelectedStreetsChange]
  );
  const [singleStreetQuery, setSingleStreetQuery] = useState<string>('');
  const [singleStreetFilter, setSingleStreetFilter] = useState<'all' | 'free'>(
    'all'
  );
  const [singleParity, setSingleParity] = useState<'all' | 'even' | 'odd'>(
    'all'
  );
  const [singleRangeFrom, setSingleRangeFrom] = useState<string>('');
  const [singleRangeTo, setSingleRangeTo] = useState<string>('');
  const [singleAssignmentMode, setSingleAssignmentMode] = useState<
    'split' | number
  >(() => (config.priestCount > 1 ? 'split' : 1));
  const [singleStartDirection, setSingleStartDirection] =
    useState<StreetStartDirection>('asc');
  const [singleStartStopId, setSingleStartStopId] = useState<string>('');
  const [previewCreatorStreet, setPreviewCreatorStreet] = useState<string | null>(
    null
  );
  const [showCreatorMatchedList, setShowCreatorMatchedList] = useState(false);

  const unassignedStops = useMemo(
    () => stops.filter((s) => !(s.visitDate ?? '').trim()),
    [stops]
  );

  const loadDayIntoPlanner = useCallback(
    (date: string) => {
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
      setSingleRangeFrom('');
      setSingleRangeTo('');
      onSelectDate(date);
    },
    [
      config.startTime,
      onSelectDate,
      seasonConfig,
      setSingleSelectedStreets,
      stops,
    ]
  );

  const resetForNewDay = useCallback(() => {
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
    setSingleRangeFrom('');
    setSingleRangeTo('');
  }, [
    config.startTime,
    plannedDays,
    seasonConfig,
    setSingleSelectedStreets,
  ]);

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
    [
      config.startTime,
      seasonConfig,
      setSingleSelectedStreets,
      singleSelectedStreets.length,
      stops,
    ]
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

  // Streets index for Single-Day Planner (houses sorted numerically + auto-detected blocks & bounds)
  const allStreetsSummary = useMemo(() => {
    const map = new Map<string, VisitStop[]>();
    for (const stop of stops) {
      const name = extractStreetName(stop);
      const list = map.get(name);
      if (list) list.push(stop);
      else map.set(name, [stop]);
    }
    return Array.from(map.entries())
      .map(([streetName, rawList]) => {
        const list = [...rawList].sort(compareStopsByHouseNumber);
        const assignedDates = Array.from(
          new Set(
            list.map((s) => (s.visitDate ?? '').trim()).filter(Boolean)
          )
        ).sort();
        const blockCount = list.filter((s) => isBlockStop(s)).length;
        const singleHouseCount = list.length - blockCount;
        const blockUnitsCount = list.reduce(
          (acc, s) => acc + (isBlockStop(s) ? getStopUnitCount(s) : 0),
          0
        );
        const bounds = computeStreetNumberBounds(
          list.filter((s) => !(s.permanentDecline && s.included === false))
        );
        return {
          streetName,
          stops: list,
          assignedDates,
          blockCount,
          singleHouseCount,
          blockUnitsCount,
          bounds,
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

  const selectedStreetSummaries = useMemo(() => {
    const selectedSet = new Set(effectiveSingleStreets);
    return allStreetsSummary.filter((st) => selectedSet.has(st.streetName));
  }, [allStreetsSummary, effectiveSingleStreets]);

  // Auto-detected start/end number bounds across selected streets (excluding permanent declines)
  const selectedStreetsBounds = useMemo(() => {
    const selectedSet = new Set(effectiveSingleStreets);
    if (selectedSet.size === 0) {
      return computeStreetNumberBounds([]);
    }
    const eligible = stops.filter(
      (s) =>
        selectedSet.has(extractStreetName(s)) &&
        !(s.permanentDecline && s.included === false)
    );
    return computeStreetNumberBounds(eligible);
  }, [effectiveSingleStreets, stops]);

  const activeParityBounds = selectedStreetsBounds[singleParity];

  const parsedRangeBounds = useMemo(() => {
    const rawFrom = singleRangeFrom.trim()
      ? Number.parseInt(singleRangeFrom.trim(), 10)
      : NaN;
    const rawTo = singleRangeTo.trim()
      ? Number.parseInt(singleRangeTo.trim(), 10)
      : NaN;
    const hasFrom = Number.isFinite(rawFrom) && rawFrom > 0;
    const hasTo = Number.isFinite(rawTo) && rawTo > 0;
    if (hasFrom && hasTo && rawFrom > rawTo) {
      return { minNum: rawTo, maxNum: rawFrom, hasFilter: true };
    }
    return {
      minNum: hasFrom ? rawFrom : null,
      maxNum: hasTo ? rawTo : null,
      hasFilter: hasFrom || hasTo,
    };
  }, [singleRangeFrom, singleRangeTo]);

  const { singleMatchingStops, excludedPermanentDeclineCount } = useMemo(() => {
    const streetSet = new Set(effectiveSingleStreets);
    if (streetSet.size === 0) {
      return {
        singleMatchingStops: [] as VisitStop[],
        excludedPermanentDeclineCount: 0,
      };
    }
    let excludedCount = 0;
    const matching = stops.filter((s) => {
      if (!streetSet.has(extractStreetName(s))) return false;
      const numLabel = extractHouseNumberLabel(s);
      if (singleParity !== 'all') {
        const isEven = isEvenHouseNumberStr(numLabel);
        if (singleParity === 'even' && isEven !== true) return false;
        if (singleParity === 'odd' && isEven !== false) return false;
      }
      if (parsedRangeBounds.hasFilter) {
        const numKey = extractHouseNumberSortKey(numLabel);
        if (numKey === Number.MAX_SAFE_INTEGER) return false;
        if (
          parsedRangeBounds.minNum !== null &&
          numKey < parsedRangeBounds.minNum
        ) {
          return false;
        }
        if (
          parsedRangeBounds.maxNum !== null &&
          numKey > parsedRangeBounds.maxNum
        ) {
          return false;
        }
      }
      if (s.permanentDecline && s.included === false) {
        excludedCount += 1;
        return false;
      }
      return true;
    });
    const sorted = [...matching].sort((a, b) => {
      const stCmp = extractStreetName(a).localeCompare(
        extractStreetName(b),
        'pl'
      );
      if (stCmp !== 0) return stCmp;
      return compareStopsByHouseNumber(a, b);
    });
    return {
      singleMatchingStops: sorted,
      excludedPermanentDeclineCount: excludedCount,
    };
  }, [
    effectiveSingleStreets,
    parsedRangeBounds.hasFilter,
    parsedRangeBounds.maxNum,
    parsedRangeBounds.minNum,
    singleParity,
    stops,
  ]);

  const matchingBuildingStats = useMemo(() => {
    let houses = 0;
    let blocks = 0;
    let units = 0;
    for (const s of singleMatchingStops) {
      if (isBlockStop(s)) {
        blocks += 1;
        units += getStopUnitCount(s);
      } else {
        houses += 1;
      }
    }
    const matchingBounds = computeStreetNumberBounds(singleMatchingStops).all;
    return { houses, blocks, units, matchingBounds };
  }, [singleMatchingStops]);

  const singlePreviewEstimate = useMemo(() => {
    if (!parish || singleMatchingStops.length === 0) return null;
    const effectiveConfig: PlanConfig = {
      ...config,
      startTime: singleStartTime || config.startTime,
      priestCount:
        singleAssignmentMode === 'split' ? config.priestCount : 1,
    };

    const assignedStops: VisitStop[] =
      singleAssignmentMode === 'split' && config.priestCount > 1
        ? partitionStopsBySector(
            parish.location,
            singleMatchingStops,
            config.priestCount
          )
        : singleMatchingStops.map((s) => ({
            ...s,
            priestId:
              typeof singleAssignmentMode === 'number'
                ? singleAssignmentMode
                : 1,
          }));

    const byPriest = new Map<number, VisitStop[]>();
    for (const s of assignedStops) {
      const list = byPriest.get(s.priestId);
      if (list) list.push(s);
      else byPriest.set(s.priestId, [s]);
    }
    const orderMap = new Map<string, number>();
    for (const [, list] of byPriest.entries()) {
      const orders = computeManualOrderForStops(
        list,
        singleStartDirection,
        singleStartStopId || undefined
      );
      orders.forEach((order, id) => orderMap.set(id, order));
    }

    const orderedPreviewStops = assignedStops.map((s) => ({
      ...s,
      manualOrder: orderMap.get(s.id) ?? 0,
    }));

    const est = estimateDayRoutes(
      parish,
      orderedPreviewStops,
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
    singleStartDirection,
    singleStartStopId,
    singleStartTime,
  ]);

  const isEditingPlannedDay = useMemo(
    () => plannedDays.some((d) => d.date === singleDayDate),
    [plannedDays, singleDayDate]
  );

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
            Najpierw pobierz ulice, domy i bloki w konfiguracji parafii, aby
            układać plan kolędy na poszczególne dni.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToSetup}
          className="min-h-[42px] px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center gap-1.5 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Skonfiguruj ulice i domy parafii</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Compact Header (house & block config lives cleanly inside Parafia i ulice) */}
      <div className="p-4 sm:p-5 border-b border-slate-200 space-y-2 bg-white shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <CalendarPlus className="w-4 h-4 text-amber-700 shrink-0" />
              <span>Planowanie kolędy na dzień</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              Baza parafii:{' '}
              <strong className="text-slate-900">
                {allStreetsSummary.length}
              </strong>{' '}
              ulic ({stops.length} punktów) · bez terminu:{' '}
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
              Domy i bloki
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
      </div>

      {/* Scrollable Workspace */}
      <div className="flex-1 overflow-y-auto">
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

                    const isPreviewOpen = previewCreatorStreet === st.streetName;
                    return (
                      <div key={st.streetName} className="bg-white">
                        <div
                          className={`flex items-stretch ${
                            checked ? 'bg-amber-50/80' : 'hover:bg-slate-50'
                          }`}
                        >
                          <button
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
                            className="flex-1 min-w-0 min-h-[48px] flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
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
                                  {st.singleHouseCount}{' '}
                                  {formatHousesNoun(st.singleHouseCount)}
                                </span>
                                {st.blockCount > 0 && (
                                  <span className="text-amber-800 font-medium">
                                    · {st.blockCount}{' '}
                                    {formatBlocksNoun(st.blockCount)}
                                    {st.blockUnitsCount > 0
                                      ? ` (${st.blockUnitsCount} lok.)`
                                      : ''}
                                  </span>
                                )}
                                {st.bounds.all.minLabel && (
                                  <span className="text-slate-400">
                                    ·{' '}
                                    {st.bounds.all.minLabel ===
                                    st.bounds.all.maxLabel
                                      ? `nr ${st.bounds.all.minLabel}`
                                      : `nr ${st.bounds.all.minLabel}–${st.bounds.all.maxLabel}`}
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

                          <button
                            type="button"
                            onClick={() =>
                              setPreviewCreatorStreet(
                                isPreviewOpen ? null : st.streetName
                              )
                            }
                            aria-label={`Pokaż adresy na ulicy ${st.streetName}`}
                            className={`px-2.5 border-l border-slate-100 text-[11px] font-medium inline-flex items-center gap-1 shrink-0 transition-colors ${
                              isPreviewOpen
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                            }`}
                          >
                            <span>Adresy</span>
                            {isPreviewOpen ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        {isPreviewOpen && (() => {
                          const missingGaps = findMissingHouseNumberGaps(st.stops);
                          return (
                          <div className="px-3 py-2.5 bg-slate-50 border-t border-slate-100 space-y-2">
                            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                              <span>
                                Adresy (uporządkowane wg numerów — dotknij, aby
                                pokazać na mapie):
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto">
                              {st.stops.map((house) => {
                                const numLabel =
                                  extractHouseNumberLabel(house) ||
                                  house.label ||
                                  house.address;
                                const isBlk = isBlockStop(house);
                                const unitCnt = isBlk
                                  ? getStopUnitCount(house)
                                  : 0;
                                return (
                                  <button
                                    key={house.id}
                                    type="button"
                                    onClick={() => onSelectStop(house.id)}
                                    title={house.address || house.label}
                                    className={`px-2 py-1 text-[11px] font-mono tabular-nums rounded-md inline-flex items-center gap-1 border transition-colors ${
                                      isBlk
                                        ? 'bg-amber-50 border-amber-300 text-amber-950 hover:bg-amber-100'
                                        : 'bg-white border-slate-200 hover:border-amber-400 hover:bg-amber-50 text-slate-800'
                                    }`}
                                  >
                                    {isBlk && (
                                      <Building2 className="w-3 h-3 text-amber-700 shrink-0" />
                                    )}
                                    <span className="font-semibold">
                                      {numLabel}
                                    </span>
                                    {isBlk && (
                                      <span className="text-[9px] font-sans font-bold text-amber-800">
                                        {unitCnt > 0
                                          ? `BLOK · ${unitCnt}`
                                          : 'BLOK'}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            {missingGaps.length > 0 && (
                              <div className="p-2 rounded-lg bg-amber-50/90 border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-950">
                                <span>
                                  Możliwe braki numeracji:{' '}
                                  <strong className="font-mono">
                                    nr {missingGaps.join(', ')}
                                  </strong>
                                </span>
                                {onAddMissingOnStreet && (
                                  <button
                                    type="button"
                                    onClick={() => onAddMissingOnStreet(st.streetName)}
                                    className="px-2 py-1 font-semibold text-amber-900 bg-white hover:bg-amber-100 border border-amber-300 rounded-md inline-flex items-center gap-1 shrink-0"
                                  >
                                    <Plus className="w-3 h-3" />
                                    <span>Dodaj na mapie</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          );
                        })()}
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* KROK 3: Zakres numerów (Parzyste/Nieparzyste + od-do), Kierunek i Zapis */}
            <section className="space-y-3 bg-slate-50/80 border border-slate-200 rounded-xl p-3.5 sm:p-4">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-700 text-white text-[11px] font-bold inline-flex items-center justify-center shrink-0">
                  3
                </span>
                <h3 className="text-xs font-semibold text-slate-900">
                  Numery domów, kierunek i zapis
                </h3>
              </div>

              {effectiveSingleStreets.length === 0 ? (
                <p className="text-xs text-slate-500 leading-relaxed">
                  Wybierz przynajmniej jedną ulicę powyżej, aby wybrać numery
                  (wszystkie, parzyste lub nieparzyste) oraz kierunek przejścia
                  od początku do końca ulicy.
                </p>
              ) : (
                <>
                  {/* Strona ulicy: Wszystkie / Parzyste / Nieparzyste z auto-wykrytymi krańcami */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[11px] font-medium text-slate-600">
                        Strona ulicy (wykryte numery)
                      </span>
                      {selectedStreetSummaries.length === 1 &&
                        activeParityBounds.minLabel && (
                          <span className="text-[11px] font-mono text-amber-800 font-semibold tabular-nums">
                            {activeParityBounds.minLabel ===
                            activeParityBounds.maxLabel
                              ? `nr ${activeParityBounds.minLabel}`
                              : `nr ${activeParityBounds.minLabel}–${activeParityBounds.maxLabel}`}
                          </span>
                        )}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'all', label: 'Wszystkie' },
                          { id: 'even', label: 'Parzyste' },
                          { id: 'odd', label: 'Nieparzyste' },
                        ] as const
                      ).map((opt) => {
                        const b = selectedStreetsBounds[opt.id];
                        const disabled = opt.id !== 'all' && b.count === 0;
                        const active = singleParity === opt.id;
                        const rangeStr = b.minLabel
                          ? b.minLabel === b.maxLabel
                            ? `nr ${b.minLabel}`
                            : `${b.minLabel}–${b.maxLabel}`
                          : 'brak';
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              setSingleParity(opt.id);
                              setSingleRangeFrom('');
                              setSingleRangeTo('');
                              setSingleStartStopId('');
                              if (
                                opt.id !== 'all' &&
                                singleStartDirection === 'side_by_side'
                              ) {
                                setSingleStartDirection('asc');
                              }
                            }}
                            className={`min-h-[50px] px-2 py-1.5 rounded-xl border text-center flex flex-col items-center justify-center gap-0.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                              active
                                ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <span className="text-xs font-semibold">
                              {opt.label}
                            </span>
                            <span
                              className={`text-[10px] font-mono tabular-nums ${
                                active ? 'text-amber-300' : 'text-slate-500'
                              }`}
                            >
                              {rangeStr} ({b.count})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Opcjonalny zakres numerów od-do z automatycznym wykryciem min i max */}
                  {activeParityBounds.minNum !== null &&
                    activeParityBounds.maxNum !== null &&
                    activeParityBounds.minNum !== activeParityBounds.maxNum && (
                      <div className="bg-white border border-slate-200 rounded-xl p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-slate-700">
                            Zakres numerów (opcjonalnie):
                          </span>
                          {parsedRangeBounds.hasFilter ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSingleRangeFrom('');
                                setSingleRangeTo('');
                                setSingleStartStopId('');
                              }}
                              className="text-[11px] font-semibold text-amber-800 hover:underline"
                            >
                              Cała ulica ({activeParityBounds.minLabel}–
                              {activeParityBounds.maxLabel})
                            </button>
                          ) : (
                            <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                              cała: nr {activeParityBounds.minLabel}–
                              {activeParityBounds.maxLabel}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 min-h-[38px]">
                            <label
                              htmlFor="single-range-from"
                              className="text-[11px] text-slate-500 shrink-0"
                            >
                              Od nr
                            </label>
                            <input
                              id="single-range-from"
                              type="number"
                              inputMode="numeric"
                              min={1}
                              value={singleRangeFrom}
                              onChange={(e) => {
                                setSingleRangeFrom(e.target.value);
                                setSingleStartStopId('');
                              }}
                              placeholder={String(activeParityBounds.minNum)}
                              className="w-full min-w-0 bg-transparent text-base sm:text-xs font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:outline-none text-right"
                            />
                          </div>
                          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 min-h-[38px]">
                            <label
                              htmlFor="single-range-to"
                              className="text-[11px] text-slate-500 shrink-0"
                            >
                              Do nr
                            </label>
                            <input
                              id="single-range-to"
                              type="number"
                              inputMode="numeric"
                              min={1}
                              value={singleRangeTo}
                              onChange={(e) => {
                                setSingleRangeTo(e.target.value);
                                setSingleStartStopId('');
                              }}
                              placeholder={String(activeParityBounds.maxNum)}
                              className="w-full min-w-0 bg-transparent text-base sm:text-xs font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:outline-none text-right"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                  {/* Kierunek kolędy: czytelne kafelki z automatycznymi numerami początku i końca */}
                  <div>
                    <span className="block text-[11px] font-medium text-slate-600 mb-1.5">
                      Kierunek kolędy na ulicy
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(() => {
                        const firstLbl =
                          matchingBuildingStats.matchingBounds.minLabel ||
                          activeParityBounds.minLabel ||
                          '1';
                        const lastLbl =
                          matchingBuildingStats.matchingBounds.maxLabel ||
                          activeParityBounds.maxLabel ||
                          'koniec';
                        const multiNote =
                          effectiveSingleStreets.length > 1
                            ? 'każda ul. rosnąco'
                            : `nr ${firstLbl} → ${lastLbl}`;
                        const multiDescNote =
                          effectiveSingleStreets.length > 1
                            ? 'każda ul. malejąco'
                            : `nr ${lastLbl} → ${firstLbl}`;
                        const canSideBySide =
                          singleParity === 'all' &&
                          selectedStreetsBounds.even.count > 0 &&
                          selectedStreetsBounds.odd.count > 0;

                        return (
                          <>
                            <button
                              type="button"
                              onClick={() => setSingleStartDirection('asc')}
                              className={`min-h-[54px] px-2.5 py-2 rounded-xl border text-left flex items-start gap-2 transition-colors ${
                                singleStartDirection === 'asc'
                                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                                  : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              <ArrowUp
                                className={`w-4 h-4 shrink-0 mt-0.5 ${
                                  singleStartDirection === 'asc'
                                    ? 'text-amber-400'
                                    : 'text-amber-700'
                                }`}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold leading-tight">
                                  Od początku do końca
                                </div>
                                <div
                                  className={`text-[10px] font-mono tabular-nums mt-0.5 truncate ${
                                    singleStartDirection === 'asc'
                                      ? 'text-amber-200'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {multiNote}
                                </div>
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => setSingleStartDirection('desc')}
                              className={`min-h-[54px] px-2.5 py-2 rounded-xl border text-left flex items-start gap-2 transition-colors ${
                                singleStartDirection === 'desc'
                                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                                  : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              <ArrowDown
                                className={`w-4 h-4 shrink-0 mt-0.5 ${
                                  singleStartDirection === 'desc'
                                    ? 'text-amber-400'
                                    : 'text-amber-700'
                                }`}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold leading-tight">
                                  Od końca do początku
                                </div>
                                <div
                                  className={`text-[10px] font-mono tabular-nums mt-0.5 truncate ${
                                    singleStartDirection === 'desc'
                                      ? 'text-amber-200'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {multiDescNote}
                                </div>
                              </div>
                            </button>

                            <button
                              type="button"
                              disabled={!canSideBySide}
                              onClick={() =>
                                setSingleStartDirection('side_by_side')
                              }
                              className={`min-h-[50px] px-2.5 py-1.5 rounded-xl border text-left flex items-start gap-2 transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                                singleStartDirection === 'side_by_side'
                                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                                  : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              <ArrowLeftRight
                                className={`w-4 h-4 shrink-0 mt-0.5 ${
                                  singleStartDirection === 'side_by_side'
                                    ? 'text-amber-400'
                                    : 'text-slate-500'
                                }`}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold leading-tight">
                                  Stronami ulicy
                                </div>
                                <div
                                  className={`text-[10px] mt-0.5 truncate ${
                                    singleStartDirection === 'side_by_side'
                                      ? 'text-amber-200'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  parzyste ↑, powrót ↓
                                </div>
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  singleStartDirection === 'from_stop' ||
                                  singleStartDirection === 'auto'
                                ) {
                                  setSingleStartDirection((d) =>
                                    d === 'from_stop' ? 'auto' : 'from_stop'
                                  );
                                } else {
                                  setSingleStartDirection('from_stop');
                                  if (
                                    !singleStartStopId &&
                                    singleMatchingStops.length > 0
                                  ) {
                                    setSingleStartStopId(
                                      singleMatchingStops[0].id
                                    );
                                  }
                                }
                              }}
                              className={`min-h-[50px] px-2.5 py-1.5 rounded-xl border text-left flex items-start gap-2 transition-colors ${
                                singleStartDirection === 'from_stop' ||
                                singleStartDirection === 'auto'
                                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                                  : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              <Compass
                                className={`w-4 h-4 shrink-0 mt-0.5 ${
                                  singleStartDirection === 'from_stop' ||
                                  singleStartDirection === 'auto'
                                    ? 'text-amber-400'
                                    : 'text-slate-500'
                                }`}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold leading-tight">
                                  {singleStartDirection === 'auto'
                                    ? 'Od kościoła (auto)'
                                    : 'Konkretny dom'}
                                </div>
                                <div
                                  className={`text-[10px] mt-0.5 truncate ${
                                    singleStartDirection === 'from_stop' ||
                                    singleStartDirection === 'auto'
                                      ? 'text-amber-200'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {singleStartDirection === 'auto'
                                    ? 'kliknij, by wybrać dom'
                                    : 'wskaż adres START'}
                                </div>
                              </div>
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {singleStartDirection === 'from_stop' &&
                    singleMatchingStops.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <label
                            htmlFor="single-start-house"
                            className="block text-[11px] font-medium text-emerald-800"
                          >
                            Dom początkowy (START #1)
                          </label>
                          <button
                            type="button"
                            onClick={() => setSingleStartDirection('auto')}
                            className="text-[11px] font-medium text-slate-500 hover:text-slate-900"
                          >
                            Lub automatycznie od kościoła
                          </button>
                        </div>
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
                              {isBlockStop(s) ? ' (Blok)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                  {singleMatchingStops.length > 0 && singlePreviewEstimate && (
                    <div
                      className={`p-3 rounded-xl border text-xs tabular-nums space-y-1.5 ${
                        singlePreviewEstimate.overLimit
                          ? 'bg-amber-50 border-amber-300 text-amber-950'
                          : 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 font-semibold">
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          {matchingBuildingStats.blocks > 0 ? (
                            <Building2 className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                          ) : (
                            <Home className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                          )}
                          <span>
                            {matchingBuildingStats.houses > 0 &&
                              `${matchingBuildingStats.houses} ${formatHousesNoun(
                                matchingBuildingStats.houses
                              )}`}
                            {matchingBuildingStats.houses > 0 &&
                              matchingBuildingStats.blocks > 0 &&
                              ' + '}
                            {matchingBuildingStats.blocks > 0 &&
                              `${matchingBuildingStats.blocks} ${formatBlocksNoun(
                                matchingBuildingStats.blocks
                              )}${
                                matchingBuildingStats.units > 0
                                  ? ` (${matchingBuildingStats.units} lok.)`
                                  : ''
                              }`}
                          </span>
                        </span>
                        <span className="font-mono shrink-0">
                          {singleStartTime} → ok. {singlePreviewEstimate.endTime}
                        </span>
                      </div>
                      {singlePreviewEstimate.overLimit && (
                        <div className="text-[11px] text-amber-800">
                          Uwaga: przy {config.defaultVisitMinutes} min/dom
                          koniec przekracza godz. {singleEndTime} (wybierz
                          parzyste/nieparzyste albo zawęź zakres numerów).
                        </div>
                      )}
                      {excludedPermanentDeclineCount > 0 && (
                        <div className="text-[11px] text-slate-700">
                          Pominięto {excludedPermanentDeclineCount}{' '}
                          {excludedPermanentDeclineCount === 1
                            ? 'adres ze stałą odmową'
                            : 'adresy/ów ze stałą odmową'}{' '}
                          —{' '}
                          <button
                            type="button"
                            onClick={onGoToSetup}
                            className="font-semibold text-amber-900 underline"
                          >
                            zmień w Parafii
                          </button>
                          .
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowCreatorMatchedList((v) => !v)}
                        className="text-[11px] font-semibold text-amber-800 hover:text-amber-950 inline-flex items-center gap-1 pt-0.5"
                      >
                        {showCreatorMatchedList ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {showCreatorMatchedList
                            ? 'Ukryj wybrane adresy'
                            : `Podejrzyj wybrane adresy (${singleMatchingStops.length})`}
                        </span>
                      </button>
                      {showCreatorMatchedList && (
                        <div className="pt-1.5 flex flex-wrap gap-1 max-h-36 overflow-y-auto">
                          {singleMatchingStops.map((s) => {
                            const isBlk = isBlockStop(s);
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => onSelectStop(s.id)}
                                className={`px-2 py-0.5 text-[11px] font-mono rounded-md border inline-flex items-center gap-1 ${
                                  isBlk
                                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                                    : 'bg-white border-slate-200 hover:border-amber-400 text-slate-800'
                                }`}
                              >
                                {isBlk && (
                                  <Building2 className="w-2.5 h-2.5 text-amber-700" />
                                )}
                                <span>{s.label || s.address}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {singleMatchingStops.length === 0 && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                      Brak budynków pasujących do wybranej strony lub zakresu
                      numerów. Zmień filtr na „Wszystkie” albo wyczyść zakres.
                    </div>
                  )}
                </>
              )}

              {effectiveSingleStreets.length > 0 && !isEditingPlannedDay && (
                <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] font-medium text-amber-900">
                  Szkic dnia jest zachowany — po sprawdzeniu mapy kliknij przycisk
                  poniżej, aby zapisać dzień i zobaczyć trasę.
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
      </div>
    </div>
  );
};
