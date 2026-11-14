import { useCallback, useEffect, useRef, useState } from 'react';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { LatLng } from '../types/parish';

interface UseParishPolygonDrawerOptions {
  isDrawing: boolean;
  savedBoundary: LatLng[];
  onComplete: (polygon: LatLng[]) => void;
  onUpdateBoundary: (polygon: LatLng[]) => void;
}

/**
 * Interactive polygon drawing and vertex-editing hook using native Maps JS events
 * and AdvancedMarkerElement (zero legacy drawing library).
 */
export function useParishPolygonDrawer({
  isDrawing,
  savedBoundary,
  onComplete,
  onUpdateBoundary,
}: UseParishPolygonDrawerOptions) {
  const map = useMap();
  const markerLib = useMapsLibrary('marker');

  const [draftPoints, setDraftPoints] = useState<LatLng[]>([]);
  const draftPointsRef = useRef<LatLng[]>([]);
  const previewPolygonRef = useRef<google.maps.Polygon | null>(null);
  const savedPolygonRef = useRef<google.maps.Polygon | null>(null);
  const vertexMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>(
    []
  );
  const suppressNextSyncRef = useRef(false);

  const clearDraftOverlays = useCallback(() => {
    if (previewPolygonRef.current) {
      previewPolygonRef.current.setMap(null);
      previewPolygonRef.current = null;
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
      onComplete(points);
    },
    [clearDraftOverlays, onComplete]
  );

  const cancelDraft = useCallback(() => {
    clearDraftOverlays();
    draftPointsRef.current = [];
    setDraftPoints([]);
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
  }, []);

  // Render editable saved parish boundary polygon when not actively drawing
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
      const polygon = new google.maps.Polygon({
        paths: savedBoundary,
        strokeColor: '#B45309',
        strokeOpacity: 0.9,
        strokeWeight: 2.2,
        fillColor: '#F59E0B',
        fillOpacity: 0.12,
        editable: true,
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

      const path = polygon.getPath();
      listeners.push(
        google.maps.event.addListener(path, 'set_at', syncPath),
        google.maps.event.addListener(path, 'insert_at', syncPath),
        google.maps.event.addListener(path, 'remove_at', syncPath)
      );

      savedPolygonRef.current = polygon;
    }

    return () => {
      listeners.forEach((l) => google.maps.event.removeListener(l));
      if (savedPolygonRef.current) {
        savedPolygonRef.current.setMap(null);
        savedPolygonRef.current = null;
      }
    };
  }, [map, isDrawing, savedBoundary, onUpdateBoundary]);

  // Drawing interaction listeners
  useEffect(() => {
    if (!map || !isDrawing) {
      if (map) {
        map.setOptions({ draggableCursor: null, disableDoubleClickZoom: false });
      }
      clearDraftOverlays();
      draftPointsRef.current = [];
      setDraftPoints([]);
      return;
    }

    map.setOptions({
      draggableCursor: 'crosshair',
      disableDoubleClickZoom: true,
    });

    const addVertexMarker = (pt: LatLng, isFirst: boolean) => {
      const AdvancedMarker =
        markerLib?.AdvancedMarkerElement ??
        google.maps.marker?.AdvancedMarkerElement;
      if (!AdvancedMarker) return;

      const dot = document.createElement('div');
      dot.style.width = isFirst ? '24px' : '15px';
      dot.style.height = isFirst ? '24px' : '15px';
      dot.style.borderRadius = '9999px';
      dot.style.background = isFirst ? '#B45309' : '#FFFFFF';
      dot.style.border = isFirst ? '3px solid #FEF3C7' : '2.5px solid #B45309';
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
    };

    const clickListener = map.addListener(
      'click',
      (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const pt: LatLng = { lat: e.latLng.lat(), lng: e.latLng.lng() };
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

        addVertexMarker(pt, isFirst);
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
  }, [map, isDrawing, markerLib, clearDraftOverlays, finalizePolygon]);

  return {
    draftVertexCount: draftPoints.length,
    finishDraft: () => finalizePolygon(draftPointsRef.current),
    undoLastVertex,
    cancelDraft,
  };
}
