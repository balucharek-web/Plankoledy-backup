import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Loader2,
  MapPinPlus,
  Route,
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

    const latLngs = boundary.map((p) => [p.lat, p.lng] as [number, number]);
    const polygon = L.polygon(latLngs, {
      color: '#B45309',
      weight: 2.5,
      opacity: 0.9,
      fillColor: '#F59E0B',
      fillOpacity: 0.14,
      interactive: false,
    }).addTo(layer);

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
            onBoundaryCompleteRef.current(pts);
          }
        });
      }
    });
  }, [draftPoints, interactionMode]);

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
      const isIncluded = stop.included !== false;
      const size = !isIncluded ? 14 : orderNum ? 28 : 22;

      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${
          isIncluded ? palette.color : '#CBD5E1'
        };border:2.5px solid ${
          isSelected ? '#0F172A' : isIncluded ? palette.borderColor : '#64748B'
        };opacity:${isIncluded ? 1 : 0.65};color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.28);cursor:pointer;">${
          isIncluded ? (orderNum ?? '') : ''
        }</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([stop.location.lat, stop.location.lng], {
        icon,
        zIndexOffset: isSelected
          ? 400
          : !isIncluded
            ? 40
            : orderNum
              ? 200 - orderNum
              : 100,
      }).addTo(layer);

      const popupEl = document.createElement('div');
      popupEl.style.fontSize = '12px';
      popupEl.style.maxWidth = '240px';
      popupEl.innerHTML = `
        <div style="color:#64748B;font-weight:500;">${
          isIncluded
            ? `${escapeHtml(palette.name)}${
                orderNum ? ` · Przystanek #${orderNum}` : ''
              }`
            : 'Zapamiętany adres (poza bieżącym planem)'
        }</div>
        <div style="font-weight:700;color:#0F172A;margin-top:2px;">${escapeHtml(
          stop.address
        )}</div>
        <div style="color:#64748B;margin-top:4px;">Czas wizyty: ${
          stop.durationMinutes
        } min${
          stop.inBoundary === false
            ? ' · <span style="color:#B45309;font-weight:600;">Poza terenem parafii</span>'
            : ''
        }</div>
        ${
          stop.notes
            ? `<div style="color:#475569;margin-top:4px;border-top:1px solid #F1F5F9;padding-top:4px;">${escapeHtml(
                stop.notes
              )}</div>`
            : ''
        }
      `;
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Usuń adres z parafii';
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

      {parish && interactionMode !== 'pan' && (
        <div className="no-print absolute top-3 left-1/2 -translate-x-1/2 z-[500] w-max max-w-[calc(100%-24px)]">
          {interactionMode === 'draw_boundary' && (
            <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-lg px-3.5 py-2 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-900">
              <span className="font-medium">
                Dotknij kolejne narożniki obszaru · Punkty:{' '}
                <span className="font-mono tabular-nums font-bold text-amber-800">
                  {draftPoints.length}
                </span>
              </span>
              <div className="flex items-center gap-1.5">
                {draftPoints.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = draftPointsRef.current.slice(0, -1);
                      draftPointsRef.current = next;
                      setDraftPoints(next);
                    }}
                    className="min-h-[34px] px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1"
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
                    className="min-h-[34px] px-3 py-1 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg inline-flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Zapisz obszar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    draftPointsRef.current = [];
                    setDraftPoints([]);
                    onCancelInteraction();
                  }}
                  className="min-h-[34px] px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  Anuluj
                </button>
              </div>
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
