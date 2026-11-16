import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Clock,
  Layers,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  BuildingUnit,
  UnitVisitStatus,
  VisitStop,
} from '../types/parish';

interface BlockUnitsModalProps {
  stop: VisitStop | null;
  defaultVisitMinutes: number;
  onClose: () => void;
  onSave: (updated: VisitStop) => void;
  onSaveAndNext?: (updated: VisitStop) => void;
}

const MAX_UNITS_LIST = 200;

export const UNIT_STATUS_META: Record<
  UnitVisitStatus,
  { label: string; badgeClass: string; shortLabel: string }
> = {
  pending: {
    label: 'Oczekuje',
    shortLabel: 'Oczekuje',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  accepted: {
    label: 'Przyjęto',
    shortLabel: 'Przyjęto',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  absent: {
    label: 'Nieobecni',
    shortLabel: 'Nieobecni',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  declined: {
    label: 'Nie przyjmuje',
    shortLabel: 'Odmowa',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
  },
  invited: {
    label: 'Na zaproszenie',
    shortLabel: 'Zaproszenie',
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
  },
};

export function formatUnitAddressLine(
  buildingAddress: string,
  unit: Pick<BuildingUnit, 'staircase' | 'unitNumber'>
): string {
  const shortBuilding = buildingAddress.split(',')[0]?.trim() || buildingAddress;
  const staircase = (unit.staircase ?? '').trim();
  const num = unit.unitNumber.trim();
  if (staircase) {
    return `${shortBuilding} kl. ${staircase} m. ${num}`;
  }
  return `${shortBuilding}/${num}`;
}

export const BlockUnitsModal: React.FC<BlockUnitsModalProps> = ({
  stop,
  defaultVisitMinutes,
  onClose,
  onSave,
  onSaveAndNext,
}) => {
  const [isMultiUnit, setIsMultiUnit] = useState(true);
  const [minutesPerUnit, setMinutesPerUnit] = useState(10);
  const [estimatedCount, setEstimatedCount] = useState(15);
  const [manualDurationMinutes, setManualDurationMinutes] = useState(150);
  const [autoCalcDuration, setAutoCalcDuration] = useState(true);
  const [units, setUnits] = useState<BuildingUnit[]>([]);

  // Generator controls
  const [genStaircaseCount, setGenStaircaseCount] = useState(1);
  const [genStaircaseStyle, setGenStaircaseStyle] = useState<
    'letters' | 'roman' | 'numbers'
  >('letters');
  const [genNumberingMode, setGenNumberingMode] = useState<
    'continuous' | 'per_staircase'
  >('continuous');
  const [genStaircase, setGenStaircase] = useState('');
  const [genFrom, setGenFrom] = useState('1');
  const [genTo, setGenTo] = useState('15');
  const [genPerStaircaseCount, setGenPerStaircaseCount] = useState('12');

  // Single unit add controls
  const [addStaircase, setAddStaircase] = useState('');
  const [addNumber, setAddNumber] = useState('');
  const [addFamily, setAddFamily] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | UnitVisitStatus>('all');
  const [limitNotice, setLimitNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!stop) return;
    const existingUnits = Array.isArray(stop.units)
      ? stop.units.map((u) => ({ ...u }))
      : [];
    const perUnit = Math.max(
      1,
      Math.min(60, stop.minutesPerUnit ?? Math.min(12, defaultVisitMinutes || 10))
    );
    const hasBlock = Boolean(stop.isMultiUnit || existingUnits.length > 0);
    const count =
      existingUnits.length > 0
        ? existingUnits.length
        : Math.max(1, stop.unitsCount || (hasBlock ? 15 : 10));

    setIsMultiUnit(hasBlock || true);
    setUnits(existingUnits);
    setMinutesPerUnit(perUnit);
    setEstimatedCount(count);
    setAutoCalcDuration(true);
    setManualDurationMinutes(
      hasBlock ? stop.durationMinutes : Math.min(1440, count * perUnit)
    );
    setGenStaircaseCount(1);
    setGenStaircaseStyle('letters');
    setGenNumberingMode('continuous');
    setGenStaircase('');
    setGenFrom(String(existingUnits.length + 1));
    setGenTo(String(existingUnits.length + 15));
    setGenPerStaircaseCount('12');
    setAddStaircase('');
    setAddNumber('');
    setAddFamily('');
    setSearchQuery('');
    setStatusFilter('all');
    setLimitNotice(null);
  }, [stop, defaultVisitMinutes]);

  useEffect(() => {
    if (!stop) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stop, onClose]);

  const effectiveUnitsCount = useMemo(() => {
    if (!isMultiUnit) return 1;
    if (units.length > 0) return units.length;
    return Math.max(1, Math.min(500, estimatedCount || 1));
  }, [isMultiUnit, units.length, estimatedCount]);

  const computedDurationMinutes = useMemo(() => {
    if (!isMultiUnit) {
      return Math.max(3, Math.min(1440, manualDurationMinutes || defaultVisitMinutes));
    }
    const activeVisitUnits =
      units.length > 0
        ? units.filter((u) => u.status !== 'declined' && u.status !== 'absent')
            .length || units.length
        : effectiveUnitsCount;
    return Math.max(
      5,
      Math.min(1440, activeVisitUnits * Math.max(1, minutesPerUnit))
    );
  }, [
    isMultiUnit,
    units,
    effectiveUnitsCount,
    minutesPerUnit,
    manualDurationMinutes,
    defaultVisitMinutes,
  ]);

  const finalDurationMinutes = autoCalcDuration
    ? computedDurationMinutes
    : Math.max(1, Math.min(1440, manualDurationMinutes || 15));

  const statusCounts = useMemo(() => {
    const counts: Record<UnitVisitStatus, number> = {
      pending: 0,
      accepted: 0,
      absent: 0,
      declined: 0,
      invited: 0,
    };
    for (const u of units) {
      const st = u.status ?? 'pending';
      counts[st] = (counts[st] ?? 0) + 1;
    }
    return counts;
  }, [units]);

  const lastYearDeclinedPendingCount = useMemo(
    () =>
      units.filter(
        (u) =>
          u.lastYearStatus === 'declined' &&
          (u.status ?? 'pending') === 'pending'
      ).length,
    [units]
  );

  const filteredUnits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return units.filter((u) => {
      if (statusFilter !== 'all' && (u.status ?? 'pending') !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        u.unitNumber.toLowerCase().includes(q) ||
        (u.staircase ?? '').toLowerCase().includes(q) ||
        (u.familyName ?? '').toLowerCase().includes(q) ||
        (u.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [units, searchQuery, statusFilter]);

  if (!stop) return null;

  const shortBuildingAddr = stop.address.split(',')[0]?.trim() || stop.address;

  const getStaircaseLabel = (
    idx: number,
    style: 'letters' | 'roman' | 'numbers'
  ): string => {
    if (style === 'numbers') return String(idx + 1);
    if (style === 'roman') {
      const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
      return romans[idx] ?? String(idx + 1);
    }
    return String.fromCharCode(65 + idx);
  };

  const handleGenerateRange = () => {
    const existingKeys = new Set(
      units.map(
        (u) => `${(u.staircase ?? '').trim().toLowerCase()}::${u.unitNumber.trim().toLowerCase()}`
      )
    );

    const added: BuildingUnit[] = [];
    let truncated = false;
    let lastGeneratedNumber = Number.parseInt(genFrom, 10) || 0;

    if (genStaircaseCount <= 1) {
      const from = Number.parseInt(genFrom, 10);
      const to = Number.parseInt(genTo, 10);
      if (Number.isNaN(from) || Number.isNaN(to) || from < 1 || to < from) {
        return;
      }
      const cleanStair = genStaircase.trim().slice(0, 30);
      for (let n = from; n <= to; n++) {
        if (units.length + added.length >= MAX_UNITS_LIST) {
          truncated = true;
          break;
        }
        const numStr = String(n);
        const key = `${cleanStair.toLowerCase()}::${numStr.toLowerCase()}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        added.push({
          id: `u_${Date.now()}_${n}_${Math.random().toString(36).slice(2, 6)}`,
          unitNumber: numStr,
          staircase: cleanStair,
          familyName: '',
          notes: '',
          status: 'pending',
        });
        lastGeneratedNumber = n;
      }
      if (added.length > 0) {
        setGenFrom(String(lastGeneratedNumber + 1));
        setGenTo(String(lastGeneratedNumber + 15));
      }
    } else {
      const startNum = Math.max(1, Number.parseInt(genFrom, 10) || 1);
      const perStair = Math.max(
        1,
        Math.min(60, Number.parseInt(genPerStaircaseCount, 10) || 12)
      );
      const stairCount = Math.max(2, Math.min(10, genStaircaseCount));
      let runningNum = startNum;

      for (let sIdx = 0; sIdx < stairCount; sIdx++) {
        const stairLabel = getStaircaseLabel(sIdx, genStaircaseStyle);
        const localStart =
          genNumberingMode === 'continuous' ? runningNum : startNum;
        for (let k = 0; k < perStair; k++) {
          if (units.length + added.length >= MAX_UNITS_LIST) {
            truncated = true;
            break;
          }
          const numVal = localStart + k;
          const numStr = String(numVal);
          const key = `${stairLabel.toLowerCase()}::${numStr.toLowerCase()}`;
          if (!existingKeys.has(key)) {
            existingKeys.add(key);
            added.push({
              id: `u_${Date.now()}_${sIdx}_${numVal}_${Math.random()
                .toString(36)
                .slice(2, 6)}`,
              unitNumber: numStr,
              staircase: stairLabel,
              familyName: '',
              notes: '',
              status: 'pending',
            });
          }
          lastGeneratedNumber = numVal;
        }
        if (genNumberingMode === 'continuous') {
          runningNum += perStair;
        }
        if (truncated) break;
      }
      if (added.length > 0 && genNumberingMode === 'continuous') {
        setGenFrom(String(lastGeneratedNumber + 1));
      }
    }

    if (added.length > 0) {
      const nextUnits = [...units, ...added];
      setUnits(nextUnits);
      setEstimatedCount(nextUnits.length);
      setIsMultiUnit(true);
    }
    setLimitNotice(
      truncated
        ? `Maksymalna rozpiska dla jednego budynku wynosi ${MAX_UNITS_LIST} lokali.`
        : null
    );
  };

  const handleAddSingleUnit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = addNumber.trim().slice(0, 30);
    if (!num) return;
    if (units.length >= MAX_UNITS_LIST) {
      setLimitNotice(
        `Maksymalna rozpiska dla jednego budynku wynosi ${MAX_UNITS_LIST} lokali.`
      );
      return;
    }
    const nextUnit: BuildingUnit = {
      id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      unitNumber: num,
      staircase: addStaircase.trim().slice(0, 30),
      familyName: addFamily.trim().slice(0, 120),
      notes: '',
      status: 'pending',
    };
    const nextUnits = [...units, nextUnit];
    setUnits(nextUnits);
    setEstimatedCount(nextUnits.length);
    setIsMultiUnit(true);
    setAddNumber('');
    setAddFamily('');
    setLimitNotice(null);
  };

  const handleUpdateUnit = (id: string, patch: Partial<BuildingUnit>) => {
    setUnits((prev) =>
      prev.map((u) => (u.id === id ? { ...u, ...patch } : u))
    );
  };

  const handleDeleteUnit = (id: string) => {
    setUnits((prev) => prev.filter((u) => u.id !== id));
    setLimitNotice(null);
  };

  const handleBatchStatus = (nextStatus: UnitVisitStatus) => {
    const visibleIds = new Set(filteredUnits.map((u) => u.id));
    if (visibleIds.size === 0) return;
    setUnits((prev) =>
      prev.map((u) =>
        visibleIds.has(u.id) ? { ...u, status: nextStatus } : u
      )
    );
  };

  const buildUpdatedStopPayload = (): VisitStop => {
    if (!isMultiUnit) {
      return {
        ...stop,
        isMultiUnit: false,
        unitsCount: 0,
        minutesPerUnit: defaultVisitMinutes,
        units: [],
        durationMinutes: Math.max(
          1,
          Math.min(1440, manualDurationMinutes || defaultVisitMinutes)
        ),
      };
    }

    const cleanedUnits = units.slice(0, MAX_UNITS_LIST);
    const finalUnitsCount =
      cleanedUnits.length > 0
        ? cleanedUnits.length
        : Math.max(1, Math.min(500, estimatedCount || 1));

    return {
      ...stop,
      isMultiUnit: true,
      unitsCount: finalUnitsCount,
      minutesPerUnit: Math.max(1, Math.min(60, minutesPerUnit || 10)),
      units: cleanedUnits,
      durationMinutes: finalDurationMinutes,
    };
  };

  const handleSaveBlock = () => {
    onSave(buildUpdatedStopPayload());
    onClose();
  };

  const handleSaveBlockAndNext = () => {
    const payload = buildUpdatedStopPayload();
    if (onSaveAndNext) {
      onSaveAndNext(payload);
    } else {
      onSave(payload);
    }
    onClose();
  };

  const totalHoursLabel =
    finalDurationMinutes >= 60
      ? `${Math.floor(finalDurationMinutes / 60)} godz. ${
          finalDurationMinutes % 60 > 0
            ? `${finalDurationMinutes % 60} min`
            : ''
        }`.trim()
      : `${finalDurationMinutes} min`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="block-units-modal-title"
      className="fixed inset-0 z-[1250] bg-slate-950/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-3xl max-h-[94dvh] sm:max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3.5 sm:px-6 sm:py-4 border-b border-slate-200 flex items-start justify-between gap-3 bg-white shrink-0">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 uppercase tracking-wide">
              <Building2 className="w-3.5 h-3.5" />
              Rozpiska lokali i adresów w budynku
            </div>
            <h2
              id="block-units-modal-title"
              className="text-sm sm:text-base font-bold text-slate-900 truncate mt-0.5"
            >
              {stop.address || stop.label}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij"
            className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5 bg-slate-50/50">
          {/* Top building type + time configuration */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isMultiUnit}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIsMultiUnit(checked);
                    if (!checked) {
                      setManualDurationMinutes(defaultVisitMinutes);
                    }
                  }}
                  className="w-4 h-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600"
                />
                <span className="text-xs sm:text-sm font-semibold text-slate-900">
                  Budynek wielorodzinny / Blok (1 punkt na mapie, wiele lokali)
                </span>
              </label>

              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-900 tabular-nums">
                <Clock className="w-3.5 h-3.5 text-amber-700" />
                Łączny postój: {totalHoursLabel}
              </span>
            </div>

            {isMultiUnit ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div>
                  <label
                    htmlFor="block-units-count"
                    className="block text-[11px] font-medium text-slate-600 mb-1"
                  >
                    {units.length > 0
                      ? 'Lokali w rozpisce'
                      : 'Liczba lokali w bloku'}
                  </label>
                  <input
                    id="block-units-count"
                    type="number"
                    min={1}
                    max={500}
                    disabled={units.length > 0}
                    value={effectiveUnitsCount}
                    onChange={(e) =>
                      setEstimatedCount(
                        Math.max(
                          1,
                          Math.min(500, Number.parseInt(e.target.value || '1', 10))
                        )
                      )
                    }
                    className="w-full min-h-[40px] px-3 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-xl text-slate-900 disabled:text-slate-600 focus:bg-white focus:outline-none focus:border-amber-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="block-min-per-unit"
                    className="block text-[11px] font-medium text-slate-600 mb-1"
                  >
                    Śr. czas na 1 lokal (min)
                  </label>
                  <input
                    id="block-min-per-unit"
                    type="number"
                    min={1}
                    max={60}
                    value={minutesPerUnit}
                    onChange={(e) =>
                      setMinutesPerUnit(
                        Math.max(
                          1,
                          Math.min(60, Number.parseInt(e.target.value || '10', 10))
                        )
                      )
                    }
                    className="w-full min-h-[40px] px-3 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="block-total-duration"
                      className="block text-[11px] font-medium text-slate-600"
                    >
                      Czas bloku w trasie (min)
                    </label>
                    <button
                      type="button"
                      onClick={() => setAutoCalcDuration((v) => !v)}
                      className="text-[11px] font-medium text-amber-800 hover:underline"
                    >
                      {autoCalcDuration ? 'Ręcznie' : 'Auto'}
                    </button>
                  </div>
                  <input
                    id="block-total-duration"
                    type="number"
                    min={1}
                    max={1440}
                    disabled={autoCalcDuration}
                    value={finalDurationMinutes}
                    onChange={(e) => {
                      setAutoCalcDuration(false);
                      setManualDurationMinutes(
                        Math.max(
                          1,
                          Math.min(
                            1440,
                            Number.parseInt(e.target.value || '15', 10)
                          )
                        )
                      );
                    }}
                    className="w-full min-h-[40px] px-3 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-xl text-slate-900 disabled:text-slate-600 focus:bg-white focus:outline-none focus:border-amber-600"
                  />
                </div>
              </div>
            ) : (
              <div className="max-w-xs">
                <label
                  htmlFor="single-house-duration"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Czas wizyty w domu (min)
                </label>
                <input
                  id="single-house-duration"
                  type="number"
                  min={1}
                  max={1440}
                  value={manualDurationMinutes}
                  onChange={(e) =>
                    setManualDurationMinutes(
                      Math.max(
                        1,
                        Math.min(
                          1440,
                          Number.parseInt(e.target.value || '15', 10)
                        )
                      )
                    )
                  }
                  className="w-full min-h-[40px] px-3 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                />
              </div>
            )}

            {isMultiUnit && (
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Na mapie blok zajmuje tylko <strong>1 bezpłatny punkt nawigacji</strong>,
                ale planer rezerwuje pełny czas potrzebny na przejście przez wszystkie
                mieszkania w budynku.
              </p>
            )}
          </div>

          {isMultiUnit && (
            <>
              {/* Quick Range Generator */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-700 shrink-0" />
                    <h3 className="text-xs sm:text-sm font-semibold text-slate-900">
                      Szybki generator lokali i klatek
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    {units.length} / {MAX_UNITS_LIST} pozycji
                  </span>
                </div>

                <div className="space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label
                        htmlFor="gen-stair-count"
                        className="block text-[11px] font-medium text-slate-600 mb-1"
                      >
                        Liczba klatek
                      </label>
                      <select
                        id="gen-stair-count"
                        value={genStaircaseCount}
                        onChange={(e) =>
                          setGenStaircaseCount(
                            Number.parseInt(e.target.value, 10) || 1
                          )
                        }
                        className="w-full min-h-[38px] px-2.5 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                      >
                        <option value={1}>1 klatka (lub bez podziału)</option>
                        {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => (
                          <option key={c} value={c}>
                            {c} klatki / klatek naraz
                          </option>
                        ))}
                      </select>
                    </div>

                    {genStaircaseCount > 1 && (
                      <>
                        <div>
                          <label
                            htmlFor="gen-stair-style"
                            className="block text-[11px] font-medium text-slate-600 mb-1"
                          >
                            Oznaczenie klatek
                          </label>
                          <select
                            id="gen-stair-style"
                            value={genStaircaseStyle}
                            onChange={(e) =>
                              setGenStaircaseStyle(
                                e.target.value as 'letters' | 'roman' | 'numbers'
                              )
                            }
                            className="w-full min-h-[38px] px-2.5 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                          >
                            <option value="letters">Litery: A, B, C...</option>
                            <option value="roman">Rzymskie: I, II, III...</option>
                            <option value="numbers">Cyfry: 1, 2, 3...</option>
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor="gen-num-mode"
                            className="block text-[11px] font-medium text-slate-600 mb-1"
                          >
                            Numeracja lokali
                          </label>
                          <select
                            id="gen-num-mode"
                            value={genNumberingMode}
                            onChange={(e) =>
                              setGenNumberingMode(
                                e.target.value as 'continuous' | 'per_staircase'
                              )
                            }
                            className="w-full min-h-[38px] px-2.5 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                          >
                            <option value="continuous">
                              Ciągła (np. kl. A 1–12, kl. B 13–24)
                            </option>
                            <option value="per_staircase">
                              Od nowa w każdej klatce
                            </option>
                          </select>
                        </div>
                      </>
                    )}
                  </div>

                  {genStaircaseCount <= 1 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label
                          htmlFor="gen-staircase"
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          Klatka (opcjonalnie)
                        </label>
                        <input
                          id="gen-staircase"
                          type="text"
                          value={genStaircase}
                          onChange={(e) => setGenStaircase(e.target.value)}
                          placeholder="np. A lub I"
                          className="w-full min-h-[38px] px-2.5 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="gen-from"
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          Od numeru
                        </label>
                        <input
                          id="gen-from"
                          type="number"
                          min={1}
                          max={999}
                          value={genFrom}
                          onChange={(e) => setGenFrom(e.target.value)}
                          className="w-full min-h-[38px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="gen-to"
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          Do numeru
                        </label>
                        <input
                          id="gen-to"
                          type="number"
                          min={1}
                          max={999}
                          value={genTo}
                          onChange={(e) => setGenTo(e.target.value)}
                          className="w-full min-h-[38px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={handleGenerateRange}
                          className="w-full min-h-[38px] px-3 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          <span>Generuj lokale</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div>
                        <label
                          htmlFor="gen-multi-from"
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          Start od numeru
                        </label>
                        <input
                          id="gen-multi-from"
                          type="number"
                          min={1}
                          max={999}
                          value={genFrom}
                          onChange={(e) => setGenFrom(e.target.value)}
                          className="w-full min-h-[38px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="gen-per-stair"
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          Lokali w każdej klatce
                        </label>
                        <input
                          id="gen-per-stair"
                          type="number"
                          min={1}
                          max={60}
                          value={genPerStaircaseCount}
                          onChange={(e) => setGenPerStaircaseCount(e.target.value)}
                          className="w-full min-h-[38px] px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-amber-600"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1 flex items-end">
                        <button
                          type="button"
                          onClick={handleGenerateRange}
                          className="w-full min-h-[38px] px-3 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors tabular-nums"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          <span>
                            Generuj {genStaircaseCount} klatek (
                            {genStaircaseCount *
                              Math.max(
                                1,
                                Math.min(
                                  60,
                                  Number.parseInt(genPerStaircaseCount, 10) || 12
                                )
                              )}{' '}
                            lok.)
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Add single unit */}
                <form
                  onSubmit={handleAddSingleUnit}
                  className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2"
                >
                  <input
                    type="text"
                    value={addStaircase}
                    onChange={(e) => setAddStaircase(e.target.value)}
                    placeholder="Klatka"
                    aria-label="Klatka"
                    className="w-20 min-h-[36px] px-2.5 py-1 text-base sm:text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-amber-600"
                  />
                  <input
                    type="text"
                    value={addNumber}
                    onChange={(e) => setAddNumber(e.target.value)}
                    placeholder="Nr lokalu (np. 12A)"
                    aria-label="Numer lokalu"
                    className="w-32 min-h-[36px] px-2.5 py-1 text-base sm:text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-amber-600"
                  />
                  <input
                    type="text"
                    value={addFamily}
                    onChange={(e) => setAddFamily(e.target.value)}
                    placeholder="Nazwisko rodziny (opcjonalnie)"
                    aria-label="Nazwisko rodziny"
                    className="flex-1 min-w-[140px] min-h-[36px] px-2.5 py-1 text-base sm:text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-amber-600"
                  />
                  <button
                    type="submit"
                    disabled={!addNumber.trim()}
                    className="min-h-[36px] px-3 py-1 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Dodaj lokal
                  </button>
                </form>

                {limitNotice && (
                  <p className="text-xs text-amber-800 font-medium">
                    {limitNotice}
                  </p>
                )}
              </div>

              {/* Units List & Fara-style batch statuses */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="p-3.5 sm:p-4 border-b border-slate-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs sm:text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-amber-700" />
                      <span>
                        Adresy w bloku {shortBuildingAddr} ({units.length})
                      </span>
                    </h3>
                    {units.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setUnits([])}
                        className="text-xs text-slate-500 hover:text-red-600"
                      >
                        Wyczyść listę lokali
                      </button>
                    )}
                  </div>

                  {units.length > 0 && (
                    <>
                      {/* Status filter chips + search */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setStatusFilter('all')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors tabular-nums ${
                            statusFilter === 'all'
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          Wszystkie ({units.length})
                        </button>
                        {(Object.keys(UNIT_STATUS_META) as UnitVisitStatus[]).map(
                          (st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => setStatusFilter(st)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors tabular-nums ${
                                statusFilter === st
                                  ? 'bg-slate-900 text-white'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              }`}
                            >
                              {UNIT_STATUS_META[st].shortLabel} (
                              {statusCounts[st] ?? 0})
                            </button>
                          )
                        )}
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Szukaj lokalu, klatki lub rodziny..."
                            className="w-full pl-8 pr-3 py-1.5 text-base sm:text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-amber-600"
                          />
                        </div>

                        {filteredUnits.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 text-[11px]">
                            <span className="text-slate-500 mr-0.5">
                              Seryjnie:
                            </span>
                            <button
                              type="button"
                              onClick={() => handleBatchStatus('accepted')}
                              className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 font-medium"
                            >
                              Przyjęto
                            </button>
                            <button
                              type="button"
                              onClick={() => handleBatchStatus('absent')}
                              className="px-2 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 font-medium"
                            >
                              Nieobecni
                            </button>
                            <button
                              type="button"
                              onClick={() => handleBatchStatus('pending')}
                              className="px-2 py-1 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium"
                            >
                              Resetuj
                            </button>
                          </div>
                        )}
                      </div>

                      {lastYearDeclinedPendingCount > 0 && (
                        <div className="p-2 rounded-lg bg-red-50/70 border border-red-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-red-900">
                          <span>
                            Wykryto <strong>{lastYearDeclinedPendingCount}</strong>{' '}
                            {lastYearDeclinedPendingCount === 1
                              ? 'mieszkanie ze zeszłoroczną odmową'
                              : 'mieszkań z odmową w zeszłym roku'}.
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setUnits((prev) =>
                                prev.map((u) =>
                                  u.lastYearStatus === 'declined' &&
                                  (u.status ?? 'pending') === 'pending'
                                    ? { ...u, status: 'declined' }
                                    : u
                                )
                              )
                            }
                            className="px-2.5 py-1 rounded-md bg-white hover:bg-red-100 border border-red-300 text-red-800 font-semibold shrink-0"
                          >
                            Oznacz zeszłoroczne odmowy ({lastYearDeclinedPendingCount})
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {units.length === 0 ? (
                  <div className="p-6 text-center space-y-2">
                    <p className="text-xs font-medium text-slate-700">
                      Brak indywidualnej rozpiski mieszkań w tym bloku
                    </p>
                    <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                      Możesz zostawić szacunkową liczbę lokali ({estimatedCount}{' '}
                      lok.) albo wygenerować numery mieszkań powyżej (np. od 1 do
                      20), aby mieć dokładną listę adresów w bloku i notować
                      obecność rodzin.
                    </p>
                  </div>
                ) : filteredUnits.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    Brak lokali pasujących do wybranego filtra.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                    {filteredUnits.map((unit) => {
                      const status = unit.status ?? 'pending';
                      const exactUnitAddress = formatUnitAddressLine(
                        stop.address || stop.label,
                        unit
                      );
                      return (
                        <div
                          key={unit.id}
                          className="px-3.5 py-2.5 hover:bg-slate-50/70 space-y-2 sm:space-y-0 sm:flex sm:items-center sm:gap-2"
                        >
                          {/* Full apartment address */}
                          <div className="min-w-[145px] sm:w-[175px] shrink-0">
                            <div className="text-xs font-semibold text-slate-900 tabular-nums truncate">
                              {exactUnitAddress}
                            </div>
                            {unit.lastYearStatus && unit.lastYearStatus !== 'pending' && (
                              <div className="mt-0.5">
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                    UNIT_STATUS_META[unit.lastYearStatus]
                                      .badgeClass
                                  }`}
                                >
                                  Rok temu:{' '}
                                  {
                                    UNIT_STATUS_META[unit.lastYearStatus]
                                      .shortLabel
                                  }
                                </span>
                              </div>
                            )}
                            <div className="flex items-center gap-1 mt-0.5">
                              <input
                                type="text"
                                value={unit.staircase ?? ''}
                                onChange={(e) =>
                                  handleUpdateUnit(unit.id, {
                                    staircase: e.target.value,
                                  })
                                }
                                placeholder="klatka"
                                aria-label="Klatka"
                                className="w-14 px-1.5 py-0.5 text-[11px] bg-slate-50 border border-slate-200 rounded text-slate-700 focus:bg-white focus:outline-none focus:border-amber-600"
                              />
                              <input
                                type="text"
                                value={unit.unitNumber}
                                onChange={(e) =>
                                  handleUpdateUnit(unit.id, {
                                    unitNumber: e.target.value,
                                  })
                                }
                                placeholder="nr"
                                aria-label="Numer lokalu"
                                className="w-14 px-1.5 py-0.5 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded text-slate-800 focus:bg-white focus:outline-none focus:border-amber-600"
                              />
                            </div>
                          </div>

                          {/* Family name + notes */}
                          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            <input
                              type="text"
                              value={unit.familyName ?? ''}
                              onChange={(e) =>
                                handleUpdateUnit(unit.id, {
                                  familyName: e.target.value,
                                })
                              }
                              placeholder="Rodzina / nazwisko"
                              aria-label={`Rodzina pod adresem ${exactUnitAddress}`}
                              className="px-2 py-1 text-base sm:text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-amber-600"
                            />
                            <input
                              type="text"
                              value={unit.notes ?? ''}
                              onChange={(e) =>
                                handleUpdateUnit(unit.id, {
                                  notes: e.target.value,
                                })
                              }
                              placeholder="Uwagi (np. po 18:00)"
                              aria-label={`Uwagi dla ${exactUnitAddress}`}
                              className="px-2 py-1 text-base sm:text-xs bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-amber-600"
                            />
                          </div>

                          {/* Status + delete */}
                          <div className="flex items-center justify-between sm:justify-end gap-1.5 shrink-0">
                            <select
                              value={status}
                              onChange={(e) =>
                                handleUpdateUnit(unit.id, {
                                  status: e.target.value as UnitVisitStatus,
                                })
                              }
                              aria-label={`Status dla ${exactUnitAddress}`}
                              className={`px-2 py-1 text-xs font-medium rounded-lg border focus:outline-none focus:border-amber-600 ${
                                UNIT_STATUS_META[status].badgeClass
                              }`}
                            >
                              {(
                                Object.keys(
                                  UNIT_STATUS_META
                                ) as UnitVisitStatus[]
                              ).map((st) => (
                                <option key={st} value={st}>
                                  {UNIT_STATUS_META[st].label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleDeleteUnit(unit.id)}
                              aria-label={`Usuń lokal ${exactUnitAddress}`}
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-600 tabular-nums">
            {isMultiUnit ? (
              <>
                <strong className="text-slate-900">
                  Blok ({effectiveUnitsCount} lok.)
                </strong>{' '}
                · Szacowany czas postoju:{' '}
                <strong className="text-amber-800">{totalHoursLabel}</strong>
              </>
            ) : (
              <>
                Pojedynczy dom ·{' '}
                <strong className="text-slate-900">
                  {finalDurationMinutes} min
                </strong>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              Anuluj
            </button>
            <button
              type="button"
              onClick={handleSaveBlock}
              className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 ${
                onSaveAndNext
                  ? 'text-slate-800 bg-slate-100 hover:bg-slate-200'
                  : 'text-white bg-slate-900 hover:bg-slate-800'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>Zapisz ustawienia</span>
            </button>
            {onSaveAndNext && (
              <button
                type="button"
                onClick={handleSaveBlockAndNext}
                className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl inline-flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Zapisz i następny dom →</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
