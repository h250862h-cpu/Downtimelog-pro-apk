import { collection, doc, getDocs, onSnapshot, setDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import historicalDispatchRaw from '../data/historicalDispatch.json';
import { db, ensureFirebaseAuth } from '../firebase';
import {
  DispatchEntry,
  DowntimeEntry,
  normalizeMachineName,
  ProductionPlanItem,
  SopProductionRecord,
  SopQcRecord,
} from '../types';
import { getSummaryRows, r2, saveFileBlob, ymd } from './downtimeCalc';
import { getLinkedScrapAndWastageForDispatch } from './sopStore';

// ======================================================
// STORAGE KEYS & FIRESTORE COLLECTIONS
// ======================================================
const HIST_UPLOAD_KEY = 'lgplast_hist_dispatch_uploads_v1';
const HIST_UPLOAD_PENDING_KEY = 'lgplast_hist_dispatch_pending_v1';
const HIST_UPLOAD_COLLECTION = 'historical_dispatch_uploads';

const PLAN_STORAGE_KEY = 'lgplast_monthly_prod_plans_v1';
const PLAN_PENDING_KEY = 'lgplast_monthly_prod_plans_pending_v1';
const PLAN_COLLECTION = 'monthly_production_plans';

// ======================================================
// COMPACT BUILT-IN HISTORICAL BACKGROUND DISPATCH LOADER
// ======================================================
interface CompactHistoricalDispatch {
  sics: string[];
  ops: string[];
  prods: string[];
  machs: string[];
  whs: string[];
  rows: Array<
    [
      string, // date YYYY-MM-DD
      'D' | 'N', // shift
      number, // sic idx
      number, // op idx
      number, // prod idx
      number, // mach idx
      number, // qty
      number, // kg
      number, // scrap
      number, // wastage
      number, // wh idx
      string // casual assisted
    ]
  >;
}

let cachedBuiltInHistoricalDispatches: DispatchEntry[] | null = null;

export function getBuiltInHistoricalDispatches(): DispatchEntry[] {
  if (cachedBuiltInHistoricalDispatches) return cachedBuiltInHistoricalDispatches;

  const raw = historicalDispatchRaw as unknown as CompactHistoricalDispatch;
  const decoded: DispatchEntry[] = (raw.rows || []).map((row, idx) => {
    const [date, sh, sicIdx, opIdx, prodIdx, machIdx, qty, kg, scrap, wastage, whIdx, casual] = row;
    const shift: 'Day' | 'Night' = sh === 'N' ? 'Night' : 'Day';
    const machine = normalizeMachineName(raw.machs[machIdx] || '');
    const product = (raw.prods[prodIdx] || '').trim();
    const shiftInCharge = (raw.sics[sicIdx] || '').trim() || 'Shift In Charge';
    const operator = (raw.ops[opIdx] || '').trim() || 'Operator';
    const whPerson = (raw.whs[whIdx] || '').trim() || 'WH Personnel';
    const unitWt = qty > 0 && kg > 0 ? Number((kg / qty).toFixed(4)) : undefined;
    const tsIso = `${date}T${shift === 'Night' ? '19:30:00' : '07:30:00'}.000Z`;
    const tsMs = new Date(tsIso).getTime() || 1760000000000 + idx;

    return {
      id: `DSP-HIST-${date}-${idx + 1}`,
      date,
      shift,
      machine,
      product,
      trolleyNo: `HIST-${idx + 1}`,
      recordedQty: qty,
      whReceivedQty: qty,
      unitWeightKg: unitWt,
      totalWeightKg: kg,
      operatorName: operator,
      assistantName: casual || '—',
      casualAssistantName: casual || undefined,
      isCasualAssistant: Boolean(casual),
      shiftInChargeName: shiftInCharge,
      shiftInChargeSignature: '',
      shiftSubmittedAt: tsIso,
      shiftSubmittedByEmail: 'history@lgplast.local',
      whPersonnelName: whPerson,
      whConfirmedAt: tsIso,
      hodConfirmedByName: 'Historical Verified',
      hodConfirmedAt: tsIso,
      status: 'CONFIRMED',
      upd: tsMs,
      isHistoricalBackground: true,
      sourceUploadBatch: 'Built-In Archive (Sep–Nov 2026)',
      backgroundScrapKg: scrap || 0,
      backgroundWastageKg: wastage || 0,
    };
  });

  cachedBuiltInHistoricalDispatches = decoded;
  return cachedBuiltInHistoricalDispatches;
}

// ======================================================
// LOCAL + FIRESTORE HELPERS
// ======================================================
function readList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, items: T[]) {
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

function sanitizeObj<T extends Record<string, any>>(obj: T): T {
  const clean: Record<string, any> = {};
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if (v !== undefined && !(typeof v === 'number' && Number.isNaN(v))) {
      clean[k] = v;
    }
  });
  return clean as T;
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

function normalizeUploadedHistoryEntry(e: DispatchEntry): DispatchEntry {
  return {
    ...e,
    machine: normalizeMachineName(e.machine),
  };
}

function normalizePlanItem(item: ProductionPlanItem): ProductionPlanItem {
  return {
    ...item,
    machine: item.machine ? normalizeMachineName(item.machine) : undefined,
  };
}

// ======================================================
// UPLOADED HISTORICAL DISPATCH CONTINUATION STORE
// ======================================================
export function getLocalUploadedBackgroundDispatches(): DispatchEntry[] {
  return readList<DispatchEntry>(HIST_UPLOAD_KEY).map(normalizeUploadedHistoryEntry);
}

export async function saveUploadedBackgroundDispatchesBatch(
  rawEntries: DispatchEntry[]
): Promise<{ saved: number; cloudSynced: number }> {
  if (!rawEntries.length) return { saved: 0, cloudSynced: 0 };
  const entries = rawEntries.map(normalizeUploadedHistoryEntry);

  const current = getLocalUploadedBackgroundDispatches();
  const merged = mergeById(current, entries);
  writeList(HIST_UPLOAD_KEY, merged);

  let cloudSynced = 0;
  try {
    await ensureFirebaseAuth();
    // Sync in gentle chunks so Firestore stays fast
    const chunkSize = 25;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const slice = entries.slice(i, i + chunkSize);
      const results = await Promise.all(
        slice.map(async (entry) => {
          try {
            const payload = sanitizeObj({ ...entry, sy: Date.now() });
            await setDoc(doc(db, HIST_UPLOAD_COLLECTION, entry.id), payload, { merge: true });
            removeFromQueue(HIST_UPLOAD_PENDING_KEY, entry.id);
            return true;
          } catch {
            addToQueue(HIST_UPLOAD_PENDING_KEY, entry.id);
            return false;
          }
        })
      );
      cloudSynced += results.filter(Boolean).length;
    }
  } catch {
    entries.forEach((e) => addToQueue(HIST_UPLOAD_PENDING_KEY, e.id));
  }

  return { saved: entries.length, cloudSynced };
}

export async function flushPendingUploadedBackgroundDispatches(): Promise<number> {
  const queue = readQueue(HIST_UPLOAD_PENDING_KEY);
  if (!queue.length) return 0;
  const all = getLocalUploadedBackgroundDispatches();
  let flushed = 0;
  try {
    await ensureFirebaseAuth();
    for (const id of queue) {
      const found = all.find((x) => x.id === id);
      if (!found) {
        removeFromQueue(HIST_UPLOAD_PENDING_KEY, id);
        continue;
      }
      try {
        await setDoc(doc(db, HIST_UPLOAD_COLLECTION, found.id), sanitizeObj({ ...found, sy: Date.now() }), {
          merge: true,
        });
        removeFromQueue(HIST_UPLOAD_PENDING_KEY, found.id);
        flushed++;
      } catch {}
    }
  } catch {}
  return flushed;
}

export async function pollUploadedBackgroundDispatches(): Promise<DispatchEntry[]> {
  try {
    await ensureFirebaseAuth();
    const snap = await getDocs(collection(db, HIST_UPLOAD_COLLECTION));
    const remote: DispatchEntry[] = [];
    snap.forEach((d) => remote.push(normalizeUploadedHistoryEntry(d.data() as DispatchEntry)));
    const merged = mergeById(getLocalUploadedBackgroundDispatches(), remote);
    writeList(HIST_UPLOAD_KEY, merged);
    return merged;
  } catch {
    return getLocalUploadedBackgroundDispatches();
  }
}

export function subscribeUploadedBackgroundDispatches(
  onUpdate: (entries: DispatchEntry[]) => void
) {
  onUpdate(getLocalUploadedBackgroundDispatches());
  let unsub: () => void = () => {};
  let cancelled = false;

  const start = async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    try {
      unsub = onSnapshot(
        collection(db, HIST_UPLOAD_COLLECTION),
        (snap) => {
          const remote: DispatchEntry[] = [];
          snap.forEach((d) => remote.push(normalizeUploadedHistoryEntry(d.data() as DispatchEntry)));
          const merged = mergeById(getLocalUploadedBackgroundDispatches(), remote);
          writeList(HIST_UPLOAD_KEY, merged);
          onUpdate(merged);
        },
        () => {}
      );
    } catch {}
  };
  start();

  return () => {
    cancelled = true;
    unsub();
  };
}

/**
 * Combines live dispatch_entries + user-uploaded historical records + built-in archive
 * into one unified chronological stream without duplicating identical records.
 */
export function mergeAllDispatchesWithBackground(
  liveDispatches: DispatchEntry[],
  uploadedBackground: DispatchEntry[]
): DispatchEntry[] {
  const builtIn = getBuiltInHistoricalDispatches();
  const seenSig = new Set<string>();
  const result: DispatchEntry[] = [];

  const pushUnique = (item: DispatchEntry) => {
    if (!item || !item.id) return;
    // Key prevents duplicate stacking if user uploads the exact same CSV/Sheet1 rows
    const sig = `${item.date}|${item.shift}|${normalizeMachineName(item.machine).toUpperCase()}|${(item.product || '').trim().toUpperCase()}|${item.recordedQty}|${item.trolleyNo}`;
    if (seenSig.has(item.id) || (item.isHistoricalBackground && seenSig.has(sig))) return;
    seenSig.add(item.id);
    if (!item.isHistoricalBackground) {
      seenSig.add(sig);
    }
    result.push({
      ...item,
      machine: normalizeMachineName(item.machine),
    });
  };

  // Live first so user live entries always take precedence
  liveDispatches.forEach(pushUnique);
  uploadedBackground.forEach(pushUnique);
  builtIn.forEach(pushUnique);

  return result.sort((a, b) => (b.date + (b.shiftSubmittedAt || '')).localeCompare(a.date + (a.shiftSubmittedAt || '')));
}

// ======================================================
// MONTHLY PRODUCTION PLANNING STORE
// ======================================================
export function getLocalProductionPlans(): ProductionPlanItem[] {
  return readList<ProductionPlanItem>(PLAN_STORAGE_KEY).map(normalizePlanItem);
}

export async function saveProductionPlanItem(
  item: ProductionPlanItem
): Promise<{ ok: boolean; error?: string }> {
  const updated: ProductionPlanItem = normalizePlanItem({
    ...item,
    upd: Date.now(),
    updatedAt: new Date().toISOString(),
  });
  const merged = mergeById(getLocalProductionPlans(), [updated]);
  writeList(PLAN_STORAGE_KEY, merged);

  try {
    await ensureFirebaseAuth();
    const payload = sanitizeObj({ ...updated, sy: Date.now() });
    await setDoc(doc(db, PLAN_COLLECTION, updated.id), payload, { merge: true });
    removeFromQueue(PLAN_PENDING_KEY, updated.id);
    return { ok: true };
  } catch (err: any) {
    addToQueue(PLAN_PENDING_KEY, updated.id);
    return { ok: false, error: err?.message || 'Offline cached; queued for cloud sync' };
  }
}

export async function saveProductionPlanBatch(
  rawItems: ProductionPlanItem[]
): Promise<{ saved: number; cloudSynced: number }> {
  if (!rawItems.length) return { saved: 0, cloudSynced: 0 };
  const items = rawItems.map(normalizePlanItem);
  const merged = mergeById(getLocalProductionPlans(), items);
  writeList(PLAN_STORAGE_KEY, merged);

  let cloudSynced = 0;
  try {
    await ensureFirebaseAuth();
    for (const item of items) {
      try {
        await setDoc(doc(db, PLAN_COLLECTION, item.id), sanitizeObj({ ...item, sy: Date.now() }), {
          merge: true,
        });
        removeFromQueue(PLAN_PENDING_KEY, item.id);
        cloudSynced++;
      } catch {
        addToQueue(PLAN_PENDING_KEY, item.id);
      }
    }
  } catch {
    items.forEach((i) => addToQueue(PLAN_PENDING_KEY, i.id));
  }
  return { saved: items.length, cloudSynced };
}

export async function flushPendingProductionPlans(): Promise<number> {
  const queue = readQueue(PLAN_PENDING_KEY);
  if (!queue.length) return 0;
  const all = getLocalProductionPlans();
  let flushed = 0;
  try {
    await ensureFirebaseAuth();
    for (const id of queue) {
      const found = all.find((x) => x.id === id);
      if (!found) {
        removeFromQueue(PLAN_PENDING_KEY, id);
        continue;
      }
      try {
        await setDoc(doc(db, PLAN_COLLECTION, found.id), sanitizeObj({ ...found, sy: Date.now() }), {
          merge: true,
        });
        removeFromQueue(PLAN_PENDING_KEY, found.id);
        flushed++;
      } catch {}
    }
  } catch {}
  return flushed;
}

export async function pollProductionPlans(): Promise<ProductionPlanItem[]> {
  try {
    await ensureFirebaseAuth();
    const snap = await getDocs(collection(db, PLAN_COLLECTION));
    const remote: ProductionPlanItem[] = [];
    snap.forEach((d) => remote.push(normalizePlanItem(d.data() as ProductionPlanItem)));
    const merged = mergeById(getLocalProductionPlans(), remote);
    writeList(PLAN_STORAGE_KEY, merged);
    return merged;
  } catch {
    return getLocalProductionPlans();
  }
}

export function subscribeProductionPlans(onUpdate: (items: ProductionPlanItem[]) => void) {
  onUpdate(getLocalProductionPlans());
  let unsub: () => void = () => {};
  let cancelled = false;

  const start = async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    try {
      unsub = onSnapshot(
        collection(db, PLAN_COLLECTION),
        (snap) => {
          const remote: ProductionPlanItem[] = [];
          snap.forEach((d) => remote.push(normalizePlanItem(d.data() as ProductionPlanItem)));
          const merged = mergeById(getLocalProductionPlans(), remote);
          writeList(PLAN_STORAGE_KEY, merged);
          onUpdate(merged);
        },
        () => {}
      );
    } catch {}
  };
  start();

  return () => {
    cancelled = true;
    unsub();
  };
}

// ======================================================
// MONTHLY PLANNING TRACKER (STRICTLY MONTH-SCOPED + AUTO-RED CLOSURE)
// ======================================================
export interface PlanProgressRow extends ProductionPlanItem {
  dispatchedQty: number;
  dispatchedKg: number;
  remainingQty: number;
  progressPct: number;
  isClosed: boolean;
  dispatchCount: number;
}

export function computeMonthlyPlanProgress(
  plans: ProductionPlanItem[],
  allDispatches: DispatchEntry[],
  month: string
): PlanProgressRow[] {
  const monthPlans = plans.filter((p) => p.month === month);
  // STRICT RULE: Only count dispatches whose date falls within this selected planning month (YYYY-MM)
  const monthDispatches = allDispatches.filter((e) => (e.date || '').startsWith(month));

  return monthPlans
    .map((plan) => {
      const targetProdNorm = plan.product.trim().toUpperCase().replace(/\s+/g, ' ');
      const targetMachNorm = plan.machine ? normalizeMachineName(plan.machine).toUpperCase() : '';

      let dispatchedQty = 0;
      let dispatchedKg = 0;
      let dispatchCount = 0;

      monthDispatches.forEach((e) => {
        const eProdNorm = (e.product || '').trim().toUpperCase().replace(/\s+/g, ' ');
        if (eProdNorm !== targetProdNorm) return;
        if (targetMachNorm) {
          const eMachNorm = normalizeMachineName(e.machine).toUpperCase();
          if (eMachNorm !== targetMachNorm) return;
        }
        const qty = typeof e.whReceivedQty === 'number' ? e.whReceivedQty : e.recordedQty || 0;
        const kg =
          typeof e.unitWeightKg === 'number' && e.unitWeightKg > 0
            ? qty * e.unitWeightKg
            : e.totalWeightKg || 0;
        dispatchedQty += qty;
        dispatchedKg += kg;
        dispatchCount += 1;
      });

      const plannedQty = Number(plan.plannedQty) || 0;
      const remainingQty = Math.max(0, r2(plannedQty - dispatchedQty));
      const progressPct = plannedQty > 0 ? Math.min(999, r2((dispatchedQty / plannedQty) * 100)) : 0;
      const isClosed = plannedQty > 0 && dispatchedQty >= plannedQty;

      return {
        ...plan,
        dispatchedQty: r2(dispatchedQty),
        dispatchedKg: r2(dispatchedKg),
        remainingQty,
        progressPct,
        isClosed,
        dispatchCount,
      };
    })
    .sort((a, b) => {
      // Surface active first or keep closed clearly grouped; sort by completion desc inside group
      if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
      return b.progressPct - a.progressPct;
    });
}

// ======================================================
// MULTI-SHEET EXCEL / CSV WORKBOOK IMPORTER
// ======================================================
function parseFlexibleDateToIso(raw: unknown, preferMdy: boolean): string {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return ymd(raw);
  }
  if (typeof raw === 'number' && raw > 25000 && raw < 90000) {
    // Excel serial date
    const utcDays = Math.floor(raw - 25569);
    const d = new Date(utcDays * 86400 * 1000);
    if (!Number.isNaN(d.getTime())) return ymd(d);
  }
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    let m: number;
    let d: number;
    if (a > 12) {
      d = a;
      m = b;
    } else if (b > 12) {
      m = a;
      d = b;
    } else if (preferMdy) {
      m = a;
      d = b;
    } else {
      d = a;
      m = b;
    }
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return '';
}

function parseNumericCell(val: unknown): number {
  if (typeof val === 'number') return Number.isNaN(val) ? 0 : val;
  const cleaned = String(val || '')
    .replace(/,/g, '')
    .replace(/[^0-9.\-]/g, '')
    .trim();
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const cand of candidates) {
    const cNorm = cand.toLowerCase().replace(/[^a-z0-9]/g, '');
    const exact = norm.findIndex((h) => h === cNorm);
    if (exact >= 0) return exact;
  }
  for (const cand of candidates) {
    const cNorm = cand.toLowerCase().replace(/[^a-z0-9]/g, '');
    const partial = norm.findIndex((h) => h.includes(cNorm));
    if (partial >= 0) return partial;
  }
  return -1;
}

export async function parseDispatchAndPlanningWorkbook(
  file: File,
  targetMonth: string,
  uploadedBy: string
): Promise<{
  historyEntries: DispatchEntry[];
  planItems: ProductionPlanItem[];
  sheetSummary: string[];
}> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheetSummary: string[] = [];
  const historyEntries: DispatchEntry[] = [];
  const planItems: ProductionPlanItem[] = [];

  wb.SheetNames.forEach((sheetName, sheetIdx) => {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
    if (!aoa || aoa.length < 2) return;

    // Locate header row within first 10 rows
    let headerIdx = -1;
    for (let r = 0; r < Math.min(10, aoa.length); r++) {
      const cells = (aoa[r] || []).map((c) => String(c || '').trim().toLowerCase());
      const nonEmpty = cells.filter(Boolean);
      if (nonEmpty.length < 2) continue;
      if (
        cells.some((c) => c.includes('item') || c.includes('product') || c.includes('date')) &&
        cells.some((c) => c.includes('qty') || c.includes('qnty') || c.includes('plan') || c.includes('target') || c.includes('machine'))
      ) {
        headerIdx = r;
        break;
      }
    }
    if (headerIdx < 0) headerIdx = 0;

    const headers = (aoa[headerIdx] || []).map((c) => String(c || '').trim());
    const dataRows = aoa.slice(headerIdx + 1);

    const dateCol = findColumnIndex(headers, ['Job Date', 'Date', 'Dispatch Date']);
    const prodCol = findColumnIndex(headers, ['Item Name', 'Product Type', 'Product Dispatched', 'Product', 'Description', 'Item']);
    const planQtyCol = findColumnIndex(headers, ['Planned Qty', 'Plan Qty', 'Planned', 'Target Qty', 'Target', 'Plan Pcs', 'Order Qty', 'Plan']);
    const qtyCol = findColumnIndex(headers, ['Qty', 'Qnty', 'Quantity', 'Prod Pcs']);
    const kgCol = findColumnIndex(headers, ['QNTY (KG)', 'Qty (kg)', 'Weight (kg)', 'Planned Kg', 'Weight', 'KG']);
    const machCol = findColumnIndex(headers, ['Machine', 'Line']);
    const shiftCol = findColumnIndex(headers, ['Shift']);
    const sicCol = findColumnIndex(headers, ['Shift In Charge', 'In Charge']);
    const opCol = findColumnIndex(headers, ['Operator']);
    const scrapCol = findColumnIndex(headers, ['Scrap']);
    const wastageCol = findColumnIndex(headers, ['Wastage']);
    const issueCol = findColumnIndex(headers, ['Issue To', 'Issued To', 'WH Personnel']);
    const casualCol = findColumnIndex(headers, ['Assembled By', 'Casual', 'Assistant']);
    const jcCol = findColumnIndex(headers, ['Job Card', 'Job Card No', 'JC']);
    const monthCol = findColumnIndex(headers, ['Month']);

    const looksLikePlanSheet =
      sheetIdx === 1 ||
      /plan|target|sched/i.test(sheetName) ||
      planQtyCol >= 0 ||
      (dateCol < 0 && prodCol >= 0 && (qtyCol >= 0 || kgCol >= 0));

    if (looksLikePlanSheet && prodCol >= 0) {
      let sheetPlans = 0;
      const mergedByProd: Record<string, ProductionPlanItem> = {};
      dataRows.forEach((row, rIdx) => {
        const prod = String(row[prodCol] || '').trim();
        if (!prod || /^total/i.test(prod)) return;
        const rawQty = planQtyCol >= 0 ? parseNumericCell(row[planQtyCol]) : qtyCol >= 0 ? parseNumericCell(row[qtyCol]) : 0;
        const rawKg = kgCol >= 0 ? parseNumericCell(row[kgCol]) : 0;
        if (rawQty <= 0 && rawKg <= 0) return;

        const mach = machCol >= 0 ? normalizeMachineName(String(row[machCol] || '')) : '';
        const jc = jcCol >= 0 ? String(row[jcCol] || '').trim() : '';
        let rowMonth = targetMonth;
        if (monthCol >= 0 && String(row[monthCol] || '').trim()) {
          const mStr = String(row[monthCol]).trim();
          if (/^\d{4}-\d{2}$/.test(mStr)) rowMonth = mStr;
        }
        const safeProdKey = prod.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 48);
        const id = `PLAN-${rowMonth}-${safeProdKey}${mach ? `-${mach.replace(/[^A-Z0-9]+/gi, '_')}` : ''}`;

        if (mergedByProd[id]) {
          mergedByProd[id].plannedQty = r2(mergedByProd[id].plannedQty + rawQty);
          mergedByProd[id].plannedKg = r2((mergedByProd[id].plannedKg || 0) + rawKg);
        } else {
          mergedByProd[id] = {
            id,
            month: rowMonth,
            product: prod,
            machine: mach || undefined,
            plannedQty: r2(rawQty),
            plannedKg: rawKg > 0 ? r2(rawKg) : undefined,
            jobCardNo: jc || `JC-${rowMonth}-${rIdx + 1}`,
            sourceFile: file.name,
            uploadedBy,
            updatedAt: new Date().toISOString(),
            upd: Date.now(),
          };
          sheetPlans++;
        }
      });
      Object.values(mergedByProd).forEach((p) => planItems.push(p));
      sheetSummary.push(`Sheet "${sheetName}": parsed ${sheetPlans} Production Planning product(s) for ${targetMonth}.`);
      return;
    }

    if (dateCol >= 0 && prodCol >= 0) {
      // Detect whether sheet mostly uses MM/DD/YYYY (like Book1) vs DD/MM/YYYY
      let mdyVotes = 0;
      let dmyVotes = 0;
      dataRows.slice(0, 80).forEach((row) => {
        const s = String(row[dateCol] || '').trim();
        const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
        if (m) {
          if (Number(m[1]) > 12) dmyVotes++;
          if (Number(m[2]) > 12) mdyVotes++;
        }
      });
      const preferMdy = mdyVotes >= dmyVotes;

      let sheetHistoryCount = 0;
      const batchTag = `${file.name} (${new Date().toLocaleDateString()})`;
      dataRows.forEach((row, rIdx) => {
        const dateIso = parseFlexibleDateToIso(row[dateCol], preferMdy);
        const prod = String(row[prodCol] || '').trim();
        if (!dateIso || !prod || /^total/i.test(prod)) return;
        const qty = qtyCol >= 0 ? parseNumericCell(row[qtyCol]) : 0;
        const kg = kgCol >= 0 ? parseNumericCell(row[kgCol]) : 0;
        const scrap = scrapCol >= 0 ? parseNumericCell(row[scrapCol]) : 0;
        const wastage = wastageCol >= 0 ? parseNumericCell(row[wastageCol]) : 0;
        const rawShift = shiftCol >= 0 ? String(row[shiftCol] || '') : '';
        const shift: 'Day' | 'Night' = /night/i.test(rawShift) ? 'Night' : 'Day';
        const machine = normalizeMachineName(machCol >= 0 ? String(row[machCol] || '') : '') || 'Plant Floor';
        const sic = sicCol >= 0 ? String(row[sicCol] || '').trim() : 'Shift In Charge';
        const op = opCol >= 0 ? String(row[opCol] || '').trim() : 'Operator';
        const wh = issueCol >= 0 ? String(row[issueCol] || '').trim() : 'WH Personnel';
        const casual = casualCol >= 0 ? String(row[casualCol] || '').trim() : '';

        const unitWt = qty > 0 && kg > 0 ? Number((kg / qty).toFixed(4)) : undefined;
        const safeHash = `${dateIso}-${shift}-${machine}-${prod}-${qty}-${rIdx}`
          .replace(/[^A-Za-z0-9]/g, '')
          .slice(0, 42);

        historyEntries.push({
          id: `DSP-UPL-${safeHash}`,
          date: dateIso,
          shift,
          machine,
          product: prod,
          trolleyNo: `UPL-${rIdx + 1}`,
          recordedQty: qty,
          whReceivedQty: qty,
          unitWeightKg: unitWt,
          totalWeightKg: kg,
          operatorName: op || 'Operator',
          assistantName: casual || '—',
          casualAssistantName: casual || undefined,
          isCasualAssistant: Boolean(casual),
          shiftInChargeName: sic || 'Shift In Charge',
          shiftInChargeSignature: '',
          shiftSubmittedAt: `${dateIso}T${shift === 'Night' ? '19:30:00' : '07:30:00'}.000Z`,
          shiftSubmittedByEmail: uploadedBy,
          whPersonnelName: wh || 'WH Personnel',
          whConfirmedAt: `${dateIso}T${shift === 'Night' ? '19:30:00' : '07:30:00'}.000Z`,
          hodConfirmedByName: 'Uploaded Archive',
          status: 'CONFIRMED',
          upd: Date.now(),
          isHistoricalBackground: true,
          sourceUploadBatch: batchTag,
          backgroundScrapKg: scrap,
          backgroundWastageKg: wastage,
        });
        sheetHistoryCount++;
      });

      sheetSummary.push(`Sheet "${sheetName}": attached ${sheetHistoryCount} Dispatch/Trolley movement record(s).`);
    }
  });

  return { historyEntries, planItems, sheetSummary };
}

// ======================================================
// UNIFIED PERIOD PRODUCTION REPORT (SUMIF STRUCTURE)
// Matches Nov_2026__08-15__W1_PRODUCTION_REPORT structure
// ======================================================
export interface ProductSumRow {
  product: string;
  prodPcs: number;
  prodKg: number;
  scrapKg: number;
  wastageKg: number;
}

export interface MachineSumRow {
  machine: string;
  prodPcs: number;
  prodKg: number;
  scrapKg: number;
  wastageKg: number;
  prodHrs: number;
  downHrs: number;
}

export interface UnifiedProductionReportData {
  fromDate: string;
  toDate: string;
  totals: {
    totalPcs: number;
    totalKg: number;
    totalScrapKg: number;
    totalWastageKg: number;
    totalProdHrs: number;
    totalDownHrs: number;
  };
  productRows: ProductSumRow[];
  machineRows: MachineSumRow[];
  shiftProductionRows: SopProductionRecord[];
  qcRows: SopQcRecord[];
}

export function buildUnifiedProductionReport(params: {
  fromDate: string;
  toDate: string;
  machines: string[];
  downtimeEntries: DowntimeEntry[];
  allDispatches: DispatchEntry[];
  sopProductionLogs: SopProductionRecord[];
  sopQcChecks: SopQcRecord[];
}): UnifiedProductionReportData {
  const {
    fromDate,
    toDate,
    machines,
    downtimeEntries,
    allDispatches,
    sopProductionLogs,
    sopQcChecks,
  } = params;

  const periodDispatches = allDispatches.filter(
    (e) => e.date >= fromDate && e.date <= toDate
  );
  const shiftProductionRows = sopProductionLogs
    .filter((p) => p.date >= fromDate && p.date <= toDate)
    .map((p) => ({ ...p, machine: normalizeMachineName(p.machine) }))
    .sort((a, b) => (a.date + a.shift).localeCompare(b.date + b.shift));
  const qcRows = sopQcChecks
    .filter((q) => q.date >= fromDate && q.date <= toDate)
    .map((q) => ({ ...q, machine: normalizeMachineName(q.machine) }))
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

  // 1. Machine hours from Machine Downtime Log records via getSummaryRows
  const downtimeSummary = getSummaryRows(fromDate, toDate, machines, downtimeEntries);
  const hoursByMachine: Record<string, { prodHrs: number; downHrs: number }> = {};
  downtimeSummary.structured.forEach((row) => {
    const mKey = normalizeMachineName(row.machine).toUpperCase();
    hoursByMachine[mKey] = { prodHrs: row.runHrs, downHrs: row.downHrs };
  });

  // 2. Aggregate Product SUMIF & Machine SUMIF from dispatch movements + linked scrap/wastage
  const prodMap: Record<string, ProductSumRow> = {};
  const machMap: Record<string, MachineSumRow> = {};
  const usedProdLogKeys = new Set<string>();

  periodDispatches.forEach((e) => {
    const qty = typeof e.whReceivedQty === 'number' ? e.whReceivedQty : e.recordedQty || 0;
    const kg =
      typeof e.unitWeightKg === 'number' && e.unitWeightKg > 0
        ? qty * e.unitWeightKg
        : e.totalWeightKg || 0;

    const linked = getLinkedScrapAndWastageForDispatch(e, shiftProductionRows);
    const machNorm = normalizeMachineName(e.machine) || 'Unassigned';
    const matchKey = `${e.date}|${e.shift}|${machNorm.toUpperCase()}`;

    let rowScrap = e.backgroundScrapKg || 0;
    let rowWastage = e.backgroundWastageKg || 0;
    if (linked.matchedCount > 0 && !usedProdLogKeys.has(matchKey)) {
      rowScrap += linked.scrapKg;
      rowWastage += linked.wastageKg;
      usedProdLogKeys.add(matchKey);
    }

    const pKey = (e.product || 'UNSPECIFIED').trim().toUpperCase();
    if (!prodMap[pKey]) {
      prodMap[pKey] = {
        product: (e.product || 'UNSPECIFIED').trim(),
        prodPcs: 0,
        prodKg: 0,
        scrapKg: 0,
        wastageKg: 0,
      };
    }
    prodMap[pKey].prodPcs += qty;
    prodMap[pKey].prodKg += kg;
    prodMap[pKey].scrapKg += rowScrap;
    prodMap[pKey].wastageKg += rowWastage;

    const mKey = machNorm.toUpperCase();
    if (!machMap[mKey]) {
      const hrs = hoursByMachine[mKey] || { prodHrs: 0, downHrs: 0 };
      machMap[mKey] = {
        machine: machNorm,
        prodPcs: 0,
        prodKg: 0,
        scrapKg: 0,
        wastageKg: 0,
        prodHrs: hrs.prodHrs,
        downHrs: hrs.downHrs,
      };
    }
    machMap[mKey].prodPcs += qty;
    machMap[mKey].prodKg += kg;
    machMap[mKey].scrapKg += rowScrap;
    machMap[mKey].wastageKg += rowWastage;
  });

  // Also include unlinked Production Logger scrap/wastage & downtime hours for machines active in downtime log
  shiftProductionRows.forEach((p) => {
    const machNorm = normalizeMachineName(p.machine) || 'Unassigned';
    const matchKey = `${p.date}|${p.shift}|${machNorm.toUpperCase()}`;
    if (usedProdLogKeys.has(matchKey)) return;

    const mKey = machNorm.toUpperCase();
    if (!machMap[mKey]) {
      const hrs = hoursByMachine[mKey] || { prodHrs: 0, downHrs: 0 };
      machMap[mKey] = {
        machine: machNorm,
        prodPcs: 0,
        prodKg: 0,
        scrapKg: 0,
        wastageKg: 0,
        prodHrs: hrs.prodHrs,
        downHrs: hrs.downHrs,
      };
    }
    machMap[mKey].scrapKg += p.scrapKg || 0;
    machMap[mKey].wastageKg += p.wastageCdKg || 0;

    const pKey = (p.product || 'UNSPECIFIED').trim().toUpperCase();
    if (!prodMap[pKey]) {
      prodMap[pKey] = {
        product: (p.product || 'UNSPECIFIED').trim(),
        prodPcs: 0,
        prodKg: 0,
        scrapKg: 0,
        wastageKg: 0,
      };
    }
    prodMap[pKey].scrapKg += p.scrapKg || 0;
    prodMap[pKey].wastageKg += p.wastageCdKg || 0;
  });

  // Ensure every plant machine with downtime/running logs appears in the Machine table too
  machines.forEach((m) => {
    const norm = normalizeMachineName(m);
    const mKey = norm.toUpperCase();
    if (!machMap[mKey]) {
      const hrs = hoursByMachine[mKey] || { prodHrs: 0, downHrs: 0 };
      if (hrs.prodHrs > 0 || hrs.downHrs > 0) {
        machMap[mKey] = {
          machine: norm,
          prodPcs: 0,
          prodKg: 0,
          scrapKg: 0,
          wastageKg: 0,
          prodHrs: hrs.prodHrs,
          downHrs: hrs.downHrs,
        };
      }
    }
  });

  const productRows = Object.values(prodMap)
    .map((r) => ({
      ...r,
      prodPcs: r2(r.prodPcs),
      prodKg: r2(r.prodKg),
      scrapKg: r2(r.scrapKg),
      wastageKg: r2(r.wastageKg),
    }))
    .sort((a, b) => b.prodKg - a.prodKg);

  const machineRows = Object.values(machMap)
    .map((r) => ({
      ...r,
      prodPcs: r2(r.prodPcs),
      prodKg: r2(r.prodKg),
      scrapKg: r2(r.scrapKg),
      wastageKg: r2(r.wastageKg),
      prodHrs: r2(r.prodHrs),
      downHrs: r2(r.downHrs),
    }))
    .sort((a, b) => b.prodKg - a.prodKg || b.prodHrs - a.prodHrs);

  const totalPcs = r2(productRows.reduce((s, r) => s + r.prodPcs, 0));
  const totalKg = r2(productRows.reduce((s, r) => s + r.prodKg, 0));
  const totalScrapKg = r2(machineRows.reduce((s, r) => s + r.scrapKg, 0));
  const totalWastageKg = r2(machineRows.reduce((s, r) => s + r.wastageKg, 0));
  const totalProdHrs = r2(machineRows.reduce((s, r) => s + r.prodHrs, 0));
  const totalDownHrs = r2(machineRows.reduce((s, r) => s + r.downHrs, 0));

  return {
    fromDate,
    toDate,
    totals: {
      totalPcs,
      totalKg,
      totalScrapKg,
      totalWastageKg,
      totalProdHrs,
      totalDownHrs,
    },
    productRows,
    machineRows,
    shiftProductionRows,
    qcRows,
  };
}

export function exportUnifiedProductionReportExcel(report: UnifiedProductionReportData) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Exact Side-by-Side / Stacked Multi-Section Summary matching W1 PRODUCTION REPORT
  const maxLen = Math.max(report.productRows.length, report.machineRows.length);
  const aoaSummary: (string | number)[][] = [
    ['LG PLAST — UNIFIED PERIOD PRODUCTION REPORT (SUMIF SUMMARY)'],
    [`Period: ${report.fromDate} to ${report.toDate}`, `Generated: ${new Date().toLocaleString()}`],
    [
      'PRODUCT (PCS)',
      report.totals.totalPcs,
      'WEIGHT (KG)',
      report.totals.totalKg,
      'SCRAP (KG)',
      report.totals.totalScrapKg,
      'WASTAGE (KG)',
      report.totals.totalWastageKg,
      'TOTAL PRODUCTION HRS',
      report.totals.totalProdHrs,
      'TOTAL DOWNTIME HRS',
      report.totals.totalDownHrs,
    ],
    [],
    [
      'PRODUCT TYPE',
      'PROD. PCS',
      'PROD KG',
      'SCRAP',
      'WASTAGE',
      '',
      'MACHINE',
      'PRODUCTION',
      'WEIGHT',
      'SCRAP',
      'WASTAGE',
      'PROD HRS',
      'DOWNTIME HRS',
    ],
  ];

  for (let i = 0; i < maxLen; i++) {
    const p = report.productRows[i];
    const m = report.machineRows[i];
    aoaSummary.push([
      p ? p.product : '',
      p ? p.prodPcs : '',
      p ? p.prodKg : '',
      p ? p.scrapKg : '',
      p ? p.wastageKg : '',
      '',
      m ? m.machine : '',
      m ? m.prodPcs : '',
      m ? m.prodKg : '',
      m ? m.scrapKg : '',
      m ? m.wastageKg : '',
      m ? m.prodHrs : '',
      m ? m.downHrs : '',
    ]);
  }

  aoaSummary.push([
    'TOTAL PRODUCTION',
    report.totals.totalPcs,
    report.totals.totalKg,
    report.totals.totalScrapKg,
    report.totals.totalWastageKg,
    '',
    'TOTAL PRODUCTION',
    report.totals.totalPcs,
    report.totals.totalKg,
    report.totals.totalScrapKg,
    report.totals.totalWastageKg,
    report.totals.totalProdHrs,
    report.totals.totalDownHrs,
  ]);

  const wsSummary = XLSX.utils.aoa_to_sheet(aoaSummary);
  wsSummary['!cols'] = [
    { wch: 36 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 3 },
    { wch: 24 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Production Summary');

  // Sheet 2: Production Per Shift (Production Logger)
  const shiftRowsJson =
    report.shiftProductionRows.length > 0
      ? report.shiftProductionRows.map((r) => ({
          Date: r.date,
          Shift: r.shift,
          Department: r.dept,
          Machine: normalizeMachineName(r.machine),
          Operator: r.operator,
          Assistant: r.assistant,
          Product: r.product,
          Quantity: r.qty ?? r.prodKg,
          Unit: r.unit || 'KG',
          'Prod (kg)': r.prodKg,
          Scrap: r.scrapKg,
          'Cut Dust': r.wastageCdKg,
          'Reported By': r.reporter || r.loggedBy,
        }))
      : [{ Notice: `No Production Logger records found between ${report.fromDate} and ${report.toDate}.` }];
  const wsShift = XLSX.utils.json_to_sheet(shiftRowsJson);
  XLSX.utils.book_append_sheet(wb, wsShift, 'Production Per Shift');

  // Sheet 3: QC Report (QC Logger)
  const qcRowsJson =
    report.qcRows.length > 0
      ? report.qcRows.map((q) => ({
          Date: q.date,
          Shift: q.shift,
          Time: q.time || '',
          'QC No': q.qcNo || '',
          Machine: normalizeMachineName(q.machine),
          Product: q.product,
          PPH: q.pph ?? '',
          'Kgs/Hr': q.kgsPerHr ?? '',
          Weight: q.weightKg ?? '',
          'Drop/Bend': q.dropBend,
          Fitting: q.fitting,
          Colour: q.color,
          OD: q.od ?? '',
          ID: q.idMm ?? '',
          'Reported By': q.reporter || q.loggedBy,
        }))
      : [{ Notice: `No QC Inspection records found between ${report.fromDate} and ${report.toDate}.` }];
  const wsQc = XLSX.utils.json_to_sheet(qcRowsJson);
  XLSX.utils.book_append_sheet(wb, wsQc, 'QC Report');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveFileBlob(
    `LGPLAST_Production_Report_${report.fromDate}_to_${report.toDate}.xlsx`,
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  );
}
