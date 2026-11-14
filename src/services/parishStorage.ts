import {
  Timestamp,
  collection,
  deleteDoc,
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
  LatLng,
  ParishCenter,
  PlanConfig,
  SavedParishRecord,
  SeasonPlanConfig,
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
  weekendStartTime: '10:00',
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

export function sanitizeSeasonConfig(
  sc?: Partial<SeasonPlanConfig> | null
): SeasonPlanConfig {
  const rawDate = cleanStr(sc?.startDate, 10);
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : DEFAULT_SEASON_CONFIG.startDate;
  const weekdayStartTime =
    cleanStr(sc?.weekdayStartTime, 5).length >= 4
      ? cleanStr(sc?.weekdayStartTime, 5)
      : DEFAULT_SEASON_CONFIG.weekdayStartTime;
  const weekendStartTime =
    cleanStr(sc?.weekendStartTime, 5).length >= 4
      ? cleanStr(sc?.weekendStartTime, 5)
      : DEFAULT_SEASON_CONFIG.weekendStartTime;
  const dailyEndTime =
    cleanStr(sc?.dailyEndTime, 5).length >= 4
      ? cleanStr(sc?.dailyEndTime, 5)
      : DEFAULT_SEASON_CONFIG.dailyEndTime;
  const rawMask = cleanStr(sc?.weekdaysMask, 20).replace(/[^0-6,]/g, '');
  return {
    startDate,
    weekdayStartTime,
    weekendStartTime,
    dailyEndTime,
    weekdaysMask: rawMask || DEFAULT_SEASON_CONFIG.weekdaysMask,
  };
}

function cleanVisitDate(raw: string | undefined | null): string {
  const v = cleanStr(raw, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

function sanitizeStopPayload(
  uid: string,
  parishId: string,
  stop: VisitStop
): Record<string, unknown> {
  const address = cleanStr(stop.address || stop.label, 350) || 'Adres domu';
  const label = cleanStr(stop.label || address, 250) || address;
  return {
    ownerId: uid,
    parishId,
    label,
    address,
    placeId: cleanStr(stop.placeId || '', 250),
    location: {
      lat: Number(stop.location.lat),
      lng: Number(stop.location.lng),
    },
    durationMinutes: clampInt(stop.durationMinutes, 1, 240, 15),
    priestId: clampInt(stop.priestId, 1, 4, 1),
    inBoundary: stop.inBoundary ?? true,
    included: stop.included !== false,
    visitDate: cleanVisitDate(stop.visitDate),
    notes: cleanStr(stop.notes || '', 500),
  };
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
    await updateDoc(doc(db, 'parishes', safeParishId, 'stops', safeStopId), {
      label,
      address,
      durationMinutes: clampInt(stop.durationMinutes, 1, 240, 15),
      priestId: clampInt(stop.priestId, 1, 4, 1),
      inBoundary: stop.inBoundary ?? true,
      included: stop.included !== false,
      visitDate: cleanVisitDate(stop.visitDate),
      notes: cleanStr(stop.notes || '', 500),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function batchUpdateStopFieldInFirestore(
  parishId: string,
  stops: VisitStop[],
  mode: 'priestId' | 'inBoundary' | 'included' | 'visitDate' | 'schedule'
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
        } else if (mode === 'schedule') {
          batch.update(ref, {
            visitDate: cleanVisitDate(stop.visitDate),
            priestId: clampInt(stop.priestId, 1, 4, 1),
            included: stop.included !== false,
            updatedAt: serverTimestamp(),
          });
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
