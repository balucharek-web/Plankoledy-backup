import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Loader2,
  LocateFixed,
  MapPinPlus,
  Route,
  Undo2,
  X,
} from 'lucide-react';
import { useUserGpsLocation } from '../hooks/useUserGpsLocation';
import {
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
  computeStopMarkerAppearance,
  extractStreetName,
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
  streetPickFeedback: StreetPickFeedback | null;
  onDismissStreetFeedback: () => void;
  onBoundaryComplete: (points: LatLng[]) => void;
  onBoundaryUpdate: (points: LatLng[]) => void;
  onCancelInteraction: () => void;
  onMapAddStop: (location: LatLng) => void;
  onMapPickStreet: (location: LatLng) => void;
  onSelectStop: (stopId: string | null) => void;
  onDeleteStop: (stopId: string) => void;
  onOpenBlockUnits?: (stopId: string) => void;
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
  streetPickFeedback,
  onDismissStreetFeedback,
  onBoundaryComplete,
  onBoundaryUpdate,
  onCancelInteraction,
  onMapAddStop,
  onMapPickStreet,
  onSelectStop,
  onDeleteStop,
  onOpenBlockUnits,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const parishLayerRef = useRef<L.LayerGroup | null>(null);
  const boundaryLayerRef = useRef<L.LayerGroup | null>(null);
  const draftLayerRef = useRef<L.LayerGroup | null>(null);
  const stopsLayerRef = useRef<L.LayerGroup | null>(null);
  const routesLayerRef = useRef<L.LayerGroup | null>(null);
  const gpsLayerRef = useRef<L.LayerGroup | null>(null);
  const markersByStopIdRef = useRef<Record<string, L.Marker>>({});
  const lastParishKeyRef = useRef<string>('');
  const lastFittedKeyRef = useRef<string>('');
  const hasCenteredGpsRef = useRef<boolean>(false);

  const gps = useUserGpsLocation();
  const [mapZoom, setMapZoom] = useState<number>(parish ? 15 : 6);
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
  const onOpenBlockUnitsRef = useRef(onOpenBlockUnits);
  onOpenBlockUnitsRef.current = onOpenBlockUnits;
  const onBoundaryCompleteRef = useRef(onBoundaryComplete);
  onBoundaryCompleteRef.current = onBoundaryComplete;
  const onBoundaryUpdateRef = useRef(onBoundaryUpdate);
  onBoundaryUpdateRef.current = onBoundaryUpdate;
  const highlightedStopIdRef = useRef(highlightedStopId);
  highlightedStopIdRef.current = highlightedStopId;

  const routeMetaByStopId = useMemo(
    () => buildRouteStopLookup(routes),
    [routes]
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
    boundaryLayerRef.current = L.layerGroup().addTo(map);
    draftLayerRef.current = L.layerGroup().addTo(map);
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
      weight: canEditBoundary ? 2.2 : 1.5,
      opacity: canEditBoundary ? 0.85 : 0.42,
      fillColor: '#F59E0B',
      fillOpacity: canEditBoundary ? 0.11 : 0.03,
      interactive: false,
    }).addTo(layer);

    if (!canEditBoundary) return;

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
  }, [boundary, interactionMode, canEditBoundary]);

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
      const routeMeta = routeMetaByStopId[stop.id];
      const orderNum = routeMeta?.orderNumber;
      const isSelected = highlightedStopId === stop.id;
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
        isSelected,
        isBlock,
        routeMeta,
      });

      const borderRadius = isBlock ? '6px' : '9999px';
      const bgColor = appearance.fillColorOverride ?? palette.color;
      const borderCol =
        appearance.borderColorOverride ?? (isSelected ? '#0F172A' : '#FFFFFF');

      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${appearance.size}px;height:${appearance.size}px;border-radius:${borderRadius};background:${bgColor};border:${appearance.borderWidth}px solid ${borderCol};opacity:${appearance.opacity};color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:${appearance.fontSize}px;line-height:1;font-weight:700;box-shadow:${
          appearance.showLabel
            ? '0 2px 6px rgba(15,23,42,0.28)'
            : '0 1px 3px rgba(15,23,42,0.24)'
        };cursor:pointer;">${appearance.showLabel ? appearance.labelText : ''}</div>`,
        iconSize: [appearance.size, appearance.size],
        iconAnchor: [appearance.size / 2, appearance.size / 2],
      });

      const marker = L.marker([stop.location.lat, stop.location.lng], {
        icon,
        zIndexOffset: appearance.zIndexPriority,
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
