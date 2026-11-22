import {
  collection,
  doc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import {
  canAccessFirestorePath,
  db,
  deepSanitizeForFirestore,
  ensureFirebaseAuth,
  getCollectionDocsServerFirst,
  isFirestorePathBlockedByRules,
  isPermissionDeniedError,
  markFirestorePathBlockedByRules,
} from '../firebase';
import {
  DispatchEntry,
  GUM_BOOT_SIZES,
  ProductionPlanItem,
  SpecialOrder,
  SpecialOrderFactoryProduction,
  SpecialOrderSizeItem,
  SpecialOrderWhDispatch,
  normalizeMachineName,
} from '../types';
import { saveDispatchEntryToFirebase, softDeleteDispatchEntryById } from './dispatchStore';
import { saveFileBlob, ymd } from './downtimeCalc';
import { drawLgplastPdfHeader, ensureLgplastLogoLoaded } from './reportPdf';

const ORDERS_STORAGE_KEY = 'lgplast_special_orders_v1';
const PROD_STORAGE_KEY = 'lgplast_special_order_prod_v1';
const WH_DISPATCH_STORAGE_KEY = 'lgplast_special_order_wh_dispatch_v1';
const DELETED_IDS_KEY = 'lgplast_so_deleted_ids_v1';

const ORDERS_PENDING_KEY = 'lgplast_so_orders_pending_v1';
const PROD_PENDING_KEY = 'lgplast_so_prod_pending_v1';
const WH_DISPATCH_PENDING_KEY = 'lgplast_so_wh_pending_v1';

const ORDERS_COL = 'special_orders';
const PROD_COL = 'special_order_production';
const WH_DISPATCH_COL = 'special_order_wh_dispatches';

export const DEFAULT_GUM_BOOT_SPECIAL_ORDER: SpecialOrder = {
  id: 'SO-GUMBOOT-39-46',
  orderNo: 'SO-GUMBOOT-01',
  title: 'Captain Black Gum Boots (Sizes 39–46)',
  customerName: 'Special Contract Stock Order',
  productPrefix: 'GUM BOOT CAPTAIN BLACK',
  machine: 'Gumboot Machine',
  sizes: [...GUM_BOOT_SIZES],
  status: 'ACTIVE',
  notes: 'Factory special production run across sizes 39 to 46. Held in factory stock until ready order dispatch to WH.',
  createdBy: 'LG PLAST Production Planning',
  createdAt: '2026-11-01T07:30:00.000Z',
  upd: 1730446200000,
};

function sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
  return deepSanitizeForFirestore(obj);
}

export function buildSpecialOrderSizeProductName(
  productPrefix: string,
  sizeLabel: string
): string {
  const cleanPrefix = productPrefix.trim();
  const cleanSize = sizeLabel.trim();
  if (cleanPrefix.toUpperCase() === 'GUM BOOT CAPTAIN BLACK') {
    const upperSize = cleanSize.toUpperCase();
    return `GUM BOOT CAPTAIN BLACK ${upperSize} 5PC`;
  }
  return `${cleanPrefix} ${cleanSize}`.trim();
}

function readDeletedIdSet(): Set<string> {
  const set = new Set<string>();
  try {
    const raw = localStorage.getItem(DELETED_IDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((id) => {
          if (typeof id === 'string' && id) set.add(id);
        });
      }
    }
  } catch {}
  return set;
}

function markIdsDeletedLocally(ids: string[]) {
  if (!ids.length) return;
  const current = readDeletedIdSet();
  ids.forEach((id) => {
    if (id) current.add(id);
  });
  saveLocalList(DELETED_IDS_KEY, Array.from(current).slice(-500));
}

function mergeById<T extends { id: string; upd?: number; deleted?: boolean }>(
  local: T[],
  remote: T[],
  sortDesc = true,
  enforceDeletedTombstones = false
): T[] {
  const deletedSet = enforceDeletedTombstones ? readDeletedIdSet() : new Set<string>();
  const newlyDeletedFromRemote: string[] = [];
  const map: Record<string, T> = {};

  local.forEach((item) => {
    if (!item?.id) return;
    if (enforceDeletedTombstones && item.deleted) deletedSet.add(item.id);
    map[item.id] = item;
  });

  remote.forEach((item) => {
    if (!item?.id) return;
    if (enforceDeletedTombstones && item.deleted) {
      deletedSet.add(item.id);
      newlyDeletedFromRemote.push(item.id);
    }
    const existing = map[item.id];
    if (!existing) {
      map[item.id] = item;
    } else if (enforceDeletedTombstones && existing.deleted && !item.deleted) {
      // Once HOD deletes a raised batch/dispatch ID, keep it deleted forever
      map[item.id] = existing;
    } else if ((enforceDeletedTombstones && item.deleted) || (item.upd || 0) >= (existing.upd || 0)) {
      map[item.id] = item;
    }
  });

  if (enforceDeletedTombstones && newlyDeletedFromRemote.length > 0) {
    markIdsDeletedLocally(newlyDeletedFromRemote);
  }

  return Object.values(map)
    .map((item) =>
      enforceDeletedTombstones && deletedSet.has(item.id) && !item.deleted
        ? ({ ...item, deleted: true } as T)
        : item
    )
    .sort((a, b) => (sortDesc ? (b.upd || 0) - (a.upd || 0) : (a.upd || 0) - (b.upd || 0)));
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

function saveLocalList<T>(key: string, items: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {}
}

function addPendingId(key: string, id: string) {
  const q = readLocalList<string>(key);
  if (!q.includes(id)) {
    saveLocalList(key, [...q, id]);
  }
}

function removePendingId(key: string, id: string) {
  const q = readLocalList<string>(key).filter((x) => x !== id);
  saveLocalList(key, q);
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
  const pending = readLocalList<string>(pendingKey);
  if (!pending.length) return;
  const localMap = new Map(local.map((x) => [x.id, x]));
  const remoteMap = new Map(remote.map((x) => [x.id, x]));
  pending.forEach((id) => {
    const r = remoteMap.get(id);
    const l = localMap.get(id);
    if (r && (!l || (r.upd || 0) >= (l.upd || 0))) {
      removePendingId(pendingKey, id);
    }
  });
}

function ensureDefaultGumBootOrder(orders: SpecialOrder[]): SpecialOrder[] {
  const hasDefault = orders.some((o) => o.id === DEFAULT_GUM_BOOT_SPECIAL_ORDER.id);
  if (hasDefault) return orders;
  return [DEFAULT_GUM_BOOT_SPECIAL_ORDER, ...orders];
}

// ======================================================
// LOCAL ACCESSORS (RAW VS ACTIVE FILTERED)
// ======================================================

function filterActiveRecords<T extends { id: string; deleted?: boolean }>(items: T[]): T[] {
  const deletedSet = readDeletedIdSet();
  return items.filter((item) => item && !item.deleted && !deletedSet.has(item.id));
}

function readRawSpecialOrderProductions(): SpecialOrderFactoryProduction[] {
  return readLocalList<SpecialOrderFactoryProduction>(PROD_STORAGE_KEY);
}

function readRawSpecialOrderWhDispatches(): SpecialOrderWhDispatch[] {
  return readLocalList<SpecialOrderWhDispatch>(WH_DISPATCH_STORAGE_KEY);
}

export function getLocalSpecialOrders(): SpecialOrder[] {
  return ensureDefaultGumBootOrder(readLocalList<SpecialOrder>(ORDERS_STORAGE_KEY));
}

export function getLocalSpecialOrderProductions(): SpecialOrderFactoryProduction[] {
  return filterActiveRecords(readRawSpecialOrderProductions());
}

export function getLocalSpecialOrderWhDispatches(): SpecialOrderWhDispatch[] {
  return filterActiveRecords(readRawSpecialOrderWhDispatches());
}

// ======================================================
// CLOUD SAVE + FLUSH + POLL + SUBSCRIBE
// ======================================================

const FIRESTORE_WRITE_TIMEOUT_MS = 3500;

async function commitDocWithUiTimeout(
  colName: string,
  docId: string,
  payload: Record<string, any>,
  onCommitSuccess: () => void,
  onCommitFailure: (err: any) => void
): Promise<{ ok: boolean; error?: string }> {
  const writePromise = (async () => {
    await ensureFirebaseAuth();
    await setDoc(doc(db, colName, docId), payload, { merge: true });
  })().then(
    () => {
      onCommitSuccess();
      return { ok: true as const };
    },
    (err: any) => {
      onCommitFailure(err);
      return { ok: false as const, error: err?.message || 'Saved locally (offline)' };
    }
  );

  const timeoutPromise = new Promise<{ ok: false; error: string }>((resolve) =>
    setTimeout(() => {
      resolve({ ok: false, error: 'Saved locally — queued for cloud sync' });
    }, FIRESTORE_WRITE_TIMEOUT_MS)
  );

  return Promise.race([writePromise, timeoutPromise]);
}

export async function saveSpecialOrderToFirebase(
  order: SpecialOrder,
  options?: { preserveUpd?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const updated: SpecialOrder = {
    ...order,
    machine: normalizeMachineName(order.machine || 'Gumboot Machine'),
    upd: options?.preserveUpd && order.upd ? order.upd : Date.now(),
  };
  const current = getLocalSpecialOrders();
  const next = mergeById(current, [updated]);
  saveLocalList(ORDERS_STORAGE_KEY, next);
  addPendingId(ORDERS_PENDING_KEY, updated.id);

  try {
    const syncTs = Date.now();
    const payload = sanitizeForFirestore({ ...updated, sy: syncTs });
    return await commitDocWithUiTimeout(
      ORDERS_COL,
      updated.id,
      payload,
      () => {
        removePendingId(ORDERS_PENDING_KEY, updated.id);
        const latest = getLocalSpecialOrders().map((x) =>
          x.id === updated.id ? ({ ...x, sy: syncTs } as SpecialOrder) : x
        );
        saveLocalList(ORDERS_STORAGE_KEY, latest);
      },
      (err) => {
        if (isPermissionDeniedError(err)) {
          markFirestorePathBlockedByRules(ORDERS_COL);
        }
        addPendingId(ORDERS_PENDING_KEY, updated.id);
      }
    );
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(ORDERS_COL);
    }
    addPendingId(ORDERS_PENDING_KEY, updated.id);
    return { ok: false, error: err?.message || 'Saved locally (offline)' };
  }
}

export async function saveSpecialOrderProductionToFirebase(
  entry: SpecialOrderFactoryProduction,
  options?: { preserveUpd?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const updated: SpecialOrderFactoryProduction = {
    ...entry,
    machine: normalizeMachineName(entry.machine),
    upd: options?.preserveUpd && entry.upd ? entry.upd : Date.now(),
  };
  if (updated.deleted) {
    markIdsDeletedLocally([updated.id]);
  }
  const current = readRawSpecialOrderProductions();
  const next = mergeById(current, [updated], true, true);
  saveLocalList(PROD_STORAGE_KEY, next);
  addPendingId(PROD_PENDING_KEY, updated.id);

  try {
    const syncTs = Date.now();
    const payload = sanitizeForFirestore({ ...updated, sy: syncTs });
    return await commitDocWithUiTimeout(
      PROD_COL,
      updated.id,
      payload,
      () => {
        removePendingId(PROD_PENDING_KEY, updated.id);
        const latest = readRawSpecialOrderProductions().map((x) =>
          x.id === updated.id ? ({ ...x, sy: syncTs } as SpecialOrderFactoryProduction) : x
        );
        saveLocalList(PROD_STORAGE_KEY, latest);
      },
      (err) => {
        if (isPermissionDeniedError(err)) {
          markFirestorePathBlockedByRules(PROD_COL);
        }
        addPendingId(PROD_PENDING_KEY, updated.id);
      }
    );
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(PROD_COL);
    }
    addPendingId(PROD_PENDING_KEY, updated.id);
    return { ok: false, error: err?.message || 'Saved locally (offline)' };
  }
}

export async function saveSpecialOrderWhDispatchToFirebase(
  entry: SpecialOrderWhDispatch,
  options?: { preserveUpd?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const updated: SpecialOrderWhDispatch = {
    ...entry,
    machine: normalizeMachineName(entry.machine),
    upd: options?.preserveUpd && entry.upd ? entry.upd : Date.now(),
  };
  if (updated.deleted) {
    markIdsDeletedLocally([updated.id]);
  }
  const current = readRawSpecialOrderWhDispatches();
  const next = mergeById(current, [updated], true, true);
  saveLocalList(WH_DISPATCH_STORAGE_KEY, next);
  addPendingId(WH_DISPATCH_PENDING_KEY, updated.id);

  try {
    const syncTs = Date.now();
    const payload = sanitizeForFirestore({ ...updated, sy: syncTs });
    return await commitDocWithUiTimeout(
      WH_DISPATCH_COL,
      updated.id,
      payload,
      () => {
        removePendingId(WH_DISPATCH_PENDING_KEY, updated.id);
        const latest = readRawSpecialOrderWhDispatches().map((x) =>
          x.id === updated.id ? ({ ...x, sy: syncTs } as SpecialOrderWhDispatch) : x
        );
        saveLocalList(WH_DISPATCH_STORAGE_KEY, latest);
      },
      (err) => {
        if (isPermissionDeniedError(err)) {
          markFirestorePathBlockedByRules(WH_DISPATCH_COL);
        }
        addPendingId(WH_DISPATCH_PENDING_KEY, updated.id);
      }
    );
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(WH_DISPATCH_COL);
    }
    addPendingId(WH_DISPATCH_PENDING_KEY, updated.id);
    return { ok: false, error: err?.message || 'Saved locally (offline)' };
  }
}

export function repairPendingSpecialOrderQueues(): number {
  return (
    repairQueueForList(ORDERS_PENDING_KEY, getLocalSpecialOrders() as Array<SpecialOrder & { sy?: number }>) +
    repairQueueForList(PROD_PENDING_KEY, readRawSpecialOrderProductions() as Array<SpecialOrderFactoryProduction & { sy?: number }>) +
    repairQueueForList(WH_DISPATCH_PENDING_KEY, readRawSpecialOrderWhDispatches() as Array<SpecialOrderWhDispatch & { sy?: number }>)
  );
}

export function getSpecialOrderPendingBreakdown(): { active: number; ruleBlocked: number } {
  const ordLen = readLocalList<string>(ORDERS_PENDING_KEY).length;
  const prodLen = readLocalList<string>(PROD_PENDING_KEY).length;
  const whLen = readLocalList<string>(WH_DISPATCH_PENDING_KEY).length;
  let active = 0;
  let ruleBlocked = 0;
  if (isFirestorePathBlockedByRules(ORDERS_COL)) ruleBlocked += ordLen;
  else active += ordLen;
  if (isFirestorePathBlockedByRules(PROD_COL)) ruleBlocked += prodLen;
  else active += prodLen;
  if (isFirestorePathBlockedByRules(WH_DISPATCH_COL)) ruleBlocked += whLen;
  else active += whLen;
  return { active, ruleBlocked };
}

export function getPendingSpecialOrderCount(): number {
  return getSpecialOrderPendingBreakdown().active;
}

export async function flushPendingSpecialOrderData(): Promise<number> {
  repairPendingSpecialOrderQueues();
  let count = 0;
  const orderIds = readLocalList<string>(ORDERS_PENDING_KEY);
  if (orderIds.length && (await canAccessFirestorePath(ORDERS_COL, false))) {
    const localOrders = getLocalSpecialOrders();
    for (const id of orderIds) {
      if (isFirestorePathBlockedByRules(ORDERS_COL)) break;
      const found = localOrders.find((x) => x.id === id);
      if (found) {
        const r = await saveSpecialOrderToFirebase(found, { preserveUpd: true });
        if (r.ok) count++;
      } else {
        removePendingId(ORDERS_PENDING_KEY, id);
      }
    }
  }

  const prodIds = readLocalList<string>(PROD_PENDING_KEY);
  if (prodIds.length && (await canAccessFirestorePath(PROD_COL, false))) {
    const localProd = readRawSpecialOrderProductions();
    for (const id of prodIds) {
      if (isFirestorePathBlockedByRules(PROD_COL)) break;
      const found = localProd.find((x) => x.id === id);
      if (found) {
        const r = await saveSpecialOrderProductionToFirebase(found, { preserveUpd: true });
        if (r.ok) count++;
      } else {
        removePendingId(PROD_PENDING_KEY, id);
      }
    }
  }

  const whIds = readLocalList<string>(WH_DISPATCH_PENDING_KEY);
  if (whIds.length && (await canAccessFirestorePath(WH_DISPATCH_COL, false))) {
    const localWh = readRawSpecialOrderWhDispatches();
    for (const id of whIds) {
      if (isFirestorePathBlockedByRules(WH_DISPATCH_COL)) break;
      const found = localWh.find((x) => x.id === id);
      if (found) {
        const r = await saveSpecialOrderWhDispatchToFirebase(found, { preserveUpd: true });
        if (r.ok) count++;
      } else {
        removePendingId(WH_DISPATCH_PENDING_KEY, id);
      }
    }
  }

  return count;
}

export async function pollSpecialOrders(): Promise<SpecialOrder[]> {
  try {
    await ensureFirebaseAuth();
    if (!(await canAccessFirestorePath(ORDERS_COL, false))) {
      return getLocalSpecialOrders();
    }
    const snap = await getCollectionDocsServerFirst(collection(db, ORDERS_COL));
    const remote: SpecialOrder[] = [];
    snap.forEach((d) => {
      const raw = d.data() as SpecialOrder & { sy?: number };
      remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 } as SpecialOrder);
    });
    const local = getLocalSpecialOrders();
    const merged = ensureDefaultGumBootOrder(mergeById(local, remote));
    saveLocalList(ORDERS_STORAGE_KEY, merged);
    clearSyncedIdsFromQueue(ORDERS_PENDING_KEY, local, remote);
    return merged;
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(ORDERS_COL);
    }
    return getLocalSpecialOrders();
  }
}

export async function pollSpecialOrderProductions(): Promise<SpecialOrderFactoryProduction[]> {
  try {
    await ensureFirebaseAuth();
    if (!(await canAccessFirestorePath(PROD_COL, false))) {
      return getLocalSpecialOrderProductions();
    }
    const snap = await getCollectionDocsServerFirst(collection(db, PROD_COL));
    const remote: SpecialOrderFactoryProduction[] = [];
    snap.forEach((d) => {
      const raw = d.data() as SpecialOrderFactoryProduction & { sy?: number };
      remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 } as SpecialOrderFactoryProduction);
    });
    const local = readRawSpecialOrderProductions();
    const merged = mergeById(local, remote, true, true);
    saveLocalList(PROD_STORAGE_KEY, merged);
    clearSyncedIdsFromQueue(PROD_PENDING_KEY, local, remote);
    return filterActiveRecords(merged);
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(PROD_COL);
    }
    return getLocalSpecialOrderProductions();
  }
}

export async function pollSpecialOrderWhDispatches(): Promise<SpecialOrderWhDispatch[]> {
  try {
    await ensureFirebaseAuth();
    if (!(await canAccessFirestorePath(WH_DISPATCH_COL, false))) {
      return getLocalSpecialOrderWhDispatches();
    }
    const snap = await getCollectionDocsServerFirst(collection(db, WH_DISPATCH_COL));
    const remote: SpecialOrderWhDispatch[] = [];
    snap.forEach((d) => {
      const raw = d.data() as SpecialOrderWhDispatch & { sy?: number };
      remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 } as SpecialOrderWhDispatch);
    });
    const local = readRawSpecialOrderWhDispatches();
    const merged = mergeById(local, remote, true, true);
    saveLocalList(WH_DISPATCH_STORAGE_KEY, merged);
    clearSyncedIdsFromQueue(WH_DISPATCH_PENDING_KEY, local, remote);
    return filterActiveRecords(merged);
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(WH_DISPATCH_COL);
    }
    return getLocalSpecialOrderWhDispatches();
  }
}

export function subscribeSpecialOrders(onUpdate: (rows: SpecialOrder[]) => void) {
  onUpdate(getLocalSpecialOrders());
  let unsub = () => {};
  let cancelled = false;
  (async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    if (!(await canAccessFirestorePath(ORDERS_COL, false))) return;
    if (cancelled) return;
    try {
      unsub = onSnapshot(
        collection(db, ORDERS_COL),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: SpecialOrder[] = [];
          snap.forEach((d) => {
            const raw = d.data() as SpecialOrder & { sy?: number };
            remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 } as SpecialOrder);
          });
          const local = getLocalSpecialOrders();
          const merged = ensureDefaultGumBootOrder(mergeById(local, remote));
          saveLocalList(ORDERS_STORAGE_KEY, merged);
          clearSyncedIdsFromQueue(ORDERS_PENDING_KEY, local, remote);
          onUpdate(merged);
          if (!snap.metadata.fromCache) {
            flushPendingSpecialOrderData().catch(() => {});
          }
        },
        (err) => {
          if (isPermissionDeniedError(err)) {
            markFirestorePathBlockedByRules(ORDERS_COL);
          }
          console.warn('SpecialOrders listener warning:', err.message);
        }
      );
    } catch {}
  })();
  return () => {
    cancelled = true;
    unsub();
  };
}

export function subscribeSpecialOrderProductions(
  onUpdate: (rows: SpecialOrderFactoryProduction[]) => void
) {
  onUpdate(getLocalSpecialOrderProductions());
  let unsub = () => {};
  let cancelled = false;
  (async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    if (!(await canAccessFirestorePath(PROD_COL, false))) return;
    if (cancelled) return;
    try {
      unsub = onSnapshot(
        collection(db, PROD_COL),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: SpecialOrderFactoryProduction[] = [];
          snap.forEach((d) => {
            const raw = d.data() as SpecialOrderFactoryProduction & { sy?: number };
            remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 } as SpecialOrderFactoryProduction);
          });
          const local = readRawSpecialOrderProductions();
          const merged = mergeById(local, remote, true, true);
          saveLocalList(PROD_STORAGE_KEY, merged);
          clearSyncedIdsFromQueue(PROD_PENDING_KEY, local, remote);
          onUpdate(filterActiveRecords(merged));
          if (!snap.metadata.fromCache) {
            flushPendingSpecialOrderData().catch(() => {});
          }
        },
        (err) => {
          if (isPermissionDeniedError(err)) {
            markFirestorePathBlockedByRules(PROD_COL);
          }
          console.warn('SpecialOrderProduction listener warning:', err.message);
        }
      );
    } catch {}
  })();
  return () => {
    cancelled = true;
    unsub();
  };
}

export function subscribeSpecialOrderWhDispatches(
  onUpdate: (rows: SpecialOrderWhDispatch[]) => void
) {
  onUpdate(getLocalSpecialOrderWhDispatches());
  let unsub = () => {};
  let cancelled = false;
  (async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    if (!(await canAccessFirestorePath(WH_DISPATCH_COL, false))) return;
    if (cancelled) return;
    try {
      unsub = onSnapshot(
        collection(db, WH_DISPATCH_COL),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: SpecialOrderWhDispatch[] = [];
          snap.forEach((d) => {
            const raw = d.data() as SpecialOrderWhDispatch & { sy?: number };
            remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 } as SpecialOrderWhDispatch);
          });
          const local = readRawSpecialOrderWhDispatches();
          const merged = mergeById(local, remote, true, true);
          saveLocalList(WH_DISPATCH_STORAGE_KEY, merged);
          clearSyncedIdsFromQueue(WH_DISPATCH_PENDING_KEY, local, remote);
          onUpdate(filterActiveRecords(merged));
          if (!snap.metadata.fromCache) {
            flushPendingSpecialOrderData().catch(() => {});
          }
        },
        (err) => {
          if (isPermissionDeniedError(err)) {
            markFirestorePathBlockedByRules(WH_DISPATCH_COL);
          }
          console.warn('SpecialOrderWhDispatches listener warning:', err.message);
        }
      );
    } catch {}
  })();
  return () => {
    cancelled = true;
    unsub();
  };
}

// ======================================================
// FACTORY STOCK MATRIX COMPUTATION (SIZES 39-46 & PLANNING TARGETS)
// ======================================================

export interface SpecialOrderSizeStockRow {
  sizeLabel: string;
  productName: string;
  targetQty: number;
  producedConfirmed: number;
  pendingFactoryHod: number;
  dispatchedToWh: number;
  confirmedWh: number;
  availableInFactory: number;
  requiredRemaining: number;
  planProgressPct: number;
  isPlanMet: boolean;
}

export function computeOrderFactoryStock(
  order: SpecialOrder,
  prodEntries: SpecialOrderFactoryProduction[],
  whDispatches: SpecialOrderWhDispatch[]
): {
  rows: SpecialOrderSizeStockRow[];
  totalTargetQty: number;
  totalProducedConfirmed: number;
  totalPendingFactoryHod: number;
  totalDispatchedToWh: number;
  totalConfirmedWh: number;
  totalAvailableInFactory: number;
  totalRequiredRemaining: number;
  openPlanCount: number;
  closedPlanCount: number;
} {
  const deletedSet = readDeletedIdSet();
  const orderProd = prodEntries.filter(
    (p) => p.orderId === order.id && !p.deleted && !deletedSet.has(p.id)
  );
  const orderWh = whDispatches.filter(
    (w) => w.orderId === order.id && !w.deleted && !deletedSet.has(w.id)
  );

  const rows: SpecialOrderSizeStockRow[] = order.sizes.map((sizeLabel) => {
    const productName = buildSpecialOrderSizeProductName(order.productPrefix, sizeLabel);
    const targetQty = Math.max(0, Number(order.sizeTargets?.[sizeLabel] || 0));

    let producedConfirmed = 0;
    let pendingFactoryHod = 0;
    orderProd.forEach((batch) => {
      const match = batch.items.find((i) => i.sizeLabel === sizeLabel);
      if (!match) return;
      if (batch.status === 'CONFIRMED_IN_FACTORY') {
        producedConfirmed += Number(match.qty || 0);
      } else {
        pendingFactoryHod += Number(match.qty || 0);
      }
    });

    let dispatchedToWh = 0;
    let confirmedWh = 0;
    orderWh.forEach((dsp) => {
      const activeItems =
        dsp.whReceivedItems && dsp.whReceivedItems.length > 0
          ? dsp.whReceivedItems
          : dsp.items;
      const match = activeItems.find((i) => i.sizeLabel === sizeLabel);
      if (!match) return;
      const qty = Number(match.qty || 0);
      dispatchedToWh += qty;
      if (dsp.status === 'CONFIRMED') {
        confirmedWh += qty;
      }
    });

    const availableInFactory = Math.max(0, producedConfirmed - dispatchedToWh);
    const requiredRemaining = targetQty > 0 ? Math.max(0, targetQty - availableInFactory) : 0;
    const planProgressPct =
      targetQty > 0 ? Math.min(100, Math.round((availableInFactory / targetQty) * 100)) : 0;
    const isPlanMet = targetQty > 0 && availableInFactory >= targetQty;

    return {
      sizeLabel,
      productName,
      targetQty,
      producedConfirmed,
      pendingFactoryHod,
      dispatchedToWh,
      confirmedWh,
      availableInFactory,
      requiredRemaining,
      planProgressPct,
      isPlanMet,
    };
  });

  return {
    rows,
    totalTargetQty: rows.reduce((s, r) => s + r.targetQty, 0),
    totalProducedConfirmed: rows.reduce((s, r) => s + r.producedConfirmed, 0),
    totalPendingFactoryHod: rows.reduce((s, r) => s + r.pendingFactoryHod, 0),
    totalDispatchedToWh: rows.reduce((s, r) => s + r.dispatchedToWh, 0),
    totalConfirmedWh: rows.reduce((s, r) => s + r.confirmedWh, 0),
    totalAvailableInFactory: rows.reduce((s, r) => s + r.availableInFactory, 0),
    totalRequiredRemaining: rows.reduce((s, r) => s + r.requiredRemaining, 0),
    openPlanCount: rows.filter((r) => r.targetQty > 0 && !r.isPlanMet).length,
    closedPlanCount: rows.filter((r) => r.isPlanMet).length,
  };
}

// ======================================================
// SIZE PLANNING IMPORT & TARGET MANAGEMENT
// ======================================================

export async function updateSpecialOrderSizePlanning(params: {
  order: SpecialOrder;
  sizeTargets: Record<string, number>;
  updatedBy: string;
  sourceLabel?: string;
}): Promise<{ ok: boolean; order: SpecialOrder; error?: string }> {
  const cleaned: Record<string, number> = {};
  params.order.sizes.forEach((sz) => {
    const val = Number(params.sizeTargets[sz] || 0);
    cleaned[sz] = Number.isFinite(val) && val > 0 ? Math.round(val) : 0;
  });

  const updated: SpecialOrder = {
    ...params.order,
    sizeTargets: cleaned,
    planningUpdatedBy: params.updatedBy,
    planningUpdatedAt: new Date().toISOString(),
    planningSource: params.sourceLabel || 'Manual Size Planning Entry',
    upd: Date.now(),
  };
  const res = await saveSpecialOrderToFirebase(updated);
  return { ok: res.ok, order: updated, error: res.error };
}

function normalizeSizeToken(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

export function pullTargetsFromMonthlyPlans(
  order: SpecialOrder,
  monthlyPlans: ProductionPlanItem[]
): { targets: Record<string, number>; matchedSizes: number; activeMonth: string | null } {
  const activePlans = monthlyPlans.filter((p) => !p.superseded && (p.plannedQty || 0) > 0);
  if (activePlans.length === 0) {
    return { targets: {}, matchedSizes: 0, activeMonth: null };
  }
  const latestMonth =
    activePlans
      .map((p) => p.month)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;
  const scopedPlans = latestMonth
    ? activePlans.filter((p) => p.month === latestMonth)
    : activePlans;

  const targets: Record<string, number> = {};
  let matchedSizes = 0;

  order.sizes.forEach((sizeLabel) => {
    const mappedProd = normalizeSizeToken(
      buildSpecialOrderSizeProductName(order.productPrefix, sizeLabel)
    );
    const sizeNum = sizeLabel.replace(/[^0-9]+/g, '').trim();
    const sizeNorm = normalizeSizeToken(sizeLabel);

    const matched = scopedPlans.filter((plan) => {
      const prodNorm = normalizeSizeToken(plan.product || '');
      if (prodNorm === mappedProd) return true;
      if (prodNorm.includes(sizeNorm) && (prodNorm.includes('BOOT') || prodNorm.includes('GUM'))) {
        return true;
      }
      if (sizeNum && prodNorm.includes(`SIZE ${sizeNum}`) && (prodNorm.includes('BOOT') || prodNorm.includes('GUM'))) {
        return true;
      }
      return false;
    });

    if (matched.length > 0) {
      targets[sizeLabel] = Math.round(
        matched.reduce((s, m) => s + Number(m.plannedQty || 0), 0)
      );
      matchedSizes++;
    } else if (order.sizeTargets?.[sizeLabel]) {
      targets[sizeLabel] = order.sizeTargets[sizeLabel];
    }
  });

  return { targets, matchedSizes, activeMonth: latestMonth };
}

export async function parseSpecialOrderSizePlanWorkbook(
  file: File,
  sizes: string[],
  productPrefix: string
): Promise<{ targets: Record<string, number>; matchedCount: number }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const targets: Record<string, number> = {};
  let matchedCount = 0;

  const sizeMatchers = sizes.map((sz) => ({
    sizeLabel: sz,
    normSize: normalizeSizeToken(sz),
    digits: sz.replace(/[^0-9]+/g, '').trim(),
    mappedProd: normalizeSizeToken(buildSpecialOrderSizeProductName(productPrefix, sz)),
  }));

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
    if (!rows.length) continue;

    for (const row of rows) {
      const keys = Object.keys(row);
      const labelKey =
        keys.find((k) => /size|product|item|description|side|variant/i.test(k)) || keys[0];
      const qtyKey =
        keys.find((k) => /plan|req|target|qty|quantity|order/i.test(k) && k !== labelKey) ||
        keys.find((k) => k !== labelKey && !Number.isNaN(Number(row[k])));

      if (!labelKey || !qtyKey) continue;
      const rawLabel = normalizeSizeToken(String(row[labelKey] || ''));
      const rawQty = Number(String(row[qtyKey] || '').replace(/,/g, '').trim());
      if (!rawLabel || !Number.isFinite(rawQty) || rawQty < 0) continue;

      const hit = sizeMatchers.find(
        (m) =>
          rawLabel === m.normSize ||
          rawLabel === m.mappedProd ||
          (m.digits && (rawLabel === m.digits || rawLabel.includes(`SIZE ${m.digits}`) || rawLabel.endsWith(` ${m.digits}`)))
      );
      if (hit) {
        targets[hit.sizeLabel] = Math.round(rawQty);
        matchedCount++;
      }
    }
    if (matchedCount > 0) break;
  }

  return { targets, matchedCount };
}

// ======================================================
// WORKFLOW ACTIONS
// ======================================================

export async function submitSpecialOrderProduction(params: {
  order: SpecialOrder;
  date: string;
  shift: 'Day' | 'Night';
  machine: string;
  rackOrTrolleyNo: string;
  items: SpecialOrderSizeItem[];
  operatorName: string;
  assistantName: string;
  isCasualAssistant?: boolean;
  casualAssistantName?: string;
  shiftInChargeName: string;
  shiftInChargeSignature: string;
  shiftNotes?: string;
  submittedByEmail: string;
}): Promise<{ ok: boolean; record: SpecialOrderFactoryProduction; error?: string }> {
  const validItems = params.items.filter((i) => i.qty > 0);
  const totalQty = validItems.reduce((s, i) => s + i.qty, 0);
  const totalWeightKg = Number(
    validItems.reduce((s, i) => s + (i.totalWeightKg || 0), 0).toFixed(2)
  );
  const record: SpecialOrderFactoryProduction = {
    id: `SOPROD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    batchNo: `SO-FAC-${params.date.replace(/-/g, '').slice(2)}-${String(Date.now()).slice(-4)}`,
    orderId: params.order.id,
    orderNo: params.order.orderNo,
    orderTitle: params.order.title,
    date: params.date,
    shift: params.shift,
    machine: normalizeMachineName(params.machine || params.order.machine),
    rackOrTrolleyNo: params.rackOrTrolleyNo.trim() || 'FACTORY-RACK',
    items: validItems,
    totalQty,
    totalWeightKg,
    operatorName: params.operatorName,
    assistantName: params.assistantName,
    isCasualAssistant: Boolean(params.isCasualAssistant),
    casualAssistantName: params.casualAssistantName,
    shiftInChargeName: params.shiftInChargeName,
    shiftInChargeSignature: params.shiftInChargeSignature,
    shiftNotes: params.shiftNotes,
    shiftSubmittedAt: new Date().toISOString(),
    shiftSubmittedByEmail: params.submittedByEmail,
    status: 'PENDING_HOD_FACTORY',
    upd: Date.now(),
  };

  const res = await saveSpecialOrderProductionToFirebase(record);
  return { ok: res.ok, record, error: res.error };
}

export async function hodConfirmSpecialOrderFactoryStock(params: {
  entry: SpecialOrderFactoryProduction;
  hodName: string;
  hodEmail: string;
  hodSignature: string;
  hodNotes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const updated: SpecialOrderFactoryProduction = {
    ...params.entry,
    hodConfirmedByName: params.hodName,
    hodConfirmedByEmail: params.hodEmail,
    hodSignature: params.hodSignature,
    hodNotes: params.hodNotes,
    hodConfirmedAt: new Date().toISOString(),
    status: 'CONFIRMED_IN_FACTORY',
    upd: Date.now(),
  };
  return saveSpecialOrderProductionToFirebase(updated);
}

/**
 * Permanently soft-deletes a Shift In Charge raised factory production batch as HOD/Admin
 * using a synced tombstone (`deleted: true`) so it never reappears on any device
 * and never triggers Firestore `delete` rule errors.
 */
export async function hodDeleteSpecialOrderFactoryBatch(params: {
  entry: SpecialOrderFactoryProduction;
  hodName: string;
  hodEmail: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (params.entry.status === 'CONFIRMED_IN_FACTORY') {
    return {
      ok: false,
      error: 'Confirmed Factory Stock batches are locked and cannot be deleted.',
    };
  }
  markIdsDeletedLocally([params.entry.id]);
  const tombstoned: SpecialOrderFactoryProduction = {
    ...params.entry,
    deleted: true,
    deletedBy: params.hodName,
    deletedByEmail: params.hodEmail,
    deletedAt: new Date().toISOString(),
    upd: Date.now(),
  };
  return saveSpecialOrderProductionToFirebase(tombstoned);
}

/**
 * Permanently soft-deletes an unconfirmed Shift In Charge raised WH dispatch order as HOD/Admin
 * via tombstones. Once CONFIRMED, orders are permanently locked and cannot be deleted.
 */
export async function hodDeleteSpecialOrderWhDispatch(params: {
  entry: SpecialOrderWhDispatch;
  hodName: string;
  hodEmail: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (params.entry.status === 'CONFIRMED') {
    return {
      ok: false,
      error: 'Confirmed WH Dispatches are locked and cannot be deleted.',
    };
  }
  markIdsDeletedLocally([params.entry.id]);
  if (params.entry.linkedRegularDispatchIds && params.entry.linkedRegularDispatchIds.length > 0) {
    for (const linkedId of params.entry.linkedRegularDispatchIds) {
      await softDeleteDispatchEntryById(linkedId, params.hodName, params.hodEmail).catch(() => {});
    }
  }
  const tombstoned: SpecialOrderWhDispatch = {
    ...params.entry,
    deleted: true,
    deletedBy: params.hodName,
    deletedByEmail: params.hodEmail,
    deletedAt: new Date().toISOString(),
    upd: Date.now(),
  };
  return saveSpecialOrderWhDispatchToFirebase(tombstoned);
}

export async function submitSpecialOrderWhDispatch(params: {
  order: SpecialOrder;
  date: string;
  shift: 'Day' | 'Night';
  machine: string;
  trolleyNo: string;
  items: SpecialOrderSizeItem[];
  operatorName: string;
  assistantName: string;
  isCasualAssistant?: boolean;
  casualAssistantName?: string;
  shiftInChargeName: string;
  shiftInChargeSignature: string;
  shiftNotes?: string;
  submittedByEmail: string;
}): Promise<{ ok: boolean; record: SpecialOrderWhDispatch; error?: string }> {
  const validItems = params.items.filter((i) => i.qty > 0);
  const totalRecordedQty = validItems.reduce((s, i) => s + i.qty, 0);
  const totalRecordedWeightKg = Number(
    validItems.reduce((s, i) => s + (i.totalWeightKg || 0), 0).toFixed(2)
  );
  const record: SpecialOrderWhDispatch = {
    id: `SOWH-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    dispatchRef: `SO-WH-${params.date.replace(/-/g, '').slice(2)}-${String(Date.now()).slice(-4)}`,
    orderId: params.order.id,
    orderNo: params.order.orderNo,
    orderTitle: params.order.title,
    date: params.date,
    shift: params.shift,
    machine: normalizeMachineName(params.machine || params.order.machine),
    trolleyNo: params.trolleyNo.trim(),
    items: validItems,
    totalRecordedQty,
    totalRecordedWeightKg,
    operatorName: params.operatorName,
    assistantName: params.assistantName,
    isCasualAssistant: Boolean(params.isCasualAssistant),
    casualAssistantName: params.casualAssistantName,
    shiftInChargeName: params.shiftInChargeName,
    shiftInChargeSignature: params.shiftInChargeSignature,
    shiftNotes: params.shiftNotes,
    shiftSubmittedAt: new Date().toISOString(),
    shiftSubmittedByEmail: params.submittedByEmail,
    status: 'PENDING_WH',
    upd: Date.now(),
  };

  const res = await saveSpecialOrderWhDispatchToFirebase(record);
  return { ok: res.ok, record, error: res.error };
}

export async function whConfirmSpecialOrderDispatch(params: {
  entry: SpecialOrderWhDispatch;
  whReceivedItems: SpecialOrderSizeItem[];
  whPersonnelName: string;
  whEmail: string;
  whSignature: string;
  whNotes?: string;
  whQtyEditReason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const totalWhReceivedQty = params.whReceivedItems.reduce((s, i) => s + (i.qty || 0), 0);
  const totalWhWeightKg = Number(
    params.whReceivedItems.reduce((s, i) => s + (i.totalWeightKg || 0), 0).toFixed(2)
  );
  const updated: SpecialOrderWhDispatch = {
    ...params.entry,
    whReceivedItems: params.whReceivedItems,
    totalWhReceivedQty,
    totalWhWeightKg,
    whPersonnelName: params.whPersonnelName,
    whConfirmedByEmail: params.whEmail,
    whSignature: params.whSignature,
    whNotes: params.whNotes,
    whQtyEditReason: params.whQtyEditReason,
    whConfirmedAt: new Date().toISOString(),
    status: 'PENDING_HOD',
    upd: Date.now(),
  };
  return saveSpecialOrderWhDispatchToFirebase(updated);
}

/**
 * Stage 3: Production HOD Final Confirmation of Special Order Dispatch to WH.
 * Automatically posts confirmed DispatchEntry record(s) into Regular Dispatch (`dispatch_entries`)
 * so they appear in Regular Dispatch Excel, Period Production Report, and Monthly Planning.
 */
export async function hodConfirmSpecialOrderWhDispatch(params: {
  entry: SpecialOrderWhDispatch;
  hodName: string;
  hodEmail: string;
  hodSignature: string;
  hodNotes?: string;
}): Promise<{ ok: boolean; linkedDispatchIds: string[]; error?: string }> {
  const { entry } = params;
  const confirmedAtIso = new Date().toISOString();
  const effectiveItems = (
    entry.whReceivedItems && entry.whReceivedItems.length > 0
      ? entry.whReceivedItems
      : entry.items
  ).filter((item) => item.qty > 0);

  const linkedDispatchIds: string[] = [];

  for (let idx = 0; idx < effectiveItems.length; idx++) {
    const item = effectiveItems[idx];
    const origItem = entry.items.find((x) => x.sizeLabel === item.sizeLabel);
    const recordedQty = origItem ? origItem.qty : item.qty;
    const regularId = `DSP-SO-${entry.id}-${idx + 1}`;
    linkedDispatchIds.push(regularId);

    const regularDispatchEntry: DispatchEntry = {
      id: regularId,
      date: entry.date,
      shift: entry.shift,
      machine: normalizeMachineName(entry.machine),
      product: item.productName,
      trolleyNo: `${entry.trolleyNo} [${item.sizeLabel}]`,
      recordedQty,
      unitWeightKg: item.unitWeightKg,
      totalWeightKg: item.totalWeightKg,
      operatorName: entry.operatorName,
      assistantName: entry.assistantName,
      isCasualAssistant: entry.isCasualAssistant,
      casualAssistantName: entry.casualAssistantName,
      shiftInChargeName: entry.shiftInChargeName,
      shiftInChargeSignature: entry.shiftInChargeSignature,
      shiftNotes: `[Special Order ${entry.orderNo} / ${entry.dispatchRef}] ${entry.shiftNotes || ''}`.trim(),
      shiftSubmittedAt: entry.shiftSubmittedAt,
      shiftSubmittedByEmail: entry.shiftSubmittedByEmail,
      whReceivedQty: item.qty,
      whPersonnelName: entry.whPersonnelName,
      whSignature: entry.whSignature,
      whNotes: entry.whNotes,
      whConfirmedAt: entry.whConfirmedAt,
      whConfirmedByEmail: entry.whConfirmedByEmail,
      whQtyEditReason: entry.whQtyEditReason,
      hodConfirmedByName: params.hodName,
      hodConfirmedByEmail: params.hodEmail,
      hodSignature: params.hodSignature,
      hodNotes: params.hodNotes,
      hodConfirmedAt: confirmedAtIso,
      status: 'CONFIRMED',
      upd: Date.now(),
      isSpecialOrderDispatch: true,
      specialOrderId: entry.orderId,
      specialOrderDispatchId: entry.id,
    };

    await saveDispatchEntryToFirebase(regularDispatchEntry);
  }

  const updated: SpecialOrderWhDispatch = {
    ...entry,
    hodConfirmedByName: params.hodName,
    hodConfirmedByEmail: params.hodEmail,
    hodSignature: params.hodSignature,
    hodNotes: params.hodNotes,
    hodConfirmedAt: confirmedAtIso,
    linkedRegularDispatchIds: linkedDispatchIds,
    syncedToRegularDispatchAt: confirmedAtIso,
    status: 'CONFIRMED',
    upd: Date.now(),
  };

  const res = await saveSpecialOrderWhDispatchToFirebase(updated);
  return { ok: res.ok, linkedDispatchIds, error: res.error };
}

// ======================================================
// REPORT 1: ADMIN-ONLY STOCK IN FACTORY EXCEL
// ======================================================

export function exportSpecialOrderFactoryStockExcel(params: {
  order: SpecialOrder;
  prodEntries: SpecialOrderFactoryProduction[];
  whDispatches: SpecialOrderWhDispatch[];
  isAdmin: boolean;
}) {
  if (!params.isAdmin) return;
  const { order, prodEntries, whDispatches } = params;
  const stockSummary = computeOrderFactoryStock(order, prodEntries, whDispatches);
  const deletedSet = readDeletedIdSet();
  const orderProd = prodEntries
    .filter((p) => p.orderId === order.id && !p.deleted && !deletedSet.has(p.id))
    .sort((a, b) => (b.date + b.shiftSubmittedAt).localeCompare(a.date + a.shiftSubmittedAt));

  const matrixRows = stockSummary.rows.map((r) => ({
    'Order No.': order.orderNo,
    'Size': r.sizeLabel,
    'Inventory Product Name': r.productName,
    'Planned Qty Required': r.targetQty || '—',
    'Confirmed Produced (Factory)': r.producedConfirmed,
    'Pending HOD Confirm': r.pendingFactoryHod,
    'Moved / Dispatched to WH': r.dispatchedToWh,
    'Available Stock in Factory': r.availableInFactory,
    'Still Required Stock (vs Avail)': r.targetQty > 0 ? r.requiredRemaining : '—',
    'Plan Progress %': r.targetQty > 0 ? `${r.planProgressPct}%` : '—',
    'Plan Status':
      r.targetQty > 0
        ? r.isPlanMet
          ? 'CLOSED — REQUIRED MET (RED)'
          : `OPEN (${r.requiredRemaining} REQ)`
        : 'No Plan',
  }));

  matrixRows.push({
    'Order No.': 'TOTAL',
    'Size': `${order.sizes.length} Sizes`,
    'Inventory Product Name': order.title,
    'Planned Qty Required': stockSummary.totalTargetQty || '—',
    'Confirmed Produced (Factory)': stockSummary.totalProducedConfirmed,
    'Pending HOD Confirm': stockSummary.totalPendingFactoryHod,
    'Moved / Dispatched to WH': stockSummary.totalDispatchedToWh,
    'Available Stock in Factory': stockSummary.totalAvailableInFactory,
    'Still Required Stock (vs Avail)':
      stockSummary.totalTargetQty > 0 ? stockSummary.totalRequiredRemaining : '—',
    'Plan Progress %':
      stockSummary.totalTargetQty > 0
        ? `${Math.min(100, Math.round((stockSummary.totalAvailableInFactory / stockSummary.totalTargetQty) * 100))}%`
        : '—',
    'Plan Status':
      stockSummary.totalTargetQty > 0
        ? `${stockSummary.closedPlanCount} RED CLOSED / ${stockSummary.openPlanCount} OPEN`
        : 'No Plan',
  });

  const dailyRows = orderProd.flatMap((batch) =>
    batch.items.map((item) => ({
      'Batch Ref': batch.batchNo,
      Date: batch.date,
      Shift: batch.shift,
      Machine: normalizeMachineName(batch.machine),
      'Rack / Holding Area': batch.rackOrTrolleyNo,
      Size: item.sizeLabel,
      Product: item.productName,
      'Produced Qty': item.qty,
      'Weight (kg)': item.totalWeightKg ?? '',
      Operator: batch.operatorName,
      Assistant: batch.isCasualAssistant
        ? `${batch.assistantName} (Casual)`
        : batch.assistantName,
      'Shift In Charge': batch.shiftInChargeName,
      'Shift Sign': batch.shiftInChargeSignature ? 'SIGNED' : 'No',
      'HOD Confirmer': batch.hodConfirmedByName || 'Pending',
      'HOD Sign': batch.hodSignature ? 'SIGNED' : 'Pending',
      Status:
        batch.status === 'CONFIRMED_IN_FACTORY'
          ? 'CONFIRMED IN FACTORY'
          : 'AWAITING HOD CONFIRMATION',
      Notes: batch.hodNotes || batch.shiftNotes || '',
    }))
  );

  const wb = XLSX.utils.book_new();

  const wsMatrix = XLSX.utils.aoa_to_sheet([
    ['LG PLAST — Affordable / Durable / Complete'],
    [`SPECIAL ORDER FACTORY STOCK REPORT — ${order.orderNo}: ${order.title}`],
    [`Customer / Ref: ${order.customerName || 'Internal Special Order'}`, `Generated: ${new Date().toLocaleString()}`],
    [],
  ]);
  XLSX.utils.sheet_add_json(wsMatrix, matrixRows, { origin: 'A5' });
  XLSX.utils.book_append_sheet(wb, wsMatrix, 'Factory Stock Balance');

  const wsLog = XLSX.utils.aoa_to_sheet([
    ['LG PLAST — Affordable / Durable / Complete'],
    [`DAILY SPECIAL ORDER FACTORY PRODUCTION LOG — ${order.orderNo}`],
    [`Generated: ${new Date().toLocaleString()}`],
    [],
  ]);
  XLSX.utils.sheet_add_json(
    wsLog,
    dailyRows.length > 0 ? dailyRows : [{ Notice: 'No daily factory production entries logged yet.' }],
    { origin: 'A5' }
  );
  XLSX.utils.book_append_sheet(wb, wsLog, 'Daily Factory Production');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveFileBlob(`LGPLAST_special_order_FACTORY_STOCK_${order.orderNo}_${ymd(new Date())}.xlsx`, blob);
}

// ======================================================
// REPORT 2: ADMIN-ONLY STOCK DISPATCHED TO WH EXCEL
// ======================================================

export function exportSpecialOrderWhDispatchedExcel(params: {
  order: SpecialOrder;
  whDispatches: SpecialOrderWhDispatch[];
  isAdmin: boolean;
}) {
  if (!params.isAdmin) return;
  const { order, whDispatches } = params;
  const deletedSet = readDeletedIdSet();
  const list = whDispatches
    .filter((w) => w.orderId === order.id && !w.deleted && !deletedSet.has(w.id))
    .sort((a, b) => (b.date + b.shiftSubmittedAt).localeCompare(a.date + a.shiftSubmittedAt));

  const summaryRows = list.map((d) => {
    const sizeBreakdown = (d.whReceivedItems || d.items)
      .filter((i) => i.qty > 0)
      .map((i) => `${i.sizeLabel}: ${i.qty}`)
      .join(' | ');
    return {
      'Dispatch Ref': d.dispatchRef,
      Date: d.date,
      Shift: d.shift,
      Machine: normalizeMachineName(d.machine),
      'Trolley No.': d.trolleyNo,
      'Sizes Breakdown': sizeBreakdown,
      'Shift Recorded Total': d.totalRecordedQty,
      'WH Received Total': d.totalWhReceivedQty ?? 'Pending',
      'Total Wt (kg)': d.totalWhWeightKg ?? d.totalRecordedWeightKg,
      Operator: d.operatorName,
      Assistant: d.isCasualAssistant ? `${d.assistantName} (Casual)` : d.assistantName,
      'Shift In Charge': d.shiftInChargeName,
      'Shift Sign': d.shiftInChargeSignature ? 'SIGNED' : 'No',
      'WH Personnel': d.whPersonnelName || 'Pending',
      'WH Sign': d.whSignature ? 'SIGNED' : 'Pending',
      'HOD Confirmer': d.hodConfirmedByName || 'Pending',
      'HOD Sign': d.hodSignature ? 'SIGNED' : 'Pending',
      'Posted to Regular Dispatch': d.syncedToRegularDispatchAt
        ? `YES (${(d.linkedRegularDispatchIds || []).length} rows)`
        : 'Pending HOD Final Confirm',
      Status: d.status,
    };
  });

  const perSizeRows = list.flatMap((d) => {
    const active = d.whReceivedItems && d.whReceivedItems.length > 0 ? d.whReceivedItems : d.items;
    return active.map((item, idx) => {
      const orig = d.items.find((x) => x.sizeLabel === item.sizeLabel);
      return {
        'Dispatch Ref': d.dispatchRef,
        Date: d.date,
        Shift: d.shift,
        'Trolley No.': d.trolleyNo,
        Size: item.sizeLabel,
        'Regular Dispatch Product': item.productName,
        'Shift Recorded Qty': orig?.qty ?? item.qty,
        'WH Confirmed Qty': typeof d.totalWhReceivedQty === 'number' ? item.qty : '',
        'Weight (kg)': item.totalWeightKg ?? '',
        'Regular Dispatch ID': d.linkedRegularDispatchIds?.[idx] || 'Pending HOD Confirm',
        Status: d.status,
      };
    });
  });

  const wb = XLSX.utils.book_new();

  const wsMain = XLSX.utils.aoa_to_sheet([
    ['LG PLAST — Affordable / Durable / Complete'],
    [`SPECIAL ORDER DISPATCHED TO WAREHOUSE (WH) REPORT — ${order.orderNo}: ${order.title}`],
    [`Note: HOD-confirmed WH movements automatically feed Regular Dispatch Excel.`, `Generated: ${new Date().toLocaleString()}`],
    [],
  ]);
  XLSX.utils.sheet_add_json(
    wsMain,
    summaryRows.length > 0 ? summaryRows : [{ Notice: 'No WH dispatches logged for this special order yet.' }],
    { origin: 'A5' }
  );
  XLSX.utils.book_append_sheet(wb, wsMain, 'WH Dispatched Orders');

  const wsSizes = XLSX.utils.aoa_to_sheet([
    ['LG PLAST — Affordable / Durable / Complete'],
    [`PER-SIZE WH DISPATCH BREAKDOWN — ${order.orderNo}`],
    [`Generated: ${new Date().toLocaleString()}`],
    [],
  ]);
  XLSX.utils.sheet_add_json(
    wsSizes,
    perSizeRows.length > 0 ? perSizeRows : [{ Notice: 'No per-size dispatch rows yet.' }],
    { origin: 'A5' }
  );
  XLSX.utils.book_append_sheet(wb, wsSizes, 'Per-Size WH Breakdown');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveFileBlob(`LGPLAST_special_order_WH_DISPATCH_${order.orderNo}_${ymd(new Date())}.xlsx`, blob);
}

// ======================================================
// OFFICIAL PORTRAIT PDF SLIP FOR SPECIAL ORDER WH DISPATCH
// ======================================================

export async function generateSpecialOrderMovementPdf(
  dispatch: SpecialOrderWhDispatch
) {
  await ensureLgplastLogoLoaded();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  drawLgplastPdfHeader(
    doc,
    'SPECIAL ORDER WH DISPATCH VOUCHER',
    `${dispatch.orderNo} — ${dispatch.orderTitle}`,
    [
      `Ref: ${dispatch.dispatchRef}`,
      `Date: ${dispatch.date} (${dispatch.shift})`,
      `Status: ${dispatch.status}`,
    ]
  );

  autoTable(doc, {
    startY: 36,
    margin: { left: 10, right: 10 },
    head: [['Special Order Transfer Details', 'Particulars']],
    body: [
      ['Order Reference', `${dispatch.orderNo} — ${dispatch.orderTitle}`],
      ['Dispatch Voucher / Trolley', `${dispatch.dispatchRef}  |  Trolley #${dispatch.trolleyNo}`],
      ['Production Machine', normalizeMachineName(dispatch.machine)],
      ['Operator / Assistant', `${dispatch.operatorName} / ${dispatch.assistantName}`],
      [
        'Totals (Shift vs WH Confirmed)',
        `Shift: ${dispatch.totalRecordedQty} units  |  WH Received: ${dispatch.totalWhReceivedQty ?? 'Pending'} units`,
      ],
      [
        'Regular Dispatch Ledger Sync',
        dispatch.syncedToRegularDispatchAt
          ? `POSTED (${(dispatch.linkedRegularDispatchIds || []).length} Regular Dispatch Rows)`
          : 'Pending HOD Final Confirmation',
      ],
    ],
    styles: { fontSize: 8.2, cellPadding: 2.2, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 62, fontStyle: 'bold', textColor: [51, 65, 85] },
      1: { cellWidth: 128 },
    },
  });

  const activeItems =
    dispatch.whReceivedItems && dispatch.whReceivedItems.length > 0
      ? dispatch.whReceivedItems
      : dispatch.items;

  autoTable(doc, {
    startY: ((doc as any).lastAutoTable?.finalY || 92) + 5,
    margin: { left: 10, right: 10 },
    head: [['Size', 'Inventory Item Name', 'Shift Qty', 'WH Confirmed Qty', 'Weight (kg)']],
    body: activeItems.map((item) => {
      const orig = dispatch.items.find((x) => x.sizeLabel === item.sizeLabel);
      return [
        item.sizeLabel,
        item.productName,
        String(orig?.qty ?? item.qty),
        typeof dispatch.totalWhReceivedQty === 'number' ? String(item.qty) : 'Pending',
        item.totalWeightKg ? item.totalWeightKg.toFixed(2) : '—',
      ];
    }),
    styles: { fontSize: 8, cellPadding: 2.2, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  const sigY = ((doc as any).lastAutoTable?.finalY || 175) + 8;
  doc.setDrawColor(148, 163, 184);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(10, sigY, pageWidth - 20, 42, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text('1. SHIFT IN CHARGE', 13, sigY + 6);
  doc.text('2. WAREHOUSE (WH)', 76, sigY + 6);
  doc.text('3. PRODUCTION HOD', 139, sigY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(dispatch.shiftInChargeName || '—', 13, sigY + 11.5);
  doc.text(dispatch.whPersonnelName || 'Pending', 76, sigY + 11.5);
  doc.text(dispatch.hodConfirmedByName || 'Pending', 139, sigY + 11.5);

  if (dispatch.shiftInChargeSignature) {
    try { doc.addImage(dispatch.shiftInChargeSignature, 'PNG', 13, sigY + 14, 48, 18); } catch {}
  }
  if (dispatch.whSignature) {
    try { doc.addImage(dispatch.whSignature, 'PNG', 76, sigY + 14, 48, 18); } catch {}
  }
  if (dispatch.hodSignature) {
    try { doc.addImage(dispatch.hodSignature, 'PNG', 139, sigY + 14, 48, 18); } catch {}
  }

  doc.save(`LGPLAST_SpecialOrder_${dispatch.dispatchRef}.pdf`);
}
