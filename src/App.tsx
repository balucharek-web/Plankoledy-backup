import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  CalendarCheck,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Church,
  Eye,
  EyeOff,
  HelpCircle,
  LayoutDashboard,
  ListOrdered,
  LogIn,
  LogOut,
  Map as MapIcon,
  Menu,
  Route,
  SlidersHorizontal,
  Undo2,
  X,
} from 'lucide-react';
import { ArchitectureGuideModal } from './components/ArchitectureGuideModal';
import { AuthModal } from './components/AuthModal';
import { BlockUnitsModal } from './components/BlockUnitsModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OsmParishMap } from './components/OsmParishMap';
import { PWAInstallButton } from './components/PWAInstallButton';
import { ParishMap, RoutePolylineEntry } from './components/ParishMap';
import { PlanDashboard, WorkspaceSection } from './components/PlanDashboard';
import { SelectedPlaceData } from './components/PlaceSearchInput';
import { PrintScheduleSheet } from './components/PrintScheduleSheet';
import { SidebarRoutes } from './components/SidebarRoutes';
import { SidebarSettings } from './components/SidebarSettings';
import { SidebarSetup } from './components/SidebarSetup';
import {
  CustomDayPlanPayload,
  SidebarStops,
} from './components/SidebarStops';
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
  DEFAULT_SEASON_CONFIG,
  batchUpdateStopFieldInFirestore,
  clearOfflineParishSnapshot,
  clearParishStopsInFirestore,
  createStopInFirestore,
  createStopsBatchInFirestore,
  deleteParishFromFirestore,
  deleteStopInFirestore,
  loadOfflineParishSnapshot,
  makeParishDocId,
  sanitizeDocId,
  saveOfflineParishSnapshot,
  saveParishToFirestore,
  subscribeParishStops,
  subscribeUserParishes,
  updateParishBoundaryInFirestore,
  updateParishConfigInFirestore,
  updateParishSeasonConfigInFirestore,
  updateStopInFirestore,
} from './services/parishStorage';
import {
  LatLng,
  MapInteractionMode,
  MarkerLabelMode,
  PRIEST_PALETTE,
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
  SavedParishRecord,
  SeasonPlanConfig,
  StreetPickFeedback,
  UnitVisitStatus,
  VisitStop,
} from './types/parish';
import {
  autoScheduleSeason,
  buildSeasonDaySummaries,
  collectReturnVisitCandidates,
  computeManualOrderForStops,
  formatPolishDateChip,
  formatPolishDateFull,
  getDayEndTime,
  getDayStartTime,
} from './utils/seasonScheduler';
import {
  computePolygonAreaSqMeters,
  createBufferedHullBoundary,
  createPresetBoundaryPolygon,
  extractStreetName,
  formatPolygonArea,
  isPointInsideBoundary,
  partitionStopsBySector,
  scaleBoundaryFromCenter,
} from './utils/spatial';

type MobilePane = 'panel' | 'map';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

const SECTION_TITLES: Record<WorkspaceSection, string> = {
  overview: 'Start',
  parish: 'Parafia i ulice',
  stops: 'Zaplanuj dzień',
  routes: 'Trasa dnia',
  schedule: 'Cały okres',
  settings: 'Ustawienia',
};

interface RouteOptimizerHandle {
  routes: PriestRouteResult[];
  routeObjects: RoutePolylineEntry[];
  isComputing: boolean;
  progressLabel?: string | null;
  error: string | null;
  computeAllRoutes: (
    parish: ParishCenter,
    stops: VisitStop[],
    config: PlanConfig
  ) => Promise<{
    routes: PriestRouteResult[];
    routeObjects: RoutePolylineEntry[];
  } | undefined>;
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
  pendingVerificationEmail,
  onSignInGoogle,
  onSignOutGoogle,
  optimizer,
  useGoogleMaps,
}: {
  authUser: User | null;
  pendingVerificationEmail: string | null;
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
  const [seasonConfig, setSeasonConfig] = useState<SeasonPlanConfig>(
    DEFAULT_SEASON_CONFIG
  );
  const [stops, setStops] = useState<VisitStop[]>([]);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [focusedPriestId, setFocusedPriestId] = useState<number | null>(null);
  const [markerLabelMode, setMarkerLabelMode] =
    useState<MarkerLabelMode>('numbers');
  const [showRouteLines, setShowRouteLines] = useState<boolean>(true);
  const [focusedStreet, setFocusedStreet] = useState<string | null>(null);
  const [exactRoutesCache, setExactRoutesCache] = useState<
    Record<
      string,
      { routes: PriestRouteResult[]; routeObjects: RoutePolylineEntry[] }
    >
  >({});

  const [activeSection, setActiveSection] =
    useState<WorkspaceSection>('overview');
  const [plannerLoadState, setPlannerLoadState] = useState<{
    date: string | null;
    seq: number;
  }>({ date: null, seq: 0 });
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
  const [editingBlockStopId, setEditingBlockStopId] = useState<string | null>(
    null
  );
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'warning' | 'default';
    onConfirm: () => void;
  } | null>(null);
  const [undoToast, setUndoToast] = useState<{
    id: number;
    message: string;
    onUndo: () => void;
  } | null>(null);

  const boundaryDebounceRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const activeParishIdRef = useRef<string | null>(activeParishId);
  activeParishIdRef.current = activeParishId;
  const stopsRef = useRef<VisitStop[]>(stops);
  stopsRef.current = stops;

  const navigateToSection = useCallback((section: WorkspaceSection) => {
    setActiveSection(section);
    setMobilePane('panel');
    setMobileMenuOpen(false);
  }, []);

  const handleEditDayInPlanner = useCallback(
    (date: string) => {
      setSelectedDate(date);
      setFocusedPriestId(null);
      setPlannerLoadState((prev) => ({ date, seq: prev.seq + 1 }));
      navigateToSection('stops');
    },
    [navigateToSection]
  );

  const handleStartNewDayInPlanner = useCallback(() => {
    setPlannerLoadState((prev) => ({ date: null, seq: prev.seq + 1 }));
    navigateToSection('stops');
  }, [navigateToSection]);

  const showUndoToast = useCallback((message: string, onUndo: () => void) => {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    const toastId = Date.now();
    setUndoToast({ id: toastId, message, onUndo });
    undoTimerRef.current = window.setTimeout(() => {
      setUndoToast((curr) => (curr?.id === toastId ? null : curr));
    }, 9000);
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
    isComputing,
    progressLabel,
    error: routeError,
    computeAllRoutes,
    clearRoutes: clearOptimizerRoutes,
  } = optimizer;

  const clearRoutes = useCallback(() => {
    clearOptimizerRoutes();
    setExactRoutesCache({});
  }, [clearOptimizerRoutes]);

  // Parishes must only be persisted for signed-in users: purge any old local cache
  useEffect(() => {
    clearLegacyLocalStorage();
    return () => {
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    };
  }, []);

  // Subscribe to signed-in user's parishes in Firestore, and clear state + offline snapshot on sign-out
  useEffect(() => {
    if (!authUser) {
      clearOfflineParishSnapshot();
      setSavedParishes([]);
      setActiveParishId(null);
      setParish(null);
      setBoundary([]);
      setConfig(DEFAULT_PLAN_CONFIG);
      setSeasonConfig(DEFAULT_SEASON_CONFIG);
      setStops([]);
      setSelectedDate(null);
      setFocusedPriestId(null);
      clearRoutes();
      return;
    }

    // Immediate offline-first hydration for signed-in user while Firestore connects
    const cachedOffline = loadOfflineParishSnapshot(authUser.uid);
    if (cachedOffline && !activeParishIdRef.current) {
      activeParishIdRef.current = cachedOffline.parishId;
      setActiveParishId(cachedOffline.parishId);
      setParish(cachedOffline.parish);
      setBoundary(cachedOffline.boundary);
      setConfig(cachedOffline.config);
      setSeasonConfig(cachedOffline.seasonConfig);
      setStops(cachedOffline.stops);
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
          seasonConfig,
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
          setSeasonConfig(matched.seasonConfig ?? DEFAULT_SEASON_CONFIG);
        } else if (matched) {
          setParish(matched.parish);
          setBoundary(matched.boundary);
          setConfig(matched.config);
          setSeasonConfig(matched.seasonConfig ?? DEFAULT_SEASON_CONFIG);
        } else {
          setActiveParishId(null);
          setParish(null);
          setBoundary([]);
          setStops([]);
          setSelectedDate(null);
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

  // Save lightweight offline snapshot for signed-in user so field checklist works offline
  useEffect(() => {
    if (!authUser || !activeParishId || !parish) return;
    saveOfflineParishSnapshot(authUser.uid, {
      parishId: activeParishId,
      parish,
      boundary,
      config,
      seasonConfig,
      stops,
      savedAtMs: Date.now(),
    });
  }, [authUser, activeParishId, parish, boundary, config, seasonConfig, stops]);

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
        setSeasonConfig(DEFAULT_SEASON_CONFIG);
        setStops([]);
        setSelectedDate(null);
        setFocusedPriestId(null);
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
        setSeasonConfig(existing.seasonConfig ?? DEFAULT_SEASON_CONFIG);
        setSelectedDate(null);
        setFocusedPriestId(null);
        return;
      }

      const newRecord: SavedParishRecord = {
        id: candidateId,
        parish: nextParish,
        boundary: [],
        config: DEFAULT_PLAN_CONFIG,
        seasonConfig: DEFAULT_SEASON_CONFIG,
        updatedAtMs: Date.now(),
      };

      setSavedParishes((prev) => [newRecord, ...prev]);
      setActiveParishId(candidateId);
      setParish(nextParish);
      setBoundary([]);
      setConfig(DEFAULT_PLAN_CONFIG);
      setSeasonConfig(DEFAULT_SEASON_CONFIG);
      setStops([]);
      setSelectedDate(null);
      setFocusedPriestId(null);

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
      setSelectedDate(null);
      setFocusedPriestId(null);
      setActiveParishId(target.id);
      setParish(target.parish);
      setBoundary(target.boundary);
      setConfig(target.config);
      setSeasonConfig(target.seasonConfig ?? DEFAULT_SEASON_CONFIG);
    },
    [authUser, clearRoutes, savedParishes]
  );

  const handleDeleteSavedParish = useCallback(
    (parishId: string) => {
      if (!authUser) return;
      const target = savedParishes.find((r) => r.id === parishId);
      setConfirmState({
        title: 'Usunąć zapisaną parafię?',
        description: `Wszystkie zapamiętane adresy, granice i harmonogramy dla „${
          target?.parish.name || 'wybranej parafii'
        }” zostaną trwale usunięte z Twojego konta.`,
        confirmLabel: 'Usuń parafię',
        variant: 'danger',
        onConfirm: () => {
          const remaining = savedParishes.filter((r) => r.id !== parishId);
          setSavedParishes(remaining);

          if (activeParishId === parishId) {
            clearRoutes();
            const fallback = remaining[0] ?? null;
            setActiveParishId(fallback?.id ?? null);
            setParish(fallback?.parish ?? null);
            setBoundary(fallback?.boundary ?? []);
            setConfig(fallback?.config ?? DEFAULT_PLAN_CONFIG);
            setSeasonConfig(fallback?.seasonConfig ?? DEFAULT_SEASON_CONFIG);
            setStops([]);
            setSelectedDate(null);
            setFocusedPriestId(null);
          }

          void deleteParishFromFirestore(authUser.uid, parishId).catch(
            () => {}
          );
        },
      });
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
      const areaLabel = formatPolygonArea(computePolygonAreaSqMeters(points));
      showStreetFeedback(
        {
          status: 'success',
          message: `Zapisano teren parafii (${areaLabel}) — możesz wykryć ulice lub poprawić narożniki.`,
        },
        5000
      );
    },
    [showStreetFeedback, updateBoundaryAndRecheckStops]
  );

  const handleWrapStopsBoundary = useCallback(() => {
    const currentStops = stopsRef.current;
    if (currentStops.length === 0) return;
    const hull = createBufferedHullBoundary(
      currentStops.map((s) => s.location),
      90
    );
    if (hull.length < 3) return;
    updateBoundaryAndRecheckStops(hull, false);
    setInteractionMode('pan');
    setMobilePane('map');
    const areaLabel = formatPolygonArea(computePolygonAreaSqMeters(hull));
    showStreetFeedback(
      {
        status: 'success',
        message: `Otoczono dodane ulice (${areaLabel}). Możesz poprawić narożniki na mapie.`,
      },
      5000
    );
  }, [showStreetFeedback, updateBoundaryAndRecheckStops]);

  const handleApplyLocalityBoundary = useCallback(
    (points: LatLng[], placeName: string) => {
      if (points.length < 3) return;
      updateBoundaryAndRecheckStops(points, false);
      setInteractionMode('pan');
      setMobilePane('map');
      const areaLabel = formatPolygonArea(computePolygonAreaSqMeters(points));
      showStreetFeedback(
        {
          status: 'success',
          message: `Pobrano granice „${placeName}” (${areaLabel}). Kliknij „Popraw granice”, aby doregulować obrys.`,
        },
        6000
      );
    },
    [showStreetFeedback, updateBoundaryAndRecheckStops]
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
    if (boundary.length === 0) return;
    const prevBoundary = [...boundary];
    setConfirmState({
      title: 'Wyczyścić obrys granic parafii?',
      description:
        'Narysowany obszar na mapie zostanie usunięty. Będziesz móc narysować nowy obrys lub cofnąć operację przez chwilę po zatwierdzeniu.',
      confirmLabel: 'Wyczyść obrys',
      variant: 'warning',
      onConfirm: () => {
        updateBoundaryAndRecheckStops([], false);
        showUndoToast('Usunięto obrys granic parafii.', () => {
          updateBoundaryAndRecheckStops(prevBoundary, false);
        });
      },
    });
  }, [boundary, showUndoToast, updateBoundaryAndRecheckStops]);

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

  const handleChangeSeasonConfig = useCallback(
    (nextSeason: SeasonPlanConfig) => {
      setSeasonConfig(nextSeason);
      const currentId = activeParishIdRef.current;
      if (authUser && currentId) {
        setSavedParishes((prev) =>
          prev.map((r) =>
            r.id === currentId
              ? { ...r, seasonConfig: nextSeason, updatedAtMs: Date.now() }
              : r
          )
        );
        void updateParishSeasonConfigInFirestore(currentId, nextSeason).catch(
          () => {}
        );
      }
    },
    [authUser]
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
        const isBlock = Boolean(place.isMultiUnit);
        const unitsCount = isBlock ? Math.max(1, place.unitsCount ?? 15) : 0;
        const perUnit = Math.min(12, Math.max(5, config.defaultVisitMinutes || 10));
        const durationMinutes = isBlock
          ? Math.min(1440, Math.max(config.defaultVisitMinutes, unitsCount * perUnit))
          : config.defaultVisitMinutes;

        const nextStop: VisitStop = {
          id: newStopId,
          label: place.name,
          address: place.address,
          location: place.location,
          placeId: place.placeId,
          durationMinutes,
          priestId: nextPriestRoundRobin(prev.length),
          inBoundary: isPointInsideBoundary(place.location, boundary),
          ...(isBlock
            ? {
                isMultiUnit: true,
                unitsCount,
                minutesPerUnit: perUnit,
                units: [],
              }
            : {}),
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
        const perUnit = Math.min(12, Math.max(5, config.defaultVisitMinutes || 10));
        addedStops = places.map((place, idx) => {
          const isBlock = Boolean(place.isMultiUnit);
          const unitsCount = isBlock ? Math.max(1, place.unitsCount ?? 15) : 0;
          const durationMinutes = isBlock
            ? Math.min(1440, Math.max(config.defaultVisitMinutes, unitsCount * perUnit))
            : config.defaultVisitMinutes;

          return {
            id: sanitizeDocId(
              `s_${baseTs}_${idx}_${Math.random().toString(36).slice(2, 6)}`
            ),
            label: place.name,
            address: place.address,
            location: place.location,
            placeId: place.placeId,
            durationMinutes,
            priestId: ((prev.length + idx) % config.priestCount) + 1,
            inBoundary: isPointInsideBoundary(place.location, boundary),
            ...(place.notes ? { notes: place.notes } : {}),
            ...(isBlock
              ? {
                  isMultiUnit: true,
                  unitsCount,
                  minutesPerUnit: perUnit,
                  units: [],
                }
              : {}),
          };
        });
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
          ...(h.isMultiUnit
            ? {
                isMultiUnit: true,
                unitsCount: h.suggestedUnitsCount ?? 15,
              }
            : {}),
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
      const removed = stopsRef.current.find((s) => s.id === id);
      setStops((prev) => prev.filter((s) => s.id !== id));
      clearRoutes();

      if (authUser && currentId) {
        void deleteStopInFirestore(currentId, id).catch(() => {});
      }

      if (removed) {
        showUndoToast(`Usunięto adres: ${removed.address}`, () => {
          setStops((prev) =>
            prev.some((s) => s.id === removed.id) ? prev : [...prev, removed]
          );
          if (authUser && currentId) {
            void createStopInFirestore(authUser.uid, currentId, removed).catch(
              () => {}
            );
          }
        });
      }
    },
    [authUser, clearRoutes, showUndoToast]
  );

  const handleClearStops = useCallback(() => {
    if (stops.length === 0) return;
    const snapshot = [...stops];
    const currentId = activeParishIdRef.current;
    const idsToDelete = snapshot.map((s) => s.id);

    setConfirmState({
      title: 'Usunąć całą bazę domów?',
      description: `Wszystkie zapamiętane budynki (${snapshot.length}) oraz przypisane daty i lokale w blokach dla tej parafii zostaną usunięte.`,
      confirmLabel: `Usuń wszystkie (${snapshot.length})`,
      variant: 'danger',
      onConfirm: () => {
        setStops([]);
        clearRoutes();

        if (authUser && currentId && idsToDelete.length > 0) {
          void clearParishStopsInFirestore(currentId, idsToDelete).catch(
            () => {}
          );
        }

        showUndoToast(
          `Usunięto bazę ${snapshot.length} domów.`,
          () => {
            setStops(snapshot);
            if (authUser && currentId) {
              void createStopsBatchInFirestore(
                authUser.uid,
                currentId,
                snapshot
              ).catch(() => {});
            }
          }
        );
      },
    });
  }, [authUser, clearRoutes, showUndoToast, stops]);

  const handleDeleteStreetStops = useCallback(
    (stopIds: string[]) => {
      if (stopIds.length === 0) return;
      const idSet = new Set(stopIds);
      const removedList = stopsRef.current.filter((s) => idSet.has(s.id));
      const currentId = activeParishIdRef.current;
      setStops((prev) => prev.filter((s) => !idSet.has(s.id)));
      clearRoutes();

      if (authUser && currentId) {
        void clearParishStopsInFirestore(currentId, stopIds).catch(() => {});
      }

      if (removedList.length > 0) {
        showUndoToast(
          `Usunięto ${removedList.length} ${
            removedList.length === 1 ? 'adres' : 'adresów'
          }.`,
          () => {
            setStops((prev) => {
              const existingIds = new Set(prev.map((p) => p.id));
              return [
                ...prev,
                ...removedList.filter((r) => !existingIds.has(r.id)),
              ];
            });
            if (authUser && currentId) {
              void createStopsBatchInFirestore(
                authUser.uid,
                currentId,
                removedList
              ).catch(() => {});
            }
          }
        );
      }
    },
    [authUser, clearRoutes, showUndoToast]
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

  const handleAutoScheduleSeason = useCallback(
    (targetMode: 'all' | 'unscheduled') => {
      if (!parish || stopsRef.current.length === 0) return;
      const currentId = activeParishIdRef.current;
      const scheduled = autoScheduleSeason({
        parish,
        stops: stopsRef.current,
        config,
        seasonConfig,
        targetMode,
      });

      setStops(scheduled);
      clearRoutes();

      const firstDate =
        scheduled
          .map((s) => (s.visitDate ?? '').trim())
          .filter(Boolean)
          .sort()[0] ?? null;
      if (firstDate) {
        setSelectedDate(firstDate);
      }
      setFocusedPriestId(null);

      if (authUser && currentId) {
        void batchUpdateStopFieldInFirestore(
          currentId,
          scheduled,
          'schedule'
        ).catch(() => {});
      }
    },
    [authUser, clearRoutes, config, parish, seasonConfig]
  );

  const handleClearAllDates = useCallback(() => {
    const withDates = stopsRef.current.filter((s) =>
      Boolean((s.visitDate ?? '').trim())
    );
    const hasOverrides =
      Object.keys(seasonConfig.dayTimeOverrides ?? {}).length > 0;
    if (withDates.length === 0 && !hasOverrides) {
      clearRoutes();
      return;
    }

    const prevStopSnapshot = new Map(
      withDates.map((s) => [
        s.id,
        { visitDate: s.visitDate ?? '', manualOrder: s.manualOrder ?? 0 },
      ])
    );
    const prevOverrides = seasonConfig.dayTimeOverrides
      ? { ...seasonConfig.dayTimeOverrides }
      : undefined;
    const currentId = activeParishIdRef.current;

    setConfirmState({
      title: 'Usunąć wszystkie wyznaczone trasy i daty?',
      description: `Wszystkie zaplanowane dni kolędy (${withDates.length} domów) zostaną usunięte z kalendarza. Lista ulic i domów parafii pozostanie bez zmian.`,
      confirmLabel: 'Usuń wszystkie trasy',
      variant: 'danger',
      onConfirm: () => {
        const changed: VisitStop[] = [];
        setStops((prev) =>
          prev.map((s) => {
            if (!(s.visitDate ?? '').trim() && !s.manualOrder) return s;
            const next = { ...s, visitDate: '', manualOrder: 0 };
            changed.push(next);
            return next;
          })
        );
        if (hasOverrides) {
          const nextSeason = { ...seasonConfig };
          delete nextSeason.dayTimeOverrides;
          handleChangeSeasonConfig(nextSeason);
        }
        setSelectedDate(null);
        setFocusedPriestId(null);
        clearRoutes();

        if (authUser && currentId && changed.length > 0) {
          void batchUpdateStopFieldInFirestore(
            currentId,
            changed,
            'manualOrder_schedule'
          ).catch(() => {});
        }

        showUndoToast('Usunięto wszystkie wyznaczone trasy.', () => {
          const restored: VisitStop[] = [];
          setStops((prev) =>
            prev.map((s) => {
              const snap = prevStopSnapshot.get(s.id);
              if (!snap) return s;
              const next = {
                ...s,
                visitDate: snap.visitDate,
                manualOrder: snap.manualOrder,
              };
              restored.push(next);
              return next;
            })
          );
          if (prevOverrides) {
            handleChangeSeasonConfig({
              ...seasonConfig,
              dayTimeOverrides: prevOverrides,
            });
          }
          if (authUser && currentId && restored.length > 0) {
            void batchUpdateStopFieldInFirestore(
              currentId,
              restored,
              'manualOrder_schedule'
            ).catch(() => {});
          }
        });
      },
    });
  }, [
    authUser,
    clearRoutes,
    handleChangeSeasonConfig,
    seasonConfig,
    showUndoToast,
  ]);

  const handleStartNewSeason = useCallback(
    (excludeDeclined: boolean) => {
      const currentStops = stopsRef.current;
      if (currentStops.length === 0) return;

      const prevSnapshot = currentStops.map((s) => ({
        ...s,
        units: s.units ? s.units.map((u) => ({ ...u })) : undefined,
      }));
      const prevOverrides = seasonConfig.dayTimeOverrides
        ? { ...seasonConfig.dayTimeOverrides }
        : undefined;
      const hasOverrides =
        Object.keys(seasonConfig.dayTimeOverrides ?? {}).length > 0;
      const currentId = activeParishIdRef.current;

      setConfirmState({
        title: 'Rozpocząć nowy sezon kolędowy?',
        description: `Obecne statusy odwiedzin dla ${currentStops.length} punktów zostaną zachowane jako „Rok temu”, a daty tras z bieżącego kalendarza zostaną wyczyszczone.${
          excludeDeclined
            ? ' Domy ze statusem „Odmowa” zostaną oznaczone jako „Stała odmowa” i domyślnie pominięte przy planowaniu nowego sezonu.'
            : ''
        }`,
        confirmLabel: 'Rozpocznij nowy sezon',
        variant: 'warning',
        onConfirm: () => {
          const rolledStops: VisitStop[] = prevSnapshot.map((s) => {
            const archivedStatus: UnitVisitStatus | undefined =
              s.visitStatus && s.visitStatus !== 'pending'
                ? s.visitStatus
                : s.lastYearStatus;
            const nextPermanentDecline =
              excludeDeclined && archivedStatus === 'declined'
                ? true
                : Boolean(s.permanentDecline);
            const nextIncluded = nextPermanentDecline ? false : true;
            const rolledUnits = s.units
              ? s.units.map((u) => {
                  const unitArchive: UnitVisitStatus | undefined =
                    u.status && u.status !== 'pending'
                      ? u.status
                      : u.lastYearStatus;
                  return {
                    ...u,
                    status: 'pending' as UnitVisitStatus,
                    ...(unitArchive ? { lastYearStatus: unitArchive } : {}),
                  };
                })
              : undefined;

            const nextStop: VisitStop = {
              ...s,
              visitStatus: 'pending',
              visitDate: '',
              manualOrder: 0,
              included: nextIncluded,
              permanentDecline: nextPermanentDecline,
              ...(rolledUnits ? { units: rolledUnits } : {}),
            };
            if (archivedStatus) {
              nextStop.lastYearStatus = archivedStatus;
            } else {
              delete nextStop.lastYearStatus;
            }
            return nextStop;
          });

          setStops(rolledStops);
          if (hasOverrides) {
            const nextSeason = { ...seasonConfig };
            delete nextSeason.dayTimeOverrides;
            handleChangeSeasonConfig(nextSeason);
          }
          setSelectedDate(null);
          setFocusedPriestId(null);
          clearRoutes();

          if (authUser && currentId && rolledStops.length > 0) {
            void batchUpdateStopFieldInFirestore(
              currentId,
              rolledStops,
              'season_rollover'
            ).catch(() => {});
          }

          showUndoToast(
            'Rozpoczęto nowy sezon kolędowy — statusy zapisano jako „Rok temu”.',
            () => {
              setStops(prevSnapshot);
              if (prevOverrides) {
                handleChangeSeasonConfig({
                  ...seasonConfig,
                  dayTimeOverrides: prevOverrides,
                });
              }
              if (authUser && currentId && prevSnapshot.length > 0) {
                void batchUpdateStopFieldInFirestore(
                  currentId,
                  prevSnapshot,
                  'season_rollover'
                ).catch(() => {});
              }
            }
          );
        },
      });
    },
    [
      authUser,
      clearRoutes,
      handleChangeSeasonConfig,
      seasonConfig,
      showUndoToast,
    ]
  );

  const handleDeleteDayPlan = useCallback(
    (date: string) => {
      if (!date) return;
      const dayStops = stopsRef.current.filter(
        (s) => (s.visitDate ?? '').trim() === date
      );
      const prevOverride = seasonConfig.dayTimeOverrides?.[date];
      if (dayStops.length === 0 && !prevOverride) {
        setExactRoutesCache((prev) => {
          if (!prev[date]) return prev;
          const copy = { ...prev };
          delete copy[date];
          return copy;
        });
        return;
      }

      const snapshotById = new Map(
        dayStops.map((s) => [
          s.id,
          {
            visitDate: s.visitDate ?? '',
            manualOrder: s.manualOrder ?? 0,
            priestId: s.priestId,
          },
        ])
      );
      const currentId = activeParishIdRef.current;

      setConfirmState({
        title: `Usunąć trasę z dnia ${formatPolishDateFull(date)}?`,
        description: `Trasa dla ${dayStops.length} ${
          dayStops.length === 1 ? 'domu' : 'domów'
        } zostanie usunięta, a ulice wrócą jako wolne (bez terminu). Same domy pozostaną w bazie parafii.`,
        confirmLabel: 'Usuń trasę',
        variant: 'warning',
        onConfirm: () => {
          const changed: VisitStop[] = [];
          setStops((prev) =>
            prev.map((s) => {
              if ((s.visitDate ?? '').trim() !== date) return s;
              const next = { ...s, visitDate: '', manualOrder: 0 };
              changed.push(next);
              return next;
            })
          );

          if (prevOverride) {
            const nextOverrides = { ...(seasonConfig.dayTimeOverrides ?? {}) };
            delete nextOverrides[date];
            const nextSeason = { ...seasonConfig };
            if (Object.keys(nextOverrides).length > 0) {
              nextSeason.dayTimeOverrides = nextOverrides;
            } else {
              delete nextSeason.dayTimeOverrides;
            }
            handleChangeSeasonConfig(nextSeason);
          }

          clearOptimizerRoutes();
          setExactRoutesCache((prev) => {
            const copy = { ...prev };
            delete copy[date];
            delete copy.current;
            return copy;
          });
          setFocusedPriestId(null);
          if (selectedDate === date) {
            setSelectedDate(null);
          }

          if (authUser && currentId && changed.length > 0) {
            void batchUpdateStopFieldInFirestore(
              currentId,
              changed,
              'manualOrder_schedule'
            ).catch(() => {});
          }

          showUndoToast(
            `Usunięto trasę z dnia ${formatPolishDateChip(date)}.`,
            () => {
              const restored: VisitStop[] = [];
              setStops((prev) =>
                prev.map((s) => {
                  const snap = snapshotById.get(s.id);
                  if (!snap) return s;
                  const next = {
                    ...s,
                    visitDate: snap.visitDate,
                    manualOrder: snap.manualOrder,
                    priestId: snap.priestId,
                  };
                  restored.push(next);
                  return next;
                })
              );
              if (prevOverride) {
                handleChangeSeasonConfig({
                  ...seasonConfig,
                  dayTimeOverrides: {
                    ...(seasonConfig.dayTimeOverrides ?? {}),
                    [date]: prevOverride,
                  },
                });
              }
              setSelectedDate(date);
              if (authUser && currentId && restored.length > 0) {
                void batchUpdateStopFieldInFirestore(
                  currentId,
                  restored,
                  'manualOrder_schedule'
                ).catch(() => {});
              }
            }
          );
        },
      });
    },
    [
      authUser,
      clearOptimizerRoutes,
      exactRoutesCache,
      handleChangeSeasonConfig,
      seasonConfig,
      selectedDate,
      showUndoToast,
    ]
  );

  const handleClearCurrentRoute = useCallback(() => {
    if (selectedDate) {
      handleDeleteDayPlan(selectedDate);
      return;
    }
    clearOptimizerRoutes();
    setExactRoutesCache((prev) => {
      if (!prev.current) return prev;
      const copy = { ...prev };
      delete copy.current;
      return copy;
    });
    setFocusedPriestId(null);
    showStreetFeedback(
      {
        status: 'info',
        message: 'Wyczyszczono bieżącą trasę z podglądu.',
      },
      3500
    );
  }, [
    clearOptimizerRoutes,
    handleDeleteDayPlan,
    selectedDate,
    showStreetFeedback,
  ]);

  const handleAssignStopsDate = useCallback(
    (stopIds: string[], visitDate: string) => {
      if (stopIds.length === 0) return;
      const idSet = new Set(stopIds);
      const currentId = activeParishIdRef.current;
      const changed: VisitStop[] = [];

      setStops((prev) =>
        prev.map((s) => {
          if (!idSet.has(s.id)) return s;
          const next = {
            ...s,
            visitDate,
            included: visitDate ? true : s.included,
          };
          changed.push(next);
          return next;
        })
      );
      clearRoutes();
      if (visitDate) {
        setSelectedDate(visitDate);
      }

      if (authUser && currentId && changed.length > 0) {
        void batchUpdateStopFieldInFirestore(
          currentId,
          changed,
          'schedule'
        ).catch(() => {});
      }
    },
    [authUser, clearRoutes]
  );

  const activeStopsCount = stops.filter((s) => s.included !== false).length;

  const exactRoutesOnlyByDay = useMemo(() => {
    const out: Record<string, PriestRouteResult[]> = {};
    for (const [key, entry] of Object.entries(exactRoutesCache)) {
      if (key !== 'current') out[key] = entry.routes;
    }
    return out;
  }, [exactRoutesCache]);

  const seasonSummary = useMemo(
    () =>
      buildSeasonDaySummaries(
        stops,
        parish,
        config,
        seasonConfig,
        exactRoutesOnlyByDay
      ),
    [stops, parish, config, seasonConfig, exactRoutesOnlyByDay]
  );

  const plannedDays = seasonSummary.days;
  const unscheduledStops = seasonSummary.unscheduledStops;

  // Keep selectedDate valid if dates were cleared/changed
  useEffect(() => {
    if (
      selectedDate &&
      !plannedDays.some((d) => d.date === selectedDate)
    ) {
      setSelectedDate(plannedDays[0]?.date ?? null);
    }
  }, [plannedDays, selectedDate]);

  const selectedDaySummary = useMemo(
    () => plannedDays.find((d) => d.date === selectedDate) ?? null,
    [plannedDays, selectedDate]
  );

  const activeRouteCacheKey = selectedDate ?? 'current';
  const cachedExact = exactRoutesCache[activeRouteCacheKey];
  const isExactRoute = Boolean(cachedExact && cachedExact.routes.length > 0);
  const displayedRoutes = useMemo(() => {
    if (cachedExact && cachedExact.routes.length > 0) {
      return cachedExact.routes;
    }
    if (selectedDaySummary) {
      return selectedDaySummary.estimatedRoutes;
    }
    return [];
  }, [cachedExact, selectedDaySummary]);

  const displayedRouteObjects = useMemo(
    () => (cachedExact ? cachedExact.routeObjects : []),
    [cachedExact]
  );

  const exactDayKeys = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(exactRoutesCache)) {
      if (v.routes.length > 0) out[k] = true;
    }
    return out;
  }, [exactRoutesCache]);

  const effectiveStartTime = useMemo(
    () => getDayStartTime(selectedDate, seasonConfig, config.startTime),
    [selectedDate, seasonConfig, config.startTime]
  );

  const effectiveEndTime = useMemo(
    () => getDayEndTime(selectedDate, seasonConfig),
    [selectedDate, seasonConfig]
  );

  const availableMapStreets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const stop of stops) {
      const isActive = selectedDate
        ? (stop.visitDate ?? '').trim() === selectedDate
        : stop.included !== false;
      if (!isActive) continue;
      if (focusedPriestId !== null && stop.priestId !== focusedPriestId) {
        continue;
      }
      const street = extractStreetName(stop);
      counts.set(street, (counts.get(street) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl'));
  }, [stops, selectedDate, focusedPriestId]);

  useEffect(() => {
    if (
      focusedStreet &&
      !availableMapStreets.some((s) => s.name === focusedStreet)
    ) {
      setFocusedStreet(null);
    }
  }, [availableMapStreets, focusedStreet]);

  const handleUpdateStopStatus = useCallback(
    (stopId: string, status: UnitVisitStatus) => {
      const currentId = activeParishIdRef.current;
      const existingStop = stopsRef.current.find((s) => s.id === stopId);
      const prevStatus: UnitVisitStatus = existingStop?.visitStatus ?? 'pending';
      let updatedStop: VisitStop | null = null;

      setStops((prev) =>
        prev.map((s) => {
          if (s.id !== stopId) return s;
          updatedStop = { ...s, visitStatus: status };
          return updatedStop;
        })
      );

      if (authUser && currentId && updatedStop) {
        void batchUpdateStopFieldInFirestore(
          currentId,
          [updatedStop],
          'visitStatus'
        ).catch(() => {});
      }

      if (prevStatus !== status) {
        const statusLabels: Record<UnitVisitStatus, string> = {
          pending: 'Do odwiedzenia',
          accepted: 'Przyjęto',
          absent: 'Nieobecni',
          declined: 'Odmowa',
          invited: 'Zaproszenie',
        };
        const label = existingStop?.label || 'punkt';
        showUndoToast(
          `Zmieniono status (${label}): ${statusLabels[status]}.`,
          () => {
            let revertedStop: VisitStop | null = null;
            setStops((prev) =>
              prev.map((s) => {
                if (s.id !== stopId) return s;
                revertedStop = { ...s, visitStatus: prevStatus };
                return revertedStop;
              })
            );
            if (authUser && currentId && revertedStop) {
              void batchUpdateStopFieldInFirestore(
                currentId,
                [revertedStop],
                'visitStatus'
              ).catch(() => {});
            }
          }
        );
      }
    },
    [authUser, showUndoToast]
  );

  const handleMoveStopOrder = useCallback(
    (priestId: number, stopId: string, direction: 'up' | 'down') => {
      const route = displayedRoutes.find((r) => r.priestId === priestId);
      if (!route || route.orderedStops.length < 2) return;

      const idx = route.orderedStops.findIndex((i) => i.stop.id === stopId);
      if (idx < 0) return;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= route.orderedStops.length) return;

      const reorderedIds = route.orderedStops.map((i) => i.stop.id);
      const temp = reorderedIds[idx];
      reorderedIds[idx] = reorderedIds[targetIdx];
      reorderedIds[targetIdx] = temp;

      const orderMap = new Map<string, number>();
      reorderedIds.forEach((id, i) => orderMap.set(id, i + 1));

      const currentId = activeParishIdRef.current;
      const changed: VisitStop[] = [];
      setStops((prev) =>
        prev.map((s) => {
          const nextOrder = orderMap.get(s.id);
          if (nextOrder === undefined) return s;
          const next = { ...s, manualOrder: nextOrder };
          changed.push(next);
          return next;
        })
      );

      // Invalidate only the currently viewed day's exact cache so estimateDayRoutes uses manualOrder immediately
      setExactRoutesCache((prev) => {
        if (!prev[activeRouteCacheKey]) return prev;
        const copy = { ...prev };
        delete copy[activeRouteCacheKey];
        return copy;
      });

      if (authUser && currentId && changed.length > 0) {
        void batchUpdateStopFieldInFirestore(
          currentId,
          changed,
          'manualOrder'
        ).catch(() => {});
      }
    },
    [activeRouteCacheKey, authUser, displayedRoutes]
  );

  const handleSetRouteStartStop = useCallback(
    (priestId: number, stopId: string) => {
      const route = displayedRoutes.find((r) => r.priestId === priestId);
      if (!route || route.orderedStops.length === 0) return;

      const orderMap = computeManualOrderForStops(
        route.orderedStops.map((i) => i.stop),
        'from_stop',
        stopId
      );
      if (orderMap.size === 0) return;

      const currentId = activeParishIdRef.current;
      const changed: VisitStop[] = [];
      setStops((prev) =>
        prev.map((s) => {
          const nextOrder = orderMap.get(s.id);
          if (nextOrder === undefined) return s;
          const next = { ...s, manualOrder: nextOrder };
          changed.push(next);
          return next;
        })
      );

      setExactRoutesCache((prev) => {
        if (!prev[activeRouteCacheKey]) return prev;
        const copy = { ...prev };
        delete copy[activeRouteCacheKey];
        return copy;
      });

      if (authUser && currentId && changed.length > 0) {
        void batchUpdateStopFieldInFirestore(
          currentId,
          changed,
          'manualOrder'
        ).catch(() => {});
      }
    },
    [activeRouteCacheKey, authUser, displayedRoutes]
  );

  const handleUpdateDayTimeWindow = useCallback(
    (date: string, startTime: string, endTime: string) => {
      if (!date) return;
      const nextSeason: SeasonPlanConfig = {
        ...seasonConfig,
        dayTimeOverrides: {
          ...(seasonConfig.dayTimeOverrides ?? {}),
          [date]: { startTime, endTime },
        },
      };
      handleChangeSeasonConfig(nextSeason);
      setExactRoutesCache((prev) => {
        if (!prev[date]) return prev;
        const copy = { ...prev };
        delete copy[date];
        return copy;
      });
    },
    [handleChangeSeasonConfig, seasonConfig]
  );

  const handleComputeRoutesForDate = useCallback(
    async (
      explicitDate?: string | null,
      options?: {
        explicitStops?: VisitStop[];
        explicitSeasonConfig?: SeasonPlanConfig;
        preserveMobilePane?: boolean;
      }
    ) => {
      if (!parish) return;
      let targetDate =
        explicitDate !== undefined ? explicitDate : selectedDate;
      if (!targetDate && plannedDays.length > 0) {
        targetDate = plannedDays[0].date;
        setSelectedDate(targetDate);
      }

      const sourceStops = options?.explicitStops ?? stops;
      const targetStops = targetDate
        ? sourceStops.filter((s) => (s.visitDate ?? '').trim() === targetDate)
        : sourceStops.filter((s) => s.included !== false);

      if (targetStops.length === 0) return;

      const effectiveSeason = options?.explicitSeasonConfig ?? seasonConfig;
      const dayStart = getDayStartTime(
        targetDate,
        effectiveSeason,
        config.startTime
      );
      const dayConfig: PlanConfig = { ...config, startTime: dayStart };

      setInteractionMode('pan');
      setActiveSection('routes');
      if (!options?.preserveMobilePane) {
        setMobilePane('panel');
      }

      const computed = await computeAllRoutes(parish, targetStops, dayConfig);
      if (computed) {
        const key = targetDate ?? 'current';
        setExactRoutesCache((prev) => ({ ...prev, [key]: computed }));
      }
    },
    [
      parish,
      selectedDate,
      plannedDays,
      stops,
      seasonConfig,
      config,
      computeAllRoutes,
    ]
  );

  const handleComputeRoutes = useCallback(async () => {
    await handleComputeRoutesForDate(undefined);
  }, [handleComputeRoutesForDate]);

  const handlePlanCustomDay = useCallback(
    (payload: CustomDayPlanPayload) => {
      if (!payload.date || payload.stopIds.length === 0) return;
      const nextSeason: SeasonPlanConfig = {
        ...seasonConfig,
        dayTimeOverrides: {
          ...(seasonConfig.dayTimeOverrides ?? {}),
          [payload.date]: {
            startTime: payload.startTime,
            endTime: payload.endTime,
          },
        },
      };
      handleChangeSeasonConfig(nextSeason);

      const idSet = new Set(payload.stopIds);
      const targetStops = stopsRef.current.filter((s) => idSet.has(s.id));
      if (targetStops.length === 0) return;

      let assignedWithPriest: VisitStop[];
      if (
        payload.assignmentMode === 'split' &&
        parish &&
        config.priestCount > 1
      ) {
        assignedWithPriest = partitionStopsBySector(
          parish.location,
          targetStops,
          config.priestCount
        );
      } else {
        const singlePriestId =
          typeof payload.assignmentMode === 'number'
            ? payload.assignmentMode
            : 1;
        assignedWithPriest = targetStops.map((s) => ({
          ...s,
          priestId: singlePriestId,
        }));
      }

      const byPriest = new Map<number, VisitStop[]>();
      for (const s of assignedWithPriest) {
        const list = byPriest.get(s.priestId);
        if (list) list.push(s);
        else byPriest.set(s.priestId, [s]);
      }

      const orderMap = new Map<string, number>();
      const priestMap = new Map<string, number>();
      for (const [pId, list] of byPriest.entries()) {
        const localOrders = computeManualOrderForStops(
          list,
          payload.startDirection,
          payload.startingStopId
        );
        for (const s of list) {
          priestMap.set(s.id, pId);
          orderMap.set(s.id, localOrders.get(s.id) ?? 0);
        }
      }

      const currentId = activeParishIdRef.current;
      const changed: VisitStop[] = [];
      const nextStopsArray = stopsRef.current.map((s) => {
        if (!idSet.has(s.id)) return s;
        const next: VisitStop = {
          ...s,
          visitDate: payload.date,
          included: true,
          priestId: priestMap.get(s.id) ?? s.priestId,
          manualOrder: orderMap.get(s.id) ?? 0,
        };
        changed.push(next);
        return next;
      });
      setStops(nextStopsArray);

      setExactRoutesCache((prev) => {
        const copy = { ...prev };
        delete copy[payload.date];
        delete copy.current;
        return copy;
      });

      setSelectedDate(payload.date);
      setFocusedPriestId(null);
      setFocusedStreet(null);
      setMarkerLabelMode('numbers');
      setInteractionMode('pan');
      setActiveSection('routes');
      setMobilePane('map');

      if (authUser && currentId && changed.length > 0) {
        void batchUpdateStopFieldInFirestore(
          currentId,
          changed,
          'manualOrder_schedule'
        ).catch(() => {});
      }

      if (typeof navigator === 'undefined' || navigator.onLine) {
        void handleComputeRoutesForDate(payload.date, {
          explicitStops: nextStopsArray,
          explicitSeasonConfig: nextSeason,
          preserveMobilePane: true,
        });
      }

      showStreetFeedback(
        {
          status: 'success',
          message: `Zaplanowano ${formatPolishDateFull(payload.date)} (${payload.startTime}–${payload.endTime}) dla ${changed.length} domów.`,
        },
        5500
      );
    },
    [
      authUser,
      config.priestCount,
      handleChangeSeasonConfig,
      handleComputeRoutesForDate,
      parish,
      seasonConfig,
      showStreetFeedback,
    ]
  );

  const handleScheduleReturnVisits = useCallback(
    (targetDate: string) => {
      if (!parish || !targetDate) return;
      const candidates = collectReturnVisitCandidates(stopsRef.current);
      if (candidates.length === 0) return;

      const candidateStops = candidates.map((c) => c.stop);
      const partitioned = partitionStopsBySector(
        parish.location,
        candidateStops,
        config.priestCount
      );
      const byId = new Map(partitioned.map((s) => [s.id, s]));
      const currentId = activeParishIdRef.current;
      const scheduleChanged: VisitStop[] = [];
      const statusChanged: VisitStop[] = [];

      setStops((prev) =>
        prev.map((s) => {
          const p = byId.get(s.id);
          if (!p) return s;
          const isBlock = Boolean(
            s.isMultiUnit || (s.units && s.units.length > 0)
          );
          const resetStatus =
            !isBlock && s.visitStatus === 'absent' ? 'pending' : s.visitStatus;
          const updated: VisitStop = {
            ...p,
            visitDate: targetDate,
            included: true,
            visitStatus: resetStatus,
          };
          scheduleChanged.push(updated);
          if (resetStatus !== s.visitStatus) {
            statusChanged.push(updated);
          }
          return updated;
        })
      );

      clearRoutes();
      setSelectedDate(targetDate);
      setFocusedPriestId(null);

      if (authUser && currentId && scheduleChanged.length > 0) {
        void batchUpdateStopFieldInFirestore(
          currentId,
          scheduleChanged,
          'schedule'
        ).catch(() => {});
        if (statusChanged.length > 0) {
          void batchUpdateStopFieldInFirestore(
            currentId,
            statusChanged,
            'visitStatus'
          ).catch(() => {});
        }
      }

      showStreetFeedback(
        {
          status: 'success',
          message: `Zaplanowano dzień powrotów (${targetDate}) dla ${scheduleChanged.length} punktów.`,
        },
        5000
      );
    },
    [authUser, clearRoutes, config.priestCount, parish, showStreetFeedback]
  );

  const handleViewDayOnMap = useCallback((date: string | null) => {
    setSelectedDate(date);
    setFocusedPriestId(null);
    setInteractionMode('pan');
    setMobilePane('map');
  }, []);

  const navItems: Array<{
    id: WorkspaceSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { id: 'overview', label: 'Start', icon: LayoutDashboard },
    { id: 'parish', label: 'Parafia i ulice', icon: Church },
    {
      id: 'stops',
      label: 'Zaplanuj dzień',
      icon: CalendarPlus,
    },
    {
      id: 'routes',
      label: 'Trasa dnia',
      icon: Route,
      count: displayedRoutes.length > 0 ? displayedRoutes.length : undefined,
    },
    {
      id: 'schedule',
      label: 'Cały okres',
      icon: CalendarCheck,
      count: plannedDays.length > 0 ? plannedDays.length : undefined,
    },
    { id: 'settings', label: 'Ustawienia', icon: SlidersHorizontal },
  ];

  const isScheduleView =
    activeSection === 'schedule' && mobilePane === 'panel';

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-50 print-reset">
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
          ) : pendingVerificationEmail ? (
            <button
              type="button"
              onClick={onSignInGoogle}
              className="min-h-[38px] px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-amber-950 bg-amber-100 border border-amber-300 hover:bg-amber-200 rounded-xl inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <LogIn className="w-3.5 h-3.5 text-amber-800" />
              <span>Potwierdź e-mail</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignInGoogle}
              className="min-h-[38px] px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <LogIn className="w-3.5 h-3.5 text-amber-700" />
              <span>Zaloguj</span>
              <span className="hidden sm:inline">/ Konto</span>
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

      <OfflineIndicator />

      {/* Pending Email Verification Banner */}
      {pendingVerificationEmail && (
        <div className="no-print bg-amber-100 border-b border-amber-300 px-3 sm:px-5 py-2 flex items-center justify-between gap-2 text-xs text-amber-950 shrink-0">
          <span className="truncate">
            Konto <strong>{pendingVerificationEmail}</strong> oczekuje na
            kliknięcie linku w e-mailu, aby zapisać dane w chmurze.
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onSignInGoogle}
              className="px-2.5 py-1 text-[11px] font-semibold bg-amber-800 hover:bg-amber-900 text-white rounded-lg whitespace-nowrap"
            >
              Potwierdź teraz
            </button>
            <button
              type="button"
              onClick={onSignOutGoogle}
              className="px-2 py-1 text-[11px] font-medium bg-white border border-amber-300 text-amber-900 hover:bg-amber-50 rounded-lg whitespace-nowrap"
            >
              Wyloguj
            </button>
          </div>
        </div>
      )}

      {/* Guest Mode Warning Banner */}
      {!authUser && !pendingVerificationEmail && parish && activeSection !== 'schedule' && (
        <div className="no-print bg-amber-50 border-b border-amber-200 px-3 sm:px-5 py-2 flex items-center justify-between gap-2 text-xs text-amber-950 shrink-0">
          <span className="truncate">
            <strong>Tryb gościa</strong> — zmiany nie zapisują się na stałe po
            odświeżeniu.
          </span>
          <button
            type="button"
            onClick={onSignInGoogle}
            className="px-2.5 py-1 text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg whitespace-nowrap shrink-0"
          >
            Zaloguj / Załóż konto
          </button>
        </div>
      )}

      {/* Main App Body: Desktop Left Menu Rail + Panel + Map */}
      <div className="flex-1 min-h-0 flex overflow-hidden print-reset">
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
            <PWAInstallButton tone="dark" />
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
                ? authUser.email || 'Konto aktywne'
                : pendingVerificationEmail
                  ? `Czeka na weryfikację: ${pendingVerificationEmail}`
                  : 'Tryb bez logowania'}
            </div>
          </div>
        </nav>

        {/* Active Workspace or Schedule */}
        {isScheduleView ? (
          <main className="flex-1 min-h-0 overflow-y-auto bg-slate-50 print-reset">
            <PrintScheduleSheet
              parish={parish}
              boundary={boundary}
              stops={stops}
              config={config}
              seasonConfig={seasonConfig}
              routes={displayedRoutes}
              isExactRoute={isExactRoute}
              plannedDays={plannedDays}
              unscheduledCount={unscheduledStops.length}
              selectedDate={selectedDate}
              effectiveStartTime={effectiveStartTime}
              effectiveEndTime={effectiveEndTime}
              exactDayKeys={exactDayKeys}
              onSelectDate={setSelectedDate}
              onInspectDay={(date) => {
                setSelectedDate(date);
                setFocusedPriestId(null);
              }}
              onViewDayOnMap={handleViewDayOnMap}
              onComputeDayRoute={(date) => void handleComputeRoutesForDate(date)}
              onChangeSeasonConfig={handleChangeSeasonConfig}
              onAutoScheduleSeason={handleAutoScheduleSeason}
              onClearAllDates={handleClearAllDates}
              onUpdateDayTimeWindow={handleUpdateDayTimeWindow}
              onScheduleReturnVisits={handleScheduleReturnVisits}
              onGoToDayPlanner={handleStartNewDayInPlanner}
              onEditDayInPlanner={handleEditDayInPlanner}
              onDeleteDayRoute={handleDeleteDayPlan}
              onStartNewSeason={handleStartNewSeason}
              onBackToMap={() => {
                setActiveSection('overview');
                setMobilePane('map');
              }}
            />
          </main>
        ) : (
          <>
          <main className="no-print flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
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
                    routes={displayedRoutes}
                    plannedDays={plannedDays}
                    selectedDate={selectedDate}
                    isSignedIn={Boolean(authUser)}
                    userEmail={authUser?.email ?? null}
                    onSignInGoogle={onSignInGoogle}
                    onSelectParish={handleSelectParish}
                    onSelectSavedParish={handleSelectSavedParish}
                    onNavigateSection={navigateToSection}
                    onOpenDayRoute={(date) => {
                      setSelectedDate(date);
                      setFocusedPriestId(null);
                      navigateToSection('routes');
                    }}
                    onViewDayOnMap={handleViewDayOnMap}
                    onEditDay={handleEditDayInPlanner}
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
                    onToggleEditBoundary={() => {
                      setInteractionMode((m) => {
                        const next =
                          m === 'edit_boundary' ? 'pan' : 'edit_boundary';
                        if (next === 'edit_boundary') setMobilePane('map');
                        return next;
                      });
                    }}
                    onWrapStopsBoundary={handleWrapStopsBoundary}
                    onApplyLocalityBoundary={handleApplyLocalityBoundary}
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
                    seasonConfig={seasonConfig}
                    plannedDays={plannedDays}
                    selectedDate={selectedDate}
                    plannerLoadDate={plannerLoadState.date}
                    plannerLoadSeq={plannerLoadState.seq}
                    onSelectDate={(d) => {
                      setSelectedDate(d);
                      setFocusedPriestId(null);
                    }}
                    onAssignStopsDate={handleAssignStopsDate}
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
                    onOpenBlockUnits={(id) => setEditingBlockStopId(id)}
                    onComputeDayRoute={(d) =>
                      void handleComputeRoutesForDate(d)
                    }
                    onPlanCustomDay={handlePlanCustomDay}
                    onDeleteDayPlan={handleDeleteDayPlan}
                    onGoToSetup={() => navigateToSection('parish')}
                    onGoToSchedule={() => navigateToSection('schedule')}
                    isComputing={isComputing}
                    progressLabel={progressLabel}
                  />
                )}

                {activeSection === 'routes' && (
                  <SidebarRoutes
                    parish={parish}
                    config={config}
                    routes={displayedRoutes}
                    isExactRoute={isExactRoute}
                    plannedDays={plannedDays}
                    selectedDate={selectedDate}
                    effectiveStartTime={effectiveStartTime}
                    focusedPriestId={focusedPriestId}
                    isComputing={isComputing}
                    progressLabel={progressLabel}
                    globalError={routeError}
                    onSelectDate={(d) => {
                      setSelectedDate(d);
                      setFocusedPriestId(null);
                    }}
                    onFocusPriestOnMap={setFocusedPriestId}
                    onRecompute={handleComputeRoutes}
                    onSelectStop={(id) => {
                      setHighlightedStopId(id);
                      setMobilePane('map');
                    }}
                    onOpenBlockUnits={(id) => setEditingBlockStopId(id)}
                    onViewRouteOnMap={(priestId) => {
                      if (priestId !== undefined) setFocusedPriestId(priestId);
                      setInteractionMode('pan');
                      setMobilePane('map');
                    }}
                    onOpenSchedule={() => navigateToSection('schedule')}
                    onUpdateStopStatus={handleUpdateStopStatus}
                    onMoveStopOrder={handleMoveStopOrder}
                    onSetRouteStartStop={handleSetRouteStartStop}
                    onDeleteRoute={handleClearCurrentRoute}
                    onGoToPlanner={handleStartNewDayInPlanner}
                  />
                )}

                {activeSection === 'settings' && (
                  <SidebarSettings
                    config={config}
                    seasonConfig={seasonConfig}
                    onChangeConfig={handleChangeConfig}
                    onChangeSeasonConfig={handleChangeSeasonConfig}
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
                  routes={displayedRoutes}
                  routeObjects={displayedRouteObjects}
                  isExactRoute={isExactRoute}
                  selectedDate={selectedDate}
                  focusedPriestId={focusedPriestId}
                  canEditBoundary={activeSection === 'parish'}
                  markerLabelMode={markerLabelMode}
                  showRouteLines={showRouteLines}
                  focusedStreet={focusedStreet}
                  interactionMode={interactionMode}
                  highlightedStopId={highlightedStopId}
                  streetPickFeedback={streetPickFeedback}
                  onDismissStreetFeedback={() => setStreetPickFeedback(null)}
                  onBoundaryComplete={handleBoundaryComplete}
                  onBoundaryUpdate={(pts) =>
                    updateBoundaryAndRecheckStops(pts, true)
                  }
                  onEnterEditBoundary={() => {
                    setInteractionMode('edit_boundary');
                    setMobilePane('map');
                  }}
                  onScaleBoundary={handleScaleBoundary}
                  onCancelInteraction={() => setInteractionMode('pan')}
                  onMapAddStop={handleMapAddStop}
                  onMapPickStreet={handleMapPickStreet}
                  onSelectStop={setHighlightedStopId}
                  onDeleteStop={handleDeleteStop}
                  onOpenBlockUnits={(id) => setEditingBlockStopId(id)}
                />
              ) : (
                <OsmParishMap
                  parish={parish}
                  boundary={boundary}
                  stops={stops}
                  routes={displayedRoutes}
                  isExactRoute={isExactRoute}
                  selectedDate={selectedDate}
                  focusedPriestId={focusedPriestId}
                  canEditBoundary={activeSection === 'parish'}
                  markerLabelMode={markerLabelMode}
                  showRouteLines={showRouteLines}
                  focusedStreet={focusedStreet}
                  interactionMode={interactionMode}
                  highlightedStopId={highlightedStopId}
                  streetPickFeedback={streetPickFeedback}
                  onDismissStreetFeedback={() => setStreetPickFeedback(null)}
                  onBoundaryComplete={handleBoundaryComplete}
                  onBoundaryUpdate={(pts) =>
                    updateBoundaryAndRecheckStops(pts, true)
                  }
                  onEnterEditBoundary={() => {
                    setInteractionMode('edit_boundary');
                    setMobilePane('map');
                  }}
                  onScaleBoundary={handleScaleBoundary}
                  onCancelInteraction={() => setInteractionMode('pan')}
                  onMapAddStop={handleMapAddStop}
                  onMapPickStreet={handleMapPickStreet}
                  onSelectStop={setHighlightedStopId}
                  onDeleteStop={handleDeleteStop}
                  onOpenBlockUnits={(id) => setEditingBlockStopId(id)}
                />
              )}

              {/* Compact Map Readability & Day HUD */}
              {interactionMode === 'pan' &&
                (plannedDays.length > 0 ||
                  displayedRoutes.length > 0 ||
                  activeStopsCount > 0) && (
                  <div className="no-print absolute bottom-6 right-3 sm:right-4 sm:bottom-5 z-[460] w-fit max-w-[calc(100%-24px)] bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-lg p-1.5 flex flex-wrap items-center justify-end gap-1.5">
                    {plannedDays.length > 0 && (
                      <div className="flex items-center gap-0.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => {
                            const idx = plannedDays.findIndex(
                              (d) => d.date === selectedDate
                            );
                            const nextIdx =
                              idx <= 0 ? plannedDays.length - 1 : idx - 1;
                            setSelectedDate(plannedDays[nextIdx].date);
                            setFocusedPriestId(null);
                          }}
                          aria-label="Poprzedni dzień"
                          className="min-w-[32px] min-h-[32px] inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 shrink-0"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>

                        <select
                          value={selectedDate ?? ''}
                          onChange={(e) => {
                            setSelectedDate(e.target.value || null);
                            setFocusedPriestId(null);
                          }}
                          aria-label="Wybierz dzień na mapie"
                          className="min-h-[32px] px-2 py-1 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-900 tabular-nums focus:outline-none focus:border-amber-600 max-w-[165px]"
                        >
                          {plannedDays.map((d) => (
                            <option key={d.date} value={d.date}>
                              {formatPolishDateChip(d.date)} · {d.startTime}–
                              {d.estimatedEndTime}
                            </option>
                          ))}
                          <option value="">Wszystkie zaznaczone</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => {
                            const idx = plannedDays.findIndex(
                              (d) => d.date === selectedDate
                            );
                            const nextIdx =
                              idx < 0 || idx >= plannedDays.length - 1
                                ? 0
                                : idx + 1;
                            setSelectedDate(plannedDays[nextIdx].date);
                            setFocusedPriestId(null);
                          }}
                          aria-label="Następny dzień"
                          className="min-w-[32px] min-h-[32px] inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 shrink-0"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {displayedRoutes.length > 1 && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setFocusedPriestId(null)}
                          className={`min-h-[32px] px-2 py-1 text-[11px] font-medium rounded-lg transition-colors ${
                            focusedPriestId === null
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          Wszyscy
                        </button>
                        {displayedRoutes.map((r) => (
                          <button
                            key={r.priestId}
                            type="button"
                            onClick={() =>
                              setFocusedPriestId(
                                focusedPriestId === r.priestId
                                  ? null
                                  : r.priestId
                              )
                            }
                            className={`min-h-[32px] px-2 py-1 text-[11px] font-medium rounded-lg inline-flex items-center gap-1 transition-colors ${
                              focusedPriestId === r.priestId
                                ? 'bg-slate-900 text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: r.color }}
                            />
                            Ks. {r.priestId}
                          </button>
                        ))}
                      </div>
                    )}

                    {availableMapStreets.length > 1 && (
                      <select
                        value={focusedStreet ?? ''}
                        onChange={(e) =>
                          setFocusedStreet(e.target.value || null)
                        }
                        aria-label="Filtruj ulicę na mapie"
                        className={`min-h-[32px] px-2 py-1 text-[11px] font-medium border rounded-lg focus:outline-none max-w-[165px] ${
                          focusedStreet
                            ? 'bg-amber-50 border-amber-400 text-amber-950 font-semibold'
                            : 'bg-slate-50 border-slate-200 text-slate-800'
                        }`}
                      >
                        <option value="">
                          Wszystkie ulice ({availableMapStreets.length})
                        </option>
                        {availableMapStreets.map((st) => (
                          <option key={st.name} value={st.name}>
                            {st.name} ({st.count})
                          </option>
                        ))}
                      </select>
                    )}

                    {activeStopsCount > 0 && (
                      <div
                        role="group"
                        aria-label="Sposób wyświetlania punktów na mapie"
                        className="inline-flex items-center rounded-lg bg-slate-100 p-0.5"
                      >
                        {(
                          [
                            { id: 'auto', label: 'Auto' },
                            { id: 'numbers', label: 'Numery' },
                            { id: 'dots', label: 'Kropki' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setMarkerLabelMode(opt.id)}
                            className={`min-h-[28px] px-2 py-0.5 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap ${
                              markerLabelMode === opt.id
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {displayedRoutes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowRouteLines((v) => !v)}
                        title={
                          showRouteLines
                            ? 'Ukryj linię trasy'
                            : 'Pokaż linię trasy'
                        }
                        className={`min-h-[32px] px-2.5 py-1 text-[11px] font-semibold rounded-lg inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                          showRouteLines
                            ? 'bg-slate-900 text-white hover:bg-slate-800'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {showRouteLines ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5" />
                        )}
                        <span>Trasa</span>
                      </button>
                    )}

                    {displayedRoutes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => navigateToSection('routes')}
                        className="lg:hidden min-h-[32px] px-2.5 py-1 text-[11px] font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <ListOrdered className="w-3.5 h-3.5" />
                        Szczegóły
                      </button>
                    )}
                  </div>
                )}

              {/* Top-left Map Route Info Pill (START + Streets) & Priest Legend */}
              <div className="no-print absolute top-3 left-3 z-[450] flex flex-col items-start gap-1.5 max-w-[calc(100%-24px)] sm:max-w-[420px] pointer-events-none">
                {interactionMode === 'pan' &&
                  !streetPickFeedback &&
                  displayedRoutes.length > 0 && (() => {
                    const visibleRoutesForPill =
                      focusedPriestId !== null
                        ? displayedRoutes.filter(
                            (r) => r.priestId === focusedPriestId
                          )
                        : displayedRoutes;
                    const primaryStart =
                      visibleRoutesForPill[0]?.orderedStops[0];
                    const coveredStreets = Array.from(
                      new Set(
                        visibleRoutesForPill.flatMap((r) =>
                          r.orderedStops.map((i) => extractStreetName(i.stop))
                        )
                      )
                    );
                    const totalPoints = visibleRoutesForPill.reduce(
                      (acc, r) => acc + r.orderedStops.length,
                      0
                    );
                    if (!primaryStart) return null;
                    return (
                      <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl px-3 py-2 shadow-md text-[11px] text-slate-800 space-y-0.5 pointer-events-auto">
                        <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                          {selectedDate && (
                            <span className="text-slate-900 tabular-nums">
                              {formatPolishDateChip(selectedDate)} ·{' '}
                              {effectiveStartTime}–{effectiveEndTime}
                            </span>
                          )}
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-700 text-white text-[10px] font-extrabold uppercase tracking-wide">
                            START
                          </span>
                          <span className="text-emerald-900 truncate max-w-[200px]">
                            {primaryStart.stop.address ||
                              primaryStart.stop.label}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 truncate">
                          <span className="font-medium text-slate-800">
                            Ulice:
                          </span>{' '}
                          {coveredStreets.join(', ')} ·{' '}
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            {totalPoints}{' '}
                            {totalPoints === 1
                              ? 'dom'
                              : totalPoints < 5
                                ? 'domy'
                                : 'domów'}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                {activeStopsCount > 0 && config.priestCount > 1 && (
                  <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-sm flex flex-wrap items-center gap-2.5 text-xs text-slate-700">
                    {PRIEST_PALETTE.slice(0, config.priestCount).map((p) => (
                      <span
                        key={p.id}
                        className="inline-flex items-center gap-1.5"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: p.color }}
                        />
                        Ks. {p.id}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </main>
          <div className="print-offscreen print-reset bg-white w-full">
            <PrintScheduleSheet
              parish={parish}
              boundary={boundary}
              config={config}
              routes={displayedRoutes}
              isExactRoute={isExactRoute}
              plannedDays={plannedDays}
              unscheduledCount={unscheduledStops.length}
              selectedDate={selectedDate}
              effectiveStartTime={effectiveStartTime}
              effectiveEndTime={effectiveEndTime}
              exactDayKeys={exactDayKeys}
              forcedViewMode={
                displayedRoutes.length > 0 ||
                selectedDate !== null ||
                plannedDays.length <= 1
                  ? 'day'
                  : 'season'
              }
              onSelectDate={setSelectedDate}
              onInspectDay={(date) => {
                setSelectedDate(date);
                setFocusedPriestId(null);
              }}
              onViewDayOnMap={handleViewDayOnMap}
              onComputeDayRoute={(date) => void handleComputeRoutesForDate(date)}
              onBackToMap={() => {
                setActiveSection('overview');
                setMobilePane('map');
              }}
            />
          </div>
          </>
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
          <span>Start</span>
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
          <CalendarPlus className="w-5 h-5" />
          <span>Zaplanuj</span>
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
          onClick={() => navigateToSection('routes')}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
            mobilePane === 'panel' && activeSection === 'routes'
              ? 'text-amber-800'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Route className="w-5 h-5" />
          <span className="tabular-nums">
            Trasy{displayedRoutes.length > 0 ? ` (${displayedRoutes.length})` : ''}
          </span>
        </button>

        <button
          type="button"
          onClick={() => navigateToSection('schedule')}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
            mobilePane === 'panel' && activeSection === 'schedule'
              ? 'text-amber-800'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <CalendarCheck className="w-5 h-5" />
          <span className="tabular-nums">
            Okres{plannedDays.length > 0 ? ` (${plannedDays.length})` : ''}
          </span>
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
              <PWAInstallButton tone="light" />
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
                  Zaloguj / Załóż konto (e-mail lub Google)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {undoToast && (
        <div
          role="status"
          aria-live="polite"
          className="no-print fixed bottom-20 lg:bottom-4 left-3 right-3 sm:left-auto sm:right-4 z-[960] bg-slate-900 text-white border border-slate-700 rounded-xl shadow-xl px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
        >
          <span className="truncate">{undoToast.message}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                undoToast.onUndo();
                setUndoToast(null);
              }}
              className="min-h-[30px] px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg inline-flex items-center gap-1 transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
              Cofnij
            </button>
            <button
              type="button"
              onClick={() => setUndoToast(null)}
              aria-label="Zamknij"
              className="p-1 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title ?? ''}
        description={confirmState?.description ?? ''}
        confirmLabel={confirmState?.confirmLabel}
        variant={confirmState?.variant}
        onConfirm={() => {
          confirmState?.onConfirm();
        }}
        onCancel={() => setConfirmState(null)}
      />

      <ArchitectureGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
      />

      <BlockUnitsModal
        stop={stops.find((s) => s.id === editingBlockStopId) ?? null}
        defaultVisitMinutes={config.defaultVisitMinutes}
        onClose={() => setEditingBlockStopId(null)}
        onSave={(updated) => handleUpdateStop(updated.id, updated)}
      />
    </div>
  );
}

function GoogleMapsWorkspace({
  authUser,
  pendingVerificationEmail,
  onSignInGoogle,
  onSignOutGoogle,
}: {
  authUser: User | null;
  pendingVerificationEmail: string | null;
  onSignInGoogle: () => void;
  onSignOutGoogle: () => void;
}) {
  const optimizer = useParishRouteOptimizer();
  return (
    <MapEngineProvider engine="google">
      <ParishPlannerWorkspace
        authUser={authUser}
        pendingVerificationEmail={pendingVerificationEmail}
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
  pendingVerificationEmail,
  onSignInGoogle,
  onSignOutGoogle,
}: {
  authUser: User | null;
  pendingVerificationEmail: string | null;
  onSignInGoogle: () => void;
  onSignOutGoogle: () => void;
}) {
  const optimizer = useOsmRouteOptimizer();
  return (
    <MapEngineProvider engine="osm">
      <ParishPlannerWorkspace
        authUser={authUser}
        pendingVerificationEmail={pendingVerificationEmail}
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
  const [, setAuthRefreshTick] = useState(0);
  const [authModalOpen, setAuthModalOpen] = useState(false);
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
      setAuthRefreshTick((n) => n + 1);
    });
    return () => unsub();
  }, []);

  const handleSignInGoogle = useCallback(async () => {
    setAuthError(null);
    await signInWithPopup(auth, googleProvider);
    setAuthModalOpen(false);
  }, []);

  const handleSignOutGoogle = useCallback(async () => {
    try {
      await signOut(auth);
    } catch {
      // Ignore sign-out errors
    }
  }, []);

  const verifiedAuthUser = authUser && authUser.emailVerified ? authUser : null;
  const pendingVerificationEmail =
    authUser && !authUser.emailVerified ? authUser.email || 'Twój e-mail' : null;

  return (
    <div className="h-full flex flex-col bg-slate-50 print-reset">
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
          authUser={verifiedAuthUser}
          pendingVerificationEmail={pendingVerificationEmail}
          onSignInGoogle={() => setAuthModalOpen(true)}
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
            authUser={verifiedAuthUser}
            pendingVerificationEmail={pendingVerificationEmail}
            onSignInGoogle={() => setAuthModalOpen(true)}
            onSignOutGoogle={handleSignOutGoogle}
          />
        </APIProvider>
      )}

      <AuthModal
        open={authModalOpen}
        authUser={authUser}
        onClose={() => setAuthModalOpen(false)}
        onSignInGoogle={handleSignInGoogle}
        onUserVerified={(user) => {
          setAuthUser(user);
          setAuthRefreshTick((n) => n + 1);
        }}
      />
    </div>
  );
}
