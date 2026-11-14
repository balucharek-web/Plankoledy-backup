import React, { useState } from 'react';
import {
  Car,
  CheckCircle2,
  Church,
  Cloud,
  Footprints,
  Loader2,
  LocateFixed,
  LogIn,
  MapPin,
  Maximize2,
  Minimize2,
  Pentagon,
  Trash2,
  X,
} from 'lucide-react';
import {
  NearbyParishCandidate,
  fetchNearbyParishesOsm,
} from '../services/overpassStreets';
import {
  LatLng,
  MapInteractionMode,
  PRIEST_PALETTE,
  ParishCenter,
  PlanConfig,
  SavedParishRecord,
} from '../types/parish';
import { PlaceSearchInput, SelectedPlaceData } from './PlaceSearchInput';

interface SidebarSetupProps {
  parish: ParishCenter | null;
  activeParishId: string | null;
  savedParishes: SavedParishRecord[];
  boundary: LatLng[];
  config: PlanConfig;
  interactionMode: MapInteractionMode;
  isSignedIn: boolean;
  userEmail: string | null;
  onSignInGoogle: () => void;
  onSelectParish: (place: SelectedPlaceData) => void;
  onSelectSavedParish: (parishId: string) => void;
  onDeleteSavedParish: (parishId: string) => void;
  onCreatePresetBoundary: (radiusMeters?: number) => void;
  onScaleBoundary: (factor: number) => void;
  onToggleDrawBoundary: () => void;
  onClearBoundary: () => void;
  onChangeConfig: (next: PlanConfig) => void;
  onNextStep: () => void;
}

function formatShortDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export const SidebarSetup: React.FC<SidebarSetupProps> = ({
  parish,
  activeParishId,
  savedParishes,
  boundary,
  config,
  interactionMode,
  isSignedIn,
  userEmail,
  onSignInGoogle,
  onSelectParish,
  onSelectSavedParish,
  onDeleteSavedParish,
  onCreatePresetBoundary,
  onScaleBoundary,
  onToggleDrawBoundary,
  onClearBoundary,
  onChangeConfig,
  onNextStep,
}) => {
  const isDrawing = interactionMode === 'draw_boundary';
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [nearbyChurches, setNearbyChurches] = useState<
    NearbyParishCandidate[] | null
  >(null);

  const loadChurchesAround = async (center: LatLng) => {
    setNearbyLoading(true);
    setNearbyError(null);
    try {
      const list = await fetchNearbyParishesOsm(center, 6000);
      setNearbyChurches(list);
      if (list.length === 0) {
        setNearbyError('Nie znaleziono kościołów w promieniu 6 km.');
      }
    } catch (err) {
      setNearbyError(
        err instanceof Error
          ? err.message
          : 'Nie udało się pobrać listy kościołów w okolicy.'
      );
    } finally {
      setNearbyLoading(false);
    }
  };

  const handleFindNearbyGps = () => {
    if (!navigator.geolocation) {
      setNearbyError('Twoja przeglądarka nie obsługuje lokalizacji GPS.');
      return;
    }
    setNearbyLoading(true);
    setNearbyError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void loadChurchesAround({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {
        setNearbyLoading(false);
        setNearbyError(
          'Brak zgody na lokalizację GPS. Wpisz nazwę miasta powyżej (np. Mikołów).'
        );
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div className="divide-y divide-slate-200">
      {/* Section 1: Parish origin & Saved parishes (signed-in only) */}
      <section className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-sm font-semibold text-slate-900">
            1. Parafia i punkt startowy
          </h2>
          {parish && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Ustawiono
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Wpisz dowolną frazę — nazwę parafii, imię patrona z miastem albo samo
          miasto.
        </p>

        <PlaceSearchInput
          placeholder="np. św Antoni Mikołów, Bazylika Mariacka lub Mikołów"
          searchScope="parish"
          onSelect={(place) => {
            setNearbyChurches(null);
            setNearbyError(null);
            onSelectParish(place);
            if (place.placeType === 'place') {
              void loadChurchesAround(place.location);
            }
          }}
          initialValue={parish?.name ?? ''}
        />

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={nearbyLoading}
            onClick={handleFindNearbyGps}
            className="flex-1 min-w-[140px] min-h-[38px] py-1.5 px-3 text-xs font-medium rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            {nearbyLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
            ) : (
              <LocateFixed className="w-3.5 h-3.5 text-amber-700" />
            )}
            <span>Parafie w pobliżu (GPS)</span>
          </button>

          {parish && (
            <button
              type="button"
              disabled={nearbyLoading}
              onClick={() => void loadChurchesAround(parish.location)}
              className="flex-1 min-w-[140px] min-h-[38px] py-1.5 px-3 text-xs font-medium rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Church className="w-3.5 h-3.5 text-amber-700" />
              <span>Kościoły w okolicy</span>
            </button>
          )}
        </div>

        {nearbyError && (
          <p className="mt-2 text-xs text-red-600">{nearbyError}</p>
        )}

        {nearbyChurches && nearbyChurches.length > 0 && (
          <div className="mt-3 border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">
                Kościoły i parafie w promieniu 6 km ({nearbyChurches.length})
              </span>
              <button
                type="button"
                onClick={() => setNearbyChurches(null)}
                aria-label="Zamknij listę kościołów"
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <ul className="max-h-52 overflow-y-auto divide-y divide-slate-100">
              {nearbyChurches.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectParish({
                        name: item.name,
                        address: item.address,
                        location: item.location,
                        placeId: item.id,
                        placeType: 'parish',
                      });
                      setNearbyChurches(null);
                    }}
                    className="w-full min-h-[44px] px-3 py-2 text-left hover:bg-amber-50/60 flex items-start justify-between gap-2 transition-colors"
                  >
                    <div className="min-w-0 flex items-start gap-2">
                      <Church className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-900 truncate">
                          {item.name}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {item.address}
                        </div>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0 mt-0.5">
                      {formatShortDistance(item.distanceMeters)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {parish && (
          <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
            <div className="font-medium text-slate-900">{parish.name}</div>
            <div className="mt-0.5 text-slate-500">{parish.address}</div>
          </div>
        )}

        {isSignedIn ? (
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">
                Zapamiętane parafie ({savedParishes.length})
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                <Cloud className="w-3 h-3" />
                Konto {userEmail?.split('@')[0] || 'Google'}
              </span>
            </div>

            {savedParishes.length === 0 ? (
              <p className="text-xs text-slate-500">
                Wybierz pierwszą parafię powyżej — zostanie automatycznie
                zapamiętana na Twoim koncie.
              </p>
            ) : (
              <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                {savedParishes.map((rec) => {
                  const isActive = rec.id === activeParishId;
                  return (
                    <li
                      key={rec.id}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                        isActive
                          ? 'bg-amber-50/70 border-amber-300'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectSavedParish(rec.id)}
                        className="flex-1 min-w-0 text-left flex items-start gap-2 min-h-[36px]"
                      >
                        <MapPin
                          className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                            isActive ? 'text-amber-700' : 'text-slate-400'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-900 truncate">
                            {rec.parish.name}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {rec.parish.address}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSavedParish(rec.id)}
                        title="Usuń zapamiętaną parafię"
                        className="p-2 text-slate-400 hover:text-red-600 rounded transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
            <p className="text-xs text-slate-600">
              Zapamiętywanie parafii działa tylko dla zalogowanego użytkownika.
              Zaloguj się przez Google, aby zapisywać swoje parafie, granice i
              domy.
            </p>
            <button
              type="button"
              onClick={onSignInGoogle}
              className="w-full min-h-[40px] py-2 px-3 text-xs font-medium text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <LogIn className="w-3.5 h-3.5 text-amber-700" />
              Zaloguj Google, aby zapamiętywać parafie
            </button>
          </div>
        )}
      </section>

      {/* Section 2: Parish territory boundary */}
      <section className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-sm font-semibold text-slate-900">
            2. Teren parafii lub rejonu
          </h2>
          {boundary.length >= 3 && (
            <span className="text-xs text-slate-500 tabular-nums">
              {boundary.length} wierzchołków
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Wybierz gotowy promień wokół kościoła (300 m, 500 m, 1 km) albo
          narysuj granice na mapie. Gotowy obrys powiększysz przyciskami lub
          przeciągając białe punkty.
        </p>

        <div className="space-y-2">
          {boundary.length < 3 ? (
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: '300 m', radius: 300 },
                { label: '500 m', radius: 500 },
                { label: '1 km', radius: 1000 },
              ].map((opt) => (
                <button
                  key={opt.radius}
                  type="button"
                  disabled={!parish || isDrawing}
                  onClick={() => onCreatePresetBoundary(opt.radius)}
                  className="min-h-[38px] py-2 px-2 text-xs font-medium rounded-lg border bg-amber-50/70 border-amber-200 text-amber-900 hover:bg-amber-100/70 disabled:opacity-50 disabled:bg-white disabled:border-slate-200 disabled:text-slate-400 transition-colors tabular-nums"
                >
                  Obrys {opt.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={isDrawing}
                onClick={() => onScaleBoundary(0.82)}
                className="min-h-[38px] py-2 px-3 text-xs font-medium rounded-lg border bg-amber-50/70 border-amber-200 text-amber-900 hover:bg-amber-100/70 inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                Zmniejsz teren
              </button>
              <button
                type="button"
                disabled={isDrawing}
                onClick={() => onScaleBoundary(1.22)}
                className="min-h-[38px] py-2 px-3 text-xs font-medium rounded-lg border bg-amber-50/70 border-amber-200 text-amber-900 hover:bg-amber-100/70 inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Powiększ teren
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!parish}
              onClick={onToggleDrawBoundary}
              className={`flex-1 min-h-[40px] py-2 px-3 text-xs font-medium rounded-lg border inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                isDrawing
                  ? 'bg-amber-700 border-amber-700 text-white'
                  : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              <Pentagon className="w-3.5 h-3.5" />
              {isDrawing
                ? 'Trwa rysowanie na mapie...'
                : boundary.length >= 3
                  ? 'Przerysuj granice ręcznie'
                  : 'Rysuj własny obrys na mapie'}
            </button>

            {boundary.length >= 3 && (
              <button
                type="button"
                onClick={onClearBoundary}
                title="Usuń obrys terenu"
                className="min-h-[40px] px-3 text-slate-500 hover:text-red-600 bg-white border border-slate-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        {!parish && (
          <p className="mt-2 text-xs text-slate-400">
            Najpierw wyszukaj i wybierz parafię powyżej, aby wyśrodkować mapę.
          </p>
        )}
      </section>

      {/* Section 3: Kolęda parameters */}
      <section className="p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 mb-1">
            3. Parametry kolędy
          </h2>
          <p className="text-xs text-slate-500">
            Dostosuj liczbę księży, środek transportu i ramy czasowe.
          </p>
        </div>

        {/* Number of priests */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            Liczba księży chodzących jednocześnie
          </label>
          <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded-lg">
            {[1, 2, 3, 4].map((count) => {
              const active = config.priestCount === count;
              return (
                <button
                  key={count}
                  type="button"
                  onClick={() =>
                    onChangeConfig({ ...config, priestCount: count })
                  }
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors tabular-nums ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {count} {count === 1 ? 'ksiądz' : 'księży'}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            {PRIEST_PALETTE.slice(0, config.priestCount).map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ backgroundColor: p.color }}
                />
                {p.name.split(' ')[0]} {p.id}
              </span>
            ))}
          </div>
        </div>

        {/* Travel mode */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            Sposób przemieszczania się
          </label>
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() =>
                onChangeConfig({ ...config, travelMode: 'WALKING' })
              }
              className={`py-2 px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-1.5 transition-colors ${
                config.travelMode === 'WALKING'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Footprints className="w-3.5 h-3.5" />
              Pieszo (miasto / blok)
            </button>
            <button
              type="button"
              onClick={() =>
                onChangeConfig({ ...config, travelMode: 'DRIVING' })
              }
              className={`py-2 px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-1.5 transition-colors ${
                config.travelMode === 'DRIVING'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Car className="w-3.5 h-3.5" />
              Samochodem (wieś)
            </button>
          </div>
        </div>

        {/* Start time & Average visit duration */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="koleda-start-time"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Godzina rozpoczęcia
            </label>
            <input
              id="koleda-start-time"
              type="time"
              value={config.startTime}
              onChange={(e) =>
                onChangeConfig({ ...config, startTime: e.target.value })
              }
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600"
            />
          </div>
          <div>
            <label
              htmlFor="koleda-visit-duration"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Śr. czas wizyty (min)
            </label>
            <input
              id="koleda-visit-duration"
              type="number"
              min={3}
              max={90}
              value={config.defaultVisitMinutes}
              onChange={(e) =>
                onChangeConfig({
                  ...config,
                  defaultVisitMinutes: Math.max(
                    3,
                    Number.parseInt(e.target.value || '15', 10)
                  ),
                })
              }
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600"
            />
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none pt-1">
          <input
            type="checkbox"
            checked={config.returnToParish}
            onChange={(e) =>
              onChangeConfig({ ...config, returnToParish: e.target.checked })
            }
            className="w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600"
          />
          Uwzględnij powrót pod kościół po ostatniej wizycie
        </label>
      </section>

      <div className="p-5 bg-slate-50/60">
        <button
          type="button"
          onClick={onNextStep}
          disabled={!parish}
          className="w-full py-2.5 px-4 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          Przejdź do dodawania adresów
        </button>
      </div>
    </div>
  );
};
