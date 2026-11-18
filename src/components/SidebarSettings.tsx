import React, { useState } from 'react';
import { Calendar, Car, Footprints, HelpCircle, Smartphone } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import {
  PRIEST_PALETTE,
  PlanConfig,
  SeasonPlanConfig,
} from '../types/parish';
import {
  WEEKDAY_OPTIONS,
  parseWeekdaysMask,
  toggleWeekdayInMask,
} from '../utils/seasonScheduler';

interface SidebarSettingsProps {
  config: PlanConfig;
  seasonConfig: SeasonPlanConfig;
  onChangeConfig: (next: PlanConfig) => void;
  onChangeSeasonConfig: (next: SeasonPlanConfig) => void;
  onOpenGuide: () => void;
  onOpenSchedule?: () => void;
}

export const SidebarSettings: React.FC<SidebarSettingsProps> = ({
  config,
  seasonConfig,
  onChangeConfig,
  onChangeSeasonConfig,
  onOpenGuide,
  onOpenSchedule,
}) => {
  const [settingsTab, setSettingsTab] = useState<'route' | 'season'>('route');
  const activeWeekdays = parseWeekdaysMask(seasonConfig.weekdaysMask);

  return (
    <div>
      {/* Compact 2-Tab Segmented Switcher */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-slate-200 px-3 py-2.5">
        <div
          role="tablist"
          aria-label="Sekcje ustawień"
          className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100"
        >
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === 'route'}
            onClick={() => setSettingsTab('route')}
            className={`min-h-[40px] px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              settingsTab === 'route'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Księża i czas wizyty
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === 'season'}
            onClick={() => setSettingsTab('season')}
            className={`min-h-[40px] px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              settingsTab === 'season'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Kalendarz i aplikacja
          </button>
        </div>
      </div>

      {settingsTab === 'route' ? (
        <section className="p-4 sm:p-5 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Ustawienia trasy dziennej
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Dostosuj liczbę księży, sposób poruszania i domyślny czas wizyty.
            </p>
          </div>

          {/* Number of priests */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Liczba księży chodzących jednocześnie
            </label>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded-xl">
              {[1, 2, 3, 4].map((count) => {
                const active = config.priestCount === count;
                return (
                  <button
                    key={count}
                    type="button"
                    onClick={() =>
                      onChangeConfig({ ...config, priestCount: count })
                    }
                    className={`min-h-[40px] py-1.5 text-xs font-medium rounded-lg transition-colors tabular-nums ${
                      active
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {count} ks.
                  </button>
                );
              })}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-slate-500">
              {PRIEST_PALETTE.slice(0, config.priestCount).map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ backgroundColor: p.color }}
                  />
                  {p.name}
                </span>
              ))}
            </div>
          </div>

          {/* Travel mode */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Sposób przemieszczania się
            </label>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() =>
                  onChangeConfig({ ...config, travelMode: 'WALKING' })
                }
                className={`min-h-[42px] py-2 px-3 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors ${
                  config.travelMode === 'WALKING'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Footprints className="w-3.5 h-3.5" />
                <span>Pieszo (miasto)</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onChangeConfig({ ...config, travelMode: 'DRIVING' })
                }
                className={`min-h-[42px] py-2 px-3 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors ${
                  config.travelMode === 'DRIVING'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Car className="w-3.5 h-3.5" />
                <span>Samochodem (wieś)</span>
              </button>
            </div>
          </div>

          {/* Start time & Average visit duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="koleda-start-time"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Godzina startu
              </label>
              <input
                id="koleda-start-time"
                type="time"
                value={config.startTime}
                onChange={(e) =>
                  onChangeConfig({ ...config, startTime: e.target.value })
                }
                className="w-full min-h-[44px] px-3 py-2 text-base sm:text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600"
              />
            </div>
            <div>
              <label
                htmlFor="koleda-visit-duration"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Czas wizyty (min)
              </label>
              <input
                id="koleda-visit-duration"
                type="number"
                min={3}
                max={90}
                value={config.defaultVisitMinutes}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    defaultVisitMinutes: Math.max(
                      3,
                      Number.parseInt(e.target.value || '15', 10)
                    ),
                  })
                }
                className="w-full min-h-[44px] px-3 py-2 text-base sm:text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600"
              />
            </div>
          </div>

          <label className="flex items-center gap-3 min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/70 text-xs text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={config.returnToParish}
              onChange={(e) =>
                onChangeConfig({ ...config, returnToParish: e.target.checked })
              }
              className="w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600 shrink-0"
            />
            <span>Uwzględnij powrót pod kościół po ostatniej wizycie</span>
          </label>
        </section>
      ) : (
        <div className="divide-y divide-slate-200">
          <section className="p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-700" />
              <h3 className="text-sm font-semibold text-slate-900">
                Ramy czasowe całego okresu kolędy
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="settings-season-start-date"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Data rozpoczęcia
                </label>
                <input
                  id="settings-season-start-date"
                  type="date"
                  value={seasonConfig.startDate}
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    if (!nextStart) return;
                    const next: SeasonPlanConfig = {
                      ...seasonConfig,
                      startDate: nextStart,
                    };
                    if (next.endDate && next.endDate < nextStart) {
                      delete next.endDate;
                    }
                    onChangeSeasonConfig(next);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                />
              </div>
              <div>
                <label
                  htmlFor="settings-season-end-date"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Koniec okresu (opcjonalnie)
                </label>
                <input
                  id="settings-season-end-date"
                  type="date"
                  min={seasonConfig.startDate}
                  value={seasonConfig.endDate ?? ''}
                  onChange={(e) => {
                    const next: SeasonPlanConfig = { ...seasonConfig };
                    if (e.target.value) next.endDate = e.target.value;
                    else delete next.endDate;
                    onChangeSeasonConfig(next);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                />
              </div>
              <div>
                <label
                  htmlFor="settings-weekday-start"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Start (dni robocze)
                </label>
                <input
                  id="settings-weekday-start"
                  type="time"
                  value={seasonConfig.weekdayStartTime}
                  onChange={(e) =>
                    onChangeSeasonConfig({
                      ...seasonConfig,
                      weekdayStartTime: e.target.value,
                    })
                  }
                  className="w-full min-h-[44px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                />
              </div>
              <div>
                <label
                  htmlFor="settings-saturday-start"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Start (Sobota)
                </label>
                <input
                  id="settings-saturday-start"
                  type="time"
                  value={
                    seasonConfig.saturdayStartTime ||
                    seasonConfig.weekendStartTime
                  }
                  onChange={(e) =>
                    onChangeSeasonConfig({
                      ...seasonConfig,
                      saturdayStartTime: e.target.value,
                    })
                  }
                  className="w-full min-h-[44px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                />
              </div>
              <div>
                <label
                  htmlFor="settings-weekend-start"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Start (Niedziela)
                </label>
                <input
                  id="settings-weekend-start"
                  type="time"
                  value={seasonConfig.weekendStartTime}
                  onChange={(e) =>
                    onChangeSeasonConfig({
                      ...seasonConfig,
                      weekendStartTime: e.target.value,
                    })
                  }
                  className="w-full min-h-[44px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                />
              </div>
              <div>
                <label
                  htmlFor="settings-season-end-time"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Koniec dnia najpóźniej
                </label>
                <input
                  id="settings-season-end-time"
                  type="time"
                  value={seasonConfig.dailyEndTime}
                  onChange={(e) =>
                    onChangeSeasonConfig({
                      ...seasonConfig,
                      dailyEndTime: e.target.value,
                    })
                  }
                  className="w-full min-h-[44px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                />
              </div>
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-700 mb-1.5">
                Aktywne dni tygodnia
              </span>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAY_OPTIONS.map((opt) => {
                  const checked = activeWeekdays.has(opt.dayIndex);
                  return (
                    <button
                      key={opt.dayIndex}
                      type="button"
                      onClick={() =>
                        onChangeSeasonConfig({
                          ...seasonConfig,
                          weekdaysMask: toggleWeekdayInMask(
                            seasonConfig.weekdaysMask,
                            opt.dayIndex
                          ),
                        })
                      }
                      aria-pressed={checked}
                      title={opt.full}
                      className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                        checked
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {opt.short}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-amber-950">
                  Dni wolne i przerwy w ciągu dnia
                </span>
                <span className="text-[11px] font-mono tabular-nums text-amber-900">
                  Wolne: {seasonConfig.excludedDates?.length ?? 0} · Przerwy:{' '}
                  {seasonConfig.defaultBreaks?.length ?? 0}
                </span>
              </div>
              <p className="text-[11px] text-amber-900/90 leading-snug">
                Święta, I piątki, przerwy obiadowe/mszalne oraz reguły dzielenia
                ulic i podgląd całego sezonu ustawisz w kreatorze kalendarza.
              </p>
              {onOpenSchedule && (
                <button
                  type="button"
                  onClick={onOpenSchedule}
                  className="w-full min-h-[42px] px-3.5 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl transition-colors"
                >
                  Otwórz pełny kalendarz, przerwy i kreator →
                </button>
              )}
            </div>
          </section>

          <section className="p-4 sm:p-5 space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-amber-700" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Aplikacja na telefon i komputer
                </h3>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Zainstaluj Planer Kolędy na ekranie głównym (PWA), aby szybko
                otwierać listy wizyt i bloki także offline w terenie.
              </p>
            </div>
            <PWAInstallButton tone="light" />
            <button
              type="button"
              onClick={onOpenGuide}
              className="w-full min-h-[42px] px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
            >
              <HelpCircle className="w-4 h-4 text-amber-700" />
              <span>Jak to działa — krótki przewodnik</span>
            </button>
          </section>
        </div>
      )}
    </div>
  );
};
