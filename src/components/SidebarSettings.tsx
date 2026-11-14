import React from 'react';
import { Calendar, Car, Footprints, HelpCircle } from 'lucide-react';
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
}

export const SidebarSettings: React.FC<SidebarSettingsProps> = ({
  config,
  seasonConfig,
  onChangeConfig,
  onChangeSeasonConfig,
  onOpenGuide,
}) => {
  const activeWeekdays = parseWeekdaysMask(seasonConfig.weekdaysMask);

  return (
    <div className="divide-y divide-slate-200">
      <section className="p-4 sm:p-5 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Ustawienia kolędy
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Dostosuj liczbę księży, środek transportu i ramy czasowe wizyt.
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
                  className={`min-h-[38px] py-1.5 text-xs font-medium rounded-lg transition-colors tabular-nums ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {count} {count === 1 ? 'ksiądz' : 'księży'}
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
              className={`min-h-[40px] py-2 px-3 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors ${
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
              className={`min-h-[40px] py-2 px-3 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors ${
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
              Domyślna godzina startu
            </label>
            <input
              id="koleda-start-time"
              type="time"
              value={config.startTime}
              onChange={(e) =>
                onChangeConfig({ ...config, startTime: e.target.value })
              }
              className="w-full min-h-[42px] px-3 py-2 text-base sm:text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600"
            />
          </div>
          <div>
            <label
              htmlFor="koleda-visit-duration"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Śr. czas wizyty (min)
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
              className="w-full min-h-[42px] px-3 py-2 text-base sm:text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600"
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

      {/* Multi-day Season Schedule Parameters */}
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
              onChange={(e) =>
                onChangeSeasonConfig({
                  ...seasonConfig,
                  startDate: e.target.value,
                })
              }
              className="w-full min-h-[42px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
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
              className="w-full min-h-[42px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
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
              className="w-full min-h-[42px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
            />
          </div>
          <div>
            <label
              htmlFor="settings-weekend-start"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Start (sobota / niedziela)
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
              className="w-full min-h-[42px] px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
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
                  className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors ${
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
      </section>

      <section className="p-4 sm:p-5">
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
  );
};
