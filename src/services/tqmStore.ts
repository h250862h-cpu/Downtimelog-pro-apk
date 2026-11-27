import { collection, doc, onSnapshot } from 'firebase/firestore';
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
  DieselFuelRequest,
  DieselGrnRecord,
  DieselTankConfig,
  DispatchEntry,
  DowntimeEntry,
  GeneratorLog,
  PowerCutLog,
  ProductionPlanItem,
  QualityTrialReport,
  ScrapSalesInvoice,
  SopMixingReport,
  SopProductionRecord,
  SopQcRecord,
  SopScrapRecord,
  SopShiftHandoverRecord,
  SpecialOrder,
  SpecialOrderFactoryProduction,
  SpecialOrderWhDispatch,
  TqmCapaRecord,
  TqmCapaSeverity,
  TqmIshikawaCategory,
  TqmLinkedEntityRef,
  normalizeMachineName,
} from '../types';
import { ParsedAttendanceMessage, QCInspectionRecord } from '../types/attendance';
import { getSummaryRows, saveFileBlob, ymd } from './downtimeCalc';

const TQM_CAPA_STORAGE_KEY = 'lgplast_tqm_capa_v1';
const TQM_CAPA_PENDING_KEY = 'lgplast_tqm_capa_pending_v1';
export const TQM_CAPA_COLLECTION = 'tqm_capa_records';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round1(n: number): number {
  return Math.round((Number(n) || 0) * 10) / 10;
}

// ======================================================
// FIRESTORE + OUTBOX PERSISTENCE (CAPA & NCR REGISTER)
// ======================================================

function readLocalCapas(): TqmCapaRecord[] {
  try {
    const raw = localStorage.getItem(TQM_CAPA_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalCapas(items: TqmCapaRecord[]): void {
  try {
    localStorage.setItem(TQM_CAPA_STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

function getPendingIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TQM_CAPA_PENDING_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string' && id) : [];
  } catch {
    return [];
  }
}

function addPendingId(id: string): void {
  const q = getPendingIds();
  if (!q.includes(id)) {
    try {
      localStorage.setItem(TQM_CAPA_PENDING_KEY, JSON.stringify([...q, id]));
    } catch {}
  }
}

function removePendingId(id: string): void {
  const q = getPendingIds().filter((x) => x !== id);
  try {
    localStorage.setItem(TQM_CAPA_PENDING_KEY, JSON.stringify(q));
  } catch {}
}

export function repairPendingTqmQueues(): number {
  try {
    const raw = localStorage.getItem(TQM_CAPA_PENDING_KEY);
    if (!raw) return 0;
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue)) {
      localStorage.removeItem(TQM_CAPA_PENDING_KEY);
      return 0;
    }
    const local = readLocalCapas();
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
      localStorage.setItem(TQM_CAPA_PENDING_KEY, JSON.stringify(cleaned));
    }
    return cleaned.length;
  } catch {
    return 0;
  }
}

function clearSyncedFromQueue(local: TqmCapaRecord[], remote: TqmCapaRecord[]): void {
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

function mergeCapas(local: TqmCapaRecord[], remote: TqmCapaRecord[]): TqmCapaRecord[] {
  const map: Record<string, TqmCapaRecord> = {};
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

function queueMissingFromRemote(
  merged: TqmCapaRecord[],
  remote: TqmCapaRecord[]
): TqmCapaRecord[] {
  const remoteMap = new Map(remote.map((r) => [r.id, r]));
  let mutated = false;
  const next = merged.map((c) => {
    if (!c?.id) return c;
    const r = remoteMap.get(c.id);
    if (!r || (c.upd || 0) > (r.upd || 0)) {
      addPendingId(c.id);
      if (c.sy !== 0) {
        mutated = true;
        return { ...c, sy: 0 };
      }
    }
    return c;
  });
  return mutated ? next : merged;
}

export function getLocalTqmCapas(): TqmCapaRecord[] {
  return readLocalCapas();
}

export function generateNextTqmCapaNo(existing: TqmCapaRecord[], dateStr: string): string {
  const ym = (dateStr || ymd(new Date())).slice(0, 7).replace(/-/g, '');
  const prefix = `TQM-CAPA-${ym}-`;
  const count = existing.filter((c) => (c.capaNo || '').startsWith(prefix)).length;
  return `${prefix}${String(count + 1).padStart(3, '0')}`;
}

export async function saveTqmCapaToFirebase(
  capa: TqmCapaRecord,
  options?: { preserveUpd?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const updated: TqmCapaRecord = {
    ...capa,
    upd: options?.preserveUpd && capa.upd ? capa.upd : Date.now(),
    sy: 0,
  };

  const mergedLocal = mergeCapas(readLocalCapas(), [updated]);
  saveLocalCapas(mergedLocal);
  addPendingId(updated.id);
  notifyCloudSyncBus('tqm_capas');

  try {
    await ensureFirebaseAuth();
    const syncTs = Math.max(Date.now(), updated.upd || 0);
    const payload = deepSanitizeForFirestore({ ...updated, sy: syncTs });
    await setDocWithTimeout(doc(db, TQM_CAPA_COLLECTION, updated.id), payload, { merge: true });
    removePendingId(updated.id);
    const latest = readLocalCapas().map((c) =>
      c.id === updated.id ? ({ ...c, sy: syncTs } as TqmCapaRecord) : c
    );
    saveLocalCapas(latest);
    notifyCloudSyncBus('tqm_capas');
    return { ok: true };
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(TQM_CAPA_COLLECTION);
    }
    addPendingId(updated.id);
    return { ok: false, error: err?.message || 'Saved locally (offline)' };
  }
}

export async function flushPendingTqmCapas(): Promise<number> {
  if (!(await canAccessFirestorePath(TQM_CAPA_COLLECTION, false))) return 0;
  const pendingIds = getPendingIds();
  if (!pendingIds.length) return 0;
  const local = readLocalCapas();
  let flushed = 0;

  for (const id of pendingIds) {
    const item = local.find((c) => c.id === id);
    if (!item) {
      removePendingId(id);
      continue;
    }
    const res = await saveTqmCapaToFirebase(item, { preserveUpd: true });
    if (res.ok) flushed++;
  }
  return flushed;
}

export async function pollTqmCapas(): Promise<TqmCapaRecord[]> {
  try {
    await ensureFirebaseAuth();
    if (!(await canAccessFirestorePath(TQM_CAPA_COLLECTION, false))) {
      return readLocalCapas();
    }
    const snap = await getCollectionDocsServerFirst(collection(db, TQM_CAPA_COLLECTION));
    const docs: TqmCapaRecord[] = [];
    snap.forEach((d) => {
      const data = d.data() as TqmCapaRecord;
      if (data) docs.push({ ...data, id: data.id || d.id, sy: data.sy || data.upd || 1 });
    });
    const local = readLocalCapas();
    const merged = mergeCapas(local, docs);
    const synced = queueMissingFromRemote(merged, docs);
    saveLocalCapas(synced);
    clearSyncedFromQueue(local, docs);
    notifyCloudSyncBus('tqm_capas');
    return synced;
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(TQM_CAPA_COLLECTION);
    }
    return readLocalCapas();
  }
}

export function subscribeTqmCapas(cb: (items: TqmCapaRecord[]) => void): () => void {
  cb(readLocalCapas());
  let unsubSnap: (() => void) | null = null;
  let cancelled = false;

  const unsubBus = subscribeCloudSyncBus((topic) => {
    if (!cancelled && (topic === 'tqm_capas' || topic === 'all')) cb(readLocalCapas());
  });

  canAccessFirestorePath(TQM_CAPA_COLLECTION, false)
    .then(async (canAccess) => {
      if (!canAccess || cancelled) return;
      await ensureFirebaseAuth();
      if (cancelled) return;
      unsubSnap = onSnapshot(
        collection(db, TQM_CAPA_COLLECTION),
        (snap) => {
          const remote: TqmCapaRecord[] = [];
          snap.forEach((d) => {
            const data = d.data() as TqmCapaRecord;
            if (data) remote.push({ ...data, id: data.id || d.id, sy: data.sy || data.upd || 1 });
          });
          const local = readLocalCapas();
          const merged = mergeCapas(local, remote);
          const checked = queueMissingFromRemote(merged, remote);
          saveLocalCapas(checked);
          clearSyncedFromQueue(local, remote);
          cb(checked);
        },
        (err) => {
          if (isPermissionDeniedError(err)) {
            markFirestorePathBlockedByRules(TQM_CAPA_COLLECTION);
          }
          cb(readLocalCapas());
        }
      );
    })
    .catch(() => {});

  return () => {
    cancelled = true;
    unsubBus();
    if (unsubSnap) unsubSnap();
  };
}

export function getTqmPendingBreakdown(): { active: number; ruleBlocked: number } {
  const count = getPendingIds().length;
  const blocked = isFirestorePathBlockedByRules(TQM_CAPA_COLLECTION);
  return {
    active: blocked ? 0 : count,
    ruleBlocked: blocked ? count : 0,
  };
}

// ======================================================
// CROSS-MODULE LINKED TQM ANALYTICS ENGINE
// ======================================================

export interface TqmAnalyticsInput {
  fromDate?: string;
  toDate?: string;
  machines: string[];
  downtimeEntries: DowntimeEntry[];
  dispatches: DispatchEntry[];
  monthlyPlans: ProductionPlanItem[];
  specialOrders: SpecialOrder[];
  specialOrderProductions: SpecialOrderFactoryProduction[];
  specialOrderWhDispatches: SpecialOrderWhDispatch[];
  qualityTrials: QualityTrialReport[];
  sopProductionLogs: SopProductionRecord[];
  sopQcChecks: SopQcRecord[];
  sopScrapPipeline: SopScrapRecord[];
  sopMixingReports: SopMixingReport[];
  sopHandovers: SopShiftHandoverRecord[];
  scrapSalesInvoices: ScrapSalesInvoice[];
  dieselRequests: DieselFuelRequest[];
  dieselGrns: DieselGrnRecord[];
  dieselTank: DieselTankConfig;
  powerCutLogs: PowerCutLog[];
  generatorLogs: GeneratorLog[];
  attendanceBatch: ParsedAttendanceMessage[];
  qcLogs: QCInspectionRecord[];
  tqmCapas: TqmCapaRecord[];
}

export interface TqmDetectedSignal {
  signalKey: string;
  title: string;
  severity: TqmCapaSeverity;
  ishikawaCategory: TqmIshikawaCategory;
  date: string;
  shift: 'Day' | 'Night';
  machine: string;
  product: string;
  summary: string;
  estimatedCopqUsd: number;
  scrapImpactKg: number;
  downtimeImpactMins: number;
  suggestedRootCause: string;
  linkedRefs: TqmLinkedEntityRef[];
  linkedCapa?: TqmCapaRecord;
}

export interface TqmMachineLinkProfile {
  machine: string;
  availabilityPct: number;
  runHrs: number;
  breakdownHrs: number;
  changeoverHrs: number;
  powerOutageLinkedCount: number;
  sopProdQty: number;
  sopProdKg: number;
  sopScrapKg: number;
  wastageKg: number;
  scrapRatePct: number;
  qcChecksCount: number;
  qcPassRatePct: number;
  qcFailOrHoldCount: number;
  dispatchUnits: number;
  whVarianceCount: number;
  trialsCount: number;
  openCapaCount: number;
  qualityIndex: number; // 0 - 100
}

export interface TqmProductTraceProfile {
  product: string;
  primaryMachine: string;
  plannedQty: number;
  dispatchedQty: number;
  dispatchedKg: number;
  planAttainmentPct: number;
  sopProdQty: number;
  sopProdKg: number;
  sopScrapKg: number;
  scrapPct: number;
  qcTotalChecks: number;
  qcPassRatePct: number;
  trialsApproved: number;
  trialsTotal: number;
  whVarianceCount: number;
  specialOrderQty: number;
  openCapaCount: number;
}

export interface TqmShiftCorrelationRow {
  shift: 'Day' | 'Night';
  sopProdKg: number;
  sopScrapKg: number;
  scrapPct: number;
  qcPassRatePct: number;
  qcSamplesTested: number;
  breakdownMins: number;
  handoverAvgScrapPct: number;
  attendanceAvgHeadcount: number;
  casualRatioPct: number;
  dispatchedQty: number;
}

export interface TqmUnifiedSnapshot {
  periodLabel: string;
  fromDate: string;
  toDate: string;
  // Executive Top KPIs
  overallTqmIndex: number; // 0-100
  firstPassYieldPct: number;
  machineAvailabilityPct: number;
  planAttainmentPct: number;
  closedLoopRecoveryPct: number;
  capaClosureRatePct: number;
  // Volume & Counts across all linked modules
  totalSopProdKg: number;
  totalSopScrapKg: number;
  totalWastageKg: number;
  overallScrapRatePct: number;
  totalDispatchedUnits: number;
  totalDispatchedKg: number;
  totalWhVariances: number;
  pendingWhDispatches: number;
  pendingHodDispatches: number;
  totalQcInspections: number;
  totalQcFailHold: number;
  totalTrials: number;
  approvedTrials: number;
  rejectedTrials: number;
  openCapaCount: number;
  inProgressCapaCount: number;
  closedCapaCount: number;
  // Closed-Loop Recycling, Mixing, Scrap Sales & Utilities
  scrapSentToRecyclingKg: number;
  usableRegrindProducedKg: number;
  recyclingWasteKg: number;
  mixerWhUsedKg: number;
  mixerScrapUsedKg: number;
  mixerSweepingKg: number;
  mixerBatchesTotal: number;
  scrapSoldGrossKg: number;
  scrapSoldNetKg: number;
  scrapSalesRevenueUsd: number;
  powerCutCount: number;
  powerCutHours: number;
  generatorRunHours: number;
  generatorFuelLitres: number;
  dieselIssuedLitres: number;
  dieselReceivedLitres: number;
  dieselTankLevelLitres: number;
  // Cost of Poor Quality (COPQ) ($)
  copqScrapLossUsd: number;
  copqDowntimeLossUsd: number;
  copqQualityHoldLossUsd: number;
  copqTotalGrossUsd: number;
  copqNetAfterRecoveryUsd: number;
  // Linked Tables
  detectedSignals: TqmDetectedSignal[];
  machineProfiles: TqmMachineLinkProfile[];
  productProfiles: TqmProductTraceProfile[];
  shiftCorrelation: TqmShiftCorrelationRow[];
  ishikawaCounts: Record<TqmIshikawaCategory, number>;
  allLinkedEntityCatalog: TqmLinkedEntityRef[];
}

function inDateRange(dateStr: string | undefined, fromDate: string, toDate: string): boolean {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  if (fromDate && d < fromDate) return false;
  if (toDate && d > toDate) return false;
  return true;
}

export function buildUnifiedTqmAnalytics(input: TqmAnalyticsInput): TqmUnifiedSnapshot {
  const today = ymd(new Date());
  const defaultFrom = `${today.slice(0, 7)}-01`;
  const fromDate = input.fromDate || defaultFrom;
  const toDate = input.toDate || today;

  // 1. Filter records in period cleanly
  const sopProd = input.sopProductionLogs.filter((r) => inDateRange(r.date, fromDate, toDate));
  const sopQc = input.sopQcChecks.filter((r) => inDateRange(r.date, fromDate, toDate));
  const qcLots = input.qcLogs.filter((r) => inDateRange(r.date, fromDate, toDate));
  const scrapPipe = input.sopScrapPipeline.filter((r) => inDateRange(r.date, fromDate, toDate));
  const mixing = input.sopMixingReports.filter((r) => inDateRange(r.date, fromDate, toDate));
  const handovers = input.sopHandovers.filter((r) => inDateRange(r.date, fromDate, toDate));
  const dispatches = input.dispatches.filter(
    (d) => !d.deleted && !d.isHistoricalBackground && inDateRange(d.date, fromDate, toDate)
  );
  const trials = input.qualityTrials.filter((t) => inDateRange(t.date, fromDate, toDate));
  const scrapSales = input.scrapSalesInvoices.filter((s) => inDateRange(s.date, fromDate, toDate));
  const powerCuts = input.powerCutLogs.filter((p) => inDateRange(p.date, fromDate, toDate));
  const genLogs = input.generatorLogs.filter((g) => inDateRange(g.date, fromDate, toDate));
  const dieselReqs = input.dieselRequests.filter(
    (r) => !r.isHistoricalCsv && inDateRange(r.date, fromDate, toDate)
  );
  const dieselGrns = input.dieselGrns.filter(
    (g) => !g.isHistoricalCsv && inDateRange(g.date, fromDate, toDate)
  );
  const attendance = input.attendanceBatch.filter(
    (a) => !a.isHistorical && inDateRange(a.date, fromDate, toDate)
  );
  const specialProd = input.specialOrderProductions.filter(
    (p) => !p.deleted && inDateRange(p.date, fromDate, toDate)
  );
  const specialWh = input.specialOrderWhDispatches.filter(
    (w) => !w.deleted && inDateRange(w.date, fromDate, toDate)
  );
  const downtimeInRange = input.downtimeEntries.filter(
    (e) => !e.del && inDateRange(e.start, fromDate, toDate)
  );

  // Machine summary rows from downtimeCalc
  const machineList =
    input.machines.length > 0 ? input.machines : ['Extrusion Machine 1', 'IM 1'];
  const summaryResult = getSummaryRows(fromDate, toDate, machineList, input.downtimeEntries);
  const summaryRows = summaryResult.structured;
  const summaryMap = new Map(summaryRows.map((r) => [normalizeMachineName(r.machine), r]));

  // Active Plans in period months
  const fromMonth = fromDate.slice(0, 7);
  const toMonth = toDate.slice(0, 7);
  const activePlans = input.monthlyPlans.filter(
    (p) => !p.superseded && p.month >= fromMonth && p.month <= toMonth
  );

  // CAPA map by signalKey
  const capaBySignal = new Map<string, TqmCapaRecord>();
  input.tqmCapas.forEach((c) => {
    if (c.sourceSignalKey && !capaBySignal.has(c.sourceSignalKey)) {
      capaBySignal.set(c.sourceSignalKey, c);
    }
  });

  // 2. Compute Global Production & Quality Metrics
  const totalSopProdKg = round2(sopProd.reduce((s, r) => s + (Number(r.prodKg) || 0), 0));
  const totalSopScrapKg = round2(sopProd.reduce((s, r) => s + (Number(r.scrapKg) || 0), 0));
  const totalWastageKg = round2(sopProd.reduce((s, r) => s + (Number(r.wastageCdKg) || 0), 0));
  const denomProdScrap = totalSopProdKg + totalSopScrapKg + totalWastageKg;
  const overallScrapRatePct =
    denomProdScrap > 0 ? round1(((totalSopScrapKg + totalWastageKg) / denomProdScrap) * 100) : 0;

  // Combine QC inspection lots + SOP floor QC checks for true FPY
  const sopQcPassCount = sopQc.filter(
    (q) =>
      String(q.dropBend).toLowerCase() !== 'fail' &&
      String(q.fitting).toLowerCase() !== 'fail' &&
      String(q.color).toLowerCase() !== 'fail'
  ).length;
  const qcLotsTested = qcLots.reduce((s, q) => s + (Number(q.samplesTested) || 0), 0);
  const qcLotsPassed = qcLots.reduce((s, q) => s + (Number(q.passedCount) || 0), 0);
  const totalQcInspections = qcLots.length + sopQc.length;
  const totalQcFailHold =
    qcLots.filter((q) => q.status === 'Rejected' || q.status === 'Hold').length +
    (sopQc.length - sopQcPassCount);

  const firstPassYieldPct = (() => {
    const sampleDenom = qcLotsTested + sopQc.length;
    if (sampleDenom === 0) return 100;
    const passSum = qcLotsPassed + sopQcPassCount;
    return round1((passSum / sampleDenom) * 100);
  })();

  const totalPeriodHrs = summaryRows.reduce((s, r) => s + r.periodHrs, 0);
  const totalRunHrs = summaryRows.reduce((s, r) => s + r.runHrs, 0);
  const totalBreakdownHrs = summaryRows.reduce((s, r) => s + r.breakdownHrs, 0);
  const machineAvailabilityPct =
    totalPeriodHrs > 0 ? round1((totalRunHrs / totalPeriodHrs) * 100) : 100;

  // Dispatch & Attainment
  const totalDispatchedUnits = dispatches.reduce(
    (s, d) => s + (Number(d.whReceivedQty ?? d.recordedQty) || 0),
    0
  );
  const totalDispatchedKg = round2(
    dispatches.reduce((s, d) => {
      const qty = Number(d.whReceivedQty ?? d.recordedQty) || 0;
      const uw = Number(d.unitWeightKg) || 0;
      return s + (uw > 0 ? qty * uw : Number(d.totalWeightKg) || 0);
    }, 0)
  );
  const pendingWhDispatches = dispatches.filter((d) => d.status === 'PENDING_WH').length;
  const pendingHodDispatches = dispatches.filter((d) => d.status === 'PENDING_HOD').length;
  const whVarianceList = dispatches.filter(
    (d) =>
      typeof d.whReceivedQty === 'number' &&
      Math.abs((d.whReceivedQty || 0) - (d.recordedQty || 0)) > 0.01
  );
  const specialWhVarianceList = specialWh.filter(
    (w) =>
      typeof w.totalWhReceivedQty === 'number' &&
      Math.abs((w.totalWhReceivedQty || 0) - (w.totalRecordedQty || 0)) > 0.01
  );
  const totalWhVariances = whVarianceList.length + specialWhVarianceList.length;

  const totalPlannedQty = activePlans.reduce((s, p) => s + (Number(p.plannedQty) || 0), 0);
  const planAttainmentPct =
    totalPlannedQty > 0
      ? round1(Math.min(100, (totalDispatchedUnits / totalPlannedQty) * 100))
      : 100;

  // Recycling, Mixing & Scrap Sales closed loop
  const scrapSentToRecyclingKg = round2(
    scrapPipe.reduce((s, r) => s + (Number(r.scrapKg) || 0), 0)
  );
  const usableRegrindProducedKg = round2(
    scrapPipe.reduce((s, r) => s + (Number(r.usableMaterialKg) || 0), 0)
  );
  const recyclingWasteKg = round2(
    scrapPipe.reduce((s, r) => s + (Number(r.recyclingWasteKg) || 0), 0)
  );
  const closedLoopRecoveryPct =
    scrapSentToRecyclingKg > 0
      ? round1((usableRegrindProducedKg / scrapSentToRecyclingKg) * 100)
      : totalSopScrapKg > 0
      ? 0
      : 100;

  const mixerWhUsedKg = round2(mixing.reduce((s, m) => s + (Number(m.whMaterialUsedKg) || 0), 0));
  const mixerScrapUsedKg = round2(
    mixing.reduce((s, m) => s + (Number(m.scrapUsedInMixingKg) || 0), 0)
  );
  const mixerSweepingKg = round2(
    mixing.reduce((s, m) => s + (Number(m.sweepingMaterialKg) || 0), 0)
  );
  const mixerBatchesTotal = mixing.reduce((s, m) => s + (Number(m.batchesMixed) || 0), 0);

  const scrapSoldGrossKg = round2(
    scrapSales.reduce((s, inv) => s + (Number(inv.totalScrapQntyKg) || 0), 0)
  );
  const scrapSoldNetKg = round2(
    scrapSales.reduce((s, inv) => s + (Number(inv.totalNetKg) || 0), 0)
  );
  const scrapSalesRevenueUsd = round2(
    scrapSales.reduce((s, inv) => s + (Number(inv.totalCost) || 0), 0)
  );

  // Utilities: Power Cut, Generator, Diesel
  const powerCutMinsTotal = powerCuts.reduce((s, p) => s + (Number(p.durationMinutes) || 0), 0);
  const powerCutHours = round1(powerCutMinsTotal / 60);
  const generatorRunHours = round1(
    genLogs.reduce((s, g) => s + (Number(g.durationMinutes) || 0), 0) / 60
  );
  const generatorFuelLitres = round1(
    genLogs.reduce((s, g) => s + (Number(g.fuelUsedLitres) || 0), 0)
  );
  const dieselIssuedLitres = round1(
    dieselReqs
      .filter((r) => r.status === 'DISPENSED')
      .reduce((s, r) => s + (Number(r.actualLitresTaken ?? r.requestedLitres) || 0), 0)
  );
  const dieselReceivedLitres = round1(
    dieselGrns.reduce((s, g) => s + (Number(g.litresAdded) || 0), 0)
  );

  // Trials
  const approvedTrials = trials.filter((t) => t.overallVerdict === 'APPROVED_FOR_PRODUCTION').length;
  const rejectedTrials = trials.filter((t) => t.overallVerdict === 'REJECTED_HOLD').length;

  // CAPA counts & resolution
  const openCapaCount = input.tqmCapas.filter((c) => c.status === 'OPEN').length;
  const inProgressCapaCount = input.tqmCapas.filter((c) => c.status === 'IN_PROGRESS').length;
  const closedCapaCount = input.tqmCapas.filter((c) => c.status === 'VERIFIED_CLOSED').length;
  const capaClosureRatePct =
    input.tqmCapas.length > 0
      ? round1((closedCapaCount / input.tqmCapas.length) * 100)
      : 100;

  // Weighted Plant TQM Index
  const overallTqmIndex = round1(
    firstPassYieldPct * 0.3 +
      machineAvailabilityPct * 0.25 +
      Math.max(0, 100 - overallScrapRatePct * 2) * 0.2 +
      planAttainmentPct * 0.15 +
      capaClosureRatePct * 0.1
  );

  // Cost of Poor Quality (COPQ) Estimates ($)
  // Virgin polymer replacement cost ~$1.25/kg; regrind internal recovery value ~$0.65/kg; downtime cost ~$28/hr; reject/hold lot ~$45/lot
  const copqScrapLossUsd = round2((totalSopScrapKg + totalWastageKg + mixerSweepingKg) * 1.25);
  const copqDowntimeLossUsd = round2(totalBreakdownHrs * 28);
  const copqQualityHoldLossUsd = round2(totalQcFailHold * 45 + totalWhVariances * 22);
  const copqTotalGrossUsd = round2(copqScrapLossUsd + copqDowntimeLossUsd + copqQualityHoldLossUsd);
  const copqRecoveryOffset = round2(usableRegrindProducedKg * 0.65 + scrapSalesRevenueUsd);
  const copqNetAfterRecoveryUsd = round2(Math.max(0, copqTotalGrossUsd - copqRecoveryOffset));

  // 3. Auto-Detect Linked Cross-Module Quality Signals
  const detectedSignals: TqmDetectedSignal[] = [];

  // 3A. Failed or Hold QC Inspection Lots
  qcLots
    .filter((q) => q.status === 'Rejected' || q.status === 'Hold')
    .slice(0, 15)
    .forEach((q) => {
      const key = `qc_lot:${q.id}`;
      const machine = normalizeMachineName(q.machineOrLine) || q.machineOrLine || 'Plant Floor';
      detectedSignals.push({
        signalKey: key,
        title: `QC ${q.status} Lot — ${q.product || machine}`,
        severity: q.status === 'Rejected' ? 'CRITICAL' : 'HIGH',
        ishikawaCategory: 'Measurement',
        date: q.date,
        shift: q.shift === 'Night' ? 'Night' : 'Day',
        machine,
        product: q.product || 'General Product',
        summary: `${q.defectsCount}/${q.samplesTested} defects (${q.defectReason || 'Spec non-conformance'}). Inspector: ${q.inspector}.`,
        estimatedCopqUsd: round2(45 + (Number(q.defectsCount) || 0) * 3.5),
        scrapImpactKg: 0,
        downtimeImpactMins: 0,
        suggestedRootCause: `Lot failed ${q.defectReason || 'dimensional/visual inspection'}. Check extrusion/moulding process window and resin moisture.`,
        linkedRefs: [
          {
            module: 'QC_INSPECTION',
            recordId: q.id,
            label: `QC Lot ${q.date} · ${q.product} (${q.status})`,
            date: q.date,
          },
        ],
        linkedCapa: capaBySignal.get(key),
      });
    });

  // 3B. Failed SOP Floor QC Checks
  sopQc
    .filter(
      (q) =>
        String(q.dropBend).toLowerCase() === 'fail' ||
        String(q.fitting).toLowerCase() === 'fail' ||
        String(q.color).toLowerCase() === 'fail'
    )
    .slice(0, 15)
    .forEach((q) => {
      const failedTests = [
        String(q.dropBend).toLowerCase() === 'fail' ? 'Drop/Bend' : null,
        String(q.fitting).toLowerCase() === 'fail' ? 'Fitting' : null,
        String(q.color).toLowerCase() === 'fail' ? 'Colour' : null,
      ]
        .filter(Boolean)
        .join(', ');
      const key = `sop_qc:${q.id}`;
      const machine = normalizeMachineName(q.machine) || q.machine;
      detectedSignals.push({
        signalKey: key,
        title: `Floor QC Failure (${failedTests}) — ${machine}`,
        severity: failedTests.includes('Drop/Bend') || failedTests.includes('Fitting') ? 'HIGH' : 'MEDIUM',
        ishikawaCategory: 'Method',
        date: q.date,
        shift: q.shift,
        machine,
        product: q.product,
        summary: `QC Check ${q.qcNo || q.id.slice(0, 6)} failed ${failedTests} on ${q.product} (Weight: ${q.weightKg || '-'} kg).`,
        estimatedCopqUsd: 35,
        scrapImpactKg: 0,
        downtimeImpactMins: 0,
        suggestedRootCause: `Check die temperature, wall thickness weight check, cooling bath flow, and masterbatch dispersion for ${failedTests}.`,
        linkedRefs: [
          {
            module: 'SOP_QC',
            recordId: q.id,
            label: `Floor QC ${q.date} ${q.shift} · ${machine}`,
            date: q.date,
          },
        ],
        linkedCapa: capaBySignal.get(key),
      });
    });

  // 3C. Rejected / Conditional Quality Trials
  trials
    .filter((t) => t.overallVerdict !== 'APPROVED_FOR_PRODUCTION')
    .forEach((t) => {
      const key = `trial:${t.id}`;
      const machine = normalizeMachineName(t.machine) || t.machine;
      detectedSignals.push({
        signalKey: key,
        title: `Trial ${t.overallVerdict === 'REJECTED_HOLD' ? 'Rejected Hold' : 'Conditional Release'} — ${t.trialNo}`,
        severity: t.overallVerdict === 'REJECTED_HOLD' ? 'CRITICAL' : 'MEDIUM',
        ishikawaCategory: 'Material',
        date: t.date,
        shift: t.shift,
        machine,
        product: t.product,
        summary: `${t.trialCategory} trial on ${t.product} verdict: ${t.overallVerdict.replace(/_/g, ' ')}.`,
        estimatedCopqUsd: t.overallVerdict === 'REJECTED_HOLD' ? 120 : 40,
        scrapImpactKg: 0,
        downtimeImpactMins: 0,
        suggestedRootCause: t.recommendations || `Formulation / regrind ratio ${t.scrapRatioPct || 'N/A'} did not achieve full spec pass.`,
        linkedRefs: [
          {
            module: 'QUALITY_TRIAL',
            recordId: t.id,
            label: `${t.trialNo} · ${t.product} (${t.overallVerdict})`,
            date: t.date,
          },
        ],
        linkedCapa: capaBySignal.get(key),
      });
    });

  // 3D. High Scrap Ratio Production Shifts (>= 8% scrap + wastage and >= 15kg total scrap)
  sopProd
    .filter((p) => {
      const loss = (Number(p.scrapKg) || 0) + (Number(p.wastageCdKg) || 0);
      const tot = (Number(p.prodKg) || 0) + loss;
      return loss >= 15 && tot > 0 && loss / tot >= 0.08;
    })
    .slice(0, 15)
    .forEach((p) => {
      const loss = round2((Number(p.scrapKg) || 0) + (Number(p.wastageCdKg) || 0));
      const tot = (Number(p.prodKg) || 0) + loss;
      const pct = round1((loss / tot) * 100);
      const key = `sop_prod:${p.id}`;
      const machine = normalizeMachineName(p.machine) || p.machine;
      detectedSignals.push({
        signalKey: key,
        title: `High Scrap Surge (${pct}%) — ${machine}`,
        severity: pct >= 15 ? 'CRITICAL' : 'HIGH',
        ishikawaCategory: 'Machine',
        date: p.date,
        shift: p.shift,
        machine,
        product: p.product,
        summary: `${loss} kg scrap/wastage vs ${p.prodKg} kg good production (${p.scrapReason || 'No reason noted'}). Operator: ${p.operator}.`,
        estimatedCopqUsd: round2(loss * 1.25),
        scrapImpactKg: loss,
        downtimeImpactMins: 0,
        suggestedRootCause: `Investigate ${p.scrapReason || 'start-up purge / die instability'} and operator changeover setup on ${machine}.`,
        linkedRefs: [
          {
            module: 'SOP_PRODUCTION',
            recordId: p.id,
            label: `Job Card ${p.date} ${p.shift} · ${machine} (${loss}kg scrap)`,
            date: p.date,
          },
        ],
        linkedCapa: capaBySignal.get(key),
      });
    });

  // 3E. WH Dispatch Quantity Variances
  whVarianceList.slice(0, 12).forEach((d) => {
    const diff = round2((d.whReceivedQty || 0) - (d.recordedQty || 0));
    const key = `dispatch_var:${d.id}`;
    const machine = normalizeMachineName(d.machine) || d.machine;
    detectedSignals.push({
      signalKey: key,
      title: `WH Dispatch Variance (${diff > 0 ? '+' : ''}${diff}) — ${d.product}`,
      severity: Math.abs(diff) >= 20 ? 'HIGH' : 'MEDIUM',
      ishikawaCategory: 'Measurement',
      date: d.date,
      shift: d.shift,
      machine,
      product: d.product,
      summary: `Shift recorded ${d.recordedQty}, WH confirmed ${d.whReceivedQty} (Reason: ${d.whQtyEditReason || 'Count discrepancy'}).`,
      estimatedCopqUsd: round2(Math.abs(diff) * 1.5),
      scrapImpactKg: 0,
      downtimeImpactMins: 0,
      suggestedRootCause: `Audit trolley counting between ${d.shiftInChargeName} and ${d.whPersonnelName || 'WH'}. Reason noted: ${d.whQtyEditReason || 'Not specified'}.`,
      linkedRefs: [
        {
          module: 'DISPATCH',
          recordId: d.id,
          label: `Dispatch ${d.date} · ${d.trolleyNo} (${d.recordedQty} vs ${d.whReceivedQty})`,
          date: d.date,
        },
      ],
      linkedCapa: capaBySignal.get(key),
    });
  });

  // 3F. Recurring Machine Breakdown Hotspots (>= 2 breakdowns or >= 120 mins)
  const bdByMachine = new Map<string, DowntimeEntry[]>();
  downtimeInRange
    .filter((e) => (e.cat || '').toLowerCase().includes('breakdown'))
    .forEach((e) => {
      const m = normalizeMachineName(e.m) || e.m;
      const arr = bdByMachine.get(m) || [];
      arr.push(e);
      bdByMachine.set(m, arr);
    });
  bdByMachine.forEach((list, machine) => {
    const row = summaryMap.get(machine);
    const bdMins = Math.round((row?.breakdownHrs || 0) * 60);
    if (list.length >= 2 || bdMins >= 120) {
      const key = `bd_hotspot:${machine}:${fromDate}`;
      const topReasons = Array.from(new Set(list.map((x) => x.reason).filter(Boolean))).slice(0, 2);
      detectedSignals.push({
        signalKey: key,
        title: `Recurring Breakdown Hotspot (${list.length} stops · ${row?.breakdownHrs.toFixed(1) || 0}h) — ${machine}`,
        severity: bdMins >= 360 || list.length >= 4 ? 'CRITICAL' : 'HIGH',
        ishikawaCategory: 'Machine',
        date: list[0]?.start?.slice(0, 10) || toDate,
        shift: list[0]?.shift?.toLowerCase().includes('night') ? 'Night' : 'Day',
        machine,
        product: list[0]?.jcn || 'All Products',
        summary: `${list.length} breakdown incidents (${bdMins} mins lost). Top fault(s): ${topReasons.join('; ') || 'Mechanical/Electrical'}.`,
        estimatedCopqUsd: round2((bdMins / 60) * 28),
        scrapImpactKg: 0,
        downtimeImpactMins: bdMins,
        suggestedRootCause: `Perform root-cause preventive maintenance inspection on ${machine}: ${topReasons.join(', ') || 'recurring component wear'}.`,
        linkedRefs: list.slice(0, 4).map((e) => ({
          module: 'DOWNTIME',
          recordId: e.id,
          label: `Downtime ${String(e.start || '').slice(0, 16).replace('T', ' ')} · ${e.reason || e.cat}`,
          date: String(e.start || '').slice(0, 10) || toDate,
        })),
        linkedCapa: capaBySignal.get(key),
      });
    }
  });

  // 3G. Recycling Discrepancies
  scrapPipe
    .filter((s) => s.verificationStatus === 'Discrepancy Flagged')
    .forEach((s) => {
      const key = `scrap_disc:${s.id}`;
      const machine = normalizeMachineName(s.machine) || s.machine;
      detectedSignals.push({
        signalKey: key,
        title: `Recycling Weight Discrepancy — ${machine}`,
        severity: 'MEDIUM',
        ishikawaCategory: 'Material',
        date: s.date,
        shift: s.shift,
        machine,
        product: s.product,
        summary: `Floor sent ${s.scrapKg} kg, Recycling weighed ${s.receivedKg ?? 0} kg (Variance ${s.varianceKg ?? 0} kg).`,
        estimatedCopqUsd: round2(Math.abs(s.varianceKg || 0) * 1.25),
        scrapImpactKg: Math.abs(s.varianceKg || 0),
        downtimeImpactMins: 0,
        suggestedRootCause: `Verify floor scale calibration vs recycling bay scale and bag contamination between ${s.sentByAssistant} and ${s.receivedBy || 'Recycling'}.`,
        linkedRefs: [
          {
            module: 'SCRAP_PIPELINE',
            recordId: s.id,
            label: `Scrap Handover ${s.date} · ${machine} (${s.scrapKg}kg)`,
            date: s.date,
          },
        ],
        linkedCapa: capaBySignal.get(key),
      });
    });

  // 3H. Severe Power Cut Impact (>= 90 mins outage)
  powerCuts
    .filter((p) => (p.durationMinutes || 0) >= 90)
    .slice(0, 8)
    .forEach((p) => {
      const key = `power_cut:${p.id}`;
      detectedSignals.push({
        signalKey: key,
        title: `Major Utility Outage (${p.durationMinutes} mins) — ${p.affectedArea}`,
        severity: p.durationMinutes >= 240 ? 'HIGH' : 'MEDIUM',
        ishikawaCategory: 'Environment',
        date: p.date,
        shift: p.shift,
        machine: 'Generator',
        product: 'All Plant Lines',
        summary: `${p.reason || 'Power outage'} in ${p.affectedArea}. Generator ${p.generatorUsed ? 'activated' : 'NOT used'}.`,
        estimatedCopqUsd: round2((p.durationMinutes / 60) * 40),
        scrapImpactKg: 0,
        downtimeImpactMins: p.durationMinutes,
        suggestedRootCause: `Evaluate backup generator changeover latency and purge scrap recovery on extrusion lines after outage.`,
        linkedRefs: [
          {
            module: 'POWER_GEN',
            recordId: p.id,
            label: `Power Cut ${p.date} · ${p.affectedArea} (${p.durationMinutes}m)`,
            date: p.date,
          },
        ],
        linkedCapa: capaBySignal.get(key),
      });
    });

  detectedSignals.sort((a, b) => {
    const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    const unresolvedA = a.linkedCapa ? 0 : 1;
    const unresolvedB = b.linkedCapa ? 0 : 1;
    if (unresolvedA !== unresolvedB) return unresolvedB - unresolvedA;
    if (rank[a.severity] !== rank[b.severity]) return rank[b.severity] - rank[a.severity];
    return b.date.localeCompare(a.date);
  });

  // 4. Machine 360 Linked Profiles
  const powerDatesSet = new Set(powerCuts.map((p) => p.date));
  const machineProfiles: TqmMachineLinkProfile[] = machineList.map((rawM) => {
    const m = normalizeMachineName(rawM) || rawM;
    const row = summaryMap.get(m);
    const mProd = sopProd.filter((p) => normalizeMachineName(p.machine) === m);
    const mSopQc = sopQc.filter((q) => normalizeMachineName(q.machine) === m);
    const mQcLots = qcLots.filter((q) => normalizeMachineName(q.machineOrLine) === m);
    const mDisp = dispatches.filter((d) => normalizeMachineName(d.machine) === m);
    const mTrials = trials.filter((t) => normalizeMachineName(t.machine) === m);
    const mCapas = input.tqmCapas.filter(
      (c) => normalizeMachineName(c.machine) === m && c.status !== 'VERIFIED_CLOSED'
    );
    const mPowerStops = downtimeInRange.filter(
      (e) =>
        normalizeMachineName(e.m) === m &&
        ((e.cat || '').toLowerCase().includes('power') || powerDatesSet.has(String(e.start || '').slice(0, 10)))
    ).length;

    const sopProdQty = mProd.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const sopProdKg = round2(mProd.reduce((s, r) => s + (Number(r.prodKg) || 0), 0));
    const sopScrapKg = round2(mProd.reduce((s, r) => s + (Number(r.scrapKg) || 0), 0));
    const wastageKg = round2(mProd.reduce((s, r) => s + (Number(r.wastageCdKg) || 0), 0));
    const mDenom = sopProdKg + sopScrapKg + wastageKg;
    const scrapRatePct = mDenom > 0 ? round1(((sopScrapKg + wastageKg) / mDenom) * 100) : 0;

    const sopQcFail = mSopQc.filter(
      (q) =>
        String(q.dropBend).toLowerCase() === 'fail' ||
        String(q.fitting).toLowerCase() === 'fail' ||
        String(q.color).toLowerCase() === 'fail'
    ).length;
    const lotTested = mQcLots.reduce((s, q) => s + (Number(q.samplesTested) || 0), 0);
    const lotPass = mQcLots.reduce((s, q) => s + (Number(q.passedCount) || 0), 0);
    const lotFailHold = mQcLots.filter((q) => q.status === 'Rejected' || q.status === 'Hold').length;
    const qcDenom = lotTested + mSopQc.length;
    const qcPassRatePct =
      qcDenom > 0 ? round1(((lotPass + (mSopQc.length - sopQcFail)) / qcDenom) * 100) : 100;

    const avail = row ? row.availabilityPercent : 100;
    const qualityIndex = round1(
      avail * 0.4 + qcPassRatePct * 0.4 + Math.max(0, 100 - scrapRatePct * 2.5) * 0.2
    );

    return {
      machine: m,
      availabilityPct: round1(avail),
      runHrs: round1(row?.runHrs || 0),
      breakdownHrs: round1(row?.breakdownHrs || 0),
      changeoverHrs: round1(row?.changeoverHrs || 0),
      powerOutageLinkedCount: mPowerStops,
      sopProdQty,
      sopProdKg,
      sopScrapKg,
      wastageKg,
      scrapRatePct,
      qcChecksCount: mSopQc.length + mQcLots.length,
      qcPassRatePct,
      qcFailOrHoldCount: sopQcFail + lotFailHold,
      dispatchUnits: mDisp.reduce((s, d) => s + (Number(d.whReceivedQty ?? d.recordedQty) || 0), 0),
      whVarianceCount: mDisp.filter(
        (d) =>
          typeof d.whReceivedQty === 'number' &&
          Math.abs((d.whReceivedQty || 0) - (d.recordedQty || 0)) > 0.01
      ).length,
      trialsCount: mTrials.length,
      openCapaCount: mCapas.length,
      qualityIndex,
    };
  });

  // 5. Product End-to-End Traceability Profiles
  const productSet = new Set<string>();
  activePlans.forEach((p) => p.product && productSet.add(p.product.trim()));
  dispatches.forEach((d) => d.product && productSet.add(d.product.trim()));
  sopProd.forEach((p) => p.product && productSet.add(p.product.trim()));
  qcLots.forEach((q) => q.product && productSet.add(q.product.trim()));
  trials.forEach((t) => t.product && productSet.add(t.product.trim()));

  const productProfiles: TqmProductTraceProfile[] = Array.from(productSet)
    .map((prod) => {
      const key = prod.toLowerCase();
      const pPlans = activePlans.filter((p) => (p.product || '').trim().toLowerCase() === key);
      const pDisp = dispatches.filter((d) => (d.product || '').trim().toLowerCase() === key);
      const pSopProd = sopProd.filter((p) => (p.product || '').trim().toLowerCase() === key);
      const pSopQc = sopQc.filter((q) => (q.product || '').trim().toLowerCase() === key);
      const pQcLots = qcLots.filter((q) => (q.product || '').trim().toLowerCase() === key);
      const pTrials = trials.filter((t) => (t.product || '').trim().toLowerCase() === key);
      const pSpecial = specialProd.filter(
        (sp) =>
          (Array.isArray(sp.items) &&
            sp.items.some((i) => (i?.productName || '').trim().toLowerCase() === key)) ||
          (sp.orderTitle || '').trim().toLowerCase().includes(key)
      );
      const pCapas = input.tqmCapas.filter(
        (c) => (c.product || '').trim().toLowerCase() === key && c.status !== 'VERIFIED_CLOSED'
      );

      const plannedQty = pPlans.reduce((s, p) => s + (Number(p.plannedQty) || 0), 0);
      const dispatchedQty = pDisp.reduce(
        (s, d) => s + (Number(d.whReceivedQty ?? d.recordedQty) || 0),
        0
      );
      const dispatchedKg = round2(
        pDisp.reduce((s, d) => {
          const q = Number(d.whReceivedQty ?? d.recordedQty) || 0;
          const uw = Number(d.unitWeightKg) || 0;
          return s + (uw > 0 ? q * uw : Number(d.totalWeightKg) || 0);
        }, 0)
      );
      const sopProdQty = pSopProd.reduce((s, r) => s + (Number(r.qty) || 0), 0);
      const sopProdKg = round2(pSopProd.reduce((s, r) => s + (Number(r.prodKg) || 0), 0));
      const sopScrapKg = round2(
        pSopProd.reduce((s, r) => s + (Number(r.scrapKg) || 0) + (Number(r.wastageCdKg) || 0), 0)
      );
      const denom = sopProdKg + sopScrapKg;
      const scrapPct = denom > 0 ? round1((sopScrapKg / denom) * 100) : 0;

      const sopFail = pSopQc.filter(
        (q) =>
          String(q.dropBend).toLowerCase() === 'fail' ||
          String(q.fitting).toLowerCase() === 'fail' ||
          String(q.color).toLowerCase() === 'fail'
      ).length;
      const tested = pQcLots.reduce((s, q) => s + (Number(q.samplesTested) || 0), 0);
      const passed = pQcLots.reduce((s, q) => s + (Number(q.passedCount) || 0), 0);
      const qcDenom = tested + pSopQc.length;
      const qcPassRatePct =
        qcDenom > 0 ? round1(((passed + (pSopQc.length - sopFail)) / qcDenom) * 100) : 100;

      const primaryMachine =
        pPlans[0]?.machine || pDisp[0]?.machine || pSopProd[0]?.machine || pTrials[0]?.machine || 'Plant Line';

      return {
        product: prod,
        primaryMachine: normalizeMachineName(primaryMachine) || primaryMachine,
        plannedQty,
        dispatchedQty,
        dispatchedKg,
        planAttainmentPct: plannedQty > 0 ? round1((dispatchedQty / plannedQty) * 100) : 0,
        sopProdQty,
        sopProdKg,
        sopScrapKg,
        scrapPct,
        qcTotalChecks: pSopQc.length + pQcLots.length,
        qcPassRatePct,
        trialsApproved: pTrials.filter((t) => t.overallVerdict === 'APPROVED_FOR_PRODUCTION').length,
        trialsTotal: pTrials.length,
        whVarianceCount: pDisp.filter(
          (d) =>
            typeof d.whReceivedQty === 'number' &&
            Math.abs((d.whReceivedQty || 0) - (d.recordedQty || 0)) > 0.01
        ).length,
        specialOrderQty: pSpecial.reduce((s, sp) => s + (Number(sp.totalQty) || 0), 0),
        openCapaCount: pCapas.length,
      };
    })
    .sort(
      (a, b) =>
        b.dispatchedQty + b.sopProdKg + b.plannedQty - (a.dispatchedQty + a.sopProdKg + a.plannedQty)
    );

  // 6. Shift & Attendance Correlation (Day vs Night)
  const shiftCorrelation: TqmShiftCorrelationRow[] = (['Day', 'Night'] as const).map((shift) => {
    const sProd = sopProd.filter((p) => p.shift === shift);
    const sQc = sopQc.filter((q) => q.shift === shift);
    const sLots = qcLots.filter((q) => q.shift === shift);
    const sDisp = dispatches.filter((d) => d.shift === shift);
    const sHand = handovers.filter((h) => h.shift === shift);
    const sAtt = attendance.filter((a) => a.shift === shift);
    const sDown = downtimeInRange.filter((e) => {
      const sh = (e.shift || '').toLowerCase();
      return shift === 'Day' ? !sh.includes('night') : sh.includes('night');
    });

    const prodKg = round2(sProd.reduce((s, r) => s + (Number(r.prodKg) || 0), 0));
    const scrapKg = round2(
      sProd.reduce((s, r) => s + (Number(r.scrapKg) || 0) + (Number(r.wastageCdKg) || 0), 0)
    );
    const denom = prodKg + scrapKg;
    const scrapPct = denom > 0 ? round1((scrapKg / denom) * 100) : 0;

    const failQc = sQc.filter(
      (q) =>
        String(q.dropBend).toLowerCase() === 'fail' ||
        String(q.fitting).toLowerCase() === 'fail' ||
        String(q.color).toLowerCase() === 'fail'
    ).length;
    const lotT = sLots.reduce((s, q) => s + (Number(q.samplesTested) || 0), 0);
    const lotP = sLots.reduce((s, q) => s + (Number(q.passedCount) || 0), 0);
    const qcDenom = lotT + sQc.length;
    const qcPassRatePct =
      qcDenom > 0 ? round1(((lotP + (sQc.length - failQc)) / qcDenom) * 100) : 100;

    const breakdownMins = sDown.reduce((s, e) => {
      if (typeof e.durationMinutes === 'number' && e.durationMinutes > 0) return s + e.durationMinutes;
      if (e.start && e.end) {
        const diff = (new Date(e.end).getTime() - new Date(e.start).getTime()) / 60000;
        if (Number.isFinite(diff) && diff > 0) return s + diff;
      }
      return s;
    }, 0);

    const handoverAvgScrapPct =
      sHand.length > 0
        ? round1(sHand.reduce((s, h) => s + (Number(h.scrapPct) || 0), 0) / sHand.length)
        : scrapPct;

    let presentSum = 0;
    let casualPresentSum = 0;
    sAtt.forEach((b) => {
      const pres = b.rows.filter((r) => r.status === 'Present');
      presentSum += pres.reduce((s, r) => s + (Number(r.count) || 1), 0);
      casualPresentSum += pres
        .filter((r) => r.type === 'Casual')
        .reduce((s, r) => s + (Number(r.count) || 1), 0);
    });

    return {
      shift,
      sopProdKg: prodKg,
      sopScrapKg: scrapKg,
      scrapPct,
      qcPassRatePct,
      qcSamplesTested: qcDenom,
      breakdownMins: Math.round(breakdownMins),
      handoverAvgScrapPct,
      attendanceAvgHeadcount: sAtt.length > 0 ? Math.round(presentSum / sAtt.length) : 0,
      casualRatioPct: presentSum > 0 ? round1((casualPresentSum / presentSum) * 100) : 0,
      dispatchedQty: sDisp.reduce(
        (s, d) => s + (Number(d.whReceivedQty ?? d.recordedQty) || 0),
        0
      ),
    };
  });

  // 7. Ishikawa 6M distribution across CAPAs + unresolved signals
  const ishikawaCounts: Record<TqmIshikawaCategory, number> = {
    Machine: 0,
    Material: 0,
    Method: 0,
    Man: 0,
    Measurement: 0,
    Environment: 0,
  };
  input.tqmCapas.forEach((c) => {
    if (c.ishikawaCategory && c.ishikawaCategory in ishikawaCounts) {
      ishikawaCounts[c.ishikawaCategory] += 1;
    }
  });
  detectedSignals
    .filter((s) => !s.linkedCapa)
    .forEach((s) => {
      ishikawaCounts[s.ishikawaCategory] += 1;
    });

  // 8. Build Linkable Catalog across modules so manual CAPAs can link ANY record cleanly
  const allLinkedEntityCatalog: TqmLinkedEntityRef[] = [
    ...qcLots.slice(0, 25).map((q) => ({
      module: 'QC_INSPECTION' as const,
      recordId: q.id,
      label: `QC Lot: ${q.date} · ${q.product} (${q.status})`,
      date: q.date,
    })),
    ...sopQc.slice(0, 25).map((q) => ({
      module: 'SOP_QC' as const,
      recordId: q.id,
      label: `Floor QC: ${q.date} ${q.shift} · ${q.machine} (${q.product})`,
      date: q.date,
    })),
    ...trials.slice(0, 20).map((t) => ({
      module: 'QUALITY_TRIAL' as const,
      recordId: t.id,
      label: `Trial ${t.trialNo}: ${t.product} (${t.overallVerdict})`,
      date: t.date,
    })),
    ...downtimeInRange.slice(0, 25).map((e) => ({
      module: 'DOWNTIME' as const,
      recordId: e.id,
      label: `Downtime: ${String(e.start || '').slice(0, 10)} · ${e.m} (${e.cat})`,
      date: String(e.start || '').slice(0, 10),
    })),
    ...sopProd.slice(0, 25).map((p) => ({
      module: 'SOP_PRODUCTION' as const,
      recordId: p.id,
      label: `Job Card: ${p.date} ${p.shift} · ${p.machine} · ${p.product}`,
      date: p.date,
    })),
    ...dispatches.slice(0, 25).map((d) => ({
      module: 'DISPATCH' as const,
      recordId: d.id,
      label: `Dispatch: ${d.date} · ${d.product} (Qty ${d.whReceivedQty ?? d.recordedQty})`,
      date: d.date,
    })),
    ...scrapPipe.slice(0, 20).map((s) => ({
      module: 'SCRAP_PIPELINE' as const,
      recordId: s.id,
      label: `Scrap Pipeline: ${s.date} · ${s.machine} (${s.scrapKg}kg)`,
      date: s.date,
    })),
    ...scrapSales.slice(0, 15).map((i) => ({
      module: 'SCRAP_SALES' as const,
      recordId: i.id,
      label: `Scrap Invoice ${i.invoiceNo}: ${i.buyerName} ($${Number(i.totalCost || 0).toFixed(2)})`,
      date: i.date,
    })),
    ...powerCuts.slice(0, 15).map((p) => ({
      module: 'POWER_GEN' as const,
      recordId: p.id,
      label: `Power Cut: ${p.date} · ${p.affectedArea} (${p.durationMinutes}m)`,
      date: p.date,
    })),
  ];

  return {
    periodLabel: `${fromDate} to ${toDate}`,
    fromDate,
    toDate,
    overallTqmIndex,
    firstPassYieldPct,
    machineAvailabilityPct,
    planAttainmentPct,
    closedLoopRecoveryPct,
    capaClosureRatePct,
    totalSopProdKg,
    totalSopScrapKg,
    totalWastageKg,
    overallScrapRatePct,
    totalDispatchedUnits,
    totalDispatchedKg,
    totalWhVariances,
    pendingWhDispatches,
    pendingHodDispatches,
    totalQcInspections,
    totalQcFailHold,
    totalTrials: trials.length,
    approvedTrials,
    rejectedTrials,
    openCapaCount,
    inProgressCapaCount,
    closedCapaCount,
    scrapSentToRecyclingKg,
    usableRegrindProducedKg,
    recyclingWasteKg,
    mixerWhUsedKg,
    mixerScrapUsedKg,
    mixerSweepingKg,
    mixerBatchesTotal,
    scrapSoldGrossKg,
    scrapSoldNetKg,
    scrapSalesRevenueUsd,
    powerCutCount: powerCuts.length,
    powerCutHours,
    generatorRunHours,
    generatorFuelLitres,
    dieselIssuedLitres,
    dieselReceivedLitres,
    dieselTankLevelLitres: round1(input.dieselTank?.currentLevelLitres || 0),
    copqScrapLossUsd,
    copqDowntimeLossUsd,
    copqQualityHoldLossUsd,
    copqTotalGrossUsd,
    copqNetAfterRecoveryUsd,
    detectedSignals,
    machineProfiles,
    productProfiles,
    shiftCorrelation,
    ishikawaCounts,
    allLinkedEntityCatalog,
  };
}

// ======================================================
// ADMIN-ONLY BACKGROUND MULTI-SHEET TQM EXCEL WORKBOOK
// ======================================================

export function buildTqmMasterExcelWorkbook(
  analytics: TqmUnifiedSnapshot,
  capas: TqmCapaRecord[]
): { wb: XLSX.WorkBook; filename: string; rowCount: number } {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Executive Scorecard & COPQ
  const execRows = [
    ['LG PLAST TOTAL QUALITY MANAGEMENT (TQM) — LINKED PLANT AUDIT'],
    [`Audit Period: ${analytics.periodLabel}`, `Generated: ${new Date().toLocaleString()}`],
    [],
    ['KPI / Quality Dimension', 'Value', 'Linked Source Modules'],
    ['Overall Plant TQM Index (%)', `${analytics.overallTqmIndex}%`, 'All 14 Plant Modules'],
    ['First-Pass Quality Yield (FPY %)', `${analytics.firstPassYieldPct}%`, 'QC Inspections + Floor SOP QC'],
    ['Machine Availability (%)', `${analytics.machineAvailabilityPct}%`, 'Downtime Logs + Power Cuts'],
    ['Monthly Plan Attainment (%)', `${analytics.planAttainmentPct}%`, 'Monthly Plans + WH Confirmed Dispatch'],
    ['Closed-Loop Regrind Recovery (%)', `${analytics.closedLoopRecoveryPct}%`, 'Scrap Pipeline + Recycling Team'],
    ['CAPA Closure Rate (%)', `${analytics.capaClosureRatePct}%`, 'TQM CAPA Register'],
    [],
    ['Production Output (kg)', analytics.totalSopProdKg, 'SOP Job Cards'],
    ['Scrap + Wastage Generated (kg)', round2(analytics.totalSopScrapKg + analytics.totalWastageKg), 'SOP Job Cards'],
    ['Overall Scrap Rate (%)', `${analytics.overallScrapRatePct}%`, 'SOP Production'],
    ['Scrap Sold Gross / Net (kg)', `${analytics.scrapSoldGrossKg} / ${analytics.scrapSoldNetKg}`, 'Scrap Sales Invoices'],
    ['Scrap Sales Revenue ($ USD)', analytics.scrapSalesRevenueUsd, 'Scrap Sales Invoices'],
    [],
    ['COST OF POOR QUALITY (COPQ) ESTIMATE', 'Amount ($ USD)', 'Basis'],
    ['Gross Scrap & Sweeping Material Loss', analytics.copqScrapLossUsd, 'Scrap + Wastage + Sweeping @ $1.25/kg'],
    ['Breakdown Downtime Production Loss', analytics.copqDowntimeLossUsd, 'Breakdown hours @ $28/hr'],
    ['QC Rejects & WH Variance Exposure', analytics.copqQualityHoldLossUsd, 'Hold/Rejected lots & WH mismatches'],
    ['Total Gross COPQ ($)', analytics.copqTotalGrossUsd, 'Sum of Losses'],
    ['Net COPQ After Regrind & Scrap Sales ($)', analytics.copqNetAfterRecoveryUsd, 'Net Unrecovered Loss'],
  ];
  const wsExec = XLSX.utils.aoa_to_sheet(execRows);
  XLSX.utils.book_append_sheet(wb, wsExec, 'TQM_Executive_COPQ');

  // Sheet 2: Machine 360 Linked Matrix
  const machineSheetData = analytics.machineProfiles.map((m) => ({
    Machine: m.machine,
    'Quality Index (%)': m.qualityIndex,
    'Availability (%)': m.availabilityPct,
    'Run Hrs': m.runHrs,
    'Breakdown Hrs': m.breakdownHrs,
    'Changeover Hrs': m.changeoverHrs,
    'Power Linked Stops': m.powerOutageLinkedCount,
    'Prod Qty': m.sopProdQty,
    'Prod (kg)': m.sopProdKg,
    'Scrap (kg)': m.sopScrapKg,
    'Wastage (kg)': m.wastageKg,
    'Scrap Rate (%)': m.scrapRatePct,
    'QC Checks': m.qcChecksCount,
    'QC FPY (%)': m.qcPassRatePct,
    'QC Fails/Holds': m.qcFailOrHoldCount,
    'Dispatched Units': m.dispatchUnits,
    'WH Variances': m.whVarianceCount,
    'Quality Trials': m.trialsCount,
    'Open CAPAs': m.openCapaCount,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(machineSheetData.length ? machineSheetData : [{ Note: 'No data' }]),
    'Machine_360_Matrix'
  );

  // Sheet 3: Product & Dispatch Traceability
  const prodSheetData = analytics.productProfiles.map((p) => ({
    Product: p.product,
    'Primary Machine': p.primaryMachine,
    'Planned Qty': p.plannedQty,
    'Dispatched Qty': p.dispatchedQty,
    'Dispatched (kg)': p.dispatchedKg,
    'Plan Attainment (%)': p.planAttainmentPct,
    'SOP Prod Qty': p.sopProdQty,
    'SOP Prod (kg)': p.sopProdKg,
    'Scrap+Wastage (kg)': p.sopScrapKg,
    'Scrap (%)': p.scrapPct,
    'QC Checks': p.qcTotalChecks,
    'QC FPY (%)': p.qcPassRatePct,
    'Approved Trials': `${p.trialsApproved}/${p.trialsTotal}`,
    'WH Variances': p.whVarianceCount,
    'Special Order Qty': p.specialOrderQty,
    'Open CAPAs': p.openCapaCount,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(prodSheetData.length ? prodSheetData : [{ Note: 'No products' }]),
    'Product_Traceability'
  );

  // Sheet 4: Shift & Attendance Correlation
  const shiftSheetData = analytics.shiftCorrelation.map((s) => ({
    Shift: s.shift,
    'SOP Prod (kg)': s.sopProdKg,
    'SOP Scrap (kg)': s.sopScrapKg,
    'Scrap Rate (%)': s.scrapPct,
    'QC FPY (%)': s.qcPassRatePct,
    'QC Samples Tested': s.qcSamplesTested,
    'Breakdown Mins': s.breakdownMins,
    'Handover Avg Scrap (%)': s.handoverAvgScrapPct,
    'Avg Staff Present': s.attendanceAvgHeadcount,
    'Casuals Ratio (%)': s.casualRatioPct,
    'Dispatched Units': s.dispatchedQty,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shiftSheetData), 'Shift_Attendance_Link');

  // Sheet 5: Live Signals & NCR/CAPA Register
  const capaSheetData = capas.map((c) => ({
    'CAPA No': c.capaNo,
    Date: c.date,
    Shift: c.shift,
    Status: c.status,
    Severity: c.severity,
    '6M Category': c.ishikawaCategory,
    Title: c.title,
    Machine: c.machine,
    Product: c.product,
    'Problem Statement': c.problemStatement,
    'Root Cause (5-Why)': c.rootCause5Why,
    Containment: c.containmentAction,
    'Corrective Action': c.correctiveAction,
    'Preventive Action': c.preventiveAction,
    'COPQ ($)': c.estimatedCopqUsd,
    'Scrap Impact (kg)': c.scrapImpactKg,
    'Downtime (mins)': c.downtimeImpactMins,
    'Linked Modules': c.linkedRefs.map((r) => `${r.module}:${r.label}`).join(' | '),
    Owner: c.ownerName,
    'Due Date': c.targetDueDate,
    'Raised By': c.raisedByName,
    'HOD Verified By': c.verifiedByHodName || 'Pending',
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(capaSheetData.length ? capaSheetData : [{ Note: 'No CAPAs logged' }]),
    'NCR_CAPA_Register'
  );

  const rowCount =
    analytics.machineProfiles.length +
    analytics.productProfiles.length +
    analytics.detectedSignals.length +
    capas.length;

  return {
    wb,
    filename: `LGPLAST_TQM_Master_Audit_${analytics.fromDate}_to_${analytics.toDate}.xlsx`,
    rowCount,
  };
}

export async function exportTqmMasterExcelWorkbook(
  analytics: TqmUnifiedSnapshot,
  capas: TqmCapaRecord[],
  isAdmin: boolean
): Promise<boolean> {
  if (!isAdmin) return false;
  const { wb, filename } = buildTqmMasterExcelWorkbook(analytics, capas);
  const out = await XLSX.writeAsync(wb, { bookType: 'xlsx', type: 'array' });
  saveFileBlob(
    filename,
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  );
  return true;
}

function downloadCsvMatrix(filename: string, rows: (string | number)[][]): void {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  saveFileBlob(filename, new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
}

export function exportTqmMachinesCsv(analytics: TqmUnifiedSnapshot): string {
  const filename = `LGPLAST_TQM_Machine_360_${analytics.fromDate}_to_${analytics.toDate}.csv`;
  const rows: (string | number)[][] = [
    ['LG PLAST TQM — MACHINE 360 LINKED RELIABILITY & QUALITY REPORT', analytics.periodLabel],
    [],
    [
      'Machine',
      'Quality Index %',
      'Availability %',
      'Run Hrs',
      'Breakdown Hrs',
      'Changeover Hrs',
      'Power-Linked Stops',
      'SOP Prod Qty',
      'SOP Prod (kg)',
      'Scrap (kg)',
      'Wastage (kg)',
      'Scrap+Waste %',
      'QC Checks',
      'QC FPY %',
      'QC Fail/Hold',
      'Dispatched Units',
      'WH Variances',
      'Trials Count',
      'Open CAPAs',
    ],
    ...analytics.machineProfiles.map((m) => [
      m.machine,
      m.qualityIndex,
      m.availabilityPct,
      m.runHrs,
      m.breakdownHrs,
      m.changeoverHrs,
      m.powerOutageLinkedCount,
      m.sopProdQty,
      m.sopProdKg,
      m.sopScrapKg,
      m.wastageKg,
      m.scrapRatePct,
      m.qcChecksCount,
      m.qcPassRatePct,
      m.qcFailOrHoldCount,
      m.dispatchUnits,
      m.whVarianceCount,
      m.trialsCount,
      m.openCapaCount,
    ]),
  ];
  downloadCsvMatrix(filename, rows);
  return filename;
}

export function exportTqmProductsCsv(analytics: TqmUnifiedSnapshot): string {
  const filename = `LGPLAST_TQM_Product_Traceability_${analytics.fromDate}_to_${analytics.toDate}.csv`;
  const rows: (string | number)[][] = [
    ['LG PLAST TQM — PRODUCT & DISPATCH END-TO-END TRACEABILITY REPORT', analytics.periodLabel],
    [],
    [
      'Product',
      'Primary Machine',
      'Planned Qty',
      'Dispatched Qty',
      'Dispatched (kg)',
      'Plan Attainment %',
      'SOP Prod Qty',
      'SOP Prod (kg)',
      'Scrap+Wastage (kg)',
      'Scrap %',
      'QC Checks',
      'QC FPY %',
      'Trials Approved',
      'Trials Total',
      'WH Variances',
      'Special Order Qty',
      'Open CAPAs',
    ],
    ...analytics.productProfiles.map((p) => [
      p.product,
      p.primaryMachine,
      p.plannedQty,
      p.dispatchedQty,
      p.dispatchedKg,
      p.planAttainmentPct,
      p.sopProdQty,
      p.sopProdKg,
      p.sopScrapKg,
      p.scrapPct,
      p.qcTotalChecks,
      p.qcPassRatePct,
      p.trialsApproved,
      p.trialsTotal,
      p.whVarianceCount,
      p.specialOrderQty,
      p.openCapaCount,
    ]),
  ];
  downloadCsvMatrix(filename, rows);
  return filename;
}

export function exportTqmCapasCsv(
  capas: TqmCapaRecord[],
  fromDate: string,
  toDate: string
): string {
  const filename = `LGPLAST_TQM_CAPA_Register_${fromDate}_to_${toDate}.csv`;
  const rows: (string | number)[][] = [
    ['LG PLAST TQM — LINKED NCR & CAPA REGISTER REPORT', `${fromDate} to ${toDate}`],
    [],
    [
      'CAPA No',
      'Date',
      'Shift',
      'Status',
      'Severity',
      'Ishikawa 6M',
      'Title',
      'Machine',
      'Product',
      'Problem Statement',
      '5-Why Root Cause',
      'Immediate Containment',
      'Corrective Action',
      'Preventive Action',
      'COPQ ($ USD)',
      'Scrap Impact (kg)',
      'Downtime (mins)',
      'Linked Records',
      'Owner',
      'Target Due Date',
      'Raised By',
      'HOD Verified By',
    ],
    ...capas.map((c) => [
      c.capaNo,
      c.date,
      c.shift,
      c.status,
      c.severity,
      c.ishikawaCategory,
      c.title,
      c.machine,
      c.product,
      c.problemStatement,
      c.rootCause5Why,
      c.containmentAction,
      c.correctiveAction,
      c.preventiveAction,
      c.estimatedCopqUsd,
      c.scrapImpactKg,
      c.downtimeImpactMins,
      (c.linkedRefs || []).map((r) => `[${r.module}] ${r.label}`).join(' | '),
      c.ownerName,
      c.targetDueDate,
      c.raisedByName,
      c.verifiedByHodName || 'Pending',
    ]),
  ];
  downloadCsvMatrix(filename, rows);
  return filename;
}

export function exportTqmSignalsCsv(analytics: TqmUnifiedSnapshot): string {
  const filename = `LGPLAST_TQM_Quality_Signals_${analytics.fromDate}_to_${analytics.toDate}.csv`;
  const rows: (string | number)[][] = [
    ['LG PLAST TQM — AUTO-DETECTED CROSS-MODULE QUALITY SIGNALS', analytics.periodLabel],
    [],
    [
      'Signal Key',
      'Severity',
      '6M Category',
      'Date',
      'Shift',
      'Machine',
      'Product',
      'Signal Title',
      'Summary',
      'Est. COPQ ($)',
      'Scrap Impact (kg)',
      'Downtime (mins)',
      'CAPA Linked',
    ],
    ...analytics.detectedSignals.map((s) => [
      s.signalKey,
      s.severity,
      s.ishikawaCategory,
      s.date,
      s.shift,
      s.machine,
      s.product,
      s.title,
      s.summary,
      s.estimatedCopqUsd,
      s.scrapImpactKg,
      s.downtimeImpactMins,
      s.linkedCapa ? `${s.linkedCapa.capaNo} (${s.linkedCapa.status})` : 'Unlinked',
    ]),
  ];
  downloadCsvMatrix(filename, rows);
  return filename;
}
