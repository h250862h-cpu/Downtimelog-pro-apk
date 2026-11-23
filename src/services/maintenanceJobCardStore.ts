import {
  collection,
  doc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import {
  canAccessFirestorePath,
  db,
  deepSanitizeForFirestore,
  ensureFirebaseAuth,
  getCollectionDocsServerFirst,
  isFirestorePathBlockedByRules,
  isPermissionDeniedError,
  markFirestorePathBlockedByRules,
  notifyCloudSyncBus,
  resetFirestorePathAccessCache,
  subscribeCloudSyncBus,
} from '../firebase';
import { MaintenanceJobCard, normalizeMachineName } from '../types';

const MNT_STORAGE_KEY = 'lgplast_maintenance_job_cards_v1';
const MNT_PENDING_KEY = 'lgplast_maintenance_job_cards_pending_v1';
const MNT_COLLECTION = 'maintenance_job_cards';
const FIRESTORE_WRITE_TIMEOUT_MS = 4500;

let lastMaintenanceSyncError: string | null = null;

export function getLastMaintenanceSyncError(): string | null {
  return lastMaintenanceSyncError;
}

function sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
  return deepSanitizeForFirestore(obj);
}

function readLocalCards(): MaintenanceJobCard[] {
  try {
    const raw = localStorage.getItem(MNT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalCards(items: MaintenanceJobCard[]) {
  try {
    localStorage.setItem(MNT_STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

function getPendingIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(MNT_PENDING_KEY) || '[]');
  } catch {
    return [];
  }
}

function addPendingId(id: string) {
  const q = getPendingIds();
  if (!q.includes(id)) {
    try {
      localStorage.setItem(MNT_PENDING_KEY, JSON.stringify([...q, id]));
    } catch {}
  }
}

function removePendingId(id: string) {
  const q = getPendingIds().filter((x) => x !== id);
  try {
    localStorage.setItem(MNT_PENDING_KEY, JSON.stringify(q));
  } catch {}
}

export function repairPendingMaintenanceJobCardQueues(): number {
  try {
    const raw = localStorage.getItem(MNT_PENDING_KEY);
    if (!raw) return 0;
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue)) {
      localStorage.removeItem(MNT_PENDING_KEY);
      return 0;
    }
    const local = readLocalCards();
    const byId = new Map(local.map((c) => [c.id, c]));
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
      localStorage.setItem(MNT_PENDING_KEY, JSON.stringify(cleaned));
    }
    return cleaned.length;
  } catch {
    return 0;
  }
}

function clearSyncedCardsFromQueue(
  local: MaintenanceJobCard[],
  remote: MaintenanceJobCard[]
) {
  const pending = getPendingIds();
  if (!pending.length) return;
  const localMap = new Map(local.map((c) => [c.id, c]));
  const remoteMap = new Map(remote.map((c) => [c.id, c]));
  pending.forEach((id) => {
    const r = remoteMap.get(id);
    const l = localMap.get(id);
    if (r && (!l || (r.upd || 0) >= (l.upd || 0))) {
      removePendingId(id);
    }
  });
}

function queueMissingCardsFromRemote(
  merged: MaintenanceJobCard[],
  remote: MaintenanceJobCard[]
): MaintenanceJobCard[] {
  const remoteMap = new Map(remote.map((r) => [r.id, r]));
  let mutated = false;
  const next = merged.map((card) => {
    if (!card?.id) return card;
    const r = remoteMap.get(card.id);
    if (!r || (card.upd || 0) > (r.upd || 0)) {
      addPendingId(card.id);
      if (card.sy !== 0) {
        mutated = true;
        return { ...card, sy: 0 };
      }
    }
    return card;
  });
  return mutated ? next : merged;
}

function mergeCards(
  local: MaintenanceJobCard[],
  remote: MaintenanceJobCard[]
): MaintenanceJobCard[] {
  const map: Record<string, MaintenanceJobCard> = {};
  local.forEach((c) => {
    if (c?.id) map[c.id] = c;
  });
  remote.forEach((c) => {
    if (!c?.id) return;
    const ex = map[c.id];
    if (!ex || (c.upd || 0) >= (ex.upd || 0)) {
      map[c.id] = c;
    }
  });
  return Object.values(map).sort((a, b) => (b.upd || 0) - (a.upd || 0));
}

export function getLocalMaintenanceJobCards(): MaintenanceJobCard[] {
  return readLocalCards();
}

export async function saveMaintenanceJobCardToFirebase(
  card: MaintenanceJobCard,
  options?: { preserveUpd?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const updated: MaintenanceJobCard = {
    ...card,
    machine: normalizeMachineName(card.machine),
    upd: options?.preserveUpd && card.upd ? card.upd : Date.now(),
  };

  const mergedLocal = mergeCards(readLocalCards(), [updated]);
  saveLocalCards(mergedLocal);
  addPendingId(updated.id);
  notifyCloudSyncBus('maintenance');

  try {
    const syncTs = Date.now();
    const payload = sanitizeForFirestore({ ...updated, sy: syncTs });

    const writePromise = (async () => {
      await ensureFirebaseAuth();
      await setDoc(doc(db, MNT_COLLECTION, updated.id), payload, { merge: true });
    })().then(
      () => {
        lastMaintenanceSyncError = null;
        removePendingId(updated.id);
        const latest = readLocalCards().map((c) =>
          c.id === updated.id ? ({ ...c, sy: syncTs } as MaintenanceJobCard) : c
        );
        saveLocalCards(latest);
        notifyCloudSyncBus('maintenance');
        return { ok: true as const };
      },
      (err: any) => {
        const errMsg = isPermissionDeniedError(err)
          ? 'Firestore rejected maintenance_job_cards write (publish updated firestore.rules in Firebase Console).'
          : err?.message || 'Saved locally (offline)';
        if (isPermissionDeniedError(err)) {
          markFirestorePathBlockedByRules(MNT_COLLECTION);
        }
        lastMaintenanceSyncError = errMsg;
        addPendingId(updated.id);
        return { ok: false as const, error: errMsg };
      }
    );

    const timeoutPromise = new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(() => {
        resolve({ ok: false, error: 'Saved locally — queued for cloud sync' });
      }, FIRESTORE_WRITE_TIMEOUT_MS)
    );

    return await Promise.race([writePromise, timeoutPromise]);
  } catch (err: any) {
    const errMsg = isPermissionDeniedError(err)
      ? 'Firestore rejected maintenance_job_cards write (publish updated firestore.rules in Firebase Console).'
      : err?.message || 'Saved locally (offline)';
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(MNT_COLLECTION);
    }
    lastMaintenanceSyncError = errMsg;
    addPendingId(updated.id);
    return { ok: false, error: errMsg };
  }
}

export function getMaintenanceJobCardsPendingBreakdown(): {
  active: number;
  ruleBlocked: number;
} {
  const len = getPendingIds().length;
  return isFirestorePathBlockedByRules(MNT_COLLECTION)
    ? { active: 0, ruleBlocked: len }
    : { active: len, ruleBlocked: 0 };
}

export async function flushPendingMaintenanceJobCards(): Promise<number> {
  repairPendingMaintenanceJobCardQueues();
  const ids = getPendingIds();
  if (!ids.length) return 0;
  if (!(await canAccessFirestorePath(MNT_COLLECTION, false))) return 0;
  const local = readLocalCards();
  let flushed = 0;
  for (const id of ids) {
    if (isFirestorePathBlockedByRules(MNT_COLLECTION)) break;
    const found = local.find((c) => c.id === id);
    if (found) {
      const r = await saveMaintenanceJobCardToFirebase(found, { preserveUpd: true });
      if (r.ok) flushed++;
    } else {
      removePendingId(id);
    }
  }
  return flushed;
}

export async function pollMaintenanceJobCards(
  forceFresh: boolean = false
): Promise<MaintenanceJobCard[]> {
  try {
    if (forceFresh) {
      resetFirestorePathAccessCache();
    }
    await ensureFirebaseAuth();
    if (!(await canAccessFirestorePath(MNT_COLLECTION, false))) {
      lastMaintenanceSyncError =
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'Device is offline.'
          : 'Cloud permission blocked maintenance_job_cards — verify updated Firestore Rules are published in Firebase Console.';
      return readLocalCards();
    }
    const snap = await getCollectionDocsServerFirst(collection(db, MNT_COLLECTION));
    const remote: MaintenanceJobCard[] = [];
    snap.forEach((d) => {
      const raw = d.data() as MaintenanceJobCard;
      remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 });
    });
    const local = readLocalCards();
    const merged = queueMissingCardsFromRemote(mergeCards(local, remote), remote);
    saveLocalCards(merged);
    clearSyncedCardsFromQueue(local, remote);
    lastMaintenanceSyncError = null;
    return merged;
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(MNT_COLLECTION);
      lastMaintenanceSyncError =
        'Cloud permission denied on maintenance_job_cards — verify updated Firestore Rules are published in Firebase Console.';
    } else {
      lastMaintenanceSyncError = err?.message || 'Failed to sync maintenance job cards.';
    }
    return readLocalCards();
  }
}

export function subscribeMaintenanceJobCards(
  onUpdate: (cards: MaintenanceJobCard[]) => void
) {
  onUpdate(readLocalCards());
  let unsub = () => {};
  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const scheduleRetry = () => {
    if (cancelled || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!cancelled) {
        attachListener().catch(() => {});
      }
    }, 3000);
  };

  const unsubBus = subscribeCloudSyncBus((topic) => {
    if (!cancelled && (topic === 'maintenance' || topic === 'all')) {
      onUpdate(readLocalCards());
    }
  });

  const attachListener = async () => {
    if (cancelled) return;
    await ensureFirebaseAuth();
    if (cancelled) return;
    const allowed = await canAccessFirestorePath(MNT_COLLECTION, false);
    if (cancelled) return;
    if (!allowed) {
      scheduleRetry();
      return;
    }
    try {
      unsub();
      unsub = onSnapshot(
        collection(db, MNT_COLLECTION),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: MaintenanceJobCard[] = [];
          snap.forEach((d) => {
            const raw = d.data() as MaintenanceJobCard;
            remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 });
          });
          const local = readLocalCards();
          const mergedRaw = mergeCards(local, remote);
          const merged = !snap.metadata.fromCache
            ? queueMissingCardsFromRemote(mergedRaw, remote)
            : mergedRaw;
          saveLocalCards(merged);
          clearSyncedCardsFromQueue(local, remote);
          lastMaintenanceSyncError = null;
          onUpdate(merged);
          if (!snap.metadata.fromCache) {
            flushPendingMaintenanceJobCards().catch(() => {});
          }
        },
        (err) => {
          if (isPermissionDeniedError(err)) {
            markFirestorePathBlockedByRules(MNT_COLLECTION);
            lastMaintenanceSyncError =
              'Cloud permission denied on maintenance_job_cards — verify updated Firestore Rules are published.';
          }
          console.warn('MaintenanceJobCards listener warning:', err.message);
          scheduleRetry();
        }
      );
    } catch {
      scheduleRetry();
    }
  };

  attachListener().catch(() => {});
  pollMaintenanceJobCards()
    .then((merged) => {
      if (!cancelled) onUpdate(merged);
    })
    .catch(() => {});

  const handleOnline = () => {
    if (cancelled) return;
    flushPendingMaintenanceJobCards().catch(() => {});
    pollMaintenanceJobCards()
      .then((merged) => {
        if (!cancelled) onUpdate(merged);
      })
      .catch(() => {});
    attachListener().catch(() => {});
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
  }

  pollTimer = setInterval(() => {
    if (cancelled || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    flushPendingMaintenanceJobCards().catch(() => {});
    pollMaintenanceJobCards()
      .then((merged) => {
        if (!cancelled) onUpdate(merged);
      })
      .catch(() => {});
  }, 6000);

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
