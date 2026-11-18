import {
  Timestamp,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  BuildingUnit,
  DayBreakWindow,
  DayTimeWindow,
  LatLng,
  ParishCenter,
  PlanConfig,
  SavedParishRecord,
  SeasonPlanConfig,
  SeasonPlanningRules,
  UnitVisitStatus,
  VisitStop,
} from '../types/parish';
import { OperationType, handleFirestoreError } from '../utils/firestoreError';

export const DEFAULT_PLAN_CONFIG: PlanConfig = {
  priestCount: 2,
  startTime: '15:30',
  defaultVisitMinutes: 15,
  travelMode: 'WALKING',
  returnToParish: true,
};

export const DEFAULT_SEASON_CONFIG: SeasonPlanConfig = {
  startDate: '2026-12-28',
  weekdayStartTime: '15:30',
  saturdayStartTime: '10:00',
  weekendStartTime: '14:00',
  dailyEndTime: '20:30',
  weekdaysMask: '1,2,3,4,5,6',
};

function cleanStr(value: string | undefined | null, maxLen: number): string {
  return (value ?? '').trim().slice(0, maxLen);
}

function clampInt(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function sanitizeDocId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || `id_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function makeParishDocId(
  parish: ParishCenter,
  uid?: string | null
): string {
  const userPrefix = uid ? `u_${sanitizeDocId(uid).slice(0, 12)}_` : '';
  if (parish.placeId) {
    return sanitizeDocId(`${userPrefix}p_${parish.placeId}`);
  }
  const latPart = Math.round(parish.location.lat * 1e5);
  const lngPart = Math.round(parish.location.lng * 1e5);
  return sanitizeDocId(`${userPrefix}p_${latPart}_${lngPart}`);
}

export function sanitizeBoundary(boundary: LatLng[]): LatLng[] {
  return boundary
    .filter(
      (pt) =>
        pt &&
        typeof pt.lat === 'number' &&
        typeof pt.lng === 'number' &&
        pt.lat >= -90 &&
        pt.lat <= 90 &&
        pt.lng >= -180 &&
        pt.lng <= 180
    )
    .slice(0, 100)
    .map((pt) => ({ lat: pt.lat, lng: pt.lng }));
}

export function sanitizeConfig(config: PlanConfig): PlanConfig {
  const startRaw = cleanStr(config.startTime, 10);
  return {
    priestCount: clampInt(config.priestCount, 1, 4, 2),
    startTime: startRaw.length >= 4 ? startRaw : '15:30',
    defaultVisitMinutes: clampInt(config.defaultVisitMinutes, 1, 240, 15),
    travelMode: config.travelMode === 'DRIVING' ? 'DRIVING' : 'WALKING',
    returnToParish: Boolean(config.returnToParish),
  };
}

function sanitizeBreakWindows(
  rawBreaks?: DayBreakWindow[] | null
): DayBreakWindow[] {
  if (!Array.isArray(rawBreaks)) return [];
  const out: DayBreakWindow[] = [];
  for (let i = 0; i < rawBreaks.length && out.length < 10; i++) {
    const bw = rawBreaks[i];
    if (!bw || typeof bw !== 'object') continue;
    const st = cleanStr(bw.startTime, 5);
    const et = cleanStr(bw.endTime, 5);
    if (!/^\d{1,2}:\d{2}$/.test(st) || !/^\d{1,2}:\d{2}$/.test(et)) continue;
    const id = cleanStr(bw.id, 60) || `brk_${i + 1}`;
    const label = cleanStr(bw.label, 80);
    const entry: DayBreakWindow = { id, startTime: st, endTime: et };
    if (label) entry.label = label;
    out.push(entry);
  }
  return out;
}

export function sanitizeSeasonConfig(
  sc?: Partial<SeasonPlanConfig> | null
): SeasonPlanConfig {
  const rawDate = cleanStr(sc?.startDate, 10);
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : DEFAULT_SEASON_CONFIG.startDate;

  const rawEndDate = cleanStr(sc?.endDate, 10);
  const endDate =
    /^\d{4}-\d{2}-\d{2}$/.test(rawEndDate) && rawEndDate >= startDate
      ? rawEndDate
      : '';

  const weekdayStartTime =
    /^\d{1,2}:\d{2}$/.test(cleanStr(sc?.weekdayStartTime, 5))
      ? cleanStr(sc?.weekdayStartTime, 5)
      : DEFAULT_SEASON_CONFIG.weekdayStartTime;
  const saturdayStartRaw = cleanStr(sc?.saturdayStartTime, 5);
  const saturdayStartTime = /^\d{1,2}:\d{2}$/.test(saturdayStartRaw)
    ? saturdayStartRaw
    : '';
  const weekendStartTime =
    /^\d{1,2}:\d{2}$/.test(cleanStr(sc?.weekendStartTime, 5))
      ? cleanStr(sc?.weekendStartTime, 5)
      : DEFAULT_SEASON_CONFIG.weekendStartTime;
  const dailyEndTime =
    /^\d{1,2}:\d{2}$/.test(cleanStr(sc?.dailyEndTime, 5))
      ? cleanStr(sc?.dailyEndTime, 5)
      : DEFAULT_SEASON_CONFIG.dailyEndTime;
  const rawMask = cleanStr(sc?.weekdaysMask, 20).replace(/[^0-6,]/g, '');

  const excludedDates = Array.isArray(sc?.excludedDates)
    ? Array.from(
        new Set(
          sc.excludedDates
            .map((d) => cleanStr(d, 10))
            .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        )
      )
        .sort()
        .slice(0, 150)
    : [];

  const defaultBreaks = sanitizeBreakWindows(sc?.defaultBreaks);

  const sanitizedOverrides: Record<string, DayTimeWindow> = {};
  if (sc?.dayTimeOverrides && typeof sc.dayTimeOverrides === 'object') {
    for (const [dateKey, win] of Object.entries(sc.dayTimeOverrides)) {
      if (Object.keys(sanitizedOverrides).length >= 150) break;
      const cleanDate = cleanStr(dateKey, 10);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(cleanDate) ||
        !win ||
        typeof win !== 'object'
      ) {
        continue;
      }
      const st = cleanStr(win.startTime, 5);
      const et = cleanStr(win.endTime, 5);
      if (/^\d{1,2}:\d{2}$/.test(st) && /^\d{1,2}:\d{2}$/.test(et)) {
        const entry: DayTimeWindow = { startTime: st, endTime: et };
        if (Array.isArray(win.breaks)) {
          entry.breaks = sanitizeBreakWindows(win.breaks);
        }
        sanitizedOverrides[cleanDate] = entry;
      }
    }
  }

  let sanitizedRules: SeasonPlanningRules | undefined;
  if (sc?.planningRules && typeof sc.planningRules === 'object') {
    const pr = sc.planningRules;
    const splitMode =
      pr.splitMode === 'parity' ||
      pr.splitMode === 'strict_budget' ||
      pr.splitMode === 'whole_or_half'
        ? pr.splitMode
        : 'whole_or_half';
    const zoneDirection =
      pr.zoneDirection === 'nearest_first' ||
      pr.zoneDirection === 'farthest_first' ||
      pr.zoneDirection === 'clockwise'
        ? pr.zoneDirection
        : 'clockwise';
    const blockPreference =
      pr.blockPreference === 'blocks_weekdays_houses_weekend' ||
      pr.blockPreference === 'any'
        ? pr.blockPreference
        : 'any';
    const safetyBufferMinutes = clampInt(pr.safetyBufferMinutes, 0, 120, 15);
    sanitizedRules = {
      splitMode,
      zoneDirection,
      blockPreference,
      safetyBufferMinutes,
    };
  }

  const result: SeasonPlanConfig = {
    startDate,
    weekdayStartTime,
    weekendStartTime,
    dailyEndTime,
    weekdaysMask: rawMask || DEFAULT_SEASON_CONFIG.weekdaysMask,
  };
  if (endDate) {
    result.endDate = endDate;
  }
  if (saturdayStartTime) {
    result.saturdayStartTime = saturdayStartTime;
  }
  if (excludedDates.length > 0) {
    result.excludedDates = excludedDates;
  }
  if (defaultBreaks.length > 0) {
    result.defaultBreaks = defaultBreaks;
  }
  if (sanitizedRules) {
    result.planningRules = sanitizedRules;
  }
  if (Object.keys(sanitizedOverrides).length > 0) {
    result.dayTimeOverrides = sanitizedOverrides;
  }
  return result;
}

function cleanVisitDate(raw: string | undefined | null): string {
  const v = cleanStr(raw, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

const VALID_UNIT_STATUSES = new Set<UnitVisitStatus>([
  'pending',
  'accepted',
  'absent',
  'declined',
  'invited',
]);

function sanitizeUnitsList(units: BuildingUnit[] | undefined | null): BuildingUnit[] {
  if (!Array.isArray(units)) return [];
  const out: BuildingUnit[] = [];
  for (let i = 0; i < units.length && out.length < 200; i++) {
    const u = units[i];
    if (!u || typeof u !== 'object') continue;
    const unitNumber = cleanStr(u.unitNumber, 30);
    if (!unitNumber) continue;
    const id = cleanStr(u.id, 80) || `u_${i + 1}`;
    const staircase = cleanStr(u.staircase || '', 30);
    const familyName = cleanStr(u.familyName || '', 120);
    const notes = cleanStr(u.notes || '', 200);
    const status: UnitVisitStatus =
      u.status && VALID_UNIT_STATUSES.has(u.status) ? u.status : 'pending';

    const item: BuildingUnit = {
      id,
      unitNumber,
      staircase,
      familyName,
      notes,
      status,
    };
    if (u.lastYearStatus && VALID_UNIT_STATUSES.has(u.lastYearStatus)) {
      item.lastYearStatus = u.lastYearStatus;
    }
    if (
      typeof u.durationMinutes === 'number' &&
      !Number.isNaN(u.durationMinutes)
    ) {
      item.durationMinutes = clampInt(u.durationMinutes, 1, 120, 10);
    }
    out.push(item);
  }
  return out;
}

function sanitizeStopPayload(
  uid: string,
  parishId: string,
  stop: VisitStop
): Record<string, unknown> {
  const address = cleanStr(stop.address || stop.label, 350) || 'Adres domu';
  const label = cleanStr(stop.label || address, 250) || address;
  const units = sanitizeUnitsList(stop.units);
  const isMultiUnit = Boolean(stop.isMultiUnit || units.length > 0);
  const unitsCount = isMultiUnit
    ? clampInt(
        units.length > 0 ? Math.max(units.length, stop.unitsCount ?? 0) : stop.unitsCount,
        0,
        500,
        units.length
      )
    : 0;
  const minutesPerUnit = clampInt(stop.minutesPerUnit, 1, 60, 10);

  const visitStatus: UnitVisitStatus =
    stop.visitStatus && VALID_UNIT_STATUSES.has(stop.visitStatus)
      ? stop.visitStatus
      : 'pending';

  const payload: Record<string, unknown> = {
    ownerId: uid,
    parishId,
    label,
    address,
    placeId: cleanStr(stop.placeId || '', 250),
    location: {
      lat: Number(stop.location.lat),
      lng: Number(stop.location.lng),
    },
    durationMinutes: clampInt(stop.durationMinutes, 1, 1440, 15),
    priestId: clampInt(stop.priestId, 1, 4, 1),
    inBoundary: stop.inBoundary ?? true,
    included: stop.included !== false,
    visitDate: cleanVisitDate(stop.visitDate),
    notes: cleanStr(stop.notes || '', 500),
    isMultiUnit,
    unitsCount,
    minutesPerUnit,
    units,
    visitStatus,
  };
  if (
    stop.lastYearStatus &&
    VALID_UNIT_STATUSES.has(stop.lastYearStatus)
  ) {
    payload.lastYearStatus = stop.lastYearStatus;
  }
  if (typeof stop.permanentDecline === 'boolean') {
    payload.permanentDecline = stop.permanentDecline;
  }
  if (
    typeof stop.manualOrder === 'number' &&
    !Number.isNaN(stop.manualOrder)
  ) {
    payload.manualOrder = clampInt(stop.manualOrder, 0, 10000, 0);
  }
  return payload;
}

function timestampToMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  return Date.now();
}

export function subscribeUserParishes(
  uid: string,
  onData: (parishes: SavedParishRecord[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = 'parishes';
  const q = query(collection(db, path), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: SavedParishRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          parish: {
            name: String(d.name ?? 'Parafia'),
            address: String(d.address ?? ''),
            placeId: d.placeId ? String(d.placeId) : undefined,
            location: {
              lat: Number(d.location?.lat ?? 50.0614),
              lng: Number(d.location?.lng ?? 19.9366),
            },
          },
          boundary: Array.isArray(d.boundary) ? sanitizeBoundary(d.boundary) : [],
          config: d.config
            ? sanitizeConfig(d.config as PlanConfig)
            : DEFAULT_PLAN_CONFIG,
          seasonConfig: d.seasonConfig
            ? sanitizeSeasonConfig(d.seasonConfig as SeasonPlanConfig)
            : DEFAULT_SEASON_CONFIG,
          updatedAtMs: timestampToMs(d.updatedAt),
        };
      });

      list.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onData(list);
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Error already logged & quota event dispatched
      }
    }
  );
}

export function subscribeParishStops(
  uid: string,
  parishId: string,
  onData: (stops: VisitStop[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const safeParishId = sanitizeDocId(parishId);
  const path = `parishes/${safeParishId}/stops`;
  const q = query(collection(db, path), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: Array<{ stop: VisitStop; createdMs: number }> =
        snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            createdMs: timestampToMs(d.createdAt),
            stop: {
              id: docSnap.id,
              label: String(d.label ?? d.address ?? 'Dom'),
              address: String(d.address ?? d.label ?? ''),
              placeId: d.placeId ? String(d.placeId) : undefined,
              location: {
                lat: Number(d.location?.lat ?? 0),
                lng: Number(d.location?.lng ?? 0),
              },
              durationMinutes: Number(d.durationMinutes ?? 15),
              priestId: Number(d.priestId ?? 1),
              inBoundary: d.inBoundary !== false,
              included: d.included !== false,
              visitDate: d.visitDate ? String(d.visitDate) : undefined,
              notes: d.notes ? String(d.notes) : undefined,
              isMultiUnit: Boolean(d.isMultiUnit),
              unitsCount:
                typeof d.unitsCount === 'number' ? d.unitsCount : undefined,
              minutesPerUnit:
                typeof d.minutesPerUnit === 'number'
                  ? d.minutesPerUnit
                  : undefined,
              units: Array.isArray(d.units)
                ? sanitizeUnitsList(d.units as BuildingUnit[])
                : undefined,
              visitStatus:
                typeof d.visitStatus === 'string' &&
                VALID_UNIT_STATUSES.has(d.visitStatus as UnitVisitStatus)
                  ? (d.visitStatus as UnitVisitStatus)
                  : undefined,
              lastYearStatus:
                typeof d.lastYearStatus === 'string' &&
                VALID_UNIT_STATUSES.has(d.lastYearStatus as UnitVisitStatus)
                  ? (d.lastYearStatus as UnitVisitStatus)
                  : undefined,
              permanentDecline:
                typeof d.permanentDecline === 'boolean'
                  ? d.permanentDecline
                  : undefined,
              manualOrder:
                typeof d.manualOrder === 'number' ? d.manualOrder : undefined,
            },
          };
        });

      items.sort((a, b) => a.createdMs - b.createdMs);
      onData(items.map((x) => x.stop));
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Error already logged & quota event dispatched
      }
    }
  );
}

export async function saveParishToFirestore(
  uid: string,
  record: SavedParishRecord,
  forceCreate = false
): Promise<void> {
  const safeId = sanitizeDocId(record.id);
  const path = `parishes/${safeId}`;
  const ref = doc(db, 'parishes', safeId);

  try {
    const payload = {
      name: cleanStr(record.parish.name, 200) || 'Parafia',
      address: cleanStr(record.parish.address, 350),
      placeId: cleanStr(record.parish.placeId || '', 250),
      location: {
        lat: Number(record.parish.location.lat),
        lng: Number(record.parish.location.lng),
      },
      boundary: sanitizeBoundary(record.boundary),
      config: sanitizeConfig(record.config),
      seasonConfig: sanitizeSeasonConfig(record.seasonConfig),
      updatedAt: serverTimestamp(),
    };

    if (forceCreate) {
      await setDoc(ref, {
        ownerId: uid,
        ...payload,
        createdAt: serverTimestamp(),
      });
      return;
    }

    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, payload);
    } else {
      await setDoc(ref, {
        ownerId: uid,
        ...payload,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateParishBoundaryInFirestore(
  parishId: string,
  boundary: LatLng[]
): Promise<void> {
  const safeId = sanitizeDocId(parishId);
  const path = `parishes/${safeId}`;
  try {
    await updateDoc(doc(db, 'parishes', safeId), {
      boundary: sanitizeBoundary(boundary),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateParishConfigInFirestore(
  parishId: string,
  config: PlanConfig
): Promise<void> {
  const safeId = sanitizeDocId(parishId);
  const path = `parishes/${safeId}`;
  try {
    await updateDoc(doc(db, 'parishes', safeId), {
      config: sanitizeConfig(config),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateParishSeasonConfigInFirestore(
  parishId: string,
  seasonConfig: SeasonPlanConfig
): Promise<void> {
  const safeId = sanitizeDocId(parishId);
  const path = `parishes/${safeId}`;
  try {
    await updateDoc(doc(db, 'parishes', safeId), {
      seasonConfig: sanitizeSeasonConfig(seasonConfig),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteParishFromFirestore(
  uid: string,
  parishId: string
): Promise<void> {
  const safeId = sanitizeDocId(parishId);
  const stopsPath = `parishes/${safeId}/stops`;
  try {
    const stopsSnap = await getDocs(
      query(collection(db, stopsPath), where('ownerId', '==', uid))
    );
    const docs = stopsSnap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = writeBatch(db);
      docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, 'parishes', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `parishes/${safeId}`);
  }
}

export async function createStopInFirestore(
  uid: string,
  parishId: string,
  stop: VisitStop
): Promise<void> {
  const safeParishId = sanitizeDocId(parishId);
  const safeStopId = sanitizeDocId(stop.id);
  const path = `parishes/${safeParishId}/stops/${safeStopId}`;
  try {
    await setDoc(doc(db, 'parishes', safeParishId, 'stops', safeStopId), {
      ...sanitizeStopPayload(uid, safeParishId, stop),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createStopsBatchInFirestore(
  uid: string,
  parishId: string,
  stops: VisitStop[]
): Promise<void> {
  if (stops.length === 0) return;
  const safeParishId = sanitizeDocId(parishId);
  const path = `parishes/${safeParishId}/stops`;
  try {
    for (let i = 0; i < stops.length; i += 400) {
      const batch = writeBatch(db);
      stops.slice(i, i + 400).forEach((stop) => {
        const safeStopId = sanitizeDocId(stop.id);
        const ref = doc(db, 'parishes', safeParishId, 'stops', safeStopId);
        batch.set(ref, {
          ...sanitizeStopPayload(uid, safeParishId, stop),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateStopInFirestore(
  parishId: string,
  stop: VisitStop
): Promise<void> {
  const safeParishId = sanitizeDocId(parishId);
  const safeStopId = sanitizeDocId(stop.id);
  const path = `parishes/${safeParishId}/stops/${safeStopId}`;
  try {
    const address = cleanStr(stop.address || stop.label, 350) || 'Adres domu';
    const label = cleanStr(stop.label || address, 250) || address;
    const units = sanitizeUnitsList(stop.units);
    const isMultiUnit = Boolean(stop.isMultiUnit || units.length > 0);
    const unitsCount = isMultiUnit
      ? clampInt(
          units.length > 0 ? Math.max(units.length, stop.unitsCount ?? 0) : stop.unitsCount,
          0,
          500,
          units.length
        )
      : 0;
    const minutesPerUnit = clampInt(stop.minutesPerUnit, 1, 60, 10);

    const visitStatus: UnitVisitStatus =
      stop.visitStatus && VALID_UNIT_STATUSES.has(stop.visitStatus)
        ? stop.visitStatus
        : 'pending';

    const updatePayload: Record<string, unknown> = {
      label,
      address,
      durationMinutes: clampInt(stop.durationMinutes, 1, 1440, 15),
      priestId: clampInt(stop.priestId, 1, 4, 1),
      inBoundary: stop.inBoundary ?? true,
      included: stop.included !== false,
      visitDate: cleanVisitDate(stop.visitDate),
      notes: cleanStr(stop.notes || '', 500),
      isMultiUnit,
      unitsCount,
      minutesPerUnit,
      units,
      visitStatus,
      updatedAt: serverTimestamp(),
    };
    if (
      stop.lastYearStatus &&
      VALID_UNIT_STATUSES.has(stop.lastYearStatus)
    ) {
      updatePayload.lastYearStatus = stop.lastYearStatus;
    }
    if (typeof stop.permanentDecline === 'boolean') {
      updatePayload.permanentDecline = stop.permanentDecline;
    }
    if (
      typeof stop.manualOrder === 'number' &&
      !Number.isNaN(stop.manualOrder)
    ) {
      updatePayload.manualOrder = clampInt(stop.manualOrder, 0, 10000, 0);
    }

    await updateDoc(
      doc(db, 'parishes', safeParishId, 'stops', safeStopId),
      updatePayload
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function batchUpdateStopFieldInFirestore(
  parishId: string,
  stops: VisitStop[],
  mode:
    | 'priestId'
    | 'inBoundary'
    | 'included'
    | 'visitDate'
    | 'schedule'
    | 'visitStatus'
    | 'manualOrder'
    | 'manualOrder_schedule'
    | 'season_rollover'
    | 'kartoteka_enrich'
): Promise<void> {
  if (stops.length === 0) return;
  const safeParishId = sanitizeDocId(parishId);
  const path = `parishes/${safeParishId}/stops`;
  try {
    for (let i = 0; i < stops.length; i += 400) {
      const batch = writeBatch(db);
      stops.slice(i, i + 400).forEach((stop) => {
        const safeStopId = sanitizeDocId(stop.id);
        const ref = doc(db, 'parishes', safeParishId, 'stops', safeStopId);
        if (mode === 'priestId') {
          batch.update(ref, {
            priestId: clampInt(stop.priestId, 1, 4, 1),
            updatedAt: serverTimestamp(),
          });
        } else if (mode === 'included') {
          batch.update(ref, {
            included: stop.included !== false,
            updatedAt: serverTimestamp(),
          });
        } else if (mode === 'visitDate') {
          batch.update(ref, {
            visitDate: cleanVisitDate(stop.visitDate),
            updatedAt: serverTimestamp(),
          });
        } else if (mode === 'visitStatus') {
          const visitStatus: UnitVisitStatus =
            stop.visitStatus && VALID_UNIT_STATUSES.has(stop.visitStatus)
              ? stop.visitStatus
              : 'pending';
          batch.update(ref, {
            visitStatus,
            updatedAt: serverTimestamp(),
          });
        } else if (mode === 'manualOrder') {
          batch.update(ref, {
            manualOrder: clampInt(stop.manualOrder, 0, 10000, 0),
            updatedAt: serverTimestamp(),
          });
        } else if (mode === 'schedule') {
          batch.update(ref, {
            visitDate: cleanVisitDate(stop.visitDate),
            priestId: clampInt(stop.priestId, 1, 4, 1),
            included: stop.included !== false,
            updatedAt: serverTimestamp(),
          });
        } else if (mode === 'manualOrder_schedule') {
          batch.update(ref, {
            visitDate: cleanVisitDate(stop.visitDate),
            priestId: clampInt(stop.priestId, 1, 4, 1),
            included: stop.included !== false,
            manualOrder: clampInt(stop.manualOrder, 0, 10000, 0),
            updatedAt: serverTimestamp(),
          });
        } else if (mode === 'season_rollover') {
          const visitStatus: UnitVisitStatus =
            stop.visitStatus && VALID_UNIT_STATUSES.has(stop.visitStatus)
              ? stop.visitStatus
              : 'pending';
          batch.update(ref, {
            visitStatus,
            lastYearStatus:
              stop.lastYearStatus && VALID_UNIT_STATUSES.has(stop.lastYearStatus)
                ? stop.lastYearStatus
                : deleteField(),
            permanentDecline: Boolean(stop.permanentDecline),
            visitDate: cleanVisitDate(stop.visitDate),
            included: stop.included !== false,
            manualOrder: clampInt(stop.manualOrder, 0, 10000, 0),
            units: sanitizeUnitsList(stop.units),
            updatedAt: serverTimestamp(),
          });
        } else if (mode === 'kartoteka_enrich') {
          const units = sanitizeUnitsList(stop.units);
          const isMultiUnit = Boolean(stop.isMultiUnit || units.length > 0);
          const unitsCount = isMultiUnit
            ? clampInt(
                units.length > 0
                  ? Math.max(units.length, stop.unitsCount ?? 0)
                  : stop.unitsCount,
                0,
                500,
                units.length
              )
            : 0;
          const enrichPayload: Record<string, unknown> = {
            durationMinutes: clampInt(stop.durationMinutes, 1, 1440, 15),
            notes: cleanStr(stop.notes || '', 500),
            isMultiUnit,
            unitsCount,
            minutesPerUnit: clampInt(stop.minutesPerUnit, 1, 60, 10),
            units,
            updatedAt: serverTimestamp(),
          };
          if (typeof stop.permanentDecline === 'boolean') {
            enrichPayload.permanentDecline = stop.permanentDecline;
          }
          if (
            stop.lastYearStatus &&
            VALID_UNIT_STATUSES.has(stop.lastYearStatus)
          ) {
            enrichPayload.lastYearStatus = stop.lastYearStatus;
          }
          batch.update(ref, enrichPayload);
        } else {
          batch.update(ref, {
            inBoundary: stop.inBoundary ?? true,
            updatedAt: serverTimestamp(),
          });
        }
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteStopInFirestore(
  parishId: string,
  stopId: string
): Promise<void> {
  const safeParishId = sanitizeDocId(parishId);
  const safeStopId = sanitizeDocId(stopId);
  const path = `parishes/${safeParishId}/stops/${safeStopId}`;
  try {
    await deleteDoc(doc(db, 'parishes', safeParishId, 'stops', safeStopId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearParishStopsInFirestore(
  parishId: string,
  stopIds: string[]
): Promise<void> {
  if (stopIds.length === 0) return;
  const safeParishId = sanitizeDocId(parishId);
  const path = `parishes/${safeParishId}/stops`;
  try {
    for (let i = 0; i < stopIds.length; i += 400) {
      const batch = writeBatch(db);
      stopIds.slice(i, i + 400).forEach((id) => {
        const safeStopId = sanitizeDocId(id);
        batch.delete(doc(db, 'parishes', safeParishId, 'stops', safeStopId));
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncLocalParishBundleToFirestore(
  uid: string,
  records: SavedParishRecord[],
  stopsByParishId: Record<string, VisitStop[]>
): Promise<void> {
  if (records.length === 0) return;

  let existingIds = new Set<string>();
  let existingPlaceIds = new Set<string>();
  try {
    const existingSnap = await getDocs(
      query(collection(db, 'parishes'), where('ownerId', '==', uid))
    );
    existingSnap.docs.forEach((d) => {
      existingIds.add(d.id);
      const pid = d.data().placeId;
      if (typeof pid === 'string' && pid.length > 0) {
        existingPlaceIds.add(pid);
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'parishes');
  }

  for (const rec of records) {
    if (
      existingIds.has(rec.id) ||
      (rec.parish.placeId && existingPlaceIds.has(rec.parish.placeId))
    ) {
      continue;
    }

    const scopedId = rec.id.startsWith('u_')
      ? sanitizeDocId(rec.id)
      : makeParishDocId(rec.parish, uid);

    if (existingIds.has(scopedId)) {
      continue;
    }

    await saveParishToFirestore(uid, { ...rec, id: scopedId }, true);
    const localStops = stopsByParishId[rec.id] || [];
    if (localStops.length > 0) {
      await createStopsBatchInFirestore(uid, scopedId, localStops);
    }
    existingIds.add(scopedId);
    if (rec.parish.placeId) existingPlaceIds.add(rec.parish.placeId);
  }
}

const OFFLINE_CACHE_KEY_PREFIX = 'planer_koledy_offline_v3_';

export interface OfflineParishSnapshot {
  parishId: string;
  parish: ParishCenter;
  boundary: LatLng[];
  config: PlanConfig;
  seasonConfig: SeasonPlanConfig;
  stops: VisitStop[];
  savedAtMs: number;
}

export function saveOfflineParishSnapshot(
  uid: string,
  snapshot: OfflineParishSnapshot
): void {
  try {
    window.localStorage.setItem(
      `${OFFLINE_CACHE_KEY_PREFIX}${sanitizeDocId(uid)}`,
      JSON.stringify(snapshot)
    );
  } catch {
    // Ignore storage quota / private mode issues
  }
}

export function loadOfflineParishSnapshot(
  uid: string
): OfflineParishSnapshot | null {
  try {
    const raw = window.localStorage.getItem(
      `${OFFLINE_CACHE_KEY_PREFIX}${sanitizeDocId(uid)}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineParishSnapshot;
    if (!parsed || !parsed.parish || !Array.isArray(parsed.stops)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearOfflineParishSnapshot(uid?: string): void {
  try {
    if (uid) {
      window.localStorage.removeItem(
        `${OFFLINE_CACHE_KEY_PREFIX}${sanitizeDocId(uid)}`
      );
      return;
    }
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(OFFLINE_CACHE_KEY_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // Ignore storage issues
  }
}

