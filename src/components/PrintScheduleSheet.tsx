import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Download,
  ExternalLink,
  History,
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
  DayBreakWindow,
  DayPlanSummary,
  LatLng,
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
  ScheduledStopItem,
  SeasonPlanConfig,
  VisitStop,
} from '../types/parish';
import { PrintableRouteMap } from './PrintableRouteMap';
import { SeasonCalendarPlanner } from './SeasonCalendarPlanner';
import {
  addDaysToIsoDate,
  buildAnnouncementDays,
  collectReturnVisitCandidates,
  exportFullSeasonToCsv,
  formatAnnouncementsPlainText,
  formatPolishDateChip,
  formatPolishDateFull,
  formatPolishWeekdayFull,
  getDayActiveBreaks,
} from '../utils/seasonScheduler';
import {
  buildGoogleMapsStageUrls,
  exportScheduleToCsv,
  extractHouseNumberLabel,
  extractHouseNumberSortKey,
  extractStreetName,
  formatDistance,
  formatDurationMillis,
  formatMinutesLabel,
  getStopUnitCount,
  isBlockStop,
  isEvenHouseNumberStr,
} from '../utils/spatial';

interface RouteStreetStage {
  streetName: string;
  startTime: string;
  endTime: string;
  items: ScheduledStopItem[];
  firstHouse: string;
  lastHouse: string;
  blockCount: number;
  unitsTotal: number;
  directionHint: string;
}

function buildRouteStreetStages(
  orderedStops: ScheduledStopItem[]
): RouteStreetStage[] {
  if (orderedStops.length === 0) return [];
  const groups: Array<{ streetName: string; items: ScheduledStopItem[] }> = [];

  for (const item of orderedStops) {
    const street = extractStreetName(item.stop);
    const prev = groups[groups.length - 1];
    if (prev && prev.streetName === street) {
      prev.items.push(item);
    } else {
      groups.push({ streetName: street, items: [item] });
    }
  }

  return groups.map((g) => {
    const first = g.items[0];
    const last = g.items[g.items.length - 1];
    const houseLabels = g.items.map((i) => extractHouseNumberLabel(i.stop));
    const numericPairs = houseLabels
      .map((lbl) => ({
        lbl,
        key: extractHouseNumberSortKey(lbl),
        even: isEvenHouseNumberStr(lbl),
      }))
      .filter((p) => p.lbl && p.key < Number.MAX_SAFE_INTEGER);

    const firstHouse = houseLabels[0] || '';
    const lastHouse = houseLabels[houseLabels.length - 1] || '';

    let trend = '';
    if (numericPairs.length >= 2) {
      let up = 0;
      let down = 0;
      for (let i = 1; i < numericPairs.length; i++) {
        if (numericPairs[i].key > numericPairs[i - 1].key) up += 1;
        else if (numericPairs[i].key < numericPairs[i - 1].key) down += 1;
      }
      const totalSteps = up + down;
      if (totalSteps > 0) {
        if (up / totalSteps >= 0.7 && numericPairs[numericPairs.length - 1].key > numericPairs[0].key) {
          trend = 'rosnąco';
        } else if (
          down / totalSteps >= 0.7 &&
          numericPairs[numericPairs.length - 1].key < numericPairs[0].key
        ) {
          trend = 'malejąco';
        }
      }
    }

    let parity = '';
    if (numericPairs.length >= 3) {
      const allEven = numericPairs.every((p) => p.even === true);
      const allOdd = numericPairs.every((p) => p.even === false);
      if (allEven) parity = 'parzyste';
      else if (allOdd) parity = 'nieparzyste';
    }

    let directionHint = '';
    if (g.items.length === 1) {
      directionHint = firstHouse ? `nr ${firstHouse}` : '1 punkt';
    } else if (firstHouse && lastHouse && firstHouse !== lastHouse) {
      const qualifiers = [trend, parity].filter(Boolean).join(', ');
      directionHint = `od nr ${firstHouse} do nr ${lastHouse}${
        qualifiers ? ` (${qualifiers})` : ''
      }`;
    } else if (firstHouse) {
      directionHint = `nr ${firstHouse} (${g.items.length} pkt)`;
    } else {
      directionHint = `${g.items.length} pkt`;
    }

    let blockCount = 0;
    let unitsTotal = 0;
    for (const item of g.items) {
      if (isBlockStop(item.stop)) {
        blockCount += 1;
        unitsTotal += getStopUnitCount(item.stop);
      }
    }

    return {
      streetName: g.streetName,
      startTime: first.arrivalTime,
      endTime: last.departureTime || last.arrivalTime,
      items: g.items,
      firstHouse,
      lastHouse,
      blockCount,
      unitsTotal,
      directionHint,
    };
  });
}

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
    endTime: string,
    breaks?: DayBreakWindow[]
  ) => void;
  onScheduleReturnVisits?: (targetDate: string) => void;
  onGoToDayPlanner?: () => void;
  onEditDayInPlanner?: (date: string) => void;
  onDeleteDayRoute?: (date: string) => void;
  onStartNewSeason?: (excludeDeclined: boolean) => void;
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
  onStartNewSeason,
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
  const [editingDayBreaks, setEditingDayBreaks] = useState<DayBreakWindow[]>([]);
  const [returnVisitDate, setReturnVisitDate] = useState<string>('');
  const [excludeDeclinedRollover, setExcludeDeclinedRollover] = useState<boolean>(true);
  const [expandedDayDate, setExpandedDayDate] = useState<string | null>(null);
  const [expandedFullListKeys, setExpandedFullListKeys] = useState<
    Record<string, boolean>
  >({});

  const effectiveViewMode = forcedViewMode ?? viewMode;

  const selectedDayBreaks = useMemo(
    () =>
      selectedDate && seasonConfig
        ? getDayActiveBreaks(selectedDate, seasonConfig)
        : [],
    [selectedDate, seasonConfig]
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

  const renderDayItineraryBreakdown = (day: DayPlanSummary) => {
    const isExact = Boolean(exactDayKeys[day.date]);
    const dayRoutes = day.estimatedRoutes;
    if (dayRoutes.length === 0) return null;

    return (
      <div className="no-print bg-slate-50/80 border border-slate-200 rounded-xl p-3.5 sm:p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
          <div>
            <div className="text-xs font-semibold text-slate-900">
              Rozpiska przejścia tego dnia
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums">
              {isExact
                ? 'Dokładna trasa drogowa'
                : 'Szacowana kolejność trasy'}{' '}
              · {day.stops.length} pkt · {formatDistance(day.totalDistanceMeters)}
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpandedDayDate(null);
            }}
            className="min-h-[34px] px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1 shrink-0"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            <span>Zwiń</span>
          </button>
        </div>

        <div className="space-y-4">
          {dayRoutes.map((route) => {
            const stages = buildRouteStreetStages(route.orderedStops);
            const firstItem = route.orderedStops[0];
            const lastItem = route.orderedStops[route.orderedStops.length - 1];
            const firstStage = stages[0];
            const lastStage = stages[stages.length - 1];
            const listKey = `${day.date}:${route.priestId}`;
            const showFullList = Boolean(expandedFullListKeys[listKey]);
            const startClock = firstItem?.arrivalTime || day.startTime;

            return (
              <div
                key={route.priestId}
                className="space-y-3 pt-1 first:pt-0 border-t border-slate-200 first:border-t-0"
              >
                {dayRoutes.length > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-900">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: route.color }}
                      />
                      <span>{route.priestName}</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-600 tabular-nums">
                      {startClock}–{route.endTime} · {route.orderedStops.length} pkt ·{' '}
                      {formatDistance(route.totalDistanceMeters)}
                    </div>
                  </div>
                )}

                {/* Gdzie i jak zaczynam -> Gdzie kończę */}
                {firstItem && lastItem && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="bg-white border border-emerald-200 rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-700 text-white text-[10px] font-bold tracking-wide">
                          START
                        </span>
                        <span className="text-xs font-mono font-semibold text-emerald-900 tabular-nums">
                          godz. {firstItem.arrivalTime}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-900">
                        {firstItem.stop.address || firstItem.stop.label}
                        {isBlockStop(firstItem.stop) && (
                          <span className="ml-1.5 text-[11px] font-normal text-amber-800">
                            (Blok
                            {getStopUnitCount(firstItem.stop) > 0
                              ? ` · ${getStopUnitCount(firstItem.stop)} lok.`
                              : ''}
                            )
                          </span>
                        )}
                      </div>
                      {firstStage && (
                        <div className="text-[11px] text-slate-600 leading-snug">
                          Jak zaczynasz: ul. {firstStage.streetName} —{' '}
                          {firstStage.directionHint}
                        </div>
                      )}
                    </div>

                    <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-900 text-white text-[10px] font-bold tracking-wide">
                          META
                        </span>
                        <span className="text-xs font-mono font-semibold text-slate-800 tabular-nums">
                          ok. {route.endTime}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-900">
                        {lastItem.stop.address || lastItem.stop.label}
                        {isBlockStop(lastItem.stop) && (
                          <span className="ml-1.5 text-[11px] font-normal text-amber-800">
                            (Blok
                            {getStopUnitCount(lastItem.stop) > 0
                              ? ` · ${getStopUnitCount(lastItem.stop)} lok.`
                              : ''}
                            )
                          </span>
                        )}
                      </div>
                      {lastStage && (
                        <div className="text-[11px] text-slate-600 leading-snug">
                          Zakończenie: ul. {lastStage.streetName} (ostatnie wejście{' '}
                          <span className="font-mono tabular-nums">
                            {lastItem.arrivalTime}
                          </span>
                          )
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Ulice po kolei — etapy przejścia */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-700">
                    Kolejność ulic i numerów ({stages.length}{' '}
                    {stages.length === 1
                      ? 'odcinek'
                      : stages.length < 5
                        ? 'odcinki'
                        : 'odcinków'}
                    ):
                  </div>

                  <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {stages.map((st, sIdx) => {
                      const numberTokens = st.items.map((item) => {
                        const nr =
                          extractHouseNumberLabel(item.stop) ||
                          item.stop.label ||
                          item.stop.address;
                        const blk = isBlockStop(item.stop);
                        const uCnt = getStopUnitCount(item.stop);
                        if (blk) {
                          return uCnt > 0 ? `${nr} (blok ${uCnt} lok.)` : `${nr} (blok)`;
                        }
                        return nr;
                      });

                      return (
                        <div
                          key={`${st.streetName}-${sIdx}`}
                          className="p-2.5 sm:px-3 space-y-1"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                            <div className="text-xs font-semibold text-slate-900">
                              <span className="font-mono text-amber-800 mr-1.5 tabular-nums">
                                {sIdx + 1}.
                              </span>
                              ul. {st.streetName}
                            </div>
                            <div className="text-[11px] font-mono text-slate-600 tabular-nums shrink-0">
                              {st.startTime}–{st.endTime} · {st.items.length} pkt
                              {st.blockCount > 0 && (
                                <span className="text-amber-800">
                                  {' '}
                                  ({st.blockCount} bl.
                                  {st.unitsTotal > 0 ? ` / ${st.unitsTotal} lok.` : ''})
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="text-[11px] font-medium text-slate-700 tabular-nums">
                            {st.directionHint}
                          </div>

                          <div className="text-[11px] font-mono text-slate-600 leading-relaxed break-words tabular-nums">
                            <span className="font-sans text-slate-400 mr-1">
                              Kolejność:
                            </span>
                            {numberTokens.join(' → ')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Opcjonalna pełna lista dom po domu z godzinami */}
                {route.orderedStops.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedFullListKeys((prev) => ({
                          ...prev,
                          [listKey]: !prev[listKey],
                        }));
                      }}
                      className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1.5"
                    >
                      {showFullList ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {showFullList
                          ? 'Ukryj dokładną listę godzinową'
                          : `Pokaż wszystkie punkty z godzinami (${route.orderedStops.length})`}
                      </span>
                    </button>

                    {showFullList && (
                      <div className="mt-2 bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-72 overflow-y-auto">
                        {route.orderedStops.map((item, idx) => {
                          const isStart = idx === 0;
                          const isEnd = idx === route.orderedStops.length - 1;
                          const blk = isBlockStop(item.stop);
                          const uCnt = getStopUnitCount(item.stop);
                          return (
                            <div
                              key={item.stop.id}
                              className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-mono text-[11px] font-semibold text-slate-500 w-6 shrink-0 tabular-nums">
                                  {item.orderIndex}.
                                </span>
                                <span className="font-mono text-[11px] font-semibold text-slate-900 shrink-0 tabular-nums">
                                  {item.arrivalTime}
                                </span>
                                <span className="text-slate-900 font-medium truncate">
                                  {item.stop.address || item.stop.label}
                                </span>
                              </div>
                              <div className="shrink-0 flex items-center gap-1.5 text-[10px]">
                                {isStart && (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-700 text-white font-bold">
                                    START
                                  </span>
                                )}
                                {isEnd && !isStart && (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white font-bold">
                                    META
                                  </span>
                                )}
                                {blk && (
                                  <span className="text-amber-800 font-semibold tabular-nums">
                                    Blok{uCnt > 0 ? ` (${uCnt})` : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
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
                  <SeasonCalendarPlanner
                    parish={parish}
                    stops={stops}
                    config={config}
                    seasonConfig={seasonConfig}
                    plannedDays={plannedDays}
                    unscheduledCount={unscheduledCount}
                    onChangeSeasonConfig={onChangeSeasonConfig}
                    onApplySchedule={(mode) => {
                      onAutoScheduleSeason(mode);
                      setShowAutoScheduler(false);
                    }}
                    onClose={
                      plannedDays.length > 0
                        ? () => setShowAutoScheduler(false)
                        : undefined
                    }
                  />
                )}
            </div>
          )}

          {/* Direct Map Preview Banner for Scheduled Days */}
          {plannedDays.length > 0 && (
            <div className="no-print bg-slate-900 text-white rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="text-xs space-y-0.5">
                <div className="font-semibold text-white">
                  Gotowy podgląd tras dzień po dniu na mapie
                </div>
                <div className="text-slate-300 tabular-nums">
                  {plannedDays.length} dni kolędy ({formatPolishDateChip(plannedDays[0].date)} –{' '}
                  {formatPolishDateChip(plannedDays[plannedDays.length - 1].date)}) · kliknij
                  wybrany dzień poniżej lub otwórz interaktywny podgląd całej kolejności.
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onViewDayOnMap(selectedDate ?? plannedDays[0].date)
                }
                className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                <MapIcon className="w-4 h-4" />
                <span>Otwórz podgląd tras na mapie</span>
              </button>
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

          {/* New Season Rollover (Memory from previous year) */}
          {stops.length > 0 && onStartNewSeason && (() => {
            const hasActiveData =
              plannedDays.length > 0 ||
              stops.some(
                (s) =>
                  (s.visitStatus && s.visitStatus !== 'pending') ||
                  Boolean(s.units?.some((u) => u.status && u.status !== 'pending'))
              );
            if (!hasActiveData) return null;
            const declinedCount = stops.filter(
              (s) => s.visitStatus === 'declined'
            ).length;
            const acceptedCount = stops.filter(
              (s) => s.visitStatus === 'accepted'
            ).length;
            return (
              <div className="no-print bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <History className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" />
                  <div className="space-y-1 min-w-0">
                    <h3 className="text-xs font-semibold text-slate-900">
                      Pamięć z poprzedniego roku — rozpocznij nowy sezon kolędowy
                    </h3>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      Zapisuje wyniki tegorocznych wizyt (
                      <span className="font-mono tabular-nums">
                        {acceptedCount} przyjętych, {declinedCount} odmów
                      </span>
                      ) jako historię „Rok temu”, zeruje terminy i kolejność na
                      nowy rok, zachowując wszystkie ulice, bloki i nazwiska rodzin.
                    </p>
                    <label className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-800 cursor-pointer pt-0.5">
                      <input
                        type="checkbox"
                        checked={excludeDeclinedRollover}
                        onChange={(e) =>
                          setExcludeDeclinedRollover(e.target.checked)
                        }
                        className="w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600"
                      />
                      <span>
                        Oznacz domy z „Odmową” jako stałą odmowę (pomiń je domyślnie w planie nowego roku)
                      </span>
                    </label>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onStartNewSeason(excludeDeclinedRollover)}
                  className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                >
                  <History className="w-3.5 h-3.5 text-amber-700" />
                  <span>Rozpocznij nowy sezon</span>
                </button>
              </div>
            );
          })()}

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
                      const isExpanded = expandedDayDate === day.date;
                      return (
                        <React.Fragment key={day.date}>
                          <tr
                            onClick={() =>
                              setExpandedDayDate((prev) =>
                                prev === day.date ? null : day.date
                              )
                            }
                            aria-expanded={isExpanded}
                            className={`cursor-pointer transition-colors ${
                              isExpanded
                                ? 'bg-amber-50/40'
                                : 'hover:bg-slate-50/60'
                            }`}
                          >
                            <td className="py-3 px-4 print:py-1.5 print:px-2 whitespace-nowrap print:whitespace-normal align-top">
                              <div className="flex items-center gap-1.5">
                                <ChevronRight
                                  className={`no-print w-3.5 h-3.5 text-slate-400 transition-transform shrink-0 ${
                                    isExpanded ? 'rotate-90 text-amber-700' : ''
                                  }`}
                                />
                                <div>
                                  <div className="text-xs font-semibold text-slate-900 tabular-nums">
                                    {day.date}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {formatPolishWeekdayFull(day.date)}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4 print:py-1.5 print:px-2 font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap print:whitespace-normal align-top">
                              <div>
                                {day.startTime} – {day.estimatedEndTime}
                              </div>
                              {(day.activeBreaks?.length ?? 0) > 0 && (
                                <div className="text-[10px] font-sans font-normal text-slate-500 mt-0.5">
                                  Przerwa:{' '}
                                  {day.activeBreaks!
                                    .map((b) => `${b.startTime}–${b.endTime}`)
                                    .join(', ')}
                                </div>
                              )}
                              {onUpdateDayTimeWindow && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isEditingHours) {
                                      setEditingHoursDate(null);
                                    } else {
                                      setEditingHoursStart(day.startTime);
                                      setEditingHoursEnd(
                                        day.plannedEndTime ||
                                          seasonConfig?.dailyEndTime ||
                                          '20:30'
                                      );
                                      setEditingDayBreaks(
                                        day.activeBreaks ? [...day.activeBreaks] : []
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
                              <div className="no-print text-[11px] text-amber-800 font-medium mt-0.5">
                                {isExpanded
                                  ? 'Ukryj rozpiskę przejścia'
                                  : 'Kliknij wiersz, aby zobaczyć start, ulice i koniec'}
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
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onEditDayInPlanner(day.date);
                                    }}
                                    className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1"
                                  >
                                    <Pencil className="w-3 h-3 text-slate-500" />
                                    Edytuj
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onViewDayOnMap(day.date);
                                  }}
                                  className="px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1"
                                >
                                  <MapIcon className="w-3.5 h-3.5 text-amber-700" />
                                  Mapa
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
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
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDeleteDayRoute(day.date);
                                    }}
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
                          {isExpanded && (
                            <tr className="no-print bg-slate-50/40">
                              <td colSpan={6} className="p-3 sm:p-4">
                                {renderDayItineraryBreakdown(day)}
                              </td>
                            </tr>
                          )}
                          {isEditingHours && onUpdateDayTimeWindow && (
                            <tr className="no-print bg-slate-50">
                              <td colSpan={6} className="px-4 py-3 space-y-2">
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
                                    onClick={() =>
                                      setEditingDayBreaks((prev) => [
                                        ...prev,
                                        {
                                          id: `dbrk_${Date.now().toString(36)}`,
                                          startTime: '17:30',
                                          endTime: '18:30',
                                          label: 'Przerwa',
                                        },
                                      ])
                                    }
                                    className="min-h-[34px] px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg"
                                  >
                                    + Przerwa
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onUpdateDayTimeWindow(
                                        day.date,
                                        editingHoursStart,
                                        editingHoursEnd,
                                        editingDayBreaks
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
                                {editingDayBreaks.length > 0 && (
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    {editingDayBreaks.map((bw, bIdx) => (
                                      <div
                                        key={bw.id}
                                        className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1"
                                      >
                                        <input
                                          type="text"
                                          value={bw.label ?? ''}
                                          placeholder="Przerwa"
                                          onChange={(e) =>
                                            setEditingDayBreaks((prev) =>
                                              prev.map((item, i) =>
                                                i === bIdx
                                                  ? { ...item, label: e.target.value }
                                                  : item
                                              )
                                            )
                                          }
                                          className="w-20 text-xs border-b border-slate-200 focus:outline-none"
                                        />
                                        <input
                                          type="time"
                                          value={bw.startTime}
                                          onChange={(e) =>
                                            setEditingDayBreaks((prev) =>
                                              prev.map((item, i) =>
                                                i === bIdx
                                                  ? { ...item, startTime: e.target.value }
                                                  : item
                                              )
                                            )
                                          }
                                          className="text-xs font-mono"
                                        />
                                        <span>–</span>
                                        <input
                                          type="time"
                                          value={bw.endTime}
                                          onChange={(e) =>
                                            setEditingDayBreaks((prev) =>
                                              prev.map((item, i) =>
                                                i === bIdx
                                                  ? { ...item, endTime: e.target.value }
                                                  : item
                                              )
                                            )
                                          }
                                          className="text-xs font-mono"
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setEditingDayBreaks((prev) =>
                                              prev.filter((_, i) => i !== bIdx)
                                            )
                                          }
                                          className="text-red-600 hover:text-red-800 px-1"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
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
                  const isExpanded = expandedDayDate === day.date;
                  return (
                    <div
                      key={day.date}
                      className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedDayDate((prev) =>
                            prev === day.date ? null : day.date
                          )
                        }
                        aria-expanded={isExpanded}
                        className="w-full text-left space-y-2.5 rounded-lg -m-1 p-1 hover:bg-slate-50/70 transition-colors"
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

                        <div className="text-xs text-slate-700 leading-relaxed space-y-1">
                          <div>
                            <span className="text-slate-500">Ulice: </span>
                            <span className="font-medium text-slate-900">
                              {day.streetNames.join(', ')}
                            </span>
                          </div>
                          {(day.activeBreaks?.length ?? 0) > 0 && (
                            <div className="text-[11px] text-slate-500">
                              Przerwy:{' '}
                              {day.activeBreaks!
                                .map(
                                  (b) =>
                                    `${b.startTime}–${b.endTime}${b.label ? ` (${b.label})` : ''}`
                                )
                                .join(', ')}
                            </div>
                          )}
                          <div className="pt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800">
                            {isExpanded ? (
                              <>
                                <ChevronUp className="w-3.5 h-3.5" />
                                <span>Ukryj rozpiskę (start, ulice, koniec)</span>
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3.5 h-3.5" />
                                <span>Dotknij, aby zobaczyć gdzie start, ulice i koniec</span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>

                      {isExpanded && renderDayItineraryBreakdown(day)}

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
                          {editingDayBreaks.length > 0 && (
                            <div className="space-y-1.5">
                              {editingDayBreaks.map((bw, bIdx) => (
                                <div
                                  key={bw.id}
                                  className="flex items-center justify-between gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs"
                                >
                                  <input
                                    type="time"
                                    value={bw.startTime}
                                    onChange={(e) =>
                                      setEditingDayBreaks((prev) =>
                                        prev.map((item, i) =>
                                          i === bIdx
                                            ? { ...item, startTime: e.target.value }
                                            : item
                                        )
                                      )
                                    }
                                    className="font-mono text-xs"
                                  />
                                  <span>–</span>
                                  <input
                                    type="time"
                                    value={bw.endTime}
                                    onChange={(e) =>
                                      setEditingDayBreaks((prev) =>
                                        prev.map((item, i) =>
                                          i === bIdx
                                            ? { ...item, endTime: e.target.value }
                                            : item
                                        )
                                      )
                                    }
                                    className="font-mono text-xs"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingDayBreaks((prev) =>
                                        prev.filter((_, i) => i !== bIdx)
                                      )
                                    }
                                    className="text-red-600 px-1 font-bold"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setEditingDayBreaks((prev) => [
                                  ...prev,
                                  {
                                    id: `dbrk_${Date.now().toString(36)}`,
                                    startTime: '17:30',
                                    endTime: '18:30',
                                    label: 'Przerwa',
                                  },
                                ])
                              }
                              className="min-h-[36px] px-2.5 py-1 text-xs font-medium bg-white border border-slate-200 rounded-lg"
                            >
                              + Przerwa
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onUpdateDayTimeWindow(
                                  day.date,
                                  editingHoursStart,
                                  editingHoursEnd,
                                  editingDayBreaks
                                );
                                setEditingHoursDate(null);
                              }}
                              className="flex-1 min-h-[36px] px-3 py-1 text-xs font-semibold text-white bg-amber-700 rounded-lg"
                            >
                              Zapisz
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingHoursDate(null)}
                              className="min-h-[36px] px-2 py-1 text-xs text-slate-600"
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
                                setEditingDayBreaks(
                                  day.activeBreaks ? [...day.activeBreaks] : []
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
                {selectedDayBreaks.length > 0 && (
                  <>
                    {' '}
                    · Przerwa:{' '}
                    <strong className="text-slate-900">
                      {selectedDayBreaks
                        .map(
                          (b) =>
                            `${b.startTime}–${b.endTime}${b.label ? ` (${b.label})` : ''}`
                        )
                        .join(', ')}
                    </strong>
                  </>
                )}
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
