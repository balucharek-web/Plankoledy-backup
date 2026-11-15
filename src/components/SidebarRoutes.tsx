import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Ban,
  BellRing,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  Download,
  ExternalLink,
  Eye,
  ListOrdered,
  Loader2,
  Map as MapIcon,
  Navigation,
  Printer,
  RefreshCw,
  Trash2,
  UserX,
} from 'lucide-react';
import {
  DayPlanSummary,
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
  ScheduledStopItem,
  UnitVisitStatus,
} from '../types/parish';
import {
  formatPolishDateChip,
  formatPolishDateFull,
} from '../utils/seasonScheduler';
import {
  buildGoogleMapsStageUrls,
  exportScheduleToCsv,
  extractStreetName,
  formatDistance,
  formatDurationMillis,
  formatMinutesLabel,
} from '../utils/spatial';

interface SidebarRoutesProps {
  parish: ParishCenter | null;
  config: PlanConfig;
  routes: PriestRouteResult[];
  isExactRoute: boolean;
  plannedDays: DayPlanSummary[];
  selectedDate: string | null;
  effectiveStartTime: string;
  focusedPriestId: number | null;
  isComputing: boolean;
  progressLabel?: string | null;
  globalError: string | null;
  onSelectDate: (date: string | null) => void;
  onFocusPriestOnMap: (priestId: number | null) => void;
  onRecompute: () => void;
  onSelectStop: (stopId: string) => void;
  onOpenBlockUnits: (stopId: string) => void;
  onViewRouteOnMap: (priestId?: number | null) => void;
  onOpenSchedule: () => void;
  onUpdateStopStatus: (stopId: string, status: UnitVisitStatus) => void;
  onMoveStopOrder: (
    priestId: number,
    stopId: string,
    direction: 'up' | 'down'
  ) => void;
  onSetRouteStartStop?: (priestId: number, stopId: string) => void;
  onDeleteRoute?: () => void;
  onGoToPlanner?: () => void;
}

const STATUS_BADGE: Record<
  UnitVisitStatus,
  { label: string; className: string }
> = {
  pending: {
    label: 'Do odwiedzenia',
    className: 'bg-slate-100 text-slate-600',
  },
  accepted: {
    label: 'Przyjęto',
    className: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  },
  absent: {
    label: 'Nieobecni',
    className: 'bg-amber-50 text-amber-800 border border-amber-200',
  },
  declined: {
    label: 'Odmowa',
    className: 'bg-red-50 text-red-700 border border-red-200',
  },
  invited: {
    label: 'Zaproszenie',
    className: 'bg-sky-50 text-sky-800 border border-sky-200',
  },
};

function isStopCompletedInField(item: ScheduledStopItem): boolean {
  const isBlock = Boolean(
    item.stop.isMultiUnit || (item.stop.units && item.stop.units.length > 0)
  );
  if (isBlock && item.stop.units && item.stop.units.length > 0) {
    return item.stop.units.every((u) => u.status !== 'pending');
  }
  const st = item.stop.visitStatus ?? 'pending';
  return st !== 'pending';
}

export const SidebarRoutes: React.FC<SidebarRoutesProps> = ({
  parish,
  config,
  routes,
  isExactRoute,
  plannedDays,
  selectedDate,
  effectiveStartTime,
  focusedPriestId,
  isComputing,
  progressLabel,
  globalError,
  onSelectDate,
  onFocusPriestOnMap,
  onRecompute,
  onSelectStop,
  onOpenBlockUnits,
  onViewRouteOnMap,
  onOpenSchedule,
  onUpdateStopStatus,
  onMoveStopOrder,
  onSetRouteStartStop,
  onDeleteRoute,
  onGoToPlanner,
}) => {
  const [viewSubMode, setViewSubMode] = useState<'list' | 'field'>('list');
  const [fieldPriestId, setFieldPriestId] = useState<number>(1);
  const [activeFieldStopId, setActiveFieldStopId] = useState<string | null>(
    null
  );
  const [openGmapsMenuPriest, setOpenGmapsMenuPriest] = useState<number | null>(
    null
  );

  // Sync selected priest in field mode with available routes
  useEffect(() => {
    if (routes.length === 0) return;
    if (!routes.some((r) => r.priestId === fieldPriestId)) {
      setFieldPriestId(routes[0].priestId);
    }
  }, [routes, fieldPriestId]);

  const activeFieldRoute = useMemo(
    () =>
      routes.find((r) => r.priestId === fieldPriestId) ?? routes[0] ?? null,
    [routes, fieldPriestId]
  );

  // Keep spotlight stop pointing to a valid stop (auto-pick first pending stop)
  useEffect(() => {
    if (!activeFieldRoute || activeFieldRoute.orderedStops.length === 0) {
      setActiveFieldStopId(null);
      return;
    }
    const stillExists = activeFieldRoute.orderedStops.some(
      (s) => s.stop.id === activeFieldStopId
    );
    if (!stillExists) {
      const firstPending =
        activeFieldRoute.orderedStops.find(
          (item) => !isStopCompletedInField(item)
        ) ?? activeFieldRoute.orderedStops[0];
      setActiveFieldStopId(firstPending.stop.id);
    }
  }, [activeFieldRoute, activeFieldStopId]);

  const fieldStats = useMemo(() => {
    if (!activeFieldRoute) {
      return { accepted: 0, absent: 0, declined: 0, invited: 0, pending: 0 };
    }
    let accepted = 0;
    let absent = 0;
    let declined = 0;
    let invited = 0;
    let pending = 0;

    for (const item of activeFieldRoute.orderedStops) {
      const isBlock = Boolean(
        item.stop.isMultiUnit || (item.stop.units && item.stop.units.length > 0)
      );
      if (isBlock && item.stop.units && item.stop.units.length > 0) {
        const allDecided = item.stop.units.every((u) => u.status !== 'pending');
        const hasAccepted = item.stop.units.some((u) => u.status === 'accepted');
        const hasAbsentOrInvited = item.stop.units.some(
          (u) => u.status === 'absent' || u.status === 'invited'
        );
        if (!allDecided) pending += 1;
        else if (hasAccepted) accepted += 1;
        else if (hasAbsentOrInvited) absent += 1;
        else declined += 1;
        continue;
      }

      const st = item.stop.visitStatus ?? 'pending';
      if (st === 'accepted') accepted += 1;
      else if (st === 'absent') absent += 1;
      else if (st === 'declined') declined += 1;
      else if (st === 'invited') invited += 1;
      else pending += 1;
    }
    return { accepted, absent, declined, invited, pending };
  }, [activeFieldRoute]);

  const handleFieldMarkSingle = (stopId: string, status: UnitVisitStatus) => {
    onUpdateStopStatus(stopId, status);
    if (!activeFieldRoute) return;
    const idx = activeFieldRoute.orderedStops.findIndex(
      (i) => i.stop.id === stopId
    );
    if (idx >= 0) {
      const remainingNext =
        activeFieldRoute.orderedStops
          .slice(idx + 1)
          .find((item) => !isStopCompletedInField(item)) ??
        activeFieldRoute.orderedStops[idx + 1];
      if (remainingNext) {
        setActiveFieldStopId(remainingNext.stop.id);
      }
    }
  };

  if (isComputing) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center gap-3">
        <Loader2 className="w-6 h-6 text-amber-700 animate-spin" />
        <div>
          <p className="text-sm font-medium text-slate-900">
            Optymalizacja kolejności odwiedzin...
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {progressLabel ||
              'Algorytm układa najkrótsze trasy drogowe dla każdego księdza.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3 bg-white shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">
              {selectedDate
                ? `Trasy · ${formatPolishDateFull(selectedDate)}`
                : 'Wyznaczone trasy kolędowe'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              Start: {effectiveStartTime} ·{' '}
              {config.travelMode === 'WALKING' ? 'Pieszo' : 'Samochodem'}
              {routes.length > 0 && (
                <>
                  {' '}
                  ·{' '}
                  <span
                    className={
                      isExactRoute
                        ? 'text-emerald-700 font-medium'
                        : 'text-amber-700 font-medium'
                    }
                  >
                    {isExactRoute ? 'Dokładna trasa drogowa' : 'Szacunek trasy'}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onRecompute}
              disabled={!parish || routes.length === 0}
              className="min-h-[36px] px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {isExactRoute ? 'Przelicz' : 'Wyznacz drogowo'}
            </button>
            {onDeleteRoute && (routes.length > 0 || Boolean(selectedDate)) && (
              <button
                type="button"
                onClick={onDeleteRoute}
                title={
                  selectedDate
                    ? 'Usuń trasę tego dnia'
                    : 'Usuń wyznaczoną trasę'
                }
                aria-label="Usuń trasę"
                className="min-h-[36px] px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg inline-flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Usuń trasę</span>
              </button>
            )}
          </div>
        </div>

        {/* Multi-day switcher strip */}
        {plannedDays.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {plannedDays.map((day) => {
              const active = selectedDate === day.date;
              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => onSelectDate(day.date)}
                  className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 tabular-nums transition-colors ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {formatPolishDateChip(day.date)} ({day.stops.length})
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => onSelectDate(null)}
              className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                selectedDate === null
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Wszystkie zaznaczone
            </button>
          </div>
        )}

        {/* Sub-mode switcher: Lista trasy vs Kolęda w terenie */}
        {routes.length > 0 && (
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setViewSubMode('list')}
              className={`min-h-[36px] px-3 py-1 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors ${
                viewSubMode === 'list'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ListOrdered className="w-3.5 h-3.5 text-amber-700" />
              <span>Lista i kolejność</span>
            </button>
            <button
              type="button"
              onClick={() => setViewSubMode('field')}
              className={`min-h-[36px] px-3 py-1 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors ${
                viewSubMode === 'field'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ClipboardCheck className="w-3.5 h-3.5 text-emerald-700" />
              <span>Kolęda w terenie</span>
            </button>
          </div>
        )}

        {/* Prominent Map Preview & Season Overview Bar */}
        {routes.length > 0 && viewSubMode === 'list' && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onViewRouteOnMap(null)}
              className="min-h-[40px] px-3 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>Zobacz trasy na mapie</span>
            </button>
            <button
              type="button"
              onClick={onOpenSchedule}
              className="min-h-[40px] px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <CalendarCheck className="w-3.5 h-3.5 text-slate-600" />
              <span>Cały harmonogram</span>
            </button>
          </div>
        )}

        {routes.length > 0 && !isExactRoute && viewSubMode === 'list' && (
          <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-2 text-xs text-amber-900">
            <span className="leading-snug">
              Podgląd szacowanego czasu i kolejności. Przelicz po drogach, aby
              dodać dokładny przebieg ulicami.
            </span>
            <button
              type="button"
              onClick={onRecompute}
              className="min-h-[32px] px-2.5 py-1 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg whitespace-nowrap shrink-0"
            >
              Wyznacz
            </button>
          </div>
        )}
      </div>

      {globalError && (
        <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span>{globalError}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
        {routes.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <Navigation className="w-6 h-6 text-slate-400 mx-auto" />
            <div>
              <p className="text-sm font-medium text-slate-800">
                Brak wyznaczonych tras
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">
                Wybierz datę i ulice w zakładce „Zaplanuj dzień” lub ułóż cały
                okres w zakładce „Cały okres”.
              </p>
            </div>
            {onGoToPlanner && (
              <button
                type="button"
                onClick={onGoToPlanner}
                className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center gap-1.5 transition-colors"
              >
                Zaplanuj dzień
              </button>
            )}
          </div>
        ) : viewSubMode === 'field' && activeFieldRoute ? (
          /* LIVE FIELD MODE ("KOLĘDA W TERENIE") */
          <div className="p-4 space-y-4">
            {/* Priest switcher if multi-priest */}
            {routes.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {routes.map((r) => {
                  const active = r.priestId === activeFieldRoute.priestId;
                  return (
                    <button
                      key={r.priestId}
                      type="button"
                      onClick={() => {
                        setFieldPriestId(r.priestId);
                        setActiveFieldStopId(null);
                      }}
                      className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                        active
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                      <span>{r.priestName}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Progress Counters */}
            <div className="grid grid-cols-4 gap-1.5 text-center tabular-nums">
              <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="text-sm font-bold text-emerald-900">
                  {fieldStats.accepted}
                </div>
                <div className="text-[10px] font-medium text-emerald-700">
                  Przyjęto
                </div>
              </div>
              <div className="p-2 rounded-xl bg-amber-50 border border-amber-200">
                <div className="text-sm font-bold text-amber-900">
                  {fieldStats.absent + fieldStats.invited}
                </div>
                <div className="text-[10px] font-medium text-amber-700">
                  Powroty
                </div>
              </div>
              <div className="p-2 rounded-xl bg-red-50 border border-red-200">
                <div className="text-sm font-bold text-red-900">
                  {fieldStats.declined}
                </div>
                <div className="text-[10px] font-medium text-red-700">
                  Odmowy
                </div>
              </div>
              <div className="p-2 rounded-xl bg-slate-100 border border-slate-200">
                <div className="text-sm font-bold text-slate-900">
                  {fieldStats.pending}
                </div>
                <div className="text-[10px] font-medium text-slate-600">
                  Zostało
                </div>
              </div>
            </div>

            {/* Active Spotlight Card */}
            {(() => {
              const currentIdx = activeFieldRoute.orderedStops.findIndex(
                (i) => i.stop.id === activeFieldStopId
              );
              const activeItem =
                (currentIdx >= 0
                  ? activeFieldRoute.orderedStops[currentIdx]
                  : activeFieldRoute.orderedStops[0]) ?? null;
              if (!activeItem) return null;

              const nextItem =
                activeFieldRoute.orderedStops[
                  (currentIdx >= 0 ? currentIdx : 0) + 1
                ] ?? null;
              const isBlock = Boolean(
                activeItem.stop.isMultiUnit ||
                  (activeItem.stop.units && activeItem.stop.units.length > 0)
              );
              const unitsTotal =
                activeItem.stop.units?.length ||
                activeItem.stop.unitsCount ||
                0;
              const currentStatus: UnitVisitStatus =
                activeItem.stop.visitStatus ?? 'pending';

              const navFromHere =
                parish &&
                buildGoogleMapsStageUrls(
                  parish,
                  activeFieldRoute.orderedStops
                    .slice(Math.max(0, currentIdx))
                    .map((s) => s.stop),
                  false,
                  config.travelMode
                )[0];

              return (
                <div className="p-4 rounded-2xl border-2 border-amber-300 bg-white shadow-sm space-y-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span
                        className={`w-7 h-7 text-xs font-mono font-bold text-white flex items-center justify-center shrink-0 tabular-nums ${
                          isBlock ? 'rounded-lg' : 'rounded-full'
                        }`}
                        style={{ backgroundColor: activeFieldRoute.color }}
                      >
                        {activeItem.orderIndex}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium text-amber-800 uppercase tracking-wide">
                          Aktualny punkt · ~{activeItem.arrivalTime}
                        </div>
                        <h3 className="text-base font-bold text-slate-900 leading-snug mt-0.5">
                          {activeItem.stop.address || activeItem.stop.label}
                        </h3>
                        {(activeItem.stop.notes ||
                          (activeItem.stop.label &&
                            activeItem.stop.label !==
                              activeItem.stop.address)) && (
                          <p className="text-xs text-slate-600 mt-0.5">
                            {activeItem.stop.notes || activeItem.stop.label}
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectStop(activeItem.stop.id)}
                      title="Pokaż ten dom na mapie"
                      className="min-w-[36px] min-h-[36px] px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center gap-1 shrink-0"
                    >
                      <MapIcon className="w-3.5 h-3.5 text-amber-700" />
                      <span>Mapa</span>
                    </button>
                  </div>

                  {isBlock ? (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => onOpenBlockUnits(activeItem.stop.id)}
                        className="w-full min-h-[46px] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
                      >
                        <Building2 className="w-4 h-4" />
                        <span>
                          Otwórz lokale bloku ({unitsTotal}) — odhacz mieszkania
                        </span>
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleFieldMarkSingle(activeItem.stop.id, 'accepted')
                        }
                        className={`min-h-[44px] px-3 py-2 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-1.5 transition-colors ${
                          currentStatus === 'accepted'
                            ? 'bg-emerald-600 border-emerald-700 text-white'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>Przyjęto</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleFieldMarkSingle(activeItem.stop.id, 'absent')
                        }
                        className={`min-h-[44px] px-3 py-2 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-1.5 transition-colors ${
                          currentStatus === 'absent'
                            ? 'bg-amber-600 border-amber-700 text-white'
                            : 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'
                        }`}
                      >
                        <UserX className="w-4 h-4 shrink-0" />
                        <span>Nieobecni</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleFieldMarkSingle(activeItem.stop.id, 'declined')
                        }
                        className={`min-h-[44px] px-3 py-2 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-1.5 transition-colors ${
                          currentStatus === 'declined'
                            ? 'bg-red-600 border-red-700 text-white'
                            : 'bg-red-50 border-red-200 text-red-900 hover:bg-red-100'
                        }`}
                      >
                        <Ban className="w-4 h-4 shrink-0" />
                        <span>Odmowa</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleFieldMarkSingle(activeItem.stop.id, 'invited')
                        }
                        className={`min-h-[44px] px-3 py-2 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-1.5 transition-colors ${
                          currentStatus === 'invited'
                            ? 'bg-sky-600 border-sky-700 text-white'
                            : 'bg-sky-50 border-sky-200 text-sky-900 hover:bg-sky-100'
                        }`}
                      >
                        <BellRing className="w-4 h-4 shrink-0" />
                        <span>Zaproszenie</span>
                      </button>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                    {navFromHere && (
                      <a
                        href={navFromHere.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[36px] px-2.5 py-1.5 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg inline-flex items-center gap-1"
                      >
                        <span>Nawiguj od tego domu</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {nextItem && (
                      <button
                        type="button"
                        onClick={() => setActiveFieldStopId(nextItem.stop.id)}
                        className="min-h-[36px] px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1 ml-auto"
                      >
                        <span className="truncate max-w-[160px]">
                          Następny: #{nextItem.orderIndex}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Interactive stop list for jumping */}
            <div className="border border-slate-200 rounded-xl bg-white divide-y divide-slate-100 overflow-hidden">
              {activeFieldRoute.orderedStops.map((item) => {
                const isActive = item.stop.id === activeFieldStopId;
                const st: UnitVisitStatus = item.stop.visitStatus ?? 'pending';
                const badge = STATUS_BADGE[st];
                const isBlock = Boolean(
                  item.stop.isMultiUnit ||
                    (item.stop.units && item.stop.units.length > 0)
                );
                return (
                  <button
                    key={item.stop.id}
                    type="button"
                    onClick={() => setActiveFieldStopId(item.stop.id)}
                    className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 transition-colors ${
                      isActive ? 'bg-amber-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-5 h-5 text-[11px] font-mono font-semibold text-white flex items-center justify-center shrink-0 tabular-nums ${
                          isBlock ? 'rounded-md' : 'rounded-full'
                        }`}
                        style={{ backgroundColor: activeFieldRoute.color }}
                      >
                        {item.orderIndex}
                      </span>
                      <span className="text-xs font-medium text-slate-900 truncate">
                        {item.stop.address || item.stop.label}
                      </span>
                    </div>
                    {isBlock ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-semibold shrink-0 tabular-nums">
                        Blok (
                        {item.stop.units?.filter((u) => u.status === 'accepted')
                          .length ?? 0}
                        /{item.stop.units?.length || item.stop.unitsCount || 0})
                      </span>
                    ) : (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* STANDARD ROUTE ORDER & REORDER LIST */
          routes.map((route) => {
            const isFocused = focusedPriestId === route.priestId;
            const stages =
              parish && route.orderedStops.length > 0
                ? buildGoogleMapsStageUrls(
                    parish,
                    route.orderedStops.map((s) => s.stop),
                    config.returnToParish,
                    config.travelMode
                  )
                : [];
            const firstItem = route.orderedStops[0];
            const routeStreets = Array.from(
              new Set(route.orderedStops.map((s) => extractStreetName(s.stop)))
            );
            const gmapsOpen = openGmapsMenuPriest === route.priestId;

            return (
              <section key={route.priestId} className="p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: route.color }}
                      />
                      <h3 className="text-sm font-semibold text-slate-900">
                        {route.priestName}
                      </h3>
                    </div>
                    {firstItem && (
                      <div className="text-xs text-slate-700">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-700 text-white text-[10px] font-bold mr-1.5">
                          START
                        </span>
                        <span className="font-semibold text-slate-900">
                          {firstItem.stop.address || firstItem.stop.label}
                        </span>
                      </div>
                    )}
                    {routeStreets.length > 0 && (
                      <div className="text-[11px] text-slate-500">
                        Ulice:{' '}
                        <span className="text-slate-700 font-medium">
                          {routeStreets.join(', ')}
                        </span>
                      </div>
                    )}
                    <div className="text-xs text-slate-500 tabular-nums">
                      {route.orderedStops.length}{' '}
                      {route.orderedStops.length === 1
                        ? 'punkt'
                        : route.orderedStops.length < 5
                          ? 'punkty'
                          : 'punktów'}{' '}
                      · {formatDistance(route.totalDistanceMeters)} · Przejście:{' '}
                      {formatDurationMillis(route.totalTravelDurationMillis)} ·
                      Koniec ok. {route.endTime}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const nextFocus = isFocused ? null : route.priestId;
                        onFocusPriestOnMap(nextFocus);
                        onViewRouteOnMap(route.priestId);
                      }}
                      className={`min-h-[34px] px-2.5 py-1.5 text-xs font-medium rounded-lg inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                        isFocused
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Na mapie
                    </button>

                    {stages.length === 1 ? (
                      <a
                        href={stages[0].url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[34px] px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                      >
                        Nawiguj
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : stages.length > 1 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setOpenGmapsMenuPriest(gmapsOpen ? null : route.priestId)
                        }
                        className="min-h-[34px] px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                      >
                        <Navigation className="w-3 h-3" />
                        Nawiguj
                      </button>
                    ) : null}
                  </div>
                </div>

                {gmapsOpen && stages.length > 1 && (
                  <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1.5">
                    <p className="text-[11px] text-amber-900 leading-snug">
                      Zewnętrzna aplikacja Google Maps przyjmuje maks. 10 punktów
                      na jeden link (w Planerze cała ulica jest jedną ciągłą trasą):
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {stages.map((st) => (
                        <a
                          key={st.stageIndex}
                          href={st.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[30px] px-2.5 py-1 text-[11px] font-medium text-amber-900 bg-white hover:bg-amber-100 border border-amber-200 rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
                        >
                          <span>
                            {st.isReturnLeg
                              ? 'Powrót pod kościół'
                              : `Nawiguj: pkt ${st.startStopNumber}–${st.endStopNumber}`}
                          </span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {route.error && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                    {route.error}
                  </div>
                )}

                {route.orderedStops.length > 0 && (
                  <ol className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white overflow-hidden">
                    {route.orderedStops.map((item, idx) => {
                      const isFirst = idx === 0;
                      const isBlock = Boolean(
                        item.stop.isMultiUnit ||
                          (item.stop.units && item.stop.units.length > 0)
                      );
                      const unitsTotal =
                        item.stop.units?.length || item.stop.unitsCount || 0;
                      const st: UnitVisitStatus =
                        item.stop.visitStatus ?? 'pending';
                      return (
                        <li
                          key={item.stop.id}
                          className={`flex items-start justify-between gap-2 px-3 py-2.5 transition-colors ${
                            isFirst ? 'bg-emerald-50/40' : 'hover:bg-slate-50'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onSelectStop(item.stop.id)}
                            className="flex-1 min-w-0 text-left flex items-start gap-2.5"
                          >
                            <span
                              className={`w-5 h-5 text-[11px] font-mono font-semibold text-white flex items-center justify-center shrink-0 mt-0.5 tabular-nums ${
                                isBlock ? 'rounded-md' : 'rounded-full'
                              }`}
                              style={{
                                backgroundColor: isFirst ? '#15803D' : route.color,
                              }}
                            >
                              {item.orderIndex}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-900 truncate inline-flex items-center gap-1.5">
                                  {isFirst && (
                                    <span className="px-1 py-0.5 rounded bg-emerald-700 text-white text-[9px] font-extrabold shrink-0">
                                      START
                                    </span>
                                  )}
                                  <span className="truncate">
                                    {item.stop.address || item.stop.label}
                                  </span>
                                  {isBlock && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-semibold shrink-0 tabular-nums">
                                      <Building2 className="w-2.5 h-2.5" />
                                      Blok{unitsTotal > 0 ? ` (${unitsTotal})` : ''}
                                    </span>
                                  )}
                                  {!isBlock && st !== 'pending' && (
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${STATUS_BADGE[st].className}`}
                                    >
                                      {STATUS_BADGE[st].label}
                                    </span>
                                  )}
                                </span>
                                <span className="text-xs font-mono text-slate-700 tabular-nums shrink-0">
                                  {item.arrivalTime}–{item.departureTime}
                                </span>
                              </div>
                              {(item.stop.notes ||
                                (item.stop.label &&
                                  item.stop.label !== item.stop.address)) && (
                                <div className="text-xs text-slate-500 truncate mt-0.5">
                                  {item.stop.notes || item.stop.label}
                                </div>
                              )}
                              <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                                Dojazd: {formatDistance(item.legDistanceMeters)} ·{' '}
                                {formatDurationMillis(item.legDurationMillis)} ·
                                Wizyta: {item.stop.durationMinutes} min
                              </div>
                            </div>
                          </button>

                          <div className="flex items-center gap-1 shrink-0 self-center">
                            {onSetRouteStartStop && !isFirst && (
                              <button
                                type="button"
                                onClick={() =>
                                  onSetRouteStartStop(route.priestId, item.stop.id)
                                }
                                title="Zacznij trasę od tego domu (ustaw jako START)"
                                className="px-1.5 py-1 text-[10px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md whitespace-nowrap"
                              >
                                Start
                              </button>
                            )}
                            {isBlock && (
                              <button
                                type="button"
                                onClick={() => onOpenBlockUnits(item.stop.id)}
                                className="px-2 py-1 text-[11px] font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg whitespace-nowrap"
                              >
                                Lokale ({unitsTotal})
                              </button>
                            )}

                            {route.orderedStops.length > 1 && (
                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() =>
                                    onMoveStopOrder(
                                      route.priestId,
                                      item.stop.id,
                                      'up'
                                    )
                                  }
                                  aria-label="Przesuń wcześniej w kolejności"
                                  title="Przesuń wcześniej"
                                  className="p-1 text-slate-400 hover:text-slate-800 hover:bg-slate-200/70 disabled:opacity-25 rounded"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    idx === route.orderedStops.length - 1
                                  }
                                  onClick={() =>
                                    onMoveStopOrder(
                                      route.priestId,
                                      item.stop.id,
                                      'down'
                                    )
                                  }
                                  aria-label="Przesuń później w kolejności"
                                  title="Przesuń później"
                                  className="p-1 text-slate-400 hover:text-slate-800 hover:bg-slate-200/70 disabled:opacity-25 rounded"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                    {config.returnToParish && parish && (
                      <li className="px-3 py-2 bg-slate-50 text-xs text-slate-600 flex items-center justify-between tabular-nums">
                        <span>Powrót: {parish.name}</span>
                        <span className="font-mono">
                          {formatDistance(route.returnLegDistanceMeters)} ·
                          finisz {route.endTime}
                        </span>
                      </li>
                    )}
                  </ol>
                )}

                <div className="text-xs text-slate-500 tabular-nums">
                  Łączny czas wizyt w domach:{' '}
                  {formatMinutesLabel(route.totalVisitMinutes)}
                </div>
              </section>
            );
          })
        )}
      </div>

      {routes.length > 0 && (
        <div className="p-4 border-t border-slate-200 bg-white grid grid-cols-2 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => exportScheduleToCsv(parish, routes)}
            className="min-h-[40px] py-2 px-3 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Eksportuj CSV
          </button>
          <button
            type="button"
            onClick={() => {
              const imgs = Array.from(
                document.querySelectorAll<HTMLImageElement>(
                  'img[data-print-map-tile="true"]'
                )
              );
              const pending = imgs.filter((img) => !img.complete);
              if (pending.length === 0) {
                window.print();
                return;
              }
              let printed = false;
              const finish = () => {
                if (printed) return;
                printed = true;
                window.print();
              };
              const timer = window.setTimeout(finish, 900);
              let remaining = pending.length;
              const onDone = () => {
                remaining -= 1;
                if (remaining <= 0) {
                  window.clearTimeout(timer);
                  finish();
                }
              };
              pending.forEach((img) => {
                img.addEventListener('load', onDone, { once: true });
                img.addEventListener('error', onDone, { once: true });
              });
            }}
            className="min-h-[40px] py-2 px-3 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            Drukuj mapę i listę
          </button>
        </div>
      )}
    </div>
  );
};
