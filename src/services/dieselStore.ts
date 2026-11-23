import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import * as XLSX from '../utils/xlsxCompat';
import {
  DIESEL_CSV_SEED_VERSION,
  SEEDED_DIESEL_GRNS,
  SEEDED_DIESEL_REQUESTS,
} from '../data/dieselCsvSeed';
import {
  canAccessFirestorePath,
  db,
  deepSanitizeForFirestore,
  ensureFirebaseAuth,
  getCollectionDocsServerFirst,
  getDocServerFirst,
  isFirestorePathBlockedByRules,
  isPermissionDeniedError,
  markFirestorePathBlockedByRules,
  notifyCloudSyncBus,
  setDocWithTimeout,
  subscribeCloudSyncBus,
} from '../firebase';
import {
  DieselFuelRequest,
  DieselGrnRecord,
  DieselTankConfig,
} from '../types';
import { generateFuelGrnPdf, generateFuelRequestApprovalPdf } from './dieselPdf';
import { r2, saveFileBlob } from './downtimeCalc';

const TANK_KEY = 'lgplast_diesel_tank_v1';
const TANK_PENDING_KEY = 'lgplast_diesel_tank_pending_v1';
const TANK_COLLECTION = 'diesel_tank_config';

const REQ_KEY = 'lgplast_diesel_requests_v1';
const REQ_PENDING_KEY = 'lgplast_diesel_requests_pending_v1';
const REQ_COLLECTION = 'diesel_fuel_requests';

const GRN_KEY = 'lgplast_diesel_grns_v1';
const GRN_PENDING_KEY = 'lgplast_diesel_grns_pending_v1';
const GRN_COLLECTION = 'diesel_grn_records';

export function recomputeDieselTankFromLedger(
  baseTank: DieselTankConfig,
  requests: DieselFuelRequest[],
  grns: DieselGrnRecord[],
  updatedByLabel?: string
): DieselTankConfig {
  const totalReceivedLitres = r2(
    grns.reduce((s, g) => s + (Number(g.litresAdded) || 0), 0)
  );
  const totalIssuedLitres = r2(
    requests
      .filter((r) => r.status === 'DISPENSED')
      .reduce((s, r) => s + (Number(r.actualLitresTaken) || 0), 0)
  );
  const currentLevelLitres = r2(totalReceivedLitres - totalIssuedLitres);

  let highestMeter = Number(baseTank.currentMeterReading) || 0;
  requests.forEach((r) => {
    if (typeof r.secondMeterReading === 'number' && r.secondMeterReading > highestMeter) {
      highestMeter = r.secondMeterReading;
    }
  });
  grns.forEach((g) => {
    if (
      !g.isHistoricalCsv &&
      typeof g.secondMeterReading === 'number' &&
      g.secondMeterReading > highestMeter
    ) {
      highestMeter = g.secondMeterReading;
    }
  });

  return {
    ...baseTank,
    id: 'main_bowser',
    totalReceivedLitres,
    totalIssuedLitres,
    currentLevelLitres,
    currentMeterReading: highestMeter,
    lastUpdatedBy: updatedByLabel || baseTank.lastUpdatedBy || 'Ledger Sync',
  };
}

export const DEFAULT_TANK_CONFIG: DieselTankConfig = {
  id: 'main_bowser',
  tankName: 'Main Factory Diesel Bowser Tank',
  capacityLitres: 10000,
  currentLevelLitres: 26,
  currentMeterReading: 170215,
  totalReceivedLitres: 4813,
  totalIssuedLitres: 4787,
  lastUpdatedAt: new Date().toISOString(),
  lastUpdatedBy: 'DESEAL REPORTS CSV (+4,813 L - 4,787 L = 26 L)',
  upd: 1,
};

let dieselCsvSeedChecked = false;
function ensureDieselCsvSeeded() {
  if (dieselCsvSeedChecked) return;
  dieselCsvSeedChecked = true;
  try {
    const alreadySeeded = localStorage.getItem(DIESEL_CSV_SEED_VERSION) === '1';
    const existingReqs = readLocalList<DieselFuelRequest>(REQ_KEY);
    const existingGrns = readLocalList<DieselGrnRecord>(GRN_KEY);

    if (!alreadySeeded || existingReqs.length === 0 || existingGrns.length === 0) {
      const mergedReqs = mergeById(SEEDED_DIESEL_REQUESTS, existingReqs);
      const mergedGrns = mergeById(SEEDED_DIESEL_GRNS, existingGrns);
      writeLocalList(REQ_KEY, mergedReqs);
      writeLocalList(GRN_KEY, mergedGrns);

      let baseTank = DEFAULT_TANK_CONFIG;
      try {
        const rawTank = localStorage.getItem(TANK_KEY);
        if (rawTank) {
          const parsed = JSON.parse(rawTank) as DieselTankConfig;
          if (parsed && parsed.id === 'main_bowser') {
            baseTank = parsed;
          }
        }
      } catch {}

      const recomputed = recomputeDieselTankFromLedger(
        {
          ...baseTank,
          currentMeterReading: Math.max(170215, baseTank.currentMeterReading || 0),
          upd: Math.max(baseTank.upd || 1, 1775400001000),
          lastUpdatedAt: baseTank.lastUpdatedAt || '2026-11-01T07:30:00.000Z',
        },
        mergedReqs,
        mergedGrns,
        'DESEAL REPORTS CSV Sync (Positives - Negatives)'
      );
      localStorage.setItem(TANK_KEY, JSON.stringify(recomputed));
      localStorage.setItem(DIESEL_CSV_SEED_VERSION, '1');
    }
  } catch {}
}

function readLocalList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalList<T>(key: string, items: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch (e) {
    console.warn(`Failed writing ${key} to localStorage:`, e);
  }
}

function readQueue(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addToQueue(key: string, id: string) {
  try {
    const q = readQueue(key);
    if (!q.includes(id)) {
      q.push(id);
      localStorage.setItem(key, JSON.stringify(q));
    }
  } catch {}
}

function removeFromQueue(key: string, id: string) {
  try {
    localStorage.setItem(key, JSON.stringify(readQueue(key).filter((x) => x !== id)));
  } catch {}
}

function repairQueueForList<T extends { id: string; upd?: number; sy?: number }>(
  pendingKey: string,
  items: T[]
): number {
  try {
    const raw = localStorage.getItem(pendingKey);
    if (!raw) return 0;
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue)) {
      localStorage.removeItem(pendingKey);
      return 0;
    }
    const byId = new Map(items.map((x) => [x.id, x]));
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const id of queue) {
      if (typeof id !== 'string' || !id || seen.has(id)) continue;
      const found = byId.get(id);
      if (!found) continue;
      if (found.sy && (!found.upd || found.sy >= found.upd)) continue;
      seen.add(id);
      cleaned.push(id);
    }
    if (cleaned.length !== queue.length) {
      localStorage.setItem(pendingKey, JSON.stringify(cleaned));
    }
    return cleaned.length;
  } catch {
    return 0;
  }
}

function clearSyncedIdsFromQueue<T extends { id: string; upd?: number }>(
  pendingKey: string,
  local: T[],
  remote: T[]
) {
  const pending = readQueue(pendingKey);
  if (!pending.length) return;
  const localMap = new Map(local.map((x) => [x.id, x]));
  const remoteMap = new Map(remote.map((x) => [x.id, x]));
  pending.forEach((id) => {
    const r = remoteMap.get(id);
    const l = localMap.get(id);
    if (r && (!l || (r.upd || 0) >= (l.upd || 0))) {
      removeFromQueue(pendingKey, id);
    }
  });
}

function queueMissingDieselRecords<
  T extends { id: string; upd?: number; sy?: number; isHistoricalCsv?: boolean }
>(pendingKey: string, merged: T[], remote: T[]): T[] {
  const remoteMap = new Map(remote.map((r) => [r.id, r]));
  let mutated = false;
  const next = merged.map((item) => {
    if (!item?.id || item.isHistoricalCsv) return item;
    const r = remoteMap.get(item.id);
    if (!r || (item.upd || 0) > (r.upd || 0)) {
      addToQueue(pendingKey, item.id);
      if (item.sy !== 0) {
        mutated = true;
        return { ...item, sy: 0 };
      }
    }
    return item;
  });
  return mutated ? next : merged;
}

function sanitizeObj<T extends Record<string, any>>(obj: T): T {
  return deepSanitizeForFirestore(obj);
}

function mergeById<T extends { id: string; upd?: number }>(local: T[], remote: T[]): T[] {
  const map: Record<string, T> = {};
  local.forEach((x) => {
    if (x?.id) map[x.id] = x;
  });
  remote.forEach((x) => {
    if (!x?.id) return;
    const prev = map[x.id];
    if (!prev || (x.upd || 0) >= (prev.upd || 0)) {
      map[x.id] = x;
    }
  });
  return Object.values(map).sort((a, b) => (b.upd || 0) - (a.upd || 0));
}

// ======================================================
// 1. DIESEL BOWSER TANK CONFIG STORE
// ======================================================
export function getLocalDieselTank(): DieselTankConfig {
  ensureDieselCsvSeeded();
  try {
    const raw = localStorage.getItem(TANK_KEY);
    if (!raw) return DEFAULT_TANK_CONFIG;
    const parsed = JSON.parse(raw) as DieselTankConfig;
    if (!parsed || parsed.id !== 'main_bowser') return DEFAULT_TANK_CONFIG;
    const reqs = readLocalList<DieselFuelRequest>(REQ_KEY);
    const grns = readLocalList<DieselGrnRecord>(GRN_KEY);
    if (reqs.length > 0 || grns.length > 0) {
      return recomputeDieselTankFromLedger(parsed, reqs, grns);
    }
    return parsed;
  } catch {
    return DEFAULT_TANK_CONFIG;
  }
}

export function saveLocalDieselTank(tank: DieselTankConfig) {
  try {
    localStorage.setItem(TANK_KEY, JSON.stringify(tank));
  } catch {}
}

export async function saveDieselTankConfig(
  tank: DieselTankConfig
): Promise<{ ok: boolean; error?: string }> {
  const next: DieselTankConfig = {
    ...tank,
    id: 'main_bowser',
    upd: Date.now(),
    lastUpdatedAt: new Date().toISOString(),
  };
  saveLocalDieselTank(next);
  try {
    localStorage.setItem(TANK_PENDING_KEY, '1');
  } catch {}
  notifyCloudSyncBus('diesel');

  try {
    await ensureFirebaseAuth();
    const syncTs = Date.now();
    await setDocWithTimeout(
      doc(db, TANK_COLLECTION, 'main_bowser'),
      sanitizeObj({ ...next, sy: syncTs }),
      { merge: true }
    );
    localStorage.removeItem(TANK_PENDING_KEY);
    notifyCloudSyncBus('diesel');
    return { ok: true };
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(TANK_COLLECTION);
    }
    try {
      localStorage.setItem(TANK_PENDING_KEY, '1');
    } catch {}
    return { ok: false, error: err?.message || 'Saved tank level locally; cloud sync queued' };
  }
}

export async function pollDieselTank(): Promise<DieselTankConfig> {
  const local = getLocalDieselTank();
  try {
    await ensureFirebaseAuth();
    if (!(await canAccessFirestorePath(`${TANK_COLLECTION}/main_bowser`, true))) {
      return local;
    }
    const snap = await getDocServerFirst(doc(db, TANK_COLLECTION, 'main_bowser'));
    if (snap.exists()) {
      const remote = snap.data() as DieselTankConfig;
      if ((remote.upd || 0) >= (local.upd || 0)) {
        saveLocalDieselTank(remote);
        try {
          localStorage.removeItem(TANK_PENDING_KEY);
        } catch {}
        return remote;
      }
    }
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(TANK_COLLECTION);
    }
  }
  return local;
}

export function subscribeDieselTank(onUpdate: (tank: DieselTankConfig) => void) {
  onUpdate(getLocalDieselTank());
  let unsub: () => void = () => {};
  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleRetry = () => {
    if (cancelled || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!cancelled) start();
    }, 3000);
  };

  const unsubBus = subscribeCloudSyncBus((topic) => {
    if (!cancelled && (topic === 'diesel' || topic === 'all')) {
      onUpdate(getLocalDieselTank());
    }
  });

  const start = async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    if (!(await canAccessFirestorePath(`${TANK_COLLECTION}/main_bowser`, true))) {
      scheduleRetry();
      return;
    }
    if (cancelled) return;
    try {
      unsub();
      unsub = onSnapshot(
        doc(db, TANK_COLLECTION, 'main_bowser'),
        { includeMetadataChanges: true },
        (snap) => {
          const local = getLocalDieselTank();
          if (snap.exists()) {
            const remote = snap.data() as DieselTankConfig;
            if ((remote.upd || 0) >= (local.upd || 0)) {
              saveLocalDieselTank(remote);
              try {
                localStorage.removeItem(TANK_PENDING_KEY);
              } catch {}
              onUpdate(remote);
            } else {
              onUpdate(local);
            }
          }
          if (!snap.metadata.fromCache) {
            flushPendingDieselData().catch(() => {});
          }
        },
        () => scheduleRetry()
      );
    } catch {
      scheduleRetry();
    }
  };
  start();

  const handleOnline = () => {
    if (cancelled) return;
    flushPendingDieselData().catch(() => {});
    pollDieselTank()
      .then((t) => {
        if (!cancelled) onUpdate(t);
      })
      .catch(() => {});
    start();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
  }

  const pollTimer = setInterval(() => {
    if (cancelled || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    flushPendingDieselData().catch(() => {});
    pollDieselTank()
      .then((t) => {
        if (!cancelled) onUpdate(t);
      })
      .catch(() => {});
  }, 60000);

  return () => {
    cancelled = true;
    unsubBus();
    if (retryTimer) clearTimeout(retryTimer);
    clearInterval(pollTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
    }
    unsub();
  };
}

// ======================================================
// 2. DIESEL FUEL REQUESTS STORE
// ======================================================
export function getLocalDieselRequests(): DieselFuelRequest[] {
  ensureDieselCsvSeeded();
  return readLocalList<DieselFuelRequest>(REQ_KEY);
}

export async function saveDieselRequest(
  req: DieselFuelRequest,
  options?: { preserveUpd?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const updated: DieselFuelRequest = {
    ...req,
    upd: options?.preserveUpd && req.upd ? req.upd : Date.now(),
  };
  const merged = mergeById(getLocalDieselRequests(), [updated]);
  writeLocalList(REQ_KEY, merged);
  addToQueue(REQ_PENDING_KEY, updated.id);
  notifyCloudSyncBus('diesel');

  try {
    await ensureFirebaseAuth();
    const syncTs = Date.now();
    await setDocWithTimeout(
      doc(db, REQ_COLLECTION, updated.id),
      sanitizeObj({ ...updated, sy: syncTs }),
      { merge: true }
    );
    removeFromQueue(REQ_PENDING_KEY, updated.id);
    notifyCloudSyncBus('diesel');
    return { ok: true };
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(REQ_COLLECTION);
    }
    addToQueue(REQ_PENDING_KEY, updated.id);
    return { ok: false, error: err?.message || 'Offline cached; queued for sync' };
  }
}

export async function pollDieselRequests(): Promise<DieselFuelRequest[]> {
  try {
    await ensureFirebaseAuth();
    if (!(await canAccessFirestorePath(REQ_COLLECTION, false))) {
      return getLocalDieselRequests();
    }
    const snap = await getCollectionDocsServerFirst(collection(db, REQ_COLLECTION));
    const remote: DieselFuelRequest[] = [];
    snap.forEach((d) => {
      const raw = d.data() as DieselFuelRequest & { sy?: number };
      remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 } as DieselFuelRequest);
    });
    const local = getLocalDieselRequests();
    const merged = queueMissingDieselRecords(REQ_PENDING_KEY, mergeById(local, remote), remote);
    writeLocalList(REQ_KEY, merged);
    clearSyncedIdsFromQueue(REQ_PENDING_KEY, local, remote);
    return merged;
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(REQ_COLLECTION);
    }
    return getLocalDieselRequests();
  }
}

export function subscribeDieselRequests(onUpdate: (reqs: DieselFuelRequest[]) => void) {
  onUpdate(getLocalDieselRequests());
  let unsub: () => void = () => {};
  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const scheduleRetry = () => {
    if (cancelled || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!cancelled) start();
    }, 3000);
  };

  const unsubBus = subscribeCloudSyncBus((topic) => {
    if (!cancelled && (topic === 'diesel' || topic === 'all')) {
      onUpdate(getLocalDieselRequests());
    }
  });

  const start = async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    if (!(await canAccessFirestorePath(REQ_COLLECTION, false))) {
      scheduleRetry();
      return;
    }
    if (cancelled) return;
    try {
      unsub();
      unsub = onSnapshot(
        collection(db, REQ_COLLECTION),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: DieselFuelRequest[] = [];
          snap.forEach((d) => {
            const raw = d.data() as DieselFuelRequest & { sy?: number };
            remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 } as DieselFuelRequest);
          });
          const local = getLocalDieselRequests();
          const mergedRaw = mergeById(local, remote);
          const merged = !snap.metadata.fromCache
            ? queueMissingDieselRecords(REQ_PENDING_KEY, mergedRaw, remote)
            : mergedRaw;
          writeLocalList(REQ_KEY, merged);
          clearSyncedIdsFromQueue(REQ_PENDING_KEY, local, remote);
          onUpdate(merged);
          if (!snap.metadata.fromCache) {
            flushPendingDieselData().catch(() => {});
          }
        },
        () => scheduleRetry()
      );
    } catch {
      scheduleRetry();
    }
  };
  start();
  pollDieselRequests()
    .then((merged) => {
      if (!cancelled) onUpdate(merged);
    })
    .catch(() => {});

  const handleOnline = () => {
    if (cancelled) return;
    flushPendingDieselData().catch(() => {});
    pollDieselRequests()
      .then((merged) => {
        if (!cancelled) onUpdate(merged);
      })
      .catch(() => {});
    start();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
  }

  pollTimer = setInterval(() => {
    if (cancelled || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    pollDieselRequests()
      .then((merged) => {
        if (!cancelled) onUpdate(merged);
      })
      .catch(() => {});
  }, 60000);

  return () => {
    cancelled = true;
    unsubBus();
    if (retryTimer) clearTimeout(retryTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
    }
    unsub();
  };
}

// ======================================================
// 3. DIESEL FUEL GRN STORE
// ======================================================
export function getLocalDieselGrns(): DieselGrnRecord[] {
  ensureDieselCsvSeeded();
  return readLocalList<DieselGrnRecord>(GRN_KEY);
}

export async function saveDieselGrn(
  grn: DieselGrnRecord,
  options?: { preserveUpd?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const updated: DieselGrnRecord = {
    ...grn,
    upd: options?.preserveUpd && grn.upd ? grn.upd : Date.now(),
  };
  const merged = mergeById(getLocalDieselGrns(), [updated]);
  writeLocalList(GRN_KEY, merged);
  addToQueue(GRN_PENDING_KEY, updated.id);
  notifyCloudSyncBus('diesel');

  try {
    await ensureFirebaseAuth();
    const syncTs = Math.max(Date.now(), updated.upd || 0);
    await setDocWithTimeout(
      doc(db, GRN_COLLECTION, updated.id),
      sanitizeObj({ ...updated, sy: syncTs }),
      { merge: true }
    );
    removeFromQueue(GRN_PENDING_KEY, updated.id);
    notifyCloudSyncBus('diesel');
    return { ok: true };
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(GRN_COLLECTION);
    }
    addToQueue(GRN_PENDING_KEY, updated.id);
    return { ok: false, error: err?.message || 'Offline cached; queued for sync' };
  }
}

export async function pollDieselGrns(): Promise<DieselGrnRecord[]> {
  try {
    await ensureFirebaseAuth();
    if (!(await canAccessFirestorePath(GRN_COLLECTION, false))) {
      return getLocalDieselGrns();
    }
    const snap = await getCollectionDocsServerFirst(collection(db, GRN_COLLECTION));
    const remote: DieselGrnRecord[] = [];
    snap.forEach((d) => {
      const raw = d.data() as DieselGrnRecord & { sy?: number };
      remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 } as DieselGrnRecord);
    });
    const local = getLocalDieselGrns();
    const merged = queueMissingDieselRecords(GRN_PENDING_KEY, mergeById(local, remote), remote);
    writeLocalList(GRN_KEY, merged);
    clearSyncedIdsFromQueue(GRN_PENDING_KEY, local, remote);
    return merged;
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(GRN_COLLECTION);
    }
    return getLocalDieselGrns();
  }
}

export function subscribeDieselGrns(onUpdate: (grns: DieselGrnRecord[]) => void) {
  onUpdate(getLocalDieselGrns());
  let unsub: () => void = () => {};
  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const scheduleRetry = () => {
    if (cancelled || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!cancelled) start();
    }, 3000);
  };

  const unsubBus = subscribeCloudSyncBus((topic) => {
    if (!cancelled && (topic === 'diesel' || topic === 'all')) {
      onUpdate(getLocalDieselGrns());
    }
  });

  const start = async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    if (!(await canAccessFirestorePath(GRN_COLLECTION, false))) {
      scheduleRetry();
      return;
    }
    if (cancelled) return;
    try {
      unsub();
      unsub = onSnapshot(
        collection(db, GRN_COLLECTION),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: DieselGrnRecord[] = [];
          snap.forEach((d) => {
            const raw = d.data() as DieselGrnRecord & { sy?: number };
            remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 } as DieselGrnRecord);
          });
          const local = getLocalDieselGrns();
          const mergedRaw = mergeById(local, remote);
          const merged = !snap.metadata.fromCache
            ? queueMissingDieselRecords(GRN_PENDING_KEY, mergedRaw, remote)
            : mergedRaw;
          writeLocalList(GRN_KEY, merged);
          clearSyncedIdsFromQueue(GRN_PENDING_KEY, local, remote);
          onUpdate(merged);
          if (!snap.metadata.fromCache) {
            flushPendingDieselData().catch(() => {});
          }
        },
        () => scheduleRetry()
      );
    } catch {
      scheduleRetry();
    }
  };
  start();
  pollDieselGrns()
    .then((merged) => {
      if (!cancelled) onUpdate(merged);
    })
    .catch(() => {});

  const handleOnline = () => {
    if (cancelled) return;
    flushPendingDieselData().catch(() => {});
    pollDieselGrns()
      .then((merged) => {
        if (!cancelled) onUpdate(merged);
      })
      .catch(() => {});
    start();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
  }

  pollTimer = setInterval(() => {
    if (cancelled || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    pollDieselGrns()
      .then((merged) => {
        if (!cancelled) onUpdate(merged);
      })
      .catch(() => {});
  }, 60000);

  return () => {
    cancelled = true;
    unsubBus();
    if (retryTimer) clearTimeout(retryTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
    }
    unsub();
  };
}

export function repairPendingDieselQueues(): number {
  return (
    repairQueueForList(REQ_PENDING_KEY, getLocalDieselRequests() as Array<DieselFuelRequest & { sy?: number }>) +
    repairQueueForList(GRN_PENDING_KEY, getLocalDieselGrns() as Array<DieselGrnRecord & { sy?: number }>)
  );
}

export function getDieselPendingBreakdown(): { active: number; ruleBlocked: number } {
  const tankPending = (() => {
    try {
      return localStorage.getItem(TANK_PENDING_KEY) === '1' ? 1 : 0;
    } catch {
      return 0;
    }
  })();
  const reqLen = readQueue(REQ_PENDING_KEY).length;
  const grnLen = readQueue(GRN_PENDING_KEY).length;

  let active = 0;
  let ruleBlocked = 0;
  if (isFirestorePathBlockedByRules(TANK_COLLECTION)) ruleBlocked += tankPending;
  else active += tankPending;
  if (isFirestorePathBlockedByRules(REQ_COLLECTION)) ruleBlocked += reqLen;
  else active += reqLen;
  if (isFirestorePathBlockedByRules(GRN_COLLECTION)) ruleBlocked += grnLen;
  else active += grnLen;
  return { active, ruleBlocked };
}

export function getPendingDieselCount(): number {
  return getDieselPendingBreakdown().active;
}

export async function flushPendingDieselData(): Promise<number> {
  repairPendingDieselQueues();
  let flushed = 0;
  try {
    await ensureFirebaseAuth();
    if (
      localStorage.getItem(TANK_PENDING_KEY) === '1' &&
      (await canAccessFirestorePath(`${TANK_COLLECTION}/main_bowser`, true))
    ) {
      const tank = getLocalDieselTank();
      try {
        await setDocWithTimeout(
          doc(db, TANK_COLLECTION, 'main_bowser'),
          sanitizeObj({ ...tank, sy: Date.now() }),
          { merge: true }
        );
        localStorage.removeItem(TANK_PENDING_KEY);
        flushed++;
      } catch (err: any) {
        if (isPermissionDeniedError(err)) {
          markFirestorePathBlockedByRules(TANK_COLLECTION);
        }
      }
    }

    const reqQueue = readQueue(REQ_PENDING_KEY);
    if (reqQueue.length && (await canAccessFirestorePath(REQ_COLLECTION, false))) {
      const allReqs = getLocalDieselRequests();
      for (const id of reqQueue) {
        const found = allReqs.find((r) => r.id === id);
        if (!found) {
          removeFromQueue(REQ_PENDING_KEY, id);
          continue;
        }
        try {
          await setDocWithTimeout(
            doc(db, REQ_COLLECTION, found.id),
            sanitizeObj({ ...found, sy: Date.now() }),
            { merge: true }
          );
          removeFromQueue(REQ_PENDING_KEY, found.id);
          flushed++;
        } catch (err: any) {
          if (isPermissionDeniedError(err)) {
            markFirestorePathBlockedByRules(REQ_COLLECTION);
            break;
          }
        }
      }
    }

    const grnQueue = readQueue(GRN_PENDING_KEY);
    if (grnQueue.length && (await canAccessFirestorePath(GRN_COLLECTION, false))) {
      const allGrns = getLocalDieselGrns();
      for (const id of grnQueue) {
        const found = allGrns.find((g) => g.id === id);
        if (!found) {
          removeFromQueue(GRN_PENDING_KEY, id);
          continue;
        }
        try {
          await setDocWithTimeout(
            doc(db, GRN_COLLECTION, found.id),
            sanitizeObj({ ...found, sy: Date.now() }),
            { merge: true }
          );
          removeFromQueue(GRN_PENDING_KEY, found.id);
          flushed++;
        } catch (err: any) {
          if (isPermissionDeniedError(err)) {
            markFirestorePathBlockedByRules(GRN_COLLECTION);
            break;
          }
        }
      }
    }
  } catch {}
  return flushed;
}

// ======================================================
// 4. WORKFLOW ACTIONS (3-STAGE BOWSER GATE + GRN TOP-UP)
// ======================================================
export async function submitFuelRequest(params: {
  date: string;
  shift: 'Day' | 'Night';
  vehicleOrForklift: string;
  driverName: string;
  driverEmail: string;
  requestedLitres: number;
  purpose: string;
  driverRequestSignature: string;
}): Promise<{ ok: boolean; request: DieselFuelRequest; error?: string }> {
  const now = new Date();
  const shortTime = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const reqNo = `FUEL-${params.date.replace(/-/g, '').slice(2)}-${shortTime}-${Math.floor(Math.random() * 90 + 10)}`;

  const req: DieselFuelRequest = {
    id: `DREQ-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
    requestNo: reqNo,
    date: params.date,
    shift: params.shift,
    vehicleOrForklift: params.vehicleOrForklift.trim(),
    driverName: params.driverName.trim(),
    driverEmail: params.driverEmail.trim(),
    requestedLitres: r2(params.requestedLitres),
    purpose: params.purpose.trim() || undefined,
    driverRequestSignature: params.driverRequestSignature,
    requestedAt: now.toISOString(),
    status: 'PENDING_HOD',
    pdfGeneratedOnce: false,
    pdfUnlockedDispense: false,
    upd: Date.now(),
  };

  const res = await saveDieselRequest(req);
  return { ok: res.ok, request: req, error: res.error };
}

/**
 * STAGE 2: Production HOD Approval + 1-Time PDF Generation
 * Strictly enforces generating the approval voucher PDF ONCE to unlock Stage 3 meter dispense.
 */
export async function approveFuelRequestAndUnlockPdf(params: {
  request: DieselFuelRequest;
  tank: DieselTankConfig;
  hodName: string;
  approvedLitres: number;
  hodNotes: string;
  hodSignature: string;
}): Promise<{ ok: boolean; updated?: DieselFuelRequest; error?: string }> {
  const { request, tank, hodName, approvedLitres, hodNotes, hodSignature } = params;

  if (request.pdfGeneratedOnce || request.status !== 'PENDING_HOD') {
    return {
      ok: false,
      error: `Voucher PDF for ${request.requestNo} was already generated once and Stage 3 is unlocked.`,
    };
  }

  const nowIso = new Date().toISOString();
  const updated: DieselFuelRequest = {
    ...request,
    status: 'APPROVED_FOR_DISPENSE',
    hodApprovedBy: hodName.trim(),
    hodApprovedLitres: r2(approvedLitres),
    hodNotes: hodNotes.trim() || undefined,
    hodSignature,
    hodApprovedAt: nowIso,
    pdfGeneratedOnce: true,
    pdfGeneratedAt: nowIso,
    pdfUnlockedDispense: true,
    upd: Date.now(),
  };

  const res = await saveDieselRequest(updated);
  await generateFuelRequestApprovalPdf(updated, tank);

  return { ok: res.ok, updated, error: res.error };
}

export async function rejectFuelRequest(params: {
  request: DieselFuelRequest;
  hodName: string;
  hodNotes: string;
}): Promise<{ ok: boolean; updated: DieselFuelRequest; error?: string }> {
  const updated: DieselFuelRequest = {
    ...params.request,
    status: 'REJECTED',
    hodApprovedBy: params.hodName.trim(),
    hodNotes: params.hodNotes.trim() || 'Request declined by Production HOD',
    hodApprovedAt: new Date().toISOString(),
    pdfUnlockedDispense: false,
    upd: Date.now(),
  };
  const res = await saveDieselRequest(updated);
  return { ok: res.ok, updated, error: res.error };
}

/**
 * STAGE 3: Forklift Driver Bowser Meter Dispense
 * Strictly blocked unless status === 'APPROVED_FOR_DISPENSE' AND pdfGeneratedOnce === true.
 */
export async function dispenseFuelWithMeterReadings(params: {
  request: DieselFuelRequest;
  tank: DieselTankConfig;
  firstMeterReading: number;
  secondMeterReading: number;
  driverDispenseSignature: string;
}): Promise<{
  ok: boolean;
  updatedRequest?: DieselFuelRequest;
  updatedTank?: DieselTankConfig;
  error?: string;
}> {
  const { request, tank, firstMeterReading, secondMeterReading, driverDispenseSignature } = params;

  if (
    request.status !== 'APPROVED_FOR_DISPENSE' ||
    !request.pdfGeneratedOnce ||
    !request.pdfUnlockedDispense
  ) {
    return {
      ok: false,
      error:
        'Locked: Bowser meter entry unlocks only after Production HOD approves and generates the Fuel Request PDF.',
    };
  }

  if (
    Number.isNaN(firstMeterReading) ||
    Number.isNaN(secondMeterReading) ||
    secondMeterReading <= firstMeterReading
  ) {
    return {
      ok: false,
      error: 'Second meter reading (after taking fuel) must be greater than First meter reading.',
    };
  }

  const actualLitresTaken = r2(secondMeterReading - firstMeterReading);
  const currentTank = recomputeDieselTankFromLedger(
    tank,
    getLocalDieselRequests(),
    getLocalDieselGrns()
  );
  const tankLevelBefore = r2(currentTank.currentLevelLitres);
  const nowIso = new Date().toISOString();

  const updatedRequestDraft: DieselFuelRequest = {
    ...request,
    status: 'DISPENSED',
    tankEffect: 'REMOVING',
    dateReceived: request.date,
    qntySigned: -Math.abs(actualLitresTaken),
    firstMeterReading: r2(firstMeterReading),
    secondMeterReading: r2(secondMeterReading),
    actualLitresTaken,
    driverDispenseSignature,
    dispensedAt: nowIso,
    tankLevelBefore,
    tankLevelAfter: r2(tankLevelBefore - actualLitresTaken),
    upd: Date.now(),
  };

  const nextReqs = mergeById(getLocalDieselRequests(), [updatedRequestDraft]);
  const updatedTank = recomputeDieselTankFromLedger(
    {
      ...currentTank,
      currentMeterReading: Math.max(currentTank.currentMeterReading || 0, r2(secondMeterReading)),
      lastUpdatedAt: nowIso,
      upd: Date.now(),
    },
    nextReqs,
    getLocalDieselGrns(),
    `${request.driverName} (${request.requestNo})`
  );

  const updatedRequest: DieselFuelRequest = {
    ...updatedRequestDraft,
    tankLevelAfter: updatedTank.currentLevelLitres,
  };

  const reqSave = await saveDieselRequest(updatedRequest);
  const tankSave = await saveDieselTankConfig(updatedTank);

  return {
    ok: reqSave.ok && tankSave.ok,
    updatedRequest,
    updatedTank,
    error: reqSave.error || tankSave.error,
  };
}

/**
 * FUEL GRN: Offload bulk diesel into Bowser Tank, verify meter readings, collect signatures & print Portrait PDF
 */
export async function recordFuelGrnAndTopUpTank(params: {
  tank: DieselTankConfig;
  date: string;
  shift: 'Day' | 'Night';
  supplierName: string;
  deliveryNoteNo: string;
  receiverName: string;
  receiverEmail: string;
  firstMeterReading: number;
  secondMeterReading: number;
  unitPrice?: number;
  notes: string;
  supplierSignature: string;
  receiverSignature: string;
  hodVerifiedBy?: string;
}): Promise<{
  ok: boolean;
  grn?: DieselGrnRecord;
  updatedTank?: DieselTankConfig;
  error?: string;
}> {
  if (!params.supplierName.trim()) {
    return { ok: false, error: 'Fuel Supplier name is required.' };
  }
  if (
    Number.isNaN(params.firstMeterReading) ||
    Number.isNaN(params.secondMeterReading) ||
    params.secondMeterReading <= params.firstMeterReading
  ) {
    return {
      ok: false,
      error: 'GRN Second Meter Reading must be greater than First Meter Reading.',
    };
  }
  if (!params.supplierSignature || !params.receiverSignature) {
    return {
      ok: false,
      error: 'Both Supplier and LG PLAST Receiver digital signatures are required for Fuel GRN.',
    };
  }

  const now = new Date();
  const litresAdded = r2(params.secondMeterReading - params.firstMeterReading);
  const baseTank = recomputeDieselTankFromLedger(
    params.tank,
    getLocalDieselRequests(),
    getLocalDieselGrns()
  );
  const tankLevelBefore = r2(baseTank.currentLevelLitres);
  const unitPriceNum =
    typeof params.unitPrice === 'number' && params.unitPrice > 0 ? r2(params.unitPrice) : undefined;
  const totalCost = unitPriceNum ? r2(unitPriceNum * litresAdded) : undefined;
  const grnNo = `GRN-${params.date.replace(/-/g, '').slice(2)}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

  const grnDraft: DieselGrnRecord = {
    id: `DGRN-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
    grnNo,
    date: params.date,
    dateRequested: params.date,
    requestedLitres: litresAdded,
    purpose: 'BOWZER TANK TOP UP',
    tankEffect: 'ADDING',
    shift: params.shift,
    supplierName: params.supplierName.trim(),
    deliveryNoteNo: params.deliveryNoteNo.trim() || undefined,
    receiverName: params.receiverName.trim(),
    receiverEmail: params.receiverEmail.trim(),
    firstMeterReading: r2(params.firstMeterReading),
    secondMeterReading: r2(params.secondMeterReading),
    litresAdded,
    unitPrice: unitPriceNum,
    totalCost,
    notes: params.notes.trim() || undefined,
    supplierSignature: params.supplierSignature,
    receiverSignature: params.receiverSignature,
    hodVerifiedBy: params.hodVerifiedBy || params.receiverName.trim(),
    tankLevelBefore,
    tankLevelAfter: r2(tankLevelBefore + litresAdded),
    createdAt: now.toISOString(),
    upd: Date.now(),
  };

  const nextGrns = mergeById(getLocalDieselGrns(), [grnDraft]);
  const updatedTank = recomputeDieselTankFromLedger(
    {
      ...baseTank,
      currentMeterReading: Math.max(baseTank.currentMeterReading || 0, r2(params.secondMeterReading)),
      lastUpdatedAt: now.toISOString(),
      upd: Date.now(),
    },
    getLocalDieselRequests(),
    nextGrns,
    `GRN ${grnNo} (${params.supplierName.trim()})`
  );

  const grn: DieselGrnRecord = {
    ...grnDraft,
    tankLevelAfter: updatedTank.currentLevelLitres,
  };

  const grnSave = await saveDieselGrn(grn);
  const tankSave = await saveDieselTankConfig(updatedTank);
  await generateFuelGrnPdf(grn);

  return {
    ok: grnSave.ok && tankSave.ok,
    grn,
    updatedTank,
    error: grnSave.error || tankSave.error,
  };
}

// ======================================================
// 5. ADMIN-ONLY DIESEL BOWSER USAGE & GRN EXCEL EXPORT
//    Maintains exact CSV Request Ledger Structure + Positives - Negatives Tank Balance
// ======================================================
export function exportDieselExcelWorkbook(
  requests: DieselFuelRequest[],
  grns: DieselGrnRecord[],
  tank: DieselTankConfig,
  fromDate: string,
  toDate: string,
  isAdmin: boolean = false
) {
  if (!isAdmin) return;

  const liveTank = recomputeDieselTankFromLedger(tank, requests, grns);
  const wb = XLSX.utils.book_new();

  const filteredIssues = requests
    .filter((r) => (!fromDate || (r.date || '') >= fromDate) && (!toDate || (r.date || '') <= toDate))
    .sort((a, b) => (a.date + a.requestedAt).localeCompare(b.date + b.requestedAt));

  const filteredGrns = grns
    .filter((g) => (!fromDate || (g.date || '') >= fromDate) && (!toDate || (g.date || '') <= toDate))
    .sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt));

  // Sheet 1: Exact CSV Request Structure (Combined Adding + Removing chronologically)
  type UnifiedDieselRow = {
    sortKey: string;
    dateRequested: string;
    requestedQty: number;
    requestedBy: string;
    purpose: string;
    tankEffect: 'ADDING' | 'REMOVING';
    firstReading: number | '';
    secondReading: number | '';
    dateReceived: string;
    qntyReceived: number | '';
    referenceNo: string;
    status: string;
  };

  const ledgerEntries: UnifiedDieselRow[] = [];

  filteredGrns.forEach((g) => {
    ledgerEntries.push({
      sortKey: `${g.dateRequested || g.date}_${g.createdAt}_${g.id}`,
      dateRequested: g.dateRequested || g.date,
      requestedQty: g.requestedLitres ?? g.litresAdded,
      requestedBy: g.supplierName || g.receiverName,
      purpose: g.purpose || 'BOWZER TANK TOP UP',
      tankEffect: 'ADDING',
      firstReading: g.firstMeterReading ? g.firstMeterReading : '',
      secondReading: g.secondMeterReading ? g.secondMeterReading : '',
      dateReceived: g.date,
      qntyReceived: r2(Math.abs(g.litresAdded)),
      referenceNo: g.grnNo,
      status: 'GRN ADDED (+)',
    });
  });

  filteredIssues.forEach((r) => {
    const signed =
      typeof r.qntySigned === 'number'
        ? r.qntySigned
        : r.status === 'DISPENSED' && typeof r.actualLitresTaken === 'number'
        ? -r2(Math.abs(r.actualLitresTaken))
        : '';
    ledgerEntries.push({
      sortKey: `${r.date}_${r.requestedAt}_${r.id}`,
      dateRequested: r.date,
      requestedQty: r.requestedLitres,
      requestedBy: r.driverName,
      purpose: r.purpose || r.vehicleOrForklift,
      tankEffect: r.tankEffect || 'REMOVING',
      firstReading: typeof r.firstMeterReading === 'number' ? r.firstMeterReading : '',
      secondReading: typeof r.secondMeterReading === 'number' ? r.secondMeterReading : '',
      dateReceived: r.dateReceived || (r.dispensedAt ? r.dispensedAt.slice(0, 10) : r.date),
      qntyReceived: signed,
      referenceNo: r.requestNo,
      status: r.status,
    });
  });

  ledgerEntries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const positivesInRange = r2(filteredGrns.reduce((s, g) => s + (Number(g.litresAdded) || 0), 0));
  const negativesInRange = r2(
    filteredIssues
      .filter((r) => r.status === 'DISPENSED')
      .reduce((s, r) => s + (Number(r.actualLitresTaken) || 0), 0)
  );
  const netPeriodDiff = r2(positivesInRange - negativesInRange);

  const ledgerAoa: (string | number)[][] = [
    ['LG PLAST — DESEAL REQUEST & BOWSER TANK LEDGER (REQUEST STRUCTURE)'],
    [`Period: ${fromDate || 'All'} to ${toDate || 'Latest'}`, `Generated: ${new Date().toLocaleString()}`],
    [
      'Total Positives (+L):',
      positivesInRange,
      'Total Negatives (-L):',
      -negativesInRange,
      'Period Net (Positives - Negatives):',
      netPeriodDiff,
      'Current Tank Level (All-Time Net L):',
      liveTank.currentLevelLitres,
    ],
    [],
    [
      'DATE REQUESTED',
      'REQUESTED QNTY',
      'REQUESTED BY',
      'PURPOSE',
      'TANK EFFECT',
      '1ST READING',
      '2ND READING',
      'DATE RECIVED',
      'QNTY RECEIVED',
      'VOUCHER / GRN NO',
      'STATUS',
    ],
  ];

  ledgerEntries.forEach((row) => {
    ledgerAoa.push([
      row.dateRequested,
      row.requestedQty,
      row.requestedBy,
      row.purpose,
      row.tankEffect,
      row.firstReading,
      row.secondReading,
      row.dateReceived,
      row.qntyReceived,
      row.referenceNo,
      row.status,
    ]);
  });

  ledgerAoa.push([]);
  ledgerAoa.push(['TOTAL POSITIVES (ADDING +L)', '', '', '', 'ADDING', '', '', '', positivesInRange, '', '']);
  ledgerAoa.push(['TOTAL NEGATIVES (REMOVING -L)', '', '', '', 'REMOVING', '', '', '', -negativesInRange, '', '']);
  ledgerAoa.push([
    'CURRENT TANK QUANTITY (POSITIVES - NEGATIVES)',
    '',
    '',
    '',
    'NET BALANCE',
    '',
    '',
    '',
    liveTank.currentLevelLitres,
    '',
    '',
  ]);

  const wsLedger = XLSX.utils.aoa_to_sheet(ledgerAoa);
  wsLedger['!cols'] = [
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 24 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 15 },
    { wch: 16 },
    { wch: 18 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsLedger, 'Diesel Request Ledger');

  // Sheet 2: Bowser Tank Summary
  const summaryRows = [
    { Metric: 'Bowser Tank Name', Value: liveTank.tankName },
    { Metric: 'Report Filter Period', Value: `${fromDate || 'All'} to ${toDate || 'Latest'}` },
    { Metric: 'Tank Capacity (Litres)', Value: liveTank.capacityLitres },
    { Metric: 'All-Time Total Positives / GRN Added (+L)', Value: liveTank.totalReceivedLitres },
    { Metric: 'All-Time Total Negatives / Fuel Issued (-L)', Value: -liveTank.totalIssuedLitres },
    {
      Metric: 'Current Diesel in Tank (Positives - Negatives) (L)',
      Value: liveTank.currentLevelLitres,
    },
    {
      Metric: 'Tank Fill Percentage (%)',
      Value:
        liveTank.capacityLitres > 0
          ? Math.max(0, r2((liveTank.currentLevelLitres / liveTank.capacityLitres) * 100))
          : 0,
    },
    { Metric: 'Current Bowser Flow Meter Reading', Value: liveTank.currentMeterReading },
    { Metric: 'Period Fuel Received (+L)', Value: positivesInRange },
    { Metric: 'Period Fuel Issued (-L)', Value: -negativesInRange },
    { Metric: 'Period Net Change (L)', Value: netPeriodDiff },
    { Metric: 'Last Tank Activity', Value: `${liveTank.lastUpdatedBy} @ ${liveTank.lastUpdatedAt}` },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 44 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Bowser Tank Summary');

  // Sheet 3: Fuel Issues
  const issueSheetRows =
    filteredIssues.length > 0
      ? filteredIssues.map((r) => ({
          'Voucher No': r.requestNo,
          'Date Requested': r.date,
          'Date Received': r.dateReceived || r.date,
          Shift: r.shift,
          'Vehicle / Purpose': r.vehicleOrForklift,
          'Requested By': r.driverName,
          'Requested (L)': r.requestedLitres,
          'Tank Effect': r.tankEffect || 'REMOVING',
          'HOD Approved (L)': r.hodApprovedLitres ?? '',
          'Approved By (HOD)': r.hodApprovedBy || 'Pending',
          'PDF Unlocked': r.pdfGeneratedOnce ? 'Yes' : 'No',
          '1st Meter Reading': r.firstMeterReading ?? '',
          '2nd Meter Reading': r.secondMeterReading ?? '',
          'Qnty Signed (-L)': r.qntySigned ?? (r.actualLitresTaken ? -r.actualLitresTaken : ''),
          'Net Taken (L)': r.actualLitresTaken ?? '',
          Status: r.status,
          'Driver Request Signed': r.driverRequestSignature ? 'Signed' : 'No',
          'HOD Signed': r.hodSignature ? 'Signed' : 'No',
          'Driver Dispense Signed': r.driverDispenseSignature ? 'Signed' : 'No',
        }))
      : [{ Notice: 'No Diesel Issue records in selected period.' }];
  const wsIssues = XLSX.utils.json_to_sheet(issueSheetRows);
  XLSX.utils.book_append_sheet(wb, wsIssues, 'Diesel Issue Usage');

  // Sheet 4: Fuel GRN Receipts
  const grnSheetRows =
    filteredGrns.length > 0
      ? filteredGrns.map((g) => ({
          'GRN No': g.grnNo,
          'Date Requested': g.dateRequested || g.date,
          'Date Received': g.date,
          Shift: g.shift,
          'Requested / Supplier': g.supplierName,
          Purpose: g.purpose || 'BOWZER TANK TOP UP',
          'Tank Effect': 'ADDING',
          'Requested (L)': g.requestedLitres ?? g.litresAdded,
          'Delivery Note No': g.deliveryNoteNo || '',
          'Receiver (LG PLAST)': g.receiverName,
          '1st Meter Reading': g.firstMeterReading,
          '2nd Meter Reading': g.secondMeterReading,
          'Litres Added (+L)': g.litresAdded,
          'Unit Price': g.unitPrice ?? '',
          'Total Cost': g.totalCost ?? '',
          'Supplier Signed': g.supplierSignature ? 'Signed' : 'No',
          'Receiver Signed': g.receiverSignature ? 'Signed' : 'No',
          Notes: g.notes || '',
        }))
      : [{ Notice: 'No Fuel GRN records in selected period.' }];
  const wsGrns = XLSX.utils.json_to_sheet(grnSheetRows);
  XLSX.utils.book_append_sheet(wb, wsGrns, 'Fuel GRN Receipts');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveFileBlob(
    `LGPLAST_Diesel_Bowser_Report_${fromDate || 'All'}_to_${toDate || 'Latest'}.xlsx`,
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  );
}
