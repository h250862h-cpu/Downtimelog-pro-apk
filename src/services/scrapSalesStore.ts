import {
  collection,
  doc,
  onSnapshot,
} from 'firebase/firestore';
import * as XLSX from '../utils/xlsxCompat';
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
  setDocWithTimeout,
  subscribeCloudSyncBus,
} from '../firebase';
import {
  SCRAP_SALES_CATEGORIES,
  ScrapSalesCategoryKey,
  ScrapSalesInvoice,
  ScrapSalesLineItem,
} from '../types';
import { saveFileBlob, ymd } from './downtimeCalc';

const SCRAP_SALES_STORAGE_KEY = 'lgplast_scrap_sales_v1';
const SCRAP_SALES_PENDING_KEY = 'lgplast_scrap_sales_pending_v1';
export const SCRAP_SALES_COLLECTION = 'scrap_sales_invoices';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round3(n: number): number {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

/**
 * Calculates the 3 scrap category rows and grand totals strictly matching
 * the official spreadsheet calculation structure:
 * - COLOUR SCRAP: Cost/kg = 0.20, TOTAL KG = 50% of QNTY/KG, TOTAL COST = TOTAL KG * 0.20
 * - WHITE SCRAP:  Cost/kg = 0.10, TOTAL KG = 50% of QNTY/KG, TOTAL COST = TOTAL KG * 0.10
 * - EMPTY BAGS:   Cost/kg = 0.066666667, TOTAL KG = 50% of QNTY/KG, TOTAL COST = TOTAL KG * 0.066666667
 */
export function calculateScrapSalesInvoiceValues(
  quantities: Partial<Record<ScrapSalesCategoryKey, number>>
): {
  items: ScrapSalesLineItem[];
  totalScrapQntyKg: number;
  totalNetKg: number;
  totalCost: number;
} {
  const items: ScrapSalesLineItem[] = SCRAP_SALES_CATEGORIES.map((cat) => {
    const rawQty = Number(quantities[cat.key] ?? 0);
    const qntyKg = Number.isFinite(rawQty) && rawQty > 0 ? round3(rawQty) : 0;
    const totalKg = round3(qntyKg * cat.yieldFactor);
    const totalCost = round2(totalKg * cat.costPerKg);
    return {
      key: cat.key,
      name: cat.name,
      costPerKg: cat.costPerKg,
      qntyKg,
      totalKg,
      totalCost,
    };
  });

  const totalScrapQntyKg = round3(items.reduce((sum, item) => sum + item.qntyKg, 0));
  const totalNetKg = round3(items.reduce((sum, item) => sum + item.totalKg, 0));
  const totalCost = round2(items.reduce((sum, item) => sum + item.totalCost, 0));

  return {
    items,
    totalScrapQntyKg,
    totalNetKg,
    totalCost,
  };
}

function hasValidSignatureData(sig?: string): boolean {
  return typeof sig === 'string' && sig.trim().length > 10;
}

export function getScrapSalesSignatureCount(
  inv?: Pick<ScrapSalesInvoice, 'signatures'> | null
): number {
  if (!inv?.signatures) return 0;
  let count = 0;
  if (hasValidSignatureData(inv.signatures.preparedBy?.signature)) count += 1;
  if (hasValidSignatureData(inv.signatures.approvedBy?.signature)) count += 1;
  if (hasValidSignatureData(inv.signatures.buyer?.signature)) count += 1;
  return count;
}

export function hasAllScrapSalesSignatures(
  inv?: Pick<ScrapSalesInvoice, 'signatures'> | null
): boolean {
  return getScrapSalesSignatureCount(inv) === 3;
}

/**
 * Only invoices that have BOTH confirmed payment (status === 'PAID')
 * AND all 3 verified digital signatures (Prepared By, Approved By, Buyer)
 * are allowed to enter Excel ledgers & TQM revenue/COPQ calculations.
 */
export function isScrapSaleConfirmedForExcel(
  inv?: ScrapSalesInvoice | null
): boolean {
  if (!inv) return false;
  return inv.status === 'PAID' && hasAllScrapSalesSignatures(inv);
}

function readLocalInvoices(): ScrapSalesInvoice[] {
  try {
    const raw = localStorage.getItem(SCRAP_SALES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalInvoices(items: ScrapSalesInvoice[]) {
  try {
    localStorage.setItem(SCRAP_SALES_STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

function getPendingIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SCRAP_SALES_PENDING_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string' && id) : [];
  } catch {
    return [];
  }
}

function addPendingId(id: string) {
  const q = getPendingIds();
  if (!q.includes(id)) {
    try {
      localStorage.setItem(SCRAP_SALES_PENDING_KEY, JSON.stringify([...q, id]));
    } catch {}
  }
}

function removePendingId(id: string) {
  const q = getPendingIds().filter((x) => x !== id);
  try {
    localStorage.setItem(SCRAP_SALES_PENDING_KEY, JSON.stringify(q));
  } catch {}
}

export function repairPendingScrapSalesQueues(): number {
  try {
    const raw = localStorage.getItem(SCRAP_SALES_PENDING_KEY);
    if (!raw) return 0;
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue)) {
      localStorage.removeItem(SCRAP_SALES_PENDING_KEY);
      return 0;
    }
    const local = readLocalInvoices();
    const byId = new Map(local.map((inv) => [inv.id, inv]));
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
      localStorage.setItem(SCRAP_SALES_PENDING_KEY, JSON.stringify(cleaned));
    }
    return cleaned.length;
  } catch {
    return 0;
  }
}

function clearSyncedFromQueue(local: ScrapSalesInvoice[], remote: ScrapSalesInvoice[]) {
  const pending = getPendingIds();
  if (!pending.length) return;
  const localMap = new Map(local.map((inv) => [inv.id, inv]));
  const remoteMap = new Map(remote.map((inv) => [inv.id, inv]));
  pending.forEach((id) => {
    const r = remoteMap.get(id);
    const l = localMap.get(id);
    if (r && (!l || (r.upd || 0) >= (l.upd || 0))) {
      removePendingId(id);
    }
  });
}

function mergeInvoices(
  local: ScrapSalesInvoice[],
  remote: ScrapSalesInvoice[]
): ScrapSalesInvoice[] {
  const map: Record<string, ScrapSalesInvoice> = {};
  local.forEach((inv) => {
    if (inv?.id) map[inv.id] = inv;
  });
  remote.forEach((inv) => {
    if (!inv?.id) return;
    const ex = map[inv.id];
    if (!ex || (inv.upd || 0) >= (ex.upd || 0)) {
      map[inv.id] = inv;
    }
  });
  return Object.values(map).sort((a, b) => (b.upd || 0) - (a.upd || 0));
}

function queueMissingFromRemote(
  merged: ScrapSalesInvoice[],
  remote: ScrapSalesInvoice[]
): ScrapSalesInvoice[] {
  const remoteMap = new Map(remote.map((r) => [r.id, r]));
  let mutated = false;
  const next = merged.map((inv) => {
    if (!inv?.id) return inv;
    const r = remoteMap.get(inv.id);
    if (!r || (inv.upd || 0) > (r.upd || 0)) {
      addPendingId(inv.id);
      if (inv.sy !== 0) {
        mutated = true;
        return { ...inv, sy: 0 };
      }
    }
    return inv;
  });
  return mutated ? next : merged;
}

export function getLocalScrapSalesInvoices(): ScrapSalesInvoice[] {
  return readLocalInvoices();
}

export function generateNextScrapInvoiceNo(existing: ScrapSalesInvoice[], dateStr: string): string {
  const compactDate = (dateStr || ymd(new Date())).replace(/-/g, '');
  const prefix = `INV-SCR-${compactDate}-`;
  const countForDay = existing.filter((i) => (i.invoiceNo || '').startsWith(prefix)).length;
  return `${prefix}${String(countForDay + 1).padStart(3, '0')}`;
}

export async function saveScrapSalesInvoiceToFirebase(
  invoice: ScrapSalesInvoice,
  options?: { preserveUpd?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const safeInvoiceNo = (invoice.invoiceNo || `INV-SCR-${Date.now()}`).trim().slice(0, 60);
  const safeDate = (invoice.date || ymd(new Date())).trim().slice(0, 20);
  const safeBuyerName = (invoice.buyerName || 'CASH / WALK-IN BUYER').trim().slice(0, 150) || 'CASH / WALK-IN BUYER';
  const allSigned = hasAllScrapSalesSignatures(invoice);
  const enforcedStatus: 'ISSUED' | 'PAID' =
    invoice.status === 'PAID' && allSigned ? 'PAID' : 'ISSUED';

  const updated: ScrapSalesInvoice = {
    ...invoice,
    invoiceNo: safeInvoiceNo.length >= 3 ? safeInvoiceNo : `INV-${safeInvoiceNo}`,
    date: safeDate,
    buyerName: safeBuyerName,
    totalScrapQntyKg: Math.max(0, Number(invoice.totalScrapQntyKg) || 0),
    totalNetKg: Math.max(0, Number(invoice.totalNetKg) || 0),
    totalCost: Math.max(0, Number(invoice.totalCost) || 0),
    status: enforcedStatus,
    paidConfirmedAt:
      enforcedStatus === 'PAID'
        ? invoice.paidConfirmedAt || new Date().toISOString()
        : undefined,
    upd: options?.preserveUpd && invoice.upd ? invoice.upd : Date.now(),
    sy: 0,
  };

  const mergedLocal = mergeInvoices(readLocalInvoices(), [updated]);
  saveLocalInvoices(mergedLocal);
  addPendingId(updated.id);
  notifyCloudSyncBus('scrap_sales');

  try {
    await ensureFirebaseAuth();
    const syncTs = Math.max(Date.now(), updated.upd || 0);
    const payload = deepSanitizeForFirestore({ ...updated, sy: syncTs });
    await setDocWithTimeout(doc(db, SCRAP_SALES_COLLECTION, updated.id), payload, { merge: true });
    removePendingId(updated.id);
    const latest = readLocalInvoices().map((inv) =>
      inv.id === updated.id ? ({ ...inv, sy: syncTs } as ScrapSalesInvoice) : inv
    );
    saveLocalInvoices(latest);
    notifyCloudSyncBus('scrap_sales');
    return { ok: true };
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(SCRAP_SALES_COLLECTION);
    }
    addPendingId(updated.id);
    return { ok: false, error: err?.message || 'Saved locally (offline)' };
  }
}

export function getScrapSalesPendingBreakdown(): { active: number; ruleBlocked: number } {
  const len = getPendingIds().length;
  return isFirestorePathBlockedByRules(SCRAP_SALES_COLLECTION)
    ? { active: 0, ruleBlocked: len }
    : { active: len, ruleBlocked: 0 };
}

export async function flushPendingScrapSalesInvoices(): Promise<number> {
  repairPendingScrapSalesQueues();
  const ids = getPendingIds();
  if (!ids.length) return 0;
  if (!(await canAccessFirestorePath(SCRAP_SALES_COLLECTION, false))) return 0;
  const local = readLocalInvoices();
  let flushed = 0;
  for (const id of ids) {
    if (isFirestorePathBlockedByRules(SCRAP_SALES_COLLECTION)) break;
    const found = local.find((inv) => inv.id === id);
    if (found) {
      const r = await saveScrapSalesInvoiceToFirebase(found, { preserveUpd: true });
      if (r.ok) flushed++;
    } else {
      removePendingId(id);
    }
  }
  return flushed;
}

export async function pollScrapSalesInvoices(): Promise<ScrapSalesInvoice[]> {
  try {
    await ensureFirebaseAuth();
    if (!(await canAccessFirestorePath(SCRAP_SALES_COLLECTION, false))) {
      return readLocalInvoices();
    }
    const snap = await getCollectionDocsServerFirst(collection(db, SCRAP_SALES_COLLECTION));
    const remote: ScrapSalesInvoice[] = [];
    snap.forEach((d) => {
      const raw = d.data() as ScrapSalesInvoice;
      remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 });
    });
    const local = readLocalInvoices();
    const merged = queueMissingFromRemote(mergeInvoices(local, remote), remote);
    saveLocalInvoices(merged);
    clearSyncedFromQueue(local, remote);
    return merged;
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(SCRAP_SALES_COLLECTION);
    }
    return readLocalInvoices();
  }
}

export function subscribeScrapSalesInvoices(
  onUpdate: (invoices: ScrapSalesInvoice[]) => void
) {
  onUpdate(readLocalInvoices());

  let unsub: (() => void) | null = null;
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
    if (!cancelled && (topic === 'scrap_sales' || topic === 'all')) {
      onUpdate(readLocalInvoices());
    }
  });

  const start = async () => {
    if (!(await canAccessFirestorePath(SCRAP_SALES_COLLECTION, false))) return;
    if (cancelled) return;
    try {
      if (unsub) {
        unsub();
        unsub = null;
      }
      unsub = onSnapshot(
        collection(db, SCRAP_SALES_COLLECTION),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: ScrapSalesInvoice[] = [];
          snap.forEach((d) => {
            const raw = d.data() as ScrapSalesInvoice;
            remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 });
          });
          const local = readLocalInvoices();
          const mergedRaw = mergeInvoices(local, remote);
          const merged = !snap.metadata.fromCache
            ? queueMissingFromRemote(mergedRaw, remote)
            : mergedRaw;
          saveLocalInvoices(merged);
          clearSyncedFromQueue(local, remote);
          onUpdate(merged);

          if (!snap.metadata.fromCache) {
            flushPendingScrapSalesInvoices().catch(() => {});
          }
        },
        (err) => {
          if (isPermissionDeniedError(err)) {
            markFirestorePathBlockedByRules(SCRAP_SALES_COLLECTION);
          }
          scheduleRetry();
        }
      );
    } catch {
      scheduleRetry();
    }
  };

  start();

  const handleOnline = () => {
    if (cancelled) return;
    flushPendingScrapSalesInvoices().catch(() => {});
    pollScrapSalesInvoices().then((res) => !cancelled && onUpdate(res));
    start();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
  }

  pollTimer = setInterval(() => {
    if (!cancelled && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      flushPendingScrapSalesInvoices().catch(() => {});
      pollScrapSalesInvoices().then((res) => !cancelled && onUpdate(res));
    }
  }, 60000);

  return () => {
    cancelled = true;
    unsubBus();
    if (retryTimer) clearTimeout(retryTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
    }
    if (unsub) unsub();
  };
}

export function buildScrapSalesExcelWorkbook(
  invoices: ScrapSalesInvoice[],
  dateLabel?: string
): { wb: XLSX.WorkBook; filename: string } {
  const confirmedInvoices = invoices.filter(isScrapSaleConfirmedForExcel);
  const wb = XLSX.utils.book_new();

  const summaryRows: any[][] = [
    ['LG PLAST — RECYCLING SCRAP SALES & INVOICE LEDGER (CONFIRMED PAID + 3 SIGNATURES ONLY)'],
    ['LG PLAST — Affordable / Durable / Complete'],
    [
      'Generated At:',
      new Date().toLocaleString(),
      'Confirmed Invoices in Excel:',
      confirmedInvoices.length,
      'Gate Rule:',
      'Only PAID + All 3 Signatures Verified',
    ],
    [],
    [
      'Invoice No',
      'Date',
      'Buyer / Customer',
      'Buyer Phone',
      'Vehicle Reg',
      'Colour Scrap Qnty/Kg',
      'Colour Total Kg',
      'Colour Cost ($)',
      'White Scrap Qnty/Kg',
      'White Total Kg',
      'White Cost ($)',
      'Empty Bags Qnty/Kg',
      'Empty Bags Total Kg',
      'Empty Bags Cost ($)',
      'Total Scrap Qnty/Kg',
      'Total Net Kg (50%)',
      'TOTAL COST ($)',
      'Prepared By',
      '1. Prepared Signed',
      '2. Approved Signed',
      '3. Buyer Signed',
      'Payment Confirmed By',
      'Payment Confirmed At',
      'Status',
    ],
  ];

  confirmedInvoices.forEach((inv) => {
    const col = inv.items.find((i) => i.key === 'colour_scrap');
    const wht = inv.items.find((i) => i.key === 'white_scrap');
    const bag = inv.items.find((i) => i.key === 'empty_bags');
    summaryRows.push([
      inv.invoiceNo,
      inv.date,
      inv.buyerName,
      inv.buyerPhone || '',
      inv.vehicleReg || '',
      col?.qntyKg || 0,
      col?.totalKg || 0,
      col?.totalCost || 0,
      wht?.qntyKg || 0,
      wht?.totalKg || 0,
      wht?.totalCost || 0,
      bag?.qntyKg || 0,
      bag?.totalKg || 0,
      bag?.totalCost || 0,
      inv.totalScrapQntyKg,
      inv.totalNetKg,
      inv.totalCost,
      inv.preparedByName,
      inv.signatures?.preparedBy?.name || inv.preparedByName || 'Signed',
      inv.signatures?.approvedBy?.name || 'Signed',
      inv.signatures?.buyer?.name || inv.buyerName || 'Signed',
      inv.paidConfirmedBy || inv.preparedByName || 'Confirmed',
      inv.paidConfirmedAt ? inv.paidConfirmedAt.slice(0, 16).replace('T', ' ') : inv.date,
      'PAID (3/3 SIGNED)',
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(summaryRows);
  ws['!cols'] = [
    { wch: 22 },
    { wch: 12 },
    { wch: 24 },
    { wch: 16 },
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 20 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 20 },
    { wch: 18 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Scrap_Sales_Invoices');
  return {
    wb,
    filename: `LGPLAST_Recycling_Scrap_Sales_${dateLabel || ymd(new Date())}.xlsx`,
  };
}

export async function exportScrapSalesExcelWorkbook(
  invoices: ScrapSalesInvoice[],
  dateLabel?: string,
  isAdmin: boolean = false
): Promise<string> {
  if (!isAdmin) return '';
  const confirmedInvoices = invoices.filter(isScrapSaleConfirmedForExcel);
  if (confirmedInvoices.length === 0) return '';
  const { wb, filename } = buildScrapSalesExcelWorkbook(confirmedInvoices, dateLabel);
  const out = await XLSX.writeAsync(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveFileBlob(filename, blob);
  return filename;
}

