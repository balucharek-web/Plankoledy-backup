import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { searchPlacesNominatim } from '../services/osmSearchAndRouting';
import { ParishCenter, VisitStop } from '../types/parish';
import { SelectedPlaceData } from './PlaceSearchInput';

interface CsvImportModalProps {
  open: boolean;
  parish: ParishCenter | null;
  existingStops: VisitStop[];
  onClose: () => void;
  onImportPlaces: (places: SelectedPlaceData[]) => void;
}

interface ParsedCsvRow {
  rowIndex: number;
  street: string;
  houseNumber: string;
  city: string;
  notes: string;
  isBlock: boolean;
  unitsCount?: number;
  lat?: number;
  lng?: number;
  rawLine: string;
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 5).join('\n');
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

function normalizeHeaderToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/[źż]/g, 'z')
    .replace(/[^a-z0-9]/g, '');
}

function extractCityFromParishAddress(address?: string): string {
  if (!address) return '';
  const parts = address.split(',').map((p) => p.trim());
  const cityPart = parts[parts.length - 1] || parts[1] || '';
  return cityPart.replace(/\b\d{2}-\d{3}\b/g, '').trim();
}

function parseBooleanishBlock(val: string): { isBlock: boolean; units?: number } {
  const v = val.trim().toLowerCase();
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

function parseCsvText(rawText: string, defaultCity: string): ParsedCsvRow[] {
  const lines = rawText
    .replace(/^\ufeff/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines);
  const firstCols = splitCsvLine(lines[0], delimiter).map(normalizeHeaderToken);

  const findCol = (aliases: string[]): number =>
    firstCols.findIndex((c) => aliases.some((a) => c === a || c.includes(a)));

  const streetIdx = findCol(['ulica', 'street', 'adres', 'address', 'droga']);
  const numberIdx = findCol(['numer', 'nrdomu', 'nr', 'housenumber', 'dom']);
  const cityIdx = findCol(['miasto', 'miejscowosc', 'city', 'town']);
  const notesIdx = findCol(['uwagi', 'rodzina', 'notes', 'notatka', 'nazwisko', 'opis']);
  const blockIdx = findCol(['blok', 'block', 'lokale', 'mieszkania', 'multiunit']);
  const latIdx = findCol(['lat', 'szerokosc']);
  const lngIdx = findCol(['lng', 'lon', 'dlugosc']);

  const hasHeader =
    streetIdx >= 0 ||
    numberIdx >= 0 ||
    cityIdx >= 0 ||
    notesIdx >= 0 ||
    blockIdx >= 0;

  const startRow = hasHeader ? 1 : 0;
  const rows: ParsedCsvRow[] = [];

  for (let r = startRow; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r], delimiter);
    if (cols.every((c) => !c)) continue;

    let street = '';
    let houseNumber = '';
    let city = defaultCity;
    let notes = '';
    let isBlock = false;
    let unitsCount: number | undefined;
    let lat: number | undefined;
    let lng: number | undefined;

    if (hasHeader) {
      street = streetIdx >= 0 ? cols[streetIdx] ?? '' : cols[0] ?? '';
      houseNumber = numberIdx >= 0 ? cols[numberIdx] ?? '' : '';
      const rowCity = cityIdx >= 0 ? (cols[cityIdx] ?? '').trim() : '';
      if (rowCity) city = rowCity;
      notes = notesIdx >= 0 ? cols[notesIdx] ?? '' : '';
      if (blockIdx >= 0) {
        const b = parseBooleanishBlock(cols[blockIdx] ?? '');
        isBlock = b.isBlock;
        unitsCount = b.units;
      }
      if (latIdx >= 0 && lngIdx >= 0) {
        const parsedLat = Number.parseFloat((cols[latIdx] ?? '').replace(',', '.'));
        const parsedLng = Number.parseFloat((cols[lngIdx] ?? '').replace(',', '.'));
        if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
          lat = parsedLat;
          lng = parsedLng;
        }
      }
    } else if (cols.length === 1) {
      street = cols[0];
    } else {
      street = cols[0] ?? '';
      houseNumber = cols[1] ?? '';
      if (cols[2]) city = cols[2];
      if (cols[3]) notes = cols[3];
      if (cols[4]) {
        const b = parseBooleanishBlock(cols[4]);
        isBlock = b.isBlock;
        unitsCount = b.units;
      }
    }

    street = street.trim();
    houseNumber = houseNumber.trim();
    if (!street && !houseNumber) continue;

    rows.push({
      rowIndex: r + 1,
      street,
      houseNumber,
      city: city.trim(),
      notes: notes.trim(),
      isBlock,
      unitsCount,
      lat,
      lng,
      rawLine: lines[r],
    });
  }

  return rows;
}

function normalizeAddrKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b(ul\.?|ulica|al\.?|aleja)\b/g, ' ')
    .replace(/[,.;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({
  open,
  parish,
  existingStops,
  onClose,
  onImportPlaces,
}) => {
  const [rawText, setRawText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<{
    added: number;
    duplicates: number;
    failedLines: string[];
  } | null>(null);
  const cancelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const defaultCity = useMemo(
    () => extractCityFromParishAddress(parish?.address),
    [parish?.address]
  );

  const parsedRows = useMemo(
    () => parseCsvText(rawText, defaultCity),
    [rawText, defaultCity]
  );

  useEffect(() => {
    if (!open) return;
    setSummary(null);
    setProgress({ done: 0, total: 0 });
    cancelRef.current = false;
  }, [open]);

  if (!open) return null;

  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    let decoded = '';
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      try {
        decoded = new TextDecoder('windows-1250').decode(buffer);
      } catch {
        decoded = new TextDecoder('utf-8').decode(buffer);
      }
    }
    setRawText(decoded);
    setSummary(null);
    e.target.value = '';
  };

  const handleDownloadTemplate = () => {
    const city = defaultCity || 'Mikołów';
    const sample = [
      'ulica;numer;miejscowosc;uwagi;blok',
      `Skalna;1;${city};Rodzina Kowalskich;nie`,
      `Skalna;3A;${city};po godz. 17:00;nie`,
      `Zielona;12;${city};Klatka A i B;24`,
    ].join('\r\n');
    const blob = new Blob([`\uFEFF${sample}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'szablon-adresy-koleda.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRunImport = async () => {
    if (!parish || parsedRows.length === 0 || isImporting) return;
    cancelRef.current = false;
    setIsImporting(true);
    setSummary(null);

    const existingKeys = new Set(
      existingStops.flatMap((s) => [
        normalizeAddrKey(s.address),
        normalizeAddrKey(s.label),
      ])
    );

    const rowsToProcess = parsedRows.slice(0, 250);
    setProgress({ done: 0, total: rowsToProcess.length });

    const resolvedPlaces: SelectedPlaceData[] = [];
    const failedLines: string[] = [];
    let duplicates = 0;

    for (let i = 0; i < rowsToProcess.length; i++) {
      if (cancelRef.current) break;
      const row = rowsToProcess[i];
      const baseLabel = [row.street, row.houseNumber]
        .filter(Boolean)
        .join(' ')
        .trim();
      const normalizedKey = normalizeAddrKey(baseLabel);
      const normalizedWithCity = normalizeAddrKey(
        [baseLabel, row.city].filter(Boolean).join(' ')
      );

      if (
        existingKeys.has(normalizedKey) ||
        existingKeys.has(normalizedWithCity)
      ) {
        duplicates += 1;
        setProgress({ done: i + 1, total: rowsToProcess.length });
        continue;
      }

      if (typeof row.lat === 'number' && typeof row.lng === 'number') {
        existingKeys.add(normalizedKey);
        resolvedPlaces.push({
          name: baseLabel,
          address: row.city ? `${baseLabel}, ${row.city}` : baseLabel,
          location: { lat: row.lat, lng: row.lng },
          placeId: `csv_${Date.now()}_${i}`,
          isMultiUnit: row.isBlock,
          unitsCount: row.unitsCount,
          notes: row.notes || undefined,
        });
        setProgress({ done: i + 1, total: rowsToProcess.length });
        continue;
      }

      const queryStr = [baseLabel, row.city].filter(Boolean).join(', ');
      let hits = await searchPlacesNominatim(queryStr, parish.location, 3);
      if (hits.length === 0 && row.city) {
        hits = await searchPlacesNominatim(baseLabel, parish.location, 3);
      }

      const best = hits[0];
      if (best) {
        existingKeys.add(normalizedKey);
        resolvedPlaces.push({
          name: baseLabel || best.name,
          address: row.city ? `${baseLabel}, ${row.city}` : best.address,
          location: best.location,
          placeId: best.placeId,
          isMultiUnit: row.isBlock,
          unitsCount: row.unitsCount,
          notes: row.notes || undefined,
        });
      } else {
        failedLines.push(baseLabel || row.rawLine);
      }

      setProgress({ done: i + 1, total: rowsToProcess.length });

      if (i + 1 < rowsToProcess.length && !cancelRef.current) {
        await new Promise((r) => window.setTimeout(r, 260));
      }
    }

    if (resolvedPlaces.length > 0) {
      onImportPlaces(resolvedPlaces);
    }

    setSummary({
      added: resolvedPlaces.length,
      duplicates,
      failedLines,
    });
    setIsImporting(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-import-title"
      className="fixed inset-0 z-[1250] bg-slate-950/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3.5 sm:px-6 sm:py-4 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 uppercase tracking-wide">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Import z Excela / CSV (kartoteka parafialna)
            </div>
            <h2
              id="csv-import-title"
              className="text-sm sm:text-base font-bold text-slate-900 mt-0.5"
            >
              Wgraj listę adresów parafian
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              cancelRef.current = true;
              onClose();
            }}
            aria-label="Zamknij"
            className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/50">
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  onChange={(e) => void handleFileSelected(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-50 rounded-xl inline-flex items-center gap-1.5 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Wybierz plik .CSV / .TXT</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="min-h-[40px] px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-slate-600" />
                  <span>Pobierz wzór CSV</span>
                </button>
              </div>
              {parsedRows.length > 0 && (
                <span className="text-xs font-semibold text-emerald-800 tabular-nums">
                  Rozpoznano {parsedRows.length}{' '}
                  {parsedRows.length === 1 ? 'adres' : 'adresów'}
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Możesz też wkleić adresy bezpośrednio poniżej (jeden wiersz =
              jeden budynek, np. <code className="text-slate-700">Skalna;12;po 18:00</code>{' '}
              lub samo <code className="text-slate-700">Skalna 12</code>). Obsługiwane są pliki z
              Excela (UTF-8 oraz Windows-1250).
            </p>

            <textarea
              rows={6}
              disabled={isImporting}
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                setSummary(null);
              }}
              placeholder={
                'ulica;numer;miejscowosc;uwagi;blok\nSkalna;1;Mikołów;Rodzina Nowak;nie\nZielona;10;Mikołów;Kl. A-B;24'
              }
              className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-amber-600"
            />
          </div>

          {parsedRows.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800">
                  Podgląd pierwszych {Math.min(6, parsedRows.length)} z{' '}
                  {parsedRows.length} pozycji
                </span>
                {parsedRows.length > 250 && (
                  <span className="text-amber-800 font-medium">
                    Import jednorazowy do 250 pozycji
                  </span>
                )}
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {parsedRows.slice(0, 6).map((row) => (
                  <div
                    key={row.rowIndex}
                    className="px-4 py-2 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-900">
                        {[row.street, row.houseNumber].filter(Boolean).join(' ')}
                      </span>
                      {row.city && (
                        <span className="text-slate-500"> · {row.city}</span>
                      )}
                      {row.notes && (
                        <span className="text-slate-600"> — {row.notes}</span>
                      )}
                    </div>
                    {row.isBlock && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-semibold shrink-0">
                        Blok ({row.unitsCount ?? 15})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isImporting && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-amber-950 tabular-nums">
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
                  Dopasowywanie współrzędnych na mapie...
                </span>
                <span>
                  {progress.done} / {progress.total}
                </span>
              </div>
              <div className="w-full h-2 bg-amber-200/70 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-700 transition-all duration-200"
                  style={{
                    width: `${
                      progress.total > 0
                        ? Math.round((progress.done / progress.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {summary && (
            <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-emerald-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  Zakończono import: dodano {summary.added}{' '}
                  {summary.added === 1 ? 'adres' : 'adresów'}
                  {summary.duplicates > 0
                    ? ` · pominięto ${summary.duplicates} istniejących`
                    : ''}
                </span>
              </div>
              {summary.failedLines.length > 0 && (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
                  <div className="font-semibold inline-flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Nie odnaleziono na mapie ({summary.failedLines.length}):
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    {summary.failedLines.slice(0, 8).join('; ')}
                    {summary.failedLines.length > 8
                      ? ` (+${summary.failedLines.length - 8} więcej)`
                      : ''}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-slate-200 bg-white flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              cancelRef.current = true;
              onClose();
            }}
            className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            {summary && !isImporting ? 'Zamknij' : 'Anuluj'}
          </button>
          <button
            type="button"
            disabled={!parish || parsedRows.length === 0 || isImporting}
            onClick={() => void handleRunImport()}
            className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl inline-flex items-center gap-1.5"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Importowanie...</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>
                  Importuj do bazy ({Math.min(250, parsedRows.length)})
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
