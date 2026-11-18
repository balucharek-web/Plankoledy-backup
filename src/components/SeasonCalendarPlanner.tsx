import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Calendar,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Compass,
  Info,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  DayBreakWindow,
  DayPlanSummary,
  ParishCenter,
  PlanConfig,
  SeasonBlockPreference,
  SeasonPlanConfig,
  SeasonPlanningRules,
  SeasonStreetSplitMode,
  SeasonZoneDirection,
  VisitStop,
} from '../types/parish';
import {
  DEFAULT_PLANNING_RULES,
  WEEKDAY_OPTIONS,
  formatIsoDateLocal,
  formatPolishDateChip,
  formatPolishDateFull,
  getDayActiveBreaks,
  getDayEndTime,
  getDayStartTime,
  getFirstFridayDatesInSeason,
  getPolishKoledaHolidayDates,
  getPolishWeekdayIndex,
  parseIsoDateLocal,
  parseWeekdaysMask,
  simulateAutoScheduleSeason,
  toggleWeekdayInMask,
} from '../utils/seasonScheduler';

interface SeasonCalendarPlannerProps {
  parish: ParishCenter | null;
  stops: VisitStop[];
  config: PlanConfig;
  seasonConfig: SeasonPlanConfig;
  plannedDays: DayPlanSummary[];
  unscheduledCount: number;
  onChangeSeasonConfig: (next: SeasonPlanConfig) => void;
  onApplySchedule: (targetMode: 'all' | 'unscheduled') => void;
  onClose?: () => void;
}

const MONTH_NAMES_PL = [
  'Styczeń',
  'Luty',
  'Marzec',
  'Kwiecień',
  'Maj',
  'Czerwiec',
  'Lipiec',
  'Sierpień',
  'Wrzesień',
  'Październik',
  'Listopad',
  'Grudzień',
];

const CALENDAR_WEEK_HEADERS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];

export const SeasonCalendarPlanner: React.FC<SeasonCalendarPlannerProps> = ({
  parish,
  stops,
  config,
  seasonConfig,
  plannedDays,
  unscheduledCount,
  onChangeSeasonConfig,
  onApplySchedule,
  onClose,
}) => {
  const [stepTab, setStepTab] = useState<'calendar' | 'rules' | 'preview'>(
    'calendar'
  );
  const [simulationMode, setSimulationMode] = useState<'all' | 'unscheduled'>(
    plannedDays.length > 0 && unscheduledCount > 0 ? 'unscheduled' : 'all'
  );

  const initialDate = useMemo(
    () => parseIsoDateLocal(seasonConfig.startDate || '2026-12-28'),
    [seasonConfig.startDate]
  );

  const [viewYear, setViewYear] = useState<number>(() =>
    initialDate.getFullYear()
  );
  const [viewMonth, setViewMonth] = useState<number>(() =>
    initialDate.getMonth()
  );
  const [focusedDate, setFocusedDate] = useState<string>(
    seasonConfig.startDate || '2026-12-28'
  );

  // Custom break creation state
  const [newBreakLabel, setNewBreakLabel] = useState<string>('Obiad');
  const [newBreakStart, setNewBreakStart] = useState<string>('12:30');
  const [newBreakEnd, setNewBreakEnd] = useState<string>('14:00');

  // Per-day override break editor
  const [dayBreakLabel, setDayBreakLabel] = useState<string>('Przerwa');
  const [dayBreakStart, setDayBreakStart] = useState<string>('17:30');
  const [dayBreakEnd, setDayBreakEnd] = useState<string>('18:30');

  const rules: SeasonPlanningRules = useMemo(
    () => ({
      splitMode:
        seasonConfig.planningRules?.splitMode ??
        DEFAULT_PLANNING_RULES.splitMode,
      zoneDirection:
        seasonConfig.planningRules?.zoneDirection ??
        DEFAULT_PLANNING_RULES.zoneDirection,
      blockPreference:
        seasonConfig.planningRules?.blockPreference ??
        DEFAULT_PLANNING_RULES.blockPreference,
      safetyBufferMinutes:
        seasonConfig.planningRules?.safetyBufferMinutes ??
        DEFAULT_PLANNING_RULES.safetyBufferMinutes,
    }),
    [seasonConfig.planningRules]
  );

  const updateRules = (patch: Partial<SeasonPlanningRules>) => {
    onChangeSeasonConfig({
      ...seasonConfig,
      planningRules: {
        ...rules,
        ...patch,
      },
    });
  };

  const activeWeekdaysSet = useMemo(
    () => parseWeekdaysMask(seasonConfig.weekdaysMask),
    [seasonConfig.weekdaysMask]
  );

  const excludedSet = useMemo(
    () => new Set(seasonConfig.excludedDates ?? []),
    [seasonConfig.excludedDates]
  );

  const effectiveSimMode: 'all' | 'unscheduled' =
    plannedDays.length > 0 && simulationMode === 'unscheduled'
      ? 'unscheduled'
      : 'all';

  const simulation = useMemo(() => {
    if (!parish || stops.length === 0) return null;
    return simulateAutoScheduleSeason({
      parish,
      stops,
      config,
      seasonConfig,
      targetMode: effectiveSimMode,
    });
  }, [parish, stops, config, seasonConfig, effectiveSimMode]);

  const simulatedByDate = useMemo(() => {
    const map = new Map<string, DayPlanSummary>();
    for (const d of simulation?.simulatedDays ?? []) {
      map.set(d.date, d);
    }
    return map;
  }, [simulation]);

  const existingByDate = useMemo(() => {
    const map = new Map<string, DayPlanSummary>();
    for (const d of plannedDays) {
      map.set(d.date, d);
    }
    return map;
  }, [plannedDays]);

  const holidayDates = useMemo(
    () => getPolishKoledaHolidayDates(seasonConfig.startDate),
    [seasonConfig.startDate]
  );

  const firstFridayDates = useMemo(
    () =>
      getFirstFridayDatesInSeason(seasonConfig.startDate, seasonConfig.endDate),
    [seasonConfig.startDate, seasonConfig.endDate]
  );

  const holidayPresetActiveCount = holidayDates.filter((d) =>
    excludedSet.has(d)
  ).length;

  const firstFridaysActiveCount = firstFridayDates.filter((d) =>
    excludedSet.has(d)
  ).length;

  const toggleExcludedDate = (dateIso: string) => {
    const next = new Set(seasonConfig.excludedDates ?? []);
    if (next.has(dateIso)) next.delete(dateIso);
    else next.add(dateIso);
    const arr = Array.from(next).sort();
    const copy: SeasonPlanConfig = { ...seasonConfig };
    if (arr.length > 0) copy.excludedDates = arr;
    else delete copy.excludedDates;
    onChangeSeasonConfig(copy);
  };

  const applyHolidayPreset = () => {
    const next = new Set(seasonConfig.excludedDates ?? []);
    const allAlready = holidayDates.every((d) => next.has(d));
    for (const d of holidayDates) {
      if (allAlready) next.delete(d);
      else next.add(d);
    }
    const arr = Array.from(next).sort();
    const copy: SeasonPlanConfig = { ...seasonConfig };
    if (arr.length > 0) copy.excludedDates = arr;
    else delete copy.excludedDates;
    onChangeSeasonConfig(copy);
  };

  const applyFirstFridaysPreset = () => {
    const next = new Set(seasonConfig.excludedDates ?? []);
    const allAlready =
      firstFridayDates.length > 0 &&
      firstFridayDates.every((d) => next.has(d));
    for (const d of firstFridayDates) {
      if (allAlready) next.delete(d);
      else next.add(d);
    }
    const arr = Array.from(next).sort();
    const copy: SeasonPlanConfig = { ...seasonConfig };
    if (arr.length > 0) copy.excludedDates = arr;
    else delete copy.excludedDates;
    onChangeSeasonConfig(copy);
  };

  const addDefaultBreak = (start: string, end: string, label: string) => {
    if (!start || !end || end <= start) return;
    const current = seasonConfig.defaultBreaks ?? [];
    const exists = current.some(
      (b) => b.startTime === start && b.endTime === end
    );
    if (exists) return;
    const entry: DayBreakWindow = {
      id: `brk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      startTime: start,
      endTime: end,
      label: label.trim() || 'Przerwa',
    };
    onChangeSeasonConfig({
      ...seasonConfig,
      defaultBreaks: [...current, entry],
    });
  };

  const removeDefaultBreak = (id: string) => {
    const next = (seasonConfig.defaultBreaks ?? []).filter((b) => b.id !== id);
    const copy: SeasonPlanConfig = { ...seasonConfig };
    if (next.length > 0) copy.defaultBreaks = next;
    else delete copy.defaultBreaks;
    onChangeSeasonConfig(copy);
  };

  const shiftCalendarMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1, 12, 0, 0);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const calendarCells = useMemo(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1, 12, 0, 0);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0, 12, 0, 0).getDate();
    // Monday-first index (0=Mon .. 6=Sun)
    const startOffset = (firstOfMonth.getDay() + 6) % 7;

    const cells: Array<{ iso: string | null; dayNum: number | null }> = [];
    for (let i = 0; i < startOffset; i++) {
      cells.push({ iso: null, dayNum: null });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = formatIsoDateLocal(new Date(viewYear, viewMonth, day, 12, 0, 0));
      cells.push({ iso, dayNum: day });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const focusedStart = getDayStartTime(
    focusedDate,
    seasonConfig,
    config.startTime
  );
  const focusedEnd = getDayEndTime(focusedDate, seasonConfig);
  const focusedOverride = seasonConfig.dayTimeOverrides?.[focusedDate];
  const focusedBreaks = getDayActiveBreaks(focusedDate, seasonConfig);
  const focusedSimDay = simulatedByDate.get(focusedDate);
  const focusedExistingDay = existingByDate.get(focusedDate);
  const focusedIsExcluded = excludedSet.has(focusedDate);
  const focusedInWeekdayMask = activeWeekdaysSet.has(
    getPolishWeekdayIndex(focusedDate)
  );

  const updateFocusedDayOverride = (patch: {
    startTime?: string;
    endTime?: string;
    breaks?: DayBreakWindow[];
  }) => {
    const nextStart = patch.startTime ?? focusedStart;
    const nextEnd = patch.endTime ?? focusedEnd;
    const nextWin = {
      startTime: nextStart,
      endTime: nextEnd,
      ...(patch.breaks !== undefined
        ? { breaks: patch.breaks }
        : focusedOverride?.breaks !== undefined
          ? { breaks: focusedOverride.breaks }
          : {}),
    };
    onChangeSeasonConfig({
      ...seasonConfig,
      dayTimeOverrides: {
        ...(seasonConfig.dayTimeOverrides ?? {}),
        [focusedDate]: nextWin,
      },
    });
  };

  const clearFocusedDayOverride = () => {
    if (!focusedOverride) return;
    const nextOverrides = { ...(seasonConfig.dayTimeOverrides ?? {}) };
    delete nextOverrides[focusedDate];
    const copy: SeasonPlanConfig = { ...seasonConfig };
    if (Object.keys(nextOverrides).length > 0) {
      copy.dayTimeOverrides = nextOverrides;
    } else {
      delete copy.dayTimeOverrides;
    }
    onChangeSeasonConfig(copy);
  };

  return (
    <div className="pt-3 border-t border-slate-200 space-y-4">
      {/* Wizard Header + Live Overview Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-700 shrink-0" />
            <span>Inteligentny kreator całego sezonu kolędy</span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
            Układa ulice spójnymi strefami (bez zygzakowania po parafii), z
            uwzględnieniem świąt, przerw obiadowych/mszalnych i bloków. Działa
            w pełni lokalnie (0 zł dodatkowych kosztów).
          </p>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="self-start sm:self-auto text-[11px] font-medium text-slate-500 hover:text-slate-900 px-2 py-1"
          >
            Zwiń kreator
          </button>
        )}
      </div>

      {/* Mode Switch if Existing Days Already Exist */}
      {plannedDays.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2">
          <span className="text-[11px] font-semibold text-slate-600 px-1.5">
            Tryb planowania:
          </span>
          <button
            type="button"
            onClick={() => setSimulationMode('all')}
            className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
              effectiveSimMode === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            Przeplanuj całą parafię od nowa
          </button>
          <button
            type="button"
            disabled={unscheduledCount === 0}
            onClick={() => setSimulationMode('unscheduled')}
            className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
              effectiveSimMode === 'unscheduled'
                ? 'bg-amber-700 text-white'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            Dopisuj tylko bez terminu ({unscheduledCount})
          </button>
        </div>
      )}

      {/* 3-Step Segmented Tabs */}
      <div
        role="tablist"
        aria-label="Kroki planowania całego okresu"
        className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl"
      >
        <button
          type="button"
          role="tab"
          aria-selected={stepTab === 'calendar'}
          onClick={() => setStepTab('calendar')}
          className={`min-h-[40px] px-2 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
            stepTab === 'calendar'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calendar className="w-3.5 h-3.5 text-amber-700 shrink-0" />
          <span className="truncate">1. Kalendarz i wolne</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={stepTab === 'rules'}
          onClick={() => setStepTab('rules')}
          className={`min-h-[40px] px-2 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
            stepTab === 'rules'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
          <span className="truncate">2. Godziny i przerwy</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={stepTab === 'preview'}
          onClick={() => setStepTab('preview')}
          className={`min-h-[40px] px-2 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
            stepTab === 'preview'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <CalendarCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
          <span className="truncate tabular-nums">
            3. Podgląd ({simulation?.simulatedDays.length ?? 0})
          </span>
        </button>
      </div>

      {/* STEP 1: INTERACTIVE CALENDAR & HOLIDAYS */}
      {stepTab === 'calendar' && (
        <div className="space-y-4">
          {/* Date Horizon + Active Weekdays */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="wiz-start-date"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Początek kolędy
                </label>
                <input
                  id="wiz-start-date"
                  type="date"
                  value={seasonConfig.startDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    const parsed = parseIsoDateLocal(val);
                    setViewYear(parsed.getFullYear());
                    setViewMonth(parsed.getMonth());
                    setFocusedDate(val);
                    const next: SeasonPlanConfig = {
                      ...seasonConfig,
                      startDate: val,
                    };
                    if (next.endDate && next.endDate < val) {
                      delete next.endDate;
                    }
                    onChangeSeasonConfig(next);
                  }}
                  className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-amber-600"
                />
              </div>
              <div>
                <label
                  htmlFor="wiz-end-date"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Koniec (opcjonalnie)
                </label>
                <input
                  id="wiz-end-date"
                  type="date"
                  min={seasonConfig.startDate}
                  value={seasonConfig.endDate ?? ''}
                  onChange={(e) => {
                    const copy: SeasonPlanConfig = { ...seasonConfig };
                    if (e.target.value) copy.endDate = e.target.value;
                    else delete copy.endDate;
                    onChangeSeasonConfig(copy);
                  }}
                  className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-amber-600"
                />
              </div>
            </div>

            <div>
              <span className="block text-[11px] font-medium text-slate-600 mb-1">
                Stałe dni tygodnia z kolędą
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
                      className={`min-h-[40px] rounded-xl text-xs font-semibold transition-colors ${
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
          </div>

          {/* 1-Tap Polish Holidays & First Fridays Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-500 mr-1">
              Szybkie wykluczenia:
            </span>
            <button
              type="button"
              onClick={applyHolidayPreset}
              className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-semibold border inline-flex items-center gap-1 transition-colors ${
                holidayPresetActiveCount === holidayDates.length
                  ? 'bg-red-50 border-red-300 text-red-900'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Ban className="w-3 h-3 text-red-600" />
              <span>
                Święta (24–26.12, 31.12, 1.01, 6.01)
                {holidayPresetActiveCount > 0
                  ? ` · ${holidayPresetActiveCount}/${holidayDates.length}`
                  : ''}
              </span>
            </button>

            {firstFridayDates.length > 0 && (
              <button
                type="button"
                onClick={applyFirstFridaysPreset}
                className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-semibold border inline-flex items-center gap-1 transition-colors ${
                  firstFridaysActiveCount === firstFridayDates.length
                    ? 'bg-red-50 border-red-300 text-red-900'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>I piątki miesiąca ({firstFridayDates.length})</span>
              </button>
            )}

            {(seasonConfig.excludedDates?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  const copy: SeasonPlanConfig = { ...seasonConfig };
                  delete copy.excludedDates;
                  onChangeSeasonConfig(copy);
                }}
                className="min-h-[34px] px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-red-700"
              >
                Wyczyść ({seasonConfig.excludedDates?.length})
              </button>
            )}
          </div>

          {/* Interactive Calendar Month View + Selected Day Inspector */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-7 border border-slate-200 rounded-xl bg-slate-50/50 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => shiftCalendarMonth(-1)}
                  aria-label="Poprzedni miesiąc"
                  className="min-w-[36px] min-h-[36px] rounded-lg border border-slate-200 bg-white hover:bg-slate-100 inline-flex items-center justify-center text-slate-700"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-xs sm:text-sm font-bold text-slate-900">
                  {MONTH_NAMES_PL[viewMonth]} {viewYear}
                </div>
                <button
                  type="button"
                  onClick={() => shiftCalendarMonth(1)}
                  aria-label="Następny miesiąc"
                  className="min-w-[36px] min-h-[36px] rounded-lg border border-slate-200 bg-white hover:bg-slate-100 inline-flex items-center justify-center text-slate-700"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center">
                {CALENDAR_WEEK_HEADERS.map((h) => (
                  <div
                    key={h}
                    className="text-[10px] font-semibold text-slate-500 py-1"
                  >
                    {h}
                  </div>
                ))}

                {calendarCells.map((cell, idx) => {
                  if (!cell.iso || !cell.dayNum) {
                    return <div key={`empty_${idx}`} className="h-11 sm:h-12" />;
                  }
                  const iso = cell.iso;
                  const isExcluded = excludedSet.has(iso);
                  const inMask = activeWeekdaysSet.has(getPolishWeekdayIndex(iso));
                  const beforeStart = iso < seasonConfig.startDate;
                  const afterEnd = Boolean(
                    seasonConfig.endDate && iso > seasonConfig.endDate
                  );
                  const outOfHorizon = beforeStart || afterEnd;
                  const simDay = simulatedByDate.get(iso);
                  const hasOverride = Boolean(seasonConfig.dayTimeOverrides?.[iso]);
                  const isFocused = focusedDate === iso;

                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => setFocusedDate(iso)}
                      className={`relative h-11 sm:h-12 rounded-lg border flex flex-col items-center justify-center p-0.5 text-xs transition-all tabular-nums ${
                        isFocused
                          ? 'ring-2 ring-amber-600 border-amber-600 z-10'
                          : 'border-slate-200'
                      } ${
                        isExcluded
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : outOfHorizon || !inMask
                            ? 'bg-slate-100/70 text-slate-400'
                            : simDay
                              ? 'bg-amber-50 text-slate-900 border-amber-300 font-semibold'
                              : 'bg-white text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`leading-none ${
                          isExcluded ? 'line-through opacity-75' : ''
                        }`}
                      >
                        {cell.dayNum}
                      </span>
                      {isExcluded ? (
                        <span className="text-[9px] font-semibold text-red-700 mt-0.5 leading-none">
                          wolne
                        </span>
                      ) : simDay ? (
                        <span className="text-[9px] font-mono font-bold text-amber-800 mt-0.5 leading-none">
                          {simDay.stops.length}d
                        </span>
                      ) : !inMask && !outOfHorizon ? (
                        <span className="text-[8px] text-slate-400 mt-0.5 leading-none">
                          —
                        </span>
                      ) : null}

                      {hasOverride && !isExcluded && (
                        <span
                          title="Własne godziny lub przerwy"
                          className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-600"
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 pt-1">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-amber-100 border border-amber-300" />
                  Dzień kolędy w symulacji
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-red-100 border border-red-200" />
                  Dzień wolny
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-indigo-600" />
                  Własne godziny / przerwa
                </span>
              </div>
            </div>

            {/* Selected Date Action Panel */}
            <div className="lg:col-span-5 border border-slate-200 rounded-xl bg-white p-3.5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wide">
                    Wybrany dzień
                  </div>
                  <div className="text-sm font-bold text-slate-900 mt-0.5">
                    {formatPolishDateFull(focusedDate)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleExcludedDate(focusedDate)}
                  className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors shrink-0 ${
                    focusedIsExcluded
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900 hover:bg-emerald-100'
                      : 'bg-red-50 border-red-200 text-red-800 hover:bg-red-100'
                  }`}
                >
                  {focusedIsExcluded ? 'Przywróć kolędę' : 'Oznacz dzień wolny'}
                </button>
              </div>

              {!focusedIsExcluded && !focusedInWeekdayMask && (
                <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2">
                  Ten dzień tygodnia jest wyłączony w masce dni tygodnia (np.
                  niedziela). Aby go uwzględnić, zaznacz ten dzień tygodnia
                  powyżej.
                </p>
              )}

              {!focusedIsExcluded && (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                        Start tego dnia
                      </label>
                      <input
                        type="time"
                        value={focusedStart}
                        onChange={(e) =>
                          updateFocusedDayOverride({
                            startTime: e.target.value,
                          })
                        }
                        className="w-full min-h-[38px] px-2 py-1 text-base sm:text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                        Koniec tego dnia do
                      </label>
                      <input
                        type="time"
                        value={focusedEnd}
                        onChange={(e) =>
                          updateFocusedDayOverride({
                            endTime: e.target.value,
                          })
                        }
                        className="w-full min-h-[38px] px-2 py-1 text-base sm:text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
                      />
                    </div>
                  </div>

                  {/* Per-day breaks */}
                  <div className="space-y-1.5 pt-1 border-t border-slate-100">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-700">
                        Przerwy w tym dniu ({focusedBreaks.length})
                      </span>
                      {focusedOverride && (
                        <button
                          type="button"
                          onClick={clearFocusedDayOverride}
                          className="text-[11px] text-amber-800 hover:underline"
                        >
                          Przywróć domyślne
                        </button>
                      )}
                    </div>

                    {focusedBreaks.length > 0 && (
                      <div className="space-y-1">
                        {focusedBreaks.map((bw) => (
                          <div
                            key={bw.id}
                            className="flex items-center justify-between gap-2 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[11px]"
                          >
                            <span className="truncate text-slate-800">
                              <strong className="font-mono">
                                {bw.startTime}–{bw.endTime}
                              </strong>{' '}
                              {bw.label || 'Przerwa'}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const next = focusedBreaks.filter(
                                  (b) => b.id !== bw.id
                                );
                                updateFocusedDayOverride({ breaks: next });
                              }}
                              className="text-red-600 hover:text-red-800 p-0.5"
                              aria-label="Usuń przerwę z tego dnia"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-12 gap-1 pt-1">
                      <input
                        type="text"
                        value={dayBreakLabel}
                        onChange={(e) => setDayBreakLabel(e.target.value)}
                        placeholder="Nazwa"
                        className="col-span-4 min-h-[34px] px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                      />
                      <input
                        type="time"
                        value={dayBreakStart}
                        onChange={(e) => setDayBreakStart(e.target.value)}
                        className="col-span-3 min-h-[34px] px-1 py-1 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
                      />
                      <input
                        type="time"
                        value={dayBreakEnd}
                        onChange={(e) => setDayBreakEnd(e.target.value)}
                        className="col-span-3 min-h-[34px] px-1 py-1 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!dayBreakStart || !dayBreakEnd || dayBreakEnd <= dayBreakStart) {
                            return;
                          }
                          const next: DayBreakWindow[] = [
                            ...focusedBreaks,
                            {
                              id: `dbrk_${Date.now().toString(36)}`,
                              startTime: dayBreakStart,
                              endTime: dayBreakEnd,
                              label: dayBreakLabel.trim() || 'Przerwa',
                            },
                          ];
                          updateFocusedDayOverride({ breaks: next });
                        }}
                        aria-label="Dodaj przerwę do tego dnia"
                        className="col-span-2 min-h-[34px] bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center justify-center"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Preview of streets assigned to focused date */}
              {focusedSimDay ? (
                <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-lg text-[11px] space-y-1">
                  <div className="font-semibold text-amber-950 flex items-center justify-between">
                    <span>Symulacja na ten dzień:</span>
                    <span className="font-mono tabular-nums">
                      {focusedSimDay.startTime}–{focusedSimDay.estimatedEndTime}
                    </span>
                  </div>
                  <div className="text-amber-900 leading-snug">
                    {focusedSimDay.streetNames.join(', ')}
                  </div>
                  <div className="text-amber-800 font-mono tabular-nums">
                    {focusedSimDay.stops.length} punktów ·{' '}
                    {focusedSimDay.estimatedRoutes.length} ks.
                  </div>
                </div>
              ) : focusedExistingDay ? (
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-700">
                  Obecny zapisany plan: {focusedExistingDay.streetNames.join(', ')} (
                  {focusedExistingDay.stops.length} domów).
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: HOURS, BREAKS & PASTORAL RULES */}
      {stepTab === 'rules' && (
        <div className="space-y-4">
          {/* Default Hours by Day Type */}
          <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 space-y-3">
            <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-700" />
              <span>Domyślne godziny odwiedzin</span>
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div>
                <label
                  htmlFor="wiz-weekday-start"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Start (Pn–Pt)
                </label>
                <input
                  id="wiz-weekday-start"
                  type="time"
                  value={seasonConfig.weekdayStartTime}
                  onChange={(e) =>
                    onChangeSeasonConfig({
                      ...seasonConfig,
                      weekdayStartTime: e.target.value,
                    })
                  }
                  className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label
                  htmlFor="wiz-sat-start"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Start (Sobota)
                </label>
                <input
                  id="wiz-sat-start"
                  type="time"
                  value={
                    seasonConfig.saturdayStartTime ||
                    seasonConfig.weekendStartTime
                  }
                  onChange={(e) =>
                    onChangeSeasonConfig({
                      ...seasonConfig,
                      saturdayStartTime: e.target.value,
                    })
                  }
                  className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label
                  htmlFor="wiz-sun-start"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Start (Niedziela)
                </label>
                <input
                  id="wiz-sun-start"
                  type="time"
                  value={seasonConfig.weekendStartTime}
                  onChange={(e) =>
                    onChangeSeasonConfig({
                      ...seasonConfig,
                      weekendStartTime: e.target.value,
                    })
                  }
                  className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label
                  htmlFor="wiz-daily-end"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Koniec dnia do
                </label>
                <input
                  id="wiz-daily-end"
                  type="time"
                  value={seasonConfig.dailyEndTime}
                  onChange={(e) =>
                    onChangeSeasonConfig({
                      ...seasonConfig,
                      dailyEndTime: e.target.value,
                    })
                  }
                  className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl"
                />
              </div>
            </div>
          </div>

          {/* Daily Breaks Config */}
          <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                <Coffee className="w-3.5 h-3.5 text-amber-700" />
                <span>Przerwy w ciągu dnia (obiad, Msza św., odpoczynek)</span>
              </h4>
              <span className="text-[11px] text-slate-500">
                Obowiązują, gdy godziny dnia obejmują przerwę
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => addDefaultBreak('12:30', '14:00', 'Przerwa obiadowa')}
                className="min-h-[34px] px-2.5 py-1 text-[11px] font-semibold bg-white hover:bg-amber-50 border border-slate-200 hover:border-amber-300 rounded-lg text-slate-800 inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3 text-amber-700" />
                Obiad (12:30–14:00)
              </button>
              <button
                type="button"
                onClick={() => addDefaultBreak('17:45', '18:45', 'Msza św. wieczorna')}
                className="min-h-[34px] px-2.5 py-1 text-[11px] font-semibold bg-white hover:bg-amber-50 border border-slate-200 hover:border-amber-300 rounded-lg text-slate-800 inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3 text-amber-700" />
                Msza św. wieczorna (17:45–18:45)
              </button>
              <button
                type="button"
                onClick={() => addDefaultBreak('17:00', '17:30', 'Przerwa na posiłek')}
                className="min-h-[34px] px-2.5 py-1 text-[11px] font-semibold bg-white hover:bg-amber-50 border border-slate-200 hover:border-amber-300 rounded-lg text-slate-800 inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3 text-amber-700" />
                Krótka przerwa (17:00–17:30)
              </button>
            </div>

            {(seasonConfig.defaultBreaks?.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                {(seasonConfig.defaultBreaks ?? []).map((bw) => (
                  <div
                    key={bw.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {bw.startTime} – {bw.endTime}
                      </span>
                      <span className="text-slate-600 ml-2">
                        {bw.label || 'Przerwa'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDefaultBreak(bw.id)}
                      className="min-h-[32px] px-2 py-1 text-red-700 hover:bg-red-50 rounded-lg inline-flex items-center gap-1 text-[11px] font-medium"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Usuń</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-12 gap-2 pt-1">
              <input
                type="text"
                value={newBreakLabel}
                onChange={(e) => setNewBreakLabel(e.target.value)}
                placeholder="Nazwa przerwy (np. Obiad)"
                className="col-span-12 sm:col-span-5 min-h-[38px] px-2.5 py-1 text-base sm:text-xs bg-white border border-slate-200 rounded-xl"
              />
              <input
                type="time"
                value={newBreakStart}
                onChange={(e) => setNewBreakStart(e.target.value)}
                aria-label="Początek przerwy"
                className="col-span-5 sm:col-span-3 min-h-[38px] px-2 py-1 text-base sm:text-xs font-mono bg-white border border-slate-200 rounded-xl"
              />
              <input
                type="time"
                value={newBreakEnd}
                onChange={(e) => setNewBreakEnd(e.target.value)}
                aria-label="Koniec przerwy"
                className="col-span-5 sm:col-span-3 min-h-[38px] px-2 py-1 text-base sm:text-xs font-mono bg-white border border-slate-200 rounded-xl"
              />
              <button
                type="button"
                onClick={() =>
                  addDefaultBreak(newBreakStart, newBreakEnd, newBreakLabel)
                }
                aria-label="Dodaj przerwę własną"
                className="col-span-2 sm:col-span-1 min-h-[38px] bg-slate-900 hover:bg-slate-800 text-white rounded-xl inline-flex items-center justify-center"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Zone & Street Grouping Rules */}
          <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 space-y-3">
            <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-amber-700" />
              <span>Zasady dzielenia ulic, bloków i stref</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Jak dzielić długie ulice?
                </label>
                <select
                  value={rules.splitMode}
                  onChange={(e) =>
                    updateRules({
                      splitMode: e.target.value as SeasonStreetSplitMode,
                    })
                  }
                  className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-900"
                >
                  <option value="whole_or_half">
                    Całe ulice (duże dziel na połowy)
                  </option>
                  <option value="parity">
                    Duże ulice stronami: Parzyste / Nieparzyste
                  </option>
                  <option value="strict_budget">
                    Ściśle dopasuj do godzin zakończenia
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Kierunek przejścia po parafii
                </label>
                <select
                  value={rules.zoneDirection}
                  onChange={(e) =>
                    updateRules({
                      zoneDirection: e.target.value as SeasonZoneDirection,
                    })
                  }
                  className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-900"
                >
                  <option value="clockwise">
                    Sektorami wokół kościoła (dzień obok dnia)
                  </option>
                  <option value="nearest_first">
                    Od ulic najbliższych kościołowi na zewnątrz
                  </option>
                  <option value="farthest_first">
                    Od obrzeży / wiosek w stronę kościoła
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Preferencja bloków i domów
                </label>
                <select
                  value={rules.blockPreference}
                  onChange={(e) =>
                    updateRules({
                      blockPreference: e.target.value as SeasonBlockPreference,
                    })
                  }
                  className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-900"
                >
                  <option value="any">
                    Wszystko spójnymi strefami po kolei
                  </option>
                  <option value="blocks_weekdays_houses_weekend">
                    Bloki w dni robocze, domy jednorodzinne w weekendy
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Bufor bezpieczeństwa dziennie
                </label>
                <select
                  value={rules.safetyBufferMinutes}
                  onChange={(e) =>
                    updateRules({
                      safetyBufferMinutes: Number.parseInt(
                        e.target.value || '15',
                        10
                      ),
                    })
                  }
                  className="w-full min-h-[40px] px-2.5 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-900"
                >
                  <option value={0}>0 min (wykorzystaj czas do końca)</option>
                  <option value={10}>10 min zapasu</option>
                  <option value={15}>15 min zapasu (zalecane)</option>
                  <option value={30}>30 min zapasu</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: LIVE DRY-RUN SIMULATION PREVIEW */}
      {stepTab === 'preview' && (
        <div className="space-y-3">
          {!simulation || simulation.simulatedDays.length === 0 ? (
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-600">
              Brak domów do zaplanowania lub brak aktywnych dni w wybranym
              okresie kalendarza.
            </div>
          ) : (
            <>
              {simulation.skippedPermanentDeclineCount > 0 && (
                <div className="flex items-start gap-2 px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[11px] text-slate-700">
                  <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <span>
                    Pominięto automatycznie{' '}
                    <strong>{simulation.skippedPermanentDeclineCount}</strong>{' '}
                    adresów oznaczonych jako „Stała odmowa” lub wyłączonych z
                    kolędy.
                  </span>
                </div>
              )}

              {simulation.unscheduledRemainingCount > 0 && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>
                    <strong>Uwaga:</strong> {simulation.unscheduledRemainingCount}{' '}
                    punktów nie zmieściło się przed datą końcową (
                    {seasonConfig.endDate || 'limit dni'}). Wydłuż datę
                    końcową lub włącz dodatkowe dni tygodnia w kroku 1.
                  </span>
                </div>
              )}

              <div className="max-h-[340px] overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-white">
                {simulation.simulatedDays.map((day, idx) => (
                  <div
                    key={day.date}
                    className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs hover:bg-slate-50/70"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-mono font-bold text-amber-800 tabular-nums">
                          {idx + 1}. {formatPolishDateChip(day.date)}
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-slate-900 tabular-nums">
                          {day.startTime}–{day.estimatedEndTime}
                        </span>
                        {(day.activeBreaks?.length ?? 0) > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">
                            przerwa:{' '}
                            {day.activeBreaks!
                              .map((b) => `${b.startTime}–${b.endTime}`)
                              .join(', ')}
                          </span>
                        )}
                      </div>
                      <div className="text-slate-700 font-medium leading-snug">
                        {day.streetNames.join(', ')}
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1 shrink-0 font-mono text-[11px] text-slate-600 tabular-nums">
                      <span className="font-semibold text-slate-900">
                        {day.stops.length} pkt
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {day.estimatedRoutes
                          .map((r) => `Ks.${r.priestId}: ${r.orderedStops.length}`)
                          .join(' · ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Persistent Live Simulation Summary + Apply Bar */}
      <div className="bg-slate-900 text-white rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5 text-xs">
          {simulation && simulation.simulatedDays.length > 0 ? (
            <>
              <div className="font-semibold flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
                <span className="inline-flex items-center gap-1 text-amber-300">
                  <CalendarDays className="w-3.5 h-3.5" />
                  Symulacja: {simulation.simulatedDays.length} dni kolędy
                </span>
                <span className="text-slate-300">
                  ({formatPolishDateChip(simulation.simulatedDays[0].date)} –{' '}
                  {formatPolishDateChip(
                    simulation.simulatedDays[simulation.simulatedDays.length - 1]
                      .date
                  )}
                  )
                </span>
              </div>
              <div className="text-[11px] text-slate-300 tabular-nums">
                Nowych punktów: <strong>{simulation.newlyScheduledCount}</strong>
                {simulation.excludedHolidaysUsed.length > 0 &&
                  ` · Pominięto ${simulation.excludedHolidaysUsed.length} dni wolnych`}
                {simulation.skippedPermanentDeclineCount > 0 &&
                  ` · Wykluczono ${simulation.skippedPermanentDeclineCount} stałych odmów`}
              </div>
            </>
          ) : (
            <span className="text-slate-300">
              Dodaj domy parafii i sprawdź aktywne dni kalendarza.
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {stepTab !== 'preview' && (
            <button
              type="button"
              onClick={() => setStepTab('preview')}
              className="min-h-[40px] px-3 py-2 text-xs font-medium bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors"
            >
              Sprawdź dni ({simulation?.simulatedDays.length ?? 0})
            </button>
          )}
          <button
            type="button"
            disabled={!parish || !simulation || simulation.newlyScheduledCount === 0}
            onClick={() => onApplySchedule(effectiveSimMode)}
            className="min-h-[40px] px-4 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-400 text-white rounded-xl inline-flex items-center gap-1.5 transition-colors"
          >
            <Check className="w-4 h-4" />
            <span>
              {effectiveSimMode === 'unscheduled'
                ? `Dopisuj brakujące (${simulation?.newlyScheduledCount ?? 0})`
                : plannedDays.length > 0
                  ? 'Zastosuj nowy plan całej parafii'
                  : 'Zastosuj harmonogram'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
