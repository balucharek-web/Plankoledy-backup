import {
  AutoSeasonSimulationResult,
  DayBreakWindow,
  DayPlanSummary,
  LatLng,
  PRIEST_PALETTE,
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
  ScheduledStopItem,
  SeasonPlanConfig,
  SeasonPlanningRules,
  VisitStop,
} from '../types/parish';
import {
  addMinutesToHHMM,
  extractHouseNumberLabel,
  extractHouseNumberSortKey,
  extractStreetName,
  formatStreetHouseRange,
  getStopUnitCount,
  isBlockStop,
  isEvenHouseNumberStr,
  partitionStopsBySector,
} from './spatial';

const POLISH_WEEKDAYS_SHORT = [
  'Nd',
  'Pon',
  'Wt',
  'Śr',
  'Czw',
  'Pt',
  'Sob',
];

const POLISH_WEEKDAYS_FULL = [
  'Niedziela',
  'Poniedziałek',
  'Wtorek',
  'Środa',
  'Czwartek',
  'Piątek',
  'Sobota',
];

const POLISH_MONTHS_SHORT = [
  'sty',
  'lut',
  'mar',
  'kwi',
  'maj',
  'cze',
  'lip',
  'sie',
  'wrz',
  'paź',
  'lis',
  'gru',
];

export const WEEKDAY_OPTIONS = [
  { dayIndex: 1, short: 'Pn', full: 'Poniedziałek' },
  { dayIndex: 2, short: 'Wt', full: 'Wtorek' },
  { dayIndex: 3, short: 'Śr', full: 'Środa' },
  { dayIndex: 4, short: 'Cz', full: 'Czwartek' },
  { dayIndex: 5, short: 'Pt', full: 'Piątek' },
  { dayIndex: 6, short: 'Sb', full: 'Sobota' },
  { dayIndex: 0, short: 'Nd', full: 'Niedziela' },
] as const;

export function parseIsoDateLocal(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  return new Date(year, month, day, 12, 0, 0);
}

export function formatIsoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysToIsoDate(dateStr: string, days: number): string {
  const d = parseIsoDateLocal(dateStr);
  d.setDate(d.getDate() + days);
  return formatIsoDateLocal(d);
}

export function getPolishWeekdayIndex(dateStr: string): number {
  return parseIsoDateLocal(dateStr).getDay();
}

export function isWeekendDate(dateStr: string): boolean {
  const day = getPolishWeekdayIndex(dateStr);
  return day === 0 || day === 6;
}

export function formatPolishWeekdayShort(dateStr: string): string {
  return POLISH_WEEKDAYS_SHORT[getPolishWeekdayIndex(dateStr)] ?? '';
}

export function formatPolishWeekdayFull(dateStr: string): string {
  return POLISH_WEEKDAYS_FULL[getPolishWeekdayIndex(dateStr)] ?? '';
}

export function formatPolishDateShort(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return dateStr;
  return `${match[3]}.${match[2]}`;
}

export function formatPolishDateChip(dateStr: string): string {
  return `${formatPolishWeekdayShort(dateStr)} ${formatPolishDateShort(dateStr)}`;
}

export function formatPolishDateFull(dateStr: string): string {
  const d = parseIsoDateLocal(dateStr);
  const weekday = POLISH_WEEKDAYS_FULL[d.getDay()] ?? '';
  const month = POLISH_MONTHS_SHORT[d.getMonth()] ?? '';
  return `${weekday}, ${d.getDate()} ${month} ${d.getFullYear()}`;
}

export function parseHHMMToMinutes(hhmm: string, fallback = 930): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
  if (!match) return fallback;
  const h = Math.max(0, Math.min(23, Number.parseInt(match[1], 10)));
  const m = Math.max(0, Math.min(59, Number.parseInt(match[2], 10)));
  return h * 60 + m;
}

export function parseWeekdaysMask(mask: string): Set<number> {
  const set = new Set<number>();
  for (const part of (mask ?? '').split(',')) {
    const n = Number.parseInt(part.trim(), 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 6) {
      set.add(n);
    }
  }
  if (set.size === 0) {
    [1, 2, 3, 4, 5, 6].forEach((d) => set.add(d));
  }
  return set;
}

export function toggleWeekdayInMask(mask: string, dayIndex: number): string {
  const set = parseWeekdaysMask(mask);
  if (set.has(dayIndex)) {
    if (set.size > 1) set.delete(dayIndex);
  } else {
    set.add(dayIndex);
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.filter((d) => set.has(d)).join(',');
}

export const DEFAULT_PLANNING_RULES: SeasonPlanningRules = {
  splitMode: 'whole_or_half',
  zoneDirection: 'clockwise',
  blockPreference: 'any',
  safetyBufferMinutes: 15,
};

/**
 * Computes traditional Polish Christmas & New Year holiday dates for the kolęda season anchored by startDateIso.
 */
export function getPolishKoledaHolidayDates(startDateIso: string): string[] {
  const start = parseIsoDateLocal(startDateIso);
  const month = start.getMonth() + 1;
  const seasonBaseYear = month <= 4 ? start.getFullYear() - 1 : start.getFullYear();
  return [
    `${seasonBaseYear}-12-24`, // Wigilia
    `${seasonBaseYear}-12-25`, // Boże Narodzenie I
    `${seasonBaseYear}-12-26`, // Boże Narodzenie II
    `${seasonBaseYear}-12-31`, // Sylwester
    `${seasonBaseYear + 1}-01-01`, // Nowy Rok
    `${seasonBaseYear + 1}-01-06`, // Objawienie Pańskie (Trzech Króli)
  ];
}

/**
 * Finds First Fridays of the month within the season window (min 60 days scan from startDateIso).
 */
export function getFirstFridayDatesInSeason(
  startDateIso: string,
  endDateIso?: string
): string[] {
  const out: string[] = [];
  const limitIso =
    endDateIso && endDateIso >= startDateIso
      ? endDateIso
      : addDaysToIsoDate(startDateIso, 75);
  for (let offset = 0; offset <= 120; offset++) {
    const iso = addDaysToIsoDate(startDateIso, offset);
    if (iso > limitIso) break;
    const d = parseIsoDateLocal(iso);
    if (d.getDay() === 5 && d.getDate() <= 7) {
      out.push(iso);
    }
  }
  return out;
}

export function getDayStartTime(
  dateStr: string | null | undefined,
  seasonConfig: SeasonPlanConfig,
  fallbackStartTime: string
): string {
  if (!dateStr) return fallbackStartTime;
  const override = seasonConfig.dayTimeOverrides?.[dateStr]?.startTime;
  if (override && /^\d{1,2}:\d{2}$/.test(override.trim())) {
    return override.trim();
  }
  const weekday = getPolishWeekdayIndex(dateStr);
  if (weekday === 6) {
    return (
      seasonConfig.saturdayStartTime ||
      seasonConfig.weekendStartTime ||
      fallbackStartTime
    );
  }
  if (weekday === 0) {
    return seasonConfig.weekendStartTime || fallbackStartTime;
  }
  return seasonConfig.weekdayStartTime || fallbackStartTime;
}

export function getDayEndTime(
  dateStr: string | null | undefined,
  seasonConfig: SeasonPlanConfig,
  fallbackEndTime = '20:30'
): string {
  if (dateStr) {
    const override = seasonConfig.dayTimeOverrides?.[dateStr]?.endTime;
    if (override && /^\d{1,2}:\d{2}$/.test(override.trim())) {
      return override.trim();
    }
  }
  return seasonConfig.dailyEndTime || fallbackEndTime;
}

export function getDayActiveBreaks(
  dateStr: string | null | undefined,
  seasonConfig: SeasonPlanConfig
): DayBreakWindow[] {
  const raw =
    dateStr && seasonConfig.dayTimeOverrides?.[dateStr]?.breaks !== undefined
      ? seasonConfig.dayTimeOverrides[dateStr].breaks ?? []
      : seasonConfig.defaultBreaks ?? [];

  if (!Array.isArray(raw) || raw.length === 0) return [];

  return raw
    .filter((bw) => {
      const s = parseHHMMToMinutes(bw.startTime, -1);
      const e = parseHHMMToMinutes(bw.endTime, -1);
      return s >= 0 && e > s;
    })
    .sort(
      (a, b) =>
        parseHHMMToMinutes(a.startTime) - parseHHMMToMinutes(b.startTime)
    );
}

export function computeBreakOverlapMinutes(
  windowStartAbs: number,
  windowEndAbs: number,
  breaks: DayBreakWindow[]
): number {
  if (breaks.length === 0 || windowEndAbs <= windowStartAbs) return 0;
  let total = 0;
  for (const bw of breaks) {
    const bs = parseHHMMToMinutes(bw.startTime, 0);
    const be = parseHHMMToMinutes(bw.endTime, 0);
    if (be <= bs) continue;
    const overlapStart = Math.max(windowStartAbs, bs);
    const overlapEnd = Math.min(windowEndAbs, be);
    if (overlapEnd > overlapStart) {
      total += overlapEnd - overlapStart;
    }
  }
  return total;
}

/**
 * Advances route clock cleanly over configured breaks (lunch, evening Mass, etc.),
 * preventing house visits from overlapping break windows.
 */
export function advanceStopClockWithBreaks(
  currentAbsMinutes: number,
  travelMinutes: number,
  visitMinutes: number,
  isMultiUnit: boolean,
  breaks: DayBreakWindow[]
): {
  arrivalAbs: number;
  departureAbs: number;
  endCursorAbs: number;
} {
  let arrival = currentAbsMinutes + travelMinutes;
  const normalizedBreaks = breaks
    .map((b) => ({
      start: parseHHMMToMinutes(b.startTime, 0),
      end: parseHHMMToMinutes(b.endTime, 0),
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  if (normalizedBreaks.length === 0) {
    const dep = arrival + visitMinutes;
    return { arrivalAbs: arrival, departureAbs: dep, endCursorAbs: dep };
  }

  // Push arrival out if arriving inside a break
  for (const br of normalizedBreaks) {
    if (arrival >= br.start && arrival < br.end) {
      arrival = br.end;
    }
  }

  // For single houses / compact stops, defer stop until after break if visit overlaps break start
  if (!isMultiUnit || visitMinutes <= 45) {
    let shifted = true;
    let guard = 0;
    while (shifted && guard < 10) {
      shifted = false;
      guard += 1;
      for (const br of normalizedBreaks) {
        if (arrival < br.end && arrival + visitMinutes > br.start) {
          arrival = br.end;
          shifted = true;
        }
      }
    }
    const dep = arrival + visitMinutes;
    return { arrivalAbs: arrival, departureAbs: dep, endCursorAbs: dep };
  }

  // For large blocks (> 45 min), pause during breaks inside the block visit and resume after
  let cursor = arrival;
  let remainingVisit = visitMinutes;
  for (const br of normalizedBreaks) {
    if (br.end <= cursor) continue;
    if (br.start >= cursor + remainingVisit) break;
    const preBreakWork = Math.max(0, br.start - cursor);
    remainingVisit = Math.max(0, remainingVisit - preBreakWork);
    cursor = br.end;
  }
  const dep = cursor + remainingVisit;
  return { arrivalAbs: arrival, departureAbs: dep, endCursorAbs: dep };
}

export function formatAbsMinutesToHHMM(absMinutes: number): string {
  const m = ((Math.round(absMinutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function getEffectiveStopDurationMinutes(
  stop: VisitStop,
  defaultVisitMinutes = 15
): number {
  if (!isBlockStop(stop)) {
    return Math.max(1, stop.durationMinutes || defaultVisitMinutes);
  }
  const perUnit = Math.max(3, stop.minutesPerUnit || 8);
  if (stop.units && stop.units.length > 0) {
    const activeUnits = stop.units.filter((u) => u.status !== 'declined');
    if (activeUnits.length === 0) return 2;
    const summed = activeUnits.reduce(
      (acc, u) => acc + (u.durationMinutes ?? perUnit),
      0
    );
    return Math.max(stop.durationMinutes || 0, summed);
  }
  const unitCount = getStopUnitCount(stop);
  if (unitCount > 1) {
    return Math.max(stop.durationMinutes || 0, unitCount * perUnit);
  }
  return Math.max(1, stop.durationMinutes || defaultVisitMinutes);
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const q =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng *
      sinLng;
  return 2 * R * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
}

function estimateLegMetrics(
  from: LatLng,
  to: LatLng,
  travelMode: PlanConfig['travelMode']
): { distanceMeters: number; durationMillis: number } {
  const straightMeters = haversineMeters(from, to);
  const roadMeters = Math.round(straightMeters * 1.3);
  if (travelMode === 'DRIVING') {
    const speedMetersPerSec = (28 * 1000) / 3600;
    const bufferSec = roadMeters > 40 ? 35 : 8;
    const durationSec = roadMeters / speedMetersPerSec + bufferSec;
    return {
      distanceMeters: roadMeters,
      durationMillis: Math.round(durationSec * 1000),
    };
  }
  const speedMetersPerSec = (4.2 * 1000) / 3600;
  const durationSec = roadMeters / speedMetersPerSec;
  return {
    distanceMeters: roadMeters,
    durationMillis: Math.round(durationSec * 1000),
  };
}

/**
 * Fast, deterministic client-side day route estimator.
 * Keeps adjacent houses on the same street contiguous and calculates exact arrival/departure windows respecting daily breaks.
 */
export function estimateDayRoutes(
  parish: ParishCenter,
  dayStops: VisitStop[],
  config: PlanConfig,
  startTimeOverride?: string,
  activeBreaks: DayBreakWindow[] = []
): {
  routes: PriestRouteResult[];
  endTime: string;
  totalDistanceMeters: number;
  totalVisitMinutes: number;
  totalTravelMillis: number;
} {
  const startTime = startTimeOverride || config.startTime;
  if (dayStops.length === 0) {
    return {
      routes: [],
      endTime: startTime,
      totalDistanceMeters: 0,
      totalVisitMinutes: 0,
      totalTravelMillis: 0,
    };
  }

  const normalized = dayStops.map((s) =>
    s.priestId > config.priestCount ? { ...s, priestId: 1 } : s
  );
  const activePriestIds = Array.from(
    new Set(normalized.map((s) => s.priestId))
  ).sort((a, b) => a - b);

  const routes: PriestRouteResult[] = [];
  let totalDistanceMeters = 0;
  let totalVisitMinutes = 0;
  let totalTravelMillis = 0;
  const startAbsBase = parseHHMMToMinutes(startTime, 930);
  let latestEndMinutes = startAbsBase;

  for (const priestId of activePriestIds) {
    const profile =
      PRIEST_PALETTE.find((p) => p.id === priestId) ?? PRIEST_PALETTE[0];
    const pool = [...normalized.filter((s) => s.priestId === priestId)];
    if (pool.length === 0) continue;

    const hasManualOrder = pool.some(
      (s) =>
        typeof s.manualOrder === 'number' &&
        !Number.isNaN(s.manualOrder) &&
        s.manualOrder > 0
    );

    const ordered: VisitStop[] = [];
    if (hasManualOrder) {
      const sorted = [...pool].sort(
        (a, b) =>
          (a.manualOrder ?? Number.MAX_SAFE_INTEGER) -
          (b.manualOrder ?? Number.MAX_SAFE_INTEGER)
      );
      ordered.push(...sorted);
    } else {
      let cursor = parish.location;
      let currentStreet = '';

      while (pool.length > 0) {
        let bestIdx = 0;
        let bestScore = Number.POSITIVE_INFINITY;
        for (let i = 0; i < pool.length; i++) {
          const candidate = pool[i];
          const dist = haversineMeters(cursor, candidate.location);
          const street = extractStreetName(candidate);
          const sameStreetBonus =
            currentStreet && street === currentStreet && dist < 450 ? 0.42 : 1;
          const score = dist * sameStreetBonus;
          if (score < bestScore) {
            bestScore = score;
            bestIdx = i;
          }
        }
        const chosen = pool.splice(bestIdx, 1)[0];
        ordered.push(chosen);
        cursor = chosen.location;
        currentStreet = extractStreetName(chosen);
      }
    }

    let cursorAbs = startAbsBase;
    let priestVisitMinutes = 0;
    let priestDistanceMeters = 0;
    let priestTravelMillis = 0;
    let prevPoint = parish.location;
    const pathPoints: LatLng[] = [parish.location];

    const scheduledItems: ScheduledStopItem[] = ordered.map((stop, idx) => {
      const leg = estimateLegMetrics(prevPoint, stop.location, config.travelMode);
      prevPoint = stop.location;
      pathPoints.push(stop.location);

      priestDistanceMeters += leg.distanceMeters;
      priestTravelMillis += leg.durationMillis;

      const travelMins = leg.durationMillis / 60000;
      const stopDuration = getEffectiveStopDurationMinutes(
        stop,
        config.defaultVisitMinutes
      );
      const timing = advanceStopClockWithBreaks(
        cursorAbs,
        travelMins,
        stopDuration,
        isBlockStop(stop),
        activeBreaks
      );
      cursorAbs = timing.endCursorAbs;
      priestVisitMinutes += stopDuration;

      return {
        stop,
        orderIndex: idx + 1,
        arrivalTime: formatAbsMinutesToHHMM(timing.arrivalAbs),
        departureTime: formatAbsMinutesToHHMM(timing.departureAbs),
        legDistanceMeters: leg.distanceMeters,
        legDurationMillis: leg.durationMillis,
      };
    });

    let returnLegDistanceMeters = 0;
    let returnLegDurationMillis = 0;
    if (config.returnToParish && ordered.length > 0) {
      const ret = estimateLegMetrics(
        prevPoint,
        parish.location,
        config.travelMode
      );
      returnLegDistanceMeters = ret.distanceMeters;
      returnLegDurationMillis = ret.durationMillis;
      priestDistanceMeters += ret.distanceMeters;
      priestTravelMillis += ret.durationMillis;
      cursorAbs += ret.durationMillis / 60000;
      pathPoints.push(parish.location);
    }

    const endAbsMinutes = Math.round(cursorAbs);
    const endTime = formatAbsMinutesToHHMM(endAbsMinutes);
    if (endAbsMinutes > latestEndMinutes) {
      latestEndMinutes = endAbsMinutes;
    }

    totalDistanceMeters += priestDistanceMeters;
    totalVisitMinutes += priestVisitMinutes;
    totalTravelMillis += priestTravelMillis;

    routes.push({
      priestId,
      priestName: profile.name,
      color: profile.color,
      orderedStops: scheduledItems,
      totalDistanceMeters: priestDistanceMeters,
      totalTravelDurationMillis: priestTravelMillis,
      totalVisitMinutes: priestVisitMinutes,
      endTime,
      returnLegDistanceMeters,
      returnLegDurationMillis,
      encodedPathPoints: pathPoints,
    });
  }

  return {
    routes,
    endTime: formatAbsMinutesToHHMM(latestEndMinutes),
    totalDistanceMeters,
    totalVisitMinutes,
    totalTravelMillis,
  };
}

/**
 * Groups all stops by scheduled date and summarizes each day's time window, streets, and metrics.
 */
export function buildSeasonDaySummaries(
  stops: VisitStop[],
  parish: ParishCenter | null,
  config: PlanConfig,
  seasonConfig: SeasonPlanConfig,
  exactRoutesByDay: Record<string, PriestRouteResult[]> = {}
): {
  days: DayPlanSummary[];
  unscheduledStops: VisitStop[];
} {
  const byDate: Record<string, VisitStop[]> = {};
  const unscheduledStops: VisitStop[] = [];

  for (const stop of stops) {
    const d = (stop.visitDate ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(stop);
    } else {
      unscheduledStops.push(stop);
    }
  }

  const sortedDates = Object.keys(byDate).sort();
  const days: DayPlanSummary[] = sortedDates.map((date) => {
    const dayStops = byDate[date];
    const startTime = getDayStartTime(date, seasonConfig, config.startTime);
    const plannedEndTime = getDayEndTime(date, seasonConfig);
    const activeBreaks = getDayActiveBreaks(date, seasonConfig);

    const streetCountMap: Record<string, number> = {};
    for (const s of dayStops) {
      const name = extractStreetName(s);
      streetCountMap[name] = (streetCountMap[name] ?? 0) + 1;
    }
    const streetNames = Object.entries(streetCountMap)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl'))
      .map(([name]) => name);

    const exact = exactRoutesByDay[date];
    if (exact && exact.length > 0 && parish) {
      const totalDistanceMeters = exact.reduce(
        (acc, r) => acc + r.totalDistanceMeters,
        0
      );
      const totalVisitMinutes = exact.reduce(
        (acc, r) => acc + r.totalVisitMinutes,
        0
      );
      const totalTravelMillis = exact.reduce(
        (acc, r) => acc + r.totalTravelDurationMillis,
        0
      );
      const estimatedEndTime =
        exact
          .map((r) => r.endTime)
          .sort()
          .slice(-1)[0] || startTime;

      return {
        date,
        weekdayLabel: formatPolishWeekdayShort(date),
        shortDateLabel: formatPolishDateShort(date),
        startTime,
        plannedEndTime,
        estimatedEndTime,
        activeBreaks,
        stops: dayStops,
        streetNames,
        estimatedRoutes: exact,
        totalDistanceMeters,
        totalVisitMinutes,
        totalTravelMillis,
      };
    }

    if (!parish) {
      const totalVisitMinutes = dayStops.reduce(
        (acc, s) =>
          acc + getEffectiveStopDurationMinutes(s, config.defaultVisitMinutes),
        0
      );
      const avgPerPriest = Math.round(
        totalVisitMinutes / Math.max(1, config.priestCount)
      );
      return {
        date,
        weekdayLabel: formatPolishWeekdayShort(date),
        shortDateLabel: formatPolishDateShort(date),
        startTime,
        plannedEndTime,
        estimatedEndTime: addMinutesToHHMM(startTime, avgPerPriest),
        activeBreaks,
        stops: dayStops,
        streetNames,
        estimatedRoutes: [],
        totalDistanceMeters: 0,
        totalVisitMinutes,
        totalTravelMillis: 0,
      };
    }

    const est = estimateDayRoutes(
      parish,
      dayStops,
      config,
      startTime,
      activeBreaks
    );
    return {
      date,
      weekdayLabel: formatPolishWeekdayShort(date),
      shortDateLabel: formatPolishDateShort(date),
      startTime,
      plannedEndTime,
      estimatedEndTime: est.endTime,
      activeBreaks,
      stops: dayStops,
      streetNames,
      estimatedRoutes: est.routes,
      totalDistanceMeters: est.totalDistanceMeters,
      totalVisitMinutes: est.totalVisitMinutes,
      totalTravelMillis: est.totalTravelMillis,
    };
  });

  return { days, unscheduledStops };
}

interface StreetWorkUnit {
  id: string;
  streetName: string;
  stops: VisitStop[];
  centroid: LatLng;
  estimatedMinutes: number;
  hasBlocks: boolean;
  angleFromParish: number;
  distanceFromParishMeters: number;
}

function orderStopsAlongStreet(
  referencePoint: LatLng,
  streetStops: VisitStop[]
): VisitStop[] {
  if (streetStops.length <= 1) return [...streetStops];
  const pool = [...streetStops];
  // Start from extreme house closest to referencePoint or lowest numeric corner
  let startIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pool.length; i++) {
    const d = haversineMeters(referencePoint, pool[i].location);
    if (d < bestDist) {
      bestDist = d;
      startIdx = i;
    }
  }
  const ordered: VisitStop[] = [pool.splice(startIdx, 1)[0]];
  let cursor = ordered[0].location;
  while (pool.length > 0) {
    let nextIdx = 0;
    let nextDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pool.length; i++) {
      const d = haversineMeters(cursor, pool[i].location);
      if (d < nextDist) {
        nextDist = d;
        nextIdx = i;
      }
    }
    const chosen = pool.splice(nextIdx, 1)[0];
    ordered.push(chosen);
    cursor = chosen.location;
  }
  return ordered;
}

function makeWorkUnit(
  id: string,
  streetName: string,
  orderedStops: VisitStop[],
  parishLocation: LatLng,
  defaultVisitMinutes: number,
  perStopTravelEstimate: number
): StreetWorkUnit {
  const centroid = {
    lat:
      orderedStops.reduce((acc, s) => acc + s.location.lat, 0) /
      orderedStops.length,
    lng:
      orderedStops.reduce((acc, s) => acc + s.location.lng, 0) /
      orderedStops.length,
  };
  const estimatedMinutes = orderedStops.reduce(
    (acc, s) =>
      acc +
      getEffectiveStopDurationMinutes(s, defaultVisitMinutes) +
      perStopTravelEstimate,
    0
  );
  const blockCount = orderedStops.filter((s) => isBlockStop(s)).length;
  const totalUnits = orderedStops.reduce(
    (acc, s) => acc + getStopUnitCount(s),
    0
  );
  const hasBlocks = blockCount > 0 && (blockCount >= orderedStops.length * 0.35 || totalUnits >= 15);
  return {
    id,
    streetName,
    stops: orderedStops,
    centroid,
    estimatedMinutes,
    hasBlocks,
    angleFromParish: Math.atan2(
      centroid.lat - parishLocation.lat,
      centroid.lng - parishLocation.lng
    ),
    distanceFromParishMeters: haversineMeters(parishLocation, centroid),
  };
}

function buildStreetWorkUnits({
  parishLocation,
  candidates,
  splitMode,
  typicalTeamDayBudget,
  defaultVisitMinutes,
  perStopTravelEstimate,
}: {
  parishLocation: LatLng;
  candidates: VisitStop[];
  splitMode: SeasonPlanningRules['splitMode'];
  typicalTeamDayBudget: number;
  defaultVisitMinutes: number;
  perStopTravelEstimate: number;
}): StreetWorkUnit[] {
  const byStreet = new Map<string, VisitStop[]>();
  for (const s of candidates) {
    const name = extractStreetName(s);
    const list = byStreet.get(name);
    if (list) list.push(s);
    else byStreet.set(name, [s]);
  }

  const units: StreetWorkUnit[] = [];
  const softChunkTarget = Math.max(90, Math.round(typicalTeamDayBudget * 0.85));

  for (const [streetName, rawStops] of byStreet.entries()) {
    const orderedStops = orderStopsAlongStreet(parishLocation, rawStops);
    const fullUnit = makeWorkUnit(
      streetName,
      streetName,
      orderedStops,
      parishLocation,
      defaultVisitMinutes,
      perStopTravelEstimate
    );

    if (splitMode === 'parity' && (fullUnit.estimatedMinutes > softChunkTarget * 0.72 || orderedStops.length >= 16)) {
      const evens: VisitStop[] = [];
      const odds: VisitStop[] = [];
      const other: VisitStop[] = [];
      for (const s of orderedStops) {
        const isEven = isEvenHouseNumberStr(extractHouseNumberLabel(s));
        if (isEven === true) evens.push(s);
        else if (isEven === false) odds.push(s);
        else other.push(s);
      }
      if (evens.length > 0 && odds.length > 0) {
        const evenBatch = evens.length <= odds.length ? [...evens, ...other] : evens;
        const oddBatch = evens.length <= odds.length ? odds : [...odds, ...other];
        const subBatches = [
          { tag: `${streetName} (parzyste)`, items: evenBatch },
          { tag: `${streetName} (nieparzyste)`, items: oddBatch },
        ];
        for (const sub of subBatches) {
          const subUnit = makeWorkUnit(
            sub.tag,
            streetName,
            sub.items,
            parishLocation,
            defaultVisitMinutes,
            perStopTravelEstimate
          );
          if (subUnit.estimatedMinutes <= typicalTeamDayBudget * 1.05 || sub.items.length <= 2) {
            units.push(subUnit);
          } else {
            // Subdivide huge side sequentially into balanced segments
            let chunk: VisitStop[] = [];
            let chunkCost = 0;
            let part = 1;
            for (const s of sub.items) {
              const c = getEffectiveStopDurationMinutes(s, defaultVisitMinutes) + perStopTravelEstimate;
              if (chunk.length > 0 && chunkCost + c > softChunkTarget) {
                units.push(
                  makeWorkUnit(
                    `${sub.tag} #${part++}`,
                    streetName,
                    chunk,
                    parishLocation,
                    defaultVisitMinutes,
                    perStopTravelEstimate
                  )
                );
                chunk = [];
                chunkCost = 0;
              }
              chunk.push(s);
              chunkCost += c;
            }
            if (chunk.length > 0) {
              units.push(
                makeWorkUnit(
                  `${sub.tag} #${part}`,
                  streetName,
                  chunk,
                  parishLocation,
                  defaultVisitMinutes,
                  perStopTravelEstimate
                )
              );
            }
          }
        }
        continue;
      }
    }

    if (splitMode === 'strict_budget' && orderedStops.length > 6 && fullUnit.estimatedMinutes > softChunkTarget * 0.55) {
      let chunk: VisitStop[] = [];
      let chunkCost = 0;
      let part = 1;
      for (const s of orderedStops) {
        const c = getEffectiveStopDurationMinutes(s, defaultVisitMinutes) + perStopTravelEstimate;
        if (chunk.length > 0 && chunkCost + c > Math.max(60, softChunkTarget * 0.5)) {
          units.push(
            makeWorkUnit(
              `${streetName} #${part++}`,
              streetName,
              chunk,
              parishLocation,
              defaultVisitMinutes,
              perStopTravelEstimate
            )
          );
          chunk = [];
          chunkCost = 0;
        }
        chunk.push(s);
        chunkCost += c;
      }
      if (chunk.length > 0) {
        units.push(
          makeWorkUnit(
            `${streetName} #${part}`,
            streetName,
            chunk,
            parishLocation,
            defaultVisitMinutes,
            perStopTravelEstimate
          )
        );
      }
      continue;
    }

    // whole_or_half (default): keep whole street intact unless it overflows a single day
    if (fullUnit.estimatedMinutes > typicalTeamDayBudget * 0.92 && orderedStops.length >= 4) {
      const partCount = Math.max(2, Math.ceil(fullUnit.estimatedMinutes / softChunkTarget));
      const targetPerPart = fullUnit.estimatedMinutes / partCount;
      let chunk: VisitStop[] = [];
      let chunkCost = 0;
      let part = 1;
      for (let idx = 0; idx < orderedStops.length; idx++) {
        const s = orderedStops[idx];
        const c = getEffectiveStopDurationMinutes(s, defaultVisitMinutes) + perStopTravelEstimate;
        const remainingParts = partCount - part;
        if (
          remainingParts > 0 &&
          chunk.length >= 2 &&
          chunkCost + c > targetPerPart &&
          orderedStops.length - idx >= remainingParts * 2
        ) {
          units.push(
            makeWorkUnit(
              `${streetName} (cz. ${part++})`,
              streetName,
              chunk,
              parishLocation,
              defaultVisitMinutes,
              perStopTravelEstimate
            )
          );
          chunk = [];
          chunkCost = 0;
        }
        chunk.push(s);
        chunkCost += c;
      }
      if (chunk.length > 0) {
        units.push(
          makeWorkUnit(
            `${streetName} (cz. ${part})`,
            streetName,
            chunk,
            parishLocation,
            defaultVisitMinutes,
            perStopTravelEstimate
          )
        );
      }
    } else {
      units.push(fullUnit);
    }
  }

  return units;
}

/**
 * Coordinates multi-priest assignment on a single day cleanly:
 * assigns whole adjacent streets to priests when balanced, or splits by even/odd side or local spatial sector around day centroid.
 */
function coordinateDayStopsAcrossPriests(
  parishLocation: LatLng,
  dayStops: VisitStop[],
  priestCount: number,
  defaultVisitMinutes: number
): VisitStop[] {
  if (dayStops.length === 0) return dayStops;
  if (priestCount <= 1) {
    return dayStops.map((s) => ({ ...s, priestId: 1 }));
  }

  const byStreet = new Map<string, VisitStop[]>();
  for (const s of dayStops) {
    const name = extractStreetName(s);
    const list = byStreet.get(name);
    if (list) list.push(s);
    else byStreet.set(name, [s]);
  }

  if (byStreet.size >= priestCount) {
    // Try street-level balanced assignment ordered by angle around day centroid
    const dayCentroid = {
      lat: dayStops.reduce((a, s) => a + s.location.lat, 0) / dayStops.length,
      lng: dayStops.reduce((a, s) => a + s.location.lng, 0) / dayStops.length,
    };
    const streetGroups = Array.from(byStreet.entries())
      .map(([streetName, list]) => {
        const cx = list.reduce((a, s) => a + s.location.lng, 0) / list.length;
        const cy = list.reduce((a, s) => a + s.location.lat, 0) / list.length;
        const load = list.reduce(
          (a, s) => a + getEffectiveStopDurationMinutes(s, defaultVisitMinutes) + 2,
          0
        );
        const angle = Math.atan2(cy - dayCentroid.lat, cx - dayCentroid.lng);
        return { streetName, list, load, angle };
      })
      .sort((a, b) => a.angle - b.angle);

    const loads = Array.from({ length: priestCount }, () => 0);
    const assigned = new Map<string, number>();

    // Greedy LPT / contiguous bin assignment if streets don't wildly skew balance
    const totalLoad = streetGroups.reduce((a, g) => a + g.load, 0);
    const maxSingleStreet = Math.max(...streetGroups.map((g) => g.load));

    if (maxSingleStreet <= (totalLoad / priestCount) * 1.45) {
      // Assign contiguous street arcs first, picking the lowest-loaded neighboring bucket
      for (const grp of streetGroups) {
        let bestP = 0;
        let minLoad = Number.POSITIVE_INFINITY;
        for (let p = 0; p < priestCount; p++) {
          if (loads[p] < minLoad) {
            minLoad = loads[p];
            bestP = p;
          }
        }
        loads[bestP] += grp.load;
        for (const s of grp.list) {
          assigned.set(s.id, bestP + 1);
        }
      }
      return dayStops.map((s) => ({
        ...s,
        priestId: assigned.get(s.id) ?? 1,
      }));
    }
  }

  // Single long street / large block area: if 2 priests and clear even/odd parity, put Ks 1 = parzyste, Ks 2 = nieparzyste
  if (priestCount === 2 && byStreet.size === 1) {
    const evens = dayStops.filter(
      (s) => isEvenHouseNumberStr(extractHouseNumberLabel(s)) === true
    );
    const odds = dayStops.filter(
      (s) => isEvenHouseNumberStr(extractHouseNumberLabel(s)) === false
    );
    if (
      evens.length >= 2 &&
      odds.length >= 2 &&
      Math.max(evens.length, odds.length) <= Math.min(evens.length, odds.length) * 1.8
    ) {
      const evenSet = new Set(evens.map((s) => s.id));
      const oddSet = new Set(odds.map((s) => s.id));
      return dayStops.map((s, idx) => ({
        ...s,
        priestId: evenSet.has(s.id) ? 1 : oddSet.has(s.id) ? 2 : (idx % 2) + 1,
      }));
    }
  }

  // Fallback: partition spatially around the day's own cluster center (keeps priests separated cleanly inside today's zone)
  const dayCentroid = {
    lat: dayStops.reduce((a, s) => a + s.location.lat, 0) / dayStops.length,
    lng: dayStops.reduce((a, s) => a + s.location.lng, 0) / dayStops.length,
  };
  const anchorOrigin =
    haversineMeters(parishLocation, dayCentroid) > 250
      ? dayCentroid
      : parishLocation;
  return partitionStopsBySector(anchorOrigin, dayStops, priestCount);
}

/**
 * Simulates an entire kolęda season using zone-first clustering, holidays/days off,
 * lunch/Mass breaks, realistic block workload, and coordinated multi-priest teams.
 * Runs 100% locally without mutating saved state so users can preview before applying.
 */
export function simulateAutoScheduleSeason({
  parish,
  stops,
  config,
  seasonConfig,
  targetMode,
}: {
  parish: ParishCenter;
  stops: VisitStop[];
  config: PlanConfig;
  seasonConfig: SeasonPlanConfig;
  targetMode: 'all' | 'unscheduled';
}): AutoSeasonSimulationResult {
  const skippedPermanentDeclineCount = stops.filter(
    (s) => Boolean(s.permanentDecline) || s.included === false
  ).length;

  const eligiblePool = stops.filter(
    (s) => !s.permanentDecline && s.included !== false
  );

  const candidates =
    targetMode === 'unscheduled'
      ? eligiblePool.filter((s) => !(s.visitDate ?? '').trim())
      : eligiblePool;

  const existingByDate = new Map<string, VisitStop[]>();
  let preservedDaysCount = 0;
  if (targetMode === 'unscheduled') {
    for (const s of stops) {
      const d = (s.visitDate ?? '').trim();
      if (d) {
        const list = existingByDate.get(d);
        if (list) list.push(s);
        else existingByDate.set(d, [s]);
      }
    }
    preservedDaysCount = existingByDate.size;
  }

  if (candidates.length === 0) {
    const summary = buildSeasonDaySummaries(stops, parish, config, seasonConfig);
    return {
      scheduledStops: stops,
      simulatedDays: summary.days,
      newlyScheduledCount: 0,
      preservedDaysCount,
      skippedPermanentDeclineCount,
      unscheduledRemainingCount: 0,
      excludedHolidaysUsed: [],
      hasOverflowPastHorizon: false,
    };
  }

  const rules: SeasonPlanningRules = {
    splitMode: seasonConfig.planningRules?.splitMode ?? DEFAULT_PLANNING_RULES.splitMode,
    zoneDirection:
      seasonConfig.planningRules?.zoneDirection ?? DEFAULT_PLANNING_RULES.zoneDirection,
    blockPreference:
      seasonConfig.planningRules?.blockPreference ??
      DEFAULT_PLANNING_RULES.blockPreference,
    safetyBufferMinutes: Math.max(
      0,
      Math.min(120, seasonConfig.planningRules?.safetyBufferMinutes ?? 15)
    ),
  };

  const allowedWeekdays = parseWeekdaysMask(seasonConfig.weekdaysMask);
  const excludedSet = new Set(seasonConfig.excludedDates ?? []);
  const priestCount = Math.max(1, Math.min(4, config.priestCount));
  const dailyEndMinutes = parseHHMMToMinutes(seasonConfig.dailyEndTime, 20 * 60 + 30);
  const perStopTravelEstimate = config.travelMode === 'DRIVING' ? 2.6 : 1.9;
  const returnReserveMinutes = config.returnToParish ? 8 : 0;

  const sampleWeekdayBudget = Math.max(
    90,
    (dailyEndMinutes -
      parseHHMMToMinutes(seasonConfig.weekdayStartTime, 15 * 60 + 30) -
      rules.safetyBufferMinutes -
      returnReserveMinutes) *
      priestCount
  );

  const remainingUnits = buildStreetWorkUnits({
    parishLocation: parish.location,
    candidates,
    splitMode: rules.splitMode,
    typicalTeamDayBudget: sampleWeekdayBudget,
    defaultVisitMinutes: config.defaultVisitMinutes,
    perStopTravelEstimate,
  });

  const updatedById = new Map<string, VisitStop>();
  const excludedHolidaysUsed: string[] = [];
  let newlyScheduledCount = 0;
  let lastZoneCentroid: LatLng | null = null;
  let dayOffset = 0;
  const MAX_DAYS_SCAN = 180;
  const endHorizon =
    seasonConfig.endDate && /^\d{4}-\d{2}-\d{2}$/.test(seasonConfig.endDate)
      ? seasonConfig.endDate
      : '';

  while (remainingUnits.length > 0 && dayOffset < MAX_DAYS_SCAN) {
    const currentDate = addDaysToIsoDate(seasonConfig.startDate, dayOffset);
    dayOffset += 1;

    if (endHorizon && currentDate > endHorizon) {
      break;
    }

    const weekday = getPolishWeekdayIndex(currentDate);
    if (!allowedWeekdays.has(weekday)) continue;

    if (excludedSet.has(currentDate)) {
      excludedHolidaysUsed.push(currentDate);
      continue;
    }

    const dayStartTime = getDayStartTime(
      currentDate,
      seasonConfig,
      config.startTime
    );
    const dayEndTime = getDayEndTime(currentDate, seasonConfig);
    const dayStartAbs = parseHHMMToMinutes(dayStartTime, 15 * 60 + 30);
    let dayEndAbs = parseHHMMToMinutes(dayEndTime, dailyEndMinutes);
    if (dayEndAbs <= dayStartAbs + 30) dayEndAbs += 24 * 60;

    const dayBreaks = getDayActiveBreaks(currentDate, seasonConfig);
    const breakOverlap = computeBreakOverlapMinutes(
      dayStartAbs,
      dayEndAbs,
      dayBreaks
    );

    const effectiveMinutesPerPriest = Math.max(
      45,
      dayEndAbs -
        dayStartAbs -
        breakOverlap -
        rules.safetyBufferMinutes -
        returnReserveMinutes
    );
    const totalDayTeamBudget = effectiveMinutesPerPriest * priestCount;

    const alreadyOnDay = existingByDate.get(currentDate) ?? [];
    const usedMinutesOnDay = alreadyOnDay.reduce(
      (acc, s) =>
        acc +
        getEffectiveStopDurationMinutes(s, config.defaultVisitMinutes) +
        perStopTravelEstimate,
      0
    );

    if (usedMinutesOnDay >= totalDayTeamBudget - 20) {
      continue;
    }

    const dayBatch: VisitStop[] = [];
    let dayMinutesAccum = usedMinutesOnDay;
    const isWeekendDay = weekday === 0 || weekday === 6;

    // Anchor today's zone close to existing stops on this day, or previous day's zone, or direction seed
    let todayCursor: LatLng =
      alreadyOnDay.length > 0
        ? {
            lat:
              alreadyOnDay.reduce((a, s) => a + s.location.lat, 0) /
              alreadyOnDay.length,
            lng:
              alreadyOnDay.reduce((a, s) => a + s.location.lng, 0) /
              alreadyOnDay.length,
          }
        : lastZoneCentroid ?? parish.location;

    while (remainingUnits.length > 0) {
      // Choose next compact work unit
      let bestIdx = 0;
      let bestScore = Number.POSITIVE_INFINITY;

      for (let i = 0; i < remainingUnits.length; i++) {
        const unit = remainingUnits[i];
        const wouldFit =
          dayBatch.length === 0 ||
          dayMinutesAccum + unit.estimatedMinutes <=
            totalDayTeamBudget * (rules.splitMode === 'strict_budget' ? 1.0 : 1.08);

        if (!wouldFit) continue;

        let score: number;
        if (!lastZoneCentroid && dayBatch.length === 0 && alreadyOnDay.length === 0) {
          // Very first day seed according to zoneDirection
          if (rules.zoneDirection === 'farthest_first') {
            score = -unit.distanceFromParishMeters;
          } else if (rules.zoneDirection === 'clockwise') {
            // Normalize polar angle from North-East clockwise
            const normAngle =
              (Math.PI / 2 - unit.angleFromParish + Math.PI * 2) % (Math.PI * 2);
            score = normAngle * 250 + unit.distanceFromParishMeters * 0.2;
          } else {
            score = unit.distanceFromParishMeters;
          }
        } else {
          const distFromCursor = haversineMeters(todayCursor, unit.centroid);
          const radialBias =
            rules.zoneDirection === 'farthest_first'
              ? -unit.distanceFromParishMeters * 0.12
              : rules.zoneDirection === 'nearest_first'
                ? unit.distanceFromParishMeters * 0.15
                : 0;
          score = distFromCursor + radialBias;
        }

        // Apply optional pastoral preference (blocks on weekday afternoons, houses on weekends)
        if (rules.blockPreference === 'blocks_weekdays_houses_weekend') {
          if (!isWeekendDay) {
            score *= unit.hasBlocks ? 0.55 : 1.55;
          } else {
            score *= !unit.hasBlocks ? 0.55 : 1.65;
          }
        }

        // Strongly prefer units that fit today cleanly without excess idle gap
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      const candidateUnit = remainingUnits[bestIdx];
      const willFit =
        dayBatch.length === 0 ||
        dayMinutesAccum + candidateUnit.estimatedMinutes <=
          totalDayTeamBudget * (rules.splitMode === 'strict_budget' ? 1.0 : 1.08);

      if (!willFit) {
        // Check if any smaller nearby unit fits nicely into remaining time on this day
        let fallbackIdx = -1;
        let fallbackScore = Number.POSITIVE_INFINITY;
        for (let i = 0; i < remainingUnits.length; i++) {
          const unit = remainingUnits[i];
          if (dayMinutesAccum + unit.estimatedMinutes > totalDayTeamBudget * 1.04) {
            continue;
          }
          const d = haversineMeters(todayCursor, unit.centroid);
          // Only pull another street if it's genuinely adjacent (< 900 m) to prevent zigzagging across parish!
          if (d <= 900 && d < fallbackScore) {
            fallbackScore = d;
            fallbackIdx = i;
          }
        }

        if (fallbackIdx < 0) {
          break;
        }

        const pulled = remainingUnits.splice(fallbackIdx, 1)[0];
        dayBatch.push(...pulled.stops);
        dayMinutesAccum += pulled.estimatedMinutes;
        todayCursor = pulled.centroid;
        continue;
      }

      const chosen = remainingUnits.splice(bestIdx, 1)[0];
      dayBatch.push(...chosen.stops);
      dayMinutesAccum += chosen.estimatedMinutes;
      todayCursor = chosen.centroid;
    }

    if (dayBatch.length > 0) {
      lastZoneCentroid = todayCursor;
      const combinedDayStops = [...alreadyOnDay, ...dayBatch];
      const coordinated = coordinateDayStopsAcrossPriests(
        parish.location,
        combinedDayStops,
        priestCount,
        config.defaultVisitMinutes
      );
      const coordById = new Map(coordinated.map((s) => [s.id, s]));

      for (const s of dayBatch) {
        const c = coordById.get(s.id) ?? s;
        updatedById.set(s.id, {
          ...c,
          visitDate: currentDate,
          included: true,
          manualOrder: 0,
        });
        newlyScheduledCount += 1;
      }

      if (alreadyOnDay.length > 0 && targetMode === 'unscheduled') {
        for (const s of alreadyOnDay) {
          const c = coordById.get(s.id) ?? s;
          updatedById.set(s.id, {
            ...c,
            visitDate: currentDate,
            included: true,
          });
        }
      }
    }
  }

  // Clear visitDate for excluded stops ONLY in 'all' mode if they had a previous date
  const scheduledStops = stops.map((s) => {
    const updated = updatedById.get(s.id);
    if (updated) return updated;
    if (
      targetMode === 'all' &&
      (s.permanentDecline || s.included === false) &&
      (s.visitDate ?? '').trim() !== ''
    ) {
      return { ...s, visitDate: '', manualOrder: 0 };
    }
    return s;
  });

  const unscheduledRemainingCount = remainingUnits.reduce(
    (acc, u) => acc + u.stops.length,
    0
  );

  const simulatedSummary = buildSeasonDaySummaries(
    scheduledStops,
    parish,
    config,
    seasonConfig
  );

  return {
    scheduledStops,
    simulatedDays: simulatedSummary.days,
    newlyScheduledCount,
    preservedDaysCount,
    skippedPermanentDeclineCount,
    unscheduledRemainingCount,
    excludedHolidaysUsed,
    hasOverflowPastHorizon: Boolean(endHorizon && unscheduledRemainingCount > 0),
  };
}

/**
 * Automatically distributes stops across a multi-day kolęda schedule respecting holidays, breaks,
 * weekday/Saturday/Sunday start times, daily end time limit, priest count, and spatial zones.
 */
export function autoScheduleSeason(params: {
  parish: ParishCenter;
  stops: VisitStop[];
  config: PlanConfig;
  seasonConfig: SeasonPlanConfig;
  targetMode: 'all' | 'unscheduled';
}): VisitStop[] {
  return simulateAutoScheduleSeason(params).scheduledStops;
}

export function exportFullSeasonToCsv(
  parish: ParishCenter | null,
  days: DayPlanSummary[]
): void {
  const header = [
    'Data',
    'Dzień tygodnia',
    'Ksiądz',
    'Kolejność',
    'Przyjście',
    'Wyjście',
    'Adres domu',
    'Czas wizyty (min)',
    'Przejazd (m)',
    'Rodzina / Uwagi',
  ];

  const rows: string[][] = [];
  for (const day of days) {
    for (const route of day.estimatedRoutes) {
      for (const item of route.orderedStops) {
        const houseAddress = item.stop.address || item.stop.label;
        const unitCount = item.stop.units?.length || item.stop.unitsCount || 0;
        const blockLabel =
          item.stop.isMultiUnit && unitCount > 0
            ? `Blok (${unitCount} lok.)`
            : item.stop.isMultiUnit
              ? 'Blok'
              : '';
        const notes = [
          blockLabel,
          item.stop.label && item.stop.label !== houseAddress
            ? item.stop.label
            : '',
          item.stop.notes || '',
        ]
          .filter(Boolean)
          .join(' · ');

        rows.push([
          day.date,
          formatPolishWeekdayFull(day.date),
          route.priestName,
          String(item.orderIndex),
          item.arrivalTime,
          item.departureTime,
          houseAddress,
          String(item.stop.durationMinutes),
          String(Math.round(item.legDistanceMeters)),
          notes,
        ]);
      }
    }
  }

  const escapeCsv = (val: string) => `"${val.replaceAll('"', '""')}"`;
  const csvContent =
    '\uFEFF' +
    [header, ...rows].map((row) => row.map(escapeCsv).join(';')).join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const slug = (parish?.name || 'koleda')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/(^-|-$)/g, '');
  link.href = url;
  link.setAttribute('download', `harmonogram-caly-okres-${slug || 'parafia'}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface AnnouncementStreetRange {
  streetName: string;
  rangeLabel: string;
  stopsCount: number;
}

export interface AnnouncementDayItem {
  date: string;
  fullDateLabel: string;
  startTime: string;
  streets: AnnouncementStreetRange[];
  priestCountUsed: number;
}

/**
 * Generates RODO-compliant parish bulletin announcements (dates, start time, streets + house ranges, zero family names).
 */
export function buildAnnouncementDays(
  days: DayPlanSummary[]
): AnnouncementDayItem[] {
  return days.map((day) => {
    const byStreet = new Map<string, VisitStop[]>();
    for (const stop of day.stops) {
      const street = extractStreetName(stop);
      const list = byStreet.get(street);
      if (list) list.push(stop);
      else byStreet.set(street, [stop]);
    }

    const streets: AnnouncementStreetRange[] = Array.from(byStreet.entries())
      .map(([streetName, list]) => ({
        streetName,
        rangeLabel: formatStreetHouseRange(list),
        stopsCount: list.length,
      }))
      .sort((a, b) => a.streetName.localeCompare(b.streetName, 'pl'));

    return {
      date: day.date,
      fullDateLabel: formatPolishDateFull(day.date),
      startTime: day.startTime,
      streets,
      priestCountUsed: day.estimatedRoutes.length || 1,
    };
  });
}

export function formatAnnouncementsPlainText(
  parish: ParishCenter | null,
  days: DayPlanSummary[]
): string {
  const items = buildAnnouncementDays(days);
  if (items.length === 0) return '';

  const header = parish
    ? `PLAN ODWIEDZIN DUSZPASTERSKICH (KOLĘDA) — ${parish.name.toUpperCase()}`
    : 'PLAN ODWIEDZIN DUSZPASTERSKICH (KOLĘDA)';

  const lines: string[] = [header, ''];
  for (const item of items) {
    const streetsText = item.streets
      .map((s) => (s.rangeLabel ? `${s.streetName} (${s.rangeLabel})` : s.streetName))
      .join('; ');
    lines.push(`• ${item.fullDateLabel}, godz. ${item.startTime} — ${streetsText}`);
  }
  return lines.join('\n');
}

export interface ReturnVisitCandidate {
  stop: VisitStop;
  reason: 'absent_house' | 'invited_house' | 'absent_or_invited_block';
  pendingUnitsCount: number;
}

/**
 * Collects all single houses marked 'absent' or 'invited', plus multi-unit blocks containing absent/invited units,
 * so the parish can schedule a supplementary "kolęda na zaproszenie / powroty" day in one click.
 */
export function collectReturnVisitCandidates(
  stops: VisitStop[]
): ReturnVisitCandidate[] {
  const out: ReturnVisitCandidate[] = [];
  for (const stop of stops) {
    const isBlock = Boolean(
      stop.isMultiUnit || (stop.units && stop.units.length > 0)
    );
    if (isBlock && stop.units && stop.units.length > 0) {
      const returnUnits = stop.units.filter(
        (u) => u.status === 'absent' || u.status === 'invited'
      );
      if (returnUnits.length > 0) {
        out.push({
          stop,
          reason: 'absent_or_invited_block',
          pendingUnitsCount: returnUnits.length,
        });
      }
      continue;
    }

    if (stop.visitStatus === 'absent') {
      out.push({ stop, reason: 'absent_house', pendingUnitsCount: 1 });
    } else if (stop.visitStatus === 'invited') {
      out.push({ stop, reason: 'invited_house', pendingUnitsCount: 1 });
    }
  }
  return out;
}

export type StreetStartDirection =
  | 'auto'
  | 'asc'
  | 'desc'
  | 'from_stop'
  | 'side_by_side';

/**
 * Computes manualOrder map for stops based on desired street direction or explicit starting house.
 * Returns manualOrder = 0 for 'auto' mode so automatic shortest-path from church takes effect.
 */
export function computeManualOrderForStops(
  targetStops: VisitStop[],
  mode: StreetStartDirection,
  startingStopId?: string
): Map<string, number> {
  const result = new Map<string, number>();
  if (targetStops.length === 0) return result;

  if (mode === 'auto') {
    for (const s of targetStops) {
      result.set(s.id, 0);
    }
    return result;
  }

  if (mode === 'from_stop' && startingStopId) {
    const startStop = targetStops.find((s) => s.id === startingStopId);
    if (startStop) {
      const pool = targetStops.filter((s) => s.id !== startStop.id);
      const ordered: VisitStop[] = [startStop];
      let cursor = startStop.location;
      let currentStreet = extractStreetName(startStop);

      while (pool.length > 0) {
        let bestIdx = 0;
        let bestScore = Number.POSITIVE_INFINITY;
        for (let i = 0; i < pool.length; i++) {
          const cand = pool[i];
          const d = haversineMeters(cursor, cand.location);
          const sameStreet = extractStreetName(cand) === currentStreet && d < 450;
          const score = sameStreet ? d * 0.42 : d;
          if (score < bestScore) {
            bestScore = score;
            bestIdx = i;
          }
        }
        const chosen = pool.splice(bestIdx, 1)[0];
        ordered.push(chosen);
        cursor = chosen.location;
        currentStreet = extractStreetName(chosen);
      }

      ordered.forEach((s, idx) => result.set(s.id, idx + 1));
      return result;
    }
  }

  if (mode === 'side_by_side') {
    const byStreet = new Map<string, VisitStop[]>();
    for (const s of targetStops) {
      const street = extractStreetName(s);
      const list = byStreet.get(street);
      if (list) list.push(s);
      else byStreet.set(street, [s]);
    }

    const sortedStreets = Array.from(byStreet.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], 'pl')
    );

    const orderedSideBySide: VisitStop[] = [];
    for (const [, list] of sortedStreets) {
      const evens: VisitStop[] = [];
      const odds: VisitStop[] = [];
      for (const s of list) {
        if (isEvenHouseNumberStr(extractHouseNumberLabel(s))) {
          evens.push(s);
        } else {
          odds.push(s);
        }
      }
      const sortAsc = (a: VisitStop, b: VisitStop) =>
        extractHouseNumberSortKey(extractHouseNumberLabel(a)) -
          extractHouseNumberSortKey(extractHouseNumberLabel(b)) ||
        (a.address || a.label).localeCompare(b.address || b.label, 'pl', {
          numeric: true,
        });
      evens.sort(sortAsc);
      odds.sort((a, b) => -sortAsc(a, b));
      orderedSideBySide.push(...evens, ...odds);
    }

    orderedSideBySide.forEach((s, idx) => result.set(s.id, idx + 1));
    return result;
  }

  const sorted = [...targetStops].sort((a, b) => {
    const streetCmp = extractStreetName(a).localeCompare(
      extractStreetName(b),
      'pl'
    );
    if (streetCmp !== 0) return streetCmp;

    const numA = extractHouseNumberSortKey(extractHouseNumberLabel(a));
    const numB = extractHouseNumberSortKey(extractHouseNumberLabel(b));
    if (numA !== numB) {
      return mode === 'desc' ? numB - numA : numA - numB;
    }

    const cmp = (a.address || a.label).localeCompare(
      b.address || b.label,
      'pl',
      { numeric: true }
    );
    return mode === 'desc' ? -cmp : cmp;
  });

  sorted.forEach((s, idx) => result.set(s.id, idx + 1));
  return result;
}


