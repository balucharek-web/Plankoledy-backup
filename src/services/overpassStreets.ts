import { LatLng } from '../types/parish';
import {
  computePolygonAreaSqMeters,
  isPointInsideBoundary,
} from '../utils/spatial';

export interface OsmHousePoint {
  id: string;
  street: string;
  houseNumber: string;
  postcode?: string;
  city?: string;
  label: string;
  fullAddress: string;
  location: LatLng;
  isMultiUnit?: boolean;
  suggestedUnitsCount?: number;
}

export interface OsmStreetGroup {
  streetName: string;
  center: LatLng;
  houses: OsmHousePoint[];
}

export interface StreetHousesPickResult {
  streetName: string;
  streetCenter: LatLng;
  houses: OsmHousePoint[];
  filteredByBoundary: boolean;
}

export interface ResolvedHouseAddress {
  label: string;
  address: string;
  resolved: boolean;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}

interface GugikAddressItem {
  city?: string | null;
  citypart?: string | null;
  street?: string | null;
  number?: string | null;
  code?: string | null;
  x?: string | number | null;
  y?: string | number | null;
  distance?: string | number | null;
  id?: number | string;
}

interface GugikReverseResponse {
  type?: string;
  'returned objects'?: number;
  results?: Record<string, GugikAddressItem> | null;
}

const GUGIK_UUG_ENDPOINT = 'https://services.gugik.gov.pl/uug/';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function naturalHouseCompare(a: string, b: string): number {
  const numA = Number.parseInt(a, 10);
  const numB = Number.parseInt(b, 10);
  const hasNumA = !Number.isNaN(numA);
  const hasNumB = !Number.isNaN(numB);
  if (hasNumA && hasNumB && numA !== numB) {
    return numA - numB;
  }
  return a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' });
}

export function isEvenHouseNumber(houseNumber: string): boolean | null {
  const match = houseNumber.match(/^\d+/);
  if (!match) return null;
  const num = Number.parseInt(match[0], 10);
  return num % 2 === 0;
}

/**
 * Parses OSM `building:flats` or `addr:flats` (supports integers like "24" and Polish ranges like "1-24" or "1-12;13-24").
 */
export function parseOsmFlatsCount(raw?: string | null): number {
  const value = (raw ?? '').trim();
  if (!value) return 0;

  if (/^\d+$/.test(value)) {
    const n = Number.parseInt(value, 10);
    return Number.isNaN(n) ? 0 : Math.min(500, n);
  }

  let total = 0;
  const segments = value.split(/[;,]+/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const rangeMatch = /^(\d+)\s*[-–]\s*(\d+)$/.exec(seg);
    if (rangeMatch) {
      const a = Number.parseInt(rangeMatch[1], 10);
      const b = Number.parseInt(rangeMatch[2], 10);
      if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a && b - a <= 400) {
        total += b - a + 1;
        continue;
      }
    }
    const single = /^(\d+)$/.exec(seg);
    if (single) {
      total += 1;
    }
  }

  return Math.min(500, total);
}

function detectMultiUnitFromOsmTags(tags: Record<string, string>): {
  isMultiUnit: boolean;
  suggestedUnitsCount?: number;
} {
  const flatsCount = parseOsmFlatsCount(
    tags['building:flats'] || tags['addr:flats']
  );
  const buildingType = (tags.building ?? '').toLowerCase();
  const levels = Number.parseInt(tags['building:levels'] || '', 10);
  const isApartmentBuilding =
    buildingType === 'apartments' ||
    buildingType === 'dormitory' ||
    flatsCount > 1 ||
    ((buildingType === 'residential' || buildingType === 'yes') &&
      !Number.isNaN(levels) &&
      levels >= 4 &&
      !tags.amenity &&
      !tags.shop &&
      !tags.office);

  if (!isApartmentBuilding) {
    return { isMultiUnit: false };
  }

  return {
    isMultiUnit: true,
    suggestedUnitsCount: flatsCount > 1 ? flatsCount : 15,
  };
}

function formatPolishHouseAddress(
  street: string,
  houseNumber: string,
  postcode?: string | null,
  city?: string | null
): { label: string; fullAddress: string } {
  const cleanStreet = street.trim();
  const cleanNum = houseNumber.trim();
  const label = cleanNum ? `${cleanStreet} ${cleanNum}` : cleanStreet;
  const cityPart = [postcode?.trim(), city?.trim()].filter(Boolean).join(' ');
  const fullAddress = cityPart ? `${label}, ${cityPart}` : label;
  return { label, fullAddress };
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

function sqDistance(a: LatLng, b: LatLng): number {
  return (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;
}

function stripPolishDiacritics(input: string): string {
  return input
    .toLowerCase()
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/[źż]/g, 'z');
}

function normalizeStreetCore(raw: string): string {
  return stripPolishDiacritics(raw)
    .replace(/[.,'"„”()]/g, ' ')
    .replace(
      /\b(ul|ulica|al|aleja|os|osiedle|pl|plac|skwer|bulwar|rondo|ks|sw|gen|prof|dr|im|plk|kpt|abp|bp)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }
  return dp[b.length];
}

function streetNamesMatch(candidate: string, target: string): boolean {
  const cCore = normalizeStreetCore(candidate);
  const tCore = normalizeStreetCore(target);
  if (!cCore || !tCore) return false;
  if (cCore === tCore) return true;
  if (levenshtein(cCore, tCore) <= 1 && Math.min(cCore.length, tCore.length) >= 5) {
    return true;
  }

  // Handle Google/OSM abbreviated labels like "Dzięndziela" matching "Mieczysława Dzieńdziela"
  const cTokens = cCore.split(' ').filter(Boolean);
  const tTokens = tCore.split(' ').filter(Boolean);
  const cLast = cTokens[cTokens.length - 1] || '';
  const tLast = tTokens[tTokens.length - 1] || '';

  const monthOrGeneric = new Set([
    'maja',
    'listopada',
    'stycznia',
    'marca',
    'kwietnia',
    'czerwca',
    'lipca',
    'sierpnia',
    'wrzesnia',
    'pazdziernika',
    'grudnia',
    'lutego',
    'polskiej',
    'polskiego',
    'wielkiej',
    'nowej',
    'starej',
  ]);

  if (
    cLast.length >= 5 &&
    tLast.length >= 5 &&
    !monthOrGeneric.has(cLast) &&
    !monthOrGeneric.has(tLast) &&
    !/^\d/.test(cCore) &&
    !/^\d/.test(tCore)
  ) {
    if (cLast === tLast || levenshtein(cLast, tLast) <= 1) {
      return true;
    }
  }

  return false;
}

function computeBoundingBox(
  boundary: LatLng[],
  center: LatLng,
  fallbackRadiusMeters: number,
  extraPoint?: LatLng
): { south: number; west: number; north: number; east: number } {
  if (boundary.length >= 3) {
    let south = 90;
    let north = -90;
    let west = 180;
    let east = -180;
    for (const pt of boundary) {
      if (pt.lat < south) south = pt.lat;
      if (pt.lat > north) north = pt.lat;
      if (pt.lng < west) west = pt.lng;
      if (pt.lng > east) east = pt.lng;
    }
    if (extraPoint) {
      if (extraPoint.lat < south) south = extraPoint.lat;
      if (extraPoint.lat > north) north = extraPoint.lat;
      if (extraPoint.lng < west) west = extraPoint.lng;
      if (extraPoint.lng > east) east = extraPoint.lng;
    }
    const padLat = 45 / 111320;
    const padLng =
      45 / (111320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
    return {
      south: south - padLat,
      west: west - padLng,
      north: north + padLat,
      east: east + padLng,
    };
  }

  const latDelta = fallbackRadiusMeters / 111320;
  const lngDelta =
    fallbackRadiusMeters /
    (111320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));

  let south = center.lat - latDelta;
  let north = center.lat + latDelta;
  let west = center.lng - lngDelta;
  let east = center.lng + lngDelta;

  if (extraPoint) {
    south = Math.min(south, extraPoint.lat - latDelta * 0.4);
    north = Math.max(north, extraPoint.lat + latDelta * 0.4);
    west = Math.min(west, extraPoint.lng - lngDelta * 0.4);
    east = Math.max(east, extraPoint.lng + lngDelta * 0.4);
  }

  return { south, west, north, east };
}

function parseGugikResults(data: GugikReverseResponse): Array<{
  item: GugikAddressItem;
  location: LatLng;
  distanceMeters: number;
}> {
  if (!data.results || typeof data.results !== 'object') return [];
  const parsed: Array<{
    item: GugikAddressItem;
    location: LatLng;
    distanceMeters: number;
  }> = [];

  for (const rawItem of Object.values(data.results)) {
    if (!rawItem) continue;
    const lng = Number(rawItem.x);
    const lat = Number(rawItem.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const dist = Number(rawItem.distance);
    parsed.push({
      item: rawItem,
      location: { lat, lng },
      distanceMeters: Number.isFinite(dist) ? dist : 0,
    });
  }
  return parsed;
}

async function queryGugikReversePoint(
  location: LatLng,
  radiusMeters: number,
  limit = 1000,
  timeoutMs = 5500
): Promise<
  Array<{ item: GugikAddressItem; location: LatLng; distanceMeters: number }>
> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const wkt = `POINT(${location.lng.toFixed(6)} ${location.lat.toFixed(6)})`;
    const url = `${GUGIK_UUG_ENDPOINT}?request=GetAddressReverse&location=${encodeURIComponent(
      wkt
    )}&srid=4326&radius=${Math.round(radiusMeters)}&limit=${limit}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as GugikReverseResponse;
    return parseGugikResults(data);
  } catch {
    return [];
  } finally {
    window.clearTimeout(timer);
  }
}

async function queryGugikReversePolygonStatus(
  boundary: LatLng[],
  limit = 1000,
  timeoutMs = 8500
): Promise<{
  ok: boolean;
  records: Array<{
    item: GugikAddressItem;
    location: LatLng;
    distanceMeters: number;
  }>;
}> {
  if (boundary.length < 3) return { ok: true, records: [] };
  const ring = [...boundary, boundary[0]];
  const coordsText = ring
    .map((pt) => `${pt.lng.toFixed(6)} ${pt.lat.toFixed(6)}`)
    .join(',');
  const wkt = `POLYGON((${coordsText}))`;
  const url = `${GUGIK_UUG_ENDPOINT}?request=GetAddressReverse&location=${encodeURIComponent(
    wkt
  )}&srid=4326&limit=${limit}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        if (attempt === 0) {
          await new Promise((r) => window.setTimeout(r, 300));
          continue;
        }
        return { ok: false, records: [] };
      }
      const data = (await res.json()) as GugikReverseResponse;
      return { ok: true, records: parseGugikResults(data) };
    } catch {
      if (attempt === 0) {
        await new Promise((r) => window.setTimeout(r, 300));
        continue;
      }
      return { ok: false, records: [] };
    } finally {
      window.clearTimeout(timer);
    }
  }
  return { ok: false, records: [] };
}

async function queryGugikReversePolygon(
  boundary: LatLng[],
  limit = 1000,
  timeoutMs = 8500
): Promise<
  Array<{ item: GugikAddressItem; location: LatLng; distanceMeters: number }>
> {
  const res = await queryGugikReversePolygonStatus(boundary, limit, timeoutMs);
  return res.records;
}

async function queryNominatimReverse(
  location: LatLng,
  timeoutMs = 4500
): Promise<{
  road: string;
  houseNumber: string;
  city?: string;
  postcode?: string;
  displayName?: string;
} | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${location.lat.toFixed(
      6
    )}&lon=${location.lng.toFixed(6)}&zoom=17&addressdetails=1&accept-language=pl`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      display_name?: string;
      address?: Record<string, string>;
    };
    const addr = data.address ?? {};
    const road =
      addr.road ||
      addr.pedestrian ||
      addr.residential ||
      addr.footway ||
      addr.path ||
      '';
    return {
      road: road.trim(),
      houseNumber: (addr.house_number || '').trim(),
      city: addr.city || addr.town || addr.village || addr.municipality,
      postcode: addr.postcode,
      displayName: data.display_name,
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function escapeOverpassRegex(input: string): string {
  return input
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/"/g, '\\"');
}

function buildPolishStreetRegex(streetName: string): string {
  const trimmed = streetName.trim();
  const prefixMatch = trimmed.match(
    /^(ul\.?|ulica|al\.?|aleja|os\.?|osiedle|pl\.?|plac)\s+(.+)$/i
  );
  const core = prefixMatch ? prefixMatch[2].trim() : trimmed;
  const escapedCore = escapeOverpassRegex(core);
  return `^(ul\\.?\\s+|ulica\\s+|al\\.?\\s+|aleja\\s+|os\\.?\\s+|osiedle\\s+|pl\\.?\\s+|plac\\s+)?${escapedCore}$`;
}

async function runOverpassQuery(
  query: string,
  timeoutMs = 9500
): Promise<OverpassElement[]> {
  let lastError: Error | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      try {
        controller.abort('Overpass timeout');
      } catch {
        controller.abort();
      }
    }, timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/json, text/plain, */*',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Serwer mapowy zwrócił kod HTTP ${response.status}.`
        );
      }

      const data = (await response.json()) as {
        elements?: OverpassElement[];
        remark?: string;
      };
      if (
        data.remark &&
        data.remark.toLowerCase().includes('timed out') &&
        (!data.elements || data.elements.length === 0)
      ) {
        throw new Error(
          'Zapytanie przekroczyło limit czasu. Spróbuj zmniejszyć obszar.'
        );
      }
      return data.elements ?? [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      if (
        timedOut ||
        msg.toLowerCase().includes('aborted') ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        lastError = new Error(
          'Serwer mapowy nie odpowiedział na czas. Spróbuj kliknąć bliżej numeru domu lub ulicy.'
        );
      } else {
        lastError =
          err instanceof Error
            ? err
            : new Error('Błąd połączenia z serwerem adresów.');
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error('Nie udało się pobrać danych adresowych.');
}

type GugikRecord = {
  item: GugikAddressItem;
  location: LatLng;
  distanceMeters: number;
};

function segmentsIntersect2D(
  a: LatLng,
  b: LatLng,
  c: LatLng,
  d: LatLng
): boolean {
  const orient = (p: LatLng, q: LatLng, r: LatLng) =>
    (q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng);
  const onSegment = (p: LatLng, q: LatLng, r: LatLng) =>
    q.lng >= Math.min(p.lng, r.lng) - 1e-10 &&
    q.lng <= Math.max(p.lng, r.lng) + 1e-10 &&
    q.lat >= Math.min(p.lat, r.lat) - 1e-10 &&
    q.lat <= Math.max(p.lat, r.lat) + 1e-10;

  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) {
    return true;
  }
  if (Math.abs(o1) < 1e-12 && onSegment(a, c, b)) return true;
  if (Math.abs(o2) < 1e-12 && onSegment(a, d, b)) return true;
  if (Math.abs(o3) < 1e-12 && onSegment(c, a, d)) return true;
  if (Math.abs(o4) < 1e-12 && onSegment(c, b, d)) return true;
  return false;
}

function rectIntersectsBoundary(
  rect: { south: number; west: number; north: number; east: number },
  boundary: LatLng[]
): boolean {
  if (boundary.length < 3) return true;
  // 1. Any boundary vertex inside rect
  for (const p of boundary) {
    if (
      p.lat >= rect.south &&
      p.lat <= rect.north &&
      p.lng >= rect.west &&
      p.lng <= rect.east
    ) {
      return true;
    }
  }
  // 2. Any rect corner or center inside boundary
  const c0: LatLng = { lat: rect.south, lng: rect.west };
  const c1: LatLng = { lat: rect.south, lng: rect.east };
  const c2: LatLng = { lat: rect.north, lng: rect.east };
  const c3: LatLng = { lat: rect.north, lng: rect.west };
  const center: LatLng = {
    lat: (rect.south + rect.north) / 2,
    lng: (rect.west + rect.east) / 2,
  };
  for (const pr of [c0, c1, c2, c3, center]) {
    if (isPointInsideBoundary(pr, boundary)) return true;
  }
  // 3. Exact edge-edge intersection between boundary polygon and rect edges
  const rectEdges: Array<[LatLng, LatLng]> = [
    [c0, c1],
    [c1, c2],
    [c2, c3],
    [c3, c0],
  ];
  for (let i = 0; i < boundary.length; i++) {
    const p1 = boundary[i];
    const p2 = boundary[(i + 1) % boundary.length];
    for (const [r1, r2] of rectEdges) {
      if (segmentsIntersect2D(p1, p2, r1, r2)) return true;
    }
  }
  return false;
}

function rectIntersectsCircle(
  rect: { south: number; west: number; north: number; east: number },
  center: LatLng,
  radiusMeters: number
): boolean {
  const closestLat = Math.max(rect.south, Math.min(center.lat, rect.north));
  const closestLng = Math.max(rect.west, Math.min(center.lng, rect.east));
  return haversineMeters(center, { lat: closestLat, lng: closestLng }) <= radiusMeters + 45;
}

/**
 * Fetches ALL GUGiK PRG addresses in the area without 1.00 km² polygon rejection
 * or 1000-record truncation.
 *
 * Important GUGiK UUG quirk: GetAddressReverse with POLYGON silently returns 0
 * whenever polygon area exceeds 1.00 km² (1,000,000 m²). Therefore, any area
 * larger than 0.78 km² is automatically tiled into metric rectangles strictly
 * under ~0.50–0.84 km² each, with retry + POINT fallback and recursive split
 * when a dense tile returns >= 800 points.
 */
async function fetchGugikAddressesInArea(params: {
  boundary: LatLng[];
  center: LatLng;
  radiusMeters: number;
  onProgress?: (completed: number, total: number) => void;
}): Promise<GugikRecord[]> {
  const { boundary, center, radiusMeters, onProgress } = params;
  const hasBoundary = boundary.length >= 3;

  const bbox = computeBoundingBox(boundary, center, radiusMeters);
  const deduped = new Map<string, GugikRecord>();
  const addRecords = (recs: GugikRecord[]) => {
    for (const r of recs) {
      // Note: GUGiK UUG `item.id` is only a 1..N row index within each single HTTP response,
      // NEVER a globally unique address identifier. Deduplicate strictly by address + coords.
      const addrKey = `${(r.item.street ?? '').trim().toLowerCase()}|${(r.item.city ?? '').trim().toLowerCase()}|${(r.item.number ?? '').trim().toLowerCase()}|${r.location.lat.toFixed(5)},${r.location.lng.toFixed(5)}`;
      if (!deduped.has(addrKey)) deduped.set(addrKey, r);
    }
  };

  // 1. Fast single-request path ONLY when safely inside GUGiK's hard 1.00 km² limit
  if (hasBoundary) {
    const boundaryAreaSqM = computePolygonAreaSqMeters(boundary);
    if (boundaryAreaSqM > 0 && boundaryAreaSqM <= 780_000) {
      const initial = await queryGugikReversePolygonStatus(boundary, 1000, 7500);
      if (initial.ok && initial.records.length > 0 && initial.records.length < 800) {
        return initial.records;
      }
      addRecords(initial.records);
    }
  } else if (radiusMeters <= 600) {
    const initial = await queryGugikReversePoint(
      center,
      Math.max(250, radiusMeters),
      1000,
      7000
    );
    if (initial.length > 0 && initial.length < 800) {
      return initial;
    }
    addRecords(initial);
  }

  // 2. Metric-safe rectangular tiling: every cell is guaranteed strictly < 0.85 km²
  //    (GUGiK silently returns 0 for any POLYGON > 1.00 km²!)
  const avgLat = (bbox.south + bbox.north) / 2;
  const metersPerLat = 111320;
  const metersPerLng = 111320 * Math.max(0.2, Math.cos((avgLat * Math.PI) / 180));
  const widthMeters = Math.max(50, (bbox.east - bbox.west) * metersPerLng);
  const heightMeters = Math.max(50, (bbox.north - bbox.south) * metersPerLat);

  interface Cell {
    south: number;
    west: number;
    north: number;
    east: number;
    depth: number;
  }

  const MAX_REQUESTS = 140;
  const buildIntersectingGrid = (maxCellSideMeters: number): Cell[] => {
    const rows = Math.max(1, Math.ceil(heightMeters / maxCellSideMeters));
    const cols = Math.max(1, Math.ceil(widthMeters / maxCellSideMeters));
    const latStep = (bbox.north - bbox.south) / rows;
    const lngStep = (bbox.east - bbox.west) / cols;
    const out: Cell[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell: Cell = {
          south: bbox.south + r * latStep,
          north: bbox.south + (r + 1) * latStep,
          west: bbox.west + c * lngStep,
          east: bbox.west + (c + 1) * lngStep,
          depth: 1,
        };
        const relevant = hasBoundary
          ? rectIntersectsBoundary(cell, boundary)
          : rectIntersectsCircle(cell, center, radiusMeters);
        if (relevant) {
          out.push(cell);
        }
      }
    }
    return out;
  };

  // Start with ~700m x 700m (~0.49 km²) tiles; for huge rural parishes relax up to 900m (~0.81 km², still < 1.00 km²)
  let queue = buildIntersectingGrid(700);
  if (queue.length > 72) {
    queue = buildIntersectingGrid(820);
  }
  if (queue.length > 105) {
    queue = buildIntersectingGrid(910);
  }

  let requestsSent = 0;
  let completedTiles = 0;
  let totalPlannedTiles = queue.length;
  onProgress?.(0, totalPlannedTiles);

  const CONCURRENCY = 4;

  while (queue.length > 0 && requestsSent < MAX_REQUESTS) {
    const batch = queue.splice(
      0,
      Math.min(CONCURRENCY, MAX_REQUESTS - requestsSent)
    );
    requestsSent += batch.length;

    const results = await Promise.all(
      batch.map(async (cell) => {
        const ring: LatLng[] = [
          { lat: cell.south, lng: cell.west },
          { lat: cell.south, lng: cell.east },
          { lat: cell.north, lng: cell.east },
          { lat: cell.north, lng: cell.west },
        ];
        const status = await queryGugikReversePolygonStatus(ring, 1000, 8500);
        if (status.ok) {
          return { cell, recs: status.records };
        }
        // Fallback if POLYGON request failed: query by POINT + covering radius
        const cellCenter: LatLng = {
          lat: (cell.south + cell.north) / 2,
          lng: (cell.west + cell.east) / 2,
        };
        const halfDiag = Math.ceil(
          haversineMeters(
            { lat: cell.south, lng: cell.west },
            { lat: cell.north, lng: cell.east }
          ) / 2
        );
        const fallbackRecs = await queryGugikReversePoint(
          cellCenter,
          Math.min(Math.max(halfDiag + 30, 150), 900),
          1000,
          8500
        );
        return { cell, recs: fallbackRecs };
      })
    );

    for (const { cell, recs } of results) {
      completedTiles += 1;
      addRecords(recs);
      const cellLatSpan = cell.north - cell.south;
      const cellLngSpan = cell.east - cell.west;
      if (
        recs.length >= 800 &&
        cell.depth < 3 &&
        (cellLatSpan > 0.0012 || cellLngSpan > 0.0016)
      ) {
        const midLat = (cell.south + cell.north) / 2;
        const midLng = (cell.west + cell.east) / 2;
        const subCells: Cell[] = [
          { south: cell.south, west: cell.west, north: midLat, east: midLng, depth: cell.depth + 1 },
          { south: cell.south, west: midLng, north: midLat, east: cell.east, depth: cell.depth + 1 },
          { south: midLat, west: cell.west, north: cell.north, east: midLng, depth: cell.depth + 1 },
          { south: midLat, west: midLng, north: cell.north, east: cell.east, depth: cell.depth + 1 },
        ];
        for (const sc of subCells) {
          const relevant = hasBoundary
            ? rectIntersectsBoundary(sc, boundary)
            : rectIntersectsCircle(sc, center, radiusMeters);
          if (relevant) {
            queue.push(sc);
            totalPlannedTiles += 1;
          }
        }
      }
    }

    onProgress?.(completedTiles, totalPlannedTiles);
  }

  return Array.from(deduped.values());
}

/**
 * Fetches named streets & addressed houses within a parish boundary or radius.
 * Runs complete adaptive PRG (GUGiK UUG with <1 km² metric tiling & zero truncation) AND
 * OpenStreetMap Overpass in parallel, merging streets, missing houses, rural addr:place,
 * and multi-unit apartment block metadata.
 */
export async function fetchParishStreetsFromOsm(params: {
  boundary: LatLng[];
  center: LatLng;
  radiusMeters: number;
  onProgress?: (completed: number, total: number) => void;
}): Promise<OsmStreetGroup[]> {
  const { boundary, center, radiusMeters, onProgress } = params;
  const hasBoundary = boundary.length >= 3;

  const isInsideArea = (pt: LatLng): boolean => {
    if (hasBoundary) {
      return isPointInsideBoundary(pt, boundary);
    }
    return haversineMeters(center, pt) <= radiusMeters;
  };

  const { south, west, north, east } = computeBoundingBox(
    boundary,
    center,
    radiusMeters
  );
  const bbox = `(${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(
    5
  )},${east.toFixed(5)})`;

  const overpassQuery = `
[out:json][timeout:10];
(
  way["highway"~"^(residential|living_street|unclassified|tertiary|secondary|primary|service|pedestrian)$"]["name"]${bbox};
  nwr["addr:housenumber"]${bbox};
  way["building"="apartments"]${bbox};
);
out center tags qt;
`.trim();

  const gugikPromise = fetchGugikAddressesInArea({
    boundary,
    center,
    radiusMeters,
    onProgress,
  });
  const overpassSettled = runOverpassQuery(overpassQuery, 5500).then(
    (elements) => ({ ok: true as const, elements }),
    (error: unknown) => ({ ok: false as const, error })
  );

  let gugikRecords: GugikRecord[] = [];
  let osmElements: OverpassElement[] = [];
  let overpassError: unknown = null;

  try {
    gugikRecords = await gugikPromise;
  } catch {
    gugikRecords = [];
  }

  if (gugikRecords.length > 0) {
    // GUGiK PRG already returned authoritative addresses; give Overpass up to 3.5s
    // extra to enrich apartment-block metadata without making the user wait 15s+ on slow mirrors.
    const graceResult = await Promise.race([
      overpassSettled,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3500)),
    ]);
    if (graceResult && graceResult.ok) {
      osmElements = graceResult.elements;
    }
  } else {
    const res = await overpassSettled;
    if (res.ok) {
      osmElements = res.elements;
    } else {
      overpassError = res.error;
    }
  }

  if (gugikRecords.length === 0 && osmElements.length === 0 && overpassError) {
    throw overpassError instanceof Error
      ? overpassError
      : new Error('Nie udało się wykryć ulic i adresów dla tego obszaru.');
  }

  const streetMap: Record<
    string,
    {
      streetName: string;
      sumLat: number;
      sumLng: number;
      pointCount: number;
      housesByNumber: Record<string, OsmHousePoint>;
    }
  > = {};

  const ensureStreet = (label: string) => {
    const clean = label.trim();
    const key = normalizeStreetCore(clean) || clean.toLowerCase();
    if (!streetMap[key]) {
      streetMap[key] = {
        streetName: clean,
        sumLat: 0,
        sumLng: 0,
        pointCount: 0,
        housesByNumber: {},
      };
    }
    return { key, group: streetMap[key] };
  };

  // Collect OSM apartment polygons so PRG / entrance nodes inside an apartment block get flagged automatically
  const apartmentBuildings: Array<{ location: LatLng; suggestedUnitsCount: number }> = [];
  for (const el of osmElements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const tags = el.tags ?? {};
    const detected = detectMultiUnitFromOsmTags(tags);
    if (detected.isMultiUnit && (el.type === 'way' || el.type === 'relation' || tags.building === 'apartments')) {
      apartmentBuildings.push({
        location: { lat, lng },
        suggestedUnitsCount: detected.suggestedUnitsCount ?? 15,
      });
    }
  }

  // 1. Official PRG records (full tiled grid)
  for (const rec of gugikRecords) {
    if (!isInsideArea(rec.location)) continue;

    const rawStreet = (rec.item.street ?? '').trim();
    const rawCity = (rec.item.city ?? '').trim();
    const rawNum = (rec.item.number ?? '').trim();
    const streetLabel = rawStreet || rawCity;
    if (!streetLabel || !rawNum) continue;

    const { key, group } = ensureStreet(streetLabel);
    const houseKey = rawNum.toLowerCase();
    if (!group.housesByNumber[houseKey]) {
      const postcode = (rec.item.code ?? '').trim() || undefined;
      const city = rawCity || undefined;
      const { label, fullAddress } = formatPolishHouseAddress(
        group.streetName,
        rawNum,
        postcode,
        city
      );

      const matchedApt = apartmentBuildings.find(
        (b) => haversineMeters(rec.location, b.location) <= 26
      );

      group.housesByNumber[houseKey] = {
        id: `prg_${key}_${houseKey}_${rec.location.lat.toFixed(5)}`,
        street: group.streetName,
        houseNumber: rawNum,
        postcode,
        city,
        label,
        fullAddress,
        location: rec.location,
        ...(matchedApt
          ? {
              isMultiUnit: true,
              suggestedUnitsCount: matchedApt.suggestedUnitsCount,
            }
          : {}),
      };
      group.sumLat += rec.location.lat;
      group.sumLng += rec.location.lng;
      group.pointCount += 1;
    }
  }

  // 2. Supplement & enrich from OpenStreetMap Overpass
  for (const el of osmElements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    const pt = { lat, lng };
    if (!isInsideArea(pt)) continue;

    const tags = el.tags ?? {};

    if (tags.highway && tags.name) {
      const { group } = ensureStreet(tags.name);
      group.sumLat += lat;
      group.sumLng += lng;
      group.pointCount += 1;
    }

    const addrStreet = (
      tags['addr:street'] ||
      tags['addr:place'] ||
      ''
    ).trim();
    const addrNum = (tags['addr:housenumber'] || '').trim();
    if (addrStreet && addrNum) {
      const { group } = ensureStreet(addrStreet);
      if (group.pointCount === 0) {
        group.sumLat += lat;
        group.sumLng += lng;
        group.pointCount += 1;
      }

      const detectedBlock = detectMultiUnitFromOsmTags(tags);
      const nearbyApt = !detectedBlock.isMultiUnit
        ? apartmentBuildings.find((b) => haversineMeters(pt, b.location) <= 24)
        : undefined;
      const isApartments = detectedBlock.isMultiUnit || Boolean(nearbyApt);
      const suggestedUnitsCount =
        detectedBlock.suggestedUnitsCount ?? nearbyApt?.suggestedUnitsCount;

      const houseKey = addrNum.toLowerCase();
      const existing = group.housesByNumber[houseKey];
      if (!existing) {
        const postcode = tags['addr:postcode'];
        const city = tags['addr:city'];
        const { label, fullAddress } = formatPolishHouseAddress(
          group.streetName,
          addrNum,
          postcode,
          city
        );

        group.housesByNumber[houseKey] = {
          id: `${el.type}-${el.id}`,
          street: group.streetName,
          houseNumber: addrNum,
          postcode,
          city,
          label,
          fullAddress,
          location: pt,
          ...(isApartments ? { isMultiUnit: true, suggestedUnitsCount } : {}),
        };
      } else if (isApartments && !existing.isMultiUnit) {
        existing.isMultiUnit = true;
        existing.suggestedUnitsCount = suggestedUnitsCount;
      }
    }
  }

  return Object.values(streetMap)
    .filter((g) => g.pointCount > 0 || Object.keys(g.housesByNumber).length > 0)
    .map((g) => ({
      streetName: g.streetName,
      center:
        g.pointCount > 0
          ? {
              lat: g.sumLat / g.pointCount,
              lng: g.sumLng / g.pointCount,
            }
          : Object.values(g.housesByNumber)[0].location,
      houses: Object.values(g.housesByNumber).sort((a, b) =>
        naturalHouseCompare(a.houseNumber, b.houseNumber)
      ),
    }))
    .sort((a, b) => a.streetName.localeCompare(b.streetName, 'pl'));
}

function minDistanceSqToElement(el: OverpassElement, target: LatLng): number {
  let best = Number.POSITIVE_INFINITY;
  if (el.geometry && el.geometry.length > 0) {
    for (const node of el.geometry) {
      const d = sqDistance(target, { lat: node.lat, lng: node.lon });
      if (d < best) best = d;
    }
    return best;
  }
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat === 'number' && typeof lng === 'number') {
    return sqDistance(target, { lat, lng });
  }
  return best;
}

async function detectStreetNameAtLocation(location: LatLng): Promise<{
  streetName: string;
  fallbackCity?: string;
  fallbackPostcode?: string;
  isRuralVillage?: boolean;
} | null> {
  // 1. Run Nominatim /reverse + GUGiK UUG nearest houses in parallel (~150 ms)
  const [nomRes, gugikNear] = await Promise.all([
    queryNominatimReverse(location, 4500),
    queryGugikReversePoint(location, 140, 35, 4500),
  ]);

  const sortedGugik = [...gugikNear].sort(
    (a, b) => a.distanceMeters - b.distanceMeters
  );
  const nearestGugikStreet = sortedGugik.find(
    (g) => (g.item.street ?? '').trim().length > 0
  );
  const nearestGugikAny = sortedGugik[0];

  if (nomRes?.road) {
    // If GUGiK has an official PRG name matching Nominatim's road, prefer canonical PRG name
    const matchingGugik = sortedGugik.find(
      (g) =>
        (g.item.street ?? '').trim().length > 0 &&
        streetNamesMatch(g.item.street ?? '', nomRes.road)
    );
    return {
      streetName: matchingGugik?.item.street?.trim() || nomRes.road,
      fallbackCity:
        matchingGugik?.item.city?.trim() ||
        nearestGugikAny?.item.city?.trim() ||
        nomRes.city,
      fallbackPostcode:
        matchingGugik?.item.code?.trim() ||
        nearestGugikAny?.item.code?.trim() ||
        nomRes.postcode,
    };
  }

  if (nearestGugikStreet?.item.street) {
    return {
      streetName: nearestGugikStreet.item.street.trim(),
      fallbackCity: nearestGugikStreet.item.city?.trim() || undefined,
      fallbackPostcode: nearestGugikStreet.item.code?.trim() || undefined,
    };
  }

  // Rural village houses without street name (street=null, city="Nazwa Wsi")
  if (nearestGugikAny?.item.city && nearestGugikAny.distanceMeters <= 95) {
    return {
      streetName: nearestGugikAny.item.city.trim(),
      fallbackCity: nearestGugikAny.item.city.trim(),
      fallbackPostcode: nearestGugikAny.item.code?.trim() || undefined,
      isRuralVillage: true,
    };
  }

  // 2. Last-resort quick Overpass around 55m (for non-PL or unaddressed roads)
  try {
    const query = `
[out:json][timeout:6];
(
  way["highway"]["name"](around:55,${location.lat.toFixed(6)},${location.lng.toFixed(6)});
  nwr["addr:street"](around:45,${location.lat.toFixed(6)},${location.lng.toFixed(6)});
);
out geom tags;
`.trim();

    const elements = await runOverpassQuery(query, 6500);
    let bestWay: { dist: number; name: string } | null = null;
    let bestAddr: {
      dist: number;
      name: string;
      city?: string;
      postcode?: string;
    } | null = null;

    for (const el of elements) {
      const tags = el.tags ?? {};
      const dist = minDistanceSqToElement(el, location);

      if (tags.highway && tags.name && (!bestWay || dist < bestWay.dist)) {
        bestWay = { dist, name: tags.name.trim() };
      }
      if (tags['addr:street'] && (!bestAddr || dist < bestAddr.dist)) {
        bestAddr = {
          dist,
          name: tags['addr:street'].trim(),
          city: tags['addr:city'],
          postcode: tags['addr:postcode'],
        };
      }
    }

    if (bestWay) {
      return {
        streetName: bestWay.name,
        fallbackCity: bestAddr?.city,
        fallbackPostcode: bestAddr?.postcode,
      };
    }
    if (bestAddr) {
      return {
        streetName: bestAddr.name,
        fallbackCity: bestAddr.city,
        fallbackPostcode: bestAddr.postcode,
      };
    }
  } catch {
    // Handled cleanly by null return
  }

  return null;
}

/**
 * Resolves the street clicked on the map and downloads ALL houses with numbers on that street
 * inside the parish area (using fast official Polish PRG GUGiK UUG first, Overpass fallback).
 */
export async function fetchStreetHousesAtLocation(params: {
  location: LatLng;
  boundary: LatLng[];
  parishCenter?: LatLng;
}): Promise<StreetHousesPickResult> {
  const { location, boundary, parishCenter } = params;
  const detected = await detectStreetNameAtLocation(location);

  if (!detected) {
    throw new Error(
      'Nie rozpoznano nazwy ulicy w tym miejscu. Przybliż mapę i kliknij bezpośrednio na linię ulicy lub dom.'
    );
  }

  const { streetName, fallbackCity, fallbackPostcode, isRuralVillage } = detected;
  const hasBoundary = boundary.length >= 3;

  const { south, west, north, east } = computeBoundingBox(
    boundary,
    parishCenter ?? location,
    1600,
    location
  );
  const bbox = `(${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(
    5
  )},${east.toFixed(5)})`;
  const streetRegex = buildPolishStreetRegex(streetName);
  const overpassQuery = isRuralVillage
    ? `
[out:json][timeout:10];
(
  nwr["addr:place"~"${streetRegex}",i]["addr:housenumber"]${bbox};
  way["building"="apartments"]${bbox};
);
out center tags qt;
`.trim()
    : `
[out:json][timeout:10];
(
  nwr["addr:street"~"${streetRegex}",i]["addr:housenumber"]${bbox};
  way["building"="apartments"]${bbox};
);
out center tags qt;
`.trim();

  // Fetch PRG (focused near click + wider radius) & targeted Overpass street query in parallel
  const [pointTightRes, pointNearClickRes, pointWideRes, overpassRes] =
    await Promise.allSettled([
      queryGugikReversePoint(location, 550, 1000, 6000),
      queryGugikReversePoint(location, 1500, 1000, 6500),
      parishCenter
        ? queryGugikReversePoint(parishCenter, 1500, 1000, 6500)
        : Promise.resolve([]),
      runOverpassQuery(overpassQuery, 7500),
    ]);

  const combinedGugik = [
    ...(pointTightRes.status === 'fulfilled' ? pointTightRes.value : []),
    ...(pointNearClickRes.status === 'fulfilled' ? pointNearClickRes.value : []),
    ...(pointWideRes.status === 'fulfilled' ? pointWideRes.value : []),
  ];
  const osmElements =
    overpassRes.status === 'fulfilled' ? overpassRes.value : [];

  const apartmentBuildings: Array<{ location: LatLng; suggestedUnitsCount: number }> = [];
  for (const el of osmElements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const tags = el.tags ?? {};
    const detectedBlock = detectMultiUnitFromOsmTags(tags);
    if (detectedBlock.isMultiUnit && (el.type === 'way' || el.type === 'relation' || tags.building === 'apartments')) {
      apartmentBuildings.push({
        location: { lat, lng },
        suggestedUnitsCount: detectedBlock.suggestedUnitsCount ?? 15,
      });
    }
  }

  const byNumber: Record<string, OsmHousePoint> = {};

  for (const rec of combinedGugik) {
    const rawNum = (rec.item.number ?? '').trim();
    if (!rawNum) continue;

    const recStreet = (rec.item.street ?? '').trim();
    const recCity = (rec.item.city ?? '').trim();

    let matches = false;
    if (isRuralVillage) {
      matches =
        !recStreet &&
        recCity.length > 0 &&
        stripPolishDiacritics(recCity) === stripPolishDiacritics(streetName);
    } else if (recStreet) {
      matches = streetNamesMatch(recStreet, streetName);
    }

    if (!matches) continue;

    const houseKey = rawNum.toLowerCase();
    if (byNumber[houseKey]) continue;

    const canonicalStreet = recStreet || streetName;
    const postcode = (rec.item.code ?? '').trim() || fallbackPostcode;
    const city = recCity || fallbackCity;
    const { label, fullAddress } = formatPolishHouseAddress(
      canonicalStreet,
      rawNum,
      postcode,
      city
    );

    const matchedApt = apartmentBuildings.find(
      (b) => haversineMeters(rec.location, b.location) <= 26
    );

    byNumber[houseKey] = {
      id: `prg_${houseKey}_${rec.location.lat.toFixed(5)}_${rec.location.lng.toFixed(5)}`,
      street: canonicalStreet,
      houseNumber: rawNum,
      postcode,
      city,
      label,
      fullAddress,
      location: rec.location,
      ...(matchedApt
        ? {
            isMultiUnit: true,
            suggestedUnitsCount: matchedApt.suggestedUnitsCount,
          }
        : {}),
    };
  }

  for (const el of osmElements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    const tags = el.tags ?? {};
    const addrNum = tags['addr:housenumber']?.trim();
    if (!addrNum) continue;

    const detectedBlock = detectMultiUnitFromOsmTags(tags);
    const nearbyApt = !detectedBlock.isMultiUnit
      ? apartmentBuildings.find((b) => haversineMeters({ lat, lng }, b.location) <= 24)
      : undefined;
    const isApartments = detectedBlock.isMultiUnit || Boolean(nearbyApt);
    const suggestedUnitsCount =
      detectedBlock.suggestedUnitsCount ?? nearbyApt?.suggestedUnitsCount;

    const key = addrNum.toLowerCase();
    const existing = byNumber[key];
    if (!existing) {
      const canonicalStreet =
        tags['addr:street']?.trim() ||
        tags['addr:place']?.trim() ||
        streetName;
      const postcode = tags['addr:postcode'] || fallbackPostcode;
      const city = tags['addr:city'] || fallbackCity;
      const { label, fullAddress } = formatPolishHouseAddress(
        canonicalStreet,
        addrNum,
        postcode,
        city
      );

      byNumber[key] = {
        id: `${el.type}-${el.id}`,
        street: canonicalStreet,
        houseNumber: addrNum,
        postcode,
        city,
        label,
        fullAddress,
        location: { lat, lng },
        ...(isApartments ? { isMultiUnit: true, suggestedUnitsCount } : {}),
      };
    } else if (isApartments && !existing.isMultiUnit) {
      existing.isMultiUnit = true;
      existing.suggestedUnitsCount = suggestedUnitsCount;
    }
  }

  const allHouses = Object.values(byNumber).sort((a, b) =>
    naturalHouseCompare(a.houseNumber, b.houseNumber)
  );

  if (allHouses.length > 0) {
    if (hasBoundary) {
      const insideOnly = allHouses.filter((h) =>
        isPointInsideBoundary(h.location, boundary)
      );
      if (insideOnly.length > 0) {
        return {
          streetName: insideOnly[0].street || streetName,
          streetCenter: {
            lat:
              insideOnly.reduce((acc, h) => acc + h.location.lat, 0) /
              insideOnly.length,
            lng:
              insideOnly.reduce((acc, h) => acc + h.location.lng, 0) /
              insideOnly.length,
          },
          houses: insideOnly,
          filteredByBoundary: true,
        };
      }
    }

    return {
      streetName: allHouses[0].street || streetName,
      streetCenter: {
        lat:
          allHouses.reduce((acc, h) => acc + h.location.lat, 0) /
          allHouses.length,
        lng:
          allHouses.reduce((acc, h) => acc + h.location.lng, 0) /
          allHouses.length,
      },
      houses: allHouses,
      filteredByBoundary: false,
    };
  }

  return {
    streetName,
    streetCenter: location,
    houses: [],
    filteredByBoundary: false,
  };
}

/**
 * Resolves a clicked coordinate on the map into the closest Polish house address
 * using official PRG (GUGiK UUG) first (~80 ms) with Nominatim fallback.
 */
export async function reverseGeocodeHouseAddress(
  location: LatLng
): Promise<ResolvedHouseAddress> {
  // 1. Official PRG GUGiK UUG nearest address point within 55m
  const gugikNear = await queryGugikReversePoint(location, 55, 5, 4000);
  if (gugikNear.length > 0) {
    const sorted = [...gugikNear].sort(
      (a, b) => a.distanceMeters - b.distanceMeters
    );
    const best = sorted.find((g) => (g.item.number ?? '').trim().length > 0);
    if (best) {
      const streetOrCity =
        (best.item.street ?? '').trim() || (best.item.city ?? '').trim();
      const houseNum = (best.item.number ?? '').trim();
      if (streetOrCity && houseNum) {
        const { label, fullAddress } = formatPolishHouseAddress(
          streetOrCity,
          houseNum,
          best.item.code,
          best.item.city
        );
        return { label, address: fullAddress, resolved: true };
      }
    }
  }

  // 2. Fallback: Nominatim reverse geocode
  const nom = await queryNominatimReverse(location, 4500);
  if (nom?.road) {
    const { label, fullAddress } = formatPolishHouseAddress(
      nom.road,
      nom.houseNumber,
      nom.postcode,
      nom.city
    );
    return { label, address: fullAddress, resolved: true };
  }
  if (nom?.displayName) {
    const shortName = nom.displayName.split(',').slice(0, 2).join(',').trim();
    return {
      label: shortName || 'Wskazany adres',
      address: nom.displayName,
      resolved: true,
    };
  }

  return {
    label: 'Wskazany dom (wpisz adres)',
    address: `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`,
    resolved: false,
  };
}

export interface NearbyParishCandidate {
  id: string;
  name: string;
  address: string;
  location: LatLng;
  distanceMeters: number;
}

interface NearbyPhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    locality?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    postcode?: string;
    countrycode?: string;
  };
}

async function queryPhotonChurchesNear(
  query: string,
  center: LatLng,
  maxRadiusMeters: number,
  timeoutMs = 5500
): Promise<NearbyParishCandidate[]> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const params = new URLSearchParams({
      q: query,
      lat: center.lat.toFixed(5),
      lon: center.lng.toFixed(5),
      limit: '20',
    });
    const res = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: NearbyPhotonFeature[] };
    const out: NearbyParishCandidate[] = [];

    for (const f of data.features ?? []) {
      const coords = f.geometry?.coordinates;
      const props = f.properties;
      if (!coords || coords.length < 2 || !props) continue;
      if (props.countrycode && props.countrycode.toUpperCase() !== 'PL') continue;

      const isChurch =
        (props.osm_key === 'amenity' &&
          props.osm_value === 'place_of_worship') ||
        (props.osm_key === 'building' &&
          ['church', 'cathedral', 'chapel'].includes(props.osm_value || '')) ||
        /(parafi|kościół|kosciol|bazylika|sanktuarium|katedra|kaplica)/i.test(
          props.name || ''
        );
      if (!isChurch) continue;

      const [lng, lat] = coords;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const pt = { lat, lng };
      const dist = Math.round(haversineMeters(center, pt));
      if (dist > maxRadiusMeters) continue;

      const name = (props.name || '').trim();
      if (!name) continue;

      const streetPart = [props.street, props.housenumber]
        .filter(Boolean)
        .join(' ');
      const city = props.city || props.town || props.village || props.county || '';
      const cityPart = [props.postcode, city].filter(Boolean).join(' ');
      const address =
        [streetPart, cityPart].filter(Boolean).join(', ') ||
        city ||
        `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

      out.push({
        id: `photon_worship_${props.osm_type || 'N'}_${props.osm_id || `${lat}_${lng}`}`,
        name,
        address,
        location: pt,
        distanceMeters: dist,
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    window.clearTimeout(timer);
  }
}

async function queryNominatimChurchesNear(
  center: LatLng,
  radiusMeters: number,
  cityHint?: string,
  timeoutMs = 5000
): Promise<NearbyParishCandidate[]> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const latDelta = radiusMeters / 111320;
    const lngDelta =
      radiusMeters /
      (111320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
    const qText = cityHint ? `kościół ${cityHint}` : 'kościół';
    const params = new URLSearchParams({
      format: 'jsonv2',
      q: qText,
      countrycodes: 'pl',
      addressdetails: '1',
      'accept-language': 'pl',
      limit: '15',
      viewbox: `${(center.lng - lngDelta).toFixed(4)},${(center.lat + latDelta).toFixed(4)},${(center.lng + lngDelta).toFixed(4)},${(center.lat - latDelta).toFixed(4)}`,
      bounded: '1',
    });

    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }
    );
    if (!res.ok) return [];
    const items = (await res.json()) as Array<{
      place_id: number;
      name?: string;
      display_name: string;
      lat: string;
      lon: string;
      type?: string;
      address?: Record<string, string>;
    }>;

    const out: NearbyParishCandidate[] = [];
    for (const item of items) {
      const lat = Number.parseFloat(item.lat);
      const lng = Number.parseFloat(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const pt = { lat, lng };
      const dist = Math.round(haversineMeters(center, pt));
      if (dist > radiusMeters) continue;

      const name =
        item.name?.trim() || item.display_name.split(',')[0]?.trim() || '';
      if (!name) continue;
      const isChurch =
        item.type === 'place_of_worship' ||
        /(parafi|kościół|kosciol|bazylika|sanktuarium|katedra|kaplica)/i.test(
          name
        );
      if (!isChurch) continue;

      const addr = item.address ?? {};
      const streetPart = [addr.road || '', addr.house_number || '']
        .filter(Boolean)
        .join(' ');
      const city = addr.city || addr.town || addr.village || addr.municipality || '';
      const cityPart = [addr.postcode || '', city].filter(Boolean).join(' ');
      const address =
        [streetPart, cityPart].filter(Boolean).join(', ') ||
        item.display_name;

      out.push({
        id: `nom_worship_${item.place_id}`,
        name,
        address,
        location: pt,
        distanceMeters: dist,
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    window.clearTimeout(timer);
  }
}

export async function describeLocationForGpsFallback(
  center: LatLng
): Promise<{ city: string; address: string }> {
  const rev = await queryNominatimReverse(center, 4000);
  const city = rev?.city || '';
  const streetPart = [rev?.road, rev?.houseNumber].filter(Boolean).join(' ');
  const cityPart = [rev?.postcode, city].filter(Boolean).join(' ');
  const address =
    [streetPart, cityPart].filter(Boolean).join(', ') ||
    rev?.displayName?.split(',').slice(0, 2).join(',').trim() ||
    `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;
  return { city, address };
}

/**
 * Finds churches, chapels and parish locations around a given coordinate using Overpass API
 * with parallel Photon & Nominatim fallback so it remains reliable even when Overpass rate-limits.
 * Sorted by distance.
 */
export async function fetchNearbyParishesOsm(
  center: LatLng,
  radiusMeters = 6000
): Promise<NearbyParishCandidate[]> {
  const safeRadius = Math.min(Math.max(radiusMeters, 500), 12000);
  const query = `
[out:json][timeout:8];
nwr["amenity"="place_of_worship"](around:${Math.round(safeRadius)},${center.lat.toFixed(
    5
  )},${center.lng.toFixed(5)});
out center tags qt;
`.trim();

  const [overpassRes, photonChurchRes, photonParishRes, reverseRes] =
    await Promise.allSettled([
      runOverpassQuery(query, 7000),
      queryPhotonChurchesNear('kościół', center, Math.max(safeRadius, 8500), 5500),
      queryPhotonChurchesNear('parafia', center, Math.max(safeRadius, 8500), 5500),
      queryNominatimReverse(center, 4000),
    ]);

  const rawList: NearbyParishCandidate[] = [];

  if (overpassRes.status === 'fulfilled') {
    for (const el of overpassRes.value) {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;

      const tags = el.tags ?? {};
      const rawName =
        tags.name ||
        tags['name:pl'] ||
        tags.official_name ||
        tags.alt_name ||
        '';
      const trimmedName = rawName.trim();
      if (!trimmedName) continue;

      const street = tags['addr:street']?.trim() || '';
      const houseNum = tags['addr:housenumber']?.trim() || '';
      const city = tags['addr:city']?.trim() || tags['addr:place']?.trim() || '';
      const postcode = tags['addr:postcode']?.trim() || '';

      const streetPart = [street, houseNum].filter(Boolean).join(' ');
      const cityPart = [postcode, city].filter(Boolean).join(' ');
      const address =
        [streetPart, cityPart].filter(Boolean).join(', ') ||
        city ||
        `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

      const pt = { lat, lng };
      rawList.push({
        id: `osm_worship_${el.type}_${el.id}`,
        name: trimmedName,
        address,
        location: pt,
        distanceMeters: Math.round(haversineMeters(center, pt)),
      });
    }
  }

  if (photonChurchRes.status === 'fulfilled') {
    rawList.push(...photonChurchRes.value);
  }
  if (photonParishRes.status === 'fulfilled') {
    rawList.push(...photonParishRes.value);
  }

  const cityHint =
    reverseRes.status === 'fulfilled' ? reverseRes.value?.city : undefined;

  // Fallback with city name + Nominatim bounded search if primary sources found nothing
  if (rawList.length === 0) {
    const extraFetches: Array<Promise<NearbyParishCandidate[]>> = [
      queryNominatimChurchesNear(center, Math.max(safeRadius, 8500), cityHint, 5000),
    ];
    if (cityHint) {
      extraFetches.push(
        queryPhotonChurchesNear(
          `kościół ${cityHint}`,
          center,
          Math.max(safeRadius, 10000),
          5000
        )
      );
    }
    const extraSettled = await Promise.allSettled(extraFetches);
    for (const s of extraSettled) {
      if (s.status === 'fulfilled') rawList.push(...s.value);
    }
  }

  const candidates: NearbyParishCandidate[] = [];
  for (const item of rawList) {
    const normTitle = item.name.toLowerCase();
    const existingIdx = candidates.findIndex(
      (c) =>
        (c.name.toLowerCase() === normTitle ||
          c.name.toLowerCase().includes(normTitle) ||
          normTitle.includes(c.name.toLowerCase()) ||
          haversineMeters(c.location, item.location) < 45) &&
        haversineMeters(c.location, item.location) < 95
    );

    if (existingIdx >= 0) {
      if (item.address.length > candidates[existingIdx].address.length) {
        candidates[existingIdx] = item;
      }
      continue;
    }

    candidates.push(item);
  }

  return candidates.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export interface PlaceBoundaryResult {
  name: string;
  displayName: string;
  polygon: LatLng[];
}

export function extractLocalityQueryHint(
  address?: string | null,
  parishName?: string | null
): string {
  const addr = (address || '').trim();
  if (addr) {
    const parts = addr
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i]
        .replace(/^\d{2}-\d{3}\s*/g, '')
        .trim();
      if (
        part &&
        part.toLowerCase() !== 'polska' &&
        part.toLowerCase() !== 'poland' &&
        !/^powiat\b/i.test(part) &&
        !/^gmina\b/i.test(part) &&
        !/^województwo\b/i.test(part)
      ) {
        return part;
      }
    }
  }
  const name = (parishName || '').trim();
  return name.replace(/^parafia\s+/i, '').trim();
}

function extractOuterRingFromGeoJson(
  geojson?: { type?: string; coordinates?: unknown }
): LatLng[] | null {
  if (!geojson || !geojson.coordinates) return null;

  const toLatLngList = (ring: unknown): LatLng[] => {
    if (!Array.isArray(ring)) return [];
    const pts: LatLng[] = [];
    for (const pair of ring) {
      if (
        Array.isArray(pair) &&
        pair.length >= 2 &&
        typeof pair[0] === 'number' &&
        typeof pair[1] === 'number'
      ) {
        pts.push({ lat: pair[1], lng: pair[0] });
      }
    }
    return pts;
  };

  if (geojson.type === 'Polygon' && Array.isArray(geojson.coordinates)) {
    const outer = toLatLngList(geojson.coordinates[0]);
    return outer.length >= 3 ? outer : null;
  }

  if (geojson.type === 'MultiPolygon' && Array.isArray(geojson.coordinates)) {
    let best: LatLng[] | null = null;
    for (const poly of geojson.coordinates) {
      if (!Array.isArray(poly)) continue;
      const candidate = toLatLngList(poly[0]);
      if (candidate.length >= 3 && (!best || candidate.length > best.length)) {
        best = candidate;
      }
    }
    return best;
  }

  return null;
}

export async function fetchPlaceBoundaryPolygonOsm(
  query: string,
  biasCenter?: LatLng
): Promise<PlaceBoundaryResult | null> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  const { simplifyPolygonRDP } = await import('../utils/spatial');

  const params = new URLSearchParams({
    format: 'jsonv2',
    polygon_geojson: '1',
    polygon_threshold: '0.0003',
    addressdetails: '1',
    limit: '6',
    countrycodes: 'pl',
    'accept-language': 'pl',
    q: trimmed,
  });

  if (biasCenter) {
    const dLat = 0.28;
    const dLng = 0.35;
    params.set(
      'viewbox',
      `${(biasCenter.lng - dLng).toFixed(4)},${(biasCenter.lat + dLat).toFixed(
        4
      )},${(biasCenter.lng + dLng).toFixed(4)},${(biasCenter.lat - dLat).toFixed(4)}`
    );
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      { signal: controller.signal }
    );
    if (!res.ok) return null;
    const items = (await res.json()) as Array<{
      name?: string;
      display_name?: string;
      category?: string;
      type?: string;
      boundingbox?: [string, string, string, string];
      geojson?: { type?: string; coordinates?: unknown };
    }>;

    if (!Array.isArray(items) || items.length === 0) return null;

    // Prefer administrative boundaries / localities with real polygon geometry
    const ranked = [...items].sort((a, b) => {
      const aHasPoly =
        a.geojson?.type === 'Polygon' || a.geojson?.type === 'MultiPolygon'
          ? 1
          : 0;
      const bHasPoly =
        b.geojson?.type === 'Polygon' || b.geojson?.type === 'MultiPolygon'
          ? 1
          : 0;
      if (aHasPoly !== bHasPoly) return bHasPoly - aHasPoly;
      const aAdmin =
        a.category === 'boundary' || a.category === 'place' ? 1 : 0;
      const bAdmin =
        b.category === 'boundary' || b.category === 'place' ? 1 : 0;
      return bAdmin - aAdmin;
    });

    for (const item of ranked) {
      const ring = extractOuterRingFromGeoJson(item.geojson);
      if (ring && ring.length >= 3) {
        const simplified = simplifyPolygonRDP(ring, 24, 30);
        if (simplified.length >= 3) {
          return {
            name: item.name || trimmed,
            displayName: item.display_name || trimmed,
            polygon: simplified,
          };
        }
      }
    }

    // Fallback: use bounding box rectangle if locality returned a real area (> 300 m span)
    for (const item of ranked) {
      if (!item.boundingbox || item.boundingbox.length !== 4) continue;
      const s = Number.parseFloat(item.boundingbox[0]);
      const n = Number.parseFloat(item.boundingbox[1]);
      const w = Number.parseFloat(item.boundingbox[2]);
      const e = Number.parseFloat(item.boundingbox[3]);
      if (
        !Number.isFinite(s) ||
        !Number.isFinite(n) ||
        !Number.isFinite(w) ||
        !Number.isFinite(e)
      ) {
        continue;
      }
      const spanMeters = haversineMeters({ lat: s, lng: w }, { lat: n, lng: e });
      if (spanMeters >= 300 && spanMeters <= 45000) {
        return {
          name: item.name || trimmed,
          displayName: item.display_name || trimmed,
          polygon: [
            { lat: n, lng: w },
            { lat: n, lng: e },
            { lat: s, lng: e },
            { lat: s, lng: w },
          ],
        };
      }
    }

    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}
