import React, { useMemo, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  ListPlus,
  Loader2,
  MapPinPlus,
  Route,
  Search,
  Split,
  Trash2,
  X,
} from 'lucide-react';
import { useMapEngine } from '../contexts/MapEngineContext';
import { searchPlacesNominatim } from '../services/osmSearchAndRouting';
import {
  LatLng,
  MapInteractionMode,
  PRIEST_PALETTE,
  ParishCenter,
  PlanConfig,
  StreetPickFeedback,
  VisitStop,
} from '../types/parish';
import { notifyIfQuotaExceeded } from '../utils/quota';
import { OsmStreetFetcherModal } from './OsmStreetFetcherModal';
import { PlaceSearchInput, SelectedPlaceData } from './PlaceSearchInput';

interface SidebarStopsProps {
  parish: ParishCenter | null;
  boundary: LatLng[];
  stops: VisitStop[];
  config: PlanConfig;
  interactionMode: MapInteractionMode;
  streetPickFeedback: StreetPickFeedback | null;
  onDismissStreetFeedback: () => void;
  onAddPlaceStop: (place: SelectedPlaceData) => void;
  onBatchAddStops: (places: SelectedPlaceData[]) => void;
  onTogglePickStreetMode: () => void;
  onToggleMapAddMode: () => void;
  onUpdateStop: (id: string, patch: Partial<VisitStop>) => void;
  onDeleteStop: (id: string) => void;
  onClearStops: () => void;
  onAutoPartition: () => void;
  onSelectStop: (id: string) => void;
  onComputeRoutes: () => void;
  isComputing: boolean;
}

interface BatchImportFormProps {
  parish: ParishCenter;
  onBatchAddStops: (places: SelectedPlaceData[]) => void;
  onClose: () => void;
  onDoneMessage: (msg: string) => void;
}

const GoogleBatchImportForm: React.FC<BatchImportFormProps> = ({
  parish,
  onBatchAddStops,
  onClose,
  onDoneMessage,
}) => {
  const placesLib = useMapsLibrary('places');
  const [batchText, setBatchText] = useState('');
  const [batchLoading, setBatchLoading] = useState(false);

  const handleImport = async () => {
    if (!placesLib) return;
    const lines = batchText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length >= 3);

    if (lines.length === 0) return;

    setBatchLoading(true);
    const found: SelectedPlaceData[] = [];
    let failedCount = 0;

    for (const line of lines.slice(0, 25)) {
      try {
        const res = await placesLib.Place.searchByText({
          textQuery: line,
          fields: ['displayName', 'formattedAddress', 'location', 'id'],
          locationBias: parish.location,
          language: 'pl',
          region: 'pl',
          maxResultCount: 1,
        });
        const first = res?.places?.[0];
        if (first && first.location) {
          found.push({
            name: first.displayName || line,
            address: first.formattedAddress || line,
            location: {
              lat: first.location.lat(),
              lng: first.location.lng(),
            },
            placeId: first.id || '',
          });
        } else {
          failedCount += 1;
        }
      } catch (err) {
        failedCount += 1;
        if (notifyIfQuotaExceeded(err)) break;
      }
    }

    if (found.length > 0) onBatchAddStops(found);
    setBatchLoading(false);
    setBatchText('');
    onClose();
    onDoneMessage(
      `Dodano ${found.length} adresów${
        failedCount > 0 ? `, nie znaleziono ${failedCount}` : ''
      }.`
    );
  };

  return (
    <div className="pt-2 border-t border-slate-100 space-y-2">
      <label htmlFor="batch-addresses" className="block text-xs text-slate-600">
        Wpisz lub wklej po jednym adresie w linii (maks. 25 naraz):
      </label>
      <textarea
        id="batch-addresses"
        rows={4}
        value={batchText}
        onChange={(e) => setBatchText(e.target.value)}
        placeholder={'ul. Mickiewicza 4, Kraków\nul. Słowackiego 12, Kraków'}
        className="w-full p-2.5 text-base sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
        >
          Anuluj
        </button>
        <button
          type="button"
          disabled={batchLoading || batchText.trim().length < 3}
          onClick={handleImport}
          className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 rounded-lg inline-flex items-center gap-1.5"
        >
          {batchLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Wyszukaj i dodaj
        </button>
      </div>
    </div>
  );
};

const OsmBatchImportForm: React.FC<BatchImportFormProps> = ({
  parish,
  onBatchAddStops,
  onClose,
  onDoneMessage,
}) => {
  const [batchText, setBatchText] = useState('');
  const [batchLoading, setBatchLoading] = useState(false);

  const handleImport = async () => {
    const lines = batchText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length >= 3);

    if (lines.length === 0) return;

    setBatchLoading(true);
    const found: SelectedPlaceData[] = [];
    let failedCount = 0;

    for (const line of lines.slice(0, 20)) {
      try {
        const res = await searchPlacesNominatim(line, parish.location, 1);
        if (res[0]) {
          found.push(res[0]);
        } else {
          failedCount += 1;
        }
      } catch {
        failedCount += 1;
      }
      await new Promise((r) => setTimeout(r, 350));
    }

    if (found.length > 0) onBatchAddStops(found);
    setBatchLoading(false);
    setBatchText('');
    onClose();
    onDoneMessage(
      `Dodano ${found.length} adresów${
        failedCount > 0 ? `, nie znaleziono ${failedCount}` : ''
      }.`
    );
  };

  return (
    <div className="pt-2 border-t border-slate-100 space-y-2">
      <label htmlFor="batch-addresses" className="block text-xs text-slate-600">
        Wpisz lub wklej po jednym adresie w linii (maks. 20 naraz):
      </label>
      <textarea
        id="batch-addresses"
        rows={4}
        value={batchText}
        onChange={(e) => setBatchText(e.target.value)}
        placeholder={'ul. Mickiewicza 4, Kraków\nul. Słowackiego 12, Kraków'}
        className="w-full p-2.5 text-base sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
        >
          Anuluj
        </button>
        <button
          type="button"
          disabled={batchLoading || batchText.trim().length < 3}
          onClick={handleImport}
          className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 rounded-lg inline-flex items-center gap-1.5"
        >
          {batchLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Wyszukaj i dodaj
        </button>
      </div>
    </div>
  );
};

export const SidebarStops: React.FC<SidebarStopsProps> = ({
  parish,
  boundary,
  stops,
  config,
  interactionMode,
  streetPickFeedback,
  onDismissStreetFeedback,
  onAddPlaceStop,
  onBatchAddStops,
  onTogglePickStreetMode,
  onToggleMapAddMode,
  onUpdateStop,
  onDeleteStop,
  onClearStops,
  onAutoPartition,
  onSelectStop,
  onComputeRoutes,
  isComputing,
}) => {
  const engine = useMapEngine();
  const [showBatch, setShowBatch] = useState(false);
  const [osmModalOpen, setOsmModalOpen] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [stopFilter, setStopFilter] = useState('');

  const outsideCount =
    boundary.length >= 3
      ? stops.filter((s) => s.inBoundary === false).length
      : 0;

  const filteredStops = useMemo(() => {
    const q = stopFilter.trim().toLowerCase();
    if (!q) return stops;
    return stops.filter(
      (s) =>
        s.address.toLowerCase().includes(q) ||
        (s.notes && s.notes.toLowerCase().includes(q))
    );
  }, [stops, stopFilter]);

  return (
    <div className="flex flex-col h-full">
      {/* Add controls */}
      <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3 bg-white">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Punkty odwiedzin ({stops.length})
          </h2>
          {stops.length > 0 && (
            <button
              type="button"
              onClick={onClearStops}
              className="text-xs text-slate-500 hover:text-red-600 transition-colors"
            >
              Wyczyść listę
            </button>
          )}
        </div>

        <PlaceSearchInput
          placeholder={
            parish
              ? 'Dodaj adres (np. ul. Floriańska 12)...'
              : 'Najpierw ustaw parafię w kroku 1'
          }
          biasLocation={parish?.location}
          onSelect={onAddPlaceStop}
          clearOnSelect={true}
        />

        {/* Primary interactive map street & house pickers */}
        <button
          type="button"
          disabled={!parish}
          onClick={onTogglePickStreetMode}
          className={`w-full min-h-[42px] py-2 px-3 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-2 transition-colors ${
            interactionMode === 'pick_street'
              ? 'bg-amber-700 border-amber-700 text-white shadow-sm'
              : 'bg-amber-50/80 border-amber-200 text-amber-950 hover:bg-amber-100/80 disabled:opacity-50 disabled:bg-white disabled:border-slate-200 disabled:text-slate-400'
          }`}
        >
          <Route className="w-4 h-4 shrink-0" />
          <span>
            {interactionMode === 'pick_street'
              ? 'Tryb aktywny — kliknij ulicę na mapie'
              : 'Kliknij ulicę na mapie (pobierz wszystkie domy)'}
          </span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!parish}
            onClick={onToggleMapAddMode}
            className={`min-h-[40px] py-2 px-3 text-xs font-medium rounded-xl border inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
              interactionMode === 'add_stop'
                ? 'bg-amber-700 border-amber-700 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50'
            }`}
          >
            <MapPinPlus className="w-3.5 h-3.5" />
            {interactionMode === 'add_stop'
              ? 'Kliknij budynek'
              : 'Pojedynczy dom'}
          </button>

          <button
            type="button"
            disabled={!parish}
            onClick={() => setShowBatch((v) => !v)}
            className="min-h-[40px] py-2 px-3 text-xs font-medium rounded-xl border bg-white border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <ListPlus className="w-3.5 h-3.5" />
            Wklej listę
          </button>
        </div>

        <button
          type="button"
          disabled={!parish}
          onClick={() => setOsmModalOpen(true)}
          className="w-full min-h-[38px] py-2 px-3 text-xs font-medium rounded-xl border bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 transition-colors"
        >
          <Search className="w-3.5 h-3.5 shrink-0 text-slate-500" />
          <span className="truncate">
            Lista wszystkich ulic z obszaru parafii (OSM)
          </span>
        </button>

        {streetPickFeedback && (
          <div
            className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
              streetPickFeedback.status === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : streetPickFeedback.status === 'error'
                  ? 'bg-red-50 border-red-200 text-red-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <span>{streetPickFeedback.message}</span>
            {streetPickFeedback.status !== 'loading' && (
              <button
                type="button"
                onClick={onDismissStreetFeedback}
                aria-label="Zamknij"
                className="p-0.5 text-current/70 hover:text-current shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {showBatch &&
          parish &&
          (engine === 'google' ? (
            <GoogleBatchImportForm
              parish={parish}
              onBatchAddStops={onBatchAddStops}
              onClose={() => setShowBatch(false)}
              onDoneMessage={setBatchStatus}
            />
          ) : (
            <OsmBatchImportForm
              parish={parish}
              onBatchAddStops={onBatchAddStops}
              onClose={() => setShowBatch(false)}
              onDoneMessage={setBatchStatus}
            />
          ))}

        {batchStatus && (
          <p className="text-xs text-slate-600">{batchStatus}</p>
        )}

        {outsideCount > 0 && (
          <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              {outsideCount}{' '}
              {outsideCount === 1
                ? 'adres znajduje się'
                : 'adresy znajdują się'}{' '}
              poza zaznaczonym terenem parafii.
            </span>
          </div>
        )}

        {stops.length > 1 && config.priestCount > 1 && (
          <button
            type="button"
            onClick={onAutoPartition}
            className="w-full min-h-[38px] py-2 px-3 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <Split className="w-3.5 h-3.5" />
            Podziel automatycznie na {config.priestCount} księży według rejonów
          </button>
        )}

        {stops.length > 4 && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={stopFilter}
              onChange={(e) => setStopFilter(e.target.value)}
              placeholder="Filtruj dodane domy po ulicy lub uwagach..."
              className="w-full pl-8 pr-8 py-2 text-base sm:text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-amber-600"
            />
            {stopFilter && (
              <button
                type="button"
                onClick={() => setStopFilter('')}
                aria-label="Wyczyść filtr"
                className="p-1 text-slate-400 hover:text-slate-700 absolute right-2 top-1/2 -translate-y-1/2"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Stops list */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {stops.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-700">
              Brak dodanych domów do odwiedzenia
            </p>
            <p className="text-xs text-slate-500 mt-1.5 max-w-xs mx-auto leading-relaxed">
              Kliknij <strong>„Kliknij ulicę na mapie”</strong>, aby jednym
              dotknięciem pobrać wszystkie domy z wybranej ulicy, albo wpisz
              adres ręcznie powyżej.
            </p>
          </div>
        ) : filteredStops.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Brak adresów pasujących do frazy „{stopFilter}”.
          </div>
        ) : (
          filteredStops.map((stop, index) => {
            const palette =
              PRIEST_PALETTE.find((p) => p.id === stop.priestId) ??
              PRIEST_PALETTE[0];
            return (
              <div
                key={stop.id}
                className="p-4 hover:bg-slate-50/80 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectStop(stop.id)}
                    className="text-left min-w-0 flex-1 group"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: palette.color }}
                      />
                      <span className="text-xs font-mono text-slate-400 tabular-nums">
                        #{index + 1}
                      </span>
                      <span className="text-sm font-medium text-slate-900 group-hover:text-amber-800 truncate">
                        {stop.address}
                      </span>
                    </div>
                    {stop.notes && (
                      <div className="text-xs text-slate-500 truncate mt-0.5 pl-4">
                        {stop.notes}
                      </div>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteStop(stop.id)}
                    aria-label="Usuń dom"
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="mt-2.5 pl-4 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={stop.address}
                    onChange={(e) =>
                      onUpdateStop(stop.id, {
                        address: e.target.value,
                        label: e.target.value,
                      })
                    }
                    aria-label="Adres domu"
                    placeholder="Adres domu (np. ul. Lipowa 12)"
                    className="flex-1 min-w-[140px] px-2.5 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-amber-600"
                  />

                  <input
                    type="text"
                    value={stop.notes ?? ''}
                    onChange={(e) =>
                      onUpdateStop(stop.id, { notes: e.target.value })
                    }
                    aria-label="Rodzina lub uwagi"
                    placeholder="Rodzina / uwagi"
                    className="w-32 sm:w-28 px-2.5 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-amber-600"
                  />

                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={3}
                      max={120}
                      value={stop.durationMinutes}
                      onChange={(e) =>
                        onUpdateStop(stop.id, {
                          durationMinutes: Math.max(
                            3,
                            Number.parseInt(e.target.value || '15', 10)
                          ),
                        })
                      }
                      aria-label="Czas wizyty w minutach"
                      className="w-14 px-2 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-800 text-right focus:outline-none focus:border-amber-600"
                    />
                    <span className="text-xs text-slate-500">min</span>
                  </div>

                  {config.priestCount > 1 && (
                    <select
                      value={stop.priestId}
                      onChange={(e) =>
                        onUpdateStop(stop.id, {
                          priestId: Number.parseInt(e.target.value, 10),
                        })
                      }
                      aria-label="Przypisany ksiądz"
                      className="px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-amber-600"
                    >
                      {PRIEST_PALETTE.slice(0, config.priestCount).map((p) => (
                        <option key={p.id} value={p.id}>
                          Ks. {p.id}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {stop.inBoundary === false && (
                  <p className="mt-1.5 pl-4 text-xs text-amber-700">
                    Punkt leży poza narysowanym obrysem parafii
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Primary action footer */}
      <div className="p-4 border-t border-slate-200 bg-white">
        <button
          type="button"
          disabled={!parish || stops.length === 0 || isComputing}
          onClick={onComputeRoutes}
          className="w-full min-h-[42px] py-2.5 px-4 text-sm font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
        >
          {isComputing && <Loader2 className="w-4 h-4 animate-spin" />}
          {isComputing
            ? 'Wyznaczanie optymalnych tras...'
            : 'Wyznacz optymalne trasy'}
        </button>
      </div>

      <OsmStreetFetcherModal
        open={osmModalOpen}
        parish={parish}
        boundary={boundary}
        onClose={() => setOsmModalOpen(false)}
        onAddPlaces={onBatchAddStops}
      />
    </div>
  );
};
