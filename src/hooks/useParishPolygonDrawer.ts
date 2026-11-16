import { useCallback, useEffect, useRef, useState } from 'react';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { BoundaryDrawTool, LatLng, VisitStop } from '../types/parish';
import {
  computeRectanglePolygon,
  extractStreetName,
  isPointInsideBoundary,
  simplifyPolygonRDP,
} from '../utils/spatial';

interface UseParishPolygonDrawerOptions {
  isDrawing: boolean;
  isEditingBoundary?: boolean;
  isLassoSelecting?: boolean;
  stopsForLasso?: VisitStop[];
  selectedDate?: string | null;
  focusedPriestId?: number | null;
  focusedStreet?: string | null;
  drawTool: BoundaryDrawTool;
  canEditBoundary?: boolean;
  savedBoundary: LatLng[];
  onComplete: (polygon: LatLng[]) => void;
  onUpdateBoundary: (polygon: LatLng[]) => void;
  onLassoSelectComplete?: (stopIds: string[]) => void;
  onCancel?: () => void;
}

/**
 * Interactive polygon drawing (Zakreśl lasso, Ramka rect, Celownik crosshair, Punkty clicks),
 * lasso multi-stop selection, and vertex-editing hook using native Maps JS events and AdvancedMarkerElement.
 */
export function useParishPolygonDrawer({
  isDrawing,
  isEditingBoundary = false,
  isLassoSelecting = false,
  stopsForLasso = [],
  selectedDate = null,
  focusedPriestId = null,
  focusedStreet = null,
  drawTool,
  canEditBoundary = true,
  savedBoundary,
  onComplete,
  onUpdateBoundary,
  onLassoSelectComplete,
  onCancel,
}: UseParishPolygonDrawerOptions) {
  const map = useMap();
  const markerLib = useMapsLibrary('marker');

  const [draftPoints, setDraftPoints] = useState<LatLng[]>([]);
  const [lassoHint, setLassoHint] = useState<string | null>(null);
  const [lassoLiveCount, setLassoLiveCount] = useState<number>(0);
  const draftPointsRef = useRef<LatLng[]>([]);
  const previewPolygonRef = useRef<google.maps.Polygon | null>(null);
  const rubberBandLineRef = useRef<google.maps.Polyline | null>(null);
  const savedPolygonRef = useRef<google.maps.Polygon | null>(null);
  const vertexMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>(
    []
  );
  const suppressNextSyncRef = useRef(false);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const onLassoSelectCompleteRef = useRef(onLassoSelectComplete);
  onLassoSelectCompleteRef.current = onLassoSelectComplete;
  const stopsForLassoRef = useRef(stopsForLasso);
  stopsForLassoRef.current = stopsForLasso;
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const focusedPriestIdRef = useRef(focusedPriestId);
  focusedPriestIdRef.current = focusedPriestId;
  const focusedStreetRef = useRef(focusedStreet);
  focusedStreetRef.current = focusedStreet;

  const clearDraftOverlays = useCallback(() => {
    if (previewPolygonRef.current) {
      previewPolygonRef.current.setMap(null);
      previewPolygonRef.current = null;
    }
    if (rubberBandLineRef.current) {
      rubberBandLineRef.current.setMap(null);
      rubberBandLineRef.current = null;
    }
    vertexMarkersRef.current.forEach((m) => {
      m.map = null;
    });
    vertexMarkersRef.current = [];
  }, []);

  const finalizePolygon = useCallback(
    (points: LatLng[]) => {
      if (points.length < 3) return;
      clearDraftOverlays();
      draftPointsRef.current = [];
      setDraftPoints([]);
      setLassoHint(null);
      onCompleteRef.current(points);
    },
    [clearDraftOverlays]
  );

  const cancelDraft = useCallback(() => {
    clearDraftOverlays();
    draftPointsRef.current = [];
    setDraftPoints([]);
    setLassoHint(null);
  }, [clearDraftOverlays]);

  const undoLastVertex = useCallback(() => {
    if (draftPointsRef.current.length === 0) return;
    const next = draftPointsRef.current.slice(0, -1);
    draftPointsRef.current = next;
    setDraftPoints(next);

    const lastMarker = vertexMarkersRef.current.pop();
    if (lastMarker) lastMarker.map = null;

    if (previewPolygonRef.current) {
      previewPolygonRef.current.setPath(next);
    }
    if (next.length === 0 && rubberBandLineRef.current) {
      rubberBandLineRef.current.setMap(null);
      rubberBandLineRef.current = null;
    }
  }, []);

  const appendVertex = useCallback(
    (pt: LatLng) => {
      if (!map) return;
      const isFirst = draftPointsRef.current.length === 0;
      const next = [...draftPointsRef.current, pt];
      draftPointsRef.current = next;
      setDraftPoints(next);

      if (!previewPolygonRef.current) {
        previewPolygonRef.current = new google.maps.Polygon({
          paths: next,
          strokeColor: '#B45309',
          strokeOpacity: 0.95,
          strokeWeight: 2.5,
          fillColor: '#F59E0B',
          fillOpacity: 0.18,
          clickable: false,
          map,
        });
      } else {
        previewPolygonRef.current.setPath(next);
      }

      const AdvancedMarker =
        markerLib?.AdvancedMarkerElement ??
        google.maps.marker?.AdvancedMarkerElement;
      if (AdvancedMarker) {
        const dot = document.createElement('div');
        dot.style.width = isFirst ? '24px' : '15px';
        dot.style.height = isFirst ? '24px' : '15px';
        dot.style.borderRadius = '9999px';
        dot.style.background = isFirst ? '#B45309' : '#FFFFFF';
        dot.style.border = isFirst
          ? '3px solid #FEF3C7'
          : '2.5px solid #B45309';
        dot.style.boxShadow = '0 2px 6px rgba(0,0,0,0.32)';
        dot.style.cursor = isFirst ? 'pointer' : 'crosshair';
        dot.style.touchAction = 'none';
        if (isFirst) {
          dot.title = 'Kliknij, aby zamknąć obrys parafii';
        }

        const marker = new AdvancedMarker({
          map,
          position: pt,
          content: dot,
          zIndex: isFirst ? 1000 : 900,
        });

        if (isFirst) {
          dot.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (draftPointsRef.current.length >= 3) {
              finalizePolygon(draftPointsRef.current);
            }
          });
        }

        vertexMarkersRef.current.push(marker);
      }
    },
    [map, markerLib, finalizePolygon]
  );

  const addCrosshairVertex = useCallback(() => {
    if (!map) return;
    const c = map.getCenter();
    if (!c) return;
    appendVertex({ lat: c.lat(), lng: c.lng() });
  }, [map, appendVertex]);

  // Render saved parish boundary polygon (editable handles ONLY when isEditingBoundary is true)
  useEffect(() => {
    if (!map) return;

    if (suppressNextSyncRef.current) {
      suppressNextSyncRef.current = false;
      return;
    }

    if (savedPolygonRef.current) {
      savedPolygonRef.current.setMap(null);
      savedPolygonRef.current = null;
    }

    const listeners: google.maps.MapsEventListener[] = [];

    if (!isDrawing && savedBoundary.length >= 3) {
      const editableNow = Boolean(isEditingBoundary);
      const polygon = new google.maps.Polygon({
        paths: savedBoundary,
        strokeColor: '#B45309',
        strokeOpacity: editableNow ? 0.95 : canEditBoundary ? 0.85 : 0.42,
        strokeWeight: editableNow ? 2.8 : canEditBoundary ? 2.2 : 1.5,
        fillColor: '#F59E0B',
        fillOpacity: editableNow ? 0.16 : canEditBoundary ? 0.1 : 0.03,
        editable: editableNow,
        draggable: false,
        clickable: false,
        map,
      });

      const syncPath = () => {
        const path = polygon.getPath();
        const updated: LatLng[] = [];
        for (let i = 0; i < path.getLength(); i++) {
          const pt = path.getAt(i);
          updated.push({ lat: pt.lat(), lng: pt.lng() });
        }
        if (updated.length >= 3) {
          suppressNextSyncRef.current = true;
          onUpdateBoundary(updated);
        }
      };

      if (editableNow) {
        const path = polygon.getPath();
        listeners.push(
          google.maps.event.addListener(path, 'set_at', syncPath),
          google.maps.event.addListener(path, 'insert_at', syncPath),
          google.maps.event.addListener(path, 'remove_at', syncPath)
        );
      }

      savedPolygonRef.current = polygon;
    }

    return () => {
      listeners.forEach((l) => google.maps.event.removeListener(l));
      if (savedPolygonRef.current) {
        savedPolygonRef.current.setMap(null);
        savedPolygonRef.current = null;
      }
    };
  }, [
    map,
    isDrawing,
    isEditingBoundary,
    canEditBoundary,
    savedBoundary,
    onUpdateBoundary,
  ]);

  // Drawing / Lasso selection interaction listeners
  useEffect(() => {
    if (!map || (!isDrawing && !isLassoSelecting)) {
      if (map) {
        map.setOptions({
          draggable: true,
          gestureHandling: 'greedy',
          draggableCursor: null,
          disableDoubleClickZoom: false,
        });
        const div = map.getDiv();
        if (div) div.style.touchAction = '';
      }
      clearDraftOverlays();
      draftPointsRef.current = [];
      setDraftPoints([]);
      setLassoHint(null);
      setLassoLiveCount(0);
      return;
    }

    const isFreehandLasso = isLassoSelecting || (isDrawing && drawTool === 'lasso');
    const isRectMode = isDrawing && drawTool === 'rect';

    if (isFreehandLasso || isRectMode) {
      const div = map.getDiv();
      const strokeColor = isLassoSelecting ? '#4F46E5' : '#B45309';
      const fillColor = isLassoSelecting ? '#6366F1' : '#F59E0B';

      map.setOptions({
        draggable: false,
        gestureHandling: 'none',
        draggableCursor: 'crosshair',
        disableDoubleClickZoom: true,
      });
      if (div) div.style.touchAction = 'none';

      const projectionOverlay = new google.maps.OverlayView();
      projectionOverlay.draw = () => {};
      projectionOverlay.setMap(map);

      let drawing = false;
      let pointerId: number | null = null;
      let lastX = 0;
      let lastY = 0;
      let rawPts: LatLng[] = [];
      let rectStart: LatLng | null = null;
      let rectEnd: LatLng | null = null;
      let liveLine: google.maps.Polyline | null = null;
      let livePoly: google.maps.Polygon | null = null;
      let liveRect: google.maps.Rectangle | null = null;
      let spaceHeld = false;
      let multiTouchActive = false;

      const matchStopsInside = (poly: LatLng[]): string[] => {
        if (poly.length < 3) return [];
        const curDate = selectedDateRef.current;
        const curPriest = focusedPriestIdRef.current;
        const curStreet = focusedStreetRef.current;
        const ids: string[] = [];
        for (const s of stopsForLassoRef.current) {
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

      const clientToLatLng = (clientX: number, clientY: number): LatLng | null => {
        if (!div) return null;
        const rect = div.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const proj = projectionOverlay.getProjection();
        if (proj) {
          const ll = proj.fromContainerPixelToLatLng(new google.maps.Point(x, y));
          if (ll) return { lat: ll.lat(), lng: ll.lng() };
        }
        const bounds = map.getBounds();
        if (!bounds || rect.width <= 0 || rect.height <= 0) return null;
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        return {
          lat: ne.lat() - (y / rect.height) * (ne.lat() - sw.lat()),
          lng: sw.lng() + (x / rect.width) * (ne.lng() - sw.lng()),
        };
      };

      const cleanupStroke = () => {
        drawing = false;
        pointerId = null;
        rawPts = [];
        rectStart = null;
        rectEnd = null;
        if (isLassoSelecting) setLassoLiveCount(0);
        liveLine?.setMap(null);
        liveLine = null;
        livePoly?.setMap(null);
        livePoly = null;
        liveRect?.setMap(null);
        liveRect = null;
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
        if (!spaceHeld) {
          spaceHeld = true;
          map.setOptions({
            draggable: true,
            gestureHandling: 'greedy',
            draggableCursor: 'grab',
          });
        }
      };

      const onKeyUp = (ev: KeyboardEvent) => {
        if (ev.code !== 'Space') return;
        spaceHeld = false;
        if (!multiTouchActive) {
          map.setOptions({
            draggable: false,
            gestureHandling: 'none',
            draggableCursor: 'crosshair',
          });
        }
      };

      const onTouchStart = (ev: TouchEvent) => {
        if (ev.touches.length >= 2) {
          multiTouchActive = true;
          cleanupStroke();
          if (div) div.style.touchAction = 'auto';
          map.setOptions({ draggable: true, gestureHandling: 'greedy' });
        }
      };

      const onTouchEnd = (ev: TouchEvent) => {
        if (ev.touches.length === 0 && multiTouchActive) {
          multiTouchActive = false;
          if (div) div.style.touchAction = 'none';
          if (!spaceHeld) {
            map.setOptions({ draggable: false, gestureHandling: 'none' });
          }
        }
      };

      const onDown = (ev: PointerEvent) => {
        const target = ev.target as HTMLElement | null;
        if (target?.closest('.no-print, button')) return;
        if (spaceHeld || multiTouchActive) return;
        if (ev.button !== 0 && ev.pointerType === 'mouse') return;
        const pt = clientToLatLng(ev.clientX, ev.clientY);
        if (!pt) return;
        ev.preventDefault();
        setLassoHint(null);
        drawing = true;
        pointerId = ev.pointerId;
        lastX = ev.clientX;
        lastY = ev.clientY;

        if (isRectMode) {
          rectStart = pt;
          rectEnd = pt;
          liveRect = new google.maps.Rectangle({
            bounds: {
              south: pt.lat,
              north: pt.lat,
              west: pt.lng,
              east: pt.lng,
            },
            strokeColor,
            strokeWeight: 3,
            strokeOpacity: 0.95,
            fillColor,
            fillOpacity: 0.16,
            clickable: false,
            map,
          });
        } else {
          rawPts = [pt];
          livePoly = new google.maps.Polygon({
            paths: [pt],
            strokeWeight: 0,
            fillColor,
            fillOpacity: 0.16,
            clickable: false,
            map,
          });
          liveLine = new google.maps.Polyline({
            path: [pt],
            strokeColor,
            strokeWeight: 3.5,
            strokeOpacity: 0.95,
            clickable: false,
            map,
          });
        }
        try {
          div.setPointerCapture(ev.pointerId);
        } catch {
          // Ignore
        }
      };

      const onMove = (ev: PointerEvent) => {
        if (!drawing || ev.pointerId !== pointerId || multiTouchActive) return;

        if (isRectMode && rectStart) {
          const pt = clientToLatLng(ev.clientX, ev.clientY);
          if (!pt) return;
          rectEnd = pt;
          liveRect?.setBounds({
            south: Math.min(rectStart.lat, pt.lat),
            north: Math.max(rectStart.lat, pt.lat),
            west: Math.min(rectStart.lng, pt.lng),
            east: Math.max(rectStart.lng, pt.lng),
          });
          return;
        }

        if (Math.hypot(ev.clientX - lastX, ev.clientY - lastY) < 6) return;
        lastX = ev.clientX;
        lastY = ev.clientY;
        const pt = clientToLatLng(ev.clientX, ev.clientY);
        if (!pt) return;
        rawPts.push(pt);
        liveLine?.setPath(rawPts);
        if (rawPts.length >= 3) {
          livePoly?.setPath(rawPts);
          if (isLassoSelecting && rawPts.length % 3 === 0) {
            setLassoLiveCount(matchStopsInside(rawPts).length);
          }
        }
      };

      const onUp = (ev: PointerEvent) => {
        if (!drawing || ev.pointerId !== pointerId) return;
        try {
          div.releasePointerCapture(ev.pointerId);
        } catch {
          // Ignore
        }

        if (isRectMode) {
          const s = rectStart;
          const e = rectEnd ?? clientToLatLng(ev.clientX, ev.clientY);
          cleanupStroke();
          if (!s || !e) return;
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
          finalizePolygon(computeRectanglePolygon(s, e));
          return;
        }

        const captured = [...rawPts];
        cleanupStroke();

        if (isLassoSelecting) {
          if (captured.length < 4) {
            setLassoHint('Zakreśl pętlę wokół wybranych domów.');
            return;
          }
          const matched = matchStopsInside(captured);
          if (matched.length === 0) {
            setLassoHint('W zakreślonej pętli nie było widocznych domów.');
            return;
          }
          onLassoSelectCompleteRef.current?.(matched);
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
          finalizePolygon(simplified);
        }
      };

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      div?.addEventListener('touchstart', onTouchStart, { passive: true });
      div?.addEventListener('touchend', onTouchEnd, { passive: true });
      div?.addEventListener('touchcancel', onTouchEnd, { passive: true });
      div?.addEventListener('pointerdown', onDown);
      div?.addEventListener('pointermove', onMove);
      div?.addEventListener('pointerup', onUp);
      div?.addEventListener('pointercancel', cleanupStroke);

      return () => {
        cleanupStroke();
        projectionOverlay.setMap(null);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        div?.removeEventListener('touchstart', onTouchStart);
        div?.removeEventListener('touchend', onTouchEnd);
        div?.removeEventListener('touchcancel', onTouchEnd);
        div?.removeEventListener('pointerdown', onDown);
        div?.removeEventListener('pointermove', onMove);
        div?.removeEventListener('pointerup', onUp);
        div?.removeEventListener('pointercancel', cleanupStroke);
        if (div) div.style.touchAction = '';
        map.setOptions({
          draggable: true,
          gestureHandling: 'greedy',
          draggableCursor: null,
          disableDoubleClickZoom: false,
        });
      };
    }

    if (drawTool === 'crosshair') {
      map.setOptions({
        draggable: true,
        gestureHandling: 'greedy',
        draggableCursor: 'grab',
        disableDoubleClickZoom: false,
      });

      const updateCenterLine = () => {
        const pts = draftPointsRef.current;
        const c = map.getCenter();
        if (!c || pts.length === 0) {
          if (rubberBandLineRef.current) {
            rubberBandLineRef.current.setMap(null);
            rubberBandLineRef.current = null;
          }
          return;
        }
        const path = [
          pts[pts.length - 1],
          { lat: c.lat(), lng: c.lng() },
        ];
        if (!rubberBandLineRef.current) {
          rubberBandLineRef.current = new google.maps.Polyline({
            path,
            strokeColor: '#B45309',
            strokeOpacity: 0.75,
            strokeWeight: 2,
            clickable: false,
            map,
          });
        } else {
          rubberBandLineRef.current.setPath(path);
        }
      };

      const centerListener = map.addListener(
        'center_changed',
        updateCenterLine
      );

      return () => {
        google.maps.event.removeListener(centerListener);
        if (rubberBandLineRef.current) {
          rubberBandLineRef.current.setMap(null);
          rubberBandLineRef.current = null;
        }
        map.setOptions({ draggableCursor: null });
      };
    }

    // Default PC 'points' mode
    map.setOptions({
      draggable: true,
      gestureHandling: 'greedy',
      draggableCursor: 'crosshair',
      disableDoubleClickZoom: true,
    });

    const clickListener = map.addListener(
      'click',
      (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        appendVertex({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      }
    );

    const moveListener = map.addListener(
      'mousemove',
      (e: google.maps.MapMouseEvent) => {
        if (!e.latLng || !previewPolygonRef.current) return;
        if (draftPointsRef.current.length === 0) return;
        const preview = [
          ...draftPointsRef.current,
          { lat: e.latLng.lat(), lng: e.latLng.lng() },
        ];
        previewPolygonRef.current.setPath(preview);
      }
    );

    const dblClickListener = map.addListener(
      'dblclick',
      (e: google.maps.MapMouseEvent) => {
        e.domEvent?.preventDefault?.();
        e.domEvent?.stopPropagation?.();
        if (draftPointsRef.current.length >= 3) {
          finalizePolygon(draftPointsRef.current);
        }
      }
    );

    return () => {
      google.maps.event.removeListener(clickListener);
      google.maps.event.removeListener(moveListener);
      google.maps.event.removeListener(dblClickListener);
      map.setOptions({ draggableCursor: null, disableDoubleClickZoom: false });
    };
  }, [map, isDrawing, isLassoSelecting, drawTool, appendVertex, clearDraftOverlays, finalizePolygon]);

  // PC keyboard shortcuts
  useEffect(() => {
    if (!isDrawing && !isEditingBoundary && !isLassoSelecting) return;

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
        cancelDraft();
        onCancelRef.current?.();
        return;
      }

      if (isDrawing) {
        if (
          ev.key === 'Backspace' ||
          ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z')
        ) {
          if (draftPointsRef.current.length > 0) {
            ev.preventDefault();
            undoLastVertex();
          }
        } else if (ev.key === 'Enter' && draftPointsRef.current.length >= 3) {
          ev.preventDefault();
          finalizePolygon(draftPointsRef.current);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDrawing, isEditingBoundary, isLassoSelecting, cancelDraft, undoLastVertex, finalizePolygon]);

  return {
    draftVertexCount: draftPoints.length,
    lassoHint,
    lassoLiveCount,
    addCrosshairVertex,
    finishDraft: () => finalizePolygon(draftPointsRef.current),
    undoLastVertex,
    cancelDraft,
  };
}
