import { useCallback, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { RoutePolylineEntry } from '../components/ParishMap';
import {
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
  addMinutesToHHMM,
} from '../utils/spatial';

export function useParishRouteOptimizer() {
  const routesLib = useMapsLibrary('routes');
  const [routes, setRoutes] = useState<PriestRouteResult[]>([]);
  const [routeObjects, setRouteObjects] = useState<RoutePolylineEntry[]>([]);
  const [isComputing, setIsComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearRoutes = useCallback(() => {
    setRoutes([]);
    setRouteObjects([]);
    setError(null);
  }, []);

  const computeAllRoutes = useCallback(
    async (parish: ParishCenter, stops: VisitStop[], config: PlanConfig) => {
      if (!routesLib) {
        setError('Biblioteka tras Google Maps jeszcze się ładuje.');
        return;
      }

      if (stops.length === 0) {
        clearRoutes();
        return;
      }

      setIsComputing(true);
      setError(null);

      const nextRoutes: PriestRouteResult[] = [];
      const nextRouteObjects: RoutePolylineEntry[] = [];

      const activePriestIds = Array.from(
        new Set(
          stops
            .map((s) => s.priestId)
            .filter((id) => id >= 1 && id <= config.priestCount)
        )
      ).sort((a, b) => a - b);

      // Include any stops assigned to higher priest IDs under priest 1 fallback if priestCount was lowered
      const normalizedStops = stops.map((s) =>
        s.priestId > config.priestCount ? { ...s, priestId: 1 } : s
      );

      const targetPriestIds =
        activePriestIds.length > 0
          ? Array.from(
              new Set(normalizedStops.map((s) => s.priestId))
            ).sort((a, b) => a - b)
          : [1];

      for (const priestId of targetPriestIds) {
        const priestProfile =
          PRIEST_PALETTE.find((p) => p.id === priestId) ?? PRIEST_PALETTE[0];
        const allPriestStops = normalizedStops.filter(
          (s) => s.priestId === priestId
        );

        if (allPriestStops.length === 0) continue;

        // Routes API allows up to 25 intermediate waypoints per request
        const capacityCap = config.returnToParish
          ? MAX_ROUTES_API_INTERMEDIATES
          : MAX_ROUTES_API_INTERMEDIATES + 1;
        const priestStops = allPriestStops.slice(0, capacityCap);
        const truncatedCount = allPriestStops.length - priestStops.length;

        try {
          let origin: google.maps.LatLngLiteral = parish.location;
          let destination: google.maps.LatLngLiteral = parish.location;
          let intermediateStops: VisitStop[] = [];
          let fixedTailStop: VisitStop | null = null;

          if (config.returnToParish) {
            destination = parish.location;
            intermediateStops = priestStops;
          } else if (priestStops.length === 1) {
            destination = priestStops[0].location;
            fixedTailStop = priestStops[0];
            intermediateStops = [];
          } else {
            // Pick farthest stop from parish as natural end of open-ended route
            let farthestIdx = 0;
            let maxDistSq = -1;
            priestStops.forEach((st, idx) => {
              const d =
                (st.location.lat - parish.location.lat) ** 2 +
                (st.location.lng - parish.location.lng) ** 2;
              if (d > maxDistSq) {
                maxDistSq = d;
                farthestIdx = idx;
              }
            });
            fixedTailStop = priestStops[farthestIdx];
            destination = fixedTailStop.location;
            intermediateStops = priestStops.filter(
              (_, idx) => idx !== farthestIdx
            );
          }

          const shouldOptimize = intermediateStops.length >= 2;
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

          // Reconstruct stop visit order from optimizedIntermediateWaypointIndices
          const optIndices = primaryRoute.optimizedIntermediateWaypointIndices;
          const orderedIntermediates: VisitStop[] =
            shouldOptimize &&
            optIndices &&
            optIndices.length === intermediateStops.length
              ? optIndices.map((idx) => intermediateStops[idx])
              : intermediateStops;

          const orderedVisitSequence: VisitStop[] = fixedTailStop
            ? [...orderedIntermediates, fixedTailStop]
            : orderedIntermediates;

          const legs = primaryRoute.legs ?? [];
          let elapsedMinutes = 0;
          let totalVisitMinutes = 0;

          const scheduledItems: ScheduledStopItem[] = orderedVisitSequence.map(
            (stop, idx) => {
              const leg = legs[idx];
              const legDist = leg?.distanceMeters ?? 0;
              const legDurMs = leg?.durationMillis ?? 0;
              const legMins = Math.round(legDurMs / 60000);

              elapsedMinutes += legMins;
              const arrivalTime = addMinutesToHHMM(
                config.startTime,
                elapsedMinutes
              );
              elapsedMinutes += stop.durationMinutes;
              totalVisitMinutes += stop.durationMinutes;
              const departureTime = addMinutesToHHMM(
                config.startTime,
                elapsedMinutes
              );

              return {
                stop,
                orderIndex: idx + 1,
                arrivalTime,
                departureTime,
                legDistanceMeters: legDist,
                legDurationMillis: legDurMs,
              };
            }
          );

          let returnLegDistanceMeters = 0;
          let returnLegDurationMillis = 0;
          if (config.returnToParish && legs.length > orderedVisitSequence.length) {
            const returnLeg = legs[orderedVisitSequence.length];
            returnLegDistanceMeters = returnLeg?.distanceMeters ?? 0;
            returnLegDurationMillis = returnLeg?.durationMillis ?? 0;
            elapsedMinutes += Math.round(returnLegDurationMillis / 60000);
          }

          const endTime = addMinutesToHHMM(config.startTime, elapsedMinutes);

          nextRoutes.push({
            priestId,
            priestName: priestProfile.name,
            color: priestProfile.color,
            orderedStops: scheduledItems,
            totalDistanceMeters: primaryRoute.distanceMeters ?? 0,
            totalTravelDurationMillis: primaryRoute.durationMillis ?? 0,
            totalVisitMinutes,
            endTime,
            returnLegDistanceMeters,
            returnLegDurationMillis,
            encodedPathPoints: [],
            error:
              truncatedCount > 0
                ? `Uwzględniono pierwsze ${priestStops.length} punktów (limit 25 punktów pośrednich Routes API na jedną trasę; pominięto ${truncatedCount}).`
                : undefined,
          });

          nextRouteObjects.push({
            priestId,
            color: priestProfile.color,
            routeObj: primaryRoute,
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
    error,
    computeAllRoutes,
    clearRoutes,
  };
}
