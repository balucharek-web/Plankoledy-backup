import {
  DayPlanSummary,
  LatLng,
  PRIEST_PALETTE,
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
  ScheduledStopItem,
  SeasonPlanConfig,
  VisitStop,
} from '../types/parish';
import {
  addMinutesToHHMM,
  extractStreetName,
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

export function getDayStartTime(
  dateStr: string | null | undefined,
  seasonConfig: SeasonPlanConfig,
  fallbackStartTime: string
): string {
  if (!dateStr) return fallbackStartTime;
  return isWeekendDate(dateStr)
    ? seasonConfig.weekendStartTime || fallbackStartTime
    : seasonConfig.weekdayStartTime || fallbackStartTime;
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
    // 28 km/h average parish driving + 0.6 min parking/exit buffer if > 40 m
    const speedMetersPerSec = (28 * 1000) / 3600;
    const bufferSec = roadMeters > 40 ? 35 : 8;
    const durationSec = roadMeters / speedMetersPerSec + bufferSec;
    return {
      distanceMeters: roadMeters,
      durationMillis: Math.round(durationSec * 1000),
    };
  }
  // 4.2 km/h parish walking
  const speedMetersPerSec = (4.2 * 1000) / 3600;
  const durationSec = roadMeters / speedMetersPerSec;
  return {
    distanceMeters: roadMeters,
    durationMillis: Math.round(durationSec * 1000),
  };
}

/**
 * Fast, deterministic client-side day route estimator.
 * Keeps adjacent houses on the same street contiguous and calculates exact arrival/departure windows.
 */
export function estimateDayRoutes(
  parish: ParishCenter,
  dayStops: VisitStop[],
  config: PlanConfig,
  startTimeOverride?: string
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
  let latestEndMinutes = parseHHMMToMinutes(startTime);

  for (const priestId of activePriestIds) {
    const profile =
      PRIEST_PALETTE.find((p) => p.id === priestId) ?? PRIEST_PALETTE[0];
    const pool = [...normalized.filter((s) => s.priestId === priestId)];
    if (pool.length === 0) continue;

    // Street-coherent greedy nearest neighbor
    const ordered: VisitStop[] = [];
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

    let elapsedMinutes = 0;
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
      elapsedMinutes += leg.durationMillis / 60000;

      const arrivalTime = addMinutesToHHMM(startTime, Math.round(elapsedMinutes));
      elapsedMinutes += stop.durationMinutes;
      priestVisitMinutes += stop.durationMinutes;
      const departureTime = addMinutesToHHMM(
        startTime,
        Math.round(elapsedMinutes)
      );

      return {
        stop,
        orderIndex: idx + 1,
        arrivalTime,
        departureTime,
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
      elapsedMinutes += ret.durationMillis / 60000;
      pathPoints.push(parish.location);
    }

    const endTime = addMinutesToHHMM(startTime, Math.round(elapsedMinutes));
    const endAbsMinutes =
      parseHHMMToMinutes(startTime) + Math.round(elapsedMinutes);
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

  const endHH = String(Math.floor((latestEndMinutes % 1440) / 60)).padStart(
    2,
    '0'
  );
  const endMM = String(latestEndMinutes % 60).padStart(2, '0');

  return {
    routes,
    endTime: `${endHH}:${endMM}`,
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
        estimatedEndTime,
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
        (acc, s) => acc + s.durationMinutes,
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
        estimatedEndTime: addMinutesToHHMM(startTime, avgPerPriest),
        stops: dayStops,
        streetNames,
        estimatedRoutes: [],
        totalDistanceMeters: 0,
        totalVisitMinutes,
        totalTravelMillis: 0,
      };
    }

    const est = estimateDayRoutes(parish, dayStops, config, startTime);
    return {
      date,
      weekdayLabel: formatPolishWeekdayShort(date),
      shortDateLabel: formatPolishDateShort(date),
      startTime,
      estimatedEndTime: est.endTime,
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

/**
 * Orders stops along street clusters so streets stay contiguous and geographically chained.
 */
function orderStopsByStreetClusters(
  parishCenter: LatLng,
  stops: VisitStop[]
): VisitStop[] {
  if (stops.length <= 1) return [...stops];

  const byStreet = new Map<string, VisitStop[]>();
  for (const s of stops) {
    const name = extractStreetName(s);
    const list = byStreet.get(name);
    if (list) list.push(s);
    else byStreet.set(name, [s]);
  }

  interface StreetCluster {
    name: string;
    stops: VisitStop[];
    centroid: LatLng;
  }

  const remaining: StreetCluster[] = Array.from(byStreet.entries()).map(
    ([name, streetStops]) => {
      const centroid = {
        lat:
          streetStops.reduce((acc, s) => acc + s.location.lat, 0) /
          streetStops.length,
        lng:
          streetStops.reduce((acc, s) => acc + s.location.lng, 0) /
          streetStops.length,
      };
      return { name, stops: streetStops, centroid };
    }
  );

  // Chain street clusters via nearest neighbor starting from closest to church
  const orderedAll: VisitStop[] = [];
  let cursor = parishCenter;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(cursor, remaining[i].centroid);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    const cluster = remaining.splice(bestIdx, 1)[0];
    // Order houses within this street starting from the house closest to cursor
    const streetPool = [...cluster.stops];
    let localCursor = cursor;
    while (streetPool.length > 0) {
      let hIdx = 0;
      let hDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < streetPool.length; i++) {
        const d = haversineMeters(localCursor, streetPool[i].location);
        if (d < hDist) {
          hDist = d;
          hIdx = i;
        }
      }
      const nextHouse = streetPool.splice(hIdx, 1)[0];
      orderedAll.push(nextHouse);
      localCursor = nextHouse.location;
    }

    cursor = localCursor;
  }

  return orderedAll;
}

/**
 * Automatically distributes stops across a multi-day kolęda schedule respecting weekday/weekend start times,
 * daily end time limit, active days of week, priest count, and Google 25-waypoint per priest cap.
 */
export function autoScheduleSeason({
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
}): VisitStop[] {
  const candidates =
    targetMode === 'unscheduled'
      ? stops.filter((s) => !(s.visitDate ?? '').trim())
      : [...stops];

  if (candidates.length === 0) return stops;

  const existingByDate = new Map<string, VisitStop[]>();
  if (targetMode === 'unscheduled') {
    for (const s of stops) {
      const d = (s.visitDate ?? '').trim();
      if (d) {
        const list = existingByDate.get(d);
        if (list) list.push(s);
        else existingByDate.set(d, [s]);
      }
    }
  }

  const orderedQueue = orderStopsByStreetClusters(parish.location, candidates);
  const allowedWeekdays = parseWeekdaysMask(seasonConfig.weekdaysMask);
  const priestCount = Math.max(1, Math.min(4, config.priestCount));
  const dailyEndMinutes = parseHHMMToMinutes(seasonConfig.dailyEndTime, 20 * 60 + 30);
  const perStopTravelEstimate = config.travelMode === 'DRIVING' ? 2.5 : 1.8;

  const updatedById = new Map<string, VisitStop>();
  let cursorIdx = 0;
  let dayOffset = 0;
  const MAX_DAYS_SCAN = 120;

  while (cursorIdx < orderedQueue.length && dayOffset < MAX_DAYS_SCAN) {
    const currentDate = addDaysToIsoDate(seasonConfig.startDate, dayOffset);
    dayOffset += 1;

    const weekday = getPolishWeekdayIndex(currentDate);
    if (!allowedWeekdays.has(weekday)) continue;

    const dayStartTime = getDayStartTime(
      currentDate,
      seasonConfig,
      config.startTime
    );
    const dayStartMinutes = parseHHMMToMinutes(dayStartTime, 15 * 60 + 30);
    let rawBudgetPerPriest = dailyEndMinutes - dayStartMinutes;
    if (rawBudgetPerPriest <= 30) rawBudgetPerPriest += 24 * 60;
    rawBudgetPerPriest = Math.max(60, rawBudgetPerPriest);

    const returnReserveMinutes = config.returnToParish ? 10 : 0;
    const totalDayTeamBudget = Math.max(
      45,
      (rawBudgetPerPriest - returnReserveMinutes) * priestCount
    );

    const alreadyOnDay = existingByDate.get(currentDate) ?? [];
    const usedMinutesOnDay = alreadyOnDay.reduce(
      (acc, s) => acc + s.durationMinutes + perStopTravelEstimate,
      0
    );

    if (usedMinutesOnDay >= totalDayTeamBudget - 15) {
      continue;
    }

    const dayBatch: VisitStop[] = [];
    let dayMinutesAccum = usedMinutesOnDay;

    while (cursorIdx < orderedQueue.length) {
      const nextStop = orderedQueue[cursorIdx];
      const cost = nextStop.durationMinutes + perStopTravelEstimate;

      // Always allow at least 1 stop on an empty day so scheduler always progresses
      if (
        dayBatch.length > 0 &&
        dayMinutesAccum + cost > totalDayTeamBudget
      ) {
        break;
      }

      dayBatch.push(nextStop);
      dayMinutesAccum += cost;
      cursorIdx += 1;
    }

    if (dayBatch.length > 0) {
      const combinedDayStops = [...alreadyOnDay, ...dayBatch];
      const partitioned = partitionStopsBySector(
        parish.location,
        combinedDayStops,
        priestCount
      );
      const partById = new Map(partitioned.map((s) => [s.id, s]));

      for (const s of dayBatch) {
        const p = partById.get(s.id) ?? s;
        updatedById.set(s.id, {
          ...p,
          visitDate: currentDate,
          included: true,
        });
      }
      // Also rebalance existing stops on that day if combined
      for (const s of alreadyOnDay) {
        const p = partById.get(s.id) ?? s;
        updatedById.set(s.id, {
          ...p,
          visitDate: currentDate,
          included: true,
        });
      }
    }
  }

  return stops.map((s) => updatedById.get(s.id) ?? s);
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
