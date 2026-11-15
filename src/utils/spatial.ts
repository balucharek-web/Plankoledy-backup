import {
  LatLng,
  MarkerLabelMode,
  ParishCenter,
  PriestRouteResult,
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
  const opacity = isDimmedByPriest ? 0.28 : 1;

  if (markerLabelMode === 'dots') {
    const showKeyBadge =
      isSelected ||
      Boolean(routeMeta?.isFirstInRoute) ||
      Boolean(routeMeta?.isLastInRoute);
    const size = showKeyBadge ? (isSelected ? 24 : 20) : isBlock ? 15 : 12;
    return {
      size,
      showLabel: showKeyBadge && Boolean(orderNumber),
      labelText: showKeyBadge ? (orderNumber ? String(orderNumber) : isBlock ? 'B' : '') : '',
      fontSize: 10,
      opacity,
      borderWidth: showKeyBadge ? 2 : 1.5,
      borderColorOverride: isSelected ? '#0F172A' : '#FFFFFF',
      zIndexPriority: isSelected ? 400 : showKeyBadge ? 250 : isBlock ? 140 : 80,
    };
  }

  if (markerLabelMode === 'numbers') {
    const size = isSelected ? 26 : orderNumber ? 24 : isBlock ? 22 : 19;
    return {
      size,
      showLabel: Boolean(orderNumber) || isBlock,
      labelText: orderNumber ? String(orderNumber) : isBlock ? 'B' : '',
      fontSize: orderNumber && orderNumber >= 100 ? 9 : 10,
      opacity,
      borderWidth: 2,
      borderColorOverride: isSelected ? '#0F172A' : '#FFFFFF',
      zIndexPriority: isSelected
        ? 400
        : isDimmedByPriest
          ? 40
          : orderNumber
            ? 240 - Math.min(140, orderNumber)
            : 100,
    };
  }

  // 'auto': Smart zoom & density adaptation
  const sparseOrDetailedZoom =
    hasFocusedStreet || activeVisibleCount <= 18 || zoom >= 17;

  if (sparseOrDetailedZoom) {
    const size = isSelected ? 26 : orderNumber ? 24 : isBlock ? 22 : 18;
    return {
      size,
      showLabel: Boolean(orderNumber) || isBlock,
      labelText: orderNumber ? String(orderNumber) : isBlock ? 'B' : '',
      fontSize: orderNumber && orderNumber >= 100 ? 9 : 10,
      opacity,
      borderWidth: 2,
      borderColorOverride: isSelected ? '#0F172A' : '#FFFFFF',
      zIndexPriority: isSelected
        ? 400
        : isDimmedByPriest
          ? 40
          : orderNumber
            ? 260 - Math.min(150, orderNumber)
            : 110,
    };
  }

  if (zoom >= 16) {
    const showMediumAnchor =
      isSelected ||
      isBlock ||
      Boolean(routeMeta?.isFirstInRoute) ||
      Boolean(routeMeta?.isLastInRoute) ||
      Boolean(routeMeta?.isStreetEntry) ||
      Boolean(orderNumber && orderNumber % 4 === 0);

    if (showMediumAnchor) {
      return {
        size: isSelected ? 25 : 22,
        showLabel: Boolean(orderNumber) || isBlock,
        labelText: orderNumber ? String(orderNumber) : isBlock ? 'B' : '',
        fontSize: orderNumber && orderNumber >= 100 ? 9 : 10,
        opacity,
        borderWidth: 2,
        borderColorOverride: isSelected ? '#0F172A' : '#FFFFFF',
        zIndexPriority: isSelected ? 400 : 280,
      };
    }

    return {
      size: 13,
      showLabel: false,
      labelText: '',
      fontSize: 9,
      opacity,
      borderWidth: 1.5,
      borderColorOverride: '#FFFFFF',
      zIndexPriority: 100,
    };
  }

  // Overview zoom (zoom <= 15) with dense stops (> 18): clean dots + key milestone badges
  const showOverviewAnchor =
    isSelected ||
    isBlock ||
    Boolean(routeMeta?.isOverviewMilestone);

  if (showOverviewAnchor) {
    return {
      size: isSelected ? 25 : 21,
      showLabel: Boolean(orderNumber) || isBlock,
      labelText: orderNumber ? String(orderNumber) : isBlock ? 'B' : '',
      fontSize: orderNumber && orderNumber >= 100 ? 9 : 10,
      opacity,
      borderWidth: 2,
      borderColorOverride: isSelected ? '#0F172A' : '#FFFFFF',
      zIndexPriority: isSelected
        ? 400
        : routeMeta?.isFirstInRoute || routeMeta?.isLastInRoute
          ? 340
          : 290,
    };
  }

  return {
    size: 11,
    showLabel: false,
    labelText: '',
    fontSize: 9,
    opacity: isDimmedByPriest ? 0.25 : 0.92,
    borderWidth: 1.5,
    borderColorOverride: '#FFFFFF',
    zIndexPriority: isDimmedByPriest ? 35 : 95,
  };
}

