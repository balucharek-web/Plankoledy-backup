import React, { useCallback, useEffect, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  CalendarCheck,
  HelpCircle,
  LogIn,
  LogOut,
  Map as MapIcon,
  SlidersHorizontal,
} from 'lucide-react';
import { ArchitectureGuideModal } from './components/ArchitectureGuideModal';
import { ParishMap } from './components/ParishMap';
import { SelectedPlaceData } from './components/PlaceSearchInput';
import { PrintScheduleSheet } from './components/PrintScheduleSheet';
import { SidebarRoutes } from './components/SidebarRoutes';
import { SidebarSetup } from './components/SidebarSetup';
import { SidebarStops } from './components/SidebarStops';
import {
  FIREBASE_CONSOLE_UPGRADE_URL,
  auth,
  googleProvider,
} from './firebase';
import { useParishRouteOptimizer } from './hooks/useParishRouteOptimizer';
import { reverseGeocodeHouseAddress } from './services/overpassStreets';
import {
  DEFAULT_PLAN_CONFIG,
  batchUpdateStopFieldInFirestore,
  clearParishStopsInFirestore,
  createStopInFirestore,
  createStopsBatchInFirestore,
  deleteParishFromFirestore,
  deleteStopInFirestore,
  makeParishDocId,
  sanitizeDocId,
  saveParishToFirestore,
  subscribeParishStops,
  subscribeUserParishes,
  updateParishBoundaryInFirestore,
  updateParishConfigInFirestore,
  updateStopInFirestore,
} from './services/parishStorage';
import {
  LatLng,
  MapInteractionMode,
  PRIEST_PALETTE,
  ParishCenter,
  PlanConfig,
  SavedParishRecord,
  VisitStop,
} from './types/parish';
import {
  createPresetBoundaryPolygon,
  isPointInsideBoundary,
  partitionStopsBySector,
  scaleBoundaryFromCenter,
} from './utils/spatial';

type SidebarTab = 'setup' | 'stops' | 'routes';
type MainView = 'workspace' | 'schedule';
type MobilePane = 'panel' | 'map';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

function clearLegacyLocalStorage() {
  try {
    window.localStorage.removeItem('planer_koledy_plan_v1');
    window.localStorage.removeItem('planer_koledy_parishes_v2');
  } catch {
    // Ignore storage access errors
  }
}

function ParishPlannerWorkspace({
  authUser,
  onSignInGoogle,
  onSignOutGoogle,
}: {
  authUser: User | null;
  onSignInGoogle: () => void;
  onSignOutGoogle: () => void;
}) {
  const [savedParishes, setSavedParishes] = useState<SavedParishRecord[]>([]);
  const [activeParishId, setActiveParishId] = useState<string | null>(null);

  const [parish, setParish] = useState<ParishCenter | null>(null);
  const [boundary, setBoundary] = useState<LatLng[]>([]);
  const [config, setConfig] = useState<PlanConfig>(DEFAULT_PLAN_CONFIG);
  const [stops, setStops] = useState<VisitStop[]>([]);

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('setup');
  const [mainView, setMainView] = useState<MainView>('workspace');
  const [mobilePane, setMobilePane] = useState<MobilePane>('panel');
  const [interactionMode, setInteractionMode] =
    useState<MapInteractionMode>('pan');
  const [highlightedStopId, setHighlightedStopId] = useState<string | null>(
    null
  );
  const [guideOpen, setGuideOpen] = useState(false);

  const boundaryDebounceRef = useRef<number | null>(null);
  const activeParishIdRef = useRef<string | null>(activeParishId);
  activeParishIdRef.current = activeParishId;

  const {
    routes,
    routeObjects,
    isComputing,
    error: routeError,
    computeAllRoutes,
    clearRoutes,
  } = useParishRouteOptimizer();

  // Parishes must only be persisted for signed-in users: purge any old local cache
  useEffect(() => {
    clearLegacyLocalStorage();
  }, []);

  // Subscribe to signed-in user's parishes in Firestore, and clear state on sign-out
  useEffect(() => {
    if (!authUser) {
      setSavedParishes([]);
      setActiveParishId(null);
      setParish(null);
      setBoundary([]);
      setConfig(DEFAULT_PLAN_CONFIG);
      setStops([]);
      clearRoutes();
      return;
    }

    let cancelled = false;
    let unsubscribeParishes: (() => void) | undefined;

    void (async () => {
      // If user already picked a parish right before signing in, save it to their account
      if (parish && !activeParishIdRef.current) {
        const newId = makeParishDocId(parish, authUser.uid);
        const rec: SavedParishRecord = {
          id: newId,
          parish,
          boundary,
          config,
          updatedAtMs: Date.now(),
        };
        activeParishIdRef.current = newId;
        setActiveParishId(newId);
        try {
          await saveParishToFirestore(authUser.uid, rec, true);
          if (stops.length > 0) {
            await createStopsBatchInFirestore(authUser.uid, newId, stops);
          }
        } catch {
          // Handled inside parishStorage
        }
      }

      if (cancelled) return;

      unsubscribeParishes = subscribeUserParishes(authUser.uid, (cloudList) => {
        setSavedParishes(cloudList);

        const currentId = activeParishIdRef.current;
        const matched =
          cloudList.find((r) => r.id === currentId) ?? cloudList[0] ?? null;

        if (matched && matched.id !== currentId) {
          setActiveParishId(matched.id);
          setParish(matched.parish);
          setBoundary(matched.boundary);
          setConfig(matched.config);
        } else if (matched) {
          setParish(matched.parish);
          setBoundary(matched.boundary);
          setConfig(matched.config);
        } else {
          setActiveParishId(null);
          setParish(null);
          setBoundary([]);
          setStops([]);
        }
      });
    })();

    return () => {
      cancelled = true;
      if (unsubscribeParishes) unsubscribeParishes();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid]);

  // Subscribe to stops of the active parish when signed in
  useEffect(() => {
    if (!authUser || !activeParishId) return;

    const unsubscribeStops = subscribeParishStops(
      authUser.uid,
      activeParishId,
      (cloudStops) => {
        setStops(cloudStops);
      }
    );

    return () => unsubscribeStops();
  }, [authUser, activeParishId]);

  const handleSelectParish = useCallback(
    (place: SelectedPlaceData) => {
      const nextParish: ParishCenter = {
        name: place.name,
        address: place.address,
        location: place.location,
        placeId: place.placeId,
      };

      clearRoutes();

      if (!authUser) {
        // Ephemeral session only when signed out (not saved/remembered)
        setActiveParishId(null);
        setParish(nextParish);
        setBoundary([]);
        setConfig(DEFAULT_PLAN_CONFIG);
        setStops([]);
        return;
      }

      const candidateId = makeParishDocId(nextParish, authUser.uid);
      const existing = savedParishes.find(
        (r) =>
          r.id === candidateId ||
          (place.placeId && r.parish.placeId === place.placeId)
      );

      if (existing) {
        setActiveParishId(existing.id);
        setParish(existing.parish);
        setBoundary(existing.boundary);
        setConfig(existing.config);
        return;
      }

      const newRecord: SavedParishRecord = {
        id: candidateId,
        parish: nextParish,
        boundary: [],
        config: DEFAULT_PLAN_CONFIG,
        updatedAtMs: Date.now(),
      };

      setSavedParishes((prev) => [newRecord, ...prev]);
      setActiveParishId(candidateId);
      setParish(nextParish);
      setBoundary([]);
      setConfig(DEFAULT_PLAN_CONFIG);
      setStops([]);

      void saveParishToFirestore(authUser.uid, newRecord, true).catch(() => {});
    },
    [authUser, clearRoutes, savedParishes]
  );

  const handleSelectSavedParish = useCallback(
    (parishId: string) => {
      if (!authUser) return;
      const target = savedParishes.find((r) => r.id === parishId);
      if (!target) return;

      clearRoutes();
      setInteractionMode('pan');
      setHighlightedStopId(null);
      setActiveParishId(target.id);
      setParish(target.parish);
      setBoundary(target.boundary);
      setConfig(target.config);
    },
    [authUser, clearRoutes, savedParishes]
  );

  const handleDeleteSavedParish = useCallback(
    (parishId: string) => {
      if (!authUser) return;
      const remaining = savedParishes.filter((r) => r.id !== parishId);
      setSavedParishes(remaining);

      if (activeParishId === parishId) {
        clearRoutes();
        const fallback = remaining[0] ?? null;
        setActiveParishId(fallback?.id ?? null);
        setParish(fallback?.parish ?? null);
        setBoundary(fallback?.boundary ?? []);
        setConfig(fallback?.config ?? DEFAULT_PLAN_CONFIG);
        setStops([]);
      }

      void deleteParishFromFirestore(authUser.uid, parishId).catch(() => {});
    },
    [activeParishId, authUser, clearRoutes, savedParishes]
  );

  const updateBoundaryAndRecheckStops = useCallback(
    (points: LatLng[], debounceCloud = false) => {
      setBoundary(points);

      const currentId = activeParishIdRef.current;
      if (authUser && currentId) {
        setSavedParishes((prev) =>
          prev.map((r) =>
            r.id === currentId
              ? { ...r, boundary: points, updatedAtMs: Date.now() }
              : r
          )
        );
      }

      const changedStops: VisitStop[] = [];
      setStops((prev) =>
        prev.map((s) => {
          const nextIn = isPointInsideBoundary(s.location, points);
          if (nextIn !== (s.inBoundary ?? true)) {
            changedStops.push({ ...s, inBoundary: nextIn });
          }
          return { ...s, inBoundary: nextIn };
        })
      );

      if (authUser && currentId) {
        const persistBoundary = () => {
          void updateParishBoundaryInFirestore(currentId, points).catch(
            () => {}
          );
          if (changedStops.length > 0) {
            void batchUpdateStopFieldInFirestore(
              currentId,
              changedStops,
              'inBoundary'
            ).catch(() => {});
          }
        };

        if (boundaryDebounceRef.current) {
          window.clearTimeout(boundaryDebounceRef.current);
        }
        if (debounceCloud) {
          boundaryDebounceRef.current = window.setTimeout(persistBoundary, 500);
        } else {
          persistBoundary();
        }
      }
    },
    [authUser]
  );

  const handleBoundaryComplete = useCallback(
    (points: LatLng[]) => {
      setInteractionMode('pan');
      updateBoundaryAndRecheckStops(points, false);
    },
    [updateBoundaryAndRecheckStops]
  );

  const handleCreatePresetBoundary = useCallback(
    (radiusMeters = 500) => {
      if (!parish) return;
      const preset = createPresetBoundaryPolygon(
        parish.location,
        radiusMeters,
        8
      );
      setInteractionMode('pan');
      updateBoundaryAndRecheckStops(preset, false);
      setMobilePane('map');
    },
    [parish, updateBoundaryAndRecheckStops]
  );

  const handleScaleBoundary = useCallback(
    (factor: number) => {
      if (boundary.length < 3) return;
      const scaled = scaleBoundaryFromCenter(
        boundary,
        factor,
        parish?.location
      );
      updateBoundaryAndRecheckStops(scaled, false);
    },
    [boundary, parish?.location, updateBoundaryAndRecheckStops]
  );

  const handleClearBoundary = useCallback(() => {
    updateBoundaryAndRecheckStops([], false);
  }, [updateBoundaryAndRecheckStops]);

  const handleChangeConfig = useCallback(
    (nextConfig: PlanConfig) => {
      setConfig(nextConfig);
      clearRoutes();
      const currentId = activeParishIdRef.current;
      if (authUser && currentId) {
        setSavedParishes((prev) =>
          prev.map((r) =>
            r.id === currentId
              ? { ...r, config: nextConfig, updatedAtMs: Date.now() }
              : r
          )
        );
        void updateParishConfigInFirestore(currentId, nextConfig).catch(
          () => {}
        );
      }
    },
    [authUser, clearRoutes]
  );

  const nextPriestRoundRobin = useCallback(
    (currentCount: number) => (currentCount % config.priestCount) + 1,
    [config.priestCount]
  );

  const handleAddPlaceStop = useCallback(
    (place: SelectedPlaceData) => {
      const currentId = activeParishIdRef.current;
      const newStopId = sanitizeDocId(
        `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      );
      let createdStop: VisitStop | null = null;

      setStops((prev) => {
        const nextStop: VisitStop = {
          id: newStopId,
          label: place.name,
          address: place.address,
          location: place.location,
          placeId: place.placeId,
          durationMinutes: config.defaultVisitMinutes,
          priestId: nextPriestRoundRobin(prev.length),
          inBoundary: isPointInsideBoundary(place.location, boundary),
        };
        createdStop = nextStop;
        return [...prev, nextStop];
      });
      clearRoutes();

      if (authUser && currentId && createdStop) {
        void createStopInFirestore(authUser.uid, currentId, createdStop).catch(
          () => {}
        );
      }
    },
    [
      authUser,
      config.defaultVisitMinutes,
      nextPriestRoundRobin,
      boundary,
      clearRoutes,
    ]
  );

  const handleBatchAddStops = useCallback(
    (places: SelectedPlaceData[]) => {
      const currentId = activeParishIdRef.current;
      let addedStops: VisitStop[] = [];
      let repartitionedStops: VisitStop[] = [];

      setStops((prev) => {
        const baseTs = Date.now();
        addedStops = places.map((place, idx) => ({
          id: sanitizeDocId(
            `s_${baseTs}_${idx}_${Math.random().toString(36).slice(2, 6)}`
          ),
          label: place.name,
          address: place.address,
          location: place.location,
          placeId: place.placeId,
          durationMinutes: config.defaultVisitMinutes,
          priestId: ((prev.length + idx) % config.priestCount) + 1,
          inBoundary: isPointInsideBoundary(place.location, boundary),
        }));
        const combined = [...prev, ...addedStops];
        if (parish && config.priestCount > 1) {
          repartitionedStops = partitionStopsBySector(
            parish.location,
            combined,
            config.priestCount
          );
          return repartitionedStops;
        }
        return combined;
      });
      clearRoutes();

      if (authUser && currentId && addedStops.length > 0) {
        const toSave =
          repartitionedStops.length > 0 ? repartitionedStops : addedStops;
        const newlyAddedIds = new Set(addedStops.map((s) => s.id));
        const newOnly = toSave.filter((s) => newlyAddedIds.has(s.id));
        const existingToReassign = toSave.filter(
          (s) => !newlyAddedIds.has(s.id)
        );
        void createStopsBatchInFirestore(authUser.uid, currentId, newOnly)
          .then(() => {
            if (existingToReassign.length > 0) {
              return batchUpdateStopFieldInFirestore(
                currentId,
                existingToReassign,
                'priestId'
              );
            }
          })
          .catch(() => {});
      }
    },
    [
      authUser,
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
      const currentId = activeParishIdRef.current;
      const stopId = sanitizeDocId(
        `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      );
      let initialStop: VisitStop | null = null;

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
        initialStop = nextStop;
        return [...prev, nextStop];
      });
      clearRoutes();

      void reverseGeocodeHouseAddress(location).then((resolved) => {
        let finalizedStop: VisitStop | null = null;
        setStops((prev) =>
          prev.map((s) => {
            if (s.id !== stopId) return s;
            finalizedStop = {
              ...s,
              label: resolved.label,
              address: resolved.address,
            };
            return finalizedStop;
          })
        );

        const targetStop =
          finalizedStop ??
          (initialStop
            ? {
                ...(initialStop as VisitStop),
                label: resolved.label,
                address: resolved.address,
              }
            : null);

        if (authUser && currentId && targetStop) {
          void createStopInFirestore(authUser.uid, currentId, targetStop).catch(
            () => {}
          );
        }
      });
    },
    [
      authUser,
      config.defaultVisitMinutes,
      nextPriestRoundRobin,
      boundary,
      clearRoutes,
    ]
  );

  const handleUpdateStop = useCallback(
    (id: string, patch: Partial<VisitStop>) => {
      const currentId = activeParishIdRef.current;
      let updatedStop: VisitStop | null = null;

      setStops((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          updatedStop = { ...s, ...patch };
          return updatedStop;
        })
      );
      clearRoutes();

      if (authUser && currentId && updatedStop) {
        void updateStopInFirestore(currentId, updatedStop).catch(() => {});
      }
    },
    [authUser, clearRoutes]
  );

  const handleDeleteStop = useCallback(
    (id: string) => {
      const currentId = activeParishIdRef.current;
      setStops((prev) => prev.filter((s) => s.id !== id));
      clearRoutes();

      if (authUser && currentId) {
        void deleteStopInFirestore(currentId, id).catch(() => {});
      }
    },
    [authUser, clearRoutes]
  );

  const handleClearStops = useCallback(() => {
    const currentId = activeParishIdRef.current;
    const idsToDelete = stops.map((s) => s.id);
    setStops([]);
    clearRoutes();

    if (authUser && currentId && idsToDelete.length > 0) {
      void clearParishStopsInFirestore(currentId, idsToDelete).catch(() => {});
    }
  }, [authUser, clearRoutes, stops]);

  const handleAutoPartition = useCallback(() => {
    if (!parish) return;
    const currentId = activeParishIdRef.current;
    let partitioned: VisitStop[] = [];

    setStops((prev) => {
      partitioned = partitionStopsBySector(
        parish.location,
        prev,
        config.priestCount
      );
      return partitioned;
    });
    clearRoutes();

    if (authUser && currentId && partitioned.length > 0) {
      void batchUpdateStopFieldInFirestore(
        currentId,
        partitioned,
        'priestId'
      ).catch(() => {});
    }
  }, [authUser, parish, config.priestCount, clearRoutes]);

  const handleComputeRoutes = useCallback(async () => {
    if (!parish || stops.length === 0) return;
    setInteractionMode('pan');
    setMainView('workspace');
    setSidebarTab('routes');
    setMobilePane('panel');
    await computeAllRoutes(parish, stops, config);
  }, [parish, stops, config, computeAllRoutes]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Three-Zone Top Bar */}
      <header className="no-print h-14 px-3 sm:px-6 bg-white border-b border-slate-200 flex items-center justify-between gap-2 sm:gap-6 shrink-0">
        <button
          type="button"
          onClick={() => setMainView('workspace')}
          className="text-sm sm:text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 text-left"
        >
          Planer Kolędy
        </button>

        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600">
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

        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            aria-label="Jak to działa"
            className="lg:hidden p-2 text-slate-500 hover:text-slate-900 rounded-lg"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {authUser ? (
            <button
              type="button"
              onClick={onSignOutGoogle}
              title={`Zalogowano: ${authUser.email ?? ''}`}
              className="px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline max-w-[110px] truncate">
                {authUser.displayName?.split(' ')[0] || 'Konto'}
              </span>
              <span className="hidden sm:inline text-slate-400">·</span>
              <span>Wyloguj</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignInGoogle}
              className="px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <LogIn className="w-3.5 h-3.5 text-amber-700" />
              <span>Zaloguj</span>
              <span className="hidden sm:inline">Google</span>
            </button>
          )}

          <button
            type="button"
            disabled={!parish || stops.length === 0 || isComputing}
            onClick={handleComputeRoutes}
            className="px-3 sm:px-4 py-2 text-xs font-medium text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {isComputing ? 'Liczenie...' : 'Wyznacz trasy'}
          </button>
        </div>
      </header>

      {/* Mobile View Switcher (< lg): Panel / Mapa / Harmonogram */}
      <div className="no-print lg:hidden bg-white border-b border-slate-200 px-3 py-1.5 grid grid-cols-3 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => {
            setMainView('workspace');
            setMobilePane('panel');
          }}
          className={`min-h-[36px] px-2 py-1.5 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
            mainView === 'workspace' && mobilePane === 'panel'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Panel
        </button>
        <button
          type="button"
          onClick={() => {
            setMainView('workspace');
            setMobilePane('map');
          }}
          className={`min-h-[36px] px-2 py-1.5 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
            mainView === 'workspace' && mobilePane === 'map'
              ? 'bg-amber-700 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MapIcon className="w-3.5 h-3.5" />
          Mapa
        </button>
        <button
          type="button"
          onClick={() => setMainView('schedule')}
          className={`min-h-[36px] px-2 py-1.5 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
            mainView === 'schedule'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <CalendarCheck className="w-3.5 h-3.5" />
          Harmonogram
        </button>
      </div>

      {mainView === 'schedule' ? (
        <main className="flex-1 overflow-y-auto bg-slate-50">
          <PrintScheduleSheet
            parish={parish}
            config={config}
            routes={routes}
            onBackToMap={() => {
              setMainView('workspace');
              setMobilePane('map');
            }}
          />
        </main>
      ) : (
        <main className="relative flex-1 min-h-0 flex flex-col lg:flex-row">
          <aside
            className={`no-print w-full lg:w-[400px] xl:w-[420px] bg-white lg:border-r border-slate-200 flex-col min-h-0 shrink-0 ${
              mobilePane === 'panel'
                ? 'flex absolute inset-0 z-20 lg:static'
                : 'hidden lg:flex'
            }`}
          >
            <div className="p-2 border-b border-slate-200 bg-slate-50/70 grid grid-cols-3 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setSidebarTab('setup')}
                className={`min-h-[36px] py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
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
                className={`min-h-[36px] py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums ${
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
                className={`min-h-[36px] py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums ${
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
                  activeParishId={activeParishId}
                  savedParishes={savedParishes}
                  boundary={boundary}
                  config={config}
                  interactionMode={interactionMode}
                  isSignedIn={Boolean(authUser)}
                  userEmail={authUser?.email ?? null}
                  onSignInGoogle={onSignInGoogle}
                  onSelectParish={handleSelectParish}
                  onSelectSavedParish={handleSelectSavedParish}
                  onDeleteSavedParish={handleDeleteSavedParish}
                  onCreatePresetBoundary={handleCreatePresetBoundary}
                  onScaleBoundary={handleScaleBoundary}
                  onToggleDrawBoundary={() => {
                    setInteractionMode((m) => {
                      const next = m === 'draw_boundary' ? 'pan' : 'draw_boundary';
                      if (next === 'draw_boundary') setMobilePane('map');
                      return next;
                    });
                  }}
                  onClearBoundary={handleClearBoundary}
                  onChangeConfig={handleChangeConfig}
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
                  onToggleMapAddMode={() => {
                    setInteractionMode((m) => {
                      const next = m === 'add_stop' ? 'pan' : 'add_stop';
                      if (next === 'add_stop') setMobilePane('map');
                      return next;
                    });
                  }}
                  onUpdateStop={handleUpdateStop}
                  onDeleteStop={handleDeleteStop}
                  onClearStops={handleClearStops}
                  onAutoPartition={handleAutoPartition}
                  onSelectStop={(id) => {
                    setHighlightedStopId(id);
                    setMobilePane('map');
                  }}
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
                  onSelectStop={(id) => {
                    setHighlightedStopId(id);
                    setMobilePane('map');
                  }}
                />
              )}
            </div>
          </aside>

          <section className="flex-1 min-h-0 relative h-full w-full">
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
              onScaleBoundary={handleScaleBoundary}
              onClearBoundary={handleClearBoundary}
              onBoundaryComplete={handleBoundaryComplete}
              onBoundaryUpdate={(pts) => updateBoundaryAndRecheckStops(pts, true)}
              onCancelInteraction={() => setInteractionMode('pan')}
              onMapAddStop={handleMapAddStop}
              onSelectStop={setHighlightedStopId}
              onDeleteStop={handleDeleteStop}
            />

            {stops.length > 0 && (
              <div className="no-print absolute top-3 left-3 sm:top-auto sm:bottom-4 sm:left-4 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-sm flex flex-wrap items-center gap-2.5 text-xs text-slate-700 pointer-events-none">
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
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const [firebaseQuotaExceeded, setFirebaseQuotaExceeded] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const onMapsQuota = () => setMapsQuotaExceeded(true);
    const onFirebaseQuota = () => setFirebaseQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onMapsQuota);
    window.addEventListener('firebase-quota-exceeded', onFirebaseQuota);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', onMapsQuota);
      window.removeEventListener('firebase-quota-exceeded', onFirebaseQuota);
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
    });
    return () => unsub();
  }, []);

  const handleSignInGoogle = useCallback(async () => {
    try {
      setAuthError(null);
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('popup-closed-by-user')) {
        setAuthError(
          'Nie udało się zalogować przez Google. Upewnij się, że wyskakujące okna nie są zablokowane.'
        );
      }
    }
  }, []);

  const handleSignOutGoogle = useCallback(async () => {
    try {
      await signOut(auth);
    } catch {
      // Ignore sign-out errors
    }
  }, []);

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {mapsQuotaExceeded && (
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

      {firebaseQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Dzienny limit bezpłatnych operacji w bazie Firestore został
            przekroczony (zresetuje się jutro). Szczegóły i opcje planu Spark /
            rozszerzenia sprawdzisz w{' '}
            <a
              href={FIREBASE_CONSOLE_UPGRADE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              konsoli Firebase
            </a>
            .
          </span>
        </div>
      )}

      {authError && (
        <div className="bg-red-50 border-b border-red-200 text-red-800 px-4 py-2 text-xs text-center flex items-center justify-center gap-3">
          <span>{authError}</span>
          <button
            type="button"
            onClick={() => setAuthError(null)}
            className="underline font-medium"
          >
            Zamknij
          </button>
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
          <ParishPlannerWorkspace
            authUser={authUser}
            onSignInGoogle={handleSignInGoogle}
            onSignOutGoogle={handleSignOutGoogle}
          />
        </APIProvider>
      )}
    </div>
  );
}
