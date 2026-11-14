import { LatLng } from '../types/parish';

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

async function runOverpassQuery(
  query: string,
  timeoutMs = 28000
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
        throw new Error(`Serwer OpenStreetMap zwrócił kod HTTP ${response.status}.`);
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
          'Serwer OpenStreetMap nie odpowiedział na czas (zbyt duży obszar lub słabsze połączenie). Spróbuj ponownie lub zmniejsz obrys.'
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

export async function fetchParishStreetsFromOsm(params: {
  boundary: LatLng[];
  center: LatLng;
  radiusMeters: number;
}): Promise<OsmStreetGroup[]> {
  const { boundary, center, radiusMeters } = params;
  const hasBoundary = boundary.length >= 3;

  const areaFilter = hasBoundary
    ? `(poly:"${boundary.map((p) => `${p.lat.toFixed(5)} ${p.lng.toFixed(5)}`).join(' ')}")`
    : `(around:${Math.round(radiusMeters)},${center.lat.toFixed(5)},${center.lng.toFixed(5)})`;

  const query = `
[out:json][timeout:25];
(
  way["highway"~"^(residential|living_street|unclassified|tertiary|secondary|primary|service|pedestrian)$"]["name"]${areaFilter};
  nwr["addr:street"]["addr:housenumber"]${areaFilter};
);
out center tags qt;
`.trim();

  const elements = await runOverpassQuery(query, 28000);

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
          location: { lat, lng },
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
