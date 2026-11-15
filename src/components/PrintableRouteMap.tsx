import React, { useEffect, useMemo, useState } from 'react';
import {
  LatLng,
  ParishCenter,
  PriestRouteResult,
} from '../types/parish';
import { extractStreetName } from '../utils/spatial';

interface PrintableRouteMapProps {
  parish: ParishCenter | null;
  boundary?: LatLng[];
  routes: PriestRouteResult[];
  isExactRoute?: boolean;
  title?: string;
}

const VIEW_W = 800;
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

interface PositionedMarker {
  item: PriestRouteResult['orderedStops'][number];
  trueX: number;
  trueY: number;
  x: number;
  y: number;
  isFirst: boolean;
  isLast: boolean;
  isBlock: boolean;
}

/**
 * Gently separates markers that sit very close together on dense streets
 * so stop numbers remain legible on paper printouts without hiding true house positions.
 */
function separateDenseMarkers(
  raw: PositionedMarker[],
  viewW: number,
  viewH: number
): PositionedMarker[] {
  const pts = raw.map((m) => ({ ...m }));
  const n = pts.length;
  if (n <= 1) return pts;

  const minDist = 23;
  const maxAnchorShift = 28;
  const marginX = 24;
  const marginTop = 34;
  const marginBottom = 26;

  for (let iter = 0; iter < 32; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pts[j].x - pts[i].x;
        const dy = pts[j].y - pts[i].y;
        let dist = Math.hypot(dx, dy);
        if (dist < minDist) {
          if (dist < 0.01) {
            // Deterministic micro-offset when coordinates coincide
            const angle = ((i + j) % 8) * (Math.PI / 4);
            pts[i].x -= Math.cos(angle) * 2;
            pts[i].y -= Math.sin(angle) * 2;
            pts[j].x += Math.cos(angle) * 2;
            pts[j].y += Math.sin(angle) * 2;
            dist = 4;
          }
          const ux = (pts[j].x - pts[i].x) / dist;
          const uy = (pts[j].y - pts[i].y) / dist;
          const push = (minDist - dist) * 0.42;
          pts[i].x -= ux * push;
          pts[i].y -= uy * push;
          pts[j].x += ux * push;
          pts[j].y += uy * push;
        }
      }
    }

    // Softly tether to true house location & keep inside safe SVG bounds
    for (let i = 0; i < n; i++) {
      const m = pts[i];
      m.x += (m.trueX - m.x) * 0.08;
      m.y += (m.trueY - m.y) * 0.08;

      const offX = m.x - m.trueX;
      const offY = m.y - m.trueY;
      const offLen = Math.hypot(offX, offY);
      if (offLen > maxAnchorShift) {
        m.x = m.trueX + (offX / offLen) * maxAnchorShift;
        m.y = m.trueY + (offY / offLen) * maxAnchorShift;
      }

      m.x = Math.max(marginX, Math.min(viewW - marginX, m.x));
      m.y = Math.max(marginTop, Math.min(viewH - marginBottom, m.y));
    }
  }

  return pts;
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

    // Fit tightly ONLY around actual scheduled stops (and road path points if close)
    // so street outlines and house numbers fill ~80% of the A4 map.
    const fitPoints: LatLng[] =
      stopPoints.length > 0 ? [...stopPoints] : parish ? [parish.location] : [];

    // Measure geographic span at reference zoom 16 to pick optimal A4 map aspect ratio
    const refZoom = 16;
    let refMinX = Number.POSITIVE_INFINITY;
    let refMaxX = Number.NEGATIVE_INFINITY;
    let refMinY = Number.POSITIVE_INFINITY;
    let refMaxY = Number.NEGATIVE_INFINITY;

    for (const pt of fitPoints) {
      const p = projectToWorldPx(pt, refZoom);
      if (p.x < refMinX) refMinX = p.x;
      if (p.x > refMaxX) refMaxX = p.x;
      if (p.y < refMinY) refMinY = p.y;
      if (p.y > refMaxY) refMaxY = p.y;
    }

    const refSpanX = Math.max(12, refMaxX - refMinX);
    const refSpanY = Math.max(12, refMaxY - refMinY);
    const geoRatio = refSpanY / refSpanX;

    // Adaptive height for A4 portrait: tall streets get up to 840px height, wide streets ~580px
    const viewW = VIEW_W;
    const viewH =
      fitPoints.length <= 1
        ? 560
        : Math.round(Math.max(580, Math.min(840, viewW * Math.max(0.72, Math.min(1.05, geoRatio * 1.05)))));

    // Continuous zoom calculation so the route spans ~78% of the map viewport
    const usableW = viewW * 0.78;
    const usableH = viewH * 0.76;
    const idealScaleFactorFromRef =
      fitPoints.length <= 1
        ? 2.0 // Zoom 17 equivalent
        : Math.min(usableW / refSpanX, usableH / refSpanY);

    const exactZoom = Math.max(
      13.5,
      Math.min(18.0, refZoom + Math.log2(idealScaleFactorFromRef))
    );

    // Prefer zoom 17/18 raster tiles for sharp house footprints and street names
    const tileZoom = Math.max(14, Math.min(18, Math.round(exactZoom)));
    const scaleRatio = Math.pow(2, exactZoom - tileZoom);

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const pt of fitPoints) {
      const p = projectToWorldPx(pt, tileZoom);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const centerWorldX = (minX + maxX) / 2;
    const centerWorldY = (minY + maxY) / 2;
    const worldViewW = viewW / scaleRatio;
    const worldViewH = viewH / scaleRatio;
    const originX = centerWorldX - worldViewW / 2;
    const originY = centerWorldY - worldViewH / 2;

    const toView = (pt: LatLng) => {
      const wp = projectToWorldPx(pt, tileZoom);
      return {
        x: (wp.x - originX) * scaleRatio,
        y: (wp.y - originY) * scaleRatio,
      };
    };

    const maxTile = Math.pow(2, tileZoom);
    const minTx = Math.floor(originX / TILE_SIZE);
    const maxTx = Math.floor((originX + worldViewW) / TILE_SIZE);
    const minTy = Math.floor(originY / TILE_SIZE);
    const maxTy = Math.floor((originY + worldViewH) / TILE_SIZE);

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
        const osmSub = ['a', 'b', 'c'][Math.abs(tx + ty) % 3];
        const leftPx = (tx * TILE_SIZE - originX) * scaleRatio;
        const topPx = (ty * TILE_SIZE - originY) * scaleRatio;
        const tileScaledPx = TILE_SIZE * scaleRatio;
        tiles.push({
          key: `${tileZoom}_${tx}_${ty}`,
          primaryUrl: `https://${osmSub}.tile.openstreetmap.org/${tileZoom}/${wrappedTx}/${ty}.png`,
          fallbackUrl: `https://tile.openstreetmap.org/${tileZoom}/${wrappedTx}/${ty}.png`,
          leftPct: (leftPx / viewW) * 100,
          topPct: (topPx / viewH) * 100,
          widthPct: (tileScaledPx / viewW) * 100,
          heightPct: (tileScaledPx / viewH) * 100,
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
        parishPos.x >= 16 &&
        parishPos.x <= viewW - 16 &&
        parishPos.y >= 16 &&
        parishPos.y <= viewH - 16
    );

    const projectedRoutes = activeRoutes.map((route) => {
      const pathPts =
        route.encodedPathPoints.length >= 2
          ? route.encodedPathPoints
          : [
              ...(parish && parishInView ? [parish.location] : []),
              ...route.orderedStops.map((s) => s.stop.location),
            ];
      const viewPathPts = pathPts.map(toView);
      const polylineStr = viewPathPts
        .map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`)
        .join(' ');

      const arrows: Array<{ x: number; y: number; angleDeg: number }> = [];
      let accumDist = 0;
      for (let i = 1; i < viewPathPts.length; i++) {
        const a = viewPathPts[i - 1];
        const b = viewPathPts[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segLen = Math.hypot(dx, dy);
        accumDist += segLen;
        if (segLen >= 30 && accumDist >= 64) {
          accumDist = 0;
          arrows.push({
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
          });
        }
      }

      const rawMarkers: PositionedMarker[] = route.orderedStops.map(
        (item, idx) => {
          const v = toView(item.stop.location);
          const isFirst = idx === 0;
          const isLast = idx === route.orderedStops.length - 1;
          const isBlock = Boolean(
            item.stop.isMultiUnit ||
              (item.stop.units && item.stop.units.length > 0)
          );
          return {
            item,
            trueX: v.x,
            trueY: v.y,
            x: v.x,
            y: v.y,
            isFirst,
            isLast,
            isBlock,
          };
        }
      );

      const markers = separateDenseMarkers(rawMarkers, viewW, viewH);

      const firstStop = route.orderedStops[0]?.stop;
      const lastStop =
        route.orderedStops[route.orderedStops.length - 1]?.stop;
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
        lastStopAddress: lastStop ? lastStop.address || lastStop.label : '',
        streets,
      };
    });

    return {
      viewW,
      viewH,
      tileZoom,
      tiles,
      boundaryPointsStr,
      parishPos,
      parishInView,
      projectedRoutes,
    };
  }, [activeRoutes, boundary, parish]);

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
    <div className="w-full max-w-full bg-white border border-slate-200 rounded-xl overflow-hidden print:rounded-lg print:border-slate-300 print-break-avoid">
      <div className="px-4 py-2 border-b border-slate-200 bg-slate-50/80 flex flex-wrap items-center justify-between gap-2 print:py-1.5 print:px-3">
        <div className="text-xs font-bold text-slate-900">
          {title || 'Mapa trasy kolędy (START i kolejne domy)'}
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

      {/* High-Resolution Vector + OSM Tile Viewport sized for A4 readability */}
      <div className="relative w-full overflow-hidden bg-slate-50">
        <div
          aria-hidden="true"
          className="absolute inset-0 z-0 opacity-30"
          style={{
            backgroundImage:
              'linear-gradient(to right, #CBD5E1 1px, transparent 1px), linear-gradient(to bottom, #CBD5E1 1px, transparent 1px)',
            backgroundSize: '36px 36px',
          }}
        />

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
                  opacity: 0.9,
                  filter: 'contrast(1.06) brightness(1.02)',
                }}
              />
            );
          })}
        </div>

        <svg
          viewBox={`0 0 ${mapData.viewW} ${mapData.viewH}`}
          className="relative z-10 block w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
        >
          {mapData.boundaryPointsStr && (
            <polygon
              points={mapData.boundaryPointsStr}
              fill="rgba(245, 158, 11, 0.04)"
              stroke="#B45309"
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
          )}

          {/* Route path lines + direction arrows */}
          {mapData.projectedRoutes.map(({ route, polylineStr, arrows }) => (
            <g key={`path-${route.priestId}`}>
              <polyline
                points={polylineStr}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.94"
              />
              <polyline
                points={polylineStr}
                fill="none"
                stroke={route.color}
                strokeWidth="3.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={isExactRoute ? undefined : '8 5'}
                opacity="0.96"
              />
              {arrows.map((arr, aIdx) => (
                <g
                  key={`arr-${route.priestId}-${aIdx}`}
                  transform={`translate(${arr.x.toFixed(1)}, ${arr.y.toFixed(1)}) rotate(${arr.angleDeg.toFixed(1)})`}
                >
                  <polygon
                    points="-4.5,-4 6,0 -4.5,4"
                    fill={route.color}
                    stroke="#FFFFFF"
                    strokeWidth="1.2"
                  />
                </g>
              ))}
            </g>
          ))}

          {/* Parish Church Anchor (shown only if naturally inside the route viewport) */}
          {mapData.parishPos && mapData.parishInView && (
            <g
              transform={`translate(${mapData.parishPos.x.toFixed(1)}, ${mapData.parishPos.y.toFixed(1)})`}
            >
              <circle
                r="13"
                fill="#B45309"
                stroke="#FEF3C7"
                strokeWidth="2.5"
              />
              <text
                x="0"
                y="4.5"
                textAnchor="middle"
                fill="#FEF3C7"
                fontSize="13"
                fontWeight="700"
              >
                ✝
              </text>
            </g>
          )}

          {/* Subtle leader lines for nudged dense markers */}
          {mapData.projectedRoutes.map(({ route, markers }) =>
            markers.map(({ item, trueX, trueY, x, y, isFirst }) => {
              const distMoved = Math.hypot(x - trueX, y - trueY);
              if (distMoved <= 4.5) return null;
              const col = isFirst ? '#15803D' : route.color;
              return (
                <g key={`tether-${item.stop.id}`}>
                  <line
                    x1={trueX.toFixed(1)}
                    y1={trueY.toFixed(1)}
                    x2={x.toFixed(1)}
                    y2={y.toFixed(1)}
                    stroke="#FFFFFF"
                    strokeWidth="2.8"
                  />
                  <line
                    x1={trueX.toFixed(1)}
                    y1={trueY.toFixed(1)}
                    x2={x.toFixed(1)}
                    y2={y.toFixed(1)}
                    stroke={col}
                    strokeWidth="1.3"
                  />
                  <circle
                    cx={trueX.toFixed(1)}
                    cy={trueY.toFixed(1)}
                    r="2.8"
                    fill={col}
                    stroke="#FFFFFF"
                    strokeWidth="1"
                  />
                </g>
              );
            })
          )}

          {/* Stop Markers (drawn in reverse so #1 START sits cleanly on top) */}
          {mapData.projectedRoutes.map(({ route, markers }) =>
            [...markers]
              .reverse()
              .map(({ item, x, y, isFirst, isLast, isBlock }) => {
                const fill = isFirst ? '#15803D' : route.color;
                const r = isFirst ? 12 : 9.8;
                const fontSize =
                  item.orderIndex >= 100 ? 7.5 : item.orderIndex >= 10 ? 8.5 : 9.5;
                const labelStr = String(item.orderIndex);

                return (
                  <g
                    key={item.stop.id}
                    transform={`translate(${x.toFixed(1)}, ${y.toFixed(1)})`}
                  >
                    {isFirst && (
                      <g transform="translate(0, -19)">
                        <rect
                          x="-21"
                          y="-10.5"
                          width="42"
                          height="14.5"
                          rx="4"
                          fill="#15803D"
                          stroke="#FFFFFF"
                          strokeWidth="1.6"
                        />
                        <text
                          x="0"
                          y="-0.2"
                          textAnchor="middle"
                          fill="#FFFFFF"
                          fontSize="9"
                          fontWeight="800"
                          fontFamily="system-ui, sans-serif"
                        >
                          START
                        </text>
                      </g>
                    )}

                    {isLast && !isFirst && markers.length > 2 && (
                      <g transform="translate(0, 18)">
                        <rect
                          x="-22"
                          y="-6"
                          width="44"
                          height="13.5"
                          rx="3.5"
                          fill="#0F172A"
                          stroke="#FFFFFF"
                          strokeWidth="1.4"
                        />
                        <text
                          x="0"
                          y="3.6"
                          textAnchor="middle"
                          fill="#FFFFFF"
                          fontSize="8"
                          fontWeight="800"
                          fontFamily="system-ui, sans-serif"
                        >
                          KONIEC
                        </text>
                      </g>
                    )}

                    {isBlock ? (
                      <rect
                        x={-r}
                        y={-r}
                        width={r * 2}
                        height={r * 2}
                        rx="4.5"
                        fill={fill}
                        stroke="#FFFFFF"
                        strokeWidth={isFirst ? 2.6 : 1.8}
                      />
                    ) : (
                      <circle
                        r={r}
                        fill={fill}
                        stroke="#FFFFFF"
                        strokeWidth={isFirst ? 2.6 : 1.8}
                      />
                    )}

                    <text
                      x="0"
                      y="3.3"
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize={fontSize}
                      fontWeight="800"
                      fontFamily="ui-monospace, monospace"
                    >
                      {labelStr}
                    </text>
                  </g>
                );
              })
          )}
        </svg>

        <div className="absolute bottom-1.5 right-2 z-20 px-1.5 py-0.5 bg-white/90 rounded text-[9px] text-slate-600">
          © OpenStreetMap
        </div>
      </div>

      {/* Clear Start, End & Streets Footer */}
      <div className="px-4 py-2 border-t border-slate-200 bg-slate-50/60 space-y-1 text-xs print:px-3 print:py-1.5">
        {mapData.projectedRoutes.map(
          ({ route, firstStopAddress, lastStopAddress, streets }) => (
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
              {route.orderedStops.length > 1 && lastStopAddress && (
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                  <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white text-[10px] font-bold">
                    KONIEC
                  </span>
                  <span>{lastStopAddress}</span>
                </span>
              )}
              <span className="text-slate-600">
                Ulice: <strong className="text-slate-900">{streets.join(', ')}</strong>
              </span>
            </div>
          )
        )}
      </div>
    </div>
  );
};
