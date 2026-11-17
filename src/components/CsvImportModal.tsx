import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { searchPlacesNominatim } from '../services/osmSearchAndRouting';
import { LatLng, ParishCenter, VisitStop } from '../types/parish';
import {
  KartotekaRowGranularity,
  buildEnrichedStopPatch,
  buildingToSelectedPlace,
  matchKartotekaToExistingStops,
  parseAndAggregateKartotekaCsv,
} from '../utils/kartotekaImport';
import { SelectedPlaceData } from './PlaceSearchInput';

interface CsvImportModalProps {
  open: boolean;
  parish: ParishCenter | null;
  existingStops: VisitStop[];
  defaultVisitMinutes?: number;
  onClose: () => void;
  onImportPlaces: (places: SelectedPlaceData[]) => void;
  onEnrichExistingStops?: (
    patches: Array<{ id: string; patch: Partial<VisitStop> }>
  ) => void;
}

function extractCityFromParishAddress(address?: string): string {
  if (!address) return '';
  const parts = address.split(',').map((p) => p.trim());
  const cityPart = parts[parts.length - 1] || parts[1] || '';
  return cityPart.replace(/\b\d{2}-\d{3}\b/g, '').trim();
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

export const CsvImportModal: React.FC<CsvImportModalProps> = ({
  open,
  parish,
  existingStops,
  defaultVisitMinutes = 15,
  onClose,
  onImportPlaces,
  onEnrichExistingStops,
}) => {
  const [rawText, setRawText] = useState('');
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    content: string;
    lineCount: number;
  } | null>(null);
  const [granularity, setGranularity] =
    useState<KartotekaRowGranularity>('auto');
  const [splitSlashUnits, setSplitSlashUnits] = useState(true);
  const [markMultiFamilyAsMultiUnit, setMarkMultiFamilyAsMultiUnit] =
    useState(true);
  const [privacyStripNotes, setPrivacyStripNotes] = useState(true);
  const [alsoGeocodeMissing, setAlsoGeocodeMissing] = useState(true);

  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<{
    enriched: number;
    added: number;
    mapOnlyCount: number;
    failedLines: string[];
  } | null>(null);
  const cancelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const defaultCity = useMemo(
    () => extractCityFromParishAddress(parish?.address),
    [parish?.address]
  );

  const activeSourceText = uploadedFile ? uploadedFile.content : rawText;

  const parsed = useMemo(
    () =>
      parseAndAggregateKartotekaCsv(activeSourceText, {
        defaultCity,
        granularity,
        splitSlashUnits,
        privacyStripNotes,
        markMultiFamilyAsMultiUnit,
        defaultVisitMinutes,
      }),
    [
      activeSourceText,
      defaultCity,
      granularity,
      splitSlashUnits,
      privacyStripNotes,
      markMultiFamilyAsMultiUnit,
      defaultVisitMinutes,
    ]
  );

  const mapMatch = useMemo(
    () => matchKartotekaToExistingStops(parsed.buildings, existingStops),
    [parsed.buildings, existingStops]
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
    const lineCount = decoded
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0).length;
    setUploadedFile({ name: file.name, content: decoded, lineCount });
    setRawText('');
    setSummary(null);
    e.target.value = '';
  };

  const handleDownloadTemplate = () => {
    const city = defaultCity || 'Mikołów';
    const sample = [
      'ulica;nr_domu;nr_lokalu;miejscowosc;liczba_osob',
      `Skalna;1;;${city};4`,
      `Skalna;3A;;${city};3`,
      `Skalna;3A;;${city};2`,
      `Zielona;12;1;${city};2`,
      `Zielona;12;2;${city};5`,
      `Zielona;12;4;${city};1`,
    ].join('\r\n');
    const blob = new Blob([`\uFEFF${sample}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'szablon-kartoteka-fara-bez-nazwisk.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRunImport = async () => {
    if (!parish || parsed.buildings.length === 0 || isImporting) return;
    cancelRef.current = false;
    setIsImporting(true);
    setSummary(null);

    let enrichedCount = 0;

    // 1. Instant local enrichment of buildings already present on map (no 250 limit, no geocoding delay)
    if (mapMatch.matched.length > 0 && onEnrichExistingStops) {
      const patches = mapMatch.matched.map(({ building, stop }) => ({
        id: stop.id,
        patch: buildEnrichedStopPatch(stop, building),
      }));
      onEnrichExistingStops(patches);
      enrichedCount = patches.length;
    }

    // 2. Geocode & add missing buildings (if enabled)
    const missingToProcess = alsoGeocodeMissing
      ? mapMatch.unmatched.slice(0, 350)
      : [];
    setProgress({ done: 0, total: missingToProcess.length });

    const resolvedPlaces: SelectedPlaceData[] = [];
    const failedLines: string[] = [];

    for (let i = 0; i < missingToProcess.length; i++) {
      if (cancelRef.current) break;
      const b = missingToProcess[i];
      const baseLabel = [b.street, b.buildingNumber].filter(Boolean).join(' ').trim();

      if (typeof b.lat === 'number' && typeof b.lng === 'number') {
        resolvedPlaces.push(
          buildingToSelectedPlace(b, { lat: b.lat, lng: b.lng }, `csv_${Date.now()}_${i}`)
        );
        setProgress({ done: i + 1, total: missingToProcess.length });
        continue;
      }

      const queryStr = [baseLabel, b.city].filter(Boolean).join(', ');
      let hits = await searchPlacesNominatim(queryStr, parish.location, 3);
      if (hits.length === 0 && b.city) {
        hits = await searchPlacesNominatim(baseLabel, parish.location, 3);
      }

      // Guard against geocoder returning an identically-named street in a distant city
      const nearbyHit = hits.find(
        (h) => haversineMeters(parish.location, h.location) <= 25000
      );
      if (nearbyHit) {
        resolvedPlaces.push(
          buildingToSelectedPlace(
            b,
            nearbyHit.location,
            nearbyHit.placeId,
            nearbyHit.address
          )
        );
      } else {
        failedLines.push(baseLabel || `${b.street} ${b.buildingNumber}`);
      }

      setProgress({ done: i + 1, total: missingToProcess.length });

      if (i + 1 < missingToProcess.length && !cancelRef.current) {
        await new Promise((r) => window.setTimeout(r, 240));
      }
    }

    if (resolvedPlaces.length > 0) {
      onImportPlaces(resolvedPlaces);
    }

    setSummary({
      enriched: enrichedCount,
      added: resolvedPlaces.length,
      mapOnlyCount: mapMatch.mapOnlyStopsCount,
      failedLines,
    });
    setIsImporting(false);
  };

  const matchedKeySet = new Set(mapMatch.matched.map((m) => m.building.key));
  const totalActionsCount =
    (onEnrichExistingStops ? mapMatch.matched.length : 0) +
    (alsoGeocodeMissing ? Math.min(350, mapMatch.unmatched.length) : 0);

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
              Kartoteka (FARA / Excel / CSV) — tryb bez nazwisk
            </div>
            <h2
              id="csv-import-title"
              className="text-sm sm:text-base font-bold text-slate-900 mt-0.5"
            >
              Nanieś adresy, mieszkania i liczbę mieszkańców
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
          {/* RODO Privacy Guarantee Banner */}
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-2.5 text-xs text-emerald-950">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div className="space-y-0.5 leading-relaxed">
              <div className="font-semibold">
                Ochrona danych osobowych (RODO) działa lokalnie przed wysłaniem
              </div>
              <p className="text-[11px] text-emerald-900">
                Możesz wgrać eksport prosto z programu <strong>FARA</strong> lub Excela. Kolumny z
                nazwiskami, imionami, PESEL-em czy telefonem są odrzucane w przeglądarce — na mapę
                trafiają tylko adresy, lokale w blokach oraz liczba mieszkańców.
              </p>
              {parsed.ignoredPiiColumns.length > 0 && (
                <div className="pt-1 text-[11px] font-semibold text-emerald-800">
                  Automatycznie pominięto kolumny osobowe:{' '}
                  {parsed.ignoredPiiColumns.join(', ')}
                </div>
              )}
            </div>
          </div>

          {/* File Upload & Paste Box */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/plain,application/vnd.ms-excel,text/comma-separated-values"
                  onChange={(e) => void handleFileSelected(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[42px] px-3.5 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-50 rounded-xl inline-flex items-center gap-1.5 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Wybierz plik .CSV / .TXT</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="min-h-[42px] px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-slate-600" />
                  <span>Wzór z FARY (CSV)</span>
                </button>
              </div>
              {parsed.buildings.length > 0 && (
                <span className="text-xs font-semibold text-emerald-800 tabular-nums">
                  {parsed.validRows} wierszy → {parsed.buildings.length}{' '}
                  {parsed.buildings.length === 1 ? 'budynek' : 'budynków'}
                </span>
              )}
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Obsługiwane formaty z FARY i Excela (UTF-8 / Windows-1250): osobne kolumny (
              <code className="text-slate-700">Ulica;Nr domu;Nr lokalu;Liczba osób</code>) lub jeden
              adres (np. <code className="text-slate-700">Słoneczna 12/5</code>,{' '}
              <code className="text-slate-700">Słoneczna 12 m. 5</code>).
            </p>

            {uploadedFile ? (
              <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {uploadedFile.name}
                  </div>
                  <div className="text-[11px] text-slate-600 tabular-nums">
                    Wczytano plik lokalnie ({uploadedFile.lineCount} wierszy)
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => {
                    setUploadedFile(null);
                    setSummary(null);
                  }}
                  className="min-h-[36px] px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg shrink-0"
                >
                  Usuń plik
                </button>
              </div>
            ) : (
              <textarea
                rows={4}
                disabled={isImporting}
                value={rawText}
                onChange={(e) => {
                  setUploadedFile(null);
                  setRawText(e.target.value);
                  setSummary(null);
                }}
                placeholder={
                  'ulica;nr_domu;nr_lokalu;miejscowosc;liczba_osob\nSkalna;1;;Mikołów;4\nSkalna;3A;;Mikołów;3\nZielona;12;1;Mikołów;2'
                }
                className="w-full p-3 text-base sm:text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-amber-600"
              />
            )}
          </div>

          {/* FARA Grouping & Privacy Options */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <label
                htmlFor="fara-granularity"
                className="text-xs font-semibold text-slate-800"
              >
                Co oznacza 1 wiersz w Twoim pliku z FARY?
              </label>
              <select
                id="fara-granularity"
                disabled={isImporting}
                value={granularity}
                onChange={(e) =>
                  setGranularity(e.target.value as KartotekaRowGranularity)
                }
                className="w-full sm:w-auto min-h-[40px] sm:min-h-[36px] px-2.5 py-1.5 text-base sm:text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-amber-600"
              >
                <option value="auto">Auto (rozpoznaj z nagłówków)</option>
                <option value="person">Osobę / mieszkańca (sumuj na adres)</option>
                <option value="family">Rodzinę / mieszkanie</option>
                <option value="building">Gotowy budynek (1 wiersz = 1 dom)</option>
              </select>
            </div>

            {parsed.validRows > 0 && (
              <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>{parsed.detectedReason}</span>
              </div>
            )}

            <div className="space-y-1.5 pt-0.5 text-xs text-slate-700">
              <label className="flex items-start gap-2.5 py-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={splitSlashUnits}
                  disabled={isImporting}
                  onChange={(e) => setSplitSlashUnits(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600 shrink-0"
                />
                <span>
                  Rozdzielaj zapis <code className="text-slate-900">12/5</code> i{' '}
                  <code className="text-slate-900">12 m. 5</code> na budynek + numer mieszkania (dla bloków i kamienic)
                </span>
              </label>

              <label className="flex items-start gap-2.5 py-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={markMultiFamilyAsMultiUnit}
                  disabled={isImporting}
                  onChange={(e) =>
                    setMarkMultiFamilyAsMultiUnit(e.target.checked)
                  }
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600 shrink-0"
                />
                <span>
                  Wiele rodzin pod jednym numerem (dom wielorodzinny bez numerów lokali) oznacz jako obiekt wielorodzinny
                </span>
              </label>

              <label className="flex items-start gap-2.5 py-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={privacyStripNotes}
                  disabled={isImporting}
                  onChange={(e) => setPrivacyStripNotes(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600 shrink-0"
                />
                <span>
                  Tylko statystyka mieszkańców i mieszkań (ignoruj kolumnę „Uwagi”, na wypadek gdyby zawierała nazwiska)
                </span>
              </label>

              {mapMatch.unmatched.length > 0 && (
                <label className="flex items-start gap-2.5 py-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={alsoGeocodeMissing}
                    disabled={isImporting}
                    onChange={(e) => setAlsoGeocodeMissing(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600 shrink-0"
                  />
                  <span>
                    Dograj na mapę także brakujące budynki spoza aktualnej mapy ({mapMatch.unmatched.length})
                  </span>
                </label>
              )}
            </div>
          </div>

          {/* Live Map Match & Aggregated Building Preview */}
          {parsed.buildings.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-900">
                    Podsumowanie przed wgraniem ({parsed.buildings.length} budynków)
                  </span>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] tabular-nums">
                    {parsed.totalResidents > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200/70 text-slate-800 font-semibold">
                        <Users className="w-3 h-3" />
                        {parsed.totalResidents} mieszk.
                      </span>
                    )}
                    {parsed.multiUnitBuildingsCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-semibold">
                        <Building2 className="w-3 h-3" />
                        {parsed.multiUnitBuildingsCount} bloków / wielorodz.
                      </span>
                    )}
                  </div>
                </div>

                {existingStops.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] tabular-nums">
                    <div className="px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900">
                      <span className="font-bold">{mapMatch.matched.length}</span> dopasowano do mapy (natychmiastowo)
                    </div>
                    <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
                      <span className="font-bold">{mapMatch.unmatched.length}</span> nowych budynków do odnalezienia
                    </div>
                    <div className="px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-700">
                      <span className="font-bold">{mapMatch.mapOnlyStopsCount}</span> domów na mapie spoza pliku
                    </div>
                  </div>
                )}
              </div>

              <div className="divide-y divide-slate-100 text-xs">
                {parsed.buildings.slice(0, 8).map((b) => {
                  const isMatched = matchedKeySet.has(b.key);
                  return (
                    <div
                      key={b.key}
                      className="px-4 py-2 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-slate-900">
                            {[b.street, b.buildingNumber].filter(Boolean).join(' ')}
                          </span>
                          {b.city && (
                            <span className="text-slate-500">· {b.city}</span>
                          )}
                          {isMatched ? (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                              Na mapie ✓
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium">
                              Nowy pin
                            </span>
                          )}
                        </div>
                        {b.summaryNote && (
                          <div className="text-[11px] text-slate-600 truncate">
                            {b.summaryNote}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {b.totalResidents > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] font-semibold tabular-nums">
                            {b.totalResidents} os.
                          </span>
                        )}
                        {b.isMultiUnit && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-semibold tabular-nums">
                            {b.units.length > 0
                              ? `${b.units.length} lok.`
                              : `Wielorodz. (${b.unitsCount})`}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {parsed.buildings.length > 8 && (
                  <div className="px-4 py-2 text-[11px] text-slate-500 text-center">
                    …oraz {parsed.buildings.length - 8} kolejnych budynków
                  </div>
                )}
              </div>
            </div>
          )}

          {isImporting && progress.total > 0 && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-amber-950 tabular-nums">
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
                  Wyszukiwanie nowych budynków na mapie...
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
              <div className="flex items-start gap-2 font-semibold text-emerald-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div>
                    Zapisano dane z kartoteki (bez nazwisk):
                  </div>
                  <div className="text-[11px] font-medium text-slate-700 space-y-0.5">
                    {summary.enriched > 0 && (
                      <div>
                        • Zaktualizowano domy już stojące na mapie:{' '}
                        <strong>{summary.enriched}</strong>
                      </div>
                    )}
                    {summary.added > 0 && (
                      <div>
                        • Dodano nowe budynki na mapę:{' '}
                        <strong>{summary.added}</strong>
                      </div>
                    )}
                    {summary.mapOnlyCount > 0 && (
                      <div>
                        • Domy obecne na mapie poza kartoteką (np. nowi mieszkańcy lub pustostany):{' '}
                        <strong>{summary.mapOnlyCount}</strong>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {summary.failedLines.length > 0 && (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
                  <div className="font-semibold inline-flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Nie odnaleziono współrzędnych ({summary.failedLines.length}):
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
        <div className="px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4 border-t border-slate-200 bg-white flex items-center justify-end gap-2 shrink-0">
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
            disabled={
              !parish ||
              parsed.buildings.length === 0 ||
              totalActionsCount === 0 ||
              isImporting
            }
            onClick={() => void handleRunImport()}
            className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl inline-flex items-center gap-1.5"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Przetwarzanie...</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>
                  {mapMatch.matched.length > 0 && !alsoGeocodeMissing
                    ? `Uzupełnij domy na mapie (${mapMatch.matched.length})`
                    : `Zastosuj na mapie (${totalActionsCount} bud.)`}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
