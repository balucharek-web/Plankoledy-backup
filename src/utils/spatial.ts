import {
  LatLng,
  ParishCenter,
  PriestRouteResult,
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
      const notes = [
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

