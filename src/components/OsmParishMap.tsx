import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  CircleDashed,
  Hand,
  Loader2,
  MapPinPlus,
  Maximize2,
  Minimize2,
  Pentagon,
  Route,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  LatLng,
  MapInteractionMode,
  PRIEST_PALETTE,
  ParishCenter,
  PriestRouteResult,
  StreetPickFeedback,
  VisitStop,
} from '../types/parish';

interface OsmParishMapProps {
  parish: ParishCenter | null;
  boundary: LatLng[];
  stops: VisitStop[];
  routes: PriestRouteResult[];
  interactionMode: MapInteractionMode;
  highlightedStopId: string | null;
  streetPickFeedback: StreetPickFeedback | null;
  onDismissStreetFeedback: () => void;
  onSetInteractionMode: (mode: MapInteractionMode) => void;
  onCreatePresetBoundary: (radiusMeters?: number) => void;
  onScaleBoundary: (factor: number) => void;
  onClearBoundary: () => void;
  onBoundaryComplete: (points: LatLng[]) => void;
  onBoundaryUpdate: (points: LatLng[]) => void;
  onCancelInteraction: () => void;
  onMapAddStop: (location: LatLng) => void;
  onMapPickStreet: (location: LatLng) => void;
  onSelectStop: (stopId: string | null) => void;
  onDeleteStop: (stopId: string) => void;
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
  interactionMode,
  highlightedStopId,
  streetPickFeedback,
  onDismissStreetFeedback,
  onSetInteractionMode,
  onCreatePresetBoundary,
  onScaleBoundary,
  onClearBoundary,
  onBoundaryComplete,
  onBoundaryUpdate,
  onCancelInteraction,
  onMapAddStop,
  onMapPickStreet,
  onSelectStop,
  onDeleteStop,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const parishLayerRef = useRef<L.LayerGroup | null>(null);
  const boundaryLayerRef = useRef<L.LayerGroup | null>(null);
  const draftLayerRef = useRef<L.LayerGroup | null>(null);
  const stopsLayerRef = useRef<L.LayerGroup | null>(null);
  const routesLayerRef = useRef<L.LayerGroup | null>(null);
  const markersByStopIdRef = useRef<Record<string, L.Marker>>({});
  const lastParishKeyRef = useRef<string>('');

  const [draftPoints, setDraftPoints] = useState<LatLng[]>([]);
  const draftPointsRef = useRef<LatLng[]>([]);

  const interactionModeRef = useRef(interactionMode);
  interactionModeRef.current = interactionMode;
  const onMapAddStopRef = useRef(onMapAddStop);
  onMapAddStopRef.current = onMapAddStop;
  const onMapPickStreetRef = useRef(onMapPickStreet);
  onMapPickStreetRef.current = onMapPickStreet;
  const onSelectStopRef = useRef(onSelectStop);
  onSelectStopRef.current = onSelectStop;
  const onDeleteStopRef = useRef(onDeleteStop);
  onDeleteStopRef.current = onDeleteStop;
  const onBoundaryCompleteRef = useRef(onBoundaryComplete);
  onBoundaryCompleteRef.current = onBoundaryComplete;
  const onBoundaryUpdateRef = useRef(onBoundaryUpdate);
  onBoundaryUpdateRef.current = onBoundaryUpdate;
  const highlightedStopIdRef = useRef(highlightedStopId);
  highlightedStopIdRef.current = highlightedStopId;

  const orderByStopId = useMemo(() => {
    const dict: Record<string, number> = {};
    for (const route of routes) {
      for (const item of route.orderedStops) {
        dict[item.stop.id] = item.orderIndex;
      }
    }
    return dict;
  }, [routes]);

  // Initialize Leaflet map once
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
    boundaryLayerRef.current = L.layerGroup().addTo(map);
    draftLayerRef.current = L.layerGroup().addTo(map);
    stopsLayerRef.current = L.layerGroup().addTo(map);
    parishLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (ev: L.LeafletMouseEvent) => {
      const coords: LatLng = { lat: ev.latlng.lat, lng: ev.latlng.lng };
      const mode = interactionModeRef.current;

      if (mode === 'add_stop') {
        onMapAddStopRef.current(coords);
      } else if (mode === 'pick_street') {
        onMapPickStreetRef.current(coords);
      } else if (mode === 'draw_boundary') {
        const next = [...draftPointsRef.current, coords];
        draftPointsRef.current = next;
        setDraftPoints(next);
      } else if (highlightedStopIdRef.current) {
        onSelectStopRef.current(null);
      }
    });

    map.on('dblclick', (ev: L.LeafletMouseEvent) => {
      if (
        interactionModeRef.current === 'draw_boundary' &&
        draftPointsRef.current.length >= 3
      ) {
        L.DomEvent.stop(ev);
        const pts = draftPointsRef.current;
        draftPointsRef.current = [];
        setDraftPoints([]);
        onBoundaryCompleteRef.current(pts);
      }
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

  // Cursor & doubleClickZoom toggle per mode
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;

    if (interactionMode === 'pan') {
      container.style.cursor = '';
      map.doubleClickZoom.enable();
    } else if (interactionMode === 'draw_boundary') {
      container.style.cursor = 'crosshair';
      map.doubleClickZoom.disable();
    } else {
      container.style.cursor = 'crosshair';
      map.doubleClickZoom.enable();
    }

    if (interactionMode !== 'draw_boundary') {
      draftPointsRef.current = [];
      setDraftPoints([]);
    }
  }, [interactionMode]);

  // Pan to newly selected parish
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
      `<div style="font-size:12px;"><div style="color:#92400E;font-weight:600;">Punkt startowy parafii</div><div style="font-weight:700;margin-top:2px;">${escapeHtml(parish.name)}</div><div style="color:#475569;margin-top:2px;">${escapeHtml(parish.address)}</div></div>`
    );
    marker.addTo(layer);

    const key = `${parish.location.lat.toFixed(6)},${parish.location.lng.toFixed(6)}`;
    if (lastParishKeyRef.current !== key) {
      lastParishKeyRef.current = key;
      map.setView([parish.location.lat, parish.location.lng], 15);
    }
  }, [parish]);

  // Render editable parish boundary polygon
  useEffect(() => {
    const layer = boundaryLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (interactionMode === 'draw_boundary' || boundary.length < 3) return;

    const latLngs = boundary.map((p) => [p.lat, p.lng] as [number, number]);
    const polygon = L.polygon(latLngs, {
      color: '#B45309',
      weight: 2.5,
      opacity: 0.9,
      fillColor: '#F59E0B',
      fillOpacity: 0.14,
      interactive: false,
    }).addTo(layer);

    // Draggable vertex handles
    boundary.forEach((pt, idx) => {
      const handleIcon = L.divIcon({
        className: '',
        html: `<div style="width:14px;height:14px;border-radius:9999px;background:#FFFFFF;border:2.5px solid #B45309;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const handle = L.marker([pt.lat, pt.lng], {
        icon: handleIcon,
        draggable: true,
        zIndexOffset: 300,
      }).addTo(layer);

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
    });
  }, [boundary, interactionMode]);

  // Render drawing draft polygon
  useEffect(() => {
    const layer = draftLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (interactionMode !== 'draw_boundary' || draftPoints.length === 0) return;

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
        html: `<div style="width:${isFirst ? 24 : 15}px;height:${isFirst ? 24 : 15}px;border-radius:9999px;background:${isFirst ? '#B45309' : '#FFFFFF'};border:${isFirst ? '3px solid #FEF3C7' : '2.5px solid #B45309'};box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
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
            onBoundaryCompleteRef.current(pts);
          }
        });
      }
    });
  }, [draftPoints, interactionMode]);

  // Render stop markers
  useEffect(() => {
    const layer = stopsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    markersByStopIdRef.current = {};

    stops.forEach((stop) => {
      const palette =
        PRIEST_PALETTE.find((p) => p.id === stop.priestId) ?? PRIEST_PALETTE[0];
      const orderNum = orderByStopId[stop.id];
      const isSelected = highlightedStopId === stop.id;
      const size = orderNum ? 28 : 22;

      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${palette.color};border:2.5px solid ${isSelected ? '#0F172A' : palette.borderColor};color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.28);cursor:pointer;">${orderNum ?? ''}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([stop.location.lat, stop.location.lng], {
        icon,
        zIndexOffset: isSelected ? 400 : orderNum ? 200 - orderNum : 100,
      }).addTo(layer);

      const popupEl = document.createElement('div');
      popupEl.style.fontSize = '12px';
      popupEl.style.maxWidth = '240px';
      popupEl.innerHTML = `
        <div style="color:#64748B;font-weight:500;">${escapeHtml(palette.name)}${orderNum ? ` · Przystanek #${orderNum}` : ''}</div>
        <div style="font-weight:700;color:#0F172A;margin-top:2px;">${escapeHtml(stop.address)}</div>
        <div style="color:#64748B;margin-top:4px;">Czas wizyty: ${stop.durationMinutes} min${stop.inBoundary === false ? ' · <span style="color:#B45309;font-weight:600;">Poza terenem parafii</span>' : ''}</div>
        ${stop.notes ? `<div style="color:#475569;margin-top:4px;border-top:1px solid #F1F5F9;padding-top:4px;">${escapeHtml(stop.notes)}</div>` : ''}
      `;
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Usuń dom z planu';
      deleteBtn.style.cssText =
        'margin-top:6px;font-size:12px;font-weight:600;color:#DC2626;background:none;border:none;padding:0;cursor:pointer;';
      deleteBtn.onclick = () => {
        onSelectStopRef.current(null);
        onDeleteStopRef.current(stop.id);
      };
      popupEl.appendChild(deleteBtn);

      marker.bindPopup(popupEl);
      marker.on('click', () => onSelectStopRef.current(stop.id));

      markersByStopIdRef.current[stop.id] = marker;
    });
  }, [stops, orderByStopId, highlightedStopId]);

  // Open popup when stop selected from list
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !highlightedStopId) return;
    const marker = markersByStopIdRef.current[highlightedStopId];
    if (marker) {
      map.panTo(marker.getLatLng());
      marker.openPopup();
    }
  }, [highlightedStopId]);

  // Render route polylines & fit bounds
  useEffect(() => {
    const map = mapRef.current;
    const layer = routesLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const routesWithPath = routes.filter((r) => r.encodedPathPoints.length >= 2);
    if (routesWithPath.length === 0) return;

    const bounds = L.latLngBounds([]);
    routesWithPath.forEach((route) => {
      const latLngs = route.encodedPathPoints.map(
        (p) => [p.lat, p.lng] as [number, number]
      );
      L.polyline(latLngs, {
        color: route.color,
        weight: 5,
        opacity: 0.88,
      }).addTo(layer);
      latLngs.forEach((ll) => bounds.extend(ll));
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [48, 48] });
    }
  }, [routes]);

  return (
    <div className="relative w-full h-full min-h-[340px] bg-slate-100">
      <div ref={containerRef} className="w-full h-full z-0" />

      {streetPickFeedback && (
        <div
          className={`no-print absolute top-3 left-1/2 -translate-x-1/2 z-[500] max-w-[calc(100%-24px)] sm:max-w-md px-3.5 py-2.5 rounded-xl border shadow-lg backdrop-blur-md flex items-center gap-2.5 text-xs font-medium ${
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

      {parish && (
        <div className="no-print absolute bottom-5 left-1/2 -translate-x-1/2 z-[500] w-max max-w-[calc(100%-16px)]">
          {interactionMode === 'pan' && (
            <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-lg p-1.5 flex flex-wrap items-center justify-center gap-1 text-xs text-slate-800">
              <button
                type="button"
                onClick={() => onSetInteractionMode('pan')}
                className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-slate-900 text-white font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Hand className="w-3.5 h-3.5" />
                Przesuwaj
              </button>

              {boundary.length < 3 ? (
                <>
                  <button
                    type="button"
                    onClick={() => onCreatePresetBoundary(300)}
                    className="min-h-[36px] px-2.5 py-1.5 rounded-xl hover:bg-amber-50 text-amber-800 font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                  >
                    <CircleDashed className="w-3.5 h-3.5" />
                    300 m
                  </button>
                  <button
                    type="button"
                    onClick={() => onCreatePresetBoundary(500)}
                    className="min-h-[36px] px-2.5 py-1.5 rounded-xl hover:bg-amber-50 text-amber-800 font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                  >
                    <CircleDashed className="w-3.5 h-3.5" />
                    500 m
                  </button>
                  <button
                    type="button"
                    onClick={() => onCreatePresetBoundary(1000)}
                    className="min-h-[36px] px-2.5 py-1.5 rounded-xl hover:bg-amber-50 text-amber-800 font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                  >
                    <CircleDashed className="w-3.5 h-3.5" />
                    1 km
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onScaleBoundary(0.82)}
                    className="min-h-[36px] px-2.5 py-1.5 rounded-xl hover:bg-amber-50 text-amber-800 font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                  >
                    <Minimize2 className="w-3.5 h-3.5" />
                    Mniejszy
                  </button>
                  <button
                    type="button"
                    onClick={() => onScaleBoundary(1.22)}
                    className="min-h-[36px] px-2.5 py-1.5 rounded-xl hover:bg-amber-50 text-amber-800 font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    Większy
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => onSetInteractionMode('draw_boundary')}
                className="min-h-[36px] px-2.5 py-1.5 rounded-xl hover:bg-slate-100 text-slate-700 font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <Pentagon className="w-3.5 h-3.5" />
                {boundary.length >= 3 ? 'Przerysuj' : 'Rysuj teren'}
              </button>

              {boundary.length >= 3 && (
                <button
                  type="button"
                  onClick={onClearBoundary}
                  title="Usuń granice terenu"
                  className="min-h-[36px] px-2 py-1.5 rounded-xl hover:bg-red-50 text-slate-500 hover:text-red-600 inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}

              <span className="h-4 w-px bg-slate-200 mx-0.5 hidden sm:inline-block" />

              <button
                type="button"
                onClick={() => onSetInteractionMode('pick_street')}
                className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <Route className="w-3.5 h-3.5 text-amber-700" />
                Kliknij ulicę
              </button>

              <button
                type="button"
                onClick={() => onSetInteractionMode('add_stop')}
                className="min-h-[36px] px-2.5 py-1.5 rounded-xl hover:bg-slate-100 text-slate-700 font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <MapPinPlus className="w-3.5 h-3.5" />
                Dodaj dom
              </button>
            </div>
          )}

          {interactionMode === 'draw_boundary' && (
            <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl shadow-lg px-3.5 py-2.5 flex flex-wrap items-center justify-center gap-2.5 text-sm text-slate-900">
              <span className="font-medium text-xs sm:text-sm text-center">
                Dotknij kolejne narożniki terenu · Punkty:{' '}
                <span className="font-mono tabular-nums font-bold text-amber-800">
                  {draftPoints.length}
                </span>
              </span>
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {draftPoints.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = draftPointsRef.current.slice(0, -1);
                      draftPointsRef.current = next;
                      setDraftPoints(next);
                    }}
                    className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center gap-1 whitespace-nowrap"
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
                      onBoundaryComplete(pts);
                    }}
                    className="min-h-[38px] px-3.5 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Zakończ obrys
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    draftPointsRef.current = [];
                    setDraftPoints([]);
                    onCancelInteraction();
                  }}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <X className="w-3.5 h-3.5" />
                  Anuluj
                </button>
              </div>
            </div>
          )}

          {interactionMode === 'pick_street' && (
            <div className="bg-white/95 backdrop-blur-md border border-amber-300 rounded-2xl shadow-lg px-3.5 py-2.5 flex items-center justify-between gap-3 text-sm text-slate-900">
              <Route className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="font-medium text-xs sm:text-sm">
                Kliknij dowolną ulicę na mapie — pobierzemy wszystkie domy z tej
                ulicy
              </span>
              <button
                type="button"
                onClick={onCancelInteraction}
                className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-xl whitespace-nowrap shrink-0"
              >
                Zakończ
              </button>
            </div>
          )}

          {interactionMode === 'add_stop' && (
            <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl shadow-lg px-3.5 py-2.5 flex items-center justify-between gap-3 text-sm text-slate-900">
              <MapPinPlus className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="font-medium text-xs sm:text-sm">
                Dotknij budynek na mapie — zapiszemy jego adres domu
              </span>
              <button
                type="button"
                onClick={onCancelInteraction}
                className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl whitespace-nowrap shrink-0"
              >
                Zakończ
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
