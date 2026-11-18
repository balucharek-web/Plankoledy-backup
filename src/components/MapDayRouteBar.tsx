import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  Eye,
  EyeOff,
  ListOrdered,
  Navigation,
} from 'lucide-react';
import {
  DayPlanSummary,
  MarkerLabelMode,
  PriestRouteResult,
} from '../types/parish';
import {
  formatPolishDateChip,
  formatPolishDateFull,
} from '../utils/seasonScheduler';
import { formatDistance } from '../utils/spatial';

interface MapDayRouteBarProps {
  plannedDays: DayPlanSummary[];
  selectedDate: string | null;
  selectedDaySummary: DayPlanSummary | null;
  routes: PriestRouteResult[];
  isExactRoute: boolean;
  isComputingExact: boolean;
  focusedPriestId: number | null;
  availableStreets: Array<{ name: string; count: number }>;
  focusedStreet: string | null;
  activeStopsCount: number;
  markerLabelMode: MarkerLabelMode;
  showRouteLines: boolean;
  onSelectDate: (date: string | null) => void;
  onFocusPriest: (priestId: number | null) => void;
  onFocusStreet: (streetName: string | null) => void;
  onChangeMarkerLabelMode: (mode: MarkerLabelMode) => void;
  onToggleRouteLines: () => void;
  onComputeExactDayRoute: () => void;
  onOpenRouteList: () => void;
  onOpenFieldMode: () => void;
}

export const MapDayRouteBar: React.FC<MapDayRouteBarProps> = ({
  plannedDays,
  selectedDate,
  selectedDaySummary,
  routes,
  isExactRoute,
  isComputingExact,
  focusedPriestId,
  availableStreets,
  focusedStreet,
  activeStopsCount,
  markerLabelMode,
  showRouteLines,
  onSelectDate,
  onFocusPriest,
  onFocusStreet,
  onChangeMarkerLabelMode,
  onToggleRouteLines,
  onComputeExactDayRoute,
  onOpenRouteList,
  onOpenFieldMode,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const selectedDayIdx = selectedDate
    ? plannedDays.findIndex((d) => d.date === selectedDate)
    : -1;

  const stepDay = (delta: number) => {
    if (plannedDays.length === 0) return;
    if (selectedDayIdx < 0) {
      onSelectDate(plannedDays[0].date);
      onFocusPriest(null);
      return;
    }
    const nextIdx =
      (selectedDayIdx + delta + plannedDays.length) % plannedDays.length;
    onSelectDate(plannedDays[nextIdx].date);
    onFocusPriest(null);
  };

  const totalStopsOnRoutes = routes.reduce(
    (acc, r) => acc + r.orderedStops.length,
    0
  );
  const totalDistMeters = routes.reduce(
    (acc, r) => acc + r.totalDistanceMeters,
    0
  );

  if (minimized) {
    return (
      <div className="no-print absolute bottom-5 left-2.5 sm:bottom-4 sm:left-4 z-[460] max-w-[calc(100%-76px)]">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="min-h-[42px] px-3.5 py-2 bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-lg text-xs font-semibold text-slate-900 hover:bg-white inline-flex items-center gap-2 tabular-nums"
        >
          <ChevronUp className="w-4 h-4 text-amber-700 shrink-0" />
          <span className="truncate">
            {selectedDate
              ? `Podgląd dnia: ${formatPolishDateChip(selectedDate)}`
              : 'Podgląd trasy'}
          </span>
          {routes.length > 0 && (
            <span className="text-slate-500 font-normal hidden sm:inline">
              · {totalStopsOnRoutes} pkt
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="no-print absolute bottom-5 left-2.5 right-14 sm:bottom-4 sm:left-4 sm:right-16 sm:max-w-3xl z-[460]">
      <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
        {/* Primary Navigation Row: Day Prev / Picker / Next + Details / Minimize */}
        <div className="px-2 sm:px-3 py-1.5 flex items-center justify-between gap-1.5">
          {plannedDays.length > 0 ? (
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => stepDay(-1)}
                aria-label="Poprzedni dzień kolędy"
                className="min-w-[40px] min-h-[40px] sm:min-w-[34px] sm:min-h-[34px] inline-flex items-center justify-center rounded-xl text-slate-700 bg-slate-100/80 hover:bg-slate-200 transition-colors shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="min-w-0 flex-1">
                <select
                  value={selectedDate ?? ''}
                  onChange={(e) => {
                    onSelectDate(e.target.value || null);
                    onFocusPriest(null);
                  }}
                  aria-label="Wybierz dzień kolędy na mapie"
                  className="w-full min-h-[40px] sm:min-h-[34px] px-2.5 py-1 text-xs sm:text-[13px] font-semibold bg-slate-50 border border-slate-200 rounded-xl text-slate-900 tabular-nums focus:outline-none focus:border-amber-600"
                >
                  {plannedDays.map((d, idx) => (
                    <option key={d.date} value={d.date}>
                      {idx + 1}/{plannedDays.length} ·{' '}
                      {formatPolishDateChip(d.date)} ({d.startTime}–
                      {d.estimatedEndTime}) · {d.stops.length} pkt
                    </option>
                  ))}
                  <option value="">Wszystkie dni naraz ({activeStopsCount})</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => stepDay(1)}
                aria-label="Następny dzień kolędy"
                className="min-w-[40px] min-h-[40px] sm:min-w-[34px] sm:min-h-[34px] inline-flex items-center justify-center rounded-xl text-slate-700 bg-slate-100/80 hover:bg-slate-200 transition-colors shrink-0"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="px-2 text-xs font-semibold text-slate-800 truncate">
              Podgląd punktów ({activeStopsCount})
            </div>
          )}

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className={`min-h-[40px] sm:min-h-[34px] px-2.5 py-1 text-xs font-semibold rounded-xl inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                expanded
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
              }`}
            >
              <span>{expanded ? 'Mniej' : 'Opcje'}</span>
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setMinimized(true)}
              aria-label="Zwiń pasek podglądu dnia"
              title="Zwiń pasek podglądu"
              className="min-w-[36px] min-h-[40px] sm:min-h-[34px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Selected Day Context Line + Scrollable Priest Route Filter */}
        {routes.length > 0 && (
          <div className="px-2.5 sm:px-3 pb-2 space-y-1.5 border-t border-slate-100 pt-1.5">
            {selectedDaySummary && (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] text-slate-600 tabular-nums">
                <div className="truncate max-w-full">
                  <span className="font-semibold text-slate-900">
                    {formatPolishDateFull(selectedDaySummary.date)}
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span className="text-slate-700">
                    {selectedDaySummary.streetNames.join(', ')}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-[11px]">
                  {(selectedDaySummary.activeBreaks?.length ?? 0) > 0 && (
                    <span className="text-amber-800 font-medium">
                      Przerwa:{' '}
                      {selectedDaySummary.activeBreaks!
                        .map((b) => `${b.startTime}–${b.endTime}`)
                        .join(', ')}
                    </span>
                  )}
                  <span
                    className={
                      isExactRoute
                        ? 'text-emerald-700 font-semibold'
                        : 'text-slate-500'
                    }
                  >
                    {isExactRoute ? 'Trasa drogowa' : 'Kolejność trasy'}
                  </span>
                </div>
              </div>
            )}

            {/* Interactive Priest Filter Bar (horizontal scroll on mobile, wrap on desktop) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
              {routes.length > 1 && (
                <button
                  type="button"
                  onClick={() => onFocusPriest(null)}
                  className={`min-h-[36px] sm:min-h-[30px] px-2.5 py-1 text-[11px] font-semibold rounded-lg whitespace-nowrap shrink-0 tabular-nums transition-colors ${
                    focusedPriestId === null
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Wszyscy ({totalStopsOnRoutes} · {formatDistance(totalDistMeters)})
                </button>
              )}

              {routes.map((r) => {
                const active = focusedPriestId === r.priestId;
                const startT =
                  r.orderedStops[0]?.arrivalTime ??
                  selectedDaySummary?.startTime ??
                  '';
                return (
                  <button
                    key={r.priestId}
                    type="button"
                    onClick={() =>
                      onFocusPriest(active ? null : r.priestId)
                    }
                    className={`min-h-[36px] sm:min-h-[30px] px-2.5 py-1 text-[11px] font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 tabular-nums border transition-colors ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900'
                        : focusedPriestId !== null
                          ? 'bg-slate-50 text-slate-400 border-slate-200 hover:text-slate-700'
                          : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: r.color }}
                    />
                    <span>Ks. {r.priestId}</span>
                    <span className="opacity-80 font-mono">
                      {r.orderedStops.length} pkt
                    </span>
                    <span className="opacity-70 font-mono hidden sm:inline">
                      {startT}–{r.endTime} · {formatDistance(r.totalDistanceMeters)}
                    </span>
                  </button>
                );
              })}

              {!isExactRoute && (
                <button
                  type="button"
                  disabled={isComputingExact}
                  onClick={onComputeExactDayRoute}
                  className="min-h-[36px] sm:min-h-[30px] px-2.5 py-1 text-[11px] font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 disabled:opacity-50 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                >
                  <Navigation className="w-3 h-3 text-amber-700" />
                  <span>
                    {isComputingExact ? 'Liczenie...' : 'Wyznacz po drogach'}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Expandable Extra Controls: Street Filter, Marker Labels, Line Visibility, Field Mode & List */}
        {expanded && (
          <div className="px-2.5 sm:px-3 py-2.5 bg-slate-50/90 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {availableStreets.length > 1 && (
                <select
                  value={focusedStreet ?? ''}
                  onChange={(e) => onFocusStreet(e.target.value || null)}
                  aria-label="Filtruj ulicę na mapie"
                  className={`min-h-[36px] px-2.5 py-1 text-xs font-medium border rounded-lg focus:outline-none max-w-[190px] ${
                    focusedStreet
                      ? 'bg-amber-50 border-amber-400 text-amber-950 font-semibold'
                      : 'bg-white border-slate-200 text-slate-800'
                  }`}
                >
                  <option value="">
                    Wszystkie ulice ({availableStreets.length})
                  </option>
                  {availableStreets.map((st) => (
                    <option key={st.name} value={st.name}>
                      {st.name} ({st.count})
                    </option>
                  ))}
                </select>
              )}

              {activeStopsCount > 0 && (
                <div
                  role="group"
                  aria-label="Sposób wyświetlania punktów na mapie"
                  className="inline-flex items-center rounded-lg bg-slate-200/80 p-0.5"
                >
                  {(
                    [
                      { id: 'auto', label: 'Auto' },
                      { id: 'numbers', label: 'Numery' },
                      { id: 'dots', label: 'Kropki' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onChangeMarkerLabelMode(opt.id)}
                      className={`min-h-[32px] px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap ${
                        markerLabelMode === opt.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              {routes.length > 0 && (
                <button
                  type="button"
                  onClick={onToggleRouteLines}
                  className={`min-h-[36px] px-2.5 py-1 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap border ${
                    showRouteLines
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {showRouteLines ? (
                    <Eye className="w-3.5 h-3.5" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5" />
                  )}
                  <span>Linie trasy</span>
                </button>
              )}
            </div>

            {routes.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onOpenFieldMode}
                  className="min-h-[36px] px-3 py-1 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  <span>W teren</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenRouteList}
                  className="lg:hidden min-h-[36px] px-3 py-1 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <ListOrdered className="w-3.5 h-3.5" />
                  <span>Lista wizyt</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
