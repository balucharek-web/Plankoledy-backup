import React, { useCallback, useEffect, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  CalendarCheck,
  Church,
  HelpCircle,
  LayoutDashboard,
  LogIn,
  LogOut,
  Map as MapIcon,
  MapPin,
  Menu,
  Route,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { ArchitectureGuideModal } from './components/ArchitectureGuideModal';
import { OsmParishMap } from './components/OsmParishMap';
import { ParishMap, RoutePolylineEntry } from './components/ParishMap';
import { PlanDashboard, WorkspaceSection } from './components/PlanDashboard';
import { SelectedPlaceData } from './components/PlaceSearchInput';
import { PrintScheduleSheet } from './components/PrintScheduleSheet';
import { SidebarRoutes } from './components/SidebarRoutes';
import { SidebarSettings } from './components/SidebarSettings';
import { SidebarSetup } from './components/SidebarSetup';
import { SidebarStops } from './components/SidebarStops';
import { MapEngineProvider } from './contexts/MapEngineContext';
import {
  FIREBASE_CONSOLE_UPGRADE_URL,
  auth,
  googleProvider,
} from './firebase';
import { useOsmRouteOptimizer } from './hooks/useOsmRouteOptimizer';
import { useParishRouteOptimizer } from './hooks/useParishRouteOptimizer';
import {
  fetchStreetHousesAtLocation,
  reverseGeocodeHouseAddress,
} from './services/overpassStreets';
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
  PriestRouteResult,
  SavedParishRecord,
  StreetPickFeedback,
  VisitStop,
} from './types/parish';
import {
  createPresetBoundaryPolygon,
  isPointInsideBoundary,
  partitionStopsBySector,
  scaleBoundaryFromCenter,
} from './utils/spatial';

type MobilePane = 'panel' | 'map';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

const SECTION_TITLES: Record<WorkspaceSection, string> = {
  overview: 'Plan kolędy',
  parish: 'Parafia i teren',
  stops: 'Układanie planu',
  routes: 'Trasy księży',
  schedule: 'Harmonogram',
  settings: 'Ustawienia kolędy',
};

interface RouteOptimizerHandle {
  routes: PriestRouteResult[];
  routeObjects: RoutePolylineEntry[];
  isComputing: boolean;
  error: string | null;
  computeAllRoutes: (
    parish: ParishCenter,
    stops: VisitStop[],
    config: PlanConfig
  ) => Promise<void>;
  clearRoutes: () => void;
}

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
  optimizer,
  useGoogleMaps,
}: {
  authUser: User | null;
  onSignInGoogle: () => void;
  onSignOutGoogle: () => void;
  optimizer: RouteOptimizerHandle;
  useGoogleMaps: boolean;
}) {
  const [savedParishes, setSavedParishes] = useState<SavedParishRecord[]>([]);
  const [activeParishId, setActiveParishId] = useState<string | null>(null);

  const [parish, setParish] = useState<ParishCenter | null>(null);
  const [boundary, setBoundary] = useState<LatLng[]>([]);
  const [config, setConfig] = useState<PlanConfig>(DEFAULT_PLAN_CONFIG);
  const [stops, setStops] = useState<VisitStop[]>([]);

  const [activeSection, setActiveSection] =
    useState<WorkspaceSection>('overview');
  const [mobilePane, setMobilePane] = useState<MobilePane>('panel');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [interactionMode, setInteractionMode] =
    useState<MapInteractionMode>('pan');
  const [highlightedStopId, setHighlightedStopId] = useState<string | null>(
    null
  );
  const [streetPickFeedback, setStreetPickFeedback] =
    useState<StreetPickFeedback | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const boundaryDebounceRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const activeParishIdRef = useRef<string | null>(activeParishId);
  activeParishIdRef.current = activeParishId;
  const stopsRef = useRef<VisitStop[]>(stops);
  stopsRef.current = stops;

  const navigateToSection = useCallback((section: WorkspaceSection) => {
    setActiveSection(section);
    setMobilePane('panel');
    setMobileMenuOpen(false);
  }, []);

  const showStreetFeedback = useCallback(
    (feedback: StreetPickFeedback, autoHideMs = 6000) => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = null;
      }
      setStreetPickFeedback(feedback);
      if (feedback.status !== 'loading' && autoHideMs > 0) {
        feedbackTimerRef.current = window.setTimeout(() => {
          setStreetPickFeedback(null);
        }, autoHideMs);
      }
    },
    []
  );

  const {
    routes,
    routeObjects,
    isComputing,
    error: routeError,
    computeAllRoutes,
    clearRoutes,
  } = optimizer;

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

  const handleMapPickStreet = useCallback(
    async (location: LatLng) => {
      showStreetFeedback(
        {
          status: 'loading',
          message: 'Rozpoznaję ulicę i pobieram wszystkie numery domów...',
        },
        0
      );

      try {
        const result = await fetchStreetHousesAtLocation({
          location,
          boundary,
          parishCenter: parish?.location,
        });

        if (result.houses.length === 0) {
          showStreetFeedback(
            {
              status: 'info',
              message: `Rozpoznano „${result.streetName}”, ale brak przypisanych numerów domów przy tej ulicy.`,
            },
            7000
          );
          return;
        }

        const existingStops = stopsRef.current;
        const existingAddresses = new Set(
          existingStops.map((s) => s.address.trim().toLowerCase())
        );

        const newHouses = result.houses.filter((h) => {
          const normAddr = h.fullAddress.trim().toLowerCase();
          if (existingAddresses.has(normAddr)) return false;
          const tooClose = existingStops.some(
            (s) =>
              Math.abs(s.location.lat - h.location.lat) < 0.00006 &&
              Math.abs(s.location.lng - h.location.lng) < 0.00008
          );
          return !tooClose;
        });

        const skippedCount = result.houses.length - newHouses.length;

        if (newHouses.length === 0) {
          showStreetFeedback(
            {
              status: 'info',
              message: `Wszystkie ${result.houses.length} domy z „${result.streetName}” są już na liście.`,
            },
            5500
          );
          return;
        }

        const placesToAdd: SelectedPlaceData[] = newHouses.map((h) => ({
          name: h.label,
          address: h.fullAddress,
          location: h.location,
          placeId: '',
        }));

        handleBatchAddStops(placesToAdd);

        const boundaryNote = result.filteredByBoundary ? ' w obrysie parafii' : '';
        const skippedNote =
          skippedCount > 0 ? ` (${skippedCount} już było na liście)` : '';

        showStreetFeedback(
          {
            status: 'success',
            message: `Dodano ${newHouses.length} domów z „${result.streetName}”${boundaryNote}${skippedNote}.`,
          },
          6500
        );
      } catch (err) {
        showStreetFeedback(
          {
            status: 'error',
            message:
              err instanceof Error
                ? err.message
                : 'Nie udało się pobrać domów z wybranej ulicy.',
          },
          6500
        );
      }
    },
    [boundary, handleBatchAddStops, parish?.location, showStreetFeedback]
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

  const handleDeleteStreetStops = useCallback(
    (stopIds: string[]) => {
      if (stopIds.length === 0) return;
      const idSet = new Set(stopIds);
      const currentId = activeParishIdRef.current;
      setStops((prev) => prev.filter((s) => !idSet.has(s.id)));
      clearRoutes();

      if (authUser && currentId) {
        void clearParishStopsInFirestore(currentId, stopIds).catch(() => {});
      }
    },
    [authUser, clearRoutes]
  );

  const handleToggleStreetIncluded = useCallback(
    (stopIds: string[], included: boolean) => {
      if (stopIds.length === 0) return;
      const idSet = new Set(stopIds);
      const currentId = activeParishIdRef.current;
      const changed: VisitStop[] = [];

      setStops((prev) =>
        prev.map((s) => {
          if (!idSet.has(s.id)) return s;
          if ((s.included !== false) === included) return s;
          const next = { ...s, included };
          changed.push(next);
          return next;
        })
      );
      clearRoutes();

      if (authUser && currentId && changed.length > 0) {
        void batchUpdateStopFieldInFirestore(
          currentId,
          changed,
          'included'
        ).catch(() => {});
      }
    },
    [authUser, clearRoutes]
  );

  const handleAssignStreetPriest = useCallback(
    (stopIds: string[], priestId: number) => {
      if (stopIds.length === 0) return;
      const idSet = new Set(stopIds);
      const currentId = activeParishIdRef.current;
      const changed: VisitStop[] = [];

      setStops((prev) =>
        prev.map((s) => {
          if (!idSet.has(s.id)) return s;
          if (s.priestId === priestId) return s;
          const next = { ...s, priestId };
          changed.push(next);
          return next;
        })
      );
      clearRoutes();

      if (authUser && currentId && changed.length > 0) {
        void batchUpdateStopFieldInFirestore(
          currentId,
          changed,
          'priestId'
        ).catch(() => {});
      }
    },
    [authUser, clearRoutes]
  );

  const handleSetAllIncluded = useCallback(
    (included: boolean) => {
      const currentId = activeParishIdRef.current;
      const changed: VisitStop[] = [];

      setStops((prev) =>
        prev.map((s) => {
          if ((s.included !== false) === included) return s;
          const next = { ...s, included };
          changed.push(next);
          return next;
        })
      );
      clearRoutes();

      if (authUser && currentId && changed.length > 0) {
        void batchUpdateStopFieldInFirestore(
          currentId,
          changed,
          'included'
        ).catch(() => {});
      }
    },
    [authUser, clearRoutes]
  );

  const handleAutoPartition = useCallback(() => {
    if (!parish) return;
    const currentId = activeParishIdRef.current;
    let changedActive: VisitStop[] = [];

    setStops((prev) => {
      const activeOnly = prev.filter((s) => s.included !== false);
      const partitionedActive = partitionStopsBySector(
        parish.location,
        activeOnly,
        config.priestCount
      );
      const byId = new Map(partitionedActive.map((s) => [s.id, s]));
      changedActive = partitionedActive;
      return prev.map((s) => byId.get(s.id) ?? s);
    });
    clearRoutes();

    if (authUser && currentId && changedActive.length > 0) {
      void batchUpdateStopFieldInFirestore(
        currentId,
        changedActive,
        'priestId'
      ).catch(() => {});
    }
  }, [authUser, parish, config.priestCount, clearRoutes]);

  const activeStopsCount = stops.filter((s) => s.included !== false).length;

  const handleComputeRoutes = useCallback(async () => {
    const activeStops = stops.filter((s) => s.included !== false);
    if (!parish || activeStops.length === 0) return;
    setInteractionMode('pan');
    setActiveSection('routes');
    setMobilePane('panel');
    await computeAllRoutes(parish, activeStops, config);
  }, [parish, stops, config, computeAllRoutes]);

  const navItems: Array<{
    id: WorkspaceSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { id: 'overview', label: 'Plan kolędy', icon: LayoutDashboard },
    { id: 'parish', label: 'Parafia i teren', icon: Church },
    {
      id: 'stops',
      label: 'Układanie planu',
      icon: MapPin,
      count: activeStopsCount > 0 ? activeStopsCount : undefined,
    },
    {
      id: 'routes',
      label: 'Trasy księży',
      icon: Route,
      count: routes.length > 0 ? routes.length : undefined,
    },
    { id: 'schedule', label: 'Harmonogram', icon: CalendarCheck },
    { id: 'settings', label: 'Ustawienia planu', icon: SlidersHorizontal },
  ];

  const isScheduleView =
    activeSection === 'schedule' && mobilePane === 'panel';

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-50">
      {/* Three-Zone Top Bar */}
      <header className="no-print h-14 px-3 sm:px-5 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Otwórz menu"
            className="lg:hidden min-w-[40px] min-h-[40px] -ml-1 inline-flex items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => navigateToSection('overview')}
            className="text-sm sm:text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 text-left"
          >
            Planer Kolędy
          </button>

          {parish && (
            <span className="hidden md:inline-flex items-center gap-2 text-xs text-slate-500 min-w-0">
              <span aria-hidden="true">/</span>
              <span className="truncate max-w-[260px] text-slate-700 font-medium">
                {parish.name}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {authUser ? (
            <button
              type="button"
              onClick={onSignOutGoogle}
              title={`Zalogowano: ${authUser.email ?? ''}`}
              className="min-h-[38px] px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline max-w-[120px] truncate">
                {authUser.displayName?.split(' ')[0] || 'Konto'}
              </span>
              <span className="hidden sm:inline text-slate-400">·</span>
              <span>Wyloguj</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignInGoogle}
              className="min-h-[38px] px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <LogIn className="w-3.5 h-3.5 text-amber-700" />
              <span>Zaloguj</span>
              <span className="hidden sm:inline">Google</span>
            </button>
          )}

          <button
            type="button"
            disabled={!parish || activeStopsCount === 0 || isComputing}
            onClick={handleComputeRoutes}
            className="min-h-[38px] px-3 sm:px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl transition-colors whitespace-nowrap shrink-0"
          >
            {isComputing ? 'Liczenie...' : 'Wyznacz trasy'}
          </button>
        </div>
      </header>

      {/* Main App Body: Desktop Left Menu Rail + Panel + Map */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Desktop App Sidebar Menu */}
        <nav
          aria-label="Menu główne"
          className="no-print hidden lg:flex w-[224px] bg-slate-950 text-slate-300 flex-col justify-between shrink-0 border-r border-slate-800"
        >
          <div className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateToSection(item.id)}
                  className={`w-full min-h-[42px] px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between gap-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-amber-700 text-white'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span className="inline-flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-white' : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.count !== undefined && (
                    <span
                      className={`font-mono tabular-nums text-[11px] ${
                        isActive ? 'text-amber-100' : 'text-slate-400'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="p-3 border-t border-slate-800/80 space-y-2">
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="w-full min-h-[38px] px-3 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white flex items-center gap-2.5 transition-colors"
            >
              <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
              <span>Jak to działa</span>
            </button>
            <div className="px-3 py-1.5 text-[11px] text-slate-400 truncate">
              {authUser
                ? authUser.email || 'Konto Google'
                : 'Tryb bez logowania'}
            </div>
          </div>
        </nav>

        {/* Active Workspace or Schedule */}
        {isScheduleView ? (
          <main className="flex-1 min-h-0 overflow-y-auto bg-slate-50">
            <PrintScheduleSheet
              parish={parish}
              config={config}
              routes={routes}
              onBackToMap={() => {
                setActiveSection('overview');
                setMobilePane('map');
              }}
            />
          </main>
        ) : (
          <main className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
            {/* Left Detail Panel (hidden on mobile when Map pane is active) */}
            <aside
              className={`no-print w-full lg:w-[400px] xl:w-[430px] bg-white lg:border-r border-slate-200 flex-col min-h-0 shrink-0 ${
                mobilePane === 'panel' ? 'flex flex-1 lg:flex-none' : 'hidden lg:flex'
              }`}
            >
              {/* Mobile section sub-header */}
              <div className="lg:hidden px-4 py-2.5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between gap-2 shrink-0">
                <span className="text-xs font-semibold text-slate-800 truncate">
                  {SECTION_TITLES[activeSection]}
                </span>
                {parish && (
                  <button
                    type="button"
                    onClick={() => setMobilePane('map')}
                    className="text-xs font-medium text-amber-800 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                    Mapa
                  </button>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto">
                {activeSection === 'overview' && (
                  <PlanDashboard
                    parish={parish}
                    activeParishId={activeParishId}
                    savedParishes={savedParishes}
                    boundary={boundary}
                    stops={stops}
                    config={config}
                    routes={routes}
                    isSignedIn={Boolean(authUser)}
                    userEmail={authUser?.email ?? null}
                    isComputing={isComputing}
                    onSignInGoogle={onSignInGoogle}
                    onSelectParish={handleSelectParish}
                    onSelectSavedParish={handleSelectSavedParish}
                    onNavigateSection={navigateToSection}
                    onOpenMapWithMode={(mode) => {
                      setInteractionMode(mode);
                      setMobilePane('map');
                    }}
                    onComputeRoutes={handleComputeRoutes}
                  />
                )}

                {activeSection === 'parish' && (
                  <SidebarSetup
                    parish={parish}
                    activeParishId={activeParishId}
                    savedParishes={savedParishes}
                    boundary={boundary}
                    stops={stops}
                    interactionMode={interactionMode}
                    streetPickFeedback={streetPickFeedback}
                    isSignedIn={Boolean(authUser)}
                    userEmail={authUser?.email ?? null}
                    onDismissStreetFeedback={() => setStreetPickFeedback(null)}
                    onSignInGoogle={onSignInGoogle}
                    onSelectParish={handleSelectParish}
                    onSelectSavedParish={handleSelectSavedParish}
                    onDeleteSavedParish={handleDeleteSavedParish}
                    onCreatePresetBoundary={handleCreatePresetBoundary}
                    onScaleBoundary={handleScaleBoundary}
                    onToggleDrawBoundary={() => {
                      setInteractionMode((m) => {
                        const next =
                          m === 'draw_boundary' ? 'pan' : 'draw_boundary';
                        if (next === 'draw_boundary') setMobilePane('map');
                        return next;
                      });
                    }}
                    onClearBoundary={handleClearBoundary}
                    onTogglePickStreetMode={() => {
                      setInteractionMode((m) => {
                        const next =
                          m === 'pick_street' ? 'pan' : 'pick_street';
                        if (next === 'pick_street') setMobilePane('map');
                        return next;
                      });
                    }}
                    onToggleMapAddMode={() => {
                      setInteractionMode((m) => {
                        const next = m === 'add_stop' ? 'pan' : 'add_stop';
                        if (next === 'add_stop') setMobilePane('map');
                        return next;
                      });
                    }}
                    onAddPlaceStop={handleAddPlaceStop}
                    onBatchAddStops={handleBatchAddStops}
                    onDeleteStreetStops={handleDeleteStreetStops}
                    onViewMap={() => setMobilePane('map')}
                    onNextStep={() => navigateToSection('stops')}
                  />
                )}

                {activeSection === 'stops' && (
                  <SidebarStops
                    parish={parish}
                    boundary={boundary}
                    stops={stops}
                    config={config}
                    onToggleStreetIncluded={handleToggleStreetIncluded}
                    onAssignStreetPriest={handleAssignStreetPriest}
                    onSetAllIncluded={handleSetAllIncluded}
                    onUpdateStop={handleUpdateStop}
                    onDeleteStop={handleDeleteStop}
                    onClearStops={handleClearStops}
                    onAutoPartition={handleAutoPartition}
                    onSelectStop={(id) => {
                      setHighlightedStopId(id);
                      setMobilePane('map');
                    }}
                    onGoToSetup={() => navigateToSection('parish')}
                    onComputeRoutes={handleComputeRoutes}
                    isComputing={isComputing}
                  />
                )}

                {activeSection === 'routes' && (
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

                {activeSection === 'settings' && (
                  <SidebarSettings
                    config={config}
                    onChangeConfig={handleChangeConfig}
                    onOpenGuide={() => setGuideOpen(true)}
                  />
                )}
              </div>
            </aside>

            {/* Right Interactive Map (completely hidden on mobile when viewing panel so nothing overlaps) */}
            <section
              className={`flex-1 min-h-0 relative h-full w-full ${
                mobilePane === 'map' ? 'block' : 'hidden lg:block'
              }`}
            >
              {useGoogleMaps ? (
                <ParishMap
                  parish={parish}
                  boundary={boundary}
                  stops={stops}
                  routes={routes}
                  routeObjects={routeObjects}
                  interactionMode={interactionMode}
                  highlightedStopId={highlightedStopId}
                  streetPickFeedback={streetPickFeedback}
                  onDismissStreetFeedback={() => setStreetPickFeedback(null)}
                  onBoundaryComplete={handleBoundaryComplete}
                  onBoundaryUpdate={(pts) =>
                    updateBoundaryAndRecheckStops(pts, true)
                  }
                  onCancelInteraction={() => setInteractionMode('pan')}
                  onMapAddStop={handleMapAddStop}
                  onMapPickStreet={handleMapPickStreet}
                  onSelectStop={setHighlightedStopId}
                  onDeleteStop={handleDeleteStop}
                />
              ) : (
                <OsmParishMap
                  parish={parish}
                  boundary={boundary}
                  stops={stops}
                  routes={routes}
                  interactionMode={interactionMode}
                  highlightedStopId={highlightedStopId}
                  streetPickFeedback={streetPickFeedback}
                  onDismissStreetFeedback={() => setStreetPickFeedback(null)}
                  onBoundaryComplete={handleBoundaryComplete}
                  onBoundaryUpdate={(pts) =>
                    updateBoundaryAndRecheckStops(pts, true)
                  }
                  onCancelInteraction={() => setInteractionMode('pan')}
                  onMapAddStop={handleMapAddStop}
                  onMapPickStreet={handleMapPickStreet}
                  onSelectStop={setHighlightedStopId}
                  onDeleteStop={handleDeleteStop}
                />
              )}

              {activeStopsCount > 0 && (
                <div className="no-print absolute top-3 right-3 sm:top-auto sm:right-auto sm:bottom-4 sm:left-4 z-[450] bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-sm flex flex-wrap items-center gap-2.5 text-xs text-slate-700 pointer-events-none">
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
      </div>

      {/* Mobile Thumb-Zone Bottom Tab Bar (< lg) */}
      <nav
        aria-label="Nawigacja mobilna"
        className="no-print lg:hidden shrink-0 bg-white border-t border-slate-200 grid grid-cols-5 h-16 px-1"
      >
        <button
          type="button"
          onClick={() => navigateToSection('overview')}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
            mobilePane === 'panel' && activeSection === 'overview'
              ? 'text-amber-800'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span>Plan</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (activeSection === 'schedule') setActiveSection('overview');
            setMobilePane('map');
          }}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
            mobilePane === 'map'
              ? 'text-amber-800'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <MapIcon className="w-5 h-5" />
          <span>Mapa</span>
        </button>

        <button
          type="button"
          onClick={() => navigateToSection('stops')}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
            mobilePane === 'panel' && activeSection === 'stops'
              ? 'text-amber-800'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <MapPin className="w-5 h-5" />
          <span className="tabular-nums">
            Plan{activeStopsCount > 0 ? ` (${activeStopsCount})` : ''}
          </span>
        </button>

        <button
          type="button"
          onClick={() => navigateToSection('routes')}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
            mobilePane === 'panel' && activeSection === 'routes'
              ? 'text-amber-800'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Route className="w-5 h-5" />
          <span className="tabular-nums">
            Trasy{routes.length > 0 ? ` (${routes.length})` : ''}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
            mobilePane === 'panel' &&
            (activeSection === 'parish' ||
              activeSection === 'settings' ||
              activeSection === 'schedule')
              ? 'text-amber-800'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Menu className="w-5 h-5" />
          <span>Menu</span>
        </button>
      </nav>

      {/* Mobile Slide-Over Menu Drawer */}
      {mobileMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu nawigacji"
          className="no-print lg:hidden fixed inset-0 z-[1200] flex"
        >
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-10 w-[290px] max-w-[85vw] bg-white h-full shadow-2xl flex flex-col">
            <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <span className="text-base font-bold text-slate-900">
                Planer Kolędy
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Zamknij menu"
                className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {parish && (
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                <div className="text-[11px] font-medium text-amber-800">
                  Aktywna parafia
                </div>
                <div className="text-xs font-semibold text-slate-900 truncate mt-0.5">
                  {parish.name}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {parish.address}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  mobilePane === 'panel' && activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateToSection(item.id)}
                    className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-xl text-sm font-medium flex items-center justify-between gap-2 transition-colors ${
                      isActive
                        ? 'bg-amber-50 text-amber-900 border border-amber-200'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="inline-flex items-center gap-3 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? 'text-amber-700' : 'text-slate-500'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.count !== undefined && (
                      <span className="font-mono tabular-nums text-xs text-slate-500">
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}

              <div className="pt-2 mt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setGuideOpen(true);
                  }}
                  className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-3 transition-colors"
                >
                  <HelpCircle className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>Jak to działa</span>
                </button>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-2 shrink-0">
              {authUser ? (
                <>
                  <div className="text-xs text-slate-600 truncate">
                    Konto: <strong className="text-slate-900">{authUser.email}</strong>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onSignOutGoogle();
                    }}
                    className="w-full min-h-[42px] px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl inline-flex items-center justify-center gap-2"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Wyloguj się
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onSignInGoogle();
                  }}
                  className="w-full min-h-[42px] px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl inline-flex items-center justify-center gap-2"
                >
                  <LogIn className="w-3.5 h-3.5 text-amber-400" />
                  Zaloguj Google, aby zapisywać parafie
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <ArchitectureGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
      />
    </div>
  );
}

function GoogleMapsWorkspace({
  authUser,
  onSignInGoogle,
  onSignOutGoogle,
}: {
  authUser: User | null;
  onSignInGoogle: () => void;
  onSignOutGoogle: () => void;
}) {
  const optimizer = useParishRouteOptimizer();
  return (
    <MapEngineProvider engine="google">
      <ParishPlannerWorkspace
        authUser={authUser}
        onSignInGoogle={onSignInGoogle}
        onSignOutGoogle={onSignOutGoogle}
        optimizer={optimizer}
        useGoogleMaps={true}
      />
    </MapEngineProvider>
  );
}

function OsmFreeWorkspace({
  authUser,
  onSignInGoogle,
  onSignOutGoogle,
}: {
  authUser: User | null;
  onSignInGoogle: () => void;
  onSignOutGoogle: () => void;
}) {
  const optimizer = useOsmRouteOptimizer();
  return (
    <MapEngineProvider engine="osm">
      <ParishPlannerWorkspace
        authUser={authUser}
        onSignInGoogle={onSignInGoogle}
        onSignOutGoogle={onSignOutGoogle}
        optimizer={optimizer}
        useGoogleMaps={false}
      />
    </MapEngineProvider>
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
        <OsmFreeWorkspace
          authUser={authUser}
          onSignInGoogle={handleSignInGoogle}
          onSignOutGoogle={handleSignOutGoogle}
        />
      ) : (
        <APIProvider
          apiKey={MAPS_API_KEY}
          language="pl"
          region="PL"
          libraries={['places', 'routes', 'marker', 'geometry']}
        >
          <GoogleMapsWorkspace
            authUser={authUser}
            onSignInGoogle={handleSignInGoogle}
            onSignOutGoogle={handleSignOutGoogle}
          />
        </APIProvider>
      )}
    </div>
  );
}
