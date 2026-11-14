import type { SelectedPlaceData } from '../components/PlaceSearchInput';
import {
  LatLng,
  PRIEST_PALETTE,
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
  ScheduledStopItem,
  VisitStop,
} from '../types/parish';
import { addMinutesToHHMM } from '../utils/spatial';

interface NominatimSearchItem {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  address?: Record<string, string>;
}

function formatNominatimItem(item: NominatimSearchItem): SelectedPlaceData {
  const addr = item.address ?? {};
  const street = addr.road || addr.pedestrian || addr.residential || '';
  const houseNum = addr.house_number || '';
  const city =
    addr.city || addr.town || addr.village || addr.municipality || '';
  const postcode = addr.postcode || '';

  const streetPart = [street, houseNum].filter(Boolean).join(' ');
  const name =
    item.name?.trim() ||
    streetPart ||
    item.display_name.split(',')[0]?.trim() ||
    'Wybrana lokalizacja';

  const cityPart = [postcode, city].filter(Boolean).join(' ');
  const shortAddress =
    streetPart && cityPart
      ? `${streetPart}, ${cityPart}`
      : streetPart || item.display_name;

  return {
    name,
    address: shortAddress,
    location: {
      lat: Number.parseFloat(item.lat),
      lng: Number.parseFloat(item.lon),
    },
    placeId: `osm_${item.place_id}`,
  };
}

export async function searchPlacesNominatim(
  query: string,
  biasLocation?: LatLng | null,
  limit = 6
): Promise<SelectedPlaceData[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const params = new URLSearchParams({
    format: 'jsonv2',
    q: trimmed,
    countrycodes: 'pl',
    addressdetails: '1',
    'accept-language': 'pl',
    limit: String(limit),
  });

  if (biasLocation) {
    const dLat = 0.25;
    const dLng = 0.35;
    params.set(
      'viewbox',
      `${(biasLocation.lng - dLng).toFixed(4)},${(biasLocation.lat + dLat).toFixed(4)},${(biasLocation.lng + dLng).toFixed(4)},${(biasLocation.lat - dLat).toFixed(4)}`
    );
  }

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    {
      headers: { Accept: 'application/json' },
    }
  );
  if (!res.ok) {
    throw new Error('Nie udało się wyszukać adresu w OpenStreetMap.');
  }
  const items = (await res.json()) as NominatimSearchItem[];
  return items
    .filter((i) => !Number.isNaN(Number.parseFloat(i.lat)))
    .map(formatNominatimItem);
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

/**
 * Nearest-neighbor + 2-opt TSP ordering around parish center.
 */
function orderStopsTsp(
  origin: LatLng,
  stops: VisitStop[],
  returnToParish: boolean
): VisitStop[] {
  if (stops.length <= 1) return stops;

  const remaining = [...stops];
  const ordered: VisitStop[] = [];
  let current = origin;

  // If open route, pick the farthest stop as fixed end anchor
  let fixedEnd: VisitStop | null = null;
  if (!returnToParish && remaining.length >= 2) {
    let farthestIdx = 0;
    let maxDist = -1;
    remaining.forEach((s, idx) => {
      const d = haversineMeters(origin, s.location);
      if (d > maxDist) {
        maxDist = d;
        farthestIdx = idx;
      }
    });
    fixedEnd = remaining.splice(farthestIdx, 1)[0];
  }

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(current, remaining[i].location);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const picked = remaining.splice(bestIdx, 1)[0];
    ordered.push(picked);
    current = picked.location;
  }

  // 2-opt local refinement on intermediate stops
  if (ordered.length >= 3) {
    const calcPathLength = (seq: VisitStop[]) => {
      let sum = haversineMeters(origin, seq[0].location);
      for (let i = 0; i < seq.length - 1; i++) {
        sum += haversineMeters(seq[i].location, seq[i + 1].location);
      }
      if (fixedEnd) {
        sum += haversineMeters(
          seq[seq.length - 1].location,
          fixedEnd.location
        );
      } else if (returnToParish) {
        sum += haversineMeters(seq[seq.length - 1].location, origin);
      }
      return sum;
    };

    let improved = true;
    let guard = 0;
    while (improved && guard < 40) {
      improved = false;
      guard += 1;
      const bestLen = calcPathLength(ordered);
      for (let i = 0; i < ordered.length - 1; i++) {
        for (let j = i + 1; j < ordered.length; j++) {
          const candidate = [
            ...ordered.slice(0, i),
            ...ordered.slice(i, j + 1).reverse(),
            ...ordered.slice(j + 1),
          ];
          if (calcPathLength(candidate) + 1 < bestLen) {
            ordered.splice(0, ordered.length, ...candidate);
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
    }
  }

  return fixedEnd ? [...ordered, fixedEnd] : ordered;
}

interface OsrmRouteResponse {
  code: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry?: {
      coordinates: Array<[number, number]>;
    };
    legs?: Array<{
      distance: number;
      duration: number;
    }>;
  }>;
}

async function fetchOsrmGeometry(
  waypoints: LatLng[],
  travelMode: PlanConfig['travelMode']
): Promise<{
  path: LatLng[];
  totalDistanceMeters: number;
  totalDurationMillis: number;
  legs: Array<{ distanceMeters: number; durationMillis: number }>;
}> {
  const coordStr = waypoints
    .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
    .join(';');

  const urls =
    travelMode === 'WALKING'
      ? [
          `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordStr}?overview=full&geometries=geojson&steps=false`,
          `https://router.project-osrm.org/route/v1/foot/${coordStr}?overview=full&geometries=geojson&steps=false`,
        ]
      : [
          `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false`,
          `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false`,
        ];

  for (const url of urls) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) continue;
      const data = (await res.json()) as OsrmRouteResponse;
      const route = data.routes?.[0];
      if (!route || data.code !== 'Ok') continue;

      const path: LatLng[] =
        route.geometry?.coordinates.map(([lng, lat]) => ({ lat, lng })) ??
        waypoints;

      const rawLegs = route.legs ?? [];
      const legs = rawLegs.map((leg) => {
        const dist = leg.distance ?? 0;
        let durMs = (leg.duration ?? 0) * 1000;
        // Guard against car-speed fallback when walking is requested
        if (travelMode === 'WALKING' && dist > 0) {
          const minWalkMs = (dist / 1.25) * 1000; // ~4.5 km/h
          if (durMs < minWalkMs * 0.75) {
            durMs = minWalkMs;
          }
        }
        return {
          distanceMeters: dist,
          durationMillis: durMs,
        };
      });

      const totalDist =
        legs.length > 0
          ? legs.reduce((acc, l) => acc + l.distanceMeters, 0)
          : route.distance ?? 0;
      const totalDur =
        legs.length > 0
          ? legs.reduce((acc, l) => acc + l.durationMillis, 0)
          : (route.duration ?? 0) * 1000;

      return {
        path,
        totalDistanceMeters: totalDist,
        totalDurationMillis: totalDur,
        legs,
      };
    } catch {
      // Try next OSRM mirror
    } finally {
      window.clearTimeout(timer);
    }
  }

  // Fallback: geodesic path & conservative speed estimate
  const speedMetersPerSec = travelMode === 'WALKING' ? 1.25 : 8.33; // 4.5 km/h vs 30 km/h
  const legs: Array<{ distanceMeters: number; durationMillis: number }> = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const dist = haversineMeters(waypoints[i], waypoints[i + 1]) * 1.15;
    legs.push({
      distanceMeters: dist,
      durationMillis: (dist / speedMetersPerSec) * 1000,
    });
  }
  return {
    path: waypoints,
    totalDistanceMeters: legs.reduce((acc, l) => acc + l.distanceMeters, 0),
    totalDurationMillis: legs.reduce((acc, l) => acc + l.durationMillis, 0),
    legs,
  };
}

export async function computeOsmParishRoutes(
  parish: ParishCenter,
  stops: VisitStop[],
  config: PlanConfig
): Promise<PriestRouteResult[]> {
  if (stops.length === 0) return [];

  const normalizedStops = stops.map((s) =>
    s.priestId > config.priestCount ? { ...s, priestId: 1 } : s
  );

  const activePriestIds = Array.from(
    new Set(normalizedStops.map((s) => s.priestId))
  ).sort((a, b) => a - b);

  const results: PriestRouteResult[] = [];

  for (const priestId of activePriestIds) {
    const priestProfile =
      PRIEST_PALETTE.find((p) => p.id === priestId) ?? PRIEST_PALETTE[0];
    const priestStops = normalizedStops.filter((s) => s.priestId === priestId);
    if (priestStops.length === 0) continue;

    // Limit single OSRM URL request to 60 points for smooth reliability
    const cappedStops = priestStops.slice(0, 60);
    const truncatedCount = priestStops.length - cappedStops.length;

    const orderedStops = orderStopsTsp(
      parish.location,
      cappedStops,
      config.returnToParish
    );

    const waypoints: LatLng[] = [
      parish.location,
      ...orderedStops.map((s) => s.location),
      ...(config.returnToParish ? [parish.location] : []),
    ];

    const osrm = await fetchOsrmGeometry(waypoints, config.travelMode);

    let elapsedMinutes = 0;
    let totalVisitMinutes = 0;

    const scheduledItems: ScheduledStopItem[] = orderedStops.map(
      (stop, idx) => {
        const leg = osrm.legs[idx];
        const legDist = leg?.distanceMeters ?? 0;
        const legDurMs = leg?.durationMillis ?? 0;
        const legMins = Math.round(legDurMs / 60000);

        elapsedMinutes += legMins;
        const arrivalTime = addMinutesToHHMM(config.startTime, elapsedMinutes);
        elapsedMinutes += stop.durationMinutes;
        totalVisitMinutes += stop.durationMinutes;
        const departureTime = addMinutesToHHMM(
          config.startTime,
          elapsedMinutes
        );

        return {
          stop,
          orderIndex: idx + 1,
          arrivalTime,
          departureTime,
          legDistanceMeters: legDist,
          legDurationMillis: legDurMs,
        };
      }
    );

    let returnLegDistanceMeters = 0;
    let returnLegDurationMillis = 0;
    if (config.returnToParish && osrm.legs.length > orderedStops.length) {
      const returnLeg = osrm.legs[orderedStops.length];
      returnLegDistanceMeters = returnLeg?.distanceMeters ?? 0;
      returnLegDurationMillis = returnLeg?.durationMillis ?? 0;
      elapsedMinutes += Math.round(returnLegDurationMillis / 60000);
    }

    const endTime = addMinutesToHHMM(config.startTime, elapsedMinutes);

    results.push({
      priestId,
      priestName: priestProfile.name,
      color: priestProfile.color,
      orderedStops: scheduledItems,
      totalDistanceMeters: osrm.totalDistanceMeters,
      totalTravelDurationMillis: osrm.totalDurationMillis,
      totalVisitMinutes,
      endTime,
      returnLegDistanceMeters,
      returnLegDurationMillis,
      encodedPathPoints: osrm.path,
      error:
        truncatedCount > 0
          ? `Uwzględniono pierwsze ${cappedStops.length} punktów na trasie (pominięto ${truncatedCount}).`
          : undefined,
    });
  }

  return results;
}
