import { LatLng } from '../types/parish';
import { isPointInsideBoundary } from '../utils/spatial';

export interface OsmHousePoint {
  id: string;
  street: string;
  houseNumber: string;
  postcode?: string;
  city?: string;
  label: string;
  fullAddress: string;
  location: LatLng;
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

function formatPolishHouseAddress(
  street: string,
  houseNumber: string,
  postcode?: string,
  city?: string
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
    // Small ~40m margin so houses sitting on boundary streets are captured
    const padLat = 40 / 111320;
    const padLng =
      40 / (111320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
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
  timeoutMs = 22000
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
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Serwer OpenStreetMap zwrócił kod HTTP ${response.status}.`
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
          'Zapytanie do OpenStreetMap przekroczyło limit czasu. Spróbuj zmniejszyć obszar parafii.'
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
          'Serwer OpenStreetMap nie odpowiedział na czas (zbyt duży obszar lub chwilowe przeciążenie). Spróbuj ponownie lub zmniejsz obrys.'
        );
      } else {
        lastError =
          err instanceof Error
            ? err
            : new Error('Błąd połączenia z OpenStreetMap Overpass API.');
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error('Nie udało się pobrać danych z OpenStreetMap.');
}

/**
 * Fetches named streets & addressed houses within a parish boundary or radius.
 * Uses a fast bounding-box Overpass query followed by exact client-side polygon filtering
 * to avoid expensive Overpass server-side (poly:...) spatial timeouts.
 */
export async function fetchParishStreetsFromOsm(params: {
  boundary: LatLng[];
  center: LatLng;
  radiusMeters: number;
}): Promise<OsmStreetGroup[]> {
  const { boundary, center, radiusMeters } = params;
  const hasBoundary = boundary.length >= 3;

  const { south, west, north, east } = computeBoundingBox(
    boundary,
    center,
    radiusMeters
  );
  const bbox = `(${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)})`;

  const query = `
[out:json][timeout:20];
(
  way["highway"~"^(residential|living_street|unclassified|tertiary|secondary|primary|service|pedestrian)$"]["name"]${bbox};
  nwr["addr:street"]["addr:housenumber"]${bbox};
);
out center tags qt;
`.trim();

  const elements = await runOverpassQuery(query, 24000);

  const isInsideArea = (pt: LatLng): boolean => {
    if (hasBoundary) {
      return isPointInsideBoundary(pt, boundary);
    }
    return haversineMeters(center, pt) <= radiusMeters;
  };

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

  const ensureStreet = (name: string) => {
    const key = name.trim().toLowerCase();
    if (!streetMap[key]) {
      streetMap[key] = {
        streetName: name.trim(),
        sumLat: 0,
        sumLng: 0,
        pointCount: 0,
        housesByNumber: {},
      };
    }
    return streetMap[key];
  };

  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    const pt = { lat, lng };
    if (!isInsideArea(pt)) continue;

    const tags = el.tags ?? {};

    if (tags.highway && tags.name) {
      const group = ensureStreet(tags.name);
      group.sumLat += lat;
      group.sumLng += lng;
      group.pointCount += 1;
    }

    const addrStreet = tags['addr:street'];
    const addrNum = tags['addr:housenumber'];
    if (addrStreet && addrNum) {
      const group = ensureStreet(addrStreet);
      if (group.pointCount === 0) {
        group.sumLat += lat;
        group.sumLng += lng;
        group.pointCount += 1;
      }
      const normNum = addrNum.trim();
      const houseKey = normNum.toLowerCase();
      if (!group.housesByNumber[houseKey]) {
        const postcode = tags['addr:postcode'];
        const city = tags['addr:city'];
        const { label, fullAddress } = formatPolishHouseAddress(
          group.streetName,
          normNum,
          postcode,
          city
        );

        group.housesByNumber[houseKey] = {
          id: `${el.type}-${el.id}`,
          street: group.streetName,
          houseNumber: normNum,
          postcode,
          city,
          label,
          fullAddress,
          location: pt,
        };
      }
    }
  }

  return Object.values(streetMap)
    .filter((g) => g.pointCount > 0)
    .map((g) => {
      const houses = Object.values(g.housesByNumber).sort((a, b) =>
        naturalHouseCompare(a.houseNumber, b.houseNumber)
      );
      return {
        streetName: g.streetName,
        center: {
          lat: g.sumLat / g.pointCount,
          lng: g.sumLng / g.pointCount,
        },
        houses,
      };
    })
    .sort((a, b) => a.streetName.localeCompare(b.streetName, 'pl'));
}

function sqDistance(a: LatLng, b: LatLng): number {
  return (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;
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

async function detectStreetNameAtLocation(
  location: LatLng
): Promise<{ streetName: string; fallbackCity?: string; fallbackPostcode?: string } | null> {
  // 1. Overpass way geometry + nearby address lookup (very fast around 55m)
  try {
    const query = `
[out:json][timeout:8];
(
  way["highway"]["name"](around:55,${location.lat.toFixed(6)},${location.lng.toFixed(6)});
  nwr["addr:street"](around:45,${location.lat.toFixed(6)},${location.lng.toFixed(6)});
);
out geom tags;
`.trim();

    const elements = await runOverpassQuery(query, 9000);
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

      if (tags.highway && tags.name) {
        if (!bestWay || dist < bestWay.dist) {
          bestWay = { dist, name: tags.name.trim() };
        }
      }
      if (tags['addr:street']) {
        if (!bestAddr || dist < bestAddr.dist) {
          bestAddr = {
            dist,
            name: tags['addr:street'].trim(),
            city: tags['addr:city'],
            postcode: tags['addr:postcode'],
          };
        }
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
    // Fall through to Nominatim reverse geocode
  }

  // 2. Fallback: Nominatim reverse geocode
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${location.lat.toFixed(6)}&lon=${location.lng.toFixed(6)}&addressdetails=1&accept-language=pl`;
    const nomRes = await fetch(nomUrl, {
      headers: { Accept: 'application/json' },
    });
    if (nomRes.ok) {
      const nomData = (await nomRes.json()) as {
        address?: Record<string, string>;
      };
      const addr = nomData.address ?? {};
      const road =
        addr.road ||
        addr.pedestrian ||
        addr.residential ||
        addr.footway ||
        '';
      if (road.trim()) {
        return {
          streetName: road.trim(),
          fallbackCity: addr.city || addr.town || addr.village || addr.municipality,
          fallbackPostcode: addr.postcode,
        };
      }
    }
  } catch {
    // Handled by null return
  }

  return null;
}

/**
 * Resolves the street clicked on the map and downloads ALL houses with numbers on that street
 * inside the parish bounding area (clipped to parish boundary when houses exist inside it).
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
      'Nie rozpoznano nazwy ulicy w tym miejscu. Przybliż mapę i kliknij bezpośrednio na linię ulicy.'
    );
  }

  const { streetName, fallbackCity, fallbackPostcode } = detected;
  const hasBoundary = boundary.length >= 3;
  const { south, west, north, east } = computeBoundingBox(
    boundary,
    parishCenter ?? location,
    1800,
    location
  );
  const bbox = `(${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)})`;
  const streetRegex = buildPolishStreetRegex(streetName);

  const query = `
[out:json][timeout:15];
(
  nwr["addr:street"~"${streetRegex}",i]["addr:housenumber"]${bbox};
);
out center tags qt;
`.trim();

  const elements = await runOverpassQuery(query, 18000);

  const byNumber: Record<string, OsmHousePoint> = {};
  let sumLat = 0;
  let sumLng = 0;
  let count = 0;

  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    const tags = el.tags ?? {};
    const addrNum = tags['addr:housenumber']?.trim();
    if (!addrNum) continue;

    const canonicalStreet = tags['addr:street']?.trim() || streetName;
    const key = addrNum.toLowerCase();
    if (byNumber[key]) continue;

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
    };

    sumLat += lat;
    sumLng += lng;
    count += 1;
  }

  const allHouses = Object.values(byNumber).sort((a, b) =>
    naturalHouseCompare(a.houseNumber, b.houseNumber)
  );

  if (hasBoundary && allHouses.length > 0) {
    const insideOnly = allHouses.filter((h) =>
      isPointInsideBoundary(h.location, boundary)
    );
    if (insideOnly.length > 0) {
      return {
        streetName,
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
    streetName,
    streetCenter:
      count > 0 ? { lat: sumLat / count, lng: sumLng / count } : location,
    houses: allHouses,
    filteredByBoundary: false,
  };
}

/**
 * Resolves a clicked coordinate on the map into the closest Polish house address
 * using OpenStreetMap building address tags (Overpass) with Nominatim fallback.
 */
export async function reverseGeocodeHouseAddress(
  location: LatLng
): Promise<ResolvedHouseAddress> {
  // 1. Try exact nearby addressed building/node via Overpass (45 m radius)
  try {
    const query = `
[out:json][timeout:6];
(
  nwr["addr:street"]["addr:housenumber"](around:45,${location.lat.toFixed(6)},${location.lng.toFixed(6)});
  way["highway"]["name"](around:45,${location.lat.toFixed(6)},${location.lng.toFixed(6)});
);
out center tags;
`.trim();

    const elements = await runOverpassQuery(query, 6500);

    let bestHouse: { dist: number; tags: Record<string, string> } | null = null;
    let bestStreet: { dist: number; name: string } | null = null;

    for (const el of elements) {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      const tags = el.tags ?? {};
      const dist = sqDistance(location, { lat, lng });

      if (tags['addr:street'] && tags['addr:housenumber']) {
        if (!bestHouse || dist < bestHouse.dist) {
          bestHouse = { dist, tags };
        }
      } else if (tags.highway && tags.name) {
        if (!bestStreet || dist < bestStreet.dist) {
          bestStreet = { dist, name: tags.name };
        }
      }
    }

    if (bestHouse) {
      const { label, fullAddress } = formatPolishHouseAddress(
        bestHouse.tags['addr:street'],
        bestHouse.tags['addr:housenumber'],
        bestHouse.tags['addr:postcode'],
        bestHouse.tags['addr:city']
      );
      return { label, address: fullAddress, resolved: true };
    }

    // 2. Fallback to Nominatim reverse geocoding for street + house number
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${location.lat.toFixed(6)}&lon=${location.lng.toFixed(6)}&addressdetails=1&accept-language=pl`;
    const nomRes = await fetch(nomUrl, {
      headers: { Accept: 'application/json' },
    });
    if (nomRes.ok) {
      const nomData = (await nomRes.json()) as {
        display_name?: string;
        address?: Record<string, string>;
      };
      const addr = nomData.address ?? {};
      const road =
        addr.road ||
        addr.pedestrian ||
        addr.residential ||
        addr.footway ||
        bestStreet?.name ||
        '';
      const houseNum = addr.house_number || '';
      const city = addr.city || addr.town || addr.village || addr.municipality;
      const postcode = addr.postcode;

      if (road) {
        const { label, fullAddress } = formatPolishHouseAddress(
          road,
          houseNum,
          postcode,
          city
        );
        return { label, address: fullAddress, resolved: true };
      }
      if (nomData.display_name) {
        const shortName = nomData.display_name.split(',').slice(0, 2).join(',').trim();
        return {
          label: shortName || 'Wskazany adres',
          address: nomData.display_name,
          resolved: true,
        };
      }
    }

    if (bestStreet) {
      return {
        label: bestStreet.name,
        address: bestStreet.name,
        resolved: true,
      };
    }
  } catch {
    // Graceful fallback if offline or external service unavailable
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

/**
 * Finds churches, chapels and parish locations around a given coordinate using Overpass API.
 * Sorted by relevance (Catholic/Christian parishes with names first) and distance.
 */
export async function fetchNearbyParishesOsm(
  center: LatLng,
  radiusMeters = 5500
): Promise<NearbyParishCandidate[]> {
  const safeRadius = Math.min(Math.max(radiusMeters, 500), 12000);
  const query = `
[out:json][timeout:12];
(
  nwr["amenity"="place_of_worship"](around:${Math.round(safeRadius)},${center.lat.toFixed(5)},${center.lng.toFixed(5)});
  nwr["building"~"^(church|cathedral|chapel)$"]["name"](around:${Math.round(safeRadius)},${center.lat.toFixed(5)},${center.lng.toFixed(5)});
);
out center tags qt;
`.trim();

  const elements = await runOverpassQuery(query, 13000);

  const candidates: NearbyParishCandidate[] = [];
  for (const el of elements) {
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

    // Exclude non-Christian shrines/cemetery chapels without parish name if needed, keep all named churches
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
    const dist = Math.round(haversineMeters(center, pt));

    // Deduplicate same church represented both as node and building way within 90m
    const normTitle = trimmedName.toLowerCase();
    const existingIdx = candidates.findIndex(
      (c) =>
        (c.name.toLowerCase() === normTitle ||
          c.name.toLowerCase().includes(normTitle) ||
          normTitle.includes(c.name.toLowerCase())) &&
        haversineMeters(c.location, pt) < 90
    );

    if (existingIdx >= 0) {
      // Prefer entries with fuller address metadata
      if (address.length > candidates[existingIdx].address.length) {
        candidates[existingIdx] = {
          id: `osm_worship_${el.type}_${el.id}`,
          name: trimmedName,
          address,
          location: pt,
          distanceMeters: dist,
        };
      }
      continue;
    }

    candidates.push({
      id: `osm_worship_${el.type}_${el.id}`,
      name: trimmedName,
      address,
      location: pt,
      distanceMeters: dist,
    });
  }

  return candidates.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

