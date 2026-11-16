import {
  LatLng,
  MarkerLabelMode,
  ParishCenter,
  PriestRouteResult,
  RouteStageLink,
  ScheduledStopItem,
  TravelModeOption,
  VisitStop,
} from '../types/parish';

export const MAX_ROUTES_API_INTERMEDIATES = 25;

export function createPresetBoundaryPolygon(
  center: LatLng,
  radiusMeters = 500,
  sides = 8
): LatLng[] {
  const latDegPerMeter = 1 / 111320;
  const lngDegPerMeter =
    1 / (111320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));

  const points: LatLng[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides;
    points.push({
      lat: center.lat + Math.sin(angle) * radiusMeters * latDegPerMeter,
      lng: center.lng + Math.cos(angle) * radiusMeters * lngDegPerMeter,
    });
  }
  return points;
}

export function scaleBoundaryFromCenter(
  boundary: LatLng[],
  factor: number,
  fallbackCenter?: LatLng
): LatLng[] {
  if (boundary.length < 3) return boundary;
  const centroid = boundary.reduce(
    (acc, pt) => ({
      lat: acc.lat + pt.lat / boundary.length,
      lng: acc.lng + pt.lng / boundary.length,
    }),
    { lat: 0, lng: 0 }
  );
  const origin =
    Number.isFinite(centroid.lat) && Number.isFinite(centroid.lng)
      ? centroid
      : fallbackCenter ?? boundary[0];

  return boundary.map((pt) => ({
    lat: Math.max(-89.9, Math.min(89.9, origin.lat + (pt.lat - origin.lat) * factor)),
    lng: Math.max(-179.9, Math.min(179.9, origin.lng + (pt.lng - origin.lng) * factor)),
  }));
}

function rdpSimplifyMetric(
  pts: Array<{ lat: number; lng: number; x: number; y: number }>,
  toleranceMeters: number
): Array<{ lat: number; lng: number; x: number; y: number }> {
  if (pts.length <= 2) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const lenSq = dx * dx + dy * dy;

  let maxDistSq = -1;
  let maxIdx = 0;

  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    let distSq: number;
    if (lenSq < 1e-6) {
      distSq = (p.x - first.x) ** 2 + (p.y - first.y) ** 2;
    } else {
      const t = Math.max(
        0,
        Math.min(1, ((p.x - first.x) * dx + (p.y - first.y) * dy) / lenSq)
      );
      const px = first.x + t * dx;
      const py = first.y + t * dy;
      distSq = (p.x - px) ** 2 + (p.y - py) ** 2;
    }
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      maxIdx = i;
    }
  }

  if (maxDistSq > toleranceMeters * toleranceMeters) {
    const left = rdpSimplifyMetric(pts.slice(0, maxIdx + 1), toleranceMeters);
    const right = rdpSimplifyMetric(pts.slice(maxIdx), toleranceMeters);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

export function simplifyPolygonRDP(
  points: LatLng[],
  toleranceMeters = 18,
  maxPoints = 26
): LatLng[] {
  if (points.length <= 3) return points;

  const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const latScale = 111320;
  const lngScale = 111320 * Math.max(0.2, Math.cos((avgLat * Math.PI) / 180));

  const metricPts: Array<{ lat: number; lng: number; x: number; y: number }> = [];
  for (const p of points) {
    const x = p.lng * lngScale;
    const y = p.lat * latScale;
    const prev = metricPts[metricPts.length - 1];
    if (!prev || (x - prev.x) ** 2 + (y - prev.y) ** 2 >= 9) {
      metricPts.push({ lat: p.lat, lng: p.lng, x, y });
    }
  }

  // Drop closing duplicate vertex if present
  if (metricPts.length > 3) {
    const first = metricPts[0];
    const last = metricPts[metricPts.length - 1];
    if ((last.x - first.x) ** 2 + (last.y - first.y) ** 2 < 25) {
      metricPts.pop();
    }
  }

  if (metricPts.length <= 3) {
    return metricPts.map(({ lat, lng }) => ({ lat, lng }));
  }

  // Split ring cleanly at farthest point from index 0 so closed RDP preserves overall shape
  let farIdx = Math.floor(metricPts.length / 2);
  let farDistSq = -1;
  for (let i = 1; i < metricPts.length; i++) {
    const dSq =
      (metricPts[i].x - metricPts[0].x) ** 2 +
      (metricPts[i].y - metricPts[0].y) ** 2;
    if (dSq > farDistSq) {
      farDistSq = dSq;
      farIdx = i;
    }
  }

  const arc1 = metricPts.slice(0, farIdx + 1);
  const arc2 = [...metricPts.slice(farIdx), metricPts[0]];

  let tol = Math.max(4, toleranceMeters);
  let result: Array<{ lat: number; lng: number; x: number; y: number }> = [];

  for (let pass = 0; pass < 14; pass++) {
    const s1 = rdpSimplifyMetric(arc1, tol);
    const s2 = rdpSimplifyMetric(arc2, tol);
    result = [...s1.slice(0, -1), ...s2.slice(0, -1)];
    if (result.length <= maxPoints || result.length <= 4) {
      break;
    }
    tol *= 1.35;
  }

  if (result.length < 3) {
    return metricPts.slice(0, Math.min(maxPoints, metricPts.length)).map(({ lat, lng }) => ({ lat, lng }));
  }

  return result.slice(0, maxPoints).map(({ lat, lng }) => ({ lat, lng }));
}

export function computePolygonAreaSqMeters(boundary: LatLng[]): number {
  if (boundary.length < 3) return 0;
  const avgLat = boundary.reduce((s, p) => s + p.lat, 0) / boundary.length;
  const latScale = 111320;
  const lngScale = 111320 * Math.max(0.2, Math.cos((avgLat * Math.PI) / 180));

  const x0 = boundary[0].lng * lngScale;
  const y0 = boundary[0].lat * latScale;
  let twiceArea = 0;

  for (let i = 0; i < boundary.length; i++) {
    const p1 = boundary[i];
    const p2 = boundary[(i + 1) % boundary.length];
    const x1 = p1.lng * lngScale - x0;
    const y1 = p1.lat * latScale - y0;
    const x2 = p2.lng * lngScale - x0;
    const y2 = p2.lat * latScale - y0;
    twiceArea += x1 * y2 - x2 * y1;
  }
  return Math.abs(twiceArea) / 2;
}

export function formatPolygonArea(areaSqMeters: number): string {
  if (!Number.isFinite(areaSqMeters) || areaSqMeters <= 0) return '';
  if (areaSqMeters < 100000) {
    const ha = areaSqMeters / 10000;
    return `${ha.toFixed(ha < 10 ? 1 : 0).replace('.', ',')} ha`;
  }
  const km2 = areaSqMeters / 1000000;
  return `${km2.toFixed(km2 < 10 ? 2 : 1).replace('.', ',')} km²`;
}

export function createBufferedHullBoundary(
  points: LatLng[],
  bufferMeters = 90
): LatLng[] {
  if (points.length === 0) return [];

  const unique: LatLng[] = [];
  for (const pt of points) {
    const exists = unique.some(
      (u) => Math.abs(u.lat - pt.lat) < 1e-6 && Math.abs(u.lng - pt.lng) < 1e-6
    );
    if (!exists) unique.push(pt);
  }

  if (unique.length === 1) {
    return createPresetBoundaryPolygon(unique[0], Math.max(160, bufferMeters), 10);
  }

  const avgLat = unique.reduce((s, p) => s + p.lat, 0) / unique.length;
  const latScale = 111320;
  const lngScale = 111320 * Math.max(0.2, Math.cos((avgLat * Math.PI) / 180));

  if (unique.length === 2) {
    const [a, b] = unique;
    const mid: LatLng = {
      lat: (a.lat + b.lat) / 2,
      lng: (a.lng + b.lng) / 2,
    };
    const dx = (b.lng - a.lng) * lngScale;
    const dy = (b.lat - a.lat) * latScale;
    const radius = Math.max(150, Math.hypot(dx, dy) / 2 + bufferMeters);
    return createPresetBoundaryPolygon(mid, radius, 10);
  }

  const sorted = [...unique].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  const cross = (o: LatLng, a: LatLng, b: LatLng) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);

  const lower: LatLng[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: LatLng[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length < 3) {
    const center = {
      lat: unique.reduce((s, p) => s + p.lat, 0) / unique.length,
      lng: unique.reduce((s, p) => s + p.lng, 0) / unique.length,
    };
    return createPresetBoundaryPolygon(center, Math.max(200, bufferMeters), 10);
  }

  const centroid = {
    lat: hull.reduce((s, p) => s + p.lat, 0) / hull.length,
    lng: hull.reduce((s, p) => s + p.lng, 0) / hull.length,
  };

  const expanded = hull.map((pt) => {
    const vx = (pt.lng - centroid.lng) * lngScale;
    const vy = (pt.lat - centroid.lat) * latScale;
    const len = Math.hypot(vx, vy) || 1;
    return {
      lat: pt.lat + ((vy / len) * bufferMeters) / latScale,
      lng: pt.lng + ((vx / len) * bufferMeters) / lngScale,
    };
  });

  return simplifyPolygonRDP(expanded, 12, 24);
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2).replace('.', ',')} km`;
}

export function formatDurationMillis(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) {
    return `${mins} min`;
  }
  if (mins === 0) {
    return `${hours} godz.`;
  }
  return `${hours} godz. ${mins} min`;
}

export function formatMinutesLabel(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} godz.`;
  return `${hours} godz. ${mins} min`;
}

export function addMinutesToHHMM(hhmm: string, deltaMinutes: number): string {
  const [hStr, mStr] = hhmm.split(':');
  const baseH = Number.parseInt(hStr || '15', 10);
  const baseM = Number.parseInt(mStr || '30', 10);
  const total = ((baseH * 60 + baseM + Math.round(deltaMinutes)) % 1440 + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Checks whether a point lies inside a polygon using ray-casting
 * (mirrors google.maps.geometry.poly.containsLocation when SDK geometry is unavailable).
 */
export function isPointInsideBoundary(point: LatLng, boundary: LatLng[]): boolean {
  if (boundary.length < 3) return true;

  if (
    typeof google !== 'undefined' &&
    google.maps?.geometry?.poly?.containsLocation
  ) {
    const gLatLng = new google.maps.LatLng(point.lat, point.lng);
    const gPoly = new google.maps.Polygon({ paths: boundary });
    return google.maps.geometry.poly.containsLocation(gLatLng, gPoly);
  }

  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const xi = boundary[i].lng;
    const yi = boundary[i].lat;
    const xj = boundary[j].lng;
    const yj = boundary[j].lat;

    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Partitions parish visit stops among N priests using polar angle sweep around the church.
 * Produces compact, non-overlapping geographic sectors.
 */
export function partitionStopsBySector(
  origin: LatLng,
  stops: VisitStop[],
  priestCount: number
): VisitStop[] {
  if (stops.length === 0) return stops;
  const clampedCount = Math.max(1, Math.min(4, priestCount));

  if (clampedCount === 1) {
    return stops.map((s) => ({ ...s, priestId: 1 }));
  }

  const withAngles = stops.map((stop) => {
    const angle = Math.atan2(
      stop.location.lat - origin.lat,
      stop.location.lng - origin.lng
    );
    const distSq =
      (stop.location.lat - origin.lat) ** 2 +
      (stop.location.lng - origin.lng) ** 2;
    return { stop, angle, distSq };
  });

  withAngles.sort((a, b) => a.angle - b.angle || a.distSq - b.distSq);

  const total = withAngles.length;
  return withAngles.map((entry, idx) => {
    const sectorIndex = Math.min(
      clampedCount - 1,
      Math.floor((idx * clampedCount) / total)
    );
    return {
      ...entry.stop,
      priestId: sectorIndex + 1,
    };
  });
}

/**
 * Generates an official Google Maps turn-by-turn directions URL for mobile navigation.
 */
export function buildGoogleMapsDirectionsUrl(
  parish: ParishCenter,
  orderedStops: VisitStop[],
  returnToParish: boolean,
  travelMode: TravelModeOption
): string {
  if (orderedStops.length === 0) return 'https://www.google.com/maps';

  const originStr = `${parish.location.lat},${parish.location.lng}`;
  const destinationStop = returnToParish
    ? parish.location
    : orderedStops[orderedStops.length - 1].location;
  const destinationStr = `${destinationStop.lat},${destinationStop.lng}`;

  const intermediateStops = returnToParish
    ? orderedStops
    : orderedStops.slice(0, -1);

  const params = new URLSearchParams({
    api: '1',
    origin: originStr,
    destination: destinationStr,
    travelmode: travelMode === 'WALKING' ? 'walking' : 'driving',
  });

  if (intermediateStops.length > 0) {
    params.set(
      'waypoints',
      intermediateStops
        .slice(0, 9)
        .map((s) => `${s.location.lat},${s.location.lng}`)
        .join('|')
    );
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Splits any route of arbitrary length (e.g. 40–100+ stops) into sequential Google Maps
 * navigation legs respecting the mobile app cap of 9 intermediate waypoints + destination.
 */
export function buildGoogleMapsStageUrls(
  parish: ParishCenter,
  orderedStops: VisitStop[],
  returnToParish: boolean,
  travelMode: TravelModeOption
): RouteStageLink[] {
  if (orderedStops.length === 0) return [];

  const modeParam = travelMode === 'WALKING' ? 'walking' : 'driving';
  const maxStopsPerStage = 10; // up to 9 intermediates + 1 destination per mobile leg
  const stages: RouteStageLink[] = [];

  let cursorOrigin: LatLng = parish.location;
  let offset = 0;

  while (offset < orderedStops.length) {
    const remaining = orderedStops.length - offset;
    const isFinalChunk = remaining <= maxStopsPerStage;
    const takeCount = isFinalChunk ? remaining : maxStopsPerStage;
    const slice = orderedStops.slice(offset, offset + takeCount);

    const includesReturnHere = isFinalChunk && returnToParish && slice.length <= 9;
    const destLoc = includesReturnHere
      ? parish.location
      : slice[slice.length - 1].location;
    const waypointsList = includesReturnHere ? slice : slice.slice(0, -1);

    const params = new URLSearchParams({
      api: '1',
      origin: `${cursorOrigin.lat},${cursorOrigin.lng}`,
      destination: `${destLoc.lat},${destLoc.lng}`,
      travelmode: modeParam,
    });
    if (waypointsList.length > 0) {
      params.set(
        'waypoints',
        waypointsList
          .map((s) => `${s.location.lat},${s.location.lng}`)
          .join('|')
      );
    }

    stages.push({
      stageIndex: stages.length + 1,
      startStopNumber: offset + 1,
      endStopNumber: offset + slice.length,
      url: `https://www.google.com/maps/dir/?${params.toString()}`,
    });

    cursorOrigin = slice[slice.length - 1].location;
    offset += takeCount;

    if (isFinalChunk && returnToParish && !includesReturnHere) {
      const returnParams = new URLSearchParams({
        api: '1',
        origin: `${cursorOrigin.lat},${cursorOrigin.lng}`,
        destination: `${parish.location.lat},${parish.location.lng}`,
        travelmode: modeParam,
      });
      stages.push({
        stageIndex: stages.length + 1,
        startStopNumber: orderedStops.length,
        endStopNumber: orderedStops.length,
        isReturnLeg: true,
        url: `https://www.google.com/maps/dir/?${returnParams.toString()}`,
      });
    }
  }

  return stages;
}

export function exportScheduleToCsv(
  parish: ParishCenter | null,
  routes: PriestRouteResult[]
): void {
  const header = [
    'Ksiądz',
    'Kolejność',
    'Adres domu',
    'Przyjście',
    'Wyjście',
    'Czas wizyty (min)',
    'Przejazd od poprzedniego (m)',
    'Rodzina / Uwagi',
  ];

  const rows: string[][] = [];
  for (const route of routes) {
    for (const item of route.orderedStops) {
      const houseAddress = item.stop.address || item.stop.label;
      const unitCount = item.stop.units?.length || item.stop.unitsCount || 0;
      const blockLabel =
        item.stop.isMultiUnit && unitCount > 0
          ? `Blok (${unitCount} lok.)`
          : item.stop.isMultiUnit
            ? 'Blok'
            : '';
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
      const notes = [
        blockLabel,
        unitsSummary,
        item.stop.label && item.stop.label !== houseAddress
          ? item.stop.label
          : '',
        item.stop.notes || '',
      ]
        .filter(Boolean)
        .join(' · ');

      rows.push([
        route.priestName,
        String(item.orderIndex),
        houseAddress,
        item.arrivalTime,
        item.departureTime,
        String(item.stop.durationMinutes),
        String(Math.round(item.legDistanceMeters)),
        notes,
      ]);
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
  link.setAttribute('download', `plan-koledy-${slug || 'parafia'}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function extractStreetName(stop: Pick<VisitStop, 'address' | 'label'>): string {
  const raw = (stop.label || stop.address).split(',')[0]?.trim() || stop.address;
  const cleaned = raw
    .replace(/\s+\d+[a-zA-Z]?(\s*\/\s*\d+[a-zA-Z]?)?(\s*[a-zA-Z])?$/, '')
    .replace(/\s*\(środek ulicy\)\s*$/i, '')
    .trim();
  return cleaned || raw;
}

export function extractHouseNumberLabel(
  stop: Pick<VisitStop, 'address' | 'label'>
): string {
  const firstPart = (stop.label || stop.address).split(',')[0]?.trim() || '';
  const match = firstPart.match(/\b(\d+[a-zA-Z]?(?:\s*\/\s*\d+[a-zA-Z]?)?)$/);
  return match ? match[1].replace(/\s+/g, '') : '';
}

export function isEvenHouseNumberStr(houseNumber: string): boolean | null {
  const match = houseNumber.match(/^\d+/);
  if (!match) return null;
  const num = Number.parseInt(match[0], 10);
  return num % 2 === 0;
}

export function extractHouseNumberSortKey(houseNumber: string): number {
  const match = houseNumber.match(/^\d+/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number.parseInt(match[0], 10);
}

/**
 * Formats a concise human-readable range of house numbers for parish bulletin announcements,
 * e.g. "1–45" or "2, 4, 6" when sparse.
 */
export function formatStreetHouseRange(
  stops: Array<Pick<VisitStop, 'address' | 'label'>>
): string {
  const numbers = stops
    .map((s) => extractHouseNumberLabel(s))
    .filter(Boolean);
  if (numbers.length === 0) return '';

  const unique = Array.from(new Set(numbers)).sort(
    (a, b) =>
      extractHouseNumberSortKey(a) - extractHouseNumberSortKey(b) ||
      a.localeCompare(b, 'pl', { numeric: true })
  );

  if (unique.length === 1) return `nr ${unique[0]}`;
  if (unique.length <= 4) return `nr ${unique.join(', ')}`;
  return `nr ${unique[0]}–${unique[unique.length - 1]}`;
}

export interface RouteStopMeta {
  orderNumber: number;
  arrivalTime: string;
  departureTime: string;
  isFirstInRoute: boolean;
  isLastInRoute: boolean;
  isStreetEntry: boolean;
  isOverviewMilestone: boolean;
}

export function buildRouteStopLookup(
  routes: PriestRouteResult[]
): Record<string, RouteStopMeta> {
  const dict: Record<string, RouteStopMeta> = {};

  for (const route of routes) {
    const items: ScheduledStopItem[] = route.orderedStops;
    const total = items.length;
    if (total === 0) continue;

    const milestoneStep = total > 60 ? 10 : total > 35 ? 5 : 4;
    let prevStreet = '';

    for (let i = 0; i < total; i++) {
      const item = items[i];
      const street = extractStreetName(item.stop);
      const isStreetEntry = street !== prevStreet;
      prevStreet = street;

      const isFirstInRoute = i === 0;
      const isLastInRoute = i === total - 1;
      const isOverviewMilestone =
        isFirstInRoute ||
        isLastInRoute ||
        item.orderIndex % milestoneStep === 0;

      dict[item.stop.id] = {
        orderNumber: item.orderIndex,
        arrivalTime: item.arrivalTime,
        departureTime: item.departureTime,
        isFirstInRoute,
        isLastInRoute,
        isStreetEntry,
        isOverviewMilestone,
      };
    }
  }

  return dict;
}

export interface StopMarkerAppearance {
  size: number;
  showLabel: boolean;
  labelText: string;
  fontSize: number;
  opacity: number;
  borderWidth: number;
  borderColorOverride?: string;
  fillColorOverride?: string;
  zIndexPriority: number;
  isStartPoint?: boolean;
}

export function computeStopMarkerAppearance({
  zoom,
  activeVisibleCount,
  markerLabelMode,
  isActiveInView,
  isDimmedByPriest,
  isDimmedByStreet,
  hasFocusedStreet,
  isSelected,
  isBlock,
  routeMeta,
}: {
  zoom: number;
  activeVisibleCount: number;
  markerLabelMode: MarkerLabelMode;
  isActiveInView: boolean;
  isDimmedByPriest: boolean;
  isDimmedByStreet: boolean;
  hasFocusedStreet: boolean;
  isSelected: boolean;
  isBlock: boolean;
  routeMeta?: RouteStopMeta;
}): StopMarkerAppearance {
  if (!isActiveInView || isDimmedByStreet) {
    return {
      size: isSelected ? 22 : 9,
      showLabel: isSelected,
      labelText: isSelected && routeMeta ? String(routeMeta.orderNumber) : '',
      fontSize: 10,
      opacity: isSelected ? 1 : isDimmedByStreet ? 0.24 : 0.26,
      borderWidth: isSelected ? 2.5 : 1.5,
      fillColorOverride: isDimmedByStreet ? '#94A3B8' : '#CBD5E1',
      borderColorOverride: isSelected ? '#0F172A' : '#64748B',
      zIndexPriority: isSelected ? 400 : 15,
    };
  }

  const orderNumber = routeMeta?.orderNumber;
  const isStartPoint = Boolean(routeMeta?.isFirstInRoute) && !isDimmedByPriest;
  const opacity = isDimmedByPriest ? 0.28 : 1;

  if (markerLabelMode === 'dots') {
    const showKeyBadge =
      isSelected ||
      Boolean(routeMeta?.isFirstInRoute) ||
      Boolean(routeMeta?.isLastInRoute);
    const size = showKeyBadge ? (isSelected ? 26 : isStartPoint ? 26 : 20) : isBlock ? 15 : 12;
    return {
      size,
      showLabel: showKeyBadge && Boolean(orderNumber),
      labelText: showKeyBadge ? (orderNumber ? String(orderNumber) : isBlock ? 'B' : '') : '',
      fontSize: 10,
      opacity,
      borderWidth: isStartPoint ? 3 : showKeyBadge ? 2 : 1.5,
      fillColorOverride: isStartPoint && !isSelected ? '#15803D' : undefined,
      borderColorOverride: isSelected ? '#0F172A' : '#FFFFFF',
      zIndexPriority: isSelected ? 400 : isStartPoint ? 360 : showKeyBadge ? 250 : isBlock ? 140 : 80,
      isStartPoint,
    };
  }

  // In 'numbers' mode or whenever viewing a day/street (<= 140 houses or zoom >= 14),
  // display every single point sequentially (1, 2, 3...) without dropping houses into unlabeled dots.
  const showEveryHouseNumber =
    markerLabelMode === 'numbers' ||
    hasFocusedStreet ||
    activeVisibleCount <= 140 ||
    zoom >= 15;

  if (showEveryHouseNumber) {
    const size = isSelected
      ? 28
      : isStartPoint
        ? 27
        : orderNumber
          ? 24
          : isBlock
            ? 22
            : 19;
    return {
      size,
      showLabel: Boolean(orderNumber) || isBlock,
      labelText: orderNumber ? String(orderNumber) : isBlock ? 'B' : '',
      fontSize: orderNumber && orderNumber >= 100 ? 9 : 10,
      opacity,
      borderWidth: isStartPoint ? 3 : 2,
      fillColorOverride: isStartPoint && !isSelected ? '#15803D' : undefined,
      borderColorOverride: isSelected ? '#0F172A' : '#FFFFFF',
      zIndexPriority: isSelected
        ? 450
        : isStartPoint
          ? 390
          : isDimmedByPriest
            ? 40
            : orderNumber
              ? 300 - Math.min(200, orderNumber)
              : 100,
      isStartPoint,
    };
  }

  // Extreme overview with >140 houses zoomed way out: still highlight START, end & street entries
  const showOverviewAnchor =
    isSelected ||
    isStartPoint ||
    isBlock ||
    Boolean(routeMeta?.isLastInRoute) ||
    Boolean(routeMeta?.isStreetEntry);

  if (showOverviewAnchor) {
    return {
      size: isSelected ? 26 : isStartPoint ? 26 : 21,
      showLabel: Boolean(orderNumber) || isBlock,
      labelText: orderNumber ? String(orderNumber) : isBlock ? 'B' : '',
      fontSize: orderNumber && orderNumber >= 100 ? 9 : 10,
      opacity,
      borderWidth: isStartPoint ? 3 : 2,
      fillColorOverride: isStartPoint && !isSelected ? '#15803D' : undefined,
      borderColorOverride: isSelected ? '#0F172A' : '#FFFFFF',
      zIndexPriority: isSelected
        ? 450
        : isStartPoint
          ? 390
          : routeMeta?.isLastInRoute
            ? 340
            : 290,
      isStartPoint,
    };
  }

  return {
    size: 12,
    showLabel: false,
    labelText: '',
    fontSize: 9,
    opacity: isDimmedByPriest ? 0.25 : 0.92,
    borderWidth: 1.5,
    borderColorOverride: '#FFFFFF',
    zIndexPriority: isDimmedByPriest ? 35 : 95,
  };
}

