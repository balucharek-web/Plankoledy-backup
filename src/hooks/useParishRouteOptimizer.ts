import { useCallback, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { RoutePolylineEntry } from '../components/ParishMap';
import { orderStopsTsp } from '../services/osmSearchAndRouting';
import {
  DayBreakWindow,
  LatLng,
  PRIEST_PALETTE,
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
  ScheduledStopItem,
  VisitStop,
} from '../types/parish';
import { notifyIfQuotaExceeded } from '../utils/quota';
import {
  MAX_ROUTES_API_INTERMEDIATES,
  isBlockStop,
} from '../utils/spatial';
import {
  advanceStopClockWithBreaks,
  formatAbsMinutesToHHMM,
  getEffectiveStopDurationMinutes,
  parseHHMMToMinutes,
} from '../utils/seasonScheduler';

export function useParishRouteOptimizer() {
  const routesLib = useMapsLibrary('routes');
  const [routes, setRoutes] = useState<PriestRouteResult[]>([]);
  const [routeObjects, setRouteObjects] = useState<RoutePolylineEntry[]>([]);
  const [isComputing, setIsComputing] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearRoutes = useCallback(() => {
    setRoutes([]);
    setRouteObjects([]);
    setError(null);
    setProgressLabel(null);
  }, []);

  const computeAllRoutes = useCallback(
    async (
      parish: ParishCenter,
      stops: VisitStop[],
      config: PlanConfig,
      activeBreaks: DayBreakWindow[] = []
    ) => {
      if (!routesLib) {
        setError('Biblioteka tras Google Maps jeszcze się ładuje.');
        return;
      }

      if (stops.length === 0) {
        clearRoutes();
        return;
      }

      setIsComputing(true);
      setProgressLabel('Przygotowywanie optymalizacji tras Google Maps...');
      setError(null);

      const nextRoutes: PriestRouteResult[] = [];
      const nextRouteObjects: RoutePolylineEntry[] = [];

      const normalizedStops = stops.map((s) =>
        s.priestId > config.priestCount ? { ...s, priestId: 1 } : s
      );

      const activePriestIds = Array.from(
        new Set(normalizedStops.map((s) => s.priestId))
      ).sort((a, b) => a - b);

      const targetPriestIds =
        activePriestIds.length > 0 ? activePriestIds : [1];

      const capacityCap = config.returnToParish
        ? MAX_ROUTES_API_INTERMEDIATES
        : MAX_ROUTES_API_INTERMEDIATES + 1;

      for (let pIdx = 0; pIdx < targetPriestIds.length; pIdx++) {
        const priestId = targetPriestIds[pIdx];
        const priestProfile =
          PRIEST_PALETTE.find((p) => p.id === priestId) ?? PRIEST_PALETTE[0];
        const allPriestStops = normalizedStops.filter(
          (s) => s.priestId === priestId
        );

        if (allPriestStops.length === 0) continue;

        const hasManualOrder = allPriestStops.some(
          (s) =>
            typeof s.manualOrder === 'number' &&
            !Number.isNaN(s.manualOrder) &&
            s.manualOrder > 0
        );
        const orderedManualStops = hasManualOrder
          ? [...allPriestStops].sort(
              (a, b) =>
                (a.manualOrder ?? Number.MAX_SAFE_INTEGER) -
                (b.manualOrder ?? Number.MAX_SAFE_INTEGER)
            )
          : allPriestStops;

        setProgressLabel(
          `Liczenie trasy księdza ${pIdx + 1}/${targetPriestIds.length} (${allPriestStops.length} adresów)...`
        );

        try {
          let orderedVisitSequence: VisitStop[] = [];
          let totalDistanceMeters = 0;
          let totalTravelDurationMillis = 0;
          const combinedLegs: Array<{
            distanceMeters: number;
            durationMillis: number;
          }> = [];

          if (allPriestStops.length <= capacityCap) {
            // Single Routes API call with native waypoint optimization
            let origin: google.maps.LatLngLiteral = parish.location;
            let destination: google.maps.LatLngLiteral = parish.location;
            let intermediateStops: VisitStop[] = [];
            let fixedTailStop: VisitStop | null = null;

            if (config.returnToParish) {
              destination = parish.location;
              intermediateStops = orderedManualStops;
            } else if (orderedManualStops.length === 1) {
              destination = orderedManualStops[0].location;
              fixedTailStop = orderedManualStops[0];
              intermediateStops = [];
            } else if (hasManualOrder) {
              fixedTailStop = orderedManualStops[orderedManualStops.length - 1];
              destination = fixedTailStop.location;
              intermediateStops = orderedManualStops.slice(0, -1);
            } else {
              let farthestIdx = 0;
              let maxDistSq = -1;
              orderedManualStops.forEach((st, idx) => {
                const d =
                  (st.location.lat - parish.location.lat) ** 2 +
                  (st.location.lng - parish.location.lng) ** 2;
                if (d > maxDistSq) {
                  maxDistSq = d;
                  farthestIdx = idx;
                }
              });
              fixedTailStop = orderedManualStops[farthestIdx];
              destination = fixedTailStop.location;
              intermediateStops = orderedManualStops.filter(
                (_, idx) => idx !== farthestIdx
              );
            }

            const shouldOptimize =
              !hasManualOrder && intermediateStops.length >= 2;
            const fields = [
              'path',
              'distanceMeters',
              'durationMillis',
              'viewport',
              'legs',
            ];
            if (shouldOptimize) {
              fields.push('optimizedIntermediateWaypointIndices');
            }

            const request: Record<string, unknown> = {
              origin,
              destination,
              travelMode: config.travelMode,
              language: 'pl',
              region: 'pl',
              fields,
            };

            if (intermediateStops.length > 0) {
              request.intermediates = intermediateStops.map((s) => ({
                location: s.location,
              }));
            }

            if (shouldOptimize) {
              request.optimizeWaypointOrder = true;
            }

            const response = await (routesLib.Route as any).computeRoutes(
              request
            );
            const primaryRoute: google.maps.routes.Route | undefined =
              response?.routes?.[0];

            if (!primaryRoute) {
              nextRoutes.push({
                priestId,
                priestName: priestProfile.name,
                color: priestProfile.color,
                orderedStops: [],
                totalDistanceMeters: 0,
                totalTravelDurationMillis: 0,
                totalVisitMinutes: 0,
                endTime: config.startTime,
                returnLegDistanceMeters: 0,
                returnLegDurationMillis: 0,
                encodedPathPoints: [],
                error: 'Google Maps nie zwróciło trasy dla tych adresów.',
              });
              continue;
            }

            const optIndices =
              primaryRoute.optimizedIntermediateWaypointIndices;
            const orderedIntermediates: VisitStop[] =
              shouldOptimize &&
              optIndices &&
              optIndices.length === intermediateStops.length
                ? optIndices.map((idx) => intermediateStops[idx])
                : intermediateStops;

            orderedVisitSequence = fixedTailStop
              ? [...orderedIntermediates, fixedTailStop]
              : orderedIntermediates;

            totalDistanceMeters = primaryRoute.distanceMeters ?? 0;
            totalTravelDurationMillis = primaryRoute.durationMillis ?? 0;
            for (const leg of primaryRoute.legs ?? []) {
              combinedLegs.push({
                distanceMeters: leg?.distanceMeters ?? 0,
                durationMillis: leg?.durationMillis ?? 0,
              });
            }

            nextRouteObjects.push({
              priestId,
              color: priestProfile.color,
              routeObj: primaryRoute,
            });
          } else {
            // Unlimited stops: keep manual order if set, or optimize via TSP + 2-opt,
            // then request overlapping chunks of <= 25 intermediate points from Routes API.
            orderedVisitSequence = hasManualOrder
              ? orderedManualStops
              : orderStopsTsp(
                  parish.location,
                  allPriestStops,
                  config.returnToParish
                );

            const fullWaypoints: LatLng[] = [
              parish.location,
              ...orderedVisitSequence.map((s) => s.location),
              ...(config.returnToParish ? [parish.location] : []),
            ];

            // Each segment has 1 origin + up to 25 intermediates + 1 destination = up to 27 points
            const maxChunkPoints = MAX_ROUTES_API_INTERMEDIATES + 2;
            const totalChunks = Math.ceil(
              (fullWaypoints.length - 1) / (maxChunkPoints - 1)
            );
            let startIdx = 0;
            let chunkIndex = 0;

            while (startIdx < fullWaypoints.length - 1) {
              chunkIndex += 1;
              setProgressLabel(
                `Liczenie trasy księdza ${pIdx + 1}/${targetPriestIds.length} · odcinek ${chunkIndex}/${totalChunks}...`
              );
              const endIdx = Math.min(
                fullWaypoints.length,
                startIdx + maxChunkPoints
              );
              const chunk = fullWaypoints.slice(startIdx, endIdx);
              const chunkOrigin = chunk[0];
              const chunkDestination = chunk[chunk.length - 1];
              const chunkIntermediates = chunk.slice(1, -1);

              const request: Record<string, unknown> = {
                origin: chunkOrigin,
                destination: chunkDestination,
                travelMode: config.travelMode,
                language: 'pl',
                region: 'pl',
                fields: ['path', 'distanceMeters', 'durationMillis', 'legs'],
              };

              if (chunkIntermediates.length > 0) {
                request.intermediates = chunkIntermediates.map((loc) => ({
                  location: loc,
                }));
              }

              const response = await (routesLib.Route as any).computeRoutes(
                request
              );
              const segRoute: google.maps.routes.Route | undefined =
                response?.routes?.[0];

              if (!segRoute) {
                throw new Error(
                  'Nie udało się wyznaczyć jednego z odcinków trasy.'
                );
              }

              totalDistanceMeters += segRoute.distanceMeters ?? 0;
              totalTravelDurationMillis += segRoute.durationMillis ?? 0;
              for (const leg of segRoute.legs ?? []) {
                combinedLegs.push({
                  distanceMeters: leg?.distanceMeters ?? 0,
                  durationMillis: leg?.durationMillis ?? 0,
                });
              }

              nextRouteObjects.push({
                priestId,
                color: priestProfile.color,
                routeObj: segRoute,
              });

              if (endIdx >= fullWaypoints.length) break;
              startIdx = endIdx - 1;
            }
          }

          let cursorAbs = parseHHMMToMinutes(config.startTime, 930);
          let totalVisitMinutes = 0;

          const scheduledItems: ScheduledStopItem[] = orderedVisitSequence.map(
            (stop, idx) => {
              const leg = combinedLegs[idx];
              const legDist = leg?.distanceMeters ?? 0;
              const legDurMs = leg?.durationMillis ?? 0;
              const legMins = Math.round(legDurMs / 60000);
              const stopDuration = getEffectiveStopDurationMinutes(
                stop,
                config.defaultVisitMinutes
              );

              const timing = advanceStopClockWithBreaks(
                cursorAbs,
                legMins,
                stopDuration,
                isBlockStop(stop),
                activeBreaks
              );
              cursorAbs = timing.endCursorAbs;
              totalVisitMinutes += stopDuration;

              return {
                stop,
                orderIndex: idx + 1,
                arrivalTime: formatAbsMinutesToHHMM(timing.arrivalAbs),
                departureTime: formatAbsMinutesToHHMM(timing.departureAbs),
                legDistanceMeters: legDist,
                legDurationMillis: legDurMs,
              };
            }
          );

          let returnLegDistanceMeters = 0;
          let returnLegDurationMillis = 0;
          if (
            config.returnToParish &&
            combinedLegs.length > orderedVisitSequence.length
          ) {
            const returnLeg = combinedLegs[orderedVisitSequence.length];
            returnLegDistanceMeters = returnLeg?.distanceMeters ?? 0;
            returnLegDurationMillis = returnLeg?.durationMillis ?? 0;
            cursorAbs += Math.round(returnLegDurationMillis / 60000);
          }

          const endTime = formatAbsMinutesToHHMM(cursorAbs);

          nextRoutes.push({
            priestId,
            priestName: priestProfile.name,
            color: priestProfile.color,
            orderedStops: scheduledItems,
            totalDistanceMeters,
            totalTravelDurationMillis,
            totalVisitMinutes,
            endTime,
            returnLegDistanceMeters,
            returnLegDurationMillis,
            encodedPathPoints: [],
          });
        } catch (err) {
          const isQuota = notifyIfQuotaExceeded(err);
          const msg = isQuota
            ? 'Przekroczono limit zapytań Google Maps Platform.'
            : err instanceof Error
              ? err.message
              : 'Nie udało się wyznaczyć trasy.';
          nextRoutes.push({
            priestId,
            priestName: priestProfile.name,
            color: priestProfile.color,
            orderedStops: [],
            totalDistanceMeters: 0,
            totalTravelDurationMillis: 0,
            totalVisitMinutes: 0,
            endTime: config.startTime,
            returnLegDistanceMeters: 0,
            returnLegDurationMillis: 0,
            encodedPathPoints: [],
            error: msg,
          });
        }
      }

      setRoutes(nextRoutes);
      setRouteObjects(nextRouteObjects);
      setIsComputing(false);
      setProgressLabel(null);
      return {
        routes: nextRoutes,
        routeObjects: nextRouteObjects,
      };
    },
    [routesLib, clearRoutes]
  );

  return {
    routes,
    routeObjects,
    isComputing,
    progressLabel,
    error,
    computeAllRoutes,
    clearRoutes,
  };
}
