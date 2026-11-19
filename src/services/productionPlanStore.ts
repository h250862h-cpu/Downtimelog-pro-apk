import { collection, doc, getDocs, onSnapshot, setDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import historicalDispatchRaw from '../data/historicalDispatch.json';
import { db, ensureFirebaseAuth } from '../firebase';
import {
  DieselFuelRequest,
  DieselGrnRecord,
  DieselTankConfig,
  DispatchEntry,
  DowntimeEntry,
  GeneratorLog,
  normalizeMachineName,
  PowerCutLog,
  ProductionPlanItem,
  SopProductionRecord,
  SopQcRecord,
} from '../types';
import { getSummaryRows, r2, saveFileBlob, ymd } from './downtimeCalc';
import { calcDurationMinutes, extractTimeLabel, formatDurationHm } from './powerGenStore';
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
// UNIFIED PERIOD PRODUCTION & UTILITIES REPORT (ALL ENTRIES, NO SUMIF)
// Filtered strictly by fromDate..toDate across 6 dedicated sheets:
// 1. Dispatch & Production Entries
// 2. Production Logs (Production Logger)
// 3. QC Logs
// 4. Fuel Logs (Issues + GRNs + Tank Summary)
// 5. Generator Start Up & Stop Logs (Litres)
// 6. Power Cut Logs (+ Total Power Cut Duration)
// ======================================================
export interface DispatchReportEntryRow {
  id: string;
  date: string;
  shift: 'Day' | 'Night';
  machine: string;
  product: string;
  trolleyNo: string;
  qty: number;
  unitWeightKg?: number;
  kg: number;
  scrapKg: number;
  wastageKg: number;
  operatorName: string;
  assistantName: string;
  casualAssistantName?: string;
  shiftInChargeName: string;
  whPersonnelName?: string;
  hodConfirmedByName?: string;
  status: string;
  isHistoricalBackground?: boolean;
}

export interface UnifiedProductionReportData {
  fromDate: string;
  toDate: string;
  totals: {
    totalDispatchEntries: number;
    totalPcs: number;
    totalKg: number;
    totalScrapKg: number;
    totalWastageKg: number;
    totalProdHrs: number;
    totalDownHrs: number;
    totalFuelIssuedLitres: number;
    totalFuelGrnLitres: number;
    totalGenRuns: number;
    totalGenRunMins: number;
    totalGenRunHrs: number;
    totalGenRunHm: string;
    totalGenFuelLitres: number;
    totalPowerCutEvents: number;
    totalPowerCutMins: number;
    totalPowerCutHrs: number;
    totalPowerCutHm: string;
  };
  dispatchRows: DispatchReportEntryRow[];
  shiftProductionRows: SopProductionRecord[];
  qcRows: SopQcRecord[];
  fuelIssueRows: DieselFuelRequest[];
  fuelGrnRows: DieselGrnRecord[];
  dieselTank: DieselTankConfig | null;
  generatorRows: GeneratorLog[];
  powerCutRows: PowerCutLog[];
}

export function buildUnifiedProductionReport(params: {
  fromDate: string;
  toDate: string;
  machines: string[];
  downtimeEntries: DowntimeEntry[];
  allDispatches: DispatchEntry[];
  sopProductionLogs: SopProductionRecord[];
  sopQcChecks: SopQcRecord[];
  dieselRequests?: DieselFuelRequest[];
  dieselGrns?: DieselGrnRecord[];
  dieselTank?: DieselTankConfig | null;
  generatorLogs?: GeneratorLog[];
  powerCutLogs?: PowerCutLog[];
}): UnifiedProductionReportData {
  const {
    fromDate,
    toDate,
    machines,
    downtimeEntries,
    allDispatches,
    sopProductionLogs,
    sopQcChecks,
    dieselRequests = [],
    dieselGrns = [],
    dieselTank = null,
    generatorLogs = [],
    powerCutLogs = [],
  } = params;

  const shiftProductionRows = sopProductionLogs
    .filter((p) => p.date >= fromDate && p.date <= toDate)
    .map((p) => ({ ...p, machine: normalizeMachineName(p.machine) }))
    .sort((a, b) => (a.date + a.shift).localeCompare(b.date + b.shift));

  const qcRows = sopQcChecks
    .filter((q) => q.date >= fromDate && q.date <= toDate)
    .map((q) => ({ ...q, machine: normalizeMachineName(q.machine) }))
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

  const periodDispatches = allDispatches
    .filter((e) => e.date >= fromDate && e.date <= toDate)
    .sort((a, b) => (a.date + (a.shiftSubmittedAt || '')).localeCompare(b.date + (b.shiftSubmittedAt || '')));

  const usedProdLogKeys = new Set<string>();
  const dispatchRows: DispatchReportEntryRow[] = periodDispatches.map((e) => {
    const qty = typeof e.whReceivedQty === 'number' ? e.whReceivedQty : e.recordedQty || 0;
    const kg =
      typeof e.unitWeightKg === 'number' && e.unitWeightKg > 0
        ? qty * e.unitWeightKg
        : e.totalWeightKg || 0;
    const machNorm = normalizeMachineName(e.machine) || 'Unassigned';
    const matchKey = `${e.date}|${e.shift}|${machNorm.toUpperCase()}`;
    const linked = getLinkedScrapAndWastageForDispatch(e, shiftProductionRows);

    let rowScrap = e.backgroundScrapKg || 0;
    let rowWastage = e.backgroundWastageKg || 0;
    if (linked.matchedCount > 0 && !usedProdLogKeys.has(matchKey)) {
      rowScrap += linked.scrapKg;
      rowWastage += linked.wastageKg;
      usedProdLogKeys.add(matchKey);
    }

    return {
      id: e.id,
      date: e.date,
      shift: e.shift,
      machine: machNorm,
      product: (e.product || 'UNSPECIFIED').trim(),
      trolleyNo: e.trolleyNo || '-',
      qty: r2(qty),
      unitWeightKg: e.unitWeightKg,
      kg: r2(kg),
      scrapKg: r2(rowScrap),
      wastageKg: r2(rowWastage),
      operatorName: e.operatorName || '-',
      assistantName: e.assistantName || '-',
      casualAssistantName: e.casualAssistantName,
      shiftInChargeName: e.shiftInChargeName || '-',
      whPersonnelName: e.whPersonnelName,
      hodConfirmedByName: e.hodConfirmedByName,
      status: e.isHistoricalBackground ? 'CONFIRMED (HIST)' : e.status,
      isHistoricalBackground: e.isHistoricalBackground,
    };
  });

  const downtimeSummary = getSummaryRows(fromDate, toDate, machines, downtimeEntries);
  const totalProdHrs = r2(downtimeSummary.structured.reduce((s, r) => s + r.runHrs, 0));
  const totalDownHrs = r2(downtimeSummary.structured.reduce((s, r) => s + r.downHrs, 0));

  const fuelIssueRows = dieselRequests
    .filter((f) => f.date >= fromDate && f.date <= toDate)
    .sort((a, b) => (a.date + a.requestedAt).localeCompare(b.date + b.requestedAt));

  const fuelGrnRows = dieselGrns
    .filter((g) => g.date >= fromDate && g.date <= toDate)
    .sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt));

  const generatorRows = generatorLogs
    .filter((g) => g.date >= fromDate && g.date <= toDate)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

  const powerCutRows = powerCutLogs
    .filter((p) => p.date >= fromDate && p.date <= toDate)
    .sort((a, b) => (a.date + a.timeOut).localeCompare(b.date + b.timeOut));

  const totalPcs = r2(dispatchRows.reduce((s, r) => s + r.qty, 0));
  const totalKg = r2(dispatchRows.reduce((s, r) => s + r.kg, 0));
  const totalScrapKg = r2(
    dispatchRows.reduce((s, r) => s + r.scrapKg, 0) +
      shiftProductionRows
        .filter((p) => !usedProdLogKeys.has(`${p.date}|${p.shift}|${normalizeMachineName(p.machine).toUpperCase()}`))
        .reduce((s, p) => s + (p.scrapKg || 0), 0)
  );
  const totalWastageKg = r2(
    dispatchRows.reduce((s, r) => s + r.wastageKg, 0) +
      shiftProductionRows
        .filter((p) => !usedProdLogKeys.has(`${p.date}|${p.shift}|${normalizeMachineName(p.machine).toUpperCase()}`))
        .reduce((s, p) => s + (p.wastageCdKg || 0), 0)
  );

  const totalFuelIssuedLitres = r2(
    fuelIssueRows
      .filter((r) => r.status === 'DISPENSED')
      .reduce((s, r) => s + (r.actualLitresTaken || 0), 0)
  );
  const totalFuelGrnLitres = r2(
    fuelGrnRows.reduce((s, g) => s + (g.litresAdded || 0), 0)
  );

  const totalGenRunMins = generatorRows.reduce(
    (s, g) => s + (g.status === 'STOPPED' ? g.durationMinutes : calcDurationMinutes(g.startTime)),
    0
  );
  const totalGenFuelLitres = r2(
    generatorRows.reduce((s, g) => s + (g.fuelUsedLitres || 0), 0)
  );

  const totalPowerCutMins = powerCutRows.reduce(
    (s, p) => s + (p.status === 'RESTORED' ? p.durationMinutes : calcDurationMinutes(p.timeOut)),
    0
  );

  return {
    fromDate,
    toDate,
    totals: {
      totalDispatchEntries: dispatchRows.length,
      totalPcs,
      totalKg,
      totalScrapKg,
      totalWastageKg,
      totalProdHrs,
      totalDownHrs,
      totalFuelIssuedLitres,
      totalFuelGrnLitres,
      totalGenRuns: generatorRows.length,
      totalGenRunMins,
      totalGenRunHrs: r2(totalGenRunMins / 60),
      totalGenRunHm: formatDurationHm(totalGenRunMins),
      totalGenFuelLitres,
      totalPowerCutEvents: powerCutRows.length,
      totalPowerCutMins,
      totalPowerCutHrs: r2(totalPowerCutMins / 60),
      totalPowerCutHm: formatDurationHm(totalPowerCutMins),
    },
    dispatchRows,
    shiftProductionRows,
    qcRows,
    fuelIssueRows,
    fuelGrnRows,
    dieselTank,
    generatorRows,
    powerCutRows,
  };
}

export function exportUnifiedProductionReportExcel(
  report: UnifiedProductionReportData,
  isAdmin = false
) {
  if (!isAdmin) return;
  const wb = XLSX.utils.book_new();

  // Sheet 1: All Dispatch & Production Entries in Period (No SUMIF)
  const aoaDispatch: (string | number)[][] = [
    ['LG PLAST — PERIOD DISPATCH & PRODUCTION ENTRIES REPORT'],
    [`Period: ${report.fromDate} to ${report.toDate}`, `Generated: ${new Date().toLocaleString()}`],
    [],
    [
      'Date',
      'Shift',
      'Machine',
      'Product Dispatched',
      'Trolley No',
      'Qty (Pcs)',
      'Unit Wt (kg)',
      'Total Wt (kg)',
      'Scrap (kg)',
      'Wastage (kg)',
      'Operator',
      'Assistant',
      'Casual Assisted',
      'Shift In Charge',
      'WH Personnel',
      'HOD Confirmed',
      'Status',
    ],
  ];

  if (report.dispatchRows.length === 0) {
    aoaDispatch.push([`No dispatch/production entries found between ${report.fromDate} and ${report.toDate}.`]);
  } else {
    report.dispatchRows.forEach((d) => {
      aoaDispatch.push([
        d.date,
        d.shift,
        d.machine,
        d.product,
        d.trolleyNo,
        d.qty,
        d.unitWeightKg ?? '',
        d.kg,
        d.scrapKg,
        d.wastageKg,
        d.operatorName,
        d.assistantName,
        d.casualAssistantName || '',
        d.shiftInChargeName,
        d.whPersonnelName || '',
        d.hodConfirmedByName || '',
        d.status,
      ]);
    });
    aoaDispatch.push([
      'TOTALS (PERIOD)',
      '',
      `${report.dispatchRows.length} entry(s)`,
      '',
      '',
      report.totals.totalPcs,
      '',
      report.totals.totalKg,
      report.totals.totalScrapKg,
      report.totals.totalWastageKg,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  }
  const wsDispatch = XLSX.utils.aoa_to_sheet(aoaDispatch);
  wsDispatch['!cols'] = [
    { wch: 12 },
    { wch: 9 },
    { wch: 22 },
    { wch: 34 },
    { wch: 13 },
    { wch: 11 },
    { wch: 12 },
    { wch: 13 },
    { wch: 11 },
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDispatch, 'Dispatch & Prod Entries');

  // Sheet 2: Production Logs (All entries from Production Logger in Period)
  const aoaProdLogs: (string | number)[][] = [
    ['LG PLAST — PERIOD PRODUCTION LOGS (PRODUCTION LOGGER ENTRIES)'],
    [`Period: ${report.fromDate} to ${report.toDate}`, `Total Entries: ${report.shiftProductionRows.length}`],
    [],
    [
      'Date',
      'Shift',
      'Time Slot',
      'Department',
      'Machine',
      'Operator',
      'Assistant',
      'Product',
      'Quantity',
      'Unit',
      'Prod (kg)',
      'Scrap (kg)',
      'Cut Dust / Wastage (kg)',
      'Running Output/hr',
      'Running Weight',
      'Breakdown Start',
      'Breakdown End',
      'Breakdown Reason',
      'Reported By',
    ],
  ];
  if (report.shiftProductionRows.length === 0) {
    aoaProdLogs.push([`No Production Logger entries found between ${report.fromDate} and ${report.toDate}.`]);
  } else {
    let sumProdKg = 0;
    let sumScrap = 0;
    let sumWastage = 0;
    report.shiftProductionRows.forEach((r) => {
      sumProdKg += r.prodKg || 0;
      sumScrap += r.scrapKg || 0;
      sumWastage += r.wastageCdKg || 0;
      aoaProdLogs.push([
        r.date,
        r.shift,
        r.timeSlot || '',
        r.dept,
        normalizeMachineName(r.machine),
        r.operator,
        r.assistant,
        r.product,
        r.qty ?? r.prodKg,
        r.unit || 'KG',
        r.prodKg,
        r.scrapKg,
        r.wastageCdKg,
        r.outputPerHour || '',
        r.runningWeight || '',
        r.bdStart || '',
        r.bdEnd || '',
        r.bdReason || '',
        r.reporter || r.loggedBy,
      ]);
    });
    aoaProdLogs.push([
      'TOTALS (PERIOD)',
      '',
      '',
      '',
      `${report.shiftProductionRows.length} log(s)`,
      '',
      '',
      '',
      '',
      '',
      r2(sumProdKg),
      r2(sumScrap),
      r2(sumWastage),
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  }
  const wsShift = XLSX.utils.aoa_to_sheet(aoaProdLogs);
  wsShift['!cols'] = [
    { wch: 12 },
    { wch: 9 },
    { wch: 13 },
    { wch: 14 },
    { wch: 22 },
    { wch: 18 },
    { wch: 18 },
    { wch: 30 },
    { wch: 11 },
    { wch: 12 },
    { wch: 11 },
    { wch: 11 },
    { wch: 18 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 24 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, wsShift, 'Production Logs');

  // Sheet 3: QC Logs (All entries from QC Logger in Period)
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
          'Weight (kg)': q.weightKg ?? '',
          'Drop/Bend': q.dropBend,
          Fitting: q.fitting,
          Colour: q.color,
          'OD (mm)': q.od ?? '',
          'ID (mm)': q.idMm ?? '',
          'Reported By': q.reporter || q.loggedBy,
        }))
      : [{ Notice: `No QC Inspection entries found between ${report.fromDate} and ${report.toDate}.` }];
  const wsQc = XLSX.utils.json_to_sheet(qcRowsJson);
  XLSX.utils.book_append_sheet(wb, wsQc, 'QC Logs');

  // Sheet 4: Fuel Logs (Issues + GRN Replenishments + Bowser Level)
  const aoaFuel: (string | number)[][] = [
    ['LG PLAST — DIESEL BOWSER FUEL LOGS (ISSUES & GRN RECEIPTS)'],
    [`Period: ${report.fromDate} to ${report.toDate}`],
    [
      'Current Tank Level (L)',
      report.dieselTank?.currentLevelLitres ?? '',
      'Tank Capacity (L)',
      report.dieselTank?.capacityLitres ?? '',
      'Period Issued (L)',
      report.totals.totalFuelIssuedLitres,
      'Period GRN Added (L)',
      report.totals.totalFuelGrnLitres,
    ],
    [],
    ['SECTION A: DIESEL FUEL REQUEST & DISPENSE ENTRIES'],
    [
      'Voucher No',
      'Date',
      'Shift',
      'Vehicle / Equipment',
      'Driver Name',
      'Requested (L)',
      'HOD Approved (L)',
      'HOD Approved By',
      '1st Meter Reading',
      '2nd Meter Reading',
      'Actual Taken (L)',
      'Tank Before (L)',
      'Tank After (L)',
      'Purpose',
      'Status',
    ],
  ];
  if (report.fuelIssueRows.length === 0) {
    aoaFuel.push([`No Diesel Fuel Request/Issue entries between ${report.fromDate} and ${report.toDate}.`]);
  } else {
    report.fuelIssueRows.forEach((f) => {
      aoaFuel.push([
        f.requestNo,
        f.date,
        f.shift,
        f.vehicleOrForklift,
        f.driverName,
        f.requestedLitres,
        f.hodApprovedLitres ?? '',
        f.hodApprovedBy || 'Pending',
        f.firstMeterReading ?? '',
        f.secondMeterReading ?? '',
        f.actualLitresTaken ?? '',
        f.tankLevelBefore ?? '',
        f.tankLevelAfter ?? '',
        f.purpose || '',
        f.status,
      ]);
    });
    aoaFuel.push([
      'TOTAL FUEL ISSUED (PERIOD)',
      '',
      '',
      '',
      `${report.fuelIssueRows.length} voucher(s)`,
      '',
      '',
      '',
      '',
      '',
      report.totals.totalFuelIssuedLitres,
      '',
      '',
      '',
      '',
    ]);
  }

  aoaFuel.push([]);
  aoaFuel.push(['SECTION B: BULK DIESEL BOWSER GRN RECEIPTS']);
  aoaFuel.push([
    'GRN No',
    'Date',
    'Shift',
    'Supplier',
    'Delivery Note No',
    'LG PLAST Receiver',
    '1st Meter',
    '2nd Meter',
    'Litres Added (+L)',
    'Tank Before (L)',
    'Tank After (L)',
    'Unit Price',
    'Total Cost',
    'Notes',
  ]);
  if (report.fuelGrnRows.length === 0) {
    aoaFuel.push([`No Fuel GRN deliveries recorded between ${report.fromDate} and ${report.toDate}.`]);
  } else {
    report.fuelGrnRows.forEach((g) => {
      aoaFuel.push([
        g.grnNo,
        g.date,
        g.shift,
        g.supplierName,
        g.deliveryNoteNo || '',
        g.receiverName,
        g.firstMeterReading,
        g.secondMeterReading,
        g.litresAdded,
        g.tankLevelBefore,
        g.tankLevelAfter,
        g.unitPrice ?? '',
        g.totalCost ?? '',
        g.notes || '',
      ]);
    });
    aoaFuel.push([
      'TOTAL GRN RECEIVED (PERIOD)',
      '',
      '',
      `${report.fuelGrnRows.length} GRN(s)`,
      '',
      '',
      '',
      '',
      report.totals.totalFuelGrnLitres,
      '',
      '',
      '',
      '',
      '',
    ]);
  }
  const wsFuel = XLSX.utils.aoa_to_sheet(aoaFuel);
  wsFuel['!cols'] = [
    { wch: 22 },
    { wch: 12 },
    { wch: 9 },
    { wch: 24 },
    { wch: 20 },
    { wch: 15 },
    { wch: 15 },
    { wch: 18 },
    { wch: 16 },
    { wch: 16 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 24 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsFuel, 'Fuel Logs');

  // Sheet 5: Generator Start Up & Stop Logs (Litres)
  const aoaGen: (string | number)[][] = [
    ['LG PLAST — GENERATOR START UP & STOP LOGS (FUEL IN LITRES)'],
    [`Period: ${report.fromDate} to ${report.toDate}`, `Total Fuel Used: ${report.totals.totalGenFuelLitres} L`],
    [],
    [
      'Date',
      'Shift',
      'Time Started',
      'Start Fuel Level (L)',
      'Time Stopped',
      'Stop Fuel Level (L)',
      'Fuel Used (L)',
      'Run Duration (mins)',
      'Run Duration (hrs)',
      'Run Duration (H:M)',
      'Status',
      'Linked Power Cut / Reason',
      'Started By',
      'Stopped By',
      'Notes',
    ],
  ];
  if (report.generatorRows.length === 0) {
    aoaGen.push([`No Generator Start/Stop logs found between ${report.fromDate} and ${report.toDate}.`]);
  } else {
    report.generatorRows.forEach((g) => {
      const mins = g.status === 'STOPPED' ? g.durationMinutes : calcDurationMinutes(g.startTime);
      aoaGen.push([
        g.date,
        g.shift,
        extractTimeLabel(g.startTime),
        r2(g.startFuelLitres),
        g.stopTime ? extractTimeLabel(g.stopTime) : 'RUNNING',
        typeof g.stopFuelLitres === 'number' ? r2(g.stopFuelLitres) : '',
        typeof g.fuelUsedLitres === 'number' ? r2(g.fuelUsedLitres) : '',
        mins,
        r2(mins / 60),
        formatDurationHm(mins),
        g.status,
        g.reason || '',
        g.operatorName,
        g.stoppedByName || '',
        g.notes || '',
      ]);
    });
    aoaGen.push([
      'TOTAL GENERATOR SUMMARY',
      '',
      '',
      '',
      '',
      '',
      report.totals.totalGenFuelLitres,
      report.totals.totalGenRunMins,
      report.totals.totalGenRunHrs,
      report.totals.totalGenRunHm,
      `${report.totals.totalGenRuns} run(s)`,
      '',
      '',
      '',
      '',
    ]);
  }
  const wsGen = XLSX.utils.aoa_to_sheet(aoaGen);
  wsGen['!cols'] = [
    { wch: 12 },
    { wch: 9 },
    { wch: 13 },
    { wch: 18 },
    { wch: 13 },
    { wch: 18 },
    { wch: 14 },
    { wch: 17 },
    { wch: 16 },
    { wch: 16 },
    { wch: 12 },
    { wch: 28 },
    { wch: 18 },
    { wch: 18 },
    { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(wb, wsGen, 'Generator Logs');

  // Sheet 6: Power Cut Logs (+ Total Power Cut Duration)
  const aoaPower: (string | number)[][] = [
    ['LG PLAST — PLANT POWER CUT LOGS & TOTAL OUTAGE DURATION'],
    [
      `Period: ${report.fromDate} to ${report.toDate}`,
      `Total Power Cut Duration: ${report.totals.totalPowerCutHm} (${report.totals.totalPowerCutHrs} hrs)`,
    ],
    [],
    [
      'Date',
      'Shift',
      'Time Out',
      'Time Back',
      'Duration (mins)',
      'Duration (hrs)',
      'Duration (H:M)',
      'Affected Area',
      'Generator Started?',
      'Status',
      'Reason / Notes',
      'Logged By',
      'Restored By',
    ],
  ];
  if (report.powerCutRows.length === 0) {
    aoaPower.push([`No Power Cut logs found between ${report.fromDate} and ${report.toDate}.`]);
  } else {
    report.powerCutRows.forEach((p) => {
      const mins = p.status === 'RESTORED' ? p.durationMinutes : calcDurationMinutes(p.timeOut);
      aoaPower.push([
        p.date,
        p.shift,
        extractTimeLabel(p.timeOut),
        p.timeBack ? extractTimeLabel(p.timeBack) : 'ONGOING',
        mins,
        r2(mins / 60),
        formatDurationHm(mins),
        p.affectedArea,
        p.generatorUsed ? 'Yes' : 'No',
        p.status,
        p.reason || '',
        p.loggedBy,
        p.restoredBy || '',
      ]);
    });
    aoaPower.push([
      'TOTAL POWER CUT DURATION',
      '',
      '',
      '',
      report.totals.totalPowerCutMins,
      report.totals.totalPowerCutHrs,
      report.totals.totalPowerCutHm,
      `${report.totals.totalPowerCutEvents} incident(s)`,
      '',
      '',
      '',
      '',
      '',
    ]);
  }
  const wsPower = XLSX.utils.aoa_to_sheet(aoaPower);
  wsPower['!cols'] = [
    { wch: 12 },
    { wch: 9 },
    { wch: 12 },
    { wch: 12 },
    { wch: 15 },
    { wch: 14 },
    { wch: 15 },
    { wch: 24 },
    { wch: 18 },
    { wch: 12 },
    { wch: 30 },
    { wch: 18 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, wsPower, 'Power Cut Logs');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveFileBlob(
    `LGPLAST_Production_Report_${report.fromDate}_to_${report.toDate}.xlsx`,
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  );
}

