import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  BellRing,
  Building2,
  CheckCircle2,
  Crosshair,
  ExternalLink,
  Moon,
  RotateCcw,
  StickyNote,
  Sun,
  UserX,
  X,
} from 'lucide-react';
import {
  ParishCenter,
  PlanConfig,
  PriestRouteResult,
  ScheduledStopItem,
  UnitVisitStatus,
  VisitStop,
} from '../types/parish';
import { buildGoogleMapsStageUrls } from '../utils/spatial';
import { UNIT_STATUS_META } from './BlockUnitsModal';

interface MapFieldOverlayProps {
  parish: ParishCenter | null;
  config: PlanConfig;
  routes: PriestRouteResult[];
  fieldPriestId: number;
  activeFieldStopId: string | null;
  nightMode: boolean;
  onChangePriest: (priestId: number) => void;
  onSelectActiveStop: (stopId: string) => void;
  onToggleNightMode: () => void;
  onUpdateStopStatus: (stopId: string, status: UnitVisitStatus) => void;
  onUpdateStopDetails: (stopId: string, patch: Partial<VisitStop>) => void;
  onOpenBlockUnits: (stopId: string) => void;
  onCenterOnStop: (stopId: string) => void;
  onClose: () => void;
}

function isStopCompletedInField(item: ScheduledStopItem): boolean {
  const isBlock = Boolean(
    item.stop.isMultiUnit || (item.stop.units && item.stop.units.length > 0)
  );
  if (isBlock && item.stop.units && item.stop.units.length > 0) {
    return item.stop.units.every((u) => u.status !== 'pending');
  }
  return (item.stop.visitStatus ?? 'pending') !== 'pending';
}

export const MapFieldOverlay: React.FC<MapFieldOverlayProps> = ({
  parish,
  config,
  routes,
  fieldPriestId,
  activeFieldStopId,
  nightMode,
  onChangePriest,
  onSelectActiveStop,
  onToggleNightMode,
  onUpdateStopStatus,
  onUpdateStopDetails,
  onOpenBlockUnits,
  onCenterOnStop,
  onClose,
}) => {
  const [noteOpen, setNoteOpen] = useState(false);
  const [draftNote, setDraftNote] = useState('');

  const activeRoute = useMemo(
    () =>
      routes.find((r) => r.priestId === fieldPriestId) ?? routes[0] ?? null,
    [routes, fieldPriestId]
  );

  const currentIdx = useMemo(() => {
    if (!activeRoute || activeRoute.orderedStops.length === 0) return -1;
    const exact = activeRoute.orderedStops.findIndex(
      (i) => i.stop.id === activeFieldStopId
    );
    if (exact >= 0) return exact;
    const firstPending = activeRoute.orderedStops.findIndex(
      (i) => !isStopCompletedInField(i)
    );
    return firstPending >= 0 ? firstPending : 0;
  }, [activeRoute, activeFieldStopId]);

  const activeItem =
    activeRoute && currentIdx >= 0
      ? activeRoute.orderedStops[currentIdx] ?? null
      : null;

  useEffect(() => {
    if (!activeItem) return;
    setDraftNote(activeItem.stop.notes ?? '');
    setNoteOpen(false);
  }, [activeItem?.stop.id, activeItem?.stop.notes]);

  const completedCount = useMemo(() => {
    if (!activeRoute) return 0;
    return activeRoute.orderedStops.filter(isStopCompletedInField).length;
  }, [activeRoute]);

  if (!activeRoute || !activeItem) return null;

  const totalStops = activeRoute.orderedStops.length;
  const prevItem = currentIdx > 0 ? activeRoute.orderedStops[currentIdx - 1] : null;
  const nextItem =
    currentIdx + 1 < totalStops ? activeRoute.orderedStops[currentIdx + 1] : null;

  const isBlock = Boolean(
    activeItem.stop.isMultiUnit ||
      (activeItem.stop.units && activeItem.stop.units.length > 0)
  );
  const unitsTotal =
    activeItem.stop.units?.length || activeItem.stop.unitsCount || 0;
  const currentStatus: UnitVisitStatus = activeItem.stop.visitStatus ?? 'pending';

  const navUrl =
    parish &&
    buildGoogleMapsStageUrls(
      parish,
      activeRoute.orderedStops.slice(currentIdx).map((s) => s.stop),
      false,
      config.travelMode
    )[0]?.url;

  const advanceToNext = (afterStopId: string) => {
    const idx = activeRoute.orderedStops.findIndex(
      (i) => i.stop.id === afterStopId
    );
    if (idx < 0) return;
    const nextCandidate =
      activeRoute.orderedStops
        .slice(idx + 1)
        .find((i) => !isStopCompletedInField(i)) ??
      activeRoute.orderedStops[idx + 1];
    if (nextCandidate) {
      onSelectActiveStop(nextCandidate.stop.id);
      onCenterOnStop(nextCandidate.stop.id);
    }
  };

  const handleMark = (status: UnitVisitStatus) => {
    onUpdateStopStatus(activeItem.stop.id, status);
    advanceToNext(activeItem.stop.id);
  };

  const handleSaveNote = () => {
    onUpdateStopDetails(activeItem.stop.id, { notes: draftNote.trim() });
    setNoteOpen(false);
  };

  return (
    <div
      className={`no-print absolute bottom-3 left-2.5 right-2.5 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[440px] sm:max-w-[calc(100%-24px)] z-[490] rounded-2xl border shadow-2xl backdrop-blur-md transition-colors ${
        nightMode
          ? 'bg-slate-950/95 border-slate-700 text-slate-100'
          : 'bg-white/95 border-amber-300 text-slate-900'
      }`}
    >
      {/* Top strip: Priest tabs + progress + Night toggle + Close */}
      <div
        className={`px-3 py-2 border-b flex items-center justify-between gap-2 ${
          nightMode ? 'border-slate-800' : 'border-slate-200'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto">
          {routes.length > 1 ? (
            routes.map((r) => {
              const active = r.priestId === activeRoute.priestId;
              return (
                <button
                  key={r.priestId}
                  type="button"
                  onClick={() => onChangePriest(r.priestId)}
                  className={`min-h-[28px] px-2 py-0.5 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? nightMode
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-900 text-white'
                      : nightMode
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: r.color }}
                  />
                  <span>Ks. {r.priestId}</span>
                </button>
              );
            })
          ) : (
            <span
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                nightMode ? 'text-amber-400' : 'text-amber-800'
              }`}
            >
              Kolęda w terenie
            </span>
          )}
          <span
            className={`text-[11px] font-mono tabular-nums whitespace-nowrap ${
              nightMode ? 'text-slate-400' : 'text-slate-500'
            }`}
          >
            {completedCount}/{totalStops}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleNightMode}
            title={nightMode ? 'Tryb dzienny' : 'Tryb wieczorny (ciemny)'}
            aria-label={nightMode ? 'Tryb dzienny' : 'Tryb wieczorny'}
            className={`min-w-[30px] min-h-[30px] inline-flex items-center justify-center rounded-lg transition-colors ${
              nightMode
                ? 'bg-slate-800 text-amber-300 hover:bg-slate-700'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {nightMode ? (
              <Sun className="w-3.5 h-3.5" />
            ) : (
              <Moon className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij kartę terenową"
            className={`min-w-[30px] min-h-[30px] inline-flex items-center justify-center rounded-lg transition-colors ${
              nightMode
                ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Active House Info */}
      <div className="p-3 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => onCenterOnStop(activeItem.stop.id)}
            className="flex items-start gap-2.5 min-w-0 text-left flex-1"
            title="Wycentruj ten dom na mapie"
          >
            <span
              className={`w-7 h-7 text-xs font-mono font-bold text-white flex items-center justify-center shrink-0 tabular-nums ${
                isBlock ? 'rounded-lg' : 'rounded-full'
              }`}
              style={{ backgroundColor: activeRoute.color }}
            >
              {activeItem.orderIndex}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={`text-[11px] font-mono tabular-nums ${
                    nightMode ? 'text-amber-300' : 'text-amber-800 font-semibold'
                  }`}
                >
                  ~{activeItem.arrivalTime}
                </span>
                {activeItem.stop.permanentDecline && (
                  <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-semibold">
                    Stała odmowa
                  </span>
                )}
                {!activeItem.stop.permanentDecline &&
                  activeItem.stop.lastYearStatus &&
                  activeItem.stop.lastYearStatus !== 'pending' && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        UNIT_STATUS_META[activeItem.stop.lastYearStatus]
                          .badgeClass
                      }`}
                    >
                      Rok temu:{' '}
                      {UNIT_STATUS_META[activeItem.stop.lastYearStatus].shortLabel}
                    </span>
                  )}
              </div>
              <div className="text-sm sm:text-base font-bold leading-snug truncate">
                {activeItem.stop.address || activeItem.stop.label}
              </div>
              {activeItem.stop.notes && (
                <div
                  className={`text-xs truncate mt-0.5 ${
                    nightMode ? 'text-slate-300' : 'text-slate-600'
                  }`}
                >
                  {activeItem.stop.notes}
                </div>
              )}
            </div>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onCenterOnStop(activeItem.stop.id)}
              title="Pokaż dom na środku mapy"
              aria-label="Wycentruj na mapie"
              className={`min-w-[34px] min-h-[34px] inline-flex items-center justify-center rounded-lg border ${
                nightMode
                  ? 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Crosshair className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setNoteOpen((v) => !v)}
              title="Notatka lub stała odmowa"
              aria-label="Notatka lub stała odmowa"
              className={`min-w-[34px] min-h-[34px] inline-flex items-center justify-center rounded-lg border ${
                noteOpen || activeItem.stop.notes || activeItem.stop.permanentDecline
                  ? nightMode
                    ? 'border-amber-500 bg-amber-950/60 text-amber-300'
                    : 'border-amber-300 bg-amber-50 text-amber-800'
                  : nightMode
                    ? 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <StickyNote className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Inline quick note + permanent decline drawer */}
        {noteOpen && (
          <div
            className={`p-2.5 rounded-xl border space-y-2 ${
              nightMode
                ? 'bg-slate-900 border-slate-700'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveNote();
                  }
                }}
                placeholder="Notatka (np. rodzina, chory, po 18:00)..."
                className={`flex-1 min-w-0 min-h-[36px] px-2.5 py-1 text-base sm:text-xs rounded-lg border focus:outline-none ${
                  nightMode
                    ? 'bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 focus:border-amber-500'
                    : 'bg-white border-slate-200 text-slate-900 focus:border-amber-600'
                }`}
              />
              <button
                type="button"
                onClick={handleSaveNote}
                className="min-h-[36px] px-3 py-1 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-600 rounded-lg shrink-0"
              >
                Zapisz
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(activeItem.stop.permanentDecline)}
                onChange={(e) =>
                  onUpdateStopDetails(activeItem.stop.id, {
                    permanentDecline: e.target.checked,
                    ...(e.target.checked
                      ? { visitStatus: 'declined', included: false }
                      : {}),
                  })
                }
                className="w-4 h-4 rounded border-slate-300 text-red-600"
              />
              <span className={nightMode ? 'text-red-300' : 'text-red-800 font-medium'}>
                Stała odmowa (pomiń w planach w kolejnych latach)
              </span>
            </label>
          </div>
        )}

        {/* Primary Action Buttons */}
        {isBlock ? (
          <button
            type="button"
            onClick={() => onOpenBlockUnits(activeItem.stop.id)}
            className="w-full min-h-[44px] px-3 py-2 text-xs sm:text-sm font-semibold text-white bg-amber-700 hover:bg-amber-600 rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
          >
            <Building2 className="w-4 h-4" />
            <span>Otwórz lokale bloku ({unitsTotal})</span>
          </button>
        ) : (
          <div className="grid grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={() => handleMark('accepted')}
              className={`min-h-[44px] px-1.5 py-1.5 text-[11px] font-semibold rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-colors ${
                currentStatus === 'accepted'
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : nightMode
                    ? 'bg-emerald-950/70 border-emerald-800 text-emerald-200 hover:bg-emerald-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Przyjęto</span>
            </button>
            <button
              type="button"
              onClick={() => handleMark('absent')}
              className={`min-h-[44px] px-1.5 py-1.5 text-[11px] font-semibold rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-colors ${
                currentStatus === 'absent'
                  ? 'bg-amber-600 border-amber-500 text-white'
                  : nightMode
                    ? 'bg-amber-950/70 border-amber-800 text-amber-200 hover:bg-amber-900'
                    : 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'
              }`}
            >
              <UserX className="w-4 h-4" />
              <span>Nieob.</span>
            </button>
            <button
              type="button"
              onClick={() => handleMark('declined')}
              className={`min-h-[44px] px-1.5 py-1.5 text-[11px] font-semibold rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-colors ${
                currentStatus === 'declined'
                  ? 'bg-red-600 border-red-500 text-white'
                  : nightMode
                    ? 'bg-red-950/70 border-red-800 text-red-200 hover:bg-red-900'
                    : 'bg-red-50 border-red-200 text-red-900 hover:bg-red-100'
              }`}
            >
              <Ban className="w-4 h-4" />
              <span>Odmowa</span>
            </button>
            <button
              type="button"
              onClick={() => handleMark('invited')}
              className={`min-h-[44px] px-1.5 py-1.5 text-[11px] font-semibold rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-colors ${
                currentStatus === 'invited'
                  ? 'bg-sky-600 border-sky-500 text-white'
                  : nightMode
                    ? 'bg-sky-950/70 border-sky-800 text-sky-200 hover:bg-sky-900'
                    : 'bg-sky-50 border-sky-200 text-sky-900 hover:bg-sky-100'
              }`}
            >
              <BellRing className="w-4 h-4" />
              <span>Zaprosz.</span>
            </button>
          </div>
        )}

        {/* Bottom Prev / Undo / Navigate / Next bar */}
        <div className="flex items-center justify-between gap-1.5 text-[11px]">
          <button
            type="button"
            disabled={!prevItem}
            onClick={() => {
              if (!prevItem) return;
              onSelectActiveStop(prevItem.stop.id);
              onCenterOnStop(prevItem.stop.id);
            }}
            className={`min-h-[34px] px-2.5 py-1 rounded-lg font-medium inline-flex items-center gap-1 disabled:opacity-35 ${
              nightMode
                ? 'bg-slate-900 text-slate-200 hover:bg-slate-800 border border-slate-700'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Poprzedni</span>
          </button>

          {currentStatus !== 'pending' && !isBlock && (
            <button
              type="button"
              onClick={() => onUpdateStopStatus(activeItem.stop.id, 'pending')}
              title="Przywróć status Oczekuje"
              className={`min-h-[34px] px-2 py-1 rounded-lg font-medium inline-flex items-center gap-1 ${
                nightMode
                  ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-700'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}

          {navUrl && (
            <a
              href={navUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`min-h-[34px] px-2.5 py-1 rounded-lg font-medium inline-flex items-center gap-1 border ${
                nightMode
                  ? 'bg-amber-950/60 border-amber-700 text-amber-200 hover:bg-amber-900/70'
                  : 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'
              }`}
            >
              <span>Nawiguj</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}

          <button
            type="button"
            disabled={!nextItem}
            onClick={() => {
              if (!nextItem) return;
              onSelectActiveStop(nextItem.stop.id);
              onCenterOnStop(nextItem.stop.id);
            }}
            className={`min-h-[34px] px-2.5 py-1 rounded-lg font-semibold inline-flex items-center gap-1 disabled:opacity-35 ml-auto ${
              nightMode
                ? 'bg-slate-800 text-white hover:bg-slate-700 border border-slate-600'
                : 'bg-slate-900 text-white hover:bg-slate-800'
            }`}
          >
            <span>
              {nextItem ? `Następny #${nextItem.orderIndex}` : 'Koniec'}
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
