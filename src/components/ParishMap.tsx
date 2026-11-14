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
  Check,
  CheckCircle2,
  Church,
  Loader2,
  MapPinPlus,
  Route,
  Undo2,
  X,
} from 'lucide-react';
import { useParishPolygonDrawer } from '../hooks/useParishPolygonDrawer';
import {
  LatLng,
  MapInteractionMode,
  PRIEST_PALETTE,
  ParishCenter,
  PriestRouteResult,
  StreetPickFeedback,
  VisitStop,
} from '../types/parish';

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

interface StopMarkerProps {
  stop: VisitStop;
  orderNumber?: number;
  color: string;
  borderColor: string;
  isSelected: boolean;
  onSelect: () => void;
  onClose: () => void;
  onDelete: () => void;
}

const StopMarker: React.FC<StopMarkerProps> = ({
  stop,
  orderNumber,
  color,
  borderColor,
  isSelected,
  onSelect,
  onClose,
  onDelete,
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const isIncluded = stop.included !== false;
  const size = !isIncluded ? 14 : orderNumber ? 28 : 22;

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={stop.location}
        title={stop.address || stop.label}
        zIndex={
          isSelected ? 400 : !isIncluded ? 40 : orderNumber ? 200 - orderNumber : 100
        }
        onClick={onSelect}
      >
        <div
          className="flex items-center justify-center rounded-full text-xs font-mono font-semibold shadow-md transition-transform hover:scale-110 cursor-pointer select-none"
          style={{
            width: size,
            height: size,
            backgroundColor: isIncluded ? color : '#CBD5E1',
            border: `2.5px solid ${
              isSelected ? '#0F172A' : isIncluded ? borderColor : '#64748B'
            }`,
            color: '#FFFFFF',
            opacity: isIncluded ? 1 : 0.65,
          }}
        >
          {isIncluded ? (orderNumber ?? '') : ''}
        </div>
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow anchor={marker} onCloseClick={onClose} maxWidth={260}>
          <div className="p-1 text-slate-900">
            <div className="text-xs font-medium text-slate-500">
              {isIncluded
                ? `${
                    PRIEST_PALETTE.find((p) => p.id === stop.priestId)?.name ??
                    `Ksiądz ${stop.priestId}`
                  }${orderNumber ? ` · Przystanek #${orderNumber}` : ''}`
                : 'Zapamiętany adres (poza bieżącym planem)'}
            </div>
            <div className="text-sm font-semibold mt-0.5">{stop.address}</div>
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
            {stop.notes && (
              <div className="text-xs text-slate-600 mt-1 border-t border-slate-100 pt-1">
                {stop.notes}
              </div>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="mt-2 text-xs font-medium text-red-600 hover:text-red-700"
            >
              Usuń adres z parafii
            </button>
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
}> = ({ routeObjects }) => {
  const map = useMap();
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!map) return;

    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (routeObjects.length === 0) return;

    const created: google.maps.Polyline[] = [];
    const bounds = new google.maps.LatLngBounds();
    let hasBounds = false;

    for (const entry of routeObjects) {
      const nativePolylines = entry.routeObj.createPolylines();
      nativePolylines.forEach((pl) => {
        pl.setOptions({
          strokeColor: entry.color,
          strokeWeight: 5,
          strokeOpacity: 0.88,
          zIndex: 50 + entry.priestId,
        });
        pl.setMap(map);
        created.push(pl);

        const path = pl.getPath();
        path.forEach((latLng) => {
          bounds.extend(latLng);
          hasBounds = true;
        });
      });
    }

    polylinesRef.current = created;

    if (hasBounds) {
      map.fitBounds(bounds, { top: 64, right: 48, bottom: 48, left: 48 });
    }

    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, routeObjects]);

  return null;
};

const MapControllerLayer: React.FC<{
  parish: ParishCenter | null;
  boundary: LatLng[];
  interactionMode: MapInteractionMode;
  onBoundaryComplete: (points: LatLng[]) => void;
  onBoundaryUpdate: (points: LatLng[]) => void;
  onCancelInteraction: () => void;
  onMapAddStop: (location: LatLng) => void;
  onMapPickStreet: (location: LatLng) => void;
}> = ({
  parish,
  boundary,
  interactionMode,
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
      savedBoundary: boundary,
      onComplete: onBoundaryComplete,
      onUpdateBoundary: onBoundaryUpdate,
    });

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

export const ParishMap: React.FC<ParishMapProps> = ({
  parish,
  boundary,
  stops,
  routes,
  routeObjects,
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
  const orderByStopId = useMemo(() => {
    const dict: Record<string, number> = {};
    for (const route of routes) {
      for (const item of route.orderedStops) {
        dict[item.stop.id] = item.orderIndex;
      }
    }
    return dict;
  }, [routes]);

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
          interactionMode={interactionMode}
          onBoundaryComplete={onBoundaryComplete}
          onBoundaryUpdate={onBoundaryUpdate}
          onCancelInteraction={onCancelInteraction}
          onMapAddStop={onMapAddStop}
          onMapPickStreet={onMapPickStreet}
        />

        <RoutePolylinesLayer routeObjects={routeObjects} />

        {parish && <ParishChurchMarker parish={parish} />}

        {stops.map((stop) => {
          const palette =
            PRIEST_PALETTE.find((p) => p.id === stop.priestId) ??
            PRIEST_PALETTE[0];
          return (
            <StopMarker
              key={stop.id}
              stop={stop}
              orderNumber={orderByStopId[stop.id]}
              color={palette.color}
              borderColor={palette.borderColor}
              isSelected={highlightedStopId === stop.id}
              onSelect={() => onSelectStop(stop.id)}
              onClose={() => onSelectStop(null)}
              onDelete={() => {
                onSelectStop(null);
                onDeleteStop(stop.id);
              }}
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
