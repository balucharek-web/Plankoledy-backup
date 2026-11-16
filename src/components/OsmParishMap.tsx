import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Crosshair,
  Loader2,
  LocateFixed,
  MapPinPlus,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Pencil,
  Plus,
  Route,
  Scan,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useUserGpsLocation } from '../hooks/useUserGpsLocation';
import {
  BoundaryDrawTool,
  LatLng,
  MapInteractionMode,
  MarkerLabelMode,
  PRIEST_PALETTE,
  ParishCenter,
  PriestRouteResult,
  StreetPickFeedback,
  VisitStop,
} from '../types/parish';
import {
  buildRouteStopLookup,
  buildStreetOverlayPaths,
  computePolygonAreaSqMeters,
  computeRectanglePolygon,
  computeStopMarkerAppearance,
  expandBoundaryPolygonMeters,
  extractStreetName,
  formatPolygonArea,
  isPointInsideBoundary,
  simplifyPolygonRDP,
} from '../utils/spatial';

interface OsmParishMapProps {
  parish: ParishCenter | null;
  boundary: LatLng[];
  stops: VisitStop[];
  routes: PriestRouteResult[];
  isExactRoute: boolean;
  selectedDate: string | null;
  focusedPriestId: number | null;
  canEditBoundary?: boolean;
  markerLabelMode?: MarkerLabelMode;
  showRouteLines?: boolean;
  focusedStreet?: string | null;
  interactionMode: MapInteractionMode;
  highlightedStopId: string | null;
  lassoSelectedIds?: string[];
  streetPickFeedback: StreetPickFeedback | null;
  onDismissStreetFeedback: () => void;
  onBoundaryComplete: (points: LatLng[]) => void;
  onBoundaryUpdate: (points: LatLng[]) => void;
  onEnterEditBoundary?: () => void;
  onScaleBoundary?: (factor: number) => void;
  onCancelInteraction: () => void;
  onMapAddStop: (location: LatLng) => void;
  onMapPickStreet: (location: LatLng) => void;
  onSelectStop: (stopId: string | null) => void;
  onDeleteStop: (stopId: string) => void;
  onOpenBlockUnits?: (stopId: string) => void;
  onLassoSelectStops?: (stopIds: string[]) => void;
  onSelectStreetOverlay?: (streetName: string) => void;
}

const DEFAULT_POLAND_CENTER: LatLng = { lat: 52.0693, lng: 19.4803 };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const OsmParishMap: React.FC<OsmParishMapProps> = ({
  parish,
  boundary,
  stops,
  routes,
  isExactRoute,
  selectedDate,
  focusedPriestId,
  canEditBoundary = true,
  markerLabelMode = 'auto',
  showRouteLines = true,
  focusedStreet = null,
  interactionMode,
  highlightedStopId,
  lassoSelectedIds = [],
  streetPickFeedback,
  onDismissStreetFeedback,
  onBoundaryComplete,
  onBoundaryUpdate,
  onEnterEditBoundary,
  onScaleBoundary,
  onCancelInteraction,
  onMapAddStop,
  onMapPickStreet,
  onSelectStop,
  onDeleteStop,
  onOpenBlockUnits,
  onLassoSelectStops,
  onSelectStreetOverlay,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const parishLayerRef = useRef<L.LayerGroup | null>(null);
  const boundaryLayerRef = useRef<L.LayerGroup | null>(null);
  const streetOverlaysLayerRef = useRef<L.LayerGroup | null>(null);
  const draftLayerRef = useRef<L.LayerGroup | null>(null);
  const rubberBandLayerRef = useRef<L.LayerGroup | null>(null);
  const stopsLayerRef = useRef<L.LayerGroup | null>(null);
  const routesLayerRef = useRef<L.LayerGroup | null>(null);
  const gpsLayerRef = useRef<L.LayerGroup | null>(null);
  const markersByStopIdRef = useRef<Record<string, L.Marker>>({});
  const lastParishKeyRef = useRef<string>('');
  const lastFittedKeyRef = useRef<string>('');
  const hasCenteredGpsRef = useRef<boolean>(false);

  const gps = useUserGpsLocation();
  const [mapZoom, setMapZoom] = useState<number>(parish ? 15 : 6);
  const [drawTool, setDrawTool] = useState<BoundaryDrawTool>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768
      ? 'crosshair'
      : 'lasso'
  );
  const drawToolRef = useRef<BoundaryDrawTool>(drawTool);
  drawToolRef.current = drawTool;

  const [draftPoints, setDraftPoints] = useState<LatLng[]>([]);
  const draftPointsRef = useRef<LatLng[]>([]);
  const [lassoHint, setLassoHint] = useState<string | null>(null);
  const [lassoLiveCount, setLassoLiveCount] = useState<number>(0);
  const [spacePanning, setSpacePanning] = useState(false);
  const spaceHeldRef = useRef(false);
  const [selectedVertexIdx, setSelectedVertexIdx] = useState<number | null>(
    null
  );

  const interactionModeRef = useRef(interactionMode);
  interactionModeRef.current = interactionMode;
  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const focusedPriestIdRef = useRef(focusedPriestId);
  focusedPriestIdRef.current = focusedPriestId;
  const focusedStreetRef = useRef(focusedStreet);
  focusedStreetRef.current = focusedStreet;
  const onMapAddStopRef = useRef(onMapAddStop);
  onMapAddStopRef.current = onMapAddStop;
  const onMapPickStreetRef = useRef(onMapPickStreet);
  onMapPickStreetRef.current = onMapPickStreet;
  const onSelectStopRef = useRef(onSelectStop);
  onSelectStopRef.current = onSelectStop;
  const onDeleteStopRef = useRef(onDeleteStop);
  onDeleteStopRef.current = onDeleteStop;
  const onOpenBlockUnitsRef = useRef(onOpenBlockUnits);
  onOpenBlockUnitsRef.current = onOpenBlockUnits;
  const onBoundaryCompleteRef = useRef(onBoundaryComplete);
  onBoundaryCompleteRef.current = onBoundaryComplete;
  const onBoundaryUpdateRef = useRef(onBoundaryUpdate);
  onBoundaryUpdateRef.current = onBoundaryUpdate;
  const onCancelInteractionRef = useRef(onCancelInteraction);
  onCancelInteractionRef.current = onCancelInteraction;
  const onLassoSelectStopsRef = useRef(onLassoSelectStops);
  onLassoSelectStopsRef.current = onLassoSelectStops;
  const onSelectStreetOverlayRef = useRef(onSelectStreetOverlay);
  onSelectStreetOverlayRef.current = onSelectStreetOverlay;
  const highlightedStopIdRef = useRef(highlightedStopId);
  highlightedStopIdRef.current = highlightedStopId;

  const lassoSelectedSet = useMemo(
    () => new Set(lassoSelectedIds),
    [lassoSelectedIds]
  );

  const streetOverlayPaths = useMemo(
    () => buildStreetOverlayPaths(stops),
    [stops]
  );

  const routeMetaByStopId = useMemo(
    () => buildRouteStopLookup(routes),
    [routes]
  );

  const boundaryAreaLabel = useMemo(
    () => formatPolygonArea(computePolygonAreaSqMeters(boundary)),
    [boundary]
  );

  const activeVisibleCount = useMemo(() => {
    let count = 0;
    for (const stop of stops) {
      const isActive = selectedDate
        ? (stop.visitDate ?? '').trim() === selectedDate
        : stop.included !== false;
      if (!isActive) continue;
      if (focusedPriestId !== null && stop.priestId !== focusedPriestId) {
        continue;
      }
      if (focusedStreet && extractStreetName(stop) !== focusedStreet) {
        continue;
      }
      count += 1;
    }
    return count;
  }, [stops, selectedDate, focusedPriestId, focusedStreet]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [
        parish?.location.lat ?? DEFAULT_POLAND_CENTER.lat,
        parish?.location.lng ?? DEFAULT_POLAND_CENTER.lng,
      ],
      zoom: parish ? 15 : 6,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    routesLayerRef.current = L.layerGroup().addTo(map);
    streetOverlaysLayerRef.current = L.layerGroup().addTo(map);
    boundaryLayerRef.current = L.layerGroup().addTo(map);
    draftLayerRef.current = L.layerGroup().addTo(map);
    rubberBandLayerRef.current = L.layerGroup().addTo(map);
    stopsLayerRef.current = L.layerGroup().addTo(map);
    parishLayerRef.current = L.layerGroup().addTo(map);
    gpsLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (ev: L.LeafletMouseEvent) => {
      const coords: LatLng = { lat: ev.latlng.lat, lng: ev.latlng.lng };
      const mode = interactionModeRef.current;

      if (mode === 'add_stop') {
        onMapAddStopRef.current(coords);
      } else if (mode === 'pick_street') {
        onMapPickStreetRef.current(coords);
      } else if (mode === 'draw_boundary' && drawToolRef.current === 'points') {
        const next = [...draftPointsRef.current, coords];
        draftPointsRef.current = next;
        setDraftPoints(next);
      } else if (mode === 'edit_boundary') {
        setSelectedVertexIdx(null);
      } else if (highlightedStopIdRef.current) {
        onSelectStopRef.current(null);
      }
    });

    const updateRubberBand = (cursorCoords: LatLng) => {
      const rb = rubberBandLayerRef.current;
      if (!rb) return;
      rb.clearLayers();
      const pts = draftPointsRef.current;
      if (
        interactionModeRef.current !== 'draw_boundary' ||
        pts.length === 0 ||
        drawToolRef.current === 'lasso' ||
        drawToolRef.current === 'rect'
      ) {
        return;
      }
      const last = pts[pts.length - 1];
      L.polyline(
        [
          [last.lat, last.lng],
          [cursorCoords.lat, cursorCoords.lng],
        ],
        {
          color: '#B45309',
          weight: 2,
          dashArray: '5, 6',
          opacity: 0.85,
          interactive: false,
        }
      ).addTo(rb);
      if (pts.length >= 2) {
        const first = pts[0];
        L.polyline(
          [
            [cursorCoords.lat, cursorCoords.lng],
            [first.lat, first.lng],
          ],
          {
            color: '#D97706',
            weight: 1.5,
            dashArray: '4, 6',
            opacity: 0.5,
            interactive: false,
          }
        ).addTo(rb);
      }
    };

    map.on('mousemove', (ev: L.LeafletMouseEvent) => {
      if (
        interactionModeRef.current === 'draw_boundary' &&
        drawToolRef.current === 'points'
      ) {
        updateRubberBand({ lat: ev.latlng.lat, lng: ev.latlng.lng });
      }
    });

    map.on('move', () => {
      if (
        interactionModeRef.current === 'draw_boundary' &&
        drawToolRef.current === 'crosshair'
      ) {
        const c = map.getCenter();
        updateRubberBand({ lat: c.lat, lng: c.lng });
      }
    });

    map.on('dblclick', (ev: L.LeafletMouseEvent) => {
      if (
        interactionModeRef.current === 'draw_boundary' &&
        drawToolRef.current === 'points' &&
        draftPointsRef.current.length >= 3
      ) {
        L.DomEvent.stop(ev);
        const pts = draftPointsRef.current;
        draftPointsRef.current = [];
        setDraftPoints([]);
        rubberBandLayerRef.current?.clearLayers();
        onBoundaryCompleteRef.current(pts);
      }
    });

    map.on('zoomend', () => {
      setMapZoom(map.getZoom());
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;

    const isFreehandCapture =
      interactionMode === 'lasso_select' ||
      (interactionMode === 'draw_boundary' &&
        (drawTool === 'lasso' || drawTool === 'rect'));

    if (interactionMode === 'draw_boundary') {
      setLassoHint(null);
      if (isFreehandCapture) {
        container.style.cursor = spacePanning ? 'grab' : 'crosshair';
        container.style.touchAction = 'none';
        if (spacePanning) map.dragging.enable();
        else map.dragging.disable();
        map.doubleClickZoom.disable();
      } else if (drawTool === 'crosshair') {
        container.style.cursor = 'grab';
        container.style.touchAction = '';
        map.dragging.enable();
        map.doubleClickZoom.enable();
      } else {
        container.style.cursor = 'crosshair';
        container.style.touchAction = '';
        map.dragging.enable();
        map.doubleClickZoom.disable();
      }
    } else if (interactionMode === 'lasso_select') {
      setLassoHint(null);
      setLassoLiveCount(0);
      container.style.cursor = spacePanning ? 'grab' : 'crosshair';
      container.style.touchAction = 'none';
      if (spacePanning) map.dragging.enable();
      else map.dragging.disable();
      map.doubleClickZoom.disable();
    } else if (interactionMode === 'edit_boundary') {
      container.style.cursor = '';
      container.style.touchAction = '';
      map.dragging.enable();
      map.doubleClickZoom.enable();
    } else if (interactionMode === 'pan') {
      container.style.cursor = '';
      container.style.touchAction = '';
      map.dragging.enable();
      map.doubleClickZoom.enable();
    } else {
      container.style.cursor = 'crosshair';
      container.style.touchAction = '';
      map.dragging.enable();
      map.doubleClickZoom.enable();
    }

    if (interactionMode !== 'draw_boundary') {
      draftPointsRef.current = [];
      setDraftPoints([]);
      setLassoHint(null);
      rubberBandLayerRef.current?.clearLayers();
    }
    if (interactionMode !== 'edit_boundary') {
      setSelectedVertexIdx(null);
    }
    if (interactionMode !== 'lasso_select') {
      setLassoLiveCount(0);
    }
  }, [interactionMode, drawTool, spacePanning]);

  // Unified pointer capture for freehand boundary ('lasso'), rectangle ('rect'), and map stop selection ('lasso_select'),
  // with 2-finger pan/zoom on mobile + Spacebar or Right-mouse-drag panning on PC.
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    const layer = draftLayerRef.current;
    if (!map || !container || !layer) return;

    const isBoundaryLasso =
      interactionMode === 'draw_boundary' && drawTool === 'lasso';
    const isBoundaryRect =
      interactionMode === 'draw_boundary' && drawTool === 'rect';
    const isStopLasso = interactionMode === 'lasso_select';
    if (!isBoundaryLasso && !isBoundaryRect && !isStopLasso) return;

    const strokeColor = isStopLasso ? '#4F46E5' : '#B45309';
    const fillColor = isStopLasso ? '#6366F1' : '#F59E0B';

    let drawing = false;
    let activePointerId: number | null = null;
    let rightPanPointerId: number | null = null;
    let panLastX = 0;
    let panLastY = 0;
    let lastClientX = 0;
    let lastClientY = 0;
    let rawPoints: LatLng[] = [];
    let rectStart: LatLng | null = null;
    let rectEnd: LatLng | null = null;
    let strokeLine: L.Polyline | null = null;
    let strokeFill: L.Polygon | null = null;
    let rectPreview: L.Rectangle | null = null;
    let multiTouchActive = false;

    const toLatLng = (clientX: number, clientY: number): LatLng => {
      const rect = container.getBoundingClientRect();
      const pt = L.point(clientX - rect.left, clientY - rect.top);
      const ll = map.containerPointToLatLng(pt);
      return { lat: ll.lat, lng: ll.lng };
    };

    const matchStopsInside = (poly: LatLng[]): string[] => {
      if (poly.length < 3) return [];
      const curDate = selectedDateRef.current;
      const curPriest = focusedPriestIdRef.current;
      const curStreet = focusedStreetRef.current;
      const ids: string[] = [];
      for (const s of stopsRef.current) {
        const isActive = curDate
          ? (s.visitDate ?? '').trim() === curDate
          : s.included !== false;
        if (!isActive) continue;
        if (curPriest !== null && s.priestId !== curPriest) continue;
        if (curStreet && extractStreetName(s) !== curStreet) continue;
        if (isPointInsideBoundary(s.location, poly)) {
          ids.push(s.id);
        }
      }
      return ids;
    };

    const cleanupStroke = () => {
      drawing = false;
      activePointerId = null;
      rawPoints = [];
      rectStart = null;
      rectEnd = null;
      if (isStopLasso) setLassoLiveCount(0);
      if (strokeLine) {
        layer.removeLayer(strokeLine);
        strokeLine = null;
      }
      if (strokeFill) {
        layer.removeLayer(strokeFill);
        strokeFill = null;
      }
      if (rectPreview) {
        layer.removeLayer(rectPreview);
        rectPreview = null;
      }
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code !== 'Space') return;
      const target = ev.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      ev.preventDefault();
      if (!spaceHeldRef.current) {
        spaceHeldRef.current = true;
        setSpacePanning(true);
        if (!drawing) map.dragging.enable();
      }
    };

    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code !== 'Space') return;
      spaceHeldRef.current = false;
      setSpacePanning(false);
      if (!drawing && !multiTouchActive) {
        map.dragging.disable();
      }
    };

    const onTouchStart = (ev: TouchEvent) => {
      if (ev.touches.length >= 2) {
        multiTouchActive = true;
        cleanupStroke();
        container.style.touchAction = 'auto';
        map.dragging.enable();
      }
    };

    const onTouchEnd = (ev: TouchEvent) => {
      if (ev.touches.length === 0 && multiTouchActive) {
        multiTouchActive = false;
        container.style.touchAction = 'none';
        if (!spaceHeldRef.current) {
          map.dragging.disable();
        }
      }
    };

    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
    };

    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target?.closest('.no-print, .leaflet-control')) return;
      if (multiTouchActive) return;

      // Right-mouse drag pans the map cleanly while drawing on PC
      if (ev.pointerType === 'mouse' && ev.button === 2) {
        ev.preventDefault();
        rightPanPointerId = ev.pointerId;
        panLastX = ev.clientX;
        panLastY = ev.clientY;
        container.style.cursor = 'grabbing';
        try {
          container.setPointerCapture(ev.pointerId);
        } catch {
          // Ignore
        }
        return;
      }

      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      if (spaceHeldRef.current) return;

      ev.preventDefault();
      setLassoHint(null);
      drawing = true;
      activePointerId = ev.pointerId;
      lastClientX = ev.clientX;
      lastClientY = ev.clientY;
      const startPt = toLatLng(ev.clientX, ev.clientY);

      layer.clearLayers();
      if (isBoundaryRect) {
        rectStart = startPt;
        rectEnd = startPt;
        rectPreview = L.rectangle(
          [
            [startPt.lat, startPt.lng],
            [startPt.lat, startPt.lng],
          ],
          {
            color: strokeColor,
            weight: 3,
            dashArray: '6, 5',
            fillColor,
            fillOpacity: 0.16,
            interactive: false,
          }
        ).addTo(layer);
      } else {
        rawPoints = [startPt];
        strokeFill = L.polygon([[startPt.lat, startPt.lng]], {
          color: strokeColor,
          weight: 0,
          fillColor,
          fillOpacity: 0.16,
          interactive: false,
        }).addTo(layer);
        strokeLine = L.polyline([[startPt.lat, startPt.lng]], {
          color: strokeColor,
          weight: 3.5,
          opacity: 0.95,
          dashArray: isStopLasso ? '6, 5' : undefined,
          interactive: false,
        }).addTo(layer);
      }

      try {
        container.setPointerCapture(ev.pointerId);
      } catch {
        // Ignore if capture is unsupported
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId === rightPanPointerId) {
        const dx = panLastX - ev.clientX;
        const dy = panLastY - ev.clientY;
        panLastX = ev.clientX;
        panLastY = ev.clientY;
        map.panBy([dx, dy], { animate: false });
        return;
      }

      if (!drawing || ev.pointerId !== activePointerId || multiTouchActive) {
        return;
      }

      if (isBoundaryRect && rectStart) {
        const curPt = toLatLng(ev.clientX, ev.clientY);
        rectEnd = curPt;
        rectPreview?.setBounds([
          [Math.min(rectStart.lat, curPt.lat), Math.min(rectStart.lng, curPt.lng)],
          [Math.max(rectStart.lat, curPt.lat), Math.max(rectStart.lng, curPt.lng)],
        ]);
        return;
      }

      const distPx = Math.hypot(
        ev.clientX - lastClientX,
        ev.clientY - lastClientY
      );
      if (distPx < 6) return;
      lastClientX = ev.clientX;
      lastClientY = ev.clientY;

      const pt = toLatLng(ev.clientX, ev.clientY);
      rawPoints.push(pt);
      const coords = rawPoints.map((p) => [p.lat, p.lng] as [number, number]);
      strokeLine?.setLatLngs(coords);
      if (rawPoints.length >= 3) {
        strokeFill?.setLatLngs(coords);
        if (isStopLasso && rawPoints.length % 3 === 0) {
          setLassoLiveCount(matchStopsInside(rawPoints).length);
        }
      }
    };

    const finishStroke = (ev: PointerEvent) => {
      if (ev.pointerId === rightPanPointerId) {
        rightPanPointerId = null;
        container.style.cursor = spaceHeldRef.current ? 'grab' : 'crosshair';
        try {
          container.releasePointerCapture(ev.pointerId);
        } catch {
          // Ignore
        }
        return;
      }

      if (!drawing || ev.pointerId !== activePointerId) return;
      try {
        container.releasePointerCapture(ev.pointerId);
      } catch {
        // Ignore
      }

      if (isBoundaryRect) {
        const s = rectStart;
        const e = rectEnd ?? toLatLng(ev.clientX, ev.clientY);
        cleanupStroke();
        if (!s) return;
        const spanLatM = Math.abs(e.lat - s.lat) * 111320;
        const spanLngM =
          Math.abs(e.lng - s.lng) *
          111320 *
          Math.max(0.2, Math.cos((s.lat * Math.PI) / 180));
        if (spanLatM < 35 || spanLngM < 35) {
          setLassoHint(
            'Przeciągnij prostokąt od rogu do przeciwnego rogu (min. ~35 m).'
          );
          return;
        }
        onBoundaryCompleteRef.current(computeRectanglePolygon(s, e));
        return;
      }

      const captured = [...rawPoints];
      cleanupStroke();

      if (isStopLasso) {
        if (captured.length < 4) {
          setLassoHint(
            'Zakreśl pętlę wokół wybranej grupy domów lub ulicy.'
          );
          return;
        }
        const matched = matchStopsInside(captured);
        if (matched.length === 0) {
          setLassoHint('W zakreślonej pętli nie było widocznych domów.');
          return;
        }
        onLassoSelectStopsRef.current?.(matched);
        return;
      }

      if (captured.length < 5) {
        setLassoHint(
          'Przytrzymaj i zakreśl pętlę wokół parafii jednym ruchem (lub przełącz na Ramkę / Celownik).'
        );
        return;
      }

      const lats = captured.map((p) => p.lat);
      const lngs = captured.map((p) => p.lng);
      const spanLatM = (Math.max(...lats) - Math.min(...lats)) * 111320;
      const spanLngM =
        (Math.max(...lngs) - Math.min(...lngs)) *
        111320 *
        Math.max(0.2, Math.cos((captured[0].lat * Math.PI) / 180));
      if (Math.hypot(spanLatM, spanLngM) < 45) {
        setLassoHint(
          'Zakreślony kształt był za mały — obrysuj większy fragment mapy.'
        );
        return;
      }

      const simplified = simplifyPolygonRDP(captured, 18, 22);
      if (simplified.length >= 3) {
        onBoundaryCompleteRef.current(simplified);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchEnd, { passive: true });
    container.addEventListener('contextmenu', onContextMenu);
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', finishStroke);
    container.addEventListener('pointercancel', cleanupStroke);

    return () => {
      spaceHeldRef.current = false;
      setSpacePanning(false);
      cleanupStroke();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
      container.removeEventListener('contextmenu', onContextMenu);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', finishStroke);
      container.removeEventListener('pointercancel', cleanupStroke);
    };
  }, [interactionMode, drawTool]);

  // PC keyboard shortcuts while drawing, lasso selecting, or editing boundary
  useEffect(() => {
    if (
      interactionMode !== 'draw_boundary' &&
      interactionMode !== 'edit_boundary' &&
      interactionMode !== 'lasso_select'
    ) {
      return;
    }

    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (ev.key === 'Escape') {
        ev.preventDefault();
        draftPointsRef.current = [];
        setDraftPoints([]);
        rubberBandLayerRef.current?.clearLayers();
        onCancelInteractionRef.current();
        return;
      }

      if (interactionMode === 'draw_boundary') {
        if (
          ev.key === 'Backspace' ||
          ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z')
        ) {
          if (draftPointsRef.current.length > 0) {
            ev.preventDefault();
            const next = draftPointsRef.current.slice(0, -1);
            draftPointsRef.current = next;
            setDraftPoints(next);
          }
        } else if (ev.key === 'Enter' && draftPointsRef.current.length >= 3) {
          ev.preventDefault();
          const pts = draftPointsRef.current;
          draftPointsRef.current = [];
          setDraftPoints([]);
          rubberBandLayerRef.current?.clearLayers();
          onBoundaryCompleteRef.current(pts);
        }
      } else if (
        interactionMode === 'edit_boundary' &&
        (ev.key === 'Delete' || ev.key === 'Backspace') &&
        selectedVertexIdx !== null &&
        boundaryRef.current.length > 3
      ) {
        ev.preventDefault();
        const updated = boundaryRef.current.filter(
          (_, i) => i !== selectedVertexIdx
        );
        setSelectedVertexIdx(null);
        onBoundaryUpdateRef.current(updated);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [interactionMode, selectedVertexIdx]);

  // Painted, clickable street highlights ("pomalowane ulice") when not displaying full route polylines
  useEffect(() => {
    const layer = streetOverlaysLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (
      routes.length > 0 ||
      interactionMode === 'draw_boundary' ||
      interactionMode === 'edit_boundary' ||
      streetOverlayPaths.length === 0
    ) {
      return;
    }

    streetOverlayPaths.forEach((overlay) => {
      const isFocused = focusedStreet === overlay.streetName;
      const opacity = focusedStreet
        ? isFocused
          ? 0.65
          : 0.14
        : 0.34;
      const poly = L.polyline(
        overlay.points.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color: overlay.color,
          weight: isFocused ? 8 : 5,
          opacity,
          lineCap: 'round',
          lineJoin: 'round',
        }
      ).addTo(layer);

      poly.on('click', (ev: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(ev);
        onSelectStreetOverlayRef.current?.(overlay.streetName);
      });
    });
  }, [streetOverlayPaths, focusedStreet, routes.length, interactionMode]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = parishLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    if (!parish) return;

    const icon = L.divIcon({
      className: '',
      html: `<div style="width:32px;height:32px;border-radius:9999px;background:#B45309;border:3px solid #FEF3C7;color:#FEF3C7;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.3);font-weight:700;font-size:15px;">✝</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    const marker = L.marker([parish.location.lat, parish.location.lng], {
      icon,
      zIndexOffset: 500,
    });
    marker.bindPopup(
      `<div style="font-size:12px;"><div style="color:#92400E;font-weight:600;">Punkt startowy parafii</div><div style="font-weight:700;margin-top:2px;">${escapeHtml(
        parish.name
      )}</div><div style="color:#475569;margin-top:2px;">${escapeHtml(
        parish.address
      )}</div></div>`
    );
    marker.addTo(layer);

    const key = `${parish.location.lat.toFixed(6)},${parish.location.lng.toFixed(6)}`;
    if (lastParishKeyRef.current !== key) {
      lastParishKeyRef.current = key;
      map.setView([parish.location.lat, parish.location.lng], 15);
    }
  }, [parish]);

  useEffect(() => {
    const layer = boundaryLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (interactionMode === 'draw_boundary' || boundary.length < 3) return;

    const isActivelyEditing = interactionMode === 'edit_boundary';
    const latLngs = boundary.map((p) => [p.lat, p.lng] as [number, number]);
    const polygon = L.polygon(latLngs, {
      color: '#B45309',
      weight: isActivelyEditing ? 2.8 : canEditBoundary ? 2.2 : 1.5,
      opacity: isActivelyEditing ? 0.95 : canEditBoundary ? 0.85 : 0.42,
      fillColor: '#F59E0B',
      fillOpacity: isActivelyEditing ? 0.16 : canEditBoundary ? 0.1 : 0.03,
      interactive: false,
    }).addTo(layer);

    if (!isActivelyEditing) return;

    // Tactile vertex handles (big hit area for fingers + clear selected indicator)
    boundary.forEach((pt, idx) => {
      const isSelected = selectedVertexIdx === idx;
      const handleIcon = L.divIcon({
        className: '',
        html: `<div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;touch-action:none;cursor:grab;"><div style="width:${
          isSelected ? 24 : 20
        }px;height:${
          isSelected ? 24 : 20
        }px;border-radius:9999px;background:${
          isSelected ? '#0F172A' : '#FFFFFF'
        };border:${
          isSelected ? '3px solid #F59E0B' : '3px solid #B45309'
        };box-shadow:0 2px 6px rgba(0,0,0,0.32);"></div></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });
      const handle = L.marker([pt.lat, pt.lng], {
        icon: handleIcon,
        draggable: true,
        zIndexOffset: isSelected ? 450 : 350,
      }).addTo(layer);

      let moved = false;
      handle.on('dragstart', () => {
        moved = true;
      });
      handle.on('drag', () => {
        const ll = handle.getLatLng();
        const updated = boundary.map((b, i) =>
          i === idx ? { lat: ll.lat, lng: ll.lng } : b
        );
        polygon.setLatLngs(
          updated.map((p) => [p.lat, p.lng] as [number, number])
        );
      });

      handle.on('dragend', () => {
        const ll = handle.getLatLng();
        const updated = boundary.map((b, i) =>
          i === idx ? { lat: ll.lat, lng: ll.lng } : b
        );
        onBoundaryUpdateRef.current(updated);
      });

      handle.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        if (moved) {
          moved = false;
          return;
        }
        setSelectedVertexIdx((cur) => (cur === idx ? null : idx));
      });
    });

    // Midpoint "+" handles to insert a new corner along any edge (disabled above 90 vertices)
    if (boundary.length < 90) {
      boundary.forEach((pt, idx) => {
        const nextPt = boundary[(idx + 1) % boundary.length];
        const mid: LatLng = {
          lat: (pt.lat + nextPt.lat) / 2,
          lng: (pt.lng + nextPt.lng) / 2,
        };
        const midIcon = L.divIcon({
          className: '',
          html: `<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;touch-action:none;cursor:pointer;"><div style="width:18px;height:18px;border-radius:9999px;background:rgba(255,255,255,0.92);border:1.5px solid #B45309;color:#B45309;font-size:13px;font-weight:700;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.22);">+</div></div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        const midHandle = L.marker([mid.lat, mid.lng], {
          icon: midIcon,
          draggable: true,
          zIndexOffset: 280,
        }).addTo(layer);

        let midMoved = false;
        midHandle.on('dragstart', () => {
          midMoved = true;
        });
        midHandle.on('drag', () => {
          const ll = midHandle.getLatLng();
          const inserted = [
            ...boundary.slice(0, idx + 1),
            { lat: ll.lat, lng: ll.lng },
            ...boundary.slice(idx + 1),
          ];
          polygon.setLatLngs(
            inserted.map((p) => [p.lat, p.lng] as [number, number])
          );
        });
        midHandle.on('dragend', () => {
          const ll = midHandle.getLatLng();
          const inserted = [
            ...boundary.slice(0, idx + 1),
            { lat: ll.lat, lng: ll.lng },
            ...boundary.slice(idx + 1),
          ];
          setSelectedVertexIdx(idx + 1);
          onBoundaryUpdateRef.current(inserted);
        });
        midHandle.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          if (midMoved) {
            midMoved = false;
            return;
          }
          const inserted = [
            ...boundary.slice(0, idx + 1),
            mid,
            ...boundary.slice(idx + 1),
          ];
          setSelectedVertexIdx(idx + 1);
          onBoundaryUpdateRef.current(inserted);
        });
      });
    }
  }, [boundary, interactionMode, canEditBoundary, selectedVertexIdx]);

  useEffect(() => {
    const layer = draftLayerRef.current;
    const rb = rubberBandLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (rb) rb.clearLayers();

    if (interactionMode !== 'draw_boundary' || draftPoints.length === 0) return;

    if (drawTool === 'crosshair' && rb && mapRef.current) {
      const center = mapRef.current.getCenter();
      const last = draftPoints[draftPoints.length - 1];
      L.polyline(
        [
          [last.lat, last.lng],
          [center.lat, center.lng],
        ],
        {
          color: '#B45309',
          weight: 2,
          dashArray: '5, 6',
          opacity: 0.85,
          interactive: false,
        }
      ).addTo(rb);
    }

    if (draftPoints.length >= 2) {
      L.polygon(
        draftPoints.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color: '#B45309',
          weight: 2.5,
          fillColor: '#F59E0B',
          fillOpacity: 0.2,
          interactive: false,
        }
      ).addTo(layer);
    }

    draftPoints.forEach((pt, idx) => {
      const isFirst = idx === 0;
      const dotIcon = L.divIcon({
        className: '',
        html: `<div style="width:${isFirst ? 24 : 15}px;height:${
          isFirst ? 24 : 15
        }px;border-radius:9999px;background:${
          isFirst ? '#B45309' : '#FFFFFF'
        };border:${
          isFirst ? '3px solid #FEF3C7' : '2.5px solid #B45309'
        };box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
        iconSize: [isFirst ? 24 : 15, isFirst ? 24 : 15],
        iconAnchor: [isFirst ? 12 : 7.5, isFirst ? 12 : 7.5],
      });
      const marker = L.marker([pt.lat, pt.lng], {
        icon: dotIcon,
        zIndexOffset: isFirst ? 900 : 800,
      }).addTo(layer);

      if (isFirst) {
        marker.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          if (draftPointsRef.current.length >= 3) {
            const pts = draftPointsRef.current;
            draftPointsRef.current = [];
            setDraftPoints([]);
            rubberBandLayerRef.current?.clearLayers();
            onBoundaryCompleteRef.current(pts);
          }
        });
      }
    });
  }, [draftPoints, interactionMode, drawTool]);

  useEffect(() => {
    const layer = stopsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    markersByStopIdRef.current = {};
    const isBoundaryEditing =
      interactionMode === 'draw_boundary' || interactionMode === 'edit_boundary';

    stops.forEach((stop) => {
      const palette =
        PRIEST_PALETTE.find((p) => p.id === stop.priestId) ?? PRIEST_PALETTE[0];
      const routeMeta = routeMetaByStopId[stop.id];
      const orderNum = routeMeta?.orderNumber;
      const isSelected = highlightedStopId === stop.id;
      const isLassoSelected = lassoSelectedSet.has(stop.id);
      const isActiveInView = selectedDate
        ? (stop.visitDate ?? '').trim() === selectedDate
        : stop.included !== false;
      const isDimmedByPriest =
        focusedPriestId !== null && stop.priestId !== focusedPriestId;
      const isDimmedByStreet =
        Boolean(focusedStreet) &&
        extractStreetName(stop) !== focusedStreet;
      const isBlock = Boolean(
        stop.isMultiUnit || (stop.units && stop.units.length > 0)
      );
      const unitsTotal = stop.units?.length || stop.unitsCount || 0;

      const appearance = computeStopMarkerAppearance({
        zoom: mapZoom,
        activeVisibleCount,
        markerLabelMode,
        isActiveInView,
        isDimmedByPriest,
        isDimmedByStreet,
        hasFocusedStreet: Boolean(focusedStreet),
        isSelected: isSelected || isLassoSelected,
        isBlock,
        isBoundaryEditing,
        routeMeta,
      });

      const borderRadius = isBlock ? '5px' : '9999px';
      const bgColor = isLassoSelected
        ? '#4F46E5'
        : appearance.fillColorOverride ?? palette.color;
      const borderCol = isLassoSelected
        ? '#FFFFFF'
        : appearance.borderColorOverride ??
          (isSelected ? '#0F172A' : '#FFFFFF');
      const finalSize = isLassoSelected
        ? Math.max(14, appearance.size - 4)
        : appearance.size;
      const hitSize = isBoundaryEditing
        ? finalSize
        : Math.max(22, finalSize);

      const startBadgeHtml = appearance.isStartPoint
        ? `<div style="position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:2px;background:#15803D;color:#FFFFFF;font-family:sans-serif;font-size:9px;font-weight:800;letter-spacing:0.04em;padding:1px 5px;border-radius:4px;border:1.5px solid #FFFFFF;box-shadow:0 1px 4px rgba(0,0,0,0.28);white-space:nowrap;pointer-events:none;">START</div>`
        : '';

      const icon = L.divIcon({
        className: '',
        html: `<div style="position:relative;width:${hitSize}px;height:${hitSize}px;display:flex;align-items:center;justify-content:center;cursor:${
          isBoundaryEditing ? 'default' : 'pointer'
        };">${startBadgeHtml}<div style="width:${finalSize}px;height:${finalSize}px;border-radius:${borderRadius};background:${bgColor};border:${appearance.borderWidth}px solid ${borderCol};opacity:${appearance.opacity};color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:${appearance.fontSize}px;line-height:1;font-weight:700;box-shadow:${
          isLassoSelected
            ? '0 0 0 3px rgba(79,70,229,0.35)'
            : appearance.showLabel
              ? '0 2px 5px rgba(15,23,42,0.28)'
              : '0 1px 2px rgba(15,23,42,0.22)'
        };">${appearance.showLabel ? appearance.labelText : ''}</div></div>`,
        iconSize: [hitSize, hitSize],
        iconAnchor: [hitSize / 2, hitSize / 2],
      });

      const marker = L.marker([stop.location.lat, stop.location.lng], {
        icon,
        interactive: !isBoundaryEditing && interactionMode !== 'lasso_select',
        zIndexOffset: isLassoSelected ? 420 : appearance.zIndexPriority,
      }).addTo(layer);

      const unitsPreviewHtml =
        stop.units && stop.units.length > 0
          ? `<div style="margin-top:6px;padding:5px 6px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;font-size:11px;color:#334155;">
              <div style="font-weight:700;color:#0F172A;margin-bottom:2px;">Lokale w bloku (${stop.units.length}):</div>
              ${stop.units
                .slice(0, 4)
                .map(
                  (u) =>
                    `<div>${
                      u.staircase ? `kl. ${escapeHtml(u.staircase)} ` : ''
                    }m. ${escapeHtml(u.unitNumber)}${
                      u.familyName ? ` — ${escapeHtml(u.familyName)}` : ''
                    }</div>`
                )
                .join('')}
              ${
                stop.units.length > 4
                  ? `<div style="color:#64748B;">+${stop.units.length - 4} kolejnych lokali...</div>`
                  : ''
              }
            </div>`
          : '';

      const popupEl = document.createElement('div');
      popupEl.style.fontSize = '12px';
      popupEl.style.maxWidth = '260px';
      popupEl.innerHTML = `
        <div style="color:#64748B;font-weight:500;">${
          isActiveInView
            ? `${escapeHtml(palette.name)}${
                orderNum ? ` · Przystanek #${orderNum}` : ''
              }`
            : 'Poza wybranym dniem / bieżącym planem'
        }</div>
        <div style="font-weight:700;color:#0F172A;margin-top:2px;">${
          isBlock
            ? `<span style="display:inline-block;background:#FEF3C7;color:#92400E;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:700;margin-right:4px;">BLOK${
                unitsTotal > 0 ? ` · ${unitsTotal} lok.` : ''
              }</span>`
            : ''
        }${escapeHtml(stop.address)}</div>
        ${
          routeMeta?.arrivalTime
            ? `<div style="color:#334155;font-weight:600;margin-top:2px;">Godzina: ~${escapeHtml(
                routeMeta.arrivalTime
              )}–${escapeHtml(routeMeta.departureTime)}</div>`
            : ''
        }
        ${
          stop.visitDate
            ? `<div style="color:#92400E;font-weight:600;margin-top:2px;">Zaplanowano: ${escapeHtml(
                stop.visitDate
              )}</div>`
            : ''
        }
        <div style="color:#64748B;margin-top:4px;">Czas wizyty: ${
          stop.durationMinutes
        } min${
          stop.inBoundary === false
            ? ' · <span style="color:#B45309;font-weight:600;">Poza terenem parafii</span>'
            : ''
        }</div>
        ${unitsPreviewHtml}
        ${
          stop.notes
            ? `<div style="color:#475569;margin-top:4px;border-top:1px solid #F1F5F9;padding-top:4px;">${escapeHtml(
                stop.notes
              )}</div>`
            : ''
        }
      `;

      const actionsRow = document.createElement('div');
      actionsRow.style.cssText =
        'margin-top:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;';

      if (onOpenBlockUnitsRef.current) {
        const unitsBtn = document.createElement('button');
        unitsBtn.type = 'button';
        unitsBtn.textContent = isBlock
          ? `Rozpiska lokali (${unitsTotal})`
          : 'Lokale / Zmień w blok';
        unitsBtn.style.cssText =
          'font-size:12px;font-weight:700;color:#92400E;background:none;border:none;padding:0;cursor:pointer;text-decoration:underline;';
        unitsBtn.onclick = () => {
          marker.closePopup();
          onOpenBlockUnitsRef.current?.(stop.id);
        };
        actionsRow.appendChild(unitsBtn);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Usuń adres';
      deleteBtn.style.cssText =
        'font-size:12px;font-weight:600;color:#DC2626;background:none;border:none;padding:0;cursor:pointer;';
      deleteBtn.onclick = () => {
        onSelectStopRef.current(null);
        onDeleteStopRef.current(stop.id);
      };
      actionsRow.appendChild(deleteBtn);
      popupEl.appendChild(actionsRow);

      marker.bindPopup(popupEl);
      marker.on('click', () => onSelectStopRef.current(stop.id));

      markersByStopIdRef.current[stop.id] = marker;
    });
  }, [
    stops,
    routeMetaByStopId,
    highlightedStopId,
    selectedDate,
    focusedPriestId,
    focusedStreet,
    markerLabelMode,
    mapZoom,
    activeVisibleCount,
    interactionMode,
    lassoSelectedSet,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !highlightedStopId) return;
    const marker = markersByStopIdRef.current[highlightedStopId];
    if (marker) {
      map.panTo(marker.getLatLng());
      marker.openPopup();
    }
  }, [highlightedStopId]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = routesLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    if (!showRouteLines) return;

    const routesWithPath = routes.filter((r) => r.encodedPathPoints.length >= 2);
    if (routesWithPath.length === 0) return;

    const routeSignature = `${isExactRoute ? 'exact' : 'est'}:${routesWithPath
      .map(
        (r) =>
          `${r.priestId}:${r.orderedStops.length}:${Math.round(r.totalDistanceMeters)}`
      )
      .join(',')}:${focusedPriestId ?? 'all'}`;

    const bounds = L.latLngBounds([]);
    let hasBounds = false;
    routesWithPath.forEach((route) => {
      const isFocused =
        focusedPriestId === null || focusedPriestId === route.priestId;
      const latLngs = route.encodedPathPoints.map(
        (p) => [p.lat, p.lng] as [number, number]
      );
      L.polyline(latLngs, {
        color: route.color,
        weight: isFocused ? 3.5 : 2,
        opacity: isFocused ? 0.78 : 0.2,
        dashArray: isExactRoute ? undefined : '7, 8',
      }).addTo(layer);
      if (isFocused) {
        latLngs.forEach((ll) => {
          bounds.extend(ll);
          hasBounds = true;
        });
      }
    });

    if (
      hasBounds &&
      bounds.isValid() &&
      lastFittedKeyRef.current !== routeSignature
    ) {
      lastFittedKeyRef.current = routeSignature;
      map.fitBounds(bounds, { padding: [48, 84] });
    }
  }, [routes, isExactRoute, focusedPriestId, showRouteLines]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = gpsLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    if (!gps.active || !gps.position) {
      if (!gps.active) hasCenteredGpsRef.current = false;
      return;
    }

    if (gps.accuracyMeters && gps.accuracyMeters > 0) {
      L.circle([gps.position.lat, gps.position.lng], {
        radius: Math.min(gps.accuracyMeters, 250),
        color: '#2563EB',
        weight: 1,
        opacity: 0.45,
        fillColor: '#3B82F6',
        fillOpacity: 0.14,
        interactive: false,
      }).addTo(layer);
    }

    const gpsIcon = L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;border-radius:9999px;background:#2563EB;border:3px solid #FFFFFF;box-shadow:0 2px 8px rgba(37,99,235,0.55);"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

    L.marker([gps.position.lat, gps.position.lng], {
      icon: gpsIcon,
      zIndexOffset: 950,
      interactive: false,
    }).addTo(layer);

    if (!hasCenteredGpsRef.current) {
      hasCenteredGpsRef.current = true;
      map.setView(
        [gps.position.lat, gps.position.lng],
        Math.max(map.getZoom(), 16)
      );
    }
  }, [gps.active, gps.position, gps.accuracyMeters]);

  return (
    <div className="relative w-full h-full min-h-[340px] bg-slate-100">
      <div ref={containerRef} className="w-full h-full z-0" />

      {/* Live GPS Tracker Control */}
      <div className="no-print absolute top-3 right-3 z-[460] flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5">
          {gps.active && gps.position && (
            <button
              type="button"
              onClick={() => {
                if (mapRef.current && gps.position) {
                  mapRef.current.setView(
                    [gps.position.lat, gps.position.lng],
                    Math.max(mapRef.current.getZoom(), 17)
                  );
                }
              }}
              title="Wyśrodkuj mapę na mojej pozycji"
              className="min-h-[36px] px-2.5 py-1.5 bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-md text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors"
            >
              Wyśrodkuj
            </button>
          )}
          <button
            type="button"
            onClick={gps.toggle}
            aria-pressed={gps.active}
            title={
              gps.active
                ? 'Wyłącz pokazywanie mojej pozycji GPS'
                : 'Pokaż moją pozycję GPS na mapie'
            }
            className={`min-h-[36px] px-3 py-1.5 rounded-xl shadow-md border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
              gps.active
                ? 'bg-blue-600 border-blue-700 text-white hover:bg-blue-700'
                : 'bg-white/95 backdrop-blur-md border-slate-200 text-slate-800 hover:bg-slate-50'
            }`}
          >
            <LocateFixed className="w-3.5 h-3.5" />
            <span>{gps.active ? 'GPS włączony' : 'Moja pozycja'}</span>
          </button>
        </div>

        {gps.error && (
          <div className="max-w-[230px] px-2.5 py-1.5 bg-red-50/95 border border-red-200 rounded-lg shadow text-[11px] font-medium text-red-800">
            {gps.error}
          </div>
        )}
      </div>

      {/* Centered crosshair target for mobile thumb precision */}
      {parish &&
        interactionMode === 'draw_boundary' &&
        drawTool === 'crosshair' && (
          <div
            aria-hidden="true"
            className="no-print pointer-events-none absolute inset-0 z-[450] flex items-center justify-center"
          >
            <div className="relative flex items-center justify-center">
              <div className="w-11 h-11 rounded-full border-2 border-amber-700 bg-amber-500/10 shadow-sm flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-700 ring-2 ring-white" />
              </div>
              <div className="absolute -bottom-6 px-2 py-0.5 rounded bg-slate-900/80 text-white text-[10px] font-medium whitespace-nowrap">
                Przesuń mapę pod celownik
              </div>
            </div>
          </div>
        )}

      {parish && interactionMode !== 'pan' && (
        <div className="no-print absolute top-3 left-1/2 -translate-x-1/2 z-[500] w-max max-w-[calc(100%-24px)]">
          {interactionMode === 'draw_boundary' && (
            <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl shadow-xl p-2 flex flex-col items-center gap-2 text-xs text-slate-900">
              {/* Tool mode switcher: Zakreśl / Celownik / Punkty */}
              <div className="flex flex-wrap items-center justify-center gap-1.5 w-full">
                <div className="flex items-center p-0.5 bg-slate-100 rounded-xl gap-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      draftPointsRef.current = [];
                      setDraftPoints([]);
                      rubberBandLayerRef.current?.clearLayers();
                      setDrawTool('lasso');
                    }}
                    className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      drawTool === 'lasso'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Pencil className="w-3.5 h-3.5 text-amber-700" />
                    <span>Zakreśl</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      draftPointsRef.current = [];
                      setDraftPoints([]);
                      rubberBandLayerRef.current?.clearLayers();
                      setLassoHint(null);
                      setDrawTool('rect');
                    }}
                    className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      drawTool === 'rect'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Square className="w-3.5 h-3.5 text-amber-700" />
                    <span>Ramka</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLassoHint(null);
                      setDrawTool('crosshair');
                    }}
                    className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      drawTool === 'crosshair'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Crosshair className="w-3.5 h-3.5 text-amber-700" />
                    <span>Celownik</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLassoHint(null);
                      setDrawTool('points');
                    }}
                    className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      drawTool === 'points'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <MousePointerClick className="w-3.5 h-3.5 text-amber-700" />
                    <span>Punkty</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    draftPointsRef.current = [];
                    setDraftPoints([]);
                    rubberBandLayerRef.current?.clearLayers();
                    onCancelInteraction();
                  }}
                  className="min-h-[34px] px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <X className="w-3.5 h-3.5" />
                  Anuluj
                </button>
              </div>

              {(drawTool === 'lasso' || drawTool === 'rect') && (
                <div className="px-2 pb-0.5 text-[11px] text-slate-600 text-center max-w-[360px]">
                  {lassoHint ? (
                    <span className="text-amber-800 font-medium">
                      {lassoHint}
                    </span>
                  ) : drawTool === 'rect' ? (
                    <span>
                      Przeciągnij prostokąt nad parafią · Przesuwanie: 2 palce / Spacja / prawy klawisz myszy
                    </span>
                  ) : (
                    <span>
                      Obrysuj teren jednym ruchem · Przesuwanie: 2 palce / Spacja / prawy klawisz myszy
                    </span>
                  )}
                </div>
              )}

              {drawTool === 'points' && (
                <div className="flex flex-wrap items-center justify-center gap-1.5 px-1">
                  <span className="text-[11px] text-slate-600">
                    Kliknij narożniki · Punkty:{' '}
                    <strong className="font-mono tabular-nums text-amber-800">
                      {draftPoints.length}
                    </strong>
                  </span>
                  {draftPoints.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = draftPointsRef.current.slice(0, -1);
                        draftPointsRef.current = next;
                        setDraftPoints(next);
                      }}
                      className="min-h-[32px] px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      Cofnij
                    </button>
                  )}
                  {draftPoints.length >= 3 && (
                    <button
                      type="button"
                      onClick={() => {
                        const pts = draftPointsRef.current;
                        draftPointsRef.current = [];
                        setDraftPoints([]);
                        rubberBandLayerRef.current?.clearLayers();
                        onBoundaryComplete(pts);
                      }}
                      className="min-h-[32px] px-3 py-1 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg inline-flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Zapisz obszar
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {interactionMode === 'edit_boundary' && (
            <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl shadow-xl px-3 py-2 flex flex-wrap items-center justify-center gap-1.5 text-xs text-slate-900">
              <span className="font-medium text-slate-700 tabular-nums px-1">
                {boundaryAreaLabel
                  ? `Pow.: ${boundaryAreaLabel} · `
                  : ''}
                {boundary.length} pkt
              </span>

              {onScaleBoundary && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onScaleBoundary(0.86)}
                    title="Zmniejsz obszar"
                    className="min-h-[36px] px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1"
                  >
                    <Minimize2 className="w-3.5 h-3.5 text-amber-700" />
                    <span className="hidden sm:inline">Zmniejsz</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onScaleBoundary(1.16)}
                    title="Powiększ obszar"
                    className="min-h-[36px] px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-amber-700" />
                    <span className="hidden sm:inline">Powiększ</span>
                  </button>
                </div>
              )}

              {boundary.length >= 3 && (
                <button
                  type="button"
                  onClick={() =>
                    onBoundaryUpdate(expandBoundaryPolygonMeters(boundary, 25))
                  }
                  title="Rozszerz granice o 25 metrów na zewnątrz, aby objąć domy po drugiej stronie ulicy granicznej"
                  className="min-h-[36px] px-2.5 py-1 text-xs font-medium text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <span>+25 m brzeg</span>
                </button>
              )}

              {selectedVertexIdx !== null && boundary.length > 3 && (
                <button
                  type="button"
                  onClick={() => {
                    const updated = boundary.filter(
                      (_, i) => i !== selectedVertexIdx
                    );
                    setSelectedVertexIdx(null);
                    onBoundaryUpdate(updated);
                  }}
                  className="min-h-[36px] px-2.5 py-1 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Usuń pkt</span>
                </button>
              )}

              <button
                type="button"
                onClick={onCancelInteraction}
                className="min-h-[36px] px-3 py-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                Gotowe
              </button>
            </div>
          )}

          {interactionMode === 'lasso_select' && (
            <div className="bg-white/95 backdrop-blur-md border border-indigo-300 rounded-2xl shadow-xl px-3.5 py-2 flex flex-wrap items-center justify-center gap-2.5 text-xs text-slate-900">
              <Scan className="w-4 h-4 text-indigo-700 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold text-indigo-950 leading-snug">
                  Obrysuj grupę domów na mapie
                  {lassoLiveCount > 0 ? ` · w pętli: ${lassoLiveCount}` : ''}
                </div>
                <div className="text-[11px] text-slate-600">
                  {lassoHint ||
                    'Przesuwanie: 2 palce na telefonie / Spacja lub prawy klawisz na PC'}
                </div>
              </div>
              <button
                type="button"
                onClick={onCancelInteraction}
                className="min-h-[34px] px-3 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0"
              >
                Anuluj
              </button>
            </div>
          )}

          {interactionMode === 'pick_street' && (
            <div className="bg-white/95 backdrop-blur-md border border-amber-300 rounded-xl shadow-lg px-3.5 py-2 flex items-center gap-2.5 text-xs text-slate-900">
              <Route className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="font-medium leading-snug">
                Kliknij ulicę na mapie, aby pobrać z niej adresy domów
              </span>
              <button
                type="button"
                onClick={onCancelInteraction}
                className="min-h-[34px] px-3 py-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
              >
                Gotowe
              </button>
            </div>
          )}

          {interactionMode === 'add_stop' && (
            <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-lg px-3.5 py-2 flex items-center gap-2.5 text-xs text-slate-900">
              <MapPinPlus className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="font-medium leading-snug">
                Dotknij budynek na mapie — rozpoznamy i zapiszemy adres
              </span>
              <button
                type="button"
                onClick={onCancelInteraction}
                className="min-h-[34px] px-3 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0"
              >
                Gotowe
              </button>
            </div>
          )}
        </div>
      )}

      {/* Ergonomic thumb-zone action bar for Crosshair boundary drawing */}
      {parish &&
        interactionMode === 'draw_boundary' &&
        drawTool === 'crosshair' && (
          <div className="no-print absolute bottom-5 left-1/2 -translate-x-1/2 z-[500] w-max max-w-[calc(100%-24px)] bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl shadow-xl p-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const map = mapRef.current;
                if (!map) return;
                const c = map.getCenter();
                const next = [
                  ...draftPointsRef.current,
                  { lat: c.lat, lng: c.lng },
                ];
                draftPointsRef.current = next;
                setDraftPoints(next);
              }}
              className="min-h-[44px] px-3.5 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>
                Postaw punkt ({draftPoints.length})
              </span>
            </button>

            {draftPoints.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const next = draftPointsRef.current.slice(0, -1);
                  draftPointsRef.current = next;
                  setDraftPoints(next);
                }}
                aria-label="Cofnij ostatni punkt"
                className="min-h-[44px] min-w-[44px] px-2.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center justify-center gap-1"
              >
                <Undo2 className="w-4 h-4" />
              </button>
            )}

            {draftPoints.length >= 3 && (
              <button
                type="button"
                onClick={() => {
                  const pts = draftPointsRef.current;
                  draftPointsRef.current = [];
                  setDraftPoints([]);
                  rubberBandLayerRef.current?.clearLayers();
                  onBoundaryComplete(pts);
                }}
                className="min-h-[44px] px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Check className="w-4 h-4" />
                <span>Zapisz</span>
              </button>
            )}
          </div>
        )}

      {/* Helpful floating tip in edit_boundary mode */}
      {parish && interactionMode === 'edit_boundary' && (
        <div className="no-print pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 z-[460] px-3 py-1.5 rounded-xl bg-slate-900/85 text-white text-[11px] font-medium whitespace-nowrap max-w-[calc(100%-24px)] truncate shadow">
          Przeciągaj narożniki, dotknij „+” aby dodać nowy, lub kliknij punkt aby go usunąć
        </div>
      )}

      {streetPickFeedback && (
        <div
          className={`no-print absolute ${
            interactionMode === 'pan' ? 'top-3' : 'top-16 sm:top-16'
          } left-1/2 -translate-x-1/2 z-[510] max-w-[calc(100%-24px)] sm:max-w-md px-3.5 py-2.5 rounded-xl border shadow-lg backdrop-blur-md flex items-center gap-2.5 text-xs font-medium ${
            streetPickFeedback.status === 'loading'
              ? 'bg-white/95 border-slate-200 text-slate-800'
              : streetPickFeedback.status === 'success'
                ? 'bg-emerald-50/95 border-emerald-200 text-emerald-900'
                : streetPickFeedback.status === 'error'
                  ? 'bg-red-50/95 border-red-200 text-red-900'
                  : 'bg-amber-50/95 border-amber-200 text-amber-900'
          }`}
        >
          {streetPickFeedback.status === 'loading' ? (
            <Loader2 className="w-4 h-4 animate-spin text-amber-700 shrink-0" />
          ) : streetPickFeedback.status === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
          )}
          <span className="leading-snug">{streetPickFeedback.message}</span>
          {streetPickFeedback.status !== 'loading' && (
            <button
              type="button"
              onClick={onDismissStreetFeedback}
              aria-label="Zamknij powiadomienie"
              className="p-1 rounded-md hover:bg-black/5 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
