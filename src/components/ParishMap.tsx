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
  Check,
  Church,
  CircleDashed,
  Hand,
  MapPinPlus,
  Pentagon,
  Trash2,
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
  onSetInteractionMode: (mode: MapInteractionMode) => void;
  onCreatePresetBoundary: () => void;
  onClearBoundary: () => void;
  onBoundaryComplete: (points: LatLng[]) => void;
  onBoundaryUpdate: (points: LatLng[]) => void;
  onCancelInteraction: () => void;
  onMapAddStop: (location: LatLng) => void;
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

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={stop.location}
        title={stop.address || stop.label}
        zIndex={isSelected ? 400 : orderNumber ? 200 - orderNumber : 100}
        onClick={onSelect}
      >
        <div
          className="flex items-center justify-center rounded-full text-xs font-mono font-semibold shadow-md transition-transform hover:scale-110 cursor-pointer select-none"
          style={{
            width: orderNumber ? 28 : 22,
            height: orderNumber ? 28 : 22,
            backgroundColor: color,
            border: `2.5px solid ${isSelected ? '#0F172A' : borderColor}`,
            color: '#FFFFFF',
          }}
        >
          {orderNumber ?? ''}
        </div>
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow anchor={marker} onCloseClick={onClose} maxWidth={260}>
          <div className="p-1 text-slate-900">
            <div className="text-xs font-medium text-slate-500">
              {PRIEST_PALETTE.find((p) => p.id === stop.priestId)?.name ??
                `Ksiądz ${stop.priestId}`}
              {orderNumber ? ` · Przystanek #${orderNumber}` : ''}
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
              Usuń dom z planu
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

/**
 * Renders native Google Maps Polylines via primaryRoute.createPolylines()
 * and auto-fits viewport bounds when routes change.
 */
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

/**
 * Handles camera panning, editable parish polygon drawing, and click-to-add-house mode.
 */
const MapControllerLayer: React.FC<{
  parish: ParishCenter | null;
  boundary: LatLng[];
  interactionMode: MapInteractionMode;
  onSetInteractionMode: (mode: MapInteractionMode) => void;
  onCreatePresetBoundary: () => void;
  onClearBoundary: () => void;
  onBoundaryComplete: (points: LatLng[]) => void;
  onBoundaryUpdate: (points: LatLng[]) => void;
  onCancelInteraction: () => void;
  onMapAddStop: (location: LatLng) => void;
}> = ({
  parish,
  boundary,
  interactionMode,
  onSetInteractionMode,
  onCreatePresetBoundary,
  onClearBoundary,
  onBoundaryComplete,
  onBoundaryUpdate,
  onCancelInteraction,
  onMapAddStop,
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
    if (!map || interactionMode !== 'add_stop') return;

    map.setOptions({ draggableCursor: 'crosshair' });
    const listener = map.addListener(
      'click',
      (ev: google.maps.MapMouseEvent) => {
        if (!ev.latLng) return;
        onMapAddStop({ lat: ev.latLng.lat(), lng: ev.latLng.lng() });
      }
    );

    return () => {
      google.maps.event.removeListener(listener);
      map.setOptions({ draggableCursor: null });
    };
  }, [map, interactionMode, onMapAddStop]);

  if (!parish) return null;

  return (
    <MapControl position={ControlPosition.TOP_CENTER}>
      {interactionMode === 'pan' && (
        <div className="no-print mt-3 mx-3 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl shadow-md p-1.5 flex flex-wrap items-center gap-1 text-xs text-slate-800">
          <button
            type="button"
            onClick={() => onSetInteractionMode('pan')}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Hand className="w-3.5 h-3.5" />
            Przesuwaj
          </button>

          {boundary.length < 3 && (
            <button
              type="button"
              onClick={onCreatePresetBoundary}
              className="px-2.5 py-1.5 rounded-lg hover:bg-amber-50 text-amber-800 font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <CircleDashed className="w-3.5 h-3.5" />
              Szybki obrys 500 m
            </button>
          )}

          <button
            type="button"
            onClick={() => onSetInteractionMode('draw_boundary')}
            className="px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <Pentagon className="w-3.5 h-3.5" />
            {boundary.length >= 3 ? 'Przerysuj teren' : 'Rysuj teren'}
          </button>

          {boundary.length >= 3 && (
            <button
              type="button"
              onClick={onClearBoundary}
              title="Usuń granice terenu"
              className="px-2 py-1.5 rounded-lg hover:bg-red-50 text-slate-500 hover:text-red-600 inline-flex items-center gap-1 whitespace-nowrap transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Usuń obrys
            </button>
          )}

          <span className="h-4 w-px bg-slate-200 mx-0.5 hidden sm:inline-block" />

          <button
            type="button"
            onClick={() => onSetInteractionMode('add_stop')}
            className="px-2.5 py-1.5 rounded-lg hover:bg-amber-50 text-amber-900 font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <MapPinPlus className="w-3.5 h-3.5" />
            Kliknij dom na mapie
          </button>
        </div>
      )}

      {interactionMode === 'draw_boundary' && (
        <div className="no-print mt-3 mx-3 bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm text-slate-900">
          <span className="font-medium text-xs sm:text-sm">
            Klikaj narożniki terenu parafii · Punkty:{' '}
            <span className="font-mono tabular-nums">{draftVertexCount}</span>
            {draftVertexCount >= 3 && (
              <span className="text-slate-500 font-normal">
                {' '}
                (kliknij pierwszy punkt lub dwukliknij, aby zamknąć)
              </span>
            )}
          </span>
          <div className="flex items-center gap-1.5">
            {draftVertexCount > 0 && (
              <button
                type="button"
                onClick={undoLastVertex}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Cofnij
              </button>
            )}
            {draftVertexCount >= 3 && (
              <button
                type="button"
                onClick={finishDraft}
                className="px-3 py-1.5 text-xs font-medium text-white bg-amber-700 hover:bg-amber-800 rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
              >
                <Check className="w-3.5 h-3.5" />
                Zakończ obrys
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                cancelDraft();
                onCancelInteraction();
              }}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
            >
              <X className="w-3.5 h-3.5" />
              Anuluj
            </button>
          </div>
        </div>
      )}

      {interactionMode === 'add_stop' && (
        <div className="no-print mt-3 mx-3 bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-3 text-sm text-slate-900">
          <MapPinPlus className="w-4 h-4 text-amber-700 shrink-0" />
          <span className="font-medium text-xs sm:text-sm">
            Kliknij budynek lub punkt na mapie — zapiszemy go automatycznie jako
            adres domu
          </span>
          <button
            type="button"
            onClick={onCancelInteraction}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
          >
            Zakończ
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
  onSetInteractionMode,
  onCreatePresetBoundary,
  onClearBoundary,
  onBoundaryComplete,
  onBoundaryUpdate,
  onCancelInteraction,
  onMapAddStop,
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
    <div className="relative w-full h-full min-h-[520px] bg-slate-100">
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
          onSetInteractionMode={onSetInteractionMode}
          onCreatePresetBoundary={onCreatePresetBoundary}
          onClearBoundary={onClearBoundary}
          onBoundaryComplete={onBoundaryComplete}
          onBoundaryUpdate={onBoundaryUpdate}
          onCancelInteraction={onCancelInteraction}
          onMapAddStop={onMapAddStop}
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
    </div>
  );
};
