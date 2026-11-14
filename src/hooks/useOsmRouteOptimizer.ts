import { useCallback, useState } from 'react';
import { RoutePolylineEntry } from '../components/ParishMap';
import { computeOsmParishRoutes } from '../services/osmSearchAndRouting';
import { ParishCenter, PlanConfig, PriestRouteResult, VisitStop } from '../types/parish';

export function useOsmRouteOptimizer() {
  const [routes, setRoutes] = useState<PriestRouteResult[]>([]);
  const [routeObjects] = useState<RoutePolylineEntry[]>([]);
  const [isComputing, setIsComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearRoutes = useCallback(() => {
    setRoutes([]);
    setError(null);
  }, []);

  const computeAllRoutes = useCallback(
    async (parish: ParishCenter, stops: VisitStop[], config: PlanConfig) => {
      if (stops.length === 0) {
        clearRoutes();
        return;
      }

      setIsComputing(true);
      setError(null);
      try {
        const nextRoutes = await computeOsmParishRoutes(parish, stops, config);
        setRoutes(nextRoutes);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Nie udało się wyznaczyć tras w trybie OpenStreetMap.'
        );
      } finally {
        setIsComputing(false);
      }
    },
    [clearRoutes]
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
