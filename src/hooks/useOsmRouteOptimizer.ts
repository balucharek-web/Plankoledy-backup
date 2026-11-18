import { useCallback, useState } from 'react';
import { RoutePolylineEntry } from '../components/ParishMap';
import { computeOsmParishRoutes } from '../services/osmSearchAndRouting';
import { DayBreakWindow, ParishCenter, PlanConfig, PriestRouteResult, VisitStop } from '../types/parish';

export function useOsmRouteOptimizer() {
  const [routes, setRoutes] = useState<PriestRouteResult[]>([]);
  const [routeObjects] = useState<RoutePolylineEntry[]>([]);
  const [isComputing, setIsComputing] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearRoutes = useCallback(() => {
    setRoutes([]);
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
      if (stops.length === 0) {
        clearRoutes();
        return;
      }

      setIsComputing(true);
      setProgressLabel('Przygotowywanie optymalizacji trasy...');
      setError(null);
      try {
        const nextRoutes = await computeOsmParishRoutes(
          parish,
          stops,
          config,
          (label) => setProgressLabel(label),
          activeBreaks
        );
        setRoutes(nextRoutes);
        return {
          routes: nextRoutes,
          routeObjects: [] as RoutePolylineEntry[],
        };
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Nie udało się wyznaczyć tras w trybie OpenStreetMap.'
        );
        return undefined;
      } finally {
        setIsComputing(false);
        setProgressLabel(null);
      }
    },
    [clearRoutes]
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
