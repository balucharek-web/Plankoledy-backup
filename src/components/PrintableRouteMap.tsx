import React, { useEffect, useMemo, useState } from 'react';
import {
  LatLng,
  ParishCenter,
  PriestRouteResult,
} from '../types/parish';
import { extractHouseNumberLabel, extractStreetName } from '../utils/spatial';

interface PrintableRouteMapProps {
  parish: ParishCenter | null;
  boundary?: LatLng[];
  routes: PriestRouteResult[];
  isExactRoute?: boolean;
  title?: string;
}

const VIEW_W = 860;
const VIEW_H = 380;
const TILE_SIZE = 256;

function projectToWorldPx(pt: LatLng, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const sinLat = Math.sin((pt.lat * Math.PI) / 180);
  const clamped = Math.max(-0.9999, Math.min(0.9999, sinLat));
  const x = ((pt.lng + 180) / 360) * scale;
  const y =
    (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function chooseBestZoom(
  points: LatLng[],
  width: number,
  height: number
): { zoom: number; centerX: number; centerY: number } {
  const padX = width * 0.82;
  const padY = height * 0.76;

  for (let z = 18; z >= 12; z--) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const pt of points) {
      const p = projectToWorldPx(pt, z);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const spanX = maxX - minX;
    const spanY = maxY - minY;
    if ((spanX <= padX && spanY <= padY) || z === 12) {
      return {
        zoom: z,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
      };
    }
  }

  const fallback = projectToWorldPx(points[0], 15);
  return { zoom: 15, centerX: fallback.x, centerY: fallback.y };
}

export const PrintableRouteMap: React.FC<PrintableRouteMapProps> = ({
  parish,
  boundary = [],
  routes,
  isExactRoute = false,
  title,
}) => {
  const [fallbackTiles, setFallbackTiles] = useState<Record<string, boolean>>(
    {}
  );

  const activeRoutes = useMemo(
    () => routes.filter((r) => r.orderedStops.length > 0),
    [routes]
  );

  const mapData = useMemo(() => {
    const stopPoints: LatLng[] = [];
    for (const r of activeRoutes) {
      for (const item of r.orderedStops) {
        stopPoints.push(item.stop.location);
      }
    }

    if (stopPoints.length === 0 && !parish) return null;

    // Fit tightly around the route stops first so street layout and numbers are legible;
    // include church anchor when it is reasonably close.
    const fitPoints: LatLng[] =
      stopPoints.length > 0 ? [...stopPoints] : parish ? [parish.location] : [];

    if (parish && stopPoints.length > 0) {
      const stopsZoom = chooseBestZoom(stopPoints, VIEW_W, VIEW_H).zoom;
      const withChurch = chooseBestZoom(
        [...stopPoints, parish.location],
        VIEW_W,
        VIEW_H
      );
      if (withChurch.zoom >= stopsZoom - 1) {
        fitPoints.push(parish.location);
      }
    }

    const { zoom, centerX, centerY } = chooseBestZoom(
      fitPoints,
      VIEW_W,
      VIEW_H
    );

    const originX = centerX - VIEW_W / 2;
    const originY = centerY - VIEW_H / 2;

    const toView = (pt: LatLng) => {
      const wp = projectToWorldPx(pt, zoom);
      return { x: wp.x - originX, y: wp.y - originY };
    };

    const maxTile = Math.pow(2, zoom);
    const minTx = Math.floor(originX / TILE_SIZE);
    const maxTx = Math.floor((originX + VIEW_W) / TILE_SIZE);
    const minTy = Math.floor(originY / TILE_SIZE);
    const maxTy = Math.floor((originY + VIEW_H) / TILE_SIZE);

    const tiles: Array<{
      key: string;
      primaryUrl: string;
      fallbackUrl: string;
      leftPct: number;
      topPct: number;
      widthPct: number;
      heightPct: number;
    }> = [];

    for (let ty = minTy; ty <= maxTy; ty++) {
      if (ty < 0 || ty >= maxTile) continue;
      for (let tx = minTx; tx <= maxTx; tx++) {
        const wrappedTx = ((tx % maxTile) + maxTile) % maxTile;
        const leftPx = tx * TILE_SIZE - originX;
        const topPx = ty * TILE_SIZE - originY;
        tiles.push({
          key: `${zoom}_${tx}_${ty}`,
          primaryUrl: `https://basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${wrappedTx}/${ty}.png`,
          fallbackUrl: `https://tile.openstreetmap.org/${zoom}/${wrappedTx}/${ty}.png`,
          leftPct: (leftPx / VIEW_W) * 100,
          topPct: (topPx / VIEW_H) * 100,
          widthPct: (TILE_SIZE / VIEW_W) * 100,
          heightPct: (TILE_SIZE / VIEW_H) * 100,
        });
      }
    }

    const boundaryPointsStr =
      boundary.length >= 3
        ? boundary
            .map((pt) => {
              const v = toView(pt);
              return `${v.x.toFixed(1)},${v.y.toFixed(1)}`;
            })
            .join(' ')
        : '';

    const parishPos = parish ? toView(parish.location) : null;
    const parishInView = Boolean(
      parishPos &&
        parishPos.x >= 12 &&
        parishPos.x <= VIEW_W - 12 &&
        parishPos.y >= 12 &&
        parishPos.y <= VIEW_H - 12
    );

    const projectedRoutes = activeRoutes.map((route) => {
      const pathPts =
        route.encodedPathPoints.length >= 2
          ? route.encodedPathPoints
          : [
              ...(parish ? [parish.location] : []),
              ...route.orderedStops.map((s) => s.stop.location),
            ];
      const viewPathPts = pathPts.map(toView);
      const polylineStr = viewPathPts
        .map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`)
        .join(' ');

      // Build subtle directional chevrons along the route so print shows walking direction
      const arrows: Array<{ x: number; y: number; angleDeg: number }> = [];
      let accumDist = 0;
      for (let i = 1; i < viewPathPts.length; i++) {
        const a = viewPathPts[i - 1];
        const b = viewPathPts[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segLen = Math.hypot(dx, dy);
        accumDist += segLen;
        if (segLen >= 34 && accumDist >= 65) {
          accumDist = 0;
          arrows.push({
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
          });
        }
      }

      const markers = route.orderedStops.map((item, idx) => {
        const v = toView(item.stop.location);
        const isFirst = idx === 0;
        const isLast = idx === route.orderedStops.length - 1;
        const isBlock = Boolean(
          item.stop.isMultiUnit ||
            (item.stop.units && item.stop.units.length > 0)
        );
        return {
          item,
          x: v.x,
          y: v.y,
          isFirst,
          isLast,
          isBlock,
          houseNum: extractHouseNumberLabel(item.stop),
        };
      });

      const firstStop = route.orderedStops[0]?.stop;
      const streets = Array.from(
        new Set(route.orderedStops.map((s) => extractStreetName(s.stop)))
      );

      return {
        route,
        polylineStr,
        arrows,
        markers,
        firstStopAddress: firstStop
          ? firstStop.address || firstStop.label
          : '',
        streets,
      };
    });

    return {
      zoom,
      tiles,
      boundaryPointsStr,
      parishPos,
      parishInView,
      projectedRoutes,
    };
  }, [activeRoutes, boundary, parish]);

  // Preload raster map tiles into browser cache even when rendered offscreen before window.print()
  useEffect(() => {
    if (!mapData) return;
    mapData.tiles.forEach((tile) => {
      const img = new window.Image();
      img.decoding = 'sync';
      img.src = tile.primaryUrl;
    });
  }, [mapData]);

  if (!mapData || activeRoutes.length === 0) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden print:border-slate-300 print-break-avoid">
      <div className="px-4 py-2 border-b border-slate-200 bg-slate-50/80 flex flex-wrap items-center justify-between gap-2 print:py-1.5 print:px-3">
        <div className="text-xs font-bold text-slate-900">
          {title || 'Mapa trasy kolędy (START i wszystkie punkty do odwiedzenia)'}
        </div>
        <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-700 border border-white shadow-xs" />
            <span>Punkt START</span>
          </span>
          {mapData.projectedRoutes.map(({ route }) => (
            <span
              key={route.priestId}
              className="inline-flex items-center gap-1 font-medium text-slate-800 whitespace-nowrap"
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: route.color }}
              />
              <span>
                {route.priestName} ({route.orderedStops.length})
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Map Viewport — explicit intrinsic SVG dimensions guarantee height in all print engines */}
      <div className="relative w-full overflow-hidden bg-slate-50">
        {/* Subtle fallback grid if offline or tiles blocked */}
        <div
          aria-hidden="true"
          className="absolute inset-0 z-0 opacity-35"
          style={{
            backgroundImage:
              'linear-gradient(to right, #CBD5E1 1px, transparent 1px), linear-gradient(to bottom, #CBD5E1 1px, transparent 1px)',
            backgroundSize: '36px 36px',
          }}
        />

        {/* Raster street map tiles aligned to exact Web-Mercator viewport */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          {mapData.tiles.map((tile) => {
            const useFallback = Boolean(fallbackTiles[tile.key]);
            return (
              <img
                key={tile.key}
                data-print-map-tile="true"
                src={useFallback ? tile.fallbackUrl : tile.primaryUrl}
                alt=""
                aria-hidden="true"
                loading="eager"
                decoding="sync"
                onError={(e) => {
                  if (!useFallback) {
                    setFallbackTiles((prev) => ({
                      ...prev,
                      [tile.key]: true,
                    }));
                  } else {
                    e.currentTarget.style.display = 'none';
                  }
                }}
                style={{
                  position: 'absolute',
                  left: `${tile.leftPct}%`,
                  top: `${tile.topPct}%`,
                  width: `${tile.widthPct}%`,
                  height: `${tile.heightPct}%`,
                  maxWidth: 'none',
                  maxHeight: 'none',
                  opacity: 0.92,
                }}
              />
            );
          })}
        </div>

        {/* Crisp Vector Route & Numbered Points Overlay */}
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="relative z-10 block w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Subtle parish boundary */}
          {mapData.boundaryPointsStr && (
            <polygon
              points={mapData.boundaryPointsStr}
              fill="rgba(245, 158, 11, 0.06)"
              stroke="#B45309"
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
          )}

          {/* White halo under routes + colored path lines + direction chevrons */}
          {mapData.projectedRoutes.map(({ route, polylineStr, arrows }) => (
            <g key={`path-${route.priestId}`}>
              <polyline
                points={polylineStr}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.92"
              />
              <polyline
                points={polylineStr}
                fill="none"
                stroke={route.color}
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={isExactRoute ? undefined : '7 5'}
                opacity="0.95"
              />
              {arrows.map((arr, aIdx) => (
                <g
                  key={`arr-${route.priestId}-${aIdx}`}
                  transform={`translate(${arr.x.toFixed(1)}, ${arr.y.toFixed(1)}) rotate(${arr.angleDeg.toFixed(1)})`}
                >
                  <polygon
                    points="-4,-3.5 5,0 -4,3.5"
                    fill={route.color}
                    stroke="#FFFFFF"
                    strokeWidth="1"
                  />
                </g>
              ))}
            </g>
          ))}

          {/* Parish Church Anchor */}
          {mapData.parishPos && mapData.parishInView && (
            <g
              transform={`translate(${mapData.parishPos.x.toFixed(1)}, ${mapData.parishPos.y.toFixed(1)})`}
            >
              <circle
                r="12"
                fill="#B45309"
                stroke="#FEF3C7"
                strokeWidth="2.5"
              />
              <text
                x="0"
                y="4.2"
                textAnchor="middle"
                fill="#FEF3C7"
                fontSize="12"
                fontWeight="700"
              >
                ✝
              </text>
            </g>
          )}

          {/* Every Single House Point (drawn highest-index first so #1 / START sits cleanly on top) */}
          {mapData.projectedRoutes.map(({ route, markers }) =>
            [...markers].reverse().map(({ item, x, y, isFirst, isBlock }) => {
              const fill = isFirst ? '#15803D' : route.color;
              const r = isFirst ? 11.5 : 9;
              const fontSize =
                item.orderIndex >= 100 ? 7 : item.orderIndex >= 10 ? 8 : 9;
              const labelStr = String(item.orderIndex);

              return (
                <g
                  key={item.stop.id}
                  transform={`translate(${x.toFixed(1)}, ${y.toFixed(1)})`}
                >
                  {isFirst && (
                    <g transform="translate(0, -18)">
                      <rect
                        x="-20"
                        y="-10"
                        width="40"
                        height="14"
                        rx="4"
                        fill="#15803D"
                        stroke="#FFFFFF"
                        strokeWidth="1.5"
                      />
                      <text
                        x="0"
                        y="0"
                        textAnchor="middle"
                        fill="#FFFFFF"
                        fontSize="8.5"
                        fontWeight="800"
                        fontFamily="system-ui, sans-serif"
                      >
                        START
                      </text>
                    </g>
                  )}

                  {isBlock ? (
                    <rect
                      x={-r}
                      y={-r}
                      width={r * 2}
                      height={r * 2}
                      rx="4"
                      fill={fill}
                      stroke="#FFFFFF"
                      strokeWidth={isFirst ? 2.5 : 1.6}
                    />
                  ) : (
                    <circle
                      r={r}
                      fill={fill}
                      stroke="#FFFFFF"
                      strokeWidth={isFirst ? 2.5 : 1.6}
                    />
                  )}

                  <text
                    x="0"
                    y="3"
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize={fontSize}
                    fontWeight="700"
                    fontFamily="ui-monospace, monospace"
                  >
                    {labelStr}
                  </text>
                </g>
              );
            })
          )}
        </svg>

        {/* Map attribution */}
        <div className="absolute bottom-1.5 right-2 z-20 px-1.5 py-0.5 bg-white/90 rounded text-[9px] text-slate-600">
          © OpenStreetMap / CARTO
        </div>
      </div>

      {/* Clear Street & Start Point Legend Footer */}
      <div className="px-4 py-2 border-t border-slate-200 bg-slate-50/60 space-y-1 text-xs print:px-3 print:py-1.5">
        {mapData.projectedRoutes.map(({ route, firstStopAddress, streets }) => (
          <div
            key={`legend-${route.priestId}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700"
          >
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
              <span className="px-1.5 py-0.5 rounded bg-emerald-700 text-white text-[10px] font-bold">
                START
              </span>
              <span>{firstStopAddress}</span>
            </span>
            <span className="text-slate-600">
              Ulice: <strong className="text-slate-900">{streets.join(', ')}</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
