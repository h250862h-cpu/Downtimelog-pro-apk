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
  db,
  deepSanitizeForFirestore,
  ensureFirebaseAuth,
  getCollectionDocsServerFirst,
} from '../firebase';
import {
  DispatchEntry,
  GUM_BOOT_SIZES,
  SpecialOrder,
  SpecialOrderFactoryProduction,
  SpecialOrderSizeItem,
  SpecialOrderWhDispatch,
  normalizeMachineName,
} from '../types';
import { saveDispatchEntryToFirebase } from './dispatchStore';
import { saveFileBlob, ymd } from './downtimeCalc';
import { drawLgplastPdfHeader, ensureLgplastLogoLoaded } from './reportPdf';

const ORDERS_STORAGE_KEY = 'lgplast_special_orders_v1';
const PROD_STORAGE_KEY = 'lgplast_special_order_prod_v1';
const WH_DISPATCH_STORAGE_KEY = 'lgplast_special_order_wh_dispatch_v1';

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

function mergeById<T extends { id: string; upd?: number }>(
  local: T[],
  remote: T[],
  sortDesc = true
): T[] {
  const map: Record<string, T> = {};
  local.forEach((item) => {
    if (item?.id) map[item.id] = item;
  });
  remote.forEach((item) => {
    if (!item?.id) return;
    const existing = map[item.id];
    if (!existing || (item.upd || 0) >= (existing.upd || 0)) {
      map[item.id] = item;
    }
  });
  return Object.values(map).sort((a, b) =>
    sortDesc ? (b.upd || 0) - (a.upd || 0) : (a.upd || 0) - (b.upd || 0)
  );
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

function ensureDefaultGumBootOrder(orders: SpecialOrder[]): SpecialOrder[] {
  const hasDefault = orders.some((o) => o.id === DEFAULT_GUM_BOOT_SPECIAL_ORDER.id);
  if (hasDefault) return orders;
  return [DEFAULT_GUM_BOOT_SPECIAL_ORDER, ...orders];
}

// ======================================================
// LOCAL ACCESSORS
// ======================================================

export function getLocalSpecialOrders(): SpecialOrder[] {
  return ensureDefaultGumBootOrder(readLocalList<SpecialOrder>(ORDERS_STORAGE_KEY));
}

export function getLocalSpecialOrderProductions(): SpecialOrderFactoryProduction[] {
  return readLocalList<SpecialOrderFactoryProduction>(PROD_STORAGE_KEY);
}

export function getLocalSpecialOrderWhDispatches(): SpecialOrderWhDispatch[] {
  return readLocalList<SpecialOrderWhDispatch>(WH_DISPATCH_STORAGE_KEY);
}

// ======================================================
// CLOUD SAVE + FLUSH + POLL + SUBSCRIBE
// ======================================================

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

  try {
    await ensureFirebaseAuth();
    const payload = sanitizeForFirestore({ ...updated, sy: Date.now() });
    await setDoc(doc(db, ORDERS_COL, updated.id), payload, { merge: true });
    removePendingId(ORDERS_PENDING_KEY, updated.id);
    return { ok: true };
  } catch (err: any) {
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
  const current = getLocalSpecialOrderProductions();
  const next = mergeById(current, [updated]);
  saveLocalList(PROD_STORAGE_KEY, next);

  try {
    await ensureFirebaseAuth();
    const payload = sanitizeForFirestore({ ...updated, sy: Date.now() });
    await setDoc(doc(db, PROD_COL, updated.id), payload, { merge: true });
    removePendingId(PROD_PENDING_KEY, updated.id);
    return { ok: true };
  } catch (err: any) {
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
  const current = getLocalSpecialOrderWhDispatches();
  const next = mergeById(current, [updated]);
  saveLocalList(WH_DISPATCH_STORAGE_KEY, next);

  try {
    await ensureFirebaseAuth();
    const payload = sanitizeForFirestore({ ...updated, sy: Date.now() });
    await setDoc(doc(db, WH_DISPATCH_COL, updated.id), payload, { merge: true });
    removePendingId(WH_DISPATCH_PENDING_KEY, updated.id);
    return { ok: true };
  } catch (err: any) {
    addPendingId(WH_DISPATCH_PENDING_KEY, updated.id);
    return { ok: false, error: err?.message || 'Saved locally (offline)' };
  }
}

export function getPendingSpecialOrderCount(): number {
  return (
    readLocalList<string>(ORDERS_PENDING_KEY).length +
    readLocalList<string>(PROD_PENDING_KEY).length +
    readLocalList<string>(WH_DISPATCH_PENDING_KEY).length
  );
}

export async function flushPendingSpecialOrderData(): Promise<number> {
  let count = 0;
  const orderIds = readLocalList<string>(ORDERS_PENDING_KEY);
  const localOrders = getLocalSpecialOrders();
  for (const id of orderIds) {
    const found = localOrders.find((x) => x.id === id);
    if (found) {
      const r = await saveSpecialOrderToFirebase(found, { preserveUpd: true });
      if (r.ok) count++;
    } else {
      removePendingId(ORDERS_PENDING_KEY, id);
    }
  }

  const prodIds = readLocalList<string>(PROD_PENDING_KEY);
  const localProd = getLocalSpecialOrderProductions();
  for (const id of prodIds) {
    const found = localProd.find((x) => x.id === id);
    if (found) {
      const r = await saveSpecialOrderProductionToFirebase(found, { preserveUpd: true });
      if (r.ok) count++;
    } else {
      removePendingId(PROD_PENDING_KEY, id);
    }
  }

  const whIds = readLocalList<string>(WH_DISPATCH_PENDING_KEY);
  const localWh = getLocalSpecialOrderWhDispatches();
  for (const id of whIds) {
    const found = localWh.find((x) => x.id === id);
    if (found) {
      const r = await saveSpecialOrderWhDispatchToFirebase(found, { preserveUpd: true });
      if (r.ok) count++;
    } else {
      removePendingId(WH_DISPATCH_PENDING_KEY, id);
    }
  }

  return count;
}

export async function pollSpecialOrders(): Promise<SpecialOrder[]> {
  try {
    await ensureFirebaseAuth();
    const snap = await getCollectionDocsServerFirst(collection(db, ORDERS_COL));
    const remote: SpecialOrder[] = [];
    snap.forEach((d) => remote.push(d.data() as SpecialOrder));
    const merged = ensureDefaultGumBootOrder(mergeById(getLocalSpecialOrders(), remote));
    saveLocalList(ORDERS_STORAGE_KEY, merged);
    return merged;
  } catch {
    return getLocalSpecialOrders();
  }
}

export async function pollSpecialOrderProductions(): Promise<SpecialOrderFactoryProduction[]> {
  try {
    await ensureFirebaseAuth();
    const snap = await getCollectionDocsServerFirst(collection(db, PROD_COL));
    const remote: SpecialOrderFactoryProduction[] = [];
    snap.forEach((d) => remote.push(d.data() as SpecialOrderFactoryProduction));
    const merged = mergeById(getLocalSpecialOrderProductions(), remote);
    saveLocalList(PROD_STORAGE_KEY, merged);
    return merged;
  } catch {
    return getLocalSpecialOrderProductions();
  }
}

export async function pollSpecialOrderWhDispatches(): Promise<SpecialOrderWhDispatch[]> {
  try {
    await ensureFirebaseAuth();
    const snap = await getCollectionDocsServerFirst(collection(db, WH_DISPATCH_COL));
    const remote: SpecialOrderWhDispatch[] = [];
    snap.forEach((d) => remote.push(d.data() as SpecialOrderWhDispatch));
    const merged = mergeById(getLocalSpecialOrderWhDispatches(), remote);
    saveLocalList(WH_DISPATCH_STORAGE_KEY, merged);
    return merged;
  } catch {
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
    try {
      unsub = onSnapshot(
        collection(db, ORDERS_COL),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: SpecialOrder[] = [];
          snap.forEach((d) => remote.push(d.data() as SpecialOrder));
          const merged = ensureDefaultGumBootOrder(mergeById(getLocalSpecialOrders(), remote));
          saveLocalList(ORDERS_STORAGE_KEY, merged);
          onUpdate(merged);
          if (!snap.metadata.fromCache) {
            flushPendingSpecialOrderData().catch(() => {});
          }
        },
        (err) => console.warn('SpecialOrders listener warning:', err.message)
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
    try {
      unsub = onSnapshot(
        collection(db, PROD_COL),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: SpecialOrderFactoryProduction[] = [];
          snap.forEach((d) => remote.push(d.data() as SpecialOrderFactoryProduction));
          const merged = mergeById(getLocalSpecialOrderProductions(), remote);
          saveLocalList(PROD_STORAGE_KEY, merged);
          onUpdate(merged);
          if (!snap.metadata.fromCache) {
            flushPendingSpecialOrderData().catch(() => {});
          }
        },
        (err) => console.warn('SpecialOrderProduction listener warning:', err.message)
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
    try {
      unsub = onSnapshot(
        collection(db, WH_DISPATCH_COL),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: SpecialOrderWhDispatch[] = [];
          snap.forEach((d) => remote.push(d.data() as SpecialOrderWhDispatch));
          const merged = mergeById(getLocalSpecialOrderWhDispatches(), remote);
          saveLocalList(WH_DISPATCH_STORAGE_KEY, merged);
          onUpdate(merged);
          if (!snap.metadata.fromCache) {
            flushPendingSpecialOrderData().catch(() => {});
          }
        },
        (err) => console.warn('SpecialOrderWhDispatches listener warning:', err.message)
      );
    } catch {}
  })();
  return () => {
    cancelled = true;
    unsub();
  };
}

// ======================================================
// FACTORY STOCK MATRIX COMPUTATION (SIZES 39-46 & CUSTOM)
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
}

export function computeOrderFactoryStock(
  order: SpecialOrder,
  prodEntries: SpecialOrderFactoryProduction[],
  whDispatches: SpecialOrderWhDispatch[]
): {
  rows: SpecialOrderSizeStockRow[];
  totalProducedConfirmed: number;
  totalPendingFactoryHod: number;
  totalDispatchedToWh: number;
  totalConfirmedWh: number;
  totalAvailableInFactory: number;
} {
  const orderProd = prodEntries.filter((p) => p.orderId === order.id);
  const orderWh = whDispatches.filter((w) => w.orderId === order.id);

  const rows: SpecialOrderSizeStockRow[] = order.sizes.map((sizeLabel) => {
    const productName = buildSpecialOrderSizeProductName(order.productPrefix, sizeLabel);
    const targetQty = Number(order.sizeTargets?.[sizeLabel] || 0);

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
    return {
      sizeLabel,
      productName,
      targetQty,
      producedConfirmed,
      pendingFactoryHod,
      dispatchedToWh,
      confirmedWh,
      availableInFactory,
    };
  });

  return {
    rows,
    totalProducedConfirmed: rows.reduce((s, r) => s + r.producedConfirmed, 0),
    totalPendingFactoryHod: rows.reduce((s, r) => s + r.pendingFactoryHod, 0),
    totalDispatchedToWh: rows.reduce((s, r) => s + r.dispatchedToWh, 0),
    totalConfirmedWh: rows.reduce((s, r) => s + r.confirmedWh, 0),
    totalAvailableInFactory: rows.reduce((s, r) => s + r.availableInFactory, 0),
  };
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
  const orderProd = prodEntries
    .filter((p) => p.orderId === order.id)
    .sort((a, b) => (b.date + b.shiftSubmittedAt).localeCompare(a.date + a.shiftSubmittedAt));

  const matrixRows = stockSummary.rows.map((r) => ({
    'Order No.': order.orderNo,
    'Size': r.sizeLabel,
    'Inventory Product Name': r.productName,
    'Order Target Qty': r.targetQty || '—',
    'Confirmed Produced (Factory)': r.producedConfirmed,
    'Pending HOD Confirm': r.pendingFactoryHod,
    'Moved / Dispatched to WH': r.dispatchedToWh,
    'Available Stock in Factory': r.availableInFactory,
  }));

  matrixRows.push({
    'Order No.': 'TOTAL',
    'Size': `${order.sizes.length} Sizes`,
    'Inventory Product Name': order.title,
    'Order Target Qty': stockSummary.rows.reduce((s, r) => s + r.targetQty, 0) || '—',
    'Confirmed Produced (Factory)': stockSummary.totalProducedConfirmed,
    'Pending HOD Confirm': stockSummary.totalPendingFactoryHod,
    'Moved / Dispatched to WH': stockSummary.totalDispatchedToWh,
    'Available Stock in Factory': stockSummary.totalAvailableInFactory,
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
  const list = whDispatches
    .filter((w) => w.orderId === order.id)
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
