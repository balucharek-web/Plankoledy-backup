import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  ControlPosition,
  InfoWindow,
  Map as GoogleMap,
  MapControl,
  Pin,
  useAdvancedMarkerRef,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Church,
  Loader2,
  LocateFixed,
  MapPinPlus,
  Route,
  Undo2,
  X,
} from 'lucide-react';
import { useParishPolygonDrawer } from '../hooks/useParishPolygonDrawer';
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
  RouteStopMeta,
  StopMarkerAppearance,
  buildRouteStopLookup,
  computeStopMarkerAppearance,
  extractStreetName,
} from '../utils/spatial';

export interface RoutePolylineEntry {
  priestId: number;
  color: string;
  routeObj: google.maps.routes.Route;
}

interface ParishMapProps {
  parish: ParishCenter | null;
  boundary: LatLng[];
  stops: VisitStop[];
  routes: PriestRouteResult[];
  routeObjects: RoutePolylineEntry[];
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

interface StopMarkerProps {
  stop: VisitStop;
  routeMeta?: RouteStopMeta;
  isActiveInView: boolean;
  appearance: StopMarkerAppearance;
  color: string;
  isSelected: boolean;
  onSelect: () => void;
  onClose: () => void;
  onDelete: () => void;
  onOpenBlockUnits?: () => void;
}

const StopMarker: React.FC<StopMarkerProps> = ({
  stop,
  routeMeta,
  isActiveInView,
  appearance,
  color,
  isSelected,
  onSelect,
  onClose,
  onDelete,
  onOpenBlockUnits,
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const isBlock = Boolean(stop.isMultiUnit || (stop.units && stop.units.length > 0));
  const unitsTotal = stop.units?.length || stop.unitsCount || 0;
  const orderNumber = routeMeta?.orderNumber;
  const bgColor = appearance.fillColorOverride ?? color;
  const borderCol =
    appearance.borderColorOverride ?? (isSelected ? '#0F172A' : '#FFFFFF');

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={stop.location}
        title={stop.address || stop.label}
        zIndex={appearance.zIndexPriority}
        onClick={onSelect}
      >
        <div
          className={`flex items-center justify-center font-mono font-bold transition-transform hover:scale-110 cursor-pointer select-none ${
            isBlock ? 'rounded-md' : 'rounded-full'
          }`}
          style={{
            width: appearance.size,
            height: appearance.size,
            fontSize: appearance.fontSize,
            lineHeight: 1,
            backgroundColor: bgColor,
            border: `${appearance.borderWidth}px solid ${borderCol}`,
            boxShadow: appearance.showLabel
              ? '0 2px 6px rgba(15,23,42,0.28)'
              : '0 1px 3px rgba(15,23,42,0.25)',
            color: '#FFFFFF',
            opacity: appearance.opacity,
          }}
        >
          {appearance.showLabel ? appearance.labelText : ''}
        </div>
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow anchor={marker} onCloseClick={onClose} maxWidth={280}>
          <div className="p-1 text-slate-900">
            <div className="text-xs font-medium text-slate-500">
              {isActiveInView
                ? `${
                    PRIEST_PALETTE.find((p) => p.id === stop.priestId)?.name ??
                    `Ksiądz ${stop.priestId}`
                  }${orderNumber ? ` · Przystanek #${orderNumber}` : ''}`
                : 'Poza wybranym dniem / bieżącym planem'}
            </div>
            <div className="text-sm font-semibold mt-0.5 flex items-center gap-1.5">
              {isBlock && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[11px] font-semibold shrink-0">
                  <Building2 className="w-3 h-3" />
                  Blok{unitsTotal > 0 ? ` · ${unitsTotal} lok.` : ''}
                </span>
              )}
              <span>{stop.address}</span>
            </div>
            {routeMeta?.arrivalTime && (
              <div className="text-xs text-slate-700 font-semibold mt-0.5 tabular-nums">
                Godzina: ~{routeMeta.arrivalTime}–{routeMeta.departureTime}
              </div>
            )}
            {stop.visitDate && (
              <div className="text-xs text-amber-800 font-medium mt-0.5 tabular-nums">
                Zaplanowano: {stop.visitDate}
              </div>
            )}
            {stop.label && stop.label !== stop.address && (
              <div className="text-xs text-slate-600 mt-0.5">{stop.label}</div>
            )}
            <div className="text-xs text-slate-500 mt-1.5 tabular-nums">
              Czas wizyty: {stop.durationMinutes} min
              {stop.inBoundary === false && (
                <span className="text-amber-700 font-medium">
                  {' '}
                  · Poza terenem parafii
                </span>
              )}
            </div>
            {stop.units && stop.units.length > 0 && (
              <div className="mt-1.5 p-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-700 space-y-0.5">
                <div className="font-semibold text-slate-800">
                  Lokale w bloku ({stop.units.length}):
                </div>
                {stop.units.slice(0, 4).map((u) => (
                  <div key={u.id} className="truncate">
                    {u.staircase ? `kl. ${u.staircase} ` : ''}m. {u.unitNumber}
                    {u.familyName ? ` — ${u.familyName}` : ''}
                  </div>
                ))}
                {stop.units.length > 4 && (
                  <div className="text-slate-500">
                    +{stop.units.length - 4} kolejnych lokali...
                  </div>
                )}
              </div>
            )}
            {stop.notes && (
              <div className="text-xs text-slate-600 mt-1 border-t border-slate-100 pt-1">
                {stop.notes}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {onOpenBlockUnits && (
                <button
                  type="button"
                  onClick={onOpenBlockUnits}
                  className="text-xs font-semibold text-amber-800 hover:text-amber-900 underline"
                >
                  {isBlock
                    ? `Rozpiska lokali (${unitsTotal})`
                    : 'Konfiguruj lokale / blok'}
                </button>
              )}
              <button
                type="button"
                onClick={onDelete}
                className="text-xs font-medium text-red-600 hover:text-red-700"
              >
                Usuń adres
              </button>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

const ParishChurchMarker: React.FC<{ parish: ParishCenter }> = ({ parish }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(false);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={parish.location}
        title={parish.name}
        zIndex={500}
        onClick={() => setOpen((v) => !v)}
      >
        <Pin
          background="#B45309"
          borderColor="#78350F"
          glyphColor="#FEF3C7"
          scale={1.2}
        >
          <Church className="w-4 h-4" />
        </Pin>
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow anchor={marker} onCloseClick={() => setOpen(false)}>
          <div className="p-1 text-slate-900">
            <div className="text-xs font-medium text-amber-800">
              Punkt startowy parafii
            </div>
            <div className="text-sm font-semibold mt-0.5">{parish.name}</div>
            <div className="text-xs text-slate-600 mt-0.5">
              {parish.address}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

const RoutePolylinesLayer: React.FC<{
  routeObjects: RoutePolylineEntry[];
  routes: PriestRouteResult[];
  isExactRoute: boolean;
  focusedPriestId: number | null;
  showRouteLines: boolean;
}> = ({
  routeObjects,
  routes,
  isExactRoute,
  focusedPriestId,
  showRouteLines,
}) => {
  const map = useMap();
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const lastFittedKeyRef = useRef<string>('');

  useEffect(() => {
    if (!map) return;

    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!showRouteLines) return;

    const created: google.maps.Polyline[] = [];
    const bounds = new google.maps.LatLngBounds();
    let hasBounds = false;

    const routeSignature = `${isExactRoute ? 'exact' : 'est'}:${routes
      .map(
        (r) =>
          `${r.priestId}:${r.orderedStops.length}:${Math.round(r.totalDistanceMeters)}`
      )
      .join(',')}:${focusedPriestId ?? 'all'}`;

    if (routeObjects.length > 0 && isExactRoute) {
      for (const entry of routeObjects) {
        const isFocused =
          focusedPriestId === null || focusedPriestId === entry.priestId;
        const nativePolylines = entry.routeObj.createPolylines();
        nativePolylines.forEach((pl) => {
          // Strip Google's chunky dotted walking bead icons and render clean, slim navigation lines
          pl.setOptions({
            strokeColor: entry.color,
            strokeWeight: isFocused ? 3.5 : 2,
            strokeOpacity: isFocused ? 0.78 : 0.2,
            icons: isFocused
              ? [
                  {
                    icon: {
                      path: google.maps.SymbolPath.FORWARD_OPEN_ARROW,
                      scale: 2,
                      strokeColor: entry.color,
                      strokeOpacity: 0.9,
                      strokeWeight: 1.8,
                    },
                    offset: '90px',
                    repeat: '160px',
                  },
                ]
              : [],
            zIndex: isFocused ? 70 + entry.priestId : 30 + entry.priestId,
          });
          pl.setMap(map);
          created.push(pl);

          if (isFocused) {
            const path = pl.getPath();
            path.forEach((latLng) => {
              bounds.extend(latLng);
              hasBounds = true;
            });
          }
        });
      }
    } else if (routes.length > 0) {
      for (const route of routes) {
        if (route.encodedPathPoints.length < 2) continue;
        const isFocused =
          focusedPriestId === null || focusedPriestId === route.priestId;
        const pl = new google.maps.Polyline({
          path: route.encodedPathPoints,
          strokeColor: route.color,
          strokeOpacity: 0,
          icons: [
            {
              icon: {
                path: 'M 0,-1 0,1',
                strokeOpacity: isFocused ? 0.72 : 0.18,
                scale: isFocused ? 2.6 : 1.8,
              },
              offset: '0',
              repeat: '11px',
            },
          ],
          zIndex: isFocused ? 65 + route.priestId : 25 + route.priestId,
          map,
        });
        created.push(pl);
        if (isFocused) {
          route.encodedPathPoints.forEach((pt) => {
            bounds.extend(pt);
            hasBounds = true;
          });
        }
      }
    }

    polylinesRef.current = created;

    if (hasBounds && lastFittedKeyRef.current !== routeSignature) {
      lastFittedKeyRef.current = routeSignature;
      map.fitBounds(bounds, { top: 64, right: 48, bottom: 90, left: 48 });
    }

    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, routeObjects, routes, isExactRoute, focusedPriestId, showRouteLines]);

  return null;
};

const MapControllerLayer: React.FC<{
  parish: ParishCenter | null;
  boundary: LatLng[];
  canEditBoundary: boolean;
  interactionMode: MapInteractionMode;
  onZoomChange: (zoom: number) => void;
  onBoundaryComplete: (points: LatLng[]) => void;
  onBoundaryUpdate: (points: LatLng[]) => void;
  onCancelInteraction: () => void;
  onMapAddStop: (location: LatLng) => void;
  onMapPickStreet: (location: LatLng) => void;
}> = ({
  parish,
  boundary,
  canEditBoundary,
  interactionMode,
  onZoomChange,
  onBoundaryComplete,
  onBoundaryUpdate,
  onCancelInteraction,
  onMapAddStop,
  onMapPickStreet,
}) => {
  const map = useMap();
  const lastParishKeyRef = useRef<string>('');

  const { draftVertexCount, finishDraft, undoLastVertex, cancelDraft } =
    useParishPolygonDrawer({
      isDrawing: interactionMode === 'draw_boundary',
      canEditBoundary,
      savedBoundary: boundary,
      onComplete: onBoundaryComplete,
      onUpdateBoundary: onBoundaryUpdate,
    });

  useEffect(() => {
    if (!map) return;
    const syncZoom = () => {
      const z = map.getZoom();
      if (typeof z === 'number') {
        onZoomChange(z);
      }
    };
    syncZoom();
    const listener = map.addListener('zoom_changed', syncZoom);
    return () => google.maps.event.removeListener(listener);
  }, [map, onZoomChange]);

  useEffect(() => {
    if (!map || !parish) return;
    const key = `${parish.location.lat.toFixed(6)},${parish.location.lng.toFixed(6)}`;
    if (lastParishKeyRef.current !== key) {
      lastParishKeyRef.current = key;
      map.panTo(parish.location);
      map.setZoom(15);
    }
  }, [map, parish]);

  useEffect(() => {
    if (
      !map ||
      (interactionMode !== 'add_stop' && interactionMode !== 'pick_street')
    ) {
      return;
    }

    map.setOptions({ draggableCursor: 'crosshair' });
    const listener = map.addListener(
      'click',
      (ev: google.maps.MapMouseEvent) => {
        if (!ev.latLng) return;
        const coords = { lat: ev.latLng.lat(), lng: ev.latLng.lng() };
        if (interactionMode === 'pick_street') {
          onMapPickStreet(coords);
        } else {
          onMapAddStop(coords);
        }
      }
    );

    return () => {
      google.maps.event.removeListener(listener);
      map.setOptions({ draggableCursor: null });
    };
  }, [map, interactionMode, onMapAddStop, onMapPickStreet]);

  if (!parish || interactionMode === 'pan') return null;

  return (
    <MapControl position={ControlPosition.TOP_CENTER}>
      {interactionMode === 'draw_boundary' && (
        <div className="no-print mt-3 mx-2 max-w-[calc(100vw-24px)] bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-lg px-3.5 py-2 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-900">
          <span className="font-medium">
            Dotknij kolejne narożniki obszaru · Punkty:{' '}
            <span className="font-mono tabular-nums font-bold text-amber-800">
              {draftVertexCount}
            </span>
          </span>
          <div className="flex items-center gap-1.5">
            {draftVertexCount > 0 && (
              <button
                type="button"
                onClick={undoLastVertex}
                className="min-h-[34px] px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Cofnij
              </button>
            )}
            {draftVertexCount >= 3 && (
              <button
                type="button"
                onClick={finishDraft}
                className="min-h-[34px] px-3 py-1 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg inline-flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                Zapisz obszar
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                cancelDraft();
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
        <div className="no-print mt-3 mx-2 max-w-[calc(100vw-24px)] bg-white/95 backdrop-blur-md border border-amber-300 rounded-xl shadow-lg px-3.5 py-2 flex items-center gap-2.5 text-xs text-slate-900">
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
        <div className="no-print mt-3 mx-2 max-w-[calc(100vw-24px)] bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-lg px-3.5 py-2 flex items-center gap-2.5 text-xs text-slate-900">
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
    </MapControl>
  );
};

const UserGpsMarkerLayer: React.FC = () => {
  const map = useMap();
  const gps = useUserGpsLocation();
  const circleRef = useRef<google.maps.Circle | null>(null);
  const hasCenteredRef = useRef<boolean>(false);

  useEffect(() => {
    if (!map) return;
    if (circleRef.current) {
      circleRef.current.setMap(null);
      circleRef.current = null;
    }

    if (!gps.active || !gps.position) {
      if (!gps.active) hasCenteredRef.current = false;
      return;
    }

    if (gps.accuracyMeters && gps.accuracyMeters > 0) {
      circleRef.current = new google.maps.Circle({
        map,
        center: gps.position,
        radius: Math.min(gps.accuracyMeters, 250),
        strokeColor: '#2563EB',
        strokeOpacity: 0.45,
        strokeWeight: 1,
        fillColor: '#3B82F6',
        fillOpacity: 0.14,
        clickable: false,
      });
    }

    if (!hasCenteredRef.current) {
      hasCenteredRef.current = true;
      map.panTo(gps.position);
      const currentZoom = map.getZoom() ?? 15;
      if (currentZoom < 16) map.setZoom(16);
    }

    return () => {
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
    };
  }, [map, gps.active, gps.position, gps.accuracyMeters]);

  return (
    <>
      {gps.active && gps.position && (
        <AdvancedMarker position={gps.position} zIndex={950}>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: '9999px',
              backgroundColor: '#2563EB',
              border: '3px solid #FFFFFF',
              boxShadow: '0 2px 8px rgba(37,99,235,0.55)',
            }}
          />
        </AdvancedMarker>
      )}

      <MapControl position={ControlPosition.RIGHT_TOP}>
        <div className="no-print mr-2.5 mt-1 flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            {gps.active && gps.position && (
              <button
                type="button"
                onClick={() => {
                  if (map && gps.position) {
                    map.panTo(gps.position);
                    if ((map.getZoom() ?? 15) < 17) map.setZoom(17);
                  }
                }}
                className="min-h-[36px] px-2.5 py-1.5 bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-md text-xs font-medium text-slate-800 hover:bg-slate-50"
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
      </MapControl>
    </>
  );
};

export const ParishMap: React.FC<ParishMapProps> = ({
  parish,
  boundary,
  stops,
  routes,
  routeObjects,
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
  const [mapZoom, setMapZoom] = useState<number>(parish ? 15 : 6);

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

  return (
    <div className="relative w-full h-full min-h-[340px] bg-slate-100">
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={parish?.location ?? DEFAULT_POLAND_CENTER}
        defaultZoom={parish ? 15 : 6}
        gestureHandling="greedy"
        mapTypeControl={true}
        streetViewControl={false}
        fullscreenControl={true}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        className="w-full h-full"
        onClick={() => {
          if (interactionMode === 'pan' && highlightedStopId) {
            onSelectStop(null);
          }
        }}
      >
        <MapControllerLayer
          parish={parish}
          boundary={boundary}
          canEditBoundary={canEditBoundary}
          interactionMode={interactionMode}
          onZoomChange={setMapZoom}
          onBoundaryComplete={onBoundaryComplete}
          onBoundaryUpdate={onBoundaryUpdate}
          onCancelInteraction={onCancelInteraction}
          onMapAddStop={onMapAddStop}
          onMapPickStreet={onMapPickStreet}
        />

        <RoutePolylinesLayer
          routeObjects={routeObjects}
          routes={routes}
          isExactRoute={isExactRoute}
          focusedPriestId={focusedPriestId}
          showRouteLines={showRouteLines}
        />

        <UserGpsMarkerLayer />

        {parish && <ParishChurchMarker parish={parish} />}

        {stops.map((stop) => {
          const palette =
            PRIEST_PALETTE.find((p) => p.id === stop.priestId) ??
            PRIEST_PALETTE[0];
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
          const isSelected = highlightedStopId === stop.id;
          const routeMeta = routeMetaByStopId[stop.id];

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

          return (
            <StopMarker
              key={stop.id}
              stop={stop}
              routeMeta={routeMeta}
              isActiveInView={isActiveInView}
              appearance={appearance}
              color={palette.color}
              isSelected={isSelected}
              onSelect={() => onSelectStop(stop.id)}
              onClose={() => onSelectStop(null)}
              onDelete={() => {
                onSelectStop(null);
                onDeleteStop(stop.id);
              }}
              onOpenBlockUnits={
                onOpenBlockUnits
                  ? () => {
                      onSelectStop(null);
                      onOpenBlockUnits(stop.id);
                    }
                  : undefined
              }
            />
          );
        })}
      </GoogleMap>

      {streetPickFeedback && (
        <div
          className={`no-print absolute ${
            interactionMode === 'pan' ? 'top-3' : 'top-16 sm:top-16'
          } left-1/2 -translate-x-1/2 z-20 max-w-[calc(100%-24px)] sm:max-w-md px-3.5 py-2.5 rounded-xl border shadow-lg backdrop-blur-md flex items-center gap-2.5 text-xs font-medium ${
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
