import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Loader2,
  MapPin,
  Plus,
  Search,
  Split,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  LatLng,
  PRIEST_PALETTE,
  ParishCenter,
  PlanConfig,
  VisitStop,
} from '../types/parish';
import {
  extractHouseNumberLabel,
  extractStreetName,
  isEvenHouseNumberStr,
} from '../utils/spatial';

interface SidebarStopsProps {
  parish: ParishCenter | null;
  boundary: LatLng[];
  stops: VisitStop[];
  config: PlanConfig;
  onToggleStreetIncluded: (stopIds: string[], included: boolean) => void;
  onAssignStreetPriest: (stopIds: string[], priestId: number) => void;
  onSetAllIncluded: (included: boolean) => void;
  onUpdateStop: (id: string, patch: Partial<VisitStop>) => void;
  onDeleteStop: (id: string) => void;
  onClearStops: () => void;
  onAutoPartition: () => void;
  onSelectStop: (id: string) => void;
  onGoToSetup: () => void;
  onComputeRoutes: () => void;
  isComputing: boolean;
}

export const SidebarStops: React.FC<SidebarStopsProps> = ({
  parish,
  boundary,
  stops,
  config,
  onToggleStreetIncluded,
  onAssignStreetPriest,
  onSetAllIncluded,
  onUpdateStop,
  onDeleteStop,
  onClearStops,
  onAutoPartition,
  onSelectStop,
  onGoToSetup,
  onComputeRoutes,
  isComputing,
}) => {
  const [filterText, setFilterText] = useState('');
  const [expandedStreets, setExpandedStreets] = useState<
    Record<string, boolean>
  >({});

  const activeStops = useMemo(
    () => stops.filter((s) => s.included !== false),
    [stops]
  );

  const outsideActiveCount = useMemo(
    () =>
      boundary.length >= 3
        ? activeStops.filter((s) => s.inBoundary === false).length
        : 0,
    [activeStops, boundary.length]
  );

  const streetGroups = useMemo(() => {
    const map: Record<string, VisitStop[]> = {};
    for (const stop of stops) {
      const street = extractStreetName(stop);
      if (!map[street]) map[street] = [];
      map[street].push(stop);
    }

    const q = filterText.trim().toLowerCase();
    return Object.entries(map)
      .map(([streetName, groupStops]) => {
        const matchingStops = q
          ? groupStops.filter(
              (s) =>
                streetName.toLowerCase().includes(q) ||
                s.address.toLowerCase().includes(q) ||
                (s.notes && s.notes.toLowerCase().includes(q))
            )
          : groupStops;
        return {
          streetName,
          allStops: groupStops,
          visibleStops: matchingStops,
        };
      })
      .filter((g) => g.visibleStops.length > 0)
      .sort((a, b) => a.streetName.localeCompare(b.streetName, 'pl'));
  }, [stops, filterText]);

  const toggleExpand = (streetName: string) => {
    setExpandedStreets((prev) => ({
      ...prev,
      [streetName]: !prev[streetName],
    }));
  };

  const selectStreetParity = (
    groupStops: VisitStop[],
    mode: 'all' | 'even' | 'odd' | 'none'
  ) => {
    if (mode === 'all') {
      onToggleStreetIncluded(
        groupStops.map((s) => s.id),
        true
      );
      return;
    }
    if (mode === 'none') {
      onToggleStreetIncluded(
        groupStops.map((s) => s.id),
        false
      );
      return;
    }

    const toInclude: string[] = [];
    const toExclude: string[] = [];
    for (const s of groupStops) {
      const numStr = extractHouseNumberLabel(s);
      const isEven = isEvenHouseNumberStr(numStr);
      const want =
        (mode === 'even' && isEven === true) ||
        (mode === 'odd' && isEven === false);
      if (want) toInclude.push(s.id);
      else toExclude.push(s.id);
    }
    if (toInclude.length > 0) onToggleStreetIncluded(toInclude, true);
    if (toExclude.length > 0) onToggleStreetIncluded(toExclude, false);
  };

  if (stops.length === 0) {
    return (
      <div className="p-6 sm:p-8 text-center space-y-4">
        <div className="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
          <MapPin className="w-5 h-5" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-sm font-semibold text-slate-900">
            Brak zapamiętanych ulic dla tej parafii
          </h2>
          <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
            Najpierw skonfiguruj teren parafii — zaznacz obszar lub kliknij
            wybrane ulice na mapie, aby pobrać z nich numery domów.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToSetup}
          className="min-h-[42px] px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center gap-1.5 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Skonfiguruj teren i ulice parafii</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stage 2 Header: Planning on saved parish territories */}
      <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3 bg-white">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Układanie planu kolędy
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              W dzisiejszym planie:{' '}
              <strong className="text-slate-900">{activeStops.length}</strong> z{' '}
              {stops.length} zapamiętanych domów ({streetGroups.length}{' '}
              {streetGroups.length === 1 ? 'ulica' : 'ulic'})
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToSetup}
            className="text-xs font-medium text-amber-800 hover:underline whitespace-nowrap shrink-0"
          >
            + Dodaj ulice
          </button>
        </div>

        {/* Batch selection bar */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSetAllIncluded(true)}
            className="min-h-[34px] px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1"
          >
            <CheckSquare className="w-3.5 h-3.5 text-amber-700" />
            Zaznacz wszystkie
          </button>
          <button
            type="button"
            onClick={() => onSetAllIncluded(false)}
            className="min-h-[34px] px-2.5 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1"
          >
            <Square className="w-3.5 h-3.5" />
            Odznacz
          </button>
          <button
            type="button"
            onClick={onClearStops}
            className="min-h-[34px] px-2.5 py-1 text-xs text-slate-500 hover:text-red-600 ml-auto"
          >
            Usuń bazę domów
          </button>
        </div>

        {activeStops.length > 1 && config.priestCount > 1 && (
          <button
            type="button"
            onClick={onAutoPartition}
            className="w-full min-h-[38px] py-2 px-3 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <Split className="w-3.5 h-3.5" />
            Podziel wybrane na {config.priestCount} księży według rejonów
          </button>
        )}

        {outsideActiveCount > 0 && (
          <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              {outsideActiveCount}{' '}
              {outsideActiveCount === 1
                ? 'wybrany adres leży'
                : 'wybrane adresy leżą'}{' '}
              poza narysowanym terenem parafii.
            </span>
          </div>
        )}

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filtruj po ulicy, numerze domu lub rodzinie..."
            className="w-full pl-8 pr-8 py-2 text-base sm:text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-amber-600"
          />
          {filterText && (
            <button
              type="button"
              onClick={() => setFilterText('')}
              aria-label="Wyczyść filtr"
              className="p-1 text-slate-400 hover:text-slate-700 absolute right-2 top-1/2 -translate-y-1/2"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Saved Street Accordions */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
        {streetGroups.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Brak zapisanych ulic lub domów pasujących do „{filterText}”.
          </div>
        ) : (
          streetGroups.map(({ streetName, allStops, visibleStops }) => {
            const includedCount = allStops.filter(
              (s) => s.included !== false
            ).length;
            const allChecked = includedCount === allStops.length;
            const someChecked = includedCount > 0 && includedCount < allStops.length;
            const isExpanded = !!expandedStreets[streetName];

            const activePriestIds = new Set(
              allStops.filter((s) => s.included !== false).map((s) => s.priestId)
            );
            const commonPriestId =
              activePriestIds.size === 1
                ? Array.from(activePriestIds)[0]
                : allStops[0]?.priestId ?? 1;

            return (
              <div key={streetName} className="bg-white">
                {/* Street summary row */}
                <div className="px-4 py-3 flex items-center gap-2.5 hover:bg-slate-50/70">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked;
                    }}
                    onChange={() =>
                      onToggleStreetIncluded(
                        allStops.map((s) => s.id),
                        !allChecked
                      )
                    }
                    aria-label={`Włącz ulicę ${streetName} do planu kolędy`}
                    className="w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600 cursor-pointer shrink-0"
                  />

                  <button
                    type="button"
                    onClick={() => toggleExpand(streetName)}
                    className="flex-1 min-w-0 text-left flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div
                        className={`text-xs sm:text-sm font-semibold truncate ${
                          includedCount > 0 ? 'text-slate-900' : 'text-slate-400'
                        }`}
                      >
                        {streetName}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        W planie: <strong>{includedCount}</strong>/{allStops.length}{' '}
                        {allStops.length === 1 ? 'dom' : 'domów'}
                      </div>
                    </div>
                  </button>

                  {config.priestCount > 1 && includedCount > 0 && (
                    <select
                      value={commonPriestId}
                      onChange={(e) =>
                        onAssignStreetPriest(
                          allStops.map((s) => s.id),
                          Number.parseInt(e.target.value, 10)
                        )
                      }
                      aria-label={`Przypisz księdza do ulicy ${streetName}`}
                      className="px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-amber-600 shrink-0"
                    >
                      {PRIEST_PALETTE.slice(0, config.priestCount).map((p) => (
                        <option key={p.id} value={p.id}>
                          Ks. {p.id}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={() => toggleExpand(streetName)}
                    aria-label={
                      isExpanded ? 'Zwiń listę domów' : 'Rozwiń listę domów'
                    }
                    className="min-w-[34px] min-h-[34px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 shrink-0"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {/* Expanded houses on this street */}
                {isExpanded && (
                  <div className="bg-slate-50/70 border-t border-slate-100 divide-y divide-slate-100">
                    {allStops.length > 2 && (
                      <div className="px-4 py-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-slate-500 mr-1">Wybierz:</span>
                        <button
                          type="button"
                          onClick={() => selectStreetParity(allStops, 'all')}
                          className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                        >
                          Wszystkie
                        </button>
                        <button
                          type="button"
                          onClick={() => selectStreetParity(allStops, 'even')}
                          className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                        >
                          Parzyste
                        </button>
                        <button
                          type="button"
                          onClick={() => selectStreetParity(allStops, 'odd')}
                          className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                        >
                          Nieparzyste
                        </button>
                        <button
                          type="button"
                          onClick={() => selectStreetParity(allStops, 'none')}
                          className="px-2 py-1 text-slate-500 hover:text-slate-800"
                        >
                          Żaden
                        </button>
                      </div>
                    )}

                    {visibleStops.map((stop) => {
                      const isIncluded = stop.included !== false;
                      const palette =
                        PRIEST_PALETTE.find((p) => p.id === stop.priestId) ??
                        PRIEST_PALETTE[0];
                      return (
                        <div
                          key={stop.id}
                          className={`px-4 py-2.5 transition-colors ${
                            isIncluded ? 'bg-white/80' : 'opacity-60'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isIncluded}
                              onChange={() =>
                                onUpdateStop(stop.id, { included: !isIncluded })
                              }
                              aria-label={`Uwzględnij ${stop.address}`}
                              className="w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600 shrink-0"
                            />
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{
                                backgroundColor: isIncluded
                                  ? palette.color
                                  : '#CBD5E1',
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => onSelectStop(stop.id)}
                              className="flex-1 min-w-0 text-left text-xs font-medium text-slate-900 hover:text-amber-800 truncate"
                            >
                              {stop.address}
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteStop(stop.id)}
                              aria-label="Usuń adres z bazy parafii"
                              title="Usuń na stałe z bazy parafii"
                              className="p-1 text-slate-400 hover:text-red-600 rounded shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {isIncluded && (
                            <div className="mt-2 pl-6 flex flex-wrap items-center gap-1.5">
                              <input
                                type="text"
                                value={stop.notes ?? ''}
                                onChange={(e) =>
                                  onUpdateStop(stop.id, {
                                    notes: e.target.value,
                                  })
                                }
                                aria-label="Rodzina lub uwagi"
                                placeholder="Rodzina / uwagi"
                                className="flex-1 min-w-[110px] px-2 py-1 text-base sm:text-xs bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-amber-600"
                              />
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={3}
                                  max={120}
                                  value={stop.durationMinutes}
                                  onChange={(e) =>
                                    onUpdateStop(stop.id, {
                                      durationMinutes: Math.max(
                                        3,
                                        Number.parseInt(
                                          e.target.value || '15',
                                          10
                                        )
                                      ),
                                    })
                                  }
                                  aria-label="Czas wizyty w minutach"
                                  className="w-12 px-1.5 py-1 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-800 text-right focus:outline-none focus:border-amber-600"
                                />
                                <span className="text-[11px] text-slate-500">
                                  min
                                </span>
                              </div>
                              {config.priestCount > 1 && (
                                <select
                                  value={stop.priestId}
                                  onChange={(e) =>
                                    onUpdateStop(stop.id, {
                                      priestId: Number.parseInt(
                                        e.target.value,
                                        10
                                      ),
                                    })
                                  }
                                  aria-label="Przypisany ksiądz"
                                  className="px-1.5 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-amber-600"
                                >
                                  {PRIEST_PALETTE.slice(
                                    0,
                                    config.priestCount
                                  ).map((p) => (
                                    <option key={p.id} value={p.id}>
                                      Ks. {p.id}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Primary action footer */}
      <div className="p-4 border-t border-slate-200 bg-white">
        <button
          type="button"
          disabled={!parish || activeStops.length === 0 || isComputing}
          onClick={onComputeRoutes}
          className="w-full min-h-[44px] py-2.5 px-4 text-sm font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl inline-flex items-center justify-center gap-2 transition-colors tabular-nums"
        >
          {isComputing && <Loader2 className="w-4 h-4 animate-spin" />}
          {isComputing
            ? 'Wyznaczanie optymalnych tras...'
            : `Wyznacz trasy (${activeStops.length} ${
                activeStops.length === 1 ? 'dom' : 'domów'
              })`}
        </button>
      </div>
    </div>
  );
};
