import React, { useCallback, useEffect, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { ArchitectureGuideModal } from './components/ArchitectureGuideModal';
import { ParishMap } from './components/ParishMap';
import { SelectedPlaceData } from './components/PlaceSearchInput';
import { PrintScheduleSheet } from './components/PrintScheduleSheet';
import { SidebarRoutes } from './components/SidebarRoutes';
import { SidebarSetup } from './components/SidebarSetup';
import { SidebarStops } from './components/SidebarStops';
import { useParishRouteOptimizer } from './hooks/useParishRouteOptimizer';
import { reverseGeocodeHouseAddress } from './services/overpassStreets';
import {
  LatLng,
  MapInteractionMode,
  PRIEST_PALETTE,
  ParishCenter,
  PlanConfig,
  VisitStop,
} from './types/parish';
import {
  createPresetBoundaryPolygon,
  isPointInsideBoundary,
  partitionStopsBySector,
} from './utils/spatial';

type SidebarTab = 'setup' | 'stops' | 'routes';
type MainView = 'workspace' | 'schedule';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const STORAGE_KEY = 'planer_koledy_plan_v1';
const CACHE_TTL_MS = 29 * 24 * 60 * 60 * 1000; // < 30 days ToS compliance

interface SavedPlanState {
  savedAt: number;
  parish: ParishCenter | null;
  boundary: LatLng[];
  stops: VisitStop[];
  config: PlanConfig;
}

function loadSavedPlan(): Partial<SavedPlanState> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SavedPlanState;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > CACHE_TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function ParishPlannerWorkspace() {
  const [initialState] = useState<Partial<SavedPlanState>>(() =>
    loadSavedPlan()
  );

  const [parish, setParish] = useState<ParishCenter | null>(
    initialState.parish ?? null
  );
  const [boundary, setBoundary] = useState<LatLng[]>(
    initialState.boundary ?? []
  );
  const [stops, setStops] = useState<VisitStop[]>(initialState.stops ?? []);
  const [config, setConfig] = useState<PlanConfig>(
    initialState.config ?? {
      priestCount: 2,
      startTime: '15:30',
      defaultVisitMinutes: 15,
      travelMode: 'WALKING',
      returnToParish: true,
    }
  );

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('setup');
  const [mainView, setMainView] = useState<MainView>('workspace');
  const [interactionMode, setInteractionMode] =
    useState<MapInteractionMode>('pan');
  const [highlightedStopId, setHighlightedStopId] = useState<string | null>(
    null
  );
  const [guideOpen, setGuideOpen] = useState(false);

  const {
    routes,
    routeObjects,
    isComputing,
    error: routeError,
    computeAllRoutes,
    clearRoutes,
  } = useParishRouteOptimizer();

  // Persist user's plan locally (automatically expires before 30 days)
  useEffect(() => {
    try {
      const payload: SavedPlanState = {
        savedAt: Date.now(),
        parish,
        boundary,
        stops,
        config,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }, [parish, boundary, stops, config]);

  const handleSelectParish = useCallback(
    (place: SelectedPlaceData) => {
      setParish({
        name: place.name,
        address: place.address,
        location: place.location,
        placeId: place.placeId,
      });
      clearRoutes();
    },
    [clearRoutes]
  );

  const updateBoundaryAndRecheckStops = useCallback((points: LatLng[]) => {
    setBoundary(points);
    setStops((prev) =>
      prev.map((s) => ({
        ...s,
        inBoundary: isPointInsideBoundary(s.location, points),
      }))
    );
  }, []);

  const handleBoundaryComplete = useCallback(
    (points: LatLng[]) => {
      setInteractionMode('pan');
      updateBoundaryAndRecheckStops(points);
    },
    [updateBoundaryAndRecheckStops]
  );

  const handleCreatePresetBoundary = useCallback(() => {
    if (!parish) return;
    const preset = createPresetBoundaryPolygon(parish.location, 500, 8);
    setInteractionMode('pan');
    updateBoundaryAndRecheckStops(preset);
  }, [parish, updateBoundaryAndRecheckStops]);

  const handleClearBoundary = useCallback(() => {
    setBoundary([]);
    setStops((prev) => prev.map((s) => ({ ...s, inBoundary: true })));
  }, []);

  const nextPriestRoundRobin = useCallback(
    (currentCount: number) => (currentCount % config.priestCount) + 1,
    [config.priestCount]
  );

  const handleAddPlaceStop = useCallback(
    (place: SelectedPlaceData) => {
      setStops((prev) => {
        const nextStop: VisitStop = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          label: place.name,
          address: place.address,
          location: place.location,
          placeId: place.placeId,
          durationMinutes: config.defaultVisitMinutes,
          priestId: nextPriestRoundRobin(prev.length),
          inBoundary: isPointInsideBoundary(place.location, boundary),
        };
        return [...prev, nextStop];
      });
      clearRoutes();
    },
    [config.defaultVisitMinutes, nextPriestRoundRobin, boundary, clearRoutes]
  );

  const handleBatchAddStops = useCallback(
    (places: SelectedPlaceData[]) => {
      setStops((prev) => {
        const added: VisitStop[] = places.map((place, idx) => ({
          id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          label: place.name,
          address: place.address,
          location: place.location,
          placeId: place.placeId,
          durationMinutes: config.defaultVisitMinutes,
          priestId: ((prev.length + idx) % config.priestCount) + 1,
          inBoundary: isPointInsideBoundary(place.location, boundary),
        }));
        const combined = [...prev, ...added];
        if (parish && config.priestCount > 1) {
          return partitionStopsBySector(
            parish.location,
            combined,
            config.priestCount
          );
        }
        return combined;
      });
      clearRoutes();
    },
    [
      config.defaultVisitMinutes,
      config.priestCount,
      boundary,
      parish,
      clearRoutes,
    ]
  );

  // Clicking a house on the map resolves & saves it as its real street/house address
  const handleMapAddStop = useCallback(
    (location: LatLng) => {
      const stopId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      setStops((prev) => {
        const nextStop: VisitStop = {
          id: stopId,
          label: 'Rozpoznawanie adresu domu...',
          address: 'Rozpoznawanie adresu domu...',
          location,
          durationMinutes: config.defaultVisitMinutes,
          priestId: nextPriestRoundRobin(prev.length),
          inBoundary: isPointInsideBoundary(location, boundary),
        };
        return [...prev, nextStop];
      });
      clearRoutes();

      void reverseGeocodeHouseAddress(location).then((resolved) => {
        setStops((prev) =>
          prev.map((s) =>
            s.id === stopId
              ? {
                  ...s,
                  label: resolved.label,
                  address: resolved.address,
                }
              : s
          )
        );
      });
    },
    [config.defaultVisitMinutes, nextPriestRoundRobin, boundary, clearRoutes]
  );

  const handleUpdateStop = useCallback(
    (id: string, patch: Partial<VisitStop>) => {
      setStops((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
      );
      clearRoutes();
    },
    [clearRoutes]
  );

  const handleDeleteStop = useCallback(
    (id: string) => {
      setStops((prev) => prev.filter((s) => s.id !== id));
      clearRoutes();
    },
    [clearRoutes]
  );

  const handleAutoPartition = useCallback(() => {
    if (!parish) return;
    setStops((prev) =>
      partitionStopsBySector(parish.location, prev, config.priestCount)
    );
    clearRoutes();
  }, [parish, config.priestCount, clearRoutes]);

  const handleComputeRoutes = useCallback(async () => {
    if (!parish || stops.length === 0) return;
    setInteractionMode('pan');
    setSidebarTab('routes');
    await computeAllRoutes(parish, stops, config);
  }, [parish, stops, config, computeAllRoutes]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Three-Zone Top Bar */}
      <header className="no-print h-14 px-6 bg-white border-b border-slate-200 flex items-center justify-between gap-8 shrink-0">
        <button
          type="button"
          onClick={() => setMainView('workspace')}
          className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 text-left"
        >
          Planer Kolędy
        </button>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => {
              setMainView('workspace');
              setSidebarTab('setup');
            }}
            className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 ${
              mainView === 'workspace' && sidebarTab === 'setup'
                ? 'text-slate-900 underline underline-offset-8 decoration-amber-700 decoration-2'
                : ''
            }`}
          >
            Parafia i teren
          </button>
          <button
            type="button"
            onClick={() => {
              setMainView('workspace');
              setSidebarTab('stops');
            }}
            className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 ${
              mainView === 'workspace' && sidebarTab === 'stops'
                ? 'text-slate-900 underline underline-offset-8 decoration-amber-700 decoration-2'
                : ''
            }`}
          >
            Adresy domów
          </button>
          <button
            type="button"
            onClick={() => {
              setMainView('workspace');
              setSidebarTab('routes');
            }}
            className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 ${
              mainView === 'workspace' && sidebarTab === 'routes'
                ? 'text-slate-900 underline underline-offset-8 decoration-amber-700 decoration-2'
                : ''
            }`}
          >
            Trasy księży
          </button>
          <button
            type="button"
            onClick={() => setMainView('schedule')}
            className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 ${
              mainView === 'schedule'
                ? 'text-slate-900 underline underline-offset-8 decoration-amber-700 decoration-2'
                : ''
            }`}
          >
            Harmonogram
          </button>
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-900"
          >
            Jak to działa
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={!parish || stops.length === 0 || isComputing}
            onClick={handleComputeRoutes}
            className="px-4 py-2 text-xs font-medium text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {isComputing ? 'Obliczanie...' : 'Wyznacz trasy'}
          </button>
        </div>
      </header>

      {mainView === 'schedule' ? (
        <main className="flex-1 overflow-y-auto bg-slate-50">
          <PrintScheduleSheet
            parish={parish}
            config={config}
            routes={routes}
            onBackToMap={() => setMainView('workspace')}
          />
        </main>
      ) : (
        <main className="flex-1 min-h-0 flex flex-col lg:flex-row">
          <aside className="no-print w-full lg:w-[400px] xl:w-[420px] bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col min-h-0 max-h-[52vh] lg:max-h-none shrink-0">
            <div className="p-2 border-b border-slate-200 bg-slate-50/70 grid grid-cols-3 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setSidebarTab('setup')}
                className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  sidebarTab === 'setup'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                1. Parafia
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('stops')}
                className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums ${
                  sidebarTab === 'stops'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                2. Domy ({stops.length})
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('routes')}
                className={`py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums ${
                  sidebarTab === 'routes'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                3. Trasy ({routes.length})
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {sidebarTab === 'setup' && (
                <SidebarSetup
                  parish={parish}
                  boundary={boundary}
                  config={config}
                  interactionMode={interactionMode}
                  onSelectParish={handleSelectParish}
                  onCreatePresetBoundary={handleCreatePresetBoundary}
                  onToggleDrawBoundary={() =>
                    setInteractionMode((m) =>
                      m === 'draw_boundary' ? 'pan' : 'draw_boundary'
                    )
                  }
                  onClearBoundary={handleClearBoundary}
                  onChangeConfig={(next) => {
                    setConfig(next);
                    clearRoutes();
                  }}
                  onNextStep={() => setSidebarTab('stops')}
                />
              )}

              {sidebarTab === 'stops' && (
                <SidebarStops
                  parish={parish}
                  boundary={boundary}
                  stops={stops}
                  config={config}
                  interactionMode={interactionMode}
                  onAddPlaceStop={handleAddPlaceStop}
                  onBatchAddStops={handleBatchAddStops}
                  onToggleMapAddMode={() =>
                    setInteractionMode((m) =>
                      m === 'add_stop' ? 'pan' : 'add_stop'
                    )
                  }
                  onUpdateStop={handleUpdateStop}
                  onDeleteStop={handleDeleteStop}
                  onClearStops={() => {
                    setStops([]);
                    clearRoutes();
                  }}
                  onAutoPartition={handleAutoPartition}
                  onSelectStop={(id) => setHighlightedStopId(id)}
                  onComputeRoutes={handleComputeRoutes}
                  isComputing={isComputing}
                />
              )}

              {sidebarTab === 'routes' && (
                <SidebarRoutes
                  parish={parish}
                  config={config}
                  routes={routes}
                  isComputing={isComputing}
                  globalError={routeError}
                  onRecompute={handleComputeRoutes}
                  onSelectStop={(id) => setHighlightedStopId(id)}
                />
              )}
            </div>
          </aside>

          <section className="flex-1 min-h-[460px] relative">
            <ParishMap
              parish={parish}
              boundary={boundary}
              stops={stops}
              routes={routes}
              routeObjects={routeObjects}
              interactionMode={interactionMode}
              highlightedStopId={highlightedStopId}
              onSetInteractionMode={setInteractionMode}
              onCreatePresetBoundary={handleCreatePresetBoundary}
              onClearBoundary={handleClearBoundary}
              onBoundaryComplete={handleBoundaryComplete}
              onBoundaryUpdate={updateBoundaryAndRecheckStops}
              onCancelInteraction={() => setInteractionMode('pan')}
              onMapAddStop={handleMapAddStop}
              onSelectStop={setHighlightedStopId}
              onDeleteStop={handleDeleteStop}
            />

            {stops.length > 0 && (
              <div className="no-print absolute bottom-4 left-4 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-2 shadow-sm flex flex-wrap items-center gap-3 text-xs text-slate-700">
                {PRIEST_PALETTE.slice(0, config.priestCount).map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: p.color }}
                    />
                    Ks. {p.id}
                  </span>
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      <ArchitectureGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
      />
    </div>
  );
}

export default function App() {
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {!MAPS_API_KEY ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md bg-white border border-slate-200 rounded-xl p-6 text-center space-y-2">
            <h1 className="text-base font-semibold text-slate-900">
              Brak klucza Google Maps API
            </h1>
            <p className="text-xs text-slate-600">
              Skonfiguruj zmienną środowiskową{' '}
              <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">
                VITE_GOOGLE_MAPS_API_KEY
              </code>{' '}
              w ustawieniach Google Maps Platform, aby uruchomić mapę i
              wyznaczanie tras.
            </p>
          </div>
        </div>
      ) : (
        <APIProvider
          apiKey={MAPS_API_KEY}
          language="pl"
          region="PL"
          libraries={['places', 'routes', 'marker', 'geometry']}
        >
          <ParishPlannerWorkspace />
        </APIProvider>
      )}
    </div>
  );
}
