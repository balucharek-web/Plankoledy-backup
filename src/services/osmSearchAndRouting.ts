import type { SelectedPlaceData } from '../components/PlaceSearchInput';
import {
  DayBreakWindow,
  LatLng,
  PRIEST_PALETTE,
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
  ScheduledStopItem,
  VisitStop,
} from '../types/parish';
import { extractStreetName, isBlockStop } from '../utils/spatial';
import {
  advanceStopClockWithBreaks,
  formatAbsMinutesToHHMM,
  getEffectiveStopDurationMinutes,
  parseHHMMToMinutes,
} from '../utils/seasonScheduler';
import { fetchNearbyParishesOsm } from './overpassStreets';

interface NominatimSearchItem {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  class?: string;
  type?: string;
  address?: Record<string, string>;
}

interface PhotonFeature {
  geometry?: {
    coordinates?: [number, number];
  };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    locality?: string;
    district?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    postcode?: string;
  };
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

const POLAND_CENTER: LatLng = { lat: 52.0693, lng: 19.4803 };

function stripPolishDiacritics(text: string): string {
  return text
    .replace(/[łŁ]/g, (m) => (m === 'Ł' ? 'L' : 'l'))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeParishQuery(raw: string): {
  cleaned: string;
  strippedCore: string;
  tokens: string[];
  wantsCemetery: boolean;
} {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\bpw\.?\b/gi, ' ')
    .replace(/\bks\.?\b/gi, ' ')
    .replace(/\bNMP\b/g, 'Najświętszej Maryi Panny')
    .replace(/\bMB\b/g, 'Matki Bożej')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove optional institutional prefixes that often differ from OSM names
  // (e.g. user types "parafia Mikołów" while OSM calls it "Kościół pw. ...")
  const strippedCore = cleaned
    .replace(
      /\b(parafia|rzymskokatolicka|kościół|kosciol|kośc\.|kosc\.|par\.|bazylika|sanktuarium|katedra|kaplica|pw|św\.?|sw\.?|świętego|swietego|świętej|swietej|święty|swiety|święta|swieta|bł\.?|bl\.?|błogosławionego|błogosławionej)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = stripPolishDiacritics(strippedCore || cleaned)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);

  const wantsCemetery = /cment|cmentar/i.test(raw);

  return { cleaned, strippedCore, tokens, wantsCemetery };
}

function isParishPhotonFeature(props: NonNullable<PhotonFeature['properties']>): boolean {
  if (props.osm_key === 'amenity' && props.osm_value === 'place_of_worship') {
    return true;
  }
  if (
    props.osm_key === 'building' &&
    ['church', 'cathedral', 'chapel'].includes(props.osm_value || '')
  ) {
    return true;
  }
  const nameLower = (props.name || '').toLowerCase();
  return /(parafi|kościół|kosciol|bazylika|sanktuarium|katedra|kaplica|plebania)/.test(
    nameLower
  );
}

function isCemeteryFeature(props: NonNullable<PhotonFeature['properties']>): boolean {
  if (props.osm_value === 'cemetery' || props.osm_key === 'landuse' && props.osm_value === 'cemetery') {
    return true;
  }
  return false;
}

function formatPhotonFeature(
  feature: PhotonFeature,
  forcedType?: SelectedPlaceData['placeType']
): SelectedPlaceData | null {
  const coords = feature.geometry?.coordinates;
  const props = feature.properties;
  if (!coords || coords.length < 2 || !props) return null;

  const [lng, lat] = coords;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  const streetPart = [props.street, props.housenumber].filter(Boolean).join(' ');
  const city = props.city || props.town || props.village || props.county || '';
  const locality =
    props.locality && props.locality !== city ? props.locality : '';
  const cityPart = [props.postcode, city].filter(Boolean).join(' ');

  const isChurch = isParishPhotonFeature(props);
  const isCityPlace =
    props.osm_key === 'place' ||
    ['city', 'town', 'village', 'district', 'locality'].includes(
      props.type || ''
    );

  const name =
    props.name?.trim() ||
    streetPart ||
    city ||
    props.district ||
    'Wybrana lokalizacja';

  const addressParts = [streetPart, locality, cityPart || props.state].filter(
    Boolean
  );
  const address =
    addressParts.join(', ') || props.country || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

  const placeType: SelectedPlaceData['placeType'] =
    forcedType ?? (isChurch ? 'parish' : isCityPlace ? 'place' : 'address');

  return {
    name,
    address,
    location: { lat, lng },
    placeId: `osm_${props.osm_type || 'N'}_${props.osm_id || `${lat}_${lng}`}`,
    placeType,
  };
}

async function queryPhotonRaw(
  query: string,
  options: {
    biasLocation?: LatLng | null;
    osmTag?: string;
    limit?: number;
    timeoutMs?: number;
  } = {}
): Promise<PhotonFeature[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({
    q: trimmed,
    limit: String(options.limit ?? 10),
  });

  if (options.osmTag) {
    params.set('osm_tag', options.osmTag);
  }

  const bias = options.biasLocation ?? POLAND_CENTER;
  params.set('lat', bias.lat.toFixed(4));
  params.set('lon', bias.lng.toFixed(4));

  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 6500
  );

  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?${params.toString()}`,
      {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as PhotonResponse;
    return (data.features ?? []).filter((f) => {
      const cc = f.properties?.countrycode;
      return !cc || cc.toUpperCase() === 'PL';
    });
  } catch {
    return [];
  } finally {
    window.clearTimeout(timer);
  }
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

  const isParish =
    item.type === 'place_of_worship' ||
    /(parafi|kościół|kosciol|bazylika|sanktuarium|katedra|kaplica)/i.test(name);

  return {
    name,
    address: shortAddress,
    location: {
      lat: Number.parseFloat(item.lat),
      lng: Number.parseFloat(item.lon),
    },
    placeId: `osm_${item.place_id}`,
    placeType: isParish ? 'parish' : item.class === 'boundary' || item.class === 'place' ? 'place' : 'address',
  };
}

async function queryNominatimRaw(
  query: string,
  biasLocation?: LatLng | null,
  limit = 6
): Promise<SelectedPlaceData[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

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

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: { Accept: 'application/json' },
      }
    );
    if (!res.ok) return [];
    const items = (await res.json()) as NominatimSearchItem[];
    return items
      .filter((i) => !Number.isNaN(Number.parseFloat(i.lat)))
      .map(formatNominatimItem);
  } catch {
    return [];
  }
}

function scorePlaceMatch(
  item: SelectedPlaceData,
  tokens: string[],
  biasLocation?: LatLng | null
): number {
  let score = item.placeType === 'parish' ? 200 : item.placeType === 'place' ? 40 : 20;

  const haystack = stripPolishDiacritics(`${item.name} ${item.address}`);
  const nameHaystack = stripPolishDiacritics(item.name);

  for (const token of tokens) {
    const stem = token.length >= 5 ? token.slice(0, token.length - 1) : token;
    if (nameHaystack.includes(token)) {
      score += 45;
    } else if (nameHaystack.includes(stem)) {
      score += 32;
    } else if (haystack.includes(token)) {
      score += 25;
    } else if (haystack.includes(stem)) {
      score += 18;
    }
  }

  if (biasLocation) {
    const dist = haversineMeters(biasLocation, item.location);
    if (dist < 5000) score += 25;
    else if (dist < 25000) score += 12;
  }

  return score;
}

function deduplicatePlaces(items: SelectedPlaceData[]): SelectedPlaceData[] {
  const result: SelectedPlaceData[] = [];
  for (const item of items) {
    const normName = stripPolishDiacritics(item.name).trim();
    const existing = result.find((r) => {
      if (r.placeId === item.placeId) return true;
      const sameDist = haversineMeters(r.location, item.location) < 80;
      if (!sameDist) return false;
      const rName = stripPolishDiacritics(r.name).trim();
      return (
        rName === normName ||
        rName.includes(normName) ||
        normName.includes(rName)
      );
    });
    if (!existing) {
      result.push(item);
    }
  }
  return result;
}

/**
 * Intelligent parish/church search for OpenStreetMap:
 * - Tolerates Polish abbreviations ("św", "par.", "pw."), missing diacritics, declensions ("Antoni" vs "Antoniego")
 * - Combines Photon place_of_worship + Photon general + Overpass churches around detected city/town
 * - Falls back to Nominatim if needed so users always get actionable results
 */
export async function searchParishesOsm(
  query: string,
  biasLocation?: LatLng | null,
  limit = 8
): Promise<SelectedPlaceData[]> {
  const { cleaned, strippedCore, tokens, wantsCemetery } =
    normalizeParishQuery(query);
  if (cleaned.length < 2) return [];

  const queriesToRun: Array<Promise<PhotonFeature[]>> = [
    queryPhotonRaw(cleaned, {
      biasLocation,
      osmTag: 'amenity:place_of_worship',
      limit: 10,
    }),
    queryPhotonRaw(cleaned, {
      biasLocation,
      limit: 8,
    }),
  ];

  if (
    strippedCore.length >= 2 &&
    strippedCore.toLowerCase() !== cleaned.toLowerCase()
  ) {
    queriesToRun.push(
      queryPhotonRaw(strippedCore, {
        biasLocation,
        osmTag: 'amenity:place_of_worship',
        limit: 10,
      })
    );
  }

  const settled = await Promise.all(queriesToRun);
  const worshipFeatures = [...settled[0], ...(settled[2] ?? [])];
  const generalFeatures = settled[1];

  const parishCandidates: SelectedPlaceData[] = [];
  const otherCandidates: SelectedPlaceData[] = [];
  let cityCenterCandidate: LatLng | null = null;

  for (const feat of worshipFeatures) {
    const props = feat.properties;
    if (!props) continue;
    if (!wantsCemetery && isCemeteryFeature(props)) continue;
    const formatted = formatPhotonFeature(feat, 'parish');
    if (formatted) parishCandidates.push(formatted);
  }

  for (const feat of generalFeatures) {
    const props = feat.properties;
    if (!props) continue;
    if (!wantsCemetery && isCemeteryFeature(props)) continue;

    if (
      !cityCenterCandidate &&
      feat.geometry?.coordinates &&
      (props.osm_key === 'place' ||
        props.osm_key === 'boundary' ||
        ['city', 'town', 'village', 'district', 'locality'].includes(
          props.type || ''
        ))
    ) {
      cityCenterCandidate = {
        lat: feat.geometry.coordinates[1],
        lng: feat.geometry.coordinates[0],
      };
    }

    const formatted = formatPhotonFeature(feat);
    if (!formatted) continue;
    if (formatted.placeType === 'parish') {
      parishCandidates.push(formatted);
    } else {
      otherCandidates.push(formatted);
    }
  }

  // If few parishes were found directly, check Overpass around the detected city/district or Nominatim
  if (parishCandidates.length < 3) {
    let fallbackCenter = cityCenterCandidate;

    if (!fallbackCenter && otherCandidates.length === 0) {
      const nomItems = await queryNominatimRaw(
        strippedCore || cleaned,
        biasLocation,
        5
      );
      for (const item of nomItems) {
        if (item.placeType === 'parish') parishCandidates.push(item);
        else {
          otherCandidates.push(item);
          if (!fallbackCenter) fallbackCenter = item.location;
        }
      }
    }

    if (fallbackCenter) {
      try {
        const nearbyChurches = await fetchNearbyParishesOsm(fallbackCenter, 5500);
        for (const church of nearbyChurches.slice(0, 12)) {
          parishCandidates.push({
            name: church.name,
            address: church.address,
            location: church.location,
            placeId: church.id,
            placeType: 'parish',
          });
        }
      } catch {
        // Ignore Overpass rate limit errors during interactive typing
      }
    }
  }

  const dedupedParishes = deduplicatePlaces(parishCandidates).sort(
    (a, b) =>
      scorePlaceMatch(b, tokens, biasLocation) -
      scorePlaceMatch(a, tokens, biasLocation)
  );

  const dedupedOthers = deduplicatePlaces(otherCandidates).sort(
    (a, b) =>
      scorePlaceMatch(b, tokens, biasLocation) -
      scorePlaceMatch(a, tokens, biasLocation)
  );

  const merged = deduplicatePlaces([...dedupedParishes, ...dedupedOthers]);
  return merged.slice(0, limit);
}

/**
 * Fast, accent-insensitive address/place search via Photon with Nominatim fallback.
 */
export async function searchPlacesNominatim(
  query: string,
  biasLocation?: LatLng | null,
  limit = 6
): Promise<SelectedPlaceData[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const photonFeatures = await queryPhotonRaw(trimmed, {
    biasLocation,
    limit: Math.max(limit, 8),
  });

  const photonResults = photonFeatures
    .map((f) => formatPhotonFeature(f))
    .filter((x): x is SelectedPlaceData => x !== null);

  if (photonResults.length > 0) {
    return deduplicatePlaces(photonResults).slice(0, limit);
  }

  return queryNominatimRaw(trimmed, biasLocation, limit);
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
 * Street-coherent nearest-neighbor + 2-opt TSP ordering around parish center.
 * Strongly prefers visiting contiguous houses on the same street before crossing to another street.
 */
export function orderStopsTsp(
  origin: LatLng,
  stops: VisitStop[],
  returnToParish: boolean
): VisitStop[] {
  if (stops.length <= 1) return stops;

  const streetOf = new Map<string, string>();
  for (const s of stops) {
    streetOf.set(s.id, extractStreetName(s));
  }

  const remaining = [...stops];
  const ordered: VisitStop[] = [];
  let current = origin;
  let currentStreet = '';

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
    const hasNearbySameStreet =
      currentStreet.length > 0 &&
      remaining.some(
        (s) =>
          streetOf.get(s.id) === currentStreet &&
          haversineMeters(current, s.location) < 420
      );

    let bestIdx = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const d = haversineMeters(current, candidate.location);
      const candStreet = streetOf.get(candidate.id) ?? '';
      let score = d;
      if (hasNearbySameStreet) {
        score = candStreet === currentStreet && d < 420 ? d * 0.35 : d + 260;
      }
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const picked = remaining.splice(bestIdx, 1)[0];
    ordered.push(picked);
    current = picked.location;
    currentStreet = streetOf.get(picked.id) ?? '';
  }

  // 2-opt local refinement with mild street-switch penalty so contiguous streets stay intact
  if (ordered.length >= 3) {
    const STREET_SWITCH_PENALTY = 75;
    const calcPathScore = (seq: VisitStop[]) => {
      let sum = haversineMeters(origin, seq[0].location);
      for (let i = 0; i < seq.length - 1; i++) {
        const d = haversineMeters(seq[i].location, seq[i + 1].location);
        const sameStreet = streetOf.get(seq[i].id) === streetOf.get(seq[i + 1].id);
        sum += d + (sameStreet ? 0 : STREET_SWITCH_PENALTY);
      }
      if (fixedEnd) {
        const d = haversineMeters(
          seq[seq.length - 1].location,
          fixedEnd.location
        );
        const sameStreet =
          streetOf.get(seq[seq.length - 1].id) === streetOf.get(fixedEnd.id);
        sum += d + (sameStreet ? 0 : STREET_SWITCH_PENALTY);
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
      const bestLen = calcPathScore(ordered);
      for (let i = 0; i < ordered.length - 1; i++) {
        for (let j = i + 1; j < ordered.length; j++) {
          const candidate = [
            ...ordered.slice(0, i),
            ...ordered.slice(i, j + 1).reverse(),
            ...ordered.slice(j + 1),
          ];
          if (calcPathScore(candidate) + 1 < bestLen) {
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

const MAX_OSRM_CHUNK_WAYPOINTS = 50;

async function fetchOsrmGeometryChunked(
  waypoints: LatLng[],
  travelMode: PlanConfig['travelMode'],
  onChunkProgress?: (chunkIdx: number, totalChunks: number) => void
): Promise<{
  path: LatLng[];
  totalDistanceMeters: number;
  totalDurationMillis: number;
  legs: Array<{ distanceMeters: number; durationMillis: number }>;
}> {
  if (waypoints.length <= MAX_OSRM_CHUNK_WAYPOINTS) {
    onChunkProgress?.(1, 1);
    return fetchOsrmGeometry(waypoints, travelMode);
  }

  const totalChunks = Math.ceil(
    (waypoints.length - 1) / (MAX_OSRM_CHUNK_WAYPOINTS - 1)
  );
  const combinedPath: LatLng[] = [];
  const combinedLegs: Array<{ distanceMeters: number; durationMillis: number }> =
    [];
  let totalDistanceMeters = 0;
  let totalDurationMillis = 0;

  let startIdx = 0;
  let chunkIndex = 0;
  while (startIdx < waypoints.length - 1) {
    chunkIndex += 1;
    onChunkProgress?.(chunkIndex, totalChunks);
    const endIdx = Math.min(
      waypoints.length,
      startIdx + MAX_OSRM_CHUNK_WAYPOINTS
    );
    const chunk = waypoints.slice(startIdx, endIdx);
    const res = await fetchOsrmGeometry(chunk, travelMode);

    if (combinedPath.length > 0 && res.path.length > 1) {
      combinedPath.push(...res.path.slice(1));
    } else {
      combinedPath.push(...res.path);
    }

    combinedLegs.push(...res.legs);
    totalDistanceMeters += res.totalDistanceMeters;
    totalDurationMillis += res.totalDurationMillis;

    if (endIdx >= waypoints.length) break;
    // Overlap by 1 boundary waypoint so legs remain contiguous
    startIdx = endIdx - 1;
  }

  return {
    path: combinedPath,
    totalDistanceMeters,
    totalDurationMillis,
    legs: combinedLegs,
  };
}

export async function computeOsmParishRoutes(
  parish: ParishCenter,
  stops: VisitStop[],
  config: PlanConfig,
  onProgress?: (label: string) => void,
  activeBreaks: DayBreakWindow[] = []
): Promise<PriestRouteResult[]> {
  if (stops.length === 0) return [];

  const normalizedStops = stops.map((s) =>
    s.priestId > config.priestCount ? { ...s, priestId: 1 } : s
  );

  const activePriestIds = Array.from(
    new Set(normalizedStops.map((s) => s.priestId))
  ).sort((a, b) => a - b);

  const results: PriestRouteResult[] = [];

  for (let pIdx = 0; pIdx < activePriestIds.length; pIdx++) {
    const priestId = activePriestIds[pIdx];
    const priestProfile =
      PRIEST_PALETTE.find((p) => p.id === priestId) ?? PRIEST_PALETTE[0];
    const priestStops = normalizedStops.filter((s) => s.priestId === priestId);
    if (priestStops.length === 0) continue;

    const hasManualOrder = priestStops.some(
      (s) =>
        typeof s.manualOrder === 'number' &&
        !Number.isNaN(s.manualOrder) &&
        s.manualOrder > 0
    );

    const orderedStops = hasManualOrder
      ? [...priestStops].sort(
          (a, b) =>
            (a.manualOrder ?? Number.MAX_SAFE_INTEGER) -
            (b.manualOrder ?? Number.MAX_SAFE_INTEGER)
        )
      : orderStopsTsp(parish.location, priestStops, config.returnToParish);

    const waypoints: LatLng[] = [
      parish.location,
      ...orderedStops.map((s) => s.location),
      ...(config.returnToParish ? [parish.location] : []),
    ];

    const osrm = await fetchOsrmGeometryChunked(
      waypoints,
      config.travelMode,
      (chunkIdx, totalChunks) => {
        onProgress?.(
          totalChunks > 1
            ? `Liczenie trasy księdza ${pIdx + 1}/${activePriestIds.length} · odcinek ${chunkIdx}/${totalChunks}...`
            : `Liczenie trasy księdza ${pIdx + 1}/${activePriestIds.length} (${priestStops.length} adresów)...`
        );
      }
    );

    let cursorAbs = parseHHMMToMinutes(config.startTime, 930);
    let totalVisitMinutes = 0;

    const scheduledItems: ScheduledStopItem[] = orderedStops.map(
      (stop, idx) => {
        const leg = osrm.legs[idx];
        const legDist = leg?.distanceMeters ?? 0;
        const legDurMs = leg?.durationMillis ?? 0;
        const legMins = Math.round(legDurMs / 60000);
        const stopDuration = getEffectiveStopDurationMinutes(
          stop,
          config.defaultVisitMinutes
        );

        const timing = advanceStopClockWithBreaks(
          cursorAbs,
          legMins,
          stopDuration,
          isBlockStop(stop),
          activeBreaks
        );
        cursorAbs = timing.endCursorAbs;
        totalVisitMinutes += stopDuration;

        return {
          stop,
          orderIndex: idx + 1,
          arrivalTime: formatAbsMinutesToHHMM(timing.arrivalAbs),
          departureTime: formatAbsMinutesToHHMM(timing.departureAbs),
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
      cursorAbs += Math.round(returnLegDurationMillis / 60000);
    }

    const endTime = formatAbsMinutesToHHMM(cursorAbs);

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
    });
  }

  return results;
}

const streetRoadGeometryCache = new Map<string, LatLng[] | null>();

/**
 * Snaps a street's smoothed centerline onto actual road geometry via OSRM
 * so clicking a street highlights it cleanly along the road like Google Maps.
 */
export async function fetchStreetRoadGeometry(
  centerlinePoints: LatLng[]
): Promise<LatLng[] | null> {
  if (centerlinePoints.length < 2) return null;

  const first = centerlinePoints[0];
  const last = centerlinePoints[centerlinePoints.length - 1];
  const cacheKey = `${centerlinePoints.length}:${first.lat.toFixed(5)},${first.lng.toFixed(5)}:${last.lat.toFixed(5)},${last.lng.toFixed(5)}`;
  if (streetRoadGeometryCache.has(cacheKey)) {
    return streetRoadGeometryCache.get(cacheKey) ?? null;
  }

  // Pick up to 7 evenly spaced anchor waypoints along the centerline
  const maxAnchors = 7;
  const anchors: LatLng[] = [];
  if (centerlinePoints.length <= maxAnchors) {
    anchors.push(...centerlinePoints);
  } else {
    for (let i = 0; i < maxAnchors; i++) {
      const idx = Math.round(
        (i * (centerlinePoints.length - 1)) / (maxAnchors - 1)
      );
      anchors.push(centerlinePoints[idx]);
    }
  }

  let directLenMeters = 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    directLenMeters += haversineMeters(anchors[i], anchors[i + 1]);
  }
  if (directLenMeters < 20) {
    streetRoadGeometryCache.set(cacheKey, null);
    return null;
  }

  const coordStr = anchors
    .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
    .join(';');
  const urls = [
    `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordStr}?overview=full&geometries=geojson&steps=false`,
    `https://router.project-osrm.org/route/v1/foot/${coordStr}?overview=full&geometries=geojson&steps=false`,
  ];

  for (const url of urls) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) continue;
      const data = (await res.json()) as OsrmRouteResponse;
      const route = data.routes?.[0];
      if (!route || data.code !== 'Ok' || !route.geometry?.coordinates?.length) {
        continue;
      }

      // Guard against crazy detours (e.g. disconnected private road)
      const routeDist = route.distance ?? 0;
      if (routeDist > directLenMeters * 2.25 + 220) {
        continue;
      }

      const path: LatLng[] = route.geometry.coordinates.map(([lng, lat]) => ({
        lat,
        lng,
      }));
      if (path.length >= 2) {
        streetRoadGeometryCache.set(cacheKey, path);
        return path;
      }
    } catch {
      // Try next mirror
    } finally {
      window.clearTimeout(timer);
    }
  }

  streetRoadGeometryCache.set(cacheKey, null);
  return null;
}

