import type { SelectedPlaceData } from '../components/PlaceSearchInput';
import type { BuildingUnit, UnitVisitStatus, VisitStop } from '../types/parish';
import { extractStreetName } from './spatial';

export type KartotekaRowGranularity = 'auto' | 'person' | 'family' | 'building';
export type ResolvedGranularity = 'person' | 'family' | 'building';

export interface KartotekaParseOptions {
  defaultCity: string;
  granularity: KartotekaRowGranularity;
  splitSlashUnits: boolean;
  privacyStripNotes: boolean;
  markMultiFamilyAsMultiUnit: boolean;
  defaultVisitMinutes: number;
}

export interface AggregatedUnitEntry {
  unitNumber: string;
  staircase: string;
  residentsCount: number;
  familiesCount: number;
  permanentDecline: boolean;
  lastYearStatus?: UnitVisitStatus;
  safeNotes: string[];
}

export interface AggregatedKartotekaBuilding {
  key: string;
  street: string;
  buildingNumber: string;
  city: string;
  totalResidents: number;
  familiesCount: number;
  explicitBlockUnits?: number;
  units: AggregatedUnitEntry[];
  isMultiUnit: boolean;
  unitsCount: number;
  minutesPerUnit: number;
  recommendedDurationMinutes: number;
  summaryNote: string;
  permanentDecline: boolean;
  lastYearStatus?: UnitVisitStatus;
  lat?: number;
  lng?: number;
}

export interface KartotekaParseResult {
  totalDataRows: number;
  validRows: number;
  ignoredPiiColumns: string[];
  detectedGranularity: ResolvedGranularity;
  detectedReason: string;
  hasResidentsColumn: boolean;
  hasUnitColumn: boolean;
  buildings: AggregatedKartotekaBuilding[];
  totalResidents: number;
  totalFamilies: number;
  multiUnitBuildingsCount: number;
}

export interface KartotekaMapMatchResult {
  matched: Array<{
    building: AggregatedKartotekaBuilding;
    stop: VisitStop;
  }>;
  unmatched: AggregatedKartotekaBuilding[];
  mapOnlyStopsCount: number;
}

const PII_HEADER_PATTERNS = [
  /^nazwisk/,
  /^imie/,
  /^imion/,
  /^drugieimie/,
  /pesel/,
  /telefon/,
  /^tel$/,
  /^kom$/,
  /komork/,
  /email/,
  /^mail$/,
  /dataur/,
  /urodz/,
  /chrzest/,
  /bierzm/,
  /slub/,
  /malzon/,
  /^ojciec$/,
  /^matka$/,
  /dowod/,
  /^plec$/,
  /uwagiosob/,
  /idparafian/,
  /idkartot/,
];

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 6).join('\n');
  const counts = [
    { char: ';', count: (sample.match(/;/g) ?? []).length },
    { char: ',', count: (sample.match(/,/g) ?? []).length },
    { char: '\t', count: (sample.match(/\t/g) ?? []).length },
  ].sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].char : ';';
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function stripPolishDiacritics(input: string): string {
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

function normalizeHeaderToken(raw: string): string {
  return stripPolishDiacritics(raw)
    .replace(/^\ufeff/, '')
    .replace(/[^a-z0-9]/g, '');
}

export function normalizeStreetCore(raw: string): string {
  return stripPolishDiacritics(raw)
    .replace(/[.,'"„”()]/g, ' ')
    .replace(
      /\b(ul|ulica|al|aleja|os|osiedle|pl|plac|skwer|bulwar|rondo|ks|sw|gen|prof|dr|im|plk|kpt|abp|bp)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBuildingNumber(raw: string): string {
  return stripPolishDiacritics(raw).replace(/\s+/g, '').toLowerCase();
}

function streetCoresMatch(aRaw: string, bRaw: string): boolean {
  const a = normalizeStreetCore(aRaw);
  const b = normalizeStreetCore(bRaw);
  if (!a || !b) return false;
  if (a === b) return true;

  const aTokens = a.split(' ').filter(Boolean);
  const bTokens = b.split(' ').filter(Boolean);
  const aLast = aTokens[aTokens.length - 1] || '';
  const bLast = bTokens[bTokens.length - 1] || '';
  if (
    aLast.length >= 5 &&
    bLast.length >= 5 &&
    aLast === bLast &&
    !/^\d/.test(a) &&
    !/^\d/.test(b)
  ) {
    return true;
  }
  return false;
}

function cleanStreetDisplay(raw: string): string {
  return raw
    .trim()
    .replace(/^(ul\.?|ulica)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a combined single-column address such as:
 * - "ul. Słoneczna 12/5, 43-190 Mikołów" -> street "Słoneczna", rawHouse "12/5", extractedCity "Mikołów"
 * - "3 Maja 15 m. 4" -> street "3 Maja", rawHouse "15 m. 4"
 */
function splitCombinedAddress(rawAddress: string): {
  street: string;
  rawHouse: string;
  extractedCity?: string;
} {
  let text = rawAddress.trim();
  let extractedCity: string | undefined;

  const commaIdx = text.indexOf(',');
  if (commaIdx > 0) {
    const tail = text
      .slice(commaIdx + 1)
      .replace(/\b\d{2}-\d{3}\b/g, '')
      .trim();
    if (tail && !/^\d/.test(tail)) {
      extractedCity = tail;
    }
    text = text.slice(0, commaIdx).trim();
  }

  // Match rightmost building+unit tail like "12", "12A", "12/5", "12 A / 5", "12 m. 5", "12 lok. 5"
  const tailMatch = text.match(
    /^(.*?)\s+(\d+[a-zA-Z]?(?:\s*(?:\/|m\.?|lok\.?)\s*[a-zA-Z0-9-]+)?)$/i
  );
  if (tailMatch && tailMatch[1].trim().length > 0) {
    return {
      street: cleanStreetDisplay(tailMatch[1]),
      rawHouse: tailMatch[2].trim(),
      extractedCity,
    };
  }

  return {
    street: cleanStreetDisplay(text),
    rawHouse: '',
    extractedCity,
  };
}

/**
 * Separates building number from apartment/unit suffix.
 * Examples:
 * - "12/5" -> { buildingNumber: "12", unitNumber: "5" }
 * - "12A m. 3" -> { buildingNumber: "12A", unitNumber: "3" }
 * - "12 lok 7" -> { buildingNumber: "12", unitNumber: "7" }
 * - "12A" -> { buildingNumber: "12A", unitNumber: "" }
 */
export function splitHouseAndUnit(
  rawHouse: string,
  explicitUnit = '',
  enableSlashSplit = true
): { buildingNumber: string; unitNumber: string } {
  const houseClean = rawHouse.trim().replace(/\s+/g, ' ');
  const explicitUnitClean = explicitUnit
    .trim()
    .replace(/^(m\.?|lok\.?|nr)\s*/i, '')
    .trim();

  if (!houseClean) {
    return { buildingNumber: '', unitNumber: explicitUnitClean };
  }

  // Always split explicit "m." / "lok." notations (e.g. "12 m. 5", "12a lok. 3")
  const explicitKeywordMatch = houseClean.match(
    /^(\d+\s*[a-zA-Z]?)\s*(?:m\.?|lok\.?|nr\.?)\s*([a-zA-Z0-9-]+)$/i
  );
  if (explicitKeywordMatch) {
    return {
      buildingNumber: explicitKeywordMatch[1].replace(/\s+/g, ''),
      unitNumber: explicitUnitClean || explicitKeywordMatch[2].trim(),
    };
  }

  if (enableSlashSplit) {
    const slashMatch = houseClean.match(
      /^(\d+\s*[a-zA-Z]?)\s*\/\s*([a-zA-Z0-9-]+)$/
    );
    if (slashMatch) {
      return {
        buildingNumber: slashMatch[1].replace(/\s+/g, ''),
        unitNumber: explicitUnitClean || slashMatch[2].trim(),
      };
    }
  }

  return {
    buildingNumber: houseClean.replace(/^(\d+)\s+([a-zA-Z])$/, '$1$2'),
    unitNumber: explicitUnitClean,
  };
}

function parsePositiveInt(raw: string): number | undefined {
  const clean = raw.trim();
  if (!clean) return undefined;
  const n = Number.parseInt(clean, 10);
  if (Number.isNaN(n) || n < 0) return undefined;
  return n;
}

function parseBooleanishBlock(val: string): { isBlock: boolean; units?: number } {
  const v = stripPolishDiacritics(val.trim());
  if (!v) return { isBlock: false };
  const asNum = Number.parseInt(v, 10);
  if (!Number.isNaN(asNum) && asNum > 1) {
    return { isBlock: true, units: Math.min(500, asNum) };
  }
  if (['tak', 't', 'yes', 'y', '1', 'true', 'blok', 'wielorodzinny'].includes(v)) {
    return { isBlock: true, units: 15 };
  }
  return { isBlock: false };
}

function parseKoledaHintFromText(raw: string): {
  permanentDecline: boolean;
  lastYearStatus?: UnitVisitStatus;
} {
  const norm = stripPolishDiacritics(raw);
  if (!norm) return { permanentDecline: false };
  if (
    /stala odmowa|nie przyjmuj|bez koledy|wykresl|zakaz/.test(norm)
  ) {
    return { permanentDecline: true, lastYearStatus: 'declined' };
  }
  if (/odmowa|odmowil/.test(norm)) {
    return { permanentDecline: false, lastYearStatus: 'declined' };
  }
  if (/nieobecn|nikogo|zamkniete/.test(norm)) {
    return { permanentDecline: false, lastYearStatus: 'absent' };
  }
  if (/przyjel|przyjal|przyjela|ok|byl/.test(norm)) {
    return { permanentDecline: false, lastYearStatus: 'accepted' };
  }
  return { permanentDecline: false };
}

function naturalUnitCompare(a: string, b: string): number {
  const numA = Number.parseInt(a, 10);
  const numB = Number.parseInt(b, 10);
  const hasA = !Number.isNaN(numA);
  const hasB = !Number.isNaN(numB);
  if (hasA && hasB && numA !== numB) return numA - numB;
  return a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' });
}

function formatPolishResidents(count: number): string {
  if (count === 1) return '1 mieszkaniec';
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    return `${count} mieszkańców`;
  }
  return `${count} mieszkańców`;
}

function formatPolishFamilies(count: number): string {
  if (count === 1) return '1 rodzina';
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    return `${count} rodziny`;
  }
  return `${count} rodzin`;
}

function formatPolishUnits(count: number): string {
  if (count === 1) return '1 lokal';
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    return `${count} lokale`;
  }
  return `${count} lokali`;
}

interface ParsedIntermediateRow {
  street: string;
  buildingNumber: string;
  unitNumber: string;
  staircase: string;
  city: string;
  residentsCount?: number;
  familiesCount?: number;
  explicitBlockUnits?: number;
  permanentDecline: boolean;
  lastYearStatus?: UnitVisitStatus;
  safeNote: string;
  lat?: number;
  lng?: number;
}

export function parseAndAggregateKartotekaCsv(
  rawText: string,
  options: KartotekaParseOptions
): KartotekaParseResult {
  const emptyResult: KartotekaParseResult = {
    totalDataRows: 0,
    validRows: 0,
    ignoredPiiColumns: [],
    detectedGranularity: 'building',
    detectedReason: 'Brak danych w pliku',
    hasResidentsColumn: false,
    hasUnitColumn: false,
    buildings: [],
    totalResidents: 0,
    totalFamilies: 0,
    multiUnitBuildingsCount: 0,
  };

  const lines = rawText
    .replace(/^\ufeff/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) return emptyResult;

  const delimiter = detectDelimiter(lines);
  const rawFirstCols = splitCsvLine(lines[0], delimiter);
  const firstCols = rawFirstCols.map(normalizeHeaderToken);

  const ignoredPiiColumns: string[] = [];
  const piiIndices = new Set<number>();

  firstCols.forEach((normCol, idx) => {
    if (normCol && PII_HEADER_PATTERNS.some((re) => re.test(normCol))) {
      piiIndices.add(idx);
      ignoredPiiColumns.push(rawFirstCols[idx].trim());
    }
  });

  const findCol = (exactAliases: string[], partialAliases: string[] = []): number => {
    const exactIdx = firstCols.findIndex(
      (c, i) => !piiIndices.has(i) && exactAliases.includes(c)
    );
    if (exactIdx >= 0) return exactIdx;
    return firstCols.findIndex(
      (c, i) =>
        !piiIndices.has(i) &&
        c.length > 0 &&
        partialAliases.some((a) => c.includes(a))
    );
  };

  const streetIdx = findCol(
    ['ulica', 'street', 'ul', 'nazwaulicy', 'droga', 'osiedle', 'plac'],
    ['ulica', 'street', 'ulic']
  );
  const fullAddressIdx = findCol(
    ['adres', 'address', 'adreszamieszkania', 'ulicainr', 'ulicainumer'],
    ['adres']
  );
  const numberIdx = findCol(
    ['nrdomu', 'numerdomu', 'dom', 'nrbudynku', 'budynek', 'numer', 'nr', 'housenumber'],
    ['nrdom', 'numerdom', 'nrbud']
  );
  const unitIdx = findCol(
    ['nrlokalu', 'numerlokalu', 'lokal', 'mieszkanie', 'nrmieszkania', 'lok', 'm'],
    ['nrlok', 'numerlok', 'nrmieszk']
  );
  const staircaseIdx = findCol(['klatka', 'kl', 'wejscie'], ['klatk']);
  const cityIdx = findCol(
    ['miejscowosc', 'miasto', 'wies', 'city', 'town', 'poczta'],
    ['miejscow', 'miasto']
  );
  const residentsIdx = findCol(
    [
      'mieszkancy',
      'mieszkancow',
      'iloscmieszkancow',
      'liczbamieszkancow',
      'liczbaosob',
      'iloscosob',
      'osoby',
      'osob',
      'losob',
      'lmieszk',
      'domownicy',
      'czlonkowie',
      'stanrodziny',
    ],
    ['mieszkanc', 'liczbaosob', 'iloscosob', 'iloscmieszk']
  );
  const familiesIdx = findCol(
    ['rodziny', 'rodzin', 'iloscrodzin', 'liczbarodzin', 'kartotek', 'kartoteki'],
    ['liczbarodzin', 'iloscrodzin']
  );
  const blockIdx = findCol(
    ['blok', 'block', 'wielorodzinny', 'lokale', 'liczbamieszkan', 'iloscmieszkan', 'multiunit'],
    ['wielorodz', 'liczbamieszkan']
  );
  const statusIdx = findCol(
    ['koleda', 'status', 'odmowa', 'statuskoledy', 'przyjecie'],
    ['statuskoled', 'odmow']
  );
  const notesIdx = findCol(
    ['uwagi', 'notatka', 'notatki', 'opis', 'notes'],
    ['uwag', 'notat']
  );
  const latIdx = findCol(['lat', 'szerokosc'], ['szerokosc']);
  const lngIdx = findCol(['lng', 'lon', 'dlugosc'], ['dlugosc']);

  const effectiveStreetCol = streetIdx >= 0 ? streetIdx : fullAddressIdx;

  const hasHeader =
    effectiveStreetCol >= 0 ||
    numberIdx >= 0 ||
    unitIdx >= 0 ||
    cityIdx >= 0 ||
    residentsIdx >= 0 ||
    familiesIdx >= 0 ||
    blockIdx >= 0 ||
    piiIndices.size > 0;

  const startRow = hasHeader ? 1 : 0;
  const intermediateRows: ParsedIntermediateRow[] = [];

  for (let r = startRow; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r], delimiter);
    if (cols.every((c) => !c)) continue;

    let rawStreet = '';
    let rawHouse = '';
    let rawUnit = '';
    let staircase = '';
    let city = options.defaultCity;
    let residentsCount: number | undefined;
    let familiesCount: number | undefined;
    let explicitBlockUnits: number | undefined;
    let permanentDecline = false;
    let lastYearStatus: UnitVisitStatus | undefined;
    let safeNote = '';
    let lat: number | undefined;
    let lng: number | undefined;

    if (hasHeader) {
      rawStreet = effectiveStreetCol >= 0 ? cols[effectiveStreetCol] ?? '' : '';
      rawHouse = numberIdx >= 0 ? cols[numberIdx] ?? '' : '';
      rawUnit = unitIdx >= 0 ? cols[unitIdx] ?? '' : '';
      staircase = staircaseIdx >= 0 ? (cols[staircaseIdx] ?? '').trim() : '';

      const rowCity = cityIdx >= 0 ? (cols[cityIdx] ?? '').trim() : '';
      if (rowCity) city = rowCity;

      if (residentsIdx >= 0) {
        const parsedRes = parsePositiveInt(cols[residentsIdx] ?? '');
        if (parsedRes !== undefined) residentsCount = parsedRes;
      }
      if (familiesIdx >= 0) {
        const parsedFam = parsePositiveInt(cols[familiesIdx] ?? '');
        if (parsedFam !== undefined) familiesCount = parsedFam;
      }
      if (blockIdx >= 0) {
        const b = parseBooleanishBlock(cols[blockIdx] ?? '');
        if (b.isBlock) explicitBlockUnits = b.units;
      }

      const statusText = statusIdx >= 0 ? cols[statusIdx] ?? '' : '';
      const rawNoteText = notesIdx >= 0 ? cols[notesIdx] ?? '' : '';
      const hint = parseKoledaHintFromText(`${statusText} ${rawNoteText}`);
      permanentDecline = hint.permanentDecline;
      lastYearStatus = hint.lastYearStatus;

      if (!options.privacyStripNotes && rawNoteText.trim()) {
        safeNote = rawNoteText.trim();
      } else if (statusText.trim() && hint.lastYearStatus) {
        safeNote = hint.permanentDecline
          ? 'Stała odmowa (wg kartoteki)'
          : '';
      }

      if (latIdx >= 0 && lngIdx >= 0) {
        const pLat = Number.parseFloat((cols[latIdx] ?? '').replace(',', '.'));
        const pLng = Number.parseFloat((cols[lngIdx] ?? '').replace(',', '.'));
        if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
          lat = pLat;
          lng = pLng;
        }
      }
    } else if (cols.length === 1) {
      rawStreet = cols[0];
    } else {
      rawStreet = cols[0] ?? '';
      rawHouse = cols[1] ?? '';
      if (cols[2]) city = cols[2];
      if (cols[3]) {
        const asRes = parsePositiveInt(cols[3]);
        if (asRes !== undefined && cols.length <= 5) {
          residentsCount = asRes;
        } else if (!options.privacyStripNotes) {
          safeNote = cols[3].trim();
        }
      }
      if (cols[4]) {
        const b = parseBooleanishBlock(cols[4]);
        if (b.isBlock) explicitBlockUnits = b.units;
      }
    }

    // If street column actually contains combined "ul. Słoneczna 12/5", split it
    let street = cleanStreetDisplay(rawStreet);
    if (!rawHouse && street) {
      const split = splitCombinedAddress(street);
      if (split.rawHouse) {
        street = split.street;
        rawHouse = split.rawHouse;
        if (split.extractedCity && (!city || city === options.defaultCity)) {
          city = split.extractedCity;
        }
      }
    }

    // Rural fallback: if there is no street name, use village/city name
    if (!street && city) {
      street = city;
    }

    const { buildingNumber, unitNumber } = splitHouseAndUnit(
      rawHouse,
      rawUnit,
      options.splitSlashUnits
    );

    if (!street && !buildingNumber) continue;

    intermediateRows.push({
      street,
      buildingNumber,
      unitNumber,
      staircase,
      city: city.trim(),
      residentsCount,
      familiesCount,
      explicitBlockUnits,
      permanentDecline,
      lastYearStatus,
      safeNote,
      lat,
      lng,
    });
  }

  if (intermediateRows.length === 0) {
    return {
      ...emptyResult,
      totalDataRows: Math.max(0, lines.length - startRow),
      ignoredPiiColumns,
    };
  }

  // Decide effective row granularity
  const hasResidentsColumn = residentsIdx >= 0;
  const hasUnitColumn =
    unitIdx >= 0 || intermediateRows.some((r) => r.unitNumber.length > 0);
  const hasPiiPersonCols = ignoredPiiColumns.some((name) =>
    /^(imi|pesel|data|urodz)/i.test(stripPolishDiacritics(name))
  );

  // Check how often exact (street + building + unit) repeats
  const exactUnitKeys = new Map<string, number>();
  for (const r of intermediateRows) {
    const k = `${normalizeStreetCore(r.street)}|${normalizeBuildingNumber(r.buildingNumber)}|${stripPolishDiacritics(r.unitNumber)}`;
    exactUnitKeys.set(k, (exactUnitKeys.get(k) ?? 0) + 1);
  }
  const hasRepeatedExactUnits = Array.from(exactUnitKeys.values()).some(
    (c) => c > 1
  );

  let detectedGranularity: ResolvedGranularity = 'building';
  let detectedReason = '1 wiersz = 1 budynek';

  if (options.granularity !== 'auto') {
    detectedGranularity = options.granularity;
    detectedReason =
      options.granularity === 'person'
        ? 'Ręcznie: 1 wiersz = 1 mieszkaniec (osoba)'
        : options.granularity === 'family'
          ? 'Ręcznie: 1 wiersz = 1 rodzina / lokal'
          : 'Ręcznie: 1 wiersz = 1 budynek';
  } else if (hasResidentsColumn) {
    // Rows specify resident counts -> treat each row as family/unit (or building if no units & single row)
    detectedGranularity = 'family';
    detectedReason =
      'Wykryto kolumnę liczby mieszkańców — sumowanie po budynku i lokalach';
  } else if (hasPiiPersonCols || hasRepeatedExactUnits) {
    detectedGranularity = 'person';
    detectedReason = hasPiiPersonCols
      ? 'Wykryto strukturę listy osób (kolumny osobowe odrzucono) — zliczanie mieszkańców na adres'
      : 'Powtarzające się adresy bez kolumny osób — zliczanie wierszy jako mieszkańców';
  } else if (hasUnitColumn) {
    detectedGranularity = 'family';
    detectedReason = 'Wykryto numery mieszkań — grupowanie lokali pod budynkiem';
  } else {
    detectedGranularity = 'building';
    detectedReason = 'Unikalne adresy budynków';
  }

  // Group into buildings
  const buildingMap = new Map<
    string,
    {
      street: string;
      buildingNumber: string;
      city: string;
      totalResidents: number;
      familiesCount: number;
      explicitBlockUnits?: number;
      unitsMap: Map<string, AggregatedUnitEntry>;
      unnumberedFamilies: Array<{
        residentsCount: number;
        permanentDecline: boolean;
        lastYearStatus?: UnitVisitStatus;
        safeNotes: string[];
      }>;
      buildingNotes: Set<string>;
      declineVotes: number;
      rowVotes: number;
      lastYearStatus?: UnitVisitStatus;
      lat?: number;
      lng?: number;
    }
  >();

  for (const row of intermediateRows) {
    const streetKey = normalizeStreetCore(row.street);
    const numKey = normalizeBuildingNumber(row.buildingNumber);
    const cityKey =
      row.city && row.city.toLowerCase() !== options.defaultCity.toLowerCase()
        ? normalizeStreetCore(row.city)
        : '';
    const bKey = `${streetKey}|${numKey}|${cityKey}`;

    let grp = buildingMap.get(bKey);
    if (!grp) {
      grp = {
        street: row.street,
        buildingNumber: row.buildingNumber,
        city: row.city,
        totalResidents: 0,
        familiesCount: 0,
        explicitBlockUnits: row.explicitBlockUnits,
        unitsMap: new Map(),
        unnumberedFamilies: [],
        buildingNotes: new Set(),
        declineVotes: 0,
        rowVotes: 0,
        lastYearStatus: row.lastYearStatus,
        lat: row.lat,
        lng: row.lng,
      };
      buildingMap.set(bKey, grp);
    }

    if (
      row.explicitBlockUnits &&
      (!grp.explicitBlockUnits || row.explicitBlockUnits > grp.explicitBlockUnits)
    ) {
      grp.explicitBlockUnits = row.explicitBlockUnits;
    }
    if (grp.lat === undefined && row.lat !== undefined) {
      grp.lat = row.lat;
      grp.lng = row.lng;
    }

    const rowResidents =
      row.residentsCount !== undefined
        ? row.residentsCount
        : detectedGranularity === 'person'
          ? 1
          : 1;

    const rowFamilies =
      row.familiesCount !== undefined
        ? row.familiesCount
        : detectedGranularity === 'person'
          ? 0
          : 1;

    grp.totalResidents += rowResidents;
    grp.familiesCount += rowFamilies;
    grp.rowVotes += 1;
    if (row.permanentDecline) grp.declineVotes += 1;
    if (!grp.lastYearStatus && row.lastYearStatus) {
      grp.lastYearStatus = row.lastYearStatus;
    }

    if (row.unitNumber) {
      const unitKey = `${stripPolishDiacritics(row.staircase)}|${stripPolishDiacritics(row.unitNumber)}`;
      let unitEntry = grp.unitsMap.get(unitKey);
      if (!unitEntry) {
        unitEntry = {
          unitNumber: row.unitNumber,
          staircase: row.staircase,
          residentsCount: 0,
          familiesCount: 0,
          permanentDecline: row.permanentDecline,
          lastYearStatus: row.lastYearStatus,
          safeNotes: [],
        };
        grp.unitsMap.set(unitKey, unitEntry);
      }
      unitEntry.residentsCount += rowResidents;
      unitEntry.familiesCount +=
        row.familiesCount !== undefined
          ? row.familiesCount
          : detectedGranularity === 'person'
            ? 0
            : 1;
      if (!row.permanentDecline) {
        unitEntry.permanentDecline = false;
      }
      if (row.safeNote && !unitEntry.safeNotes.includes(row.safeNote)) {
        unitEntry.safeNotes.push(row.safeNote);
      }
    } else {
      grp.unnumberedFamilies.push({
        residentsCount: rowResidents,
        permanentDecline: row.permanentDecline,
        lastYearStatus: row.lastYearStatus,
        safeNotes: row.safeNote ? [row.safeNote] : [],
      });
      if (row.safeNote) {
        grp.buildingNotes.add(row.safeNote);
      }
    }
  }

  const perUnitMin = Math.min(12, Math.max(5, options.defaultVisitMinutes || 10));
  const buildings: AggregatedKartotekaBuilding[] = [];
  let totalResidentsAll = 0;
  let totalFamiliesAll = 0;
  let multiUnitBuildingsCount = 0;

  for (const [key, grp] of buildingMap.entries()) {
    const unitsList = Array.from(grp.unitsMap.values()).sort((a, b) =>
      naturalUnitCompare(a.unitNumber, b.unitNumber)
    );

    // Effective families count
    let effectiveFamilies = grp.familiesCount;
    if (detectedGranularity === 'person') {
      effectiveFamilies = unitsList.length > 0 ? unitsList.length : 1;
    } else if (effectiveFamilies === 0) {
      effectiveFamilies = Math.max(1, unitsList.length);
    }

    const isBlockOrNamedUnits =
      unitsList.length > 0 || (grp.explicitBlockUnits ?? 0) > 1;
    const isMultiFamilyHouse =
      !isBlockOrNamedUnits &&
      options.markMultiFamilyAsMultiUnit &&
      effectiveFamilies > 1;
    const isMultiUnit = isBlockOrNamedUnits || isMultiFamilyHouse;

    const unitsCount = isMultiUnit
      ? Math.max(
          unitsList.length,
          grp.explicitBlockUnits ?? 0,
          isMultiFamilyHouse ? effectiveFamilies : 0
        )
      : 0;

    // Synthetic unit list for multi-family house without explicit unit numbers (e.g. "Rodz. 1", "Rodz. 2")
    let finalUnits = unitsList;
    if (isMultiFamilyHouse && unitsList.length === 0) {
      const hasResData = hasResidentsColumn || detectedGranularity === 'person';
      finalUnits = Array.from({ length: effectiveFamilies }, (_, i) => {
        const fam = grp.unnumberedFamilies[i];
        return {
          unitNumber: `Rodz. ${i + 1}`,
          staircase: '',
          residentsCount: hasResData ? (fam?.residentsCount ?? 0) : 0,
          familiesCount: 1,
          permanentDecline: fam?.permanentDecline ?? false,
          lastYearStatus: fam?.lastYearStatus,
          safeNotes: fam?.safeNotes ?? [],
        };
      });
    }

    const hasExactResidentTotal =
      hasResidentsColumn || detectedGranularity === 'person';

    const noteParts: string[] = [];
    if (isBlockOrNamedUnits) {
      noteParts.push(formatPolishUnits(unitsCount));
    } else if (effectiveFamilies > 1) {
      noteParts.push(formatPolishFamilies(effectiveFamilies));
    }
    if (hasExactResidentTotal && grp.totalResidents > 0) {
      noteParts.push(formatPolishResidents(grp.totalResidents));
    }
    const extraSafeNotes = Array.from(grp.buildingNotes).slice(0, 3);
    const statLabel =
      noteParts.length > 0 ? `Kartoteka: ${noteParts.join(' · ')}` : '';
    const summaryNote = [statLabel, ...extraSafeNotes].filter(Boolean).join(' — ');

    const recommendedDurationMinutes = isMultiUnit
      ? Math.min(
          1440,
          Math.max(
            options.defaultVisitMinutes,
            Math.max(1, unitsList.length || unitsCount) * perUnitMin
          )
        )
      : effectiveFamilies > 1
        ? Math.min(180, options.defaultVisitMinutes * effectiveFamilies)
        : options.defaultVisitMinutes;

    const allRowsDecline =
      grp.rowVotes > 0 && grp.declineVotes === grp.rowVotes;

    totalResidentsAll += hasExactResidentTotal ? grp.totalResidents : 0;
    totalFamiliesAll += effectiveFamilies;
    if (isMultiUnit) multiUnitBuildingsCount += 1;

    buildings.push({
      key,
      street: grp.street,
      buildingNumber: grp.buildingNumber,
      city: grp.city,
      totalResidents: hasExactResidentTotal ? grp.totalResidents : 0,
      familiesCount: effectiveFamilies,
      explicitBlockUnits: grp.explicitBlockUnits,
      units: finalUnits,
      isMultiUnit,
      unitsCount,
      minutesPerUnit: perUnitMin,
      recommendedDurationMinutes,
      summaryNote,
      permanentDecline: allRowsDecline,
      lastYearStatus: grp.lastYearStatus,
      lat: grp.lat,
      lng: grp.lng,
    });
  }

  return {
    totalDataRows: Math.max(0, lines.length - startRow),
    validRows: intermediateRows.length,
    ignoredPiiColumns,
    detectedGranularity,
    detectedReason,
    hasResidentsColumn,
    hasUnitColumn,
    buildings,
    totalResidents: totalResidentsAll,
    totalFamilies: totalFamiliesAll,
    multiUnitBuildingsCount,
  };
}

function extractHouseNumFromStop(stop: VisitStop): string {
  const src = (stop.label || stop.address.split(',')[0] || '').trim();
  const match = src.match(/(\d+\s*[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?)\s*$/);
  if (match) return normalizeBuildingNumber(match[1]);
  return '';
}

export function matchKartotekaToExistingStops(
  buildings: AggregatedKartotekaBuilding[],
  existingStops: VisitStop[]
): KartotekaMapMatchResult {
  const stopIndexEntries = existingStops.map((stop) => ({
    stop,
    street: extractStreetName(stop),
    streetCore: normalizeStreetCore(extractStreetName(stop)),
    houseCore: extractHouseNumFromStop(stop),
  }));

  // Quick bucket by exact streetCore + houseCore
  const exactBucket = new Map<string, VisitStop>();
  for (const entry of stopIndexEntries) {
    if (entry.streetCore && entry.houseCore) {
      const k = `${entry.streetCore}|${entry.houseCore}`;
      if (!exactBucket.has(k)) exactBucket.set(k, entry.stop);
    }
  }

  const matched: Array<{ building: AggregatedKartotekaBuilding; stop: VisitStop }> =
    [];
  const unmatched: AggregatedKartotekaBuilding[] = [];
  const matchedStopIds = new Set<string>();

  for (const building of buildings) {
    const bStreetCore = normalizeStreetCore(building.street);
    const bHouseCore = normalizeBuildingNumber(building.buildingNumber);

    let hit: VisitStop | undefined;
    if (bStreetCore && bHouseCore) {
      hit = exactBucket.get(`${bStreetCore}|${bHouseCore}`);
    }

    if (!hit && bHouseCore) {
      const fuzzy = stopIndexEntries.find(
        (e) =>
          !matchedStopIds.has(e.stop.id) &&
          e.houseCore === bHouseCore &&
          streetCoresMatch(e.street, building.street)
      );
      if (fuzzy) hit = fuzzy.stop;
    }

    if (hit) {
      matched.push({ building, stop: hit });
      matchedStopIds.add(hit.id);
    } else {
      unmatched.push(building);
    }
  }

  return {
    matched,
    unmatched,
    mapOnlyStopsCount: Math.max(0, existingStops.length - matchedStopIds.size),
  };
}

export function buildUnitsForBuilding(
  building: AggregatedKartotekaBuilding,
  existingUnits: BuildingUnit[] = []
): BuildingUnit[] {
  if (building.units.length === 0) return existingUnits;

  const existingByNumber = new Map<string, BuildingUnit>();
  for (const eu of existingUnits) {
    existingByNumber.set(stripPolishDiacritics(eu.unitNumber.trim()), eu);
  }

  const result: BuildingUnit[] = [];
  const usedKeys = new Set<string>();

  building.units.forEach((u, idx) => {
    const key = stripPolishDiacritics(u.unitNumber.trim());
    usedKeys.add(key);
    const prev = existingByNumber.get(key);

    const resNote =
      u.residentsCount > 0 ? formatPolishResidents(u.residentsCount) : '';
    const extraNote = u.safeNotes.join('; ');
    const declineTag = u.permanentDecline ? 'Stała odmowa (kartoteka)' : '';
    const computedNote = [resNote, declineTag, extraNote]
      .filter(Boolean)
      .join(' · ');

    if (prev) {
      const prevCustomNote = (prev.notes || '')
        .replace(/^\d+\s+mieszkańc[ówy]+(?:\s*·\s*)?/i, '')
        .trim();
      const mergedNotes = [resNote, prevCustomNote || extraNote]
        .filter(Boolean)
        .join(' · ');
      result.push({
        ...prev,
        staircase: prev.staircase || u.staircase,
        familyName: '', // Strict RODO sanitization
        notes: mergedNotes,
        lastYearStatus: prev.lastYearStatus ?? u.lastYearStatus,
      });
    } else {
      result.push({
        id: `k_${Date.now()}_${idx}_${u.unitNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        unitNumber: u.unitNumber,
        staircase: u.staircase,
        familyName: '', // Zero personal surnames
        notes: computedNote,
        status: 'pending',
        ...(u.lastYearStatus ? { lastYearStatus: u.lastYearStatus } : {}),
      });
    }
  });

  // Preserve any extra manually added units that were not in CSV
  for (const eu of existingUnits) {
    const key = stripPolishDiacritics(eu.unitNumber.trim());
    if (!usedKeys.has(key)) {
      result.push(eu);
    }
  }

  return result.slice(0, 200);
}

export function buildEnrichedStopPatch(
  stop: VisitStop,
  building: AggregatedKartotekaBuilding
): Partial<VisitStop> {
  const existingNoteClean = (stop.notes || '')
    .replace(/Kartoteka:\s*[^|—]+(?:\s*[|—]\s*)?/gi, '')
    .trim();

  const mergedNotes = [building.summaryNote, existingNoteClean]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 500);

  const mergedUnits = building.isMultiUnit
    ? buildUnitsForBuilding(building, stop.units ?? [])
    : stop.units ?? [];

  const nextUnitsCount = building.isMultiUnit
    ? Math.max(
        building.unitsCount,
        mergedUnits.length,
        stop.unitsCount ?? 0
      )
    : stop.unitsCount ?? 0;

  const patch: Partial<VisitStop> = {
    notes: mergedNotes,
    isMultiUnit: Boolean(stop.isMultiUnit || building.isMultiUnit),
    unitsCount: nextUnitsCount,
    minutesPerUnit: stop.minutesPerUnit ?? building.minutesPerUnit,
    units: mergedUnits,
    durationMinutes: building.isMultiUnit
      ? Math.max(stop.durationMinutes, building.recommendedDurationMinutes)
      : Math.max(stop.durationMinutes, building.recommendedDurationMinutes),
  };

  if (building.permanentDecline) {
    patch.permanentDecline = true;
    patch.lastYearStatus = building.lastYearStatus ?? 'declined';
  } else if (building.lastYearStatus && !stop.lastYearStatus) {
    patch.lastYearStatus = building.lastYearStatus;
  }

  return patch;
}

export function buildingToSelectedPlace(
  building: AggregatedKartotekaBuilding,
  coords: { lat: number; lng: number },
  placeId: string,
  resolvedCityAddress?: string
): SelectedPlaceData {
  const baseLabel = [building.street, building.buildingNumber]
    .filter(Boolean)
    .join(' ')
    .trim();
  const fullAddress = building.city
    ? `${baseLabel}, ${building.city}`
    : resolvedCityAddress || baseLabel;

  const units = building.isMultiUnit
    ? buildUnitsForBuilding(building, [])
    : undefined;

  return {
    name: baseLabel,
    address: fullAddress,
    location: coords,
    placeId,
    isMultiUnit: building.isMultiUnit,
    unitsCount: building.isMultiUnit ? building.unitsCount : undefined,
    minutesPerUnit: building.isMultiUnit ? building.minutesPerUnit : undefined,
    durationMinutes: building.recommendedDurationMinutes,
    units,
    notes: building.summaryNote || undefined,
    ...(building.permanentDecline
      ? {
          permanentDecline: true,
          lastYearStatus: building.lastYearStatus ?? 'declined',
        }
      : building.lastYearStatus
        ? { lastYearStatus: building.lastYearStatus }
        : {}),
  };
}
